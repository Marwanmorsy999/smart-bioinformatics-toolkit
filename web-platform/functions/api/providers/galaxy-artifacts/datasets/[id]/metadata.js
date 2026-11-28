// GET /api/providers/galaxy/datasets/:id/metadata — owner-only metadata view.
// Confirms live Galaxy metadata through the adapter without returning any key.

import {
  jsonResponse, requireMethod, getDb, typedError, artifactFailure,
  requireGalaxy, publicArtifact
} from "../../_lib.js";
import { requireOwner, providerPayload } from "../../../_lib.js";
import { createGalaxyArtifactStore } from "../../../../../../storage/galaxy-artifacts.js";

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

  try {
    const live = await store.inspectDataset(row);
    return jsonResponse(providerPayload(request, env, {
      artifact: publicArtifact(row),
      live: {
        dataset_id: live.id,
        name: live.name,
        type: live.type,
        size: live.size,
        state: live.state,
        history_id: live.history_id
      },
      notice: "Live metadata confirmed through the Galaxy adapter. No credentials are returned."
    }), 200, request);
  } catch (error) {
    return artifactFailure(error, request);
  }
}
