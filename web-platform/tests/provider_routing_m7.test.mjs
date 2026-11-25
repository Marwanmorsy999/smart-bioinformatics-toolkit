import test from "node:test";
import assert from "node:assert/strict";
import { createFetch, handlers } from "../worker.js";

const ORIGIN = "https://worker.example.test";

function stubMap() {
  const map = {};
  for (const key of Object.keys(handlers)) {
    map[key] = async (context) => new Response(JSON.stringify({ key, params: context.params }), {
      status: 200,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
        "X-Content-Type-Options": "nosniff"
      }
    });
  }
  return map;
}

const ROUTES = [
  ["/api/providers", "providers", {}],
  ["/api/providers/usage", "providerUsage", {}],
  ["/api/providers/emergency-stop", "providerEmergencyStop", {}],
  ["/api/providers/budget", "providerBudget", {}],
  ["/api/providers/chat", "providerChat", {}],
  ["/api/providers/plan", "providerPlan", {}],
  ["/api/providers/consent", "providerConsent", {}],
  ["/api/providers/transfers", "providerTransfers", {}],
  ["/api/providers/jobs", "providerJobs", {}],
  ["/api/providers/jobs/job_0123456789abcdef", "providerJob", { id: "job_0123456789abcdef" }],
  ["/api/providers/jobs/job_0123456789abcdef/cancel", "providerJobCancel", { id: "job_0123456789abcdef" }],
  ["/api/providers/jobs/job_0123456789abcdef/artifacts", "providerJobArtifacts", { id: "job_0123456789abcdef" }],
  ["/api/providers/galaxy/capabilities", "providerCapabilities", { id: "galaxy" }],
  ["/api/providers/galaxy/limits", "providerLimits", { id: "galaxy" }],
  ["/api/providers/galaxy", "providerDetail", { id: "galaxy" }],
  ["/api/artifacts/upload-url", "artifactUploadUrl", {}],
  ["/api/artifacts/upload", "artifactUpload", {}],
  ["/api/artifacts/content", "artifactContent", {}],
  ["/api/artifacts/delete", "artifactDelete", {}],
  ["/api/artifacts/art_0123456789abcdef/download-url", "artifactDownloadUrl", { id: "art_0123456789abcdef" }]
];

test("every M7 route reaches its handler with parsed params", async () => {
  const workerFetch = createFetch(stubMap());
  for (const [path, key, params] of ROUTES) {
    const response = await workerFetch(new Request(`${ORIGIN}${path}`, { method: "POST" }), { ASSETS: { fetch() {} } }, {});
    assert.equal(response.status, 200, path);
    assert.deepEqual(await response.json(), { key, params }, path);
  }
});

test("static M7 paths are never captured by the dynamic provider route", async () => {
  const workerFetch = createFetch(stubMap());
  for (const path of ["/api/providers/usage", "/api/providers/chat", "/api/providers/jobs", "/api/providers/transfers"]) {
    const response = await workerFetch(new Request(`${ORIGIN}${path}`), { ASSETS: { fetch() {} } }, {});
    assert.equal((await response.json()).key !== "providerDetail", true, path);
  }
});

test("disabled providers are reported without any network call", async () => {
  const env = { ASSETS: { fetch() {} }, BLAST_DB: {}, GALAXY_ENABLED: "false", SMARTSBIO_ENABLED: "false", NINEROUTER_ENABLED: "false" };
  const response = await createFetch()(new Request(`${ORIGIN}/api/providers`), env, {});
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.execution_mode, "real");
  assert.equal(body.providers.length, 3);
  for (const provider of body.providers) {
    assert.equal(provider.enabled, false);
    assert.equal(provider.availability, "disabled");
    assert.deepEqual(provider.tools, []);
  }
});

test("smarts.bio chat is refused even when its flag is enabled (authorization pending)", async () => {
  const env = { ASSETS: { fetch() {} }, BLAST_DB: {}, SMARTSBIO_ENABLED: "true" };
  const response = await createFetch()(new Request(`${ORIGIN}/api/providers/chat`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ provider: "smartsbio", message: "hello" })
  }), env, {});
  assert.equal(response.status, 403);
  assert.equal(response.headers.get("X-Provider"), "smartsbio");
  const body = await response.json();
  assert.match(body.error, /authorization/i);
});
