// POST /api/providers/jobs/:id/cancel — cancel a job and release its reservation.
// Authorization: owner token OR the consent_id bound to the job.

import {
  jsonResponse, errorResponse, requireMethod, readJsonBody, getRegistry,
  providerPayload, normalizeForApi, requireOwner, safeString
} from "../../_lib.js";
import { getDb, getRow, runStatement, parseJson } from "../../../ai/_lib.js";
import { PROVIDER_SQL } from "../../_lib.js";
import { getGovernor } from "../../_lib.js";
import { JOB_STATUS } from "../../../../../providers/common/contract.js";

export async function onRequest(context) {
  const denied = requireMethod(context.request, "POST", "POST");
  if (denied) return denied;
  const { env, request, params } = context;
  const id = String(params?.id ?? "");
  const { payload, error } = await readJsonBody(request);
  if (error) return errorResponse(error, 400, request);

  const db = getDb(env);
  if (!db) return errorResponse("D1 binding is unavailable.", 503, request);
  const row = await getRow(db, PROVIDER_SQL.getProviderJob, [id]);
  if (!row) return errorResponse("Provider job not found.", 404, request);

  // Cancellation is a state-changing external action: owner token required.
  // A consent id is never accepted as proof of ownership (review finding M4).
  const ownerError = requireOwner(request, env);
  if (ownerError) return ownerError;

  const registry = getRegistry(env, { fetch: env?.FETCH_IMPL });
  const provider = registry.getProvider(row.provider);
  if (!provider) return errorResponse("Provider adapter is unavailable.", 503, request);

  try {
    const result = await provider.cancelJob(
      { job_id: row.provider_job_id, provider_job_id: row.provider_job_id },
      { fetch: env?.FETCH_IMPL }
    );
    await runStatement(db, PROVIDER_SQL.updateProviderJob, [
      JOB_STATUS.CANCELLED, new Date().toISOString(),
      JSON.stringify({ ...(parseJson(row.detail_json) ?? {}), cancellation: result }), id
    ]);
    try {
      const governor = getGovernor(env);
      await governor.initialize();
      // The submission reservation was already consumed. Cancellation is
      // recorded as actual usage rather than releasing a consumed reservation.
      await governor.recordUsage(row.provider, { jobs_cancelled: 1 });
    } catch { /* accounting is advisory after cancellation */ }
    return jsonResponse(providerPayload(request, env, {
      job: { id, provider: row.provider, status: JOB_STATUS.CANCELLED, cancelled: true, provider_result: result }
    }), 200, request);
  } catch (fail) {
    return normalizeForApi(row.provider, fail, request);
  }
}
