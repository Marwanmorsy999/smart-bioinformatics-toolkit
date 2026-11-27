// M7.14.3 LABELLED STUBBED BIOM->TSV CONVERSION TESTS — ZERO live calls.
//
// The HDF5 BIOMV210DirFmt export cannot be read as text in a Worker. These
// tests prove the fallback discovers a REAL installed biom_convert tool, uses
// only its LIVE schema field names/values, submits once, and fails closed
// without fabricating a feature table.
import test from "node:test";
import assert from "node:assert/strict";

import {
  handleStatus, handleAdvance
} from "../functions/api/ai/workflows/microbiome/engine.js";
import { createFakeD1AI, makeGetRequest, makePostRequest, mockAIEnv } from "./helpers/fake-d1.mjs";

const RUN = "job_a8817e35d7534d98";
const HISTORY = "11ac94870d0bb33aff42f70766c41aa1";
const TABLE_QZA = "40160950115d555ed5330c1bedac2181";
const BIOM_DS = "40160950115d555eef85c989da8f71b7";
const TSV_DS = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const REP_SEQS = "cccccccccccccccccccccccccccccccc";
const CONVERT_TOOL = "toolshed.g2.bx.psu.edu/repos/iuc/biom_convert/biom_convert/2.1.18+galaxy0";
const TEST_KEY = "stub-key-not-a-real-secret";
const TSV_TEXT = "#OTU ID\tsampleA\tsampleB\nasv1\t10\t5\nasv2\t2\t7\n";
const REP_TEXT = ">asv1\nACGTACGT\n>asv2\nACGTTCGA\n";

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function convertSchema() {
  const data = (name, extensions, label) => ({ model_class: "DataToolParameter", name, extensions, label });
  return { tool_id: CONVERT_TOOL, inputs: [
    { model_class: "Conditional", name: "input", test_param: { name: "type_selector", value: "tsv",
      options: [{ value: "tsv", label: "TSV" }, { value: "biom", label: "BIOM" }] },
    cases: [
      { value: "tsv", inputs: [data("input_fp", ["tsv"], "Input table")] },
      { value: "biom", name: "biom", inputs: [data("input_fp", ["biom1"], "Input BIOM table")] }
    ] },
    { model_class: "Conditional", name: "output", test_param: { name: "type_selector", value: "biom",
      options: [{ value: "tsv", label: "TSV" }, { value: "biom", label: "BIOM" }] },
    cases: [
      { value: "tsv", inputs: [
        { name: "header_key", value: "#OTU ID", optional: true },
        { name: "output_metadata_id", optional: true },
        { model_class: "Select", name: "tsv_metadata_formatter", value: "naive",
          options: [{ value: "naive", label: "naive" }] }
      ] },
      { value: "biom", inputs: [] }
    ] }
  ] };
}

