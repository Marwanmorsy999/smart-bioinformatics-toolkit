import test from "node:test";
import assert from "node:assert/strict";
import {
  BLAST_API_URL,
  ALLOWED_DATABASE,
  ALLOWED_PROGRAM,
  BLAST_CONSENT_ERRORS,
  BlastCryptoUnavailableError,
  buildPutParams,
  buildResultsParams,
  buildStatusParams,
  consumeBlastConsent,
  consentErrorResponse,
  cryptoUnavailableResponse,
  DEFAULT_CONSENT_TTL_SECONDS,
  extractTabular,
  hashInput,
  htmlEscape,
  isMock,
  issueBlastConsent,
  makeConsentToken,
  resolveBlastConsent,
  SQL,
  jsonResponse,
  MOCK_TSV,
  mockRid,
  ncbiFetchText,
  parsePutResponse,
  parseStatusResponse,
  textResponse,
  validateDatabase,
  validateFasta,
  validateProgram
} from "../functions/api/blast/_lib.js";
import { createFakeD1, makeGetRequest, mockEnv, VALID_PAYLOAD } from "./helpers/fake-d1.mjs";

test("validateFasta accepts multiple records and IUPAC codes", () => {
  const result = validateFasta(VALID_PAYLOAD.fasta);
  assert.equal(result.valid, true);
  assert.equal(result.records, 2);
  assert.ok(result.sequence_characters > 0);
});

test("validateFasta rejects unsafe or empty FASTA inputs", () => {
  assert.equal(validateFasta("").valid, false);
  assert.equal(validateFasta(null).valid, false);
  assert.equal(validateFasta("ACGT").valid, false);
  assert.equal(validateFasta(">seq1\n" + "A".repeat(10001)).valid, false);
  assert.equal(validateFasta(">seq1\nACGTX\n").valid, false);
  assert.equal(validateFasta(">seq1\n>seq2\nACGT\n").valid, false);
  assert.equal(validateFasta(">\nACGT\n").valid, false);
  assert.equal(validateFasta(">seq1\n\n").valid, false);
});

test("ALLOWED_DATABASE is the canonical NCBI 16S rRNA identifier", () => {
  assert.equal(ALLOWED_DATABASE, "rRNA_typestrains/16S_ribosomal_RNA");
});

test("database and program must match exactly", () => {
  assert.equal(validateDatabase("rRNA_typestrains/16S_ribosomal_RNA").valid, true);
  assert.equal(validateDatabase("nt").valid, false);
  assert.equal(validateDatabase("16S_ribosomal_rna").valid, false);
  assert.equal(validateProgram("blastn").valid, true);
  assert.equal(validateProgram("blastp").valid, false);
});

test("hashInput is deterministic SHA-256 hex", async () => {
  const a = await hashInput(VALID_PAYLOAD.fasta);
  const b = await hashInput(VALID_PAYLOAD.fasta);
  const c = await hashInput(">x\nACGT\n");
  assert.equal(a, b);
  assert.notEqual(a, c);
  assert.match(a, /^[0-9a-f]{64}$/);
});

test("mockRid is deterministic and prefixed", async () => {
  const hash = await hashInput(VALID_PAYLOAD.fasta);
  assert.equal(mockRid(hash), mockRid(hash));
  assert.match(mockRid(hash), /^MOCK[0-9A-F]{16}$/);
});

test("CMD=Put params include every verified NCBI parameter", () => {
  const params = buildPutParams(VALID_PAYLOAD.fasta, mockEnv(null));
  assert.equal(params.get("CMD"), "Put");
  assert.equal(params.get("QUERY"), VALID_PAYLOAD.fasta);
  assert.equal(params.get("DATABASE"), ALLOWED_DATABASE);
  assert.equal(params.get("PROGRAM"), "blastn");
  assert.equal(params.get("MEGABLAST"), "on");
  assert.ok(params.get("EXPECT"));
  assert.ok(params.get("HITLIST_SIZE"));
  assert.ok(params.get("FILTER"));
  assert.equal(params.get("FORMAT_TYPE"), "Text");
  assert.equal(params.get("tool"), "smart-bioinformatics-toolkit-tests");
  assert.ok(BLAST_API_URL.startsWith("https://blast.ncbi.nlm.nih.gov/"));
});

test("CMD=Get status and tabular results params", () => {
  const env = mockEnv(null);
  const status = buildStatusParams("ABC123", env);
  assert.equal(status.get("CMD"), "Get");
  assert.equal(status.get("RID"), "ABC123");
  const results = buildResultsParams("ABC123", env);
  assert.equal(results.get("CMD"), "Get");
  assert.equal(results.get("RID"), "ABC123");
  assert.equal(results.get("FORMAT_TYPE"), "Text");
  assert.equal(results.get("ALIGNMENT_VIEW"), "Tabular");
});

test("htmlEscape escapes all HTML-sensitive characters", () => {
  assert.equal(htmlEscape(`<a href="x">&'</a>`), "&lt;a href=&quot;x&quot;&gt;&amp;&#39;&lt;/a&gt;");
});

