// M7.14.2 LABELLED STUBBED IMPORT-OUTPUT RECOVERY TESTS — ZERO live calls.
// Reproduces the live root cause: the real import job succeeded, but its qza
// landed in a DIFFERENT history from the run, so collectOutputs' history filter
// discarded it. This file proves read-only recovery in the output's own history,
// no resubmission, honest failure reasons, history-scoped future submissions,
// and that a final stage resume PRESERVES the existing import job.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { handleStatus, handleResumeStages } from "../functions/api/ai/workflows/microbiome/engine.js";
import { createFakeD1AI, makeGetRequest, makePostRequest, mockAIEnv } from "./helpers/fake-d1.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const fixture = (name) => readFileSync(resolve(HERE, "fixtures/m7_14_microbiome", name), "utf8");

const RUN_ID = "job_a8817e35d7534d98";
const RUN_HISTORY = "11ac94870d0bb33aff42f70766c41aa1";
const OUTPUT_HISTORY = "11ac94870d0bb33aa1d667180c20abd0";
const IMPORT_JOB = "4838ba20a6d8676539a8440d60cb5a98";
const REAL_QZA = "40160950115d555e26f11fc9fc50ace4";
const REAL_UUID = "6ffd23da-534e-4574-b11f-2172f639a1aa";
const READS = "311309378", BARCODES = "311309379";
const METADATA = "44444444444444444444444444444444";
const IMPORT_TOOL = "toolshed.g2.bx.psu.edu/repos/q2d2/qiime2_core__tools__import/2026.1.0+dist.h02a552c2";
const FORMAT = "SingleLanePerSampleSingleEndFastqDirFmt";
const DEMUX_TOOL = "toolshed.g2.bx.psu.edu/repos/iuc/qiime2_demux_emp_single/2026.1.0";
const QC_TOOL = "toolshed.g2.bx.psu.edu/repos/iuc/qiime2_vsearch_fastq_stats/2026.1.0";
const DENOISE_TOOL = "toolshed.g2.bx.psu.edu/repos/iuc/qiime2_dada2_denoise_single/2026.1.0";
const CLASSIFY_TOOL = "toolshed.g2.bx.psu.edu/repos/iuc/qiime2_feature_classifier_classify_sklearn/2026.1.0";
const EXPORT_TOOL = "toolshed.g2.bx.psu.edu/repos/q2d2/qiime2_core__tools__export/2026.1.0";

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}
function tool(id, name) {
  return { id, name, version: "2026.1.0", model_class: "Tool", available: true };
}
const TOOL_LIST = [
  tool(DEMUX_TOOL, "qiime2 demux emp-single"), tool(QC_TOOL, "qiime2 vsearch fastq-stats"),
  tool(DENOISE_TOOL, "qiime2 dada2 denoise-single"), tool(CLASSIFY_TOOL, "qiime2 feature-classifier classify-sklearn"),
  tool(IMPORT_TOOL, "qiime2 tools import"), tool(EXPORT_TOOL, "qiime2 tools export")
];

function schemaFor(toolId) {
  const data = (name, extensions) => ({ model_class: "DataToolParameter", name, extensions });
  if (toolId === DEMUX_TOOL) return { tool_id: toolId, inputs: [data("seqs", ["qza"]), data("metadata", ["tsv"])] };
  if (toolId === IMPORT_TOOL) {
    return { tool_id: toolId, inputs: [{
      model_class: "Conditional", name: "import_root",
      test_param: { name: "import_format", options: [{ value: FORMAT, label: "EMP single-end reads" }] },
      cases: [{ value: FORMAT, name: "emp_single", inputs: [
        { model_class: "DataToolParameter", name: "sequences", help: "Sequences", extensions: ["fastq.gz"] },
        { model_class: "DataToolParameter", name: "barcodes", help: "Barcodes", extensions: ["fastq.gz"] },
        { model_class: "TextToolParameter", name: "sequences_name", value: "sequences" },
        { model_class: "TextToolParameter", name: "barcodes_name", value: "barcodes" }
      ] }]
    }] };
  }
  if (toolId === CLASSIFY_TOOL) return { tool_id: toolId, inputs: [data("reads", ["fasta"]), data("classifier", ["qza"])] };
  return { tool_id: toolId, inputs: [{ model_class: "DataToolParameter", name: "input", extensions: ["tsv"] }] };
}

