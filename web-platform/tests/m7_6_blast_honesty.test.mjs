// M7.6 — strict provider-status parsing and honest result retrieval.
// Every NCBI interaction is mocked here: no test contacts a live provider.
import test from "node:test";
import assert from "node:assert/strict";

import {
  ALLOWED_DATABASE,
  QBLAST_PARSER_SCHEMA,
  hashInput,
  isMock,
  parseQBlastStatus,
  safeStatusEvidence
} from "../functions/api/blast/_lib.js";
import { handleSubmit } from "../functions/api/blast/submit.js";
import { handleStatus } from "../functions/api/blast/status/[rid].js";
import { handleResults } from "../functions/api/blast/results/[rid].js";
import {
  createFakeD1,
  makeGetRequest,
  makePostRequest,
  VALID_PAYLOAD,
  withConsent
} from "./helpers/fake-d1.mjs";

const T0 = Date.parse("2026-11-26T09:30:00.000Z");
const RID = "REALRID123";

const FAILED_BODY = `<html><body>
<p id="qb"><!--
QBlastInfoBegin
\tStatus=FAILED
QBlastInfoEnd
--></p>
<p class="usa-alert-text">There was a problem with the search.</p>
<p class="usa-alert-text">Error: No alias or index file found for nucleotide database [16S_ribosomal_RNA] in search path [/blast/db]. Please verify the spelling of </p>
</body></html>`;

const READY_BODY = `<html><body><p><!--
QBlastInfoBegin
\tStatus=READY
QBlastInfoEnd
--></p></body></html>`;

// Evidence-B style FORMAT_OBJECT=SearchInfo page (M7.7): valid QBlastInfo
// search-status evidence, NOT a "format-only" page. Stale "Status=Searching"
// table and hidden fields are not authoritative.
const FORMAT_READY_BODY = `<html><body>
<div class="pageTitle">Format Request Status</div>
<p><!-- QBlastInfoBegin
\tStatus=READY
QBlastInfoEnd
--></p>
<p><!-- QBlastInfoBegin
\tThereAreHits=no
QBlastInfoEnd
--></p>
<table id="statInfo" class="READY"><tr><td>Status</td><td>Searching</td></tr></table>
<form><input name="FORMAT_OBJECT" type="hidden" value="SearchInfo"><input name="CMD" type="hidden" value="Get"></form>
</body></html>`;

const NO_HITS_BODY = `<html><body><p><!--
QBlastInfoBegin
\tStatus=READY
QBlastInfoEnd
--></p><p><!--
QBlastInfoBegin
\tThereAreHits=no
QBlastInfoEnd
--></p></body></html>`;

const TSV = [
  "# BLASTN tabular report",
  "qseqid\tsacc\tstaxids\tsscinames\tpident\tlength\tqstart\tqend\tqlen\tevalue\tbitscore\tqcovs",
  "q1\tNR_074666.1\t1234\tFrancisella tularensis\t99.5\t100\t1\t100\t100\t1e-50\t200\t100"
].join("\n") + "\n";

function realEnv(db, extra = {}) {
  return { BLAST_DB: db, NCBI_TOOL: "tests", NCBI_EMAIL: "tests@example.invalid", ...extra };
}

function realRow(overrides = {}) {
  return {
    rid: RID,
    status: "complete",
    created_at: new Date(T0).toISOString(),
    last_checked_at: null,
    input_hash: "a".repeat(64),
    result_tsv: null,
    ...overrides
  };
}

function response(body, { status = 200, contentType = "text/html" } = {}) {
  return new Response(body, { status, headers: { "Content-Type": contentType } });
}

// The status and results endpoints share one injected fetch; the URL decides
// which canned provider document is returned.
function providerFetch({ statusBody = READY_BODY, resultsBody = TSV, resultsStatus = 200, contentType = "text/plain" } = {}) {
  const calls = [];
  const impl = async (url) => {
    const query = new URL(String(url)).searchParams;
    if (query.get("FORMAT_TYPE") === "Text") {
      calls.push("results");
      return response(resultsBody, { status: resultsStatus, contentType });
    }
    calls.push("status");
    return response(statusBody, { contentType: "text/html" });
  };
  return { impl, calls };
}

