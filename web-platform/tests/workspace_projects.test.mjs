import test from "node:test";
import assert from "node:assert/strict";
import { onRequest as projectsOnRequest, handleCreateProject, handleListProjects } from "../functions/api/workspace/projects/index.js";
import { handleGetProject, handlePatchProject } from "../functions/api/workspace/projects/[id]/index.js";
import { handleArchiveProject } from "../functions/api/workspace/projects/[id]/archive.js";
import { handleActivateProject } from "../functions/api/workspace/projects/[id]/activate.js";
import { makeRequest, TOKEN_A, TOKEN_B, ownerOf, newWorkspaceEnv, SHA256_A } from "./helpers/workspace.mjs";

const PROJECT_A = "proj_1111111111111111";
const PROJECT_B = "proj_2222222222222222";

function sequentialIds() {
  let counter = 0;
  return (prefix) => `${prefix}_${(++counter).toString(16).padStart(16, "0")}`;
}

function validPayload(extra = {}) {
  return {
    name: "16S isolate study",
    description: "Field isolates from coastal water",
    scientific_objective: "Resolve species-level identities",
    status: "active",
    ...extra
  };
}

function seedWithTwoOwners(ownerA, ownerB) {
  return {
    projects: [
      { public_id: PROJECT_A, name: "Mine", owner: ownerA, status: "active", created_at: "2026-11-26T00:00:00.000Z" },
      { public_id: PROJECT_B, name: "Their project", owner: ownerB, status: "active", created_at: "2026-11-26T00:00:00.000Z" }
    ],
    datasets: [
      { public_id: "ds_1111111111111111", project_id: PROJECT_A, owner: ownerA, sha256: SHA256_A, created_at: "2026-11-26T00:00:01.000Z" }
    ],
    workspace_runs: [
      { public_id: "run_1111111111111111", project_id: PROJECT_A, owner: ownerA, workflow_id: "16s-rrna-identification", state: "draft", created_at: "2026-11-26T00:00:02.000Z" }
    ]
  };
}

test("project creation stores the derived owner, never the raw token", async () => {
  const { env, state } = newWorkspaceEnv();
  const response = await handleCreateProject(makeRequest("POST", "/api/workspace/projects", TOKEN_A, validPayload()), env, { idFactory: sequentialIds() });
  assert.equal(response.status, 201);
  const body = await response.json();
  const owner = await ownerOf(TOKEN_A);
  assert.equal(body.project.owner, owner);
  assert.equal(body.project.name, "16S isolate study");
  assert.equal(body.project.scientific_objective, "Resolve species-level identities");
  assert.equal(body.project.status, "active");
  assert.equal(body.execution_mode, "real");
  const stored = state.tables.projects[0];
  assert.equal(stored.owner, owner);
  assert.notEqual(stored.owner, TOKEN_A);
  assert.equal(JSON.stringify(stored).includes(TOKEN_A), false);
  assert.equal(state.tables.audit_events.length, 1);
  assert.equal(state.tables.audit_events[0].actor, owner);
});

test("project creation rejects missing and wrong operator tokens", async () => {
  const { env } = newWorkspaceEnv();
  assert.equal((await handleCreateProject(makeRequest("POST", "/api/workspace/projects", null, validPayload()), env)).status, 401);
  assert.equal((await handleCreateProject(makeRequest("POST", "/api/workspace/projects", TOKEN_B, validPayload()), mockAIEnvFor(env, TOKEN_A))).status, 401);
});

function mockAIEnvFor(env, token) {
  return { AI_DB: env.AI_DB, AI_AGENT_TOKEN: token };
}

test("project creation fails closed when the token or database is unavailable", async () => {
  const { db } = newWorkspaceEnv();
  const noToken = await handleCreateProject(makeRequest("POST", "/api/workspace/projects", TOKEN_A, validPayload()), { AI_DB: db });
  assert.equal(noToken.status, 503);
  const noDb = await handleCreateProject(makeRequest("POST", "/api/workspace/projects", TOKEN_A, validPayload()), { AI_AGENT_TOKEN: TOKEN_A });
  assert.equal(noDb.status, 503);
});