function stateAtDemux(overrides = {}) {
  return {
    workflow_type: "microbiome", run_id: RUN_ID, plan_id: "plan_a8817e35d7534d98",
    status: "running", current_step: "demux", created_at: "2026-11-27T00:00:00.000Z",
    input_sha256: "a".repeat(64), metadata_sha256: "b".repeat(64),
    input: { mode: "public", source: {}, sample_ids: ["sampleA", "sampleB", "sampleC"], sample_count: 3,
      filenames: { reads: "sequences.fastq.gz", barcodes: "barcodes.fastq.gz", metadata: "sample-metadata.tsv" } },
    params: { trim_left: 0, trunc_len: 120, rarefaction_depth: null },
    discovery: { tools: { demux: { id: DEMUX_TOOL, version: "2026.1.0" }, qc: { id: QC_TOOL, version: "2026.1.0" },
      denoise: { id: DENOISE_TOOL, version: "2026.1.0" }, classify: { id: CLASSIFY_TOOL, version: "2026.1.0" },
      importTool: { id: IMPORT_TOOL, version: "2026.1.0" }, exportTool: { id: EXPORT_TOOL, version: "2026.1.0" } },
    classifier: { available: false, reason: "no select option" }, discovery_mode: "live", discovered_at: null },
    dataset_ids: { sequences: READS, barcodes: BARCODES, metadata: METADATA },
    filenames: { reads: "sequences.fastq.gz", barcodes: "barcodes.fastq.gz", metadata: "sample-metadata.tsv" },
    history_id: RUN_HISTORY, frontier: {}, results: {}, artifacts: [], errors: [], poll_count: 0,
    steps: { import_reads: { status: "succeeded", provider_job_id: "uploadjob00000001" } },
    exports: {}, pending_exports: [], import: null, ...overrides
  };
}

// The live failure had demux=unavailable, but a final stage resume resets that
// step while PRESERVING state.import. These recovery tests use that live-shaped
// post-resume state; the resume test below starts from the unavailable step.
function liveImportState() {
  return stateAtDemux({
    import: { status: "unavailable", reason: "qza_import_output_missing", provider_job_id: IMPORT_JOB,
      tool_id: IMPORT_TOOL, source_dataset_ids: { reads: READS, barcodes: BARCODES } },
    errors: [{ step: "demux", reason: "qza_import_output_missing" }]
  });
}

function seededDb(state) {
  return createFakeD1AI({ microbiome_runs: [{
    public_id: RUN_ID, input_sha256: state.input_sha256, metadata_sha256: state.metadata_sha256,
    state: state.status, plan_id: state.plan_id, run_id: RUN_ID, state_json: JSON.stringify(state),
    result_json: null, created_at: state.created_at, completed_at: null
  }] });
}

function makeStub({ outputHistory = OUTPUT_HISTORY, outputState = "ok", outputExtension = "qza",
  outputName = "imported-sequences.qza", outputsOk = true, includeOutput = true } = {}) {
  const calls = [];
  const submissions = [];
  const fetchImpl = async (input, init = {}) => {
    const url = String(input);
    const method = String(init.method ?? "GET").toUpperCase();
    let body = null;
    if (typeof init.body === "string") { try { body = JSON.parse(init.body); } catch { body = null; } }
    calls.push({ method, url, body, init });
    assert.doesNotMatch(url, /blast|iprscan|ncbi|CMD=Put|rid=/i, "no external analysis route may be touched");
    if (method === "GET" && (url.includes("/api/tools?") || url.endsWith("/api/tools"))) return json(TOOL_LIST);
    if (url.includes("/api/workflows")) return json([]);
    if (url.includes("io_details=true")) {
      const decoded = decodeURIComponent(url);
      const id = TOOL_LIST.map((entry) => entry.id).find((toolId) => decoded.includes(toolId)) ?? DEMUX_TOOL;
      return json(schemaFor(id));
    }
    if (method === "GET" && /\/api\/histories\?/.test(url)) return json([{ id: RUN_HISTORY }]);
    if (method === "GET" && /\/api\/histories\//.test(url) && url.includes("/contents")) {
      const historyId = decodeURIComponent(url.slice(url.lastIndexOf("/histories/") + 11).split("/")[0]);
      if (historyId === outputHistory && includeOutput) {
        return json([{ id: REAL_QZA, uuid: REAL_UUID, name: outputName, extension: outputExtension,
          state: outputState, history_id: historyId }]);
      }
      // The run history contains only the three uploaded inputs: no qza.
      return json([
        { id: READS, name: "sequences.fastq.gz", extension: "fastq.gz", state: "ok", history_id: RUN_HISTORY },
        { id: BARCODES, name: "barcodes.fastq.gz", extension: "fastq.gz", state: "ok", history_id: RUN_HISTORY },
        { id: METADATA, name: "sample-metadata.tsv", extension: "tsv", state: "ok", history_id: RUN_HISTORY }
      ]);
    }
    if (method === "GET" && /\/api\/jobs\/[^/]+\/outputs/.test(url)) {
      if (!outputsOk) return json({ error: "outputs_unavailable" }, 404);
      return json({ output: { id: REAL_QZA, uuid: REAL_UUID, history_id: outputHistory,
        name: outputName, extension: outputExtension, state: outputState } });
    }
    if (method === "GET" && /\/api\/jobs\//.test(url)) {
      return json({ id: IMPORT_JOB, state: "ok", history_id: RUN_HISTORY });
    }
    if (method === "POST" && url.endsWith("/api/tools")) {
      submissions.push({ tool_id: body?.tool_id, history_id: body?.history_id, inputs: body?.inputs });
      return json({ outputs: [{ id: "ffffffffffffffffffffffffffffffff" }], jobs: [{ id: "new-job-0001" }] });
    }
    return json({ error: "unexpected_stub_route", url }, 404);
  };
  return {
    calls, submissions, fetchImpl,
    importSubmissions: () => submissions.filter((entry) => entry.tool_id === IMPORT_TOOL),
    historyLookups: () => calls.filter((call) => call.method === "GET" && call.url.includes(`/histories/${OUTPUT_HISTORY}/contents`))
  };
}

