import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { createAdapter } from "../providers/galaxy/index.js";
import { AVAILABILITY, DISCOVERY_MODE, JOB_STATUS, OPERATIONS } from "../providers/common/contract.js";

const FIXTURES = new URL("./fixtures/providers/galaxy/", import.meta.url);
function fixture(name) {
  return JSON.parse(readFileSync(new URL(name, FIXTURES), "utf8"));
}
const discovery = fixture("mock-discovery.json");
const jobs = fixture("mock-jobs.json");

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}
function env(overrides = {}) {
  return {
    GALAXY_ENABLED: "true",
    GALAXY_BASE_URL: "https://galaxy.example.invalid",
    GALAXY_API_KEY: "mock-key-not-a-real-secret",
    ...overrides
  };
}
function noSleep() { return async () => {}; }

function discoveryFetch(calls, overrides = {}) {
  return async (input, init = {}) => {
    const url = String(input);
    const method = init.method ?? "GET";
    calls.push({ url, method, body: init.body });
    if (url.endsWith("/api/tools") && method === "POST") {
      const body = JSON.parse(init.body);
      if (body.tool_id === "upload1") return json(jobs.upload);
      return json(jobs.job);
    }
    if (url.endsWith("/api/tools")) return json(discovery.tools);
    if (url.endsWith("/api/workflows")) return json(discovery.workflows);
    if (url.endsWith("/api/version")) return json(discovery.version);
    if (url.endsWith("/api/users/current/usage")) return json(discovery.usage);
    if (url.endsWith("/api/users/current")) return json(discovery.user);
    if (url.endsWith("/api/histories")) return json(jobs.history);
    if (url.endsWith("/api/invocations") && method === "POST") return json(jobs.invocation);
    if (url.endsWith("/api/upload")) return json(jobs.upload);
    if (url.includes("/api/jobs/")) return json(jobs.running_job);
    if (url.includes("/api/histories/") && url.endsWith("/contents")) return json(jobs.contents);
    if (url.includes("/api/datasets/") && url.endsWith("/get_content_as_text")) return json({ item_data: "MOCK BYTES", truncated: false, item_url: "mock://item" });
    if (url.includes("/api/datasets/")) return json(jobs.dataset);
    if (overrides.onRequest) return overrides.onRequest(url, method, init);
    return json({}, 404);
  };
}

test("Galaxy tool submission uses the real job id from jobs[0]", async () => {
  const calls = [];
  const baseFetch = discoveryFetch(calls);
  const fetchImpl = async (input, init = {}) => {
    if (String(input).endsWith("/api/tools") && (init.method ?? "GET") === "POST") {
      return json({
        outputs: [{ id: "mock-output-ds" }],
        jobs: [{ id: "mock-real-galaxy-job", state: "queued" }]
      });
    }
    return baseFetch(input, init);
  };
  const result = await createAdapter(env()).submitJob({
    operation: OPERATIONS.SUBMIT_JOB, tool_id: "mock.tool.alpha",
    history_id: "mock-history-id", inputs: {}, params: {}
  }, { fetch: fetchImpl, sleep: noSleep() });
  assert.equal(result.status, "queued");
  assert.equal(result.provider_job_id, "mock-real-galaxy-job");
  assert.deepEqual(result.output.structured.outputs, ["mock-output-ds"]);
});

test("Galaxy quota parsing handles the live array-of-sources response", async () => {
  const calls = [];
  const baseFetch = discoveryFetch(calls);
  const fetchImpl = async (input, init = {}) => {
    if (String(input).endsWith("/api/users/current/usage")) {
      return json([
        { quota_bytes: 268435456000, total_disk_usage: 0, quota_percent: 0, quota: "268.4 GB" },
        { quota_bytes: 2199023255552, total_disk_usage: 0, quota_source_label: "scratch", quota: "2.2 TB" }
      ]);
    }
    return baseFetch(input, init);
  };
  const limits = await createAdapter(env()).getLimits({ fetch: fetchImpl, sleep: noSleep() });
  assert.equal(limits.units.bytes.total, 268435456000, "primary quota must be selected from the array");
  assert.equal(limits.units.bytes.used, 0);
  assert.equal(limits.units.jobs.total, null, "no invented concurrency quota");
});

