// M7.14.2 DIAGNOSTIC HARDENING — LABELLED STUBBED TESTS — ZERO live calls.
//
// Staging returned an empty HTTP 500 from GET /import-schema while the local
// fixtures passed. These tests prove that a malformed/minimal live case is
// reported honestly and that any unexpected throw becomes a JSON 500 whose
// detail contains only a sanitized error name/message/stack (no secrets,
// provider responses or schema payloads).
import test from "node:test";
import assert from "node:assert/strict";
import { handleImportSchema } from "../functions/api/ai/workflows/microbiome/engine.js";
import { describeImportCase } from "../functions/api/ai/workflows/microbiome/schema.js";
import { createFakeD1AI, mockAIEnv } from "./helpers/fake-d1.mjs";

const IMPORT_TOOL = "toolshed.g2.bx.psu.edu/repos/q2d2/qiime2_core__tools__import/2026.1.0+dist.h02a552c2";
const SECRET = "stub-secret";
function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}
async function withStub(stub, fn) {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = stub;
  try { return await fn(); } finally { globalThis.fetch = previousFetch; }
}
function envFor() {
  return { GALAXY_ENABLED: "true", GALAXY_BASE_URL: "https://galaxy.example.test",
    GALAXY_API_KEY: SECRET, ...mockAIEnv(createFakeD1AI().db) };
}
function toolsList() {
  return [{ id: IMPORT_TOOL, name: "qiime2 tools import", version: "2026.1.0",
    model_class: "Tool", available: true }];
}

test("LABELLED STUB / malformed matched case is reported honestly, never thrown", () => {
  const schema = { tool_id: IMPORT_TOOL, inputs: [{ model_class: "DataToolParameter", name: "input" }] };
  const absentEntry = describeImportCase(schema, { caseEntry: null, selectors: null });
  assert.equal(absentEntry.available, false);
  assert.match(absentEntry.reason, /case metadata is incomplete/);
  const partialSelector = describeImportCase(schema, {
    caseEntry: { inputs: [] }, selectors: [{ name: "import_root|type" }] });
  assert.equal(partialSelector.available, false);
  assert.match(partialSelector.reason, /case metadata is incomplete/);

  // Even when the case exists but the live extensions field has the wrong
  // shape, the read-only view degrades instead of throwing.
  const oddExtensions = describeImportCase(schema, {
    caseEntry: { inputs: [
      { model_class: "DataToolParameter", name: "input_1", extensions: "fastq.gz" },
      { model_class: "DataToolParameter", name: "input_2", extensions: { nested: true } }
    ] },
    prefix: "import_root|", selectors: [{ name: "import_root|type", value: "EMPSingleEndSequences" }],
    evidence: { format: "not-an-object" }
  });
  assert.equal(oddExtensions.available, true);
  assert.deepEqual(oddExtensions.inputs.map((entry) => entry.extensions), [[], []]);
  assert.equal(oddExtensions.chosen_mapping, null, "ambiguous mapping is not presented as a mapping");
  assert.equal(oddExtensions.case_evidence.format, null);
});

test("LABELLED STUB / unexpected throw becomes JSON 500 with sanitized detail, zero POSTs", async () => {
  const calls = [];
  const fetchImpl = async (input, init = {}) => {
    const url = String(input);
    const method = String(init.method ?? "GET").toUpperCase();
    calls.push({ method, url });
    assert.notEqual(method, "POST", "the diagnostic endpoint must never submit a job");
    if (method === "GET" && (url.includes("/api/tools?") || url.endsWith("/api/tools"))) return json(toolsList());
    if (url.includes("io_details=true")) return json({ tool_id: IMPORT_TOOL,
      inputs: [{ model_class: "DataToolParameter", name: "input", extensions: ["fastq.gz"] }] });
    if (url.includes("/api/workflows")) return json([]);
    return json({ error: "unexpected_stub_route", url }, 404);
  };
  // A request-like object whose URL getter throws exercises the outer catch;
  // its message deliberately contains the configured key to test redaction.
  const request = { method: "GET", headers: new Headers(),
    get url() { throw new Error(`${SECRET} leaked in url getter`); } };
  const response = await withStub(fetchImpl, () => handleImportSchema(request, envFor(), { fetchImpl }));
  assert.equal(response.status, 500);
  const body = await response.json();
  assert.equal(body.available, false);
  assert.equal(body.error, "import_schema_handler_failed");
  assert.equal(body.detail.name, "Error");
  assert.match(body.detail.message, /leaked in url getter/);
  assert.ok(body.detail.message.length <= 300);
  assert.ok(body.detail.stack.length <= 500);
  assert.equal(JSON.stringify(body).includes(SECRET), false, "no secret is returned");
  assert.equal(body.schema, undefined, "no schema payload is returned");
  assert.equal(calls.some((call) => call.method === "POST"), false);
});

test("LABELLED STUB / provider schema error is a 200 with redacted reason", async () => {
  const fetchImpl = async (input, init = {}) => {
    const url = String(input);
    const method = String(init.method ?? "GET").toUpperCase();
    assert.notEqual(method, "POST", "the diagnostic endpoint must never submit a job");
    if (method === "GET" && (url.includes("/api/tools?") || url.endsWith("/api/tools"))) return json(toolsList());
    if (url.includes("io_details=true")) throw new Error(`X-API-Key: ${SECRET}`);
    if (url.includes("/api/workflows")) return json([]);
    return json({ error: "unexpected_stub_route", url }, 404);
  };
  const request = new Request("https://galaxy.example.test/api/ai/workflows/microbiome/import-schema",
    { method: "GET" });
  const response = await withStub(fetchImpl, () => handleImportSchema(request, envFor(), { fetchImpl }));
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.available, false);
  assert.match(body.reason, /X-API-Key=\[redacted\]/i);
  assert.equal(JSON.stringify(body).includes(SECRET), false);
});
