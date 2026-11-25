// M7.2 OFFLINE / MOCK-only verification of the failure and usage matrix.
//
// NOT LIVE EXECUTION. All Galaxy responses are canned MOCK fixtures returned by
// an injected fetch; storage is an injected fake D1 / in-memory R2 stand-in.
// No credential, no real endpoint and no real job is involved.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { createFetch, handlers } from "../worker.js";
import { SQL_META, hashInput } from "../functions/api/ai/_lib.js";
import { getTool } from "../functions/api/ai/registry.js";
import { PROVIDER_SQL } from "../functions/api/providers/_lib.js";
import { SQL_UPSERT_HEARTBEAT } from "../functions/api/ai/jobs/index.js";
import { SQL_LIST_HEARTBEATS } from "../functions/api/ai/backend.js";
import { createAdapter } from "../providers/galaxy/index.js";
import { requestResponse } from "../providers/common/retry.js";
import { createArtifactStore } from "../storage/r2.js";
import { JOB_STATUS } from "../providers/common/contract.js";

const FIXTURES = new URL("./fixtures/providers/galaxy/", import.meta.url);
const fixture = (name) => JSON.parse(readFileSync(new URL(name, FIXTURES), "utf8"));
const discovery = fixture("m7_2_galaxy_discovery.json");
const jobs = fixture("m7_2_galaxy_jobs.json");
const errors = fixture("m7_2_galaxy_errors.json");

const TOOL_ID = discovery.tools.find((tool) => tool.disabled !== true).id;
const WORKFLOW_ID = discovery.workflows[0].id;
const DATASET = "ds_1111111111111111";
const OTHER_DATASET = "ds_2222222222222222";
const CONSENT = "pcon_1111111111111111";
const CONSENT2 = "pcon_2222222222222222";
const ARTIFACT = "art_1111111111111111";
const AI_JOB = "job_1111111111111111";
const PLAN = "plan_1111111111111111";
const FASTA = ">m7_2_seq1 OFFLINE MOCK\nACGTACGTACGT\n";
const FUTURE = new Date(Date.now() + 3_600_000).toISOString();
const PAST = new Date(Date.now() - 3_600_000).toISOString();
const ALERT_SQL =
  "INSERT INTO governor_alerts (public_id, provider, unit, category, ratio, kind, at) VALUES (?, ?, ?, ?, ?, ?, ?)";

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}
function noSleep() { return async () => {}; }
function ok(changes) { return { success: true, meta: { changes } }; }
function governorState(overrides = {}) {
  return {
    version: 1,
    totals: { galaxy: { jobs: 10, bytes: 4096 } },
    used: { galaxy: {} }, usedByCategory: { galaxy: {} }, reserved: { galaxy: {} },
    reservations: {}, emergency: {}, usage: {}, alerts: [],
    ...overrides
  };
}
function finalGovernor(state) { return JSON.parse(state.governor ?? "{}"); }
function consent(overrides = {}) {
  return {
    public_id: CONSENT, dataset_id: DATASET, provider: "galaxy", destination: "galaxy",
    scope_json: JSON.stringify({ operation: "submit_job", destination: "galaxy" }),
    granted: 1, created_at: FUTURE, expires_at: FUTURE, ...overrides
  };
}
function storedArtifact(overrides = {}) {
  return {
    public_id: ARTIFACT, dataset_id: DATASET, object_key: "datasets/mock/report.txt",
    filename: "report.txt", mime: "text/plain", sha256: "0".repeat(64), bytes: 4,
    status: "stored", created_at: FUTURE, deleted_at: null, ...overrides
  };
}

