// GET /api/ai/plans/:id - retrieve the immutable plan.

import { SQL, errorResponse, getDb, getRow, jsonResponse, parseJson, requireMethod } from "../../_lib.js";

export async function onRequest(context) {
  const { request, env, params } = context;
  const rejected = requireMethod(request, "GET", "GET, OPTIONS");
  if (rejected) return rejected;
  return handleGetPlan(request, env, params?.id);
}

export async function handleGetPlan(request, env, planId) {
  const db = getDb(env);
  if (!db) return errorResponse("AI database binding is unavailable.", 503, request);
  if (typeof planId !== "string" || !planId.startsWith("plan_")) {
    return errorResponse("Invalid plan id.", 400, request);
  }
  try {
    const row = await getRow(db, SQL.getPlan, [planId]);
    if (!row) return errorResponse("Plan not found.", 404, request);
    return jsonResponse(parseJson(row.plan_json), 200, request);
  } catch {
    return errorResponse("Could not read the plan.", 500, request);
  }
}
