// M7.14.3 LABELLED STUBBED LOCAL-PCoA TESTS — ZERO live calls.
// Emperor needs an actual PCoA qza; the engine computes genuine coordinates
// from the real retrieved Bray-Curtis matrix instead of submitting a bad job.
import test from "node:test";
import assert from "node:assert/strict";

import { handleAdvance, handleStatus } from "../functions/api/ai/workflows/microbiome/engine.js";
import { createFakeD1AI, makeGetRequest, makePostRequest, mockAIEnv } from "./helpers/fake-d1.mjs";

const RUN = "job_a8817e35d7534d98";
const HISTORY = "11ac94870d0bb33aff42f70766c41aa1";
const EMPEROR_TOOL = "toolshed.g2.bx.psu.edu/repos/iuc/qiime2_emperor_plot/7+galaxy1";

function state(beta, overrides = {}) {
  return {
    workflow_type: "microbiome", run_id: RUN, plan_id: "plan_a8817e35d7534d98",
    status: "running", current_step: "pcoa", created_at: "2026-11-27T00:00:00.000Z",
    input_sha256: "a".repeat(64), metadata_sha256: "b".repeat(64),
    input: { mode: "public", source: {}, sample_ids: ["sampleA", "sampleB", "sampleC"], sample_count: 3,
      metadata_text: "sample-id\tbarcode-sequence\nsampleA\tA\nsampleB\tC\nsampleC\tG\n" },
    params: { trim_left: 0, trunc_len: 120, rarefaction_depth: 1 },
    discovery: { tools: { pcoa: { id: EMPEROR_TOOL, version: "7+galaxy1" } },
      classifier: { available: false }, discovery_mode: "live" },
    history_id: HISTORY, frontier: { distanceMatrixId: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" },
    steps: {
      import_reads: { status: "succeeded" }, demux: { status: "succeeded" },
      qc_summary: { status: "unavailable" }, dada2_denoise: { status: "succeeded" },
      taxonomy: { status: "succeeded" }, composition: { status: "succeeded" },
      alpha_diversity: { status: "succeeded" }, beta_diversity: { status: "succeeded" },
      pcoa: {}
    },
    results: { asv: { available: true, feature_count: 2, sample_count: 3 }, beta },
    artifacts: [], errors: [], poll_count: 0, exports: {}, pending_exports: [],
    ...overrides
  };
}

const REAL_BETA = { available: true, samples: ["sampleA", "sampleB", "sampleC"],
  matrix: [[0, 0.4, 0.7], [0.4, 0, 0.5], [0.7, 0.5, 0]],
  metric: "bray_curtis", basis: "parsed_from_real_distance_artifact",
  source_kind: "parsed_from_retrieved_artifacts" };

function seeded(s) {
  return createFakeD1AI({ microbiome_runs: [{
    public_id: RUN, input_sha256: s.input_sha256, metadata_sha256: s.metadata_sha256,
    state: s.status, plan_id: s.plan_id, run_id: RUN, state_json: JSON.stringify(s),
    result_json: null, created_at: s.created_at, completed_at: null
  }] });
}

function envFor(db, fetchImpl) {
  return { ...mockAIEnv(db), MICROBIOME_TEST_ADVANCE: false, GALAXY_ENABLED: "true",
    GALAXY_BASE_URL: "https://galaxy.example.test", GALAXY_API_KEY: "stub-key", FETCH_IMPL: fetchImpl };
}

test("PCoA / real beta matrix yields genuine coordinates and variance with zero submissions", async () => {
  const { db: statusDb } = seeded(state(REAL_BETA));
  const { db, state: d1 } = seeded(state(REAL_BETA, { advance_op: "submit_stage" }));
  let submissions = 0;
  const fetchImpl = async (input, init = {}) => {
    if (String(init.method ?? "GET").toUpperCase() === "POST") submissions += 1;
    throw new Error("no provider call is allowed for a local PCoA stage");
  };
  const env = envFor(db, fetchImpl);
  const previous = globalThis.fetch;
  globalThis.fetch = fetchImpl;
  try {
    const summary = await (await handleStatus(makeGetRequest(
      `/api/ai/workflows/microbiome/status?run_id=${RUN}`), envFor(statusDb, fetchImpl), { fetchImpl })).json();
    assert.equal(summary.next_operation, "local_stage", "status never selects an emperor submission");
    // An explicit stale cursor must also be redirected to the local op.
    const routed = await (await handleAdvance(makePostRequest({ run_id: RUN },
      "/api/ai/workflows/microbiome/advance"), env, { fetchImpl })).json();
    assert.equal(routed.operation, "submit_stage");
    assert.equal(routed.next_operation, "local_stage");
    const computed = await (await handleAdvance(makePostRequest({ run_id: RUN },
      "/api/ai/workflows/microbiome/advance"), env, { fetchImpl })).json();
    assert.equal(computed.operation, "local_stage");
    const finalState = JSON.parse(d1.tables.microbiome_runs[0].state_json);
    const pcoa = finalState.results.pcoa;
    assert.equal(pcoa.available, true, pcoa.reason);
    assert.deepEqual(pcoa.samples, ["sampleA", "sampleB", "sampleC"]);
    assert.ok(pcoa.axes.length >= 1);
    assert.equal(pcoa.coordinates.length, 3);
    assert.deepEqual(Object.keys(pcoa.coordinates[0].values), pcoa.axes);
    assert.ok(pcoa.variance_explained);
    assert.match(pcoa.basis_detail, /actual retrieved Bray-Curtis distance matrix/);
    assert.match(pcoa.basis_detail, /no significance or group-separation claim/);
    assert.equal(finalState.steps.pcoa.status, "succeeded");
    assert.equal(finalState.steps.pcoa.provider_job_id, null, "no provider job was recorded");
    assert.equal(submissions, 0, "no Galaxy job was submitted");
  } finally { globalThis.fetch = previous; }
});

test("PCoA / unavailable beta fails closed with the existing reason and no submission", async () => {
  const beta = { available: false, reason: "No beta diversity artifact was retrieved.",
    samples: [], matrix: [] };
  const { db, state: d1 } = seeded(state(beta, { advance_op: "local_stage" }));
  const fetchImpl = async () => { throw new Error("no provider call is allowed"); };
  const env = envFor(db, fetchImpl);
  const previous = globalThis.fetch;
  globalThis.fetch = fetchImpl;
  try {
    const body = await (await handleAdvance(makePostRequest({ run_id: RUN },
      "/api/ai/workflows/microbiome/advance"), env, { fetchImpl })).json();
    assert.equal(body.operation, "local_stage");
    const finalState = JSON.parse(d1.tables.microbiome_runs[0].state_json);
    assert.equal(finalState.results.pcoa.available, false);
    assert.equal(finalState.results.pcoa.reason,
      "A usable distance matrix is unavailable; no PCoA was computed.");
    assert.equal(finalState.steps.pcoa.status, "unavailable");
    assert.equal(finalState.results.pcoa.coordinates.length, 0);
  } finally { globalThis.fetch = previous; }
});
