// M7.14.3 LABELLED STUBBED CLASSIFIER-FALLBACK TESTS — ZERO live calls.
//
// The official classifier was SHA-256 verified outside the Worker; Galaxy need
// not expose that hash. An MD5 it does expose can corroborate the same bytes.
// Taxonomy must consume the genuine rep-seqs qza, never an exported FASTA.
import test from "node:test";
import assert from "node:assert/strict";

import { handleAdvance } from "../functions/api/ai/workflows/microbiome/engine.js";
import {
  QIIME_CLASSIFIER, classifierProvenance
} from "../functions/api/ai/workflows/microbiome/classifier-prep.js";
import { createFakeD1AI, makePostRequest, mockAIEnv } from "./helpers/fake-d1.mjs";

const RUN = "job_a8817e35d7534d98";
const HISTORY = "11ac94870d0bb33aff42f70766c41aa1";
const CLASSIFIER_DS = "40160950115d555e25bf9f7119c9c970";
const REP_QZA = "40160950115d555ee89a9cf8938de69c";
const REP_FASTA = "40160950115d555edb600ea9dd17fdb5";
const CLASSIFY_TOOL = "toolshed.g2.bx.psu.edu/repos/iuc/qiime2_feature_classifier_classify_sklearn/7+galaxy1";
const TEST_KEY = "stub-key-not-a-real-secret";
const MD5 = "b02f082919b53566ebd91b8e1a78f106";

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
    params: { trim_left: 0, trunc_len: 120, rarefaction_depth: 1 },
    discovery: { tools: { classify: { id: CLASSIFY_TOOL, version: "7+galaxy1" } },
      classifier: { available: false, reason: "no live option" }, discovery_mode: "live" },
    history_id: HISTORY,
    frontier: { repSeqsId: REP_FASTA, repSeqsQzaId: REP_QZA },
    steps: {
      import_reads: { status: "succeeded", provider_job_id: "upload-job-0001" },
      demux: { status: "succeeded", provider_job_id: "demux-job-0001" },
      qc_summary: { status: "unavailable", reason: "no qc tool" },
      dada2_denoise: { status: "succeeded", provider_job_id: "dada2-job-0001" },
      taxonomy: {}
    },
    results: { asv: { available: true, feature_count: 1, sample_count: 1 } },
    artifacts: [], errors: [], poll_count: 0, exports: {}, pending_exports: [],
    advance_op: "classifier_verify",
    classifier_prep: { ...classifierProvenance(QIIME_CLASSIFIER), status: "uploaded",
      usable: false, dataset_id: CLASSIFIER_DS, history_id: HISTORY,
      provider_job_id: "4838ba20a6d867652d7ab2f9383c4d26", computed_sha256: null,
      reason: "provider_checksum_verification_pending" },
    local_classifier_verification: { sha256: QIIME_CLASSIFIER.expected_sha256,
      bytes: QIIME_CLASSIFIER.expected_bytes, match: true, md5: MD5,
      basis: "locally_streamed_official_artifact_sha256_verified_outside_worker" },
    ...overrides
  };
}

function verifyStub(options = {}) {
  const calls = [];
  const fetchImpl = async (input, init = {}) => {
    const url = String(input);
    calls.push({ url, method: String(init.method ?? "GET") });
    if (url === QIIME_CLASSIFIER.url) throw new Error("worker_streamed_classifier");
    if (String(init.method ?? "GET").toUpperCase() === "POST" && url.endsWith("/api/tools")) {
      return json({ outputs: [{ id: "taxonomy-out-0001" }],
        jobs: [{ id: "taxonomy-job-0001" }] });
    }
    if (/\/api\/datasets\/[^/]+$/.test(url)) {
      return json({ id: CLASSIFIER_DS, name: QIIME_CLASSIFIER.filename, state: "ok",
        file_size: options.size ?? QIIME_CLASSIFIER.expected_bytes,
        history_id: options.history ?? HISTORY, checksums: options.checksums ?? [],
        creating_job: options.creatingJob ?? "4838ba20a6d867652d7ab2f9383c4d26" });
    }
    return json({ error: "unexpected_stub_route", url }, 404);
  };
  return { calls, fetchImpl };
}

