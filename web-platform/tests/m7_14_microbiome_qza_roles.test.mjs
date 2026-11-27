// M7.14.2 LABELLED STUBBED QZA-ROLE TESTS — ZERO live calls.
// Every downstream QIIME 2 tool input is a .qza artifact. These tests prove the
// stage roles place the real frontier ids into the LIVE schema's data fields,
// including two distinct qza fields (rep-seqs + classifier) for taxonomy.
import test from "node:test";
import assert from "node:assert/strict";

import { buildMicrobiomePayload } from "../functions/api/ai/workflows/microbiome/schema.js";
import { handleStatus } from "../functions/api/ai/workflows/microbiome/engine.js";
import { createFakeD1AI, makeGetRequest, mockAIEnv } from "./helpers/fake-d1.mjs";

const RUN_ID = "job_a8817e35d7534d98";
const HISTORY = "11ac94870d0bb33aff42f70766c41aa1";
const DEMUX_QZA = "40160950115d555e13e23a881bf39904";
const REP_SEQS = "13131313131313131313131313131313";
const CLASSIFIER = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const TABLE = "12121212121212121212121212121212";
const DISTANCE = "17171717171717171717171717171717";
const TOOLS = Object.freeze({
  qc: "toolshed.g2.bx.psu.edu/repos/iuc/qiime2_vsearch_fastq_stats/2026.1.0",
  denoise: "toolshed.g2.bx.psu.edu/repos/iuc/qiime2_dada2_denoise_single/2026.1.0",
  classify: "toolshed.g2.bx.psu.edu/repos/iuc/qiime2_feature_classifier_classify_sklearn/2026.1.0",
  alpha: "toolshed.g2.bx.psu.edu/repos/iuc/qiime2_diversity_alpha/2026.1.0",
  beta: "toolshed.g2.bx.psu.edu/repos/iuc/qiime2_diversity_beta/2026.1.0",
  pcoa: "toolshed.g2.bx.psu.edu/repos/iuc/qiime2_emperor_plot/2026.1.0"
});

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}
function data(name, extensions, help = "") {
  return { model_class: "DataToolParameter", name, extensions, help };
}
function liveSchema(toolId) {
  if (toolId === TOOLS.classify) return { tool_id: toolId, inputs: [
    data("reads", ["qza"], "representative sequences qza"),
    data("classifier", ["qza"], "trained classifier qza")
  ] };
  if (toolId === TOOLS.pcoa) return { tool_id: toolId, inputs: [data("distance_matrix", ["qza"], "distance matrix")] };
  return { tool_id: toolId, inputs: [data("table", ["qza"], "QIIME 2 artifact")] };
}

function state() {
  return {
    workflow_type: "microbiome", run_id: RUN_ID, plan_id: "plan_a8817e35d7534d98",
    status: "running", current_step: "qc_summary", created_at: "2026-11-27T00:00:00.000Z",
    input_sha256: "a".repeat(64), metadata_sha256: "b".repeat(64),
    input: { mode: "public", source: {}, sample_ids: ["sampleA"], sample_count: 1,
      metadata_text: "sample-id\tbarcode-sequence\nsampleA\tACCGCACTT\n" },
    params: { trim_left: 0, trunc_len: 120, rarefaction_depth: null },
    discovery: { tools: Object.fromEntries(Object.entries(TOOLS).map(([role, id]) =>
      [role, { id, name: id, version: "2026.1.0" }])),
    classifier: { available: false, reason: "no select option" }, discovery_mode: "live", discovered_at: null },
    dataset_ids: { metadata: "44444444444444444444444444444444" },
    filenames: { reads: "sequences.fastq.gz", barcodes: "barcodes.fastq.gz", metadata: "sample-metadata.tsv" },
    history_id: HISTORY, frontier: { importedSeqsId: DEMUX_QZA, demuxReadsId: DEMUX_QZA,
      repSeqsId: REP_SEQS, featureTableId: TABLE, distanceMatrixId: DISTANCE },
    classifier_prep: { dataset_id: CLASSIFIER, filename: "silva-138-99-nb-classifier.qza",
      official_url: "https://data.qiime2.org/classifiers/sklearn-1.4.2/silva/silva-138-99-nb-classifier.qza" },
    results: {}, artifacts: [], errors: [], poll_count: 0, exports: {}, pending_exports: [],
    steps: {
      import_reads: { status: "succeeded", provider_job_id: "uploadjob00000001" },
      demux: { status: "succeeded", provider_job_id: "demux-job-0001", demuxReadsId: DEMUX_QZA }
    },
    import: { status: "succeeded", provider_job_id: "import-job-0001", output_dataset_id: DEMUX_QZA,
      output_history_id: HISTORY, copy_dataset_id: DEMUX_QZA }
  };
}

