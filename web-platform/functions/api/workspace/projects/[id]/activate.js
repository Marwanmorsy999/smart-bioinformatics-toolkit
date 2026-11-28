// POST /api/workspace/projects/:id/activate - restore an archived project.
// Companion to /archive; both are owner-checked and audited.

import { requireAnyMethod } from "../../_lib.js";
import { handleSetProjectStatus } from "./status.js";

export async function onRequest(context) {
  const rejected = requireAnyMethod(context.request, ["POST"]);
  if (rejected) return rejected;
  return handleActivateProject(context.request, context.env, context.params?.id, context);
}

export function handleActivateProject(request, env, projectId, options) {
  return handleSetProjectStatus(request, env, projectId, "active", options);
}
