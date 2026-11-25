// M7.2-R2FREE OFFLINE / MOCK-only failure matrix for the R2-free Galaxy
// artifact architecture (Galaxy histories hold dataset bytes; D1 holds only
// metadata/hashes/provenance/ownership; the Worker owns authenticated retrieval).
//
// NOT LIVE EXECUTION. There is no GALAXY_API_KEY, no activated account and
// GALAXY_ENABLED=false in the operator environment, so live activation is
// STOPPED. Every Galaxy response below is a canned MOCK fixture returned by an
// injected fetch. D1 is an injected in-memory fake. No provider call, no secret,
// no credential and no real job is involved. The literal word MOCK is used in
// every label; nothing here is a live observation disguised as a test.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { createFetch, handlers } from "../worker.js";
import { SQL_META, hashInput } from "../functions/api/ai/_lib.js";
import { PROVIDER_SQL } from "../functions/api/providers/_lib.js";
import { SQL_UPSERT_HEARTBEAT } from "../functions/api/ai/jobs/index.js";
import { createAdapter } from "../providers/galaxy/index.js";
import { requestResponse } from "../providers/common/retry.js";
import {
  GALAXY_ARTIFACT_SQL_META, DIRECTIONS
} from "../storage/galaxy-artifacts.js";

const FIXTURES = new URL("./fixtures/providers/galaxy/", import.meta.url);
const fixture = (name) => JSON.parse(readFileSync(new URL(name, FIXTURES), "utf8"));
const discovery = fixture("m7_2_galaxy_discovery.json");
const jobs = fixture("m7_2_galaxy_jobs.json");
const errors = fixture("m7_2_galaxy_errors.json");

const TOOL_ID = discovery.tools.find((tool) => tool.disabled !== true).id;
const WORKFLOW_ID = discovery.workflows[0].id;
const DATASET = "ds_a111111111111111";
const OTHER_DATASET = "ds_b222222222222222";
const CONSENT = "pcon_a111111111111111";
const CONSENT2 = "pcon_b222222222222222";
const ARTIFACT = "art_a111111111111111";
const MISSING_ARTIFACT = "art_f333333333333333";
const AI_JOB = "job_a111111111111111";
const PLAN = "plan_a111111111111111";
const SECRET = "MOCK-API-KEY-DO-NOT-LEAK-4c1f9a2e";
const BYTE_MARKER = "MOCK-OUTPUT-BYTES-DO-NOT-STORE-IN-D1";
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
    totals: { galaxy: { jobs: 10, bytes: 4_096 } },
    used: { galaxy: {} }, usedByCategory: { galaxy: {} }, reserved: { galaxy: {} },
    reservations: {}, emergency: {}, usage: {}, alerts: [],
    ...overrides
  };
}
function consent(overrides = {}) {
  return {
    public_id: CONSENT, dataset_id: DATASET, provider: "galaxy", destination: "galaxy",
    scope_json: JSON.stringify({ operation: "submit_job", destination: "galaxy" }),
    granted: 1, created_at: FUTURE, expires_at: FUTURE, ...overrides
  };
}
function storedArtifact(overrides = {}) {
  return {
    public_id: ARTIFACT, dataset_id: DATASET, object_key: "galaxy/mock/report.txt",
    filename: "report.txt", mime: "text/plain", sha256: "0".repeat(64), bytes: 4,
    status: "stored", created_at: FUTURE, deleted_at: null, ...overrides
  };
}

