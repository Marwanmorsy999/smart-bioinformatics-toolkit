// M7.2 OFFLINE verification of the Galaxy upload wire contract.
// No network, no credentials, no live endpoints: every fetch/sleep/id is injected.
// This file only ADDS tests; it does not touch production code.

import test from "node:test";
import assert from "node:assert/strict";

import { createAdapter } from "../providers/galaxy/index.js";
import { OPERATIONS } from "../providers/common/contract.js";

const BASE = "https://galaxy.example.invalid";
const KEY = "MOCK-KEY-DO-NOT-USE"; // explicit placeholder; never a real secret
const HISTORY_ID = "verify-upload-history";
const PASTED = ">pasted\nACGTACGT\n";
const FASTA = ">file\nACGTACGTACGT\n";
const FETCH_URL = `${BASE}/api/tools/fetch`;

function env() {
  return { GALAXY_ENABLED: "true", GALAXY_BASE_URL: BASE, GALAXY_API_KEY: KEY };
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

function harness({ status = 200, body = [] } = {}) {
  const calls = [];
  const fetchImpl = async (input, init = {}) => {
    const url = String(input);
    const method = String(init.method ?? "GET").toUpperCase();
    calls.push({ url, method, init });
    if (method === "POST" && url === FETCH_URL) return json(body, status);
    if (method === "POST" && url === `${BASE}/api/histories`) return json({ id: HISTORY_ID });
    return json({ error: "not_found" }, 404);
  };
  return { calls, adapter: createAdapter(env()), fetchImpl };
}

function submit(adapter, fetchImpl, inputs) {
  return adapter.submitJob({
    operation: OPERATIONS.SUBMIT_JOB,
    tool_id: "upload1",
    history_id: HISTORY_ID,
    inputs
  }, {
    fetch: fetchImpl,
    sleep: async () => {},
    idFactory: () => "verify-upload-job"
  });
}

function pastedInputs() {
  return { file1: { src: "upload", content: PASTED, filename: "pasted.txt", extension: "txt" } };
}

function fileInputs() {
  return { file1: { src: "upload", content: new File([FASTA], "file.fasta", { type: "text/plain" }), filename: "file.fasta", extension: "fasta" } };
}

function uploadCalls(calls) {
  return calls.filter((call) => call.method === "POST" && call.url === FETCH_URL);
}

function formOf(call) {
  assert.ok(call.init.body instanceof FormData, "upload body must be FormData");
  return call.init.body;
}

function hasContentTypeOverride(init) {
  const headers = init.headers ?? {};
  const names = typeof headers.keys === "function" ? [...headers.keys()] : Object.keys(headers);
  return names.some((name) => String(name).toLowerCase() === "content-type");
}

function assertNoLegacyUpload(calls) {
  assert.equal(
    calls.some((call) => call.method === "POST" && call.url === `${BASE}/api/tools`),
    false,
    "legacy POST /api/tools upload body must not be used"
  );
  assert.equal(
    calls.some((call) => call.url.includes("/api/upload")),
    false,
    "there is no /api/upload route on usegalaxy.eu"
  );
  for (const call of calls) {
    if (typeof call.init.body === "string") {
      assert.equal(
        call.init.body.includes('"tool_id":"upload1"') && call.init.body.includes("file_content"),
        false,
        "no JSON body may carry the legacy tool_id=upload1 + file_content upload shape"
      );
    }
  }
}

test("M7.2 OFFLINE: text upload uses exact history_id/targets fields, hdas+pasted target, no Content-Type override", async () => {
  const { calls, adapter, fetchImpl } = harness();
  const result = await submit(adapter, fetchImpl, pastedInputs());

  assert.equal(result.status, "queued");
  assert.equal(result.provider_job_id, "verify-upload-job");
  assert.equal(result.error, undefined);

  const uploads = uploadCalls(calls);
  assert.equal(uploads.length, 1, "exactly one multipart upload call");
  const call = uploads[0];
  assert.equal(call.method, "POST");

  const form = formOf(call);
  assert.deepEqual([...form.keys()], ["history_id", "targets"], "exact multipart field names for pasted text");
  assert.equal(form.get("history_id"), HISTORY_ID);

  const targets = JSON.parse(form.get("targets"));
  assert.equal(targets.length, 1);
  assert.equal(targets[0].destination.type, "hdas");
  assert.equal(targets[0].elements.length, 1);
  assert.equal(targets[0].elements[0].src, "pasted");
  assert.equal(targets[0].elements[0].paste_content, PASTED);
  assert.equal(targets[0].elements[0].name, "pasted.txt");
  assert.equal(targets[0].elements[0].ext, "txt");

  assert.equal(hasContentTypeOverride(call.init), false, "adapter must not set Content-Type on multipart fetch");
  const computedType = new Request(FETCH_URL, {
    method: "POST", body: form, headers: call.init.headers
  }).headers.get("content-type");
  assert.match(computedType, /^multipart\/form-data; boundary=/, "fetch must generate the boundary");

  assertNoLegacyUpload(calls);
});

test("M7.2 OFFLINE: file upload uses exact history_id/targets/files fields, hdas+files target, bytes preserved", async () => {
  const { calls, adapter, fetchImpl } = harness();
  const result = await submit(adapter, fetchImpl, fileInputs());

  assert.equal(result.status, "queued");
  const uploads = uploadCalls(calls);
  assert.equal(uploads.length, 1);
  const form = formOf(uploads[0]);

  assert.deepEqual([...form.keys()], ["history_id", "targets", "files"], "exact multipart field names for file upload");
  const targets = JSON.parse(form.get("targets"));
  assert.equal(targets[0].destination.type, "hdas");
  assert.equal(targets[0].elements[0].src, "files");
  assert.equal(targets[0].elements[0].name, "file.fasta");
  assert.equal(targets[0].elements[0].ext, "fasta");

  const parts = form.getAll("files");
  assert.equal(parts.length, 1);
  assert.equal(await parts[0].text(), FASTA, "file bytes preserved verbatim");
  assert.equal(hasContentTypeOverride(uploads[0].init), false);
  assertNoLegacyUpload(calls);
});

test("M7.2 OFFLINE: HTTP 400 is a typed failure, never a fabricated success, and is not retried", async () => {
  const { calls, adapter, fetchImpl } = harness({
    status: 400,
    body: { error: "invalid_targets", message: "No data was entered in the upload form" }
  });
  const result = await submit(adapter, fetchImpl, pastedInputs());

  assert.equal(result.status, "failed");
  assert.equal(result.provider_job_id, null);
  assert.deepEqual(result.output, {});
  assert.equal(result.error.provider, "galaxy");
  assert.equal(result.error.status, 400);
  assert.equal(result.error.code, "invalid_targets");
  assert.equal(result.error.retryable, false);
  assert.equal(uploadCalls(calls).length, 1, "400 must not be retried");
  assertNoLegacyUpload(calls);
});

test("M7.2 OFFLINE: HTTP 403 activation and 401 expired key propagate as typed failures", async () => {
  for (const [status, code] of [[403, "action_requires_account_activation"], [401, "invalid_api_key"]]) {
    const { calls, adapter, fetchImpl } = harness({ status, body: { error: code, message: "mock rejection" } });
    const result = await submit(adapter, fetchImpl, pastedInputs());

    assert.equal(result.status, "failed", `${status} must fail, never fabricate success`);
    assert.equal(result.provider_job_id, null);
    assert.deepEqual(result.output, {});
    assert.equal(result.error.provider, "galaxy");
    assert.equal(result.error.status, status);
    assert.equal(result.error.code, code);
    assert.equal(result.error.retryable, false);
    assert.equal(uploadCalls(calls).length, 1, `${status} must not be retried`);
    assertNoLegacyUpload(calls);
  }
});

test("M7.2 OFFLINE: legacy /api/tools upload body is never emitted for the upload primitive", async () => {
  for (const inputs of [pastedInputs(), fileInputs()]) {
    const { calls, adapter, fetchImpl } = harness();
    await submit(adapter, fetchImpl, inputs);

    // The only upload write is the multipart /api/tools/fetch call.
    const writeCalls = calls.filter((call) => call.method === "POST");
    assert.deepEqual(
      writeCalls.map((call) => call.url),
      [FETCH_URL],
      "the only POST for an upload must be /api/tools/fetch"
    );
    assertNoLegacyUpload(calls);
    const targets = JSON.parse(formOf(uploadCalls(calls)[0]).get("targets"));
    assert.equal(targets[0].destination.type, "hdas");
    assert.ok(["pasted", "files"].includes(targets[0].elements[0].src));
  }
});
