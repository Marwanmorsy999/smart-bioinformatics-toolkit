// M7 9Router provider adapter (remote OpenAI-compatible endpoint).
//
// The endpoint MUST be supplied by the operator through NINEROUTER_BASE_URL.
// There is no loopback/default endpoint anywhere in this adapter. The key,
// model and timeout also come from env only.
//
// Implemented, OpenAI-compatible endpoints:
//   GET  /v1/models            -> live model discovery
//   POST /v1/chat/completions  -> chat, chat_stream (SSE) and plan (JSON mode)
//
// Token usage is read from response.usage and never synthesized. Streaming
// usage is captured only if the provider includes a usage chunk; no quota is
// invented. Long-running jobs, artifact downloads and cancellation are not
// part of a chat-completions API and are reported as unsupported rather than
// faked. Completed in-memory job records are best-effort (D1 is durable).
//
// SAFETY: a fixed system guard forbids scientific measurements and citations.
// This provider is an orchestration / structured-reasoning aid only; all
// scientific values must come from validated tools and evidence records.

import {
  OPERATIONS, AVAILABILITY, DISCOVERY_MODE, JOB_STATUS, normalizeProviderError
} from "../common/contract.js";
import {
  asArray, asObject, failure, jobIdFrom, joinUrl, makeId, makeNow,
  normalizeCallArgs, normalizeTokenUsage, pick, requestJson, safeId, safeString
} from "../common/normalize.js";
import { ProviderHttpError } from "../common/retry.js";

const PROVIDER = "ninerouter";

export const SYSTEM_GUARD = Object.freeze(
  "You are an orchestration and structured-reasoning assistant. You MUST NOT generate, estimate or invent scientific measurements, numeric results, statistics, p-values, accession numbers, sequences, citations or references. Never present a factual scientific value unless it was supplied to you in the user message by a validated tool or evidence record. When asked for measurements or citations, state that they must come from executed tools and evidence records. Return only planning, routing, classification or structured-reasoning output."
);

const ROUTER_OPERATIONS = Object.freeze([
  OPERATIONS.HEALTH_CHECK,
  OPERATIONS.GET_CAPABILITIES,
  OPERATIONS.GET_LIMITS,
  OPERATIONS.GET_USAGE,
  OPERATIONS.CHAT,
  OPERATIONS.CHAT_STREAM,
  OPERATIONS.PLAN,
  OPERATIONS.SUBMIT_JOB,
  OPERATIONS.JOB_STATUS
]);

function timeoutMsFrom(env) {
  // NINEROUTER_TIMEOUT is expressed in seconds (matching the documented
  // AI_LLM_TIMEOUT_SECONDS convention). Values above 300 are treated as
  // milliseconds only when they exceed the seconds ceiling.
  let seconds = Number(env?.NINEROUTER_TIMEOUT);
  if (!Number.isFinite(seconds) || seconds <= 0) seconds = 20;
  if (seconds > 300) seconds = Math.round(seconds / 1000);
  return Math.min(Math.max(seconds, 1), 300) * 1000;
}

const MESSAGE_ROLES = Object.freeze(["system", "user", "assistant", "tool"]);
const MAX_MESSAGES = 20;
const MAX_MESSAGE_CONTENT = 12000;
const MAX_TOOL_DEFINITIONS = 32;

function badRequest(code, message) {
  return new ProviderHttpError({ status: 400, code, message, retryable: false });
}

function normalizeToolCalls(raw) {
  return asArray(raw).map((item, index) => {
    const source = asObject(item);
    const fn = asObject(source.function);
    return {
      id: safeString(source.id, 200),
      type: safeString(source.type, 40) || "function",
      index: Number.isInteger(source.index) ? source.index : index,
      function: {
        name: safeString(fn.name, 200),
        arguments: safeString(fn.arguments, 12000)
      }
    };
  }).filter((call) => call.function.name);
}

