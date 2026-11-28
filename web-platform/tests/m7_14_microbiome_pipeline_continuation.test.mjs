// M7.14.2 LABELLED STUBBED PIPELINE-CONTINUATION TESTS — ZERO live calls.
// Reproduces the live success: demux emits two binary qza outputs; the run must
// keep their dataset ids without trying to read qza bytes as text, treat a qc
// schema/data mismatch as a non-fatal unavailable stage, and support one
// bounded continuation for a pre-job failure after succeeded stages.
import test from "node:test";
import assert from "node:assert/strict";

import {
  handleStatus, handleContinueStages
} from "../functions/api/ai/workflows/microbiome/engine.js";
import { createFakeD1AI, makeGetRequest, makePostRequest, mockAIEnv } from "./helpers/fake-d1.mjs";

const RUN_ID = "job_a8817e35d7534d98";
const HISTORY = "11ac94870d0bb33aff42f70766c41aa1";
const IMPORTED_QZA = "40160950115d555e26f11fc9fc50ace4";
const PER_SAMPLE_QZA = "40160950115d555e13e23a881bf39904";
const ERROR_QZA = "40160950115d555e362baf8e6d9e53df";
const META = "44444444444444444444444444444444";
const DEMUX_JOB = "4838ba20a6d86765bffba01b2682f823";
const DEMUX_TOOL = "toolshed.g2.bx.psu.edu/repos/iuc/qiime2_demux_emp_single/2026.1.0";
const QC_TOOL = "toolshed.g2.bx.psu.edu/repos/iuc/qiime2_vsearch_fastq_stats/2026.1.0";
const DENOISE_TOOL = "toolshed.g2.bx.psu.edu/repos/iuc/qiime2_dada2_denoise_single/2026.1.0";

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function tool(id, name) {
  return { id, name, version: "2026.1.0", model_class: "Tool", available: true };
}
const TOOLS = [tool(DEMUX_TOOL, "qiime2 demux emp-single"),
  tool(QC_TOOL, "qiime2 vsearch fastq-stats"), tool(DENOISE_TOOL, "qiime2 dada2 denoise-single")];

function schemaFor(toolId) {
  if (toolId === DEMUX_TOOL) return { tool_id: toolId, inputs: [
    { model_class: "DataToolParameter", name: "seqs", extensions: ["qza"] },
    { model_class: "DataToolParameter", name: "metadata", extensions: ["tsv"] }
  ] };
  if (toolId === QC_TOOL) {
    // Live-shaped mismatch: the qc tool's reads input cannot accept our qza.
    return { tool_id: toolId, inputs: [{ model_class: "DataToolParameter", name: "reads", extensions: ["qza"] }] };
  }
  return { tool_id: toolId, inputs: [{ model_class: "DataToolParameter", name: "table" }] };
}

function state(overrides = {}) {
  return {
    workflow_type: "microbiome", run_id: RUN_ID, plan_id: "plan_a8817e35d7534d98",
    status: "running", current_step: "demux", created_at: "2026-11-27T00:00:00.000Z",
    input_sha256: "a".repeat(64), metadata_sha256: "b".repeat(64),
    input: { mode: "public", source: {}, sample_ids: ["sampleA"], sample_count: 1,
      metadata_text: "sample-id\tbarcode-sequence\nsampleA\tACCGCACTT\n" },
    params: { trim_left: 0, trunc_len: 120, rarefaction_depth: null },
    discovery: { tools: { demux: { id: DEMUX_TOOL, version: "2026.1.0" },
      qc: { id: QC_TOOL, version: "2026.1.0" }, denoise: { id: DENOISE_TOOL, version: "2026.1.0" } },
    classifier: { available: false, reason: "none" }, discovery_mode: "live", discovered_at: null },
    dataset_ids: { metadata: META },
    filenames: { reads: "sequences.fastq.gz", barcodes: "barcodes.fastq.gz", metadata: "sample-metadata.tsv" },
    history_id: HISTORY, frontier: { importedSeqsId: IMPORTED_QZA }, results: {}, artifacts: [], errors: [], poll_count: 0,
    steps: { import_reads: { status: "succeeded", provider_job_id: "uploadjob00000001" } },
    exports: {}, pending_exports: [],
    import: { status: "succeeded", provider_job_id: "import-job-0001", output_dataset_id: IMPORTED_QZA,
      output_history_id: HISTORY, copy_dataset_id: IMPORTED_QZA, copy: { verified: true, reused: true } },
    ...overrides
  };
}