// Purpose-built MOCK D1: covers only the statements used by these paths.
// The provider_artifacts table is metadata-only by construction; no value in
// this fake ever models an object-store byte payload.
function createFakeD1(seed = {}) {
  const state = {
    tables: {}, calls: [], governor: seed.governor ?? null,
    consents: new Map((seed.consents ?? []).map((row) => [row.public_id, { ...row }])),
    providerJobs: new Map((seed.providerJobs ?? []).map((row) => [row.public_id, { ...row }])),
    transfers: [...(seed.transfers ?? [])],
    artifacts: new Map((seed.artifacts ?? []).map((row) => [row.public_id, { ...row }])),
    audit: [], alerts: [], heartbeats: new Map()
  };
  let nextId = 1;
  for (const [table, rows] of Object.entries(seed.tables ?? {})) {
    state.tables[table] = rows.map((row) => ({ ...row, id: row.id ?? nextId++ }));
  }
  const ensure = (table) => (state.tables[table] ??= []);
  const matches = (row, columns, values) => columns.every((column, index) => row[column] === values[index]);
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
            row.status = v[0]; row.finished_at = v[1]; row.detail_json = v[2];
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
            row.status = v[0]; row.deleted_at = v[1];
            return ok(1);
          }
          if (sql === ALERT_SQL) { state.alerts.push([...v]); return ok(1); }
          if (sql === SQL_UPSERT_HEARTBEAT) {
            state.heartbeats.set(v[0], { agent_id: v[0], last_seen_at: v[1], last_job_count: v[2] });
            return ok(1);
          }
          const galaxyMeta = GALAXY_ARTIFACT_SQL_META[sql];
          if (galaxyMeta) {
            const rows = ensure(galaxyMeta.table);
            if (galaxyMeta.op === "insert") {
              const row = {};
              galaxyMeta.columns.forEach((column, index) => { row[column] = v[index] ?? null; });
              rows.push(row);
              return ok(1);
            }
            if (galaxyMeta.op === "update") {
              const whereValues = v.slice(-galaxyMeta.where.length);
              const matched = rows.filter((row) => matches(row, galaxyMeta.where, whereValues));
              for (const row of matched) {
                for (const [column, index] of Object.entries(galaxyMeta.assignments)) row[column] = v[index];
              }
              return ok(matched.length);
            }
            throw new Error(`Unexpected MOCK Galaxy artifact run op: ${galaxyMeta.op}`);
          }
          const meta = SQL_META[sql];
          if (!meta) throw new Error(`Unexpected MOCK D1 run SQL: ${sql}`);
          const rows = ensure(meta.table);
          if (meta.op === "insert") {
            const row = { id: nextId++ };
            meta.columns.forEach((column, index) => { row[column] = v[index] ?? null; });
            rows.push(row);
            return ok(1);
          }
          if (meta.op === "update" || meta.op === "claim") {
            const whereValues = v.slice(-meta.where.length);
            const matched = rows.filter((row) => matches(row, meta.where, whereValues));
            for (const row of matched) {
              for (const [column, index] of Object.entries(meta.assignments)) row[column] = v[index];
            }
            return ok(matched.length);
          }
          throw new Error(`Unexpected MOCK D1 run op: ${meta.op}`);
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
          const galaxyMeta = GALAXY_ARTIFACT_SQL_META[sql];
          if (galaxyMeta) {
            if (galaxyMeta.op !== "select") throw new Error(`Unexpected MOCK Galaxy artifact all op: ${galaxyMeta.op}`);
            let rows = ensure(galaxyMeta.table).filter(
              (row) => matches(row, galaxyMeta.where, stmt.values)
            );
            if (galaxyMeta.orderBy) rows = [...rows].sort((a, b) => String(a[galaxyMeta.orderBy]).localeCompare(String(b[galaxyMeta.orderBy])));
            if (galaxyMeta.limit) rows = rows.slice(0, stmt.values[stmt.values.length - 1]);
            return { success: true, results: rows.map((row) => ({ ...row })) };
          }
          const meta = SQL_META[sql];
          if (!meta || meta.op !== "select") throw new Error(`Unexpected MOCK D1 all SQL: ${sql}`);
          let rows = ensure(meta.table).filter((row) => matches(row, meta.where, stmt.values));
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
    GALAXY_BASE_URL: `https://m7-2-r2free-${sequence}.invalid`,
    GALAXY_API_KEY: SECRET,
    ARTIFACTS: {
      async put() {}, async get() { return null; }, async delete() {}
    },
    ARTIFACT_SIGNING_KEY: "m7-2-offline-hmac-key-not-a-real-secret",
    ...extra
  };
}

