import test from "node:test";
import assert from "node:assert/strict";
import { handleSubmit } from "../functions/api/blast/submit.js";
import { handleStatus, onRequest } from "../functions/api/blast/status/[rid].js";
import { createFakeD1, makeGetRequest, makePostRequest, mockEnv, VALID_PAYLOAD } from "./helpers/fake-d1.mjs";

const T0 = Date.parse("2026-11-24T12:00:00.000Z");

async function queuedRid() {
  const { db, state } = createFakeD1();
  const env = mockEnv(db);
  const response = await handleSubmit(makePostRequest(VALID_PAYLOAD), env, { now: T0 });
  const { rid } = await response.json();
  return { rid, db, state, env };
}

function statusRequest(rid) {
  return makeGetRequest(`/api/blast/status/${rid}`);
}

test("first status check advances mock job to complete and updates D1", async () => {
  const { rid, state, env } = await queuedRid();
  const response = await handleStatus(rid, statusRequest(rid), env, { now: T0 + 1000 });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { status: "complete" });
  assert.equal(state.rows[0].status, "complete");
  assert.equal(state.rows[0].last_checked_at, new Date(T0 + 1000).toISOString());
});

test("a second check within one minute returns 429 with Retry-After", async () => {
  const { rid, state, env } = await queuedRid();
  await handleStatus(rid, statusRequest(rid), env, { now: T0 + 1000 });
  const before = { ...state.rows[0] };
  const response = await handleStatus(rid, statusRequest(rid), env, { now: T0 + 2000 });
  assert.equal(response.status, 429);
  assert.ok(Number(response.headers.get("Retry-After")) > 0);
  assert.match((await response.json()).error, /too recently/i);
  assert.deepEqual(state.rows[0], before);
});

test("polling is allowed again after the one-minute interval", async () => {
  const { rid, env } = await queuedRid();
  await handleStatus(rid, statusRequest(rid), env, { now: T0 + 1000 });
  const response = await handleStatus(rid, statusRequest(rid), env, { now: T0 + 61000 });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { status: "complete" });
});

test("unknown and malformed request IDs are rejected", async () => {
  const { db, env } = createFakeD1();
  const missing = await handleStatus("MISSING123", statusRequest("MISSING123"), mockEnv(db));
  assert.equal(missing.status, 404);
  const invalid = await handleStatus("<script>", statusRequest("bad"), env);
  assert.equal(invalid.status, 400);
});

test("onRequest reads params.rid and enforces the method", async () => {
  const { rid, env } = await queuedRid();
  const ok = await onRequest({ request: statusRequest(rid), env, params: { rid } });
  assert.equal(ok.status, 200);
  const wrong = await onRequest({
    request: new Request(`https://blast.example.test/api/blast/status/${rid}`, { method: "POST" }),
    env,
    params: { rid }
  });
  assert.equal(wrong.status, 405);
  const options = await onRequest({
    request: new Request(`https://blast.example.test/api/blast/status/${rid}`, { method: "OPTIONS" }),
    env,
    params: { rid }
  });
  assert.equal(options.status, 204);
});

test("status falls back to the URL path when params are absent", async () => {
  const { rid, env } = await queuedRid();
  const response = await onRequest({ request: statusRequest(rid), env });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).status, "complete");
});