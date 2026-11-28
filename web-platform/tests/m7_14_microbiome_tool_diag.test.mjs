// M7.14.3 LABELLED STUBBED TOOL-DIAGNOSTIC TESTS — ZERO live calls.
// The two GET-only endpoints expose structural tool metadata so an operator
// can see the LIVE export formats and installed BIOM tools. No job, upload,
// dataset id, credential, URL or raw tool body leaves either boundary.
import test from "node:test";
import assert from "node:assert/strict";

import {
  handleToolSchema, handleToolSearch
} from "../functions/api/ai/workflows/microbiome/engine.js";
import { makeGetRequest } from "./helpers/fake-d1.mjs";

const TOOL_ID = "toolshed.g2.bx.psu.edu/repos/q2d2/qiime2_core__tools__export";
const TEST_KEY = "stub-key-not-a-real-secret";
const BASE = "https://galaxy.example.test";

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function envFor(fetchImpl) {
  return { GALAXY_ENABLED: "true", GALAXY_BASE_URL: BASE, GALAXY_API_KEY: TEST_KEY,
    FETCH_IMPL: fetchImpl };
}

test("TOOL SCHEMA / read-only structural summary of FeatureTable cases and top-level fields", async () => {
  const calls = [];
  const fetchImpl = async (input, init = {}) => {
    calls.push({ url: String(input), method: String(init.method ?? "GET") });
    assert.match(String(input), /\/api\/tools\//);
    assert.match(String(input), /io_details=true/);
    return json({ tool_id: TOOL_ID, inputs: [
      { model_class: "Select", name: "mode", options: [{ label: "secret-value", value: "raw-body" }] },
      { model_class: "Conditional", name: "format_choice", cases: [
        { value: "FeatureTable[Frequency]", inputs: [
          { name: "output_format", options: [
            { label: "BIOM v1 JSON", value: "biom1" }, { label: "TSV", value: "tsv" }
          ] },
          { name: "hidden", value: "https://secret.example.test/?key=" + TEST_KEY }
        ] },
        { value: "Sequences", inputs: [{ name: "output_format", options: [{ label: "FASTA", value: "fasta" }] }] }
      ] }
    ] });
  };
  const previous = globalThis.fetch;
  globalThis.fetch = fetchImpl;
  try {
    const response = await handleToolSchema(makeGetRequest(
      `/api/ai/workflows/microbiome/tool-schema?tool_id=${encodeURIComponent(TOOL_ID)}&version=2026.1.0`),
    envFor(fetchImpl), { fetchImpl });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.available, true);
    assert.equal(body.tool_id, TOOL_ID);
    assert.equal(body.version, "2026.1.0");
    assert.equal(body.feature_table_cases.length, 1);
    assert.equal(body.feature_table_cases[0].value, "FeatureTable[Frequency]");
    assert.deepEqual(body.feature_table_cases[0].output_format,
      [["BIOM v1 JSON", "biom1"], ["TSV", "tsv"]]);
    assert.ok(body.top_level_fields.some((field) => field.name === "mode" && field.type === "Select"));
    assert.ok(body.top_level_fields.some((field) => field.name === "format_choice" && field.type === "Conditional"));
    assert.doesNotMatch(JSON.stringify(body), new RegExp(TEST_KEY));
    assert.doesNotMatch(JSON.stringify(body), /https:\/\/|raw-body|secret-value|hidden/);
    assert.equal(calls.length, 1);
    assert.ok(calls.every((call) => call.method === "GET"));
  } finally { globalThis.fetch = previous; }
});

test("TOOL SCHEMA / malformed or missing tool_id is refused before any fetch", async () => {
  let fetched = 0;
  const fetchImpl = async () => { fetched += 1; return json({}); };
  const previous = globalThis.fetch;
  globalThis.fetch = fetchImpl;
  try {
    for (const bad of ["", "../../etc/passwd", "a b", "id?x=1"]) {
      const response = await handleToolSchema(makeGetRequest(
        `/api/ai/workflows/microbiome/tool-schema?tool_id=${encodeURIComponent(bad)}`),
      envFor(fetchImpl), { fetchImpl });
      assert.equal(response.status, 400);
    }
    assert.equal(fetched, 0, "no provider fetch for an invalid tool_id");
  } finally { globalThis.fetch = previous; }
});

test("TOOL SEARCH / read-only tool lookup returns only bounded id/name/version", async () => {
  const calls = [];
  const fetchImpl = async (input, init = {}) => {
    calls.push({ url: String(input), method: String(init.method ?? "GET") });
    assert.equal(String(input), `${BASE}/api/tools?q=biom&limit=50`);
    return json([{ id: "panel", name: "Panel", model_class: "ToolSection", elems: [
      { id: "biom-convert", name: "BIOM to TSV", version: "1.0", model_class: "Tool", available: true },
      { id: "disabled-tool", name: "disabled", version: "2.0", model_class: "Tool", available: false }
    ] }]);
  };
  const response = await handleToolSearch(makeGetRequest(
    "/api/ai/workflows/microbiome/tool-search?query=biom"), envFor(fetchImpl), { fetchImpl });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.available, true);
  assert.deepEqual(body.tools, [{ id: "biom-convert", name: "BIOM to TSV", version: "1.0" }]);
  const text = JSON.stringify(body);
  assert.doesNotMatch(text, new RegExp(TEST_KEY));
  assert.doesNotMatch(text, /disabled-tool|ToolSection|https:\/\//);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, "GET");
});

test("TOOL SEARCH / a too-short query is refused before any fetch", async () => {
  let fetched = 0;
  const fetchImpl = async () => { fetched += 1; return json([]); };
  const response = await handleToolSearch(makeGetRequest(
    "/api/ai/workflows/microbiome/tool-search?query=x"), envFor(fetchImpl), { fetchImpl });
  assert.equal(response.status, 400);
  assert.equal(fetched, 0);
});

test("ROUTING / tool-schema and tool-search reach their registered Worker handlers", async () => {
  const { createFetch, handlers } = await import("../worker.js");
  const seen = [];
  const map = { ...handlers,
    microbiomeToolSchema: async () => { seen.push("schema"); return new Response("schema"); },
    microbiomeToolSearch: async () => { seen.push("search"); return new Response("search"); } };
  const workerFetch = createFetch(map);
  await workerFetch(new Request("https://app.example.test/api/ai/workflows/microbiome/tool-schema?tool_id=x"), {}, {});
  await workerFetch(new Request("https://app.example.test/api/ai/workflows/microbiome/tool-search?query=biom"), {}, {});
  assert.deepEqual(seen, ["schema", "search"]);
});