// purpose-built fake D1 (AI SQL_META tables + migration-0007 provider tables).
function createM7FakeD1(seed = {}) {
  const state = {
    tables: {}, calls: [], governor: seed.governor ?? null,
    consents: new Map((seed.consents ?? []).map((row) => [row.public_id, { ...row }])),
    providerJobs: new Map((seed.providerJobs ?? []).map((row) => [row.public_id, { ...row }])),
    transfers: [...(seed.transfers ?? [])],
    artifacts: new Map((seed.artifacts ?? []).map((row) => [row.public_id, { ...row }])),
    alerts: [], heartbeats: new Map()
  };
  let nextId = 1;
  for (const [table, rows] of Object.entries(seed.tables ?? {})) {
    state.tables[table] = rows.map((row) => ({ ...row, id: row.id ?? nextId++ }));
  }
  const ensure = (table) => (state.tables[table] ??= []);
  const matchesWhere = (row, columns, values) => columns.every((column, index) => row[column] === values[index]);
  const uniquePairs = { jobs: ["plan_id", "step_id"], approvals: ["plan_id", "step_id"] };

  const db = {
    prepare(sql) {
      const stmt = {
        sql, values: [],
        bind(...values) { stmt.values = values; return stmt; },
        async run() {
          state.calls.push({ sql, values: [...stmt.values] });
          const v = stmt.values;
          if (sql === PROVIDER_SQL.putGovernorState) { state.governor = v[1]; return ok(1); }
          if (sql === PROVIDER_SQL.insertConsentRecord) {
            state.consents.set(v[0], {
              public_id: v[0], dataset_id: v[1], provider: v[2], destination: v[3],
              scope_json: v[4], granted: v[5], created_at: v[6], expires_at: v[7]
            });
            return ok(1);
          }
          if (sql === PROVIDER_SQL.consumeConsent) {
            const row = state.consents.get(v[1]);
            if (!row || row.granted !== 1 || row.used_at) return ok(0);
            row.granted = 0;
            row.used_at = v[0];
            return ok(1);
          }
          if (sql === PROVIDER_SQL.insertProviderJob) {
            state.providerJobs.set(v[0], {
              public_id: v[0], provider: v[1], tool_id: v[2], operation: v[3], status: v[4],
              provider_job_id: v[5], reservation_id: v[6], dataset_id: v[7], input_hash: v[8],
              byte_count: v[9], consent_id: v[10], transfer_id: v[11], params_json: v[12],
              created_at: v[13], finished_at: v[14], detail_json: null
            });
            return ok(1);
          }
          if (sql === PROVIDER_SQL.updateProviderJob) {
            const row = state.providerJobs.get(v[3]);
            if (!row) return ok(0);
            row.status = v[0];
            row.finished_at = v[1];
            row.detail_json = v[2];
            return ok(1);
          }
          if (sql === PROVIDER_SQL.insertTransfer) { state.transfers.push([...v]); return ok(1); }
          if (sql === PROVIDER_SQL.insertArtifactRecord) {
            state.artifacts.set(v[0], {
              public_id: v[0], dataset_id: v[1], object_key: v[2], filename: v[3], mime: v[4],
              sha256: v[5], bytes: v[6], status: v[7], created_at: v[8], deleted_at: v[9]
            });
            return ok(1);
          }
          if (sql === PROVIDER_SQL.markArtifactDeleted) {
            const row = state.artifacts.get(v[2]);
            if (!row) return ok(0);
            row.status = v[0];
            row.deleted_at = v[1];
            return ok(1);
          }
          if (sql === ALERT_SQL) { state.alerts.push([...v]); return ok(1); }
          if (sql === SQL_UPSERT_HEARTBEAT) {
            state.heartbeats.set(v[0], { agent_id: v[0], last_seen_at: v[1], last_job_count: v[2] });
            return ok(1);
          }
          const meta = SQL_META[sql];
          if (!meta) throw new Error(`Unexpected M7.2 run SQL: ${sql}`);
          const rows = ensure(meta.table);
          if (meta.op === "insert") {
            const uniqueColumns = uniquePairs[meta.table];
            if (uniqueColumns) {
              const values = uniqueColumns.map((column) => v[meta.columns.indexOf(column)]);
              if (rows.some((existing) => matchesWhere(existing, uniqueColumns, values))) {
                throw new Error(`UNIQUE constraint failed: ${meta.table}.${uniqueColumns.join(", ")}`);
              }
            }
            const row = { id: nextId++ };
            meta.columns.forEach((column, index) => { row[column] = v[index] ?? null; });
            rows.push(row);
            return ok(1);
          }
          if (meta.op === "update" || meta.op === "claim") {
            const whereValues = v.slice(-meta.where.length);
            const matched = rows.filter((row) => matchesWhere(row, meta.where, whereValues));
            for (const row of matched) {
              for (const [column, index] of Object.entries(meta.assignments)) row[column] = v[index];
              if (meta.increment) row[meta.increment] = (row[meta.increment] ?? 0) + 1;
            }
            return ok(matched.length);
          }
          throw new Error(`Unexpected M7.2 run op: ${meta.op}`);
        },
        async all() {
          state.calls.push({ sql, values: [...stmt.values] });
          if (sql === PROVIDER_SQL.getGovernorState) {
            return { success: true, results: state.governor ? [{ state_json: state.governor }] : [] };
          }
          if (sql === PROVIDER_SQL.getConsentRecord) {
            const row = state.consents.get(stmt.values[0]);
            return { success: true, results: row ? [{ ...row }] : [] };
          }
          if (sql === PROVIDER_SQL.getProviderJob) {
            const row = state.providerJobs.get(stmt.values[0]);
            return { success: true, results: row ? [{ ...row }] : [] };
          }
          if (sql === PROVIDER_SQL.getArtifactRecord) {
            const row = state.artifacts.get(stmt.values[0]);
            return { success: true, results: row ? [{ ...row }] : [] };
          }
          if (sql === SQL_LIST_HEARTBEATS) {
            return { success: true, results: [...state.heartbeats.values()].map((row) => ({ ...row })) };
          }
          const meta = SQL_META[sql];
          if (!meta || meta.op !== "select") throw new Error(`Unexpected M7.2 all SQL: ${sql}`);
          let rows = ensure(meta.table).filter((row) => matchesWhere(row, meta.where, stmt.values));
          if (meta.orderBy) rows = [...rows].sort((a, b) => String(a[meta.orderBy]).localeCompare(String(b[meta.orderBy])));
          if (meta.limit) rows = rows.slice(0, stmt.values[stmt.values.length - 1]);
          return { success: true, results: rows.map((row) => ({ ...row })) };
        }
      };
      return stmt;
    }
  };
  return { db, state };
}

