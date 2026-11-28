// M7.1 verification tests for the five required offline behaviors.
// Fake D1 + injected fetch only: no real network, no credentials, no production edits.
// These assert the exact acceptance criteria (status codes, reason codes, counts),
// complementing the broader m7_1_* tests already in this directory.
import test from "node:test";
import assert from "node:assert/strict";

import { PROVIDER_SQL } from "../functions/api/providers/_lib.js";
import { SQL as AI_SQL } from "../functions/api/ai/_lib.js";
import { onRequest as jobsOnRequest } from "../functions/api/providers/jobs/index.js";
import { createRegistry } from "../providers/registry.js";
import { onRequest as downloadUrl } from "../functions/api/artifacts/[id]/download-url.js";

const TOOL = "m7-1.verify.tool";
const WORKFLOW_ID = "m7-1.verify.workflow";
const DATASET = "ds_0123456789abcdef";
const OTHER_DATASET = "ds_ffffffffffffffff";
const CONSENT = "pcon_1111111111111111";
const CONSENT2 = "pcon_2222222222222222";
const ART = "art_aaaaaaaaaaaaaaaa";
const FUTURE = new Date(Date.now() + 3600_000).toISOString();
const PAST = new Date(Date.now() - 60_000).toISOString();
const ALERT_SQL =
  "INSERT INTO governor_alerts (public_id, provider, unit, category, ratio, kind, at) VALUES (?, ?, ?, ?, ?, ?, ?)";

let sequence = 0;

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}
function post(payload) {
  // Unique per-request IP keeps the module-level rate limiter out of these tests.
  sequence += 1;
  return new Request("https://m7-1-verify.example.test/api/providers/jobs", {
    method: "POST",
    headers: { "Content-Type": "application/json", "CF-Connecting-IP": `203.0.113.${sequence % 200 + 1}` },
    body: JSON.stringify(payload)
  });
}
function get(path, headers = {}) {
  return new Request(`https://m7-1-verify.example.test${path}`, { method: "GET", headers });
}

function governorState(overrides = {}) {
  return {
    version: 1,
    totals: { galaxy: { jobs: 10, bytes: 1024 } },
    used: { galaxy: {} }, usedByCategory: { galaxy: {} }, reserved: { galaxy: {} },
    reservations: {}, emergency: {}, usage: {}, alerts: [],
    ...overrides
  };
}

