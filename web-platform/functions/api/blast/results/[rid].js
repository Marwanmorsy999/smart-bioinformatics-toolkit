// GET /api/blast/results/:rid - return cached tabular results once the job is complete.

import {
  BLAST_API_URL,
  buildResultsParams,
  cacheResults,
  errorResponse,
  extractTabular,
  getRequest,
  isMock,
  isValidRid,
  MOCK_TSV,
  ncbiFetchText,
  preflightResponse,
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

export async function onRequest(context) {
  const { request, env } = context;
  if (request.method === "OPTIONS") return preflightResponse(request);
  if (request.method !== "GET") {
    return errorResponse("Method not allowed. Use GET.", 405, request, { Allow: "GET, OPTIONS" });
  }
  const rid = context.params?.rid ?? ridFromUrl(request.url, "results");
  return handleResults(rid, request, env);
}

export async function handleResults(rid, request, env) {
  const safeRid = typeof rid === "string" ? rid.trim() : "";
  if (!isValidRid(safeRid)) return errorResponse("Invalid request ID.", 400, request);

  const db = env && env.BLAST_DB;
  if (!db) return errorResponse("BLAST database binding is unavailable.", 503, request);

  const row = await getRequest(db, safeRid);
  if (!row) return errorResponse(`Unknown request ID: ${safeRid}.`, 404, request);
  if (row.status !== "complete") {
    return errorResponse(`Results are not ready. Current status: ${row.status}.`, 409, request);
  }

  let tsv = row.result_tsv;
  if (!tsv) {
    if (isMock(env)) {
      tsv = MOCK_TSV;
    } else {
      try {
        const url = `${BLAST_API_URL}?${buildResultsParams(safeRid, env).toString()}`;
        tsv = extractTabular(await ncbiFetchText(url));
      } catch {
        return errorResponse("Could not fetch results from NCBI.", 502, request);
      }
    }
    await cacheResults(db, safeRid, tsv);
  }

  return textResponse(tsv, 200, request);
}