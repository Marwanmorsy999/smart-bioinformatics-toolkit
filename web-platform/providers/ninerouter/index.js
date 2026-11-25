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
  normalizeCallArgs, normalizeTokenUsage, pick, readSse, requestJson, safeId, safeString
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
    return requestJson(PROVIDER, fetcher(ctx), joinUrl(baseUrl, path), { method, headers, body: payload }, opts);
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
    const body = unwrap(await call("GET", "/v1/models", undefined, ctx));
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

  function messages(request) {
    const list = [{ role: "system", content: SYSTEM_GUARD }];
    const extraSystem = safeString(asObject(request).system, 4000);
    if (extraSystem) list.push({ role: "system", content: extraSystem });
    list.push({ role: "user", content: safeString(asObject(request).message, 8000) });
    return list;
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

  async function streamChat(body, ctx) {
    const { response, cleanup } = await call("POST", "/v1/chat/completions", { ...body, stream: true }, ctx, { parse: "stream", attempts: 2 });
    let text = "";
    let finishReason = null;
    let usage;
    let model = body.model;
    try {
      await readSse(response, (chunk) => {
        if (chunk?.__done || chunk?.__invalid) return;
        const choice = asArray(chunk.choices)[0];
        if (choice) {
          const delta = asObject(choice.delta);
          if (typeof delta.content === "string") text += delta.content.slice(0, 20_000);
          if (choice.finish_reason) finishReason = safeString(choice.finish_reason, 80);
        }
        if (chunk.usage) {
          usage = normalizeTokenUsage(chunk.usage, chunk.model ?? model);
          if (usage) {
            for (const key of ["input_tokens", "output_tokens", "total_tokens"]) {
              if (Number.isFinite(usage[key])) counters[key] += usage[key];
            }
          }
        }
        if (chunk.model) model = safeString(chunk.model, 300);
      }, ctx?.signal ?? null);
    } finally {
      cleanup();
    }
    counters.requests += 1;
    return { text, structured: undefined, usage, finish_reason: finishReason, model };
  }

  const adapter = {
    id: () => PROVIDER,

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
        "operation", "message", "system", "conversation_id", "model", "json_schema",
        "inputs", "params", "job_id", "provider_job_id"
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
      if ([OPERATIONS.CHAT, OPERATIONS.CHAT_STREAM, OPERATIONS.PLAN, OPERATIONS.SUBMIT_JOB].includes(normalized.operation) && !normalized.message) return bad("message_required");
      if (normalized.operation === OPERATIONS.JOB_STATUS && !jobIdFrom(normalized)) return bad("job_id_required");
      if (normalized.json_schema !== undefined && typeof normalized.json_schema !== "object") return bad("json_schema_must_be_object");
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
        const body = { model, messages: messages(payload) };
        if (isPlan) body.response_format = { type: "json_object" };
        let output;
        if (isStream) {
          output = await streamChat(body, ctx);
        } else {
          const data = unwrap(await call("POST", "/v1/chat/completions", body, ctx, { attempts: 2 }));
          const choice = asArray(data.choices)[0];
          const message = asObject(asObject(choice).message);
          const text = safeString(message.content, 20_000);
          output = {
            text,
            structured: isPlan && text ? JSON.parse(text) : undefined,
            usage: recordUsage(data, model),
            finish_reason: safeString(asObject(choice).finish_reason, 80) || null
          };
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
