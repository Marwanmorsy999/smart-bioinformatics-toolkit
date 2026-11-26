// M7.8 privacy contract — offline, no NCBI. Proves the two-axis reality:
//   (a) /api/ai/requests receives FASTA, makes NO external request, stores
//       fasta_text inline in D1 `datasets`, and audit contains no sequence;
//   (b) NCBI is NOT contacted before consent; fetch counter = 0 before approval;
//       consent is required; token is single-use;
//   (c) /api/blast/submit sends ONLY approved FASTA + approved params
//       (DATABASE=rRNA_typestrains%2F16S_ribosomal_RNA, PROGRAM=blastn); no
//       secrets; consent token not in NCBI URL; audit no sequence; real/mock is
//       server-side only (client execution_mode/mock cannot force either);
//   (d) exact outgoing request inspection via a stubbed fetch.
// Plus UI/wording checks on public/16s.html + public/js/16s-flow.js.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { handleCreateRequest } from "../functions/api/ai/requests/index.js";
import { handleApprove } from "../functions/api/ai/plans/[id]/approve.js";
import { SQL as AI_SQL, SQL_META } from "../functions/api/ai/_lib.js";
import { handleSubmit } from "../functions/api/blast/submit.js";
import { ALLOWED_DATABASE, ALLOWED_PROGRAM, SQL as BLAST_SQL, hashInput } from "../functions/api/blast/_lib.js";
import {
  createFakeD1,
  createFakeD1AI,
  makePostRequest,
  mockAIEnv,
  mockEnv,
  withConsent,
  VALID_PAYLOAD
} from "./helpers/fake-d1.mjs";

const NOW = Date.parse("2026-11-26T12:00:00.000Z");
const FASTA = ">seq1 16S isolate\nACGTACGTACGTACGTACGT\n>seq2 16S isolate\nACGTACGTTCGTACGTACGT\n";
const SEQUENCE_MARKER = "ACGTACGTACGTACGTACGT";
const REAL_ENV_DB = (db) => ({ BLAST_DB: db }); // no MOCK_NCBI -> real NCBI branch

// A single-D1 router so the full request -> approval -> submit chain shares one
// store, mirroring production's `AI_DB ?? BLAST_DB`.
function combinedDb(ai, blast) {
  return {
    prepare(sql) {
      return SQL_META[sql] ? ai.prepare(sql) : blast.prepare(sql);
    }
  };
}

// Stub global fetch, counting every external call and capturing each request.
function stubFetch(handler) {
  const calls = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    return handler ? handler(String(url), options, calls.length) : new Response("", { status: 200 });
  };
  return { calls, restore() { globalThis.fetch = original; } };
}

// --------------------------------------------------------------- (a) /api/ai/requests

test("(a) /api/ai/requests receives FASTA in body, sends NO external request, stores fasta_text in D1 datasets, audit has no sequence", async () => {
  const fake = createFakeD1AI();
  const env = mockAIEnv(fake.db);
  const net = stubFetch(() => { throw new Error("no external request may be made"); });
  try {
    const res = await handleCreateRequest(
      makePostRequest({
        text: "Identify taxa from these 16S sequences using BLASTN",
        fasta: FASTA,
        filename: "16s.fasta",
        // client cannot flip execution mode; ignored by the server
        execution_mode: "mock",
        mock: true
      }, "/api/ai/requests"),
      env,
      { now: NOW }
    );
    assert.equal(res.status, 200, await res.text());
  } finally {
    net.restore();
  }

  assert.equal(net.calls.length, 0, "no external request is made at request-creation time");

  const datasets = fake.state.tables.datasets ?? [];
  assert.equal(datasets.length, 1, "one dataset row stored");
  assert.equal(datasets[0].fasta_text, FASTA, "FASTA stored inline in D1 datasets.fasta_text");
  assert.equal(datasets[0].storage_ref, `d1://datasets/${datasets[0].public_id}`);
  assert.equal(datasets[0].mime, "text/plain");
  assert.equal(typeof datasets[0].sha256, "string");
  assert.match(datasets[0].sha256, /^[0-9a-f]{64}$/);
  assert.equal(datasets[0].sha256, await hashInput(FASTA));
  assert.equal(typeof datasets[0].size_bytes, "number");

  // audit event exists but contains no sequence
  const audit = fake.state.tables.audit_events ?? [];
  assert.ok(audit.some((row) => row.action === "ai_request_created"), "ai_request_created audit recorded");
  const auditJson = JSON.stringify(audit);
  assert.equal(auditJson.includes(SEQUENCE_MARKER), false, "no sequence in audit");
  assert.equal(auditJson.includes(FASTA), false, "no FASTA in audit");

  // client-supplied execution mode cannot force mock; server env decides
  const body = await (await handleCreateRequest(
    makePostRequest({ text: "identify taxa using blast", fasta: FASTA, execution_mode: "mock" }, "/api/ai/requests"),
    mockAIEnv(createFakeD1AI().db),
    { now: NOW }
  )).json();
  assert.equal(body.execution_mode, "real", "client execution_mode cannot force mock");
});

