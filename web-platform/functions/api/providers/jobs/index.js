// POST /api/providers/jobs — submit a REAL governed, consent-gated provider job.
// No silent third-party transmission: a matching consent record is mandatory.

import {
  jsonResponse, errorResponse, requireMethod, readJsonBody, getRegistry,
  requireEnabled, getGovernor, providerPayload, normalizeForApi,
  safeString, nowIso, isPublicId, rateLimit
} from "../_lib.js";
import { getDb, insertRow, getRow, makeId, parseJson, runStatement } from "../../ai/_lib.js";
import { PROVIDER_SQL } from "../_lib.js";
import { OPERATIONS, JOB_STATUS } from "../../../../providers/common/contract.js";

const MAX_JOB_INPUT_BYTES = 64 * 1024 * 1024;
const CONSENT_TTL_MS = 30 * 60 * 1000;
// Consents are issued as pcon_<hex>; req_<hex> is accepted for compatibility
// with records written by earlier integration tests.
const CONSENT_ID_PATTERN = /^(pcon|req)_[0-9a-f]{16}$/;

// Budget units and categories are provider-specific. "general" exists only
// for Galaxy's operational caps; using it for other providers fails closed.
function governorPlan(provider) {
  if (provider === "galaxy") return { unit: "jobs", category: "general" };
  if (provider === "smartsbio") return { unit: "api_calls", category: "core_integration" };
  if (provider === "ninerouter") return { unit: "requests", category: "integration" };
  return null;
}

