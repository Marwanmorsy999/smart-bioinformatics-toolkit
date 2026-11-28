// GET /api/ai/workflows/microbiome/tool-search?query=...
// Read-only LIVE tool-panel search: only id/name/version are returned.
import { handleToolSearch } from "./engine.js";

export async function onRequest(context) {
  return handleToolSearch(context.request, context.env, { fetchImpl: context.env?.FETCH_IMPL });
}
