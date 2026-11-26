// GET /api/blast/status/:rid - poll a submitted RID at most once per minute.
// Real responses are parsed strictly from canonical CMD=Get QBlastInfo blocks.
// LIMITATION: blast_requests has no column for structured evidence and M7.6
// adds no migration, so safe evidence is returned in this JSON response only
// (the existing status column stores just the typed state).

import {
  BLAST_API_URL,
  buildStatusParams,
  errorResponse,
  fetchUpstream,
  getRequest,
  isMock,
  isValidRid,
  jsonResponse,
  parseQBlastStatus,
  POLL_INTERVAL_MS,
  preflightResponse,
  QBLAST_TERMINAL_STATES,
  updateStatus
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

const CACHED_MESSAGES = {
  complete: "NCBI previously reported this search as complete.",
  failed: "NCBI previously reported a failed search. No results were retrieved or fabricated.",
  error: "The previous status check could not establish the search state. No results were retrieved.",
  unavailable: "NCBI was unavailable on the previous check. The search state is unknown; no results were retrieved."
};

function typedStatusResponse(rid, status, request, extra = {}) {
  return jsonResponse({
    status,
    state: status,
    reason: extra.reason ?? null,
    message: extra.message ?? CACHED_MESSAGES[status] ?? "No results were retrieved.",
    terminal: QBLAST_TERMINAL_STATES.has(status),
    evidence: extra.evidence ?? { rid, from_cache: true },
    mock: false
  }, 200, request);
}

export async function onRequest(context) {
  const { request, env } = context;
  if (request.method === "OPTIONS") return preflightResponse(request);
  if (request.method !== "GET") {
    return errorResponse("Method not allowed. Use GET.", 405, request, { Allow: "GET, OPTIONS" });
  }
  const rid = context.params?.rid ?? ridFromUrl(request.url, "status");
  return handleStatus(rid, request, env);
}

export async function handleStatus(rid, request, env, { now = Date.now(), fetchImpl } = {}) {
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

  const lastChecked = row.last_checked_at ? Date.parse(row.last_checked_at) : NaN;
  if (Number.isFinite(lastChecked)) {
    const elapsed = now - lastChecked;
    if (elapsed < POLL_INTERVAL_MS) {
      const retryAfter = Math.max(1, Math.ceil((POLL_INTERVAL_MS - elapsed) / 1000));
      return errorResponse("Status checked too recently. Wait one minute before polling again.", 429, request, {
        "Retry-After": String(retryAfter)
      });
    }
  }

  // Mock RIDs never contact NCBI and keep the original minimal response shape.
  if (isMock(env)) {
    try {
      await updateStatus(db, safeRid, "complete", new Date(now).toISOString());
    } catch {
      return errorResponse("Could not update the BLAST request.", 500, request);
    }
    return jsonResponse({ status: "complete" }, 200, request);
  }

  // Terminal jobs are never polled again: no egress, no extra provider load.
  // The gate timestamp still advances so a client cannot spam status reads.
  if (QBLAST_TERMINAL_STATES.has(row.status)) {
    try {
      await updateStatus(db, safeRid, row.status, new Date(now).toISOString());
    } catch {
      return errorResponse("Could not update the BLAST request.", 500, request);
    }
    return typedStatusResponse(safeRid, row.status, request);
  }

  const url = `${BLAST_API_URL}?${buildStatusParams(safeRid, env).toString()}`;
  const response = await fetchUpstream(url, { fetchImpl });
  const parsed = parseQBlastStatus(response.body, {
    rid: safeRid,
    httpStatus: response.httpStatus,
    at: now,
    errorCode: response.errorCode
  });

  try {
    await updateStatus(db, safeRid, parsed.state, new Date(now).toISOString());
  } catch {
    return errorResponse("Could not update the BLAST request.", 500, request);
  }
  return typedStatusResponse(safeRid, parsed.state, request, parsed);
}