function envFor(db, stub) {
  return { ...mockAIEnv(db), GALAXY_ENABLED: "true", GALAXY_BASE_URL: "https://galaxy.example.test",
    GALAXY_API_KEY: "stub-key-not-a-real-secret", FETCH_IMPL: stub.fetchImpl };
}

async function withStub(stub, fn) {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = stub.fetchImpl;
  try { return await fn(); } finally { globalThis.fetch = previousFetch; }
}
async function status(db, stub) {
  const response = await handleStatus(makeGetRequest(`/api/ai/workflows/microbiome/status?run_id=${RUN_ID}`),
    envFor(db, stub), { fetchImpl: stub.fetchImpl });
  return response.json();
}
function storedState(d1) { return JSON.parse(d1.tables.microbiome_runs[0].state_json); }

test("RECOVERY / cross-history output yields the real qza id with no second import job", async () => {
  const stub = makeStub();
  const { db, state: d1 } = seededDb(liveImportState());
  await withStub(stub, async () => {
    await status(db, stub);
    assert.equal(stub.importSubmissions().length, 0, "a real job is never resubmitted");
    assert.equal(stub.historyLookups().length, 1, "the association's own history is read");
    const stored = storedState(d1);
    assert.equal(stored.frontier.importedSeqsId, REAL_QZA);
    assert.equal(stored.import.status, "succeeded");
    assert.equal(stored.import.output_dataset_id, REAL_QZA);
    assert.equal(stored.import.recovery.output_history_id, OUTPUT_HISTORY);
    assert.equal(stored.import.recovery.history_mismatch, true);
    assert.equal(stored.import.recovery.basis, "read_only_job_output_resolution_in_output_own_history");
    assert.equal(stored.import.output_history_id, OUTPUT_HISTORY);
    // A later poll must not re-recover or re-submit.
    await status(db, stub);
    assert.equal(stub.importSubmissions().length, 0);
    assert.equal(storedState(d1).frontier.importedSeqsId, REAL_QZA);
  });
});

test("RECOVERY / output not found, unreadable or not a qza records exact reasons and no job", async () => {
  const cases = [
    [{ includeOutput: false }, /output_dataset_not_found_in_its_history_or_not_ready/],
    [{ outputsOk: false }, /qza_import_outputs_unavailable/],
    [{ outputExtension: "tsv", outputName: "not-a-classifier.tsv" }, /output_not_qza_artifact/],
    [{ outputState: "queued" }, /output_dataset_not_found_in_its_history_or_not_ready/]
  ];
  for (const [options, reason] of cases) {
    const stub = makeStub(options);
    const { db, state: d1 } = seededDb(liveImportState());
    await withStub(stub, async () => {
      await status(db, stub);
      const stored = storedState(d1);
      assert.equal(stored.frontier.importedSeqsId, undefined, "no dataset id was guessed");
      assert.equal(stored.import.status, "unavailable");
      assert.match(stored.import.reason, /^qza_import_output_resolution_failed: /);
      assert.match(stored.import.reason, reason);
      assert.equal(stepsReason(stored), stored.import.reason);
      assert.equal(stub.importSubmissions().length, 0, "verification failure never submits an import");
    });
  }
});
function stepsReason(state) { return state.steps.demux?.reason; }

