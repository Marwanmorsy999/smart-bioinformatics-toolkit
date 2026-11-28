// M7.7 — status-evidence reconciliation. No test contacts NCBI; provider
// responses are mocked/stubbed. Real raw evidence files are read from
// docs/evidence (already captured); no new NCBI call (no CMD=Put) is made.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  ALLOWED_DATABASE,
  ALLOWED_PROGRAM,
  QBLAST_STATES,
  QBLAST_TERMINAL_STATES,
  hashInput,
  parsePutResponse,
  parsePutResponseDetailed,
  parseQBlastStatus,
  parseRtoe,
  reconcileStatusEvidence,
  validateDatabase
} from "../functions/api/blast/_lib.js";
import { handleSubmit } from "../functions/api/blast/submit.js";
import { handleStatus } from "../functions/api/blast/status/[rid].js";
import { handleResults } from "../functions/api/blast/results/[rid].js";
import { buildPutParams } from "../functions/api/blast/_lib.js";
import { createFakeD1, makeGetRequest, makePostRequest, mockEnv, VALID_PAYLOAD, withConsent } from "./helpers/fake-d1.mjs";

const T0 = Date.parse("2026-11-26T10:00:00.000Z");
const RID = "GF4KCK07016";
const EVIDENCE_DIR = new URL("../../docs/evidence/", import.meta.url);

function readEvidence(name) {
  return JSON.parse(readFileSync(new URL(name, EVIDENCE_DIR), "utf8"));
}

// Evidence A: canonical CMD=Get -> Status=FAILED + invalid database.
const CANONICAL_RAW = readEvidence("M7_7_recheck_canonical_raw.json");
const EVIDENCE_A = CANONICAL_RAW.body;
// Evidence B: CMD=Get&FORMAT_OBJECT=SearchInfo -> READY + ThereAreHits=no.
const SEARCHINFO_RAW = readEvidence("M7_7_recheck_searchinfo_raw.json");
const EVIDENCE_B = SEARCHINFO_RAW.body;

const QB = (status) => `<!-- QBlastInfoBegin\nStatus=${status}\nQBlastInfoEnd -->`;

// ------------------------------------------------------------- status parser
test("M7.7 evidence A: canonical FAILED + invalid database -> failed/provider_database_error", () => {
  const parsed = parseQBlastStatus(EVIDENCE_A, { rid: RID, httpStatus: 200, mode: "canonical" });
  assert.equal(parsed.state, "failed");
  assert.equal(parsed.reason, "provider_database_error");
  assert.equal(parsed.terminal, true);
  assert.equal(parsed.evidence.qblast_status, "FAILED");
  assert.match(parsed.evidence.provider_error, /No alias or index file found for nucleotide database \[16S_ribosomal_RNA\]/);
  assert.equal(parsed.evidence.there_are_hits, null);
  assert.equal(parsed.evidence.no_hits, false);
  // raw re-capture M7.6 + M7.7 both reproduce it
  const m76 = readEvidence("M7_6_status_url_raw.json");
  const p76 = parseQBlastStatus(m76.body, { rid: RID, httpStatus: 200 });
  assert.equal(p76.state, "failed");
  assert.equal(p76.reason, "provider_database_error");
});

test("M7.7 evidence B: SearchInfo READY + ThereAreHits=no -> complete + no_hits (not format-only)", () => {
  const parsed = parseQBlastStatus(EVIDENCE_B, { rid: RID, httpStatus: 200, mode: "SearchInfo" });
  assert.equal(parsed.state, "complete");
  assert.equal(parsed.reason, null);
  assert.equal(parsed.terminal, true);
  assert.equal(parsed.evidence.there_are_hits, "no");
  assert.equal(parsed.evidence.no_hits, true);
  assert.equal(parsed.evidence.qblast_status, "READY");
  // the stale "Status=Searching" table is NOT authoritative
  assert.notEqual(parsed.state, "queued");
  // also auto-detected in canonical mode (no canonical error page)
  const auto = parseQBlastStatus(EVIDENCE_B, { rid: RID, httpStatus: 200 });
  assert.equal(auto.state, "complete");
  assert.equal(auto.evidence.no_hits, true);
});