function seededDb(s) {
  return createFakeD1AI({ microbiome_runs: [{
    public_id: RUN_ID, input_sha256: s.input_sha256, metadata_sha256: s.metadata_sha256,
    state: s.status, plan_id: s.plan_id, run_id: RUN_ID, state_json: JSON.stringify(s),
    result_json: null, created_at: s.created_at, completed_at: null
  }] });
}

function makeStub() {
  const submissions = [];
  let dada2Submitted = false;
  const fetchImpl = async (input, init = {}) => {
    const url = String(input);
    const method = String(init.method ?? "GET").toUpperCase();
    let body = null;
    if (typeof init.body === "string") { try { body = JSON.parse(init.body); } catch { body = null; } }
    if (method === "GET" && (url.includes("/api/tools?") || url.endsWith("/api/tools"))) {
      return json(Object.values(TOOLS).map((id) => ({ id, name: id, version: "2026.1.0",
        model_class: "Tool", available: true })));
    }
    if (url.includes("/api/workflows")) return json([]);
    if (url.includes("io_details=true")) return json(liveSchema(Object.values(TOOLS)
      .find((id) => decodeURIComponent(url).includes(id)) ?? TOOLS.qc));
    if (method === "POST" && url.endsWith("/api/tools")) {
      const toolId = String(body?.tool_id ?? "");
      submissions.push({ tool_id: toolId, inputs: body?.inputs });
      if (toolId === TOOLS.denoise) dada2Submitted = true;
      return json({ outputs: [], jobs: [{ id: `job-${submissions.length}` }] });
    }
    if (method === "GET" && /\/api\/jobs\/[^/]+\/outputs/.test(url)) {
      return dada2Submitted
        ? json({ rep: { id: REP_SEQS, state: "ok" }, table: { id: TABLE, state: "ok" } })
        : json({});
    }
    if (method === "GET" && /\/api\/jobs\//.test(url)) return json({ id: "job-0001", state: "ok", history_id: HISTORY });
    if (method === "GET" && /\/api\/histories\/[^/]+\/contents/.test(url)) {
      const items = [{ id: HISTORY, name: "input", extension: "qza", state: "ok", history_id: HISTORY }];
      if (dada2Submitted) items.push(
        { id: REP_SEQS, name: "rep-seqs.fasta", extension: "fasta", state: "ok", history_id: HISTORY },
        { id: TABLE, name: "feature-table.tsv", extension: "tsv", state: "ok", history_id: HISTORY });
      return json(items);
    }
    if (url.includes("/get_content_as_text")) {
      if (url.includes(REP_SEQS)) return json({ item_data: ">asv1\nACGT\n", truncated: false });
      if (url.includes(TABLE)) return json({ item_data: "#OTU ID\tsampleA\nasv1\t10\n", truncated: false });
      return json({ error: "not_found" }, 404);
    }
    return json({ error: "unexpected_stub_route", url }, 404);
  };
  return { fetchImpl, submissions };
}

async function drive(db, stub, limit = 18) {
  for (let index = 0; index < limit; index += 1) {
    await handleStatus(makeGetRequest(`/api/ai/workflows/microbiome/status?run_id=${RUN_ID}`),
      { ...mockAIEnv(db), GALAXY_ENABLED: "true", GALAXY_BASE_URL: "https://galaxy.example.test",
        GALAXY_API_KEY: "stub-key", FETCH_IMPL: stub.fetchImpl }, { fetchImpl: stub.fetchImpl });
  }
}

test("UNIT / artifact role places qza ids with no no_data_input errors", () => {
  const cases = [
    [TOOLS.qc, DEMUX_QZA, "table", [{ id: DEMUX_QZA, role: "artifact", name: "demux qza" }]],
    [TOOLS.denoise, DEMUX_QZA, "table", [{ id: DEMUX_QZA, role: "artifact", name: "demux qza" }]],
    [TOOLS.alpha, TABLE, "table", [{ id: TABLE, role: "artifact", name: "feature table qza" }]],
    [TOOLS.beta, TABLE, "table", [{ id: TABLE, role: "artifact", name: "feature table qza" }]],
    [TOOLS.pcoa, DISTANCE, "distance_matrix", [{ id: DISTANCE, role: "artifact", name: "distance qza" }]]
  ];
  for (const [toolId, id, field, datasets] of cases) {
    const payload = buildMicrobiomePayload(liveSchema(toolId), datasets, {});
    assert.equal(payload.valid, true, `${toolId}: ${payload.errors.join(", ")}`);
    assert.deepEqual(payload.inputs[field], { src: "hda", id });
  }
});

test("UNIT / taxonomy places rep-seqs and classifier into distinct qza fields", () => {
  const payload = buildMicrobiomePayload(liveSchema(TOOLS.classify), [
    { id: REP_SEQS, role: "artifact", key: "reads", name: "rep-seqs.qza", hint: "reads|sequences|rep|feature" },
    { id: CLASSIFIER, role: "artifact", key: "classifier", name: "silva.qza",
      hint: "classifier|referen|database|rrna|silva|taxonomy" }
  ], {});
  assert.equal(payload.valid, true, payload.errors.join(", "));
  assert.deepEqual(payload.inputs.reads, { src: "hda", id: REP_SEQS });
  assert.deepEqual(payload.inputs.classifier, { src: "hda", id: CLASSIFIER });
  assert.equal(payload.dataset_fields.reads, "reads");
  assert.equal(payload.dataset_fields.classifier, "classifier");
});

test("ENGINE / every downstream stage submits its real qza id; no schema errors", async () => {
  const stub = makeStub();
  const { db, state: d1 } = seededDb(state());
  const previousFetch = globalThis.fetch;
  globalThis.fetch = stub.fetchImpl;
  try {
    await drive(db, stub);
    const byTool = Object.fromEntries(stub.submissions.map((entry) => [entry.tool_id, entry.inputs]));
    assert.deepEqual(byTool[TOOLS.qc]?.table, { src: "hda", id: DEMUX_QZA });
    assert.deepEqual(byTool[TOOLS.denoise]?.table, { src: "hda", id: DEMUX_QZA });
    assert.deepEqual(byTool[TOOLS.classify]?.reads, { src: "hda", id: REP_SEQS });
    assert.deepEqual(byTool[TOOLS.classify]?.classifier, { src: "hda", id: CLASSIFIER });
    assert.deepEqual(byTool[TOOLS.alpha]?.table, { src: "hda", id: TABLE });
    assert.deepEqual(byTool[TOOLS.beta]?.table, { src: "hda", id: TABLE });
    assert.deepEqual(byTool[TOOLS.pcoa]?.distance_matrix, { src: "hda", id: DISTANCE });
    const s = JSON.parse(d1.tables.microbiome_runs[0].state_json);
    assert.equal(s.errors.some((error) => /no_data_input_/.test(errorText(error))), false);
    assert.equal(stub.submissions.some((entry) => entry.tool_id.includes("demux")), false,
      "the succeeded demux is never resubmitted");
  } finally { globalThis.fetch = previousFetch; }
});
function errorText(entry) { return typeof entry === "string" ? entry : JSON.stringify(entry ?? {}); }
