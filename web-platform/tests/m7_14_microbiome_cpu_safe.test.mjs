// M7.14.3 LABELLED STUBBED CPU-SAFETY TESTS — ZERO live calls.
//
// The status route is read-only; each advance POST performs one bounded action
// from a durable cursor. Every Galaxy route and the official classifier URL are
// answered in memory. No live job/upload/download is made and the 218 MB
// classifier is never streamed or hashed in the Worker.
import test from "node:test";
import assert from "node:assert/strict";

import { SQL } from "../functions/api/ai/_lib.js";
import {
  handleStatus, handleAdvance, handleArtifact, intendedExportKind
} from "../functions/api/ai/workflows/microbiome/engine.js";
import { QIIME_CLASSIFIER } from "../functions/api/ai/workflows/microbiome/classifier-prep.js";
import { createFakeD1AI, makeGetRequest, makePostRequest, mockAIEnv } from "./helpers/fake-d1.mjs";

const RUN = "job_a8817e35d7534d98";
const HISTORY = "11ac94870d0bb33aff42f70766c41aa1";
const TABLE_QZA = "40160950115d555ed5330c1bedac2181";
const TABLE_TEXT_DS = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const REP_SEQS = "40160950115d555ee89a9cf8938de69c";
const CLASSIFIER_DS = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const EXPORT_TOOL = "toolshed.g2.bx.psu.edu/repos/q2d2/qiime2_core__tools__export/2026.1.0+dist.h02a552c2";
const DENOISE_TOOL = "toolshed.g2.bx.psu.edu/repos/iuc/qiime2_dada2_denoise_single/7+galaxy1";
const TEST_KEY = "stub-key-not-a-real-secret";

