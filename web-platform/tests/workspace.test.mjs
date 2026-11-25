import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { publicCatalog, getWorkflow } from "../providers/workspace/catalog.js";
import { canTransition, runSummary, RUN_STATES } from "../providers/workspace/states.js";
import {
  CATALOG_VERSION,
  listWorkflows,
  WORKFLOW_IDS
} from "../functions/api/workspace/catalog.js";
import { STATE_TRANSITIONS, WORKSPACE_STATES } from "../functions/api/workspace/_lib.js";
import { onRequest as catchAll } from "../functions/api/workspace/index.js";
import { makeRequest, TOKEN_A } from "./helpers/workspace.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const AUTHORITATIVE_IDS = ["16s-rrna-identification", "msa-phylogenetics"];

test("M7.4 browser-facing catalog has exactly the two authoritative workflows", () => {
  const catalog = publicCatalog();
  assert.equal(catalog.length, 2);
  assert.deepEqual(catalog.map((workflow) => workflow.id), AUTHORITATIVE_IDS);
  assert.deepEqual(WORKFLOW_IDS, AUTHORITATIVE_IDS);
});

test("M7.4 shim and authoritative catalog never drift", () => {
  assert.deepEqual(publicCatalog(), listWorkflows());
  assert.deepEqual(publicCatalog().map((workflow) => workflow.id), listWorkflows().map((workflow) => workflow.id));
  for (const id of AUTHORITATIVE_IDS) {
    assert.deepEqual(getWorkflow(id), listWorkflows().find((workflow) => workflow.id === id));
  }
});

test("M7.4 catalog exposes authoritative availability states and scientific fields", () => {
  const identification = getWorkflow("16s-rrna-identification");
  const phylo = getWorkflow("msa-phylogenetics");
  assert.equal(identification.execution_availability.state, "available-browser-and-local-agent");
  assert.equal(identification.execution_availability.production_ready, true);
  assert.ok(identification.supported_formats.includes("fasta"));
  assert.ok(identification.scientific_purpose.length > 0);
  assert.ok(identification.expected_outputs.includes("taxonomy assignments"));

  assert.equal(phylo.execution_availability.state, "partial-not-production-ready");
  assert.equal(phylo.execution_availability.production_ready, false);
  assert.match(phylo.execution_availability.note, /M7_3_PHYLOGENETICS_WORKFLOW_REPORT\.md/);
  assert.match(phylo.execution_availability.note, /NOT verified|not verified/);
  assert.ok(phylo.required_parameters.includes("sequences"));
});

test("M7.4 state shim re-exports the one authoritative transition map", () => {
  assert.equal(RUN_STATES, WORKSPACE_STATES);
  assert.equal(Object.keys(STATE_TRANSITIONS).length, WORKSPACE_STATES.length);
  assert.deepEqual(RUN_STATES, [
    "draft", "planned", "awaiting_approval", "queued", "running",
    "execution_completed", "artifact_retrieval", "validation", "succeeded", "failed", "cancelled"
  ]);
});

test("M7.4 run lifecycle transitions are explicit", () => {
  assert.equal(canTransition("draft", "planned"), true);
  assert.equal(canTransition("planned", "queued"), false);
  assert.equal(canTransition("awaiting_approval", "queued"), true);
  assert.equal(canTransition("running", "execution_completed"), true);
  assert.equal(canTransition("execution_completed", "artifact_retrieval"), true);
  assert.equal(canTransition("artifact_retrieval", "validation"), true);
  assert.equal(canTransition("validation", "succeeded"), true);
  assert.equal(canTransition("succeeded", "running"), false);
});

test("M7.4 stage reporting never claims success from a partial stage", () => {
  const mid = runSummary({ state: "execution_completed" });
  assert.equal(mid.execution_completed, true);
  assert.equal(mid.artifact_retrieved, false);
  assert.equal(mid.validated, false);
  assert.equal(mid.full_workflow_completed, false);
  const done = runSummary({ state: "succeeded" });
  assert.equal(done.full_workflow_completed, true);
});

test("M7.4 catch-all catalog alias matches the authoritative workflow endpoint shape", async () => {
  const response = await catchAll({ request: makeRequest("GET", "/api/workspace/catalog"), env: { AI_AGENT_TOKEN: TOKEN_A, BLAST_DB: {} } });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("X-Content-Type-Options"), "nosniff");
  assert.match(response.headers.get("Content-Security-Policy"), /default-src 'none'/);
  const body = await response.json();
  assert.equal(body.catalog_version, CATALOG_VERSION);
  assert.equal(body.count, 2);
  assert.deepEqual(body.workflows.map((workflow) => workflow.id), AUTHORITATIVE_IDS);
  assert.equal(typeof body.execution_mode, "string");
});

test("M7.4 catch-all requires the operator token and 404s all other paths", async () => {
  const env = { AI_AGENT_TOKEN: TOKEN_A, BLAST_DB: {} };
  const denied = await catchAll({ request: makeRequest("GET", "/api/workspace/catalog", null), env });
  assert.equal(denied.status, 401);
  for (const path of ["/api/workspace/projects", "/api/workspace/runs/run_1", "/api/workspace/anything-else"]) {
    const response = await catchAll({ request: makeRequest("GET", path), env });
    assert.equal(response.status, 404, path);
    assert.match(response.headers.get("Content-Type"), /application\/json/);
    assert.equal(response.headers.get("X-Content-Type-Options"), "nosniff");
    assert.equal((await response.json()).error, "Workspace route not found.");
  }
});

test("M7.4 catch-all shim contains no SQL for nonexistent tables", () => {
  const source = readFileSync(resolve(HERE, "../functions/api/workspace/index.js"), "utf8");
  assert.doesNotMatch(source, /workspace_projects|workspace_datasets/);
  assert.match(source, /handleDemo/);
});

test("M7.4 demo UI labels sample data as precomputed", () => {
  const text = readFileSync(resolve(HERE, "../public/js/workspace.js"), "utf8");
  assert.ok(text.includes("/api/workspace/demo"));
  const html = readFileSync(resolve(HERE, "../public/workspace.html"), "utf8");
  assert.ok(html.includes("precomputed"));
});
