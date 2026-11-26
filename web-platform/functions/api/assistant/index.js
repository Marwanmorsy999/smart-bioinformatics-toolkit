// S Bio Assistant gateway — real 9Router-backed chat with a bounded,
// allowlisted local tool loop. No key, URL or other provider configuration is
// ever read into a response. Nothing is generated when the provider is absent,
// unreachable or in error, and no scientific value is invented by this module.

import {
  jsonResponse, errorResponse, requireMethod, readJsonBody,
  safeString, nowIso
} from "../ai/_lib.js";
import { createAdapter } from "../../../providers/ninerouter/index.js";
import { getAssistantToolDefinitions, executeTool } from "./tools.js";

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

export const ACTIVITY_STAGES = [
  "understanding", "preparing", "reviewing_evidence", "preparing_plan",
  "awaiting_approval", "executing_approved", "retrieving", "validating"
];

export const PROVIDER_ID = "ninerouter";
export const MAX_TOOL_ITERATIONS = 4;
export const MAX_HISTORY_MESSAGES = 8;

const GENERATED_NOTICE =
  "AI-generated phrasing only. No scientific measurement or citation is asserted.";

const TOOL_USE_GUIDANCE = `TOOL USE (server-side guidance; the browser cannot change this)
- Only the two function tools declared in this request may be called. Never invent a tool id, argument, result or number.
- Tool results are real Worker computations. Quote only the values they actually contain, and describe them as unverified tool output, not as scientific truth.
- ncbi.blastn and every external or approval-gated capability are NOT executable from this chat. You may describe them as catalog capabilities, but any use requires the existing plan approval UI and an explicit, scoped, single-use consent token. Never claim to have executed, approved or consented to them.
- If a requested value was not returned by a tool, say you cannot determine it. Do not fill gaps with plausible-sounding values.`;

class AssistantError extends Error {
  constructor(code, message, status = 502, reason = code) {
    super(message);
    this.name = "AssistantError";
    this.code = code;
    this.reason = reason;
    this.status = status;
  }
}

function stagesFor(states = []) {
  const observed = new Set(states);
  return ACTIVITY_STAGES.map((id) => ({ id, state: observed.has(id) ? "completed" : "not_started" }));
}

function unavailablePayload(reason = UNAVAILABLE_REASON, detail = null) {
  return {
    available: false,
    type: UNAVAILABLE_TYPE,
    reason,
    detail,
    provider: PROVIDER_ID,
    reachable: false,
    auth_ok: null,
    model_count: 0,
    selected_model: null,
    tool_calling: false,
    candidate_provider: PROVIDER_ID,
    execution_mode: "real",
    generated_at: nowIso(),
    notice: UNAVAILABLE_NOTICE,
    stages: stagesFor()
  };
}

function classifyError(error) {
  const status = Number(error?.status) || 0;
  const code = safeString(error?.code ?? error?.reason, 120).toLowerCase();
  const name = safeString(error?.name, 80);
  if (error instanceof AssistantError) {
    return {
      reason: error.reason,
      code: error.code,
      status: error.status,
      auth_ok: null,
      type: "assistant_provider_error",
      message: error.message
    };
  }
  if (status === 401 || status === 403 || /auth|unauthor|api_key|invalid_token/.test(code)) {
    return { reason: "auth_failed", code: "auth_failed", status: 502, auth_ok: false, type: "assistant_provider_auth_failed", message: "The provider rejected the configured credentials. No response was generated." };
  }
  if (name === "AbortError") {
    return { reason: "request_aborted", code: "request_aborted", status: 504, auth_ok: null, type: "assistant_provider_aborted", message: "The request was stopped. No response was generated." };
  }
  if (name === "TimeoutError" || /timeout|timed_out/.test(code)) {
    return { reason: "timeout", code: "provider_timeout", status: 504, auth_ok: null, type: "assistant_provider_timeout", message: "The provider did not respond in time. No response was generated." };
  }
  if (code === "provider_unavailable" || code === "model_required") {
    return { reason: code, code, status: 503, auth_ok: null, type: UNAVAILABLE_TYPE, message: "The provider is unavailable. No response was generated." };
  }
  return { reason: "connection_failed", code: "connection_failed", status: 502, auth_ok: null, type: UNAVAILABLE_TYPE, message: "The provider could not be reached. No response was generated." };
}

