// GET /api/ai/workflows/microbiome/import-job?run_id=<id> — read-only view of
// the single qza import job stored in a microbiome run. GET only: no job
// submission, no state mutation and no new run. Provider calls are GETs through
// the existing Galaxy adapter; all returned text is sanitized and capped.
import { handleImportJob } from "./engine.js";
export async function onRequest(context) {
  return handleImportJob(context.request, context.env, { fetchImpl: context.env?.FETCH_IMPL });
}