function state(overrides = {}) {
  return {
    workflow_type: "microbiome", run_id: RUN, plan_id: "plan_a8817e35d7534d98",
    status: "running", current_step: "taxonomy", created_at: "2026-11-27T00:00:00.000Z",
    input_sha256: "a".repeat(64), metadata_sha256: "b".repeat(64),
    input: { mode: "public", source: {}, sample_ids: ["sampleA", "sampleB"], sample_count: 2,
      metadata_text: "sample-id\tbarcode-sequence\nsampleA\tACCGCACTT\nsampleB\tGGACGGACG\n" },
    params: { trim_left: 0, trunc_len: 120, rarefaction_depth: null },
    discovery: { tools: {}, classifier: { available: false, reason: "checkpoint" }, discovery_mode: "live" },
    history_id: HISTORY, frontier: { repSeqsId: REP_SEQS, featureTableId: null },
    steps: {
      import_reads: { status: "succeeded" }, demux: { status: "succeeded" },
      qc_summary: { status: "unavailable", reason: "no qc tool" },
      dada2_denoise: { status: "succeeded", provider_job_id: "dada2-job-0001" }
    },
    results: { asv: { available: false, reason: "content_unavailable", rep_seq_count: 702,
      denoising_stats: { available: true, samples: [{ sample_id: "sampleA", read_count: 10 }] } } },
    artifacts: [{ name: "rep_seqs.fasta", kind: "rep_seqs", dataset_id: REP_SEQS,
      checksum: "c".repeat(64), bytes: REP_TEXT.length, source_step: "dada2_denoise" }],
    errors: [{ step: "dada2_denoise", dataset_id: BIOM_DS,
      name: "qiime2 tools export on dataset 8 as BIOMV210DirFmt (feature-table)",
      reason: "content_unavailable" }],
    exports: { [TABLE_QZA]: { expected_kind: "feature_table", status: "succeeded",
      exported_dataset_ids: [] } },
    pending_exports: [], export_step_id: "dada2_denoise",
    feature_table_recovery: { status: "submitted", dataset_id: TABLE_QZA,
      provider_job_id: "export-job-0001", text_dataset_id: null,
      expected_kind: "feature_table" },
    biom_conversion: null,
    ...overrides
  };
}

function seed(s, extraArtifactRows = []) {
  const rows = [{ run_id: RUN, name: "rep_seqs.fasta", kind: "rep_seqs", content: REP_TEXT,
    checksum: "c".repeat(64) }, ...extraArtifactRows];
  const { db, state: d1 } = createFakeD1AI({ microbiome_runs: [{
    public_id: RUN, input_sha256: s.input_sha256, metadata_sha256: s.metadata_sha256,
    state: s.status, plan_id: s.plan_id, run_id: RUN, state_json: JSON.stringify(s),
    result_json: null, created_at: s.created_at, completed_at: null
  }], artifacts: rows });
  return { db, d1 };
}

function makeStub(options = {}) {
  const calls = [];
  const submissions = [];
  let tsvText = options.tsvText ?? TSV_TEXT;
  const fetchImpl = async (input, init = {}) => {
    const url = String(input);
    const method = String(init.method ?? "GET").toUpperCase();
    calls.push({ url, method, body: init.body });
    if (method === "POST" && url.endsWith("/api/tools")) {
      submissions.push({ url, body: JSON.parse(String(init.body)) });
      return json({ outputs: [{ id: TSV_DS }], jobs: [{ id: "convert-job-0001" }] });
    }
    if (url.includes("io_details=true")) {
      return options.noSchema ? json({ tool_id: CONVERT_TOOL, inputs: [] }) : json(convertSchema());
    }
    if (url.includes("/api/tools?")) {
      const tools = options.noTool ? [] : [{ id: CONVERT_TOOL, name: "Convert",
        description: "between BIOM table formats", version: "2.1.18+galaxy0", model_class: "Tool" }];
      return json(tools);
    }
    if (url.endsWith("/api/tools")) return json(options.noTool ? [] : [{ id: CONVERT_TOOL,
      name: "Convert", version: "2.1.18+galaxy0", model_class: "Tool" }]);
    if (url.endsWith("/api/workflows")) return json([]);
    if (url.includes("/get_content_as_text")) return json({ item_data: tsvText, truncated: false });
    if (/\/api\/jobs\/[^/]+\/outputs$/.test(url)) {
      return json({ outputs: [{ galaxyHdaId: TSV_DS, name: "feature table.tsv" }] });
    }
    if (url.includes("/api/jobs/")) {
      return json({ id: "convert-job-0001", state: options.jobState ?? "ok",
        history_id: HISTORY, outputs: [{ id: TSV_DS, name: "feature table.tsv", state: "ok" }] });
    }
    const detail = url.match(/\/api\/datasets\/([^/?]+)$/);
    if (detail) {
      const id = decodeURIComponent(detail[1]);
      return json({ id, name: "qiime2 tools export on dataset 8 as BIOMV210DirFmt (feature-table)",
        state: "ok", extension: "biom", history_id: options.foreignHistory
          ? "ffffffffffffffffffffffffffffffff" : HISTORY });
    }
    if (/\/api\/histories\/[^/]+\/contents/.test(url)) {
      return json([{ id: TSV_DS, name: "feature table.tsv", extension: "tsv", state: "ok",
        history_id: HISTORY }]);
    }
    return json({ error: "unexpected_stub_route", url }, 404);
  };
  return {
    calls, submissions, fetchImpl,
    setTsvText: (value) => { tsvText = value; },
    posts: () => calls.filter((call) => call.method === "POST")
  };
}

