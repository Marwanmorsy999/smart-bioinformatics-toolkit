// GET /api/providers — transparency view of registered providers.
// Never advertises an unavailable tool as executable.

import {
  jsonResponse, requireMethod, getRegistry, getCachedCapabilities,
  isEnabled, providerPayload, safeString, getCachedHealth
} from "./_lib.js";
import { PROVIDER_IDS, AVAILABILITY, executableTools as filterExecutable } from "../../../providers/common/contract.js";

export async function onRequest(context) {
  const denied = requireMethod(context.request, "GET", "GET");
  if (denied) return denied;
  const { env, request } = context;
  const registry = getRegistry(env, { fetch: env?.FETCH_IMPL });
  const providers = [];

  for (const id of PROVIDER_IDS) {
    const provider = registry.getProvider(id);
    const enabled = isEnabled(env, id);
    const entry = {
      id,
      enabled,
      availability: enabled ? AVAILABILITY.UNKNOWN : AVAILABILITY.DISABLED,
      health: null,
      operations: [],
      tools: [],
      workflows: [],
      discovery_mode: "unavailable",
      discovered_at: null,
      source: null
    };
    if (provider && enabled) {
      try {
        const health = await getCachedHealth(provider, id, env);
        entry.health = {
          ok: Boolean(health?.ok),
          status: String(health?.status ?? AVAILABILITY.UNKNOWN),
          error: health?.error ? safeString(health.error.message ?? health.error, 300) : null
        };
        entry.availability = health?.ok ? AVAILABILITY.AVAILABLE : AVAILABILITY.UNAVAILABLE;
      } catch (error) {
        entry.health = { ok: false, status: AVAILABILITY.UNAVAILABLE, error: safeString(error?.message ?? error, 300) };
        entry.availability = AVAILABILITY.UNAVAILABLE;
      }
      try {
        const capabilities = await getCachedCapabilities(registry, id, env);
        if (capabilities) {
          entry.operations = Array.isArray(capabilities.operations) ? capabilities.operations : [];
          entry.discovery_mode = String(capabilities.discovery_mode ?? "unavailable");
          entry.discovered_at = capabilities.discovered_at ?? null;
          entry.source = capabilities.source ?? null;
          const executable = filterExecutable(capabilities);
          entry.tools = executable.map((tool) => ({
            id: tool.id, name: tool.name, version: tool.version,
            description: tool.description ?? "", input_types: tool.input_types ?? [],
            output_types: tool.output_types ?? [], available: true, executable: true
          }));
          entry.workflows = Array.isArray(capabilities.workflows)
            ? capabilities.workflows.filter((workflow) => workflow?.available === true).map((workflow) => ({ id: workflow.id, name: workflow.name }))
            : [];
        }
      } catch (error) {
        entry.discovery_mode = "unavailable";
        entry.health = entry.health ?? {};
        entry.health.capability_error = safeString(error?.message ?? error, 300);
      }
    }
    providers.push(entry);
  }

  return jsonResponse(providerPayload(request, env, { providers }), 200, request);
}
