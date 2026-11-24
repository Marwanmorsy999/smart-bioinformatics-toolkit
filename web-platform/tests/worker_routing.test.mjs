import test from "node:test";
import assert from "node:assert/strict";
import { createFetch, handlers } from "../worker.js";

const ORIGIN = "https://worker.example.test";

function makeAssets(calls, body = "<!doctype html><html><body>Static page</body></html>") {
  return {
    fetch(request) {
      calls.push(request);
      return new Response(body, {
        status: 200,
        headers: { "Content-Type": "text/html; charset=utf-8", "X-Asset-Served": "1" }
      });
    }
  };
}

function makeEnv(assets) {
  return { ASSETS: assets, BLAST_DB: {}, AI_AGENT_TOKEN: "unit-test-token" };
}

function makeStubMap(seen) {
  const map = {};
  for (const key of Object.keys(handlers)) {
    map[key] = async (context) => {
      seen.push({ key, context });
      return new Response(JSON.stringify({ key, params: context.params }), {
        status: 200,
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
          "X-Content-Type-Options": "nosniff"
        }
      });
    };
  }
  return map;
}

const ROUTE_SAMPLES = [
  ["/api/ai/plans/plan_0123456789abcdef", "aiPlan", { id: "plan_0123456789abcdef" }],
  ["/api/ai/plans/plan_0123456789abcdef/approve", "aiPlanApprove", { id: "plan_0123456789abcdef" }],
  ["/api/ai/jobs?agentId=unit&limit=5", "aiJobs", {}],
  ["/api/ai/jobs/job_0123456789abcdef/result", "aiJobResult", { id: "job_0123456789abcdef" }],
  ["/api/ai/runs/job_0123456789abcdef", "aiRun", { id: "job_0123456789abcdef" }],
  ["/api/ai/runs/job_0123456789abcdef/provenance", "aiRunProvenance", { id: "job_0123456789abcdef" }],
  ["/api/ai/runs/job_0123456789abcdef/report", "aiRunReport", { id: "job_0123456789abcdef" }],
  ["/api/ai/requests", "aiRequests", {}],
  ["/api/ai/backend", "aiBackend", {}],
  ["/api/tools", "tools", {}],
  ["/api/blast/submit", "blastSubmit", {}],
  ["/api/blast/status/MOCKa1b2c3d4e5f6a7", "blastStatus", { rid: "MOCKa1b2c3d4e5f6a7" }],
  ["/api/blast/results/MOCKa1b2c3d4e5f6a7", "blastResults", { rid: "MOCKa1b2c3d4e5f6a7" }],
  ["/api/blast/history", "blastHistory", {}]
];

test("every known API route reaches its stubbed handler with parsed params and context", async () => {
  const seen = [];
  const assetCalls = [];
  const env = makeEnv(makeAssets(assetCalls));
  const workerFetch = createFetch(makeStubMap(seen));

  for (const [path, expectedKey, expectedParams] of ROUTE_SAMPLES) {
    const request = new Request(`${ORIGIN}${path}`, { method: "POST" });
    const response = await workerFetch(request, env, {});
    assert.equal(response.status, 200, path);
    assert.deepEqual(await response.json(), { key: expectedKey, params: expectedParams }, path);
  }

  assert.equal(seen.length, ROUTE_SAMPLES.length);
  for (let index = 0; index < ROUTE_SAMPLES.length; index += 1) {
    const [path] = ROUTE_SAMPLES[index];
    const { key, context } = seen[index];
    assert.equal(key, ROUTE_SAMPLES[index][1], path);
    assert.equal(context.request.url, `${ORIGIN}${path}`, path);
    assert.equal(context.request.method, "POST", path);
    assert.equal(context.env, env, path);
    assert.equal(typeof context.next, "function", path);
  }
  assert.equal(assetCalls.length, 0, "API routes must not be delegated to assets");
});