test("Galaxy tool/workflow discovery is fully dynamic: no hardcoded expected id", async () => {
  const calls = [];
  const adapter = createAdapter(env());
  const capabilities = await adapter.getCapabilities({ fetch: discoveryFetch(calls), sleep: noSleep() });
  const expectedToolIds = discovery.tools.map((tool) => tool.id);
  assert.deepEqual(capabilities.tools.map((tool) => tool.id), expectedToolIds);
  assert.deepEqual(capabilities.workflows.map((workflow) => workflow.id), discovery.workflows.map((workflow) => workflow.id));
  assert.equal(capabilities.discovery_mode, DISCOVERY_MODE.LIVE);
  assert.equal(capabilities.availability, AVAILABILITY.AVAILABLE);
  assert.ok(capabilities.operations.includes(OPERATIONS.INVOKE_WORKFLOW));
  for (const tool of capabilities.tools) {
    for (const field of ["id", "name", "version", "description", "input_types", "output_types", "parameters", "available", "executable", "source", "discovery_mode"]) {
      assert.ok(Object.hasOwn(tool, field), `${tool.id}: ${field}`);
    }
    const discovered = discovery.tools.find((item) => item.id === tool.id);
    const blocked = discovered.disabled === true;
    assert.equal(tool.available, !blocked);
    assert.equal(tool.executable, !blocked);
    assert.equal(tool.discovery_mode, DISCOVERY_MODE.LIVE);
  }
  const disabledId = discovery.tools.find((tool) => tool.disabled === true).id;
  const disabled = capabilities.tools.find((tool) => tool.id === disabledId);
  assert.equal(disabled.available, false, "disabled tool is discovered but not available");
  assert.equal(disabled.executable, false, "disabled tool must never be executable");
});

test("Galaxy health check and limits use real quota data and keep unknown totals null", async () => {
  const calls = [];
  const adapter = createAdapter(env());
  const fetchImpl = discoveryFetch(calls);
  const health = await adapter.healthCheck({ fetch: fetchImpl, sleep: noSleep() });
  assert.equal(health.ok, true);
  assert.equal(health.status, AVAILABILITY.AVAILABLE);
  assert.equal(health.version, discovery.version.version);
  const limits = await adapter.getLimits({ fetch: fetchImpl, sleep: noSleep() });
  assert.equal(limits.units.bytes.total, discovery.usage.quota_bytes);
  assert.equal(limits.units.bytes.used, discovery.usage.total_disk_usage);
  assert.equal(limits.units.jobs.total, null, "concurrency must remain unknown, never invented");
  assert.equal(limits.units.jobs.unknown, true);
  const usage = await adapter.getUsage({ fetch: fetchImpl, sleep: noSleep() });
  assert.equal(usage.ok, true);
  assert.equal(usage.usage.quota_bytes, discovery.usage.quota_bytes);
});

test("Galaxy submit_job executes a dynamically discovered tool id and uploads inline datasets", async () => {
  const calls = [];
  const adapter = createAdapter(env());
  const toolId = discovery.tools[0].id; // from fixture
  const uploadedId = jobs.upload.outputs[0].id; // from fixture
  const response = await adapter.submitJob({
    operation: OPERATIONS.SUBMIT_JOB,
    tool_id: toolId,
    inputs: { input: { src: "upload", content: "MOCK FASTA", filename: "mock.fasta", extension: "fasta" } },
    params: { mode: "mock-mode" }
  }, { fetch: discoveryFetch(calls), sleep: noSleep() });
  assert.equal(response.status, JOB_STATUS.QUEUED);
  assert.equal(response.provider_job_id, jobs.job.id);
  assert.equal(response.error, undefined);
  const uploadCall = calls.find((call) => call.url.endsWith("/api/tools") && call.method === "POST" && JSON.parse(call.body).tool_id === "upload1");
  assert.ok(uploadCall, "/api/upload is 404 on usegalaxy.eu; upload must use POST /api/tools + upload1");
  assert.equal(calls.some((call) => call.url.endsWith("/api/upload")), false);
  const uploadBody = JSON.parse(uploadCall.body);
  assert.deepEqual(uploadBody.inputs.file1, { file_content: "MOCK FASTA", filename: "mock.fasta", ext: "fasta" });
  const toolCall = calls.find((call) => call.url.endsWith("/api/tools") && call.method === "POST" && JSON.parse(call.body).tool_id === toolId);
  assert.ok(toolCall, "tool execution must use POST /api/tools");
  const body = JSON.parse(toolCall.body);
  assert.equal(body.tool_id, toolId);
  assert.equal(body.inputs.input.src, "hda");
  assert.equal(body.inputs.input.id, uploadedId);
  assert.equal(body.inputs.mode, "mock-mode");
});

