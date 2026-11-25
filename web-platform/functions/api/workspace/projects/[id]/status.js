// Shared implementation for POST /api/workspace/projects/:id/archive and
// /activate. Only 'active' and 'archived' are valid project statuses.

import {
  SQL,
  envExecutionMode,
  errorResponse,
  isPublicId,
  jsonResponse,
  nowIso,
  runStatement
} from "../../../ai/_lib.js";
import {
  deriveOwner,
  getProject,
  requireDb,
  toProjectDto,
  workspaceAudit
} from "../../_lib.js";

export async function handleSetProjectStatus(request, env, projectId, status, { now = Date.now(), idFactory } = {}) {
  const { owner, error: authError } = await deriveOwner(request, env);
  if (authError) return authError;
  if (!isPublicId(projectId) || !projectId.startsWith("proj_")) {
    return errorResponse("Invalid project id.", 400, request);
  }
  const { db, error: dbError } = requireDb(env, request);
  if (dbError) return dbError;

  try {
    const row = await getProject(db, projectId, owner);
    if (!row) return errorResponse("Project not found.", 404, request);
    const timestamp = nowIso(now);
    await runStatement(db, SQL.setProjectStatus, [status, timestamp, projectId, owner]);
    const action = status === "archived" ? "workspace_project_archived" : "workspace_project_activated";
    await workspaceAudit(db, owner, action, projectId, {
      previous_status: row.status ?? "active"
    }, idFactory, timestamp);
    return jsonResponse({
      project: toProjectDto({ ...row, status, updated_at: timestamp }),
      execution_mode: envExecutionMode(env)
    }, 200, request);
  } catch {
    return errorResponse("Could not update the project status.", 500, request);
  }
}
