// GET /api/providers/:id — single provider health + capability summary.

import {
  jsonResponse, requireMethod, getRegistry, getCachedCapabilities,
  requireEnabled, isEnabled, providerPayload, safeString, typedProviderError
} from "../_lib.js";
import { AVAILABILITY, executableTools } from "../../../../providers/common/contract.js";

export async function onRequest(context) {
  const denied = requireMethod(context.request, "GET", "GET");
  if (denied) return denied;
  const { env, request, params } = context;
  const id = String(params?.id ?? "");
  const registry = getRegistry(env, { fetch: env?.FETCH_IMPL });
  const disabled = requireEnabled(registry, id, request, env);
  if (disabled) return disabled;

  const provider = registry.getProvider(id);
  let health = null;
  try {
    health = await provider.healthCheck({ fetch: env?.FETCH_IMPL });
  } catch (error) {
    return typedProviderError(safeString(error?.message ?? error, 300), 502, request, id);
  }
  let capabilities = null;
  try {
    capabilities = await getCachedCapabilities(registry, id, env);
  } catch (error) {
    capabilities = { discovery_mode: "unavailable", error: safeString(error?.message ?? error, 300) };
  }

  return jsonResponse(providerPayload(request, env, {
    provider: {
      id,
      enabled: isEnabled(env, id),
      availability: health?.ok ? AVAILABILITY.AVAILABLE : AVAILABILITY.UNAVAILABLE,
      health: {
        ok: Boolean(health?.ok), status: String(health?.status ?? AVAILABILITY.UNKNOWN),
        error: health?.error ? safeString(health.error.message ?? health.error, 300) : null
      },
      operations: Array.isArray(capabilities?.operations) ? capabilities.operations : [],
      tools: executableTools(capabilities).map((tool) => ({
        id: tool.id, name: tool.name, version: tool.version, description: tool.description ?? "",
        input_types: tool.input_types ?? [], output_types: tool.output_types ?? []
      })),
      discovery_mode: capabilities?.discovery_mode ?? "unavailable",
      discovered_at: capabilities?.discovered_at ?? null
    }
  }), 200, request);
}
