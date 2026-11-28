// GET /api/ai/workflows/microbiome/artifact?run_id=...&dataset_id=...
// Owner-scoped, streaming dataset-body proxy for datasets known to a run.
import { handleArtifact } from "./engine.js";

export async function onRequest(context) {
  return handleArtifact(context.request, context.env, { fetchImpl: context.env?.FETCH_IMPL });
}
