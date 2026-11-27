// M7.14.2 LABELLED STUBBED LIVE-DEMUX-SCHEMA TESTS — ZERO live calls.
// Reproduces the exact live `qiime2 demux emp-single` io_details shape: seqs
// qza, a `barcodes` conditional with a tabular `source` plus a default-less
// `column`, and section defaults. The column value must come from the REAL
// stored metadata header; failed submissions must be recorded as bounded,
// sanitized field-name summaries only.
import test from "node:test";
import assert from "node:assert/strict";

import { handleStatus, handleResumeStages } from "../functions/api/ai/workflows/microbiome/engine.js";
import { createFakeD1AI, makeGetRequest, makePostRequest, mockAIEnv } from "./helpers/fake-d1.mjs";

const RUN_ID = "job_a8817e35d7534d98";
const HISTORY = "11ac94870d0bb33aff42f70766c41aa1";
const QZA = "40160950115d555e26f11fc9fc50ace4";
const META = "44444444444444444444444444444444";
const DEMUX_TOOL = "toolshed.g2.bx.psu.edu/repos/iuc/qiime2_demux_emp_single/2026.1.0";
const IMPORT_JOB = "4838ba20a6d8676539a8440d60cb5a98";
const SECRET = "mock-api-key-SUPER-SECRET-do-not-log";

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function liveDemuxSchema() {
  return {
    tool_id: DEMUX_TOOL, tool_version: "2026.1.0",
    inputs: [
      { model_class: "DataToolParameter", name: "seqs", optional: false, extensions: ["qza"] },
      { model_class: "Conditional", name: "barcodes", optional: false,
        test_param: { name: "type", value: "tsv", options: [
          { value: "tsv", label: "Tabular metadata" }, { value: "qza", label: "QIIME 2 artifact" }
        ] },
        cases: [
          { value: "tsv", inputs: [
            { model_class: "DataToolParameter", name: "source", optional: false,
              extensions: ["tabular", "qiime2.tabular"] },
            { model_class: "ColumnListParameter", name: "column", optional: false }
          ] },
          { value: "qza", inputs: [
            { model_class: "TextToolParameter", name: "source", value: "" },
            { model_class: "TextToolParameter", name: "column", value: "" }
          ] }
        ] },
      { model_class: "Section", name: "extra_opts", inputs: [
        { model_class: "BooleanToolParameter", name: "golay_error_correction", value: "True" },
        { model_class: "BooleanToolParameter", name: "phred_quality_threshold", value: "False" }
      ] }
    ]
  };
}

const METADATA = "sample-id\tbarcode-sequence\tsite\nsampleA\tACCGCACTT\tgut\nsampleB\tGGACGGACG\tgut\n";

function stateAtDemux(overrides = {}) {
  return {
    workflow_type: "microbiome", run_id: RUN_ID, plan_id: "plan_a8817e35d7534d98",
    status: "running", current_step: "demux", created_at: "2026-11-27T00:00:00.000Z",
    input_sha256: "a".repeat(64), metadata_sha256: "b".repeat(64),
    input: { mode: "public", source: {}, metadata_text: METADATA,
      sample_ids: ["sampleA", "sampleB"], sample_count: 2,
      filenames: { reads: "sequences.fastq.gz", barcodes: "barcodes.fastq.gz", metadata: "sample-metadata.tsv" } },
    params: { trim_left: 0, trunc_len: 120, rarefaction_depth: null },
    discovery: { tools: { demux: { id: DEMUX_TOOL, name: "qiime2 demux emp-single", version: "2026.1.0" } },
      classifier: { available: false, reason: "no select option" }, discovery_mode: "live", discovered_at: null },
    dataset_ids: { sequences: "11111111111111111111111111111111",
      barcodes: "22222222222222222222222222222222", metadata: META },
    filenames: { reads: "sequences.fastq.gz", barcodes: "barcodes.fastq.gz", metadata: "sample-metadata.tsv" },
    history_id: HISTORY, frontier: { importedSeqsId: QZA }, results: {}, artifacts: [], errors: [], poll_count: 0,
    steps: { import_reads: { status: "succeeded", provider_job_id: "uploadjob00000001" } },
    exports: {}, pending_exports: [],
    import: { status: "succeeded", provider_job_id: IMPORT_JOB, output_dataset_id: QZA },
    ...overrides
  };
}

