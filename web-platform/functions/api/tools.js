// GET /api/tools - registered tools with JSON Schemas and availability flags.

import { envExecutionMode, jsonResponse, requireMethod } from "./ai/_lib.js";
import { TOOLS } from "./ai/registry.js";

export async function onRequest(context) {
  const { request, env } = context;
  const rejected = requireMethod(request, "GET", "GET, OPTIONS");
  if (rejected) return rejected;
  return jsonResponse({ tools: TOOLS, execution_mode: envExecutionMode(env) }, 200, request);
}
