import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { createAdapter, SYSTEM_GUARD } from "../providers/ninerouter/index.js";
import { AVAILABILITY, DISCOVERY_MODE, JOB_STATUS, OPERATIONS } from "../providers/common/contract.js";

const FIXTURES = new URL("./fixtures/providers/ninerouter/", import.meta.url);
function read(name) {
  return readFileSync(new URL(name, FIXTURES), "utf8");
}
function fixture(name) {
  return JSON.parse(read(name));
}
const models = fixture("mock-models.json");
const chat = fixture("mock-chat.json");
const plan = fixture("mock-plan.json");
const stream = read("mock-stream.txt");

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}
function sse(text) {
  return new Response(text, { status: 200, headers: { "Content-Type": "text/event-stream" } });
}
function env(overrides = {}) {
  return {
    NINEROUTER_ENABLED: "true",
    NINEROUTER_BASE_URL: "https://router.example.invalid/v1",
    NINEROUTER_API_KEY: "mock-key-not-a-real-secret",
    NINEROUTER_MODEL: models.data[0].id,
    NINEROUTER_TIMEOUT: "5",
    ...overrides
  };
}
function noSleep() { return async () => {}; }
function mockFetch(calls, overrides = {}) {
  return async (input, init = {}) => {
    const url = String(input);
    const method = init.method ?? "GET";
    calls.push({ url, method, body: init.body });
    if (url.includes("/v1/models")) return json(models);
    if (url.includes("/v1/chat/completions")) {
      if (overrides.stream) return sse(stream);
      const body = JSON.parse(init.body);
      if (body.response_format?.type === "json_object") return json(plan);
      return json(chat);
    }
    return json({ error: { message: "mock not found", code: "not_found" } }, 404);
  };
}

test("9Router discovers models live and maps them to executable tools", async () => {
  const calls = [];
  const adapter = createAdapter(env());
  const caps = await adapter.getCapabilities({ fetch: mockFetch(calls), sleep: noSleep() });
  assert.deepEqual(caps.tools.map((tool) => tool.id), models.data.map((model) => model.id));
  assert.equal(caps.discovery_mode, DISCOVERY_MODE.LIVE);
  assert.equal(caps.availability, AVAILABILITY.AVAILABLE);
  for (const tool of caps.tools) {
    assert.equal(tool.available, true);
    assert.equal(tool.executable, true);
    assert.ok(tool.source.includes("/v1/models"));
  }
  const health = await adapter.healthCheck({ fetch: mockFetch(calls), sleep: noSleep() });
  assert.equal(health.ok, true);
  assert.equal(health.status, AVAILABILITY.AVAILABLE);
  assert.equal(health.selected_model, models.data[0].id);
});

test("9Router chat goes through submitJob, carries the guard and reports token usage", async () => {
  const calls = [];
  const adapter = createAdapter(env());
  const result = await adapter.submitJob({ operation: OPERATIONS.CHAT, message: "Plan a QC step" }, { fetch: mockFetch(calls), sleep: noSleep() });
  assert.equal(result.status, JOB_STATUS.SUCCEEDED);
  assert.equal(result.output.text, chat.choices[0].message.content);
  assert.equal(result.output.finish_reason, chat.choices[0].finish_reason);
  assert.equal(result.output.usage.input_tokens, chat.usage.prompt_tokens);
  assert.equal(result.output.usage.output_tokens, chat.usage.completion_tokens);
  assert.equal(result.output.usage.total_tokens, chat.usage.total_tokens);
  const requestBody = JSON.parse(calls.find((call) => call.method === "POST").body);
  assert.equal(requestBody.model, models.data[0].id);
  const systemText = requestBody.messages.filter((message) => message.role === "system").map((message) => message.content).join("\n");
  assert.match(systemText, /MUST NOT generate/i);
  assert.match(systemText, /citations/i);
  assert.equal(SYSTEM_GUARD.includes("127.0.0.1"), false);
  const usage = await adapter.getUsage({ fetch: mockFetch(calls), sleep: noSleep() });
  assert.equal(usage.ok, true);
  assert.equal(usage.usage.requests, 1);
  assert.equal(usage.usage.total_tokens, chat.usage.total_tokens);
});

