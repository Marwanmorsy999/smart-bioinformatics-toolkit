// POST /api/providers/budget — owner-only: configure governor totals from
// ACTUAL provider-reported quota/usage data. Unknown totals stay null and
// continue to fail closed. No quota is ever invented by this endpoint.

import {
  jsonResponse, errorResponse, requireMethod, readJsonBody,
  requireOwner, providerPayload, safeString
} from "./_lib.js";
import { getGovernor } from "./_lib.js";
import { PROVIDER_IDS } from "../../../providers/common/contract.js";

export async function onRequest(context) {
  const denied = requireMethod(context.request, "POST", "POST");
  if (denied) return denied;
  const { env, request } = context;
  const ownerError = requireOwner(request, env);
  if (ownerError) return ownerError;
  const { payload, error } = await readJsonBody(request);
  if (error) return errorResponse(error, 400, request);

  const totals = payload.totals;
  if (!totals || typeof totals !== "object" || Array.isArray(totals)) {
    return errorResponse("totals must be an object keyed by provider.", 400, request);
  }
  for (const [provider, units] of Object.entries(totals)) {
    if (!PROVIDER_IDS.includes(provider)) return errorResponse(`Unknown provider: ${provider}`, 400, request);
    if (!units || typeof units !== "object" || Array.isArray(units)) {
      return errorResponse(`totals.${provider} must be an object.`, 400, request);
    }
    for (const [unit, value] of Object.entries(units)) {
      if (value !== null && (!Number.isFinite(Number(value)) || Number(value) < 0)) {
        return errorResponse(`totals.${provider}.${unit} must be a non-negative number or null.`, 400, request);
      }
    }
  }
  if (typeof payload.source !== "string" || !payload.source.trim()) {
    return errorResponse("source is required (where the quota values were observed).", 400, request);
  }

  try {
    const governor = getGovernor(env);
    await governor.initialize();
    await governor.configureTotals(totals);
    return jsonResponse(providerPayload(request, env, {
      totals,
      source: safeString(payload.source, 300),
      note: "Totals are operator-supplied from real provider data. Null means unknown and stays fail-closed."
    }), 200, request);
  } catch (fail) {
    return errorResponse(`Governor unavailable: ${fail?.message ?? fail}`, 503, request);
  }
}
