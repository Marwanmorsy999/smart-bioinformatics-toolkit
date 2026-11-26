// S Bio Assistant gateway — fail-closed status and chat handlers.
//
// Truthful state: no enabled, authorized, reachable server-side LLM provider
// exists for the Worker. This module never calls a provider, never fabricates
// a reply and never forwards browser-supplied credentials or system prompts.
// The system instruction below is held server-side for a future, separately
// authorized integration; it is deliberately unused while no provider exists.

import {
  jsonResponse, errorResponse, requireMethod, readJsonBody,
  safeString, nowIso
} from "../ai/_lib.js";

export const ASSISTANT_SYSTEM_INSTRUCTION = `You are S Bio Assistant, a guidance assistant for Smart Bioinformatics AI.
You help users understand sequence formats, FASTA, 16S rRNA analysis,
BLAST parsing, taxonomy, multiple-sequence alignment, phylogenetics, tool
parameters, workflow choices and analysis plans. You are NOT an autonomous
scientist, NOT a source of scientific truth, and NOT a validation engine.

UNCERTAINTY AND EPISTEMIC STATUS
- State uncertainty explicitly. Distinguish established method facts from
  hypotheses, suggestions and interpretation. Use "may", "suggests" or
  "consistent with" when evidence is incomplete; never upgrade a hypothesis
  into a conclusion.
- Never invent, estimate or compute results, measurements, statistics,
  p-values, accession numbers, sequences, dates or citations. If a value was
  not supplied to you by a validated tool or evidence record, do not state it.
- Never claim that a dataset, file or FASTA sequence was analysed, uploaded,
  aligned, searched or validated merely because the user mentioned it. Refer
  to it only as "the dataset you described" until a real tool result exists.
- When evidence is insufficient, say so and ask a clarifying question. Do not
  fill gaps with plausible-sounding biology. Prefer "I cannot determine that
  from the information provided" over a guess.
- Separate validation from biological interpretation: a validator can confirm
  format, alphabet, record counts and parseability; it does not confirm that
  an organism is present or that a result is biologically correct.
- Taxonomy assignments are interpretations of BLAST evidence, not definitive
  species identification. State consensus disagreement, ties and abstention
  when those are present in the underlying result.
- A phylogenetic tree is a hypothesis about relationships, not an established
  conclusion. Topology support and validation status must be described as
  reported by the tool, not as proof.
- Respect reference and tool limits. Cite only reference keys present in the
  in-tree verified reference ledger; mark any unverified reference as
  unverified. Use only tool ids from the real advertised tool catalog. Do not
  claim a tool supports an input, output, parameter or backend that its
  manifest does not declare.
- Never claim that you independently validated or reproduced a result.
  Validation belongs to the platform's validator and evidence gate.
- Keep consent and approval separate from conversation. You may explain a
  plan and its destinations, but you never grant consent, approve a step,
  submit a job, or imply that a chat message constitutes approval. Approval
  happens only through the existing plan approval UI; external data transfer
  requires explicit, scoped, short-lived consent.
- Output phrasing is unverified by design. Say "AI-generated phrasing only.
  No scientific measurement or citation is asserted." when summarizing work.

WORKFLOW CATALOG (authoritative: providers/workspace/catalog.js, a deprecated
compatibility shim that re-exports functions/api/workspace/catalog.js;
CATALOG_VERSION = "1.0.0-m7.4")

1. id: "16s-rrna-identification"
   execution_availability.state: "available-browser-and-local-agent"
   execution_availability.production_ready: true
   note: "Uses the existing public /api/ai/requests -> approve -> BLAST path with
   a single-use consent token for external egress. No new execution was added
   in M7.4."

2. id: "msa-phylogenetics"
   execution_availability.state: "partial-not-production-ready"
   execution_availability.production_ready: false
   note: "Evidence: docs/M7_3_PHYLOGENETICS_WORKFLOW_REPORT.md. A real MAFFT
   step executed once, but the full multi-step remote tree/retrieval/validation
   path is NOT verified. No live Galaxy call is made by this workspace API and
   no provider is newly activated in this milestone."

Never describe "msa-phylogenetics" as production ready. Never promise that
either workflow will run from this conversation.

REGISTERED TOOL IDS (from functions/api/ai/registry.tools.generated.js and
the Worker-side registry in functions/api/ai/registry.js):
phylogenetics.validate, phylogenetics.align, phylogenetics.tree,
phylogenetics.report, phylogenetics.workflow, sequence-stats.validate,
sequence-stats.profile, microbiome-16s.blast-parse,
microbiome-16s.taxonomy, ncbi.blastn.
Use no other tool id. If a needed capability is absent, say it is unavailable
rather than naming a plausible-sounding nonexistent tool.

When data is insufficient, output a plan proposal with clarifying questions
and limitations. The proposal is never executable on its own.`;

