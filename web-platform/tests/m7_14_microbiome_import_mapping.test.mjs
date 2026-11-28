// M7.14.1 LABELLED STUBBED IMPORT-MAPPING + DIAGNOSTIC TESTS — ZERO live calls.
//
// The live EMP format case did not identify its data inputs through help text.
// These tests prove name-parameter regex evidence is preferred, that a bounded
// order fallback is recorded honestly, that >2 inputs still fail closed, and
// that the schema diagnostic is GET-only and returns metadata only.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseJson } from "../functions/api/ai/_lib.js";
import { handleStatus, handleImportSchema } from "../functions/api/ai/workflows/microbiome/engine.js";
import { createFakeD1AI, makeGetRequest, mockAIEnv } from "./helpers/fake-d1.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const fixture = (name) => readFileSync(resolve(HERE, "fixtures/m7_14_microbiome", name), "utf8");
const RUN_ID = "job_a8817e35d7534d98";
const HISTORY = "11ac94870d0bb33aff42f70766c41aa1";
const FORMAT = "SingleLanePerSampleSingleEndFastqDirFmt";
const IMPORT_TOOL = "toolshed.g2.bx.psu.edu/repos/q2d2/qiime2_core__tools__import/2026.1.0+dist.h02a552c2";
const DEMUX_TOOL = "toolshed.g2.bx.psu.edu/repos/iuc/qiime2_demux_emp_single/2026.1.0";
const READS = "22222222222222222222222222222222";
const BARCODES = "33333333333333333333333333333333";
const METADATA = "44444444444444444444444444444444";
const QZA = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const DEMUX_READS = "55555555555555555555555555555555";
const DEMUX_QC = "66666666666666666666666666666666";

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}
function toolMeta(id) {
  return { id, name: id, version: "2026.1.0", available: true };
}

function caseSchema({ mode = "name-regex", formatCase = true } = {}) {
  const data = (name) => ({ model_class: "DataToolParameter", name, help: "Input dataset", extensions: ["fastq.gz"] });
  const items = mode === "three"
    ? [data("input_1"), data("input_2"), data("input_3")]
    : [data("input_1"), data("input_2")];
  if (mode === "name-regex") {
    items.push({ model_class: "TextToolParameter", name: "name_1",
      help: "Name for this file, e.g. sequences.fastq.gz" });
    items.push({ model_class: "TextToolParameter", name: "name_2",
      help: "Name for this file, e.g. barcodes.fastq.gz" });
  }
  return {
    tool_id: IMPORT_TOOL,
    inputs: [{
      model_class: "Conditional", name: "import_root",
      test_param: { name: "root_format", options: [{ value: formatCase ? FORMAT : "OtherFormatFmt", label: "EMP" }] },
      cases: [{ value: formatCase ? FORMAT : "OtherFormatFmt", name: "emp", inputs: items }]
    }]
  };
}

function stateAtDemux() {
  const tools = { demux: toolMeta(DEMUX_TOOL), importTool: toolMeta(IMPORT_TOOL) };
  return {
    workflow_type: "microbiome", run_id: RUN_ID, plan_id: "plan_a8817e35d7534d98",
    status: "running", current_step: "demux", created_at: "2026-11-27T00:00:00.000Z",
    input: { mode: "public", source: {}, filenames: {
      reads: "sequences.fastq.gz", barcodes: "barcodes.fastq.gz", metadata: "sample-metadata.tsv" } },
    input_sha256: "a".repeat(64), metadata_sha256: "b".repeat(64),
    params: {}, discovery: { tools, classifier: { available: true, parameter_name: "classifier",
      option_value: "silva.qza", option_label: "SILVA 138" }, discovery_mode: "live", discovered_at: "now" },
    dataset_ids: { sequences: READS, barcodes: BARCODES, metadata: METADATA },
    filenames: { reads: "sequences.fastq.gz", barcodes: "barcodes.fastq.gz", metadata: "sample-metadata.tsv" },
    history_id: HISTORY, frontier: {}, steps: { import_reads: { status: "succeeded", provider_job_id: "uploadjob" } },
    results: {}, artifacts: [], errors: [], poll_count: 0, exports: {}, pending_exports: [], import: null
  };
}
function seededDb(state) {
  return createFakeD1AI({ microbiome_runs: [{
    public_id: RUN_ID, input_sha256: state.input_sha256, metadata_sha256: state.metadata_sha256,
    state: state.status, plan_id: state.plan_id, run_id: RUN_ID, state_json: JSON.stringify(state),
    result_json: null, created_at: state.created_at, completed_at: null
  }] });
}

