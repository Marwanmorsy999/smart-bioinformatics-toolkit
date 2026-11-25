import test from "node:test";
import assert from "node:assert/strict";
import { DEMO_PAYLOAD, handleDemo } from "../functions/api/workspace/demo.js";
import { handleListProjects } from "../functions/api/workspace/projects/index.js";
import { makeRequest, TOKEN_A, newWorkspaceEnv, SHA256_A, ownerOf } from "./helpers/workspace.mjs";

test("demo endpoint requires the operator token", async () => {
  const { env } = newWorkspaceEnv();
  const response = await handleDemo(makeRequest("GET", "/api/workspace/demo", null), env);
  assert.equal(response.status, 401);
});

test("demo payload carries top-level precomputed labels and disclaimer", async () => {
  const { env } = newWorkspaceEnv();
  const body = await (await handleDemo(makeRequest("GET", "/api/workspace/demo"), env)).json();
  assert.equal(body.is_demo, true);
  assert.equal(body.sample, true);
  assert.equal(body.execution_mode, "precomputed");
  assert.equal(typeof body.disclaimer, "string");
  assert.match(body.disclaimer, /NOT a newly executed analysis/);
});

test("every demo project, dataset and run object is labelled as sample", async () => {
  const { env } = newWorkspaceEnv();
  const body = await (await handleDemo(makeRequest("GET", "/api/workspace/demo"), env)).json();
  const objects = [body.project, ...body.datasets, ...body.runs];
  assert.equal(objects.length, 5); // 1 project + 2 datasets + 2 runs
  for (const object of objects) {
    assert.equal(object.is_demo, true);
    assert.equal(object.sample, true);
    assert.equal(object.execution_mode, "precomputed");
    assert.equal(typeof object.disclaimer, "string");
  }
});

test("demo never presents a run as newly executed", async () => {
  const { env } = newWorkspaceEnv();
  const body = await (await handleDemo(makeRequest("GET", "/api/workspace/demo"), env)).json();
  const succeeded = body.runs.find((run) => run.state === "succeeded");
  assert.ok(succeeded);
  assert.equal(succeeded.execution_mode, "precomputed");
  assert.equal(succeeded.sample, true);
  assert.equal(body.runs.some((run) => run.state === "running" || run.state === "queued"), false);
});

test("demo causes no D1 writes", async () => {
  const { env, state } = newWorkspaceEnv();
  await handleDemo(makeRequest("GET", "/api/workspace/demo"), env);
  assert.equal(state.calls.length, 0);
  assert.deepEqual(state.tables, {});
});

test("demo stays labelled precomputed even in mock mode", async () => {
  const { env } = newWorkspaceEnv();
  env.AI_EXECUTION_MODE = "mock";
  const body = await (await handleDemo(makeRequest("GET", "/api/workspace/demo"), env)).json();
  assert.equal(body.execution_mode, "precomputed");
});

test("demo data is isolated from real project rows", async () => {
  const owner = await ownerOf(TOKEN_A);
  const { env } = newWorkspaceEnv({
    projects: [{ public_id: "proj_1111111111111111", name: "Real project", owner, status: "active", created_at: "2026-11-26T00:00:00.000Z" }],
    datasets: [{ public_id: "ds_1111111111111111", project_id: "proj_1111111111111111", owner, sha256: SHA256_A, created_at: "2026-11-26T00:00:01.000Z" }]
  });
  const real = await (await handleListProjects(makeRequest("GET", "/api/workspace/projects"), env)).json();
  assert.deepEqual(real.projects.map((project) => project.name), ["Real project"]);
  const demo = await (await handleDemo(makeRequest("GET", "/api/workspace/demo"), env)).json();
  assert.equal(demo.project.name, "Sample: 16S isolate panel");
  assert.notEqual(demo.project.id, real.projects[0].id);
});

test("demo handler returns a deep copy and cannot mutate the shared constant", async () => {
  const { env } = newWorkspaceEnv();
  const first = await (await handleDemo(makeRequest("GET", "/api/workspace/demo"), env)).json();
  first.project.name = "mutated";
  const second = await (await handleDemo(makeRequest("GET", "/api/workspace/demo"), env)).json();
  assert.equal(second.project.name, DEMO_PAYLOAD.project.name);
});
