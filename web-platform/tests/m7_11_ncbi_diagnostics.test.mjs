// M7.11 Workstream A — bounded diagnostics + honest ambiguous submission.
// FIXTURES ONLY. All provider responses are stubbed Responses; no test in this
// file contacts NCBI or creates a RID. Zero external CMD=Put submissions.
import test from "node:test";
import assert from "node:assert/strict";

import {
  buildPutDiagnosticDetail,
  classifyPutResponse,
  fetchPutUpstream,
  hashInput,
  PUT_DIAGNOSTIC_EXCERPT_CHARS,
  PUT_SAFE_RESPONSE_HEADERS,
  safePutResponseHeaders,
  safeUrlOriginPath,
  sanitizeDiagnosticText,
  SUBMISSION_UNKNOWN_CODE
} from "../functions/api/blast/_lib.js";
import { handleSubmit } from "../functions/api/blast/submit.js";
import { createFakeD1, makePostRequest, VALID_PAYLOAD, withConsent } from "./helpers/fake-d1.mjs";
import * as F from "./fixtures/m7_11_ncbi_put_fixtures.mjs";

const T0 = Date.parse("2026-11-26T10:00:00.000Z");
const PUT_ORIGIN_PATH = "https://blast.ncbi.nlm.nih.gov/Blast.cgi";

function realEnv(db, extra = {}) {
  return { BLAST_DB: db, NCBI_TOOL: "tests", NCBI_EMAIL: "tests@example.invalid", ...extra };
}

// Install a single-shot stub. The counter is asserted by every integration
// test so an accidental automatic retry cannot pass silently.
function installFetch(calls, factory) {
  const original = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    return factory(calls.length);
  };
  return () => { globalThis.fetch = original; };
}

async function submitWith(body, { status = 200, headers = {} } = {}) {
  const { db, state } = createFakeD1();
  const env = realEnv(db);
  const granted = await withConsent(VALID_PAYLOAD, db, { now: T0 });
  const calls = [];
  const restore = installFetch(calls, () => new Response(body, { status, headers }));
  let response;
  try {
    response = await handleSubmit(makePostRequest(granted), env, { now: T0 });
  } finally {
    restore();
  }
  return { response, state, calls, granted, env };
}

// --------------------------------------------------------------- pure helpers
test("safeUrlOriginPath keeps origin+path only and strips QUERY/token/FASTA", () => {
  const putUrl = `${PUT_ORIGIN_PATH}?CMD=Put&QUERY=${encodeURIComponent(VALID_PAYLOAD.fasta)}&token=SECRET123`;
  const safe = safeUrlOriginPath(putUrl);
  assert.equal(safe, PUT_ORIGIN_PATH);
  assert.equal(safe.includes("QUERY"), false);
  assert.equal(safe.includes("token"), false);
  assert.equal(safe.includes("ACGT"), false);
  assert.equal(safeUrlOriginPath("not a url"), null);
});

test("sanitizeDiagnosticText strips tokens, keys, consent tokens, FASTA and email", () => {
  const excerpt = sanitizeDiagnosticText(F.SECRET_LADEN_BODY);
  assert.ok(excerpt.length > 0);
  assert.ok(excerpt.length <= PUT_DIAGNOSTIC_EXCERPT_CHARS);
  for (const leak of [
    "consent_", "SECRET_FAKE_KEY_VALUE", "FAKE_TOKEN", "FAKE_QUERY_TOKEN_VALUE",
    "researcher.fake@example.org", "QUERY=>seq1", "ACGTACGTACGTACGTACGT", VALID_PAYLOAD.fasta
  ]) {
    assert.equal(excerpt.includes(leak), false, `leak: ${leak}`);
  }
  assert.match(excerpt, /\[redacted\]/);
});

test("safePutResponseHeaders uses only the allowlist and sanitizes values", () => {
  const headers = new Headers({
    "Content-Type": "text/html",
    "Retry-After": "60",
    "CF-Ray": "consent_0123456789abcdef",
    Authorization: "Bearer FAKE_TOKEN_9876543210",
    Location: `${PUT_ORIGIN_PATH}?token=FAKE_QUERY_TOKEN_VALUE_1234567890`,
    Cookie: "session=FAKE_SESSION"
  });
  const safe = safePutResponseHeaders(headers);
  const keys = Object.keys(safe);
  assert.ok(keys.every((key) => PUT_SAFE_RESPONSE_HEADERS.includes(key)));
  assert.equal("authorization" in safe, false);
  assert.equal("location" in safe, false);
  assert.equal("cookie" in safe, false);
  assert.equal(safe["content-type"], "text/html");
  assert.equal(safe["retry-after"], "60");
  assert.equal(safe["cf-ray"], "[redacted]");
  assert.equal(JSON.stringify(safe).includes("FAKE_TOKEN"), false);
});