function envFor(db, fetchImpl) {
  return { ...mockAIEnv(db), MICROBIOME_TEST_ADVANCE: false, GALAXY_ENABLED: "true",
    GALAXY_BASE_URL: "https://galaxy.example.test", GALAXY_API_KEY: TEST_KEY, FETCH_IMPL: fetchImpl };
}

async function status(db, env, fetchImpl) {
  const previous = globalThis.fetch;
  globalThis.fetch = fetchImpl;
  try {
    return (await handleStatus(makeGetRequest(`/api/ai/workflows/microbiome/status?run_id=${RUN}`),
      env, { fetchImpl })).json();
  } finally { globalThis.fetch = previous; }
}

async function advance(db, env, fetchImpl, payload = {}) {
  const previous = globalThis.fetch;
  globalThis.fetch = fetchImpl;
  try {
    return await handleAdvance(makePostRequest({ run_id: RUN, ...payload },
      "/api/ai/workflows/microbiome/advance"), env, { fetchImpl });
  } finally { globalThis.fetch = previous; }
}

function stored(d1) { return JSON.parse(d1.tables.microbiome_runs[0].state_json); }

test("CONVERT / default cursor discovers the real tool and submits a schema-derived biom->tsv job once", async () => {
  const { db, d1 } = seed(state());
  const stub = makeStub();
  const env = envFor(db, stub.fetchImpl);
  const summary = await status(db, env, stub.fetchImpl);
  assert.equal(summary.next_operation, "convert_biom_to_tsv");
  const first = await (await advance(db, env, stub.fetchImpl)).json();
  assert.equal(first.operation, "convert_biom_to_tsv");
  assert.equal(first.next_operation, "poll_biom_conversion");
  assert.equal(stub.submissions.length, 1);
  const submission = stub.submissions[0].body;
  assert.equal(submission.tool_id, CONVERT_TOOL, "the dynamically discovered live tool id is used");
  assert.equal(submission.inputs["input|type_selector"], "biom");
  assert.equal(submission.inputs["output|type_selector"], "tsv");
  assert.deepEqual(submission.inputs["input|input_fp"], { src: "hda", id: BIOM_DS });
  const conversion = stored(d1).biom_conversion;
  assert.equal(conversion.status, "submitted");
  assert.equal(conversion.source_dataset_id, BIOM_DS);
  assert.equal(conversion.provider_job_id, "convert-job-0001");
  assert.equal(conversion.tool_id, CONVERT_TOOL);
  assert.deepEqual(conversion.schema_evidence.selectors.map((entry) => entry.normalized), ["biom", "tsv"]);
  // A repeated poll only checks the already-recorded job; no second submission.
  const second = await (await advance(db, env, stub.fetchImpl)).json();
  assert.equal(second.operation, "poll_biom_conversion");
  assert.equal(second.next_operation, "finalize_converted_table");
  assert.equal(stub.submissions.length, 1, "no duplicate conversion job");
  assert.equal(stored(d1).biom_conversion.status, "text_collected");
  assert.equal(stored(d1).biom_conversion.pending_text.dataset_id, TSV_DS);
});