// Accumulate OpenAI streaming tool-call deltas. Fragments arrive keyed by the
// `index` field; nothing is invented when a provider omits an id or name.
export function accumulateToolCall(target, delta) {
  const source = asObject(delta);
  const index = Number.isInteger(source.index) ? source.index : target.size;
  const entry = target.get(index) ?? {
    id: "", type: "function", index, function: { name: "", arguments: "" }
  };
  if (source.id) entry.id = safeString(source.id, 200);
  if (source.type) entry.type = safeString(source.type, 40);
  const fn = asObject(source.function);
  if (fn.name) entry.function.name = safeString(fn.name, 200);
  if (fn.arguments) entry.function.arguments = safeString(entry.function.arguments + fn.arguments, 12000);
  target.set(index, entry);
  return entry;
}

/**
 * Parse an upstream SSE response into normalized events. Handles partial
 * lines, `[DONE]`, malformed JSON, upstream error frames and client aborts.
 * The caller owns response.body and MUST close the reader (the generator does
 * this in its finally block) and call the request cleanup when finished.
 */
export async function* parseChatStream(response, signal) {
  const reader = response?.body?.getReader?.();
  if (!reader) {
    throw new ProviderHttpError({
      status: Number(response?.status) || 0,
      code: "stream_unavailable",
      message: "Provider stream is unavailable.",
      retryable: false
    });
  }
  const decoder = new TextDecoder();
  let buffer = "";
  const toEvent = (rawLine) => {
    const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;
    if (!line.startsWith("data:")) return null; // comments / event / id frames
    const data = line.slice(5).trim();
    if (!data) return null;
    if (data === "[DONE]") return { __done: true, raw: "[DONE]" };
    let parsed;
    try { parsed = JSON.parse(data); } catch { return { __invalid: true }; }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return { __invalid: true };
    if (parsed.error) {
      const detail = asObject(parsed.error);
      return {
        __error: {
          code: safeString(detail.code ?? detail.type ?? "provider_stream_error", 120),
          message: safeString(detail.message ?? "Provider stream error.", 200)
        }
      };
    }
    return { ...parsed, raw: data };
  };
  try {
    for (;;) {
      if (signal?.aborted) {
        const error = new Error("Provider request aborted.");
        error.name = "AbortError";
        throw error;
      }
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let index;
      while ((index = buffer.indexOf("\n")) !== -1) {
        const event = toEvent(buffer.slice(0, index));
        buffer = buffer.slice(index + 1);
        if (event) yield event;
      }
    }
    if (buffer.trim()) {
      const event = toEvent(buffer);
      if (event) yield event;
    }
  } finally {
    try { await reader.cancel(); } catch { /* stream already closed */ }
  }
}

