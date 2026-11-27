// M7.14.2 LIVE-SHAPE EMP IMPORT — LABELLED STUBBED TESTS — ZERO live calls.
//
// Staging exposed the real wrapper shape: each EMP file is a Section with a
// `name` text input and a `data` input whose extension is generically `data`
// while its help says "formatted as a FastqGzFormat". These tests reproduce
// that exact shape and prove field-name + format-help evidence is used to map
// sequences/barcodes without order guessing or manifest/YAML inputs.
import test from "node:test";
import assert from "node:assert/strict";
import { parseJson } from "../functions/api/ai/_lib.js";
import { handleImportSchema, handleStatus } from "../functions/api/ai/workflows/microbiome/engine.js";
import { createFakeD1AI, makeGetRequest, mockAIEnv } from "./helpers/fake-d1.mjs";

const RUN_ID = "job_a8817e35d7534d98";
const HISTORY = "11ac94870d0bb33aff42f70766c41aa1";
const IMPORT_TOOL = "toolshed.g2.bx.psu.edu/repos/q2d2/qiime2_core__tools__import/2026.1.0+dist.h02a552c2";
const DEMUX_TOOL = "toolshed.g2.bx.psu.edu/repos/iuc/qiime2_demux_emp_single/2026.1.0";
const READS = "22222222222222222222222222222222";
const BARCODES = "33333333333333333333333333333333";
const METADATA = "44444444444444444444444444444444";
const QZA = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const TYPE_SELECTOR = "import_root|type";
const FORMAT_SELECTOR = "import_root|__q2galaxy__GUI__cond__format__|format";
const PREFIX = "import_root|__q2galaxy__GUI__cond__format__|";
const FASTQ_HELP = "This data should be formatted as a FastqGzFormat. See the documentation below for more information.";

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}
function toolMeta(id) { return { id, name: id, version: "2026.1.0", available: true }; }

function liveSchema({ contradictory = false, omitToolId = false } = {}) {
  const fileGroup = (key) => ({
    model_class: "Section", name: key,
    inputs: [
      { model_class: "TextToolParameter", name: "name", help: `Name for the ${key} file` },
      { model_class: "DataToolParameter", name: "data",
        extensions: [contradictory ? "tsv" : "data"], help: FASTQ_HELP }
    ]
  });
  const manifestCase = { value: "SingleLanePerSampleSingleEndFastqDirFmt", name: "single_lane",
    inputs: [
      { model_class: "DataToolParameter", name: "data", extensions: ["txt"], help: "Fastq manifest file" },
      { model_class: "DataToolParameter", name: "yaml", extensions: ["yaml"], help: "YAML file" }
    ] };
  const empCase = { value: "EMPSingleEndDirFmt", name: "emp_directory",
    inputs: [fileGroup("import_sequences"), fileGroup("import_barcodes")] };
  const formatConditional = () => ({
    model_class: "Conditional", name: "__q2galaxy__GUI__cond__format__",
    test_param: { name: "format", options: [
      { value: "EMPSingleEndDirFmt", label: "EMP Single End Directory Format" },
      { value: "SingleLanePerSampleSingleEndFastqDirFmt", label: "SingleLanePerSampleSingleEndFastqDirFmt" }
    ] },
    cases: [empCase, manifestCase]
  });
  return {
    ...(omitToolId ? {} : { tool_id: IMPORT_TOOL, tool_version: "2026.1.0" }),
    inputs: [{ model_class: "Conditional", name: "import_root",
      test_param: { name: "type", options: [
        { value: "EMPSingleEndSequences", label: "EMPSingleEndSequences" },
        { value: "SampleData__ob__JoinedSequencesWithQuality__cb__", label: "SampleData [JoinedSequencesWithQuality]" }
      ] },
      cases: [
        { value: "EMPSingleEndSequences", name: "emp_single", inputs: [formatConditional()] },
        { value: "SampleData__ob__JoinedSequencesWithQuality__cb__", name: "joined", inputs: [formatConditional()] }
      ] }]
  };
}