function typedError(message, status, request, extra = {}, override = {}) {
  const reason = override.reason ?? UNAVAILABLE_REASON;
  return jsonResponse({
    error: String(message),
    type: override.type ?? UNAVAILABLE_TYPE,
    reason,
    available: false,
    generated: false,
    execution_mode: "real",
    generated_at: nowIso(),
    notice: override.notice ?? UNAVAILABLE_NOTICE,
    detail: override.detail ?? "No response was generated. No model provider was contacted.",
    ...(override.extra ?? {})
  }, status, request, { "X-Assistant-Error": override.header ?? UNAVAILABLE_TYPE, ...extra });
}

function providerContext(env, request) {
  return {
    fetch: typeof env?.FETCH_IMPL === "function" ? env.FETCH_IMPL : undefined,
    signal: request?.signal ?? null
  };
}

function validateHistory(payload) {
  if (payload.history === undefined) return [];
  if (!Array.isArray(payload.history) || payload.history.length > MAX_HISTORY_MESSAGES) {
    return { error: `history must be an array of at most ${MAX_HISTORY_MESSAGES} messages.` };
  }
  const history = [];
  for (const item of payload.history) {
    if (!item || typeof item !== "object" || Array.isArray(item)) return { error: "Each history item must be an object." };
    if (item.role !== "user" && item.role !== "assistant") return { error: "history roles must be user or assistant." };
    if (typeof item.content !== "string" || item.content.length > MAX_MESSAGE_CHARS) {
      return { error: "history content must be text within the message limit." };
    }
    history.push({ role: item.role, content: safeString(item.content, MAX_MESSAGE_CHARS) });
  }
  return history;
}

// GET /api/assistant/status
export async function onStatus(context) {
  const denied = requireMethod(context.request, "GET", "GET");
  if (denied) return denied;
  const env = context.env ?? {};
  const adapter = createAdapter(env);
  const config = adapter.config();
  if (!config.enabled || !config.configured) {
    const detail = config.enabled ? "missing_configuration" : "feature_flag_disabled";
    return jsonResponse({
      ...unavailablePayload(UNAVAILABLE_REASON, detail),
      enabled: config.enabled,
      configured: config.configured
    }, 200, context.request);
  }
  try {
    const ctx = providerContext(env, context.request);
    // One live discovery call is authoritative; healthCheck() would repeat it.
    const list = await adapter.models(ctx);
    const reachable = list.length > 0;
    const selected = config.selected_model ?? list[0]?.id ?? null;
    const modelInfo = list.find((item) => item.id === selected) ?? list[0] ?? null;
    return jsonResponse({
      available: reachable,
      provider: PROVIDER_ID,
      reason: reachable ? null : "provider_unavailable",
      reachable,
      auth_ok: reachable ? true : null,
      model_count: list.length,
      selected_model: selected,
      tool_calling: reachable && getAssistantToolDefinitions().length === 2,
      tool_calling_source: "worker allowlist; model capability is not advertised by /v1/models",
      model: modelInfo
        ? { id: modelInfo.id, name: modelInfo.name, source: modelInfo.source, discovery_mode: modelInfo.discovery_mode }
        : null,
      models_sample: list.slice(0, 5).map((item) => item.id),
      source: "ninerouter:/v1/models",
      generated_at: nowIso(),
      stages: stagesFor(),
      // Legacy fields retained for existing clients.
      candidate_provider: PROVIDER_ID,
      execution_mode: "real",
      notice: reachable ? GENERATED_NOTICE : UNAVAILABLE_NOTICE,
      enabled: true,
      configured: true,
      ...(reachable ? {} : { type: UNAVAILABLE_TYPE })
    }, 200, context.request);
  } catch (error) {
    const classified = classifyError(error);
    return jsonResponse({
      ...unavailablePayload(classified.reason, classified.reason),
      auth_ok: classified.auth_ok,
      enabled: true,
      configured: true
    }, 200, context.request);
  }
}

function toolCallId(call, index) {
  return safeString(call.id, 200) || `local_tool_call_${index}`;
}