test("project creation validates name, status and body", async () => {
  const { env } = newWorkspaceEnv();
  for (const payload of [
    { ...validPayload(), name: "" },
    { ...validPayload(), name: "x".repeat(201) },
    { ...validPayload(), status: "unknown" },
    {}
  ]) {
    const response = await handleCreateProject(makeRequest("POST", "/api/workspace/projects", TOKEN_A, payload), env, { idFactory: sequentialIds() });
    assert.equal(response.status, 400, JSON.stringify(payload).slice(0, 60));
  }
});

test("project list is filtered by derived owner in SQL", async () => {
  const ownerA = await ownerOf(TOKEN_A);
  const ownerB = await ownerOf(TOKEN_B);
  const { env } = newWorkspaceEnv(seedWithTwoOwners(ownerA, ownerB));
  const response = await handleListProjects(makeRequest("GET", "/api/workspace/projects"), env);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.count, 1);
  assert.deepEqual(body.projects.map((project) => project.id), [PROJECT_A]);
  assert.ok(!JSON.stringify(body).includes("Their project"));
});

test("project list computes dataset and run counts from D1 rows", async () => {
  const ownerA = await ownerOf(TOKEN_A);
  const ownerB = await ownerOf(TOKEN_B);
  const { env } = newWorkspaceEnv(seedWithTwoOwners(ownerA, ownerB));
  const body = await (await handleListProjects(makeRequest("GET", "/api/workspace/projects"), env)).json();
  assert.equal(body.projects[0].dataset_count, 1);
  assert.equal(body.projects[0].run_count, 1);
});

test("opening an owned project returns its metadata and counts", async () => {
  const ownerA = await ownerOf(TOKEN_A);
  const ownerB = await ownerOf(TOKEN_B);
  const { env } = newWorkspaceEnv(seedWithTwoOwners(ownerA, ownerB));
  const response = await handleGetProject(makeRequest("GET", `/api/workspace/projects/${PROJECT_A}`), env, PROJECT_A);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.project.id, PROJECT_A);
  assert.equal(body.project.dataset_count, 1);
});

test("cross-owner project reads return 404 without leaking existence", async () => {
  const ownerA = await ownerOf(TOKEN_A);
  const ownerB = await ownerOf(TOKEN_B);
  const { env } = newWorkspaceEnv(seedWithTwoOwners(ownerA, ownerB));
  const cross = await handleGetProject(makeRequest("GET", `/api/workspace/projects/${PROJECT_B}`), env, PROJECT_B);
  assert.equal(cross.status, 404);
  assert.ok(!(await cross.json()).error.includes("Their project"));
  const missing = await handleGetProject(makeRequest("GET", "/api/workspace/projects/proj_9999999999999999"), env, "proj_9999999999999999");
  assert.equal(missing.status, 404);
});

test("invalid project ids are rejected before any D1 access", async () => {
  const { env, state } = newWorkspaceEnv();
  const response = await handleGetProject(makeRequest("GET", "/api/workspace/projects/not-an-id"), env, "not-an-id");
  assert.equal(response.status, 400);
  assert.equal(state.calls.length, 0);
});

test("project patch updates only the supplied metadata fields", async () => {
  const ownerA = await ownerOf(TOKEN_A);
  const seed = seedWithTwoOwners(ownerA, await ownerOf(TOKEN_B));
  seed.projects[0].description = "old";
  seed.projects[0].scientific_objective = "old objective";
  const { env, state } = newWorkspaceEnv(seed);
  const response = await handlePatchProject(
    makeRequest("PATCH", `/api/workspace/projects/${PROJECT_A}`, TOKEN_A, { description: "new description" }),
    env, PROJECT_A, { idFactory: sequentialIds() }
  );
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.project.description, "new description");
  assert.equal(body.project.scientific_objective, "old objective");
  assert.equal(body.project.name, "Mine");
  assert.equal(state.tables.projects[0].updated_at !== null, true);
  assert.equal(state.tables.audit_events[0].action, "workspace_project_updated");
});