function stateAtDemux() {
  return {
    workflow_type: "microbiome", run_id: RUN_ID, plan_id: "plan_a8817e35d7534d98",
    status: "running", current_step: "demux", created_at: "2026-11-27T00:00:00.000Z",
    input: { mode: "public", source: {}, filenames: {
      reads: "sequences.fastq.gz", barcodes: "barcodes.fastq.gz", metadata: "sample-metadata.tsv" } },
    input_sha256: "a".repeat(64), metadata_sha256: "b".repeat(64), params: {},
    discovery: { tools: { demux: toolMeta(DEMUX_TOOL), importTool: toolMeta(IMPORT_TOOL) },
      classifier: { available: true, parameter_name: "classifier", option_value: "silva.qza",
        option_label: "SILVA 138" }, discovery_mode: "live", discovered_at: "now" },
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
async function withStub(stub, fn) {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = stub;
  try { return await fn(); } finally { globalThis.fetch = previousFetch; }
}

function statusStub(schema) {
  const submissions = [];
  const fetchImpl = async (input, init = {}) => {
    const url = String(input);
    const method = String(init.method ?? "GET").toUpperCase();
    let body = null;
    if (typeof init.body === "string") { try { body = JSON.parse(init.body); } catch { body = null; } }
    if (method === "POST" && url.includes("/api/histories")) return json({ id: HISTORY });
    if (url.includes("io_details=true")) {
      const decoded = decodeURIComponent(url);
      if (decoded.includes(IMPORT_TOOL)) return json(schema);
      if (decoded.includes(DEMUX_TOOL)) return json({ tool_id: DEMUX_TOOL, inputs: [
        { model_class: "DataToolParameter", name: "seqs", extensions: ["qza"] },
        { model_class: "DataToolParameter", name: "metadata", extensions: ["tsv"] } ] });
      return json({ tool_id: "stub", inputs: [{ model_class: "DataToolParameter", name: "input" }] });
    }
    if (method === "POST" && url.endsWith("/api/tools")) {
      const toolId = String(body?.tool_id ?? "");
      if (toolId === IMPORT_TOOL) {
        submissions.push(body?.inputs ?? {});
        return json({ outputs: [{ id: QZA }], jobs: [{ id: "import-job-1" }] });
      }
      return json({ outputs: [], jobs: [{ id: "stub-job" }] });
    }
    if (url.includes("/api/histories/") && url.includes("/contents")) return json([
      { id: READS, name: "sequences.fastq.gz", extension: "fastq.gz", state: "ok", history_id: HISTORY },
      { id: BARCODES, name: "barcodes.fastq.gz", extension: "fastq.gz", state: "ok", history_id: HISTORY },
      { id: METADATA, name: "sample-metadata.tsv", extension: "tsv", state: "ok", history_id: HISTORY }
    ]);
    if (url.includes("/api/jobs/")) return json({ id: url.slice(url.lastIndexOf("/") + 1), state: "ok", history_id: HISTORY });
    return json({ error: "unexpected_stub_route", url }, 404);
  };
  return { fetchImpl, submissions };
}
async function driveOnce(stub, db) {
  const env = { ...mockAIEnv(db), GALAXY_ENABLED: "true", GALAXY_BASE_URL: "https://galaxy.example.test",
    GALAXY_API_KEY: "stub-secret", FETCH_IMPL: stub.fetchImpl };
  return handleStatus(makeGetRequest(`/api/ai/workflows/microbiome/status?run_id=${RUN_ID}`), env,
    { fetchImpl: stub.fetchImpl });
}

function diagnosticStub(schema) {
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
    if (url.includes("io_details=true") && decodeURIComponent(url).includes(IMPORT_TOOL)) return json(schema);
    if (url.includes("/api/workflows")) return json([]);
    return json({ error: "unexpected_stub_route", url }, 404);
  };
  return { fetchImpl, calls };
}
function diagnosticEnv() {
  return { GALAXY_ENABLED: "true", GALAXY_BASE_URL: "https://galaxy.example.test",
    GALAXY_API_KEY: "stub-secret", ...mockAIEnv(createFakeD1AI().db) };
}

test("LABELLED STUB / live generic-data shape is FASTQ-compatible via FastqGzFormat help", async () => {
  const stub = diagnosticStub(liveSchema());
  await withStub(stub.fetchImpl, async () => {
    const response = await handleImportSchema(makeGetRequest(
      "/api/ai/workflows/microbiome/import-schema"), diagnosticEnv(), { fetchImpl: stub.fetchImpl });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.available, true);
    assert.equal(body.selected_case, "emp_single_end_directory");
    assert.equal(body.discovered_format_value, "EMPSingleEndDirFmt");
    assert.deepEqual(body.type_value, "EMPSingleEndSequences");
    const dataInputs = body.inputs.filter((entry) => entry.model_class === "DataToolParameter");
    assert.equal(dataInputs.length, 2);
    assert.deepEqual(dataInputs.map((entry) => entry.extensions), [["data"], ["data"]]);
    assert.deepEqual(dataInputs.map((entry) => entry.fastq_compatible), [true, true]);
    assert.deepEqual(dataInputs.map((entry) => entry.fastq_basis), ["fastq_format_help", "fastq_format_help"]);
    assert.deepEqual(dataInputs.map((entry) => entry.resolved_role), ["reads", "barcodes"]);
    assert.deepEqual(dataInputs.map((entry) => entry.field_name_evidence), ["reads", "barcodes"]);
    assert.equal(body.mapping_basis, "field_name_and_fastq_format_help");
    assert.deepEqual(body.chosen_mapping, {
      reads: `${PREFIX}import_sequences|data`, barcodes: `${PREFIX}import_barcodes|data`
    });
    assert.deepEqual(body.chosen_dataset_mapping, {
      uploaded_sequences_fastaq: `${PREFIX}import_sequences|data`,
      uploaded_barcodes_fastq: `${PREFIX}import_barcodes|data`
    });
    assert.equal(body.inputs.some((entry) => /manifest|ya?ml/i.test(`${entry.field} ${entry.name} ${entry.help}`)), false,
      "the selected case exposes no manifest/YAML field");
    assert.equal(stub.calls.some((call) => call.method === "POST"), false);
  });
});

