// M7.14.1 LABELLED STUBBED RETRY TESTS — ZERO live calls.
//
// Every Galaxy route and every public re-fetch is answered in-memory. No job is
// submitted to a real provider, no public URL is fetched and no credential is
// logged. The retry endpoint must recover the SAME upload-only failed run.
import test from "node:test";
import assert from "node:assert/strict";
import { hashInput, parseJson } from "../functions/api/ai/_lib.js";
import { handleRetry, handleRun } from "../functions/api/ai/workflows/microbiome/engine.js";
import { PUBLIC_DATASETS } from "../public/js/microbiome-zip.js";
import { createFakeD1AI, makePostRequest, mockAIEnv } from "./helpers/fake-d1.mjs";

const DESCRIPTOR = PUBLIC_DATASETS["moving-pictures-2026.10"];
const RUN_ID = "job_a8817e35d7534d98";
const HISTORY = "22222222222222222222222222222222";
const INPUT_SHA = await hashInput(`${DESCRIPTOR.expected_reads_sha256}:${DESCRIPTOR.expected_barcodes_sha256}`);
const RETRY_PATH = "/api/ai/workflows/microbiome/retry";

const IDS = Object.freeze({
  reads: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  barcodes: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
  metadata: "cccccccccccccccccccccccccccccccc",
  demuxTool: "toolshed.g2.bx.psu.edu/repos/iuc/qiime2_demux_emp_single/7+galaxy1",
  qcTool: "toolshed.g2.bx.psu.edu/repos/iuc/qiime2_vsearch_fastq_stats/7+galaxy1",
  denoiseTool: "toolshed.g2.bx.psu.edu/repos/iuc/qiime2_dada2_denoise_single/7+galaxy1",
  classifyTool: "toolshed.g2.bx.psu.edu/repos/iuc/qiime2_feature_classifier_classify_sklearn/7+galaxy1",
  alphaTool: "toolshed.g2.bx.psu.edu/repos/iuc/qiime2_diversity_alpha/7+galaxy1",
  betaTool: "toolshed.g2.bx.psu.edu/repos/iuc/qiime2_diversity_beta/7+galaxy1",
  pcoaTool: "toolshed.g2.bx.psu.edu/repos/iuc/qiime2_emperor_plot/7+galaxy1"
});

function json(body, status = 200, requestId = null) {
  const headers = { "Content-Type": "application/json" };
  if (requestId) headers["X-Request-Id"] = requestId;
  return new Response(JSON.stringify(body), { status, headers });
}

function toolEntry(id, name, description) {
  return { id, name, description, version: "2026.1.0", model_class: "Tool", available: true };
}

const TOOLS = [
  toolEntry(IDS.demuxTool, "qiime2 demux emp-single", "Demultiplex single-end EMP sequencing reads with barcodes"),
  toolEntry(IDS.qcTool, "qiime2 vsearch fastq-stats", "Quality statistics for FASTQ data"),
  toolEntry(IDS.denoiseTool, "qiime2 dada2 denoise-single", "Denoise single-end reads with DADA2"),
  toolEntry(IDS.classifyTool, "qiime2 feature-classifier classify-sklearn", "Assign taxonomy with a trained classifier"),
  toolEntry(IDS.alphaTool, "qiime2 diversity alpha", "Compute alpha diversity"),
  toolEntry(IDS.betaTool, "qiime2 diversity beta", "Compute beta distance matrix"),
  toolEntry(IDS.pcoaTool, "qiime2 emperor plot", "Emperor ordination visualization")
];

function schemaFor(url) {
  const data = (name, extensions) => ({ model_class: "DataToolParameter", name, optional: false, extensions });
  if (url.includes(encodeURIComponent(IDS.classifyTool))) {
    return { tool_id: IDS.classifyTool, inputs: [data("sequences", ["fasta"]), {
      model_class: "DataToolParameter", name: "classifier", optional: false, extensions: ["qza"],
      options: [{ value: "silva-138-99-515-806-nb-classifier.qza", label: "SILVA 138 99% 515-806 Naive Bayes classifier" }]
    }] };
  }
  return { tool_id: "stub", inputs: [data("input", ["fastq"])] };
}