export async function onRequest(context) {
  const denied = requireMethod(context.request, "POST", "POST");
  if (denied) return denied;
  const { env, request } = context;
  const limited = rateLimit(request, "jobs", 20, 5 * 60 * 1000);
  if (limited) return limited;

  const { payload, error } = await readJsonBody(request);
  if (error) return errorResponse(error, 400, request);

  const providerId = String(payload.provider ?? "");
  const registry = getRegistry(env, { fetch: env?.FETCH_IMPL });
  const disabled = requireEnabled(registry, providerId, request, env);
  if (disabled) return disabled;

  const operation = payload.operation === "invoke_workflow" ? OPERATIONS.INVOKE_WORKFLOW : OPERATIONS.SUBMIT_JOB;
  const toolId = safeString(payload.tool_id, 300);
  const workflowId = safeString(payload.workflow_id, 300);
  if (!toolId && !workflowId) return errorResponse("tool_id or workflow_id is required.", 400, request);

  const advertised = await registry.advertisedTools({ fetch: env?.FETCH_IMPL });
  const match = advertised.find((tool) => tool.id === (toolId || workflowId) && tool.provider === providerId);
  if (!match) {
    return errorResponse(`Tool '${toolId || workflowId}' is not registered and available for provider '${providerId}'.`, 400, request);
  }

  const datasetId = safeString(payload.dataset_id, 100);
  const consentId = safeString(payload.consent_id, 100);
  if (!isPublicId(datasetId) || !CONSENT_ID_PATTERN.test(consentId)) {
    return errorResponse("A valid dataset_id and consent_id are required.", 400, request);
  }
  const db = getDb(env);
  if (!db) return errorResponse("D1 binding is unavailable; job submission is fail-closed.", 503, request);

  const consent = await getRow(db, PROVIDER_SQL.getConsentRecord, [consentId]);
  if (!consent || consent.provider !== providerId || consent.dataset_id !== datasetId) {
    return errorResponse("Consent does not cover this provider and dataset.", 403, request, {
      "X-Governor-Reason": "consent_mismatch"
    });
  }
  // A spent consent is an idempotency signal, not a generic mismatch: repeat
  // submissions must be distinguishable from "no consent for this dataset".
  if (consent.used_at) {
    return errorResponse("Consent has already been used for a submission.", 409, request, {
      "X-Governor-Reason": "duplicate_submission"
    });
  }
  if (Number(consent.granted) !== 1) {
    return errorResponse("Consent does not cover this provider and dataset.", 403, request, {
      "X-Governor-Reason": "consent_mismatch"
    });
  }
  if (!consent.expires_at || Date.parse(consent.expires_at) <= Date.now()) {
    return errorResponse("Consent has expired.", 403, request, { "X-Governor-Reason": "consent_expired" });
  }
  const scope = parseJson(consent.scope_json) ?? {};
  if (scope.operation && scope.operation !== operation) {
    return errorResponse("Consent does not cover this operation.", 403, request, { "X-Governor-Reason": "consent_scope_operation" });
  }
  if (scope.destination && scope.destination !== providerId) {
    return errorResponse("Consent does not cover this destination.", 403, request, { "X-Governor-Reason": "consent_scope_destination" });
  }

  // Single-use consent claim: the conditional update is the atomic gate that
  // prevents two concurrent requests from submitting the same transfer twice.
  // A spent consent is never restored, even if the later provider call fails.
  const claim = await runStatement(db, PROVIDER_SQL.consumeConsent, [nowIso(), consentId]);
  if (!(Number(claim?.meta?.changes ?? claim?.changes ?? 0) > 0)) {
    return errorResponse("Consent has already been used for a submission.", 409, request, {
      "X-Governor-Reason": "duplicate_submission"
    });
  }

  const byteCount = Number(payload.size_bytes ?? 0);
  if (!Number.isFinite(byteCount) || byteCount < 0 || byteCount > MAX_JOB_INPUT_BYTES) {
    return errorResponse(`size_bytes must be between 0 and ${MAX_JOB_INPUT_BYTES}.`, 400, request);
  }

  let governor;
  try {
    governor = getGovernor(env);
    await governor.initialize();
  } catch {
    return errorResponse("Usage governor is unavailable; job submission is fail-closed.", 503, request);
  }
  const plan = governorPlan(providerId);
  const reservations = [];
  const reserve = await governor.reserve({
    provider: providerId, unit: plan.unit, amount: 1, category: plan.category,
    consentVerified: true, operation, idFactory: () => makeId("rsv")
  });
  if (!reserve.ok) {
    return errorResponse(`Request refused: ${reserve.reason}.`, reserve.reason === "budget_exhausted" ? 429 : 503, request, {
      "X-Governor-Reason": reserve.reason
    });
  }
  reservations.push({ reservation: reserve, amount: 1 });
  if (byteCount > 0) {
    const byteReserve = await governor.reserve({
      provider: providerId, unit: "bytes", amount: byteCount, category: plan.category,
      consentVerified: true, operation, idFactory: () => makeId("rsv")
    });
    if (!byteReserve.ok) {
      for (const entry of reservations) await governor.release(entry.reservation.reservation_id);
      return errorResponse(`Request refused: byte budget ${byteReserve.reason}.`, 429, request, { "X-Governor-Reason": byteReserve.reason });
    }
    reservations.push({ reservation: byteReserve, amount: byteCount });
  }

  const jobId = makeId("pjob");
  const transferId = makeId("xfer");
  const inputHash = safeString(payload.input_hash, 64);
  const createdAt = nowIso();
  let result;
  try {
    const provider = registry.getProvider(providerId);
    const validation = provider.validateRequest(operation, {
      tool_id: toolId || undefined, workflow_id: workflowId || undefined,
      params: payload.params ?? {}, inputs: payload.inputs ?? {}
    });
    if (!validation.valid) throw new Error(validation.error ?? "Invalid provider request.");

    result = await provider.submitJob({
      operation,
      tool_id: toolId || undefined,
      workflow_id: workflowId || undefined,
      params: payload.params && typeof payload.params === "object" ? payload.params : {},
      inputs: payload.inputs && typeof payload.inputs === "object" ? payload.inputs : {},
      dataset_id: datasetId,
      input_hash: inputHash,
      size_bytes: byteCount
    }, { fetch: env?.FETCH_IMPL });

    // Adapters normalize provider failures into a failed result instead of
    // throwing. Treat that as a failure here — never persist it as submitted.
    if (result?.status === "failed" || result?.error) {
      const detail = result.error?.message ?? result.error ?? "Provider submission failed.";
      const failure = new Error(String(detail).slice(0, 500));
      // Preserve the provider's HTTP status and code so an expired key (401)
      // or an unactivated account (403) is not misreported as a Worker 502.
      failure.status = Number(result.error?.status ?? result.error?.response?.status ?? 0) || 0;
      failure.code = result.error?.code;
      // Preserve normalizeProviderError's default (e.g. retryable 5xx) when the
      // adapter did not explicitly report the flag.
      if (typeof result.error?.retryable === "boolean") failure.retryable = result.error.retryable;
      throw failure;
    }

    await insertRow(db, PROVIDER_SQL.insertProviderJob, [
      jobId, providerId, tool_id_or(toolId, workflowId), operation, JOB_STATUS.QUEUED,
      safeString(result?.provider_job_id, 300) || jobId,
      reserve.reservation_id, datasetId, inputHash, byteCount, consentId, transferId,
      JSON.stringify({ params: payload.params ?? {}, workflow_id: workflowId || null }),
      createdAt, null
    ]);
    await insertRow(db, PROVIDER_SQL.insertTransfer, [
      transferId, datasetId, "platform-artifact-store", providerId,
      inputHash, byteCount, consentId, operation, "submitted", createdAt,
      new Date(Date.now() + CONSENT_TTL_MS).toISOString(), null
    ]);

    // Post-job accounting: one submitted job/API call and the transferred bytes
    // are actual consumption. Consume now so no reservation can leak.
    for (const entry of reservations) await governor.consume(entry.reservation.reservation_id, entry.amount);
    await governor.recordUsage(providerId, {
      jobs_submitted: 1, tool_id: toolId || workflowId,
      destination: providerId, bytes_transferred: byteCount
    });
  } catch (fail) {
    for (const entry of reservations) await governor.release(entry.reservation.reservation_id);
    return normalizeForApi(providerId, fail, request);
  }

  return jsonResponse(providerPayload(request, env, {
    job: {
      id: jobId, provider: providerId, tool_id: toolId || workflowId,
      operation, status: JOB_STATUS.QUEUED, provider_job_id: result?.provider_job_id ?? jobId,
      dataset_id: datasetId, transfer_id: transferId, consent_id: null,
      external_egress: true, destination: providerId, created_at: createdAt
    },
    notice: "Real provider job submitted. Consent was verified and usage was accounted before submission."
  }), 202, request);
}

function tool_id_or(toolId, workflowId) {
  return toolId || workflowId;
}