test("a fake secret tail longer than 120 chars is still fully redacted", () => {
  const excerpt = sanitizeDiagnosticText(F.LONG_SECRET_BODY);
  assert.ok(excerpt.length <= PUT_DIAGNOSTIC_EXCERPT_CHARS);
  assert.equal(excerpt.includes(F.LONG_SECRET_MARKER), false);
  assert.equal(excerpt.includes("Z".repeat(40)), false);
  assert.match(excerpt, /api_key=\[redacted\]/);
});

test("diagnostic_kind is neutral for non-ambiguous failures and ambiguous only when warranted", async () => {
  const cases = [
    [{ body: F.RATE_LIMIT_BODY, status: 429 }, "cmd_put_rate_limited"],
    [{ body: F.PROXY_CDN_ERROR_BODY, status: 502 }, "cmd_put_proxy_error_page"],
    [{ body: F.EMPTY_BODY, status: 200 }, "cmd_put_empty_body"],
    [{ body: F.MALFORMED_RID_BODY, status: 200 }, "cmd_put_ambiguous"]
  ];
  for (const [{ body, status }, expected] of cases) {
    const transport = await fetchPutUpstream(`${PUT_ORIGIN_PATH}?CMD=Put&QUERY=HIDDEN_FASTA`, {
      fetchImpl: async () => new Response(body, { status })
    });
    const parsed = classifyPutResponse(body, { httpStatus: status });
    const detail = await buildPutDiagnosticDetail({
      transport, parsed, attemptId: "aud_kind", at: new Date(T0).toISOString()
    });
    assert.equal(detail.diagnostic_kind, expected, `${status}: ${parsed.classification}`);
  }
  const transportDetail = await buildPutDiagnosticDetail({
    transport: { httpStatus: null, contentType: null, headers: {}, urlOriginPath: PUT_ORIGIN_PATH, body: "" },
    parsed: classifyPutResponse("", { errorCode: "network_error" }),
    attemptId: "aud_kind",
    at: new Date(T0).toISOString()
  });
  assert.equal(transportDetail.diagnostic_kind, "cmd_put_transport_error");
});

test("buildPutDiagnosticDetail records every required bounded field", async () => {
  const transport = await fetchPutUpstream(`${PUT_ORIGIN_PATH}?CMD=Put&QUERY=HIDDEN_FASTA`, {
    fetchImpl: async () => new Response(F.SECRET_LADEN_BODY, {
      status: 200,
      headers: { "Content-Type": "text/html", Authorization: "Bearer FAKE_TOKEN" }
    })
  });
  const parsed = classifyPutResponse(F.SECRET_LADEN_BODY);
  const detail = await buildPutDiagnosticDetail({
    transport,
    parsed,
    attemptId: "aud_fixture_attempt_1",
    at: new Date(T0).toISOString()
  });
  assert.equal(detail.diagnostic_kind, "cmd_put_unexpected_html");
  assert.equal(detail.submission_attempt_id, "aud_fixture_attempt_1");
  assert.equal(detail.requested_at, new Date(T0).toISOString());
  assert.equal(detail.provider_http_status, 200);
  assert.match(detail.content_type, /text\/html/);
  assert.equal(detail.final_url_origin_path, PUT_ORIGIN_PATH);
  assert.equal(detail.body_byte_length, new TextEncoder().encode(F.SECRET_LADEN_BODY).length);
  assert.equal(detail.body_sha256, await hashInput(F.SECRET_LADEN_BODY));
  assert.ok(detail.body_excerpt.length <= PUT_DIAGNOSTIC_EXCERPT_CHARS);
  assert.equal(typeof detail.parser_classification, "string");
  assert.equal(typeof detail.parser_reason, "string");
  assert.equal(detail.auto_retried, false);
  const serialized = JSON.stringify(detail);
  for (const leak of ["HIDDEN_FASTA", "QUERY=>seq1", "consent_", "FAKE_TOKEN", "api_key=SECRET"]) {
    assert.equal(serialized.includes(leak), false, `leak: ${leak}`);
  }
});

