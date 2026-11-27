// GET /api/ai/workflows/microbiome/submission-failures — read-only diagnostic.
// Returns only allowlisted, re-scrubbed failed-submission summaries stored in
// the run state. No live provider call, credentials or dataset content.
import { handleSubmissionFailures } from "./engine.js";

export async function onRequest(context) {
  return handleSubmissionFailures(context.request, context.env, { fetchImpl: context.env?.FETCH_IMPL });
}
