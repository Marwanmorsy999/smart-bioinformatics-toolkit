// GET /api/blast/results/:rid - return tabular results only after the search
// is genuinely complete on a canonical CMD=Get body. A formatting-request
// READY, a SearchInfo-only page or contradictory status evidence never unlocks
// retrieval; only canonical complete does.
// LIMITATION: blast_requests has no retrieval-timestamp column; M7.6 added no
// migration, so provenance is returned in the response (JSON with ?format=json,
// or X-Blast-* headers on the plain-text response). The ORIGINAL retrieval time
// is persisted without a migration in the existing append-only audit_events
// table, keyed by RID, and reused verbatim on ?cached=1 reloads.

import {
  ALLOWED_DATABASE,
  BLAST_API_URL,
  buildResultsParams,
  buildStatusParams,
  cacheResults,
  DATABASE_LABEL,
  earliestBlastRetrieval,
  errorResponse,
  extractTabular,
  fetchUpstream,
  getRequest,
  hashInput,
  isMock,
  isValidRid,
  jsonResponse,
  MOCK_RID_PREFIX,
  MOCK_TSV,
  parseQBlastStatus,
  preflightResponse,
  QBLAST_PARSER_SCHEMA,
  recordBlastRetrieval,
  textResponse
} from "../_lib.js";
import { isJson2Report, parseBlastJson2, toDerivedTabular } from "../json2.js";

function ridFromUrl(url, segment) {
  try {
    const parts = new URL(url).pathname.split("/").filter(Boolean);
    const index = parts.indexOf(segment);
    return index >= 0 ? decodeURIComponent(parts[index + 1] || "") : null;
  } catch {
    return null;
  }
}

function wantsJson(request) {
  const format = new URL(request.url).searchParams.get("format");
  return format === "json" || /application\/json/i.test(request.headers.get("Accept") ?? "");
}

// Opt-in modes. `structured=1` is only honoured together with format=json, so
// the default text/plain and JSON tabular responses stay byte-for-byte intact.
function requestOptions(request) {
  try {
    const params = new URL(request.url).searchParams;
    return {
      structured: params.get("structured") === "1" && params.get("format") === "json",
      cached: params.get("cached") === "1"
    };
  } catch {
    return { structured: false, cached: false };
  }
}

function looksLikeJson2(raw) {
  const body = String(raw ?? "").trim();
  return body.startsWith("{") && !/QBlastInfoBegin|<!doctype|<html/i.test(body);
}

// Persist the ORIGINAL retrieval time once, in the existing audit_events table.
// A later fresh retrieval (cache update) never replaces it: the earliest
// record for the RID wins, and any body change is reported as a warning.
async function rememberBlastRetrieval(db, rid, retrievedAt, sha256, resultFormat, warnings) {
  let original = null;
  try { original = await earliestBlastRetrieval(db, rid); } catch { original = null; }
  if (original?.retrieved_at) {
    warnings.push("A later cache update occurred for this RID; the original retrieval time from the first retrieval is preserved.");
    if (original.sha256 && sha256 && original.sha256 !== sha256) {
      warnings.push("The cached result body differs from the hash recorded at original retrieval.");
    }
    return original.retrieved_at;
  }
  try {
    await recordBlastRetrieval(db, { rid, retrievedAt, sha256, resultFormat });
  } catch {
    warnings.push("The original retrieval time could not be recorded; a cached reload will report it as unknown.");
  }
  return retrievedAt;
}