const BIOM_TEXT = JSON.stringify({
  id: "table", format: "Biological Observation Matrix 1.0.0", matrix_type: "sparse",
  sample_ids: ["sampleA", "sampleB"], observation_ids: ["asv1", "asv2"],
  data: [[0, 0, 10], [0, 1, 5], [1, 0, 2], [1, 1, 7]]
});

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}
function exportSchema() {
  return { tool_id: EXPORT_TOOL, inputs: [
    { model_class: "DataToolParameter", name: "input", optional: false, extensions: ["qza"] }
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
    discovery: { tools: { denoise: { id: DENOISE_TOOL, version: "7+galaxy1" },
      exportTool: { id: EXPORT_TOOL, version: "2026.1.0+dist.h02a552c2" } },
      classifier: { available: false, reason: "no option" }, discovery_mode: "live" },
    dataset_ids: { metadata: "44444444444444444444444444444444" },
    filenames: { reads: "sequences.fastq.gz", barcodes: "barcodes.fastq.gz", metadata: "sample-metadata.tsv" },
    history_id: HISTORY,
    frontier: { demuxReadsId: "55555555555555555555555555555555", repSeqsId: REP_SEQS },
    steps: {
      import_reads: { status: "succeeded", provider_job_id: "upload-job-0001" },
      demux: { status: "succeeded", provider_job_id: "demux-job-0001" },
      qc_summary: { status: "unavailable", reason: "no qc tool" },
      dada2_denoise: { status: "succeeded", provider_job_id: "dada2-job-0001", output_artifacts: [
        { name: "qiime2 dada2 denoise-single on dataset 5: table.qza", kind: "qza_artifact", dataset_id: TABLE_QZA },
        { name: "representative_sequences.qza", kind: "qza_artifact", dataset_id: REP_SEQS }
      ] }
    },
    results: { asv: { available: false, reason: "no feature table text", rep_seq_count: 702,
      denoising_stats: { available: true, samples: [{ sample_id: "sampleA", read_count: 10 }] } } },
    artifacts: [
      { name: "representative_sequences.fasta", kind: "rep_seqs", dataset_id: "cccccccccccccccccccccccccccccccc",
        checksum: "d".repeat(64), bytes: 111618, source_step: "dada2_denoise" },
      { name: "qiime2 dada2 denoise-single on dataset 5: table.qza", kind: "qza_artifact",
        dataset_id: TABLE_QZA, checksum: null, bytes: null, source_step: "dada2_denoise" }
    ],
    errors: [], poll_count: 120, exports: {}, pending_exports: [], import: null,
    // Disable the one-off repair in tests that focus on other operations.
    feature_table_recovery: { status: "unavailable", reason: "disabled in this test" },
    ...overrides
  };
}

function seed(s, extra = {}) {
  const { db, state: d1 } = createFakeD1AI({ microbiome_runs: [{
    public_id: RUN, input_sha256: s.input_sha256, metadata_sha256: s.metadata_sha256,
    state: s.status, plan_id: s.plan_id, run_id: RUN, state_json: JSON.stringify(s),
    result_json: null, created_at: s.created_at, completed_at: null
  }], ...extra });
  return { db, d1 };
}

function envFor(db, fetchImpl, extra = {}) {
  return { ...mockAIEnv(db), MICROBIOME_TEST_ADVANCE: false,
    GALAXY_ENABLED: "true", GALAXY_BASE_URL: "https://galaxy.example.test",
    GALAXY_API_KEY: TEST_KEY, FETCH_IMPL: fetchImpl, ...extra };
}

function makeStub(options = {}) {
  const calls = [];
  const submissions = [];
  let throwOnJob = Boolean(options.throwOnJob);
  const contents = () => [
    { id: REP_SEQS, name: "representative_sequences.qza", extension: "qza", state: "ok", history_id: HISTORY },
    ...(options.noTableQza ? [] : [{ id: TABLE_QZA, name: "qiime2 dada2 denoise-single on dataset 5: table.qza",
      extension: "qza", state: "ok", history_id: HISTORY,
      creating_job: options.tableCreatingJob ?? "dada2-job-0001", checksum: "f".repeat(64) }]),
    ...(options.foreignTableId ? [{ id: options.foreignTableId,
      name: "qiime2 dada2 denoise-single on dataset 9: table.qza", extension: "qza",
      state: "ok", history_id: "ffffffffffffffffffffffffffffffff",
      creating_job: "dada2-job-0001" }] : []),
    ...(options.otherJobTableId ? [{ id: options.otherJobTableId,
      name: "qiime2 dada2 denoise-single on dataset 8: table.qza", extension: "qza",
      state: "ok", history_id: HISTORY, creating_job: "some-other-job" }] : []),
    ...(options.noClassifier ? [] : [{ id: CLASSIFIER_DS, name: QIIME_CLASSIFIER.filename,
      extension: "qza", state: "ok", history_id: HISTORY,
      checksum: `sha256$${QIIME_CLASSIFIER.expected_sha256}`,
      ...(options.classifierSize === null ? {}
        : { file_size: options.classifierSize ?? QIIME_CLASSIFIER.expected_bytes }) }]),
    { id: TABLE_TEXT_DS, name: "exported-table.biom", extension: "biom", state: "ok", history_id: HISTORY }
  ];
  const fetchImpl = async (input, init = {}) => {
    const url = String(input);
    const method = String(init.method ?? "GET").toUpperCase();
    calls.push({ url, method, body: init.body });
    assert.ok(!url.includes("data.qiime2.org"), "the Worker must never fetch the classifier URL");
    if (url === QIIME_CLASSIFIER.url) throw new Error("worker_streamed_classifier");
    if (method === "POST" && url.endsWith("/api/tools")) {
      submissions.push({ url, body: JSON.parse(String(init.body)) });
      return json({ outputs: [{ id: TABLE_TEXT_DS }], jobs: [{ id: "export-job-0001" }] });
    }
    if (url.includes("/api/tools/fetch")) {
      return json({ outputs: [{ id: CLASSIFIER_DS, history_id: HISTORY }], jobs: [{ id: "url-job-0001" }] });
    }
    if (url.includes("io_details=true")) return json(exportSchema());
    if (url.includes("/get_content_as_text")) {
      return json({ item_data: options.exportText ?? BIOM_TEXT, truncated: false });
    }
    if (/\/api\/datasets\/[^/]+\/content$/.test(url)) {
      const bytes = new TextEncoder().encode("streamed-binary-body");
      return new Response(new ReadableStream({ start(controller) {
        controller.enqueue(bytes.subarray(0, 5)); controller.enqueue(bytes.subarray(5)); controller.close();
      } }), { status: 200, headers: { "Content-Type": "application/octet-stream", "X-API-Key": TEST_KEY } });
    }
    const detailMatch = url.match(/\/api\/datasets\/([^/?]+)$/);
    if (detailMatch) {
      const requestedId = decodeURIComponent(detailMatch[1]);
      const owner = requestedId === options.foreignId ? "ffffffffffffffffffffffffffffffff" : HISTORY;
      if (options.noChecksum) return json({ id: requestedId, name: QIIME_CLASSIFIER.filename,
        state: "ok", size: QIIME_CLASSIFIER.expected_bytes, history_id: owner, checksums: [] });
      return json({ id: requestedId, name: QIIME_CLASSIFIER.filename, state: "ok",
        ...(options.noSize ? {} : { file_size: options.detailSize ?? QIIME_CLASSIFIER.expected_bytes }),
        extension: "qza", semantic_type: "FeatureData[Sequence]",
        checksums: [{ hash_function: "sha256", checksum: QIIME_CLASSIFIER.expected_sha256 }],
        history_id: owner, creating_job: "url-job-0001" });
    }
    if (/\/api\/jobs\/[^/]+\/outputs$/.test(url)) {
      return json({ outputs: [{ galaxyHdaId: TABLE_TEXT_DS, name: "exported-table.biom" }] });
    }
    if (url.includes("/api/jobs/")) {
      if (throwOnJob) throw new Error("simulated_provider_failure");
      if (options.jobState) return json({ id: "taxonomy-job-0001", state: options.jobState, history_id: HISTORY });
      return json({ id: "export-job-0001", state: "ok", history_id: HISTORY,
        outputs: [{ id: TABLE_TEXT_DS, name: "exported-table.biom", state: "ok" }] });
    }
    if (/\/api\/histories\/[^/]+\/contents/.test(url)) return json(contents());
    if (url.includes("/api/histories?")) return json([{ id: HISTORY }]);
    return json({ error: "unexpected_stub_route", url }, 404);
  };
  return {
    calls, submissions, fetchImpl,
    setThrowOnJob: (value) => { throwOnJob = value; },
    posts: () => calls.filter((call) => call.method === "POST"),
    jobReads: () => calls.filter((call) => /\/api\/jobs\/[^/]+$/.test(call.url)).length,
    historyReads: () => calls.filter((call) => /\/api\/histories\/[^/]+\/contents/.test(call.url)).length
  };
}

async function status(db, env, fetchImpl) {
  const previous = globalThis.fetch;
  globalThis.fetch = fetchImpl;
  try {
    return (await handleStatus(makeGetRequest(`/api/ai/workflows/microbiome/status?run_id=${RUN}`), env,
      { fetchImpl })).json();
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

async function artifact(db, env, fetchImpl, datasetId, runId = RUN) {
  const previous = globalThis.fetch;
  globalThis.fetch = fetchImpl;
  try {
    return await handleArtifact(makeGetRequest(
      `/api/ai/workflows/microbiome/artifact?run_id=${encodeURIComponent(runId)}&dataset_id=${datasetId}`),
    env, { fetchImpl });
  } finally { globalThis.fetch = previous; }
}

function stored(d1) { return JSON.parse(d1.tables.microbiome_runs[0].state_json); }

test("ROUTING / advance and artifact paths reach their registered Worker handlers", async () => {
  const { createFetch, handlers } = await import("../worker.js");
  const seen = [];
  const map = { ...handlers,
    microbiomeAdvance: async () => { seen.push("advance"); return new Response("advance"); },
    microbiomeArtifact: async () => { seen.push("artifact"); return new Response("artifact"); } };
  const workerFetch = createFetch(map);
  await workerFetch(new Request("https://app.example.test/api/ai/workflows/microbiome/advance",
    { method: "POST" }), {}, {});
  await workerFetch(new Request(
    "https://app.example.test/api/ai/workflows/microbiome/artifact?run_id=x&dataset_id=y"), {}, {});
  assert.deepEqual(seen, ["advance", "artifact"]);
});

test("STATUS / read-only: zero provider calls, zero D1 writes, advance metadata present", async () => {
  const s = state({ advance_op: "poll_current_job", steps: { ...state().steps,
    taxonomy: { status: "running", provider_job_id: "taxonomy-job-0001" } } });
  const { db, d1 } = seed(s);
  const stub = makeStub();
  const env = envFor(db, stub.fetchImpl);
  const writesBefore = d1.calls.filter((call) => call.kind === "run").length;
  const body = await status(db, env, stub.fetchImpl);
  await status(db, env, stub.fetchImpl);
  assert.equal(stub.calls.length, 0, "status must not call the provider");
  assert.equal(d1.calls.filter((call) => call.kind === "run").length, writesBefore,
    "status must not write D1");
  assert.equal(body.status, "running");
  assert.equal(body.advance_url, "/api/ai/workflows/microbiome/advance?run_id=job_a8817e35d7534d98");
  assert.equal(body.next_operation, "poll_current_job");
  assert.equal(body.poll_after_ms, 1600);
  assert.ok(Array.isArray(body.artifacts));
  assert.ok(body.artifacts.some((entry) => entry.dataset_id === TABLE_QZA));
  assert.equal(stored(d1).poll_count, 120, "poll_count was not mutated");
});

test("ADVANCE / poll_current_job performs exactly one job read and stays resumable", async () => {
  const s = state({ advance_op: "poll_current_job", steps: { ...state().steps,
    taxonomy: { status: "running", provider_job_id: "taxonomy-job-0001" } } });
  const { db, d1 } = seed(s);
  const stub = makeStub({ jobState: "running" });
  const response = await advance(db, envFor(db, stub.fetchImpl), stub.fetchImpl);
  const body = await response.json();
  assert.equal(body.operation, "poll_current_job");
  assert.equal(body.next_operation, "poll_current_job");
  assert.equal(stub.jobReads(), 1);
  assert.equal(stored(d1).steps.taxonomy.provider_job_id, "taxonomy-job-0001", "no job was resubmitted");
});

test("ADVANCE / a succeeded job moves the cursor to collect_outputs without resubmitting", async () => {
  const s = state({ advance_op: "poll_current_job", steps: { ...state().steps,
    taxonomy: { status: "running", provider_job_id: "taxonomy-job-0001" } } });
  const { db, d1 } = seed(s);
  const stub = makeStub();
  const body = await (await advance(db, envFor(db, stub.fetchImpl), stub.fetchImpl)).json();
  assert.equal(body.next_operation, "collect_outputs");
  assert.equal(stub.posts().length, 0);
  assert.equal(stored(d1).steps.taxonomy.provider_job_id, "taxonomy-job-0001");
});

test("ADVANCE / classifier_inventory reuses a verified qza with one history read and no URL fetch", async () => {
  const s = state({ advance_op: "classifier_inventory" });
  const { db, d1 } = seed(s);
  const stub = makeStub();
  const body = await (await advance(db, envFor(db, stub.fetchImpl), stub.fetchImpl)).json();
  assert.equal(body.operation, "classifier_inventory");
  assert.equal(body.next_operation, "submit_stage");
  assert.equal(stub.historyReads(), 1);
  assert.equal(stub.posts().length, 0);
  const prep = stored(d1).classifier_prep;
  assert.equal(prep.status, "reused");
  assert.equal(prep.usable, true);
  assert.equal(prep.dataset_id, CLASSIFIER_DS);
  assert.equal(prep.computed_sha256, QIIME_CLASSIFIER.expected_sha256);
});

test("ADVANCE / classifier_import submits one URL import and never streams the official URL", async () => {
  const s = state({ advance_op: "classifier_import" });
  const { db, d1 } = seed(s);
  const stub = makeStub({ noClassifier: true });
  const body = await (await advance(db, envFor(db, stub.fetchImpl), stub.fetchImpl)).json();
  // The URL-import job must finish before any checksum read is attempted.
  assert.equal(body.next_operation, "classifier_wait");
  assert.equal(stub.posts().filter((call) => call.url.includes("/api/tools/fetch")).length, 1);
  const form = stub.calls.find((call) => call.url.includes("/api/tools/fetch")).body;
  assert.deepEqual(JSON.parse(form.get("targets"))[0].elements[0],
    { src: "url", url: QIIME_CLASSIFIER.url, name: QIIME_CLASSIFIER.filename, ext: "qza" });
  const prep = stored(d1).classifier_prep;
  assert.equal(prep.status, "uploaded");
  assert.equal(prep.usable, false);
  assert.equal(prep.computed_sha256, null);
});

test("ADVANCE / classifier_verify fails closed when the provider exposes no SHA-256", async () => {
  const prep = { ...QIIME_CLASSIFIER, status: "uploaded", usable: false, dataset_id: CLASSIFIER_DS };
  const s = state({ advance_op: "classifier_verify", classifier_prep: prep });
  const { db, d1 } = seed(s);
  const stub = makeStub({ noChecksum: true });
  const body = await (await advance(db, envFor(db, stub.fetchImpl), stub.fetchImpl)).json();
  assert.equal(body.next_operation, "submit_stage");
  const storedPrep = stored(d1).classifier_prep;
  assert.equal(storedPrep.status, "unavailable");
  assert.equal(storedPrep.usable, false);
  assert.match(storedPrep.reason, /^checksum_not_exposed:/);
  assert.equal(stub.calls.filter((call) => /\/api\/datasets\/[^/]+$/.test(call.url)).length, 1,
    "verification is one dataset-detail GET");
});

test("ADVANCE / classifier_verify marks usable only for a matching provider checksum and size", async () => {
  const prep = { ...QIIME_CLASSIFIER, status: "uploaded", usable: false, dataset_id: CLASSIFIER_DS };
  const s = state({ advance_op: "classifier_verify", classifier_prep: prep });
  const { db, d1 } = seed(s);
  const stub = makeStub();
  const body = await (await advance(db, envFor(db, stub.fetchImpl), stub.fetchImpl)).json();
  assert.equal(body.next_operation, "submit_stage");
  const storedPrep = stored(d1).classifier_prep;
  assert.equal(storedPrep.status, "verified");
  assert.equal(storedPrep.usable, true);
  assert.equal(storedPrep.computed_sha256, QIIME_CLASSIFIER.expected_sha256);
  assert.equal(storedPrep.size_status, "verified");
});

test("ADVANCE / matching SHA-256 with NO reported size keeps classifier unusable; taxonomy is not submitted", async () => {
  const prep = { ...QIIME_CLASSIFIER, status: "uploaded", usable: false, dataset_id: CLASSIFIER_DS };
  const s = state({ advance_op: "classifier_verify", classifier_prep: prep, steps: {
    ...state().steps, taxonomy: {} } });
  const { db, d1 } = seed(s);
  const stub = makeStub({ noSize: true });
  const env = envFor(db, stub.fetchImpl);
  const body = await (await advance(db, env, stub.fetchImpl)).json();
  assert.equal(body.next_operation, "submit_stage");
  const storedPrep = stored(d1).classifier_prep;
  assert.equal(storedPrep.status, "unavailable");
  assert.equal(storedPrep.usable, false);
  assert.equal(storedPrep.computed_sha256, QIIME_CLASSIFIER.expected_sha256,
    "the checksum DID match; size is the failing identity check");
  assert.match(storedPrep.reason, /^size_not_exposed: provider did not report a byte size for dataset /);
  // The next advance runs submit_stage with no usable classifier and no live
  // option, so taxonomy must be refused rather than submitted.
  await advance(db, env, stub.fetchImpl);
  assert.equal(stored(d1).steps.taxonomy.status, "unavailable");
  assert.equal(stub.posts().length, 0, "no classifier or taxonomy job was submitted");
});

test("ADVANCE / matching SHA-256 with a MISMATCHED size keeps classifier unusable", async () => {
  const prep = { ...QIIME_CLASSIFIER, status: "uploaded", usable: false, dataset_id: CLASSIFIER_DS };
  const s = state({ advance_op: "classifier_verify", classifier_prep: prep });
  const { db, d1 } = seed(s);
  const stub = makeStub({ detailSize: QIIME_CLASSIFIER.expected_bytes - 1 });
  await advance(db, envFor(db, stub.fetchImpl), stub.fetchImpl);
  const storedPrep = stored(d1).classifier_prep;
  assert.equal(storedPrep.usable, false);
  assert.match(storedPrep.reason, /^size_mismatch: provider reported \d+ bytes; expected 218245868 bytes/);
});

test("ADVANCE / inventory reuse with a WRONG size is refused; taxonomy is not submitted", async () => {
  const s = state({ advance_op: "classifier_inventory", steps: { ...state().steps, taxonomy: {} } });
  const { db, d1 } = seed(s);
  const stub = makeStub({ classifierSize: QIIME_CLASSIFIER.expected_bytes + 1 });
  const env = envFor(db, stub.fetchImpl);
  const body = await (await advance(db, env, stub.fetchImpl)).json();
  assert.equal(body.next_operation, "submit_stage");
  const storedPrep = stored(d1).classifier_prep;
  assert.equal(storedPrep.status, "unavailable");
  assert.equal(storedPrep.usable, false);
  assert.equal(storedPrep.dataset_id, CLASSIFIER_DS);
  assert.equal(storedPrep.computed_sha256, QIIME_CLASSIFIER.expected_sha256);
  assert.match(storedPrep.reason, /^size_mismatch: provider reported \d+ bytes; expected 218245868 bytes/);
  await advance(db, env, stub.fetchImpl);
  assert.equal(stored(d1).steps.taxonomy.status, "unavailable");
  assert.equal(stub.posts().length, 0, "no taxonomy submission without a verified classifier");
});

test("REGRESSION / intendedExportKind routes the real DADA2 ': table.qza' name", () => {
  assert.equal(intendedExportKind("qiime2 dada2 denoise-single on dataset 5: table.qza"), "feature_table");
  assert.equal(intendedExportKind("feature-table.qza"), "feature_table");
  assert.equal(intendedExportKind("representative_sequences.qza"), "rep_seqs");
  assert.equal(intendedExportKind("denoising_stats.qza"), "qc");
  assert.equal(intendedExportKind("something else.qza"), null);
});

// Live-shaped state: only the two exported TEXT artifacts were recorded, the
// frontier featureTableId is null, and the real table.qza exists only in the
// run's Galaxy history (never in stored state).
function liveShapedState(extra = {}) {
  const textArtifacts = [
    { name: "rep_seqs.fasta", kind: "rep_seqs", dataset_id: "40160950115d555edb600ea9dd17fdb5",
      checksum: "d".repeat(64), bytes: 111618, source_step: "dada2_denoise" },
    { name: "DADA2Stats.tsv", kind: "qc", dataset_id: "40160950115d555eebdabe0cf3c121d3",
      checksum: "a".repeat(64), bytes: 1487, source_step: "dada2_denoise" }
  ];
  return state({ feature_table_recovery: undefined,
    frontier: { demuxReadsId: "55555555555555555555555555555555", repSeqsId: REP_SEQS,
      featureTableId: null },
    steps: { ...state().steps, dada2_denoise: { status: "succeeded",
      provider_job_id: "dada2-job-0001", output_artifacts: textArtifacts } },
    artifacts: textArtifacts,
    ...extra });
}

test("RECOVERY / live-shaped state resolves table.qza from its own history once, refuses a foreign history", async () => {
  const foreign = "99999999999999999999999999999999";
  const s = liveShapedState();
  const { db, d1 } = seed(s);
  const stub = makeStub({ foreignTableId: foreign });
  const env = envFor(db, stub.fetchImpl);
  const summary = await status(db, env, stub.fetchImpl);
  assert.equal(summary.next_operation, "recover_table_reference", "default cursor starts with reference recovery");
  const body = await (await advance(db, env, stub.fetchImpl)).json();
  assert.equal(body.operation, "recover_table_reference");
  assert.equal(body.next_operation, "recover_feature_table");
  const ref = stored(d1).recovered_table_qza;
  assert.equal(ref.id, TABLE_QZA);
  assert.equal(ref.name, "qiime2 dada2 denoise-single on dataset 5: table.qza");
  assert.equal(ref.history_id, HISTORY);
  assert.equal(ref.source_job_id, "dada2-job-0001");
  assert.equal(ref.provenance_match, true);
  assert.equal(ref.checksum, "f".repeat(64));
  assert.notEqual(ref.id, foreign, "a same-named dataset from another history is never selected");
  assert.equal(stored(d1).frontier.featureTableId, null, "reference recovery never sets the frontier");
  assert.equal(stored(d1).recovered_table_qza_attempted, true);
  assert.equal(stub.historyReads(), 1, "exactly one history inventory read");
  assert.equal(stub.posts().length, 0, "no job, upload or export was submitted");
  // The at-most-once guard keeps a replayed cursor from re-reading the history.
  const replay = await (await advance(db, env, stub.fetchImpl, {})).json();
  assert.equal(replay.operation, "recover_feature_table");
  assert.equal(stub.historyReads(), 1);
});

test("RECOVERY / prefers the DADA2-created table.qza over another same-history table.qza", async () => {
  const other = "77777777777777777777777777777777";
  const { db, d1 } = seed(liveShapedState());
  const stub = makeStub({ otherJobTableId: other });
  await advance(db, envFor(db, stub.fetchImpl), stub.fetchImpl);
  const ref = stored(d1).recovered_table_qza;
  assert.equal(ref.id, TABLE_QZA);
  assert.equal(ref.provenance_match, true);
  assert.notEqual(ref.id, other);
  assert.equal(stub.posts().length, 0);
});

test("RECOVERY / no table.qza in the run history fails closed with an exact reason", async () => {
  const { db, d1 } = seed(liveShapedState());
  const stub = makeStub({ noTableQza: true, foreignTableId: "88888888888888888888888888888888" });
  const body = await (await advance(db, envFor(db, stub.fetchImpl), stub.fetchImpl)).json();
  assert.equal(body.next_operation, "poll_current_job");
  const finalState = stored(d1);
  assert.equal(finalState.feature_table_recovery.status, "unavailable");
  assert.match(finalState.feature_table_recovery.reason, /^no_table_qza_in_run_history:/);
  assert.equal(finalState.recovered_table_qza, undefined);
  assert.equal(finalState.frontier.featureTableId, null);
  assert.equal(stub.posts().length, 0, "nothing was guessed or resubmitted");
});

test("ADVANCE / recover_feature_table submits one genuine export for table.qza, never DADA2", async () => {
  const s = state({ advance_op: "recover_feature_table",
    feature_table_recovery: undefined, frontier: { repSeqsId: REP_SEQS } });
  const { db, d1 } = seed(s);
  const stub = makeStub();
  const body = await (await advance(db, envFor(db, stub.fetchImpl), stub.fetchImpl)).json();
  assert.equal(body.next_operation, "poll_exports");
  assert.equal(stub.posts().length, 1, "exactly one export submission");
  const submission = stub.submissions[0].body;
  assert.equal(submission.tool_id, EXPORT_TOOL, "the live discovered export tool id is used");
  assert.deepEqual(submission.inputs, { input: { src: "hda", id: TABLE_QZA } });
  assert.equal(stub.submissions.some((entry) => entry.body.tool_id === DENOISE_TOOL), false,
    "a succeeded DADA2 job is never replayed");
  const recovery = stored(d1).feature_table_recovery;
  assert.equal(recovery.status, "submitted");
  assert.equal(recovery.dataset_id, TABLE_QZA);
  assert.equal(recovery.expected_kind, "feature_table");
  assert.equal(stored(d1).exports[TABLE_QZA].expected_kind, "feature_table");
});

test("ADVANCE / genuine BIOM-v1 text recovery fills the frontier and ASV summary", async () => {
  const s = state({ advance_op: "poll_exports",
    feature_table_recovery: { status: "submitted", dataset_id: TABLE_QZA },
    frontier: { repSeqsId: REP_SEQS }, export_step_id: "dada2_denoise",
    pending_exports: [{ step_id: "dada2_denoise", source_dataset_id: TABLE_QZA,
      expected_kind: "feature_table", provider_job_id: "export-job-0001", tool_id: EXPORT_TOOL }] });
  const { db, d1 } = seed(s);
  const stub = makeStub();
  const first = await (await advance(db, envFor(db, stub.fetchImpl), stub.fetchImpl)).json();
  assert.equal(first.next_operation, "finalize_feature_table");
  assert.ok(stored(d1).artifacts.some((entry) => entry.kind === "feature_table"
    && entry.dataset_id === TABLE_TEXT_DS));
  const second = await (await advance(db, envFor(db, stub.fetchImpl),
    stub.fetchImpl, { })).json();
  assert.equal(second.status, "running");
  const finalState = stored(d1);
  assert.equal(finalState.frontier.featureTableId, TABLE_QZA);
  assert.equal(finalState.results.asv.available, true);
  assert.equal(finalState.results.asv.feature_count, 2);
  assert.equal(finalState.results.asv.sample_count, 2);
  assert.equal(finalState.results.asv.total_assignable_reads, 24);
  assert.match(finalState.results.asv.basis, /parsed_from_genuine_exported_feature_table_text/);
});

test("ADVANCE / unparseable export text fails closed instead of inventing a table", async () => {
  const s = state({ advance_op: "finalize_feature_table", frontier: { repSeqsId: REP_SEQS },
    pending_exports: [], feature_table_recovery: { status: "collected", dataset_id: TABLE_QZA,
      text_dataset_id: TABLE_TEXT_DS },
    artifacts: [{ name: "exported-table.biom", kind: "feature_table",
      dataset_id: TABLE_TEXT_DS, checksum: "e".repeat(64), bytes: 24, source_step: "dada2_denoise" }] });
  const { db, d1 } = seed(s, { artifacts: [{ run_id: RUN, name: "exported-table.biom",
    kind: "feature_table", content: "this is not a feature table", checksum: "e".repeat(64) }] });
  const stub = makeStub({ exportText: "this is not a feature table" });
  await advance(db, envFor(db, stub.fetchImpl), stub.fetchImpl);
  const finalState = stored(d1);
  assert.equal(finalState.frontier.featureTableId, null);
  assert.equal(finalState.results.asv.available, false);
  assert.match(finalState.feature_table_recovery.reason, /^no_parseable_feature_table_text:/);
});

test("ADVANCE / finalize_result is guarded by result_built and saves once", async () => {
  const steps = Object.fromEntries([
    "import_reads", "demux", "qc_summary", "dada2_denoise", "taxonomy", "composition",
    "alpha_diversity", "beta_diversity", "pcoa", "ordination", "report"
  ].map((id) => [id, { status: id === "qc_summary" ? "unavailable" : "succeeded" }]));
  const s = state({ advance_op: "finalize_result", current_step: null, steps,
    results: { asv: { available: false, reason: "no table" } } });
  const { db, d1 } = seed(s);
  const stub = makeStub();
  const first = await (await advance(db, envFor(db, stub.fetchImpl), stub.fetchImpl)).json();
  assert.equal(first.status, "succeeded");
  const once = d1.calls.filter((call) => call.sql === SQL.saveJobResult).length;
  const second = await (await advance(db, envFor(db, stub.fetchImpl), stub.fetchImpl)).json();
  assert.equal(second.status, "succeeded");
  assert.equal(d1.calls.filter((call) => call.sql === SQL.saveJobResult).length, once,
    "result and exports are built at most once");
  assert.equal(stored(d1).result_built, true);
});

test("ADVANCE / checkpoint survives a simulated provider failure with no duplicate submission", async () => {
  const s = state({ advance_op: "submit_one_export", feature_table_recovery: undefined,
    frontier: { repSeqsId: REP_SEQS }, export_step_id: "dada2_denoise",
    finalize_queue: { step_id: "dada2_denoise", job_id: "dada2-job-0001", cursor: 0,
      items: [{ id: TABLE_QZA, name: "qiime2 dada2 denoise-single on dataset 5: table.qza",
        kind: "qza_artifact", extension: "qza", state: "ok", history_id: HISTORY }],
      downloaded: [], errors: [], created_at: "2026-11-27T00:00:00.000Z" },
    exports: { [REP_SEQS]: { expected_kind: "rep_seqs", status: "succeeded" },
      cccccccccccccccccccccccccccccccc: { expected_kind: "qc", status: "succeeded" } },
    export_submissions: { dada2_denoise: { status: "pending", submitted_kinds: [] } } });
  const { db, d1 } = seed(s);
  const stub = makeStub();
  const env = envFor(db, stub.fetchImpl);
  const first = await (await advance(db, env, stub.fetchImpl)).json();
  assert.equal(first.next_operation, "poll_exports");
  assert.equal(stub.posts().length, 1);
  // Second call: the provider is unavailable. The cursor and the already
  // recorded submission checkpoint must both survive without a resubmission.
  stub.setThrowOnJob(true);
  const failed = await (await advance(db, env, stub.fetchImpl)).json();
  assert.equal(failed.status, "running");
  assert.equal(failed.next_operation, "poll_exports", "cursor stays on the interrupted operation");
  assert.equal(stored(d1).advance_op, "poll_exports");
  assert.equal(stored(d1).exports[TABLE_QZA].status, "running");
  // Third call: recovery proceeds from the checkpoint without resubmitting.
  stub.setThrowOnJob(false);
  const third = await (await advance(db, env, stub.fetchImpl)).json();
  assert.equal(third.status, "running");
  assert.equal(stub.posts().length, 1, "the export job was never submitted twice");
  assert.equal(stored(d1).exports[TABLE_QZA].provider_job_id, "export-job-0001");
});

test("ARTIFACT / known dataset streams with no-store headers and no Worker buffering", async () => {
  const s = state();
  const { db } = seed(s);
  const stub = makeStub();
  const response = await artifact(db, envFor(db, stub.fetchImpl), stub.fetchImpl, TABLE_QZA);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.equal(response.headers.get("X-Content-Type-Options"), "nosniff");
  assert.match(response.headers.get("Content-Disposition"), /attachment; filename=".*table\.qza"/);
  assert.equal(response.headers.get("X-Dataset-Id"), TABLE_QZA);
  assert.equal(response.headers.get("X-API-Key"), null, "no upstream key header escapes");
  const text = await response.text();
  assert.equal(text, "streamed-binary-body");
  const contentCalls = stub.calls.filter((call) => call.url.includes("/content"));
  assert.equal(contentCalls.length, 1);
});

test("ARTIFACT / wrong history and unknown datasets are rejected; in-history dataset is allowed", async () => {
  const s = state();
  const { db } = seed(s);
  const foreign = "99999999999999999999999999999999";
  const stub = makeStub({ foreignId: foreign });
  const env = envFor(db, stub.fetchImpl);
  const denied = await artifact(db, env, stub.fetchImpl, foreign);
  assert.equal(denied.status, 403);
  assert.match(await denied.text(), /not owned by this run/);
  const owned = await artifact(db, env, stub.fetchImpl, TABLE_TEXT_DS);
  assert.equal(owned.status, 200, "an unknown-but-in-history dataset is allowed after one lookup");
  await owned.text();
  const wrongRun = await artifact(db, env, stub.fetchImpl, TABLE_QZA, "job_0000000000000000");
  assert.equal(wrongRun.status, 404);
});
