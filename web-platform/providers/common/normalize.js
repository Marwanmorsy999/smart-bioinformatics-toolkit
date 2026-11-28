// M7 normalization helpers shared by provider adapters.
//
// Contract shapes are defined in contract.js; transport concerns in retry.js.
// This module only converts provider payloads into those shapes and builds
// normalized errors. It never contains provider credentials or endpoints.

import { JOB_STATUS, normalizeProviderError } from "./contract.js";

export { ProviderHttpError, isRetryableStatus, requestJson, requestResponse, readSse, withTimeout } from "./retry.js";

export function safeString(value, max = 2000) {
  if (typeof value !== "string") return "";
  return value.slice(0, max);
}

export function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

export function asArray(value) {
  return Array.isArray(value) ? value : [];
}

export function pick(source, keys) {
  const out = {};
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(source, key) && source[key] !== undefined) out[key] = source[key];
  }
  return out;
}

// Validate identifiers before they are placed into provider request bodies or
// URL paths. Whitespace, control characters and traversal sequences are always
// rejected. `allowSlash` is needed for Galaxy tool ids from the ToolShed (they
// legitimately contain '/'), which are sent in a JSON body, never in a path.
export function safeId(value, { max = 200, allowSlash = false } = {}) {
  const id = safeString(value, max + 1).trim();
  if (!id || id.length > max || id.includes("..")) return "";
  if (/[\s\u0000-\u001f\u007f]/.test(id)) return "";
  const pattern = allowSlash
    ? /^[A-Za-z0-9][A-Za-z0-9_.:\-+@/]*$/
    : /^[A-Za-z0-9][A-Za-z0-9_.:\-+]*$/;
  return pattern.test(id) ? id : "";
}

const CTX_KEYS = Object.freeze(["fetch", "signal", "now", "idFactory", "sleep", "timeoutMs", "parse"]);
const REQUEST_KEYS = Object.freeze([
  "operation", "message", "system", "job_id", "provider_job_id", "tool_id", "workflow_id",
  "pipeline_id", "history_id", "artifact_id", "dataset_id", "key", "inputs", "input",
  "params", "conversation_id", "model", "json_schema", "workspace_id", "async"
]);

// The polling methods take a request object and a ctx bag. For compatibility
// with callers that pass only a ctx bag (fetch/signal/...), recognize that case
// and return an empty request instead of misreading `fetch` as an id.
export function normalizeCallArgs(first = {}, ctx = {}) {
  const primary = asObject(first);
  const looksLikeCtx = CTX_KEYS.some((key) => key in primary) && !REQUEST_KEYS.some((key) => key in primary);
  return looksLikeCtx ? { request: {}, ctx: { ...primary, ...asObject(ctx) } } : { request: primary, ctx: asObject(ctx) };
}

// job_id is canonical; provider_job_id is accepted as an alias everywhere.
export function jobIdFrom(request) {
  const source = asObject(request);
  return safeId(source.job_id ?? source.provider_job_id, { max: 200 });
}

// Join a configured base URL and a provider API path. Both pieces come from
// env / provider code only; no loopback or other endpoint is ever invented.
export function joinUrl(base, path) {
  const root = safeString(base).replace(/\/+$/, "");
  const suffix = safeString(path).replace(/^\/+/, "");
  return `${root}/${suffix}`;
}

export function makeNow(ctx) {
  if (typeof ctx?.now === "function") {
    const value = ctx.now();
    if (typeof value === "string" && Number.isFinite(Date.parse(value))) return new Date(value).toISOString();
  }
  return new Date().toISOString();
}

export function makeId(ctx, prefix = "job") {
  if (typeof ctx?.idFactory === "function") {
    const value = ctx.idFactory(prefix);
    if (typeof value === "string" && value) return value;
  }
  const suffix = `${Date.now().toString(16)}${Math.floor(Math.random() * 0xffff).toString(16).padStart(4, "0")}`;
  return `${prefix}_${suffix}`;
}

export function toNormalizedError(provider, error, at = null) {
  return normalizeProviderError(provider, error, { at });
}

export function failure(provider, error, at = null) {
  return { ok: false, error: toNormalizedError(provider, error, at) };
}

// Map provider-specific state words onto the stable contract vocabulary.
// Unknown states deliberately stay UNKNOWN rather than being guessed.
const STATE_MAP = Object.freeze({
  new: JOB_STATUS.QUEUED,
  queued: JOB_STATUS.QUEUED,
  pending: JOB_STATUS.QUEUED,
  submitted: JOB_STATUS.QUEUED,
  uploading: JOB_STATUS.QUEUED,
  running: JOB_STATUS.RUNNING,
  active: JOB_STATUS.RUNNING,
  in_progress: JOB_STATUS.RUNNING,
  ok: JOB_STATUS.SUCCEEDED,
  success: JOB_STATUS.SUCCEEDED,
  succeeded: JOB_STATUS.SUCCEEDED,
  completed: JOB_STATUS.SUCCEEDED,
  finished: JOB_STATUS.SUCCEEDED,
  error: JOB_STATUS.FAILED,
  failed: JOB_STATUS.FAILED,
  cancelled: JOB_STATUS.CANCELLED,
  canceled: JOB_STATUS.CANCELLED,
  deleted: JOB_STATUS.CANCELLED
});

export function mapState(state) {
  const key = safeString(state, 80).toLowerCase().replace(/[\s-]+/g, "_");
  return STATE_MAP[key] ?? JOB_STATUS.UNKNOWN;
}

// A uniform token-usage shape. Missing provider counters stay undefined; they
// are never filled with zeros or invented totals.
export function normalizeTokenUsage(usage, model) {
  const raw = asObject(usage);
  const out = {};
  for (const [target, sources] of Object.entries({
    input_tokens: ["input_tokens", "prompt_tokens", "inputTokens", "promptTokens"],
    output_tokens: ["output_tokens", "completion_tokens", "outputTokens", "completionTokens"],
    total_tokens: ["total_tokens", "totalTokens"]
  })) {
    for (const key of sources) {
      const value = raw[key];
      if (Number.isFinite(Number(value))) { out[target] = Number(value); break; }
    }
  }
  const reportedModel = safeString(raw.model ?? model, 200);
  if (reportedModel) out.model = reportedModel;
  return Object.keys(out).length ? out : undefined;
}

export function emptyResult(provider, reason, extra = {}) {
  return { provider, ok: false, reason: safeString(reason, 120), ...extra };
}
