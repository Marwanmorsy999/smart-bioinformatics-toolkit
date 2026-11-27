// M7.14.1 LABELLED STUBBED QZA-IMPORT TESTS — ZERO live calls.
//
// Every Galaxy route is answered in-memory. The EMP single-end format value and
// every parameter name come from the stubbed LIVE import schema; no tool id,
// format value or input order is invented by the engine.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseJson } from "../functions/api/ai/_lib.js";
import { handleStatus } from "../functions/api/ai/workflows/microbiome/engine.js";
import { createFakeD1AI, makeGetRequest, mockAIEnv } from "./helpers/fake-d1.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const fixture = (name) => readFileSync(resolve(HERE, "fixtures/m7_14_microbiome", name), "utf8");
const RUN_ID = "job_a8817e35d7534d98";
const HISTORY = "11ac94870d0bb33aff42f70766c41aa1";
const FORMAT = "SingleLanePerSampleSingleEndFastqDirFmt";

const IDS = Object.freeze({
  reads: "22222222222222222222222222222222",
  barcodes: "33333333333333333333333333333333",
  metadata: "44444444444444444444444444444444",
  importedQza: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  demuxReads: "55555555555555555555555555555555",
  demuxQc: "66666666666666666666666666666666",
  qc: "77777777777777777777777777777777",
  table: "12121212121212121212121212121212",
  repSeqs: "13131313131313131313131313131313",
  taxonomy: "15151515151515151515151515151515",
  alpha: "16161616161616161616161616161616",
  distance: "17171717171717171717171717171717",
  pcoa: "18181818181818181818181818181818",
  demux: "toolshed.g2.bx.psu.edu/repos/iuc/qiime2_demux_emp_single/2026.1.0",
  qcTool: "toolshed.g2.bx.psu.edu/repos/iuc/qiime2_vsearch_fastq_stats/2026.1.0",
  denoise: "toolshed.g2.bx.psu.edu/repos/iuc/qiime2_dada2_denoise_single/2026.1.0",
  classify: "toolshed.g2.bx.psu.edu/repos/iuc/qiime2_feature_classifier_classify_sklearn/2026.1.0",
  alphaTool: "toolshed.g2.bx.psu.edu/repos/iuc/qiime2_diversity_alpha/2026.1.0",
  betaTool: "toolshed.g2.bx.psu.edu/repos/iuc/qiime2_diversity_core_metrics_phylogenetic/2026.1.0",
  pcoaTool: "toolshed.g2.bx.psu.edu/repos/iuc/qiime2_emperor_plot/2026.1.0",
  importTool: "toolshed.g2.bx.psu.edu/repos/q2d2/qiime2_core__tools__import/2026.1.0+dist.h02a552c2"
});

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}
function toolMeta(id) {
  return { id, name: id, version: "2026.1.0", available: true };
}
function nestedImportSchema(formatCase) {
  const dataInputs = [
    { model_class: "DataToolParameter", name: "sequences", help: "Sequences", extensions: ["fastq.gz"] },
    { model_class: "DataToolParameter", name: "barcodes", help: "Barcodes", extensions: ["fastq.gz"] },
    { model_class: "TextToolParameter", name: "sequences_name", help: "Name for sequences", value: "sequences" },
    { model_class: "TextToolParameter", name: "barcodes_name", help: "Name for barcodes", value: "barcodes" }
  ];
  const formatConditional = (options, cases) => ({
    model_class: "Conditional", name: "__q2galaxy__GUI__cond__format__",
    test_param: { name: "format", options }, cases
  });
  const formatValue = formatCase ? FORMAT : "SomeOtherFormatFmt";
  const formatOptions = formatCase
    ? [{ value: "BLASTDBDirFmtV5", label: "BLASTDB" }, { value: FORMAT, label: "EMP single-end reads" }]
    : [{ value: "BLASTDBDirFmtV5", label: "BLASTDB" }, { value: "SomeOtherFormatFmt", label: "Other" }];
  return {
    tool_id: IDS.importTool,
    inputs: [{
      model_class: "Conditional", name: "import_root",
      test_param: { name: "group", options: [
        { value: "BLASTDB", label: "BLAST database group" }, { value: "None", label: "No group" }
      ] },
      cases: [
        { value: "BLASTDB", inputs: [formatConditional(
          [{ value: "BLASTDBDirFmtV5", label: "BLASTDB" }],
          [{ value: "BLASTDBDirFmtV5", inputs: [] }])] },
        { value: "None", inputs: [formatConditional(formatOptions,
          [{ value: "BLASTDBDirFmtV5", inputs: [] }, { value: formatValue, inputs: dataInputs }])] }
      ]
    }]
  };
}

