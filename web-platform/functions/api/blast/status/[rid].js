// GET /api/blast/status/:rid - poll a submitted RID at most once per minute.

import {
  BLAST_API_URL,
  buildStatusParams,
  errorResponse,
  getRequest,
  isMock,
  isValidRid,
  jsonResponse,
  ncbiFetchText,
  parseStatusResponse,
  POLL_INTERVAL_MS,
  preflightResponse,
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

export async function onRequest(context) {
  const { request, env } = context;
  if (request.method === "OPTIONS") return preflightResponse(request);
  if (request.method !== "GET") {
    return errorResponse("Method not allowed. Use GET.", 405, request, { Allow: "GET, OPTIONS" });
  }
  const rid = context.params?.rid ?? ridFromUrl(request.url, "status");
  return handleStatus(rid, request, env);
}

export async function handleStatus(rid, request, env, { now = Date.now() } = {}) {
  const safeRid = typeof rid === "string" ? rid.trim() : "";
  if (!isValidRid(safeRid)) return errorResponse("Invalid request ID.", 400, request);

  const db = env && env.BLAST_DB;
  if (!db) return errorResponse("BLAST database binding is unavailable.", 503, request);

  const row = await getRequest(db, safeRid);
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

  let status;
  if (isMock(env)) {
    status = "complete";
  } else {
    try {
      const url = `${BLAST_API_URL}?${buildStatusParams(safeRid, env).toString()}`;
      status = parseStatusResponse(await ncbiFetchText(url));
    } catch {
      return errorResponse("Could not check the search status with NCBI.", 502, request);
    }
  }

  await updateStatus(db, safeRid, status, new Date(now).toISOString());
  return jsonResponse({ status }, 200, request);
}