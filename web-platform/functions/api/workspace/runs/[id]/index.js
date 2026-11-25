// GET/PATCH /api/workspace/runs/:id - full detail and strict lifecycle updates.
// PATCH is operator bookkeeping only; it never starts or polls an execution.

import {
  SQL,
  envExecutionMode,
  errorResponse,
  getRow,
  insertRow,
  isPublicId,
  jsonResponse,
  makeId,
  nowIso,
  parseJson,
  readJsonBody,
  runStatement,
  safeString
} from "../../../ai/_lib.js";
import {
  deriveOwner,
  getRun,
  isTerminalState,
  isValidTransition,
  requireAnyMethod,
  requireDb,
  toRunDetail,
  validateBookkeeping,
  validateProvenanceRecord,
  workspaceAudit,
  WORKSPACE_STATES
} from "../../_lib.js";

export async function onRequest(context) {
  const rejected = requireAnyMethod(context.request, ["GET", "PATCH"]);
  if (rejected) return rejected;
  if (context.request.method === "GET") return handleGetRun(context.request, context.env, context.params?.id);
  return handlePatchRun(context.request, context.env, context.params?.id, context);
}

function invalidRunId(request, runId) {
  return !isPublicId(runId) || !runId.startsWith("run_")
    ? errorResponse("Invalid run id.", 400, request)
    : null;
}

async function finalProvenance(db, row, owner) {
  const stored = await getRow(db, SQL.getProvenanceRecord, [row.public_id, owner]);
  if (stored) return parseJson(stored.record_json);
  return parseJson(row.provenance_json);
}

export async function handleGetRun(request, env, runId) {
  const { owner, error: authError } = await deriveOwner(request, env);
  if (authError) return authError;
  const badId = invalidRunId(request, runId);
  if (badId) return badId;
  const { db, error: dbError } = requireDb(env, request);
  if (dbError) return dbError;
  try {
    const row = await getRun(db, runId, owner);
    if (!row) return errorResponse("Run not found.", 404, request);
    const report = await getRow(db, SQL.getReportRun, [runId]);
    const provenance = await finalProvenance(db, row, owner);
    return jsonResponse({
      run: toRunDetail(row, { reportAvailable: Boolean(report), provenance }),
      execution_mode: envExecutionMode(env)
    }, 200, request);
  } catch {
    return errorResponse("Could not read the run.", 500, request);
  }
}

export async function handlePatchRun(request, env, runId, { now = Date.now(), idFactory } = {}) {
  const { owner, error: authError } = await deriveOwner(request, env);
  if (authError) return authError;
  const badId = invalidRunId(request, runId);
  if (badId) return badId;
  const { payload, error: bodyError } = await readJsonBody(request);
  if (bodyError) return bodyError;
  const { db, error: dbError } = requireDb(env, request);
  if (dbError) return dbError;

  const nextState = safeString(payload.state, 40);
  if (!WORKSPACE_STATES.includes(nextState)) return errorResponse("Invalid or missing state.", 400, request);
  const checked = validateBookkeeping(payload);
  if (checked.error) return errorResponse(checked.error, 400, request);

  try {
    const row = await getRun(db, runId, owner);
    if (!row) return errorResponse("Run not found.", 404, request);
    if (!isValidTransition(row.state, nextState)) {
      return errorResponse(`Illegal transition from ${row.state} to ${nextState}.`, 409, request);
    }

    // Honesty gate: a run cannot be marked succeeded without a complete record.
    let provenanceForRecord = null;
    if (nextState === "succeeded") {
      provenanceForRecord = payload.provenance ?? parseJson(row.provenance_json);
      const completeness = validateProvenanceRecord(provenanceForRecord, row);
      if (!completeness.valid) return errorResponse(`Incomplete provenance: ${completeness.error}`, 409, request);
    }

    const book = checked.value;
    const values = [
      nextState,
      isTerminalState(nextState) ? nowIso(now) : (row.completed_at ?? null),
      Object.hasOwn(book, "steps") ? book.steps : (row.steps_json ?? null),
      Object.hasOwn(book, "artifact_refs") ? book.artifact_refs : (row.artifact_refs_json ?? null),
      Object.hasOwn(book, "validation") ? book.validation : (row.validation_json ?? null),
      Object.hasOwn(book, "provenance") ? book.provenance : (row.provenance_json ?? null),
      Object.hasOwn(book, "error") ? book.error : (row.error_json ?? null),
      runId,
      owner
    ];
    await runStatement(db, SQL.updateWorkspaceRun, values);

    if (nextState === "succeeded") {
      const existing = await getRow(db, SQL.getProvenanceRecord, [runId, owner]);
      if (!existing) {
        await insertRow(db, SQL.insertProvenanceRecord, [
          makeId("prov", idFactory),
          runId,
          JSON.stringify(provenanceForRecord),
          nowIso(now),
          owner
        ]);
      }
    }
    await workspaceAudit(db, owner, "workspace_run_transition", runId, {
      from: row.state,
      to: nextState,
      fields: Object.keys(book)
    }, idFactory, nowIso(now));

    const updated = await getRun(db, runId, owner);
    const report = await getRow(db, SQL.getReportRun, [runId]);
    const provenance = await finalProvenance(db, updated, owner);
    return jsonResponse({
      run: toRunDetail(updated, { reportAvailable: Boolean(report), provenance }),
      execution_mode: envExecutionMode(env)
    }, 200, request);
  } catch {
    return errorResponse("Could not update the run.", 500, request);
  }
}