function fakeBucket() {
  const objects = new Map();
  return {
    objects,
    async put(key, value, options = {}) {
      const bytes = new Uint8Array(await new Response(value).arrayBuffer());
      objects.set(key, { bytes, httpMetadata: options.httpMetadata ?? {}, customMetadata: options.customMetadata ?? {}, size: bytes.length });
    },
    async get(key) {
      const item = objects.get(key);
      if (!item) return null;
      return { body: new Response(item.bytes).body, httpMetadata: item.httpMetadata, customMetadata: item.customMetadata, size: item.size };
    },
    async delete(key) { objects.delete(key); return true; }
  };
}

let sequence = 0;
let ipSequence = 0;
function makeEnv(db, fetchImpl, extra = {}) {
  sequence += 1;
  return {
    AI_DB: db,
    AI_AGENT_TOKEN: "m7-2-offline-agent-token",
    AI_EXECUTION_MODE: "mock",
    FETCH_IMPL: fetchImpl,
    GALAXY_ENABLED: "true",
    GALAXY_BASE_URL: `https://m7-2-failures-${sequence}.invalid`,
    GALAXY_API_KEY: "MOCK-KEY-NOT-A-REAL-SECRET",
    ARTIFACTS: fakeBucket(),
    ARTIFACT_SIGNING_KEY: "m7-2-offline-hmac-key-not-a-real-secret",
    ...extra
  };
}

const workerFetch = createFetch(handlers);
function request(method, path, body, headers = {}) {
  const init = {
    method,
    headers: {
      "CF-Connecting-IP": `m7-2-fail-${++ipSequence}`,
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      ...headers
    }
  };
  if (body !== undefined) init.body = typeof body === "string" ? body : JSON.stringify(body);
  return new Request(`https://m7-2.example.test${path}`, init);
}
async function call(env, method, path, body, headers = {}) {
  return workerFetch(request(method, path, body, headers), env, {});
}
function submit(env, overrides = {}) {
  return call(env, "POST", "/api/providers/jobs", {
    provider: "galaxy", tool_id: TOOL_ID, dataset_id: DATASET, consent_id: CONSENT,
    size_bytes: 0, ...overrides
  });
}

