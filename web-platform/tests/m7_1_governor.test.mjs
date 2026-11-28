// M7.1 governor / governed-job validation tests. Fully offline: a purpose-built
// fake D1 handles the migration-0007 tables and all provider traffic is injected
// through FETCH_IMPL. No real network, no credentials, no production changes.
import test from "node:test";
import assert from "node:assert/strict";

import { createGovernor } from "../providers/common/governor.js";
import { createMemoryStorage } from "../providers/common/contract.js";
import { createRegistry } from "../providers/registry.js";
import { PROVIDER_SQL } from "../functions/api/providers/_lib.js";
import { SQL as AI_SQL } from "../functions/api/ai/_lib.js";
import { onRequest as jobsOnRequest } from "../functions/api/providers/jobs/index.js";

const TOOL = "m7-1.mock.tool";
// A workflow id is used for the workflow-invocation governor paths; the
// plain submit_job path (no workflow id) is covered by its own test below.
const WORKFLOW_ID = "m7-1.mock.workflow";
const DATASET = "ds_0123456789abcdef";
const CONSENT = "pcon_1111111111111111";
const FUTURE = new Date(Date.now() + 3600_000).toISOString();
const ALERT_SQL =
  "INSERT INTO governor_alerts (public_id, provider, unit, category, ratio, kind, at) VALUES (?, ?, ?, ?, ?, ?, ?)";

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}
function post(payload) {
  return new Request("https://m7-1.example.test/api/providers/jobs", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload)
  });
}
function governorState(overrides = {}) {
  return {
    version: 1,
    totals: { galaxy: { jobs: 10, bytes: 1024 } },
    // Mirrors a snapshot produced by configureTotals(): nested containers exist.
    used: { galaxy: {} }, usedByCategory: { galaxy: {} }, reserved: { galaxy: {} },
    reservations: {}, emergency: {}, usage: {}, alerts: [],
    ...overrides
  };
}

// Fake D1 with primary-key enforcement on the two ledger tables, so duplicate
// consent / job ids cannot be inserted twice.
function createProviderDb(seed = {}) {
  const state = {
    governor: seed.governor === undefined ? null : seed.governor,
    consents: new Map((seed.consents ?? []).map((row) => [row.public_id, { ...row }])),
    jobs: new Map(),
    transfers: [],
    alerts: [],
    audit: [],
    calls: []
  };
  const db = {
    prepare(sql) {
      const stmt = {
        values: [],
        bind(...values) { stmt.values = values; return stmt; },
        async run() {
          state.calls.push({ sql, values: [...stmt.values] });
          const v = stmt.values;
          if (sql === PROVIDER_SQL.putGovernorState) { state.governor = v[1]; return { success: true, meta: { changes: 1 } }; }
          if (sql === PROVIDER_SQL.insertConsentRecord) {
            if (state.consents.has(v[0])) throw new Error(`UNIQUE constraint failed: provider_consents.public_id (${v[0]})`);
            state.consents.set(v[0], { public_id: v[0], dataset_id: v[1], provider: v[2], destination: v[3], scope_json: v[4], granted: v[5], created_at: v[6], expires_at: v[7] });
            return { success: true, meta: { changes: 1 } };
          }
          if (sql === PROVIDER_SQL.consumeConsent) {
            const row = state.consents.get(v[1]);
            if (!row || row.granted !== 1 || row.used_at) return { success: true, meta: { changes: 0 } };
            row.granted = 0;
            row.used_at = v[0];
            return { success: true, meta: { changes: 1 } };
          }
          if (sql === PROVIDER_SQL.insertProviderJob) {
            if (state.jobs.has(v[0])) throw new Error(`UNIQUE constraint failed: provider_jobs.public_id (${v[0]})`);
            state.jobs.set(v[0], [...v]);
            return { success: true, meta: { changes: 1 } };
          }
          if (sql === PROVIDER_SQL.insertTransfer) { state.transfers.push([...v]); return { success: true, meta: { changes: 1 } }; }
          if (sql === ALERT_SQL) { state.alerts.push([...v]); return { success: true, meta: { changes: 1 } }; }
          if (sql === AI_SQL.insertAudit) { state.audit.push([...v]); return { success: true, meta: { changes: 1 } }; }
          throw new Error(`Unexpected run SQL: ${sql}`);
        },
        async all() {
          state.calls.push({ sql, values: [...stmt.values] });
          if (sql === PROVIDER_SQL.getGovernorState) return { success: true, results: state.governor ? [{ state_json: state.governor }] : [] };
          if (sql === PROVIDER_SQL.getConsentRecord) {
            const row = state.consents.get(stmt.values[0]);
            return { success: true, results: row ? [{ ...row }] : [] };
          }
          if (sql === PROVIDER_SQL.getProviderJob) {
            const row = state.jobs.get(stmt.values[0]);
            return { success: true, results: row ? [row] : [] };
          }
          throw new Error(`Unexpected all SQL: ${sql}`);
        }
      };
      return stmt;
    }
  };
  return { db, state };
}

