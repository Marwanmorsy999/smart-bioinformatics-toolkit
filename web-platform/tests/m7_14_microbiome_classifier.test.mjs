// M7.14.2 LABELLED, STUBBED CLASSIFIER TESTS — ZERO live calls.
// Every Galaxy route and the classifier URL are answered in memory. No job is
// submitted to a real provider and no large byte stream is fetched from the
// network. Production handlers always use the official QIIME 2 descriptor;
// the small descriptor passed through handleStatus options is an offline seam.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { createAdapter } from "../providers/galaxy/index.js";
import { handleStatus } from "../functions/api/ai/workflows/microbiome/engine.js";
import {
  QIIME_CLASSIFIER, classifierProvenance, inspectClassifierInventory
} from "../functions/api/ai/workflows/microbiome/classifier-prep.js";
import { createSha256, sha256Bytes, verifyRemoteSha256 } from "../functions/api/ai/workflows/microbiome/sha256-stream.js";
import { createFakeD1AI, makeGetRequest, mockAIEnv } from "./helpers/fake-d1.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const fixture = (name) => readFileSync(resolve(HERE, "fixtures/m7_14_microbiome", name), "utf8");

const HISTORY = "11111111111111111111111111111111";
const RUN_ID = "job_a8817e35d7534d98";
const CLASSIFIER_DS = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const REP_SEQS = "13131313131313131313131313131313";
const TAXONOMY_DS = "15151515151515151515151515151515";
const CLASSIFY_TOOL = "toolshed.g2.bx.psu.edu/repos/iuc/qiime2_feature_classifier_classify_sklearn/7+galaxy1";
const TEST_KEY = "stub-key-not-a-real-secret";

const CLASSIFIER_BYTES = new TextEncoder().encode("labelled-offline-classifier-qza-bytes");
const DESCRIPTOR = Object.freeze({
  ...QIIME_CLASSIFIER,
  url: "https://classifier.example.test/silva-138-99-nb-classifier.qza",
  expected_sha256: sha256Bytes(CLASSIFIER_BYTES),
  expected_bytes: CLASSIFIER_BYTES.length
});

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function streamed(bytes, chunkSize = 7) {
  return new Response(new ReadableStream({
    start(controller) {
      for (let offset = 0; offset < bytes.length; offset += chunkSize) {
        controller.enqueue(bytes.subarray(offset, Math.min(offset + chunkSize, bytes.length)));
      }
      controller.close();
    }
  }), { status: 200 });
}

function toolEntry(id, name) {
  return { id, name, version: "2026.1.0", model_class: "Tool", available: true };
}

// The live schema deliberately exposes NO option for the classifier. Its only
// classifier input is a qza DataToolParameter, so the prepared history dataset
// must be used directly rather than skipping taxonomy.
function classifySchema() {
  return { tool_id: CLASSIFY_TOOL, inputs: [
    { model_class: "DataToolParameter", name: "reads", optional: false, extensions: ["fasta"] },
    { model_class: "DataToolParameter", name: "classifier", optional: false, extensions: ["qza"] }
  ] };
}

