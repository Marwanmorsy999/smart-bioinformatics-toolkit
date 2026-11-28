import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { createAdapter } from "../providers/smartsbio/index.js";
import { AVAILABILITY, DISCOVERY_MODE, JOB_STATUS, OPERATIONS } from "../providers/common/contract.js";

const FIXTURES = new URL("./fixtures/providers/smartsbio/", import.meta.url);
function read(name) {
  return readFileSync(new URL(name, FIXTURES), "utf8");
}
function fixture(name) {
  return JSON.parse(read(name));
}
const workspaces = fixture("mock-workspaces.json");
const tools = fixture("mock-tools.json");
const query = fixture("mock-query.json");
const pipelines = fixture("mock-pipeline.json");
const toolRun = fixture("mock-tool-run.json");
const stream = read("mock-stream.txt");

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}
function sse(text) {
  return new Response(text, { status: 200, headers: { "Content-Type": "text/event-stream" } });
}
function env(overrides = {}) {
  return {
    SMARTSBIO_ENABLED: "true",
    SMARTSBIO_PUBLIC_AUTHORIZED: "true",
    SMARTSBIO_BASE_URL: "https://smarts.example.invalid/v1",
    SMARTSBIO_API_KEY: "mock-key-not-a-real-secret",
    SMARTSBIO_WORKSPACE_ID: workspaces.data[0].id,
    ...overrides
  };
}
function noSleep() { return async () => {}; }
function mockFetch(calls, overrides = {}) {
  return async (input, init = {}) => {
    const url = String(input);
    const method = init.method ?? "GET";
    calls.push({ url, method, body: init.body });
    if (url.includes("/v1/workspaces")) return json(workspaces);
    if (url.includes("/v1/tools") && method === "POST") return json(overrides.toolRunResponse ?? toolRun.success);
    if (url.includes("/v1/tools")) return json(tools);
    if (url.includes("/v1/query/stream")) return sse(stream);
    if (url.includes("/v1/query")) return json(overrides.queryResponse ?? query);
    if (url.includes("storage.example.invalid")) return new Response("MOCK FILE BYTES");
    if (url.includes("/v1/files/download")) return json(pipelines.download);
    if (url.includes("/v1/files")) return json(pipelines.files);
    if (url.includes("/v1/pipelines") && method === "POST") return json(pipelines.created);
    if (url.includes("/v1/pipelines") && method === "DELETE") return json({ status: "success", message: "Mock cancelled." });
    // VERIFIED shape: the list endpoint returns {processes, total, pagination}, not `data`.
    if (new URL(url).pathname.endsWith("/v1/pipelines")) return json(pipelines.listing);
    if (url.includes("/v1/pipelines")) return json(pipelines.completed);
    return json({ status: "error", error: "not_found" }, 404);
  };
}

test("smarts.bio is disabled by default: no gate, no tools, no chat, no network", async () => {
  const calls = [];
  const adapter = createAdapter({ SMARTSBIO_ENABLED: "true" }, { fetch: mockFetch(calls) });
  const health = await adapter.healthCheck({ fetch: mockFetch(calls) });
  assert.equal(health.ok, false);
  assert.equal(health.status, AVAILABILITY.DISABLED);
  const caps = await adapter.getCapabilities({ fetch: mockFetch(calls) });
  assert.deepEqual(caps.operations, []);
  assert.deepEqual(caps.tools, []);
  assert.equal(caps.discovery_mode, DISCOVERY_MODE.UNAVAILABLE);
  const chat = await adapter.submitJob({ operation: OPERATIONS.CHAT, message: "mock" }, { fetch: mockFetch(calls) });
  assert.equal(chat.status, "failed");
  assert.equal(chat.error.code, "public_authorization_required");
  assert.equal(chat.error.status, 403);
  const validated = adapter.validateRequest(OPERATIONS.CHAT, { message: "mock" });
  assert.equal(validated.valid, false);
  assert.equal(validated.error, "public_authorization_required");
  const usage = await adapter.getUsage({ fetch: mockFetch(calls) });
  assert.equal(usage.ok, false);
  assert.equal(usage.reason, "not_documented");
  assert.equal(calls.length, 0, "gated adapter must not make any HTTP call");
});

test("smarts.bio health/workspace and dynamic tool discovery after authorization", async () => {
  const calls = [];
  const adapter = createAdapter(env());
  const fetchImpl = mockFetch(calls);
  const health = await adapter.healthCheck({ fetch: fetchImpl, sleep: noSleep() });
  assert.equal(health.ok, true);
  assert.equal(health.status, AVAILABILITY.AVAILABLE);
  assert.equal(health.workspace_visible, true);
  const caps = await adapter.getCapabilities({ fetch: fetchImpl, sleep: noSleep() });
  assert.equal(caps.discovery_mode, DISCOVERY_MODE.LIVE);
  assert.deepEqual(caps.tools.map((tool) => tool.id), tools.tools.map((tool) => tool.id));
  const first = caps.tools[0];
  assert.deepEqual(Object.keys(first.parameters), Object.keys(tools.tools[0].parameters), "the verified parameter schemas must survive discovery");
  assert.ok(caps.operations.includes(OPERATIONS.CHAT));
  for (const tool of caps.tools) {
    assert.equal(tool.available, true);
    assert.equal(tool.executable, true);
    assert.ok(tool.source.includes("/v1/tools"));
  }
});