function makeStub({ histories = [], datasetsByHistory = {}, uploadStatus = 200,
  uploadRequestId = null, uploadError = null } = {}) {
  const calls = [];
  const fetchImpl = async (input, init = {}) => {
    const url = String(input);
    const method = String(init.method ?? "GET").toUpperCase();
    calls.push({ method, url });
    assert.doesNotMatch(url, /blast|iprscan|ncbi|CMD=Put|rid=/i, "no external analysis job may be touched by M7.14.1 tests");
    if (method === "GET" && /\/api\/histories\?/.test(url)) return json(histories);
    if (method === "GET" && /\/api\/histories\/[^/]+\/contents/.test(url)) {
      const id = decodeURIComponent(url.slice(url.lastIndexOf("/histories/") + 11).split("/")[0]);
      return json(datasetsByHistory[id] ?? []);
    }
    if (method === "POST" && /\/api\/histories\/?$/.test(url)) return json({ id: HISTORY });
    if (url.includes("/api/tools/fetch")) {
      if (uploadError) return json({ error: uploadError }, uploadStatus, uploadRequestId);
      return json({ outputs: [{ id: IDS.reads, history_id: HISTORY }], jobs: [{ id: "uploadjob00000001" }] });
    }
    if (url.includes("io_details=true")) return json(schemaFor(url));
    if (url.includes("/api/tools?") || url.endsWith("/api/tools")) return json(TOOLS);
    if (url.includes("/api/workflows")) return json([]);
    return json({ error: "unexpected_stub_route", url }, 404);
  };
  return {
    fetchImpl, calls,
    // One submitJob == one POST /api/histories (ensureHistory). The adapter's
    // own bounded HTTP retry of a failed fetch stays inside that one submit.
    submitCount: () => calls.filter((call) => call.method === "POST" && /\/api\/histories\/?$/.test(call.url)).length,
    uploadCount: () => calls.filter((call) => call.url.includes("/api/tools/fetch")).length,
    inventoryCount: () => calls.filter((call) => /\/api\/histories\?/.test(call.url)).length,
    publicFetchCount: () => calls.filter((call) => /qiime2\.org|readthedocs\.io/.test(call.url)).length
  };
}

// Production resolves the original gzip bytes from the verified public URLs.
// This seam injects the identical three-file payload offline; the guards and
// the single-upload behaviour under test are unchanged.
const STUB_RESOLVE = async () => ({
  reads_filename: "sequences.fastq.gz", barcodes_filename: "barcodes.fastq.gz",
  metadata_filename: "sample-metadata.tsv",
  reads_bytes: new TextEncoder().encode("stubbed-original-reads-gzip"),
  barcodes_bytes: new TextEncoder().encode("stubbed-original-barcodes-gzip"),
  metadata_text: "sample-id\tbarcode-sequence\nsampleA\tACCGCACTT\n"
});

function failedState(overrides = {}) {
  return {
    workflow_type: "microbiome", run_id: RUN_ID, plan_id: "plan_a8817e35d7534d98",
    status: "failed", created_at: "2026-11-27T00:00:00.000Z", current_step: "import_reads",
    input_sha256: INPUT_SHA, metadata_sha256: DESCRIPTOR.expected_metadata_sha256,
    // Realistic stored state: handleRun never writes input.public_dataset.
    input: {
      mode: "public",
      source: {
        urls: { metadata: DESCRIPTOR.metadata_url, reads: DESCRIPTOR.reads_url,
          barcodes: DESCRIPTOR.barcodes_url, sequences_zip: DESCRIPTOR.zip_provenance.url },
        checksums: { metadata_sha256: DESCRIPTOR.expected_metadata_sha256,
          reads_sha256: DESCRIPTOR.expected_reads_sha256,
          barcodes_sha256: DESCRIPTOR.expected_barcodes_sha256,
          zip_sha256_reference: DESCRIPTOR.zip_provenance.sha256 }
      },
      filenames: { reads: "sequences.fastq.gz", barcodes: "barcodes.fastq.gz", metadata: "sample-metadata.tsv" },
      sample_count: 34
    },
    params: { trim_left: 0, trunc_len: 120 },
    discovery: { tools: { demux: null, qc: null, denoise: null, classify: null, alpha: null, beta: null, pcoa: null },
      classifier: { available: false, reason: "Galaxy was unavailable during the original run." },
      discovery_mode: "unavailable", discovered_at: null },
    dataset_ids: { sequences: null, barcodes: null, metadata: null },
    filenames: { reads: "sequences.fastq.gz", barcodes: "barcodes.fastq.gz", metadata: "sample-metadata.tsv" },
    history_id: null, frontier: {}, steps: {}, results: {}, artifacts: [],
    errors: ["upload_failed: galaxy returned HTTP 502"], poll_count: 0, retry_count: 0,
    ...overrides
  };
}