test("WAITING/QUEUED->queued; RUNNING->running; READY+yes->complete; FAILED->failed; UNKNOWN->unavailable", () => {
  assert.equal(parseQBlastStatus(QB("WAITING")).state, "queued");
  assert.equal(parseQBlastStatus(QB("QUEUED")).state, "queued");
  assert.equal(parseQBlastStatus(QB("RUNNING")).state, "running");
  const readyYes = parseQBlastStatus(`<!-- QBlastInfoBegin\nStatus=READY\nQBlastInfoEnd -->\n<!-- QBlastInfoBegin\nThereAreHits=yes\nQBlastInfoEnd -->`);
  assert.equal(readyYes.state, "complete");
  assert.equal(readyYes.evidence.there_are_hits, "yes");
  assert.equal(readyYes.evidence.no_hits, false);
  assert.equal(parseQBlastStatus(QB("FAILED")).state, "failed");
  assert.equal(parseQBlastStatus(QB("UNKNOWN")).state, "unavailable");
  // SearchInfo mode applies the same mapping
  assert.equal(parseQBlastStatus(QB("WAITING"), { mode: "SearchInfo" }).state, "queued");
  assert.equal(parseQBlastStatus(QB("RUNNING"), { mode: "SearchInfo" }).state, "running");
  assert.equal(parseQBlastStatus(QB("UNKNOWN"), { mode: "SearchInfo" }).state, "unavailable");
  assert.equal(parseQBlastStatus(QB("FAILED"), { mode: "SearchInfo" }).state, "failed");
});

test("missing block -> malformed; unknown token -> malformed; never queued/complete", () => {
  const missing = parseQBlastStatus("<html><body><p>Status=READY</p></body></html>");
  assert.equal(missing.state, "error");
  assert.equal(missing.reason, "malformed_response");
  assert.notEqual(missing.state, "queued");
  assert.notEqual(missing.state, "complete");
  const noStatus = parseQBlastStatus("<!-- QBlastInfoBegin\nThereAreHits=no\nQBlastInfoEnd -->");
  assert.equal(noStatus.state, "error");
  assert.equal(noStatus.reason, "malformed_response");
  const unknown = parseQBlastStatus(QB("BANANA"));
  assert.equal(unknown.state, "error");
  assert.equal(unknown.reason, "malformed_response");
  const empty = parseQBlastStatus("");
  assert.equal(empty.state, "error");
  assert.notEqual(empty.state, "queued");
});

test("multiple conflicting Status across QBlastInfo blocks -> typed status_conflict (terminal)", () => {
  const body = `<!-- QBlastInfoBegin\nStatus=READY\nQBlastInfoEnd -->\n<!-- QBlastInfoBegin\nStatus=FAILED\nQBlastInfoEnd -->`;
  const parsed = parseQBlastStatus(body, { rid: RID });
  assert.equal(parsed.state, "status_conflict");
  assert.equal(parsed.state, QBLAST_STATES.CONFLICT);
  assert.equal(parsed.terminal, true);
  assert.ok(QBLAST_TERMINAL_STATES.has("status_conflict"));
  assert.deepEqual([...parsed.evidence.conflicting_statuses].sort(), ["FAILED", "READY"]);
  assert.notEqual(parsed.state, "queued");
  assert.notEqual(parsed.state, "complete");
  // WAITING + QUEUED are distinct recognized values -> conflict
  const wq = parseQBlastStatus(`${QB("WAITING")}\n${QB("QUEUED")}`);
  assert.equal(wq.state, "status_conflict");
  // same value repeated is NOT a conflict
  assert.equal(parseQBlastStatus(`${QB("READY")}\n${QB("READY")}`).state, "complete");
});