function seededDb(state) {
  return createFakeD1AI({ microbiome_runs: [{
    public_id: RUN_ID, input_sha256: state.input_sha256, metadata_sha256: state.metadata_sha256,
    state: state.status, plan_id: state.plan_id, run_id: RUN_ID, state_json: JSON.stringify(state),
    result_json: null, created_at: state.created_at, completed_at: null
  }] });
}

function makeStub({ submitStatus = 200, submitError = null } = {}) {
  const calls = [];
  const submissions = [];
  const fetchImpl = async (input, init = {}) => {
    const url = String(input);
    const method = String(init.method ?? "GET").toUpperCase();
    let body = null;
    if (typeof init.body === "string") { try { body = JSON.parse(init.body); } catch { body = null; } }
    calls.push({ method, url, body, init });
    if (url.includes("io_details=true")) {
      assert.ok(decodeURIComponent(url).includes(DEMUX_TOOL), "only the discovered demux schema may be read");
      return json(liveDemuxSchema());
    }
    if (method === "GET" && (url.includes("/api/tools?") || url.endsWith("/api/tools"))) {
      return json([{ id: DEMUX_TOOL, name: "qiime2 demux emp-single", version: "2026.1.0",
        model_class: "Tool", available: true }]);
    }
    if (url.includes("/api/workflows")) return json([]);
    if (method === "GET" && /\/api\/histories\/[^/]+\/contents/.test(url)) {
      return json([{ id: QZA, name: "imported-sequences.qza", extension: "qza", state: "ok", history_id: HISTORY }]);
    }
    if (method === "POST" && url.endsWith("/api/tools")) {
      submissions.push(body);
      if (submitStatus !== 200) return json(submitError ?? { error: "bad_request" }, submitStatus);
      return json({ outputs: [{ id: "ffffffffffffffffffffffffffffffff" }], jobs: [{ id: "demux-job-0001" }] });
    }
    if (method === "GET" && /\/api\/jobs\//.test(url)) {
      return json({ id: "demux-job-0001", state: "ok", history_id: HISTORY });
    }
    return json({ error: "unexpected_stub_route", url }, 404);
  };
  return { calls, submissions, fetchImpl };
}