// Canned MOCK Galaxy server. `error` selects a failure envelope; `state`
// selects a job state; `invocation` overrides the invocation response.
function mockFetch(calls, { error = null, state = "queued", invocation = null } = {}) {
  return async (input, init = {}) => {
    const url = String(input);
    const method = init.method ?? "GET";
    const body = init.body ? JSON.parse(init.body) : {};
    calls.push({ url, method, body });
    if (url.endsWith("/api/tools") && method === "GET") return json(discovery.tools);
    if (url.endsWith("/api/workflows")) return json(discovery.workflows);
    if (url.endsWith("/api/histories") && method === "POST") return json(jobs.history);
    if (url.endsWith("/api/tools") && method === "POST") {
      if (error) return json(error.body, error.status);
      if (body.tool_id === "upload1") return json(jobs.upload);
      return json({ ...jobs.queued_job, state });
    }
    if (url.includes("/api/invocations") && method === "POST") return json(invocation ?? jobs.invocation);
    if (url.includes("/api/jobs/")) return json({ ...jobs.running_job, state });
    if (url.includes("/api/invocations/")) return json({ ...jobs.invocation, state });
    if (url.includes("/api/histories/") && url.endsWith("/contents")) return json(jobs.contents);
    if (url.includes("/api/datasets/") && url.endsWith("/content")) return new Response(jobs.dataset_content);
    if (url.includes("/api/datasets/")) return json(jobs.dataset);
    return json(errors.not_found_404, 404);
  };
}
function toolPosts(calls) {
  return calls.filter((entry) => entry.method === "POST" && entry.url.endsWith("/api/tools") && entry.body.tool_id !== "upload1");
}

test("OFFLINE/MOCK expired credentials (401) refuse the job, release reservations and do not retry", async () => {
  const { db, state } = createM7FakeD1({
    governor: JSON.stringify(governorState()), consents: [consent()]
  });
  const calls = [];
  const env = makeEnv(db, mockFetch(calls, { error: { status: 401, body: errors.expired_credentials_401 } }));
  // OFFLINE/MOCK: the adapter seam preserves the real MOCK status and code.
  const adapterResult = await createAdapter({
    GALAXY_ENABLED: "true", GALAXY_BASE_URL: "https://m7-2-401.invalid", GALAXY_API_KEY: "MOCK-KEY"
  }).submitJob({ operation: "submit_job", tool_id: TOOL_ID }, {
    fetch: mockFetch([], { error: { status: 401, body: errors.expired_credentials_401 } }), sleep: noSleep()
  });
  assert.equal(adapterResult.status, "failed");
  assert.equal(adapterResult.error.status, 401);
  assert.equal(adapterResult.error.code, "expired_api_key");
  assert.equal(adapterResult.error.retryable, false);

  const response = await submit(env);
  // The governed control plane propagates the provider status and code.
  assert.equal(response.status, 401);
  assert.equal(response.headers.get("X-Provider"), "galaxy");
  assert.deepEqual(JSON.parse(response.headers.get("X-Error-Detail") ?? "{}").code, "expired_api_key");
  assert.match((await response.json()).error, /HTTP 401/);
  assert.equal(state.providerJobs.size, 0, "OFFLINE/MOCK: a 401 must never persist a submitted job");
  assert.equal(state.transfers.length, 0);
  const end = finalGovernor(state);
  assert.deepEqual(end.reservations, {});
  assert.equal(end.reserved.galaxy?.jobs ?? 0, 0);
  assert.equal(end.used.galaxy?.jobs ?? 0, 0);
  assert.equal(toolPosts(calls).length, 1, "OFFLINE/MOCK: 401 is not retryable");
});

