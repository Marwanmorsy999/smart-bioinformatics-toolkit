// POST /api/ai/requests - validate the FASTA, infer intent and persist a plan.

import {
  SQL,
  audit,
  envExecutionMode,
  errorResponse,
  getDb,
  hashInput,
  insertRow,
  jsonResponse,
  makeId,
  nowIso,
  readJsonBody,
  requireMethod,
  sanitizeFilename,
  safeString,
  validatePlan,
  validateRequestPayload
} from "../_lib.js";
import { planRequest } from "../planner.js";

export async function onRequest(context) {
  const { request, env } = context;
  const rejected = requireMethod(request, "POST", "POST, OPTIONS");
  if (rejected) return rejected;
  return handleCreateRequest(request, env, context);
}

export async function handleCreateRequest(request, env, { now = Date.now(), idFactory } = {}) {
  const { payload, error } = await readJsonBody(request);
  if (error) return errorResponse(error, 400, request);

  const checked = validateRequestPayload(payload);
  if (!checked.valid) return errorResponse(checked.error, 400, request);

  const db = getDb(env);
  if (!db) return errorResponse("AI database binding is unavailable.", 503, request);

  const createdAt = nowIso(now);
  const requestId = makeId("req", idFactory);
  const datasetId = makeId("ds", idFactory);
  const filename = sanitizeFilename(payload.filename);
  const projectId = safeString(payload.project_id, 100) || null;

  const built = planRequest({
    text: payload.text,
    fasta: payload.fasta,
    datasetId,
    requestId,
    now,
    idFactory
  });
  if (built.clarifyingQuestion) {
    return jsonResponse({
      error: "Intent is unclear.",
      clarifying_question: built.clarifyingQuestion,
      execution_mode: envExecutionMode(env)
    }, 422, request);
  }
  const planCheck = validatePlan(built.plan);
  if (!planCheck.valid) return errorResponse(`Generated an invalid plan: ${planCheck.error}`, 500, request);

  const inputHash = await hashInput(payload.fasta);
  const sizeBytes = new TextEncoder().encode(payload.fasta).length;
  try {
    await insertRow(db, SQL.insertDataset, [
      datasetId,
      projectId,
      filename,
      inputHash,
      sizeBytes,
      "text/plain",
      `d1://datasets/${datasetId}`,
      payload.fasta,
      createdAt
    ]);
    await insertRow(db, SQL.insertRequest, [
      requestId,
      projectId,
      datasetId,
      payload.text.slice(0, 4000),
      built.plan.intent,
      built.plan.confidence,
      createdAt
    ]);
    await insertRow(db, SQL.insertPlan, [
      built.plan.plan_id,
      requestId,
      1,
      JSON.stringify(built.plan),
      createdAt
    ]);
    await audit(db, {
      actor: "browser",
      action: "ai_request_created",
      target: requestId,
      detail: { dataset_id: datasetId, intent: built.plan.intent, confidence: built.plan.confidence },
      timestamp: createdAt,
      idFactory
    });
  } catch {
    return errorResponse("Could not store the AI request.", 500, request);
  }

  return jsonResponse({
    request_id: requestId,
    plan_id: built.plan.plan_id,
    plan: built.plan,
    dataset_id: datasetId,
    preflight: built.preflight,
    execution_mode: envExecutionMode(env)
  }, 200, request);
}