function schemaFor(toolId, { formatCase = true, ambiguous = false, nested = false } = {}) {
  if (toolId === IDS.importTool && nested) return nestedImportSchema(formatCase);
  if (toolId === IDS.importTool) {
    const caseInputs = ambiguous
      ? [{ model_class: "DataToolParameter", name: "input", help: "Sequences and barcodes", extensions: ["fastq.gz"] }]
      : [
        { model_class: "DataToolParameter", name: "sequences", help: "Sequences", extensions: ["fastq.gz"] },
        { model_class: "DataToolParameter", name: "barcodes", help: "Barcodes", extensions: ["fastq.gz"] },
        { model_class: "TextToolParameter", name: "sequences_name", help: "Name for sequences", value: "sequences" },
        { model_class: "TextToolParameter", name: "barcodes_name", help: "Name for barcodes", value: "barcodes" }
      ];
    return {
      tool_id: toolId,
      inputs: [{
        model_class: "Conditional", name: "import_root",
        test_param: { name: "import_format", options: [
          { value: formatCase ? FORMAT : "SomeOtherFormatFmt", label: "EMP single-end reads" }
        ] },
        cases: [{ value: formatCase ? FORMAT : "SomeOtherFormatFmt", name: "emp_single", inputs: caseInputs }]
      }]
    };
  }
  if (toolId === IDS.demux) {
    return { tool_id: toolId, inputs: [
      { model_class: "DataToolParameter", name: "seqs", help: "Sequences", extensions: ["qza"] },
      { model_class: "DataToolParameter", name: "metadata", help: "Metadata", extensions: ["tsv"] }
    ] };
  }
  return { tool_id: toolId, inputs: [{ model_class: "DataToolParameter", name: "input" }] };
}

