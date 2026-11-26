// M7.11 Workstream A — offline CMD=Put response classification.
// FIXTURES ONLY. Every body below comes from m7_11_ncbi_put_fixtures.mjs;
// nothing in this file performs a network request or creates a real RID.
import test from "node:test";
import assert from "node:assert/strict";

import {
  classifyPutResponse,
  parsePutResponse,
  parsePutResponseDetailed,
  parseRtoe,
  PUT_PARSE_CLASSIFICATIONS,
  PUT_PARSE_REASONS
} from "../functions/api/blast/_lib.js";
import * as F from "./fixtures/m7_11_ncbi_put_fixtures.mjs";

const stableClassifications = new Set(Object.values(PUT_PARSE_CLASSIFICATIONS));

function classified(body, options = {}) {
  const result = classifyPutResponse(body, options);
  assert.ok(stableClassifications.has(result.classification), `unstable classification: ${result.classification}`);
  assert.equal(result.accepted, result.classification === PUT_PARSE_CLASSIFICATIONS.ACCEPTED);
  return result;
}

test("fixture label: these bodies are synthetic test data, not NCBI evidence", () => {
  // Guards against a fixture ever being mistaken for a recorded live response.
  assert.equal(F.DOCUMENTED_QBLAST_BLOCK.includes("FIXTURE01"), true);
  assert.equal(F.NCBI_ERROR_PAGE.includes("fixture"), false); // shape fixture, no live id
  assert.equal(F.FIXTURE_RID, "FIXTURE01");
});

test("documented QBlastInfoBegin/QBlastInfoEnd block with separate RID/RTOE lines", () => {
  const r = classified(F.DOCUMENTED_QBLAST_BLOCK, { httpStatus: 200, contentType: "text/html" });
  assert.equal(r.classification, PUT_PARSE_CLASSIFICATIONS.ACCEPTED);
  assert.equal(r.reason, PUT_PARSE_REASONS.VALID_RID);
  assert.equal(r.rid, F.FIXTURE_RID);
  assert.equal(r.rtoe, F.FIXTURE_RTOE);
  assert.equal(r.ambiguous, false);
  assert.equal(r.has_qblast_block, true);
});

test("HTML-comment wrapper and CRLF / varied whitespace still classify accepted", () => {
  for (const body of [F.HTML_COMMENT_WRAPPED_QBLAST, F.CRLF_QBLAST]) {
    const r = classified(body, { httpStatus: 200, contentType: "text/html" });
    assert.equal(r.classification, PUT_PARSE_CLASSIFICATIONS.ACCEPTED);
    assert.equal(r.rid, F.FIXTURE_RID);
    assert.equal(r.rtoe, F.FIXTURE_RTOE);
  }
});

test("full HTML document wrapper and reversed hidden-input attributes are accepted", () => {
  for (const body of [F.FULL_HTML_DOCUMENT, F.REVERSED_ATTRIBUTES]) {
    const r = classified(body, { httpStatus: 200, contentType: "text/html" });
    assert.equal(r.classification, PUT_PARSE_CLASSIFICATIONS.ACCEPTED);
    assert.equal(r.rid, F.FIXTURE_RID);
    assert.equal(r.rtoe, F.FIXTURE_RTOE);
  }
});

test("content-type variations never change an accepted RID", () => {
  for (const contentType of ["text/html", "text/plain", "text/html; charset=UTF-8", "application/octet-stream", null]) {
    const r = classified(F.DOCUMENTED_QBLAST_BLOCK, { httpStatus: 200, contentType });
    assert.equal(r.classification, PUT_PARSE_CLASSIFICATIONS.ACCEPTED, String(contentType));
    assert.equal(r.rid, F.FIXTURE_RID);
    assert.equal(r.content_type, contentType);
  }
});

test("public parsing helpers keep their historical shapes on every accepted fixture", () => {
  for (const body of [
    F.DOCUMENTED_QBLAST_BLOCK,
    F.HTML_COMMENT_WRAPPED_QBLAST,
    F.CRLF_QBLAST,
    F.FULL_HTML_DOCUMENT,
    F.REVERSED_ATTRIBUTES
  ]) {
    assert.equal(parsePutResponse(body), F.FIXTURE_RID);
    assert.deepEqual(parsePutResponseDetailed(body), { rid: F.FIXTURE_RID, rtoe: F.FIXTURE_RTOE });
  }
  assert.deepEqual(parsePutResponseDetailed("Request ID = ABC999ZZ"), { rid: "ABC999ZZ", rtoe: null });
  assert.equal(parseRtoe(F.MALFORMED_RTOE_BODY), null);
});