// Cached reload: NO NCBI fetch at all. blast_requests has no retrieval
// timestamp column, so the ORIGINAL time is read from the append-only
// audit_events retrieval record (no migration). Legacy rows with no record
// stay honestly unknown: retrieved_at is null, never the current time.
async function cachedResultResponse(request, rid, raw, { structured = false, mock = false, db = null } = {}) {
  const rawText = String(raw ?? "");
  const synthetic = mock === true || /MOCK DATA|MOCK000001/.test(rawText);
  const sha256 = await hashInput(rawText);
  let retrieval = null;
  if (db && !synthetic) {
    try { retrieval = await earliestBlastRetrieval(db, rid); } catch { retrieval = null; }
  }
  const cachedWarning = retrieval?.retrieved_at
    ? "Cached result served from D1 without a fresh NCBI fetch; the original retrieval time comes from the append-only retrieval record."
    : "Cached result served from D1 without a fresh NCBI fetch; retrieval time unknown (no original retrieval record).";
  const updateWarning = retrieval?.sha256 && retrieval.sha256 !== sha256
    ? "The cached result body differs from the hash recorded at original retrieval; a later cache update occurred. The original retrieval time is preserved."
    : null;

  if (looksLikeJson2(rawText)) {
    const result = parseBlastJson2(rawText);
    if (isJson2Report(result)) {
      const tsv = toDerivedTabular(result);
      // A cached JSON2 report can be a genuine no-hits result: never label it
      // as hits just because rows were served from D1.
      const noHits = result.no_hits === true && !result.hits.length;
      const outcome = noHits ? "no_hits" : "hits";
      const provenance = baseProvenance(rid, retrieval?.retrieved_at ?? null, synthetic, {
        outcome,
        cached: true,
        result_format: "json2",
        derived_from: "json2",
        sha256,
        ...countRows(tsv),
        warnings: [
          ...result.warnings,
          cachedWarning,
          ...(updateWarning ? [updateWarning] : []),
          ...(noHits ? ["NCBI reported ThereAreHits=no. No result rows were retrieved and none were synthesised."] : [])
        ]
      });
      if (wantsJson(request)) {
        const body = {
          status: noHits ? "no_hits" : "complete",
          state: noHits ? "no_hits" : "complete",
          outcome, terminal: true,
          tsv: noHits ? null : tsv,
          table: null, mock: synthetic, cached: true, provenance,
          message: synthetic
            ? "Cached SYNTHETIC result. Not a real NCBI result."
            : (noHits
              ? "Cached no-hits result served from D1; no new NCBI request was made."
              : "Cached structured result served from D1; no new NCBI request was made.")
        };
        if (structured) body.result = result;
        return jsonResponse(body, 200, request);
      }
      return textResponse(noHits ? "" : tsv, 200, request, provenanceHeaders(provenance));
    }
  }

  const provenance = baseProvenance(rid, retrieval?.retrieved_at ?? null, synthetic, {
    outcome: synthetic ? "mock" : "hits",
    cached: true,
    result_format: "tabular",
    sha256,
    ...countRows(rawText),
    warnings: [cachedWarning, ...(updateWarning ? [updateWarning] : [])]
  });
  if (wantsJson(request)) {
    return jsonResponse({
      status: "complete", state: "complete", outcome: synthetic ? "mock" : "hits", terminal: true,
      tsv: rawText, table: null, mock: synthetic, cached: true, provenance,
      message: synthetic
        ? "Cached SYNTHETIC result. Not a real NCBI result."
        : "Cached tabular result served from D1; no new NCBI request was made."
    }, 200, request);
  }
  return textResponse(rawText, 200, request, provenanceHeaders(provenance));
}

