// M7.1 smarts.bio AlphaFold lookup regression - OFFLINE.
// Uses only the synthetic MOCK fixtures under tests/fixtures/providers/smartsbio
// through an injected fetch. No real endpoint, no credential, no live call.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { createAdapter } from "../providers/smartsbio/index.js";
import { JOB_STATUS, OPERATIONS } from "../providers/common/contract.js";

const FIXTURES = new URL("./fixtures/providers/smartsbio/", import.meta.url);
function fixture(name) {
  return JSON.parse(readFileSync(new URL(name, FIXTURES), "utf8"));
}
const workspaces = fixture("mock-workspaces.json");
const tools = fixture("mock-tools.json");
const alphafold = fixture("mock-alphafold-db.json");

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}
function env() {
  return {
    SMARTSBIO_ENABLED: "true",
    SMARTSBIO_PUBLIC_AUTHORIZED: "true",
    SMARTSBIO_BASE_URL: "https://m7-1-smarts.example.invalid/v1",
    SMARTSBIO_API_KEY: "mock-key-not-a-real-secret",
    SMARTSBIO_WORKSPACE_ID: workspaces.data[0].id
  };
}
function noSleep() { return async () => {}; }

test("AlphaFold lookup uses the singular input key and yields a normalized succeeded result with artifacts", async () => {
  // Derive the tool id from the MOCK catalog rather than hardcoding it here.
  const tool = tools.tools.find((entry) => String(entry.id).startsWith("alphafold-db"));
  assert.ok(tool, "the MOCK catalog must contain an alphafold-db tool");
  const toolId = tool.id;

  const calls = [];
  const fetchImpl = async (input, init = {}) => {
    const url = String(input);
    const method = init.method ?? "GET";
    calls.push({ url, method, body: init.body });
    if (url.includes("/v1/workspaces")) return json(workspaces);
    if (url.includes("/v1/tools") && method === "POST") return json(alphafold);
    if (url.includes("/v1/tools")) return json(tools);
    return json({ status: "error", error: "not_found" }, 404);
  };
  const adapter = createAdapter(env());
  const lookupInput = { query_type: "uniprot", identifier: "P04637", format: "json", limit: 1 };
  const result = await adapter.submitJob({
    operation: OPERATIONS.SUBMIT_JOB, tool_id: toolId, input: lookupInput
  }, { fetch: fetchImpl, sleep: noSleep() });

  assert.equal(result.status, JOB_STATUS.SUCCEEDED);
  assert.equal(result.provider, "smartsbio");
  assert.ok(result.provider_job_id);
  assert.ok(result.submitted_at);

  const runCall = calls.find((call) => call.url.includes(`/v1/tools/${encodeURIComponent(toolId)}/run`));
  assert.ok(runCall, "the lookup must go through POST /v1/tools/:id/run");
  assert.equal(runCall.method, "POST");
  const body = JSON.parse(runCall.body);
  // VERIFIED contract: the parameter map is the singular `input` key.
  assert.deepEqual(body.input, lookupInput);
  assert.equal(Object.hasOwn(body, "input"), true);
  assert.equal(Object.hasOwn(body, "inputs"), false, "`inputs` is rejected upstream");
  assert.equal(Object.hasOwn(body, "parameters"), false, "`parameters` is rejected upstream");
  assert.equal(Object.hasOwn(body, "query_type"), false, "flat parameters are rejected upstream");
  assert.equal(body.workspace_id, workspaces.data[0].id);

  // Normalized result: the verified success envelope is unwrapped into output.
  assert.deepEqual(result.output.structured, alphafold.result.data);
  assert.ok(Array.isArray(result.output.structured.output_paths));
  assert.ok(result.output.structured.output_paths.length > 0, "a succeeded lookup must expose artifact paths");

  // Expected-result regression check (values from the MOCK fixture).
  assert.equal(result.output.structured.gene, "TP53");
  assert.equal(result.output.structured.uniprot_id, "P04637");
  assert.match(result.output.structured.model_identifier, /^AF-P04637/);

  const artifacts = await adapter.getArtifacts({ job_id: result.provider_job_id }, { fetch: fetchImpl, sleep: noSleep() });
  assert.equal(artifacts.ok, true);
  assert.deepEqual(artifacts.artifacts.map((item) => item.key), alphafold.result.data.output_paths);
});

test("the AlphaFold regression stays disabled without the written-authorization gate", async () => {
  const calls = [];
  const fetchImpl = async () => { calls.push("call"); return json(alphafold); };
  const adapter = createAdapter({ ...env(), SMARTSBIO_PUBLIC_AUTHORIZED: "false" });
  const result = await adapter.submitJob({
    operation: OPERATIONS.SUBMIT_JOB, tool_id: "alphafold-db", input: { query_type: "uniprot", identifier: "P04637" }
  }, { fetch: fetchImpl, sleep: noSleep() });
  assert.equal(result.status, JOB_STATUS.FAILED);
  assert.equal(result.error.code, "public_authorization_required");
  assert.deepEqual(calls, [], "a gated adapter must not make any HTTP call");
});
