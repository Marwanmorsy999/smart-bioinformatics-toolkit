// GET /api/workspace/runs/:id/report - owner-checked report access.
// Reuses the existing report_runs table. Authorization is via the parent
// workspace run (public_id + owner); missing reports return 404, never a
// generated or fabricated document, and no public URL is produced.

import {
  SQL,
  envExecutionMode,
  errorResponse,
  getRow,
  isPublicId,
  jsonResponse
} from "../../../ai/_lib.js";
import { deriveOwner, getRun, requireAnyMethod, requireDb } from "../../_lib.js";

export async function onRequest(context) {
  const rejected = requireAnyMethod(context.request, ["GET"]);
  if (rejected) return rejected;
  return handleGetWorkspaceReport(context.request, context.env, context.params?.id);
}

export async function handleGetWorkspaceReport(request, env, runId) {
  const { owner, error: authError } = await deriveOwner(request, env);
  if (authError) return authError;
  if (!isPublicId(runId) || !runId.startsWith("run_")) {
    return errorResponse("Invalid run id.", 400, request);
  }
  const { db, error: dbError } = requireDb(env, request);
  if (dbError) return dbError;
  try {
    const run = await getRun(db, runId, owner);
    if (!run) return errorResponse("Run not found.", 404, request);
    const report = await getRow(db, SQL.getReportRun, [runId]);
    if (!report) return errorResponse("Report is not available for this run.", 404, request);
    return jsonResponse({
      run_id: runId,
      project_id: run.project_id,
      report_html: report.report_html ?? "",
      report_ref: report.report_ref ?? null,
      explanation_ref: report.explanation_ref ?? null,
      validation_ref: report.validation_ref ?? null,
      created_at: report.created_at ?? null,
      execution_mode: envExecutionMode(env)
    }, 200, request);
  } catch {
    return errorResponse("Could not read the report.", 500, request);
  }
}
