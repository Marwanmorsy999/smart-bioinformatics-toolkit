// M7.10 results-handler tests. EVERY provider response is a FIXTURE returned
// by a stubbed fetch. No live NCBI request, no CMD=Put, no new RID, no 9Router.
import test from "node:test";
import assert from "node:assert/strict";

import { ALLOWED_DATABASE, hashInput } from "../functions/api/blast/_lib.js";
import { handleResults } from "../functions/api/blast/results/[rid].js";
import { createFakeD1, makeGetRequest } from "./helpers/fake-d1.mjs";
import { JSON2_FIXTURE_TEXT, JSON2_NO_HITS_FIXTURE_TEXT } from "./fixtures/m7_10_json2_fixture.mjs";

const T0 = Date.parse("2026-11-26T10:00:00.000Z");
const RID = "M7T10RID123";

const READY_BODY = `<html><body><!-- QBlastInfoBegin\nStatus=READY\nQBlastInfoEnd --></body></html>`;
const NO_HITS_BODY = `<html><body><!-- QBlastInfoBegin\nStatus=READY\nQBlastInfoEnd --></body></html>\n<!-- QBlastInfoBegin\nThereAreHits=no\nQBlastInfoEnd -->`;
const CONFLICT_BODY = `<html><body><!-- QBlastInfoBegin\nStatus=READY\nQBlastInfoEnd -->\n<!-- QBlastInfoBegin\nStatus=FAILED\nQBlastInfoEnd --></body></html>`;
const TSV_FIXTURE = "# fixture tabular\nqseqid\tsacc\tstaxids\tsscinames\tpident\tlength\tqstart\tqend\tqlen\tevalue\tbitscore\tqcovs\nq1\tNR_074666.1\t1234\tFixture organism\t97.5\t40\t1\t40\t40\t1e-50\t200\t100\n";

function realRow(overrides = {}) {
  return {
    rid: RID, status: "complete", created_at: new Date(T0).toISOString(),
    last_checked_at: null, input_hash: "b".repeat(64), result_tsv: null, ...overrides
  };
}

function envFor(db) {
  return { BLAST_DB: db, NCBI_TOOL: "fixture-tests", NCBI_EMAIL: "fixture@example.invalid" };
}

function response(body, contentType = "text/plain") {
  return new Response(body, { status: 200, headers: { "Content-Type": contentType } });
}

// Dispatches by the OFFICIAL CMD=Get parameters. Only the injected fixture is
// ever returned; the stub records which retrieval shape was requested.
function stubProvider({ statusBody = READY_BODY, json2Body = JSON2_FIXTURE_TEXT, tabularBody = TSV_FIXTURE } = {}) {
  const calls = [];
  const impl = async (url) => {
    const params = new URL(String(url)).searchParams;
    const format = params.get("FORMAT_TYPE");
    if (format === "JSON2") {
      calls.push("results-json2");
      return response(json2Body, "application/json");
    }
    if (format === "Text") {
      calls.push("results-tabular");
      return response(tabularBody, "text/plain");
    }
    calls.push("status");
    return response(statusBody, "text/html");
  };
  return { impl, calls };
}

function request(query = "?format=json&structured=1") {
  return makeGetRequest(`/api/blast/results/${RID}${query}`);
}

test("FIXTURE: structured=1 performs one JSON2 results fetch after the canonical status gate", async () => {
  const { db, state } = createFakeD1([realRow()]);
  const { impl, calls } = stubProvider();
  const result = await handleResults(RID, request(), envFor(db), { now: T0, fetchImpl: impl });
  assert.equal(result.status, 200);
  const body = await result.json();
  assert.equal(body.status, "complete");
  assert.equal(body.outcome, "hits");
  assert.equal(body.mock, false);
  assert.equal(body.table, null);
  assert.equal(body.result.query.id, "fixture_query_1 16S isolate");
  assert.equal(body.result.hits.length, 3);
  assert.equal(body.tsv.includes("# derived_from: json2"), true);
  assert.equal(body.provenance.result_format, "json2");
  assert.equal(body.provenance.derived_from, "json2");
  assert.equal(body.provenance.sha256, await hashInput(JSON2_FIXTURE_TEXT));
  assert.equal(body.provenance.retrieved_at, new Date(T0).toISOString());
  assert.equal(body.provenance.database, ALLOWED_DATABASE);
  assert.equal(body.evidence.qblast_status, "READY");
  // Exactly one status preflight and one JSON2 retrieval; no tabular fetch.
  assert.deepEqual(calls, ["status", "results-json2"]);
  // RAW JSON2 is cached, not the derived TSV.
  assert.equal(state.rows[0].result_tsv, JSON2_FIXTURE_TEXT);
});