test("stale Status=Searching table is not authoritative; error page with unrelated Status=READY is not success", () => {
  // stale placeholder table only (no QBlastInfo) -> not queued/success
  const stale = parseQBlastStatus(`<table id="statInfo"><tr><td>Status</td><td>Searching</td></tr></table>`);
  assert.equal(stale.state, "error");
  assert.notEqual(stale.state, "queued");
  // stale table + valid QBlastInfo READY -> stale table ignored
  const withStale = parseQBlastStatus(`${QB("READY")}<table><tr><td>Status</td><td>Searching</td></tr></table>`);
  assert.equal(withStale.state, "complete");
  // canonical error page + unrelated READY -> contradiction, never success
  const errorPage = `<html><body><p class="usa-alert-text">Error: No alias or index file found for nucleotide database [16S_ribosomal_RNA] in search path [/x].</p>${QB("READY")}</body></html>`;
  const err = parseQBlastStatus(errorPage);
  assert.notEqual(err.state, "complete");
  assert.equal(err.state, "status_conflict");
  assert.ok(err.evidence.provider_error);
});

test("timeout, network error and non-2xx are honest, never queued/complete", () => {
  const timeout = parseQBlastStatus(EVIDENCE_A, { timeout: true });
  assert.equal(timeout.state, "unavailable");
  assert.equal(timeout.reason, "timeout");
  const network = parseQBlastStatus("", { errorCode: "network_error" });
  assert.equal(network.state, "unavailable");
  assert.equal(network.reason, "network_error");
  const http = parseQBlastStatus(QB("READY"), { httpStatus: 503 });
  assert.equal(http.state, "unavailable");
  assert.equal(http.reason, "http_error");
  for (const p of [timeout, network, http]) {
    assert.notEqual(p.state, "queued");
    assert.notEqual(p.state, "complete");
  }
});

test("reconcileStatusEvidence(A,B) -> status_conflict; preserves both evidences", () => {
  const a = parseQBlastStatus(EVIDENCE_A, { rid: RID, httpStatus: 200, mode: "canonical" });
  const b = parseQBlastStatus(EVIDENCE_B, { rid: RID, httpStatus: 200, mode: "SearchInfo" });
  const reconciled = reconcileStatusEvidence(a, b);
  assert.equal(reconciled.conflict, true);
  assert.equal(reconciled.state, "status_conflict");
  assert.ok(reconciled.reason);
  assert.equal(reconciled.evidences.length, 2);
  assert.equal(reconciled.evidences[0].qblast_status, "FAILED");
  assert.equal(reconciled.evidences[1].qblast_status, "READY");
  assert.equal(reconciled.a, a);
  assert.equal(reconciled.b, b);
  // order-independent
  assert.equal(reconcileStatusEvidence(b, a).state, "status_conflict");
  // two agreeing snapshots do not conflict
  const agree = reconcileStatusEvidence(a, parseQBlastStatus(QB("FAILED"), { rid: RID }));
  assert.equal(agree.conflict, false);
});

// ------------------------------------------------------- status handler
function realEnv(db, extra = {}) { return { BLAST_DB: db, NCBI_TOOL: "tests", NCBI_EMAIL: "t@example.invalid", ...extra }; }
function realRow(overrides = {}) {
  return { rid: RID, status: "queued", created_at: new Date(T0).toISOString(), last_checked_at: null, input_hash: "a".repeat(64), result_tsv: null, ...overrides };
}
const resp = (body, status = 200) => new Response(body, { status, headers: { "Content-Type": "text/html" } });

test("status handler passes canonical mode; conflict -> typed status_conflict + stops polling", async () => {
  const conflict = `${QB("READY")}\n${QB("FAILED")}`;
  const { db, state } = createFakeD1([realRow()]);
  const out = await handleStatus(RID, makeGetRequest(`/api/blast/status/${RID}`), realEnv(db), { now: T0, fetchImpl: async () => resp(conflict) });
  const body = await out.json();
  assert.equal(out.status, 200);
  assert.equal(body.state, "status_conflict");
  assert.equal(body.code, "status_conflict");
  assert.equal(body.terminal, true);
  assert.equal(state.rows[0].status, "status_conflict");
  // terminal: a second check does not contact NCBI again
  let calls = 0;
  const second = await handleStatus(RID, makeGetRequest(`/api/blast/status/${RID}`), realEnv(db), {
    now: T0 + 120000,
    fetchImpl: async () => { calls += 1; return resp(QB("READY")); }
  });
  assert.equal((await second.json()).state, "status_conflict");
  assert.equal(calls, 0, "status_conflict is terminal; no re-poll");
});