// Fake D1 with primary-key enforcement on the two ledger tables so a duplicate
// job/consent cannot be inserted twice, plus single-use consent semantics.
function createProviderDb(seed = {}) {
  const state = {
    governor: seed.governor === undefined ? JSON.stringify(governorState()) : seed.governor,
    consents: new Map((seed.consents ?? []).map((row) => [row.public_id, { ...row }])),
    jobs: new Map(),
    transfers: [],
    alerts: [],
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
          if (sql === AI_SQL.insertAudit) { return { success: true, meta: { changes: 1 } }; }
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
          if (sql === PROVIDER_SQL.getArtifactRecord) {
            const row = state.artifacts?.get(stmt.values[0]);
            return { success: true, results: row ? [{ ...row }] : [] };
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

function galaxyEnv(db, extra = {}) {
  sequence += 1;
  return {
    AI_DB: db,
    AI_AGENT_TOKEN: "m7-1-verify-token",
    FETCH_IMPL: () => { throw new Error("unexpected real network call"); },
    GALAXY_ENABLED: "true",
    GALAXY_BASE_URL: `https://m7-1-verify-${sequence}.invalid`,
    GALAXY_API_KEY: "mock-key-not-a-real-secret",
    ...extra
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
function finalState(state) { return JSON.parse(state.governor ?? "{}"); }

test("single-use consent: 202 then 409 duplicate_submission, no second job or transfer", async () => {
  const { db, state } = createProviderDb({ consents: [consent()] });
  const calls = [];
  const env = galaxyEnv(db, { FETCH_IMPL: galaxyFetch(calls) });
  const first = await submit(env);
  assert.equal(first.status, 202);
  const second = await submit(env);
  assert.equal(second.status, 409);
  assert.equal(second.headers.get("X-Governor-Reason"), "duplicate_submission");
  assert.equal(state.jobs.size, 1, "reused consent must not create a second job");
  assert.equal(state.transfers.length, 1, "reused consent must not create a second transfer");
});

test("plain submit_job (tool_id only, no workflow_id) is accepted, not a 502", async () => {
  const { db, state } = createProviderDb({ consents: [consent()] });
  const calls = [];
  const env = galaxyEnv(db, { FETCH_IMPL: galaxyFetch(calls) });
  const response = await jobsOnRequest({
    request: post({ provider: "galaxy", tool_id: TOOL, dataset_id: DATASET, consent_id: CONSENT, size_bytes: 0 }),
    env
  });
  assert.equal(response.status, 202, `plain submit_job was refused: ${await response.clone().text()}`);
  assert.equal((response.headers.get("X-Error-Detail") ?? "").includes("malformed_workflow_id"), false);
  assert.equal(state.jobs.size, 1);
});

test("governor: exhausted category budget gives 429 after a fresh consent", async () => {
  const { db, state } = createProviderDb({
    governor: JSON.stringify(governorState({ totals: { galaxy: { jobs: 1, bytes: 1024 } } })),
    consents: [consent(), consent({ public_id: CONSENT2 })]
  });
  const calls = [];
  const env = galaxyEnv(db, { FETCH_IMPL: galaxyFetch(calls) });
  assert.equal((await submit(env)).status, 202);
  const denied = await submit(env, { consent_id: CONSENT2 });
  assert.equal(denied.status, 429);
  assert.equal(denied.headers.get("X-Governor-Reason"), "budget_exhausted");
  assert.equal(state.jobs.size, 1);
  assert.equal(state.transfers.length, 1);
});

test("governor: emergency stop gives 503 before any reservation or provider POST", async () => {
  const stopped = governorState();
  stopped.emergency = { galaxy: { stopped: true, reason: "operator halt", at: new Date().toISOString() } };
  const { db, state } = createProviderDb({ governor: JSON.stringify(stopped), consents: [consent()] });
  const calls = [];
  const response = await submit(galaxyEnv(db, { FETCH_IMPL: galaxyFetch(calls) }));
  assert.equal(response.status, 503);
  assert.equal(response.headers.get("X-Governor-Reason"), "emergency_stop");
  assert.equal(state.jobs.size, 0);
  assert.equal(calls.filter((call) => call.method === "POST").length, 0, "no provider submission may follow an emergency stop");
  assert.deepEqual(finalState(state).reservations, {});
});

test("governor: a released reservation leaves no budget charge", async () => {
  const { db, state } = createProviderDb({ consents: [consent()] });
  const calls = [];
  const env = galaxyEnv(db, { FETCH_IMPL: galaxyFetch(calls, { submitStatus: 400 }) });
  const response = await submit(env);
  assert.equal(response.status >= 400, true);
  assert.equal(state.jobs.size, 0);
  assert.equal(state.transfers.length, 0);
  const end = finalState(state);
  assert.deepEqual(end.reservations, {});
  assert.equal(end.reserved.galaxy?.jobs ?? 0, 0);
  assert.equal(end.used.galaxy?.jobs ?? 0, 0);
});

test("registry: enabled-but-unconfigured providers advertise zero tools", async () => {
  const env = {
    GALAXY_ENABLED: "true", SMARTSBIO_ENABLED: "true", NINEROUTER_ENABLED: "true",
    FETCH_IMPL: () => { throw new Error("unexpected real network call"); }
  };
  const registry = createRegistry(env, { fetch: env.FETCH_IMPL });
  const providers = await registry.listProviders({ fetch: env.FETCH_IMPL });
  assert.equal(providers.length, 3);
  for (const entry of providers) {
    assert.deepEqual(entry.tools, [], `${entry.id} must advertise no tools without configuration`);
  }
  assert.deepEqual(await registry.advertisedTools({ fetch: env.FETCH_IMPL }), []);
});

test("artifact download: anonymous and other-dataset consents are denied", async () => {
  const state = {
    artifacts: new Map([[ART, {
      public_id: ART, dataset_id: DATASET, object_key: `datasets/${DATASET}/hash/sample.fasta`,
      filename: "sample.fasta", mime: "text/plain", sha256: "hash", bytes: 8,
      status: "stored", created_at: new Date().toISOString(), deleted_at: null
    }]]),
    consents: new Map([
      [CONSENT, { public_id: CONSENT, dataset_id: DATASET, granted: 1, expires_at: FUTURE }],
      [CONSENT2, { public_id: CONSENT2, dataset_id: OTHER_DATASET, granted: 1, expires_at: FUTURE }],
      ["pcon_4444444444444444", { public_id: "pcon_4444444444444444", dataset_id: DATASET, granted: 1, expires_at: PAST }]
    ])
  };
  const db = {
    prepare(sql) {
      const stmt = {
        values: [],
        bind(...values) { stmt.values = values; return stmt; },
        async run() { throw new Error(`Unexpected run SQL: ${sql}`); },
        async all() {
          if (sql === PROVIDER_SQL.getArtifactRecord) {
            const row = state.artifacts.get(stmt.values[0]);
            return { success: true, results: row ? [{ ...row }] : [] };
          }
          if (sql === PROVIDER_SQL.getConsentRecord) {
            const row = state.consents.get(stmt.values[0]);
            return { success: true, results: row ? [{ ...row }] : [] };
          }
          throw new Error(`Unexpected all SQL: ${sql}`);
        }
      };
      return stmt;
    }
  };
  const env = {
    AI_DB: db,
    AI_AGENT_TOKEN: "m7-1-verify-token",
    ARTIFACTS: { async get() { return null; }, async put() {}, async delete() {} },
    ARTIFACT_SIGNING_KEY: "m7-1-verify-signing-key-not-a-real-secret"
  };
  const call = (query) => downloadUrl({ request: get(`/api/artifacts/${ART}/download-url${query}`), env, params: { id: ART } });

  assert.equal((await call("")).status, 403, "anonymous caller must be denied");
  assert.equal((await call(`?consent_id=${CONSENT2}`)).status, 403, "consent for another dataset must be denied");
  assert.equal((await call("?consent_id=pcon_4444444444444444")).status, 403, "expired consent must be denied");
  const allowed = await call(`?consent_id=${CONSENT}`);
  assert.equal(allowed.status, 200, "a valid unexpired consent for the artifact dataset must be allowed");
});