function makeStub({ formatCase = true, ambiguous = false, nested = false,
  importDelayPolls = 0, importFails = false } = {}) {
  const calls = [];
  const importSubmissions = [];
  const demuxSubmissions = [];
  const jobOutputs = new Map();
  const jobStates = new Map();
  const importPolls = new Map();
  const dynamicDatasets = [];
  let phase = 0;
  let importCount = 0;
  const roleByTool = {
    [IDS.demux]: { order: 1, outputs: [IDS.demuxReads, IDS.demuxQc] },
    [IDS.qcTool]: { order: 2, outputs: [IDS.qc] },
    [IDS.denoise]: { order: 3, outputs: [IDS.table, IDS.repSeqs] },
    [IDS.classify]: { order: 4, outputs: [IDS.taxonomy] },
    [IDS.alphaTool]: { order: 5, outputs: [IDS.alpha] },
    [IDS.betaTool]: { order: 6, outputs: [IDS.distance] },
    [IDS.pcoaTool]: { order: 7, outputs: [IDS.pcoa] }
  };
  const textById = new Map([
    [IDS.reads, fixture("sequences.fastq")], [IDS.barcodes, fixture("barcodes.fastq")],
    [IDS.metadata, fixture("sample-metadata.tsv")], [IDS.demuxReads, fixture("sequences.fastq")],
    [IDS.demuxQc, fixture("qc-stats.tsv")], [IDS.qc, fixture("qc-stats.tsv")],
    [IDS.table, fixture("feature-table.tsv")], [IDS.repSeqs, fixture("rep-seqs.fasta")],
    [IDS.taxonomy, fixture("taxonomy.tsv")], [IDS.alpha, fixture("alpha.tsv")],
    [IDS.distance, fixture("distance.tsv")], [IDS.pcoa, fixture("pcoa.tsv")]
  ]);
  const contents = () => {
    const items = [
      { id: IDS.reads, name: "sequences.fastq.gz", extension: "fastq.gz", state: "ok", history_id: HISTORY },
      { id: IDS.barcodes, name: "barcodes.fastq.gz", extension: "fastq.gz", state: "ok", history_id: HISTORY },
      { id: IDS.metadata, name: "sample-metadata.tsv", extension: "tsv", state: "ok", history_id: HISTORY }
    ];
    if (phase >= 1) items.push(
      { id: IDS.demuxReads, name: "demultiplexed reads.fastq", extension: "fastq", state: "ok", history_id: HISTORY },
      { id: IDS.demuxQc, name: "demux stats.tsv", extension: "tsv", state: "ok", history_id: HISTORY });
    if (phase >= 2) items.push({ id: IDS.qc, name: "quality stats.tsv", extension: "tsv", state: "ok", history_id: HISTORY });
    if (phase >= 3) items.push(
      { id: IDS.table, name: "feature table.tsv", extension: "tsv", state: "ok", history_id: HISTORY },
      { id: IDS.repSeqs, name: "rep seqs.fasta", extension: "fasta", state: "ok", history_id: HISTORY });
    if (phase >= 4) items.push({ id: IDS.taxonomy, name: "taxonomy.tsv", extension: "tsv", state: "ok", history_id: HISTORY });
    if (phase >= 5) items.push({ id: IDS.alpha, name: "alpha.tsv", extension: "tsv", state: "ok", history_id: HISTORY });
    if (phase >= 6) items.push({ id: IDS.distance, name: "bray curtis distance matrix.tsv", extension: "tsv", state: "ok", history_id: HISTORY });
    if (phase >= 7) items.push({ id: IDS.pcoa, name: "pcoa coordinates.tsv", extension: "tsv", state: "ok", history_id: HISTORY });
    return [...items, ...dynamicDatasets];
  };
  const fetchImpl = async (input, init = {}) => {
    const url = String(input);
    const method = String(init.method ?? "GET").toUpperCase();
    let body = null;
    if (typeof init.body === "string") { try { body = JSON.parse(init.body); } catch { body = null; } }
    calls.push({ method, url });
    assert.doesNotMatch(url, /blast|iprscan|ncbi|CMD=Put|rid=/i, "no external analysis job may be touched by these tests");
    if (method === "POST" && url.includes("/api/histories")) return json({ id: HISTORY });
    if (url.includes("/api/tools/fetch")) return json({ outputs: [{ id: IDS.reads, history_id: HISTORY }], jobs: [{ id: "uploadjob" }] });
    if (url.includes("io_details=true")) return json(schemaFor(decodeURIComponent(url).includes(IDS.importTool)
      ? IDS.importTool : Object.keys(roleByTool).find((id) => decodeURIComponent(url).includes(id)) ?? IDS.demux,
    { formatCase, ambiguous, nested }));
    if (method === "POST" && url.endsWith("/api/tools")) {
      const toolId = String(body?.tool_id ?? "");
      if (toolId === IDS.importTool) {
        importSubmissions.push(body?.inputs ?? {});
        const jobId = `import-job-${++importCount}`;
        jobOutputs.set(jobId, [IDS.importedQza]);
        jobStates.set(jobId, importFails ? "error" : importDelayPolls > 0 ? "running" : "ok");
        dynamicDatasets.push({ id: IDS.importedQza, name: "imported-sequences.qza", extension: "qza",
          state: "ok", history_id: HISTORY });
        return json({ outputs: [{ id: IDS.importedQza }], jobs: [{ id: jobId }] });
      }
      const role = roleByTool[toolId];
      assert.ok(role, `unexpected tool submission ${toolId}`);
      if (toolId === IDS.demux) demuxSubmissions.push(body?.inputs ?? {});
      phase = Math.max(phase, role.order);
      const jobId = `job-${role.order}-${phase}`;
      jobOutputs.set(jobId, role.outputs);
      return json({ outputs: role.outputs.map((id) => ({ id })), jobs: [{ id: jobId }] });
    }
    if (url.includes("/api/histories/") && url.includes("/contents")) return json(contents());
    if (url.includes("/api/jobs/") && url.includes("/outputs")) {
      const id = decodeURIComponent(url.slice(url.lastIndexOf("/jobs/") + 6).split("/")[0]);
      const outputs = jobOutputs.get(id) ?? [];
      return json(Object.fromEntries(outputs.map((datasetId) => [datasetId, { id: datasetId, state: "ok" }])));
    }
    if (url.includes("/api/jobs/")) {
      const id = decodeURIComponent(url.slice(url.lastIndexOf("/jobs/") + 6).split("/")[0]);
      let state = jobStates.get(id) ?? "ok";
      if (state === "running" && importDelayPolls > 0) {
        const seen = (importPolls.get(id) ?? 0) + 1;
        importPolls.set(id, seen);
        if (seen > importDelayPolls) { state = "ok"; jobStates.set(id, state); }
      }
      return json({ id, state, history_id: HISTORY });
    }
    if (url.includes("/get_content_as_text")) {
      const id = decodeURIComponent(url.slice(url.lastIndexOf("/datasets/") + 10).split("/")[0]);
      const content = textById.get(id);
      return content === undefined ? json({ error: "not_found" }, 404) : json({ item_data: content, truncated: false });
    }
    return json({ error: "unexpected_stub_route", url }, 404);
  };
  return { fetchImpl, importSubmissions, demuxSubmissions, calls };
}