test("LABELLED STUB / exact request maps sequences/barcodes datasets from field-name evidence", async () => {
  const stub = statusStub(liveSchema());
  const { db, state: d1 } = seededDb(stateAtDemux());
  await withStub(stub.fetchImpl, async () => {
    await driveOnce(stub, db);
    assert.equal(stub.submissions.length, 1);
    assert.deepEqual(stub.submissions[0], {
      [TYPE_SELECTOR]: "EMPSingleEndSequences",
      [FORMAT_SELECTOR]: "EMPSingleEndDirFmt",
      [`${PREFIX}import_sequences|name`]: "sequences.fastq.gz",
      [`${PREFIX}import_sequences|data`]: { src: "hda", id: READS },
      [`${PREFIX}import_barcodes|name`]: "barcodes.fastq.gz",
      [`${PREFIX}import_barcodes|data`]: { src: "hda", id: BARCODES }
    });
    assert.equal(Object.keys(stub.submissions[0]).some((key) => /manifest|ya?ml/i.test(key)), false);
    const stored = parseJson(d1.tables.microbiome_runs[0].state_json);
    assert.equal(stored.import.mapping_basis, "field_name_and_fastq_format_help");
    assert.deepEqual(stored.import.mapping, {
      reads: `${PREFIX}import_sequences|data`, barcodes: `${PREFIX}import_barcodes|data`
    });
    assert.deepEqual(stored.import.mapping_evidence.map((item) => item.from_field_name), ["reads", "barcodes"]);
    assert.deepEqual(stored.import.mapping_evidence.map((item) => item.fastq.basis),
      ["fastq_format_help", "fastq_format_help"]);
  });
});

test("LABELLED STUB / contradictory format evidence still fails closed", async () => {
  const stub = diagnosticStub(liveSchema({ contradictory: true }));
  await withStub(stub.fetchImpl, async () => {
    const response = await handleImportSchema(makeGetRequest(
      "/api/ai/workflows/microbiome/import-schema"), diagnosticEnv(), { fetchImpl: stub.fetchImpl });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.available, true);
    assert.equal(body.chosen_mapping, null);
    assert.equal(body.mapping_basis, null);
    assert.equal(body.inputs.filter((entry) => entry.fastq_compatible === true).length, 0);
  });
});

test("LABELLED STUB / absent tool metadata is reported as null, not the string 'null'", async () => {
  const stub = diagnosticStub(liveSchema({ omitToolId: true }));
  await withStub(stub.fetchImpl, async () => {
    const response = await handleImportSchema(makeGetRequest(
      "/api/ai/workflows/microbiome/import-schema"), diagnosticEnv(), { fetchImpl: stub.fetchImpl });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.tool_id, null);
    assert.equal(body.tool_version, null);
  });
});