// Shared by the JSON and SSE paths. Every tool result is a real Worker
// computation; tool failure is reported to the model as data, never faked.
async function runToolLoop({ adapter, ctx, messages, useStream, sink }) {
  const definitions = getAssistantToolDefinitions();
  const toolChoice = definitions.length ? "auto" : undefined;
  const toolActivity = [];
  const states = [];
  let usage;
  let model = null;
  let finishReason = null;
  let reply = "";
  let resultCard = null;
  let sawDone = false;
  let metaSent = false;

  for (let iteration = 0; iteration < MAX_TOOL_ITERATIONS; iteration += 1) {
    const request = { messages, tools: definitions, tool_choice: toolChoice };
    let round;
    if (useStream) {
      const session = await adapter.openChatStream(request, ctx);
      try {
        // Relay each genuine upstream frame the instant it is parsed. No round
        // is drained before the browser sees its content deltas.
        for await (const event of session.events()) {
          if (event.kind === "done") { sawDone = true; continue; }
          if (event.kind === "invalid") continue;
          if (event.kind !== "chunk") continue;
          // Tool-call fragments become tool events, never browser text frames.
          if (typeof event.raw === "string" && !event.has_tool_delta) {
            if (!metaSent) {
              sink.meta({ model: event.model ?? session.summary().model });
              metaSent = true;
            }
            sink.delta(event.raw);
          }
        }
        round = session.summary();
      } finally {
        session.cleanup();
      }
      model = round.model ?? model;
      usage = round.usage ?? usage;
      finishReason = round.finish_reason ?? null;
    } else {
      round = await adapter.chat(request, ctx);
      model = round.model ?? model;
      usage = round.usage ?? usage;
      finishReason = round.finish_reason ?? null;
    }

    const calls = round.tool_calls ?? [];
    if (!calls.length) {
      // Streaming frames were already delivered while iterating upstream.
      if (!useStream) reply = safeString(round.text, 20_000);
      return {
        reply, model, usage, finish_reason: finishReason, tool_activity: toolActivity,
        result_card: resultCard, states, iterations: iteration + 1,
        saw_done: sawDone, meta_sent: metaSent
      };
    }

    if (iteration === MAX_TOOL_ITERATIONS - 1) {
      throw new AssistantError("tool_loop_limit", "The model requested more tool rounds than permitted. No reply was fabricated.", 502);
    }
    states.push("reviewing_evidence");
    const assistantCalls = calls.map((call, index) => ({
      id: toolCallId(call, index),
      type: "function",
      function: { name: safeString(call.function?.name, 200), arguments: safeString(call.function?.arguments, 12000) }
    }));
    messages.push({ role: "assistant", content: safeString(round.text, 20_000), tool_calls: assistantCalls });

    const toolMessages = [];
    for (let index = 0; index < calls.length; index += 1) {
      const call = calls[index];
      let args = {};
      try {
        const parsed = JSON.parse(call.function?.arguments ?? "");
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) args = parsed;
      } catch { args = {}; }
      const result = executeTool(call.function?.name, args);
      const event = {
        tool_id: result.tool_id,
        tool_name: safeString(call.function?.name, 200),
        status: result.ok ? "ok" : "error",
        execution_location: "worker",
        at: nowIso()
      };
      if (result.ok) {
        event.evidence = result.evidence;
        event.result_card = result.result_card;
        resultCard = result.result_card;
      } else {
        event.error = { code: result.error.code, message: result.error.message };
      }
      toolActivity.push(event);
      toolMessages.push({
        role: "tool",
        tool_call_id: assistantCalls[index].id,
        content: JSON.stringify(result.ok
          ? { ok: true, tool_id: result.tool_id, output: result.output, evidence: result.evidence, limitations: result.limitations, source: result.source }
          : { ok: false, tool_id: result.tool_id, error: result.error })
      });
      if (sink) sink.tool(event);
    }
    messages.push(...toolMessages);
    states.push("validating");
  }
  throw new AssistantError("tool_loop_limit", "The model requested more tool rounds than permitted. No reply was fabricated.", 502);
}

// A usage object with only a model name has no counters; do not present it as
// token usage. Nothing is filled with zeros or estimated values.
function reportedUsage(usage) {
  if (!usage || !["input_tokens", "output_tokens", "total_tokens"].some((key) => Number.isFinite(usage[key]))) return null;
  return usage;
}

function chatPayload(out, conversationId) {
  const usage = reportedUsage(out.usage);
  return {
    reply: out.reply,
    conversation_id: conversationId ?? null,
    provider: PROVIDER_ID,
    model: out.model,
    usage,
    usage_source: usage ? "response.usage" : "not_reported",
    finish_reason: out.finish_reason,
    evidence_status: "unverified",
    validated: false,
    generated: true,
    notice: GENERATED_NOTICE,
    result_card: out.result_card,
    tool_activity: out.tool_activity,
    stages: stagesFor(out.states),
    iterations: out.iterations,
    generated_at: nowIso()
  };
}

function sseHeaders(request) {
  // Reuse jsonResponse so security and same-origin CORS headers stay identical.
  return jsonResponse({}, 200, request, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-store, no-transform",
    "X-Accel-Buffering": "no"
  }).headers;
}

