// GET /api/ai/workflows/microbiome/status?run_id=... — one bounded stage poll.
import { handleStatus } from "./engine.js";
export async function onRequest(context) {
  return handleStatus(context.request, context.env, { fetchImpl: context.env?.FETCH_IMPL });
}
