// M7.14.2 LABELLED STUBBED STATUS-PERFORMANCE TESTS — ZERO live calls.
// A provider poll must not re-parse stored artifacts (live Worker exceeded its
// CPU limit). Rehydration happens once for local computation / terminal result,
// and oversized artifacts degrade with an honest reason instead of burning CPU.
import test from "node:test";
import assert from "node:assert/strict";

import { SQL } from "../functions/api/ai/_lib.js";
import { handleStatus } from "../functions/api/ai/workflows/microbiome/engine.js";
import { createFakeD1AI, makeGetRequest, mockAIEnv } from "./helpers/fake-d1.mjs";

const RUN_ID = "job_a8817e35d7534d98";
const HISTORY = "11ac94870d0bb33aff42f70766c41aa1";
const DEMUX_QZA = "40160950115d555e13e23a881bf39904";
const TABLE_TEXT = "#OTU ID\tsampleA\tsampleB\nasv1\t10\t5\nasv2\t2\t7\n";
const REP_TEXT = ">asv1\nACGTACGT\n>asv2\nACGTTCGA\n";
const TAX_TEXT = "Feature ID\tTaxon\tConfidence\nasv1\tk__Bacteria; p__Firmicutes\t0.9\nasv2\tk__Bacteria; p__Bacteroidetes\t0.8\n";

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function state(overrides = {}) {
  return {
    workflow_type: "microbiome", run_id: RUN_ID, plan_id: "plan_a8817e35d7534d98",
    status: "running", current_step: "dada2_denoise", created_at: "2026-11-27T00:00:00.000Z",
    input_sha256: "a".repeat(64), metadata_sha256: "b".repeat(64),
    input: { mode: "public", source: {}, sample_ids: ["sampleA", "sampleB"], sample_count: 2,
      metadata_text: "sample-id\tbarcode-sequence\nsampleA\tACCGCACTT\nsampleB\tGGACGGACG\n" },
    params: { trim_left: 0, trunc_len: 120, rarefaction_depth: null },
    discovery: { tools: { demux: { id: "demux-tool", version: "2026.1.0" },
      denoise: { id: "denoise-tool", version: "2026.1.0" } },
    classifier: { available: false, reason: "none" }, discovery_mode: "live", discovered_at: null },
    dataset_ids: { metadata: "44444444444444444444444444444444" },
    filenames: { reads: "sequences.fastq.gz", barcodes: "barcodes.fastq.gz", metadata: "sample-metadata.tsv" },
    history_id: HISTORY, frontier: { importedSeqsId: DEMUX_QZA, demuxReadsId: DEMUX_QZA },
    results: {}, artifacts: [], errors: [], poll_count: 0, exports: {}, pending_exports: [],
    steps: {
      import_reads: { status: "succeeded", provider_job_id: "uploadjob00000001" },
      demux: { status: "succeeded", provider_job_id: "demux-job-0001", demuxReadsId: DEMUX_QZA }
    },
    import: { status: "succeeded", provider_job_id: "import-job-0001", output_dataset_id: DEMUX_QZA,
      output_history_id: HISTORY, copy_dataset_id: DEMUX_QZA },
    ...overrides
  };
}

function artifacts() {
  return [
    { run_id: RUN_ID, name: "feature-table.tsv", kind: "feature_table", content: TABLE_TEXT, checksum: "a".repeat(64) },
    { run_id: RUN_ID, name: "rep-seqs.fasta", kind: "rep_seqs", content: REP_TEXT, checksum: "b".repeat(64) },
    { run_id: RUN_ID, name: "taxonomy.tsv", kind: "taxonomy", content: TAX_TEXT, checksum: "c".repeat(64) }
  ];
}

// Count every attempt to read stored artifact text for parsing.
function countingDb(initial) {
  const { db, state: d1 } = createFakeD1AI(initial);
  let parseReads = 0;
  const realPrepare = db.prepare.bind(db);
  db.prepare = (sql) => {
    if (sql === SQL.listArtifactsForRun) {
      const statement = realPrepare(sql);
      const realAll = statement.all.bind(statement);
      statement.all = async (...args) => { parseReads += 1; return realAll(...args); };
      return statement;
    }
    return realPrepare(sql);
  };
  return { db, d1, parseReads: () => parseReads };
}

function seededDb(s, artifactRows = artifacts()) {
  return countingDb({ microbiome_runs: [{
    public_id: RUN_ID, input_sha256: s.input_sha256, metadata_sha256: s.metadata_sha256,
    state: s.status, plan_id: s.plan_id, run_id: RUN_ID, state_json: JSON.stringify(s),
    result_json: null, created_at: s.created_at, completed_at: null
  }], artifacts: artifactRows });
}

const runningFetch = async (input) => {
  const url = String(input);
  if (url.includes("/api/jobs/")) return json({ id: "dada2-job-0001", state: "running", history_id: HISTORY });
  return json({ error: "unexpected_stub_route", url }, 404);
};

async function status(db, fetchImpl = runningFetch) {
  const response = await handleStatus(makeGetRequest(`/api/ai/workflows/microbiome/status?run_id=${RUN_ID}`),
    { ...mockAIEnv(db), GALAXY_ENABLED: "true", GALAXY_BASE_URL: "https://galaxy.example.test",
      GALAXY_API_KEY: "stub-key", FETCH_IMPL: fetchImpl }, { fetchImpl });
  return response.json();
}