test("OFFLINE/MOCK account-activation 403 is propagated and never persisted as submitted", async () => {
  const { db, state } = createM7FakeD1({
    governor: JSON.stringify(governorState()), consents: [consent()]
  });
  const calls = [];
  const env = makeEnv(db, mockFetch(calls, { error: { status: 403, body: errors.account_activation_403 } }));
  // OFFLINE/MOCK: "Action requires account activation" is a 403 at the adapter seam.
  const adapterResult = await createAdapter({
    GALAXY_ENABLED: "true", GALAXY_BASE_URL: "https://m7-2-403.invalid", GALAXY_API_KEY: "MOCK-KEY"
  }).submitJob({ operation: "submit_job", tool_id: TOOL_ID }, {
    fetch: mockFetch([], { error: { status: 403, body: errors.account_activation_403 } }), sleep: noSleep()
  });
  assert.equal(adapterResult.status, "failed");
  assert.equal(adapterResult.error.status, 403);
  assert.equal(adapterResult.error.code, "action_requires_account_activation");

  const response = await submit(env);
  // The governed control plane propagates the activation status and code.
  assert.equal(response.status, 403);
  assert.equal(response.headers.get("X-Provider"), "galaxy");
  assert.deepEqual(JSON.parse(response.headers.get("X-Error-Detail") ?? "{}").code, "action_requires_account_activation");
  assert.match((await response.json()).error, /HTTP 403/);
  assert.equal(state.providerJobs.size, 0);
  assert.equal(state.transfers.length, 0);
  const end = finalGovernor(state);
  assert.deepEqual(end.reservations, {});
  assert.equal(end.reserved.galaxy?.jobs ?? 0, 0);
  assert.equal(end.used.galaxy?.jobs ?? 0, 0);
  assert.equal(toolPosts(calls).length, 1, "OFFLINE/MOCK: 403 is not retryable");
});

test("OFFLINE/MOCK insufficient quota 429 budget_exhausted denies the second job without a leak", async () => {
  const { db, state } = createM7FakeD1({
    governor: JSON.stringify(governorState({ totals: { galaxy: { jobs: 1, bytes: 4096 } } })),
    consents: [consent(), consent({ public_id: CONSENT2 })]
  });
  const calls = [];
  const env = makeEnv(db, mockFetch(calls));
  const first = await submit(env);
  assert.equal(first.status, 202);
  const second = await submit(env, { consent_id: CONSENT2 });
  assert.equal(second.status, 429);
  assert.equal(second.headers.get("X-Governor-Reason"), "budget_exhausted");
  assert.equal(state.providerJobs.size, 1, "OFFLINE/MOCK: denied job must not be persisted");
  const end = finalGovernor(state);
  assert.deepEqual(end.reservations, {});
  assert.equal(end.reserved.galaxy?.jobs ?? 0, 0);
  assert.equal(end.used.galaxy?.jobs, 1);
  assert.equal(toolPosts(calls).length, 1, "OFFLINE/MOCK: refused job must not reach the provider POST");
});

test("OFFLINE/MOCK provider 429 budget_exhausted is retried only up to the adapter's bounded count", async () => {
  const calls = [];
  const fetchImpl = mockFetch(calls, { error: { status: 429, body: errors.budget_exhausted_429 } });
  const result = await createAdapter({
    GALAXY_ENABLED: "true", GALAXY_BASE_URL: "https://m7-2-retry.invalid", GALAXY_API_KEY: "MOCK-KEY"
  }).submitJob({ operation: "submit_job", tool_id: TOOL_ID, history_id: jobs.history.id }, {
    fetch: fetchImpl, sleep: noSleep()
  });
  assert.equal(result.status, "failed");
  assert.equal(result.error.code, "budget_exhausted");
  assert.equal(toolPosts(calls).length, 2, "OFFLINE/MOCK: submission POST is capped at 2 attempts");
});

test("OFFLINE/MOCK retry helper never exceeds its bounded attempt cap", async () => {
  let count = 0;
  const always500 = async () => { count += 1; return json(errors.server_error_500, 500); };
  await assert.rejects(requestResponse("galaxy", always500, "https://m7-2-retry.invalid/x", {}, {
    attempts: 5, baseDelayMs: 0, sleep: noSleep()
  }));
  assert.equal(count, 5, "OFFLINE/MOCK: 5xx retry is bounded to the configured maximum");

  count = 0;
  const always401 = async () => { count += 1; return json(errors.expired_credentials_401, 401); };
  await assert.rejects(requestResponse("galaxy", always401, "https://m7-2-retry.invalid/x", {}, {
    attempts: 5, baseDelayMs: 0, sleep: noSleep()
  }));
  assert.equal(count, 1, "OFFLINE/MOCK: 401 must not be retried at all");
});