test("cross-owner patch is rejected and leaves the row untouched", async () => {
  const ownerA = await ownerOf(TOKEN_A);
  const ownerB = await ownerOf(TOKEN_B);
  const { env, state } = newWorkspaceEnv(seedWithTwoOwners(ownerA, ownerB));
  const before = JSON.stringify(state.tables.projects[1]);
  const response = await handlePatchProject(
    makeRequest("PATCH", `/api/workspace/projects/${PROJECT_B}`, TOKEN_A, { name: "hijacked" }),
    env, PROJECT_B, { idFactory: sequentialIds() }
  );
  assert.equal(response.status, 404);
  assert.equal(JSON.stringify(state.tables.projects[1]), before);
});

test("empty patch body is rejected", async () => {
  const ownerA = await ownerOf(TOKEN_A);
  const { env } = newWorkspaceEnv(seedWithTwoOwners(ownerA, await ownerOf(TOKEN_B)));
  const response = await handlePatchProject(
    makeRequest("PATCH", `/api/workspace/projects/${PROJECT_A}`, TOKEN_A, {}),
    env, PROJECT_A
  );
  assert.equal(response.status, 400);
});

test("archive and activate flip status with owner-checked audit events", async () => {
  const ownerA = await ownerOf(TOKEN_A);
  const { env, state } = newWorkspaceEnv(seedWithTwoOwners(ownerA, await ownerOf(TOKEN_B)));
  const archived = await handleArchiveProject(makeRequest("POST", `/api/workspace/projects/${PROJECT_A}/archive`), env, PROJECT_A, { idFactory: sequentialIds() });
  assert.equal(archived.status, 200);
  assert.equal((await archived.json()).project.status, "archived");
  assert.equal(state.tables.projects[0].status, "archived");
  const activated = await handleActivateProject(makeRequest("POST", `/api/workspace/projects/${PROJECT_A}/activate`), env, PROJECT_A, { idFactory: sequentialIds() });
  assert.equal(activated.status, 200);
  assert.equal((await activated.json()).project.status, "active");
  assert.deepEqual(state.tables.audit_events.map((event) => event.action), ["workspace_project_archived", "workspace_project_activated"]);
});

test("cross-owner archive cannot change another owner's project", async () => {
  const ownerA = await ownerOf(TOKEN_A);
  const ownerB = await ownerOf(TOKEN_B);
  const { env, state } = newWorkspaceEnv(seedWithTwoOwners(ownerA, ownerB));
  const response = await handleArchiveProject(makeRequest("POST", `/api/workspace/projects/${PROJECT_B}/archive`), env, PROJECT_B);
  assert.equal(response.status, 404);
  assert.equal(state.tables.projects[1].status, "active");
});

test("unsupported methods return 405 with an Allow header", async () => {
  const { env } = newWorkspaceEnv();
  const response = await projectsOnRequest({ request: makeRequest("DELETE", "/api/workspace/projects"), env, params: {} });
  assert.equal(response.status, 405);
  assert.equal(response.headers.get("Allow"), "GET, POST");
});

test("workspace responses carry the shared CSP/nosniff/no-store headers", async () => {
  const { env } = newWorkspaceEnv();
  const response = await handleCreateProject(makeRequest("POST", "/api/workspace/projects", TOKEN_A, validPayload()), env, { idFactory: sequentialIds() });
  assert.equal(response.headers.get("X-Content-Type-Options"), "nosniff");
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.match(response.headers.get("Content-Security-Policy"), /default-src 'none'/);
  assert.match(response.headers.get("Referrer-Policy"), /no-referrer/);
});