function seededDb(state) {
  return createFakeD1AI({ microbiome_runs: [{
    public_id: RUN_ID, input_sha256: INPUT_SHA, metadata_sha256: DESCRIPTOR.expected_metadata_sha256,
    state: state.status, plan_id: state.plan_id, run_id: RUN_ID, state_json: JSON.stringify(state),
    result_json: null, created_at: state.created_at, completed_at: "2026-11-27T00:01:00.000Z"
  }] });
}

function envFor(db, stub) {
  return { ...mockAIEnv(db), GALAXY_ENABLED: "true", GALAXY_BASE_URL: "https://galaxy.example.test",
    GALAXY_API_KEY: "stub-secret", FETCH_IMPL: stub.fetchImpl };
}

function retryRequest() {
  return makePostRequest({ run_id: RUN_ID }, RETRY_PATH);
}

function retryOptions(stub) {
  return { fetchImpl: stub.fetchImpl, resolvePublicImpl: STUB_RESOLVE, sleep: () => {} };
}

function matchingDataset(name, checksum, id) {
  return { id, name, state: "ok", extension: name.endsWith(".gz") ? "fastq.gz" : "tsv",
    checksum: `sha256$${checksum}`, history_id: HISTORY, file_size: 1024 };
}

const ALL_DATASETS = [
  matchingDataset("sequences.fastq.gz", DESCRIPTOR.expected_reads_sha256, "d0000000000000000000000000000001"),
  matchingDataset("barcodes.fastq.gz", DESCRIPTOR.expected_barcodes_sha256, "d0000000000000000000000000000002"),
  matchingDataset("sample-metadata.tsv", DESCRIPTOR.expected_metadata_sha256, "d0000000000000000000000000000003")
];

async function withStub(stub, run) {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = stub.fetchImpl;
  try { return await run(); } finally { globalThis.fetch = previousFetch; }
}

test("LABELLED STUB / upload-only retry: one submit, running state, live discovery, no stage claimed", async () => {
  const stub = makeStub({ histories: [] });
  const { db, state: d1 } = seededDb(failedState());
  await withStub(stub, async () => {
    const response = await handleRetry(retryRequest(), envFor(db, stub), retryOptions(stub));
    assert.equal(response.status, 202);
    const body = await response.json();
    assert.equal(body.workflow_type, "microbiome");
    assert.equal(body.run_id, RUN_ID);
    assert.equal(body.retried, true);
    assert.equal(body.status, "running");
    assert.equal(body.current_step, "import_reads");
    assert.equal(body.retry_count, 1);
    assert.equal(body.recovery_path, "upload_retry");
    assert.equal(body.history_id, HISTORY);
    assert.equal(body.status_url, `/api/ai/workflows/microbiome/status?run_id=${RUN_ID}`);
    assert.equal(body.result_url, `/api/ai/workflows/microbiome/result?run_id=${RUN_ID}`);
    assert.equal(body.recovery_url, `/api/ai/runs/${RUN_ID}/recovery`);
    assert.equal(stub.submitCount(), 1, "exactly one upload retry submission");
    assert.equal(stub.inventoryCount(), 1, "inventory runs before upload");
    assert.equal(stub.publicFetchCount(), 0, "no live public URL was fetched");
    assert.equal(body.tool_versions.demux.id, IDS.demuxTool);
    assert.equal(body.tool_versions.denoise.version, "2026.1.0");
    assert.equal(body.classifier.available, true);
    assert.match(body.classifier.option_label, /SILVA 138/);
    assert.equal(body.discovery_error, null);
    assert.deepEqual(d1.tables.microbiome_runs.length, 1, "the SAME run is resumed, never recreated");

    const stored = parseJson(d1.tables.microbiome_runs[0].state_json);
    assert.equal(stored.status, "running");
    assert.equal(stored.steps.import_reads.status, "running", "import completion stays with bounded /status");
    assert.equal(stored.steps.import_reads.provider_job_id, "uploadjob00000001");
    assert.equal(Object.values(stored.steps).filter((step) => step.status === "succeeded").length, 0,
      "no scientific stage is claimed by the retry");
    assert.equal(stored.errors.some((entry) => String(entry).includes("upload_failed")), false);
    assert.equal(stored.discovery.tools.demux.id, IDS.demuxTool);
    assert.equal(stored.upload_retry.outcome, "upload_succeeded");
  });
});

