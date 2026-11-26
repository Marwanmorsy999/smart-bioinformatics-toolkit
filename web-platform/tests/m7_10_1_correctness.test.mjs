// M7.10.1 FIXTURE tests — offline only. Every BLAST JSON2/TSV body and every
// provider response below is hand-written here or in the labelled M7.10 fixture
// file. No live NCBI CMD=Put/new RID, no live 9Router, no secrets, no deploy.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  ALLOWED_DATABASE,
  BLAST_RETRIEVAL_ACTION,
  SQL,
  earliestBlastRetrieval,
  hashInput,
  recordBlastRetrieval
} from "../functions/api/blast/_lib.js";
import { parseBlastJson2, toDerivedTabular } from "../functions/api/blast/json2.js";
import { handleResults } from "../functions/api/blast/results/[rid].js";
import { createAdapter } from "../providers/ninerouter/index.js";
import { OPERATIONS } from "../providers/common/contract.js";
import { onChat } from "../functions/api/assistant/index.js";
import { createFakeD1, makeGetRequest } from "./helpers/fake-d1.mjs";
import { JSON2_FIXTURE_TEXT } from "./fixtures/m7_10_json2_fixture.mjs";

// ---------------------------------------------------------------- helpers

const RID = "M7101RID456";
const T0 = Date.parse("2026-11-20T09:00:00.000Z");
const ISO0 = new Date(T0).toISOString();
const READY = `<html><body><!-- QBlastInfoBegin\nStatus=READY\nQBlastInfoEnd --></body></html>`;
const TSV = [
  "# FIXTURE tabular result",
  "qseqid\tsacc\tstaxids\tsscinames\tpident\tlength\tqstart\tqend\tqlen\tevalue\tbitscore\tqcovs",
  "q1\tNR_074666.1\t1234\tFixture organism\t97.5\t40\t1\t40\t40\t1e-50\t200\t100"
].join("\n") + "\n";

function json2(queryLen, hsps, { queryId = "m7101_fixture_query" } = {}) {
  return JSON.stringify({
    BlastOutput2: {
      report: {
        results: {
          search: {
            query_title: queryId,
            query_len: queryLen,
            hits: [{
              num: 1,
              description: [{ accession: "FIX001", organism: "Fixture organism", taxid: 42, length: 100 }],
              hsps: hsps.map((hsp, index) => ({
                num: index + 1, bit_score: 100 - index, identity: 95, evalue: "1e-20",
                length: 10, qcovs: 25, ...hsp
              }))
            }]
          }
        }
      }
    }
  });
}

function positive(qstart, qend) {
  return { qstart, qend, sstart: 1, send: 20 };
}

function realRow(overrides = {}) {
  return {
    rid: RID, status: "complete", created_at: ISO0, last_checked_at: null,
    input_hash: "c".repeat(64), result_tsv: null, ...overrides
  };
}

function blastEnv(db) {
  return { BLAST_DB: db, NCBI_TOOL: "fixture-tests", NCBI_EMAIL: "fixture@example.invalid" };
}

function blastRequest(query) {
  return makeGetRequest(`/api/blast/results/${RID}${query}`);
}

function blastFetch({ tabular = TSV, json2Body = JSON2_FIXTURE_TEXT } = {}) {
  const calls = [];
  const impl = async (url) => {
    const params = new URL(String(url)).searchParams;
    const format = params.get("FORMAT_TYPE");
    if (format === "JSON2") { calls.push("results-json2"); return new Response(json2Body, { status: 200, headers: { "Content-Type": "application/json" } }); }
    if (format === "Text") { calls.push("results-tabular"); return new Response(tabular, { status: 200, headers: { "Content-Type": "text/plain" } }); }
    calls.push("status");
    return new Response(READY, { status: 200, headers: { "Content-Type": "text/html" } });
  };
  return { impl, calls };
}

const ROUTER_BASE = "https://router.example.invalid/v1";
const ROUTER_KEY = "mock-key-not-a-real-secret"; // fixture, never printed by tests
const MODELS = { data: [{ id: "auto", name: "Auto router" }] };

function routerEnv(fetchImpl, overrides = {}) {
  return {
    ASSETS: { fetch() {} }, BLAST_DB: {},
    NINEROUTER_ENABLED: "true", NINEROUTER_BASE_URL: ROUTER_BASE,
    NINEROUTER_API_KEY: ROUTER_KEY, NINEROUTER_MODEL: "auto",
    NINEROUTER_TIMEOUT: "5", FETCH_IMPL: fetchImpl, ...overrides
  };
}