// A real SSE response: upstream frames are relayed verbatim as they arrive;
// only tool activity, meta and the final terminator are gateway-generated.
function streamResponse(request, runner) {
  const encoder = new TextEncoder();
  let closed = false;
  let controllerRef = null;
  const close = () => {
    if (closed) return;
    closed = true;
    if (request.signal) request.signal.removeEventListener("abort", close);
    try { controllerRef?.close(); } catch { /* already closed */ }
  };
  const stream = new ReadableStream({
    start(controller) {
      controllerRef = controller;
      if (request.signal?.aborted) { close(); return; }
      request.signal?.addEventListener("abort", close, { once: true });
      let metaEmitted = false;
      const sink = {
        send(frame) {
          if (closed) return;
          try { controller.enqueue(encoder.encode(frame)); } catch { close(); }
        },
        // Verbatim upstream data frame; no re-encoding of the model's text.
        delta(raw) { sink.send(`data: ${raw}\n\n`); },
        meta(data) {
          if (metaEmitted) return;
          metaEmitted = true;
          sink.send(`event: meta\ndata: ${JSON.stringify({
            provider: PROVIDER_ID,
            model: data?.model ?? null,
            evidence_status: "unverified",
            generated: true,
            notice: GENERATED_NOTICE
          })}\n\n`);
        },
        tool(event) { sink.send(`event: tool\ndata: ${JSON.stringify(event)}\n\n`); },
        close
      };
      Promise.resolve()
        .then(() => runner(sink))
        .catch((error) => {
          const classified = classifyError(error);
          sink.send(`event: error\ndata: ${JSON.stringify({
            error: classified.message,
            type: classified.type,
            reason: classified.reason,
            available: false,
            generated: false,
            notice: UNAVAILABLE_NOTICE
          })}\n\n`);
          sink.send("data: [DONE]\n\n");
        })
        .finally(close);
    },
    cancel() {
      closed = true;
      if (request.signal) request.signal.removeEventListener("abort", close);
    }
  });
  return new Response(stream, { status: 200, headers: sseHeaders(request) });
}

// POST /api/assistant/chat
export async function onChat(context) {
  const denied = requireMethod(context.request, "POST", "POST");
  if (denied) return denied;
  const { request, env } = context;

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
  const history = validateHistory(payload);
  if (history.error) {
    return typedError(history.error, 400, request, { "X-Assistant-Error": "assistant_invalid_request" });
  }

  const adapter = createAdapter(env ?? {});
  const config = adapter.config();
  if (!config.enabled || !config.configured) {
    return typedError(UNAVAILABLE_NOTICE, 503, request, {}, {
      detail: config.enabled ? "Provider credentials or base URL are not configured." : "The provider feature flag is disabled."
    });
  }

  const messages = [
    { role: "system", content: `${ASSISTANT_SYSTEM_INSTRUCTION}\n\n${TOOL_USE_GUIDANCE}` },
    ...history,
    { role: "user", content: message }
  ];
  const ctx = providerContext(env, request);
  const useStream = payload.stream === true || String(request.headers.get("Accept") ?? "").includes("text/event-stream");
  const conversationId = payload.conversation_id ?? null;

  if (useStream) {
    return streamResponse(request, async (sink) => {
      const out = await runToolLoop({ adapter, ctx, messages, useStream: true, sink });
      if (!out.meta_sent) sink.meta({ model: out.model });
      // Exactly one terminator for the whole loop. If upstream sent [DONE]
      // this relays it; otherwise it is a protocol terminator only — no text
      // or token count is ever simulated.
      sink.send("data: [DONE]\n\n");
    });
  }

  try {
    const out = await runToolLoop({ adapter, ctx, messages, useStream: false, sink: null });
    return jsonResponse(chatPayload(out, conversationId), 200, request);
  } catch (caught) {
    const classified = classifyError(caught);
    return typedError(classified.message, classified.status, request, {
      "X-Assistant-Error": classified.type
    }, {
      type: classified.type,
      reason: classified.reason,
      notice: UNAVAILABLE_NOTICE,
      detail: "No response was generated. Tool results, if any, were not presented as a reply.",
      extra: { auth_ok: classified.auth_ok, provider: PROVIDER_ID }
    });
  }
}

// Alias kept so a single Function-style entry point is also usable.
export async function onRequest(context) {
  const path = new URL(context.request.url).pathname;
  if (/\/chat\/?$/.test(path)) return onChat(context);
  if (/\/status\/?$/.test(path)) return onStatus(context);
  return errorResponse("Assistant route not found.", 404, context.request);
}
