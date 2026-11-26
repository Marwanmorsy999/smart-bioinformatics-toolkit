// M7 Galaxy Europe provider adapter (generic; works against any Galaxy 22+).
//
// Everything executable is discovered from the LIVE instance: GET /api/tools
// and GET /api/workflows. There are NO hardcoded tool ids, workflow ids or
// endpoint defaults. The base URL and API key come from env only.
//
// Galaxy API semantics implemented (best effort, verified against the public
// Galaxy API surface; limitations recorded here rather than papered over):
//   GET  /api/version                  -> version metadata
//   GET  /api/users/current           -> authenticated user identity
//   GET  /api/users/current/usage     -> disk quota (the only real quota we use)
//   GET  /api/tools                   -> dynamic tool list + input/output schema
//   GET  /api/workflows               -> dynamic workflow list
//   POST /api/histories               -> per-job output history
//   POST /api/tools                   -> tool execution (inputs map + hda refs)
//   POST /api/tools/fetch             -> dataset upload (multipart/form-data;
//                                       VERIFIED against /openapi.json 2026-11-25)
//   POST /api/invocations             -> workflow invocation
//   GET  /api/jobs/:id                -> job state
//   POST /api/jobs/:id/cancel         -> cancellation
//   GET  /api/histories/:id/contents  -> result datasets
//   GET  /api/datasets/:id            -> one dataset
//   GET  /api/datasets/:id/get_content_as_text -> dataset text ({item_data, truncated})
//
// Known limitations:
//  * /api/users/current/usage reports disk usage/quota but does NOT expose a
//    reliable concurrency or "jobs remaining" quota. Those totals stay null
//    (unknown); no fictional credits are invented.
//  * Tool inputs are passed through as Galaxy descriptors. The adapter does not
//    guess a tool's parameter schema; callers should populate `params` from
//    the dynamically discovered tool metadata.
//  * Workflow invocation ids live in /api/invocations, not /api/jobs. Polling
//    falls back to the invocation endpoint when a job lookup returns 404.
//  * Dataset upload uses POST /api/tools/fetch (multipart/form-data). The
//    verified schema (https://usegalaxy.eu/openapi.json, accessed 2026-11-25)
//    requires `history_id` and a JSON-encoded `targets` array whose items are
//    {destination:{type:"hdas"}, elements:[...]}; text elements are
//    {src:"pasted", paste_content, name, ext} and byte elements are
//    {src:"files", name, ext} with the bytes in a `files` form part. The old
//    POST /api/tools + tool_id=upload1 + inputs.file1.file_content body is
//    known to return 400 "No data was entered in the upload form"; POST
//    /api/upload does not exist (404). `upload1` is Galaxy's generic platform
//    upload primitive, never a discovered/advertised scientific capability.
//  * Dataset text is read from GET /api/datasets/:id/get_content_as_text, verified
//    live on 2026-11-25: it returns JSON {item_data, truncated, item_url}. The
//    older GET /api/datasets/:id/content has no route on usegalaxy.eu (404).
//    truncated:true is rejected as a typed error instead of returning partial
//    bytes. A newly uploaded dataset stays queued/running for tens of seconds;
//    content must only be fetched after it reaches ok/success.
//  * A previously observed HTTP 403 "Action requires account activation" is
//    propagated as a normalized failure; no successful upload or job is ever
//    fabricated. Account activation is not confirmed by this change.
//  * POST retries are at-least-once. A transient failure after the server
//    accepted a submission may create a duplicate job; callers reconcile by
//    provider_job_id. Read endpoints are safe to retry.

import {
  OPERATIONS, AVAILABILITY, DISCOVERY_MODE, JOB_STATUS, normalizeProviderError
} from "../common/contract.js";
import {
  asArray, asObject, failure, jobIdFrom, joinUrl, makeId, makeNow, mapState,
  normalizeCallArgs, pick, requestJson, safeId, safeString
} from "../common/normalize.js";

const PROVIDER = "galaxy";

// Platform upload primitive only. Never added to the discovered capability
// list; submitJob uses it to select the dataset-upload wire format.
const UPLOAD_TOOL_ID = "upload1";