const consent = (overrides = {}) => ({
  public_id: CONSENT, dataset_id: DATASET, provider: "galaxy", destination: "galaxy",
  scope_json: JSON.stringify({ operation: "submit_job", destination: "galaxy" }),
  granted: 1, created_at: new Date(Date.now() - 1000).toISOString(), expires_at: FUTURE,
  ...overrides
});

let sequence = 0;
function galaxyEnv(db, extra = {}) {
  sequence += 1;
  return {
    AI_DB: db,
    AI_AGENT_TOKEN: "m7-1-test-token",
    FETCH_IMPL: () => { throw new Error("unexpected real network call"); },
    GALAXY_ENABLED: "true",
    GALAXY_BASE_URL: `https://m7-1-governor-${sequence}.invalid`,
    GALAXY_API_KEY: "mock-key-not-a-real-secret",
    ...extra
  };
}
function galaxyFetch(calls, { submitStatus = 200 } = {}) {
  return async (input, init = {}) => {
    const url = String(input);
    const method = init.method ?? "GET";
    calls.push({ url, method });
    if (url.includes("/api/tools") && method === "GET") {
      return json([{ id: TOOL, name: "Mock tool", inputs: [], outputs: [] }]);
    }
    if (url.includes("/api/workflows") && method === "GET") return json([]);
    if (url.includes("/api/histories") && method === "POST") return json({ id: "mock-history" });
    if (url.includes("/api/tools") && method === "POST") {
      if (submitStatus >= 400) return json({ message: "mock submission refused" }, submitStatus);
      return json({ id: "mock-provider-job", state: "queued" });
    }
    return json({}, 404);
  };
}
async function submit(env, overrides = {}) {
  return jobsOnRequest({
    request: post({
      provider: "galaxy", tool_id: TOOL, workflow_id: WORKFLOW_ID,
      dataset_id: DATASET, consent_id: CONSENT, size_bytes: 0, ...overrides
    }),
    env
  });
}
function finalState(state) {
  return JSON.parse(state.governor ?? "{}");
}
function savedStates(state) {
  return state.calls
    .filter((call) => call.sql === PROVIDER_SQL.putGovernorState)
    .map((call) => JSON.parse(call.values[1]));
}

test("exhausted category budget denies a job and records no job or transfer", async () => {
  const { db, state } = createProviderDb({
    governor: JSON.stringify(governorState({ totals: { galaxy: { jobs: 1, bytes: 1024 } } })),
    consents: [consent(), consent({ public_id: "pcon_2222222222222222" })]
  });
  const calls = [];
  const env = galaxyEnv(db, { FETCH_IMPL: galaxyFetch(calls) });
  const first = await submit(env);
  assert.equal(first.status, 202);
  // Consent is single-use, so the budget-exhaustion probe needs a fresh one.
  const second = await submit(env, { consent_id: "pcon_2222222222222222" });
  assert.equal(second.status, 429);
  assert.equal(second.headers.get("X-Governor-Reason"), "budget_exhausted");
  assert.equal(state.jobs.size, 1, "a denied submission must not create a second job");
  assert.equal(state.transfers.length, 1);
  assert.deepEqual(finalState(state).reservations, {});
});

