// POST /api/providers/chat — AI research chat / controlled explanation phrasing.
// 9Router is an orchestration reasoner, NOT a source of scientific measurements
// or citations. Output is always marked unverified and never enters the
// evidence gate as a finding.

import {
  jsonResponse, errorResponse, requireMethod, readJsonBody, getRegistry,
  requireEnabled, getGovernor, providerPayload, normalizeForApi,
  safeString, nowIso, writeAudit, rateLimit
} from "./_lib.js";
import { getDb } from "../ai/_lib.js";
import { OPERATIONS } from "../../../providers/common/contract.js";

const ALLOWED_CATEGORIES = new Set(["integration", "workflow_planning", "tool_selection", "explanation_evaluation", "reserve"]);

export async function onRequest(context) {
  const denied = requireMethod(context.request, "POST", "POST");
  if (denied) return denied;
  const { env, request } = context;
  const limited = rateLimit(request, "chat", 60, 5 * 60 * 1000);
  if (limited) return limited;
  const { payload, error } = await readJsonBody(request);
  if (error) return errorResponse(error, 400, request);

  const providerId = String(payload.provider ?? "ninerouter");
  if (providerId === "smartsbio") {
    return errorResponse(
      "smarts.bio public API access is disabled pending written provider authorization.",
      403, request, { "X-Provider": "smartsbio", "X-Error-Detail": JSON.stringify({ reason: "service_terms_authorization_pending" }) }
    );
  }
  if (providerId !== "ninerouter") return errorResponse("Unsupported chat provider.", 400, request);

  const registry = getRegistry(env, { fetch: env?.FETCH_IMPL });
  const disabled = requireEnabled(registry, providerId, request, env);
  if (disabled) return disabled;

  const message = safeString(payload.message, 4000);
  if (!message) return errorResponse("message must be non-empty text.", 400, request);
  const category = ALLOWED_CATEGORIES.has(payload.category) ? payload.category : "integration";

  let governor;
  try {
    governor = getGovernor(env);
    await governor.initialize();
  } catch (fail) {
    return errorResponse("Usage governor is unavailable; chat is fail-closed.", 503, request);
  }
  const reservation = await governor.reserve({
    provider: providerId, unit: "requests", amount: 1, category, operation: OPERATIONS.CHAT
  });
  if (!reservation.ok) {
    return errorResponse(`Request refused: ${reservation.reason}.`, reservation.reason === "budget_exhausted" ? 429 : 503, request, {
      "X-Governor-Reason": reservation.reason
    });
  }

  try {
    const provider = registry.getProvider(providerId);
    const validation = provider.validateRequest(OPERATIONS.CHAT, { message, operation: OPERATIONS.CHAT });
    if (!validation.valid) {
      await governor.release(reservation.reservation_id);
      return errorResponse(validation.error ?? "Invalid chat request.", 400, request);
    }
    const result = await provider.submitJob({
      operation: OPERATIONS.CHAT,
      message,
      system: typeof payload.system === "string" ? safeString(payload.system, 2000) : undefined,
      conversation_id: typeof payload.conversation_id === "string" ? safeString(payload.conversation_id, 100) : undefined,
      model: typeof payload.model === "string" ? safeString(payload.model, 100) : undefined
    }, { fetch: env?.FETCH_IMPL });

    if (result?.status === "failed" || result?.error) {
      const detail = result.error?.message ?? result.error ?? "Provider chat failed.";
      throw new Error(String(detail).slice(0, 500));
    }

    await governor.consume(reservation.reservation_id, 1);
    const usage = result?.output?.usage ?? {};
    await governor.recordUsage(providerId, {
      model: usage.model ?? env?.NINEROUTER_MODEL ?? "unknown",
      input_tokens: Number(usage.input_tokens) || 0,
      output_tokens: Number(usage.output_tokens) || 0,
      requests: 1
    });
    if (getDb(env)) {
      await writeAudit(getDb(env), "provider.chat", providerId, { category, model: usage.model ?? null }, () => makeIdSafe("aud"), nowIso());
    }

    return jsonResponse(providerPayload(request, env, {
      provider: providerId,
      reply: String(result?.output?.text ?? ""),
      conversation_id: payload.conversation_id ?? null,
      usage,
      evidence_status: "unverified",
      validated: false,
      notice: "AI-generated phrasing only. No scientific measurement or citation is asserted."
    }), 200, request);
  } catch (error) {
    await governor.release(reservation.reservation_id);
    return normalizeForApi(providerId, error, request);
  }
}

function makeIdSafe(prefix) {
  const bytes = new Uint8Array(8);
  if (globalThis.crypto?.getRandomValues) globalThis.crypto.getRandomValues(bytes);
  return `${prefix}_${Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")}`;
}
