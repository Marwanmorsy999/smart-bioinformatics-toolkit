// GET /api/ai/workflows/microbiome/import-schema — read-only provenance view of
// the LIVE `qiime2 tools import` io_details schema. No POST, no credentials,
// no dataset content and no history data.
import { handleImportSchema } from "./engine.js";
export async function onRequest(context) {
  return handleImportSchema(context.request, context.env, { fetchImpl: context.env?.FETCH_IMPL });
}