test("concurrent reservations cannot overspend a single category share", async () => {
  const storage = createMemoryStorage();
  const governor = createGovernor({ storage });
  await governor.initialize();
  await governor.configureTotals({ ninerouter: { requests: 100 } });
  // integration share = 10% of 100 = 10; two 6-unit reservations cannot both win.
  const results = await Promise.all([
    governor.reserve({ provider: "ninerouter", unit: "requests", amount: 6, category: "integration" }),
    governor.reserve({ provider: "ninerouter", unit: "requests", amount: 6, category: "integration" })
  ]);
  assert.equal(results.filter((result) => result.ok).length, 1);
  assert.equal(results.filter((result) => result.reason === "budget_exhausted").length, 1);
  const status = await governor.getStatus("ninerouter");
  assert.equal(status.ninerouter.units.requests.used_by_category.integration, 6);
  assert.equal(status.ninerouter.units.requests.reserved, 6);
  assert.ok(6 <= 10, "category share must never be exceeded");
});

test("a failed provider reservation is released and leaves no budget charge", async () => {
  const { db, state } = createProviderDb({
    governor: JSON.stringify(governorState()), consents: [consent()]
  });
  const calls = [];
  const env = galaxyEnv(db, { FETCH_IMPL: galaxyFetch(calls, { submitStatus: 400 }) });
  const response = await submit(env);
  assert.equal(response.status >= 400, true);
  assert.equal(state.jobs.size, 0, "a failed submission must not be persisted as submitted");
  const end = finalState(state);
  assert.deepEqual(end.reservations, {});
  assert.equal(end.reserved.galaxy?.jobs ?? 0, 0);
  assert.equal(end.used.galaxy?.jobs ?? 0, 0);
});

test("a failed byte reservation releases the earlier job reservation", async () => {
  const { db, state } = createProviderDb({
    governor: JSON.stringify(governorState({ totals: { galaxy: { jobs: 10, bytes: 4 } } })),
    consents: [consent()]
  });
  const calls = [];
  const env = galaxyEnv(db, { FETCH_IMPL: galaxyFetch(calls) });
  const response = await submit(env, { size_bytes: 5 });
  assert.equal(response.status, 429);
  assert.equal(response.headers.get("X-Governor-Reason"), "budget_exhausted");
  assert.equal(state.jobs.size, 0);
  const end = finalState(state);
  assert.deepEqual(end.reservations, {});
  assert.equal(end.reserved.galaxy?.jobs ?? 0, 0);
  assert.equal(end.reserved.galaxy?.bytes ?? 0, 0);
  // No provider submission may follow a refused byte reservation.
  assert.equal(calls.filter((call) => call.method === "POST" && call.url.includes("/api/tools")).length, 0);
});

test("emergency stop blocks job submission before any reservation", async () => {
  const state0 = governorState();
  state0.emergency = { galaxy: { stopped: true, reason: "operator halt", at: new Date().toISOString() } };
  const { db, state } = createProviderDb({ governor: JSON.stringify(state0), consents: [consent()] });
  const calls = [];
  const response = await submit(galaxyEnv(db, { FETCH_IMPL: galaxyFetch(calls) }));
  assert.equal(response.status, 503);
  assert.equal(response.headers.get("X-Governor-Reason"), "emergency_stop");
  assert.equal(state.jobs.size, 0);
  // Capability discovery (GET) precedes the governor check; no POST may follow.
  assert.equal(calls.filter((call) => call.method === "POST").length, 0, "emergency stop must prevent submission");
});

