// GET /api/tools/catalog — public, read-only projection of the real capability
// registry. No auth, no D1, no provider flags, no secrets and no mutation. The
// existing GET /api/tools response is deliberately left untouched.

import { jsonResponse, requireMethod } from "../../ai/_lib.js";
import { TOOL_CATALOG_VERSION, listCatalog } from "../../../../providers/tools/registry.js";

export async function onRequest(context) {
  const { request } = context;
  const rejected = requireMethod(request, "GET", "GET, OPTIONS");
  if (rejected) return rejected;
  return jsonResponse({
    tools: listCatalog(),
    catalog_version: TOOL_CATALOG_VERSION
  }, 200, request);
}
