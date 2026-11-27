// M7.14.3 LABELLED STUBBED DATASET-DETAIL DIAGNOSTIC TESTS — ZERO live calls.
// Read-only checksum/metadata view for a dataset already owned by the run.
import test from "node:test";
import assert from "node:assert/strict";

import { handleDatasetDetail } from "../functions/api/ai/workflows/microbiome/engine.js";
import { createFakeD1AI, makeGetRequest, mockAIEnv } from "./helpers/fake-d1.mjs";

const RUN = "job_a8817e35d7534d98";
const HISTORY = "11ac94870d0bb33aff42f70766c41aa1";
const CLASSIFIER_DS = "40160950115d555e25bf9f7119c9c970";
const UNKNOWN_DS = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const TEST_KEY = "stub-key-not-a-real-secret";
const MD5 = "b02f082919b53566ebd91b8e1a78f106";

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function state() {
  return {
    workflow_type: "microbiome", run_id: RUN, status: "running", current_step: "taxonomy",
    created_at: "2026-11-27T00:00:00.000Z", input_sha256: "a".repeat(64),
    metadata_sha256: "b".repeat(64), plan_id: "plan_a8817e35d7534d98",
    history_id: HISTORY, frontier: {}, artifacts: [], dataset_ids: {},
    classifier_prep: { dataset_id: CLASSIFIER_DS, status: "verified", usable: true },
    errors: []
  };
}

function makeStub(options = {}) {
  const calls = [];
  const fetchImpl = async (input, init = {}) => {
    const url = String(input);
    calls.push({ url, method: String(init.method ?? "GET") });
    if (/\/api\/datasets\/[^/]+$/.test(url)) {
      return json({ id: CLASSIFIER_DS, name: "silva-138-99-nb-classifier.qza", state: "ok",
        file_size: 218245868, extension: "qza", datatype: "qza", semantic_type: "FeatureData[Sequence]",
        history_id: options.history ?? HISTORY, creating_job: "4838ba20a6d867652d7ab2f9383c4d26",
        checksums: [{ hash_function: "md5", checksum: MD5 }] });
    }
    if (/\/api\/histories\/[^/]+\/contents/.test(url)) {
      return json([{ id: CLASSIFIER_DS, name: "silva-138-99-nb-classifier.qza",
        state: "ok", history_id: HISTORY }]);
    }
    return json({ error: "unexpected_stub_route", url }, 404);
  };
  return { calls, fetchImpl };
}

async function detail(datasetId, stub, runId = RUN) {
  const s = state();
  const { db } = createFakeD1AI({ microbiome_runs: [{
    public_id: RUN, input_sha256: s.input_sha256, metadata_sha256: s.metadata_sha256,
    state: s.status, plan_id: s.plan_id, run_id: RUN, state_json: JSON.stringify(s),
    result_json: null, created_at: s.created_at, completed_at: null
  }] });
  const env = { ...mockAIEnv(db), MICROBIOME_TEST_ADVANCE: false, GALAXY_ENABLED: "true",
    GALAXY_BASE_URL: "https://galaxy.example.test", GALAXY_API_KEY: TEST_KEY, FETCH_IMPL: stub.fetchImpl };
  const previous = globalThis.fetch;
  globalThis.fetch = stub.fetchImpl;
  try {
    return handleDatasetDetail(makeGetRequest(
      `/api/ai/workflows/microbiome/dataset-detail?run_id=${encodeURIComponent(runId)}&dataset_id=${datasetId}`),
    env, { fetchImpl: stub.fetchImpl });
  } finally { globalThis.fetch = previous; }
}

test("DATASET DETAIL / a run-owned dataset returns a capped sanitized checksum map", async () => {
  const stub = makeStub();
  const response = await detail(CLASSIFIER_DS, stub);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.id, CLASSIFIER_DS);
  assert.equal(body.name, "silva-138-99-nb-classifier.qza");
  assert.equal(body.state, "ok");
  assert.equal(body.size, 218245868);
  assert.equal(body.history_id, HISTORY);
  assert.equal(body.creating_job, "4838ba20a6d867652d7ab2f9383c4d26");
  assert.deepEqual(body.checksums, { md5: MD5 });
  assert.equal(body.checksums.sha256, undefined, "a missing SHA-256 is never invented");
  const text = JSON.stringify(body);
  assert.doesNotMatch(text, new RegExp(TEST_KEY));
  assert.doesNotMatch(text, /https:\/\/|raw body|item_data/);
  assert.ok(text.length < 8 * 1024);
  assert.equal(stub.calls.length, 1, "one dataset-detail GET; no history scan for a known id");
  assert.ok(stub.calls.every((call) => call.method === "GET"));
});

test("DATASET DETAIL / an unknown dataset and a wrong-history dataset are refused", async () => {
  const stub = makeStub();
  const unknown = await detail(UNKNOWN_DS, stub);
  assert.equal(unknown.status, 403);
  assert.match(await unknown.text(), /not owned by this run/);
  const wrongHistory = makeStub({ history: "ffffffffffffffffffffffffffffffff" });
  const refused = await detail(CLASSIFIER_DS, wrongHistory);
  assert.equal(refused.status, 403);
  assert.match(await refused.text(), /different history/);
  const wrongRun = await detail(CLASSIFIER_DS, stub, "job_0000000000000000");
  assert.equal(wrongRun.status, 404);
});

test("ROUTING / dataset-detail reaches its registered Worker handler", async () => {
  const { createFetch, handlers } = await import("../worker.js");
  let reached = false;
  const map = { ...handlers, microbiomeDatasetDetail: async () => {
    reached = true; return new Response("detail");
  } };
  const response = await createFetch(map)(new Request(
    "https://app.example.test/api/ai/workflows/microbiome/dataset-detail?run_id=x&dataset_id=y"), {}, {});
  assert.equal(await response.text(), "detail");
  assert.equal(reached, true);
});