function makeStub({ inventoryDatasets = [], urlStatus = 200 } = {}) {
  const calls = [];
  const submitted = [];
  let uploaded = false;
  const contents = () => [
    { id: REP_SEQS, name: "rep seqs.fasta", extension: "fasta", state: "ok", history_id: HISTORY },
    ...inventoryDatasets,
    ...(uploaded ? [{ id: CLASSIFIER_DS, name: DESCRIPTOR.filename, extension: "qza", state: "queued", history_id: HISTORY }] : []),
    { id: TAXONOMY_DS, name: "taxonomy.tsv", extension: "tsv", state: "ok", history_id: HISTORY }
  ];
  const fetchImpl = async (input, init = {}) => {
    const url = String(input);
    const method = String(init.method ?? "GET").toUpperCase();
    calls.push({ method, url, init });
    assert.doesNotMatch(url, /blast|iprscan|ncbi|CMD=Put|rid=/i, "no external analysis route may be touched");
    if (url === DESCRIPTOR.url) {
      return urlStatus === 200 ? streamed(CLASSIFIER_BYTES) : json({ error: "unavailable" }, urlStatus);
    }
    if (method === "GET" && /\/api\/histories\?/.test(url)) return json([{ id: HISTORY }]);
    if (method === "GET" && /\/api\/histories\/[^/]+\/contents/.test(url)) return json(contents());
    if (url.includes("/api/tools/fetch")) {
      uploaded = true;
      return json({ outputs: [{ id: CLASSIFIER_DS, history_id: HISTORY }], jobs: [{ id: "url-job-0001" }] });
    }
    if (url.includes("io_details=true")) return json(classifySchema());
    if (url.includes("/api/tools?")) return json([toolEntry(CLASSIFY_TOOL, "qiime2 feature-classifier classify-sklearn")]);
    if (url.includes("/api/workflows")) return json([]);
    if (method === "POST" && url.endsWith("/api/tools")) {
      submitted.push({ url, body: JSON.parse(String(init.body)) });
      return json({ outputs: [{ id: TAXONOMY_DS }], jobs: [{ id: "taxonomy-job-0001" }] });
    }
    if (url.includes("/api/jobs/") && url.includes("/outputs")) {
      return json({ [TAXONOMY_DS]: { id: TAXONOMY_DS, state: "ok" } });
    }
    if (url.includes("/api/jobs/")) return json({ id: "taxonomy-job-0001", state: "ok", history_id: HISTORY });
    if (url.includes("/get_content_as_text")) return json({ item_data: fixture("taxonomy.tsv"), truncated: false });
    return json({ error: "unexpected_stub_route", url }, 404);
  };
  return {
    calls, submitted, fetchImpl,
    urlFetchCount: () => calls.filter((call) => call.url === DESCRIPTOR.url).length,
    uploadCount: () => calls.filter((call) => call.url.includes("/api/tools/fetch")).length,
    classifierSubmission: () => submitted.find((call) => String(call.body?.tool_id).includes("classify_sklearn")) ?? null
  };
}

function stateAtTaxonomy(overrides = {}) {
  return {
    workflow_type: "microbiome", run_id: RUN_ID, plan_id: "plan_a8817e35d7534d98",
    status: "running", current_step: "taxonomy", created_at: "2026-11-27T00:00:00.000Z",
    input_sha256: "a".repeat(64), metadata_sha256: "b".repeat(64),
    input: { mode: "public", source: {}, sample_ids: ["sampleA", "sampleB", "sampleC"], sample_count: 3,
      filenames: { reads: "sequences.fastq.gz", barcodes: "barcodes.fastq.gz", metadata: "sample-metadata.tsv" } },
    params: { trim_left: 0, trunc_len: 120, rarefaction_depth: 1 },
    discovery: { tools: { classify: { id: CLASSIFY_TOOL, name: "qiime2 feature-classifier classify-sklearn", version: "2026.1.0" } },
      // No select option: a prepared qza must still drive taxonomy.
      classifier: { available: false, reason: "No classifier/reference option was exposed by the live tool schema." },
      discovery_mode: "live", discovered_at: "2026-11-27T00:00:00.000Z" },
    dataset_ids: { sequences: "22222222222222222222222222222222", barcodes: "33333333333333333333333333333333",
      metadata: "44444444444444444444444444444444" },
    filenames: { reads: "sequences.fastq.gz", barcodes: "barcodes.fastq.gz", metadata: "sample-metadata.tsv" },
    history_id: HISTORY, frontier: { repSeqsId: REP_SEQS },
    steps: { import_reads: { status: "succeeded" }, demux: { status: "succeeded" },
      qc_summary: { status: "succeeded" }, dada2_denoise: { status: "succeeded" } },
    results: {}, artifacts: [], errors: [], poll_count: 0, exports: {}, pending_exports: [], import: null,
    ...overrides
  };
}

function seededEnv(state, stub) {
  const { db, state: d1 } = createFakeD1AI({ microbiome_runs: [{
    public_id: RUN_ID, input_sha256: state.input_sha256, metadata_sha256: state.metadata_sha256,
    state: "running", plan_id: state.plan_id, run_id: RUN_ID, state_json: JSON.stringify(state),
    result_json: null, created_at: state.created_at, completed_at: null
  }] });
  return { env: { ...mockAIEnv(db), GALAXY_ENABLED: "true", GALAXY_BASE_URL: "https://galaxy.example.test",
    GALAXY_API_KEY: TEST_KEY, FETCH_IMPL: stub.fetchImpl }, db, d1 };
}

// fetchToolSchema uses the ambient fetch, so the offline stub must be installed
// globally around each status request (no live route is reachable).
async function statusRequest(env, stub, options = {}) {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = stub.fetchImpl;
  try {
    const response = await handleStatus(makeGetRequest(`/api/ai/workflows/microbiome/status?run_id=${RUN_ID}`), env,
      { fetchImpl: stub.fetchImpl, classifierDescriptor: DESCRIPTOR, ...options });
    return response.json();
  } finally { globalThis.fetch = previousFetch; }
}
const status = (env, stub, options = {}) => statusRequest(env, stub, options);

