// POST /api/providers/emergency-stop — owner-only per-provider circuit breaker.

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
  const provider = safeString(payload.provider, 50);
  if (!PROVIDER_IDS.includes(provider)) return errorResponse("Unknown provider.", 400, request);

  try {
    const governor = getGovernor(env);
    await governor.initialize();
    const result = await governor.setEmergencyStop(provider, payload.stopped === true, safeString(payload.reason, 300));
    return jsonResponse(providerPayload(request, env, { emergency_stop: result }), 200, request);
  } catch (fail) {
    return errorResponse(`Governor unavailable: ${fail?.message ?? fail}`, 503, request);
  }
}