test("static paths are delegated to the ASSETS binding and its response is returned unchanged", async () => {
  const assetCalls = [];
  const seen = [];
  const env = makeEnv(makeAssets(assetCalls));
  const workerFetch = createFetch(makeStubMap(seen));

  for (const path of ["/", "/ai.html", "/blast.html", "/js/app.js", "/css/style.css"]) {
    const request = new Request(`${ORIGIN}${path}`);
    const response = await workerFetch(request, env, {});
    assert.equal(response.status, 200, path);
    assert.equal(response.headers.get("X-Asset-Served"), "1", path);
    assert.match(await response.text(), /Static page/, path);
  }

  assert.equal(assetCalls.length, 5);
  assert.deepEqual(assetCalls.map((request) => new URL(request.url).pathname), [
    "/", "/ai.html", "/blast.html", "/js/app.js", "/css/style.css"
  ]);
  assert.equal(seen.length, 0, "static requests must not reach API handlers");
});

test("unknown /api paths return the error envelope and are never served as static HTML", async () => {
  const assetCalls = [];
  const env = makeEnv(makeAssets(assetCalls));
  const workerFetch = createFetch(makeStubMap([]));

  for (const path of ["/api", "/api/", "/api/unknown", "/api/tools/extra", "/api/ai/legacy", "/api/blast/nope"]) {
    const response = await workerFetch(new Request(`${ORIGIN}${path}`), env, {});
    assert.equal(response.status, 404, path);
    assert.match(response.headers.get("Content-Type"), /application\/json/, path);
    assert.equal(response.headers.get("Content-Security-Policy"), "default-src 'none'; frame-ancestors 'none'; base-uri 'none'", path);
    assert.equal(response.headers.get("X-Content-Type-Options"), "nosniff", path);
    const text = await response.text();
    assert.doesNotMatch(text, /<html/i, path);
    const body = JSON.parse(text);
    assert.equal(body.error, "API route not found.", path);
    assert.equal(body.execution_mode, "real", path);
  }

  assert.equal(assetCalls.length, 0, "no API path may fall through to static assets");
});

test("handler CSP and nosniff headers are preserved verbatim", async () => {
  const seen = [];
  const env = makeEnv(makeAssets([]));
  const originalHeaders = {
    "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "Cache-Control": "no-store"
  };
  const workerFetch = createFetch({
    tools: () => Promise.resolve(new Response("ok", { status: 201, headers: originalHeaders }))
  });

  const response = await workerFetch(new Request(`${ORIGIN}/api/tools`), env, {});
  assert.equal(response.status, 201);
  for (const [name, value] of Object.entries(originalHeaders)) {
    assert.equal(response.headers.get(name), value, name);
  }
  assert.equal(seen.length, 0);
});

test("real /api/tools handler is wired through the Worker and keeps its security headers", async () => {
  const assetCalls = [];
  const env = makeEnv(makeAssets(assetCalls));
  const response = await createFetch()(new Request(`${ORIGIN}/api/tools`), env, {});

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("X-Content-Type-Options"), "nosniff");
  assert.match(response.headers.get("Content-Security-Policy"), /default-src 'none'/);
  const body = await response.json();
  assert.ok(Array.isArray(body.tools));
  assert.equal(body.execution_mode, "real");
  assert.equal(assetCalls.length, 0);
});

test("context.next() fails closed instead of serving an API path as HTML", async () => {
  const assetCalls = [];
  const env = makeEnv(makeAssets(assetCalls));
  const workerFetch = createFetch({
    tools: (context) => context.next()
  });

  const response = await workerFetch(new Request(`${ORIGIN}/api/tools`), env, {});
  assert.equal(response.status, 404);
  assert.equal((await response.json()).error, "API route not found.");
  assert.equal(assetCalls.length, 0);
});

test("malformed percent encoding in a path parameter returns 400, not static HTML", async () => {
  const assetCalls = [];
  const env = makeEnv(makeAssets(assetCalls));
  const workerFetch = createFetch(makeStubMap([]));

  const response = await workerFetch(new Request(`${ORIGIN}/api/ai/plans/%E0%A4%A`), env, {});
  assert.equal(response.status, 400);
  assert.match(response.headers.get("Content-Type"), /application\/json/);
  assert.equal(assetCalls.length, 0);
});

test("missing ASSETS binding for a static path fails closed with nosniff", async () => {
  const workerFetch = createFetch(makeStubMap([]));
  const response = await workerFetch(new Request(`${ORIGIN}/ai.html`), {}, {});
  assert.equal(response.status, 503);
  assert.equal(response.headers.get("X-Content-Type-Options"), "nosniff");
  assert.match(await response.text(), /Static assets are unavailable/);
});
