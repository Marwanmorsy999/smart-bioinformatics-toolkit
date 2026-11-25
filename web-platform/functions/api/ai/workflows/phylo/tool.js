// GET /api/ai/workflows/phylo/tool?tool_id=<id>&version=<v>&history_id=<id>
// M7.3 schema discovery: probe the instance's supported tool-schema routes in
// a controlled sequence, returning ONLY sanitized tool metadata and status
// codes. The Galaxy key is used server-side as a request header and is never
// returned, logged, or stored in a response.
import { errorResponse, jsonResponse, requireMethod, safeString } from "../../_lib.js";

const ROUTE_BUILDERS = [
  (id, version) => `/api/tools/${encodeURIComponent(id)}?io_details=true&tool_version=${encodeURIComponent(version)}`,
  (id, version) => `/api/tools/${encodeURIComponent(id)}/interop?tool_version=${encodeURIComponent(version)}`,
  (id, version, historyId) => `/api/tools/${encodeURIComponent(id)}/build${historyId ? `?history_id=${encodeURIComponent(historyId)}` : ""}`,
  (id, version) => `/api/tools/${encodeURIComponent(id)}/parameter_request_schema?tool_version=${encodeURIComponent(version)}`
];

function sanitize(text) {
  return String(text ?? "").slice(0, 12000)
    .replace(/X-API-Key[^\r\n]*/gi, "[REDACTED]")
    .replace(/Authorization[^\r\n]*/gi, "[REDACTED]")
    .replace(/[A-Za-z0-9]{32,}/g, (v) => (v.length >= 32 ? `[ID:${v.length}]` : v));
}

export async function onRequest(context) {
  const rejected = requireMethod(context.request, "GET", "GET, OPTIONS");
  if (rejected) return rejected;
  const query = new URL(context.request.url).searchParams;
  const toolId = safeString(query.get("tool_id"), 300);
  const version = safeString(query.get("version"), 100);
  const historyId = safeString(query.get("history_id"), 200);
  if (!toolId) return errorResponse("tool_id is required.", 400, context.request);
  const base = safeString(context.env?.GALAXY_BASE_URL).trim();
  const key = safeString(context.env?.GALAXY_API_KEY).trim();
  if (!base || !key) return errorResponse("Galaxy is not configured.", 503, context.request);
  const results = [];
  for (const build of ROUTE_BUILDERS) {
    const path = build(toolId, version, historyId);
    try {
      const response = await fetch(`${base}${path}`, {
        method: "GET",
        headers: { "X-API-Key": key, Accept: "application/json" }
      });
      const text = await response.text();
      results.push({ path, status: response.status, body: sanitize(text) });
    } catch (error) {
      results.push({ path, status: null, error: sanitize(error?.message ?? error) });
    }
  }
  return jsonResponse({ tool_id: toolId, version, history_id: historyId ? "[ID]" : null, routes: results }, 200, context.request);
}