function envFor(db, stub) {
  return { ...mockAIEnv(db), GALAXY_ENABLED: "true", GALAXY_BASE_URL: "https://galaxy.example.test",
    GALAXY_API_KEY: SECRET, FETCH_IMPL: stub.fetchImpl };
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

test("LIVE SCHEMA / barcode column comes from the real metadata header; defaults kept, nothing invented", async () => {
  const stub = makeStub();
  const { db, state: d1 } = seededDb(stateAtDemux());
  await withStub(stub, async () => {
    await status(db, stub); // unconditional membership proof
    await status(db, stub); // demux submission
    assert.equal(stub.submissions.length, 1);
    const submission = stub.submissions[0];
    assert.equal(submission.history_id, HISTORY, "the job targets the run history");
    const inputs = submission.inputs;
    assert.deepEqual(inputs.seqs, { src: "hda", id: QZA });
    assert.deepEqual(inputs["barcodes|source"], { src: "hda", id: META });
    assert.equal(inputs["barcodes|type"], "tsv", "the live default is preserved");
    assert.equal(inputs["barcodes|column"], "barcode-sequence", "the real header supplies the column");
    assert.equal(inputs["extra_opts|golay_error_correction"], "True", "Golay default from schema");
    assert.equal(inputs["extra_opts|phred_quality_threshold"], "False", "other schema defaults unchanged");
    assert.equal("column" in inputs, false, "no guessed top-level column parameter");
    const liveNames = new Set(["seqs", "barcodes|type", "barcodes|source", "barcodes|column",
      "extra_opts|golay_error_correction", "extra_opts|phred_quality_threshold"]);
    assert.ok(Object.keys(inputs).every((name) => liveNames.has(name)),
      `unexpected parameter names: ${Object.keys(inputs).join(", ")}`);
  });
});

test("LIVE SCHEMA / a different verified barcode header is used, never hardcoded", async () => {
  const alternate = "sample-id\tBarcodeSequence\tsite\nsampleA\tACCGCACTT\tgut\n";
  const stub = makeStub();
  const { db } = seededDb(stateAtDemux({ input: { ...stateAtDemux().input, metadata_text: alternate } }));
  await withStub(stub, async () => {
    await status(db, stub);
    await status(db, stub);
    assert.equal(stub.submissions[0].inputs["barcodes|column"], "BarcodeSequence");
  });
});

test("FAILED SUBMISSION / bounded sanitized field-name summary is persisted", async () => {
  const longError = `${SECRET}: ` + "upstream refused the request ".repeat(80);
  const stub = makeStub({ submitStatus: 400, submitError: { error: "bad_request", message: longError } });
  const { db, state: d1 } = seededDb(stateAtDemux());
  await withStub(stub, async () => {
    await status(db, stub); // membership proof
    const body = await status(db, stub); // demux submission fails
    assert.equal(body.status, "failed");
    const stored = storedState(d1);
    assert.equal(stored.steps.demux.status, "failed");
    assert.equal(stored.steps.demux.provider_job_id, null, "no provider job was created");
    const entry = stored.submission_failures?.[0];
    assert.ok(entry, "a submission failure diagnostic was recorded");
    assert.equal(entry.tool_id, DEMUX_TOOL);
    assert.equal(entry.tool_version, "2026.1.0");
    assert.equal(entry.http_status, 400);
    assert.ok(entry.field_names.includes("seqs"));
    assert.ok(entry.field_names.includes("barcodes|column"));
    const serialized = JSON.stringify(entry);
    assert.ok(serialized.length <= 1200, `diagnostic must stay bounded: ${serialized.length}`);
    assert.ok(String(entry.upstream_excerpt ?? "").length <= 600, "excerpt itself is capped");
    assert.doesNotMatch(serialized, new RegExp(SECRET));
    assert.doesNotMatch(serialized, /barcode-sequence/);
    assert.doesNotMatch(serialized, new RegExp(QZA));
    assert.doesNotMatch(serialized, new RegExp(META));
    assert.ok(entry.error_message.length <= 300);
  });
});

test("RESUME / eighth pre-job resume succeeds; ninth cap and provider-job failure are refused", async () => {
  const failedState = () => stateAtDemux({
    status: "failed", retry_count: 1, stage_resume_count: 7, current_step: "demux",
    steps: { import_reads: { status: "succeeded", provider_job_id: "uploadjob00000001" },
      demux: { status: "failed", reason: "demux submission failed: HTTP 400", provider_job_id: null } },
    errors: [{ step: "demux", reason: "demux submission failed: HTTP 400" }],
    frontier: { importedSeqsId: QZA }
  });
  const stub = makeStub();
  const { db, state: d1 } = seededDb(failedState());
  await withStub(stub, async () => {
    const resume = () => handleResumeStages(makePostRequest({ run_id: RUN_ID },
      "/api/ai/workflows/microbiome/resume-stages"), envFor(db, stub), { fetchImpl: stub.fetchImpl });
    const eighth = await resume();
    assert.equal(eighth.status, 202, JSON.stringify(await eighth.clone().json()));
    assert.equal((await eighth.json()).stage_resume_count, 8);
    assert.equal(storedState(d1).import.provider_job_id, IMPORT_JOB, "import preparation survived");
    assert.equal(storedState(d1).steps.demux, undefined);

    const refail = (count, demux) => {
      const row = d1.tables.microbiome_runs[0];
      const state = JSON.parse(row.state_json);
      state.status = "failed";
      state.stage_resume_count = count;
      state.steps.demux = demux;
      row.state_json = JSON.stringify(state);
      row.state = "failed";
    };
    refail(8, { status: "failed", reason: "demux submission failed: HTTP 400", provider_job_id: null });
    const capped = await resume();
    assert.equal(capped.status, 409);
    assert.equal((await capped.json()).reason, "stage_resume_limit_reached");

    refail(3, { status: "failed", reason: "demux submission failed: HTTP 400", provider_job_id: "real-provider-job" });
    const postJob = await resume();
    assert.equal(postJob.status, 409);
    // The unchanged started-stage guard refuses any real scientific job.
    assert.equal((await postJob.json()).reason, "scientific_stage_exists");
  });
});