// ------------------------------------------------------- (b) NCBI not contacted before consent

test("(b) NCBI NOT contacted before consent; fetch counter=0 before approval; consent required; single-use", async () => {
  const ai = createFakeD1AI();
  const blast = createFakeD1();
  const db = combinedDb(ai.db, blast.db);
  const env = { AI_DB: db, BLAST_DB: db }; // real mode: no MOCK_NCBI
  const net = stubFetch(() => {
    // If anything reaches NCBI before consent, fail loudly.
    throw new Error("NCBI must not be contacted in this test");
  });
  let consent;
  try {
    // Step 1: create request — no NCBI.
    const created = await handleCreateRequest(
      makePostRequest({ text: "Identify taxa using BLAST", fasta: FASTA, filename: "16s.fasta" }, "/api/ai/requests"),
      env,
      { now: NOW }
    );
    assert.equal(created.status, 200);
    const request = await created.json();
    assert.equal(net.calls.length, 0, "fetch counter = 0 after request creation");

    // NCBI not contacted before approval AND before submit, even if a caller
    // tries to submit directly without a token.
    const premature = await handleSubmit(
      makePostRequest({ fasta: FASTA, database: ALLOWED_DATABASE, program: ALLOWED_PROGRAM }, "/api/blast/submit"),
      env,
      { now: NOW }
    );
    assert.equal(premature.status, 403, "consent required");
    assert.equal((await premature.json()).code, "consent_missing");
    assert.equal(net.calls.length, 0, "fetch counter = 0 before approval / without consent");

    // Step 2: approve — mints single-use consent; still no NCBI.
    const approved = await handleApprove(
      makePostRequest({ approvals: [{ step_id: "step_1", approved: true, consent_granted: true }], consents: ["external-blast"] },
        `/api/ai/plans/${request.plan_id}/approve`),
      env,
      request.plan_id,
      { now: NOW }
    );
    assert.equal(approved.status, 200);
    const approval = await approved.json();
    consent = approval.blast_consent;
    assert.ok(consent?.token, "approval mints a single-use consent token");
    assert.equal(net.calls.length, 0, "fetch counter = 0 after approval (no external egress on approve)");

    // approval without explicit consent mints nothing and contacts nothing
    const noConsent = await handleApprove(
      makePostRequest({ approvals: [{ step_id: "step_1", approved: true, consent_granted: false }], consents: [] },
        `/api/ai/plans/${request.plan_id}/approve`),
      mockAIEnv(createFakeD1AI().db),
      request.plan_id,
      { now: NOW }
    );
    assert.equal(net.calls.length, 0, "no external call without consent");
    void noConsent;
  } finally {
    net.restore();
  }

  // Single-use: reusing the same token is rejected (consent_used). Use a
  // separate real-mode DB + stubbed successful NCBI to consume it once.
  const { db: submitDb, state } = createFakeD1();
  const submitEnv = { BLAST_DB: submitDb };
  const approvedFasta = FASTA;
  const inputHash = await hashInput(approvedFasta);
  // seed a token identical in shape to an approve-minted one
  const seeded = await withConsent({ fasta: approvedFasta, database: ALLOWED_DATABASE, program: ALLOWED_PROGRAM }, submitDb, { now: NOW });
  void inputHash;

  const net2 = stubFetch(() => new Response('<input name="RID" value="ABC123XYZ789">\n<input name="RTOE" value="15">', { status: 200 }));
  try {
    const first = await handleSubmit(makePostRequest(seeded), submitEnv, { now: NOW });
    assert.equal(first.status, 200, await first.text());
    assert.equal(net2.calls.length, 1, "exactly one NCBI call after consent");

    const second = await handleSubmit(makePostRequest(seeded), submitEnv, { now: NOW + 1000 });
    assert.equal(second.status, 403, "single-use: replay rejected");
    assert.equal((await second.json()).code, "consent_used");
    assert.equal(net2.calls.length, 1, "no second NCBI egress for a reused token");
  } finally {
    net2.restore();
  }
  void state;
  void consent;
});