const workerFetch = createFetch(handlers);
function request(method, path, body, headers = {}) {
  const init = {
    method,
    headers: {
      "CF-Connecting-IP": `m7-2-r2free-${++ipSequence}`,
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      ...headers
    }
  };
  if (body !== undefined) init.body = typeof body === "string" ? body : JSON.stringify(body);
  return new Request(`https://m7-2-r2free.example.test${path}`, init);
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

// Canned MOCK Galaxy server. No value here is a real provider response.
function mockFetch(calls, { error = null, state = "queued", invocation = null, contents = jobs.contents } = {}) {
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
    if (url.includes("/api/histories/") && url.endsWith("/contents")) return json(contents);
    if (url.includes("/api/datasets/") && url.endsWith("/content")) {
      if (error) return json(error.body, error.status);
      return new Response(jobs.dataset_content);
    }
    if (url.includes("/api/datasets/")) {
      if (error) return json(error.body, error.status);
      return json(jobs.dataset);
    }
    return json(errors.not_found_404, 404);
  };
}
function toolPosts(calls) {
  return calls.filter((entry) => entry.method === "POST" && entry.url.endsWith("/api/tools") && entry.body.tool_id !== "upload1");
}
function asText(value) {
  return typeof value === "string" ? value : JSON.stringify(value ?? null);
}
function assertNoSecret(value, label) {
  assert.equal(asText(value).includes(SECRET), false, `${label}: MOCK secret must never be exposed`);
}
async function assertNoSecretInResponse(response, label) {
  assertNoSecret(await bodyText(response), `${label} body`);
  for (const [name, value] of response.headers) {
    assert.equal(value.includes(SECRET), false, `${label}: secret leaked in header ${name}`);
  }
}
async function bodyText(response) {
  // Clone so a body can be inspected more than once (status/header checks and
  // the secret sweep must not consume each other's stream).
  return response.clone().text();
}
function assertNoByteStorage(state, label) {
  const collections = [
    ...state.providerJobs.values(), ...state.artifacts.values(), ...state.consents.values(),
    ...state.transfers.map((row) => Object.fromEntries(row.map((value, index) => [index, value]))),
    ...Object.values(state.tables).flat()
  ];
  for (const row of collections) {
    assert.equal(
      Object.values(row ?? {}).some((value) => typeof value === "string" && value.includes(BYTE_MARKER)),
      false,
      `${label}: dataset bytes must not be written to D1`
    );
  }
}

test("OFFLINE/MOCK invalid credentials (401): typed error, no secret, no byte storage, no retry", async () => {
  const { db, state } = createFakeD1({
    governor: JSON.stringify(governorState()), consents: [consent()]
  });
  const calls = [];
  const env = makeEnv(db, mockFetch(calls, { error: { status: 401, body: errors.expired_credentials_401 } }));
  const adapterCalls = [];
  const adapter = createAdapter({
    GALAXY_ENABLED: "true", GALAXY_BASE_URL: env.GALAXY_BASE_URL, GALAXY_API_KEY: SECRET
  });
  const adapterResult = await adapter.submitJob({ operation: "submit_job", tool_id: TOOL_ID }, {
    fetch: mockFetch(adapterCalls, { error: { status: 401, body: errors.expired_credentials_401 } }),
    sleep: noSleep()
  });
  assert.equal(adapterResult.status, "failed");
  assert.equal(adapterResult.error.status, 401);
  assert.equal(adapterResult.error.code, "expired_api_key");
  assert.equal(adapterResult.error.retryable, false);
  assertNoSecret(adapterResult, "adapter 401 result");

  const response = await submit(env);
  assert.equal(response.status, 401);
  assert.equal(response.headers.get("X-Provider"), "galaxy");
  assert.equal(JSON.parse(response.headers.get("X-Error-Detail") ?? "{}").code, "expired_api_key");
  await assertNoSecretInResponse(response, "worker 401");
  assert.equal(state.providerJobs.size, 0);
  assert.equal(state.transfers.length, 0);
  assert.equal(state.artifacts.size, 0);
  assertNoByteStorage(state, "401 path");
  assert.deepEqual(JSON.parse(state.governor).reservations, {});
  assert.equal(toolPosts(calls).length, 1, "401 must not be retried");
});

