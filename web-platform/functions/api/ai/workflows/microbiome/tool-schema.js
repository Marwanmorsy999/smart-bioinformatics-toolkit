// GET /api/ai/workflows/microbiome/tool-schema?tool_id=...&version=...
// Read-only structural summary of a LIVE tool schema. No job is submitted.
import { handleToolSchema } from "./engine.js";

export async function onRequest(context) {
  return handleToolSchema(context.request, context.env, { fetchImpl: context.env?.FETCH_IMPL });
}
