// M7 validation-only tests (no production code is modified).
// Provider traffic is injected via FETCH_IMPL; no real network calls or credentials.
// These cover gaps not exercised by the existing M7 test files:
//   - registry advertises zero tools when flags are on but credentials are absent
//   - smarts.bio chat typed 403 even when BOTH its flag and authorization flag are on
//   - consent denial / mismatch / expiry blocks provider job submission
//   - plan endpoint rejects unregistered tool ids and submits no job
import test from "node:test";
import assert from "node:assert/strict";

import { createRegistry } from "../providers/registry.js";
import { PROVIDER_SQL } from "../functions/api/providers/_lib.js";
import { SQL as AI_SQL } from "../functions/api/ai/_lib.js";
import { onRequest as chatOnRequest } from "../functions/api/providers/chat.js";
import { onRequest as jobsOnRequest } from "../functions/api/providers/jobs/index.js";
import { onRequest as planOnRequest } from "../functions/api/providers/plan.js";

const DATASET = "ds_0123456789abcdef";
const OTHER_DATASET = "ds_ffffffffffffffff";
const TOOL_ID = "validation.tool.alpha";
const MODEL_ID = "validation-model-1";
const GALAXY_BASE = "https://galaxy.m7-validation.invalid";
const ROUTER_BASE = "https://router.m7-validation.invalid/v1";
const FUTURE = new Date(Date.now() + 3600_000).toISOString();
const PAST = new Date(Date.now() - 60_000).toISOString();

