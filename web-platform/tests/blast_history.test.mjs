import test from "node:test";
import assert from "node:assert/strict";
import { handleSubmit } from "../functions/api/blast/submit.js";
import { handleHistory, onRequest } from "../functions/api/blast/history.js";
import { createFakeD1, makeGetRequest, makePostRequest, mockEnv, VALID_PAYLOAD, withConsent } from "./helpers/fake-d1.mjs";

const T0 = Date.parse("2026-11-24T12:00:00.000Z");

function historyRequest() {
  return makeGetRequest("/api/blast/history");
}

test("empty history returns an empty list", async () => {
  const { db } = createFakeD1();
  const response = await handleHistory(historyRequest(), mockEnv(db));
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.deepEqual(body.submissions, []);
  assert.equal(body.count, 0);
  assert.equal(body.mock, true);
});

test("history exposes only rid, status and created_at", async () => {
  const { db, state } = createFakeD1();
  const env = mockEnv(db);
  await handleSubmit(makePostRequest(await withConsent(VALID_PAYLOAD, db, { now: T0 })), env, { now: T0 });
  const response = await handleHistory(historyRequest(), env);
  const body = await response.json();
  assert.equal(body.submissions.length, 1);
  assert.deepEqual(Object.keys(body.submissions[0]).sort(), ["created_at", "rid", "status"]);
  assert.equal(body.submissions[0].rid, state.rows[0].rid);
  const text = JSON.stringify(body);
  assert.equal(text.includes("input_hash"), false);
  assert.equal(text.includes("result_tsv"), false);
  assert.equal(text.includes("ACGTACGT"), false);
});

test("history is newest-first and honours the limit", async () => {
  const { db, state } = createFakeD1();
  const env = mockEnv(db);
  await handleSubmit(makePostRequest(await withConsent(VALID_PAYLOAD, db, { now: T0 })), env, { now: T0 });
  const secondPayload = { ...VALID_PAYLOAD, fasta: ">second\nACGTACGTACGT\n" };
  await handleSubmit(
    makePostRequest(await withConsent(secondPayload, db, { now: T0 + 60000 })), env, { now: T0 + 60000 }
  );
  assert.equal(state.rows.length, 2);
  const response = await handleHistory(historyRequest(), env, { limit: 1 });
  const body = await response.json();
  assert.equal(body.count, 1);
  assert.equal(body.submissions[0].rid, state.rows.find((row) => row.created_at === new Date(T0 + 60000).toISOString()).rid);
});

test("onRequest enforces the method, preflight and missing binding", async () => {
  const { db } = createFakeD1();
  const env = mockEnv(db);
  const ok = await onRequest({ request: historyRequest(), env });
  assert.equal(ok.status, 200);
  const wrong = await onRequest({ request: makePostRequest({}, "/api/blast/history"), env });
  assert.equal(wrong.status, 405);
  const options = await onRequest({
    request: new Request("https://blast.example.test/api/blast/history", { method: "OPTIONS" }),
    env
  });
  assert.equal(options.status, 204);
  const noDb = await handleHistory(historyRequest(), { MOCK_NCBI: "1" });
  assert.equal(noDb.status, 503);
});