test("STREAMING SHA-256 / official vectors are reproduced across chunk boundaries", () => {
  const vectors = new Map([
    ["", "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"],
    ["abc", "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"],
    ["hello world", "b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9"]
  ]);
  for (const [text, expected] of vectors) {
    const bytes = new TextEncoder().encode(text);
    for (const chunk of [1, 3, 17, 64, 65, 1024]) {
      const hasher = createSha256();
      for (let offset = 0; offset < bytes.length; offset += chunk) {
        hasher.update(bytes.subarray(offset, Math.min(offset + chunk, bytes.length)));
      }
      assert.equal(hasher.digest(), expected, `vector "${text}" at chunk ${chunk}`);
    }
    assert.equal(sha256Bytes(bytes), expected);
  }
  const megabyte = new Uint8Array(1024 * 1024).fill(97);
  const hasher = createSha256();
  for (let offset = 0; offset < megabyte.length; offset += 7919) {
    hasher.update(megabyte.subarray(offset, Math.min(offset + 7919, megabyte.length)));
  }
  assert.equal(hasher.bytes, megabyte.length);
  assert.match(hasher.digest(), /^[0-9a-f]{64}$/);
  // digest() is repeatable and does not destroy an in-flight stream.
  assert.equal(hasher.digest(), hasher.digest());
});

test("ADAPTER / URL import posts the exact url element into the existing history, no file part", async () => {
  const calls = [];
  const fetchImpl = async (input, init = {}) => {
    calls.push({ url: String(input), init });
    if (String(input).includes("/api/tools/fetch")) {
      return json({ outputs: [{ id: CLASSIFIER_DS, history_id: HISTORY }], jobs: [{ id: "url-job-0001" }] });
    }
    return json({}, 404);
  };
  const adapter = createAdapter({ GALAXY_ENABLED: "true", GALAXY_BASE_URL: "https://galaxy.example.test",
    GALAXY_API_KEY: TEST_KEY });
  const result = await adapter.importUrlIntoHistory({
    url: DESCRIPTOR.url, name: DESCRIPTOR.filename, ext: "qza", history_id: HISTORY
  }, { fetch: fetchImpl });
  assert.equal(result.ok, true);
  assert.equal(result.dataset_id, CLASSIFIER_DS);
  assert.equal(result.job_id, "url-job-0001");
  assert.equal(result.history_id, HISTORY);
  const posts = calls.filter((call) => call.url.includes("/api/tools/fetch"));
  assert.equal(posts.length, 1);
  const form = posts[0].init.body;
  assert.ok(form instanceof FormData);
  assert.equal(form.get("history_id"), HISTORY);
  assert.deepEqual(JSON.parse(form.get("targets")), [{ destination: { type: "hdas" },
    elements: [{ src: "url", url: DESCRIPTOR.url, name: DESCRIPTOR.filename, ext: "qza" }] }]);
  assert.deepEqual(form.getAll("files"), [], "no Blob/file part may be created for a URL import");
  assert.equal(calls.some((call) => call.url.endsWith("/api/histories") && call.init.method === "POST"), false,
    "an existing history must never be recreated");
  assert.doesNotMatch(JSON.stringify(result), new RegExp(TEST_KEY));
});

test("ADAPTER / URL import refuses a missing history or a non-http URL before any fetch", async () => {
  let fetched = 0;
  const adapter = createAdapter({ GALAXY_ENABLED: "true", GALAXY_BASE_URL: "https://galaxy.example.test",
    GALAXY_API_KEY: TEST_KEY });
  const fetchImpl = async () => { fetched += 1; return json({}); };
  const noHistory = await adapter.importUrlIntoHistory({ url: DESCRIPTOR.url, name: "x.qza" }, { fetch: fetchImpl });
  assert.equal(noHistory.ok, false);
  assert.equal(noHistory.error.code, "history_id_required");
  const badUrl = await adapter.importUrlIntoHistory({ url: "javascript:alert(1)", name: "x.qza",
    history_id: HISTORY }, { fetch: fetchImpl });
  assert.equal(badUrl.ok, false);
  assert.equal(badUrl.error.code, "invalid_url");
  assert.equal(fetched, 0);
});

