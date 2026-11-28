// GET /api/providers/jobs/:id/artifacts — discovered output artifacts only.
// Artifacts are normalized by the adapter and still pass the M6 evidence gate
// before any finding is surfaced. No provider text is treated as a conclusion.

import {
  jsonResponse, errorResponse, requireMethod, getRegistry,
  providerPayload, normalizeForApi
} from "../../_lib.js";
import { getDb, getRow, runStatement, parseJson } from "../../../ai/_lib.js";
import { PROVIDER_SQL } from "../../_lib.js";

export async function onRequest(context) {
  const denied = requireMethod(context.request, "GET", "GET");
  if (denied) return denied;
  const { env, request, params } = context;
  const id = String(params?.id ?? "");
  const db = getDb(env);
  if (!db) return errorResponse("D1 binding is unavailable.", 503, request);
  const row = await getRow(db, PROVIDER_SQL.getProviderJob, [id]);
  if (!row) return errorResponse("Provider job not found.", 404, request);

  const registry = getRegistry(env, { fetch: env?.FETCH_IMPL });
  const provider = registry.getProvider(row.provider);
  if (!provider) return errorResponse("Provider adapter is unavailable.", 503, request);

  try {
    const result = await provider.getArtifacts(
      { job_id: row.provider_job_id, provider_job_id: row.provider_job_id },
      { fetch: env?.FETCH_IMPL }
    );
    const artifacts = Array.isArray(result?.artifacts) ? result.artifacts : [];
    await runStatement(db, PROVIDER_SQL.updateProviderJob, [
      row.status, row.finished_at ?? null,
      JSON.stringify({ ...(parseJson(row.detail_json) ?? {}), artifacts }), id
    ]);
    return jsonResponse(providerPayload(request, env, {
      job_id: id,
      provider: row.provider,
      artifacts,
      complete: Boolean(result?.complete),
      evidence_status: "unvalidated",
      notice: "Outputs must pass the platform validation and evidence gate before use as findings."
    }), 200, request);
  } catch (error) {
    return normalizeForApi(row.provider, error, request);
  }
}
