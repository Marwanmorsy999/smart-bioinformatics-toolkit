// POST /api/providers/consent — explicit, per-provider destination consent.
// Consent records are short-lived, scoped to one dataset + one provider, and
// are required before any external transmission (including Galaxy).

import {
  jsonResponse, errorResponse, requireMethod, readJsonBody,
  providerPayload, safeString, nowIso, isPublicId, rateLimit
} from "./_lib.js";
import { getDb, insertRow, makeId } from "../ai/_lib.js";
import { PROVIDER_SQL } from "./_lib.js";
import { PROVIDER_IDS } from "../../../providers/common/contract.js";

const MAX_CONSENT_TTL_MS = 30 * 60 * 1000;

export async function onRequest(context) {
  const denied = requireMethod(context.request, "POST", "POST");
  if (denied) return denied;
  const { env, request } = context;
  const limited = rateLimit(request, "consent", 20, 5 * 60 * 1000);
  if (limited) return limited;
  const { payload, error } = await readJsonBody(request);
  if (error) return errorResponse(error, 400, request);

  const provider = safeString(payload.provider, 50);
  const datasetId = safeString(payload.dataset_id, 100);
  if (!PROVIDER_IDS.includes(provider)) return errorResponse("Unknown provider.", 400, request);
  if (!isPublicId(datasetId)) return errorResponse("Invalid dataset_id.", 400, request);
  if (payload.granted !== true) {
    return errorResponse("Explicit granted=true is required; denial is the default.", 403, request, { "X-Governor-Reason": "consent_denied" });
  }
  const scope = payload.scope && typeof payload.scope === "object" && !Array.isArray(payload.scope)
    ? JSON.stringify(payload.scope) : JSON.stringify({});
  const db = getDb(env);
  if (!db) return errorResponse("D1 binding is unavailable.", 503, request);

  const ttlMs = Number.isFinite(payload.ttl_seconds)
    ? Math.min(MAX_CONSENT_TTL_MS, Math.max(60_000, payload.ttl_seconds * 1000))
    : MAX_CONSENT_TTL_MS;
  const publicId = makeId("pcon");
  const createdAt = nowIso();
  const expiresAt = new Date(Date.now() + ttlMs).toISOString();
  await insertRow(db, PROVIDER_SQL.insertConsentRecord, [
    publicId, datasetId, provider, String(env?.[`${provider.toUpperCase()}_BASE_URL`] ?? provider),
    scope, 1, createdAt, expiresAt
  ]);

  return jsonResponse(providerPayload(request, env, {
    consent: {
      id: publicId, dataset_id: datasetId, provider, granted: true,
      created_at: createdAt, expires_at: expiresAt,
      revocable: true, scope: JSON.parse(scope)
    },
    notice: `Consent covers only ${provider} and dataset ${datasetId}. A switch to another destination requires new consent.`
  }), 201, request);
}