// Structured JSON2 retrieval. Called only AFTER the same canonical status gate
// used by the tabular path, so no-hit/failure states behave identically.
async function structuredHitsResponse(request, rid, env, { now, fetchImpl, parsed, db }) {
  const resultsUrl = `${BLAST_API_URL}?${buildResultsParams(rid, env, { format: "json2" }).toString()}`;
  const upstream = await fetchUpstream(resultsUrl, { fetchImpl });
  if (!upstream.ok) {
    return rejectedResponse(request,
      `NCBI did not return a usable JSON2 report (HTTP ${upstream.httpStatus ?? "unknown"}). No result was fabricated.`,
      parsed.evidence);
  }

  const raw = upstream.body;
  const contentType = String(upstream.contentType ?? "").toLowerCase();
  if (!raw.trim()
    || /text\/html|application\/xml/i.test(contentType)
    || /<!doctype|<html|QBlastInfoBegin|\bError:\s*No alias/i.test(raw)) {
    return rejectedResponse(request,
      "NCBI returned an HTML, error or empty body instead of a JSON2 report. No result was fabricated.",
      parsed.evidence);
  }

  const result = parseBlastJson2(raw);
  if (!isJson2Report(result)) {
    return rejectedResponse(request,
      "NCBI returned a body with no usable JSON2 search object. No result was fabricated.",
      parsed.evidence);
  }
  const retrievedAt = new Date(now).toISOString();
  if (result.no_hits && !result.hits.length) {
    return noHitsResponse(request, rid, parsed, retrievedAt, {
      cachedProof: { sha256: await hashInput(raw), warnings: result.warnings }
    });
  }

  const tsv = toDerivedTabular(result);
  const sha256 = await hashInput(raw);
  const provenance = baseProvenance(rid, retrievedAt, false, {
    outcome: "hits",
    result_format: "json2",
    derived_from: "json2",
    sha256,
    ...countRows(tsv),
    warnings: [...result.warnings]
  });
  provenance.retrieved_at = await rememberBlastRetrieval(db, rid, retrievedAt, sha256, "json2", provenance.warnings);
  if (provenance.rows_rejected > 0) {
    provenance.warnings.push(`${provenance.rows_rejected} derived line(s) were rejected.`);
  }

  try {
    // Store the RAW JSON2 body: a later ?cached=1 reload must serve exactly
    // what the provider returned, not a lossy derived summary.
    await cacheResults(db, rid, raw);
  } catch {
    return errorResponse("Could not cache the BLAST results.", 500, request);
  }

  return jsonResponse({
    status: "complete", state: "complete", outcome: "hits", terminal: true,
    result, tsv, table: null, mock: false, cached: false,
    message: "Real structured JSON2 BLAST report retrieved from NCBI. Independent interpretation is required.",
    evidence: parsed.evidence,
    provenance
  }, 200, request);
}

function provenanceHeaders(provenance) {
  return {
    "X-Blast-Rid": provenance.rid ?? "",
    "X-Blast-Sha256": provenance.sha256 ?? "",
    "X-Blast-Parser-Schema": provenance.parser_schema ?? "",
    "X-Blast-Database": provenance.database ?? "",
    "X-Blast-Program": provenance.program ?? "",
    "X-Blast-Retrieved-At": provenance.retrieved_at ?? "",
    "X-Blast-Rows-Received": String(provenance.rows_received ?? 0),
    "X-Blast-Rows-Parsed": String(provenance.rows_parsed ?? 0),
    "X-Blast-Rows-Rejected": String(provenance.rows_rejected ?? 0),
    "X-Blast-Mock": String(provenance.mock)
  };
}

function countRows(tsv) {
  const lines = String(tsv || "").replace(/\r\n?/g, "\n").split("\n").filter((line) => line.trim());
  const tabular = lines.filter((line) => !line.startsWith("#") && line.includes("\t"));
  // Tabular schemas start their header with qseqid; NCBI comments carry the
  // field list and are not data rows.
  const headerIndex = tabular.findIndex((line) => /^\s*qseqid\b/i.test(line));
  const data = headerIndex >= 0 ? tabular.filter((_, index) => index !== headerIndex) : tabular;
  const parsed = data.filter((line) => line.split("\t").length >= 2).length;
  return { rows_received: lines.length, rows_parsed: parsed, rows_rejected: data.length - parsed };
}

function baseProvenance(rid, retrievedAt, mock, extra = {}) {
  return {
    rid,
    database: ALLOWED_DATABASE,
    database_label: DATABASE_LABEL,
    program: "blastn",
    retrieved_at: retrievedAt,
    mock,
    parser_schema: QBLAST_PARSER_SCHEMA,
    rows_received: 0,
    rows_parsed: 0,
    rows_rejected: 0,
    warnings: [],
    ...extra
  };
}

