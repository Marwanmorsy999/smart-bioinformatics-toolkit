// POST /api/ai/workflows/microbiome/continue-stages — single-use continuation
// after a pre-job failure that followed real succeeded stages. It only rewrites
// stored step bookkeeping: no run, upload, provider job or live call is made.
import { handleContinueStages } from "./engine.js";

export async function onRequest(context) {
  return handleContinueStages(context.request, context.env, { fetchImpl: context.env?.FETCH_IMPL });
}