test("explicit NCBI error page is a typed provider error, never a job", () => {
  const r = classified(F.NCBI_ERROR_PAGE, { httpStatus: 200, contentType: "text/html" });
  assert.equal(r.classification, PUT_PARSE_CLASSIFICATIONS.PROVIDER_ERROR_PAGE);
  assert.equal(r.reason, PUT_PARSE_REASONS.NCBI_ERROR_PAGE);
  assert.equal(r.accepted, false);
  assert.equal(r.rid, null);
  assert.equal(parsePutResponse(F.NCBI_ERROR_PAGE), null);
});

test("empty body is never success, even with HTTP 200", () => {
  const r = classified(F.EMPTY_BODY, { httpStatus: 200, contentType: "text/html" });
  assert.equal(r.classification, PUT_PARSE_CLASSIFICATIONS.EMPTY_BODY);
  assert.equal(r.reason, PUT_PARSE_REASONS.EMPTY_BODY);
  assert.equal(r.accepted, false);
});

test("rate-limit responses are classified and never accepted", () => {
  const withStatus = classified(F.RATE_LIMIT_BODY, { httpStatus: 429, contentType: "text/html" });
  assert.equal(withStatus.classification, PUT_PARSE_CLASSIFICATIONS.RATE_LIMITED);
  assert.equal(withStatus.reason, PUT_PARSE_REASONS.HTTP_429);
  assert.equal(withStatus.accepted, false);
  const byBody = classified(F.RATE_LIMIT_BODY, { httpStatus: 200 });
  assert.equal(byBody.classification, PUT_PARSE_CLASSIFICATIONS.RATE_LIMITED);
  // A RID-looking token inside a 429 body is not trusted.
  const withRid = classified(`${F.RATE_LIMIT_BODY}\nRID = ${F.FIXTURE_RID}`, { httpStatus: 429 });
  assert.equal(withRid.accepted, false);
  assert.equal(withRid.rid, F.FIXTURE_RID, "candidate is retained for diagnostics but not trusted");
});

test("proxy/CDN error pages are classified separately from provider errors", () => {
  const r = classified(F.PROXY_CDN_ERROR_BODY, { httpStatus: 502, contentType: "text/html" });
  assert.equal(r.classification, PUT_PARSE_CLASSIFICATIONS.PROXY_ERROR_PAGE);
  assert.equal(r.reason, PUT_PARSE_REASONS.PROXY_CDN_ERROR);
  assert.equal(r.accepted, false);
  const withRid = classified(`${F.PROXY_CDN_ERROR_BODY}\nRID = ${F.FIXTURE_RID}`, { httpStatus: 502 });
  assert.equal(withRid.accepted, false, "a RID in a proxy error response is not trusted");
});

test("unexpected 2xx HTML and unexpected JSON are distinct typed states", () => {
  const html = classified(F.UNEXPECTED_HTML_BODY, { httpStatus: 200, contentType: "text/html" });
  assert.equal(html.classification, PUT_PARSE_CLASSIFICATIONS.UNEXPECTED_HTML);
  assert.equal(html.reason, PUT_PARSE_REASONS.UNEXPECTED_HTML);
  assert.equal(html.accepted, false);
  const json = classified(F.UNEXPECTED_JSON_BODY, { httpStatus: 200, contentType: "application/json" });
  assert.equal(json.classification, PUT_PARSE_CLASSIFICATIONS.UNEXPECTED_JSON);
  assert.equal(json.reason, PUT_PARSE_REASONS.UNEXPECTED_JSON);
  assert.equal(json.accepted, false);
  assert.equal(parsePutResponse(F.UNEXPECTED_JSON_BODY), null);
});

