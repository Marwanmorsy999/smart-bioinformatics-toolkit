// GET /api/blast/history - recent submissions, never including query sequences.

import { errorResponse, HISTORY_LIMIT, isMock, jsonResponse, listRecent, preflightResponse } from "./_lib.js";

export async function onRequest(context) {
  const { request, env } = context;
  if (request.method === "OPTIONS") return preflightResponse(request);
  if (request.method !== "GET") {
    return errorResponse("Method not allowed. Use GET.", 405, request, { Allow: "GET, OPTIONS" });
  }
  return handleHistory(request, env);
}

export async function handleHistory(request, env, { limit = HISTORY_LIMIT } = {}) {
  const db = env && env.BLAST_DB;
  if (!db) return errorResponse("BLAST database binding is unavailable.", 503, request);
  const parsedLimit = Number(limit);
  const safeLimit = Number.isFinite(parsedLimit) ? Math.min(Math.max(parsedLimit, 1), HISTORY_LIMIT) : HISTORY_LIMIT;
  let rows;
  try {
    rows = await listRecent(db, safeLimit);
  } catch {
    return errorResponse("BLAST database is unavailable.", 503, request);
  }
  return jsonResponse({ submissions: rows, count: rows.length, mock: isMock(env) }, 200, request);
}
