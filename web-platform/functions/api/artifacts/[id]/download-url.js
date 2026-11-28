// GET /api/artifacts/:id/download-url — short-lived signed download ticket.
// Authorization: owner token, OR a valid consent for the artifact's dataset.

import {
  jsonResponse, errorResponse, requireMethod, providerPayload,
  getStore, PROVIDER_SQL, getDb, getRow, requireOwner, safeString
} from "../_lib.js";

export async function onRequest(context) {
  const denied = requireMethod(context.request, "GET", "GET");
  if (denied) return denied;
  const { env, request, params } = context;
  const id = String(params?.id ?? "");
  const db = getDb(env);
  if (!db) return errorResponse("D1 binding is unavailable.", 503, request);
  const row = await getRow(db, PROVIDER_SQL.getArtifactRecord, [id]);
  if (!row || row.status !== "stored" || row.deleted_at) {
    return errorResponse("Artifact is unavailable.", 404, request);
  }

  if (requireOwner(request, env) !== null) {
    const consentId = safeString(new URL(request.url).searchParams.get("consent_id"), 100);
    if (!/^pcon_[0-9a-f]{16}$/.test(consentId)) {
      return errorResponse("An owner token or a valid consent_id is required.", 403, request);
    }
    const consent = await getRow(db, PROVIDER_SQL.getConsentRecord, [consentId]);
    if (!consent || consent.granted !== 1 || consent.dataset_id !== row.dataset_id
        || !consent.expires_at || Date.parse(consent.expires_at) <= Date.now()) {
      return errorResponse("Consent is invalid or expired for this dataset.", 403, request);
    }
  }

  const store = getStore(env);
  if (store.error) return errorResponse(store.error, 503, request);
  try {
    const ticket = await store.createDownloadTicket({
      dataset_id: row.dataset_id, object_key: row.object_key,
      filename: row.filename, mime: row.mime, bytes: row.bytes,
      ttl_seconds: 300
    });
    return jsonResponse(providerPayload(request, env, {
      artifact_id: id, ...ticket,
      sha256: row.sha256, bytes: row.bytes, filename: row.filename
    }), 200, request);
  } catch (fail) {
    return errorResponse(String(fail?.message ?? fail), 503, request);
  }
}