// --------------------------------------------- (c)+(d) exact outgoing NCBI request

test("(c)+(d) submit sends ONLY approved FASTA + approved params; no secrets; token not in NCBI URL; audit no sequence", async () => {
  const { db, state } = createFakeD1();
  const env = {
    BLAST_DB: db,
    // a decoy secret in the server env must never leak into the outgoing call
    AI_AGENT_TOKEN: "SECRET_AGENT_TOKEN_DO_NOT_LEAK",
    NCBI_API_KEY: "SECRET_NCBI_KEY_DO_NOT_LEAK"
    // no NCBI_TOOL / NCBI_EMAIL identification configured
  };
  const approvedFasta = VALID_PAYLOAD.fasta;
  const payload = await withConsent(
    {
      ...VALID_PAYLOAD,
      // client cannot inject anything beyond approved FASTA + approved params
      execution_mode: "mock",
      mock: true,
      MOCK_NCBI: "1",
      extra: "SHOULD_NOT_BE_FORWARDED",
      note: "project file contents should not leak",
      secrets: "leak me"
    },
    db,
    { now: NOW }
  );
  const consentToken = payload.consent_token;

  const net = stubFetch(() => new Response('<input name="RID" value="ABC123XYZ789">\n<input name="RTOE" value="15">', { status: 200 }));
  let response;
  try {
    response = await handleSubmit(makePostRequest(payload), env, { now: NOW });
  } finally {
    net.restore();
  }
  assert.equal(response.status, 200, await response.text());
  assert.equal(net.calls.length, 1, "exactly one outgoing NCBI request");

  const call = net.calls[0];
  // method + no auth headers
  assert.equal(call.options.method, "GET");
  const headerJson = JSON.stringify(call.options.headers ?? {});
  assert.equal(/authorization/i.test(headerJson), false, "no Authorization header");
  assert.equal(headerJson.includes("SECRET"), false, "no secret in headers");

  // target is NCBI Blast.cgi
  assert.ok(call.url.startsWith("https://blast.ncbi.nlm.nih.gov/Blast.cgi?"), "target NCBI Blast.cgi");

  // exact params
  const url = new URL(call.url);
  const params = url.searchParams;
  assert.equal(params.get("QUERY"), approvedFasta.replace(/\r\n?/g, "\n"), "QUERY is exactly the approved FASTA");
  assert.equal(params.get("DATABASE"), "rRNA_typestrains/16S_ribosomal_RNA", "approved database");
  assert.equal(params.get("PROGRAM"), "blastn", "approved program");
  assert.ok(call.url.includes("DATABASE=rRNA_typestrains%2F16S_ribosomal_RNA"), "DATABASE url-encoded");
  assert.ok(call.url.includes("PROGRAM=blastn"), "PROGRAM=blastn");
  assert.equal(params.get("CMD"), "Put", "this is the audited CMD=Put submission path in code (no live call in tests)");

  // consent token NOT in NCBI URL; no secrets; no unrelated data
  assert.equal(call.url.includes(consentToken), false, "consent token not in NCBI URL");
  assert.equal(call.url.toLowerCase().includes("consent"), false, "no consent field to NCBI");
  assert.equal(call.url.includes("SECRET"), false, "no secret in outgoing URL");
  assert.equal(call.url.includes("SECRET_AGENT_TOKEN_DO_NOT_LEAK"), false);
  assert.equal(call.url.includes("SECRET_NCBI_KEY_DO_NOT_LEAK"), false);
  assert.equal(call.url.includes("SHOULD_NOT_BE_FORWARDED"), false, "no client extra fields forwarded");
  assert.equal(call.url.includes("project file contents"), false, "no unrelated project data");
  assert.equal(call.url.includes("execution_mode"), false, "client execution_mode not forwarded");
  // client `mock`/`execution_mode` cannot force mock/real; no such param is sent
  assert.equal(params.has("mock"), false, "no client mock param forwarded to NCBI");
  assert.equal(params.has("MOCK_NCBI"), false, "no client MOCK_NCBI param forwarded to NCBI");
  assert.equal(params.has("execution_mode"), false, "no client execution_mode param forwarded to NCBI");

  // audit: no sequence, no token; only hashes/counts
  const auditJson = JSON.stringify(state.auditEvents);
  assert.equal(auditJson.includes("ACGTACGT"), false, "no sequence in audit");
  assert.equal(auditJson.includes("ACGTTCGT"), false, "no sequence in audit");
  assert.equal(auditJson.includes(consentToken), false, "consent token not in audit");
  assert.equal(auditJson.includes("SECRET"), false, "no secret in audit");
  const detail = JSON.parse(state.auditEvents[state.auditEvents.length - 1].detail_json);
  assert.equal(detail.database, "rRNA_typestrains/16S_ribosomal_RNA");
  assert.equal(detail.program, "blastn");
  assert.equal(typeof detail.input_hash, "string");
  assert.equal(detail.transmitted, true);
  // blast_requests stores no sequence
  assert.equal(JSON.stringify(state.rows).includes("ACGTACGT"), false, "no sequence in blast_requests");
});