test("responses carry restrictive CSP and nosniff headers", async () => {
  const json = jsonResponse({ ok: true }, 200, makeGetRequest("/api/blast/history"));
  assert.match(json.headers.get("Content-Type"), /^application\/json/);
  assert.match(json.headers.get("Content-Security-Policy"), /default-src 'none'/);
  assert.equal(json.headers.get("X-Content-Type-Options"), "nosniff");
  assert.equal(json.headers.get("Cache-Control"), "no-store");

  const text = textResponse("q\th\n", 200, makeGetRequest("/api/blast/results/ABC123"));
  assert.match(text.headers.get("Content-Type"), /^text\/plain/);
  assert.match(text.headers.get("Content-Security-Policy"), /frame-ancestors 'none'/);
});

test("CORS headers echo only a same-origin request", () => {
  const same = jsonResponse({}, 200, makeGetRequest("/api/blast/history", { Origin: "https://blast.example.test" }));
  assert.equal(same.headers.get("Access-Control-Allow-Origin"), "https://blast.example.test");
  const cross = jsonResponse({}, 200, makeGetRequest("/api/blast/history", { Origin: "https://evil.example" }));
  assert.equal(cross.headers.get("Access-Control-Allow-Origin"), null);
});

test("isMock reads the environment flag", () => {
  assert.equal(isMock(mockEnv(null)), true);
  assert.equal(isMock({ MOCK_NCBI: "0" }), false);
  assert.equal(isMock({}), false);
});

test("NCBI response parsing helpers", () => {
  assert.equal(parsePutResponse('<input type="hidden" name="RID" value="ABC123XYZ">'), "ABC123XYZ");
  assert.equal(parsePutResponse("RID = ABC999ZZ"), "ABC999ZZ");
  assert.equal(parsePutResponse("nothing here"), null);
  assert.equal(parseStatusResponse("<p>Status=Ready</p>"), "complete");
  assert.equal(parseStatusResponse("Status=Running"), "queued");
  assert.equal(parseStatusResponse("Status=Failed"), "error");
  assert.equal(parseStatusResponse("Status=Unknown"), "error");
  assert.equal(extractTabular("<html>\nq1\thitA\t99\n</html>"), "q1\thitA\t99\n");
});

test("ncbiFetchText retries retryable statuses and stops on client errors", async () => {
  let calls = 0;
  const retryingFetch = async () => {
    calls += 1;
    return calls < 3 ? new Response("busy", { status: 503 }) : new Response("ok");
  };
  assert.equal(await ncbiFetchText("https://example.test/x", { fetchImpl: retryingFetch, delays: [0, 0, 0] }), "ok");
  assert.equal(calls, 3);

  let badCalls = 0;
  const badFetch = async () => {
    badCalls += 1;
    return new Response("bad", { status: 400 });
  };
  await assert.rejects(() => ncbiFetchText("https://example.test/x", { fetchImpl: badFetch, delays: [0, 0, 0] }), /HTTP 400/);
  assert.equal(badCalls, 1);
});

test("mock TSV is labelled blastn_local_v1 with the 12-column schema", () => {
  assert.match(MOCK_TSV, /blastn_local_v1/);
  assert.match(MOCK_TSV, /MOCK DATA/i);
  const [comment, header, row] = MOCK_TSV.trim().split("\n");
  assert.ok(comment.startsWith("#"));
  assert.equal(header.split("\t").length, 12);
  assert.equal(row.split("\t").length, 12);
});

const CONSENT_AT = Date.parse("2026-11-24T12:00:00.000Z");

test("issueBlastConsent writes a bounded, hash-bound, single-use token", async () => {
  const { db, state } = createFakeD1();
  const inputHash = await hashInput(VALID_PAYLOAD.fasta);
  const token = await issueBlastConsent(db, {
    inputHash,
    database: ALLOWED_DATABASE,
    program: ALLOWED_PROGRAM,
    now: CONSENT_AT
  });
  assert.match(token, /^consent_[0-9a-f]{32}$/);
  assert.equal(state.consents.length, 1);
  const row = state.consents[0];
  assert.equal(row.token, token);
  assert.equal(row.input_hash, inputHash);
  assert.equal(row.database, ALLOWED_DATABASE);
  assert.equal(row.program, ALLOWED_PROGRAM);
  assert.equal(row.granted, 1);
  assert.equal(row.used_at, null);
  assert.equal(row.created_at, new Date(CONSENT_AT).toISOString());
  assert.equal(Date.parse(row.expires_at) - CONSENT_AT, DEFAULT_CONSENT_TTL_SECONDS * 1000);

  const resolved = await resolveBlastConsent(db, token, {
    inputHash,
    database: ALLOWED_DATABASE,
    program: ALLOWED_PROGRAM,
    now: CONSENT_AT
  });
  assert.equal(resolved.valid, true);
  const claim = { token, inputHash, database: ALLOWED_DATABASE, program: ALLOWED_PROGRAM, now: CONSENT_AT };
  assert.equal(await consumeBlastConsent(db, claim), true);
  assert.equal(await consumeBlastConsent(db, { ...claim, now: CONSENT_AT + 1 }), false, "a token can only be claimed once");
});