test("Galaxy invoke_workflow posts to /api/invocations with the discovered workflow id", async () => {
  const calls = [];
  const adapter = createAdapter(env());
  const workflowId = discovery.workflows[0].id; // from fixture
  const response = await adapter.submitJob({
    operation: OPERATIONS.INVOKE_WORKFLOW,
    workflow_id: workflowId,
    history_id: jobs.history.id,
    inputs: { 0: { src: "hda", id: jobs.upload.outputs[0].id } }
  }, { fetch: discoveryFetch(calls), sleep: noSleep() });
  assert.equal(response.status, JOB_STATUS.QUEUED);
  assert.equal(response.provider_job_id, jobs.invocation.id);
  const invocation = calls.find((call) => call.url.endsWith("/api/invocations") && call.method === "POST");
  assert.equal(JSON.parse(invocation.body).workflow_id, workflowId);
});

test("Galaxy job status, artifacts, cancel and download use documented endpoints", async () => {
  const calls = [];
  const adapter = createAdapter(env());
  const fetchImpl = discoveryFetch(calls);
  const status = await adapter.getJobStatus({ job_id: jobs.job.id }, { fetch: fetchImpl, sleep: noSleep() });
  assert.equal(status.status, JOB_STATUS.RUNNING);
  const artifacts = await adapter.getArtifacts({ history_id: jobs.history.id }, { fetch: fetchImpl, sleep: noSleep() });
  assert.equal(artifacts.ok, true);
  assert.equal(artifacts.artifacts.length, 1);
  assert.equal(artifacts.artifacts[0].id, jobs.contents[0].id);
  const cancelled = await adapter.cancelJob({ job_id: jobs.job.id }, { fetch: fetchImpl, sleep: noSleep() });
  assert.equal(cancelled.status, JOB_STATUS.CANCELLED);
  assert.ok(calls.some((call) => call.url.endsWith("/cancel") && call.method === "POST"));
  const download = await adapter.downloadArtifact({ artifact_id: jobs.dataset.id }, { fetch: fetchImpl, sleep: noSleep() });
  assert.equal(download.ok, true);
  assert.equal(download.content, "MOCK BYTES");
  assert.ok(calls.some((call) => call.url.endsWith("/get_content_as_text")), "content must use the verified text route");
  assert.equal(calls.some((call) => call.url.endsWith("/content")), false, "the old /content route has no endpoint");
});

test("Galaxy retries 503 with bounded exponential backoff and normalizes errors", async () => {
  const calls = [];
  let versionAttempt = 0;
  const adapter = createAdapter(env());
  const fetchImpl = async (input) => {
    const url = String(input);
    calls.push(url);
    if (url.endsWith("/api/version")) {
      versionAttempt += 1;
      if (versionAttempt === 1) return json({ error: "temporarily_unavailable" }, 503);
      return json(discovery.version);
    }
    if (url.endsWith("/api/users/current/usage")) return json(discovery.usage);
    if (url.endsWith("/api/users/current")) return json(discovery.user);
    return json({}, 404);
  };
  const response = await adapter.healthCheck({ fetch: fetchImpl, sleep: noSleep() });
  // version is retried once (2 calls) plus user + usage = 4 total.
  assert.equal(calls.length, 4);
  assert.equal(response.status, AVAILABILITY.AVAILABLE);

  const failed = await adapter.getJobStatus({ job_id: "x" }, {
    fetch: async () => json({ error: "server_error" }, 500), sleep: noSleep()
  });
  assert.equal(failed.status, JOB_STATUS.UNKNOWN);
  assert.equal(failed.error.provider, "galaxy");
  assert.equal(failed.error.code, "server_error");
  assert.equal(failed.error.retryable, true);
});

