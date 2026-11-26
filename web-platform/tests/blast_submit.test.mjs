import test from "node:test";
import assert from "node:assert/strict";
import { handleSubmit, onRequest } from "../functions/api/blast/submit.js";
import { hashInput } from "../functions/api/blast/_lib.js";
import { createFakeD1, makePostRequest, mockEnv, VALID_PAYLOAD, withConsent } from "./helpers/fake-d1.mjs";

const SUBMIT_AT = Date.parse("2026-11-24T12:00:00.000Z");

// Every submit gets a fresh single-use consent token unless a test opts out.
async function submit(payload = VALID_PAYLOAD, env, options = {}) {
  const activeEnv = env ?? mockEnv(createFakeD1().db);
  const body = await withConsent(payload, activeEnv.BLAST_DB, { now: SUBMIT_AT, ...options });
  const response = await handleSubmit(makePostRequest(body), activeEnv, { now: SUBMIT_AT });
  return { response, env: activeEnv, body };
}

test("valid mock submission returns rid/status and stores only a hash", async () => {
  const { db, state } = createFakeD1();
  const env = mockEnv(db);
  const { response } = await submit(VALID_PAYLOAD, env);
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

  assert.equal(state.consents.length, 1);
  assert.match(state.consents[0].token, /^consent_[0-9a-f]{32}$/);
  assert.equal(JSON.stringify(state.consents).includes("ACGTACGT"), false);
  assert.equal(state.consents[0].used_at, new Date(SUBMIT_AT).toISOString());

  assert.equal(state.auditEvents.length, 1, "the mock submit path is audited too");
  const auditRow = state.auditEvents[0];
  assert.match(auditRow.public_id, /^aud_[0-9a-f]{16}$/);
  assert.equal(auditRow.actor, "browser");
  assert.equal(auditRow.action, "blast_egress");
  assert.equal(auditRow.target, "https://blast.ncbi.nlm.nih.gov/Blast.cgi");
  assert.equal(auditRow.timestamp, new Date(SUBMIT_AT).toISOString());
  const detail = JSON.parse(auditRow.detail_json);
  assert.equal(detail.input_hash, row.input_hash);
  assert.equal(detail.database, "rRNA_typestrains/16S_ribosomal_RNA");
  assert.equal(detail.program, "blastn");
  assert.equal(detail.payload_bytes, new TextEncoder().encode(VALID_PAYLOAD.fasta).length);
  assert.equal(detail.hash_bytes, 32);
  assert.equal(detail.mock, true);
  assert.equal(detail.transmitted, false);
  assert.equal(detail.status, "succeeded");
  assert.equal(detail.success, true);
  assert.equal(JSON.stringify(state.auditEvents).includes("ACGTACGT"), false, "no sequence value in audit");
});

test("mock rid is deterministic for the same sequence and differs for another", async () => {
  const first = createFakeD1();
  const second = createFakeD1();
  const third = createFakeD1();
  const a = await submit(VALID_PAYLOAD, mockEnv(first.db));
  const b = await submit(VALID_PAYLOAD, mockEnv(second.db));
  const c = await submit({ ...VALID_PAYLOAD, fasta: ">other\nACGTACGT\n" }, mockEnv(third.db));
  const ridA = (await a.response.json()).rid;
  assert.equal(ridA, (await b.response.json()).rid);
  assert.notEqual(ridA, (await c.response.json()).rid);
});

test("re-submitting the same FASTA resets the existing RID instead of duplicating it", async () => {
  const { db, state } = createFakeD1();
  const env = mockEnv(db);
  const first = await submit(VALID_PAYLOAD, env);
  const rid = (await first.response.json()).rid;
  state.rows[0].status = "complete";
  state.rows[0].last_checked_at = new Date(SUBMIT_AT + 1000).toISOString();
  await submit(VALID_PAYLOAD, env);
  assert.equal(state.rows.length, 1);
  assert.equal(state.rows[0].rid, rid);
  assert.equal(state.rows[0].status, "queued");
  assert.equal(state.rows[0].last_checked_at, null);
  assert.equal(state.consents.length, 2, "each submit consumes its own token");
});

