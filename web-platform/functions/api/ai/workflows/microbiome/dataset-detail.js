// GET /api/ai/workflows/microbiome/dataset-detail?run_id=...&dataset_id=...
// Read-only provider metadata/checksum diagnostic for a run-owned dataset.
import { handleDatasetDetail } from "./engine.js";

export async function onRequest(context) {
  return handleDatasetDetail(context.request, context.env, { fetchImpl: context.env?.FETCH_IMPL });
}