test("Galaxy validates requests and honors AbortSignal timeouts", async () => {
  const adapter = createAdapter(env());
  const invalid = adapter.validateRequest(OPERATIONS.CHAT, { message: "not supported" });
  assert.equal(invalid.valid, false);
  assert.equal(invalid.error, "operation_not_supported");
  const valid = adapter.validateRequest(OPERATIONS.SUBMIT_JOB, { tool_id: discovery.tools[0].id });
  assert.equal(valid.valid, true);
  assert.equal(valid.normalized.tool_id, discovery.tools[0].id);

  const controller = new AbortController();
  controller.abort();
  const response = await adapter.submitJob({ operation: OPERATIONS.SUBMIT_JOB, tool_id: discovery.tools[0].id }, {
    fetch: async () => { throw new Error("must not run when aborted"); },
    signal: controller.signal,
    sleep: noSleep()
  });
  assert.equal(response.status, "failed");
  assert.ok(response.error);
});

test("Galaxy rejects malformed ids and accepts provider_job_id as an alias", async () => {
  const adapter = createAdapter(env());
  assert.equal(adapter.validateRequest(OPERATIONS.JOB_STATUS, { job_id: "../etc/passwd" }).error, "malformed_job_id");
  assert.equal(adapter.validateRequest(OPERATIONS.SUBMIT_JOB, { tool_id: "bad id" }).error, "malformed_tool_id");
  assert.equal(adapter.validateRequest(OPERATIONS.JOB_STATUS, { provider_job_id: jobs.job.id }).valid, true);

  const calls = [];
  const fetchImpl = discoveryFetch(calls);
  const status = await adapter.getJobStatus({ provider_job_id: jobs.job.id }, { fetch: fetchImpl, sleep: noSleep() });
  assert.equal(status.status, JOB_STATUS.RUNNING);
  const cancel = await adapter.cancelJob({ provider_job_id: jobs.job.id }, { fetch: fetchImpl, sleep: noSleep() });
  assert.equal(cancel.status, JOB_STATUS.CANCELLED);
  const artifacts = await adapter.getArtifacts({ provider_job_id: jobs.job.id }, { fetch: fetchImpl, sleep: noSleep() });
  assert.equal(artifacts.ok, true);
  const usage = await adapter.getUsage({ provider_job_id: jobs.job.id }, { fetch: fetchImpl, sleep: noSleep() });
  assert.equal(usage.provider_job_id, jobs.job.id);
});

test("Galaxy propagates the account-activation 403 instead of faking upload success", async () => {
  const adapter = createAdapter(env());
  const fetchImpl = async (input, init = {}) => {
    const url = String(input);
    const method = init.method ?? "GET";
    if (method === "POST" && url.endsWith("/api/histories")) return json(jobs.history);
    if (method === "POST" && url.endsWith("/api/tools")) {
      return json({ error: "action_requires_account_activation", message: "Action requires account activation" }, 403);
    }
    return json({}, 404);
  };
  const response = await adapter.submitJob({
    operation: OPERATIONS.SUBMIT_JOB,
    tool_id: discovery.tools[0].id,
    inputs: { input: { src: "upload", content: "MOCK", filename: "mock.txt" } }
  }, { fetch: fetchImpl, sleep: noSleep() });
  assert.equal(response.status, "failed");
  assert.equal(response.error.status, 403);
  assert.equal(response.error.retryable, false);
  assert.equal(response.provider_job_id, null);
  assert.deepEqual(response.output, {});
});
