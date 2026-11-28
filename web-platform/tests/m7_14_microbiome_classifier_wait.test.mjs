// M7.14.3 LABELLED STUBBED CLASSIFIER-WAIT / RESUME TESTS — ZERO live calls.
//
// A URL-import job must finish before any checksum claim, and a skipped job
// submission must never become a running step with a null provider job id.
// The single opt-in recovery is checked before the terminal-state guard.
import test from "node:test";
import assert from "node:assert/strict";

import { handleAdvance } from "../functions/api/ai/workflows/microbiome/engine.js";
import { createFakeD1AI, makePostRequest, mockAIEnv } from "./helpers/fake-d1.mjs";

const RUN = "job_a8817e35d7534d98";
const HISTORY = "11ac94870d0bb33aff42f70766c41aa1";
const CLASSIFIER_DS = "40160950115d555e25bf9f7119c9c970";
const IMPORT_JOB = "4838ba20a6d867652d7ab2f9383c4d26";
const CLASSIFY_TOOL = "toolshed.g2.bx.psu.edu/repos/iuc/qiime2_feature_classifier_classify_sklearn/7+galaxy1";
const TEST_KEY = "stub-key-not-a-real-secret";
const SKIP_REASON = "No classifier/reference option was exposed by the live tool schema. No classifier release or identifier was invented.";

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function state(overrides = {}) {
  return {
    workflow_type: "microbiome", run_id: RUN, plan_id: "plan_a8817e35d7534d98",
    status: "running", current_step: "taxonomy", created_at: "2026-11-27T00:00:00.000Z",
    input_sha256: "a".repeat(64), metadata_sha256: "b".repeat(64),
    input: { mode: "public", source: {}, sample_ids: ["sampleA"], sample_count: 1,
      metadata_text: "sample-id\tbarcode-sequence\nsampleA\tACCGCACTT\n" },
    params: { trim_left: 0, trunc_len: 120, rarefaction_depth: null },
    discovery: { tools: { classify: { id: CLASSIFY_TOOL, version: "7+galaxy1" } },
      classifier: { available: false, reason: SKIP_REASON }, discovery_mode: "live" },
    history_id: HISTORY, frontier: { repSeqsId: "cccccccccccccccccccccccccccccccc" },
    steps: {
      import_reads: { status: "succeeded", provider_job_id: "upload-job-0001" },
      demux: { status: "succeeded", provider_job_id: "demux-job-0001" },
      qc_summary: { status: "unavailable", reason: "no qc tool" },
      dada2_denoise: { status: "succeeded", provider_job_id: "dada2-job-0001" },
      taxonomy: {}
    },
    results: { asv: { available: false, reason: "no table" } },
    artifacts: [], errors: [], poll_count: 120, exports: {}, pending_exports: [],
    classifier_prep: { status: "uploaded", usable: false, dataset_id: CLASSIFIER_DS,
      history_id: HISTORY, job_id: IMPORT_JOB, provider_job_id: IMPORT_JOB,
      computed_sha256: null, reason: "provider_checksum_verification_pending" },
    feature_table_recovery: { status: "unavailable", reason: "disabled in this test" },
    ...overrides
  };
}

function seededDb(s) {
  return createFakeD1AI({ microbiome_runs: [{
    public_id: RUN, input_sha256: s.input_sha256, metadata_sha256: s.metadata_sha256,
    state: s.status, plan_id: s.plan_id, run_id: RUN, state_json: JSON.stringify(s),
    result_json: null, created_at: s.created_at, completed_at: null
  }] });
}

