import test from "node:test";
import assert from "node:assert/strict";

import { SQL_META } from "../functions/api/ai/_lib.js";
import { SQL_LIST_HEARTBEATS, handleBackendStatus } from "../functions/api/ai/backend.js";
import { SQL_UPSERT_HEARTBEAT, handlePollJobs } from "../functions/api/ai/jobs/index.js";
import { createFakeD1AI, makeGetRequest, mockAIEnv } from "./helpers/fake-d1.mjs";

// The shared fake D1 is driven by SQL_META from _lib.js. Register the two
// heartbeat statements here (test-local) so no production helper is edited.
SQL_META[SQL_UPSERT_HEARTBEAT] = {
  op: "insert",
  table: "agent_heartbeats",
  columns: ["agent_id", "last_seen_at", "last_job_count"]
};
SQL_META[SQL_LIST_HEARTBEATS] = {
  op: "select",
  table: "agent_heartbeats",
  where: []
};

const NOW = Date.parse("2026-11-25T12:00:00.000Z");
const TOKEN = "test-agent-token";

function pollRequest({ token = TOKEN, agentId = "local-agent" } = {}) {
  const headers = token ? { "X-Agent-Token": token } : {};
  const path = agentId ? `/api/ai/jobs?agentId=${encodeURIComponent(agentId)}` : "/api/ai/jobs";
  return makeGetRequest(path, headers);
}

async function backendBody(env) {
  const response = await handleBackendStatus(makeGetRequest("/api/ai/backend"), env, { now: NOW });
  assert.equal(response.status, 200);
  return response.json();
}

function heartbeatRow(lastSeenAt) {
  return {
    agent_id: "local-agent",
    last_seen_at: new Date(lastSeenAt).toISOString(),
    last_job_count: 0
  };
}

test("successful authenticated poll writes a heartbeat and backend reports connected via heartbeat", async () => {
  const fake = createFakeD1AI();
  const env = mockAIEnv(fake.db, TOKEN);

  const response = await handlePollJobs(pollRequest(), env, { now: NOW });
  assert.equal(response.status, 200);

  const rows = fake.state.tables.agent_heartbeats ?? [];
  assert.equal(rows.length, 1);
  assert.equal(rows[0].agent_id, "local-agent");
  assert.equal(rows[0].last_seen_at, new Date(NOW).toISOString());
  assert.ok(!JSON.stringify(rows).includes(TOKEN), "raw agent token must never be persisted");

  const upsertCall = fake.state.calls.find((call) => call.sql === SQL_UPSERT_HEARTBEAT);
  assert.ok(upsertCall, "heartbeat must be written with bound SQL parameters");
  assert.equal(upsertCall.kind, "run");
  assert.equal(upsertCall.values.length, 3);

  const body = await backendBody(env);
  assert.equal(body.agent_status, "connected");
  assert.equal(body.heavy_analyses_available, true);
  assert.equal(body.browser_local_available, true);
  assert.equal(body.simulated_results_available, false);
  assert.match(body.agent_observation_basis, /heartbeat/);
  assert.equal(body.last_agent_activity_at, new Date(NOW).toISOString());
});

test("unauthenticated poll writes no heartbeat and backend stays not connected", async () => {
  const fake = createFakeD1AI();
  const env = mockAIEnv(fake.db, TOKEN);

  const response = await handlePollJobs(pollRequest({ token: "" }), env, { now: NOW });
  assert.equal(response.status, 401);
  assert.equal(fake.state.tables.agent_heartbeats?.length ?? 0, 0);
  assert.equal(
    fake.state.calls.some((call) => call.sql === SQL_UPSERT_HEARTBEAT),
    false
  );

  const body = await backendBody(env);
  assert.equal(body.agent_status, "not_connected");
  assert.equal(body.heavy_analyses_available, false);
});

test("stale heartbeat does not report connected", async () => {
  const fake = createFakeD1AI({
    agent_heartbeats: [heartbeatRow(NOW - 20 * 60_000)]
  });
  const body = await backendBody(mockAIEnv(fake.db, TOKEN));
  assert.equal(body.agent_status, "not_connected");
  assert.equal(body.heavy_analyses_available, false);
  assert.equal(body.simulated_results_available, false);
});

test("mock mode stays not connected even with a fresh heartbeat", async () => {
  const fake = createFakeD1AI({
    agent_heartbeats: [heartbeatRow(NOW - 1000)]
  });
  const env = { ...mockAIEnv(fake.db, TOKEN), AI_EXECUTION_MODE: "mock" };
  const body = await backendBody(env);
  assert.equal(body.agent_status, "not_connected");
  assert.equal(body.heavy_analyses_available, false);
  assert.equal(body.simulated_results_available, false);
});

test("poll without an explicit agent id stores a token-derived id, never the token", async () => {
  const fake = createFakeD1AI();
  const env = mockAIEnv(fake.db, TOKEN);

  const response = await handlePollJobs(pollRequest({ agentId: "" }), env, { now: NOW });
  assert.equal(response.status, 200);

  const row = fake.state.tables.agent_heartbeats?.[0];
  assert.ok(row, "heartbeat must be written even when the agent sends no id");
  assert.match(row.agent_id, /^token-[0-9a-f]{16}$/);
  assert.notEqual(row.agent_id, TOKEN);
  assert.ok(!JSON.stringify(row).includes(TOKEN));
});
