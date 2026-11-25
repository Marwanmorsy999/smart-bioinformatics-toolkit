// GET /api/ai/workflows/phylo/tool?tool_id=<id> — M7.3 schema discovery.
// Returns ONLY public tool input/output metadata; the Galaxy key is used as a
// request header server-side and is never echoed.
import { errorResponse, jsonResponse, requireMethod, safeString } from "../../_lib.js";

export async function onRequest(context) {
  const rejected = requireMethod(context.request, "GET", "GET, OPTIONS");
  if (rejected) return rejected;
  const toolId = safeString(new URL(context.request.url).searchParams.get("tool_id"), 300);
  if (!toolId) return errorResponse("tool_id is required.", 400, context.request);
  const base = safeString(context.env?.GALAXY_BASE_URL).trim();
  const key = safeString(context.env?.GALAXY_API_KEY).trim();
  if (!base || !key) return errorResponse("Galaxy is not configured.", 503, context.request);
  try {
    const response = await fetch(`${base}/api/tools/${encodeURIComponent(toolId)}`, {
      headers: { "X-API-Key": key, Accept: "application/json" }
    });
    if (!response.ok) return errorResponse(`Galaxy returned HTTP ${response.status}.`, 502, context.request);
    const body = await response.json();
    return jsonResponse({
      tool_id: body?.id ?? toolId,
      version: body?.version ?? null,
      inputs: (body?.inputs ?? []).map((i) => ({ name: i?.name, type: i?.type, optional: i?.optional })),
      outputs: (body?.outputs ?? []).map((o) => ({ name: o?.name, type: o?.type ?? o?.format })),
      params: (body?.parameters ?? []).map((p) => ({ name: p?.name, type: p?.type, value: p?.value ?? null }))
    }, 200, context.request);
  } catch (error) {
    return errorResponse(`Tool schema unavailable: ${error?.message ?? error}`, 502, context.request);
  }
}
