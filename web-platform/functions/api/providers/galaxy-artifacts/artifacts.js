// GET /api/providers/galaxy/artifacts — owner-only, metadata-only registry.
// No file bytes, no public URLs and no provider credentials are returned.

import {
  jsonResponse, requireMethod, getDb, typedError, requireGalaxy, publicArtifact
} from "./_lib.js";
import { requireOwner, providerPayload } from "../_lib.js";
import { createGalaxyArtifactStore } from "../../../../storage/galaxy-artifacts.js";

export async function onRequest(context) {
  const denied = requireMethod(context.request, "GET", "GET");
  if (denied) return denied;
  const { request, env } = context;

  const ownerError = requireOwner(request, env);
  if (ownerError) return ownerError;
  const disabled = requireGalaxy(env, request);
  if (disabled) return disabled;
  const db = getDb(env);
  if (!db) return typedError("D1 binding is unavailable.", 503, request, "no_d1");

  const rawLimit = Number(new URL(request.url).searchParams.get("limit"));
  const limit = Math.max(1, Math.min(Number.isInteger(rawLimit) ? rawLimit : 50, 100));
  const rows = await createGalaxyArtifactStore(db, env, { fetch: env.FETCH_IMPL }).list(limit);
  return jsonResponse(providerPayload(request, env, {
    artifacts: rows.map(publicArtifact),
    count: rows.length,
    notice: "Metadata-only view of registered Galaxy dataset references; bytes stay in the Galaxy history."
  }), 200, request);
}