function chatContext(payload, fetchImpl, init = {}, overrides = {}) {
  return {
    request: new Request("https://worker.example.test/api/assistant/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(init.headers ?? {}) },
      body: JSON.stringify(payload),
      ...(init.signal ? { signal: init.signal } : {})
    }),
    env: routerEnv(fetchImpl, overrides),
    params: {},
    next: () => Promise.resolve()
  };
}

function jsonResponse(body, status = 200, contentType = "application/json") {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": contentType } });
}

function sseResponse(text) {
  return new Response(text, { status: 200, headers: { "Content-Type": "text/event-stream" } });
}

function completion(text, usage) {
  const body = {
    model: "auto",
    choices: [{ index: 0, message: { role: "assistant", content: text }, finish_reason: "stop" }]
  };
  if (usage) body.usage = usage;
  return jsonResponse(body);
}

// ------------------------------------------------------------ TASK A: union

test("FIXTURE A: one HSP uses its single span over full JSON2 query_len", () => {
  const parsed = parseBlastJson2(json2(40, [positive(1, 20)]));
  const hit = parsed.hits[0];
  assert.equal(hit.query_coverage, 50);
  assert.equal(hit.query_coverage_method, "union_of_hsp_query_intervals");
  assert.equal(hit.query_coverage_bases, 20);
  assert.deepEqual(hit.query_coverage_intervals, [{ start: 1, end: 20 }]);
  assert.equal(hit.hsps[0].query_coverage, 50, "per-HSP span is unchanged");
  assert.equal(parsed.query.length, 40);
});

test("FIXTURE A: exact union math — adjacent [1,20]+[21,40]=40 bp, overlapping [1,20]+[11,30]=30 bp", () => {
  const adjacent = parseBlastJson2(json2(40, [positive(1, 20), positive(21, 40)])).hits[0];
  assert.equal(adjacent.query_coverage_bases, 40, "adjacent intervals merge without a gap or double count");
  assert.equal(adjacent.query_coverage, 100);
  assert.deepEqual(adjacent.query_coverage_intervals, [{ start: 1, end: 40 }]);
  assert.equal(adjacent.hsps[0].query_coverage, 50);
  assert.equal(adjacent.hsps[1].query_coverage, 50, "per-HSP coverage stays 50% each");

  const overlapping = parseBlastJson2(json2(40, [positive(1, 20), positive(11, 30)])).hits[0];
  assert.equal(overlapping.query_coverage_bases, 30);
  assert.equal(overlapping.query_coverage, 75);
  assert.deepEqual(overlapping.query_coverage_intervals, [{ start: 1, end: 30 }]);
});

test("FIXTURE A: containment [1,40]+[5,30]=40 bp, not 70 bp", () => {
  const contained = parseBlastJson2(json2(40, [positive(1, 40), positive(5, 30)])).hits[0];
  assert.equal(contained.query_coverage_bases, 40);
  assert.equal(contained.query_coverage, 100);
  assert.deepEqual(contained.query_coverage_intervals, [{ start: 1, end: 40 }]);

  const partial = parseBlastJson2(json2(40, [positive(1, 20), positive(11, 30), positive(35, 40)])).hits[0];
  assert.deepEqual(partial.query_coverage_intervals, [{ start: 1, end: 30 }, { start: 35, end: 40 }]);
  assert.equal(partial.query_coverage_bases, 36);
  assert.equal(partial.query_coverage, 90);
});

test("FIXTURE A: reverse-strand subjects keep their label; query normalization is strand-independent", () => {
  const reversed = {
    qstart: 40, qend: 21, sstart: 100, send: 1,
    qseq: "ACGT".repeat(5), sseq: "TGCA".repeat(5), midline: "|".repeat(20)
  };
  const parsed = parseBlastJson2(json2(40, [reversed]));
  const hit = parsed.hits[0];
  assert.equal(hit.hsps[0].strand, "minus");
  assert.deepEqual(hit.query_coverage_intervals, [{ start: 21, end: 40 }]);
  assert.equal(hit.query_coverage_bases, 20);
  assert.equal(hit.query_coverage, 50);
  assert.equal(hit.hsps[0].query_coverage, 50);
  assert.match(parsed.warnings.join(" "), /reverse strand/);

  const plus = parseBlastJson2(json2(40, [positive(1, 20)])).hits[0].hsps[0];
  assert.equal(plus.strand, "plus");
});