test("LABELLED STUB / existing-dataset reuse: matching inventory skips upload entirely", async () => {
  const stub = makeStub({ histories: [{ id: HISTORY }], datasetsByHistory: { [HISTORY]: ALL_DATASETS } });
  const { db, state: d1 } = seededDb(failedState());
  await withStub(stub, async () => {
    const response = await handleRetry(retryRequest(), envFor(db, stub), retryOptions(stub));
    assert.equal(response.status, 202);
    const body = await response.json();
    assert.equal(body.recovery_path, "reuse_existing_upload");
    assert.equal(body.upload_retry.outcome, "reuse_existing_upload");
    assert.equal(stub.submitCount(), 0, "no upload was submitted");
    assert.equal(stub.uploadCount(), 0);
    assert.equal(stub.inventoryCount(), 1);
    assert.equal(stub.publicFetchCount(), 0);
    assert.deepEqual(body.dataset_ids, { sequences: ALL_DATASETS[0].id,
      barcodes: ALL_DATASETS[1].id, metadata: ALL_DATASETS[2].id });
    assert.equal(body.history_id, HISTORY);
    assert.equal(body.retry_count, 1);
    assert.equal(body.tool_versions.classify.id, IDS.classifyTool);
    const stored = parseJson(d1.tables.microbiome_runs[0].state_json);
    assert.equal(stored.steps.import_reads.status, "succeeded");
    assert.equal(stored.steps.import_reads.provider_job_id, null);
    assert.match(stored.steps.import_reads.note, /reuse_existing_upload/);
    assert.deepEqual(stored.dataset_ids, body.dataset_ids);
    assert.equal(stored.errors.some((entry) => String(entry).includes("upload_failed")), false);
  });
});

test("LABELLED STUB / second retry refused: retry_count blocks a second upload", async () => {
  const stub = makeStub({ histories: [] });
  const { db } = seededDb(failedState());
  await withStub(stub, async () => {
    const first = await handleRetry(retryRequest(), envFor(db, stub), retryOptions(stub));
    assert.equal(first.status, 202);
    const second = await handleRetry(retryRequest(), envFor(db, stub), retryOptions(stub));
    assert.equal(second.status, 409);
    const body = await second.json();
    assert.equal(body.reason, "retry_limit_reached");
    assert.equal(body.retried, false);
    assert.equal(body.retry_count, 1);
    assert.equal(stub.submitCount(), 1, "no second upload submission");
    assert.equal(stub.uploadCount(), 1);
    assert.equal(stub.inventoryCount(), 1, "guards run before a second inventory");
  });
});

test("LABELLED STUB / refusal when a provider job exists: no upload, no inventory guess", async () => {
  const stub = makeStub({ histories: [{ id: HISTORY }], datasetsByHistory: { [HISTORY]: ALL_DATASETS } });
  const state = failedState({ steps: { demux: { status: "running", provider_job_id: "job-existing" } } });
  const { db } = seededDb(state);
  await withStub(stub, async () => {
    const response = await handleRetry(retryRequest(), envFor(db, stub), retryOptions(stub));
    assert.equal(response.status, 409);
    const body = await response.json();
    assert.equal(body.reason, "provider_job_exists");
    assert.match(body.detail, /demux/);
    assert.equal(stub.submitCount(), 0);
    assert.equal(stub.uploadCount(), 0);
    assert.equal(stub.inventoryCount(), 0, "a guard refusal is strictly read-only");
  });
});

