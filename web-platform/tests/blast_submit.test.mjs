import test from "node:test";
import assert from "node:assert/strict";
import { handleSubmit, onRequest } from "../functions/api/blast/submit.js";
import { createFakeD1, makePostRequest, mockEnv, VALID_PAYLOAD } from "./helpers/fake-d1.mjs";

const SUBMIT_AT = Date.parse("2026-11-24T12:00:00.000Z");

async function submit(payload = VALID_PAYLOAD, env, state) {
  const activeEnv = env ?? mockEnv(createFakeD1().db);
  const response = await handleSubmit(makePostRequest(payload), activeEnv, { now: SUBMIT_AT });
  return { response, env: activeEnv, state };
}

test("valid mock submission returns rid/status and stores only a hash", async () => {
  const { db, state } = createFakeD1();
  const env = mockEnv(db);
  const response = await handleSubmit(makePostRequest(VALID_PAYLOAD), env, { now: SUBMIT_AT });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.deepEqual(Object.keys(body).sort(), ["rid", "status"]);
  assert.equal(body.status, "queued");
  assert.match(body.rid, /^MOCK[0-9A-F]{16}$/);

  assert.equal(state.rows.length, 1);
  const row = state.rows[0];
  assert.equal(row.rid, body.rid);
  assert.equal(row.status, "queued");
  assert.equal(row.created_at, new Date(SUBMIT_AT).toISOString());
  assert.equal(row.last_checked_at, null);
  assert.match(row.input_hash, /^[0-9a-f]{64}$/);
  assert.equal(JSON.stringify(state.rows).includes("ACGTACGT"), false);
  assert.equal(row.result_tsv, null);
});

test("mock rid is deterministic for the same sequence and differs for another", async () => {
  const first = createFakeD1();
  const second = createFakeD1();
  const a = await handleSubmit(makePostRequest(VALID_PAYLOAD), mockEnv(first.db), { now: SUBMIT_AT });
  const b = await handleSubmit(makePostRequest(VALID_PAYLOAD), mockEnv(second.db), { now: SUBMIT_AT });
  const c = await handleSubmit(makePostRequest({ ...VALID_PAYLOAD, fasta: ">other\nACGTACGT\n" }), mockEnv(createFakeD1().db), { now: SUBMIT_AT });
  const ridA = (await a.json()).rid;
  assert.equal(ridA, (await b.json()).rid);
  assert.notEqual(ridA, (await c.json()).rid);
});

test("re-submitting the same FASTA resets the existing RID instead of duplicating it", async () => {
  const { db, state } = createFakeD1();
  const env = mockEnv(db);
  const first = await handleSubmit(makePostRequest(VALID_PAYLOAD), env, { now: SUBMIT_AT });
  const rid = (await first.json()).rid;
  state.rows[0].status = "complete";
  state.rows[0].last_checked_at = new Date(SUBMIT_AT + 1000).toISOString();
  await handleSubmit(makePostRequest(VALID_PAYLOAD), env, { now: SUBMIT_AT + 120000 });
  assert.equal(state.rows.length, 1);
  assert.equal(state.rows[0].rid, rid);
  assert.equal(state.rows[0].status, "queued");
  assert.equal(state.rows[0].last_checked_at, null);
});

test("invalid FASTA, database and program return 400", async () => {
  const { db } = createFakeD1();
  const env = mockEnv(db);
  const badFasta = await handleSubmit(makePostRequest({ ...VALID_PAYLOAD, fasta: ">seq1\nACGX\n" }), env, { now: SUBMIT_AT });
  assert.equal(badFasta.status, 400);
  assert.match((await badFasta.json()).error, /Invalid nucleotide character/);

  const badDatabase = await handleSubmit(makePostRequest({ ...VALID_PAYLOAD, database: "nt" }), env, { now: SUBMIT_AT });
  assert.equal(badDatabase.status, 400);
  assert.match((await badDatabase.json()).error, /16S_ribosomal_RNA/);

  const badProgram = await handleSubmit(makePostRequest({ ...VALID_PAYLOAD, program: "blastp" }), env, { now: SUBMIT_AT });
  assert.equal(badProgram.status, 400);
  assert.match((await badProgram.json()).error, /blastn/);

  const oversized = await handleSubmit(makePostRequest({ ...VALID_PAYLOAD, fasta: ">s\n" + "A".repeat(10001) }), env, { now: SUBMIT_AT });
  assert.equal(oversized.status, 400);
});

test("malformed JSON and missing binding are rejected", async () => {
  const { db } = createFakeD1();
  const env = mockEnv(db);
  const badJson = new Request("https://blast.example.test/api/blast/submit", {
    method: "POST",
    body: "{not json"
  });
  const badResponse = await handleSubmit(badJson, env);
  assert.equal(badResponse.status, 400);
  assert.match((await badResponse.json()).error, /valid JSON/);

  const noDb = await handleSubmit(makePostRequest(VALID_PAYLOAD), { MOCK_NCBI: "1" });
  assert.equal(noDb.status, 503);
});

test("onRequest enforces the method and supports preflight", async () => {
  const { db } = createFakeD1();
  const env = mockEnv(db);
  const wrong = await onRequest({ request: makePostRequest(VALID_PAYLOAD, "/x", {}), env });
  // POST still works through onRequest
  assert.equal(wrong.status, 200);
  const get = await onRequest({ request: new Request("https://blast.example.test/api/blast/submit"), env });
  assert.equal(get.status, 405);
  const options = await onRequest({ request: new Request("https://blast.example.test/api/blast/submit", { method: "OPTIONS" }), env });
  assert.equal(options.status, 204);
});

test("mock mode never contacts NCBI", async () => {
  const { db } = createFakeD1();
  const env = mockEnv(db);
  const originalFetch = globalThis.fetch;
  globalThis.fetch = () => {
    throw new Error("network must not be used in MOCK_NCBI=1 mode");
  };
  try {
    const response = await handleSubmit(makePostRequest(VALID_PAYLOAD), env, { now: SUBMIT_AT });
    assert.equal(response.status, 200);
  } finally {
    globalThis.fetch = originalFetch;
  }
});