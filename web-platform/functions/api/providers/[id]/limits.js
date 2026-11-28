// GET /api/providers/:id/limits — actual quota/limits only. Unknown stays null.

import {
  jsonResponse, requireMethod, getRegistry, requireEnabled,
  providerPayload, safeString, typedProviderError
} from "../_lib.js";

export async function onRequest(context) {
  const denied = requireMethod(context.request, "GET", "GET");
  if (denied) return denied;
  const { env, request, params } = context;
  const id = String(params?.id ?? "");
  const registry = getRegistry(env, { fetch: env?.FETCH_IMPL });
  const disabled = requireEnabled(registry, id, request, env);
  if (disabled) return disabled;

  try {
    const limits = await registry.getProvider(id).getLimits({ fetch: env?.FETCH_IMPL });
    return jsonResponse(providerPayload(request, env, {
      provider: id,
      limits,
      notice: "Only provider-reported or operator-configured operational limits are shown. No quota is invented."
    }), 200, request);
  } catch (error) {
    return typedProviderError(safeString(error?.message ?? error, 300), 502, request, id);
  }
}