function noHitsResponse(request, rid, parsed, retrievedAt, { cachedProof = null } = {}) {
  const provenance = baseProvenance(rid, retrievedAt, false, {
    outcome: "no_hits",
    there_are_hits: "no",
    sha256: cachedProof?.sha256 ?? null,
    warnings: [
      ...(cachedProof?.warnings ?? []),
      "NCBI reported ThereAreHits=no. No tabular rows were retrieved and none were synthesised."
    ]
  });
  return jsonResponse({
    status: "no_hits",
    state: "no_hits",
    terminal: true,
    outcome: "no_hits",
    table: null,
    tsv: null,
    message: "NCBI completed the search with no hits. There is no result table to display and none was fabricated.",
    evidence: parsed?.evidence ?? null,
    mock: false,
    provenance
  }, 200, request);
}

function providerFailureResponse(request, parsed) {
  return jsonResponse({
    status: parsed.state,
    state: parsed.state,
    reason: parsed.reason,
    terminal: parsed.terminal,
    outcome: "provider_failure",
    table: null,
    message: parsed.message,
    evidence: parsed.evidence,
    mock: false
  }, 409, request);
}

function rejectedResponse(request, message, evidence = null) {
  return jsonResponse({
    status: "unavailable",
    state: "unavailable",
    reason: "invalid_provider_payload",
    terminal: true,
    outcome: "unavailable",
    table: null,
    message,
    evidence,
    mock: false
  }, 502, request);
}

export async function onRequest(context) {
  const { request, env } = context;
  if (request.method === "OPTIONS") return preflightResponse(request);
  if (request.method !== "GET") {
    return errorResponse("Method not allowed. Use GET.", 405, request, { Allow: "GET, OPTIONS" });
  }
  const rid = context.params?.rid ?? ridFromUrl(request.url, "results");
  return handleResults(rid, request, env);
}