test("OFFLINE/MOCK unadvertised tool returns 400 and creates no reservation", async () => {
  const seed = JSON.stringify(governorState());
  const { db, state } = createM7FakeD1({ governor: seed, consents: [consent()] });
  const calls = [];
  const response = await submit(makeEnv(db, mockFetch(calls)), { tool_id: "m7-2.not.advertised" });
  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /not registered/);
  assert.equal(state.providerJobs.size, 0);
  assert.equal(state.governor, seed, "OFFLINE/MOCK: no governor write for an unadvertised tool");
  assert.equal(toolPosts(calls).length, 0);
});

test("OFFLINE/MOCK failed remote workflow result is never persisted as submitted", async () => {
  const { db, state } = createM7FakeD1({
    governor: JSON.stringify(governorState()), consents: [consent()]
  });
  const calls = [];
  const env = makeEnv(db, mockFetch(calls, { invocation: jobs.failed_invocation }));
  const response = await submit(env, { tool_id: undefined, workflow_id: WORKFLOW_ID, operation: "invoke_workflow" });
  assert.equal(response.status >= 400, true, `OFFLINE failed workflow was accepted: ${response.status}`);
  assert.equal(state.providerJobs.size, 0, "OFFLINE/MOCK: failed result must never be stored as submitted");
  assert.equal(state.transfers.length, 0);
  const end = finalGovernor(state);
  assert.deepEqual(end.reservations, {});
  assert.equal(end.reserved.galaxy?.jobs ?? 0, 0);
  assert.equal(end.used.galaxy?.jobs ?? 0, 0);
});

test("OFFLINE/MOCK cancelling a job keeps consumed usage and does not re-release the reservation", async () => {
  const { db, state } = createM7FakeD1({
    governor: JSON.stringify(governorState()), consents: [consent()]
  });
  const calls = [];
  const env = makeEnv(db, mockFetch(calls));
  const submitRes = await submit(env);
  assert.equal(submitRes.status, 202);
  const jobId = (await submitRes.json()).job.id;
  const cancelRes = await call(env, "POST", `/api/providers/jobs/${jobId}/cancel`, {}, {
    "X-Agent-Token": "m7-2-offline-agent-token"
  });
  assert.equal(cancelRes.status, 200);
  assert.equal((await cancelRes.json()).job.status, JOB_STATUS.CANCELLED);
  assert.equal(state.providerJobs.get(jobId).status, JOB_STATUS.CANCELLED);
  assert.equal(calls.filter((entry) => entry.url.includes("/cancel") && entry.method === "POST").length, 1);
  const end = finalGovernor(state);
  assert.deepEqual(end.reservations, {});
  assert.equal(end.reserved.galaxy?.jobs ?? 0, 0);
  assert.equal(end.used.galaxy?.jobs, 1, "OFFLINE/MOCK: a submitted job stays charged after cancellation");
  assert.equal(end.usage.galaxy?.jobs_cancelled, 1);
});

test("OFFLINE/MOCK status monitoring observes a cancelled MOCK job and records it", async () => {
  const { db, state } = createM7FakeD1({
    governor: JSON.stringify(governorState()), consents: [consent()],
    providerJobs: [{
      public_id: "pjob_3333333333333333", provider: "galaxy", tool_id: TOOL_ID,
      operation: "submit_job", status: JOB_STATUS.QUEUED, provider_job_id: jobs.queued_job.id,
      reservation_id: "rsv_3333333333333333", dataset_id: DATASET, byte_count: 0,
      consent_id: CONSENT, transfer_id: "xfer_3333333333333333"
    }]
  });
  const env = makeEnv(db, mockFetch([], { state: "cancelled" }));
  const response = await call(env, "GET", "/api/providers/jobs/pjob_3333333333333333");
  assert.equal(response.status, 200);
  assert.equal((await response.json()).job.status, JOB_STATUS.CANCELLED);
  assert.equal(state.providerJobs.get("pjob_3333333333333333").status, JOB_STATUS.CANCELLED);
});

