// PUT /api/artifacts/upload?ticket=... — streamed, hash-verified upload into R2.

import {
  jsonResponse, errorResponse, requireMethod, providerPayload,
  nowIso, getStore, PROVIDER_SQL, getDb, insertRow
} from "./_lib.js";

export async function onRequest(context) {
  const denied = requireMethod(context.request, "PUT", "PUT");
  if (denied) return denied;
  const { env, request } = context;
  const store = getStore(env);
  if (store.error) return errorResponse(store.error, 503, request);

  const ticket = await store.verify(new URL(request.url).searchParams.get("ticket"), "upload");
  if (!ticket) return errorResponse("Invalid or expired upload ticket.", 403, request);
  const db = getDb(env);
  if (!db) return errorResponse("D1 binding is unavailable.", 503, request);

  try {
    const stored = await store.storeStream(ticket, request.body);
    const createdAt = nowIso();
    await insertRow(db, PROVIDER_SQL.insertArtifactRecord, [
      ticket.artifact_id, ticket.dataset_id, stored.object_key, ticket.filename,
      ticket.mime, stored.sha256, stored.bytes, "stored", createdAt, null
    ]);
    await insertRow(db, PROVIDER_SQL.insertTransfer, [
      `xfer_${Array.from(crypto.getRandomValues(new Uint8Array(8)), (b) => b.toString(16).padStart(2, "0")).join("")}`,
      ticket.dataset_id, "browser", "platform-artifact-store", stored.sha256,
      stored.bytes, null, "artifact_upload", "stored", createdAt,
      new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(), null
    ]);
    return jsonResponse(providerPayload(request, env, {
      artifact: {
        id: ticket.artifact_id, dataset_id: ticket.dataset_id, filename: ticket.filename,
        sha256: stored.sha256, bytes: stored.bytes, storage_ref: stored.object_key,
        status: "stored", created_at: createdAt
      },
      notice: "Stored in a private bucket. SHA-256 and byte count were verified during streaming upload."
    }), 201, request);
  } catch (fail) {
    return errorResponse(String(fail?.message ?? fail), 400, request);
  }
}