test("CONVERT / an exported BIOM dataset from a different history is refused before submission", async () => {
  const { db, d1 } = seed(state());
  const stub = makeStub({ foreignHistory: true });
  const response = await advance(db, envFor(db, stub.fetchImpl), stub.fetchImpl);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.next_operation, "poll_current_job");
  assert.equal(stored(d1).biom_conversion.status, "unavailable");
  assert.match(stored(d1).biom_conversion.reason, /^biom_conversion_wrong_history:/);
  assert.equal(stub.posts().length, 0, "nothing was submitted for a foreign dataset");
});

test("CONVERT / a missing installed tool fails closed with no guessed tool id", async () => {
  const { db, d1 } = seed(state());
  const stub = makeStub({ noTool: true });
  await advance(db, envFor(db, stub.fetchImpl), stub.fetchImpl);
  assert.equal(stored(d1).biom_conversion.status, "unavailable");
  assert.match(stored(d1).biom_conversion.reason, /^biom_conversion_tool_unavailable:/);
  assert.equal(stub.posts().length, 0);
});

test("CONVERT / genuine TSV parses into ASV counts and keeps the original DADA2 qza id", async () => {
  const s = state({ advance_op: "finalize_converted_table",
    biom_conversion: { status: "text_collected", source_dataset_id: BIOM_DS, tool_id: CONVERT_TOOL,
      tool_version: "2.1.18+galaxy0", provider_job_id: "convert-job-0001",
      pending_text: { dataset_id: TSV_DS, name: "feature table.tsv", checksum: "e".repeat(64),
        bytes: TSV_TEXT.length } } });
  const { db, d1 } = seed(s, [{ run_id: RUN, name: "feature table.tsv", kind: "feature_table",
    content: TSV_TEXT, checksum: "e".repeat(64) }]);
  const stub = makeStub();
  const body = await (await advance(db, envFor(db, stub.fetchImpl), stub.fetchImpl)).json();
  assert.equal(body.next_operation, "poll_current_job");
  const finalState = stored(d1);
  assert.equal(finalState.frontier.featureTableId, TABLE_QZA);
  assert.equal(finalState.frontier.featureTableTextDatasetId, TSV_DS);
  assert.equal(finalState.results.asv.available, true);
  assert.equal(finalState.results.asv.feature_count, 2);
  assert.equal(finalState.results.asv.sample_count, 2);
  assert.equal(finalState.results.asv.total_assignable_reads, 24);
  assert.equal(finalState.results.asv.rep_seq_count, 702);
  assert.match(finalState.results.asv.basis, /parsed_from_genuine_biom_converted_tsv/);
  assert.equal(finalState.feature_table_recovery.status, "collected");
  assert.equal(finalState.biom_conversion.status, "collected");
  assert.equal(finalState.biom_conversion.tsv_dataset_id, TSV_DS);
  assert.equal(stub.posts().length, 0);
});

test("CONVERT / unparseable conversion output fails closed without fabricating a table", async () => {
  const bad = "this is not a QIIME OTU table";
  const s = state({ advance_op: "finalize_converted_table",
    biom_conversion: { status: "text_collected", source_dataset_id: BIOM_DS,
      pending_text: { dataset_id: TSV_DS, name: "feature table.tsv", checksum: "e".repeat(64),
        bytes: bad.length } } });
  const { db, d1 } = seed(s, [{ run_id: RUN, name: "feature table.tsv", kind: "feature_table",
    content: bad, checksum: "e".repeat(64) }]);
  const stub = makeStub();
  await advance(db, envFor(db, stub.fetchImpl), stub.fetchImpl);
  const finalState = stored(d1);
  assert.equal(finalState.frontier.featureTableId, null);
  assert.equal(finalState.results.asv.available, false);
  assert.equal(finalState.feature_table_recovery.status, "submitted");
  assert.equal(finalState.biom_conversion.status, "unavailable");
  assert.match(finalState.biom_conversion.reason, /^no_parseable_converted_feature_table_text:/);
  assert.equal(stub.posts().length, 0);
});
