// M7.14 tool-registry / assistant / routing tests. All provider calls stubbed.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { getTool, isKnownTool, validateParams } from "../functions/api/ai/registry.js";
import { getAssistantToolDefinitions, executeTool } from "../functions/api/assistant/tools.js";
import {
  MICROBIOME_ASSISTANT_TOOL_IDS, getMicrobiomeToolDefinitions
} from "../functions/api/assistant/microbiome-tools.js";
import { createFetch, handlers } from "../worker.js";
import { createFakeD1AI, makeGetRequest, makePostRequest, mockAIEnv } from "./helpers/fake-d1.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const fixture = (name) => readFileSync(resolve(HERE, "fixtures/m7_14_microbiome", name), "utf8");
const PAYLOAD = {
  reads_text: fixture("sequences.fastq"),
  barcodes_text: fixture("barcodes.fastq"),
  metadata_text: fixture("sample-metadata.tsv")
};

test("REGISTRY: four genuine microbiome capabilities with strict schemas", () => {
  for (const id of MICROBIOME_ASSISTANT_TOOL_IDS) {
    assert.equal(isKnownTool(id), true, `${id} is not registered`);
    const tool = getTool(id);
    assert.equal(tool.version, "1.0.0-m7.14");
    assert.equal(tool.domain, "microbiome-16s");
    assert.ok(tool.params_schema?.required?.length);
    assert.ok(tool.limitations.length);
  }
  assert.equal(validateParams("microbiome.get_result", { run_id: "job_1" }).valid, true);
  assert.equal(validateParams("microbiome.get_result", { invented: true }).valid, false);
  assert.equal(validateParams("microbiome.validate", { mode: "public", extra: 1 }).valid, false);
  const definitions = getAssistantToolDefinitions().map((entry) => entry.function.name);
  for (const id of MICROBIOME_ASSISTANT_TOOL_IDS) assert.ok(definitions.includes(id));
  assert.equal(getMicrobiomeToolDefinitions().length, 4);
});

test("EXECUTOR: validate returns real input evidence with stubbed tool discovery", async () => {
  const stub = async (input) => {
    const url = String(input);
    if (url.includes("/api/tools?") || url.endsWith("/api/tools")) {
      return new Response(JSON.stringify([]), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    if (url.includes("/api/workflows")) {
      return new Response(JSON.stringify([]), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    return new Response(JSON.stringify({ error: "unexpected" }), { status: 404 });
  };
  const previous = globalThis.fetch;
  globalThis.fetch = stub;
  try {
    const response = await executeTool("microbiome.validate", { mode: "upload", ...PAYLOAD },
      { env: mockAIEnv(createFakeD1AI().db), fetch: stub });
    assert.equal(response.ok, true);
    assert.equal(response.tool_id, "microbiome.validate");
    assert.equal(response.output.validation.status, "pass");
    assert.equal(response.output.input.sample_count, 3);
    assert.match(response.result_card.summary, /No workflow was submitted/);
  } finally { globalThis.fetch = previous; }
});

test("EXECUTOR: chat never submits a workflow and unregistered tools are refused", async () => {
  const refused = await executeTool("microbiome.run", { action: "run", ...PAYLOAD }, {});
  assert.equal(refused.ok, false);
  assert.equal(refused.error.code, "submission_requires_approval_gate");
  const annotate = await executeTool("microbiome.annotate", { action: "run", ...PAYLOAD }, {});
  assert.equal(annotate.ok, false);
  const unknown = await executeTool("microbiome.invented", {}, {});
  assert.equal(unknown.ok, false);
  assert.equal(unknown.error.code, "unknown_tool");
});

test("EXECUTOR: get_result reads stored D1 records and honest nulls", async () => {
  const { db } = createFakeD1AI({ microbiome_runs: [{ public_id: "job_aaaaaaaaaaaaaaaa", state: "succeeded",
    result_json: JSON.stringify({ workflow_type: "microbiome", asv: { feature_count: 3 } }) }] });
  const env = mockAIEnv(db);
  const found = await executeTool("microbiome.get_result", { run_id: "job_aaaaaaaaaaaaaaaa" }, { env });
  assert.equal(found.ok, true);
  assert.equal(found.output.result.asv.feature_count, 3);
  const missing = await executeTool("microbiome.get_result", { run_id: "job_bbbbbbbbbbbbbbbb" }, { env });
  assert.equal(missing.ok, true);
  assert.equal(missing.output.result, null);
  assert.match(missing.output.reason, /No such microbiome run/);
});

test("ROUTING: microbiome API paths are registered before generic AI routes", () => {
  for (const key of ["microbiomePlan", "microbiomeRun", "microbiomeStatus", "microbiomeResult"]) {
    assert.equal(typeof handlers[key], "function");
  }
  const env = { ASSETS: null };
  const fetch = createFetch({
    ...handlers,
    microbiomePlan: () => new Response("plan", { status: 200 }),
    microbiomeRun: () => new Response("run", { status: 202 }),
    microbiomeStatus: () => new Response("status", { status: 200 }),
    microbiomeResult: () => new Response("result", { status: 200 })
  });
  return (async () => {
    for (const [path, text] of [["/api/ai/workflows/microbiome/plan", "plan"],
      ["/api/ai/workflows/microbiome/run", "run"],
      ["/api/ai/workflows/microbiome/status", "status"],
      ["/api/ai/workflows/microbiome/result", "result"]]) {
      const response = await fetch(makeGetRequest(path), env);
      assert.equal(response.status, path.endsWith("run") ? 202 : 200);
      assert.equal(await response.text(), text);
    }
    const missing = await fetch(makeGetRequest("/api/ai/workflows/microbiome/unknown"), env);
    assert.equal(missing.status, 404);
  })();
});
