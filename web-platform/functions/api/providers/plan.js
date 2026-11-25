// POST /api/providers/plan — structured, evidence-bounded workflow planning.
// Produces a PROPOSAL only. No job is submitted and no data leaves via this
// endpoint. Every proposed tool MUST be in the advertised registry.

import {
  jsonResponse, errorResponse, requireMethod, readJsonBody, getRegistry,
  requireEnabled, getGovernor, providerPayload, normalizeForApi,
  safeString, nowIso, writeAudit, rateLimit
} from "./_lib.js";
import { getDb } from "../ai/_lib.js";
import { OPERATIONS } from "../../../providers/common/contract.js";

const PLAN_SCHEMA = {
  type: "object",
  properties: {
    intent: { type: "string" },
    confidence: { type: "number" },
    proposed_tools: {
      type: "array",
      items: {
        type: "object",
        properties: {
          tool_id: { type: "string" },
          provider: { type: "string" },
          params: { type: "object" },
          reason: { type: "string" }
        }
      }
    },
    clarifying_questions: { type: "array", items: { type: "string" } },
    limitations: { type: "array", items: { type: "string" } }
  }
};

export async function onRequest(context) {
  const denied = requireMethod(context.request, "POST", "POST");
  if (denied) return denied;
  const { env, request } = context;
  const limited = rateLimit(request, "plan", 30, 5 * 60 * 1000);
  if (limited) return limited;
  const { payload, error } = await readJsonBody(request);
  if (error) return errorResponse(error, 400, request);

  const providerId = "ninerouter";
  const registry = getRegistry(env, { fetch: env?.FETCH_IMPL });
  const disabled = requireEnabled(registry, providerId, request, env);
  if (disabled) return disabled;

  const objective = safeString(payload.objective, 4000);
  if (!objective) return errorResponse("objective must be non-empty text.", 400, request);

  let governor;
  try {
    governor = getGovernor(env);
    await governor.initialize();
  } catch {
    return errorResponse("Usage governor is unavailable; planning is fail-closed.", 503, request);
  }
  const reservation = await governor.reserve({
    provider: providerId, unit: "requests", amount: 1,
    category: "workflow_planning", operation: OPERATIONS.PLAN
  });
  if (!reservation.ok) {
    return errorResponse(`Request refused: ${reservation.reason}.`, reservation.reason === "budget_exhausted" ? 429 : 503, request, {
      "X-Governor-Reason": reservation.reason
    });
  }

  try {
    // advertisedTools() is async and may perform metadata-only discovery.
    // Resolve it once and reuse the snapshot for both the prompt and the gate.
    const tools = await registry.advertisedTools({ fetch: env?.FETCH_IMPL });
    const result = await registry.getProvider(providerId).submitJob({
      operation: OPERATIONS.PLAN,
      message: objective,
      system: "Produce a structured workflow proposal. Use only tool ids supplied in the available-tools list. Do not report measurements, numerical results or citations. Ask clarifying questions when evidence is insufficient.",
      json_schema: PLAN_SCHEMA,
      available_tools: tools.map((tool) => ({ tool_id: tool.id, provider: tool.provider, description: tool.description ?? "" }))
    }, { fetch: env?.FETCH_IMPL });

    if (result?.status === "failed" || result?.error) {
      const detail = result.error?.message ?? result.error ?? "Provider planning failed.";
      throw new Error(String(detail).slice(0, 500));
    }

    await governor.consume(reservation.reservation_id, 1);
    const structured = result?.output?.structured ?? null;
    const advertised = new Map(tools.map((tool) => [tool.id, tool]));
    const rejected = [];
    const accepted = [];
    for (const proposal of Array.isArray(structured?.proposed_tools) ? structured.proposed_tools : []) {
      const toolId = String(proposal?.tool_id ?? "");
      if (!advertised.has(toolId)) {
        rejected.push({ tool_id: toolId, reason: "not_registered_or_unavailable" });
        continue;
      }
      const tool = advertised.get(toolId);
      accepted.push({
        tool_id: toolId,
        provider: tool.provider,
        params: proposal.params && typeof proposal.params === "object" ? proposal.params : {},
        reason: safeString(proposal.reason, 500)
      });
    }

    const destinations = [...new Set(accepted.map((step) => step.provider))];
    if (getDb(env)) {
      await writeAudit(getDb(env), "provider.plan", providerId, {
        objective_length: objective.length, accepted: accepted.length, rejected: rejected.length
      }, () => makeIdSafe("aud"), nowIso());
    }

    return jsonResponse(providerPayload(request, env, {
      provider: providerId,
      proposal: {
        intent: safeString(structured?.intent, 500) || "unspecified",
        confidence: Number.isFinite(structured?.confidence) ? Math.max(0, Math.min(1, structured.confidence)) : null,
        steps: accepted,
        rejected_steps: rejected,
        clarifying_questions: Array.isArray(structured?.clarifying_questions)
          ? structured.clarifying_questions.map((q) => safeString(q, 500)).filter(Boolean) : [],
        limitations: Array.isArray(structured?.limitations)
          ? structured.limitations.map((q) => safeString(q, 500)).filter(Boolean) : []
      },
      destination_disclosure: {
        external_providers: destinations,
        data_leaves_platform: destinations.length > 0,
        requires_per_provider_consent: destinations.length > 0
      },
      requires_approval: true,
      executable: false,
      validated: false,
      notice: "This is a proposal. No job was submitted and no dataset was transmitted."
    }), 200, request);
  } catch (fail) {
    await governor.release(reservation.reservation_id);
    return normalizeForApi(providerId, fail, request);
  }
}

function makeIdSafe(prefix) {
  const bytes = new Uint8Array(8);
  if (globalThis.crypto?.getRandomValues) globalThis.crypto.getRandomValues(bytes);
  return `${prefix}_${Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")}`;
}
