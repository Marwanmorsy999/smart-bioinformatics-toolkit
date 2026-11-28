// POST /api/ai/workflows/microbiome/advance — ONE bounded operation per call.
// The cursor lives in the stored run state (state.advance_op); status is
// read-only and the browser calls this endpoint once after each poll.
import { handleAdvance } from "./engine.js";

export async function onRequest(context) {
  return handleAdvance(context.request, context.env, { fetchImpl: context.env?.FETCH_IMPL });
}
