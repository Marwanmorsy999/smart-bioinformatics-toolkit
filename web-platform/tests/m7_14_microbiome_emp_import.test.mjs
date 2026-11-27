// M7.14.2 PHASE 1 — LABELLED STUBBED EMP DIRECTORY-IMPORT TESTS — ZERO live calls.
//
// The fixture schema contains BOTH the invalid manifest + YAML branch
// (`SingleLanePerSampleSingleEndFastqDirFmt` under the mangled
// `SampleData [JoinedSequencesWithQuality]` type) AND the user-verified raw EMP
// path (`EMPSingleEndSequences` -> `EMP Single End Directory Format`, exposed by
// the live wrapper as `EMPSingleEndDirFmt` with `import_sequences` /
// `import_barcodes`). Selector values are read from the stubbed live schema; no
// job is submitted to any real provider.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseJson } from "../functions/api/ai/_lib.js";
import { handleImportSchema, handleStatus } from "../functions/api/ai/workflows/microbiome/engine.js";
import { parseFastq } from "../functions/api/ai/workflows/microbiome/parsers.js";
import { findImportFormatCase } from "../functions/api/ai/workflows/microbiome/schema.js";
import { createFakeD1AI, makeGetRequest, mockAIEnv } from "./helpers/fake-d1.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const fixture = (name) => readFileSync(resolve(HERE, "fixtures/m7_14_microbiome", name), "utf8");
const RUN_ID = "job_a8817e35d7534d98";
const HISTORY = "11ac94870d0bb33aff42f70766c41aa1";
const IMPORT_TOOL = "toolshed.g2.bx.psu.edu/repos/q2d2/qiime2_core__tools__import/2026.1.0+dist.h02a552c2";
const DEMUX_TOOL = "toolshed.g2.bx.psu.edu/repos/iuc/qiime2_demux_emp_single/2026.1.0";
const READS = "22222222222222222222222222222222";
const BARCODES = "33333333333333333333333333333333";
const METADATA = "44444444444444444444444444444444";
const QZA = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

const EMP_TYPE = "EMPSingleEndSequences";
const EMP_TYPE_VALUE = "EMPSingleEndSequences";
const EMP_FORMAT_LABEL = "EMP Single End Directory Format";
const EMP_FORMAT_VALUE = "EMPSingleEndDirFmt"; // exact value read from the stubbed live schema
const WRONG_TYPE_VALUE = "SampleData__ob__JoinedSequencesWithQuality__cb__";
const WRONG_FORMAT_VALUE = "SingleLanePerSampleSingleEndFastqDirFmt";
const TYPE_SELECTOR = "import_root|type";
const FORMAT_SELECTOR = "import_root|__q2galaxy__GUI__cond__format__|format";
const PREFIX = "import_root|__q2galaxy__GUI__cond__format__|";

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}
function toolMeta(id) { return { id, name: id, version: "2026.1.0", available: true }; }

function data(name, help, extensions = ["fastq.gz"]) {
  return { model_class: "DataToolParameter", name, help, extensions };
}
function text(name, help) { return { model_class: "TextToolParameter", name, help }; }

/**
 * Realistic nested live-style schema. `variant` changes only the labelled
 * evidence; all selector values remain schema-owned strings.
 */