export function createAdapter(env = {}, deps = {}) {
  const enabled = env?.NINEROUTER_ENABLED === "true";
  const baseUrl = safeString(env?.NINEROUTER_BASE_URL).trim();
  const apiKey = safeString(env?.NINEROUTER_API_KEY).trim(); // secret
  const configuredModel = safeString(env?.NINEROUTER_MODEL).trim();
  const configured = Boolean(baseUrl && apiKey);
  const defaultTimeout = timeoutMsFrom(env);
  const discoveredModels = [];
  const completed = new Map();
  const counters = { input_tokens: 0, output_tokens: 0, total_tokens: 0, requests: 0 };

  // The operator-supplied base URL already carries the /v1 prefix in staging.
  // Normalise it once so appending an endpoint can never double the prefix.
  function apiUrl(path) {
    const root = baseUrl.replace(/\/+$/, "");
    const hasVersion = /(?:^|\/)v1$/.test(root);
    return joinUrl(hasVersion ? root : `${root}/v1`, path);
  }

  function availability() {
    if (!enabled) return AVAILABILITY.DISABLED;
    if (!configured) return AVAILABILITY.UNAVAILABLE;
    return AVAILABILITY.UNKNOWN;
  }

  function fetcher(ctx) {
    return ctx?.fetch ?? deps.fetch ?? globalThis.fetch;
  }

  async function call(method, path, body, ctx = {}, extra = {}) {
    const headers = { Authorization: `Bearer ${apiKey}`, Accept: "application/json" };
    let payload;
    if (body !== undefined) {
      headers["Content-Type"] = "application/json";
      payload = JSON.stringify(body);
    }
    const opts = {
      timeoutMs: Number(ctx?.timeoutMs) > 0 ? Number(ctx.timeoutMs) : defaultTimeout,
      signal: ctx?.signal ?? null,
      attempts: extra.attempts ?? 3,
      sleep: ctx?.sleep ?? null
    };
    if (extra.parse) opts.parse = extra.parse;
    return requestJson(PROVIDER, fetcher(ctx), apiUrl(path), { method, headers, body: payload }, opts);
  }

  function unwrap(result) {
    const body = asObject(result?.body);
    if (body.error && !body.choices) {
      const detail = asObject(body.error);
      throw new ProviderHttpError({
        status: Number(result?.response?.status) || 502,
        code: safeString(detail.code ?? detail.type ?? body.error, 120) || "provider_error",
        message: "ninerouter returned an error object",
        retryable: false
      });
    }
    return body;
  }

  function normalizeModel(raw) {
    const item = asObject(raw);
    const id = safeString(item.id, 300);
    return {
      id,
      name: safeString(item.name, 300) || id,
      version: safeString(item.version, 100),
      description: safeString(item.description, 1000),
      input_types: asArray(item.input_types).map((type) => safeString(type, 100)),
      output_types: asArray(item.output_types).map((type) => safeString(type, 100)),
      parameters: asObject(item.parameters ?? {}),
      available: Boolean(id),
      executable: Boolean(id && enabled && configured),
      source: "ninerouter:/v1/models",
      discovery_mode: DISCOVERY_MODE.LIVE
    };
  }

  async function models(ctx) {
    const body = unwrap(await call("GET", "models", undefined, ctx));
    const list = asArray(body.data ?? body.models ?? body).map(normalizeModel).filter((item) => item.id);
    discoveredModels.length = 0;
    discoveredModels.push(...list.map((item) => item.id));
    return list;
  }

  function selectedModel(request) {
    return safeString(asObject(request).model, 300)
      || configuredModel
      || discoveredModels[0]
      || null;
  }

  // Accept either the legacy {message, system} shape used by /api/providers/chat
  // or an explicit OpenAI-style messages array (bounded and role-checked).
  function normalizeMessages(request) {
    const source = asObject(request);
    const list = [{ role: "system", content: SYSTEM_GUARD }];
    const extraSystem = safeString(source.system, 4000);
    if (extraSystem) list.push({ role: "system", content: extraSystem });
    const provided = asArray(source.messages);
    if (provided.length) {
      if (provided.length > MAX_MESSAGES) {
        throw badRequest("messages_limit", `At most ${MAX_MESSAGES} messages are accepted.`);
      }
      for (const raw of provided) {
        const item = asObject(raw);
        const role = safeString(item.role, 40);
        if (!MESSAGE_ROLES.includes(role)) throw badRequest("invalid_message_role", "Unsupported message role.");
        if (typeof item.content !== "string" || item.content.length > MAX_MESSAGE_CONTENT) {
          throw badRequest("invalid_message_content", "Message content must be text within the size limit.");
        }
        const normalized = { role, content: safeString(item.content, MAX_MESSAGE_CONTENT) };
        if (role === "assistant" && item.tool_calls !== undefined) {
          if (!Array.isArray(item.tool_calls)) throw badRequest("invalid_tool_calls", "tool_calls must be an array.");
          normalized.tool_calls = normalizeToolCalls(item.tool_calls);
        }
        if (role === "tool" && item.tool_call_id !== undefined) {
          normalized.tool_call_id = safeString(item.tool_call_id, 200);
        }
        list.push(normalized);
      }
    } else {
      list.push({ role: "user", content: safeString(source.message, 8000) });
    }
    return list;
  }

  function normalizeTools(value) {
    if (value === undefined) return [];
    if (!Array.isArray(value) || value.length > MAX_TOOL_DEFINITIONS) {
      throw badRequest("invalid_tools", `tools must be an array of at most ${MAX_TOOL_DEFINITIONS} definitions.`);
    }
    return value.map((raw) => {
      const item = asObject(raw);
      const fn = asObject(item.function);
      const name = safeString(fn.name, 200);
      if (safeString(item.type, 40) !== "function" || !name) {
        throw badRequest("invalid_tools", "Each tool must be a function definition with a name.");
      }
      const parameters = fn.parameters && typeof fn.parameters === "object" && !Array.isArray(fn.parameters)
        ? fn.parameters : { type: "object", properties: {} };
      return { type: "function", function: { name, description: safeString(fn.description, 2000), parameters } };
    });
  }

  function normalizeToolChoice(value) {
    if (value === undefined) return undefined;
    if (typeof value === "string" && ["auto", "none", "required"].includes(value)) return value;
    const item = asObject(value);
    const name = safeString(asObject(item.function).name, 200);
    if (safeString(item.type, 40) === "function" && name) return { type: "function", function: { name } };
    throw badRequest("invalid_tool_choice", "tool_choice must be auto, none, required or a named function.");
  }

  function buildChatBody(request, { stream = false, jsonMode = false } = {}) {
    const model = selectedModel(request);
    if (!model) throw badRequest("model_required", "No model configured or discovered.");
    const body = { model, messages: normalizeMessages(request) };
    const tools = normalizeTools(request.tools);
    if (tools.length) body.tools = tools;
    const toolChoice = normalizeToolChoice(request.tool_choice);
    if (toolChoice !== undefined) body.tool_choice = toolChoice;
    if (jsonMode) body.response_format = { type: "json_object" };
    if (stream) body.stream = true;
    return { body, model };
  }

  function normalizeCompletion(data, fallbackModel) {
    const choice = asObject(asArray(data.choices)[0]);
    const message = asObject(choice.message);
    return {
      text: safeString(message.content, 20_000),
      tool_calls: normalizeToolCalls(message.tool_calls),
      finish_reason: safeString(choice.finish_reason, 80) || null,
      usage: recordUsage(data, fallbackModel),
      model: safeString(data.model, 300) || fallbackModel
    };
  }

  function result(request, jobId, status, output = {}, extra = {}) {
    return {
      provider: PROVIDER,
      provider_job_id: safeString(jobId, 200) || makeId(extra.ctx, "router"),
      status,
      submitted_at: extra.submitted_at ?? null,
      output,
      ...(extra.error ? { error: extra.error } : {})
    };
  }

  function recordUsage(data, model) {
    const usage = normalizeTokenUsage(data.usage, data.model ?? model);
    if (!usage) return undefined;
    for (const key of ["input_tokens", "output_tokens", "total_tokens"]) {
      if (Number.isFinite(usage[key])) counters[key] += usage[key];
    }
    counters.requests += 1;
    return usage;
  }

  // Non-streaming chat used by the assistant tool loop. Errors are thrown so
  // callers can fail closed with a typed response instead of a fabricated text.
  async function chat(request = {}, ctx = {}) {
    const { body, model } = buildChatBody(request, { jsonMode: request.json_schema !== undefined });
    const data = unwrap(await call("POST", "chat/completions", body, ctx, { attempts: 2 }));
    return normalizeCompletion(data, model);
  }

  // A live stream session. events() yields every parsed upstream event as soon
  // as it arrives; summary() exposes accumulated tool-call deltas,
  // finish_reason and usage after iteration. Frames are never held back for
  // delayed delivery: callers relay them while iterating.
  function streamSession(response, cleanup, ctx = {}, fallbackModel = null) {
    const state = {
      toolDeltas: new Map(),
      text: "",
      finish_reason: null,
      usage: undefined,
      model: fallbackModel,
      saw_done: false,
      malformed_frames: 0
    };

    async function* events() {
      for await (const event of parseChatStream(response, ctx?.signal ?? null)) {
        if (event.__done) {
          state.saw_done = true;
          yield { kind: "done" };
          continue;
        }
        if (event.__invalid) {
          state.malformed_frames += 1;
          yield { kind: "invalid" };
          continue;
        }
        if (event.__error) {
          throw new ProviderHttpError({
            status: 502, code: event.__error.code, message: "Provider stream error.", retryable: false
          });
        }
        const choice = asArray(event.choices)[0];
        const delta = choice ? asObject(choice.delta) : {};
        const fragments = asArray(delta.tool_calls);
        const text = typeof delta.content === "string" ? delta.content.slice(0, 20_000) : null;
        if (text) state.text += text;
        for (const fragment of fragments) accumulateToolCall(state.toolDeltas, asObject(fragment));
        if (choice?.finish_reason) state.finish_reason = safeString(choice.finish_reason, 80);
        if (event.usage) {
          state.usage = normalizeTokenUsage(event.usage, event.model ?? state.model);
          if (state.usage) {
            for (const key of ["input_tokens", "output_tokens", "total_tokens"]) {
              if (Number.isFinite(state.usage[key])) counters[key] += state.usage[key];
            }
          }
        }
        if (event.model) state.model = safeString(event.model, 300);
        yield {
          kind: "chunk",
          raw: event.raw,
          text,
          has_tool_delta: fragments.length > 0,
          finish_reason: state.finish_reason,
          model: state.model,
          usage: state.usage
        };
      }
    }

    return {
      response,
      cleanup,
      events,
      summary() {
        return {
          text: state.text,
          tool_calls: [...state.toolDeltas.values()].filter((call) => call.function.name),
          finish_reason: state.finish_reason,
          usage: state.usage,
          model: state.model ?? null,
          saw_done: state.saw_done,
          malformed_frames: state.malformed_frames
        };
      }
    };
  }

  async function openChatStream(request = {}, ctx = {}) {
    const { body, model } = buildChatBody(request, { stream: true });
    const { response, cleanup } = await call("POST", "chat/completions", body, ctx, { parse: "stream", attempts: 2 });
    counters.requests += 1;
    return streamSession(response, cleanup, ctx, model);
  }

  function iterateChatStream(response, ctx = {}) {
    return streamSession(response, () => {}, ctx).events();
  }

  // Legacy buffered reader kept for submitJob/consumeChatStream callers.
  async function readChatStream(response, ctx = {}) {
    const session = streamSession(response, () => {}, ctx);
    const frames = [];
    for await (const event of session.events()) {
      if (event.kind === "chunk" && typeof event.raw === "string" && frames.length < 20_000) frames.push(event.raw);
      else if (event.kind === "done" && frames.length < 20_000) frames.push("[DONE]");
    }
    return { ...session.summary(), frames };
  }

  async function streamChat(request = {}, ctx = {}) {
    const session = await openChatStream(request, ctx);
    try {
      const frames = [];
      for await (const event of session.events()) {
        if (event.kind === "chunk" && typeof event.raw === "string" && frames.length < 20_000) frames.push(event.raw);
        else if (event.kind === "done" && frames.length < 20_000) frames.push("[DONE]");
      }
      const out = session.summary();
      return {
        text: out.text,
        structured: undefined,
        usage: out.usage,
        finish_reason: out.finish_reason,
        tool_calls: out.tool_calls,
        model: out.model,
        frames
      };
    } finally {
      session.cleanup();
    }
  }

  const adapter = {
    id: () => PROVIDER,

    // Configuration/status accessors deliberately expose no key and no URL.
    config() {
      return {
        provider: PROVIDER,
        enabled,
        configured,
        selected_model: configuredModel || discoveredModels[0] || null,
        model_count: discoveredModels.length,
        source: "environment"
      };
    },

    async status(ctx = {}) {
      const base = adapter.config();
      if (!enabled || !configured) {
        return { ...base, reachable: false, reason: enabled ? "missing_configuration" : "feature_flag_disabled" };
      }
      try {
        const health = await adapter.healthCheck(ctx);
        return {
          ...base,
          reachable: Boolean(health.ok),
          reason: health.ok ? "ok" : (safeString(health.reason, 120) || "provider_unavailable"),
          model_count: Math.max(base.model_count, Number(health.model_count) || 0)
        };
      } catch {
        return { ...base, reachable: false, reason: "provider_unavailable" };
      }
    },

    models(ctx = {}) { return models(ctx); },

    chat(request = {}, ctx = {}) { return chat(request, ctx); },

    // Live stream session: iterate session.events() to receive each upstream
    // event immediately; session.summary() holds the accumulated tool calls,
    // finish_reason and usage after iteration. cleanup() is mandatory.
    openChatStream(request = {}, ctx = {}) { return openChatStream(request, ctx); },

    // Async iterable over an already-open upstream SSE response.
    streamEvents(response, ctx = {}) { return iterateChatStream(response, ctx); },

    // Legacy shape: raw upstream SSE Response plus deadline cleanup.
    async streamChatResponse(request = {}, ctx = {}) {
      const session = await openChatStream(request, ctx);
      return { response: session.response, cleanup: session.cleanup, model: session.summary().model };
    },

    consumeChatStream(response, ctx = {}) { return readChatStream(response, ctx); },

    async healthCheck(ctx = {}) {
      if (!enabled) return { provider: PROVIDER, ok: false, status: AVAILABILITY.DISABLED, reason: "feature_flag_disabled", at: makeNow(ctx) };
      if (!configured) return { provider: PROVIDER, ok: false, status: AVAILABILITY.UNAVAILABLE, reason: "missing_configuration", at: makeNow(ctx) };
      try {
        const list = await models(ctx);
        const status = list.length ? AVAILABILITY.AVAILABLE : AVAILABILITY.DEGRADED;
        return {
          provider: PROVIDER, ok: status === AVAILABILITY.AVAILABLE, status,
          model_count: list.length, selected_model: selectedModel({}), at: makeNow(ctx)
        };
      } catch (error) {
        return { provider: PROVIDER, ok: false, status: AVAILABILITY.UNAVAILABLE, error: normalizeProviderError(PROVIDER, error, { at: makeNow(ctx) }), at: makeNow(ctx) };
      }
    },

    async getCapabilities(ctx = {}) {
      const at = makeNow(ctx);
      const empty = { provider: PROVIDER, availability: availability(), operations: [], tools: [], discovery_mode: DISCOVERY_MODE.UNAVAILABLE, at };
      if (!enabled || !configured) return empty;
      let tools = [];
      let live = false;
      try {
        tools = await models(ctx);
        live = tools.length > 0;
      } catch { /* no live catalog: advertise nothing */ }
      return {
        provider: PROVIDER,
        availability: live ? AVAILABILITY.AVAILABLE : AVAILABILITY.DEGRADED,
        operations: [...ROUTER_OPERATIONS],
        tools,
        discovery_mode: live ? DISCOVERY_MODE.LIVE : DISCOVERY_MODE.UNAVAILABLE,
        source: "ninerouter:/v1/models",
        at
      };
    },

    async getLimits(ctx = {}) {
      return {
        provider: PROVIDER,
        units: {
          requests: { total: null, used: counters.requests, remaining: null, unknown: true },
          tokens: { total: null, used: counters.total_tokens, remaining: null, unknown: true }
        },
        unknown: true,
        availability: availability(),
        source: "not_documented",
        discovery_mode: DISCOVERY_MODE.UNAVAILABLE,
        at: makeNow(ctx)
      };
    },

    validateRequest(operation, request = {}) {
      const normalized = pick(asObject(request), [
        "operation", "message", "system", "messages", "tools", "tool_choice",
        "conversation_id", "model", "json_schema", "inputs", "params",
        "job_id", "provider_job_id"
      ]);
      normalized.operation = safeString(operation ?? normalized.operation, 80);
      normalized.message = safeString(normalized.message, 8000);
      normalized.model = safeString(normalized.model, 300);
      const bad = (error) => ({ valid: false, error, normalized });
      for (const field of ["job_id", "provider_job_id"]) {
        if (normalized[field] !== undefined) {
          const id = safeId(normalized[field], { max: 200 });
          if (!id) return { valid: false, error: `malformed_${field}`, normalized };
          normalized[field] = id;
        }
      }
      if (!ROUTER_OPERATIONS.includes(normalized.operation)) return bad("operation_not_supported");
      if ([OPERATIONS.CHAT, OPERATIONS.CHAT_STREAM, OPERATIONS.PLAN, OPERATIONS.SUBMIT_JOB].includes(normalized.operation)
          && !normalized.message && !Array.isArray(normalized.messages)) return bad("message_required");
      if (normalized.operation === OPERATIONS.JOB_STATUS && !jobIdFrom(normalized)) return bad("job_id_required");
      if (normalized.json_schema !== undefined && typeof normalized.json_schema !== "object") return bad("json_schema_must_be_object");
      if (normalized.messages !== undefined) {
        try { normalizeMessages(normalized); }
        catch (error) { return bad(safeString(error?.code, 120) || "invalid_messages"); }
      }
      return { valid: true, error: null, normalized };
    },

    async submitJob(request = {}, ctx = {}) {
      const submittedAt = makeNow(ctx);
      const operation = safeString(request?.operation, 80) || OPERATIONS.CHAT;
      const checked = adapter.validateRequest(operation, request);
      if (!checked.valid) {
        return result(request, null, "failed", {}, {
          submitted_at: submittedAt,
          ctx,
          error: { provider: PROVIDER, code: "validation_error", message: checked.error, status: 400, retryable: false, at: submittedAt }
        });
      }
      const payload = checked.normalized;
      const model = selectedModel(payload);
      if (!model) {
        return result(payload, null, "failed", {}, {
          submitted_at: submittedAt,
          ctx,
          error: { provider: PROVIDER, code: "model_required", message: "No model configured or discovered.", status: 400, retryable: false, at: submittedAt }
        });
      }
      try {
        const isPlan = payload.operation === OPERATIONS.PLAN;
        const isStream = payload.operation === OPERATIONS.CHAT_STREAM;
        let output;
        if (isStream) {
          output = await streamChat(payload, ctx);
        } else {
          output = await chat(payload, ctx);
          if (isPlan && output.text) output.structured = JSON.parse(output.text);
        }
        const jobId = makeId(ctx, "router");
        const finalResult = result(payload, jobId, JOB_STATUS.SUCCEEDED, output, { submitted_at: submittedAt, ctx });
        completed.set(jobId, finalResult);
        return finalResult;
      } catch (error) {
        const normalized = normalizeProviderError(PROVIDER, error, { at: submittedAt });
        return result(payload, null, "failed", {}, { submitted_at: submittedAt, ctx, error: normalized });
      }
    },

    async getJobStatus(request = {}, ctx = {}) {
      const args = normalizeCallArgs(request, ctx);
      ctx = args.ctx;
      const jobId = jobIdFrom(args.request);
      const known = completed.get(jobId);
      if (known) return { provider: PROVIDER, provider_job_id: jobId, status: known.status, output: known.output, at: makeNow(ctx) };
      return { provider: PROVIDER, provider_job_id: jobId || null, status: JOB_STATUS.UNKNOWN, reason: "not_durable", at: makeNow(ctx) };
    },

    async cancelJob(request = {}, ctx = {}) {
      const args = normalizeCallArgs(request, ctx);
      return { provider: PROVIDER, provider_job_id: jobIdFrom(args.request) || null, ok: false, reason: "not_supported", at: makeNow(args.ctx) };
    },

    async getArtifacts(request = {}, ctx = {}) {
      const args = normalizeCallArgs(request, ctx);
      return { provider: PROVIDER, provider_job_id: jobIdFrom(args.request) || null, artifacts: [], ok: false, reason: "not_supported", at: makeNow(args.ctx) };
    },

    async getUsage(request = {}, ctx = {}) {
      const args = normalizeCallArgs(request, ctx);
      return {
        provider: PROVIDER,
        ok: true,
        usage: { ...counters },
        source: "response.usage",
        unknown_totals: true,
        provider_job_id: jobIdFrom(args.request) || null,
        at: makeNow(args.ctx)
      };
    }
  };

  return adapter;
}

export const createNinerouterAdapter = createAdapter;
export default createAdapter;
