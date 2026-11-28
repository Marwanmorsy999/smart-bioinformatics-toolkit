import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { createRegistry } from "../providers/registry.js";
import { AVAILABILITY, DISCOVERY_MODE, OPERATIONS } from "../providers/common/contract.js";

const FIXTURES = new URL("./fixtures/providers/", import.meta.url);
function fixture(path) {
  return JSON.parse(readFileSync(new URL(path, FIXTURES), "utf8"));
}

const galaxy = fixture("galaxy/mock-discovery.json");
const smartTools = fixture("smartsbio/mock-tools.json");
const routerModels = fixture("ninerouter/mock-models.json");

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function mockFetch(calls) {
  return async (input, init = {}) => {
    const url = String(input);
    calls.push({ url, method: init.method ?? "GET" });
    if (url.includes("/api/tools")) return json(galaxy.tools);
    if (url.includes("/api/workflows")) return json({ data: galaxy.workflows });
    if (url.includes("/api/version")) return json(galaxy.version);
    if (url.includes("/v1/models")) return json(routerModels);
    if (url.includes("/v1/tools")) return json(smartTools);
    if (url.includes("/v1/workspaces")) return json({ status: "success", data: [] });
    return json({}, 404);
  };
}

function fullEnv() {
  return {
    GALAXY_ENABLED: "true", SMARTSBIO_ENABLED: "true", NINEROUTER_ENABLED: "true",
    SMARTSBIO_PUBLIC_AUTHORIZED: "true",
    GALAXY_BASE_URL: "https://galaxy.example.invalid", GALAXY_API_KEY: "mock-key",
    SMARTSBIO_BASE_URL: "https://smarts.example.invalid/v1", SMARTSBIO_API_KEY: "mock-key", SMARTSBIO_WORKSPACE_ID: "ws_mock001",
    NINEROUTER_BASE_URL: "https://router.example.invalid/v1", NINEROUTER_API_KEY: "mock-key", NINEROUTER_MODEL: "mock-reasoner-1"
  };
}

test("registry flags: only the literal string true enables a provider", async () => {
  const variants = [
    [{}, []],
    [{ GALAXY_ENABLED: "TRUE", SMARTSBIO_ENABLED: "1", NINEROUTER_ENABLED: "yes" }, []],
    [{ GALAXY_ENABLED: "true" }, ["galaxy"]],
    [{ SMARTSBIO_ENABLED: "true" }, ["smartsbio"]],
    [{ NINEROUTER_ENABLED: "true" }, ["ninerouter"]]
  ];
  for (const [env, expected] of variants) {
    const registry = createRegistry(env);
    const enabled = ["galaxy", "smartsbio", "ninerouter"].filter((id) => registry.isEnabled(id));
    assert.deepEqual(enabled, expected, JSON.stringify(env));
  }
  const calls = [];
  const registry = createRegistry({}, { fetch: mockFetch(calls) });
  const providers = await registry.listProviders({ fetch: mockFetch(calls) });
  assert.equal(providers.length, 3);
  for (const entry of providers) {
    assert.equal(entry.enabled, false);
    assert.equal(entry.availability, AVAILABILITY.DISABLED);
    assert.deepEqual(entry.operations, []);
    assert.deepEqual(entry.tools, []);
    assert.equal(entry.discovery_mode, DISCOVERY_MODE.UNAVAILABLE);
  }
  assert.equal(calls.length, 0, "disabled providers must never be contacted");
  assert.deepEqual(await registry.advertisedTools({ fetch: mockFetch(calls) }), []);
  assert.equal(await registry.resolveTool("anything", { fetch: mockFetch(calls) }), null);
});

test("advertisedTools uses executableTools: disabled and non-executable tools are hidden", async () => {
  const calls = [];
  const registry = createRegistry(fullEnv(), { fetch: mockFetch(calls) });
  const tools = await registry.advertisedTools({ fetch: mockFetch(calls) });
  const ids = tools.map((tool) => tool.id);
  const executableGalaxyIds = galaxy.tools.filter((tool) => tool.disabled !== true).map((tool) => tool.id);
  for (const id of executableGalaxyIds) assert.ok(ids.includes(id), `missing executable galaxy tool ${id}`);
  const hidden = galaxy.tools.find((tool) => tool.disabled === true).id;
  assert.equal(ids.includes(hidden), false, "disabled Galaxy tool must not be advertised");
  for (const tool of tools) {
    assert.equal(tool.available, true);
    assert.equal(tool.executable, true);
    assert.ok(tool.provider);
  }
});

test("resolveTool finds a dynamic tool id and a provider-qualified id", async () => {
  const calls = [];
  const registry = createRegistry(fullEnv(), { fetch: mockFetch(calls) });
  const wanted = galaxy.tools[0].id; // derived from fixture, never hardcoded
  const found = await registry.resolveTool(wanted, { fetch: mockFetch(calls) });
  assert.ok(found, "expected a resolved tool");
  assert.equal(found.id, wanted);
  assert.equal(found.provider, "galaxy");
  const qualified = await registry.resolveTool(`galaxy:${wanted}`, { fetch: mockFetch(calls) });
  assert.equal(qualified?.id, wanted);
  assert.equal(await registry.resolveTool("tool.that.does.not.exist", { fetch: mockFetch(calls) }), null);
});

test("smarts.bio stays empty in listProviders/advertisedTools until the authorization gate opens", async () => {
  const calls = [];
  const env = { ...fullEnv(), SMARTSBIO_PUBLIC_AUTHORIZED: undefined };
  const registry = createRegistry(env, { fetch: mockFetch(calls) });
  const providers = await registry.listProviders({ fetch: mockFetch(calls) });
  const smarts = providers.find((entry) => entry.id === "smartsbio");
  assert.deepEqual(smarts.operations, []);
  assert.deepEqual(smarts.tools, []);
  assert.equal(smartToolsGuard(providers), true);
  const tools = await registry.advertisedTools({ fetch: mockFetch(calls) });
  assert.equal(tools.some((tool) => tool.provider === "smartsbio"), false);
  assert.equal(tools.some((tool) => tool.id === OPERATIONS.CHAT), false);
});

function smartToolsGuard(providers) {
  const smarts = providers.find((entry) => entry.id === "smartsbio");
  return smarts.availability === AVAILABILITY.DISABLED || smarts.tools.length === 0;
}

test("registry wraps errors through the shared normalizer", () => {
  const registry = createRegistry({});
  const normalized = registry.normalizeError("ninerouter", { status: 503, message: "upstream" }, { at: "t" });
  assert.equal(normalized.provider, "ninerouter");
  assert.equal(normalized.retryable, true);
  assert.equal(normalized.at, "t");
});