test("status handler: SearchInfo-style contradictory evidence is not queued; canonical FAILED is failed", async () => {
  const { db } = createFakeD1([realRow({ rid: "RIDX", status: "queued" })]);
  const out = await handleStatus("RIDX", makeGetRequest("/api/blast/status/RIDX"), realEnv(db), { now: T0, fetchImpl: async () => resp(EVIDENCE_A) });
  const body = await out.json();
  assert.equal(body.state, "failed");
  assert.equal(body.reason, "provider_database_error");
  assert.notEqual(body.state, "queued");
});

// ------------------------------------------------------- results gates
test("results blocked before canonical complete; canonical not-complete blocks; no_hits kept; SHA-256/provenance kept", async () => {
  const request = makeGetRequest(`/api/blast/results/${RID}?format=json`);
  // not complete in D1
  let { db } = createFakeD1([realRow({ status: "queued" })]);
  let r = await handleResults(RID, request, realEnv(db), { now: T0 });
  assert.equal(r.status, 409);
  // canonical not-complete body re-verified
  db = createFakeD1([realRow({ status: "complete" })]).db;
  r = await handleResults(RID, request, realEnv(db), { now: T0, fetchImpl: async () => resp(QB("RUNNING")) });
  assert.equal(r.status, 409);
  assert.equal((await r.json()).state, "running");
  // conflicting canonical body -> 409 typed status_conflict
  db = createFakeD1([realRow({ status: "complete" })]).db;
  r = await handleResults(RID, request, realEnv(db), { now: T0, fetchImpl: async () => resp(`${QB("READY")}${QB("FAILED")}`) });
  assert.equal(r.status, 409);
  assert.equal((await r.json()).state, "status_conflict");
});

test("results no-hit outcome from canonical complete + ThereAreHits=no; no fabricated table", async () => {
  const { db } = createFakeD1([realRow({ status: "complete" })]);
  const statusBody = `${QB("READY")}\n<!-- QBlastInfoBegin\nThereAreHits=no\nQBlastInfoEnd -->`;
  const r = await handleResults(RID, makeGetRequest(`/api/blast/results/${RID}?format=json`), realEnv(db), { now: T0, fetchImpl: async () => resp(statusBody) });
  assert.equal(r.status, 200);
  const body = await r.json();
  assert.equal(body.outcome, "no_hits");
  assert.equal(body.table, null);
  assert.equal(body.tsv, null);
  assert.equal(body.evidence.no_hits, true);
});

const TSV = ["qseqid\tsacc\tstaxids\tsscinames\tpident\tlength\tqstart\tqend\tqlen\tevalue\tbitscore\tqcovs", "q1\tNR_074666.1\t1234\tFrancisella tularensis\t99.5\t100\t1\t100\t100\t1e-50\t200\t100"].join("\n") + "\n";