test("OFFLINE/MOCK duplicate submission (reused consent) returns 409 duplicate_submission", async () => {
  const { db, state } = createM7FakeD1({
    governor: JSON.stringify(governorState()), consents: [consent()]
  });
  const calls = [];
  const env = makeEnv(db, mockFetch(calls));
  const first = await submit(env);
  assert.equal(first.status, 202);
  const duplicate = await submit(env);
  assert.equal(duplicate.status, 409);
  assert.equal(duplicate.headers.get("X-Governor-Reason"), "duplicate_submission");
  assert.equal(state.providerJobs.size, 1, "OFFLINE/MOCK: a repeat must not create a second job");
  const end = finalGovernor(state);
  assert.equal(end.used.galaxy?.jobs, 1);
  assert.deepEqual(end.reservations, {});
  assert.equal(toolPosts(calls).length, 1);
});

test("OFFLINE/MOCK consent denial and consent mismatch never create a job or reservation", async () => {
  const seed = JSON.stringify(governorState());
  const { db, state } = createM7FakeD1({
    governor: seed,
    consents: [
      consent({ public_id: CONSENT2, dataset_id: OTHER_DATASET }),
      consent({ scope_json: JSON.stringify({ operation: "invoke_workflow", destination: "galaxy" }) })
    ]
  });
  const denied = await call(makeEnv(db, mockFetch([])), "POST", "/api/providers/consent", {
    provider: "galaxy", dataset_id: DATASET, granted: false
  });
  assert.equal(denied.status, 403);
  assert.equal(denied.headers.get("X-Governor-Reason"), "consent_denied");
  assert.equal(state.consents.size, 2, "OFFLINE/MOCK: a denial must not mint a consent record");

  const mismatch = await submit(makeEnv(db, mockFetch([])), { consent_id: CONSENT2 });
  assert.equal(mismatch.status, 403);
  assert.equal(mismatch.headers.get("X-Governor-Reason"), "consent_mismatch");
  assert.equal(state.providerJobs.size, 0);
  assert.equal(state.governor, seed, "OFFLINE/MOCK: no governor write before a valid consent");

  const scoped = await submit(makeEnv(db, mockFetch([])));
  assert.equal(scoped.status, 403);
  assert.equal(scoped.headers.get("X-Governor-Reason"), "consent_scope_operation");
  assert.equal(state.providerJobs.size, 0);
});

test("OFFLINE/MOCK download authorization denial without owner token or valid consent", async () => {
  const { db } = createM7FakeD1({
    artifacts: [storedArtifact()],
    consents: [consent({ public_id: CONSENT2, expires_at: PAST })]
  });
  const env = makeEnv(db, mockFetch([]));
  const anonymous = await call(env, "GET", `/api/artifacts/${ARTIFACT}/download-url`);
  assert.equal(anonymous.status, 403);
  const badConsent = await call(env, "GET", `/api/artifacts/${ARTIFACT}/download-url?consent_id=pcon_9999999999999999`);
  assert.equal(badConsent.status, 403);
  const expiredConsent = await call(env, "GET", `/api/artifacts/${ARTIFACT}/download-url?consent_id=${CONSENT2}`);
  assert.equal(expiredConsent.status, 403);
  assert.match((await expiredConsent.json()).error, /invalid or expired/i);
});

test("OFFLINE/MOCK expired, tampered and wrong-operation signed tickets are rejected", async () => {
  const { db } = createM7FakeD1();
  const env = makeEnv(db, mockFetch([]));
  const store = createArtifactStore(env);
  const payload = {
    op: "download", dataset_id: DATASET, object_key: "datasets/mock/report.txt",
    filename: "report.txt", mime: "text/plain", bytes: 4
  };
  const expired = await store.sign({ ...payload, exp: Date.now() - 1000 }, 300);
  const valid = await store.sign(payload, 300);
  const [encoded, signature] = valid.split(".");
  const tampered = `${encoded}.${signature.slice(0, -1)}${signature.endsWith("A") ? "B" : "A"}`;
  const wrongOp = await store.sign({ ...payload, op: "upload", exp: Date.now() + 60_000 }, 300);
  for (const [label, ticket] of [["expired", expired], ["tampered", tampered], ["wrong-op", wrongOp]]) {
    const response = await call(env, "GET", `/api/artifacts/content?ticket=${encodeURIComponent(ticket)}`);
    assert.equal(response.status, 403, `OFFLINE/MOCK: ${label} ticket must be rejected`);
    assert.match((await response.json()).error, /Invalid or expired download ticket/);
  }
});