function makeStub(options = {}) {
  const calls = [];
  const submissions = [];
  const fetchImpl = async (input, init = {}) => {
    const url = String(input);
    const method = String(init.method ?? "GET").toUpperCase();
    calls.push({ url, method });
    if (method === "POST" && url.endsWith("/api/tools")) {
      submissions.push({ url, body: JSON.parse(String(init.body)) });
      return json({ outputs: [{ id: "dddddddddddddddddddddddddddddddd" }],
        jobs: [{ id: "taxonomy-job-0001" }] });
    }
    if (url.includes("/api/jobs/")) {
      return json({ id: IMPORT_JOB, state: options.jobState ?? "running",
        history_id: HISTORY });
    }
    if (/\/api\/datasets\//.test(url)) {
      return json({ id: CLASSIFIER_DS, state: "ok", file_size: 218245868,
        checksums: [{ hash_function: "sha256", checksum: "c08a1aa4d56b449b511f7215543a43249ae9c54b57491428a7e5548a62613616" }],
        history_id: HISTORY });
    }
    return json({ error: "unexpected_stub_route", url }, 404);
  };
  return { calls, submissions, fetchImpl,
    detailReads: () => calls.filter((call) => /\/api\/datasets\//.test(call.url)).length,
    jobReads: () => calls.filter((call) => /\/api\/jobs\//.test(call.url)).length };
}

function envFor(db, fetchImpl) {
  return { ...mockAIEnv(db), MICROBIOME_TEST_ADVANCE: false, GALAXY_ENABLED: "true",
    GALAXY_BASE_URL: "https://galaxy.example.test", GALAXY_API_KEY: TEST_KEY, FETCH_IMPL: fetchImpl };
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

test("CLASSIFIER WAIT / a still-running URL-import job keeps the cursor and never reads a checksum", async () => {
  const { db, state: d1 } = seededDb(state({ advance_op: "classifier_wait" }));
  const stub = makeStub({ jobState: "running" });
  const env = envFor(db, stub.fetchImpl);
  const body = await (await advance(db, env, stub.fetchImpl)).json();
  assert.equal(body.operation, "classifier_wait");
  assert.equal(body.next_operation, "classifier_wait");
  assert.equal(stub.jobReads(), 1, "exactly one job-status read");
  assert.equal(stub.detailReads(), 0, "no premature dataset-detail/checksum read");
  const prep = stored(d1).classifier_prep;
  assert.equal(prep.status, "uploaded");
  assert.equal(prep.usable, false);
  assert.equal(prep.reason, "provider_checksum_verification_pending",
    "no premature unusable reason was recorded");
  assert.equal(stored(d1).steps.taxonomy.status, undefined);
  const finished = makeStub({ jobState: "ok" });
  const next = await (await advance(db, env, finished.fetchImpl)).json();
  assert.equal(next.next_operation, "classifier_verify");
});

test("CLASSIFIER WAIT / a failed import job marks the classifier and step unavailable, then advances", async () => {
  const { db, state: d1 } = seededDb(state({ advance_op: "classifier_wait" }));
  const stub = makeStub({ jobState: "failed" });
  const env = envFor(db, stub.fetchImpl);
  const body = await (await advance(db, env, stub.fetchImpl)).json();
  assert.notEqual(body.next_operation, "classifier_verify");
  assert.equal(stub.detailReads(), 0);
  const finalState = stored(d1);
  assert.equal(finalState.classifier_prep.status, "unavailable");
  assert.equal(finalState.classifier_prep.usable, false);
  assert.match(finalState.classifier_prep.reason, /^classifier_import_job_failed:/);
  assert.equal(finalState.steps.taxonomy.status, "unavailable");
  assert.match(finalState.steps.taxonomy.reason, /^classifier_import_job_failed:/);
});

test("SUBMIT STAGE / a skipped submission marks taxonomy unavailable with zero jobs and no provider_job_id_missing", async () => {
  const { db, state: d1 } = seededDb(state({ advance_op: "submit_stage" }));
  const stub = makeStub();
  const env = envFor(db, stub.fetchImpl);
  const body = await (await advance(db, env, stub.fetchImpl)).json();
  assert.equal(body.status, "running");
  assert.equal(stub.submissions.length, 0, "no provider job was submitted");
  const finalState = stored(d1);
  assert.equal(finalState.steps.taxonomy.status, "unavailable");
  assert.equal(finalState.steps.taxonomy.reason, SKIP_REASON);
  assert.equal(finalState.steps.taxonomy.provider_job_id, null);
  assert.equal(finalState.errors.some((entry) => /provider_job_id_missing/.test(JSON.stringify(entry))), false);
});

test("RESUME FAILED / opt-in recovery restores the exact failed run once and cannot loop", async () => {
  const failed = state({ status: "failed", advance_op: null,
    current_step: "taxonomy",
    errors: [{ step: "taxonomy", reason: "provider_job_id_missing" },
      { step: "demux", reason: "unrelated_evidence_kept" }],
    steps: { ...state().steps, taxonomy: { status: "running", reason: SKIP_REASON,
      provider_job_id: null } },
    feature_table_recovery: { status: "submitted", dataset_id: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" } });
  failed.errors.push({ step: "dada2_denoise", dataset_id: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    reason: "content_unavailable" });
  const { db, state: d1 } = seededDb(failed);
  const stub = makeStub();
  const env = envFor(db, stub.fetchImpl);
  const first = await advance(db, env, stub.fetchImpl, { resume: "m7143_classifier_ready" });
  assert.equal(first.status, 200);
  const body = await first.json();
  assert.equal(body.operation, "resume_failed");
  assert.equal(body.resumed, true);
  assert.equal(body.status, "running");
  // Conversion is still needed, so the cursor is free to choose it first.
  assert.equal(body.next_operation, "convert_biom_to_tsv");
  const restored = stored(d1);
  assert.equal(restored.status, "running");
  assert.deepEqual(restored.steps.taxonomy, {});
  assert.equal(restored.advance_op, null);
  assert.deepEqual(restored.resume_markers, ["m7143_classifier_ready"]);
  assert.equal(restored.errors.some((entry) => /provider_job_id_missing/.test(JSON.stringify(entry))), false);
  assert.ok(restored.errors.some((entry) => /unrelated_evidence_kept/.test(JSON.stringify(entry))));
  assert.ok(restored.errors.some((entry) => /content_unavailable/.test(JSON.stringify(entry))));
  assert.equal(restored.steps.dada2_denoise.provider_job_id, "dada2-job-0001");
  // A second recovery attempt is refused and changes nothing.
  const replay = await advance(db, env, stub.fetchImpl, { resume: "m7143_classifier_ready" });
  assert.equal(replay.status, 409);
  assert.match(await replay.text(), /resume_not_eligible/);
  assert.deepEqual(stored(d1).resume_markers, ["m7143_classifier_ready"]);
  const unknown = await advance(db, env, stub.fetchImpl, { resume: "anything_else" });
  assert.equal(unknown.status, 409);
  assert.match(await unknown.text(), /unknown_resume_token/);
});

test("RESUME FAILED / a failed run without the exact taxonomy failure stays failed", async () => {
  const { db, state: d1 } = seededDb(state({ status: "failed", advance_op: null,
    errors: [{ step: "taxonomy", reason: "some_other_failure" }],
    steps: { ...state().steps, taxonomy: { status: "running", provider_job_id: null,
      reason: SKIP_REASON } } }));
  const stub = makeStub();
  const env = envFor(db, stub.fetchImpl);
  const response = await advance(db, env, stub.fetchImpl, { resume: "m7143_classifier_ready" });
  assert.equal(response.status, 409);
  assert.match(await response.text(), /resume_not_eligible/);
  assert.equal(stored(d1).status, "failed");
  assert.equal(stored(d1).resume_markers, undefined);
});