test("OFFLINE/MOCK activation restriction (403): typed error and fail-closed submission", async () => {
  const { db, state } = createFakeD1({
    governor: JSON.stringify(governorState()), consents: [consent()]
  });
  const calls = [];
  const env = makeEnv(db, mockFetch(calls, { error: { status: 403, body: errors.account_activation_403 } }));
  const response = await submit(env);
  assert.equal(response.status, 403);
  assert.equal(JSON.parse(response.headers.get("X-Error-Detail") ?? "{}").code, "action_requires_account_activation");
  assert.match(await bodyText(response), /HTTP 403/);
  await assertNoSecretInResponse(response, "worker 403");
  assert.equal(state.providerJobs.size, 0);
  assert.equal(state.artifacts.size, 0);
  assertNoByteStorage(state, "403 path");
  assert.deepEqual(JSON.parse(state.governor).reservations, {});
  assert.equal(toolPosts(calls).length, 1, "403 must not be retried");
});

test("OFFLINE/MOCK missing history: no invented reference, 404 is typed and not retried", async () => {
  const adapter = createAdapter({
    GALAXY_ENABLED: "true", GALAXY_BASE_URL: "https://m7-2-missing.invalid", GALAXY_API_KEY: SECRET
  });
  const noRefs = await adapter.getArtifacts({}, { fetch: async () => { throw new Error("should not be called"); } });
  assert.equal(noRefs.ok, false);
  assert.equal(noRefs.reason, "reference_required");
  assert.deepEqual(noRefs.artifacts, []);

  const calls = [];
  const fetch404 = async (input, init = {}) => {
    calls.push({ url: String(input), method: init.method ?? "GET", body: {} });
    return json(errors.not_found_404, 404);
  };
  const missing = await adapter.getArtifacts(
    { history_id: "missing_history" },
    { fetch: fetch404, sleep: noSleep() }
  );
  assert.equal(missing.ok, false);
  assert.equal(missing.error.status, 404);
  assert.equal(missing.error.code, "not_found");
  assert.equal(missing.error.retryable, false);
  assertNoSecret(missing, "missing-history error");
  assert.equal(calls.filter((entry) => entry.url.includes("/histories/")).length, 1, "404 must not be retried");
});

test("OFFLINE/MOCK deleted/expired Galaxy datasets (404/410) are not surfaced or retrieved", async () => {
  const adapter = createAdapter({
    GALAXY_ENABLED: "true", GALAXY_BASE_URL: "https://m7-2-expired.invalid", GALAXY_API_KEY: SECRET
  });
  const contents = [
    { id: "ds_deleted", name: "deleted.txt", state: "ok", deleted: true },
    { id: "ds_pending", name: "pending.txt", state: "queued" },
    { id: "ds_ok", name: "ok.txt", state: "ok" }
  ];
  const found = await adapter.getArtifacts({ history_id: "h_ok" }, { fetch: mockFetch([], { contents }) });
  assert.equal(found.ok, true);
  assert.deepEqual(found.artifacts.map((item) => item.id), ["ds_ok"], "only completed non-deleted datasets are artifacts");

  for (const status of [404, 410]) {
    const calls = [];
    const failed = await adapter.downloadArtifact(
      { artifact_id: "ds_expired" },
      { fetch: mockFetch(calls, { error: { status, body: errors.not_found_404 } }), sleep: noSleep() }
    );
    assert.equal(failed.ok, false);
    assert.equal(failed.error.status, status);
    assert.equal(failed.error.retryable, false);
    assertNoSecret(failed, `${status} download`);
    assert.equal(calls.filter((entry) => entry.url.endsWith("/content")).length, 1, `${status} must not be retried`);
  }
});

test("OFFLINE/MOCK unauthorized download: no owner token, wrong job dataset, unknown artifact", async () => {
  const { db, state } = createFakeD1({
    artifacts: [storedArtifact()],
    consents: [consent({ public_id: CONSENT2, dataset_id: OTHER_DATASET })]
  });
  const env = makeEnv(db, async () => json(errors.not_found_404, 404));

  const anonymous = await call(env, "GET", `/api/artifacts/${ARTIFACT}/download-url`);
  assert.equal(anonymous.status, 403);
  assert.match(await bodyText(anonymous), /owner token or a valid consent_id/);
  await assertNoSecretInResponse(anonymous, "anonymous download");

  const wrongJob = await call(env, "GET", `/api/artifacts/${ARTIFACT}/download-url?consent_id=${CONSENT2}`);
  assert.equal(wrongJob.status, 403, "consent bound to another job's dataset must not authorize retrieval");
  assert.match(await bodyText(wrongJob), /invalid or expired/i);

  const unregistered = await call(env, "GET", `/api/artifacts/${MISSING_ARTIFACT}/download-url`, undefined, {
    "X-Agent-Token": env.AI_AGENT_TOKEN
  });
  assert.equal(unregistered.status, 404, "no unregistered dataset may be retrieved");
  assert.equal(state.artifacts.size, 1);
});