export async function handleResults(rid, request, env, { now = Date.now(), fetchImpl } = {}) {
  const safeRid = typeof rid === "string" ? rid.trim() : "";
  if (!isValidRid(safeRid)) return errorResponse("Invalid request ID.", 400, request);

  const db = env && env.BLAST_DB;
  if (!db) return errorResponse("BLAST database binding is unavailable.", 503, request);

  let row;
  try {
    row = await getRequest(db, safeRid);
  } catch {
    return errorResponse("BLAST database is unavailable.", 503, request);
  }
  if (!row) return errorResponse(`Unknown request ID: ${safeRid}.`, 404, request);
  if (row.status !== "complete") {
    return errorResponse(`Results are not ready. Current status: ${row.status}.`, 409, request);
  }

  const options = requestOptions(request);
  const mockEnv = isMock(env);
  const mockRid = safeRid.toUpperCase().startsWith(MOCK_RID_PREFIX);

  // ?cached=1 is an explicit offline reload: serve the cached body with no
  // status preflight and no results fetch. Provenance says so honestly.
  if (options.cached && row.result_tsv) {
    return cachedResultResponse(request, safeRid, row.result_tsv, {
      structured: options.structured,
      mock: mockEnv || mockRid,
      db
    });
  }

  if (mockEnv || mockRid) {
    // MOCK_TSV is strictly gated by server-side env: a mock RID in real mode
    // never turns synthetic rows into an apparently real result.
    if (!mockEnv) {
      return errorResponse("This RID is a mock RID. Synthetic results require MOCK_NCBI on the server.", 409, request);
    }
    const tsv = row.result_tsv || MOCK_TSV;
    if (!row.result_tsv) {
      try {
        await cacheResults(db, safeRid, tsv);
      } catch {
        return errorResponse("Could not cache the BLAST results.", 500, request);
      }
    }
    const retrievedAt = new Date(now).toISOString();
    const provenance = baseProvenance(safeRid, retrievedAt, true, {
      outcome: "mock",
      sha256: await hashInput(tsv),
      ...countRows(tsv),
      warnings: ["SYNTHETIC MOCK DATA - not from NCBI and not usable for biological conclusions."]
    });
    if (wantsJson(request)) {
      return jsonResponse({
        status: "complete", state: "complete", outcome: "mock", terminal: true,
        tsv, table: null, mock: true,
        message: "Synthetic mock data. This is not a real NCBI result.",
        provenance
      }, 200, request);
    }
    return textResponse(tsv, 200, request, provenanceHeaders(provenance));
  }

  // Re-verify the provider immediately before retrieval on a CANONICAL CMD=Get
  // body (no FORMAT_OBJECT). Only canonical complete unlocks; contradictory
  // status evidence is typed status_conflict (409); ThereAreHits=no is no_hits.
  const statusUrl = `${BLAST_API_URL}?${buildStatusParams(safeRid, env).toString()}`;
  const statusFetch = await fetchUpstream(statusUrl, { fetchImpl });
  const parsed = parseQBlastStatus(statusFetch.body, {
    rid: safeRid,
    httpStatus: statusFetch.httpStatus,
    at: now,
    errorCode: statusFetch.errorCode,
    mode: "canonical"
  });
  if (parsed.state === "status_conflict") {
    return jsonResponse({
      status: "status_conflict",
      state: "status_conflict",
      code: "status_conflict",
      reason: parsed.reason ?? "status_conflict",
      terminal: true,
      outcome: "status_conflict",
      table: null,
      message: parsed.message,
      evidence: parsed.evidence,
      mock: false
    }, 409, request);
  }
  if (parsed.state !== "complete") return providerFailureResponse(request, parsed);
  if (parsed.evidence.there_are_hits === "no" || parsed.evidence.no_hits === true) {
    return noHitsResponse(request, safeRid, parsed, new Date(now).toISOString());
  }

  if (options.structured) {
    return structuredHitsResponse(request, safeRid, env, { now, fetchImpl, parsed, db });
  }

  const resultsUrl = `${BLAST_API_URL}?${buildResultsParams(safeRid, env).toString()}`;
  const upstream = await fetchUpstream(resultsUrl, { fetchImpl });
  if (!upstream.ok) {
    return rejectedResponse(request,
      `NCBI did not return a usable report (HTTP ${upstream.httpStatus ?? "unknown"}). No result table was fabricated.`,
      parsed.evidence);
  }

  const raw = upstream.body;
  const contentType = String(upstream.contentType ?? "").toLowerCase();
  if (!raw.trim()
    || /text\/html|application\/json|application\/xml/i.test(contentType)
    || /<!doctype|<html|QBlastInfoBegin|\bError:\s*No alias/i.test(raw)) {
    return rejectedResponse(request,
      "NCBI returned an HTML, error or empty body instead of a tabular report. No result table was fabricated.",
      parsed.evidence);
  }

  const tsv = extractTabular(raw);
  if (!tsv.trim()) {
    if (/ThereAreHits=no|No hits found/i.test(raw)) {
      return noHitsResponse(request, safeRid, parsed, new Date(now).toISOString());
    }
    return rejectedResponse(request,
      "NCBI returned no tabular lines. No result table was fabricated.", parsed.evidence);
  }

  const retrievedAt = new Date(now).toISOString();
  const warnings = [];
  if (/\t/.test(raw.replace(/\r\n?/g, "\n").split("\n").filter((line) => line.includes("<")).join(""))) {
    warnings.push("The provider report contained markup; only tabular lines were retained.");
  }
  const sha256 = await hashInput(raw);
  const provenance = baseProvenance(safeRid, retrievedAt, false, {
    outcome: "hits",
    sha256,
    ...countRows(tsv),
    warnings
  });
  provenance.retrieved_at = await rememberBlastRetrieval(db, safeRid, retrievedAt, sha256, "tabular", warnings);
  if (provenance.rows_rejected > 0) {
    provenance.warnings.push(`${provenance.rows_rejected} non-tabular line(s) were rejected.`);
  }

  try {
    await cacheResults(db, safeRid, tsv);
  } catch {
    return errorResponse("Could not cache the BLAST results.", 500, request);
  }

  if (wantsJson(request)) {
    return jsonResponse({
      status: "complete", state: "complete", outcome: "hits", terminal: true,
      tsv, table: null, mock: false,
      message: "Real tabular BLAST report retrieved from NCBI. Independent interpretation is required.",
      evidence: parsed.evidence,
      provenance
    }, 200, request);
  }
  return textResponse(tsv, 200, request, provenanceHeaders(provenance));
}