async function advance(s, stub, payload = {}, schema = null) {
  const { db, state: d1 } = createFakeD1AI({ microbiome_runs: [{
    public_id: RUN, input_sha256: s.input_sha256, metadata_sha256: s.metadata_sha256,
    state: s.status, plan_id: s.plan_id, run_id: RUN, state_json: JSON.stringify(s),
    result_json: null, created_at: s.created_at, completed_at: null
  }] });
  const submissions = [];
  const fetchImpl = async (input, init = {}) => {
    const url = String(input);
    if (schema && url.includes("io_details=true")) return json(schema);
    const result = await stub.fetchImpl(input, init);
    if (String(init.method).toUpperCase() === "POST" && url.endsWith("/api/tools")) {
      submissions.push(JSON.parse(String(init.body)));
    }
    return result;
  };
  const env = { ...mockAIEnv(db), MICROBIOME_TEST_ADVANCE: false, GALAXY_ENABLED: "true",
    GALAXY_BASE_URL: "https://galaxy.example.test", GALAXY_API_KEY: TEST_KEY, FETCH_IMPL: fetchImpl };
  const previous = globalThis.fetch;
  globalThis.fetch = fetchImpl;
  try {
    const response = await handleAdvance(makePostRequest({ run_id: RUN, ...payload },
      "/api/ai/workflows/microbiome/advance"), env, { fetchImpl });
    return { response, body: await response.json(), submissions,
      stored: JSON.parse(d1.tables.microbiome_runs[0].state_json) };
  } finally { globalThis.fetch = previous; }
}

test("CLASSIFIER FALLBACK / local SHA-256 + provider MD5 + size marks the classifier usable", async () => {
  const stub = verifyStub({ checksums: [{ hash_function: "md5", checksum: MD5 }] });
  const { body, stored } = await advance(state(), stub);
  assert.equal(body.next_operation, "submit_stage");
  const prep = stored.classifier_prep;
  assert.equal(prep.usable, true);
  assert.equal(prep.status, "verified");
  assert.equal(prep.computed_sha256, QIIME_CLASSIFIER.expected_sha256);
  assert.equal(prep.verification_basis, "local_sha256_plus_provider_md5_and_size");
  assert.equal(prep.provider_sha256_exposed, false, "provider SHA-256 was never claimed");
  assert.equal(prep.provider_md5, MD5);
  assert.equal(prep.source_url, QIIME_CLASSIFIER.url);
  assert.equal(prep.verified_size, QIIME_CLASSIFIER.expected_bytes);
  assert.equal(stub.calls.some((call) => call.url === QIIME_CLASSIFIER.url), false);
});

test("CLASSIFIER FALLBACK / missing or mismatched provider MD5 fails closed", async () => {
  for (const checksums of [[], [{ hash_function: "md5", checksum: "0".repeat(32) }]]) {
    // The provenance path is deliberately disabled here (wrong creating job),
    // so this test isolates the MD5 fallback's fail-closed behaviour.
    const stub = verifyStub({ checksums, creatingJob: "some-other-import-job" });
    const { body, stored } = await advance(state(), stub);
    assert.equal(body.next_operation, "submit_stage");
    const prep = stored.classifier_prep;
    assert.equal(prep.usable, false);
    assert.equal(prep.status, "unavailable");
    assert.match(prep.reason, /^checksum_not_exposed:/);
    assert.equal(prep.computed_sha256, null);
  }
});

test("CLASSIFIER FALLBACK / provider SHA-256 path stays strict and unchanged", async () => {
  const stub = verifyStub({ checksums: [{ hash_function: "sha256", checksum: QIIME_CLASSIFIER.expected_sha256 }] });
  const { stored } = await advance(state(), stub);
  assert.equal(stored.classifier_prep.usable, true);
  assert.equal(stored.classifier_prep.verification_basis, "provider_sha256_and_size");
  assert.equal(stored.classifier_prep.provider_sha256_exposed, true);
  assert.equal(stored.classifier_prep.provider_md5, null);
});