test("resolveBlastConsent classifies every rejection with a typed code", async () => {
  const { db } = createFakeD1();
  const inputHash = await hashInput(VALID_PAYLOAD.fasta);
  const base = {
    inputHash,
    database: ALLOWED_DATABASE,
    program: ALLOWED_PROGRAM,
    now: CONSENT_AT
  };
  assert.equal((await resolveBlastConsent(db, undefined, base)).code, "consent_missing");
  assert.equal((await resolveBlastConsent(null, "x", base)).code, "consent_unavailable");
  assert.equal((await resolveBlastConsent(db, "consent_nope", base)).code, "consent_invalid");

  const denied = await issueBlastConsent(db, { ...base, granted: false, now: CONSENT_AT });
  assert.equal((await resolveBlastConsent(db, denied, base)).code, "consent_not_granted");

  const expired = await issueBlastConsent(db, { ...base, ttlSeconds: 1, now: CONSENT_AT - 2000 });
  assert.equal((await resolveBlastConsent(db, expired, base)).code, "consent_expired");

  const used = await issueBlastConsent(db, { ...base, now: CONSENT_AT });
  await consumeBlastConsent(db, { ...base, token: used });
  assert.equal((await resolveBlastConsent(db, used, base)).code, "consent_used");

  const valid = await issueBlastConsent(db, { ...base, now: CONSENT_AT });
  assert.equal((await resolveBlastConsent(db, valid, { ...base, inputHash: "0".repeat(64) })).code, "consent_mismatch");
  assert.equal((await resolveBlastConsent(db, valid, { ...base, database: "nt" })).code, "consent_mismatch");
  assert.equal((await resolveBlastConsent(db, valid, { ...base, program: "blastp" })).code, "consent_mismatch");

  for (const code of Object.keys(BLAST_CONSENT_ERRORS)) {
    const response = consentErrorResponse(code, makeGetRequest("/api/blast/submit"));
    assert.equal(response.status, 403);
    assert.equal((await response.json()).code, code);
    assert.match(response.headers.get("Cache-Control"), /no-store/);
  }
});

test("status and results URLs carry the RID only, never the user sequence", () => {
  const env = mockEnv(null);
  for (const params of [buildStatusParams("RID123", env), buildResultsParams("RID123", env)]) {
    const query = params.toString();
    assert.match(query, /CMD=Get/);
    assert.match(query, /RID=RID123/);
    assert.equal(query.includes("QUERY"), false);
    assert.equal(query.includes(VALID_PAYLOAD.fasta), false);
  }
  assert.match(SQL.selectByRid, /WHERE rid = \?/);
  assert.match(SQL.insertConsent, /blast_consents/);
});

test("consumeBlastConsent claims atomically and failed claims do not burn the token", async () => {
  const { db, state } = createFakeD1();
  const inputHash = await hashInput(VALID_PAYLOAD.fasta);
  const base = { inputHash, database: ALLOWED_DATABASE, program: ALLOWED_PROGRAM, now: CONSENT_AT };
  const token = await issueBlastConsent(db, { ...base, ttlSeconds: 60 });

  assert.equal(await consumeBlastConsent(db, { ...base, token, inputHash: "0".repeat(64) }), false);
  assert.equal(await consumeBlastConsent(db, { ...base, token, database: "nt" }), false);
  assert.equal(await consumeBlastConsent(db, { ...base, token, program: "blastp" }), false);
  assert.equal(await consumeBlastConsent(db, { ...base, token, now: CONSENT_AT + 61000 }), false);
  assert.equal(state.consents[0].used_at, null, "a rejected claim does not consume the token");

  assert.equal(await consumeBlastConsent(db, { ...base, token }), true);
  assert.equal(state.consents[0].used_at, new Date(CONSENT_AT).toISOString());
  assert.equal(await consumeBlastConsent(db, { ...base, token }), false);
  assert.match(SQL.claimConsent, /used_at IS NULL AND granted = 1/);
  assert.match(SQL.claimConsent, /expires_at > \?/);
});

test("token generation fails closed when Web Crypto is unavailable", async () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "crypto");
  const { db } = createFakeD1();
  const inputHash = await hashInput(VALID_PAYLOAD.fasta); // compute while crypto exists
  try {
    Object.defineProperty(globalThis, "crypto", { value: undefined, configurable: true, writable: true });
    assert.throws(
      () => makeConsentToken(),
      (error) => error instanceof BlastCryptoUnavailableError
    );
    await assert.rejects(
      () => issueBlastConsent(db, { inputHash, database: ALLOWED_DATABASE, program: ALLOWED_PROGRAM }),
      (error) => error instanceof BlastCryptoUnavailableError
    );
    const response = cryptoUnavailableResponse(makeGetRequest("/api/blast/submit"));
    assert.equal(response.status, 503);
    assert.equal((await response.json()).code, "crypto_unavailable");
  } finally {
    if (descriptor) Object.defineProperty(globalThis, "crypto", descriptor);
    else delete globalThis.crypto;
  }
});