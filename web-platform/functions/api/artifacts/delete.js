// POST /api/artifacts/delete?ticket=... — user-facing deletion.
// Authorization: owner token OR a short-lived signed delete ticket.

import {
  jsonResponse, errorResponse, requireMethod, providerPayload,
  getStore, PROVIDER_SQL, getDb, getRow, runStatement, requireOwner, nowIso
} from "./_lib.js";

export async function onRequest(context) {
  const denied = requireMethod(context.request, "POST", "POST");
  if (denied) return denied;
  const { env, request } = context;
  const store = getStore(env);
  if (store.error) return errorResponse(store.error, 503, request);
  const ticket = await store.verify(new URL(request.url).searchParams.get("ticket"), "delete");
  const isOwner = requireOwner(request, env) === null;
  if (!ticket && !isOwner) return errorResponse("A signed delete ticket or owner token is required.", 403, request);

  const db = getDb(env);
  if (!db) return errorResponse("D1 binding is unavailable.", 503, request);
  const artifactId = ticket?.artifact_id ?? new URL(request.url).searchParams.get("id") ?? "";
  const row = await getRow(db, PROVIDER_SQL.getArtifactRecord, [artifactId]);
  if (!row) return errorResponse("Artifact not found.", 404, request);
  if (isOwner && ticket && ticket.object_key !== row.object_key) {
    return errorResponse("Delete ticket does not match artifact.", 403, request);
  }

  try {
    await store.deleteObject(row.object_key);
    await runStatement(db, PROVIDER_SQL.markArtifactDeleted, ["deleted", nowIso(), artifactId]);
    return jsonResponse(providerPayload(request, env, {
      artifact_id: artifactId, deleted: true, deleted_at: nowIso(),
      notice: "Private object removed; transfer ledger deletion status updated."
    }), 200, request);
  } catch (fail) {
    return errorResponse(String(fail?.message ?? fail), 503, request);
  }
}