test("FIXTURE A: missing/malformed coordinates and invalid query_len yield null aggregates", () => {
  const malformed = parseBlastJson2(json2(40, [
    { qstart: "abc", qend: 20 }, { qstart: null, qend: 30 }, { qend: 10 }, {}
  ]));
  const hit = malformed.hits[0];
  assert.equal(hit.query_coverage, null);
  assert.equal(hit.query_coverage_bases, null);
  assert.deepEqual(hit.query_coverage_intervals, []);
  assert.equal(hit.hsps.every((hsp) => hsp.query_coverage === null), true);
  assert.match(malformed.warnings.join(" "), /no coordinate-derived query coverage/);

  const partialData = parseBlastJson2(json2(40, [positive(1, 10), { qstart: "bad", qend: 40 }])).hits[0];
  assert.equal(partialData.query_coverage_bases, 10, "valid intervals still count; malformed ones are skipped");
  assert.equal(partialData.query_coverage, 25);

  for (const badLength of [0, "nonsense", null]) {
    const noLength = parseBlastJson2(json2(badLength, [positive(1, 20)]));
    assert.equal(noLength.hits[0].query_coverage, null);
    assert.equal(noLength.hits[0].query_coverage_bases, null);
  }
});

test("FIXTURE A: out-of-range intervals are clamped or skipped with warnings", () => {
  const clamped = parseBlastJson2(json2(10, [positive(0, 5), positive(8, 50)]));
  // [0,5] clamps to [1,5]; [8,50] clamps to [8,10]; the 6-7 gap remains a gap.
  assert.deepEqual(clamped.hits[0].query_coverage_intervals, [{ start: 1, end: 5 }, { start: 8, end: 10 }]);
  assert.equal(clamped.hits[0].query_coverage_bases, 8);
  assert.equal(clamped.hits[0].query_coverage, 80);
  // Per-HSP spans clamp the same way but stay separate from the hit union.
  assert.deepEqual(clamped.hits[0].hsps.map((hsp) => hsp.query_coverage), [50, 30]);
  assert.match(clamped.warnings.join(" "), /clamped to 1-5 for per-HSP coverage/);
  assert.match(clamped.warnings.join(" "), /clamped to 8-10 for per-HSP coverage/);

  const outside = parseBlastJson2(json2(10, [positive(11, 20), positive(0, 0)]));
  assert.equal(outside.hits[0].query_coverage, null);
  assert.equal(outside.hits[0].query_coverage_bases, null);
  assert.deepEqual(outside.hits[0].hsps.map((hsp) => hsp.query_coverage), [null, null]);
  assert.match(outside.warnings.join(" "), /entirely outside the query range/);
  assert.match(outside.warnings.join(" "), /per-HSP coverage is unavailable/);
});

test("FIXTURE A: partial overruns clamp per-HSP spans; wholly out-of-range HSP is null, hit union stays distinct", () => {
  const parsed = parseBlastJson2(json2(40, [
    positive(0, 10),    // clamps to [1,10]  -> 10/40 = 25%
    positive(-5, 20),   // clamps to [1,20]  -> 20/40 = 50%
    positive(41, 60),   // wholly outside   -> null per-HSP coverage
    positive(10, 30)    // in range         -> 21/40 = 52.5%
  ]));
  const hit = parsed.hits[0];
  assert.deepEqual(hit.hsps.map((hsp) => hsp.query_coverage), [25, 50, null, 52.5]);
  // Union of [1,10] U [1,20] U [10,30] = [1,30] = 30 bp / 40 bp = 75%.
  assert.equal(hit.query_coverage_bases, 30);
  assert.equal(hit.query_coverage, 75);
  assert.deepEqual(hit.query_coverage_intervals, [{ start: 1, end: 30 }]);
  const warnings = parsed.warnings.join(" ");
  assert.match(warnings, /clamped to 1-10 for per-HSP coverage/);
  assert.match(warnings, /clamped to 1-20 for per-HSP coverage/);
  assert.match(warnings, /interval 41-60 lies entirely outside the query range 1-40; per-HSP coverage is unavailable/);
});