test("smarts.bio chat, streaming chat and plan all use submitJob with the documented shapes", async () => {
  const calls = [];
  const adapter = createAdapter(env());
  const fetchImpl = mockFetch(calls);
  const chat = await adapter.submitJob({ operation: OPERATIONS.CHAT, message: "mock question" }, { fetch: fetchImpl, sleep: noSleep() });
  assert.equal(chat.status, JOB_STATUS.SUCCEEDED);
  assert.equal(chat.output.text, query.data.answer);
  assert.ok(chat.provider_job_id);
  assert.ok(chat.submitted_at);
  const chatCall = calls.find((call) => call.url.endsWith("/v1/query") && call.method === "POST");
  assert.ok(chatCall, "chat must use POST /v1/query");
  assert.equal(JSON.parse(chatCall.body).workspace_id, workspaces.data[0].id);

  const streamed = await adapter.submitJob({ operation: OPERATIONS.CHAT_STREAM, message: "mock stream" }, { fetch: fetchImpl, sleep: noSleep() });
  assert.equal(streamed.status, JOB_STATUS.SUCCEEDED);
  assert.equal(streamed.output.text, "Mock streamed answer.");
  assert.ok(calls.some((call) => call.url.endsWith("/v1/query/stream")));

  const schema = { type: "object", properties: { steps: { type: "array" } } };
  const planResponse = structuredClone(query);
  planResponse.data.answer = JSON.stringify({ steps: ["mock-step"] });
  const planFetch = mockFetch(calls, { queryResponse: planResponse });
  const plan = await adapter.submitJob({ operation: OPERATIONS.PLAN, message: "mock plan", json_schema: schema }, { fetch: planFetch, sleep: noSleep() });
  assert.equal(plan.status, JOB_STATUS.SUCCEEDED);
  assert.deepEqual(plan.output.structured, { steps: ["mock-step"] });
});

test("smarts.bio pipeline submit/status/cancel/artifacts use documented endpoints", async () => {
  const calls = [];
  const adapter = createAdapter(env());
  const fetchImpl = mockFetch(calls);
  const submitted = await adapter.submitJob({ operation: OPERATIONS.SUBMIT_JOB, pipeline_id: "mock-pipeline-id", inputs: {} }, { fetch: fetchImpl, sleep: noSleep() });
  assert.equal(submitted.status, JOB_STATUS.QUEUED);
  assert.equal(submitted.provider_job_id, pipelines.created.data.id);
  const createCall = calls.find((call) => call.url.endsWith("/v1/pipelines") && call.method === "POST");
  assert.ok(createCall);
  const createBody = JSON.parse(createCall.body);
  assert.ok(createBody.workspace_id, "pipelines require workspace_id");
  assert.ok(Object.hasOwn(createBody, "input"));

  const status = await adapter.getJobStatus({ job_id: pipelines.created.data.id }, { fetch: fetchImpl, sleep: noSleep() });
  assert.equal(status.status, JOB_STATUS.SUCCEEDED);
  assert.deepEqual(status.output.structured.output_paths, pipelines.completed.data.output_paths);

  const artifacts = await adapter.getArtifacts({ job_id: pipelines.created.data.id }, { fetch: fetchImpl, sleep: noSleep() });
  assert.equal(artifacts.ok, true);
  assert.equal(artifacts.artifacts.length, pipelines.completed.data.output_paths.length);

  const cancel = await adapter.cancelJob({ job_id: pipelines.created.data.id }, { fetch: fetchImpl, sleep: noSleep() });
  assert.equal(cancel.status, JOB_STATUS.CANCELLED);
  assert.ok(calls.some((call) => call.method === "DELETE" && call.url.includes("/v1/pipelines/")));

  const download = await adapter.downloadArtifact({ key: pipelines.files.data[0].key }, { fetch: fetchImpl, sleep: noSleep() });
  assert.equal(download.ok, true);
  assert.equal(download.content, "MOCK FILE BYTES");
});

test("smarts.bio tool runs use the verified singular input key and result envelope", async () => {
  const calls = [];
  const adapter = createAdapter(env());
  const fetchImpl = mockFetch(calls);
  const toolId = tools.tools[0].id; // from fixture
  const toolInput = { query_type: "uniprot", identifier: "P04637", format: "json", limit: 1 };
  const run = await adapter.submitJob({ operation: OPERATIONS.SUBMIT_JOB, tool_id: toolId, input: toolInput }, { fetch: fetchImpl, sleep: noSleep() });
  assert.equal(run.status, JOB_STATUS.SUCCEEDED);
  const runCall = calls.find((call) => call.url.includes(`/v1/tools/${toolId}/run`));
  assert.ok(runCall, "tool execution must use POST /v1/tools/:id/run");
  const body = JSON.parse(runCall.body);
  assert.deepEqual(body.input, toolInput, "VERIFIED: parameters go under `input`, not inputs/parameters/flat");
  assert.equal(body.workspace_id, workspaces.data[0].id);
  assert.deepEqual(run.output.structured, toolRun.success.result.data);
  const usage = await adapter.getUsage({ fetch: fetchImpl });
  assert.equal(usage.ok, false, "no usage endpoint is documented; do not invent counters");
  assert.equal(usage.usage, null);
});

