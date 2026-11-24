// GET /api/ai/runs/:id/provenance - stored step provenance record.

import { SQL, errorResponse, getDb, getRow, jsonResponse, parseJson, requireMethod } from "../../_lib.js";

export async function onRequest(context) {
  const { request, env, params } = context;
  const rejected = requireMethod(request, "GET", "GET, OPTIONS");
  if (rejected) return rejected;
  return handleGetProvenance(request, env, params?.id);
}

export async function handleGetProvenance(request, env, runId) {
  const db = getDb(env);
  if (!db) return errorResponse("AI database binding is unavailable.", 503, request);
  if (typeof runId !== "string" || !runId.startsWith("job_")) {
    return errorResponse("Invalid run id.", 400, request);
  }
  try {
    const row = await getRow(db, SQL.getJob, [runId]);
    if (!row) return errorResponse("Run not found.", 404, request);
    const provenance = parseJson(row.provenance_json);
    if (!provenance) return errorResponse("Provenance not available yet.", 404, request);
    return jsonResponse({ ...provenance, execution_mode: row.execution_mode ?? "real" }, 200, request);
  } catch {
    return errorResponse("Could not read provenance.", 500, request);
  }
}
