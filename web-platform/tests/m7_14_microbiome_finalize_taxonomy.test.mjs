// M7.14.3 LABELLED STUBBED FINALIZE-TAXONOMY TESTS — ZERO live calls.
// Genuine taxonomy text that arrived through the bounded export poll must be
// reflected in the final result, not left unavailable in stored results.
import test from "node:test";
import assert from "node:assert/strict";

import { handleAdvance } from "../functions/api/ai/workflows/microbiome/engine.js";
import { createFakeD1AI, makePostRequest, mockAIEnv } from "./helpers/fake-d1.mjs";

const RUN = "job_a8817e35d7534d98";
const HISTORY = "11ac94870d0bb33aff42f70766c41aa1";
const TABLE_ID = "40160950115d555ed5330c1bedac2181";
const TAXONOMY_ID = "40160950115d555eef85c989da8f71b7";
const TAXONOMY_TEXT = "Feature ID\tTaxon\tConfidence\n"
  + "asv1\tk__Bacteria; p__Firmicutes\t0.9\n"
  + "asv2\tk__Bacteria; p__Bacteroidetes\t0.8\n";

function state() {
  const steps = {};
  for (const id of ["import_reads", "demux", "qc_summary", "dada2_denoise", "taxonomy",
    "composition", "alpha_diversity", "beta_diversity", "pcoa", "ordination", "report"]) {
    steps[id] = { status: id === "qc_summary" ? "unavailable" : "succeeded" };
  }
  return {
    workflow_type: "microbiome", run_id: RUN, plan_id: "plan_a8817e35d7534d98",
    status: "running", current_step: null, advance_op: "finalize_result",
    created_at: "2026-11-27T00:00:00.000Z", input_sha256: "a".repeat(64),
    metadata_sha256: "b".repeat(64), history_id: HISTORY,
    input: { mode: "public", source: {}, sample_ids: ["sampleA", "sampleB"], sample_count: 2,
      metadata_text: "sample-id\tbarcode-sequence\nsampleA\tA\nsampleB\tC\n" },
    params: { trim_left: 0, trunc_len: 120, rarefaction_depth: 1 },
    discovery: { tools: {}, classifier: { available: false }, discovery_mode: "live" },
    steps,
    results: {
      asv: { available: true, feature_count: 2, sample_count: 2, total_assignable_reads: 24,
        rep_seq_count: 2 },
      // The live bug: real taxonomy text was stored, but these stayed unavailable.
      taxonomy: { available: false, reason: "No parseable taxonomy artifact was retrieved from the tool output" },
      composition: { available: false, reason: "No feature table or taxonomy was available." },
      alpha: { available: true, samples: [], basis: "computed_from_real_feature_table" },
      beta: { available: true, samples: ["sampleA", "sampleB"], matrix: [[0, 0.4], [0.4, 0]],
        metric: "bray_curtis", basis: "parsed_from_real_distance_artifact" },
      pcoa: { available: true, samples: ["sampleA", "sampleB"], axes: ["PC1"],
        coordinates: [], variance_explained: { PC1: 1 }, basis: "computed_from_real_distance_matrix" }
    },
    artifacts: [
      { name: "feature table.tsv", kind: "feature_table", dataset_id: TABLE_ID,
        checksum: "1".repeat(64), source_step: "dada2_denoise" },
      { name: "rep-seqs.fasta", kind: "rep_seqs", dataset_id: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        checksum: "2".repeat(64), source_step: "dada2_denoise" },
      { name: "taxonomy.tsv", kind: "taxonomy", dataset_id: TAXONOMY_ID,
        checksum: "3".repeat(64), bytes: TAXONOMY_TEXT.length, source_step: "taxonomy" }
    ],
    frontier: { featureTableId: TABLE_ID },
    errors: [], poll_count: 0, exports: {}, pending_exports: [], dataset_ids: {}
  };
}

test("FINALIZE TAXONOMY / parsed genuine text fills taxonomy and composition in the stored result", async () => {
  const s = state();
  const { db, state: d1 } = createFakeD1AI({ microbiome_runs: [{
    public_id: RUN, input_sha256: s.input_sha256, metadata_sha256: s.metadata_sha256,
    state: s.status, plan_id: s.plan_id, run_id: RUN, state_json: JSON.stringify(s),
    result_json: null, created_at: s.created_at, completed_at: null
  }], artifacts: [
    { run_id: RUN, name: "feature table.tsv", kind: "feature_table",
      content: "#OTU ID\tsampleA\tsampleB\nasv1\t10\t5\nasv2\t2\t7\n", checksum: "1".repeat(64) },
    { run_id: RUN, name: "rep-seqs.fasta", kind: "rep_seqs",
      content: ">asv1\nACGTACGT\n>asv2\nACGTTCGA\n", checksum: "2".repeat(64) },
    { run_id: RUN, name: "taxonomy.tsv", kind: "taxonomy",
      content: TAXONOMY_TEXT, checksum: "3".repeat(64) }
  ] });
  const fetchImpl = async () => { throw new Error("no provider call is allowed"); };
  const env = { ...mockAIEnv(db), MICROBIOME_TEST_ADVANCE: false, GALAXY_ENABLED: "true",
    GALAXY_BASE_URL: "https://galaxy.example.test", GALAXY_API_KEY: "stub-key", FETCH_IMPL: fetchImpl };
  const previous = globalThis.fetch;
  globalThis.fetch = fetchImpl;
  try {
    const response = await handleAdvance(makePostRequest({ run_id: RUN },
      "/api/ai/workflows/microbiome/advance"), env, { fetchImpl });
    assert.equal(response.status, 200);
    await response.json();
    const row = d1.tables.microbiome_runs[0];
    assert.ok(row.result_json, "result_json must be persisted");
    const result = JSON.parse(row.result_json);
    assert.equal(result.taxonomy.available, true);
    assert.equal(result.taxonomy.assignments.length, 2);
    assert.equal(result.taxonomy.basis, "parsed_from_genuine_exported_taxonomy_text");
    assert.equal(result.taxonomy.dataset_id, TAXONOMY_ID);
    assert.equal(result.taxonomy.checksum, "3".repeat(64));
    assert.equal(result.composition.available, true);
    assert.equal(result.composition.rank, "phylum");
    assert.equal(result.composition.samples.length, 2);
    assert.equal(result.composition.basis,
      "computed_from_retrieved_feature_table_and_genuine_exported_taxonomy_text");
    assert.equal(result.composition.feature_table_dataset_id, TABLE_ID);
    assert.equal(result.composition.taxonomy_dataset_id, TAXONOMY_ID);
    assert.ok(result.composition.samples[0].taxa.some((entry) => entry.taxon === "Firmicutes"));
    const persistedOnce = row.result_json;
    const replay = await handleAdvance(makePostRequest({ run_id: RUN },
      "/api/ai/workflows/microbiome/advance"), env, { fetchImpl });
    assert.equal((await replay.json()).status, "succeeded");
    assert.equal(d1.tables.microbiome_runs[0].result_json, persistedOnce, "no rebuild on replay");
    assert.equal(JSON.parse(d1.tables.microbiome_runs[0].state_json).result_built, true);
  } finally { globalThis.fetch = previous; }
});