test("smarts.bio surfaces a failed tool result as a normalized failed job", async () => {
  const calls = [];
  const adapter = createAdapter(env());
  const fetchImpl = mockFetch(calls, { toolRunResponse: toolRun.failure });
  const run = await adapter.submitJob({
    operation: OPERATIONS.SUBMIT_JOB,
    tool_id: tools.tools[0].id,
    input: { identifier: "P04637" } // deliberately missing query_type
  }, { fetch: fetchImpl, sleep: noSleep() });
  assert.equal(run.status, "failed");
  assert.equal(run.error.provider, "smartsbio");
  assert.equal(run.error.code, "tool_run_failed");
  assert.equal(run.error.retryable, false);
  assert.deepEqual(run.output, {});

  const httpError = await adapter.submitJob({
    operation: OPERATIONS.SUBMIT_JOB,
    tool_id: tools.tools[0].id,
    input: {}
  }, { fetch: mockFetch(calls, { toolRunResponse: toolRun.http_validation_error }), sleep: noSleep() });
  assert.equal(httpError.status, "failed");
  assert.equal(httpError.error.code, "validation_error");
});

test("smarts.bio list/get artifacts require workspace_id and use the verified processes shape", async () => {
  const calls = [];
  const adapter = createAdapter(env());
  const fetchImpl = async (input, init = {}) => {
    const url = String(input);
    calls.push({ url, method: init.method ?? "GET" });
    // Detail has no outputs; the verified `processes` list is the only source.
    if (url.includes("/v1/pipelines/")) return json({ status: "success", data: { id: pipelines.created.data.id, output_paths: [] } });
    if (new URL(url).pathname.endsWith("/v1/pipelines")) return json(pipelines.listing);
    return json({}, 404);
  };
  const artifacts = await adapter.getArtifacts({ job_id: pipelines.created.data.id, workspace_id: workspaces.data[0].id }, { fetch: fetchImpl, sleep: noSleep() });
  assert.equal(artifacts.ok, true);
  const listCall = calls.find((call) => call.url.includes("/v1/pipelines?"));
  assert.ok(listCall, "GET /v1/pipelines must be called with workspace_id");
  assert.match(listCall.url, /workspace_id=/);
  assert.deepEqual(artifacts.artifacts.map((item) => item.key), pipelines.listing.processes[0].output_paths);

  const noWorkspace = createAdapter({
    SMARTSBIO_ENABLED: "true", SMARTSBIO_PUBLIC_AUTHORIZED: "true",
    SMARTSBIO_BASE_URL: env().SMARTSBIO_BASE_URL, SMARTSBIO_API_KEY: env().SMARTSBIO_API_KEY
  });
  const refused = await noWorkspace.submitJob({
    operation: OPERATIONS.SUBMIT_JOB, pipeline_id: "mock-pipeline-id", input: {}
  }, { fetch: fetchImpl, sleep: noSleep() });
  assert.equal(refused.status, "failed");
  assert.equal(refused.error.code, "workspace_id_required");
  const listed = await noWorkspace.getArtifacts({ job_id: pipelines.created.data.id }, { fetch: fetchImpl, sleep: noSleep() });
  assert.equal(listed.ok, false);
  assert.equal(listed.reason, "workspace_id_required");
});

test("smarts.bio rejects malformed ids and accepts provider_job_id as an alias", async () => {
  const adapter = createAdapter(env());
  assert.equal(adapter.validateRequest(OPERATIONS.SUBMIT_JOB, { tool_id: "../bad id" }).error, "malformed_tool_id");
  assert.equal(adapter.validateRequest(OPERATIONS.JOB_STATUS, { job_id: "bad/id" }).error, "malformed_job_id");
  assert.equal(adapter.validateRequest(OPERATIONS.JOB_STATUS, { provider_job_id: pipelines.created.data.id }).valid, true);
  const calls = [];
  const fetchImpl = mockFetch(calls);
  const byAlias = await adapter.getJobStatus({ provider_job_id: pipelines.created.data.id }, { fetch: fetchImpl, sleep: noSleep() });
  assert.equal(byAlias.status, JOB_STATUS.SUCCEEDED);
  const cancel = await adapter.cancelJob({ provider_job_id: pipelines.created.data.id }, { fetch: fetchImpl, sleep: noSleep() });
  assert.equal(cancel.status, JOB_STATUS.CANCELLED);
  const usage = await adapter.getUsage({ provider_job_id: pipelines.created.data.id }, { fetch: fetchImpl });
  assert.equal(usage.provider_job_id, pipelines.created.data.id);
});