test("LABELLED STUB / Galaxy 502 classification: real status, error and request id survive; HTTP 502", async () => {
  const stub = makeStub({ histories: [], uploadStatus: 502, uploadError: "upstream_unavailable",
    uploadRequestId: "req_stub_502" });
  const { db, state: d1 } = seededDb(failedState());
  await withStub(stub, async () => {
    const response = await handleRetry(retryRequest(), envFor(db, stub), retryOptions(stub));
    assert.equal(response.status, 502);
    const body = await response.json();
    assert.match(body.error, /HTTP 502/, "the real upstream status is preserved");
    assert.match(body.error, /upstream_unavailable/, "the real upstream error is preserved");
    assert.equal(body.upload_retry.outcome, "upload_failed");
    assert.equal(body.upload_retry.error_status, 502);
    assert.equal(body.upload_retry.error_code, "upstream_unavailable");
    assert.equal(body.upload_retry.request_id_if_supplied, "req_stub_502");
    assert.equal(body.retry_count, 1, "single-use: no automatic second attempt");
    assert.equal(stub.submitCount(), 1, "no endpoint switching and no second submitJob");
    assert.equal(stub.publicFetchCount(), 0);
    const stored = parseJson(d1.tables.microbiome_runs[0].state_json);
    assert.equal(stored.status, "failed");
    assert.equal(stored.retry_count, 1);
    assert.equal(stored.upload_retry.error_status, 502);
    assert.equal(stored.upload_retry.request_id_if_supplied, "req_stub_502");
    const second = await handleRetry(retryRequest(), envFor(db, stub), retryOptions(stub));
    assert.equal(second.status, 409);
    assert.equal(stub.submitCount(), 1);
  });
});

test("LABELLED STUB / partial upload state: no duplicate upload, honest refusal", async () => {
  const partial = ALL_DATASETS.slice(0, 2);
  const stub = makeStub({ histories: [{ id: HISTORY }], datasetsByHistory: { [HISTORY]: partial } });
  const { db, state: d1 } = seededDb(failedState());
  await withStub(stub, async () => {
    const response = await handleRetry(retryRequest(), envFor(db, stub), retryOptions(stub));
    assert.equal(response.status, 409);
    const body = await response.json();
    assert.equal(body.reason, "partial_existing_upload");
    assert.equal(stub.submitCount(), 0, "no upload may duplicate the partial state");
    assert.equal(stub.uploadCount(), 0);
    assert.equal(stub.inventoryCount(), 1);
    const stored = parseJson(d1.tables.microbiome_runs[0].state_json);
    assert.equal(stored.upload_retry.outcome, "partial_existing_upload");
    assert.deepEqual(stored.dataset_ids, { sequences: null, barcodes: null, metadata: null });
    assert.equal(stored.status, "failed");
    assert.equal(stored.retry_count, 0, "no retry was actually performed");
    assert.match(stored.upload_retry.note, /no upload was attempted/);
    assert.ok(body.detail.matched[0].missing_roles.includes("metadata"));
  });
});

test("LABELLED STUB / stored state WITHOUT public_dataset: exact URLs/checksums/filenames/hashes are sufficient", async () => {
  const state = failedState();
  assert.equal("public_dataset" in state.input, false,
    "handleRun never stores input.public_dataset; the fixture must mirror the real stored run");
  const stub = makeStub({ histories: [] });
  const { db, state: d1 } = seededDb(state);
  await withStub(stub, async () => {
    const response = await handleRetry(retryRequest(), envFor(db, stub), retryOptions(stub));
    assert.equal(response.status, 202, JSON.stringify(await response.clone().json()));
    const body = await response.json();
    assert.equal(body.retry_count, 1);
    assert.equal(body.recovery_path, "upload_retry");
    assert.equal(stub.submitCount(), 1, "the single retry proceeds");
    assert.equal(stub.inventoryCount(), 1);
    const stored = parseJson(d1.tables.microbiome_runs[0].state_json);
    assert.equal(stored.status, "running");
    assert.equal(stored.upload_retry.outcome, "upload_succeeded");
  });
});