// --------------------------------------------------- submit integration (all stubbed)
test("2xx with no valid RID returns typed submission_unknown, inserts nothing, never retries", async () => {
  const { response, state, calls, granted } = await submitWith(F.UNEXPECTED_HTML_BODY);
  assert.equal(response.status, 502);
  const body = await response.json();
  assert.equal(body.code, SUBMISSION_UNKNOWN_CODE);
  assert.equal(body.transmitted, true);
  assert.equal(body.rid, null);
  assert.equal(body.diagnostics_available, true);
  assert.equal(calls.length, 1, "no automatic retry after an ambiguous submission");
  assert.match(calls[0].url, /QUERY=/);
  assert.equal(state.rows.length, 0, "no blast_requests row without a valid RID");
  assert.equal(state.consents.find((row) => row.token === granted.consent_token).used_at, new Date(T0).toISOString());
  assert.equal(state.auditEvents.length, 1);
  const detail = JSON.parse(state.auditEvents[0].detail_json);
  assert.equal(detail.status, SUBMISSION_UNKNOWN_CODE);
  assert.equal(detail.error, SUBMISSION_UNKNOWN_CODE);
  assert.equal(detail.success, false);
  assert.equal(detail.transmitted, true);
  assert.equal(detail.rid, null);
  assert.equal(detail.diagnostics.parser_classification, "unexpected_html");
  assert.equal(detail.diagnostics.parser_reason, "unexpected_html");
  assert.equal(detail.diagnostics.provider_http_status, 200);
  assert.equal(detail.diagnostics.final_url_origin_path, PUT_ORIGIN_PATH);
  assert.equal(detail.diagnostics.auto_retried, false);
  const serialized = JSON.stringify(state.auditEvents);
  assert.equal(serialized.includes(VALID_PAYLOAD.fasta), false);
  assert.equal(serialized.includes("QUERY="), false);
  assert.equal(serialized.includes("ACGT"), false);
});

test("hostile diagnostic body is redacted in the persisted audit detail", async () => {
  const { response, state, calls } = await submitWith(F.SECRET_LADEN_BODY, {
    headers: {
      "Content-Type": "text/html",
      Authorization: "Bearer FAKE_TOKEN_9876543210",
      Location: `${PUT_ORIGIN_PATH}?token=FAKE_QUERY_TOKEN_VALUE_1234567890`
    }
  });
  assert.equal(response.status, 502);
  assert.equal((await response.json()).code, SUBMISSION_UNKNOWN_CODE);
  assert.equal(calls.length, 1);
  const serialized = JSON.stringify(state.auditEvents);
  for (const leak of [
    "consent_", "SECRET_FAKE_KEY_VALUE", "FAKE_TOKEN", "FAKE_QUERY_TOKEN_VALUE_1234567890",
    "researcher.fake@example.org", "ACGTACGTACGTACGTACGT", VALID_PAYLOAD.fasta
  ]) {
    assert.equal(serialized.includes(leak), false, `audit leak: ${leak}`);
  }
  const detail = JSON.parse(state.auditEvents[0].detail_json);
  assert.equal("authorization" in detail.diagnostics.safe_response_headers, false);
  assert.equal("location" in detail.diagnostics.safe_response_headers, false);
  assert.equal(detail.diagnostics.final_url_origin_path, PUT_ORIGIN_PATH);
});

test("empty body, unexpected JSON and explicit NCBI error page are all typed ambiguous states", async () => {
  for (const [body, expectedClassification] of [
    [F.EMPTY_BODY, "empty_body"],
    [F.UNEXPECTED_JSON_BODY, "unexpected_json"],
    [F.NCBI_ERROR_PAGE, "provider_error_page"]
  ]) {
    const { response, state, calls } = await submitWith(body);
    assert.equal(response.status, 502);
    assert.equal((await response.json()).code, SUBMISSION_UNKNOWN_CODE);
    assert.equal(calls.length, 1);
    assert.equal(state.rows.length, 0);
    const detail = JSON.parse(state.auditEvents[0].detail_json);
    assert.equal(detail.diagnostics.parser_classification, expectedClassification);
  }
});

test("rate-limit and proxy responses are failed egress (not mislabelled ambiguous), with no retry", async () => {
  for (const [body, status, expectedClassification] of [
    [F.RATE_LIMIT_BODY, 429, "rate_limited"],
    [F.PROXY_CDN_ERROR_BODY, 502, "proxy_error_page"]
  ]) {
    const { response, state, calls } = await submitWith(body, { status });
    assert.equal(response.status, 502);
    const bodyJson = await response.json();
    assert.equal(bodyJson.code, "ncbi_error");
    assert.notEqual(bodyJson.code, SUBMISSION_UNKNOWN_CODE);
    assert.equal(bodyJson.transmitted, true, "a 429/5xx still reached NCBI");
    assert.equal(bodyJson.diagnostics_available, true, "matching the ambiguous branch semantics");
    assert.equal(calls.length, 1, "no retry on 429/5xx");
    assert.equal(state.rows.length, 0);
    const detail = JSON.parse(state.auditEvents[0].detail_json);
    assert.equal(detail.error, "ncbi_error");
    assert.equal(detail.diagnostics.parser_classification, expectedClassification);
    assert.equal(detail.diagnostics.provider_http_status, status);
  }
});