const GOVERNOR_ALERT_SQL =
  "INSERT INTO governor_alerts (public_id, provider, unit, category, ratio, kind, at) VALUES (?, ?, ?, ?, ?, ?, ?)";

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function post(path, payload) {
  return new Request(`https://m7-validation.example.test${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
}

// Purpose-built fake D1 for the migration-0007 tables (as suggested by
// functions/api/providers/_lib.js:22). Unexpected SQL throws so gaps surface.
function createProviderDb(seed = {}) {
  const state = {
    governor: seed.governorState ?? null,
    consents: new Map((seed.consents ?? []).map((row) => [row.public_id, { ...row }])),
    jobs: [],
    transfers: [],
    audit: [],
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
            const [public_id, dataset_id, provider, destination, scope_json, granted, created_at, expires_at] = v;
            state.consents.set(public_id, { public_id, dataset_id, provider, destination, scope_json, granted, created_at, expires_at });
            return { success: true, meta: { changes: 1 } };
          }
          if (sql === PROVIDER_SQL.consumeConsent) {
            const row = state.consents.get(v[1]);
            if (!row || row.granted !== 1 || row.used_at) return { success: true, meta: { changes: 0 } };
            row.granted = 0;
            row.used_at = v[0];
            return { success: true, meta: { changes: 1 } };
          }
          if (sql === PROVIDER_SQL.insertProviderJob) { state.jobs.push([...v]); return { success: true, meta: { changes: 1 } }; }
          if (sql === PROVIDER_SQL.insertTransfer) { state.transfers.push([...v]); return { success: true, meta: { changes: 1 } }; }
          if (sql === GOVERNOR_ALERT_SQL) { state.alerts.push([...v]); return { success: true, meta: { changes: 1 } }; }
          if (sql === AI_SQL.insertAudit) { state.audit.push([...v]); return { success: true, meta: { changes: 1 } }; }
          throw new Error(`Unexpected run SQL: ${sql}`);
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
          throw new Error(`Unexpected all SQL: ${sql}`);
        }
      };
      return stmt;
    }
  };
  return { db, state };
}

function baseEnv(db, extra = {}) {
  return {
    AI_DB: db,
    FETCH_IMPL: () => { throw new Error("Unexpected real network call"); },
    ...extra
  };
}

function galaxyFetch(calls) {
  return async (input, init = {}) => {
    const url = String(input);
    const method = init.method ?? "GET";
    calls.push({ url, method });
    if (url.includes("/api/tools") && method === "GET") return json([{ id: TOOL_ID, name: "Validation tool", inputs: [], outputs: [] }]);
    if (url.includes("/api/workflows") && method === "GET") return json([]);
    if (url.includes("/api/histories") && method === "POST") return json({ id: "history_validation" });
    if (url.includes("/api/tools") && method === "POST") return json({ id: "provider_job_validation", state: "queued" });
    return json({}, 404);
  };
}

function routerFetch(calls, proposedTools) {
  return async (input, init = {}) => {
    const url = String(input);
    const method = init.method ?? "GET";
    calls.push({ url, method });
    if (method === "GET" && url.includes("/v1/models")) return json({ data: [{ id: MODEL_ID }] });
    if (method === "POST" && url.includes("/v1/chat/completions")) {
      const body = JSON.parse(init.body);
      const structured = {
        intent: "validation",
        confidence: 0.9,
        proposed_tools: proposedTools,
        clarifying_questions: [],
        limitations: ["validation-only fixture"]
      };
      return json({
        choices: [{ message: { content: JSON.stringify(structured) }, finish_reason: "stop" }],
        model: MODEL_ID,
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 }
      });
    }
    return json({}, 404);
  };
}

test("registry advertises zero tools when flags are enabled but credentials are absent", async () => {
  const calls = [];
  const fetchImpl = (input) => { calls.push(String(input)); return json({}, 404); };
  // All three flags are ON; no base URLs, API keys or model are configured.
  const env = { GALAXY_ENABLED: "true", SMARTSBIO_ENABLED: "true", NINEROUTER_ENABLED: "true" };
  const registry = createRegistry(env, { fetch: fetchImpl });
  const ctx = { fetch: fetchImpl };

  assert.deepEqual(await registry.advertisedTools(ctx), []);
  const providers = await registry.listProviders(ctx);
  assert.equal(providers.length, 3);
  for (const entry of providers) {
    assert.deepEqual(entry.tools, [], `no tools may be advertised for ${entry.id}`);
    assert.deepEqual(entry.operations, [], `no operations may be advertised for ${entry.id}`);
  }
  assert.equal(providers.find((p) => p.id === "galaxy").availability, "unavailable");
  assert.equal(providers.find((p) => p.id === "ninerouter").availability, "unavailable");
  assert.equal(calls.length, 0, "credential-less providers must never be contacted");
});

test("smarts.bio chat is a typed 403 even with flag AND authorization flag enabled", async () => {
  const env = baseEnv(createProviderDb().db, {
    SMARTSBIO_ENABLED: "true",
    SMARTSBIO_PUBLIC_AUTHORIZED: "true",
    SMARTSBIO_BASE_URL: "https://smarts.m7-validation.invalid/v1",
    SMARTSBIO_API_KEY: "mock-key"
  });
  const response = await chatOnRequest({
    request: post("/api/providers/chat", { provider: "smartsbio", message: "hello" }),
    env
  });
  assert.equal(response.status, 403);
  assert.equal(response.headers.get("X-Provider"), "smartsbio");
  const detail = JSON.parse(response.headers.get("X-Error-Detail") ?? "{}");
  assert.equal(detail.reason, "service_terms_authorization_pending");
  assert.match((await response.json()).error, /authorization/i);
});

test("consent denial, mismatch and expiry block provider job submission", async () => {
  const cases = [
    { id: "req_1111111111111111", reason: "consent_mismatch", note: "granted=false" },
    { id: "req_2222222222222222", reason: "consent_mismatch", note: "wrong provider" },
    { id: "req_3333333333333333", reason: "consent_mismatch", note: "wrong dataset" },
    { id: "req_4444444444444444", reason: "consent_expired", note: "expired" }
  ];
  const consents = [
    { public_id: cases[0].id, dataset_id: DATASET, provider: "galaxy", granted: 0, expires_at: FUTURE },
    { public_id: cases[1].id, dataset_id: DATASET, provider: "ninerouter", granted: 1, expires_at: FUTURE },
    { public_id: cases[2].id, dataset_id: OTHER_DATASET, provider: "galaxy", granted: 1, expires_at: FUTURE },
    { public_id: cases[3].id, dataset_id: DATASET, provider: "galaxy", granted: 1, expires_at: PAST }
  ];

  for (const entry of cases) {
    const { db, state } = createProviderDb({ consents });
    const calls = [];
    const env = baseEnv(db, {
      GALAXY_ENABLED: "true",
      GALAXY_BASE_URL: `${GALAXY_BASE}/consent`,
      GALAXY_API_KEY: "mock-key",
      FETCH_IMPL: galaxyFetch(calls)
    });
    let response;
    try {
      response = await jobsOnRequest({
        request: post("/api/providers/jobs", {
          provider: "galaxy", tool_id: TOOL_ID, dataset_id: DATASET,
          consent_id: entry.id, size_bytes: 0
        }),
        env
      });
    } catch (err) {
      assert.fail(`${entry.note}: job submission must return a typed response, not throw ${err.name}: ${err.message}`);
    }
    assert.equal(response.status, 403, entry.note);
    assert.equal(response.headers.get("X-Governor-Reason"), entry.reason, entry.note);
    assert.equal(state.jobs.length, 0, `${entry.note}: no provider job may be recorded`);
    assert.equal(calls.filter((call) => call.method === "POST").length, 0, `${entry.note}: no provider job may be submitted`);
  }
});

test("plan endpoint rejects unregistered tool ids and never submits a job", async () => {
  const bogus = [
    { tool_id: "tool.not.registered", provider: "galaxy", params: {}, reason: "bogus" },
    { tool_id: "validation-model-NOT-ADVERTISED", provider: "ninerouter", params: {}, reason: "bogus" }
  ];
  const { db, state } = createProviderDb({
    governorState: JSON.stringify({
      version: 1, totals: { ninerouter: { requests: 100 } },
      used: { ninerouter: {} }, reserved: { ninerouter: {} },
      reservations: {}, emergency: {}, usage: {}, alerts: []
    })
  });
  const calls = [];
  const env = baseEnv(db, {
    NINEROUTER_ENABLED: "true",
    NINEROUTER_BASE_URL: `${ROUTER_BASE}/plan`,
    NINEROUTER_API_KEY: "mock-key",
    NINEROUTER_MODEL: MODEL_ID,
    FETCH_IMPL: routerFetch(calls, bogus)
  });

  const response = await planOnRequest({
    request: post("/api/providers/plan", { objective: "Propose a workflow using only registered tools." }),
    env
  });
  assert.equal(response.status, 200, `plan failed: ${JSON.stringify(await response.clone().json())}`);
  const body = await response.json();
  assert.equal(body.proposal.steps.length, 0, "no unregistered tool may be accepted");
  assert.equal(body.proposal.rejected_steps.length, bogus.length);
  for (const rejected of body.proposal.rejected_steps) {
    assert.equal(rejected.reason, "not_registered_or_unavailable");
  }
  assert.deepEqual(body.destination_disclosure.external_providers, []);
  assert.equal(body.destination_disclosure.data_leaves_platform, false);
  assert.equal(body.executable, false);
  assert.equal(body.requires_approval, true);
  assert.equal(state.jobs.length, 0, "planning must never insert a provider job");
  assert.equal(state.transfers.length, 0, "planning must never create a transfer");
  assert.deepEqual(
    calls.map((call) => `${call.method} ${call.url}`).filter((entry) => !entry.includes("/v1/")),
    [],
    "no job-submission endpoint may be called by the plan endpoint"
  );
});
