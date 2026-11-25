// OFFLINE / MOCK regression tests for the verified Galaxy upload contract.
// Every fetch is injected; no credential, real URL or network call is used.

import test from "node:test";
import assert from "node:assert/strict";

import { createAdapter } from "../providers/galaxy/index.js";
import { OPERATIONS } from "../providers/common/contract.js";

const HISTORY_ID = "history_upload_fetch_mock";
const TEST_KEY = "mock-key-not-a-real-secret";
const PASTED = ">mock-seq\nACGTACGT\n";
const PASTED_NAME = "pasted-input.txt";
const FILE_TEXT = ">mock-file-seq\nACGTACGTACGT\n";
const FILE_NAME = "file-input.fasta";

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

function env() {
  return {
    GALAXY_ENABLED: "true",
    GALAXY_BASE_URL: "https://galaxy.example.invalid",
    GALAXY_API_KEY: TEST_KEY
  };
}

function noSleep() { return async () => {}; }

function harness({ fetchStatus = 200, fetchBody = [], contents = [] } = {}) {
  const calls = [];
  const fetchImpl = async (input, init = {}) => {
    const url = String(input);
    const method = init.method ?? "GET";
    calls.push({ url, method, init });
    if (method === "POST" && url.endsWith("/api/histories")) return json({ id: HISTORY_ID });
    if (method === "POST" && url.endsWith("/api/tools/fetch")) {
      return new Response(JSON.stringify(fetchBody), {
        status: fetchStatus,
        headers: { "Content-Type": "application/json" }
      });
    }
    if (method === "GET" && url.includes("/api/histories/") && url.endsWith("/contents")) return json(contents);
    return json({}, 404);
  };
  return { calls, fetchImpl, adapter: createAdapter(env()) };
}

function submit(adapter, fetchImpl, overrides = {}) {
  return adapter.submitJob({
    operation: OPERATIONS.SUBMIT_JOB,
    tool_id: "upload1",
    history_id: overrides.history_id ?? HISTORY_ID,
    inputs: overrides.inputs ?? {
      file1: { src: "upload", content: PASTED, filename: PASTED_NAME, extension: "txt" }
    }
  }, {
    fetch: fetchImpl,
    sleep: noSleep(),
    idFactory: () => "galaxy-upload-mock-job"
  });
}

function fetchCalls(calls) {
  return calls.filter((call) => call.method === "POST" && call.url.endsWith("/api/tools/fetch"));
}

function formOf(call) {
  assert.ok(call.init.body instanceof FormData, "upload body must be FormData");
  return call.init.body;
}

function assertNoLegacyUpload(calls) {
  assert.equal(calls.some((call) => call.method === "POST" && call.url.endsWith("/api/tools")), false,
    "old POST /api/tools + tool_id=upload1 upload body must be gone");
  assert.equal(calls.some((call) => call.url.includes("/api/upload")), false,
    "there is no /api/upload route on usegalaxy.eu");
}

test("OFFLINE/MOCK: text upload posts multipart /api/tools/fetch with the exact hdas+pasted target", async () => {
  const { calls, fetchImpl, adapter } = harness();
  const result = await submit(adapter, fetchImpl);

  assert.equal(result.status, "queued");
  assert.equal(result.provider_job_id, "galaxy-upload-mock-job");
  assert.equal(result.output.structured.history_id, HISTORY_ID);
  assert.equal(result.error, undefined);

  const uploads = fetchCalls(calls);
  assert.equal(uploads.length, 1);
  const call = uploads[0];
  assert.equal(call.url, "https://galaxy.example.invalid/api/tools/fetch");
  assert.equal(call.method, "POST");
  const contentType = new Request(call.url, {
    method: call.method, body: call.init.body, headers: call.init.headers
  }).headers.get("content-type");
  assert.match(contentType, /^multipart\/form-data; boundary=/);
  assert.equal(call.init.headers?.["Content-Type"], undefined, "fetch must generate the boundary");

  const form = formOf(call);
  assert.equal(form.get("history_id"), HISTORY_ID);
  assert.deepEqual(JSON.parse(form.get("targets")), [{
    destination: { type: "hdas" },
    elements: [{ src: "pasted", paste_content: PASTED, name: PASTED_NAME, ext: "txt" }]
  }]);
  assert.equal(form.get("targets").includes("ACGTACGT"), true, "text content must be present in the JSON-encoded targets");
  assert.deepEqual(form.getAll("files"), []);
  assert.equal(calls.some((entry) => entry.method === "POST" && entry.url.endsWith("/api/histories")), false,
    "a supplied history_id must never trigger history creation");
  assertNoLegacyUpload(calls);
});

