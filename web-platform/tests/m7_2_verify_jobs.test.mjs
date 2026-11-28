// M7.2 VERIFICATION — OFFLINE / MOCK only.
// No live Galaxy execution, no credentials, no real network, no production code
// changes. All provider answers come from labelled MOCK fixtures via an injected
// fetch; D1 is an injected purpose-built fake.
//
// Focused re-verification of four governed-job behaviors surfaced in M7.2:
//   1. provider 401 propagates as exact HTTP 401 + code via the jobs handler
//   2. provider 403 propagates as exact HTTP 403 + code via the jobs handler
//   3. a failed submission releases reservations and creates no job/transfer
//   4. reuse of a spent consent returns 409 duplicate_submission
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { createFetch, handlers } from "../worker.js";
import { PROVIDER_SQL } from "../functions/api/providers/_lib.js";

const FIXTURES = new URL("./fixtures/providers/galaxy/", import.meta.url);
const fixture = (name) => JSON.parse(readFileSync(new URL(name, FIXTURES), "utf8"));
const discovery = fixture("m7_2_galaxy_discovery.json");
const jobs = fixture("m7_2_galaxy_jobs.json");
const errors = fixture("m7_2_galaxy_errors.json");

const TOOL_ID = discovery.tools.find((tool) => tool.disabled !== true).id;
const DATASET = "ds_1111111111111111";
const CONSENT = "pcon_1111111111111111";
const FUTURE = new Date(Date.now() + 3_600_000).toISOString();

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}
function governorState() {
  return {
    version: 1,
    totals: { galaxy: { jobs: 10, bytes: 4096 } },
    used: { galaxy: {} }, usedByCategory: { galaxy: {} }, reserved: { galaxy: {} },
    reservations: {}, emergency: {}, usage: {}, alerts: []
  };
}
function consentRow(overrides = {}) {
  return {
    public_id: CONSENT, dataset_id: DATASET, provider: "galaxy", destination: "galaxy",
    scope_json: JSON.stringify({ operation: "submit_job", destination: "galaxy" }),
    granted: 1, created_at: FUTURE, expires_at: FUTURE, ...overrides
  };
}

// Minimal fake D1: only the provider-only SQL the jobs handler issues.
function makeDb(seed = {}) {
  const state = {
    governor: seed.governor ?? JSON.stringify(governorState()),
    consents: new Map((seed.consents ?? []).map((row) => [row.public_id, { ...row }])),
    providerJobs: new Map(),
    transfers: []
  };
  const ok = (changes = 1) => ({ success: true, meta: { changes } });
  const db = {
    prepare(sql) {
      const stmt = {
        values: [],
        bind(...values) { stmt.values = values; return stmt; },
        async run() {
          const v = stmt.values;
          if (sql === PROVIDER_SQL.putGovernorState) { state.governor = v[1]; return ok(); }
          if (sql === PROVIDER_SQL.consumeConsent) {
            const row = state.consents.get(v[1]);
            if (!row || row.granted !== 1 || row.used_at) return ok(0);
            row.granted = 0;
            row.used_at = v[0];
            return ok(1);
          }
          if (sql === PROVIDER_SQL.insertProviderJob) {
            state.providerJobs.set(v[0], {
              public_id: v[0], provider: v[1], status: v[4], provider_job_id: v[5],
              dataset_id: v[7], consent_id: v[10], transfer_id: v[11]
            });
            return ok();
          }
          if (sql === PROVIDER_SQL.insertTransfer) { state.transfers.push([...v]); return ok(); }
          if (sql.startsWith("INSERT INTO governor_alerts")) return ok(); // advisory only
          throw new Error(`Unexpected M7.2 verify run SQL: ${sql}`);
        },
        async all() {
          const v = stmt.values;
          if (sql === PROVIDER_SQL.getGovernorState) {
            return { success: true, results: [{ state_json: state.governor }] };
          }
          if (sql === PROVIDER_SQL.getConsentRecord) {
            const row = state.consents.get(v[0]);
            return { success: true, results: row ? [{ ...row }] : [] };
          }
          throw new Error(`Unexpected M7.2 verify all SQL: ${sql}`);
        }
      };
      return stmt;
    }
  };
  return { db, state };
}