test("OFFLINE/MOCK oversized upload and oversized job input are rejected before any provider POST", async () => {
  const { db, state } = createFakeD1({
    governor: JSON.stringify(governorState()), consents: [consent()]
  });
  const calls = [];
  const env = makeEnv(db, mockFetch(calls));
  const huge = await call(env, "POST", "/api/artifacts/upload-url", {
    dataset_id: DATASET, filename: "huge.fasta", size_bytes: 64 * 1024 * 1024 + 1,
    sha256: "0".repeat(64)
  });
  assert.equal(huge.status, 400);
  assert.match(await bodyText(huge), /File size/);

  const oversizedJob = await submit(env, { size_bytes: 64 * 1024 * 1024 + 1 });
  assert.equal(oversizedJob.status, 400);
  assert.match(await bodyText(oversizedJob), /size_bytes/);
  assert.equal(toolPosts(calls).length, 0, "oversized input must never reach the Galaxy POST");
  assert.equal(state.artifacts.size, 0);
  assertNoByteStorage(state, "oversize path");
});

test("OFFLINE/MOCK provider timeout: bounded single attempt, typed non-retryable error", async () => {
  const calls = [];
  const neverResolves = (input, init) => new Promise((resolve, reject) => {
    calls.push(String(input));
    init?.signal?.addEventListener("abort", () => {
      const error = new Error("provider request timed out");
      error.name = "AbortError";
      reject(error);
    });
  });
  const result = await createAdapter({
    GALAXY_ENABLED: "true", GALAXY_BASE_URL: "https://m7-2-timeout.invalid", GALAXY_API_KEY: SECRET
  }).submitJob({ operation: "submit_job", tool_id: TOOL_ID }, {
    fetch: neverResolves, sleep: noSleep(), timeoutMs: 5
  });
  assert.equal(result.status, "failed");
  assert.equal(result.error.status, 0);
  assert.equal(result.error.retryable, false);
  assertNoSecret(result, "timeout result");
  assert.equal(calls.length, 1, "a timeout abort must not spawn an unbounded retry loop");

  let count = 0;
  const always500 = async () => { count += 1; return json(errors.server_error_500, 500); };
  await assert.rejects(requestResponse("galaxy", always500, "https://m7-2-timeout.invalid/x", {}, {
    attempts: 5, baseDelayMs: 0, sleep: noSleep()
  }));
  assert.equal(count, 5, "retries stop at the configured cap");
});

test("OFFLINE/MOCK failed remote job and failed status are never surfaced as success", async () => {
  const { db, state } = createFakeD1({
    governor: JSON.stringify(governorState()), consents: [consent()]
  });
  const calls = [];
  const env = makeEnv(db, mockFetch(calls, { invocation: jobs.failed_invocation }));
  const response = await submit(env, {
    tool_id: undefined, workflow_id: WORKFLOW_ID, operation: "invoke_workflow"
  });
  assert.equal(response.status >= 400, true);
  assert.equal(state.providerJobs.size, 0, "a failed remote job must not be persisted as submitted");
  assert.equal(state.transfers.length, 0);
  assertNoByteStorage(state, "failed job path");

  const status = await createAdapter({
    GALAXY_ENABLED: "true", GALAXY_BASE_URL: env.GALAXY_BASE_URL, GALAXY_API_KEY: SECRET
  }).getJobStatus({ job_id: "m7-2-mock-job" }, {
    fetch: mockFetch([], { state: "error" }), sleep: noSleep()
  });
  assert.equal(status.status, "failed");
  assertNoSecret(status, "failed status");
});

