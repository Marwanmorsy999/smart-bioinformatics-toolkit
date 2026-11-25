// GET /api/ai/workflows/phylo/status?plan_id=... — job progress for the website.
import { SQL, errorResponse, getDb, jsonResponse, listRows, requireMethod, safeString } from "../../_lib.js";

export async function onRequest(context) {
  const rejected = requireMethod(context.request, "GET", "GET, OPTIONS");
  if (rejected) return rejected;
  const db = getDb(context.env);
  if (!db) return errorResponse("AI database binding is unavailable.", 503, context.request);
  const planId = safeString(new URL(context.request.url).searchParams.get("plan_id"), 100);
  if (!planId) return errorResponse("plan_id is required.", 400, context.request);
  try {
    const jobs = await listRows(db, SQL.listJobsForPlan, [planId]);
    return jsonResponse({ plan_id: planId, jobs: jobs.map((j) => ({
      job_id: j.public_id, step_id: j.step_id, status: j.status,
      tool_id: j.tool_id, started_at: j.started_at, finished_at: j.finished_at
    })) }, 200, context.request);
  } catch (e) {
    return errorResponse(`Could not read job status: ${e?.message ?? e}`, 500, context.request);
  }
}
