// POST /api/workspace/projects/:id/archive - mark an owned project archived.

import { requireAnyMethod } from "../../_lib.js";
import { handleSetProjectStatus } from "./status.js";

export async function onRequest(context) {
  const rejected = requireAnyMethod(context.request, ["POST"]);
  if (rejected) return rejected;
  return handleArchiveProject(context.request, context.env, context.params?.id, context);
}

export function handleArchiveProject(request, env, projectId, options) {
  return handleSetProjectStatus(request, env, projectId, "archived", options);
}