test("OFFLINE/MOCK cancelled job is recorded once and the cancel call is not retried", async () => {
  const { db, state } = createFakeD1({
    governor: JSON.stringify(governorState()), consents: [consent()],
    providerJobs: [{
      public_id: "pjob_a111111111111111", provider: "galaxy", tool_id: TOOL_ID,
      operation: "submit_job", status: "queued", provider_job_id: jobs.queued_job.id,
      reservation_id: "rsv_a111111111111111", dataset_id: DATASET, byte_count: 0,
      consent_id: CONSENT, transfer_id: "xfer_a111111111111111", input_hash: "0".repeat(64)
    }]
  });
  const calls = [];
  const env = makeEnv(db, mockFetch(calls));
  const response = await call(env, "POST", "/api/providers/jobs/pjob_a111111111111111/cancel", {}, {
    "X-Agent-Token": env.AI_AGENT_TOKEN
  });
  assert.equal(response.status, 200);
  await assertNoSecretInResponse(response, "cancel");
  assert.equal((await response.json()).job.status, "cancelled");
  assert.equal(state.providerJobs.get("pjob_a111111111111111").status, "cancelled");
  assert.equal(calls.filter((entry) => entry.url.includes("/cancel")).length, 1);
});

test("OFFLINE/MOCK duplicate submission (reused consent) returns 409 with a single provider POST", async () => {
  const { db, state } = createFakeD1({
    governor: JSON.stringify(governorState()), consents: [consent()]
  });
  const calls = [];
  const env = makeEnv(db, mockFetch(calls));
  assert.equal((await submit(env)).status, 202);
  const duplicate = await submit(env);
  assert.equal(duplicate.status, 409);
  assert.equal(duplicate.headers.get("X-Governor-Reason"), "duplicate_submission");
  assert.equal(state.providerJobs.size, 1);
  assert.equal(toolPosts(calls).length, 1);
  await assertNoSecretInResponse(duplicate, "duplicate submit");
});

test("OFFLINE/MOCK missing output dataset yields an empty artifact list, never an invented id", async () => {
  const adapter = createAdapter({
    GALAXY_ENABLED: "true", GALAXY_BASE_URL: "https://m7-2-no-output.invalid", GALAXY_API_KEY: SECRET
  });
  const result = await adapter.getArtifacts(
    { job_id: "m7-2-mock-job", history_id: "m7-2-mock-history" },
    { fetch: mockFetch([], { contents: [] }), sleep: noSleep() }
  );
  assert.equal(result.ok, true);
  assert.deepEqual(result.artifacts, []);
  assertNoSecret(result, "empty artifacts");
});

test("OFFLINE/MOCK consent denial mints no record and no job", async () => {
  const { db, state } = createFakeD1({
    governor: JSON.stringify(governorState()), consents: [consent({ granted: 0 })]
  });
  const env = makeEnv(db, mockFetch([]));
  const denied = await call(env, "POST", "/api/providers/consent", {
    provider: "galaxy", dataset_id: DATASET, granted: false
  });
  assert.equal(denied.status, 403);
  assert.equal(denied.headers.get("X-Governor-Reason"), "consent_denied");
  assert.equal(state.consents.get(CONSENT).granted, 0);
  assert.equal(state.providerJobs.size, 0);
  await assertNoSecretInResponse(denied, "consent denial");
});