test("VERIFY / checksum and size mismatches record an exact reason and never authorize upload", async () => {
  const wrongSha = "0".repeat(64);
  const mismatch = await verifyRemoteSha256(async () => streamed(CLASSIFIER_BYTES), DESCRIPTOR.url,
    { expected_sha256: wrongSha, expected_bytes: CLASSIFIER_BYTES.length });
  assert.equal(mismatch.ok, false);
  assert.match(mismatch.reason, /^checksum_mismatch: computed [0-9a-f]{64}; expected 0{64}; no upload was attempted$/);
  assert.equal(mismatch.computed_sha256, DESCRIPTOR.expected_sha256);
  const wrongSize = await verifyRemoteSha256(async () => streamed(CLASSIFIER_BYTES), DESCRIPTOR.url,
    { expected_sha256: DESCRIPTOR.expected_sha256, expected_bytes: CLASSIFIER_BYTES.length + 1 });
  assert.equal(wrongSize.ok, false);
  assert.match(wrongSize.reason, /^size_mismatch: streamed \d+ bytes; expected \d+ bytes; no upload was attempted$/);
  const fetchFailed = await verifyRemoteSha256(async () => { throw new Error("offline"); }, DESCRIPTOR.url,
    { expected_sha256: DESCRIPTOR.expected_sha256, expected_bytes: CLASSIFIER_BYTES.length });
  assert.equal(fetchFailed.ok, false);
  assert.match(fetchFailed.reason, /^fetch_failed: Error: offline$/);
});

test("PROVENANCE / official descriptor is exact and names no other SILVA release", () => {
  assert.equal(QIIME_CLASSIFIER.url, "https://data.qiime2.org/classifiers/sklearn-1.4.2/silva/silva-138-99-nb-classifier.qza");
  assert.equal(QIIME_CLASSIFIER.expected_sha256, "c08a1aa4d56b449b511f7215543a43249ae9c54b57491428a7e5548a62613616");
  assert.equal(QIIME_CLASSIFIER.expected_bytes, 218245868);
  const provenance = classifierProvenance();
  assert.equal(provenance.identity, "Silva 138 99% OTUs full-length sequences");
  assert.match(provenance.classifier_kind, /sklearn 1\.4\.2/);
  assert.match(provenance.compatible_qiime2, /2024\.5–2026\.1/);
  assert.doesNotMatch(JSON.stringify(provenance), /SILVA 144|silva-144/i);
  assert.ok(provenance.limitations.some((item) => /F515–R806/.test(item) && /full-length/.test(item)));
  assert.ok(provenance.limitations.some((item) => /Species-level/.test(item)));
});

test("INVENTORY REUSE / verified qza is reused with no URL fetch and no upload", async () => {
  const dataset = { id: CLASSIFIER_DS, name: DESCRIPTOR.filename, extension: "qza", state: "ok",
    history_id: HISTORY, checksum: `sha256$${DESCRIPTOR.expected_sha256}`,
    file_size: DESCRIPTOR.expected_bytes };
  const stub = makeStub({ inventoryDatasets: [dataset] });
  const { env, d1 } = seededEnv(stateAtTaxonomy(), stub);
  await status(env, stub);
  assert.equal(stub.urlFetchCount(), 0, "reuse must never download the classifier");
  assert.equal(stub.uploadCount(), 0, "reuse must never upload");
  const stored = JSON.parse(d1.tables.microbiome_runs[0].state_json);
  assert.equal(stored.classifier_prep.status, "reused");
  assert.equal(stored.classifier_prep.dataset_id, CLASSIFIER_DS);
  assert.equal(stored.classifier_prep.computed_sha256, DESCRIPTOR.expected_sha256);
  assert.ok(stub.classifierSubmission(), "taxonomy must still be submitted");
});

test("SINGLE URL IMPORT / no Worker-side stream or hash; one import into the existing history", async () => {
  const stub = makeStub();
  const { env, d1 } = seededEnv(stateAtTaxonomy(), stub);
  const body = await status(env, stub);
  // CPU-safety contract: the 218 MB classifier is never fetched or hashed in
  // a Worker request. Galaxy imports it by URL; verification is a later,
  // bounded dataset-detail read (classifier_verify).
  assert.equal(stub.urlFetchCount(), 0, "the Worker must never stream the classifier URL");
  assert.equal(stub.uploadCount(), 1);
  const stored = JSON.parse(d1.tables.microbiome_runs[0].state_json);
  assert.equal(stored.classifier_prep.status, "uploaded");
  assert.equal(stored.classifier_prep.usable, false);
  assert.equal(stored.classifier_prep.dataset_id, CLASSIFIER_DS);
  assert.equal(stored.classifier_prep.job_id, "url-job-0001");
  assert.equal(stored.classifier_prep.history_id, HISTORY);
  assert.equal(stored.classifier_prep.computed_sha256, null);
  assert.equal(stored.classifier_prep.expected_bytes, DESCRIPTOR.expected_bytes);
  assert.match(stored.classifier_prep.reason, /provider_checksum_verification_pending/);
  const form = stub.calls.find((call) => call.url.includes("/api/tools/fetch")).init.body;
  assert.deepEqual(JSON.parse(form.get("targets"))[0].elements[0],
    { src: "url", url: DESCRIPTOR.url, name: DESCRIPTOR.filename, ext: "qza" });
  assert.equal(form.get("history_id"), HISTORY);
  assert.equal(body.status, "running");
});

