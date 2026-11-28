// GET /api/workspace/workflows - versioned static catalog. Auth is required
// for a uniform authorization surface (documented in M7_4_WORKSPACE_DESIGN.md).

import { envExecutionMode, jsonResponse } from "../ai/_lib.js";
import { CATALOG_VERSION, listWorkflows } from "./catalog.js";
import { deriveOwner, requireAnyMethod, requireDb } from "./_lib.js";

export async function onRequest(context) {
  const rejected = requireAnyMethod(context.request, ["GET"]);
  if (rejected) return rejected;
  return handleListWorkflows(context.request, context.env);
}

export async function handleListWorkflows(request, env) {
  const { error: authError } = await deriveOwner(request, env);
  if (authError) return authError;
  const { error: dbError } = requireDb(env, request);
  if (dbError) return dbError;
  const workflows = listWorkflows();
  return jsonResponse({
    catalog_version: CATALOG_VERSION,
    workflows,
    count: workflows.length,
    execution_mode: envExecutionMode(env)
  }, 200, request);
}