test("registry reports unavailable for enabled-but-unconfigured providers", async () => {
  const env = {
    GALAXY_ENABLED: "true", SMARTSBIO_ENABLED: "true", NINEROUTER_ENABLED: "true",
    FETCH_IMPL: () => { throw new Error("unexpected real network call"); }
  };
  const registry = createRegistry(env, { fetch: env.FETCH_IMPL });
  const providers = await registry.listProviders({ fetch: env.FETCH_IMPL });
  assert.deepEqual(providers.map((entry) => entry.id).sort(), ["galaxy", "ninerouter", "smartsbio"]);
  for (const entry of providers) {
    assert.notEqual(entry.availability, "available", "a credential-less provider must never report available");
    assert.deepEqual(entry.tools, [], "unavailable providers must not advertise tools");
  }
  // smarts.bio reports `disabled` because its written-authorization gate is off.
  assert.equal(providers.find((entry) => entry.id === "smartsbio").availability, "disabled");
  assert.equal(providers.find((entry) => entry.id === "galaxy").availability, "unavailable");
  assert.deepEqual(await registry.advertisedTools({ fetch: env.FETCH_IMPL }), []);
});

test("an unregistered tool is rejected without reserving budget", async () => {
  const { db, state } = createProviderDb({ consents: [consent()] });
  const response = await submit(galaxyEnv(db), { tool_id: "tool.not.registered" });
  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /not registered/);
  assert.equal(state.governor, null, "no reservation may be created for an unregistered tool");
  assert.equal(state.jobs.size, 0);
});

test("every reservation has a matching consume or release and none leak", async () => {
  const { db, state } = createProviderDb({
    governor: JSON.stringify(governorState()), consents: [consent()]
  });
  const calls = [];
  await submit(galaxyEnv(db, { FETCH_IMPL: galaxyFetch(calls) }), { size_bytes: 8 });
  const seen = new Set();
  for (const snapshot of savedStates(state)) {
    for (const id of Object.keys(snapshot.reservations ?? {})) seen.add(id);
  }
  assert.equal(seen.size, 2, "a job with bytes must reserve both a job and a byte unit");
  const end = finalState(state);
  for (const id of seen) {
    assert.equal(end.reservations[id], undefined, `reservation ${id} must be consumed or released`);
  }
  assert.equal(end.reserved.galaxy?.jobs ?? 0, 0);
  assert.equal(end.reserved.galaxy?.bytes ?? 0, 0);
  assert.equal(end.used.galaxy?.jobs, 1);
  assert.equal(end.used.galaxy?.bytes, 8);
  assert.equal(state.jobs.size, 1);
});

// Regression: single-use consent / idempotency. The conditional consent claim
// in jobs/index.js returns 409 duplicate_submission on a repeated consent id.
test("duplicate submission (repeat consent id) is rejected", async () => {
  const { db, state } = createProviderDb({
    governor: JSON.stringify(governorState({ totals: { galaxy: { jobs: 10, bytes: 1024 } } })),
    consents: [consent()]
  });
  const calls = [];
  const env = galaxyEnv(db, { FETCH_IMPL: galaxyFetch(calls) });
  const first = await submit(env);
  assert.equal(first.status, 202);
  const duplicate = await submit(env);
  assert.equal(duplicate.status, 409, "reusing a consent id must be rejected");
  assert.equal(duplicate.headers.get("X-Governor-Reason"), "duplicate_submission");
  assert.equal(state.jobs.size, 1, "a repeated submission must not create a second provider job");
});

// Regression: a plain submit_job (tool_id only, no workflow_id) is accepted.
// jobs/index.js forwards `workflow_id || undefined` to validateRequest().
test("submit_job with a tool_id and no workflow_id is accepted", async () => {
  const { db, state } = createProviderDb({
    governor: JSON.stringify(governorState()), consents: [consent()]
  });
  const calls = [];
  const response = await jobsOnRequest({
    request: post({ provider: "galaxy", tool_id: TOOL, dataset_id: DATASET, consent_id: CONSENT, size_bytes: 0 }),
    env: galaxyEnv(db, { FETCH_IMPL: galaxyFetch(calls) })
  });
  assert.equal(response.status, 202, `plain submit_job was refused: ${await response.clone().text()}`);
  assert.equal(state.jobs.size, 1);
});