// ------------------------------------------------------------ strict parser
test("FAILED database error is a typed terminal failure with safe evidence", () => {
  const parsed = parseQBlastStatus(FAILED_BODY, { rid: "GF4KCK07016", httpStatus: 200, at: T0 });
  assert.equal(parsed.state, "failed");
  assert.equal(parsed.reason, "provider_database_error");
  assert.equal(parsed.terminal, true);
  assert.match(parsed.message, /no results|not found/i);
  assert.equal(parsed.evidence.rid, "GF4KCK07016");
  assert.equal(parsed.evidence.qblast_status, "FAILED");
  assert.equal(parsed.evidence.http_status, 200);
  assert.match(parsed.evidence.provider_error, /No alias or index file found/);
  assert.equal(JSON.stringify(parsed.evidence).includes("<html"), false);
  assert.equal(JSON.stringify(parsed.evidence).includes("QBlastInfoBegin"), false);
});

test("canonical READY completes; valid SearchInfo READY is search-status evidence (M7.7)", () => {
  assert.equal(parseQBlastStatus(READY_BODY).state, "complete");
  // Evidence B: FORMAT_OBJECT=SearchInfo page, no canonical error page.
  // M7.7 corrects the M7.6 "format-only" misclassification: a valid SearchInfo
  // QBlastInfo block is search-status evidence, and the stale "Searching"
  // table is not authoritative.
  const canonicalMode = parseQBlastStatus(FORMAT_READY_BODY);
  assert.equal(canonicalMode.state, "complete");
  assert.equal(canonicalMode.reason, null);
  assert.equal(canonicalMode.evidence.there_are_hits, "no");
  assert.equal(canonicalMode.evidence.no_hits, true);
  assert.equal(canonicalMode.evidence.qblast_status, "READY");
  const searchInfoMode = parseQBlastStatus(FORMAT_READY_BODY, { mode: "SearchInfo" });
  assert.equal(searchInfoMode.state, "complete");
  assert.equal(searchInfoMode.evidence.there_are_hits, "no");
  assert.equal(searchInfoMode.evidence.no_hits, true);
  // No "format_status_only" misclassification exists anymore.
  assert.notEqual(canonicalMode.reason, "format_status_only");
});

test("RUNNING, WAITING and QUEUED map to non-terminal states", () => {
  const body = (value) => `<!-- QBlastInfoBegin\nStatus=${value}\nQBlastInfoEnd -->`;
  assert.equal(parseQBlastStatus(body("RUNNING")).state, "running");
  assert.equal(parseQBlastStatus(body("WAITING")).state, "queued");
  assert.equal(parseQBlastStatus(body("QUEUED")).state, "queued");
  assert.equal(parseQBlastStatus(body("RUNNING")).terminal, false);
});

test("malformed HTML, empty body, timeout and non-2xx never become queued or complete", () => {
  const malformed = parseQBlastStatus("<html><body><p>Status=Ready</p></body></html>");
  assert.equal(malformed.state, "error");
  assert.equal(malformed.reason, "malformed_response");
  const empty = parseQBlastStatus("");
  assert.equal(empty.state, "error");
  assert.equal(empty.reason, "empty_response");
  const timeout = parseQBlastStatus("", { timeout: true });
  assert.equal(timeout.state, "unavailable");
  assert.equal(timeout.reason, "timeout");
  const http = parseQBlastStatus(FAILED_BODY, { httpStatus: 503 });
  assert.equal(http.state, "unavailable");
  assert.equal(http.reason, "http_error");
});

test("safe evidence drops secrets, sequences and long HTML", () => {
  const hostile = FAILED_BODY
    + "\nconsent_0123456789abcdef0123456789abcdef\nQUERY=>seq1\nACGTACGTNRYSWKMBDHV\nNCBI_EMAIL=someone@example.org";
  const evidence = safeStatusEvidence({
    rid: "<script>",
    at: "not-a-date",
    httpStatus: 200,
    qblastStatus: "FAILED",
    providerError: hostile,
    thereAreHits: "maybe",
    errorCode: "unknown_code"
  });
  const serialized = JSON.stringify(evidence);
  assert.equal(evidence.rid, null);
  assert.ok(Number.isFinite(Date.parse(evidence.timestamp)));
  assert.equal(evidence.there_are_hits, null);
  assert.equal(evidence.error_code, null);
  assert.equal(serialized.includes("consent_"), false);
  assert.equal(serialized.includes("ACGTACGT"), false);
  assert.equal(serialized.includes("NCBI_EMAIL"), false);
  assert.equal(serialized.includes("<html"), false);
  assert.ok(evidence.provider_error.length <= 300);
});