test("malformed RID and QBlastInfo-without-RID are ambiguous, with no job stored", async () => {
  for (const [body, expected] of [
    [F.MALFORMED_RID_BODY, "malformed_rid"],
    [F.QBLAST_STATUS_ONLY_BODY, "no_rid"]
  ]) {
    const { response, state, calls } = await submitWith(body);
    assert.equal(response.status, 502);
    assert.equal((await response.json()).code, SUBMISSION_UNKNOWN_CODE);
    assert.equal(calls.length, 1);
    assert.equal(state.rows.length, 0);
    assert.equal(JSON.parse(state.auditEvents[0].detail_json).diagnostics.parser_classification, expected);
  }
});

test("valid RID with malformed optional RTOE is accepted, flagged and diagnosed", async () => {
  const { response, state, calls } = await submitWith(F.MALFORMED_RTOE_BODY);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.rid, F.FIXTURE_RID_B);
  assert.equal(body.rtoe, null, "malformed RTOE is never invented");
  assert.equal(calls.length, 1);
  assert.equal(state.rows.length, 1);
  const detail = JSON.parse(state.auditEvents[0].detail_json);
  assert.equal(detail.status, "succeeded");
  assert.equal(detail.rid, F.FIXTURE_RID_B);
  assert.equal(detail.rtoe, null);
  assert.equal(detail.diagnostics.parser_reason, "valid_rid_malformed_rtoe");
  assert.equal(detail.diagnostics.ambiguous, true);
});

test("valid RID alongside provider error text is accepted, diagnosed, never a fabricated result", async () => {
  const { response, state, calls } = await submitWith(F.RID_WITH_ERROR_PAGE);
  assert.equal(response.status, 200);
  assert.equal((await response.json()).rid, F.FIXTURE_RID);
  assert.equal(calls.length, 1);
  assert.equal(state.rows.length, 1);
  const detail = JSON.parse(state.auditEvents[0].detail_json);
  assert.equal(detail.diagnostics.ambiguous, true);
  assert.equal(detail.diagnostics.parser_reason, "valid_rid_with_provider_error");
});

test("unambiguous valid RID keeps the historical success shape and adds no diagnostics", async () => {
  const { response, state, calls } = await submitWith(F.DOCUMENTED_QBLAST_BLOCK);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { rid: F.FIXTURE_RID, status: "queued", rtoe: F.FIXTURE_RTOE });
  assert.equal(calls.length, 1);
  assert.equal(state.rows.length, 1);
  const detail = JSON.parse(state.auditEvents[0].detail_json);
  assert.equal(detail.status, "succeeded");
  assert.equal(detail.success, true);
  assert.equal(detail.rtoe, F.FIXTURE_RTOE);
  assert.equal(detail.diagnostics, undefined);
});

test("transport failure still fails closed as ncbi_error with one audited attempt", async () => {
  const { db, state } = createFakeD1();
  const env = realEnv(db);
  const granted = await withConsent(VALID_PAYLOAD, db, { now: T0 });
  const calls = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    throw new Error("stubbed network failure");
  };
  let response;
  try {
    response = await handleSubmit(makePostRequest(granted), env, { now: T0 });
  } finally {
    globalThis.fetch = original;
  }
  assert.equal(response.status, 502);
  assert.equal((await response.json()).code, "ncbi_error");
  assert.equal(calls.length, 1, "no retry on transport failure");
  assert.equal(state.rows.length, 0);
  assert.equal(state.auditEvents.length, 1);
  const detail = JSON.parse(state.auditEvents[0].detail_json);
  assert.equal(detail.status, "failed");
  assert.equal(detail.error, "ncbi_error");
  assert.equal(detail.diagnostics.parser_classification, "transport_error");
  assert.equal(detail.diagnostics.parser_reason, "network_error");
});

test("consent stays single-use after an ambiguous submission: no second egress", async () => {
  const { state, granted, env } = await submitWith(F.UNEXPECTED_HTML_BODY);
  assert.equal(state.consents.find((row) => row.token === granted.consent_token).used_at, new Date(T0).toISOString());
  const calls = [];
  const restore = installFetch(calls, () => new Response("should never be called", { status: 200 }));
  let second;
  try {
    second = await handleSubmit(makePostRequest(granted), env, { now: T0 + 1 });
  } finally {
    restore();
  }
  assert.equal(second.status, 403);
  assert.equal((await second.json()).code, "consent_used");
  assert.equal(calls.length, 0, "a burned token never triggers another CMD=Put");
  assert.equal(state.auditEvents.length, 1, "no second egress was audited");
});