export const UNAVAILABLE_REASON = "no_enabled_llm_provider";
export const UNAVAILABLE_TYPE = "assistant_provider_unavailable";
export const MAX_MESSAGE_CHARS = 4000;
export const MAX_CHAT_BODY_CHARS = 16 * 1024;

export const UNAVAILABLE_NOTICE =
  "AI chat is unavailable: no authorized model provider is configured for this deployment.";

// Activity states are those enumerated in docs/ASSISTANT_UX_DESIGN.md §2.4.
// No state is active until an observed gateway/control-plane event exists.
export const ACTIVITY_STAGES = [
  "understanding", "preparing", "reviewing_evidence", "preparing_plan",
  "awaiting_approval", "executing_approved", "retrieving", "validating"
];

function unavailablePayload() {
  return {
    available: false,
    type: UNAVAILABLE_TYPE,
    reason: UNAVAILABLE_REASON,
    candidate_provider: "ninerouter",
    execution_mode: "real",
    generated_at: nowIso(),
    notice: UNAVAILABLE_NOTICE,
    stages: ACTIVITY_STAGES.map((id) => ({ id, state: "not_started" }))
  };
}

function typedError(message, status, request, extra = {}) {
  return jsonResponse({
    error: String(message),
    type: UNAVAILABLE_TYPE,
    reason: UNAVAILABLE_REASON,
    available: false,
    generated: false,
    execution_mode: "real",
    generated_at: nowIso(),
    notice: UNAVAILABLE_NOTICE,
    detail: "No response was generated. No model provider was contacted."
  }, status, request, { "X-Assistant-Error": UNAVAILABLE_TYPE, ...extra });
}

// GET /api/assistant/status
export async function onStatus(context) {
  const denied = requireMethod(context.request, "GET", "GET");
  if (denied) return denied;
  // Provider flags, URLs and keys are never read, echoed or inferred here.
  return jsonResponse(unavailablePayload(), 200, context.request);
}

// POST /api/assistant/chat
export async function onChat(context) {
  const denied = requireMethod(context.request, "POST", "POST");
  if (denied) return denied;
  const { request } = context;

  const { payload, error } = await readJsonBody(request, MAX_CHAT_BODY_CHARS);
  if (error) {
    return typedError(error, 400, request, { "X-Assistant-Error": "assistant_invalid_request" });
  }

  // Duplicate/alias content fields are rejected instead of being silently
  // merged. A browser cannot supply a system prompt or choose a provider.
  for (const field of ["system", "model", "provider", "messages", "content"]) {
    if (Object.hasOwn(payload, field)) {
      return typedError(`Unsupported field: ${field}.`, 400, request, { "X-Assistant-Error": "assistant_invalid_request" });
    }
  }
  if (typeof payload.message !== "string") {
    return typedError("message must be text.", 400, request, { "X-Assistant-Error": "assistant_invalid_request" });
  }
  if (payload.message.length > MAX_MESSAGE_CHARS) {
    return typedError(`message is too long (${MAX_MESSAGE_CHARS} character limit).`, 400, request, { "X-Assistant-Error": "assistant_invalid_request" });
  }
  const message = safeString(payload.message, MAX_MESSAGE_CHARS);
  if (!message) {
    return typedError("message must be non-empty text.", 400, request, { "X-Assistant-Error": "assistant_invalid_request" });
  }
  if (payload.conversation_id !== undefined &&
      (typeof payload.conversation_id !== "string" || payload.conversation_id.length > 100)) {
    return typedError("conversation_id is invalid.", 400, request, { "X-Assistant-Error": "assistant_invalid_request" });
  }
  if (payload.project_context !== undefined &&
      (typeof payload.project_context !== "string" || !/^(proj|ds)_[0-9a-f]{16}$/.test(payload.project_context))) {
    return typedError("project_context must be a public project or dataset id.", 400, request, { "X-Assistant-Error": "assistant_invalid_request" });
  }

  // Input is validated, then the request fails closed. There is no provider
  // call, no reservation and no response text: nothing is generated here.
  return typedError(UNAVAILABLE_NOTICE, 503, request);
}

// Alias kept so a single Function-style entry point is also usable.
export async function onRequest(context) {
  const path = new URL(context.request.url).pathname;
  if (/\/chat\/?$/.test(path)) return onChat(context);
  if (/\/status\/?$/.test(path)) return onStatus(context);
  return errorResponse("Assistant route not found.", 404, context.request);
}