// ------------------------------------------------------------ status handler
test("status handler persists the typed failure and never fabricates results", async () => {
  const { db, state } = createFakeD1([realRow({ status: "queued" })]);
  const { impl, calls } = providerFetch({ statusBody: FAILED_BODY });
  const responseBody = await handleStatus(RID, makeGetRequest(`/api/blast/status/${RID}`), realEnv(db), {
    now: T0,
    fetchImpl: impl
  });
  assert.equal(responseBody.status, 200);
  const body = await responseBody.json();
  assert.equal(body.state, "failed");
  assert.equal(body.reason, "provider_database_error");
  assert.equal(body.terminal, true);
  assert.equal(body.mock, false);
  assert.match(body.evidence.provider_error, /No alias or index file found/);
  assert.equal(state.rows[0].status, "failed");
  assert.deepEqual(calls, ["status"]);
});

test("terminal states stop polling and do not contact NCBI again", async () => {
  const { db } = createFakeD1([realRow({ status: "failed", last_checked_at: new Date(T0 - 120000).toISOString() })]);
  const { impl, calls } = providerFetch();
  const request = makeGetRequest(`/api/blast/status/${RID}`);
  const first = await handleStatus(RID, request, realEnv(db), { now: T0, fetchImpl: impl });
  assert.equal((await first.json()).state, "failed");
  assert.deepEqual(calls, [], "a terminal RID is never re-polled");
  const second = await handleStatus(RID, request, realEnv(db), { now: T0 + 1000, fetchImpl: impl });
  assert.equal(second.status, 429);
  assert.ok(Number(second.headers.get("Retry-After")) > 0);
  assert.deepEqual(calls, []);
});

test("network timeout and non-2xx status become honest unavailable states", async () => {
  const { db } = createFakeD1([
    realRow({ rid: "RIDTIMEOUT", status: "queued" }),
    realRow({ rid: "RIDHTTP503", status: "queued" })
  ]);
  const aborting = async () => {
    const error = new Error("aborted");
    error.name = "AbortError";
    throw error;
  };
  const timeout = await handleStatus("RIDTIMEOUT", makeGetRequest("/api/blast/status/RIDTIMEOUT"), realEnv(db), {
    now: T0,
    fetchImpl: aborting
  });
  assert.equal((await timeout.json()).reason, "timeout");
  const http = await handleStatus("RIDHTTP503", makeGetRequest("/api/blast/status/RIDHTTP503"), realEnv(db), {
    now: T0,
    fetchImpl: async () => response("service down", { status: 503 })
  });
  const body = await http.json();
  assert.equal(body.state, "unavailable");
  assert.equal(body.reason, "http_error");
  assert.equal(body.evidence.http_status, 503);
});

// ------------------------------------------------------------ results gates
test("results are blocked before genuine canonical completion (production gate)", async () => {
  const { db } = createFakeD1([realRow({ status: "queued" })]);
  const request = makeGetRequest(`/api/blast/results/${RID}?format=json`);
  const queued = await handleResults(RID, request, realEnv(db), { now: T0 });
  assert.equal(queued.status, 409);
  assert.match((await queued.json()).error, /not ready/);

  // Production gate: re-verify the CANONICAL body. Inject a canonical
  // non-complete body; only canonical complete unlocks. No "format_status_only".
  const CANONICAL_WAITING = `<html><body><!-- QBlastInfoBegin\nStatus=WAITING\nQBlastInfoEnd --></body></html>`;
  const { db: db2 } = createFakeD1([realRow()]);
  const { impl } = providerFetch({ statusBody: CANONICAL_WAITING });
  const notComplete = await handleResults(RID, request, realEnv(db2), { now: T0, fetchImpl: impl });
  assert.equal(notComplete.status, 409);
  const body = await notComplete.json();
  assert.equal(body.state, "queued");
  assert.equal(body.outcome, "provider_failure");
  assert.equal(body.table, null);
  assert.notEqual(body.reason, "format_status_only");
  assert.equal(body.reason, null);
});