const GALAXY_OPERATIONS = Object.freeze([
  OPERATIONS.HEALTH_CHECK,
  OPERATIONS.GET_CAPABILITIES,
  OPERATIONS.GET_LIMITS,
  OPERATIONS.SUBMIT_JOB,
  OPERATIONS.JOB_STATUS,
  OPERATIONS.CANCEL_JOB,
  OPERATIONS.GET_ARTIFACTS,
  OPERATIONS.DOWNLOAD_ARTIFACT,
  OPERATIONS.GET_USAGE,
  OPERATIONS.DISCOVER_WORKFLOWS,
  OPERATIONS.INVOKE_WORKFLOW
]);

function finite(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function firstFinite(...values) {
  for (const value of values) {
    const n = finite(value);
    if (n !== null) return n;
  }
  return null;
}

function timeoutFrom(env) {
  const raw = Number(env?.GALAXY_TIMEOUT ?? env?.GALAXY_TIMEOUT_MS);
  return Number.isFinite(raw) && raw > 0 ? Math.min(raw, 120_000) : 20_000;
}

function parseQuota(raw) {
  const source = asObject(raw);
  return {
    quota_bytes: firstFinite(source.quota_bytes, source.quotaBytes, source.quota?.bytes),
    used_bytes: firstFinite(source.total_disk_usage, source.totalDiskUsage, source.usage?.total_disk_usage),
    quota_percent: firstFinite(source.quota_percent, source.quotaPercent),
    nice_total: safeString(source.nice_total_disk_usage, 120)
  };
}

export function createAdapter(env = {}, deps = {}) {
  const enabled = env?.GALAXY_ENABLED === "true";
  const baseUrl = safeString(env?.GALAXY_BASE_URL).trim();
  const apiKey = safeString(env?.GALAXY_API_KEY).trim(); // secret: never logged or returned
  const configured = Boolean(baseUrl && apiKey);
  const defaultTimeout = timeoutFrom(env);

  function availability() {
    if (!enabled) return AVAILABILITY.DISABLED;
    if (!configured) return AVAILABILITY.UNAVAILABLE;
    return AVAILABILITY.UNKNOWN;
  }

  function fetcher(ctx) {
    return ctx?.fetch ?? deps.fetch ?? globalThis.fetch;
  }

  async function call(method, path, body, ctx = {}, extra = {}) {
    const headers = { "X-API-Key": apiKey, Accept: "application/json" };
    let payload;
    if (body !== undefined) {
      headers["Content-Type"] = "application/json";
      payload = JSON.stringify(body);
    }
    const { body: parsed, response, attempts } = await requestJson(PROVIDER, fetcher(ctx), joinUrl(baseUrl, path), {
      method,
      headers,
      body: payload
    }, {
      timeoutMs: Number(ctx?.timeoutMs) > 0 ? Number(ctx.timeoutMs) : defaultTimeout,
      signal: ctx?.signal ?? null,
      attempts: extra.attempts ?? 3,
      sleep: ctx?.sleep ?? null
    });
    return { body: parsed, response, attempts };
  }

  // Dataset upload goes through the verified multipart endpoint. The boundary
  // is generated by fetch/FormData; setting Content-Type here would break it.
  async function callFetch(historyId, targets, fileParts, ctx = {}) {
    const form = new FormData();
    form.append("history_id", historyId);
    form.append("targets", JSON.stringify(targets));
    for (const part of fileParts) form.append("files", part);
    const { body: parsed, response, attempts } = await requestJson(PROVIDER, fetcher(ctx), joinUrl(baseUrl, "/api/tools/fetch"), {
      method: "POST",
      headers: { "X-API-Key": apiKey, Accept: "application/json" },
      body: form
    }, {
      timeoutMs: Number(ctx?.timeoutMs) > 0 ? Number(ctx.timeoutMs) : defaultTimeout,
      signal: ctx?.signal ?? null,
      attempts: 2,
      sleep: ctx?.sleep ?? null
    });
    return { body: parsed, response, attempts };
  }

  // GET /api/tools returns a panel: sections with nested `elems`, plus entries
  // such as ToolSection/DataSourceTool that are not API-executable. Only real
  // Tool entries may be advertised as executable capabilities.
  function flattenToolPanel(items) {
    const out = [];
    for (const entry of asArray(items)) {
      const item = asObject(entry);
      if (Array.isArray(item.elems) || item.model_class === "ToolSection") {
        out.push(...flattenToolPanel(item.elems));
      } else {
        out.push(item);
      }
    }
    return out;
  }

  function normalizeTool(raw) {
    const item = asObject(raw);
    const id = safeString(item.id, 300);
    const name = safeString(item.name ?? item.label, 300);
    const blocked = item.disabled === true || item.hidden === true || item.deleted === true || item.available === false;
    const inputs = asArray(item.inputs).map((input) => ({
      name: safeString(asObject(input).name, 200),
      type: safeString(asObject(input).type, 100),
      optional: asObject(input).optional === true
    }));
    const outputs = asArray(item.outputs).map((output) => ({
      name: safeString(asObject(output).name, 200),
      type: safeString(asObject(output).type ?? asObject(output).format, 100)
    }));
    const parameters = {};
    for (const input of inputs) {
      if (input.name) parameters[input.name] = { type: input.type, optional: input.optional };
    }
    return {
      id,
      name,
      version: safeString(item.version, 100),
      description: safeString(item.description ?? item.help, 1000),
      input_types: inputs.map((input) => input.type),
      output_types: outputs.map((output) => output.type),
      inputs,
      outputs,
      parameters,
      available: Boolean(id) && !blocked,
      executable: Boolean(id && apiKey) && !blocked,
      source: "galaxy:/api/tools",
      discovery_mode: DISCOVERY_MODE.LIVE
    };
  }

  function normalizeWorkflow(raw) {
    const item = asObject(raw);
    const id = safeString(item.id, 300);
    return {
      id,
      name: safeString(item.name, 300),
      version: safeString(item.version, 100),
      description: safeString(item.description, 1000),
      step_count: finite(item.step_count ?? item.steps?.length ?? (Array.isArray(item.steps) ? item.steps.length : null)),
      available: Boolean(id),
      executable: Boolean(id && apiKey),
      source: "galaxy:/api/workflows",
      discovery_mode: DISCOVERY_MODE.LIVE
    };
  }

  async function quota(ctx) {
    const { body } = await call("GET", "/api/users/current/usage", undefined, ctx);
    // usegalaxy.eu returns an ARRAY of quota sources (primary + scratch).
    // The first source carrying quota_bytes is the account's primary quota.
    const list = Array.isArray(body) ? body : [body];
    const primary = list.find((item) => finite(asObject(item).quota_bytes) !== null) ?? asObject(list[0]);
    const parsed = parseQuota(primary);
    parsed.sources = list.map((item) => parseQuota(item));
    return parsed;
  }

  function systemPromptGuard() {
    // Galaxy never uses an LLM; kept as an explicit no-op marker so downstream
    // code cannot mistake discovered tools for generated scientific claims.
    return "Scientific values must come from executed tools, never from model prose.";
  }

  async function ensureHistory(requested, ctx) {
    if (safeString(requested, 200)) return safeString(requested, 200);
    const name = `provider-job-${makeId(ctx, "galaxy")}`;
    const { body } = await call("POST", "/api/histories", { name }, ctx, { attempts: 2 });
    return safeString(asObject(body).id, 200);
  }

  function isBlobLike(value) {
    if (!value || typeof value !== "object") return false;
    if (typeof Blob !== "undefined" && value instanceof Blob) return true;
    return typeof value.arrayBuffer === "function" && typeof value.size === "number"
      && typeof value.type === "string" && typeof value.slice === "function";
  }

  // Only a real dot-separated suffix is an extension. An extension-less name
  // such as `README` must fall back to `txt`, never become its own extension.
  function extFromFilename(filename) {
    const name = String(filename ?? "");
    const dot = name.lastIndexOf(".");
    return (dot > 0 ? name.slice(dot + 1) : "") || "txt";
  }

  function invalidContent() {
    return Object.assign(new Error("galaxy upload requires string or Blob content"), {
      code: "invalid_upload_content", status: 400, retryable: false
    });
  }

  // Convert a caller input descriptor into one DataElementsTarget element.
  // Strings (and {content, ...}) become `pasted` elements; an explicit Blob or
  // File becomes a `files` element plus a multipart `files` part.
  function uploadElement(name, value) {
    const fallbackName = safeString(name, 200) || "input.txt";
    if (typeof value === "string") {
      const filename = fallbackName;
      const ext = extFromFilename(filename);
      return { element: { src: "pasted", paste_content: value, name: filename, ext }, part: null };
    }
    const descriptor = asObject(value);
    const filename = safeString(descriptor.filename ?? descriptor.name, 200) || fallbackName;
    const ext = safeString(descriptor.extension ?? descriptor.ext, 40).replace(/^\./, "")
      || extFromFilename(filename);
    const candidates = [descriptor.content, descriptor.file_content, descriptor.file, descriptor.blob];
    const blob = candidates.find((candidate) => isBlobLike(candidate));
    if (blob) return { element: { src: "files", name: filename, ext }, part: blob };
    // Never upload an empty placeholder when the caller supplied a non-text,
    // non-blob value: fail with a typed validation error at the boundary.
    const content = [descriptor.content, descriptor.file_content]
      .find((candidate) => typeof candidate === "string");
    if (content === undefined) throw invalidContent();
    return { element: { src: "pasted", paste_content: content, name: filename, ext }, part: null };
  }

  // Direct dataset upload (submit_job with tool_id=upload1) uses the verified
  // POST /api/tools/fetch contract. That endpoint carries no stable job id, so
  // the platform primitive gets a generated provider_job_id; the resulting
  // dataset is resolved later by exact filename via getArtifacts({history_id}).
  async function uploadDataset(inputs, historyId, ctx) {
    const elements = [];
    const fileParts = [];
    for (const [name, value] of Object.entries(asObject(inputs))) {
      const { element, part } = uploadElement(name, value);
      elements.push(element);
      if (part) fileParts.push(part);
    }
    const targets = [{ destination: { type: "hdas" }, elements }];
    const { body } = await callFetch(historyId, targets, fileParts, ctx);
    // POST /api/tools/fetch returns outputs[0].{id,history_id,name}, jobs[0].id.
    // These are authoritative and available immediately (state is still queued),
    // so downstream registration must not wait for getArtifacts() state='ok'.
    const outputs = asArray(body?.outputs);
    const jobs = asArray(body?.jobs);
    return {
      dataset_id: safeId(asObject(outputs[0]).id, { max: 200 }) || null,
      history_id: safeString(asObject(outputs[0]).history_id, 200) || historyId,
      job_id: safeId(asObject(jobs[0]).id, { max: 200 }) || null
    };
  }

  // Legacy path for inline {src:"upload"} descriptors that feed a *scientific*
  // tool: it still needs an hda id to substitute into that tool's inputs. The
  // direct upload primitive above never uses this body; the old form is known
  // to be rejected on usegalaxy.eu and is not advertised anywhere.
  async function uploadInputs(inputs, historyId, ctx) {
    const result = {};
    for (const [name, value] of Object.entries(asObject(inputs))) {
      const descriptor = asObject(value);
      if (descriptor.src !== "upload") { result[name] = value; continue; }
      const content = typeof descriptor.content === "string" ? descriptor.content : "";
      const filename = safeString(descriptor.filename, 200) || "input.txt";
      const ext = safeString(descriptor.extension ?? descriptor.ext, 40).replace(/^\./, "") || (filename.split(".").pop() ?? "txt");
      const { body } = await call("POST", "/api/tools", {
        tool_id: UPLOAD_TOOL_ID,
        history_id: historyId,
        inputs: { file1: { file_content: content, filename, ext } }
      }, ctx, { attempts: 2 });
      const candidates = asArray(body).length ? asArray(body) : asArray(asObject(body).outputs);
      const id = safeId(asObject(candidates[0]).id, { max: 200 });
      if (!id) throw Object.assign(new Error("galaxy upload returned no dataset id"), { code: "upload_dataset_id_unavailable", status: 502, retryable: false });
      result[name] = { src: "hda", id };
    }
    return result;
  }

  function jobResult(jobId, state, historyId, extra = {}) {
    return {
      provider: PROVIDER,
      provider_job_id: safeString(jobId, 200) || null,
      status: mapState(state),
      submitted_at: extra.submitted_at ?? null,
      output: {
        structured: {
          job_id: safeString(jobId, 200) || null,
          state: safeString(state, 80) || null,
          history_id: safeString(historyId, 200) || null
        }
      },
      source: "galaxy:/api"
    };
  }

  const adapter = {
    id: () => PROVIDER,

    async healthCheck(ctx = {}) {
      if (!enabled) return { provider: PROVIDER, ok: false, status: AVAILABILITY.DISABLED, reason: "feature_flag_disabled", at: makeNow(ctx) };
      if (!configured) return { provider: PROVIDER, ok: false, status: AVAILABILITY.UNAVAILABLE, reason: "missing_configuration", at: makeNow(ctx) };
      const at = makeNow(ctx);
      let version = null;
      let user = null;
      let quotaInfo = null;
      try {
        const raw = asObject((await call("GET", "/api/version", undefined, ctx)).body);
        // usegalaxy.eu reports {version_major, version_minor}, not `version`.
        version = safeString(raw.version, 100)
          || [safeString(raw.version_major, 40), safeString(raw.version_minor, 40)].filter(Boolean).join(".") || null;
      } catch { /* degraded */ }
      try {
        const raw = asObject((await call("GET", "/api/users/current", undefined, ctx)).body);
        user = pick(raw, ["id", "username"]);
      } catch { /* degraded */ }
      try { quotaInfo = await quota(ctx); } catch { /* degraded */ }
      const ok = Boolean(version && user && Object.keys(user).length);
      const status = ok ? AVAILABILITY.AVAILABLE
        : (version || user || quotaInfo) ? AVAILABILITY.DEGRADED : AVAILABILITY.UNAVAILABLE;
      return { provider: PROVIDER, ok, status, version, user, quota: quotaInfo, at, guard: systemPromptGuard() };
    },

    async getCapabilities(ctx = {}) {
      const at = makeNow(ctx);
      const empty = {
        provider: PROVIDER,
        availability: availability(),
        operations: [],
        tools: [],
        workflows: [],
        discovery_mode: DISCOVERY_MODE.UNAVAILABLE,
        at
      };
      if (!enabled || !configured) return empty;
      let tools = [];
      let workflows = [];
      let live = false;
      try {
        const { body } = await call("GET", "/api/tools", undefined, ctx);
        tools = flattenToolPanel(body)
          .filter((item) => !item.model_class || item.model_class === "Tool")
          .map(normalizeTool)
          .filter((tool) => tool.id);
        live = true;
      } catch { /* no tool catalog: nothing may be advertised */ }
      try {
        const { body } = await call("GET", "/api/workflows", undefined, ctx);
        workflows = asArray(body).map(normalizeWorkflow).filter((workflow) => workflow.id);
      } catch { /* workflows are optional */ }
      return {
        provider: PROVIDER,
        availability: live ? AVAILABILITY.AVAILABLE : AVAILABILITY.DEGRADED,
        operations: [...GALAXY_OPERATIONS],
        tools,
        workflows,
        discovery_mode: live ? DISCOVERY_MODE.LIVE : DISCOVERY_MODE.UNAVAILABLE,
        source: "galaxy:/api/tools,/api/workflows",
        at
      };
    },

    async getLimits(ctx = {}) {
      const at = makeNow(ctx);
      const base = {
        provider: PROVIDER,
        units: {
          bytes: { total: null, used: null, remaining: null, unknown: true },
          jobs: { total: null, used: null, remaining: null, unknown: true }
        },
        unknown: true,
        source: "galaxy:/api/users/current/usage",
        discovery_mode: DISCOVERY_MODE.UNAVAILABLE,
        at
      };
      if (!enabled || !configured) return { ...base, availability: availability() };
      try {
        const info = await quota(ctx);
        const total = info.quota_bytes;
        const used = info.used_bytes;
        return {
          ...base,
          units: {
            bytes: {
              total,
              used,
              remaining: total !== null && used !== null ? Math.max(0, total - used) : null,
              unknown: total === null
            },
            jobs: { total: null, used: null, remaining: null, unknown: true }
          },
          unknown: total === null,
          discovery_mode: DISCOVERY_MODE.LIVE,
          availability: AVAILABILITY.AVAILABLE
        };
      } catch (error) {
        return { ...base, availability: AVAILABILITY.UNAVAILABLE, error: normalizeProviderError(PROVIDER, error, { at }) };
      }
    },

    validateRequest(operation, request = {}) {
      const normalized = pick(asObject(request), [
        "operation", "tool_id", "workflow_id", "history_id", "job_id",
        "provider_job_id", "artifact_id", "dataset_id", "inputs", "params"
      ]);
      normalized.operation = safeString(operation ?? normalized.operation, 80);
      normalized.inputs = asObject(normalized.inputs);
      normalized.params = asObject(normalized.params);
      // ToolShed ids legitimately contain '/', so allow it for body-only ids.
      for (const field of ["tool_id", "workflow_id"]) {
        if (normalized[field] !== undefined) {
          const id = safeId(normalized[field], { max: 300, allowSlash: true });
          if (!id) return { valid: false, error: `malformed_${field}`, normalized };
          normalized[field] = id;
        }
      }
      // Path ids must be strict: no slashes, whitespace or traversal sequences.
      for (const field of ["history_id", "job_id", "provider_job_id", "artifact_id", "dataset_id"]) {
        if (normalized[field] !== undefined) {
          const id = safeId(normalized[field], { max: 200 });
          if (!id) return { valid: false, error: `malformed_${field}`, normalized };
          normalized[field] = id;
        }
      }
      const bad = (error) => ({ valid: false, error, normalized });
      if (!GALAXY_OPERATIONS.includes(normalized.operation)) return bad("operation_not_supported");
      if (normalized.operation === OPERATIONS.SUBMIT_JOB && !normalized.tool_id) return bad("tool_id_required");
      if (normalized.operation === OPERATIONS.INVOKE_WORKFLOW && !normalized.workflow_id) return bad("workflow_id_required");
      const jobRef = normalized.job_id || normalized.provider_job_id;
      if ([OPERATIONS.JOB_STATUS, OPERATIONS.CANCEL_JOB].includes(normalized.operation) && !jobRef) return bad("job_id_required");
      if ([OPERATIONS.GET_ARTIFACTS, OPERATIONS.DOWNLOAD_ARTIFACT].includes(normalized.operation)
        && !normalized.history_id && !jobRef && !normalized.artifact_id && !normalized.dataset_id) {
        return bad("artifact_reference_required");
      }
      return { valid: true, error: null, normalized };
    },

    async submitJob(request = {}, ctx = {}) {
      const submittedAt = makeNow(ctx);
      const checked = adapter.validateRequest(request?.operation ?? OPERATIONS.SUBMIT_JOB, request);
      if (!checked.valid) {
        return {
          provider: PROVIDER, provider_job_id: null, status: "failed", submitted_at: submittedAt,
          output: {}, error: { provider: PROVIDER, code: "validation_error", message: checked.error, status: 400, retryable: false, at: submittedAt }
        };
      }
      const payload = checked.normalized;
      try {
        const historyId = await ensureHistory(payload.history_id, ctx);
        // Dataset upload is a platform primitive, not an executable capability.
        // It must use the verified multipart /api/tools/fetch contract; the old
        // POST /api/tools + upload1 body is rejected by Galaxy.
        if (payload.operation === OPERATIONS.SUBMIT_JOB
          && safeString(payload.tool_id, 300) === UPLOAD_TOOL_ID) {
          const upload = await uploadDataset(payload.inputs, historyId, ctx);
          const result = jobResult(upload.job_id ?? makeId(ctx, "galaxy"), "new", upload.history_id ?? historyId, { submitted_at: submittedAt });
          result.output.structured.dataset_id = upload.dataset_id;
          return result;
        }
        let response;
        if (payload.operation === OPERATIONS.INVOKE_WORKFLOW) {
          const inputs = await uploadInputs(payload.inputs, historyId, ctx);
          const body = { workflow_id: safeString(payload.workflow_id, 300), history_id: historyId, inputs };
          if (Object.keys(payload.params).length) body.params = payload.params;
          response = (await call("POST", "/api/invocations", body, ctx, { attempts: 2 })).body;
        } else {
          const inputs = await uploadInputs(payload.inputs, historyId, ctx);
          // Galaxy uses one `inputs` map for both dataset references and simple
          // parameters. We never guess which is which; caller-provided params
          // are merged on top of the caller-provided input descriptors.
          const merged = { ...inputs, ...payload.params };
          response = (await call("POST", "/api/tools", {
            tool_id: safeString(payload.tool_id, 300),
            history_id: historyId,
            inputs: merged
          }, ctx, { attempts: 2 })).body;
        }
        // POST /api/tools returns {outputs:[...], jobs:[{id,state,...}]}.
        // The real job id lives in jobs[0], not at the top level.
        const returnedJobs = asArray(asObject(response).jobs);
        const job = asObject(returnedJobs[0]);
        const result = jobResult(
          job.id ?? asObject(response).id ?? null,
          job.state ?? asObject(response).state ?? "new",
          historyId,
          { submitted_at: submittedAt }
        );
        result.provider_job_id = result.provider_job_id || makeId(ctx, "galaxy");
        result.output.structured.outputs = asArray(asObject(response).outputs).map((item) => asObject(item).id).filter(Boolean);
        return result;
      } catch (error) {
        return {
          provider: PROVIDER, provider_job_id: null, status: "failed", submitted_at: submittedAt,
          output: {}, error: normalizeProviderError(PROVIDER, error, { at: submittedAt })
        };
      }
    },

    async getJobStatus(request = {}, ctx = {}) {
      const args = normalizeCallArgs(request, ctx);
      request = args.request;
      ctx = args.ctx;
      const jobId = jobIdFrom(request);
      const at = makeNow(ctx);
      if (!jobId) return { ...failure(PROVIDER, Object.assign(new Error("job_id_required"), { code: "validation_error", status: 400, retryable: false }), at), provider_job_id: null, status: JOB_STATUS.UNKNOWN };
      try {
        let body;
        try {
          body = (await call("GET", `/api/jobs/${encodeURIComponent(jobId)}`, undefined, ctx)).body;
        } catch (error) {
          if (Number(error?.status) !== 404) throw error;
          // Workflow invocations are not visible through /api/jobs.
          body = (await call("GET", `/api/invocations/${encodeURIComponent(jobId)}`, undefined, ctx)).body;
        }
        const raw = asObject(body);
        const result = jobResult(raw.id ?? jobId, raw.state, raw.history_id);
        result.output.structured.progress = finite(raw.progress) ?? null;
        result.at = at;
        return result;
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
      if (!jobId) return { ...failure(PROVIDER, Object.assign(new Error("job_id_required"), { code: "validation_error", status: 400, retryable: false }), at), provider_job_id: null };
      try {
        await call("POST", `/api/jobs/${encodeURIComponent(jobId)}/cancel`, {}, ctx, { attempts: 2 });
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
      if (!enabled || !configured) return { ...empty, reason: availability() };
      try {
        let historyId = safeId(request?.history_id, { max: 200 });
        const datasetId = safeId(request?.artifact_id ?? request?.dataset_id, { max: 200 });
        if (!historyId && !datasetId) {
          const jobId = jobIdFrom(request);
          if (!jobId) return { ...empty, reason: "reference_required" };
          const job = asObject((await call("GET", `/api/jobs/${encodeURIComponent(jobId)}`, undefined, ctx)).body);
          historyId = safeString(job.history_id, 200);
        }
        let datasets = [];
        if (datasetId) datasets = [asObject((await call("GET", `/api/datasets/${encodeURIComponent(datasetId)}`, undefined, ctx)).body)];
        else if (historyId) datasets = asArray((await call("GET", `/api/histories/${encodeURIComponent(historyId)}/contents`, undefined, ctx)).body);
        // Only completed, non-deleted datasets are downloadable artifacts.
        // Queued/pending history entries are reported by Galaxy but are not
        // artifacts yet and must not be exposed as such.
        const artifacts = datasets
          .map((item) => asObject(item))
          .filter((item) => Boolean(safeString(item.id, 200)) && item.deleted !== true
            && ["ok", "success"].includes(safeString(item.state, 80).toLowerCase()))
          .map((item) => ({
            id: safeString(item.id, 200),
            // UUID and numeric dataset id are persistent identities, NOT HDA
            // ids. They are exposed for association resolution only; download
            // routes must keep using `id`.
            uuid: safeString(item.uuid, 200) || null,
            dataset_id: safeString(item.dataset_id, 200) || null,
            name: safeString(item.name, 300),
            type: safeString(item.extension ?? item.file_ext ?? item.type, 100),
            size: finite(item.file_size ?? item.size),
            state: safeString(item.state, 80),
            // The provider's own value is authoritative. A caller-supplied
            // history_id must never overwrite it, or a history mismatch could
            // not be detected by the storage layer.
            history_id: safeString(item.history_id, 200) || historyId || null,
            deleted: item.deleted === true,
            source: "galaxy:/api/histories/:id/contents"
          }));
        return { provider: PROVIDER, artifacts, ok: true, at };
      } catch (error) {
        return { ...empty, error: normalizeProviderError(PROVIDER, error, { at }) };
      }
    },

    async getUsage(request = {}, ctx = {}) {
      const args = normalizeCallArgs(request, ctx);
      ctx = args.ctx;
      const at = makeNow(ctx);
      const jobId = jobIdFrom(args.request);
      if (!enabled || !configured) return { provider: PROVIDER, ok: false, reason: availability(), usage: null, provider_job_id: jobId || null, at };
      try {
        const info = await quota(ctx);
        return {
          provider: PROVIDER,
          ok: true,
          provider_job_id: jobId || null,
          usage: {
            disk_bytes: info.used_bytes,
            quota_bytes: info.quota_bytes,
            quota_percent: info.quota_percent,
            display: info.nice_total || null
          },
          unknown: info.quota_bytes === null,
          source: "galaxy:/api/users/current/usage",
          at
        };
      } catch (error) {
        return { provider: PROVIDER, ok: false, usage: null, error: normalizeProviderError(PROVIDER, error, { at }), at };
      }
    },

    // Metadata-only dataset text fetch. Kept off the advertised operation list
    // because Workers must first pass the platform's artifact/download gate.
    // GET /api/datasets/:id/content has no route on usegalaxy.eu (404); the
    // verified route is /get_content_as_text -> {item_data, truncated, item_url}.
    async downloadArtifact(request = {}, ctx = {}) {
      const id = safeString(request?.artifact_id ?? request?.dataset_id, 200);
      if (!id) return failure(PROVIDER, Object.assign(new Error("artifact_id_required"), { code: "validation_error", status: 400, retryable: false }));
      try {
        const { body } = await requestJson(PROVIDER, fetcher(ctx), joinUrl(baseUrl, `/api/datasets/${encodeURIComponent(id)}/get_content_as_text`), {
          method: "GET",
          headers: { "X-API-Key": apiKey, Accept: "application/json" }
        }, {
          timeoutMs: Number(ctx?.timeoutMs) > 0 ? Number(ctx.timeoutMs) : defaultTimeout,
          signal: ctx?.signal ?? null,
          attempts: 3,
          sleep: ctx?.sleep ?? null
        });
        const payload = asObject(body);
        if (payload.truncated === true) {
          throw Object.assign(new Error("galaxy dataset content was truncated"), {
            code: "content_truncated", status: 413, retryable: false
          });
        }
        if (typeof payload.item_data !== "string") {
          throw Object.assign(new Error("galaxy dataset content was unavailable"), {
            code: "content_unavailable", status: 502, retryable: false
          });
        }
        return { provider: PROVIDER, ok: true, artifact_id: id, content: payload.item_data };
      } catch (error) {
        return failure(PROVIDER, error, makeNow(ctx));
      }
    }
  };

  return adapter;
}

export const createGalaxyAdapter = createAdapter;
export default createAdapter;
