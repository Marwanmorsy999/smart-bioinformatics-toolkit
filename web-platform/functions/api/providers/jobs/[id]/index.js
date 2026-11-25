// GET /api/providers/jobs/:id — live job status from the provider.

import {
  jsonResponse, errorResponse, requireMethod, getRegistry,
  providerPayload, normalizeForApi, safeString
} from "../../_lib.js";
import { getDb, getRow, parseJson, runStatement } from "../../../ai/_lib.js";
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
    const status = await provider.getJobStatus(
      { job_id: row.provider_job_id, provider_job_id: row.provider_job_id },
      { fetch: env?.FETCH_IMPL }
    );
    const detail = parseJson(row.detail_json) ?? {};
    if (status?.status && status.status !== row.status) {
      await runStatement(db, PROVIDER_SQL.updateProviderJob, [
        String(status.status), status.finished_at ?? null, JSON.stringify({ ...detail, last_status: status }), id
      ]);
    }
    return jsonResponse(providerPayload(request, env, {
      job: {
        id: row.public_id, provider: row.provider, tool_id: row.tool_id,
        status: String(status?.status ?? row.status), provider_job_id: row.provider_job_id,
        dataset_id: row.dataset_id, transfer_id: row.transfer_id,
        destination: row.provider, external_egress: true,
        started_at: status?.started_at ?? null, finished_at: status?.finished_at ?? null,
        error: status?.error ? safeString(status.error.message ?? status.error, 300) : null
      }
    }), 200, request);
  } catch (error) {
    return normalizeForApi(row.provider, error, request);
  }
}
