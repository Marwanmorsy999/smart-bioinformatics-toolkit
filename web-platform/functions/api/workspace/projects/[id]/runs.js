// GET/POST /api/workspace/projects/:id/runs - unified run history and creation
// of a draft record. POST never starts an execution.

import {
  SQL,
  envExecutionMode,
  errorResponse,
  insertRow,
  isPublicId,
  jsonResponse,
  listRows,
  makeId,
  nowIso,
  readJsonBody
} from "../../../ai/_lib.js";
import {
  deriveOwner,
  getProject,
  requireAnyMethod,
  requireDb,
  toRunSummary,
  validateRunCreate,
  workspaceAudit
} from "../../_lib.js";

export async function onRequest(context) {
  const rejected = requireAnyMethod(context.request, ["GET", "POST"]);
  if (rejected) return rejected;
  if (context.request.method === "GET") return handleListRuns(context.request, context.env, context.params?.id);
  return handleCreateRun(context.request, context.env, context.params?.id, context);
}

async function ownedProject(request, env, projectId) {
  if (!isPublicId(projectId) || !projectId.startsWith("proj_")) {
    return { error: errorResponse("Invalid project id.", 400, request) };
  }
  const { owner, error: authError } = await deriveOwner(request, env);
  if (authError) return { error: authError };
  const { db, error: dbError } = requireDb(env, request);
  if (dbError) return { error: dbError };
  const project = await getProject(db, projectId, owner);
  if (!project) return { error: errorResponse("Project not found.", 404, request) };
  return { owner, db, project };
}

export async function handleListRuns(request, env, projectId) {
  const contextResult = await ownedProject(request, env, projectId);
  if (contextResult.error) return contextResult.error;
  const { db, owner } = contextResult;
  try {
    const rows = await listRows(db, SQL.listRunsForProject, [projectId, owner]);
    rows.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
    return jsonResponse({
      runs: rows.map(toRunSummary),
      count: rows.length,
      execution_mode: envExecutionMode(env)
    }, 200, request);
  } catch {
    return errorResponse("Could not list runs.", 500, request);
  }
}

export async function handleCreateRun(request, env, projectId, { now = Date.now(), idFactory } = {}) {
  const contextResult = await ownedProject(request, env, projectId);
  if (contextResult.error) return contextResult.error;
  const { db, owner } = contextResult;
  const { payload, error: bodyError } = await readJsonBody(request);
  if (bodyError) return bodyError;

  let datasetIds;
  try {
    const datasetRows = await listRows(db, SQL.listDatasetsForProject, [projectId, owner]);
    datasetIds = datasetRows.map((row) => row.public_id);
  } catch {
    return errorResponse("Could not validate project datasets.", 500, request);
  }
  const checked = validateRunCreate(payload, datasetIds, env);
  if (checked.error) return errorResponse(checked.error, 400, request);

  const createdAt = nowIso(now);
  const runId = makeId("run", idFactory);
  const value = checked.value;
  try {
    await insertRow(db, SQL.insertWorkspaceRun, [
      runId,
      projectId,
      value.workflow.id,
      value.workflow.version,
      value.objective,
      JSON.stringify(value.dataset_ids),
      JSON.stringify(value.params),
      value.execution_provider,
      value.execution_mode,
      "draft",
      createdAt,
      null,
      null,
      null,
      null,
      null,
      null,
      owner,
      0
    ]);
    await workspaceAudit(db, owner, "workspace_run_created", runId, {
      project_id: projectId,
      workflow_id: value.workflow.id,
      dataset_ids: value.dataset_ids,
      state: "draft",
      executed: false
    }, idFactory, createdAt);
  } catch {
    return errorResponse("Could not create the run record.", 500, request);
  }

  return jsonResponse({
    run: toRunSummary({
      public_id: runId,
      project_id: projectId,
      workflow_id: value.workflow.id,
      workflow_version: value.workflow.version,
      objective: value.objective,
      state: "draft",
      created_at: createdAt,
      completed_at: null,
      input_datasets_json: JSON.stringify(value.dataset_ids),
      params_json: JSON.stringify(value.params),
      execution_provider: value.execution_provider,
      execution_mode: value.execution_mode,
      validation_json: null,
      is_demo: 0
    }),
    executed: false,
    execution_mode: envExecutionMode(env)
  }, 201, request);
}
