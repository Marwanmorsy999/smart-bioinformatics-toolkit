// GET /api/ai/workflows/microbiome/result?run_id=... — stored result only.
import { handleResult } from "./engine.js";
export async function onRequest(context) {
  return handleResult(context.request, context.env);
}