function importStub({ mode = "name-regex", formatCase = true } = {}) {
  const submissions = [];
  const jobOutputs = new Map();
  const fetchImpl = async (input, init = {}) => {
    const url = String(input);
    const method = String(init.method ?? "GET").toUpperCase();
    let body = null;
    if (typeof init.body === "string") { try { body = JSON.parse(init.body); } catch { body = null; } }
    if (method === "POST" && url.includes("/api/histories")) return json({ id: HISTORY });
    if (url.includes("/api/tools/fetch")) return json({ outputs: [{ id: READS, history_id: HISTORY }], jobs: [{ id: "uploadjob" }] });
    if (url.includes("io_details=true")) {
      const decoded = decodeURIComponent(url);
      if (decoded.includes(IMPORT_TOOL)) return json(caseSchema({ mode, formatCase }));
      if (decoded.includes(DEMUX_TOOL)) {
        return json({ tool_id: DEMUX_TOOL, inputs: [
          { model_class: "DataToolParameter", name: "seqs", extensions: ["qza"] },
          { model_class: "DataToolParameter", name: "metadata", extensions: ["tsv"] }
        ] });
      }
      return json({ tool_id: "stub", inputs: [{ model_class: "DataToolParameter", name: "input" }] });
    }
    if (method === "POST" && url.endsWith("/api/tools")) {
      const toolId = String(body?.tool_id ?? "");
      if (toolId === IMPORT_TOOL) {
        submissions.push(body?.inputs ?? {});
        jobOutputs.set("import-job-1", [QZA]);
        return json({ outputs: [{ id: QZA }], jobs: [{ id: "import-job-1" }] });
      }
      if (toolId === DEMUX_TOOL) {
        jobOutputs.set("demux-job-1", [DEMUX_READS, DEMUX_QC]);
        return json({ outputs: [{ id: DEMUX_READS }, { id: DEMUX_QC }], jobs: [{ id: "demux-job-1" }] });
      }
      return json({ outputs: [], jobs: [{ id: "stub-job" }] });
    }
    if (url.includes("/api/histories/") && url.includes("/contents")) {
      return json([
        { id: READS, name: "sequences.fastq.gz", extension: "fastq.gz", state: "ok", history_id: HISTORY },
        { id: BARCODES, name: "barcodes.fastq.gz", extension: "fastq.gz", state: "ok", history_id: HISTORY },
        { id: METADATA, name: "sample-metadata.tsv", extension: "tsv", state: "ok", history_id: HISTORY },
        { id: QZA, name: "imported.qza", extension: "qza", state: "ok", history_id: HISTORY },
        { id: DEMUX_READS, name: "demux.fastq", extension: "fastq", state: "ok", history_id: HISTORY },
        { id: DEMUX_QC, name: "demux-stats.tsv", extension: "tsv", state: "ok", history_id: HISTORY }
      ]);
    }
    if (url.includes("/api/jobs/") && url.includes("/outputs")) {
      const id = decodeURIComponent(url.slice(url.lastIndexOf("/jobs/") + 6).split("/")[0]);
      const outputs = jobOutputs.get(id) ?? [];
      return json(Object.fromEntries(outputs.map((datasetId) => [datasetId, { id: datasetId, state: "ok" }])));
    }
    if (url.includes("/api/jobs/")) return json({ id: url.slice(url.lastIndexOf("/") + 1), state: "ok", history_id: HISTORY });
    if (url.includes("/get_content_as_text")) return json({ item_data: fixture("qc-stats.tsv"), truncated: false });
    return json({ error: "unexpected_stub_route", url }, 404);
  };
  return { fetchImpl, submissions };
}
async function withStub(stub, fn) {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = stub.fetchImpl;
  try { return await fn(); } finally { globalThis.fetch = previousFetch; }
}
async function driveOnce(stub, db) {
  const env = { ...mockAIEnv(db), GALAXY_ENABLED: "true", GALAXY_BASE_URL: "https://galaxy.example.test",
    GALAXY_API_KEY: "stub-secret", FETCH_IMPL: stub.fetchImpl };
  return handleStatus(makeGetRequest(`/api/ai/workflows/microbiome/status?run_id=${RUN_ID}`), env,
    { fetchImpl: stub.fetchImpl });
}

test("LABELLED STUB / name-parameter help regex distinguishes sequences from barcodes", async () => {
  const stub = importStub({ mode: "name-regex" });
  const { db, state: d1 } = seededDb(stateAtDemux());
  await withStub(stub, async () => {
    await driveOnce(stub, db); // submits the single import job
    assert.equal(stub.submissions.length, 1);
    const payload = stub.submissions[0];
    assert.deepEqual(payload["import_root|input_1"], { src: "hda", id: READS });
    assert.deepEqual(payload["import_root|input_2"], { src: "hda", id: BARCODES });
    assert.equal(payload["import_root|name_1"], "sequences.fastq.gz");
    assert.equal(payload["import_root|name_2"], "barcodes.fastq.gz");
    const stored = parseJson(d1.tables.microbiome_runs[0].state_json);
    assert.equal(stored.import.mapping_basis, "name_text_help");
    assert.deepEqual(stored.import.mapping, { reads: "import_root|input_1", barcodes: "import_root|input_2" });
  });
});