test("9Router plan uses JSON mode and structured output via submitJob", async () => {
  const calls = [];
  const adapter = createAdapter(env());
  const result = await adapter.submitJob({
    operation: OPERATIONS.PLAN,
    message: "Return a two-step plan",
    json_schema: { type: "object" }
  }, { fetch: mockFetch(calls), sleep: noSleep() });
  assert.equal(result.status, JOB_STATUS.SUCCEEDED);
  assert.deepEqual(result.output.structured, JSON.parse(plan.choices[0].message.content));
  const requestBody = JSON.parse(calls.find((call) => call.method === "POST").body);
  assert.deepEqual(requestBody.response_format, { type: "json_object" });
});

test("9Router SSE streaming accumulates text and captures usage", async () => {
  const calls = [];
  const adapter = createAdapter(env());
  const result = await adapter.submitJob({ operation: OPERATIONS.CHAT_STREAM, message: "stream a plan" }, {
    fetch: mockFetch(calls, { stream: true }), sleep: noSleep()
  });
  assert.equal(result.status, JOB_STATUS.SUCCEEDED);
  assert.equal(result.output.text, "Mock streamed reasoning.");
  assert.equal(result.output.finish_reason, "stop");
  assert.equal(result.output.usage.total_tokens, 10);
});

test("9Router has no loopback fallback and validates requests", async () => {
  const source = readFileSync(new URL("../providers/ninerouter/index.js", import.meta.url), "utf8");
  assert.equal(source.includes("127.0.0.1"), false);
  assert.equal(source.includes("localhost"), false);
  const calls = [];
  const adapter = createAdapter({ NINEROUTER_ENABLED: "true", NINEROUTER_API_KEY: "mock-key" });
  const health = await adapter.healthCheck({ fetch: mockFetch(calls), sleep: noSleep() });
  assert.equal(health.status, AVAILABILITY.UNAVAILABLE, "missing NINEROUTER_BASE_URL must not fall back to a local endpoint");
  assert.equal(calls.length, 0);
  const valid = adapter.validateRequest(OPERATIONS.CHAT, { message: "hi", model: "m" });
  assert.equal(valid.valid, true);
  assert.equal(valid.normalized.message, "hi");
  assert.equal(adapter.validateRequest(OPERATIONS.CHAT, {}).error, "message_required");
  assert.equal(adapter.validateRequest("teleport", { message: "hi" }).error, "operation_not_supported");
});

test("9Router polling methods accept request objects with provider_job_id alias and reject malformed ids", async () => {
  const calls = [];
  const adapter = createAdapter(env());
  const submitted = await adapter.submitJob({ operation: OPERATIONS.CHAT, message: "hi" }, { fetch: mockFetch(calls), sleep: noSleep() });
  const jobId = submitted.provider_job_id;
  const status = await adapter.getJobStatus({ provider_job_id: jobId }, { fetch: mockFetch(calls) });
  assert.equal(status.status, JOB_STATUS.SUCCEEDED);
  assert.equal(status.output.text, chat.choices[0].message.content);
  assert.equal((await adapter.cancelJob({ provider_job_id: jobId })).provider_job_id, jobId);
  assert.equal((await adapter.getArtifacts({ provider_job_id: jobId })).provider_job_id, jobId);
  assert.equal((await adapter.getUsage({ provider_job_id: jobId })).provider_job_id, jobId);
  assert.equal(adapter.validateRequest(OPERATIONS.JOB_STATUS, { job_id: "../oops" }).error, "malformed_job_id");
  assert.equal(adapter.validateRequest(OPERATIONS.JOB_STATUS, {}).error, "job_id_required");
});