let sequence = 0;
let ipSequence = 0;
function makeEnv(db, fetchImpl) {
  sequence += 1;
  return {
    AI_DB: db,
    AI_EXECUTION_MODE: "mock",
    FETCH_IMPL: fetchImpl,
    GALAXY_ENABLED: "true",
    GALAXY_BASE_URL: `https://m7-2-verify-${sequence}.invalid`,
    GALAXY_API_KEY: "MOCK-KEY-NOT-A-REAL-SECRET"
  };
}
const workerFetch = createFetch(handlers);
function call(env, body) {
  return workerFetch(new Request("https://m7-2-verify.example.test/api/providers/jobs", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "CF-Connecting-IP": `m7-2-verify-${++ipSequence}`
    },
    body: JSON.stringify({
      provider: "galaxy", tool_id: TOOL_ID, dataset_id: DATASET, consent_id: CONSENT,
      size_bytes: 0, ...body
    })
  }), env, {});
}

function mockFetch(calls, error = null) {
  return async (input, init = {}) => {
    const url = String(input);
    const method = init.method ?? "GET";
    const requestBody = init.body ? JSON.parse(init.body) : {};
    calls.push({ url, method, body: requestBody });
    if (url.endsWith("/api/tools") && method === "GET") return json(discovery.tools);
    if (url.endsWith("/api/workflows")) return json(discovery.workflows);
    if (url.endsWith("/api/histories") && method === "POST") return json(jobs.history);
    if (url.endsWith("/api/tools") && method === "POST") {
      if (error) return json(error.body, error.status);
      if (requestBody.tool_id === "upload1") return json(jobs.upload);
      return json(jobs.queued_job);
    }
    if (url.includes("/api/invocations") && method === "POST") return json(jobs.invocation);
    return json(errors.not_found_404, 404);
  };
}
function assertNoSideEffects(state) {
  assert.equal(state.providerJobs.size, 0, "a failed/duplicate submission must persist no job");
  assert.equal(state.transfers.length, 0, "a failed/duplicate submission must persist no transfer");
  const end = JSON.parse(state.governor);
  assert.deepEqual(end.reservations, {}, "reservations must be released");
  assert.equal(end.reserved.galaxy?.jobs ?? 0, 0);
  assert.equal(end.used.galaxy?.jobs ?? 0, 0);
}

test("OFFLINE/MOCK provider 401 is propagated as exact HTTP 401 with code via the jobs handler", async () => {
  const { db, state } = makeDb({ consents: [consentRow()] });
  const calls = [];
  const env = makeEnv(db, mockFetch(calls, { status: 401, body: errors.expired_credentials_401 }));
  const response = await call(env);
  assert.equal(response.status, 401);
  assert.equal(response.headers.get("X-Provider"), "galaxy");
  assert.equal(JSON.parse(response.headers.get("X-Error-Detail") ?? "{}").code, "expired_api_key");
  assert.match((await response.json()).error, /HTTP 401/);
  assertNoSideEffects(state);
});

test("OFFLINE/MOCK provider 403 is propagated as exact HTTP 403 with code via the jobs handler", async () => {
  const { db, state } = makeDb({ consents: [consentRow()] });
  const calls = [];
  const env = makeEnv(db, mockFetch(calls, { status: 403, body: errors.account_activation_403 }));
  const response = await call(env);
  assert.equal(response.status, 403);
  assert.equal(response.headers.get("X-Provider"), "galaxy");
  assert.equal(JSON.parse(response.headers.get("X-Error-Detail") ?? "{}").code, "action_requires_account_activation");
  assert.match((await response.json()).error, /HTTP 403/);
  assertNoSideEffects(state);
});

test("OFFLINE/MOCK a failed submission releases reservations and creates no job or transfer", async () => {
  const { db, state } = makeDb({ consents: [consentRow()] });
  const calls = [];
  const env = makeEnv(db, mockFetch(calls, { status: 500, body: errors.server_error_500 }));
  const response = await call(env);
  assert.equal(response.status >= 400, true, `failed submission was accepted: ${response.status}`);
  assertNoSideEffects(state);
});

test("OFFLINE/MOCK reusing a spent consent returns 409 duplicate_submission and creates no second job", async () => {
  const { db, state } = makeDb({ consents: [consentRow()] });
  const calls = [];
  const env = makeEnv(db, mockFetch(calls));
  const first = await call(env);
  assert.equal(first.status, 202, `OFFLINE submit failed: ${await first.clone().text()}`);
  assert.equal(state.providerJobs.size, 1);
  const duplicate = await call(env);
  assert.equal(duplicate.status, 409);
  assert.equal(duplicate.headers.get("X-Governor-Reason"), "duplicate_submission");
  assert.equal(state.providerJobs.size, 1, "a reused consent must not create a second job");
  assert.equal(state.transfers.length, 1, "a reused consent must not create a second transfer");
  const end = JSON.parse(state.governor);
  assert.deepEqual(end.reservations, {});
  assert.equal(end.used.galaxy?.jobs, 1);
});