test("OFFLINE/MOCK invalid input hash is rejected by the upload ticket and the M6 result gate", async () => {
  const { db, state } = createFakeD1({
    tables: {
      jobs: [{
        public_id: AI_JOB, plan_id: PLAN, step_id: "step_1", status: "running",
        tool_id: "sequence-stats.profile", backend: "local-python", execution_mode: "mock",
        agent_id: "m7-2-offline-agent", attempts: 1, created_at: FUTURE, started_at: FUTURE,
        finished_at: null, inputs_json: JSON.stringify({ dataset_id: DATASET, fasta_text: ">x\nACGT\n" }),
        params_json: "{}", consent_json: "{}"
      }]
    }
  });
  const env = makeEnv(db, mockFetch([]));
  const badTicket = await call(env, "POST", "/api/artifacts/upload-url", {
    dataset_id: DATASET, filename: "sample.fasta", size_bytes: 4, sha256: "not-a-sha256"
  });
  assert.equal(badTicket.status, 400);
  assert.match(await bodyText(badTicket), /sha256/);

  const validationJson = '{"total_records":1,"valid_records":1,"invalid_records":0}';
  const result = {
    job_id: AI_JOB, status: "succeeded", execution_mode: "mock",
    artifacts: [
      { name: "validation.json", kind: "json", content: validationJson, sha256: await hashInput(validationJson) },
      { name: "statistics.json", kind: "json", content: "{}", sha256: "0".repeat(64) }
    ],
    provenance: {
      run_id: AI_JOB, step_id: "step_1",
      tool: { id: "sequence-stats.profile", version: "1.0", backend: "local-python" },
      input: { dataset_id: DATASET, sha256: await hashInput(">x\nACGT\n"), filename: "sample.fasta" },
      parameters: {}, database: { name: null, release: null, retrieved_at: null },
      output: { artifact_names: ["validation.json", "statistics.json"], sha256: await hashInput("mock") },
      timing: { started_at: FUTURE, finished_at: FUTURE }, execution_mode: "mock"
    },
    validation: { status: "pass", flags: [], checked_rules: ["schema"] },
    explanation: { summary: "MOCK", findings: [], limitations: [], references: [], uncertainty: "low" }
  };
  const gated = await call(env, "POST", `/api/ai/jobs/${AI_JOB}/result`, result, {
    "X-Agent-Token": env.AI_AGENT_TOKEN
  });
  assert.equal(gated.status, 400);
  assert.match(await bodyText(gated), /Artifact hash mismatch: statistics\.json/);
  assert.equal((state.tables.artifacts ?? []).length, 0);
  assertNoByteStorage(state, "invalid hash path");
});

// ---- End-to-end MOCK checks through the NEW R2-free Galaxy artifact routes ----
const artifactDatasets = fixture("m7_2_galaxy_artifacts_datasets.json");
const ART_GID = artifactDatasets.input_dataset.id;
const ART_HISTORY = artifactDatasets.history_id;
const ART_JOB = artifactDatasets.job_id;

function galaxyArtifactFetch(calls, {
  datasetHistory = ART_HISTORY, jobHistory = ART_HISTORY,
  datasetStatus = 200, datasetError = errors.not_found_404,
  content = artifactDatasets.content
} = {}) {
  return async (input, init = {}) => {
    const url = String(input);
    const method = init.method ?? "GET";
    const body = init.body ? JSON.parse(init.body) : {};
    calls.push({ url, method, body });
    if (url.endsWith("/api/tools") && method === "GET") return json(discovery.tools);
    if (url.endsWith("/api/workflows")) return json(discovery.workflows);
    if (url.endsWith("/api/histories") && method === "POST") return json(artifactDatasets.history);
    if (url.endsWith("/api/tools") && method === "POST") {
      if (body.tool_id === "upload1") return json(artifactDatasets.upload_job);
      return json(artifactDatasets.tool_job);
    }
    if (url.includes("/api/histories/") && url.endsWith("/contents")) return json(artifactDatasets.contents);
    if (url.includes("/api/jobs/")) return json({ ...artifactDatasets.job, history_id: jobHistory });
    if (url.includes("/api/datasets/") && url.endsWith("/content")) {
      if (datasetStatus !== 200) return json(datasetError, datasetStatus);
      return new Response(content);
    }
    if (url.includes("/api/datasets/")) {
      if (datasetStatus !== 200) return json(datasetError, datasetStatus);
      return json({ ...artifactDatasets.input_dataset, history_id: datasetHistory });
    }
    return json(errors.not_found_404, 404);
  };
}

function galaxyRegistered(overrides = {}) {
  return {
    public_id: "art_c111111111111111", dataset_id: DATASET,
    galaxy_dataset_id: ART_GID, job_id: ART_JOB, history_id: ART_HISTORY,
    filename: "artifact-input.fasta", ext: "fasta", direction: DIRECTIONS.INPUT,
    sha256: "0".repeat(64), bytes: artifactDatasets.content.length,
    project_id: null, created_at: FUTURE, deleted_at: null, ...overrides
  };
}

