// GET/PATCH /api/workspace/projects/:id - open or edit one owned project.

import {
  SQL,
  envExecutionMode,
  errorResponse,
  isPublicId,
  jsonResponse,
  listRows,
  makeId,
  nowIso,
  readJsonBody,
  runStatement
} from "../../../ai/_lib.js";
import {
  deriveOwner,
  getProject,
  requireAnyMethod,
  requireDb,
  toProjectDto,
  validateProjectPatch,
  workspaceAudit
} from "../../_lib.js";

export async function onRequest(context) {
  const rejected = requireAnyMethod(context.request, ["GET", "PATCH"]);
  if (rejected) return rejected;
  if (context.request.method === "GET") return handleGetProject(context.request, context.env, context.params?.id);
  return handlePatchProject(context.request, context.env, context.params?.id, context);
}

async function validateId(projectId, request) {
  if (!isPublicId(projectId) || !projectId.startsWith("proj_")) {
    return errorResponse("Invalid project id.", 400, request);
  }
  return null;
}

export async function handleGetProject(request, env, projectId) {
  const { owner, error: authError } = await deriveOwner(request, env);
  if (authError) return authError;
  const badId = await validateId(projectId, request);
  if (badId) return badId;
  const { db, error: dbError } = requireDb(env, request);
  if (dbError) return dbError;
  try {
    const row = await getProject(db, projectId, owner);
    if (!row) return errorResponse("Project not found.", 404, request);
    const [datasets, runs] = await Promise.all([
      listRows(db, SQL.listDatasetsForProject, [projectId, owner]),
      listRows(db, SQL.listRunsForProject, [projectId, owner])
    ]);
    return jsonResponse({
      project: toProjectDto(row, { dataset_count: datasets.length, run_count: runs.length }),
      execution_mode: envExecutionMode(env)
    }, 200, request);
  } catch {
    return errorResponse("Could not read the project.", 500, request);
  }
}

export async function handlePatchProject(request, env, projectId, { now = Date.now(), idFactory } = {}) {
  const { owner, error: authError } = await deriveOwner(request, env);
  if (authError) return authError;
  const badId = await validateId(projectId, request);
  if (badId) return badId;
  const { payload, error: bodyError } = await readJsonBody(request);
  if (bodyError) return bodyError;
  const checked = validateProjectPatch(payload);
  if (checked.error) return errorResponse(checked.error, 400, request);
  const { db, error: dbError } = requireDb(env, request);
  if (dbError) return dbError;

  try {
    const row = await getProject(db, projectId, owner);
    if (!row) return errorResponse("Project not found.", 404, request);
    const patch = checked.value;
    const values = [
      Object.hasOwn(patch, "name") ? patch.name : row.name,
      Object.hasOwn(patch, "description") ? patch.description : (row.description ?? null),
      Object.hasOwn(patch, "scientific_objective") ? patch.scientific_objective : (row.scientific_objective ?? null),
      Object.hasOwn(patch, "status") ? patch.status : (row.status ?? "active"),
      nowIso(now),
      projectId,
      owner
    ];
    await runStatement(db, SQL.updateProjectMetadata, values);
    await workspaceAudit(db, owner, "workspace_project_updated", projectId, {
      fields: Object.keys(patch)
    }, idFactory, nowIso(now));
    // Mutation DTOs must be consistent with GET/list: compute the same counts
    // instead of returning the toProjectDto defaults of zero.
    const [datasets, runs] = await Promise.all([
      listRows(db, SQL.listDatasetsForProject, [projectId, owner]),
      listRows(db, SQL.listRunsForProject, [projectId, owner])
    ]);
    return jsonResponse({
      project: toProjectDto({
        ...row,
        name: values[0],
        description: values[1],
        scientific_objective: values[2],
        status: values[3],
        updated_at: values[4]
      }, { dataset_count: datasets.length, run_count: runs.length }),
      execution_mode: envExecutionMode(env)
    }, 200, request);
  } catch {
    return errorResponse("Could not update the project.", 500, request);
  }
}