test("LABELLED STUB / guard matrix: every non-upload-only state is refused with a precise reason", async () => {
  const base = failedState();
  const cases = [
    [{ status: "running" }, "status_not_failed"],
    [{ errors: ["provider job ended in state error"] }, "not_upload_failure"],
    [{ history_id: HISTORY }, "history_id_present"],
    [{ artifacts: [{ name: "feature-table.tsv", checksum: "a".repeat(64) }] }, "artifacts_present"],
    [{ input: { ...base.input, mode: "upload" } }, "not_original_public_source"],
    // Optional public_dataset context, when present, must name the same source.
    [{ input: { ...base.input, public_dataset: "some-other-dataset" } }, "not_original_public_source"],
    // The three URLs, three checksums and three filenames stay strictly verified.
    [{ input: { ...base.input, source: { ...base.input.source,
      urls: { ...base.input.source.urls, reads: "https://other.example.test/sequences.fastq.gz" } } } },
    "not_original_public_source"],
    [{ input: { ...base.input, source: { ...base.input.source,
      checksums: { ...base.input.source.checksums, reads_sha256: "f".repeat(64) } } } },
    "not_original_public_source"],
    [{ filenames: { ...base.filenames, reads: "other.fastq.gz" } }, "not_original_public_source"],
    [{ input_sha256: "f".repeat(64) }, "input_hash_mismatch"],
    [{ metadata_sha256: "f".repeat(64) }, "input_hash_mismatch"],
    [{ retry_count: 1 }, "retry_limit_reached"]
  ];
  for (const [overrides, reason] of cases) {
    const stub = makeStub({ histories: [] });
    const { db } = seededDb(failedState(overrides));
    await withStub(stub, async () => {
      const response = await handleRetry(retryRequest(), envFor(db, stub), retryOptions(stub));
      assert.equal(response.status, 409, reason);
      const body = await response.json();
      assert.equal(body.reason, reason, JSON.stringify(body));
      assert.equal(stub.submitCount(), 0, `${reason} must never upload`);
      assert.equal(stub.uploadCount(), 0);
      assert.equal(stub.inventoryCount(), 0, `${reason} must be caught before inventory`);
    });
  }
  // A run id that does not exist is refused too.
  const stub = makeStub();
  const { db } = seededDb(failedState());
  await withStub(stub, async () => {
    const missing = await handleRetry(makePostRequest({ run_id: "job_ffffffffffffffff" }, RETRY_PATH),
      envFor(db, stub), retryOptions(stub));
    assert.equal(missing.status, 409);
    assert.equal((await missing.json()).reason, "run_missing");
    assert.equal(stub.uploadCount(), 0);
  });
});

test("LABELLED STUB / /run dedupe unchanged: a failed run is never a second retry path", async () => {
  const stub = makeStub({ histories: [], uploadStatus: 502, uploadError: "upload_unavailable" });
  const payload = {
    reads_text: "@r\nACGT\n+\nIIII\n", barcodes_text: "@b\nACGT\n+\nIIII\n",
    metadata_text: "sample-id\tbarcode-sequence\nsampleA\tACGT\n",
    reads_filename: "sequences.fastq", barcodes_filename: "barcodes.fastq", metadata_filename: "sample-metadata.tsv"
  };
  await withStub(stub, async () => {
    const { db } = seededDb(failedState());
    const env = envFor(db, stub);
    const first = await handleRun(makePostRequest(payload, "/api/ai/workflows/microbiome/run"), env,
      { fetchImpl: stub.fetchImpl, sleep: () => {} });
    assert.equal(first.status, 502);
    const run = await first.json();
    const submitsAfterFirst = stub.submitCount();
    const second = await handleRun(makePostRequest(payload, "/api/ai/workflows/microbiome/run"), env,
      { fetchImpl: stub.fetchImpl, sleep: () => {} });
    assert.equal(second.status, 200);
    const deduped = await second.json();
    assert.equal(deduped.deduped, true);
    assert.equal(deduped.run_id, run.run_id);
    assert.equal(stub.submitCount(), submitsAfterFirst, "/run did not become a retry path");
  });
});