test("FIXTURE: structured no-hit and contradictory status behave like the default gate", async () => {
  const { db } = createFakeD1([realRow()]);
  const noHitsFetch = stubProvider({ statusBody: NO_HITS_BODY });
  const noHits = await handleResults(RID, request(), envFor(db), { now: T0, fetchImpl: noHitsFetch.impl });
  assert.equal(noHits.status, 200);
  const noHitsBody = await noHits.json();
  assert.equal(noHitsBody.outcome, "no_hits");
  assert.equal(noHitsBody.tsv, null);
  assert.deepEqual(noHitsFetch.calls, ["status"], "no results fetch is made for no-hits");

  const conflictFetch = stubProvider({ statusBody: CONFLICT_BODY });
  const conflict = await handleResults(RID, request(), envFor(db), { now: T0, fetchImpl: conflictFetch.impl });
  assert.equal(conflict.status, 409);
  assert.equal((await conflict.json()).state, "status_conflict");
  assert.deepEqual(conflictFetch.calls, ["status"]);
});

test("FIXTURE: malformed JSON2 is rejected without fabricating a table", async () => {
  const { db } = createFakeD1([realRow()]);
  const { impl } = stubProvider({ json2Body: "<html>not json2</html>" });
  const result = await handleResults(RID, request(), envFor(db), { now: T0, fetchImpl: impl });
  assert.equal(result.status, 502);
  const body = await result.json();
  assert.equal(body.table, null);
  assert.equal(body.tsv, undefined);
  assert.match(body.message, /no result was fabricated/i);
});

test("FIXTURE: cached=1 serves the raw JSON2 with zero provider fetches and a null retrieval time", async () => {
  const { db, state } = createFakeD1([realRow({ result_tsv: JSON2_FIXTURE_TEXT })]);
  const neverFetch = async () => { throw new Error("cached mode must not fetch"); };
  const result = await handleResults(
    RID, request("?format=json&structured=1&cached=1"), envFor(db), { now: T0, fetchImpl: neverFetch }
  );
  assert.equal(result.status, 200);
  const body = await result.json();
  assert.equal(body.cached, true);
  assert.equal(body.result.hits.length, 3);
  assert.equal(body.tsv.includes("# derived_from: json2"), true);
  assert.equal(body.provenance.cached, true);
  assert.equal(body.provenance.retrieved_at, null);
  assert.equal(
    body.provenance.warnings.some((warning) => /without a fresh NCBI fetch/.test(warning)),
    true
  );
  assert.equal(state.rows[0].result_tsv, JSON2_FIXTURE_TEXT, "cached mode never overwrites the cache");
});

test("FIXTURE: cached JSON2 no-hits is typed no_hits with zero provider fetches", async () => {
  const { db } = createFakeD1([realRow({ result_tsv: JSON2_NO_HITS_FIXTURE_TEXT })]);
  const neverFetch = async () => { throw new Error("cached mode must not fetch"); };
  const result = await handleResults(
    RID, request("?format=json&structured=1&cached=1"), envFor(db), { now: T0, fetchImpl: neverFetch }
  );
  assert.equal(result.status, 200);
  const body = await result.json();
  assert.equal(body.outcome, "no_hits");
  assert.equal(body.status, "no_hits");
  assert.equal(body.state, "no_hits");
  assert.equal(body.tsv, null);
  assert.equal(body.table, null);
  assert.equal(body.cached, true);
  assert.equal(body.provenance.outcome, "no_hits");
  assert.equal(body.provenance.cached, true);
  assert.equal(body.provenance.retrieved_at, null);
  assert.equal(
    body.provenance.warnings.some((warning) => /ThereAreHits=no/.test(warning)),
    true
  );
});

test("FIXTURE: cached=1 serves a cached tabular body verbatim with no fetch", async () => {
  const { db } = createFakeD1([realRow({ result_tsv: TSV_FIXTURE })]);
  const neverFetch = async () => { throw new Error("cached mode must not fetch"); };
  const result = await handleResults(
    RID, request("?format=json&cached=1"), envFor(db), { now: T0, fetchImpl: neverFetch }
  );
  assert.equal(result.status, 200);
  const body = await result.json();
  assert.equal(body.cached, true);
  assert.equal(body.tsv, TSV_FIXTURE);
  assert.equal(body.result, undefined);
  assert.equal(body.provenance.retrieved_at, null);
  assert.equal(body.provenance.result_format, "tabular");
});

test("FIXTURE: default path is unchanged when structured=1 is given without format=json", async () => {
  const { db } = createFakeD1([realRow()]);
  const { impl, calls } = stubProvider();
  const plainJsonRequest = makeGetRequest(
    `/api/blast/results/${RID}?structured=1`, { Accept: "application/json" }
  );
  const result = await handleResults(RID, plainJsonRequest, envFor(db), { now: T0, fetchImpl: impl });
  assert.equal(result.status, 200);
  const body = await result.json();
  assert.equal(body.tsv, TSV_FIXTURE);
  assert.equal(body.result, undefined);
  assert.deepEqual(calls, ["status", "results-tabular"]);
});

test("FIXTURE: structured no-hit JSON2 body is a typed no_hits outcome", async () => {
  const { db } = createFakeD1([realRow()]);
  const { impl } = stubProvider({ json2Body: JSON2_NO_HITS_FIXTURE_TEXT });
  const result = await handleResults(RID, request(), envFor(db), { now: T0, fetchImpl: impl });
  assert.equal(result.status, 200);
  const body = await result.json();
  assert.equal(body.outcome, "no_hits");
  assert.equal(body.tsv, null);
  assert.equal(body.result, undefined);
});
