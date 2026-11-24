import test from "node:test";
import assert from "node:assert/strict";
import { handleSubmit } from "../functions/api/blast/submit.js";
import { handleStatus } from "../functions/api/blast/status/[rid].js";
import { handleResults, onRequest } from "../functions/api/blast/results/[rid].js";
import { MOCK_TSV, SQL } from "../functions/api/blast/_lib.js";
import { createFakeD1, makeGetRequest, makePostRequest, mockEnv, VALID_PAYLOAD, withConsent } from "./helpers/fake-d1.mjs";

const T0 = Date.parse("2026-11-24T12:00:00.000Z");

async function completeRid() {
  const { db, state } = createFakeD1();
  const env = mockEnv(db);
  const consented = await withConsent(VALID_PAYLOAD, db, { now: T0 });
  const submit = await handleSubmit(makePostRequest(consented), env, { now: T0 });
  const { rid } = await submit.json();
  await handleStatus(rid, makeGetRequest(`/api/blast/status/${rid}`), env, { now: T0 + 1000 });
  return { rid, db, state, env };
}

function resultsRequest(rid) {
  return makeGetRequest(`/api/blast/results/${rid}`);
}

test("results are unavailable until the job is complete", async () => {
  const { db } = createFakeD1();
  const env = mockEnv(db);
  const consented = await withConsent(VALID_PAYLOAD, db, { now: T0 });
  const submit = await handleSubmit(makePostRequest(consented), env, { now: T0 });
  const { rid } = await submit.json();
  const response = await handleResults(rid, resultsRequest(rid), env);
  assert.equal(response.status, 409);
  assert.match((await response.json()).error, /not ready/);
});

test("completed mock results return labelled TSV as text/plain", async () => {
  const { rid, state, env } = await completeRid();
  const response = await handleResults(rid, resultsRequest(rid), env);
  assert.equal(response.status, 200);
  assert.match(response.headers.get("Content-Type"), /^text\/plain/);
  const tsv = await response.text();
  assert.equal(tsv, MOCK_TSV);
  assert.match(tsv, /blastn_local_v1/);
  assert.match(tsv, /MOCK DATA/);
  assert.equal(tsv.includes("ACGTACGT"), false);
  assert.equal(state.rows[0].result_tsv, tsv);
});

test("raw TSV is cached in D1 and reused on later requests", async () => {
  const { rid, state, env } = await completeRid();
  const first = await handleResults(rid, resultsRequest(rid), env);
  const firstTsv = await first.text();
  state.rows[0].result_tsv = "cached\tsynthetic\trow\n";
  const second = await handleResults(rid, resultsRequest(rid), env);
  assert.equal(second.status, 200);
  assert.equal(await second.text(), "cached\tsynthetic\trow\n");
  const writes = state.calls.filter((call) => call.kind === "run" && call.sql === SQL.cacheResults);
  assert.equal(writes.length, 1);
  assert.equal(firstTsv.length > 0, true);
});

test("unknown and invalid RIDs are rejected", async () => {
  const { db, env } = createFakeD1();
  const missing = await handleResults("MISSING123", resultsRequest("MISSING123"), mockEnv(db));
  assert.equal(missing.status, 404);
  const invalid = await handleResults("<script>", resultsRequest("bad"), env);
  assert.equal(invalid.status, 400);
});

test("onRequest reads params.rid and enforces the method", async () => {
  const { rid, env } = await completeRid();
  const ok = await onRequest({ request: resultsRequest(rid), env, params: { rid } });
  assert.equal(ok.status, 200);
  const wrong = await onRequest({
    request: new Request(`https://blast.example.test/api/blast/results/${rid}`, { method: "POST" }),
    env,
    params: { rid }
  });
  assert.equal(wrong.status, 405);
  const options = await onRequest({
    request: new Request(`https://blast.example.test/api/blast/results/${rid}`, { method: "OPTIONS" }),
    env,
    params: { rid }
  });
  assert.equal(options.status, 204);
});