test("invalid FASTA, database and program return 400", async () => {
  const { db } = createFakeD1();
  const env = mockEnv(db);
  const badFasta = await submit({ ...VALID_PAYLOAD, fasta: ">seq1\nACGX\n" }, env);
  assert.equal(badFasta.response.status, 400);
  assert.match((await badFasta.response.json()).error, /Invalid nucleotide character/);

  const badDatabase = await submit({ ...VALID_PAYLOAD, database: "nt" }, env);
  assert.equal(badDatabase.response.status, 400);
  assert.match((await badDatabase.response.json()).error, /16S_ribosomal_RNA/); // label mentions the legacy name

  const badProgram = await submit({ ...VALID_PAYLOAD, program: "blastp" }, env);
  assert.equal(badProgram.response.status, 400);
  assert.match((await badProgram.response.json()).error, /blastn/);

  const oversized = await submit({ ...VALID_PAYLOAD, fasta: ">s\n" + "A".repeat(10001) }, env);
  assert.equal(oversized.response.status, 400);
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
  // onRequest uses real time; issue a token that is valid at wall-clock time.
  const body = await withConsent(VALID_PAYLOAD, db, { now: Date.now(), ttlSeconds: 3600 });
  const wrong = await onRequest({ request: makePostRequest(body, "/x", {}), env });
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
    const { response } = await submit(VALID_PAYLOAD, env);
    assert.equal(response.status, 200);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("submit without consent is rejected with a typed 403 and stores nothing", async () => {
  const { db, state } = createFakeD1();
  const env = mockEnv(db);
  const originalFetch = globalThis.fetch;
  globalThis.fetch = () => {
    throw new Error("network must not be used without consent");
  };
  try {
    const response = await handleSubmit(makePostRequest(VALID_PAYLOAD), env, { now: SUBMIT_AT });
    assert.equal(response.status, 403);
    assert.deepEqual(await response.json(), {
      error: "A consent token is required for remote BLAST submission.",
      code: "consent_missing"
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
  assert.equal(state.rows.length, 0);
  assert.equal(state.consents.length, 0);
  assert.equal(state.auditEvents.length, 0, "no consent means no audited egress attempt");
});

test("a token bound to different FASTA, database or program is rejected", async () => {
  const { db, state } = createFakeD1();
  const env = mockEnv(db);

  const wrongHash = await withConsent({ ...VALID_PAYLOAD, fasta: ">other\nACGTACGT\n" }, db, { now: SUBMIT_AT });
  const hashResponse = await handleSubmit(
    makePostRequest({ ...VALID_PAYLOAD, consent_token: wrongHash.consent_token }), env, { now: SUBMIT_AT }
  );
  assert.equal(hashResponse.status, 403);
  assert.equal((await hashResponse.json()).code, "consent_mismatch");

  const wrongDb = await withConsent({ ...VALID_PAYLOAD, database: "nt" }, db, { now: SUBMIT_AT });
  const dbResponse = await handleSubmit(
    makePostRequest({ ...VALID_PAYLOAD, consent_token: wrongDb.consent_token }), env, { now: SUBMIT_AT }
  );
  assert.equal(dbResponse.status, 403);
  assert.equal((await dbResponse.json()).code, "consent_mismatch");

  const wrongProgram = await withConsent({ ...VALID_PAYLOAD, program: "blastp" }, db, { now: SUBMIT_AT });
  const programResponse = await handleSubmit(
    makePostRequest({ ...VALID_PAYLOAD, consent_token: wrongProgram.consent_token }), env, { now: SUBMIT_AT }
  );
  assert.equal(programResponse.status, 403);
  assert.equal((await programResponse.json()).code, "consent_mismatch");

  assert.equal(state.rows.length, 0, "no mismatched request was stored");
});

test("expired, denied, unknown and used tokens are rejected", async () => {
  const { db, state } = createFakeD1();
  const env = mockEnv(db);

  const expired = await withConsent(VALID_PAYLOAD, db, { now: SUBMIT_AT - 2000, ttlSeconds: 1 });
  const expiredResponse = await handleSubmit(
    makePostRequest({ ...VALID_PAYLOAD, consent_token: expired.consent_token }), env, { now: SUBMIT_AT }
  );
  assert.equal(expiredResponse.status, 403);
  assert.equal((await expiredResponse.json()).code, "consent_expired");

  const denied = await withConsent(VALID_PAYLOAD, db, { now: SUBMIT_AT, granted: false });
  const deniedResponse = await handleSubmit(
    makePostRequest({ ...VALID_PAYLOAD, consent_token: denied.consent_token }), env, { now: SUBMIT_AT }
  );
  assert.equal(deniedResponse.status, 403);
  assert.equal((await deniedResponse.json()).code, "consent_not_granted");

  const unknown = await handleSubmit(
    makePostRequest({ ...VALID_PAYLOAD, consent_token: "consent_" + "0".repeat(32) }), env, { now: SUBMIT_AT }
  );
  assert.equal(unknown.status, 403);
  assert.equal((await unknown.json()).code, "consent_invalid");

  const granted = await withConsent(VALID_PAYLOAD, db, { now: SUBMIT_AT });
  const first = await handleSubmit(makePostRequest(granted), env, { now: SUBMIT_AT });
  assert.equal(first.status, 200);
  const second = await handleSubmit(makePostRequest(granted), env, { now: SUBMIT_AT + 1000 });
  assert.equal(second.status, 403);
  assert.equal((await second.json()).code, "consent_used");

  assert.equal(state.rows.length, 1, "only the first use stored a request");
  const row = state.consents.find((consent) => consent.token === granted.consent_token);
  assert.equal(row.used_at, new Date(SUBMIT_AT).toISOString());
});

test("a consented submit binds the exact SHA-256 of the transmitted FASTA", async () => {
  const { db, state } = createFakeD1();
  const env = mockEnv(db);
  const { response } = await submit(VALID_PAYLOAD, env);
  assert.equal(response.status, 200);
  const expectedHash = await hashInput(VALID_PAYLOAD.fasta);
  assert.equal(state.rows[0].input_hash, expectedHash);
  assert.equal(state.consents[0].input_hash, expectedHash);
  assert.equal(state.consents[0].database, "rRNA_typestrains/16S_ribosomal_RNA");
  assert.equal(state.consents[0].program, "blastn");
  assert.equal(state.consents[0].granted, 1);
});

test("two simultaneous submissions with one token: only one is authorized", async () => {
  const { db, state } = createFakeD1();
  const env = mockEnv(db);
  const granted = await withConsent(VALID_PAYLOAD, db, { now: SUBMIT_AT });
  const results = await Promise.all([
    handleSubmit(makePostRequest(granted), env, { now: SUBMIT_AT }),
    handleSubmit(makePostRequest(granted), env, { now: SUBMIT_AT })
  ]);
  assert.deepEqual(results.map((response) => response.status).sort(), [200, 403]);
  const rejected = results.find((response) => response.status === 403);
  assert.equal((await rejected.json()).code, "consent_used");
  assert.equal(state.rows.length, 1, "one consent authorizes exactly one submit");
  assert.equal(state.consents[0].used_at, new Date(SUBMIT_AT).toISOString());
  assert.equal(state.auditEvents.length, 1, "only one egress was audited");
});

test("a failed NCBI submission still burns the token", async () => {
  const { db, state } = createFakeD1();
  // No MOCK_NCBI: this takes the real CMD=Put branch.
  const env = { BLAST_DB: db, NCBI_TOOL: "tests", NCBI_EMAIL: "tests@example.invalid" };
  const granted = await withConsent(VALID_PAYLOAD, db, { now: SUBMIT_AT });
  const originalFetch = globalThis.fetch;
  let fetchCalls = 0;
  globalThis.fetch = async () => {
    fetchCalls += 1;
    return new Response("bad request", { status: 400 });
  };
  let failed;
  try {
    failed = await handleSubmit(makePostRequest(granted), env, { now: SUBMIT_AT });
  } finally {
    globalThis.fetch = originalFetch;
  }
  assert.equal(failed.status, 502);
  assert.equal(fetchCalls, 1);
  assert.equal(state.rows.length, 0);
  assert.equal(state.consents[0].used_at, new Date(SUBMIT_AT).toISOString(), "a burned token is never restored");
  assert.equal(state.auditEvents.length, 1, "the failed egress is still audited");
  const failedDetail = JSON.parse(state.auditEvents[0].detail_json);
  assert.equal(failedDetail.status, "failed");
  assert.equal(failedDetail.success, false);
  assert.equal(failedDetail.error, "ncbi_error");
  assert.equal(failedDetail.transmitted, true);
  assert.equal(JSON.stringify(state.auditEvents).includes("ACGTACGT"), false, "no sequence value in audit");

  const retry = await handleSubmit(makePostRequest(granted), mockEnv(db), { now: SUBMIT_AT + 1 });
  assert.equal(retry.status, 403);
  assert.equal((await retry.json()).code, "consent_used");
  assert.equal(state.rows.length, 0, "no second egress or stored request is allowed");
  assert.equal(state.auditEvents.length, 1, "no second egress was audited");
});