test("FIXTURE A: derived tabular qcovs is the hit union, not the best HSP span", () => {
  const parsed = parseBlastJson2(json2(40, [positive(1, 20), positive(21, 25)]));
  const row = toDerivedTabular(parsed).trim().split("\n")[2].split("\t");
  assert.equal(row[11], "62.5", "25/40 = 62.5, while each HSP is 50% and 12.5%");
  assert.equal(parsed.hits[0].hsps[0].query_coverage, 50);
  assert.match(toDerivedTabular(parsed), /qcovs, which is the hit-level union of query intervals/);
  const provenanceComment = readFileSync(new URL("../functions/api/blast/json2.js", import.meta.url), "utf8");
  assert.match(provenanceComment, /FULL query_len from the JSON2 search/);
});

// ----------------------------------------------- TASK B: retrieval timestamp

test("FIXTURE B: fresh tabular and JSON2 retrievals record the original timestamp once", async () => {
  for (const [label, query, expectedFormat] of [
    ["tabular", "?format=json", "tabular"],
    ["json2", "?format=json&structured=1", "json2"]
  ]) {
    const { db, state } = createFakeD1([realRow()]);
    const { impl, calls } = blastFetch();
    const response = await handleResults(RID, blastRequest(query), blastEnv(db), { now: T0, fetchImpl: impl });
    assert.equal(response.status, 200, label);
    const body = await response.json();
    assert.equal(body.provenance.retrieved_at, ISO0, label);
    assert.equal(state.auditEvents.length, 1, label);
    const audit = state.auditEvents[0];
    assert.equal(audit.action, BLAST_RETRIEVAL_ACTION);
    assert.equal(audit.target, RID);
    assert.equal(audit.timestamp, ISO0);
    const detail = JSON.parse(audit.detail_json);
    assert.deepEqual(detail, {
      rid: RID, retrieved_at: ISO0, sha256: body.provenance.sha256,
      result_format: expectedFormat, kind: "original_retrieval"
    });
    const noSecrets = JSON.stringify(state.auditEvents);
    assert.equal(noSecrets.includes("Fixture organism"), false, label);
    assert.equal(noSecrets.includes(ALLOWED_DATABASE), false, label);
    assert.equal(calls.includes("status"), true, label);
  }
});

test("FIXTURE B: cached reload returns the exact original timestamp with zero fetch", async () => {
  const { db, state } = createFakeD1([realRow()]);
  const freshFetch = blastFetch();
  await handleResults(RID, blastRequest("?format=json"), blastEnv(db), { now: T0, fetchImpl: freshFetch.impl });
  const cachedFetch = blastFetch();
  const cached = await handleResults(RID, blastRequest("?format=json&cached=1"), blastEnv(db), {
    now: T0 + 86_400_000, fetchImpl: async () => { throw new Error("cached mode must not fetch"); }
  });
  assert.equal(cached.status, 200);
  const body = await cached.json();
  assert.equal(body.cached, true);
  assert.equal(body.provenance.retrieved_at, ISO0, "must be the original, not the reload time");
  assert.match(body.provenance.warnings.join(" "), /append-only retrieval record/);
  assert.deepEqual(cachedFetch.calls, []);
  assert.equal(state.auditEvents.length, 1, "cached reloads never add audit rows");
});

test("FIXTURE B: reopening and repeated cache updates never replace the original time", async () => {
  const { db, state } = createFakeD1([realRow()]);
  const firstBody = TSV;
  await handleResults(RID, blastRequest("?format=json"), blastEnv(db), {
    now: T0, fetchImpl: blastFetch({ tabular: firstBody }).impl
  });
  const changedBody = TSV.replace("Fixture organism", "Later fixture organism");
  await handleResults(RID, blastRequest("?format=json"), blastEnv(db), {
    now: T0 + 3_600_000, fetchImpl: blastFetch({ tabular: changedBody }).impl
  });
  assert.equal(state.auditEvents.length, 1, "a cache update must not append a second retrieval record");
  const cached = await handleResults(RID, blastRequest("?format=json&cached=1"), blastEnv(db), {
    now: T0 + 7_200_000, fetchImpl: async () => { throw new Error("cached mode must not fetch"); }
  });
  const body = await cached.json();
  assert.equal(body.provenance.retrieved_at, ISO0);
  assert.equal(body.tsv, changedBody, "the cached body is the updated one");
  assert.match(body.provenance.warnings.join(" "), /later cache update occurred/);
  assert.equal(await earliestBlastRetrieval(db, RID).then((row) => row.retrieved_at), ISO0);
  assert.equal(BLAST_RETRIEVAL_ACTION.includes("secret"), false);
});