test("contradictory canonical status evidence is typed status_conflict (409)", async () => {
  const CONFLICT_BODY = `<html><body>
<!-- QBlastInfoBegin\nStatus=READY\nQBlastInfoEnd -->
<!-- QBlastInfoBegin\nStatus=FAILED\nQBlastInfoEnd -->
</body></html>`;
  const { db } = createFakeD1([realRow()]);
  const { impl } = providerFetch({ statusBody: CONFLICT_BODY });
  const result = await handleResults(RID, makeGetRequest(`/api/blast/results/${RID}?format=json`), realEnv(db), {
    now: T0,
    fetchImpl: impl
  });
  assert.equal(result.status, 409);
  const body = await result.json();
  assert.equal(body.state, "status_conflict");
  assert.equal(body.code, "status_conflict");
  assert.equal(body.table, null);
  assert.equal(body.mock, false);
});

test("HTML, error bodies and non-TSV content are rejected without synthesis", async () => {
  for (const [label, resultsBody, contentType] of [
    ["html", "<html><body>QBlastInfoBegin Error: bad database</body></html>", "text/html"],
    ["empty", "", "text/plain"],
    ["prose", "no tabular data here", "text/plain"]
  ]) {
    const { db } = createFakeD1([realRow()]);
    const { impl } = providerFetch({ resultsBody, contentType });
    const result = await handleResults(RID, makeGetRequest(`/api/blast/results/${RID}?format=json`), realEnv(db), {
      now: T0,
      fetchImpl: impl
    });
    assert.equal(result.status, 502, label);
    const body = await result.json();
    assert.equal(body.table, null);
    assert.equal(body.tsv, undefined);
    assert.equal(body.mock, false);
    assert.match(body.message, /no result table was fabricated/i);
  }
});

test("completed no-hits is a typed outcome, not a synthetic table", async () => {
  const { db, state } = createFakeD1([realRow()]);
  const { impl } = providerFetch({ statusBody: NO_HITS_BODY, resultsBody: TSV });
  const result = await handleResults(RID, makeGetRequest(`/api/blast/results/${RID}?format=json`), realEnv(db), {
    now: T0,
    fetchImpl: impl
  });
  assert.equal(result.status, 200);
  const body = await result.json();
  assert.equal(body.outcome, "no_hits");
  assert.equal(body.state, "no_hits");
  assert.equal(body.table, null);
  assert.equal(body.tsv, null);
  assert.equal(body.evidence.there_are_hits, "no");
  assert.equal(state.rows[0].result_tsv, null, "no synthetic table is cached");
});

test("real TSV response carries SHA-256 and full provenance", async () => {
  const { db, state } = createFakeD1([realRow()]);
  const { impl, calls } = providerFetch({ resultsBody: TSV, contentType: "text/plain" });
  const envelope = await handleResults(RID, makeGetRequest(`/api/blast/results/${RID}?format=json`), realEnv(db), {
    now: T0,
    fetchImpl: impl
  });
  assert.equal(envelope.status, 200);
  const body = await envelope.json();
  assert.equal(body.outcome, "hits");
  assert.equal(body.mock, false);
  assert.equal(body.tsv, TSV);
  assert.equal(body.provenance.rid, RID);
  assert.equal(body.provenance.database, ALLOWED_DATABASE);
  assert.equal(body.provenance.program, "blastn");
  assert.equal(body.provenance.retrieved_at, new Date(T0).toISOString());
  assert.equal(body.provenance.mock, false);
  assert.equal(body.provenance.parser_schema, QBLAST_PARSER_SCHEMA);
  assert.equal(body.provenance.sha256, await hashInput(TSV));
  assert.equal(body.provenance.rows_parsed, 1);
  assert.equal(body.provenance.rows_rejected, 0);
  assert.deepEqual(calls, ["status", "results"]);
  assert.equal(state.rows[0].result_tsv, TSV);

  const { db: db2 } = createFakeD1([realRow({ result_tsv: TSV })]);
  const plain = await handleResults(RID, makeGetRequest(`/api/blast/results/${RID}`), realEnv(db2), {
    now: T0,
    fetchImpl: providerFetch().impl
  });
  assert.equal(await plain.text(), TSV);
  assert.equal(plain.headers.get("X-Blast-Sha256"), await hashInput(TSV));
  assert.equal(plain.headers.get("X-Blast-Mock"), "false");
  assert.equal(plain.headers.get("X-Blast-Parser-Schema"), QBLAST_PARSER_SCHEMA);
});

