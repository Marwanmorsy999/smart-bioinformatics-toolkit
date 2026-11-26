// GET /api/blast/results/:rid - return tabular results only after the search
// is genuinely complete on a canonical CMD=Get body. A formatting-request
// READY, a SearchInfo-only page or contradictory status evidence never unlocks
// retrieval; only canonical complete does.
// LIMITATION: provenance cannot be persisted in D1 without a new column; M7.6
// adds no migration, so provenance is returned in the response (JSON with
// ?format=json, or X-Blast-* headers on the plain-text response).

import {
  ALLOWED_DATABASE,
  BLAST_API_URL,
  buildResultsParams,
  buildStatusParams,
  cacheResults,
  DATABASE_LABEL,
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
  textResponse
} from "../_lib.js";

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

  const mockEnv = isMock(env);
  const mockRid = safeRid.toUpperCase().startsWith(MOCK_RID_PREFIX);
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
  const provenance = baseProvenance(safeRid, retrievedAt, false, {
    outcome: "hits",
    sha256: await hashInput(raw),
    ...countRows(tsv),
    warnings
  });
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