test("OFFLINE/MOCK: blob upload uses a files element plus a files multipart part", async () => {
  const { calls, fetchImpl, adapter } = harness();
  const file = new File([FILE_TEXT], FILE_NAME, { type: "text/plain" });
  const result = await submit(adapter, fetchImpl, {
    inputs: { file1: { src: "upload", content: file, filename: FILE_NAME, extension: "fasta" } }
  });

  assert.equal(result.status, "queued");
  const uploads = fetchCalls(calls);
  assert.equal(uploads.length, 1);
  const form = formOf(uploads[0]);
  assert.deepEqual(JSON.parse(form.get("targets")), [{
    destination: { type: "hdas" },
    elements: [{ src: "files", name: FILE_NAME, ext: "fasta" }]
  }]);
  const parts = form.getAll("files");
  assert.equal(parts.length, 1, "bytes must travel as the multipart files part");
  assert.equal(await parts[0].text(), FILE_TEXT, "file bytes must be preserved verbatim");
  assertNoLegacyUpload(calls);
});

test("OFFLINE/MOCK: Galaxy 400 is a typed failure, never a fabricated success", async () => {
  const { calls, fetchImpl, adapter } = harness({
    fetchStatus: 400,
    fetchBody: { error: "invalid_targets", message: "No data was entered in the upload form" }
  });
  const result = await submit(adapter, fetchImpl);

  assert.equal(result.status, "failed");
  assert.equal(result.provider_job_id, null);
  assert.deepEqual(result.output, {});
  assert.equal(result.error.provider, "galaxy");
  assert.equal(result.error.status, 400);
  assert.equal(result.error.code, "invalid_targets");
  assert.equal(result.error.retryable, false);
  assert.equal(fetchCalls(calls).length, 1, "400 must not be retried");
  const artifacts = await adapter.getArtifacts({ history_id: HISTORY_ID }, { fetch: fetchImpl, sleep: noSleep() });
  assert.deepEqual(artifacts.artifacts, [], "no dataset may be claimed after a 400");
});

test("OFFLINE/MOCK: 403 activation and 401 expired key propagate as typed errors", async () => {
  for (const [status, code] of [[403, "action_requires_account_activation"], [401, "invalid_api_key"]]) {
    const { calls, fetchImpl, adapter } = harness({
      fetchStatus: status,
      fetchBody: { error: code, message: "mock rejection" }
    });
    const result = await submit(adapter, fetchImpl);
    assert.equal(result.status, "failed");
    assert.equal(result.error.status, status);
    assert.equal(result.error.code, code);
    assert.equal(result.error.retryable, false);
    assert.equal(result.provider_job_id, null);
    assert.deepEqual(result.output, {});
    assert.equal(fetchCalls(calls).length, 1, `${status} must not be retried`);
  }
});

test("OFFLINE/MOCK: missing or malformed history fails before any network call", async () => {
  const { calls, fetchImpl, adapter } = harness();
  const result = await submit(adapter, fetchImpl, { history_id: "../not-a-history" });
  assert.equal(result.status, "failed");
  assert.equal(result.error.code, "validation_error");
  assert.equal(result.error.message, "malformed_history_id");
  assert.equal(result.error.status, 400);
  assert.equal(result.provider_job_id, null);
  assert.deepEqual(calls, [], "no request may be sent without a valid history reference");
});