test("malformed RID is never promoted to a valid RID", () => {
  const r = classified(F.MALFORMED_RID_BODY, { httpStatus: 200 });
  assert.equal(r.classification, PUT_PARSE_CLASSIFICATIONS.MALFORMED_RID);
  assert.equal(r.reason, PUT_PARSE_REASONS.RID_PRESENT_MALFORMED);
  assert.equal(r.rid, null);
  assert.equal(r.accepted, false);
  assert.equal(r.ambiguous, true);
  assert.equal(parsePutResponse(F.MALFORMED_RID_BODY), null);
  assert.ok(r.rid_candidate_count > 0);
});

test("RID present with malformed optional RTOE stays accepted but is flagged", () => {
  const r = classified(F.MALFORMED_RTOE_BODY, { httpStatus: 200 });
  assert.equal(r.classification, PUT_PARSE_CLASSIFICATIONS.ACCEPTED);
  assert.equal(r.reason, PUT_PARSE_REASONS.VALID_RID_MALFORMED_RTOE);
  assert.equal(r.rid, F.FIXTURE_RID_B);
  assert.equal(r.rtoe, null, "a malformed RTOE is never invented");
  assert.equal(r.rtoe_malformed, true);
  assert.equal(r.ambiguous, true);
  assert.deepEqual(parsePutResponseDetailed(F.MALFORMED_RTOE_BODY), { rid: F.FIXTURE_RID_B, rtoe: null });
});

test("valid RID alongside an error page is accepted but ambiguous", () => {
  const r = classified(F.RID_WITH_ERROR_PAGE, { httpStatus: 200 });
  assert.equal(r.classification, PUT_PARSE_CLASSIFICATIONS.ACCEPTED);
  assert.equal(r.reason, PUT_PARSE_REASONS.VALID_RID_WITH_PROVIDER_ERROR);
  assert.equal(r.rid, F.FIXTURE_RID);
  assert.equal(r.ambiguous, true);
});

test("QBlastInfo status-only body has no RID and is not a job", () => {
  const r = classified(F.QBLAST_STATUS_ONLY_BODY, { httpStatus: 200 });
  assert.equal(r.classification, PUT_PARSE_CLASSIFICATIONS.NO_RID);
  assert.equal(r.reason, PUT_PARSE_REASONS.QBLAST_BLOCK_WITHOUT_RID);
  assert.equal(r.has_qblast_block, true);
  assert.equal(r.accepted, false);
  assert.equal(r.ambiguous, true);
});

test("transport failures are typed and produce no RID", () => {
  for (const errorCode of ["timeout", "network_error"]) {
    const r = classified("", { errorCode, httpStatus: null });
    assert.equal(r.classification, PUT_PARSE_CLASSIFICATIONS.TRANSPORT_ERROR);
    assert.equal(r.reason, errorCode === "timeout" ? PUT_PARSE_REASONS.TIMEOUT : PUT_PARSE_REASONS.NETWORK_ERROR);
    assert.equal(r.accepted, false);
  }
});

test("4xx and 5xx without recognised markers are typed HTTP errors", () => {
  const four = classified("client error", { httpStatus: 404 });
  assert.equal(four.classification, PUT_PARSE_CLASSIFICATIONS.HTTP_ERROR);
  assert.equal(four.reason, PUT_PARSE_REASONS.HTTP_4XX);
  const five = classified("server error", { httpStatus: 500 });
  assert.equal(five.classification, PUT_PARSE_CLASSIFICATIONS.HTTP_ERROR);
  assert.equal(five.reason, PUT_PARSE_REASONS.HTTP_5XX);
});

test("HTTP 200 alone is never accepted: every no-RID fixture stays rejected", () => {
  const bodies = [
    F.EMPTY_BODY,
    F.NCBI_ERROR_PAGE,
    F.RATE_LIMIT_BODY,
    F.PROXY_CDN_ERROR_BODY,
    F.UNEXPECTED_HTML_BODY,
    F.UNEXPECTED_JSON_BODY,
    F.MALFORMED_RID_BODY,
    F.QBLAST_STATUS_ONLY_BODY
  ];
  for (const body of bodies) {
    const r = classified(body, { httpStatus: 200, contentType: "text/html" });
    assert.equal(r.accepted, false, "HTTP 200 must not imply success");
  }
});
