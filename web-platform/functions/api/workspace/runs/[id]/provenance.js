// GET /api/workspace/runs/:id/provenance - final provenance record.
// A succeeded run must have a complete record; the incomplete case fails
// closed instead of returning a partial or fabricated record.

import {
  envExecutionMode,
  errorResponse,
  getRow,
  isPublicId,
  jsonResponse,
  parseJson,
  SQL
} from "../../../ai/_lib.js";
import {
  deriveOwner,
  getRun,
  requireAnyMethod,
  requireDb,
  validateProvenanceRecord
} from "../../_lib.js";

export async function onRequest(context) {
  const rejected = requireAnyMethod(context.request, ["GET"]);
  if (rejected) return rejected;
  return handleGetWorkspaceProvenance(context.request, context.env, context.params?.id);
}

export async function handleGetWorkspaceProvenance(request, env, runId) {
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
    const stored = await getRow(db, SQL.getProvenanceRecord, [runId, owner]);
    const record = stored ? parseJson(stored.record_json) : parseJson(run.provenance_json);
    if (!record) return errorResponse("Provenance is not available yet.", 404, request);
    const completeness = validateProvenanceRecord(record, run);
    if (run.state === "succeeded" && !completeness.valid) {
      return errorResponse(`Succeeded run has incomplete provenance: ${completeness.error}`, 409, request);
    }
    return jsonResponse({
      run_id: runId,
      state: run.state,
      workflow_id: run.workflow_id,
      workflow_version: run.workflow_version,
      provenance: record,
      complete: completeness.valid,
      execution_mode: envExecutionMode(env)
    }, 200, request);
  } catch {
    return errorResponse("Could not read provenance.", 500, request);
  }
}