test("FIXTURE B: legacy cached rows without a retrieval record stay explicitly unknown", async () => {
  const { db, state } = createFakeD1([realRow({ result_tsv: TSV })]);
  const cached = await handleResults(RID, blastRequest("?format=json&cached=1"), blastEnv(db), {
    now: T0, fetchImpl: async () => { throw new Error("cached mode must not fetch"); }
  });
  const body = await cached.json();
  assert.equal(body.provenance.retrieved_at, null);
  assert.match(body.provenance.warnings.join(" "), /retrieval time unknown/);
  assert.equal(state.auditEvents.length, 0);

  const json2Legacy = createFakeD1([realRow({ result_tsv: JSON2_FIXTURE_TEXT })]);
  const structured = await handleResults(RID, blastRequest("?format=json&structured=1&cached=1"), blastEnv(json2Legacy.db), {
    now: T0, fetchImpl: async () => { throw new Error("cached mode must not fetch"); }
  });
  const structuredBody = await structured.json();
  assert.equal(structuredBody.provenance.retrieved_at, null);
  assert.equal(structuredBody.result.hits.length, 3, "legacy JSON2 cache still parses normally");
});

test("FIXTURE B: cached JSON2 reload keeps the original time; earliest audit row wins", async () => {
  const { db } = createFakeD1([realRow({ result_tsv: JSON2_FIXTURE_TEXT })]);
  await recordBlastRetrieval(db, { rid: RID, retrievedAt: new Date(T0 + 5000).toISOString(), sha256: "b".repeat(64), resultFormat: "json2" });
  await recordBlastRetrieval(db, { rid: RID, retrievedAt: ISO0, sha256: await hashInput(JSON2_FIXTURE_TEXT), resultFormat: "json2" });
  const other = createFakeD1([realRow()]);
  await recordBlastRetrieval(other.db, { rid: "OTHER_RID", retrievedAt: new Date(T0 + 9999).toISOString(), sha256: "a".repeat(64), resultFormat: "tabular" });

  const cached = await handleResults(RID, blastRequest("?format=json&structured=1&cached=1"), blastEnv(db), {
    now: T0 + 86_400_000, fetchImpl: async () => { throw new Error("cached mode must not fetch"); }
  });
  const body = await cached.json();
  assert.equal(body.provenance.retrieved_at, ISO0, "earliest timestamp wins, even when rows were inserted out of order");
  assert.equal(body.result.hits[0].query_coverage_method, "union_of_hsp_query_intervals");
  assert.match(SQL.selectBlastRetrieval, /ORDER BY timestamp ASC LIMIT 1/);
  assert.doesNotMatch(SQL.selectBlastRetrieval, /created_at/, "no schema migration or invented column");
});

// ------------------------------------- TASK C: stream flag, SSE, timeout UI

test("FIXTURE C: every non-stream body sends explicit stream:false; streaming keeps stream:true", async () => {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url: String(url), body: JSON.parse(init.body ?? "{}") });
    if (String(url).includes("/models")) return jsonResponse(MODELS);
    if (calls.at(-1)?.body?.response_format) return completion('{"steps":[]}');
    return completion("Fixture reply.");
  };
  const adapter = createAdapter(routerEnv(fetchImpl));
  await adapter.chat({ message: "hello" }, { fetch: fetchImpl });
  assert.equal(calls.find((call) => call.url.includes("chat/completions")).body.stream, false);
  calls.length = 0;
  const planned = await adapter.submitJob({
    operation: OPERATIONS.PLAN, message: "return JSON", json_schema: { type: "object" }
  }, { fetch: fetchImpl });
  assert.equal(planned.status, "succeeded", JSON.stringify(planned.error ?? {}));
  const body = calls.find((call) => call.url.includes("chat/completions")).body;
  assert.equal(body.stream, false);
  assert.deepEqual(body.response_format, { type: "json_object" });

  calls.length = 0;
  const sseFetch = async (url, init = {}) => {
    calls.push({ url: String(url), body: JSON.parse(init.body ?? "{}") });
    if (String(url).includes("/models")) return jsonResponse(MODELS);
    return sseResponse("data: [DONE]\n\n");
  };
  const session = await createAdapter(routerEnv(sseFetch)).openChatStream({ message: "stream" }, { fetch: sseFetch });
  for await (const _event of session.events()) { /* drain fixture stream */ }
  session.cleanup();
  assert.equal(calls.find((call) => call.url.includes("chat/completions")).body.stream, true);
});

