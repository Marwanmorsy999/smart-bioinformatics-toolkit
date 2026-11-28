// M7 smarts.bio server-side adapter.
//
// HAZARD: smarts.bio is a direct competitor of this project (see
// docs/discovery/RESEARCH_competitors.md). Its terms may restrict using the
// public API to build, resell or operate a competing service. Therefore public
// API-backed access MUST remain disabled until written provider authorization
// exists. SMARTSBIO_PUBLIC_AUTHORIZED === "true" is that written authorization
// gate: unless it is set, healthCheck() reports disabled, getCapabilities()
// returns empty operations/tools and submitJob() performs NO network call.
//
// Endpoints below are taken from the officially published documentation
// (https://www.smarts.bio/llms.txt and /docs/reference/*). Shapes marked
// VERIFIED were confirmed live on 2026-11-25 with the operator's valid key.
//   GET  /v1/workspaces            (any scope; VERIFIED {status:"success", data:[{id,name,...}]})
//   GET  /v1/tools                 (tools scope; VERIFIED {status:"success", tools:[...]}
//                                  with exact parameter schemas -- NOT `data`)
//   POST /v1/query                 (query scope; synchronous chat/plan)
//   POST /v1/query/stream          (query scope; SSE chat)
//   POST /v1/tools/:toolId/run     (tools scope; VERIFIED body {input:{<params>},
//                                  workspace_id?}, NOT `inputs`/`parameters`/flat.
//                                  VERIFIED response {status:"success",
//                                  result:{success:true, data:{...}}}; a missing
//                                  `input.query_type` produced a 400 validation error.)
//   POST /v1/pipelines             (tools scope; documented body
//                                  {tool_id, workspace_id, input:{...}})
//   GET  /v1/pipelines?workspace_id=<id> (tools scope; VERIFIED
//                                  {processes:[...], total:N, pagination:{...}},
//                                  NOT `data`; workspace_id is mandatory)
//   GET  /v1/pipelines/:id         (status/output_paths; shape NOT verified live -- parsed
//                                  defensively from `data`, `pipeline`, `process` or top level)
//   DELETE /v1/pipelines/:id       (cancel)
//   GET  /v1/files                 (files scope; metadata)
//   GET  /v1/files/download        (presigned S3 URL, ~1h validity)
//
// NOT documented, therefore NOT implemented and NOT advertised:
//   * an account quota/usage endpoint (getUsage returns unknown, never a
//     marketing number such as "1000 API calls/month");
//   * an OpenAI-style response_format parameter for /v1/query. Structured
//     `plan` output is best-effort: the JSON instruction is added to the
//     prompt and the answer is parsed, then validated by the caller.
//   * no tool-id list is hardcoded: pipeline-vs-tool routing is chosen by an
//     explicit `pipeline_id` / `async: true` flag from the caller.
//
// All secrets come from env: SMARTSBIO_API_KEY, SMARTSBIO_BASE_URL,
// SMARTSBIO_WORKSPACE_ID. No endpoint default is hardcoded.

import {
  OPERATIONS, AVAILABILITY, DISCOVERY_MODE, JOB_STATUS, normalizeProviderError
} from "../common/contract.js";
import {
  asArray, asObject, failure, jobIdFrom, joinUrl, makeId, makeNow, mapState,
  normalizeCallArgs, normalizeTokenUsage, pick, readSse, requestJson, safeId, safeString
} from "../common/normalize.js";
import { ProviderHttpError } from "../common/retry.js";

const PROVIDER = "smartsbio";
const GATE = "SMARTSBIO_PUBLIC_AUTHORIZED";

const SMARTS_OPERATIONS = Object.freeze([
  OPERATIONS.HEALTH_CHECK,
  OPERATIONS.GET_CAPABILITIES,
  OPERATIONS.GET_LIMITS,
  OPERATIONS.CHAT,
  OPERATIONS.CHAT_STREAM,
  OPERATIONS.PLAN,
  OPERATIONS.SUBMIT_JOB,
  OPERATIONS.JOB_STATUS,
  OPERATIONS.CANCEL_JOB,
  OPERATIONS.GET_ARTIFACTS,
  OPERATIONS.DOWNLOAD_ARTIFACT,
  OPERATIONS.DISCOVER_WORKFLOWS,
  OPERATIONS.INVOKE_WORKFLOW
]);