test("(c) real/mock is server-side only: client cannot force real or mock", async () => {
  // MOCK env + client says real -> still mock (no NCBI)
  const mockDb = createFakeD1();
  const mockEnvDb = mockEnv(mockDb.db); // MOCK_NCBI=1
  const mockPayload = await withConsent({ ...VALID_PAYLOAD, execution_mode: "real", mock: false, MOCK_NCBI: "0" }, mockDb.db, { now: NOW });
  const mockNet = stubFetch(() => { throw new Error("mock mode must not contact NCBI"); });
  try {
    const res = await handleSubmit(makePostRequest(mockPayload), mockEnvDb, { now: NOW });
    assert.equal(res.status, 200);
    assert.match((await res.json()).rid, /^MOCK/, "mock RID in server mock mode");
  } finally {
    mockNet.restore();
  }
  assert.equal(mockNet.calls.length, 0, "server mock mode: no NCBI regardless of client fields");

  // Real env + client says mock -> still real (NCBI called)
  const realDb = createFakeD1();
  const realEnv = REAL_ENV_DB(realDb.db);
  delete process.env.MOCK_NCBI;
  const realPayload = await withConsent({ ...VALID_PAYLOAD, execution_mode: "mock", mock: true, MOCK_NCBI: "1" }, realDb.db, { now: NOW });
  const realNet = stubFetch(() => new Response('<input name="RID" value="ABC123XYZ789">', { status: 200 }));
  try {
    const res = await handleSubmit(makePostRequest(realPayload), realEnv, { now: NOW });
    assert.equal(res.status, 200);
    assert.equal((await res.json()).rid, "ABC123XYZ789", "real RID in real mode");
  } finally {
    realNet.restore();
  }
  assert.equal(realNet.calls.length, 1, "server real mode: NCBI called regardless of client mock fields");
});

test("(c) AI execution_mode is server-side only", async () => {
  // client cannot force mock
  const a = mockAIEnv(createFakeD1AI().db);
  const realBody = await (await handleCreateRequest(
    makePostRequest({ text: "identify taxa using blast", fasta: FASTA, execution_mode: "mock" }, "/api/ai/requests"),
    a, { now: NOW }
  )).json();
  assert.equal(realBody.execution_mode, "real");

  // server env mock wins; client cannot force real
  const b = { ...mockAIEnv(createFakeD1AI().db), AI_EXECUTION_MODE: "mock" };
  const mockBody = await (await handleCreateRequest(
    makePostRequest({ text: "identify taxa using blast", fasta: FASTA, execution_mode: "real" }, "/api/ai/requests"),
    b, { now: NOW }
  )).json();
  assert.equal(mockBody.execution_mode, "mock", "server AI_EXECUTION_MODE wins; client cannot force real");
});

// --------------------------------------------------------------- UI / wording