test("LABELLED STUB / two indistinguishable inputs use recorded schema order", async () => {
  const stub = importStub({ mode: "order" });
  const { db, state: d1 } = seededDb(stateAtDemux());
  await withStub(stub, async () => {
    await driveOnce(stub, db);
    assert.equal(stub.submissions.length, 1);
    const payload = stub.submissions[0];
    assert.deepEqual(payload["import_root|input_1"], { src: "hda", id: READS });
    assert.deepEqual(payload["import_root|input_2"], { src: "hda", id: BARCODES });
    const stored = parseJson(d1.tables.microbiome_runs[0].state_json);
    assert.equal(stored.import.mapping_basis, "schema_order_two_inputs");
  });
});

test("LABELLED STUB / three data inputs remain refused with zero jobs", async () => {
  const stub = importStub({ mode: "three" });
  const { db, state: d1 } = seededDb(stateAtDemux());
  await withStub(stub, async () => {
    await driveOnce(stub, db);
    assert.equal(stub.submissions.length, 0);
    const stored = parseJson(d1.tables.microbiome_runs[0].state_json);
    assert.equal(stored.steps.demux.status, "unavailable");
    assert.match(stored.import.reason, /import_input_mapping_ambiguous/);
  });
});

function diagnosticStub({ formatCase = true } = {}) {
  const calls = [];
  const fetchImpl = async (input, init = {}) => {
    const url = String(input);
    const method = String(init.method ?? "GET").toUpperCase();
    calls.push({ method, url });
    assert.notEqual(method, "POST", "the diagnostic endpoint must never submit a job");
    if (method === "GET" && (url.includes("/api/tools?") || url.endsWith("/api/tools"))) {
      return json([
        { id: IMPORT_TOOL, name: "qiime2 tools import", version: "2026.1.0", model_class: "Tool", available: true },
        { id: DEMUX_TOOL, name: "qiime2 demux emp-single", version: "2026.1.0", model_class: "Tool", available: true }
      ]);
    }
    if (url.includes("io_details=true") && decodeURIComponent(url).includes(IMPORT_TOOL)) {
      const schema = caseSchema({ mode: "name-regex", formatCase });
      schema.inputs[0].cases[0].inputs[0].help = "x".repeat(1000);
      return json(schema);
    }
    if (url.includes("/api/workflows")) return json([]);
    return json({ error: "unexpected_stub_route", url }, 404);
  };
  return { fetchImpl, calls };
}

test("LABELLED STUB / diagnostic endpoint returns sanitized live schema metadata, zero POSTs", async () => {
  const stub = diagnosticStub();
  const env = { GALAXY_ENABLED: "true", GALAXY_BASE_URL: "https://galaxy.example.test",
    GALAXY_API_KEY: "stub-secret", ...mockAIEnv(createFakeD1AI().db) };
  await withStub(stub, async () => {
    const response = await handleImportSchema(makeGetRequest(
      "/api/ai/workflows/microbiome/import-schema"), env, { fetchImpl: stub.fetchImpl });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.available, true);
    assert.equal(body.tool_id, IMPORT_TOOL);
    assert.equal(body.version, "2026.1.0");
    assert.equal(body.discovered_format_value, FORMAT);
    assert.deepEqual(body.selector_path, [{ name: "import_root|root_format", value: FORMAT }]);
    assert.ok(body.inputs.length >= 4);
    assert.equal(body.inputs[0].help.length, 300, "help text is bounded");
    assert.ok(body.inputs.every((entry) => "model_class" in entry && "extensions" in entry));
    assert.equal(JSON.stringify(body).includes("stub-secret"), false, "no credentials are exposed");
    assert.equal(stub.calls.some((call) => call.method === "POST"), false);
  });

  const absent = diagnosticStub({ formatCase: false });
  const env2 = { GALAXY_ENABLED: "true", GALAXY_BASE_URL: "https://galaxy.example.test",
    GALAXY_API_KEY: "stub-secret", ...mockAIEnv(createFakeD1AI().db) };
  await withStub(absent, async () => {
    const response = await handleImportSchema(makeGetRequest(
      "/api/ai/workflows/microbiome/import-schema"), env2, { fetchImpl: absent.fetchImpl });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.available, false);
    assert.match(body.reason, /does not expose the SingleLanePerSampleSingleEndFastqDirFmt format case/);
    assert.equal(absent.calls.some((call) => call.method === "POST"), false);
  });
});
