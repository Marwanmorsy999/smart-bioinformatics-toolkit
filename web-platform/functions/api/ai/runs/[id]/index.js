// GET /api/ai/runs/:id - plan, jobs, artifacts, validation, explanation, report URL.

import {
  SQL,
  errorResponse,
  getDb,
  getRow,
  jsonResponse,
  listRows,
  parseJson,
  requireMethod,
  toArtifactDto,
  toJobDto
} from "../../_lib.js";

export async function onRequest(context) {
  const { request, env, params } = context;
  const rejected = requireMethod(request, "GET", "GET, OPTIONS");
  if (rejected) return rejected;
  return handleGetRun(request, env, params?.id);
}

export async function handleGetRun(request, env, runId) {
  const db = getDb(env);
  if (!db) return errorResponse("AI database binding is unavailable.", 503, request);
  if (typeof runId !== "string" || !runId.startsWith("job_")) {
    return errorResponse("Invalid run id.", 400, request);
  }

  try {
    const jobRow = await getRow(db, SQL.getJob, [runId]);
    if (!jobRow) return errorResponse("Run not found.", 404, request);
    const planRow = await getRow(db, SQL.getPlan, [jobRow.plan_id]);
    const jobRows = await listRows(db, SQL.listJobsForPlan, [jobRow.plan_id]);
    const artifactRows = await listRows(db, SQL.listArtifactsForRun, [runId]);
    const reportMeta = parseJson(jobRow.report_json);
    const mode = jobRow.execution_mode ?? "real";

    return jsonResponse({
      run_id: runId,
      plan: planRow ? parseJson(planRow.plan_json) : null,
      jobs: jobRows.map(toJobDto),
      artifacts: artifactRows.map(toArtifactDto),
      validation: parseJson(jobRow.validation_json),
      explanation: parseJson(jobRow.explanation_json),
      report_url: reportMeta?.report_url ?? `/api/ai/runs/${runId}/report`,
      provenance_url: reportMeta?.provenance_url ?? `/api/ai/runs/${runId}/provenance`,
      execution_mode: mode
    }, 200, request);
  } catch {
    return errorResponse("Could not read the run.", 500, request);
  }
}