test("SAME HISTORY / unchanged path still resolves the real qza with no mismatch flag", async () => {
  const stub = makeStub({ outputHistory: RUN_HISTORY });
  const { db, state: d1 } = seededDb(liveImportState());
  await withStub(stub, async () => {
    await status(db, stub);
    const stored = storedState(d1);
    assert.equal(stored.frontier.importedSeqsId, REAL_QZA);
    assert.equal(stored.import.status, "succeeded");
    assert.equal(stored.import.recovery.output_history_id, RUN_HISTORY);
    assert.equal(stored.import.recovery.history_mismatch, false);
    assert.equal(stub.importSubmissions().length, 0);
  });
});

test("PREVENTION / every future provider submission carries the run history id", async () => {
  const stub = makeStub();
  const { db, state: d1 } = seededDb(stateAtDemux());
  await withStub(stub, async () => {
    for (let index = 0; index < 12 && storedState(d1).status === "running"; index += 1) await status(db, stub);
    assert.ok(stub.submissions.length >= 1, "at least the import job was submitted");
    assert.ok(stub.submissions.every((entry) => entry.history_id === RUN_HISTORY),
      `every provider submitJob must use the run history: ${JSON.stringify(stub.submissions)}`);
    assert.ok(stub.importSubmissions().length >= 1);
  });
});

test("RESUME / live-shaped final resume preserves the real import job id", async () => {
  const state = stateAtDemux({
    status: "failed", retry_count: 1, stage_resume_count: 2, current_step: "demux",
    import: { status: "unavailable", reason: "qza_import_output_missing", provider_job_id: IMPORT_JOB,
      tool_id: IMPORT_TOOL, source_dataset_ids: { reads: READS, barcodes: BARCODES } },
    steps: { import_reads: { status: "succeeded", provider_job_id: "uploadjob00000001" },
      demux: { status: "unavailable", reason: "qza_import_output_missing" },
      qc_summary: { status: "failed", reason: "qc_summary schema failure: no_data_input_for_reads" } },
    errors: [{ step: "demux", reason: "qza_import_output_missing" },
      { step: "qc_summary", reason: "qc_summary schema failure: no_data_input_for_reads" }]
  });
  const stub = makeStub();
  const { db, state: d1 } = seededDb(state);
  await withStub(stub, async () => {
    const response = await handleResumeStages(makePostRequest({ run_id: RUN_ID },
      "/api/ai/workflows/microbiome/resume-stages"), envFor(db, stub), { fetchImpl: stub.fetchImpl });
    assert.equal(response.status, 202, JSON.stringify(await response.clone().json()));
    const body = await response.json();
    assert.equal(body.resumed, true);
    assert.equal(body.stage_resume_count, 3);
    assert.equal(body.current_step, "demux");
    assert.ok(stub.calls.every((call) => call.method === "GET"), "resume must not submit any job");
    const stored = storedState(d1);
    assert.equal(stored.import.provider_job_id, IMPORT_JOB, "the real job id survives the final resume");
    assert.equal(stored.import.status, "unavailable");
    assert.equal(stored.frontier.importedSeqsId, undefined);
    assert.equal(stored.steps.demux, undefined, "demux is reset for the recovery path");
  });
});

test("RESUME / an import preparation job id on demux is not a scientific stage", async () => {
  const state = liveImportState();
  state.status = "failed";
  state.retry_count = 1;
  state.stage_resume_count = 2;
  state.steps.demux = { status: "unavailable", reason: "qza_import_output_missing", provider_job_id: IMPORT_JOB };
  const stub = makeStub();
  const { db, state: d1 } = seededDb(state);
  await withStub(stub, async () => {
    const response = await handleResumeStages(makePostRequest({ run_id: RUN_ID },
      "/api/ai/workflows/microbiome/resume-stages"), envFor(db, stub), { fetchImpl: stub.fetchImpl });
    assert.equal(response.status, 202, JSON.stringify(await response.clone().json()));
    assert.equal((await response.json()).resumed, true);
    const stored = storedState(d1);
    assert.equal(stored.import.provider_job_id, IMPORT_JOB);
    assert.equal(stored.steps.demux, undefined);
  });
});
