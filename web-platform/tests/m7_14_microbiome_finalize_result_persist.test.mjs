// M7.14.3 LABELLED STUBBED RESULT-PERSISTENCE TESTS — ZERO live calls.
// finalize_result must return the built result so the run row's result_json is
// written, even when the best-effort jobs-table write matches no row.
import test from "node:test";
import assert from "node:assert/strict";

import { SQL } from "../functions/api/ai/_lib.js";
import {
  handleAdvance, handleResult
} from "../functions/api/ai/workflows/microbiome/engine.js";
import { createFakeD1AI, makeGetRequest, makePostRequest, mockAIEnv } from "./helpers/fake-d1.mjs";

const RUN = "job_a8817e35d7534d98";
const HISTORY = "11ac94870d0bb33aff42f70766c41aa1";

function state() {
  const steps = {};
  for (const id of ["import_reads", "demux", "qc_summary", "dada2_denoise", "taxonomy",
    "composition", "alpha_diversity", "beta_diversity", "pcoa", "ordination", "report"]) {
    steps[id] = { status: id === "qc_summary" ? "unavailable" : "succeeded",
      ...(id === "dada2_denoise" ? { provider_job_id: "dada2-job-0001" } : {}) };
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
      taxonomy: { available: true, assignments: [], by_feature: {} },
      alpha: { available: true, samples: [{ sample_id: "sampleA", observed_features: 2,
        shannon: 0.69, faith_pd: null }], basis: "computed_from_real_feature_table" },
      beta: { available: true, samples: ["sampleA", "sampleB"], matrix: [[0, 0.4], [0.4, 0]],
        metric: "bray_curtis", basis: "parsed_from_real_distance_artifact" },
      pcoa: { available: true, samples: ["sampleA", "sampleB"], axes: ["PC1"],
        coordinates: [{ sample_id: "sampleA", values: { PC1: -0.2 } },
          { sample_id: "sampleB", values: { PC1: 0.2 } }],
        variance_explained: { PC1: 1 }, basis: "computed_from_real_distance_matrix" }
    },
    artifacts: [
      { name: "feature table.tsv", kind: "feature_table", dataset_id: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        checksum: "1".repeat(64), source_step: "dada2_denoise" },
      { name: "rep-seqs.fasta", kind: "rep_seqs", dataset_id: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        checksum: "2".repeat(64), source_step: "dada2_denoise" },
      { name: "taxonomy.tsv", kind: "taxonomy", dataset_id: "cccccccccccccccccccccccccccccccc",
        checksum: "3".repeat(64), source_step: "taxonomy" }
    ],
    frontier: { featureTableId: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" },
    errors: [], poll_count: 0, exports: {}, pending_exports: [], dataset_ids: {}
  };
}

function seeded() {
  const s = state();
  const artifacts = [
    { run_id: RUN, name: "feature table.tsv", kind: "feature_table",
      content: "#OTU ID\tsampleA\tsampleB\nasv1\t10\t5\nasv2\t2\t7\n", checksum: "1".repeat(64) },
    { run_id: RUN, name: "rep-seqs.fasta", kind: "rep_seqs",
      content: ">asv1\nACGTACGT\n>asv2\nACGTTCGA\n", checksum: "2".repeat(64) },
    { run_id: RUN, name: "taxonomy.tsv", kind: "taxonomy",
      content: "Feature ID\tTaxon\tConfidence\nasv1\tk__Bacteria; p__Firmicutes\t0.9\n"
        + "asv2\tk__Bacteria; p__Bacteroidetes\t0.8\n", checksum: "3".repeat(64) }
  ];
  const { db, state: d1 } = createFakeD1AI({ microbiome_runs: [{
    public_id: RUN, input_sha256: s.input_sha256, metadata_sha256: s.metadata_sha256,
    state: s.status, plan_id: s.plan_id, run_id: RUN, state_json: JSON.stringify(s),
    result_json: null, created_at: s.created_at, completed_at: null
  }], artifacts });
  // Simulate a jobs-table status-guard row-match failure: result persistence
  // must not depend on that best-effort write.
  const realPrepare = db.prepare.bind(db);
  db.prepare = (sql) => {
    if (sql === SQL.saveJobResult) throw new Error("jobs row did not match status guard");
    return realPrepare(sql);
  };
  return { db, d1 };
}

const envFor = (db, fetchImpl) => ({ ...mockAIEnv(db), MICROBIOME_TEST_ADVANCE: false,
  GALAXY_ENABLED: "true", GALAXY_BASE_URL: "https://galaxy.example.test",
  GALAXY_API_KEY: "stub-key", FETCH_IMPL: fetchImpl });

test("FINALIZE RESULT / built result is persisted to the run row and served by /result", async () => {
  const { db, d1 } = seeded();
  const fetchImpl = async () => { throw new Error("no provider call is allowed"); };
  const env = envFor(db, fetchImpl);
  const previous = globalThis.fetch;
  globalThis.fetch = fetchImpl;
  try {
    const advance = await handleAdvance(makePostRequest({ run_id: RUN },
      "/api/ai/workflows/microbiome/advance"), env, { fetchImpl });
    assert.equal(advance.status, 200);
    const body = await advance.json();
    assert.equal(body.result_ready, true);
    assert.equal(body.status, "succeeded");
    const row = d1.tables.microbiome_runs[0];
    assert.ok(row.result_json, "the run row must hold the built result");
    const result = JSON.parse(row.result_json);
    assert.equal(result.run_id, RUN);
    assert.equal(result.asv.available, true);
    assert.equal(result.alpha.available, true);
    assert.equal(result.beta.available, true);
    assert.equal(result.pcoa.available, true);
    assert.ok(result.exports.some((entry) => entry.name === "report.txt"));
    const served = await handleResult(makeGetRequest(
      `/api/ai/workflows/microbiome/result?run_id=${RUN}`), env);
    assert.equal(served.status, 200);
    const servedBody = await served.json();
    assert.equal(servedBody.asv.feature_count, 2);
    const persistedOnce = row.result_json;
    const replay = await handleAdvance(makePostRequest({ run_id: RUN },
      "/api/ai/workflows/microbiome/advance"), env, { fetchImpl });
    const replayBody = await replay.json();
    assert.equal(replayBody.status, "succeeded");
    assert.equal(replayBody.result_ready, undefined, "a replay never rebuilds the result");
    assert.equal(d1.tables.microbiome_runs[0].result_json, persistedOnce);
    assert.equal(JSON.parse(d1.tables.microbiome_runs[0].state_json).result_built, true);
  } finally { globalThis.fetch = previous; }
});