test("CLASSIFIER PROVENANCE / zero provider checksums still verify from local SHA-256 + size + URL-import job", async () => {
  const stub = verifyStub({ checksums: {} });
  const { body, stored } = await advance(state(), stub);
  assert.equal(body.next_operation, "submit_stage");
  const prep = stored.classifier_prep;
  assert.equal(prep.usable, true);
  assert.equal(prep.status, "verified");
  assert.equal(prep.computed_sha256, QIIME_CLASSIFIER.expected_sha256);
  assert.equal(prep.verification_basis, "local_sha256_and_size_with_verified_url_import_provenance");
  assert.equal(prep.provider_checksum_exposed, false);
  assert.equal(prep.provider_sha256_exposed, false);
  assert.equal(prep.provider_md5, null);
  assert.equal(prep.verified_creating_job, "4838ba20a6d867652d7ab2f9383c4d26");
  assert.equal(prep.source_url, QIIME_CLASSIFIER.url);
  assert.equal(prep.name ?? prep.filename, QIIME_CLASSIFIER.filename);
  assert.equal(stub.calls.some((call) => call.url === QIIME_CLASSIFIER.url), false);
});

test("CLASSIFIER PROVENANCE / wrong job, size, history or unverified local hash all fail closed", async () => {
  const cases = [
    ["wrong creating_job", verifyStub({ checksums: {}, creatingJob: "some-other-job" }), state()],
    ["wrong size", verifyStub({ checksums: {}, size: QIIME_CLASSIFIER.expected_bytes - 1 }), state()],
    ["wrong history", verifyStub({ checksums: {}, history: "ffffffffffffffffffffffffffffffff" }), state()],
    ["local not verified", verifyStub({ checksums: {} }), state({ local_classifier_verification: {
      sha256: QIIME_CLASSIFIER.expected_sha256, bytes: QIIME_CLASSIFIER.expected_bytes,
      match: false, md5: MD5 } })],
    ["wrong local SHA-256", verifyStub({ checksums: {} }), state({ local_classifier_verification: {
      sha256: "0".repeat(64), bytes: QIIME_CLASSIFIER.expected_bytes, match: true, md5: MD5 } })]
  ];
  for (const [label, stub, s] of cases) {
    const { body, stored } = await advance(s, stub);
    assert.equal(body.next_operation, "submit_stage", label);
    assert.equal(stored.classifier_prep.usable, false, label);
    assert.equal(stored.classifier_prep.status, "unavailable", label);
    assert.match(stored.classifier_prep.reason, /^checksum_not_exposed:/, label);
    assert.equal(stored.classifier_prep.computed_sha256, null, label);
  }
});

test("TAXONOMY ROLE / the verified rep-seqs qza is used, not the exported FASTA", async () => {
  const classifierPrep = { ...state().classifier_prep, status: "verified", usable: true,
    computed_sha256: QIIME_CLASSIFIER.expected_sha256 };
  const s = state({ advance_op: "submit_stage", classifier_prep: classifierPrep });
  const schema = { tool_id: CLASSIFY_TOOL, inputs: [
    { model_class: "DataToolParameter", name: "reads", optional: false, extensions: ["fasta", "qza"] },
    { model_class: "DataToolParameter", name: "classifier", optional: false, extensions: ["qza"] }
  ] };
  const stub = verifyStub();
  const { submissions, stored } = await advance(s, stub, {}, schema);
  assert.equal(submissions.length, 1);
  assert.deepEqual(submissions[0].inputs.reads, { src: "hda", id: REP_QZA });
  assert.notEqual(submissions[0].inputs.reads.id, REP_FASTA);
  assert.deepEqual(submissions[0].inputs.classifier, { src: "hda", id: CLASSIFIER_DS });
  assert.equal(stored.steps.taxonomy.status, "running");
});
