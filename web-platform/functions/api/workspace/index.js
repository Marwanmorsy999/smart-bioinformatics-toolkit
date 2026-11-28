// M7.4 compatibility shim for the catch-all /api/workspace/** route.
//
// The authoritative handlers are the specific batch-1 routes registered in
// worker.js (projects/, runs/, workflows.js, demo.js). This module only exists
// so a runtime that dispatches the catch-all first sees the SAME authoritative
// catalog and demo payload instead of a competing implementation.
//
// DEPRECATED SURFACES: /api/workspace/catalog is an alias of
// /api/workspace/workflows; /api/workspace/demo delegates to demo.js. The
// specific Worker routes win in normal operation. Every other path here is a
// JSON 404 — the table names used by the old competing handler exist in no
// migration, so this shim performs no SQL and derives no owner itself.
//
// Security headers come from jsonResponse/errorResponse via the shared ai/_lib
// helpers (and the delegated handlers); the raw operator token is never stored
// or echoed.

import { envExecutionMode, errorResponse, jsonResponse } from "../ai/_lib.js";
import { CATALOG_VERSION, listWorkflows } from "./catalog.js";
import { handleDemo } from "./demo.js";
import { deriveOwner, requireAnyMethod, requireDb } from "./_lib.js";

export async function onRequest(context) {
  const { request, env } = context;
  let path;
  try {
    path = new URL(request.url).pathname.replace(/\/+$/, "");
  } catch {
    return errorResponse("Invalid request URL.", 400, request);
  }

  if (path === "/api/workspace/catalog") {
    const rejected = requireAnyMethod(request, ["GET"]);
    if (rejected) return rejected;
    // Uniform authorization surface: catalog requires the existing operator
    // token, exactly like /api/workspace/workflows.
    const { error: authError } = await deriveOwner(request, env);
    if (authError) return authError;
    const { error: dbError } = requireDb(env, request);
    if (dbError) return dbError;
    const workflows = listWorkflows();
    // Same DTO shape as workflows.js handleListWorkflows.
    return jsonResponse({
      catalog_version: CATALOG_VERSION,
      workflows,
      count: workflows.length,
      execution_mode: envExecutionMode(env)
    }, 200, request);
  }

  if (path === "/api/workspace/demo") {
    // Authoritative precomputed payload, including its labels and disclaimer.
    return handleDemo(request, env);
  }

  return errorResponse("Workspace route not found.", 404, request);
}