function stateAtDemux(overrides = {}) {
  // The stored discovery map is keyed by ROLE, exactly as handleRun writes it.
  const tools = {
    demux: toolMeta(IDS.demux), qc: toolMeta(IDS.qcTool), denoise: toolMeta(IDS.denoise),
    classify: toolMeta(IDS.classify), alpha: toolMeta(IDS.alphaTool), beta: toolMeta(IDS.betaTool),
    pcoa: toolMeta(IDS.pcoaTool), importTool: toolMeta(IDS.importTool)
  };
  return {
    workflow_type: "microbiome", run_id: RUN_ID, plan_id: "plan_a8817e35d7534d98",
    status: "running", current_step: "demux", created_at: "2026-11-27T00:00:00.000Z",
    input: { mode: "public", source: {}, filenames: {
      reads: "sequences.fastq.gz", barcodes: "barcodes.fastq.gz", metadata: "sample-metadata.tsv" } },
    input_sha256: "a".repeat(64), metadata_sha256: "b".repeat(64),
    params: { trim_left: 0, trunc_len: 120 },
    discovery: { tools, classifier: { available: true, parameter_name: "classifier",
      option_value: "silva.qza", option_label: "SILVA 138" }, discovery_mode: "live",
    discovered_at: "2026-11-27T00:00:00.000Z" },
    dataset_ids: { sequences: IDS.reads, barcodes: IDS.barcodes, metadata: IDS.metadata },
    filenames: { reads: "sequences.fastq.gz", barcodes: "barcodes.fastq.gz", metadata: "sample-metadata.tsv" },
    history_id: HISTORY, frontier: {}, steps: { import_reads: { status: "succeeded", provider_job_id: "uploadjob" } },
    results: {}, artifacts: [], errors: [], poll_count: 0, exports: {}, pending_exports: [], import: null,
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
async function withStub(stub, fn) {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = stub.fetchImpl;
  try { return await fn(); } finally { globalThis.fetch = previousFetch; }
}
async function drive(stub, env, limit = 40) {
  let last = null;
  for (let index = 0; index < limit; index += 1) {
    last = await handleStatus(makeGetRequest(`/api/ai/workflows/microbiome/status?run_id=${RUN_ID}`), env,
      { fetchImpl: stub.fetchImpl });
    if ((await last.clone().json()).terminal) break;
  }
  return last.json();
}
function envFor(db, stub) {
  return { ...mockAIEnv(db), GALAXY_ENABLED: "true", GALAXY_BASE_URL: "https://galaxy.example.test",
    GALAXY_API_KEY: "stub-secret", FETCH_IMPL: stub.fetchImpl };
}

test("LABELLED STUB / live format case found: one import job with reads, barcodes and names; demux uses its qza", async () => {
  const stub = makeStub();
  const { db, state: d1 } = seededDb(stateAtDemux());
  await withStub(stub, async () => {
    const terminal = await drive(stub, envFor(db, stub));
    assert.equal(terminal.status, "succeeded", JSON.stringify(terminal.errors));
    assert.equal(stub.importSubmissions.length, 1, "exactly one import job");
    const inputs = stub.importSubmissions[0];
    assert.equal(inputs["import_root|import_format"], FORMAT, "format value came from the live schema");
    assert.deepEqual(inputs["import_root|sequences"], { src: "hda", id: IDS.reads });
    assert.deepEqual(inputs["import_root|barcodes"], { src: "hda", id: IDS.barcodes });
    assert.equal(inputs["import_root|sequences_name"], "sequences.fastq.gz");
    assert.equal(inputs["import_root|barcodes_name"], "barcodes.fastq.gz");
    assert.equal(stub.demuxSubmissions.length, 1);
    assert.deepEqual(Object.values(stub.demuxSubmissions[0]).filter((v) => v?.src === "hda").map((v) => v.id),
      [IDS.importedQza, IDS.metadata], "qza reads plus metadata; raw barcodes were consumed by import");
    const stored = parseJson(d1.tables.microbiome_runs[0].state_json);
    assert.equal(stored.frontier.importedSeqsId, IDS.importedQza);
    assert.equal(stored.import.tool_id, IDS.importTool);
    assert.deepEqual(stored.import.source_dataset_ids, { reads: IDS.reads, barcodes: IDS.barcodes });
    assert.equal(stored.import.output_dataset_id, IDS.importedQza);
    assert.equal(stored.import.basis, "preparation_of_stored_inputs");
  });
});

test("LABELLED STUB / repeated polls never submit a second import", async () => {
  const stub = makeStub({ importDelayPolls: 2 });
  const { db, state: d1 } = seededDb(stateAtDemux());
  await withStub(stub, async () => {
    const terminal = await drive(stub, envFor(db, stub));
    assert.equal(terminal.status, "succeeded", JSON.stringify(terminal.errors));
    assert.equal(stub.importSubmissions.length, 1);
    const stored = parseJson(d1.tables.microbiome_runs[0].state_json);
    assert.equal(stored.import.status, "succeeded");
    assert.equal(stored.frontier.importedSeqsId, IDS.importedQza);
  });
});

test("LABELLED STUB / missing live format case: honest refusal, zero jobs", async () => {
  const stub = makeStub({ formatCase: false });
  const { db, state: d1 } = seededDb(stateAtDemux());
  await withStub(stub, async () => {
    await drive(stub, envFor(db, stub), 3);
    assert.equal(stub.importSubmissions.length, 0, "no format value was invented");
    assert.equal(stub.demuxSubmissions.length, 0, "no wrong demux payload was submitted");
    const stored = parseJson(d1.tables.microbiome_runs[0].state_json);
    assert.equal(stored.steps.demux.status, "unavailable");
    assert.match(stored.import.reason, /qza_import_format_case_missing/);
    assert.ok(stored.errors.some((error) => String(error.reason).includes("qza_import_format_case_missing")));
  });
});

test("LABELLED STUB / ambiguous input mapping: honest refusal, zero jobs", async () => {
  const stub = makeStub({ ambiguous: true });
  const { db, state: d1 } = seededDb(stateAtDemux());
  await withStub(stub, async () => {
    await drive(stub, envFor(db, stub), 3);
    assert.equal(stub.importSubmissions.length, 0, "an ambiguous mapping is never submitted");
    assert.equal(stub.demuxSubmissions.length, 0);
    const stored = parseJson(d1.tables.microbiome_runs[0].state_json);
    assert.equal(stored.steps.demux.status, "unavailable");
    assert.match(stored.steps.demux.reason, /mapping_ambiguous/);
  });
});

test("LABELLED STUB / pre-existing qza input skips import entirely", async () => {
  const stub = makeStub();
  const state = stateAtDemux({ frontier: { importedSeqsId: IDS.importedQza } });
  const { db, state: d1 } = seededDb(state);
  await withStub(stub, async () => {
    const terminal = await drive(stub, envFor(db, stub));
    assert.equal(terminal.status, "succeeded", JSON.stringify(terminal.errors));
    assert.equal(stub.importSubmissions.length, 0);
    assert.equal(stub.demuxSubmissions.length, 1);
    assert.deepEqual(Object.values(stub.demuxSubmissions[0]).filter((v) => v?.src === "hda").map((v) => v.id),
      [IDS.importedQza, IDS.metadata]);
    assert.equal(parseJson(d1.tables.microbiome_runs[0].state_json).import, null);
  });
});

test("LABELLED STUB / nested two-level schema: both live selectors and the nested case are used", async () => {
  const stub = makeStub({ nested: true });
  const { db, state: d1 } = seededDb(stateAtDemux());
  await withStub(stub, async () => {
    const terminal = await drive(stub, envFor(db, stub));
    assert.equal(terminal.status, "succeeded", JSON.stringify(terminal.errors));
    assert.equal(stub.importSubmissions.length, 1);
    const inputs = stub.importSubmissions[0];
    // Outer group case and inner format case BOTH come from the live schema.
    assert.equal(inputs["import_root|group"], "None");
    assert.equal(inputs["import_root|__q2galaxy__GUI__cond__format__|format"], FORMAT);
    const prefix = "import_root|__q2galaxy__GUI__cond__format__|";
    assert.deepEqual(inputs[`${prefix}sequences`], { src: "hda", id: IDS.reads });
    assert.deepEqual(inputs[`${prefix}barcodes`], { src: "hda", id: IDS.barcodes });
    assert.equal(inputs[`${prefix}sequences_name`], "sequences.fastq.gz");
    assert.equal(inputs[`${prefix}barcodes_name`], "barcodes.fastq.gz");
    assert.deepEqual(Object.values(stub.demuxSubmissions[0]).filter((v) => v?.src === "hda").map((v) => v.id),
      [IDS.importedQza, IDS.metadata]);
    const stored = parseJson(d1.tables.microbiome_runs[0].state_json);
    assert.deepEqual(stored.import.selectors, [
      { name: "import_root|group", value: "None" },
      { name: "import_root|__q2galaxy__GUI__cond__format__|format", value: FORMAT }
    ]);
    assert.equal(stored.import.format_value, FORMAT);
  });
});

test("LABELLED STUB / nested schema without the EMP format: zero jobs, honest refusal", async () => {
  const stub = makeStub({ nested: true, formatCase: false });
  const { db, state: d1 } = seededDb(stateAtDemux());
  await withStub(stub, async () => {
    await drive(stub, envFor(db, stub), 3);
    assert.equal(stub.importSubmissions.length, 0, "no format value was invented");
    assert.equal(stub.demuxSubmissions.length, 0);
    const stored = parseJson(d1.tables.microbiome_runs[0].state_json);
    assert.equal(stored.steps.demux.status, "unavailable");
    assert.match(stored.import.reason, /qza_import_format_case_missing/);
  });
});
