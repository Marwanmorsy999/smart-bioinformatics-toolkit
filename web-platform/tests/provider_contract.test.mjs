import test from "node:test";
import assert from "node:assert/strict";

import {
  ADAPTER_METHODS, PROVIDER_IDS, OPERATIONS, AVAILABILITY, DISCOVERY_MODE,
  assertAdapter, executableTools, isOperationSupported, normalizeProviderError
} from "../providers/common/contract.js";
import { createAdapter as createGalaxy } from "../providers/galaxy/index.js";
import { createAdapter as createSmartBio } from "../providers/smartsbio/index.js";
import { createAdapter as createNinerouter } from "../providers/ninerouter/index.js";

const FACTORIES = Object.freeze({
  galaxy: createGalaxy,
  smartsbio: createSmartBio,
  ninerouter: createNinerouter
});

function enabledEnv() {
  return {
    GALAXY_ENABLED: "true", SMARTSBIO_ENABLED: "true", NINEROUTER_ENABLED: "true",
    SMARTSBIO_PUBLIC_AUTHORIZED: "true",
    GALAXY_BASE_URL: "https://galaxy.example.invalid", GALAXY_API_KEY: "mock-key",
    SMARTSBIO_BASE_URL: "https://smarts.example.invalid/v1", SMARTSBIO_API_KEY: "mock-key", SMARTSBIO_WORKSPACE_ID: "ws_mock001",
    NINEROUTER_BASE_URL: "https://router.example.invalid/v1", NINEROUTER_API_KEY: "mock-key", NINEROUTER_MODEL: "mock-reasoner-1"
  };
}

test("every adapter conforms to the common contract", () => {
  const env = enabledEnv();
  assert.deepEqual([...PROVIDER_IDS], ["galaxy", "smartsbio", "ninerouter"]);
  assert.ok(ADAPTER_METHODS.includes("submitJob"));
  for (const id of PROVIDER_IDS) {
    const adapter = FACTORIES[id](env);
    assert.deepEqual(assertAdapter(adapter), { valid: true, errors: [] }, id);
    assert.equal(typeof adapter.id, "function", `${id}.id must be callable for assertAdapter`);
    assert.equal(adapter.id(), id);
  }
});

test("executableTools only exposes tools that are both available and executable", () => {
  const capabilities = {
    tools: [
      { id: "ok", available: true, executable: true },
      { id: "not-available", available: false, executable: true },
      { id: "not-executable", available: true, executable: false },
      { id: "missing-flags" }
    ]
  };
  assert.deepEqual(executableTools(capabilities).map((tool) => tool.id), ["ok"]);
  assert.deepEqual(executableTools({ tools: null }), []);
  assert.deepEqual(executableTools(null), []);
  assert.equal(isOperationSupported(capabilities, OPERATIONS.CHAT), false);
  assert.equal(isOperationSupported({ operations: [OPERATIONS.CHAT] }, OPERATIONS.CHAT), true);
});

test("normalizeProviderError keeps provider, status and retryability but truncates messages", () => {
  const normalized = normalizeProviderError("galaxy", {
    status: 429, code: "rate_limit_exceeded", message: "x".repeat(900)
  }, { at: "2026-01-01T00:00:00.000Z" });
  assert.equal(normalized.provider, "galaxy");
  assert.equal(normalized.code, "rate_limit_exceeded");
  assert.equal(normalized.status, 429);
  assert.equal(normalized.retryable, true);
  assert.equal(normalized.message.length, 500);
  assert.equal(normalized.at, "2026-01-01T00:00:00.000Z");
  const unknown = normalizeProviderError("ninerouter", { status: 400 });
  assert.equal(unknown.retryable, false);
  assert.equal(unknown.code, "http_400");
});

test("disabled adapters expose no operations or tools and do not touch the network", async () => {
  let calls = 0;
  const fetchImpl = () => { calls += 1; throw new Error("network must not be called"); };
  const env = {}; // all flags absent
  for (const id of PROVIDER_IDS) {
    const adapter = FACTORIES[id](env, { fetch: fetchImpl });
    const health = await adapter.healthCheck({ fetch: fetchImpl });
    assert.equal(health.status, AVAILABILITY.DISABLED, id);
    const caps = await adapter.getCapabilities({ fetch: fetchImpl });
    assert.deepEqual(caps.operations, [], id);
    assert.deepEqual(caps.tools, [], id);
    assert.equal(caps.discovery_mode, DISCOVERY_MODE.UNAVAILABLE, id);
  }
  assert.equal(calls, 0);
});