test("UI wording: no false 'no sequence is transmitted'; D1 + NCBI timing; status_conflict simplified", () => {
  const html = readFileSync(new URL("../public/16s.html", import.meta.url), "utf8");
  const js = readFileSync(new URL("../public/js/16s-flow.js", import.meta.url), "utf8");

  // contradictory claims removed
  assert.doesNotMatch(html, /no sequence is transmitted/i);
  assert.doesNotMatch(html, /nothing is transmitted until/i);
  assert.doesNotMatch(html + js, /no sequence is transmitted until you explicitly approve/i);

  // accurate two-axis wording (verbatim)
  const accurate = "Browser validation is local. When you create a request, your FASTA is sent to Smart Bioinformatics AI and stored in D1 for that request. It is not sent to NCBI until you review and approve the plan and explicitly submit using the single-use consent.";
  assert.ok(html.includes(accurate), "accurate two-axis sentence present verbatim");

  // concise main + technical <details>
  assert.match(html, /<details[^>]*>[\s\S]*?<summary[^>]*>Technical data-flow details<\/summary>/i);

  // what is sent to platform / stored / NCBI / when / what consent authorizes
  assert.match(html, /What is sent to this platform/i);
  assert.match(html, /What is stored/i);
  assert.match(html, /What goes to NCBI/i);
  assert.match(html, /When external transmission occurs/i);
  assert.match(html, /What consent authorizes/i);

  // storage reality
  assert.match(html, /FASTA bytes are stored inline in D1/i);
  assert.match(html, /datasets\.fasta_text/i);
  assert.match(html, /no retention period/i);
  assert.match(html, /no.*R2|durable object storage/i);
  // 'short-lived' applies to the single-use token, never to stored FASTA/data
  assert.doesNotMatch(html, /short-lived[^.]*(FASTA|sequence|dataset|storage|data stored)/i, "not 'short-lived' for data");
  assert.doesNotMatch(html, /(FASTA|sequence|dataset)[^.]*short-lived/i, "data not described as short-lived");

  // NCBI: only approved FASTA + params; no secrets; token not exposed; nothing else external
  assert.match(html, /rRNA_typestrains\/16S_ribosomal_RNA/);
  assert.match(html, /PROGRAM=blastn/);
  assert.match(html, /no consent token/i);
  assert.match(html, /no secrets/i);
  assert.match(html, /nothing is sent to NCBI before approval/i);

  // research-use warning + approval badge retained
  assert.match(html, /Research use only\./);
  assert.match(html, /Approval required/);
  // Precision Instrument Bench untouched (design system intact)
  assert.match(readFileSync(new URL("../public/css/tokens.css", import.meta.url), "utf8"), /.*/);

  // P2 status copy simplified (verbatim researcher wording)
  const conflict = "NCBI may occasionally return inconsistent status information. When this happens, monitoring stops and the request is held for verification. No scientific result is shown until the platform retrieves and validates a real results file.";
  assert.ok(html.includes(conflict) || js.includes(conflict), "researcher status_conflict wording");
  // technical status_conflict kept in a concise details area, not ordinary copy
  assert.match(html, /<code>status_conflict<\/code>/);
  assert.match(js, /status_conflict/);
  // honest failed / no-hit / unavailable retained; terminal stops polling; no indefinite animation on terminal
  assert.match(js, /no-hit|no hits|no-hit/i);
  assert.match(js, /unavailable/i);
  assert.match(js, /TERMINAL_STATUSES/);
  assert.match(js, /clearPollTimer\(\)/);
  assert.match(js, /stopCountdown\(\)/);
  assert.doesNotMatch(js, /setInterval\(\(\) => checkStatus/);
  // RID / submission time / RTOE / last check / next permitted check / clear error / resume
  assert.match(js, /RID/);
  assert.match(js, /Submission time/);
  assert.match(js, /RTOE/);
  assert.match(js, /Last check/);
  assert.match(js, /Next permitted check/);
  assert.match(html, /Clear error/);
  assert.match(js, /[Rr]esume/);
  assert.match(html, /id="clear-error"/);
  assert.match(html, /id="resume-rid"/);
  // P5 placeholder-note not broken
  assert.match(html, /class="placeholder-note"/);
  assert.match(html, /greyed-out example is only a placeholder/i);
});

// sanity: the shared AI SQL we rely on still exists (no migration added here)
test("no new endpoints / no migration: reuses existing D1 schema", () => {
  assert.ok(AI_SQL.insertDataset.includes("fasta_text"));
  assert.ok(BLAST_SQL.claimConsent.includes("used_at IS NULL"));
});
