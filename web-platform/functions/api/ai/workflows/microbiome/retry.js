// POST /api/ai/workflows/microbiome/retry — single-use, bounded recovery of an
// upload-only failed run. Resumes the SAME run; it never creates a new one.
import { handleRetry } from "./engine.js";
export async function onRequest(context) {
  return handleRetry(context.request, context.env, { fetchImpl: context.env?.FETCH_IMPL });
}