test("PROVIDER POLL / zero artifact parses while a real DADA2 job is running", async () => {
  const s = state({ steps: { ...state().steps,
    dada2_denoise: { status: "running", provider_job_id: "dada2-job-0001", tool_id: "denoise-tool" } } });
  const { db, d1, parseReads } = seededDb(s);
  const previousFetch = globalThis.fetch;
  globalThis.fetch = runningFetch;
  try {
    for (let index = 0; index < 5; index += 1) {
      const body = await status(db);
      assert.equal(body.status, "running");
    }
    assert.equal(parseReads(), 0, "provider polls must never rehydrate artifacts");
    const stored = JSON.parse(d1.tables.microbiome_runs[0].state_json);
    assert.equal(stored._parsed, undefined);
    assert.equal(stored.steps.dada2_denoise.provider_job_id, "dada2-job-0001", "no job was resubmitted");
  } finally { globalThis.fetch = previousFetch; }
});

test("LOCAL STAGE / rehydrates at most once across polls", async () => {
  const s = state({ current_step: "composition", steps: {
    import_reads: { status: "succeeded" }, demux: { status: "succeeded", provider_job_id: "demux-job-0001" },
    qc_summary: { status: "unavailable", reason: "no qc tool" },
    dada2_denoise: { status: "unavailable", reason: "no denoise artifact" },
    taxonomy: { status: "unavailable", reason: "no classifier" }
  } });
  const { db, d1, parseReads } = seededDb(s);
  await status(db);
  await status(db);
  await status(db);
  assert.equal(parseReads(), 1, "parsed tables are built once, then reused from state");
  const stored = JSON.parse(d1.tables.microbiome_runs[0].state_json);
  assert.ok(stored._parsed_rehydrated_at);
  assert.equal(stored.results.composition.available, true);
});

test("TERMINAL RESULT / deterministic values and exports still produced once", async () => {
  const s = state({ current_step: "report", results: {
    asv: { available: true, feature_count: 2, sample_count: 2, total_assignable_reads: 24 },
    taxonomy: { available: true, assignments: [], by_feature: {} },
    alpha: { available: true, samples: [{ sample_id: "sampleA", observed_features: 2, shannon: 0.56, faith_pd: null }], basis: "worker_computed_from_real_feature_table_counts" },
    beta: { available: true, samples: ["sampleA", "sampleB"], matrix: [[0, 0.4], [0.4, 0]], metric: "bray_curtis", basis: "worker_computed_from_real_feature_table_counts" },
    pcoa: { available: true, samples: ["sampleA", "sampleB"], axes: ["PC1"], coordinates: [], basis: "worker_computed_from_real_distance_matrix" }
  }, steps: {
    import_reads: { status: "succeeded" }, demux: { status: "succeeded" },
    qc_summary: { status: "unavailable" }, dada2_denoise: { status: "succeeded" },
    taxonomy: { status: "unavailable" }, composition: { status: "succeeded" },
    alpha_diversity: { status: "succeeded" }, beta_diversity: { status: "succeeded" },
    pcoa: { status: "succeeded" }, ordination: { status: "succeeded" }
  } });
  const { db, d1, parseReads } = seededDb(s);
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async () => json({ error: "unused" }, 404);
  try {
    await status(db); // report local stage succeeds
    const body = await status(db); // advances to terminal and builds the result
    assert.equal(body.status, "succeeded");
    assert.equal(parseReads(), 1, "rehydrate once for the final result");
    const row = d1.tables.microbiome_runs[0];
    const result = JSON.parse(row.result_json);
    assert.ok(result.exports.some((entry) => entry.name === "feature-table.tsv"));
    const tableExport = result.exports.find((entry) => entry.name === "feature-table.tsv");
    assert.match(tableExport.content, /asv1\t10\t5/);
    const report = result.exports.find((entry) => entry.name === "report.txt");
    assert.match(report.content, /16S microbiome run/);
    const again = await status(db);
    assert.equal(again.status, "succeeded");
    assert.equal(parseReads(), 1, "terminal polls do not rebuild result/exports");
  } finally { globalThis.fetch = previousFetch; }
});

test("CPU-HEAVY ARTIFACT / oversized parse is skipped with an honest reason", async () => {
  const rows = artifacts();
  rows[0] = { ...rows[0], content: "#OTU ID\tsampleA\n" + "asv1\t1\n".repeat(40_000) };
  const s = state({ current_step: "composition", steps: {
    import_reads: { status: "succeeded" }, demux: { status: "succeeded", provider_job_id: "demux-job-0001" }
  } });
  const { db, d1, parseReads } = seededDb(s, rows);
  const body = await status(db);
  assert.equal(body.status, "running", "the workflow advances rather than timing out");
  assert.equal(parseReads(), 1);
  const stored = JSON.parse(d1.tables.microbiome_runs[0].state_json);
  assert.ok(stored.parse_limits.some((entry) => /artifact_exceeds_.*character_local_parse_bound/.test(entry.reason)));
  assert.equal(stored.results.composition.available, false);
  assert.match(stored.results.composition.reason, /unavailable/);
  assert.equal(stored.steps.composition.status, "unavailable");
});