test("FIXTURE C: an SSE body on a JSON-expecting call is parsed, not fabricated", async () => {
  const sse = [
    `data: ${JSON.stringify({ model: "auto", choices: [{ delta: { content: "Plan " } }] })}`,
    `data: ${JSON.stringify({ choices: [{ delta: { content: "steps." }, finish_reason: "stop" }] })}`,
    `data: ${JSON.stringify({ usage: { prompt_tokens: 7, completion_tokens: 3, total_tokens: 10 } })}`,
    "data: [DONE]"
  ].join("\n\n") + "\n\n";
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    calls.push(JSON.parse(init.body ?? "{}"));
    if (String(url).includes("/models")) return jsonResponse(MODELS);
    return sseResponse(sse);
  };
  const adapter = createAdapter(routerEnv(fetchImpl));
  const out = await adapter.chat({ message: "explain the plan" }, { fetch: fetchImpl });
  assert.equal(out.text, "Plan steps.");
  assert.equal(out.delivery, "sse_fallback");
  assert.equal(out.finish_reason, "stop");
  assert.equal(out.usage.total_tokens, 10, "usage comes from the upstream chunk");
  assert.equal(calls[0].stream, false);

  const api = await onChat(chatContext({ message: "explain the plan", stream: false }, fetchImpl));
  assert.equal(api.status, 200);
  const payload = await api.json();
  assert.equal(payload.generated, true);
  assert.equal(payload.reply, "Plan steps.");
  assert.equal(payload.usage.total_tokens, 10);
});

test("FIXTURE C: timeout is classified provider_timeout; browser fallback copy is visible and non-blocking", async () => {
  const neverResolves = async (url, init = {}) => {
    if (String(url).includes("/models")) return jsonResponse(MODELS);
    // A well-behaved fetch rejects when its abort signal fires. The stub must
    // do the same or the fixture would hang forever.
    return new Promise((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => {
        const error = new Error("fixture deadline");
        error.name = "TimeoutError";
        reject(error);
      }, { once: true });
    });
  };
  const response = await onChat(chatContext({ message: "explain the plan", stream: false }, neverResolves, {}, {
    NINEROUTER_TIMEOUT: "0.01"
  }));
  assert.equal(response.status, 504);
  const body = await response.json();
  assert.equal(body.reason, "provider_timeout");
  assert.match(body.error, /did not respond in time/);

  const js = readFileSync(new URL("../public/js/16s-flow.js", import.meta.url), "utf8");
  assert.match(js, /showPlanExplanationFallback/);
  assert.match(js, /explanation-fallback/);
  assert.match(js, /optional AI explanation timed out/);
  assert.match(js, /review and approve it below/);
  assert.match(js, /No job was created and nothing was sent to NCBI/);
  assert.doesNotMatch(js, /if \(!response\.ok\) return;/, "failures must not silently hide the panel");
  assert.match(js, /state\.fetchedAt = state\.provenance\?\.retrieved_at \?\? \(state\.cached \? null/);
});

test("FIXTURE C: client abort stays request_aborted and stream path is not retried as JSON", async () => {
  const controller = new AbortController();
  controller.abort(new DOMException("Aborted", "AbortError"));
  const response = await onChat(chatContext({ message: "x", stream: false }, async () => {
    throw new Error("aborted request must not fetch");
  }, { signal: controller.signal }));
  assert.equal(response.status, 504);
  assert.equal((await response.json()).reason, "request_aborted");

  const sseFrames = [
    `data: ${JSON.stringify({ choices: [{ delta: { content: "live." } }] })}`,
    "data: [DONE]"
  ].join("\n\n") + "\n\n";
  const streamResponse = await onChat(chatContext({ message: "stream", stream: true }, async (url) => {
    if (String(url).includes("/models")) return jsonResponse(MODELS);
    return sseResponse(sseFrames);
  }, { headers: { Accept: "text/event-stream" } }));
  assert.equal(streamResponse.status, 200);
  assert.match(streamResponse.headers.get("Content-Type"), /text\/event-stream/);
  const raw = await streamResponse.text();
  assert.match(raw, /data: \[DONE\]/);
  assert.match(raw, /event: meta/, "stream meta event is unchanged");
  assert.equal(/"reply":/.test(raw), false, "SSE frames are relayed, not a JSON chat reply");
});