const GATE_ERROR = Object.freeze({
  provider: PROVIDER,
  code: "public_authorization_required",
  message: "smarts.bio API access requires written provider authorization (SMARTSBIO_PUBLIC_AUTHORIZED).",
  status: 403,
  retryable: false
});

function timeoutFrom(env) {
  const raw = Number(env?.SMARTSBIO_TIMEOUT ?? env?.SMARTSBIO_TIMEOUT_MS);
  return Number.isFinite(raw) && raw > 0 ? Math.min(raw, 120_000) : 20_000;
}

export function createAdapter(env = {}, deps = {}) {
  const enabled = env?.SMARTSBIO_ENABLED === "true";
  const authorized = env?.[GATE] === "true";
  const baseUrl = safeString(env?.SMARTSBIO_BASE_URL).trim();
  const apiKey = safeString(env?.SMARTSBIO_API_KEY).trim(); // secret
  const workspaceId = safeString(env?.SMARTSBIO_WORKSPACE_ID).trim();
  const configured = Boolean(baseUrl && apiKey && workspaceId);
  const active = enabled && authorized && configured;
  const defaultTimeout = timeoutFrom(env);

  // Ephemeral per-adapter metadata. A Worker isolate can be recycled, so this
  // is best-effort only: durable job state belongs in D1 (provider_jobs).
  const jobMeta = new Map();

  function fetcher(ctx) {
    return ctx?.fetch ?? deps.fetch ?? globalThis.fetch;
  }

  function availability() {
    if (!enabled) return AVAILABILITY.DISABLED;
    if (!authorized) return AVAILABILITY.DISABLED;
    if (!configured) return AVAILABILITY.UNAVAILABLE;
    return AVAILABILITY.UNKNOWN;
  }

  function gateDenied() {
    return { ok: false, status: AVAILABILITY.DISABLED, reason: GATE_ERROR.code, at: null };
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
    if (extra.parse === "text") opts.parse = "text";
    return requestJson(PROVIDER, fetcher(ctx), joinUrl(baseUrl, path), { method, headers, body: payload }, opts);
  }

  // smarts.bio uses {status:"error", error:<code>} for failures, but successful
  // payload keys differ by endpoint: `data` (workspaces, pipelines create,
  // files), `tools` (GET /v1/tools) and `processes` (GET /v1/pipelines). Only
  // the error *code* crosses the boundary; raw provider text never does.
  function errorEnvelope(envelope, result) {
    return new ProviderHttpError({
      status: Number(result?.response?.status) || 502,
      code: safeString(envelope.error, 120) || "provider_error",
      message: "smarts.bio returned an error envelope",
      retryable: false
    });
  }

  function unwrap(result, extraKeys = []) {
    const envelope = asObject(result?.body);
    if (envelope.status === "error") throw errorEnvelope(envelope, result);
    for (const key of ["data", ...extraKeys]) {
      if (envelope[key] !== undefined) return envelope[key];
    }
    return envelope;
  }

  // VERIFIED: POST /v1/tools/:id/run -> {status:"success", result:{success,data}}.
  // A success:false result is a provider-side failure, never a successful job.
  function toolRunPayload(result) {
    const envelope = asObject(result?.body);
    if (envelope.status === "error") throw errorEnvelope(envelope, result);
    const run = asObject(envelope.result ?? envelope.data ?? envelope);
    if (run.success === false) {
      throw new ProviderHttpError({
        status: Number(result?.response?.status) || 502,
        code: "tool_run_failed",
        message: "smarts.bio tool run reported failure",
        retryable: false
      });
    }
    return run.data ?? run;
  }

  // GET /v1/pipelines/:id is not live-verified, so accept the documented
  // `data` shape as well as `pipeline`/`process`/top-level equivalents.
  function pipelinePayload(result) {
    const envelope = asObject(result?.body);
    if (envelope.status === "error") throw errorEnvelope(envelope, result);
    return asObject(envelope.pipeline ?? envelope.process ?? envelope.data ?? envelope);
  }

  function workspace(request) {
    return safeString(asObject(request).workspace_id, 200) || workspaceId;
  }

  function normalizeTool(raw) {
    const item = asObject(raw);
    const id = safeId(item.id, { max: 300, allowSlash: true });
    // VERIFIED: GET /v1/tools carries exact parameter schemas in `parameters`.
    const rawParameters = item.parameters ?? item.input_schema?.properties ?? {};
    const parameters = Array.isArray(rawParameters)
      ? Object.fromEntries(rawParameters.map((entry) => [safeString(asObject(entry).name, 120), asObject(entry)].filter(([name]) => name)))
      : asObject(rawParameters);
    return {
      id,
      name: safeString(item.name, 300),
      version: safeString(item.version, 100),
      description: safeString(item.description, 1000),
      input_types: asArray(item.input_types).map((type) => safeString(type, 100)),
      output_types: asArray(item.output_types).map((type) => safeString(type, 100)),
      parameters,
      available: Boolean(id),
      executable: Boolean(id && active),
      source: "smartsbio:/v1/tools",
      discovery_mode: DISCOVERY_MODE.LIVE
    };
  }

  function result(request, providerJobId, status, output = {}, extra = {}) {
    return {
      provider: PROVIDER,
      provider_job_id: safeString(providerJobId, 200) || makeId(extra.ctx, "smarts"),
      status,
      submitted_at: extra.submitted_at ?? null,
      output,
      ...(extra.error ? { error: extra.error } : {})
    };
  }

  function failed(request, error, submittedAt, ctx) {
    return result(request, null, "failed", {}, {
      submitted_at: submittedAt,
      ctx,
      error: error === GATE_ERROR ? { ...GATE_ERROR, at: submittedAt } : normalizeProviderError(PROVIDER, error, { at: submittedAt })
    });
  }

  async function syncQuery(request, ctx, streaming = false, wantStructured = false) {
    const promptParts = [safeString(request.message, 8000)];
    if (wantStructured) {
      const schema = asObject(request.json_schema);
      promptParts.push("Return ONLY a valid JSON object" + (Object.keys(schema).length ? ` matching this JSON schema: ${JSON.stringify(schema).slice(0, 4000)}` : "."));
    }
    const body = {
      prompt: promptParts.join("\n\n"),
      workspace_id: workspace(request)
    };
    const conversationId = safeString(request.conversation_id, 200);
    if (conversationId) body.conversation_id = conversationId;

    if (streaming) {
      const { response, cleanup } = await requestJson(PROVIDER, fetcher(ctx), joinUrl(baseUrl, "/v1/query/stream"), {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          Accept: "text/event-stream",
          "Content-Type": "application/json"
        },
        body: JSON.stringify(body)
      }, {
        timeoutMs: Number(ctx?.timeoutMs) > 0 ? Number(ctx.timeoutMs) : defaultTimeout,
        signal: ctx?.signal ?? null,
        parse: "stream",
        attempts: 2,
        sleep: ctx?.sleep ?? null
      });
      let text = "";
      let streamError = null;
      try {
        await readSse(response, (event) => {
          if (event?.__done || event?.__invalid) return;
          const type = safeString(event.type, 80);
          if (type === "content") text += safeString(event.content, 20_000);
          else if (type === "error") streamError = new ProviderHttpError({
            status: 500,
            code: safeString(event.error, 120) || "agent_error",
            message: "smarts.bio streaming error event",
            retryable: false
          });
        }, ctx?.signal ?? null);
      } finally {
        cleanup();
      }
      if (streamError) throw streamError;
      return { text, structured: undefined, usage: undefined, finish_reason: text ? "stop" : null };
    }

    const data = unwrap(await call("POST", "/v1/query", body, ctx, { attempts: 2 }));
    const text = safeString(data.answer ?? data.content ?? data.text, 20_000);
    let parsedStructured;
    if (wantStructured && text) {
      try { parsedStructured = JSON.parse(text); }
      catch {
        throw new ProviderHttpError({ status: 502, code: "invalid_structured_output", message: "smarts.bio plan output was not valid JSON", retryable: false });
      }
    }
    return {
      text,
      structured: parsedStructured,
      usage: normalizeTokenUsage(data.usage, data.model),
      finish_reason: safeString(data.finish_reason, 80) || null
    };
  }

  async function runToolOrPipeline(request, ctx) {
    const workspaceIdValue = workspace(request);
    // VERIFIED LIVE: the parameter map MUST be the singular `input` key.
    // `inputs`, `parameters` and a flat body all fail validation upstream.
    const toolInput = asObject(request.input ?? request.inputs ?? request.params);
    const asyncRun = request.async === true || Boolean(safeId(request.pipeline_id, { max: 300, allowSlash: true }));
    if (!asyncRun) {
      const toolId = safeId(request.tool_id, { max: 300, allowSlash: true });
      const result = await call("POST", `/v1/tools/${encodeURIComponent(toolId)}/run`, {
        input: toolInput,
        workspace_id: workspaceIdValue
      }, ctx, { attempts: 2 });
      const data = toolRunPayload(result); // surfaces result.success === false
      return { id: makeId(ctx, "smarts"), status: JOB_STATUS.SUCCEEDED, data, kind: "tool" };
    }
    const toolId = safeId(request.pipeline_id ?? request.tool_id, { max: 300, allowSlash: true });
    // VERIFIED: the pipelines endpoints require workspace_id; never send an
    // unscoped request and never invent a workspace.
    if (!workspaceIdValue) throw new ProviderHttpError({ status: 400, code: "workspace_id_required", message: "smarts.bio pipelines require workspace_id", retryable: false });
    const data = unwrap(await call("POST", "/v1/pipelines", {
      tool_id: toolId,
      workspace_id: workspaceIdValue,
      input: toolInput
    }, ctx, { attempts: 2 }));
    return { id: safeId(asObject(data).id, { max: 200 }) || makeId(ctx, "smarts"), status: mapState(asObject(data).status), data: asObject(data), kind: "pipeline" };
  }

  const adapter = {
    id: () => PROVIDER,

    async healthCheck(ctx = {}) {
      if (!enabled || !authorized) return { provider: PROVIDER, ...gateDenied(), at: makeNow(ctx) };
      if (!configured) return { provider: PROVIDER, ok: false, status: AVAILABILITY.UNAVAILABLE, reason: "missing_configuration", at: makeNow(ctx) };
      try {
        const data = unwrap(await call("GET", "/v1/workspaces", undefined, ctx));
        const list = asArray(data);
        const visible = list.some((item) => safeString(asObject(item).id, 200) === workspaceId);
        const status = visible ? AVAILABILITY.AVAILABLE : AVAILABILITY.DEGRADED;
        return {
          provider: PROVIDER, ok: status === AVAILABILITY.AVAILABLE, status,
          workspace_configured: Boolean(workspaceId), workspace_visible: visible,
          at: makeNow(ctx)
        };
      } catch (error) {
        return { provider: PROVIDER, ok: false, status: AVAILABILITY.UNAVAILABLE, error: normalizeProviderError(PROVIDER, error, { at: makeNow(ctx) }), at: makeNow(ctx) };
      }
    },

    async getCapabilities(ctx = {}) {
      const at = makeNow(ctx);
      const empty = {
        provider: PROVIDER, availability: availability(), operations: [], tools: [],
        discovery_mode: DISCOVERY_MODE.UNAVAILABLE, at,
        authorization_required: true
      };
      if (!enabled || !authorized || !configured) return empty;
      let tools = [];
      let live = false;
      try {
        // VERIFIED: the catalog is under `tools`, not `data`.
        const data = unwrap(await call("GET", "/v1/tools", undefined, ctx), ["tools"]);
        tools = asArray(data).map(normalizeTool).filter((tool) => tool.id);
        live = true;
      } catch { /* with no catalog nothing may be advertised */ }
      return {
        provider: PROVIDER,
        availability: live ? AVAILABILITY.AVAILABLE : AVAILABILITY.DEGRADED,
        operations: [...SMARTS_OPERATIONS],
        tools,
        discovery_mode: live ? DISCOVERY_MODE.LIVE : DISCOVERY_MODE.UNAVAILABLE,
        source: "smartsbio:/v1/tools",
        at,
        authorization_required: true
      };
    },

    async getLimits(ctx = {}) {
      // No documented quota endpoint exists; totals stay null (unknown). The
      // marketing free-tier numbers are NOT API facts and are never used.
      return {
        provider: PROVIDER,
        units: {
          api_calls: { total: null, used: null, remaining: null, unknown: true },
          compute_hours: { total: null, used: null, remaining: null, unknown: true }
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
        "tool_id", "pipeline_id", "workflow_id", "history_id", "job_id",
        "provider_job_id", "key", "workspace_id", "input", "inputs", "params", "async"
      ]);
      normalized.operation = safeString(operation ?? normalized.operation, 80);
      normalized.message = safeString(normalized.message, 8000);
      normalized.input = asObject(normalized.input ?? normalized.inputs ?? normalized.params);
      normalized.inputs = asObject(normalized.inputs);
      normalized.params = asObject(normalized.params);
      for (const field of ["tool_id", "pipeline_id", "workflow_id"]) {
        if (normalized[field] !== undefined) {
          const id = safeId(normalized[field], { max: 300, allowSlash: true });
          if (!id) return { valid: false, error: `malformed_${field}`, normalized };
          normalized[field] = id;
        }
      }
      for (const field of ["job_id", "provider_job_id", "history_id"]) {
        if (normalized[field] !== undefined) {
          const id = safeId(normalized[field], { max: 200 });
          if (!id) return { valid: false, error: `malformed_${field}`, normalized };
          normalized[field] = id;
        }
      }
      const bad = (error) => ({ valid: false, error, normalized });
      if (!enabled || !authorized) return bad(GATE_ERROR.code);
      if (!SMARTS_OPERATIONS.includes(normalized.operation)) return bad("operation_not_supported");
      const chatOps = [OPERATIONS.CHAT, OPERATIONS.CHAT_STREAM, OPERATIONS.PLAN];
      if (chatOps.includes(normalized.operation) && !normalized.message) return bad("message_required");
      if (normalized.operation === OPERATIONS.PLAN && normalized.json_schema !== undefined && !asObject(normalized.json_schema)?.type && !Array.isArray(normalized.json_schema)) {
        // A JSON schema is an object; other shapes are still accepted as
        // opaque hints, so this is a normalization note, not a hard failure.
        normalized.json_schema = asObject(normalized.json_schema);
      }
      if (normalized.operation === OPERATIONS.SUBMIT_JOB && !normalized.tool_id && !normalized.pipeline_id) return bad("tool_id_required");
      if (normalized.operation === OPERATIONS.INVOKE_WORKFLOW && !normalized.workflow_id && !normalized.tool_id) return bad("workflow_id_required");
      const jobRef = normalized.job_id || normalized.provider_job_id;
      if ([OPERATIONS.JOB_STATUS, OPERATIONS.CANCEL_JOB].includes(normalized.operation) && !jobRef) return bad("job_id_required");
      if ([OPERATIONS.GET_ARTIFACTS, OPERATIONS.DOWNLOAD_ARTIFACT].includes(normalized.operation)
        && !jobRef && !safeString(normalized.key, 500) && !safeId(normalized.workspace_id, { max: 200 })) {
        return bad("artifact_reference_required");
      }
      return { valid: true, error: null, normalized };
    },

    async submitJob(request = {}, ctx = {}) {
      const submittedAt = makeNow(ctx);
      if (!enabled || !authorized) return failed(request, GATE_ERROR, submittedAt, ctx);
      const checked = adapter.validateRequest(request?.operation, request);
      if (!checked.valid) {
        return failed(request, Object.assign(new Error(checked.error), { code: "validation_error", status: 400, retryable: false }), submittedAt, ctx);
      }
      const payload = checked.normalized;
      try {
        let output;
        let jobId;
        let status = JOB_STATUS.SUCCEEDED;
        let kind = "chat";
        if ([OPERATIONS.CHAT, OPERATIONS.CHAT_STREAM, OPERATIONS.PLAN].includes(payload.operation)) {
          output = await syncQuery(payload, ctx, payload.operation === OPERATIONS.CHAT_STREAM, payload.operation === OPERATIONS.PLAN);
          jobId = makeId(ctx, "smarts");
        } else {
          const run = await runToolOrPipeline(payload, ctx);
          jobId = run.id;
          status = run.status;
          kind = run.kind;
          output = {
            structured: asObject(run.data),
            usage: normalizeTokenUsage(asObject(run.data).usage, asObject(run.data).model)
          };
          if (Array.isArray(run.data?.output_paths)) output.structured.output_paths = run.data.output_paths;
        }
        jobMeta.set(jobId, { kind, status, workspace_id: workspace(payload), output_paths: output?.structured?.output_paths ?? [] });
        return result(payload, jobId, status, output, { submitted_at: submittedAt, ctx });
      } catch (error) {
        return failed(payload, error, submittedAt, ctx);
      }
    },

    async getJobStatus(request = {}, ctx = {}) {
      const args = normalizeCallArgs(request, ctx);
      request = args.request;
      ctx = args.ctx;
      const jobId = jobIdFrom(request);
      const at = makeNow(ctx);
      if (!enabled || !authorized) return { ...failure(PROVIDER, GATE_ERROR, at), provider_job_id: jobId || null, status: JOB_STATUS.UNKNOWN };
      if (!jobId) return { ...failure(PROVIDER, Object.assign(new Error("job_id_required"), { code: "validation_error", status: 400, retryable: false }), at), provider_job_id: null, status: JOB_STATUS.UNKNOWN };
      const known = jobMeta.get(jobId);
      if (known && known.kind !== "pipeline") {
        return { provider: PROVIDER, provider_job_id: jobId, status: known.status, output: { structured: { kind: known.kind } } };
      }
      try {
        const ws = safeId(request?.workspace_id, { max: 200 }) || known?.workspace_id || workspaceId;
        const data = pipelinePayload(await call("GET", `/v1/pipelines/${encodeURIComponent(jobId)}?workspace_id=${encodeURIComponent(ws)}`, undefined, ctx));
        return {
          provider: PROVIDER,
          provider_job_id: jobId,
          status: mapState(data.status),
          output: {
            structured: {
              progress_pct: data.progress_pct ?? null,
              current_step: safeString(data.current_step, 200) || null,
              output_paths: asArray(data.output_paths).map((path) => safeString(path, 500)),
              error: safeString(data.error, 500) || null
            }
          },
          at
        };
      } catch (error) {
        return { ...failure(PROVIDER, error, at), provider_job_id: jobId, status: JOB_STATUS.UNKNOWN };
      }
    },

    async cancelJob(request = {}, ctx = {}) {
      const args = normalizeCallArgs(request, ctx);
      request = args.request;
      ctx = args.ctx;
      const jobId = jobIdFrom(request);
      const at = makeNow(ctx);
      if (!enabled || !authorized) return { ...failure(PROVIDER, GATE_ERROR, at), ok: false };
      if (!jobId) return { ...failure(PROVIDER, Object.assign(new Error("job_id_required"), { code: "validation_error", status: 400, retryable: false }), at), ok: false };
      const known = jobMeta.get(jobId);
      if (known && known.kind !== "pipeline") {
        return { provider: PROVIDER, provider_job_id: jobId, status: JOB_STATUS.CANCELLED, ok: false, reason: "synchronous_job_not_cancellable" };
      }
      try {
        const ws = safeId(request?.workspace_id, { max: 200 }) || known?.workspace_id || workspaceId;
        await call("DELETE", `/v1/pipelines/${encodeURIComponent(jobId)}?workspace_id=${encodeURIComponent(ws)}`, undefined, ctx, { attempts: 2 });
        return { provider: PROVIDER, provider_job_id: jobId, status: JOB_STATUS.CANCELLED, ok: true, at };
      } catch (error) {
        return { ...failure(PROVIDER, error, at), provider_job_id: jobId, ok: false };
      }
    },

    async getArtifacts(request = {}, ctx = {}) {
      const args = normalizeCallArgs(request, ctx);
      request = args.request;
      ctx = args.ctx;
      const at = makeNow(ctx);
      const empty = { provider: PROVIDER, artifacts: [], ok: false, at };
      if (!enabled || !authorized) return { ...empty, error: { ...GATE_ERROR, at } };
      try {
        const jobId = jobIdFrom(request);
        const ws = safeId(request?.workspace_id, { max: 200 }) || workspaceId;
        const keys = [];
        if (jobId) {
          const meta = jobMeta.get(jobId);
          keys.push(...(meta?.output_paths ?? []));
          if (!meta || meta.kind === "pipeline") {
            const detailWorkspace = ws || meta?.workspace_id;
            if (!detailWorkspace) return { ...empty, reason: "workspace_id_required" };
            const data = pipelinePayload(await call("GET", `/v1/pipelines/${encodeURIComponent(jobId)}?workspace_id=${encodeURIComponent(detailWorkspace)}`, undefined, ctx));
            keys.push(...asArray(data.output_paths).map((path) => safeString(path, 500)));
          }
        }
        if (safeString(request?.key, 500)) keys.push(safeString(request.key, 500));
        let listed = [];
        if (!keys.length) {
          if (!ws) return { ...empty, reason: "workspace_id_required" };
          if (jobId) {
            // VERIFIED: GET /v1/pipelines?workspace_id=<id> -> {processes:[...]},
            // not `data`. The workspace id is mandatory for this endpoint.
            const processes = unwrap(await call("GET", `/v1/pipelines?workspace_id=${encodeURIComponent(ws)}`, undefined, ctx), ["processes"]);
            const matching = asArray(processes).find((item) => safeId(asObject(item).id, { max: 200 }) === jobId);
            if (matching) keys.push(...asArray(asObject(matching).output_paths).map((path) => safeString(path, 500)));
          }
          if (!keys.length) {
            const data = unwrap(await call("GET", `/v1/files?workspace_id=${encodeURIComponent(ws)}`, undefined, ctx));
            listed = asArray(data).map((item) => asObject(item));
          }
        }
        const artifacts = [
          ...keys.map((key) => ({ key, name: key.split("/").pop() || key, size: null, source: "smartsbio:/v1/pipelines" })),
          ...listed.map((item) => ({
            key: safeString(item.key, 500),
            name: safeString(item.name, 300),
            size: Number.isFinite(Number(item.size)) ? Number(item.size) : null,
            source: "smartsbio:/v1/files"
          }))
        ].filter((item) => item.key);
        return { provider: PROVIDER, artifacts, ok: true, at };
      } catch (error) {
        return { ...empty, error: normalizeProviderError(PROVIDER, error, { at }) };
      }
    },

    async downloadArtifact(request = {}, ctx = {}) {
      const at = makeNow(ctx);
      if (!enabled || !authorized) return failure(PROVIDER, GATE_ERROR, at);
      const key = safeString(request?.key ?? request?.artifact_id, 500);
      if (!key) return failure(PROVIDER, Object.assign(new Error("key_required"), { code: "validation_error", status: 400, retryable: false }), at);
      try {
        const ws = safeString(request?.workspace_id, 200) || workspaceId;
        const data = unwrap(await call("GET", `/v1/files/download?workspace_id=${encodeURIComponent(ws)}&key=${encodeURIComponent(key)}`, undefined, ctx));
        const url = safeString(data.downloadUrl ?? data.download_url, 2000);
        let parsed;
        try { parsed = new URL(url); } catch { throw new ProviderHttpError({ status: 502, code: "invalid_download_url", message: "smarts.bio returned an invalid download URL", retryable: false }); }
        if (!/^https?:$/.test(parsed.protocol)) throw new ProviderHttpError({ status: 502, code: "invalid_download_url", message: "smarts.bio returned an unsupported download URL scheme", retryable: false });
        const { body } = await requestJson(PROVIDER, fetcher(ctx), url, { method: "GET" }, {
          timeoutMs: Number(ctx?.timeoutMs) > 0 ? Number(ctx.timeoutMs) : defaultTimeout,
          signal: ctx?.signal ?? null,
          parse: "text",
          attempts: 2,
          sleep: ctx?.sleep ?? null
        });
        return { provider: PROVIDER, ok: true, key, content: body, at };
      } catch (error) {
        return failure(PROVIDER, error, at);
      }
    },

    async getUsage(request = {}, ctx = {}) {
      const args = normalizeCallArgs(request, ctx);
      const at = makeNow(args.ctx);
      const jobId = jobIdFrom(args.request);
      // Deliberately no HTTP call / no invented counters: the public API does
      // not document a usage endpoint, so totals remain unknown.
      return {
        provider: PROVIDER,
        ok: false,
        reason: "not_documented",
        usage: null,
        unknown: true,
        source: "not_documented",
        provider_job_id: jobId || null,
        at
      };
    }
  };

  return adapter;
}

export const createSmartBioAdapter = createAdapter;
export default createAdapter;