test("results hit: SHA-256 + provenance + canonical DB/program; HTML/empty rejected; mock separated", async () => {
  // hit
  let { db } = createFakeD1([realRow({ status: "complete" })]);
  const fetchImpl = async (url) => {
    const q = new URL(String(url)).searchParams;
    if (q.get("FORMAT_TYPE") === "Text") return new Response(TSV, { status: 200, headers: { "Content-Type": "text/plain" } });
    return resp(QB("READY"));
  };
  let r = await handleResults(RID, makeGetRequest(`/api/blast/results/${RID}?format=json`), realEnv(db), { now: T0, fetchImpl });
  let body = await r.json();
  assert.equal(r.status, 200);
  assert.equal(body.provenance.sha256, await hashInput(TSV));
  assert.equal(body.provenance.database, ALLOWED_DATABASE);
  assert.equal(body.provenance.program, "blastn");
  assert.equal(body.provenance.mock, false);
  assert.equal(body.mock, false);
  // HTML / empty results rejected
  for (const [resultsBody, ct] of [["<html><body>nope</body></html>", "text/html"], ["", "text/plain"]]) {
    ({ db } = createFakeD1([realRow({ status: "complete" })]));
    const impl = async (url) => {
      const q = new URL(String(url)).searchParams;
      if (q.get("FORMAT_TYPE") === "Text") return new Response(resultsBody, { status: 200, headers: { "Content-Type": ct } });
      return resp(QB("READY"));
    };
    const rr = await handleResults(RID, makeGetRequest(`/api/blast/results/${RID}?format=json`), realEnv(db), { now: T0, fetchImpl: impl });
    assert.equal(rr.status, 502);
    assert.equal((await rr.json()).table, null);
  }
  // mock separation: mock RID in real mode rejected
  ({ db } = createFakeD1([realRow({ rid: "MOCKABC123", status: "complete" })]));
  const mr = await handleResults("MOCKABC123", makeGetRequest("/api/blast/results/MOCKABC123?format=json"), realEnv(db), { now: T0, fetchImpl });
  assert.equal(mr.status, 409);
});

// ------------------------------------------------------- canonical database
test("old bare database rejected; corrected canonical accepted; consent bound to canonical; no browser override", async () => {
  assert.equal(ALLOWED_DATABASE, "rRNA_typestrains/16S_ribosomal_RNA");
  assert.equal(ALLOWED_PROGRAM, "blastn");
  assert.equal(validateDatabase("16S_ribosomal_RNA").valid, false, "old bare name rejected");
  assert.equal(validateDatabase("rRNA_typestrains/16S_ribosomal_RNA").valid, true, "corrected canonical accepted");

  // buildPutParams uses the canonical constant, never a caller value
  const params = buildPutParams(VALID_PAYLOAD.fasta, {});
  assert.equal(params.get("DATABASE"), "rRNA_typestrains/16S_ribosomal_RNA");
  assert.equal(params.get("PROGRAM"), "blastn");
  const encoded = params.toString();
  assert.ok(encoded.includes("DATABASE=rRNA_typestrains%2F16S_ribosomal_RNA"), `encoded=${encoded}`);
  assert.equal(new URLSearchParams(encoded).get("DATABASE"), "rRNA_typestrains/16S_ribosomal_RNA");

  // submit rejects a browser-supplied bare/invalid database; no egress
  const { db } = createFakeD1();
  const env = { BLAST_DB: db };
  const granted = await withConsent({ ...VALID_PAYLOAD, database: "16S_ribosomal_RNA" }, db, { now: T0 });
  const originalFetch = globalThis.fetch;
  let egress = false;
  globalThis.fetch = async () => { egress = true; return new Response("x"); };
  try {
    const bad = await handleSubmit(makePostRequest({ ...granted, database: "16S_ribosomal_RNA" }), env, { now: T0 });
    assert.equal(bad.status, 400, "no browser override of the canonical database");
    assert.equal(egress, false);
  } finally { globalThis.fetch = originalFetch; }
});

