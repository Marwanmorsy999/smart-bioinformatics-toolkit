// POST /api/ai/workflows/microbiome/refresh-discovery — re-run genuine tool
// discovery for an already-resumed, upload-only run. Read-only: no upload, no
// job submission, no new run; only state.discovery is updated.
import { handleRefreshDiscovery } from "./engine.js";
export async function onRequest(context) {
  return handleRefreshDiscovery(context.request, context.env, { fetchImpl: context.env?.FETCH_IMPL });
}
