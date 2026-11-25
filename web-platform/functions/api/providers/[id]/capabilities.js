// GET /api/providers/:id/capabilities — metadata-only dynamic discovery.
// This endpoint NEVER uploads data. Tools are filtered to executable ones.

import {
  jsonResponse, requireMethod, getRegistry, getCachedCapabilities,
  requireEnabled, providerPayload, safeString, typedProviderError
} from "../_lib.js";
import { executableTools } from "../../../../providers/common/contract.js";

export async function onRequest(context) {
  const denied = requireMethod(context.request, "GET", "GET");
  if (denied) return denied;
  const { env, request, params } = context;
  const id = String(params?.id ?? "");
  const registry = getRegistry(env, { fetch: env?.FETCH_IMPL });
  const disabled = requireEnabled(registry, id, request, env);
  if (disabled) return disabled;

  try {
    const capabilities = await getCachedCapabilities(registry, id, env);
    const tools = executableTools(capabilities);
    return jsonResponse(providerPayload(request, env, {
      provider: id,
      capabilities: {
        ...capabilities,
        tools,
        non_executable_tools: (capabilities?.tools ?? []).filter((tool) => !tool?.available || !tool?.executable).map((tool) => ({
          id: tool.id, name: tool.name, available: Boolean(tool?.available)
        }))
      },
      executable_tool_count: tools.length,
      notice: "Discovery is metadata-only. No dataset is transmitted by this endpoint."
    }), 200, request);
  } catch (error) {
    return typedProviderError(safeString(error?.message ?? error, 300), 502, request, id);
  }
}