test("OFFLINE/MOCK: uploaded dataset is discoverable by exact filename in the supplied history", async () => {
  const datasets = [
    { id: "ds_other", name: "pasted-input.txt.gz", state: "ok", history_id: HISTORY_ID },
    { id: "ds_created", name: PASTED_NAME, state: "ok", history_id: HISTORY_ID }
  ];
  const { fetchImpl, adapter } = harness({ contents: datasets });
  const submitted = await submit(adapter, fetchImpl);
  assert.equal(submitted.status, "queued");
  const artifacts = await adapter.getArtifacts({ history_id: HISTORY_ID }, { fetch: fetchImpl, sleep: noSleep() });
  assert.equal(artifacts.ok, true);
  const found = artifacts.artifacts.find((item) => item.name === PASTED_NAME);
  assert.ok(found, "dataset must be discoverable by exact filename");
  assert.equal(found.id, "ds_created");
  assert.equal(found.history_id, HISTORY_ID);
});

test("OFFLINE/MOCK: downloadArtifact returns item_data from the verified text route", async () => {
  const calls = [];
  const fetchImpl = async (input, init = {}) => {
    calls.push({ url: String(input), method: init.method ?? "GET" });
    return json({ item_data: PASTED, truncated: false, item_url: "mock://item" });
  };
  const adapter = createAdapter(env());
  const result = await adapter.downloadArtifact(
    { dataset_id: "ds_created" }, { fetch: fetchImpl, sleep: noSleep() }
  );

  assert.equal(result.ok, true);
  assert.equal(result.artifact_id, "ds_created");
  assert.equal(result.content, PASTED);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://galaxy.example.invalid/api/datasets/ds_created/get_content_as_text");
  assert.equal(calls.some((call) => call.url.endsWith("/content")), false, "the old /content route must not be used");
  assert.equal(JSON.stringify(result).includes(TEST_KEY), false);
});

test("OFFLINE/MOCK: truncated:true is a typed failure and partial text is never returned", async () => {
  const calls = [];
  const fetchImpl = async (input) => {
    calls.push(String(input));
    return json({ item_data: PASTED.slice(0, 4), truncated: true, item_url: "mock://item" });
  };
  const adapter = createAdapter(env());
  const result = await adapter.downloadArtifact(
    { artifact_id: "ds_created" }, { fetch: fetchImpl, sleep: noSleep() }
  );

  assert.equal(result.ok, false);
  assert.equal(result.error.provider, "galaxy");
  assert.equal(result.error.code, "content_truncated");
  assert.equal(result.error.status, 413);
  assert.equal(result.error.retryable, false);
  assert.equal(result.error.message, "galaxy dataset content was truncated");
  assert.equal(result.content, undefined, "partial content must never be exposed");
  assert.equal(calls.length, 1, "a truncated response must not be retried");
  assert.equal(JSON.stringify(result).includes(TEST_KEY), false);
});

test("OFFLINE/MOCK: invalid upload content fails typed; extension-less names fall back to txt", async () => {
  const { calls, fetchImpl, adapter } = harness();
  const bad = await submit(adapter, fetchImpl, {
    inputs: { file1: { src: "upload", content: 42, filename: "README" } }
  });
  assert.equal(bad.status, "failed");
  assert.equal(bad.error.code, "invalid_upload_content");
  assert.equal(bad.error.status, 400);
  assert.equal(bad.error.retryable, false);
  assert.deepEqual(calls, [], "invalid content must be rejected before any network call");

  const good = await submit(adapter, fetchImpl, {
    inputs: { file1: { src: "upload", content: PASTED, filename: "README" } }
  });
  assert.equal(good.status, "queued");
  const form = formOf(fetchCalls(calls)[0]);
  assert.deepEqual(JSON.parse(form.get("targets")), [{
    destination: { type: "hdas" },
    elements: [{ src: "pasted", paste_content: PASTED, name: "README", ext: "txt" }]
  }]);
});