function seededDb(s) {
  return createFakeD1AI({ microbiome_runs: [{
    public_id: RUN_ID, input_sha256: s.input_sha256, metadata_sha256: s.metadata_sha256,
    state: s.status, plan_id: s.plan_id, run_id: RUN_ID, state_json: JSON.stringify(s),
    result_json: null, created_at: s.created_at, completed_at: null
  }] });
}

function makeStub({ demuxOutputsAvailable = false } = {}) {
  const submissions = [];
  const textFetches = [];
  let demuxSubmitted = false;
  const fetchImpl = async (input, init = {}) => {
    const url = String(input);
    const method = String(init.method ?? "GET").toUpperCase();
    let body = null;
    if (typeof init.body === "string") { try { body = JSON.parse(init.body); } catch { body = null; } }
    if (method === "GET" && (url.includes("/api/tools?") || url.endsWith("/api/tools"))) return json(TOOLS);
    if (url.includes("/api/workflows")) return json([]);
    if (url.includes("io_details=true")) {
      const decoded = decodeURIComponent(url);
      const id = TOOLS.map((entry) => entry.id).find((toolId) => decoded.includes(toolId)) ?? DEMUX_TOOL;
      return json(schemaFor(id));
    }
    if (method === "GET" && /\/api\/histories\/[^/]+\/contents/.test(url)) {
      const items = [{ id: IMPORTED_QZA, name: "imported-sequences.qza", extension: "qza",
        state: "ok", history_id: HISTORY }];
      if (demuxSubmitted || demuxOutputsAvailable) items.push(
        { id: PER_SAMPLE_QZA, name: "qiime2 demux emp-single on dataset 3 and 4: per_sample_sequences.qza",
          extension: "qza", state: "ok", history_id: HISTORY },
        { id: ERROR_QZA, name: "qiime2 demux emp-single on dataset 3 and 4: error_correction_details.qza",
          extension: "qza", state: "ok", history_id: HISTORY });
      return json(items);
    }
    if (method === "POST" && url.endsWith("/api/tools")) {
      const toolId = String(body?.tool_id ?? "");
      submissions.push({ tool_id: toolId, inputs: body?.inputs, history_id: body?.history_id });
      if (toolId === DEMUX_TOOL) {
        demuxSubmitted = true;
        return json({ outputs: [{ id: PER_SAMPLE_QZA }], jobs: [{ id: DEMUX_JOB }] });
      }
      if (toolId === DENOISE_TOOL) return json({ outputs: [], jobs: [{ id: "denoise-job-0001" }] });
      return json({ error: "schema_mismatch" }, 400);
    }
    if (method === "GET" && /\/api\/jobs\/[^/]+\/outputs/.test(url)) {
      if (url.includes(DEMUX_JOB)) return json({ seqs: { id: PER_SAMPLE_QZA, state: "ok" },
        details: { id: ERROR_QZA, state: "ok" } });
      return json({});
    }
    if (method === "GET" && /\/api\/jobs\//.test(url)) return json({ id: DEMUX_JOB, state: "ok", history_id: HISTORY });
    if (url.includes("/get_content_as_text")) {
      textFetches.push(url);
      return json({ error: "binary qza" }, 404);
    }
    return json({ error: "unexpected_stub_route", url }, 404);
  };
  return { fetchImpl, submissions, textFetches,
    demuxSubmission: () => submissions.find((entry) => entry.tool_id === DEMUX_TOOL),
    denoiseSubmission: () => submissions.find((entry) => entry.tool_id === DENOISE_TOOL) };
}

function envFor(db, stub) {
  return { ...mockAIEnv(db), GALAXY_ENABLED: "true", GALAXY_BASE_URL: "https://galaxy.example.test",
    GALAXY_API_KEY: "stub-key", FETCH_IMPL: stub.fetchImpl };
}
async function drive(db, stub, limit = 12) {
  let last = null;
  for (let index = 0; index < limit; index += 1) {
    last = await handleStatus(makeGetRequest(`/api/ai/workflows/microbiome/status?run_id=${RUN_ID}`),
      envFor(db, stub), { fetchImpl: stub.fetchImpl });
    const body = await last.clone().json();
    if (body.terminal || body.steps?.some((step) => step.step_id === "dada2_denoise" && step.status === "running")) break;
  }
  return last.json();
}
function stored(d1) { return JSON.parse(d1.tables.microbiome_runs[0].state_json); }

test("DEMUX / real per_sample_sequences.qza sets the frontier; binary qza is never read as text", async () => {
  const stub = makeStub();
  const { db, state: d1 } = seededDb(state());
  const previousFetch = globalThis.fetch;
  globalThis.fetch = stub.fetchImpl;
  try {
    await drive(db, stub, 3);
    const s = stored(d1);
    assert.equal(s.steps.demux.status, "succeeded");
    assert.equal(s.frontier.demuxReadsId, PER_SAMPLE_QZA);
    assert.equal(s.frontier.demuxErrorCorrectionDetailsId, ERROR_QZA);
    const provenance = s.steps.demux.demux_output_provenance;
    assert.equal(provenance.per_sample_sequences_dataset_id, PER_SAMPLE_QZA);
    assert.equal(provenance.error_correction_details_dataset_id, ERROR_QZA);
    assert.match(provenance.per_sample_sequences_name, /per_sample_sequences\.qza/);
    assert.equal(provenance.basis, "real_demux_job_output_qza");
    assert.equal(stub.textFetches.some((url) => url.includes(PER_SAMPLE_QZA) || url.includes(ERROR_QZA)), false,
      "binary qza must not be downloaded as text");
    assert.equal(s.errors.some((error) => String(error.reason).includes("content_unavailable")), false);
  } finally { globalThis.fetch = previousFetch; }
});

test("QC SCHEMA MISMATCH / stage is unavailable, run continues, DADA2 gets the demux qza id", async () => {
  const stub = makeStub();
  const { db, state: d1 } = seededDb(state());
  const previousFetch = globalThis.fetch;
  globalThis.fetch = stub.fetchImpl;
  try {
    const body = await drive(db, stub);
    const s = stored(d1);
    assert.equal(s.status, "running", "a qc schema mismatch must not fail the run");
    assert.equal(s.steps.qc_summary.status, "unavailable");
    assert.match(s.steps.qc_summary.reason, /no_data_input_for_reads|schema failure|galaxy returned HTTP 400/);
    assert.equal(s.steps.dada2_denoise.status, "running");
    assert.deepEqual(stub.denoiseSubmission()?.inputs.table, { src: "hda", id: PER_SAMPLE_QZA });
    assert.equal(stub.denoiseSubmission()?.history_id, HISTORY);
    assert.equal(body.status, "running");
  } finally { globalThis.fetch = previousFetch; }
});

function failedAfterDemux(overrides = {}) {
  return state({
    status: "failed", current_step: "qc_summary",
    steps: {
      import_reads: { status: "succeeded", provider_job_id: "uploadjob00000001" },
      demux: { status: "succeeded", provider_job_id: DEMUX_JOB, frontier: { demuxReadsId: PER_SAMPLE_QZA } },
      qc_summary: { status: "failed", reason: "qc_summary schema failure: no_data_input_for_reads", provider_job_id: null }
    },
    frontier: { importedSeqsId: IMPORTED_QZA, demuxReadsId: PER_SAMPLE_QZA },
    errors: [{ step: "qc_summary", reason: "qc_summary schema failure: no_data_input_for_reads" }],
    ...overrides
  });
}

test("CONTINUE / preserves succeeded demux job and resets only failed and later stages", async () => {
  const stub = makeStub();
  const { db, state: d1 } = seededDb(failedAfterDemux());
  const env = envFor(db, stub);
  const continueRun = () => handleContinueStages(makePostRequest({ run_id: RUN_ID },
    "/api/ai/workflows/microbiome/continue-stages"), env);
  const response = await continueRun();
  assert.equal(response.status, 202, JSON.stringify(await response.clone().json()));
  const body = await response.json();
  assert.equal(body.continued, true);
  assert.equal(body.current_step, "qc_summary");
  assert.equal(body.continue_count, 1);
  assert.deepEqual(body.preserved_succeeded_stages, ["demux"]);
  const s = stored(d1);
  assert.equal(s.steps.import_reads.status, "succeeded");
  assert.deepEqual(s.steps.demux.provider_job_id, DEMUX_JOB, "demux job id preserved");
  assert.equal(s.steps.qc_summary, undefined);
  assert.equal(s.steps.dada2_denoise, undefined);
  assert.equal(s.frontier.demuxReadsId, PER_SAMPLE_QZA, "retrieved artifact id preserved");
  assert.equal(s.status, "running");
  const refail = () => {
    const row = d1.tables.microbiome_runs[0];
    const current = JSON.parse(row.state_json);
    current.status = "failed";
    current.steps.qc_summary = { status: "unavailable", reason: "no_data_input_for_reads" };
    current.steps.dada2_denoise = { status: "failed", reason: "schema failure: no_data_input_for_reads", provider_job_id: null };
    row.state_json = JSON.stringify(current);
    row.state = "failed";
  };
  refail();
  const second = await continueRun();
  assert.equal(second.status, 202, JSON.stringify(await second.clone().json()));
  assert.equal((await second.json()).continue_count, 2);
  refail();
  const third = await continueRun();
  assert.equal(third.status, 202, JSON.stringify(await third.clone().json()));
  assert.equal((await third.json()).continue_count, 3);
  refail();
  const fourth = await continueRun();
  assert.equal(fourth.status, 202, JSON.stringify(await fourth.clone().json()));
  assert.equal((await fourth.json()).continue_count, 4);
  refail();
  const fifth = await continueRun();
  assert.equal(fifth.status, 409);
  assert.equal((await fifth.json()).reason, "continue_limit_reached");
});

function liveStaleState(overrides = {}) {
  return state({
    status: "failed", current_step: "dada2_denoise",
    steps: {
      import_reads: { status: "succeeded", provider_job_id: "uploadjob00000001" },
      demux: { status: "succeeded", provider_job_id: DEMUX_JOB, output_artifacts: [
        { name: "qiime2 demux emp-single on dataset 3 and 4: per_sample_sequences.qza",
          kind: "qza_artifact", dataset_id: PER_SAMPLE_QZA, checksum: "a".repeat(64) },
        { name: "qiime2 demux emp-single on dataset 3 and 4: error_correction_details.qza",
          kind: "qza_artifact", dataset_id: ERROR_QZA, checksum: "b".repeat(64) }
      ] },
      qc_summary: { status: "unavailable", reason: "no_data_input_for_reads" },
      dada2_denoise: { status: "failed", reason: "dada2_denoise schema failure: no_data_input_for_reads",
        provider_job_id: null }
    },
    frontier: { importedSeqsId: IMPORTED_QZA },
    artifacts: [
      { name: "qiime2 demux emp-single on dataset 3 and 4: per_sample_sequences.qza",
        kind: "qza_artifact", dataset_id: PER_SAMPLE_QZA, source_step: "demux" },
      { name: "qiime2 demux emp-single on dataset 3 and 4: error_correction_details.qza",
        kind: "qza_artifact", dataset_id: ERROR_QZA, source_step: "demux" }
    ],
    errors: [
      { step: "demux", dataset_id: PER_SAMPLE_QZA, reason: "content_unavailable" },
      { step: "demux", dataset_id: ERROR_QZA, reason: "content_unavailable" },
      { step: "dada2_denoise", reason: "dada2_denoise schema failure: no_data_input_for_reads" },
      { step: "import_reads", reason: "genuine upload diagnostic" }
    ],
    ...overrides
  });
}

test("REPAIR / live-shaped succeeded demux with missing frontier is repaired on continue", async () => {
  const stub = makeStub();
  const { db, state: d1 } = seededDb(liveStaleState());
  const env = envFor(db, stub);
  const previousFetch = globalThis.fetch;
  globalThis.fetch = stub.fetchImpl;
  try {
    const response = await handleContinueStages(makePostRequest({ run_id: RUN_ID },
      "/api/ai/workflows/microbiome/continue-stages"), env);
    assert.equal(response.status, 202, JSON.stringify(await response.clone().json()));
    const body = await response.json();
    assert.equal(body.frontier_repair.repaired, true);
    assert.equal(body.frontier_repair.dataset_id, PER_SAMPLE_QZA);
    let s = stored(d1);
    assert.equal(s.frontier.demuxReadsId, PER_SAMPLE_QZA);
    assert.equal(s.frontier.demuxErrorCorrectionDetailsId, ERROR_QZA);
    assert.equal(s.steps.demux.demux_output_provenance.basis, "repaired_from_stored_demux_output_artifacts");
    assert.equal(s.steps.demux.provider_job_id, DEMUX_JOB);
    assert.equal(s.errors.some((error) => String(error.reason).includes("content_unavailable")), false,
      "obsolete binary-download errors were pruned");
    assert.equal(s.errors.some((error) => String(error.reason).includes("genuine upload diagnostic")), true,
      "genuine non-demux failures stay");
    await drive(db, stub, 4);
    s = stored(d1);
    assert.equal(s.steps.dada2_denoise.status, "running");
    assert.deepEqual(stub.denoiseSubmission()?.inputs.table, { src: "hda", id: PER_SAMPLE_QZA });
    assert.equal(stub.submissions.some((entry) => entry.tool_id === DEMUX_TOOL), false,
      "the succeeded demux is never resubmitted");
    assert.equal(stub.textFetches.some((url) => url.includes(PER_SAMPLE_QZA)), false);
  } finally { globalThis.fetch = previousFetch; }
});

test("REPAIR / no stored artifacts but real demux provider outputs resolve the qza", async () => {
  const live = liveStaleState();
  live.artifacts = [];
  live.steps.demux.output_artifacts = [];
  live.errors = [
    { step: "demux", dataset_id: PER_SAMPLE_QZA, reason: "content_unavailable" },
    { step: "dada2_denoise", reason: "dada2_denoise schema failure: no_data_input_for_reads" }
  ];
  const stub = makeStub({ demuxOutputsAvailable: true });
  const { db, state: d1 } = seededDb(live);
  const env = envFor(db, stub);
  const previousFetch = globalThis.fetch;
  globalThis.fetch = stub.fetchImpl;
  try {
    const response = await handleContinueStages(makePostRequest({ run_id: RUN_ID },
      "/api/ai/workflows/microbiome/continue-stages"), env);
    assert.equal(response.status, 202, JSON.stringify(await response.clone().json()));
    const repair = (await response.json()).frontier_repair;
    assert.equal(repair.repaired, true);
    assert.equal(repair.dataset_id, PER_SAMPLE_QZA);
    assert.equal(repair.error_correction_dataset_id, ERROR_QZA);
    assert.equal(repair.basis, "recovered_from_demux_provider_job_outputs");
    let s = stored(d1);
    assert.equal(s.frontier.demuxReadsId, PER_SAMPLE_QZA);
    assert.equal(s.frontier.demuxReadsHistoryId, HISTORY);
    assert.equal(s.frontier.demuxReadsUuid, null);
    assert.equal(s.frontier.demuxErrorCorrectionDetailsId, ERROR_QZA);
    const provenance = s.steps.demux.demux_output_provenance;
    assert.equal(provenance.basis, "recovered_from_demux_provider_job_outputs");
    assert.equal(provenance.provider_job_id, DEMUX_JOB);
    assert.match(provenance.per_sample_sequences_name, /per_sample_sequences\.qza/);
    assert.equal(provenance.error_correction_details_dataset_id, ERROR_QZA);
    assert.equal(s.errors.some((error) => String(error.reason).includes("content_unavailable")), false);
    await drive(db, stub, 4);
    s = stored(d1);
    assert.equal(s.steps.dada2_denoise.status, "running");
    assert.deepEqual(stub.denoiseSubmission()?.inputs.table, { src: "hda", id: PER_SAMPLE_QZA });
    assert.equal(stub.submissions.some((entry) => entry.tool_id === DEMUX_TOOL), false,
      "the succeeded demux job is never resubmitted");
  } finally { globalThis.fetch = previousFetch; }
});

test("REPAIR / provider output resolution failure records an exact reason and invents nothing", async () => {
  const live = liveStaleState();
  live.artifacts = [];
  live.steps.demux.output_artifacts = [];
  const stub = makeStub(); // histories contain no demux qza outputs
  const { db, state: d1 } = seededDb(live);
  const response = await handleContinueStages(makePostRequest({ run_id: RUN_ID },
    "/api/ai/workflows/microbiome/continue-stages"), envFor(db, stub));
  assert.equal(response.status, 202);
  const repair = (await response.json()).frontier_repair;
  assert.equal(repair.repaired, false);
  assert.match(repair.reason, /provider_job_output_resolution_failed: no_ready_per_sample_sequences_qza/);
  const s = stored(d1);
  assert.equal(s.frontier.demuxReadsId, undefined);
  assert.match(s.steps.demux.demux_frontier_repair.reason, /no_stored_per_sample_sequences_qza_artifact/);
});

test("REPAIR / no matching stored qza leaves the frontier unset with an honest reason", async () => {
  const live = liveStaleState();
  live.steps.demux.output_artifacts = [];
  live.artifacts = [];
  const stub = makeStub();
  const { db, state: d1 } = seededDb(live);
  const env = envFor(db, stub);
  const response = await handleContinueStages(makePostRequest({ run_id: RUN_ID },
    "/api/ai/workflows/microbiome/continue-stages"), env);
  assert.equal(response.status, 202);
  const repair = (await response.json()).frontier_repair;
  assert.equal(repair.repaired, false);
  assert.equal(repair.dataset_id, null);
  assert.match(repair.reason, /no_stored_per_sample_sequences_qza_artifact/);
  assert.equal(repair.repaired, false);
  const s = stored(d1);
  assert.equal(s.frontier.demuxReadsId, undefined);
  assert.match(s.steps.demux.demux_frontier_repair.reason, /provider_job_output_resolution_failed|no demux reads id was invented/);
});

test("REPAIR / normal stage path repairs a running run without a continuation", async () => {
  const live = liveStaleState({
    status: "running", current_step: "dada2_denoise", continue_count: 0,
    steps: { import_reads: { status: "succeeded" }, demux: liveStaleState().steps.demux },
    errors: []
  });
  const stub = makeStub();
  const { db, state: d1 } = seededDb(live);
  const previousFetch = globalThis.fetch;
  globalThis.fetch = stub.fetchImpl;
  try {
    const body = await drive(db, stub, 3);
    assert.equal(body.status, "running");
    assert.equal(stored(d1).frontier.demuxReadsId, PER_SAMPLE_QZA);
    assert.deepEqual(stub.denoiseSubmission()?.inputs.table, { src: "hda", id: PER_SAMPLE_QZA });
    assert.equal(stub.submissions.some((entry) => entry.tool_id === DEMUX_TOOL), false);
  } finally { globalThis.fetch = previousFetch; }
});

test("CONTINUE / refuses a failed stage holding a provider job and a run without succeeded stages", async () => {
  const stub = makeStub();
  const { db } = seededDb(failedAfterDemux({
    steps: { ...failedAfterDemux().steps,
      qc_summary: { status: "failed", reason: "provider job ended in error", provider_job_id: "real-job-0001" } }
  }));
  const env = envFor(db, stub);
  const postJob = await handleContinueStages(makePostRequest({ run_id: RUN_ID },
    "/api/ai/workflows/microbiome/continue-stages"), env);
  assert.equal(postJob.status, 409);
  assert.equal((await postJob.json()).reason, "provider_job_failure_not_continuable");

  const { db: db2 } = seededDb(failedAfterDemux({
    steps: { import_reads: { status: "succeeded" },
      demux: { status: "failed", reason: "schema failure", provider_job_id: null } }
  }));
  const noSuccess = await handleContinueStages(makePostRequest({ run_id: RUN_ID },
    "/api/ai/workflows/microbiome/continue-stages"), envFor(db2, stub));
  assert.equal(noSuccess.status, 409);
  assert.equal((await noSuccess.json()).reason, "no_succeeded_scientific_stage");
});
