// GET /api/providers/usage — centralized governor status and alerts.

import { jsonResponse, requireMethod, getGovernor, providerPayload } from "./_lib.js";
import { listRows, getDb } from "../ai/_lib.js";
import { PROVIDER_SQL } from "./_lib.js";

export async function onRequest(context) {
  const denied = requireMethod(context.request, "GET", "GET");
  if (denied) return denied;
  const { env, request } = context;
  try {
    const governor = getGovernor(env);
    await governor.initialize();
    const status = await governor.getStatus();
    const db = getDb(env);
    const alerts = db ? await listRows(db, PROVIDER_SQL.listGovernorAlerts, [50]) : [];
    return jsonResponse(providerPayload(request, env, { status, alerts }), 200, request);
  } catch (error) {
    return jsonResponse(providerPayload(request, env, {
      status: null,
      error: String(error?.message ?? error),
      notice: "Usage state is unavailable; job submission is fail-closed."
    }), 503, request);
  }
}