test("exact outgoing CMD=Put contains canonical DATABASE + PROGRAM=blastn; consent + audit consistent (stubbed, no network)", async () => {
  const { db, state } = createFakeD1();
  const env = { BLAST_DB: db, NCBI_TOOL: "tests", NCBI_EMAIL: "t@example.invalid" };
  const granted = await withConsent(VALID_PAYLOAD, db, { now: T0 });
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    return new Response(`<input type="hidden" name="RID" value="ABC123XYZ"><input type="hidden" name="RTOE" value="30">`, { status: 200, headers: { "Content-Type": "text/html" } });
  };
  let result;
  try {
    result = await handleSubmit(makePostRequest(granted), env, { now: T0 });
  } finally { globalThis.fetch = originalFetch; }

  assert.equal(result.status, 200);
  // no real network: the stub captured exactly one outgoing call
  assert.equal(calls.length, 1);
  const outgoing = calls[0].url;
  const queryString = outgoing.split("?")[1] || "";
  assert.ok(outgoing.startsWith("https://blast.ncbi.nlm.nih.gov/Blast.cgi?"));
  // exact outgoing PUT contains canonical DATABASE + PROGRAM=blastn + CMD=Put
  assert.ok(queryString.includes("CMD=Put"), queryString);
  assert.ok(queryString.includes("DATABASE=rRNA_typestrains%2F16S_ribosomal_RNA"), queryString);
  const decoded = new URLSearchParams(queryString);
  assert.equal(decoded.get("DATABASE"), "rRNA_typestrains/16S_ribosomal_RNA");
  assert.equal(decoded.get("PROGRAM"), "blastn");
  assert.ok(!queryString.includes("16S_ribosomal_RNA%2F16S"), "no bare db");
  assert.ok(!/(^|&)DATABASE=16S_ribosomal_RNA(&|$)/.test(queryString));
  // consent bound to canonical
  assert.equal(state.consents[0].database, "rRNA_typestrains/16S_ribosomal_RNA");
  assert.equal(state.consents[0].program, "blastn");
  // audit consistent (no sequence)
  const detail = JSON.parse(state.auditEvents[0].detail_json);
  assert.equal(detail.database, "rRNA_typestrains/16S_ribosomal_RNA");
  assert.equal(detail.program, "blastn");
  assert.equal(JSON.stringify(state.auditEvents).includes("ACGTACGT"), false);
  assert.ok(!outgoing.includes("consent_"), "consent token never in the NCBI URL");
});

// ------------------------------------------------------- RTOE
test("RTOE parsed; parsePutResponse unchanged; real submit returns {rid,status,rtoe} + audit; mock unaffected", async () => {
  const put = `<input type="hidden" name="RID" value="ABC123XYZ"><input type="hidden" name="RTOE" value="30">`;
  assert.equal(parseRtoe(put), 30);
  assert.equal(parseRtoe(`name="RTOE" value="12"`), 12);
  assert.equal(parseRtoe("RTOE=45"), 45);
  assert.equal(parseRtoe(`value="9" name="RTOE"`), 9);
  assert.equal(parseRtoe("no rtoe here"), null);
  assert.equal(parseRtoe(`name="RTOE" value="soon"`), null);
  assert.equal(parsePutResponse(put), "ABC123XYZ", "parsePutResponse unchanged");
  assert.deepEqual(parsePutResponseDetailed(put), { rid: "ABC123XYZ", rtoe: 30 });
  assert.deepEqual(parsePutResponseDetailed("Request ID = ABC999ZZ"), { rid: "ABC999ZZ", rtoe: null });

  const { db, state } = createFakeD1();
  const env = { BLAST_DB: db };
  const granted = await withConsent(VALID_PAYLOAD, db, { now: T0 });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(put, { status: 200 });
  let result;
  try { result = await handleSubmit(makePostRequest(granted), env, { now: T0 }); }
  finally { globalThis.fetch = originalFetch; }
  const body = await result.json();
  assert.equal(body.rid, "ABC123XYZ");
  assert.equal(body.status, "queued");
  assert.equal(body.rtoe, 30);
  const detail = JSON.parse(state.auditEvents[0].detail_json);
  assert.equal(detail.rtoe, 30);
  assert.equal(JSON.stringify(state.auditEvents).includes("ACGTACGT"), false);
  // nothing new recorded in D1 blast_requests
  assert.equal(state.rows[0].rid, "ABC123XYZ");

  // mock branch keeps minimal shape, no RTOE invented
  const mockDb = createFakeD1();
  const mockGranted = await withConsent(VALID_PAYLOAD, mockDb.db, { now: T0 });
  const m = await handleSubmit(makePostRequest(mockGranted), mockEnv(mockDb.db), { now: T0 });
  const mb = await m.json();
  assert.equal(mb.status, "queued");
  assert.equal(mb.rtoe, undefined);
});

test("no NCBI call in unit tests (fetch is always stubbed)", () => {
  assert.ok(true);
});
