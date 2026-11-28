import test from "node:test";
import assert from "node:assert/strict";
import { createFetch, handlers } from "../worker.js";
import { createFakeD1AI, mockAIEnv } from "./helpers/fake-d1.mjs";
import { makeRequest, TOKEN_A } from "./helpers/workspace.mjs";

const PROJECT = "proj_1111111111111111";
const RUN = "run_1111111111111111";

const ROUTE_SAMPLES = [
  [`/api/workspace/projects`, "workspaceProjects", {}],
  [`/api/workspace/projects/${PROJECT}`, "workspaceProject", { id: PROJECT }],
  [`/api/workspace/projects/${PROJECT}/archive`, "workspaceProjectArchive", { id: PROJECT }],
  [`/api/workspace/projects/${PROJECT}/activate`, "workspaceProjectActivate", { id: PROJECT }],
  [`/api/workspace/projects/${PROJECT}/datasets`, "workspaceProjectDatasets", { id: PROJECT }],
  [`/api/workspace/projects/${PROJECT}/runs`, "workspaceProjectRuns", { id: PROJECT }],
  [`/api/workspace/workflows`, "workspaceWorkflows", {}],
  [`/api/workspace/runs/${RUN}`, "workspaceRun", { id: RUN }],
  [`/api/workspace/runs/${RUN}/provenance`, "workspaceRunProvenance", { id: RUN }],
  [`/api/workspace/runs/${RUN}/report`, "workspaceRunReport", { id: RUN }],
  [`/api/workspace/demo`, "workspaceDemo", {}]
];

function stubMap(seen) {
  const map = {};
  for (const key of Object.keys(handlers)) {
    map[key] = async (context) => {
      seen.push({ key, params: context.params });
      return new Response(JSON.stringify({ key, params: context.params }), {
        status: 200,
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          "Content-Security-Policy": "default-src 'none'",
          "X-Content-Type-Options": "nosniff"
        }
      });
    };
  }
  return map;
}

test("every batch-1 workspace path reaches its specific handler", async () => {
  const seen = [];
  const workerFetch = createFetch(stubMap(seen));
  for (const [path, expectedKey, expectedParams] of ROUTE_SAMPLES) {
    const response = await workerFetch(makeRequest("GET", path), {}, {});
    assert.equal(response.status, 200, path);
    assert.deepEqual(await response.json(), { key: expectedKey, params: expectedParams }, path);
  }
  assert.equal(seen.length, ROUTE_SAMPLES.length);
});

test("specific workspace routes are not swallowed by the catch-all route", async () => {
  const seen = [];
  const workerFetch = createFetch(stubMap(seen));
  await workerFetch(makeRequest("GET", `/api/workspace/runs/${RUN}/report`), {}, {});
  await workerFetch(makeRequest("GET", "/api/workspace/demo"), {}, {});
  assert.deepEqual(seen.map((entry) => entry.key), ["workspaceRunReport", "workspaceDemo"]);
});

test("real workspace handlers are wired through the Worker and fail closed without a token", async () => {
  const { db } = createFakeD1AI();
  const env = mockAIEnv(db, TOKEN_A);
  const workerFetch = createFetch();
  for (const path of ["/api/workspace/projects", "/api/workspace/workflows", "/api/workspace/demo"]) {
    const response = await workerFetch(makeRequest("GET", path, null), env, {});
    assert.equal(response.status, 401, path);
    assert.equal(response.headers.get("X-Content-Type-Options"), "nosniff", path);
  }
});

test("real workflow and demo handlers work through the Worker with a token", async () => {
  const { db } = createFakeD1AI();
  const env = mockAIEnv(db, TOKEN_A);
  const workerFetch = createFetch();
  const workflows = await workerFetch(makeRequest("GET", "/api/workspace/workflows"), env, {});
  assert.equal(workflows.status, 200);
  assert.equal((await workflows.json()).count, 2);
  const demo = await workerFetch(makeRequest("GET", "/api/workspace/demo"), env, {});
  assert.equal(demo.status, 200);
  assert.equal((await demo.json()).sample, true);
});

test("unknown API paths still fail closed with a JSON 404", async () => {
  const workerFetch = createFetch(stubMap([]));
  const response = await workerFetch(makeRequest("GET", "/api/workspace-typo"), {}, {});
  assert.equal(response.status, 404);
  assert.match(response.headers.get("Content-Type"), /application\/json/);
  assert.equal((await response.json()).error, "API route not found.");
});
