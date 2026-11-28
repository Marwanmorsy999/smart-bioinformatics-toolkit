import test from "node:test";
import assert from "node:assert/strict";
import {
  CATALOG_VERSION,
  WORKFLOWS,
  WORKFLOW_IDS,
  getWorkflow,
  isKnownWorkflow,
  listWorkflows
} from "../functions/api/workspace/catalog.js";
import { handleListWorkflows } from "../functions/api/workspace/workflows.js";
import { createFakeD1AI, mockAIEnv } from "./helpers/fake-d1.mjs";
import { makeRequest, TOKEN_A } from "./helpers/workspace.mjs";

test("catalog is versioned static data with exactly two workflows", () => {
  assert.equal(typeof CATALOG_VERSION, "string");
  assert.ok(CATALOG_VERSION.includes("m7.4"));
  assert.equal(WORKFLOWS.length, 2);
  assert.deepEqual(WORKFLOW_IDS, ["16s-rrna-identification", "msa-phylogenetics"]);
});

test("catalog entries expose every required scientific field", () => {
  for (const workflow of WORKFLOWS) {
    assert.equal(typeof workflow.id, "string");
    assert.equal(typeof workflow.version, "string");
    assert.equal(typeof workflow.scientific_purpose, "string");
    assert.equal(typeof workflow.expected_input, "string");
    assert.ok(Array.isArray(workflow.supported_formats));
    assert.ok(Array.isArray(workflow.required_parameters));
    assert.ok(Array.isArray(workflow.expected_outputs));
    assert.ok(Array.isArray(workflow.validation_capabilities));
    assert.equal(typeof workflow.execution_availability.state, "string");
    assert.equal(typeof workflow.execution_availability.production_ready, "boolean");
  }
});

test("16S availability is stated as browser + local agent", () => {
  const workflow = getWorkflow("16s-rrna-identification");
  assert.equal(workflow.execution_availability.state, "available-browser-and-local-agent");
  assert.equal(workflow.execution_availability.production_ready, true);
  assert.ok(workflow.supported_formats.includes("fasta"));
});

test("phylogenetics availability is honest about M7.3 evidence", () => {
  const workflow = getWorkflow("msa-phylogenetics");
  assert.equal(workflow.execution_availability.state, "partial-not-production-ready");
  assert.equal(workflow.execution_availability.production_ready, false);
  assert.match(workflow.execution_availability.note, /M7_3_PHYLOGENETICS_WORKFLOW_REPORT\.md/);
  assert.match(workflow.execution_availability.note, /NOT verified|not verified/);
});

test("getWorkflow and isKnownWorkflow reject unknown ids without throwing", () => {
  assert.equal(getWorkflow("nonexistent"), null);
  assert.equal(getWorkflow(undefined), null);
  assert.equal(isKnownWorkflow("msa-phylogenetics"), true);
  assert.equal(isKnownWorkflow("galaxy-production"), false);
});

test("listWorkflows returns copies so callers cannot mutate the catalog", () => {
  const copy = listWorkflows();
  copy[0].execution_availability.state = "tampered";
  assert.equal(getWorkflow("16s-rrna-identification").execution_availability.state, "available-browser-and-local-agent");
});

test("workflow endpoint requires the operator token", async () => {
  const { db } = createFakeD1AI();
  const env = mockAIEnv(db, TOKEN_A);
  const noToken = await handleListWorkflows(makeRequest("GET", "/api/workspace/workflows", null), env);
  assert.equal(noToken.status, 401);
  const wrongToken = await handleListWorkflows(makeRequest("GET", "/api/workspace/workflows", "wrong"), env);
  assert.equal(wrongToken.status, 401);
});

test("workflow endpoint returns the versioned catalog with security headers", async () => {
  const { db } = createFakeD1AI();
  const env = mockAIEnv(db, TOKEN_A);
  const response = await handleListWorkflows(makeRequest("GET", "/api/workspace/workflows"), env);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("X-Content-Type-Options"), "nosniff");
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.match(response.headers.get("Content-Security-Policy"), /default-src 'none'/);
  const body = await response.json();
  assert.equal(body.catalog_version, CATALOG_VERSION);
  assert.equal(body.count, 2);
  assert.deepEqual(body.workflows.map((workflow) => workflow.id), WORKFLOW_IDS);
  assert.equal(body.execution_mode, "real");
});