test("OFFLINE/MOCK invalid artifact hash is rejected by the M6 gate and by streaming upload", async () => {
  const tool = getTool("sequence-stats.profile");
  const { db, state } = createM7FakeD1({
    governor: JSON.stringify(governorState()),
    tables: {
      jobs: [{
        public_id: AI_JOB, plan_id: PLAN, step_id: "step_1", status: "running",
        tool_id: "sequence-stats.profile", backend: "local-python", execution_mode: "mock",
        agent_id: "m7-2-offline-agent", attempts: 1, created_at: FUTURE, started_at: FUTURE,
        finished_at: null, inputs_json: JSON.stringify({ dataset_id: DATASET, fasta_text: FASTA }),
        params_json: "{}", consent_json: "{}"
      }]
    }
  });
  const validationJson = '{"total_records":1,"valid_records":1,"invalid_records":0}';
  const statisticsJson = '{"summary":{"gc_percent":50},"per_record":[]}';
  const artifacts = [
    { name: "validation.json", kind: "json", content: validationJson, sha256: await hashInput(validationJson) },
    { name: "statistics.json", kind: "json", content: statisticsJson, sha256: "0".repeat(64) }
  ];
  const result = {
    job_id: AI_JOB, status: "succeeded", execution_mode: "mock", artifacts,
    provenance: {
      run_id: AI_JOB, step_id: "step_1",
      tool: { id: tool.id, version: tool.version, backend: "local-python" },
      input: { dataset_id: DATASET, sha256: await hashInput(FASTA), filename: "m7-2-mock.fasta" },
      parameters: { sequence_type: "dna" },
      database: { name: null, release: null, retrieved_at: null },
      output: { artifact_names: artifacts.map((item) => item.name), sha256: await hashInput("m7-2-mock") },
      timing: { started_at: FUTURE, finished_at: FUTURE }, execution_mode: "mock"
    },
    validation: { status: "pass", flags: [], checked_rules: ["schema"] },
    explanation: { summary: "OFFLINE/MOCK", findings: [], limitations: [], references: [], uncertainty: "low" }
  };
  const env = makeEnv(db, mockFetch([]));
  const resultRes = await call(env, "POST", `/api/ai/jobs/${AI_JOB}/result`, result, {
    "X-Agent-Token": "m7-2-offline-agent-token"
  });
  assert.equal(resultRes.status, 400);
  assert.match((await resultRes.json()).error, /Artifact hash mismatch: statistics\.json/);
  assert.equal((state.tables.artifacts ?? []).length, 0, "OFFLINE/MOCK: tampered artifacts must not be stored");
  assert.equal(state.tables.jobs[0].status, "running", "OFFLINE/MOCK: a failed gate must not close the job");

  const bytes = "M7.2 MOCK BYTES";
  const wrongSha = "1".repeat(64);
  const ticketRes = await call(env, "POST", "/api/artifacts/upload-url", {
    dataset_id: DATASET, filename: "m7-2-mock.txt",
    size_bytes: new TextEncoder().encode(bytes).length, sha256: wrongSha, mime: "text/plain"
  });
  assert.equal(ticketRes.status, 201);
  const ticket = await ticketRes.json();
  const uploadRes = await call(env, "PUT", ticket.upload_url, bytes, { "Content-Type": "text/plain" });
  assert.equal(uploadRes.status, 400);
  assert.match((await uploadRes.json()).error, /integrity verification/);
  assert.equal(env.ARTIFACTS.objects.size, 0, "OFFLINE/MOCK: mismatched upload must be deleted, never stored");
});
