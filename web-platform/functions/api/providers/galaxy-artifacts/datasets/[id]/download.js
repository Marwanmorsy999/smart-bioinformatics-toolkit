// GET /api/providers/galaxy/datasets/:id/download — owner-only dataset body.
// The body is proxied from Galaxy through the adapter (no public URL, no key),
// bounded by the artifact cap, hash-verified and audit-logged.

import {
  requireMethod, getDb, typedError, artifactFailure, requireGalaxy
} from "../../_lib.js";
import { requireOwner } from "../../../_lib.js";
import { createGalaxyArtifactStore, MAX_UPLOAD_BYTES } from "../../../../../../storage/galaxy-artifacts.js";

const STREAM_CHUNK_BYTES = 64 * 1024;

export async function onRequest(context) {
  const denied = requireMethod(context.request, "GET", "GET");
  if (denied) return denied;
  const { request, env, params } = context;

  const ownerError = requireOwner(request, env);
  if (ownerError) return ownerError;
  const disabled = requireGalaxy(env, request);
  if (disabled) return disabled;
  const db = getDb(env);
  if (!db) return typedError("D1 binding is unavailable.", 503, request, "no_d1");

  const store = createGalaxyArtifactStore(db, env, { fetch: env.FETCH_IMPL });
  const row = await store.resolve(String(params?.id ?? ""));
  if (!row) return typedError("Galaxy artifact not found.", 404, request, "artifact_not_found");

  let result;
  try {
    result = await store.downloadDataset(row);
  } catch (error) {
    // Failed attempts are audited too (who / when / dataset / status / code).
    await store.recordDownload({
      artifact_id: row.public_id, dataset_id: row.dataset_id, actor: "owner",
      status: "failed",
      sha256: error?.detail?.actual ?? null,
      detail: { code: error?.code ?? "download_failed", status: error?.status ?? 500 }
    }).catch(() => {});
    return artifactFailure(error, request);
  }

  await store.recordDownload({
    artifact_id: row.public_id, dataset_id: row.dataset_id, actor: "owner",
    bytes: result.bytes, sha256: result.sha256, status: "ok",
    detail: { code: "ok", status: 200 }
  });

  const body = new TextEncoder().encode(result.content);
  const stream = new ReadableStream({
    start(controller) {
      for (let offset = 0; offset < body.byteLength; offset += STREAM_CHUNK_BYTES) {
        controller.enqueue(body.subarray(offset, offset + STREAM_CHUNK_BYTES));
      }
      controller.close();
    }
  });
  return new Response(stream, {
    status: 200,
    headers: {
      "Content-Type": "application/octet-stream",
      "Content-Length": String(body.byteLength),
      "Content-Disposition": `attachment; filename="${row.filename.replace(/["\r\n]/g, "")}"`,
      "Content-Security-Policy": "default-src 'none'",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
      "Cache-Control": "no-store",
      "X-Artifact-Id": row.public_id,
      "X-Dataset-Sha256": result.sha256,
      "X-Max-Bytes": String(MAX_UPLOAD_BYTES)
    }
  });
}
