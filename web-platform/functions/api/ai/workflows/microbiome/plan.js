// POST /api/ai/workflows/microbiome/plan — read-only reviewed plan.
import { handlePlan } from "./engine.js";
export async function onRequest(context) {
  return handlePlan(context.request, context.env, { fetchImpl: context.env?.FETCH_IMPL });
}
