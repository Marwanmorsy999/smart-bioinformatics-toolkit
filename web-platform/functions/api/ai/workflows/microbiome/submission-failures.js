// GET /api/ai/workflows/microbiome/submission-failures?run_id=... — stored diagnostic only.
import { handleSubmissionFailures } from "./engine.js";
export async function onRequest(context) {
  return handleSubmissionFailures(context.request, context.env);
}
