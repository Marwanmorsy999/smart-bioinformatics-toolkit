// POST /api/ai/workflows/microbiome/run — create the single, refresh-safe run.
import { handleRun } from "./engine.js";
export async function onRequest(context) {
  return handleRun(context.request, context.env, { fetchImpl: context.env?.FETCH_IMPL });
}