function empSchema(variant = "correct") {
  const sequences = data("import_sequences", "Sequences file (FASTQ) of the raw EMP run");
  const barcodes = data("import_barcodes", "Barcodes file (FASTQ) of the raw EMP run");
  const nameSequences = text("import_sequences_name", "Name for the sequences file, e.g. sequences.fastq.gz");
  const nameBarcodes = text("import_barcodes_name", "Name for the barcodes file, e.g. barcodes.fastq.gz");
  if (variant === "conflicting") {
    sequences.help = "Sequences and barcodes FASTQ file";
    barcodes.help = "Sequences and barcodes FASTQ file";
    nameSequences.help = "Name for this file";
    nameBarcodes.help = "Name for this file";
  }
  const empInputs = [sequences, barcodes, nameSequences, nameBarcodes];
  // The wrong branch: two data inputs plus `name` text inputs describing the
  // manifest and YAML files. It must never be selected for raw multiplexed data.
  const manifestInputs = [
    data("data", "Fastq manifest file", ["txt"]),
    data("yaml", "YAML configuration file", ["yaml"]),
    text("name", "Name for the manifest file, e.g. manifest.txt"),
    text("name", "Name for the YAML file, e.g. config.yaml")
  ];
  const formatConditional = () => {
    const cases = [{ value: WRONG_FORMAT_VALUE, name: "single_lane", inputs: manifestInputs }];
    if (variant !== "manifest-only") {
      cases.unshift({ value: EMP_FORMAT_VALUE, name: "emp_directory", inputs: empInputs });
    }
    return {
      model_class: "Conditional", name: "__q2galaxy__GUI__cond__format__",
      test_param: { name: "format", options: [
        { value: EMP_FORMAT_VALUE, label: EMP_FORMAT_LABEL },
        { value: WRONG_FORMAT_VALUE, label: "SingleLanePerSampleSingleEndFastqDirFmt" }
      ] },
      cases
    };
  };
  return {
    tool_id: IMPORT_TOOL, tool_version: "2026.1.0",
    inputs: [{
      model_class: "Conditional", name: "import_root",
      test_param: { name: "type", options: [
        { value: EMP_TYPE_VALUE, label: EMP_TYPE },
        { value: WRONG_TYPE_VALUE, label: "SampleData [JoinedSequencesWithQuality]" }
      ] },
      cases: [
        { value: WRONG_TYPE_VALUE, name: "joined", inputs: [formatConditional()] },
        { value: EMP_TYPE_VALUE, name: "emp_single", inputs: [formatConditional()] }
      ]
    }]
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

function importStub({ variant = "correct", importFails = false } = {}) {
  const submissions = [];
  const calls = [];
  const fetchImpl = async (input, init = {}) => {
    const url = String(input);
    const method = String(init.method ?? "GET").toUpperCase();
    calls.push({ method, url });
    let body = null;
    if (typeof init.body === "string") { try { body = JSON.parse(init.body); } catch { body = null; } }
    if (method === "POST" && url.includes("/api/histories")) return json({ id: HISTORY });
    if (url.includes("io_details=true")) {
      const decoded = decodeURIComponent(url);
      if (decoded.includes(IMPORT_TOOL)) return json(empSchema(variant));
      if (decoded.includes(DEMUX_TOOL)) return json({ tool_id: DEMUX_TOOL, inputs: [
        data("seqs", "Sequences (qza)", ["qza"]), data("metadata", "Metadata", ["tsv"]) ] });
      return json({ tool_id: "stub", inputs: [{ model_class: "DataToolParameter", name: "input" }] });
    }
    if (method === "POST" && url.endsWith("/api/tools")) {
      const toolId = String(body?.tool_id ?? "");
      if (toolId === IMPORT_TOOL) {
        submissions.push(body?.inputs ?? {});
        if (importFails) return json({ error: { code: "stubbed_import_rejection", message: "stubbed import failure" } }, 400);
        return json({ outputs: [{ id: QZA }], jobs: [{ id: "import-job-1" }] });
      }
      if (toolId === DEMUX_TOOL) return json({ outputs: [], jobs: [{ id: "demux-job-1" }] });
      return json({ outputs: [], jobs: [{ id: "stub-job" }] });
    }
    if (url.includes("/api/histories/") && url.includes("/contents")) return json([
      { id: READS, name: "sequences.fastq.gz", extension: "fastq.gz", state: "ok", history_id: HISTORY },
      { id: BARCODES, name: "barcodes.fastq.gz", extension: "fastq.gz", state: "ok", history_id: HISTORY },
      { id: METADATA, name: "sample-metadata.tsv", extension: "tsv", state: "ok", history_id: HISTORY },
      { id: QZA, name: "imported.qza", extension: "qza", state: "ok", history_id: HISTORY }
    ]);
    if (url.includes("/api/jobs/")) return json({ id: url.slice(url.lastIndexOf("/") + 1), state: "ok", history_id: HISTORY });
    if (url.includes("/get_content_as_text")) return json({ item_data: fixture("qc-stats.tsv"), truncated: false });
    return json({ error: "unexpected_stub_route", url }, 404);
  };
  return { fetchImpl, submissions, calls };
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
function diagnosticStub(variant = "correct") {
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
      return json(empSchema(variant));
    }
    if (url.includes("/api/workflows")) return json([]);
    return json({ error: "unexpected_stub_route", url }, 404);
  };
  return { fetchImpl, calls };
}
function diagnosticEnv(stub) {
  return { GALAXY_ENABLED: "true", GALAXY_BASE_URL: "https://galaxy.example.test",
    GALAXY_API_KEY: "stub-secret", ...mockAIEnv(createFakeD1AI().db) };
}

test("LABELLED SCHEMA / both live selectors are read; the EMP directory case wins over manifest-YAML", () => {
  const matched = findImportFormatCase(empSchema());
  assert.ok(matched, "the EMP directory case must be found in the live-style schema");
  assert.deepEqual(matched.selectors, [
    { name: TYPE_SELECTOR, value: EMP_TYPE_VALUE },
    { name: FORMAT_SELECTOR, value: EMP_FORMAT_VALUE }
  ]);
  assert.equal(matched.typeValue, EMP_TYPE_VALUE);
  assert.equal(matched.formatValue, EMP_FORMAT_VALUE);
  assert.notEqual(matched.formatValue, WRONG_FORMAT_VALUE);
  assert.equal(matched.manifestYamlCase, false);
  assert.equal(matched.selection_basis, "live_type_and_format_selectors");
  assert.equal(matched.evidence.type.basis, "exact_type_selector");
  assert.equal(matched.evidence.format.basis, "exact_format_label");
  assert.equal(matched.evidence.format.source, "option_label");
});

test("LABELLED SCHEMA / documented format-class wording is mapped from the actual live value, not invented", () => {
  const schema = empSchema();
  schema.inputs[0].cases[1].inputs[0].test_param.options[0].label = EMP_FORMAT_VALUE;
  const matched = findImportFormatCase(schema);
  assert.equal(matched.formatValue, EMP_FORMAT_VALUE, "the value still comes from the live case");
  assert.equal(matched.evidence.format.basis, "documented_format_class");
  assert.ok(["case_value", "option_label"].includes(matched.evidence.format.source));
});

test("LABELLED STUB / exact EMP request construction and recorded provenance", async () => {
  const stub = importStub();
  const { db, state: d1 } = seededDb(stateAtDemux());
  await withStub(stub, async () => {
    await driveOnce(stub, db);
    assert.equal(stub.submissions.length, 1, "exactly one import submission");
    assert.deepEqual(stub.submissions[0], {
      [TYPE_SELECTOR]: EMP_TYPE_VALUE,
      [FORMAT_SELECTOR]: EMP_FORMAT_VALUE,
      [`${PREFIX}import_sequences`]: { src: "hda", id: READS },
      [`${PREFIX}import_barcodes`]: { src: "hda", id: BARCODES },
      [`${PREFIX}import_sequences_name`]: "sequences.fastq.gz",
      [`${PREFIX}import_barcodes_name`]: "barcodes.fastq.gz"
    });
    assert.equal(Object.keys(stub.submissions[0]).some((key) => /manifest|ya?ml/i.test(key)), false,
      "no manifest/YAML parameter is submitted");
    assert.equal(stub.submissions[0][FORMAT_SELECTOR], EMP_FORMAT_VALUE);

    const stored = parseJson(d1.tables.microbiome_runs[0].state_json);
    assert.equal(stored.import.tool_id, IMPORT_TOOL);
    assert.equal(stored.import.tool_version, "2026.1.0");
    assert.deepEqual(stored.import.source_dataset_ids, { reads: READS, barcodes: BARCODES });
    assert.deepEqual(stored.import.source_filenames, { reads: "sequences.fastq.gz", barcodes: "barcodes.fastq.gz" });
    assert.deepEqual(stored.import.selectors, [
      { name: TYPE_SELECTOR, value: EMP_TYPE_VALUE },
      { name: FORMAT_SELECTOR, value: EMP_FORMAT_VALUE }
    ]);
    assert.equal(stored.import.type_value, EMP_TYPE_VALUE);
    assert.equal(stored.import.selection_basis, "live_type_and_format_selectors");
    assert.equal(stored.import.case_evidence.format.basis, "exact_format_label");
    assert.equal(stored.import.manifest_yaml_branch_excluded, true);
    assert.equal(stored.import.mapping_basis, "name_text_help");
    assert.deepEqual(stored.import.mapping, {
      reads: `${PREFIX}import_sequences`, barcodes: `${PREFIX}import_barcodes`
    });
    assert.deepEqual(stored.import.dataset_fields, {
      reads: `${PREFIX}import_sequences`, barcodes: `${PREFIX}import_barcodes`
    });
    assert.equal(stored.import.mapping_evidence.length, 2);
    assert.equal(stored.import.mapping_evidence.every((entry) => entry.fastq.compatible), true);
    assert.equal(stored.import.schema_source, "Galaxy io_details=true (full nested schema)");
  });
});

test("LABELLED STUB / conflicting sequences-vs-barcodes evidence fails closed with zero jobs", async () => {
  const stub = importStub({ variant: "conflicting" });
  const { db, state: d1 } = seededDb(stateAtDemux());
  await withStub(stub, async () => {
    await driveOnce(stub, db);
    assert.equal(stub.submissions.length, 0, "an ambiguous mapping is never submitted");
    const stored = parseJson(d1.tables.microbiome_runs[0].state_json);
    assert.equal(stored.steps.demux.status, "unavailable");
    assert.match(stored.import.reason, /qza_import_import_input_mapping_ambiguous/);
  });
});

test("LABELLED STUB / typed wrapper without an EMP directory case fails closed (no manifest fallback)", async () => {
  const stub = importStub({ variant: "manifest-only" });
  const { db, state: d1 } = seededDb(stateAtDemux());
  await withStub(stub, async () => {
    await driveOnce(stub, db);
    assert.equal(stub.submissions.length, 0, "the manifest/YAML branch is never used for raw EMP reads");
    const stored = parseJson(d1.tables.microbiome_runs[0].state_json);
    assert.equal(stored.steps.demux.status, "unavailable");
    assert.match(stored.import.reason, /qza_import_format_case_missing/);
  });
});

test("LABELLED STUB / provider import failure is reported without a second submission", async () => {
  const stub = importStub({ importFails: true });
  const { db, state: d1 } = seededDb(stateAtDemux());
  await withStub(stub, async () => {
    await driveOnce(stub, db);
    assert.equal(stub.submissions.length, 1, "the failed attempt is not replayed in this request");
    const stored = parseJson(d1.tables.microbiome_runs[0].state_json);
    assert.equal(stored.import.status, "unavailable");
    assert.match(stored.import.reason, /qza_import_submission_failed/);
    assert.equal(stored.steps.demux.status, "unavailable");
    assert.equal(stored.frontier.importedSeqsId ?? null, null);
  });
});

test("LABELLED FIXTURE / sequence and barcode record counts correspond one-to-one", () => {
  const sequences = parseFastq(fixture("sequences.fastq"), { label: "labelled sequences subset" });
  const barcodes = parseFastq(fixture("barcodes.fastq"), { label: "labelled barcodes subset" });
  assert.equal(sequences.valid, true);
  assert.equal(barcodes.valid, true);
  assert.equal(sequences.record_count, 3);
  assert.equal(barcodes.record_count, 3, "EMP paired files must carry the same read count");
  assert.deepEqual(sequences.records.map((record) => record.id), barcodes.records.map((record) => record.id));
});

test("LABELLED STUB / GET diagnostic reports the selected EMP case and mapping basis; no POST", async () => {
  const stub = diagnosticStub();
  const env = diagnosticEnv(stub);
  await withStub(stub, async () => {
    const response = await handleImportSchema(makeGetRequest(
      "/api/ai/workflows/microbiome/import-schema"), env, { fetchImpl: stub.fetchImpl });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.available, true);
    assert.equal(body.selected_case, "emp_single_end_directory");
    assert.equal(body.selection_basis, "live_type_and_format_selectors");
    assert.equal(body.type_value, EMP_TYPE_VALUE);
    assert.equal(body.discovered_format_value, EMP_FORMAT_VALUE);
    assert.deepEqual(body.selector_path, [
      { name: TYPE_SELECTOR, value: EMP_TYPE_VALUE },
      { name: FORMAT_SELECTOR, value: EMP_FORMAT_VALUE }
    ]);
    assert.equal(body.manifest_yaml_branch_excluded, true);
    assert.deepEqual(body.inputs.map((entry) => entry.name), [
      "import_sequences", "import_barcodes", "import_sequences_name", "import_barcodes_name"
    ]);
    assert.ok(body.inputs.every((entry) => "model_class" in entry && "extensions" in entry
      && "help" in entry && "label" in entry && "field" in entry && "resolved_role" in entry));
    assert.deepEqual(body.inputs.slice(0, 2).map((entry) => entry.resolved_role), ["reads", "barcodes"]);
    assert.equal(body.inputs[0].field, `${PREFIX}import_sequences`);
    assert.equal(body.mapping_basis, "name_text_help");
    assert.deepEqual(body.chosen_mapping, {
      reads: `${PREFIX}import_sequences`, barcodes: `${PREFIX}import_barcodes`
    });
    assert.deepEqual(body.chosen_dataset_mapping, {
      uploaded_sequences_fastaq: `${PREFIX}import_sequences`,
      uploaded_barcodes_fastq: `${PREFIX}import_barcodes`
    });
    assert.equal(body.candidates, undefined, "the default view is the selected EMP case only");
    assert.equal(JSON.stringify(body).includes("stub-secret"), false, "no credentials are exposed");
    assert.equal(stub.calls.some((call) => call.method === "POST"), false);
  });

  const allStub = diagnosticStub();
  await withStub(allStub, async () => {
    const response = await handleImportSchema(makeGetRequest(
      "/api/ai/workflows/microbiome/import-schema?format=all"), diagnosticEnv(allStub),
    { fetchImpl: allStub.fetchImpl });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.selected_case, "emp_single_end_directory");
    assert.ok(Array.isArray(body.candidates));
    assert.equal(body.candidates.some((candidate) => candidate.manifest_yaml_case === true), true,
      "candidate review lists the manifest/YAML branch but never selects it");
    assert.equal(body.candidates.some((candidate) =>
      candidate.format_evidence?.basis === "exact_format_label"
      && candidate.selector_path.at(-1)?.value === EMP_FORMAT_VALUE), true);
    assert.equal(allStub.calls.some((call) => call.method === "POST"), false);
  });
});
