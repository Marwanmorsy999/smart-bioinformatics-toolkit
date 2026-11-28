// GET/POST /api/workspace/projects/:id/datasets - metadata-only dataset
// registration. NO file bytes are accepted and no public URL is stored.

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
  toDatasetDto,
  validateDatasetCreate,
  workspaceAudit
} from "../../_lib.js";

export async function onRequest(context) {
  const rejected = requireAnyMethod(context.request, ["GET", "POST"]);
  if (rejected) return rejected;
  if (context.request.method === "GET") return handleListDatasets(context.request, context.env, context.params?.id);
  return handleCreateDataset(context.request, context.env, context.params?.id, context);
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
  if (!project) return { error: errorResponse("Project not found.", 404, request), owner, db };
  return { owner, db, project };
}

export async function handleListDatasets(request, env, projectId) {
  const contextResult = await ownedProject(request, env, projectId);
  if (contextResult.error) return contextResult.error;
  const { db, owner } = contextResult;
  try {
    const rows = await listRows(db, SQL.listDatasetsForProject, [projectId, owner]);
    rows.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
    return jsonResponse({
      datasets: rows.map(toDatasetDto),
      count: rows.length,
      execution_mode: envExecutionMode(env)
    }, 200, request);
  } catch {
    return errorResponse("Could not list datasets.", 500, request);
  }
}

export async function handleCreateDataset(request, env, projectId, { now = Date.now(), idFactory } = {}) {
  const contextResult = await ownedProject(request, env, projectId);
  if (contextResult.error) return contextResult.error;
  const { db, owner } = contextResult;
  const { payload, error: bodyError } = await readJsonBody(request);
  if (bodyError) return bodyError;
  const checked = validateDatasetCreate(payload);
  if (checked.error) return errorResponse(checked.error, 400, request);

  const createdAt = nowIso(now);
  const datasetId = makeId("ds", idFactory);
  const value = checked.value;
  // Explicit metadata-only markers. These are labels, not resolvable file
  // locations, and they do not assert that bytes exist anywhere.
  const storageRef = value.provider_history_ref
    ? "metadata-only://provider-history"
    : "metadata-only://none";
  try {
    await insertRow(db, SQL.insertWorkspaceDataset, [
      datasetId,
      projectId,
      value.filename,
      value.sha256,
      value.size_bytes,
      value.mime ?? "application/octet-stream",
      storageRef,
      null, // fasta_text: legacy path only; workspace registration stores no bytes
      createdAt,
      value.file_format,
      value.source,
      value.validation_state,
      value.provider_history_ref,
      createdAt,
      owner,
      0
    ]);
    await workspaceAudit(db, owner, "workspace_dataset_registered", datasetId, {
      project_id: projectId,
      has_provider_history_ref: Boolean(value.provider_history_ref),
      bytes_uploaded: false
    }, idFactory, createdAt);
  } catch {
    return errorResponse("Could not register the dataset.", 500, request);
  }

  return jsonResponse({
    dataset: toDatasetDto({
      public_id: datasetId,
      project_id: projectId,
      filename: value.filename,
      sha256: value.sha256,
      size_bytes: value.size_bytes,
      mime: value.mime ?? "application/octet-stream",
      storage_ref: storageRef,
      fasta_text: null,
      created_at: createdAt,
      file_format: value.file_format,
      source: value.source,
      validation_state: value.validation_state,
      provider_history_ref: value.provider_history_ref,
      uploaded_at: createdAt,
      owner,
      is_demo: 0
    }),
    bytes_uploaded: false,
    storage_policy: "metadata-only",
    execution_mode: envExecutionMode(env)
  }, 201, request);
}
