// POST /api/artifacts/upload-url — issue a short-lived signed upload ticket.
// No file bytes touch this endpoint; the client uploads directly to the
// signed Worker URL, which streams into the private R2 bucket.

import {
  jsonResponse, errorResponse, requireMethod, readJsonBody,
  providerPayload, safeString, isPublicId, getStore
} from "./_lib.js";

export async function onRequest(context) {
  const denied = requireMethod(context.request, "POST", "POST");
  if (denied) return denied;
  const { env, request } = context;
  const { payload, error } = await readJsonBody(request);
  if (error) return errorResponse(error, 400, request);

  const datasetId = safeString(payload.dataset_id, 100);
  if (!isPublicId(datasetId)) return errorResponse("Invalid dataset_id.", 400, request);
  const store = getStore(env);
  if (store.error) return errorResponse(store.error, 503, request);

  try {
    const bytes = new Uint8Array(8);
    crypto.getRandomValues(bytes);
    const artifactId = `art_${Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")}`;
    const ticket = await store.createUploadTicket({
      dataset_id: datasetId,
      filename: payload.filename,
      size_bytes: payload.size_bytes,
      sha256: payload.sha256,
      mime: payload.mime ?? "application/octet-stream",
      artifact_id: artifactId
    });
    return jsonResponse(providerPayload(request, env, {
      artifact_id: artifactId,
      ...ticket,
      notice: "Private storage only. The signed URL expires; SHA-256 and byte count are enforced on upload."
    }), 201, request);
  } catch (fail) {
    return errorResponse(String(fail?.message ?? fail), 400, request);
  }
}
