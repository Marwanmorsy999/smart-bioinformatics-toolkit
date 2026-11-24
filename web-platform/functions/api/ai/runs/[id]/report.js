// GET /api/ai/runs/:id/report - stored, self-contained HTML report.

import { SQL, errorResponse, getDb, getRow, htmlResponse, requireMethod } from "../../_lib.js";

export async function onRequest(context) {
  const { request, env, params } = context;
  const rejected = requireMethod(request, "GET", "GET, OPTIONS");
  if (rejected) return rejected;
  return handleGetReport(request, env, params?.id);
}

export async function handleGetReport(request, env, runId) {
  const db = getDb(env);
  if (!db) return errorResponse("AI database binding is unavailable.", 503, request);
  if (typeof runId !== "string" || !runId.startsWith("job_")) {
    return errorResponse("Invalid run id.", 400, request);
  }
  try {
    const row = await getRow(db, SQL.getReportRun, [runId]);
    if (!row || !row.report_html) return errorResponse("Report not available yet.", 404, request);
    return htmlResponse(row.report_html, 200, request);
  } catch {
    return errorResponse("Could not read the report.", 500, request);
  }
}