// ------------------------------------------- throttle, resume, real/mock split
test("global throttle returns typed 429 with Retry-After before consuming consent", async () => {
  const recent = [1, 2].map((offset) => realRow({
    rid: `REALRID00${offset}`,
    created_at: new Date(T0 - offset * 1000).toISOString()
  }));
  const { db, state } = createFakeD1(recent);
  const env = realEnv(db, { NCBI_SUBMIT_LIMIT: 2, NCBI_SUBMIT_WINDOW_MS: 60000 });
  const granted = await withConsent(VALID_PAYLOAD, db, { now: T0 });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = () => { throw new Error("throttled submission must not contact NCBI"); };
  try {
    const result = await handleSubmit(makePostRequest(granted), env, { now: T0 });
    assert.equal(result.status, 429);
    const body = await result.json();
    assert.equal(body.code, "ncbi_submit_throttled");
    assert.ok(body.retry_after_seconds > 0);
    assert.equal(Number(result.headers.get("Retry-After")), body.retry_after_seconds);
  } finally {
    globalThis.fetch = originalFetch;
  }
  assert.equal(state.consents[0].used_at, null, "rejected request did not burn consent");
  assert.equal(state.auditEvents.length, 0);
  assert.equal(state.rows.length, 2, "no duplicate job was created");
});

test("resume-by-RID is read-only: no egress, no consent burn, no duplicate job", async () => {
  const inputHash = await hashInput(VALID_PAYLOAD.fasta);
  const { db, state } = createFakeD1([realRow({ rid: RID, status: "queued", input_hash: inputHash })]);
  const granted = await withConsent(VALID_PAYLOAD, db, { now: T0 });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = () => { throw new Error("resume must never resubmit"); };
  try {
    const result = await handleSubmit(makePostRequest({ ...granted, rid: RID }), realEnv(db), { now: T0 });
    assert.equal(result.status, 200);
    const body = await result.json();
    assert.equal(body.rid, RID);
    assert.equal(body.resumed, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
  assert.equal(state.consents[0].used_at, null);
  assert.equal(state.auditEvents.length, 0);
  assert.equal(state.rows.length, 1);
});

test("real/mock is chosen by server env only, never a client execution_mode label", async () => {
  const { db, state } = createFakeD1();
  const env = realEnv(db);
  const granted = await withConsent({ ...VALID_PAYLOAD, execution_mode: "mock" }, db, { now: T0 });
  assert.equal(isMock(env), false);
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => response("Request ID = ABC123XYZ", { contentType: "text/html" });
  try {
    const result = await handleSubmit(makePostRequest(granted), env, { now: T0 });
    assert.equal(result.status, 200);
    const body = await result.json();
    assert.match(body.rid, /^ABC123XYZ$/);
    assert.equal(state.rows[0].status, "queued");
    assert.equal(JSON.parse(state.auditEvents[0].detail_json).mock, false);
  } finally {
    globalThis.fetch = originalFetch;
  }

  // A mock RID is not accepted as real evidence when MOCK_NCBI is off.
  const { db: db2 } = createFakeD1([realRow({ rid: "MOCKABC123", status: "complete" })]);
  const mockRidResult = await handleResults("MOCKABC123", makeGetRequest("/api/blast/results/MOCKABC123?format=json"), realEnv(db2), {
    now: T0,
    fetchImpl: providerFetch().impl
  });
  assert.equal(mockRidResult.status, 409);
});