test("NO DUPLICATE PREP / repeated status never downloads or re-imports the classifier", async () => {
  const stub = makeStub();
  const { env, d1 } = seededEnv(stateAtTaxonomy(), stub);
  await status(env, stub);
  await status(env, stub);
  await status(env, stub);
  assert.equal(stub.urlFetchCount(), 0, "no Worker-side classifier download, ever");
  assert.equal(stub.uploadCount(), 1, "exactly one URL import");
  const stored = JSON.parse(d1.tables.microbiome_runs[0].state_json);
  assert.equal(stored.classifier_prep.attempts, 1);
  assert.equal(stored.classifier_prep.status, "uploaded");
});

test("TAXONOMY PAYLOAD / reads and classifier ids come from the live schema with no select option", async () => {
  const stub = makeStub();
  const { env, d1 } = seededEnv(stateAtTaxonomy(), stub);
  await status(env, stub);
  // A URL import alone is NOT usable. Simulate the bounded provider checksum
  // verification before taxonomy is allowed to consume the dataset id.
  const stored = JSON.parse(d1.tables.microbiome_runs[0].state_json);
  stored.classifier_prep.usable = true;
  stored.classifier_prep.status = "verified";
  stored.steps.taxonomy = {};
  stored.current_step = "taxonomy";
  d1.tables.microbiome_runs[0].state_json = JSON.stringify(stored);
  await status(env, stub);
  const submission = stub.classifierSubmission();
  assert.ok(submission, "taxonomy must be submitted without a select option");
  const inputs = submission.body.inputs;
  assert.deepEqual(inputs.reads, { src: "hda", id: REP_SEQS });
  assert.deepEqual(inputs.classifier, { src: "hda", id: CLASSIFIER_DS });
});

test("NO WORKER HASH / a mismatched descriptor never triggers a remote download", async () => {
  const stub = makeStub();
  const { env, d1 } = seededEnv(stateAtTaxonomy(), stub);
  // The old path streamed and hashed the classifier before importing it. That
  // CPU-heavy path is gone: no descriptor can make the Worker download bytes.
  const badDescriptor = { ...DESCRIPTOR, expected_sha256: "0".repeat(64) };
  await statusRequest(env, stub, { classifierDescriptor: badDescriptor });
  assert.equal(stub.urlFetchCount(), 0, "no Worker-side stream, regardless of descriptor");
  assert.equal(stub.uploadCount(), 1, "the single URL import is still made by Galaxy");
  const stored = JSON.parse(d1.tables.microbiome_runs[0].state_json);
  assert.equal(stored.classifier_prep.usable, false, "never usable before provider verification");
  assert.match(stored.classifier_prep.download.reason, /worker_side_stream_and_hash_removed/);
});

test("INVENTORY HELPER / missing or mismatched checksums are never treated as verified", () => {
  const missing = { ok: true, datasets: [{ id: "x", name: DESCRIPTOR.filename, state: "ok", history_id: HISTORY }] };
  assert.equal(inspectClassifierInventory(missing, HISTORY, DESCRIPTOR).verified, null);
  const mismatch = { ok: true, datasets: [{ id: "x", name: DESCRIPTOR.filename, state: "ok",
    history_id: HISTORY, checksum: "0".repeat(64) }] };
  const inspected = inspectClassifierInventory(mismatch, HISTORY, DESCRIPTOR);
  assert.equal(inspected.verified, null);
  assert.equal(inspected.candidates[0].reason, "checksum_mismatch");
  const otherHistory = { ok: true, datasets: [{ id: "x", name: DESCRIPTOR.filename, state: "ok",
    history_id: "ffffffffffffffffffffffffffffffff", checksum: DESCRIPTOR.expected_sha256 }] };
  assert.equal(inspectClassifierInventory(otherHistory, HISTORY, DESCRIPTOR).verified, null);
});
