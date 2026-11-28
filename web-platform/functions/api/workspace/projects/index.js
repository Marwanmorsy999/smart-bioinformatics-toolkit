// POST/GET /api/workspace/projects - owner-scoped project creation and listing.

import {
  SQL,
  envExecutionMode,
  errorResponse,
  insertRow,
  jsonResponse,
  listRows,
  makeId,
  nowIso,
  readJsonBody
} from "../../ai/_lib.js";
import {
  deriveOwner,
  requireAnyMethod,
  requireDb,
  validateProjectCreate,
  workspaceAudit,
  toProjectDto
} from "../_lib.js";

export async function onRequest(context) {
  const rejected = requireAnyMethod(context.request, ["GET", "POST"]);
  if (rejected) return rejected;
  if (context.request.method === "GET") return handleListProjects(context.request, context.env);
  return handleCreateProject(context.request, context.env, context);
}

export async function handleCreateProject(request, env, { now = Date.now(), idFactory } = {}) {
  const { owner, error: authError } = await deriveOwner(request, env);
  if (authError) return authError;
  const { payload, error: bodyError } = await readJsonBody(request);
  if (bodyError) return bodyError;
  const checked = validateProjectCreate(payload);
  if (checked.error) return errorResponse(checked.error, 400, request);
  const { db, error: dbError } = requireDb(env, request);
  if (dbError) return dbError;

  const createdAt = nowIso(now);
  const projectId = makeId("proj", idFactory);
  try {
    await insertRow(db, SQL.insertWorkspaceProject, [
      projectId,
      checked.value.name,
      owner,
      JSON.stringify({}),
      createdAt,
      checked.value.description,
      checked.value.scientific_objective,
      checked.value.status,
      createdAt
    ]);
    await workspaceAudit(db, owner, "workspace_project_created", projectId, {
      status: checked.value.status,
      has_objective: Boolean(checked.value.scientific_objective)
    }, idFactory, createdAt);
  } catch {
    return errorResponse("Could not create the project.", 500, request);
  }

  const project = toProjectDto({
    public_id: projectId,
    name: checked.value.name,
    description: checked.value.description,
    scientific_objective: checked.value.scientific_objective,
    status: checked.value.status,
    owner,
    created_at: createdAt,
    updated_at: createdAt
  });
  return jsonResponse({ project, execution_mode: envExecutionMode(env) }, 201, request);
}

export async function handleListProjects(request, env) {
  const { owner, error: authError } = await deriveOwner(request, env);
  if (authError) return authError;
  const { db, error: dbError } = requireDb(env, request);
  if (dbError) return dbError;

  try {
    const [projects, datasets, runs] = await Promise.all([
      listRows(db, SQL.listProjectsByOwner, [owner]),
      listRows(db, SQL.listDatasetsByOwner, [owner]),
      listRows(db, SQL.listRunsByOwner, [owner])
    ]);
    const datasetCounts = new Map();
    const runCounts = new Map();
    for (const row of datasets) datasetCounts.set(row.project_id, (datasetCounts.get(row.project_id) ?? 0) + 1);
    for (const row of runs) runCounts.set(row.project_id, (runCounts.get(row.project_id) ?? 0) + 1);
    projects.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
    return jsonResponse({
      projects: projects.map((row) => toProjectDto(row, {
        dataset_count: datasetCounts.get(row.public_id) ?? 0,
        run_count: runCounts.get(row.public_id) ?? 0
      })),
      count: projects.length,
      execution_mode: envExecutionMode(env)
    }, 200, request);
  } catch {
    return errorResponse("Could not list projects.", 500, request);
  }
}