test("OFFLINE/MOCK Galaxy-only retrieval: owner token and registration are required", async () => {
  const seed = { galaxy_artifacts: [galaxyRegistered()], galaxy_artifact_downloads: [] };
  const { db, state } = createFakeD1({ tables: seed });
  const env = makeEnv(db, galaxyArtifactFetch([]));

  const anonymous = await call(env, "GET", `/api/providers/galaxy/datasets/${ART_GID}/download`);
  assert.equal(anonymous.status, 401, "no owner token means no dataset bytes");
  await assertNoSecretInResponse(anonymous, "Galaxy-only anonymous download");

  const unknown = await call(env, "GET", "/api/providers/galaxy/datasets/art_d111111111111111/download", undefined, {
    "X-Agent-Token": env.AI_AGENT_TOKEN
  });
  assert.equal(unknown.status, 404, "no unregistered dataset may be retrieved");
  assert.equal(JSON.parse(unknown.headers.get("X-Error-Detail") ?? "{}").code, "artifact_not_found");
  assert.equal(state.tables.galaxy_artifact_downloads.length, 0);
});

test("OFFLINE/MOCK Galaxy-only retrieval: wrong history/job is 409, purged dataset is 410, all audited", async () => {
  const seed = { galaxy_artifacts: [galaxyRegistered()], galaxy_artifact_downloads: [] };
  const { db, state } = createFakeD1({ tables: seed });

  const wrongHistory = makeEnv(db, galaxyArtifactFetch([], {
    datasetHistory: "m7-2-artifact-other-history"
  }));
  const historyRes = await call(wrongHistory, "GET", `/api/providers/galaxy/datasets/${ART_GID}/download`, undefined, {
    "X-Agent-Token": wrongHistory.AI_AGENT_TOKEN
  });
  assert.equal(historyRes.status, 409);
  assert.equal(JSON.parse(historyRes.headers.get("X-Error-Detail") ?? "{}").code, "history_mismatch");

  const wrongJob = makeEnv(db, galaxyArtifactFetch([], { jobHistory: "m7-2-artifact-other-job" }));
  const jobRes = await call(wrongJob, "GET", `/api/providers/galaxy/datasets/${ART_GID}/download`, undefined, {
    "X-Agent-Token": wrongJob.AI_AGENT_TOKEN
  });
  assert.equal(jobRes.status, 409);
  assert.equal(JSON.parse(jobRes.headers.get("X-Error-Detail") ?? "{}").code, "history_mismatch");

  const purged = makeEnv(db, galaxyArtifactFetch([], {
    datasetStatus: 404, datasetError: { error: "dataset_purged" }
  }));
  const purgeRes = await call(purged, "GET", `/api/providers/galaxy/datasets/${ART_GID}/download`, undefined, {
    "X-Agent-Token": purged.AI_AGENT_TOKEN
  });
  assert.equal(purgeRes.status, 410);
  assert.match(await bodyText(purgeRes), /deleted, expired or no longer available/i);

  assert.equal(state.tables.galaxy_artifact_downloads.length, 3, "every failed retrieval is audited");
  for (const row of state.tables.galaxy_artifact_downloads) {
    assert.equal(row.status, "failed");
    assert.equal(JSON.stringify(row).includes(SECRET), false, "no key in the download audit");
  }
});

test("OFFLINE/MOCK Galaxy-only happy download: hash verified, no secret, no D1 byte storage", async () => {
  const contentHash = await hashInput(artifactDatasets.content);
  const { db, state } = createFakeD1({
    tables: {
      galaxy_artifacts: [galaxyRegistered({ sha256: contentHash })],
      galaxy_artifact_downloads: []
    }
  });
  const env = makeEnv(db, galaxyArtifactFetch([]));
  const response = await call(env, "GET", `/api/providers/galaxy/datasets/${ART_GID}/download`, undefined, {
    "X-Agent-Token": env.AI_AGENT_TOKEN
  });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("X-Dataset-Sha256"), contentHash);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.equal(response.headers.get("Content-Security-Policy"), "default-src 'none'");
  assert.match(response.headers.get("Content-Disposition"), /^attachment;/);
  await assertNoSecretInResponse(response, "Galaxy-only happy download");
  assert.equal(await bodyText(response), artifactDatasets.content);
  assert.equal(state.tables.galaxy_artifact_downloads.length, 1);
  assert.equal(state.tables.galaxy_artifact_downloads[0].status, "ok");
  assert.equal(state.tables.galaxy_artifact_downloads[0].sha256, contentHash);
  assert.equal(JSON.stringify(state.tables).includes(artifactDatasets.content), false, "bytes must not land in D1");
});
