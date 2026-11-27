// M7 common provider contract.
//
// Pure ES module. No framework, no network, no secrets. This file is the
// stable seam every adapter conforms to; provider-specific wire formats are
// normalized by the adapters before anything enters the platform.
//
// An adapter is produced by `createAdapter(env)` and returns an object whose
// methods are listed in ADAPTER_METHODS. `env` supplies secrets and flags
// (never hardcoded). `ctx` is a per-call bag: { fetch, signal, now, idFactory }.

export const PROVIDER_IDS = Object.freeze(["galaxy", "smartsbio", "ninerouter"]);

export const OPERATIONS = Object.freeze({
  HEALTH_CHECK: "health_check",
  GET_CAPABILITIES: "get_capabilities",
  GET_LIMITS: "get_limits",
  CHAT: "chat",
  CHAT_STREAM: "chat_stream",
  PLAN: "plan",
  SUBMIT_JOB: "submit_job",
  JOB_STATUS: "job_status",
  CANCEL_JOB: "cancel_job",
  GET_ARTIFACTS: "get_artifacts",
  DOWNLOAD_ARTIFACT: "download_artifact",
  GET_USAGE: "get_usage",
  DISCOVER_WORKFLOWS: "discover_workflows",
  INVOKE_WORKFLOW: "invoke_workflow"
});

export const JOB_STATUS = Object.freeze({
  QUEUED: "queued",
  RUNNING: "running",
  SUCCEEDED: "succeeded",
  FAILED: "failed",
  CANCELLED: "cancelled",
  UNKNOWN: "unknown"
});

export const AVAILABILITY = Object.freeze({
  AVAILABLE: "available",
  DEGRADED: "degraded",
  UNAVAILABLE: "unavailable",
  DISABLED: "disabled",
  UNKNOWN: "unknown"
});

export const DISCOVERY_MODE = Object.freeze({
  LIVE: "live",
  FIXTURE: "fixture",
  UNAVAILABLE: "unavailable"
});

export const EXECUTION_MODE = Object.freeze({ REAL: "real", MOCK: "mock" });

export const ADAPTER_METHODS = Object.freeze([
  "id",
  "healthCheck",
  "getCapabilities",
  "getLimits",
  "validateRequest",
  "submitJob",
  "getJobStatus",
  "cancelJob",
  "getArtifacts",
  "getUsage"
]);

// Bounded redaction shared by adapters and diagnostics. Configured secret
// values are removed verbatim; key/token/secret patterns, URLs and query
// strings are masked. Never returns a raw provider body.
export function redactDiagnosticText(value, env = {}) {
  let text = String(value ?? "");
  for (const secret of [env?.GALAXY_API_KEY, env?.AI_API_KEY, env?.NINEROUTER_API_KEY,
    env?.SMARTSBIO_API_KEY, env?.X_AGENT_TOKEN, env?.API_KEY]) {
    if (typeof secret === "string" && secret.length >= 4) text = text.split(secret).join("[redacted]");
  }
  return text
    .replace(/\b(api[-_]?key|x-api-key|authorization|token|secret|password|passwd|credential)\b\s*[:=]\s*["']?[^\s,;"']+/gi, "$1=[redacted]")
    .replace(/https?:\/\/[^\s"'<>]+/gi, "[url]")
    .replace(/[?&][^=\s]+=[^\s&]+/g, "[query]");
}

// Prefer Galaxy's own human-readable error fields. The result is capped and
// redacted before it can be attached to an error or persisted anywhere.
export function sanitizeUpstreamExcerpt(body, env = {}, cap = 600) {
  let text = "";
  if (body && typeof body === "object") {
    const candidate = [body.err_msg, body.message, body.detail, body.error_description,
      body.error?.message, body.error?.detail]
      .find((value) => typeof value === "string" && value.trim());
    text = candidate ?? (typeof body.detail === "string" ? body.detail : JSON.stringify(body));
  } else if (typeof body === "string") text = body;
  if (!text) return "";
  return redactDiagnosticText(text, env).slice(0, Math.max(1, Math.min(Number(cap) || 600, 600)));
}

// A normalized error. Never leak provider raw bodies/secrets to callers;
// only the bounded, sanitized `upstream_excerpt` is allowlisted out.
export function normalizeProviderError(provider, error, meta = {}) {
  const reason = error?.message ?? (typeof error === "string" ? error : "unknown error");
  const status = Number(error?.status ?? error?.response?.status ?? meta.status ?? 0) || 0;
  const normalized = {
    provider,
    code: String(error?.code ?? meta.code ?? ("http_" + (status || "0"))),
    message: String(reason).slice(0, 500),
    status,
    retryable: Boolean(error?.retryable ?? (status === 408 || status === 429 || status >= 500)),
    at: meta.at ?? null
  };
  if (error?.upstream_excerpt) {
    normalized.upstream_excerpt = redactDiagnosticText(error.upstream_excerpt, meta.env).slice(0, 600);
  }
  return normalized;
}

export function makeResult(provider, ok, extra = {}) {
  return { provider, ok: Boolean(ok), ...extra };
}

// Structural conformance check used by unit tests and the registry at startup.
export function assertAdapter(adapter) {
  const errors = [];
  if (!adapter || typeof adapter !== "object") return { valid: false, errors: ["adapter must be an object"] };
  for (const name of ADAPTER_METHODS) {
    if (typeof adapter[name] !== "function") errors.push(`missing method: ${name}`);
  }
  return { valid: errors.length === 0, errors };
}

// The registry uses this to decide whether a tool may be advertised as
// executable. Unavailable or non-executable tools must never be advertised.
export function executableTools(capabilities) {
  const tools = capabilities?.tools;
  if (!Array.isArray(tools)) return [];
  return tools.filter((tool) => tool && tool.available === true && tool.executable === true);
}

export function isOperationSupported(capabilities, operation) {
  const operations = capabilities?.operations;
  return Array.isArray(operations) && operations.includes(operation);
}

// Minimal in-memory storage used by the governor in tests. In production a
// D1-backed implementation with the same load/save interface is injected.
export function createMemoryStorage(initial = {}) {
  let state = JSON.parse(JSON.stringify(initial));
  return {
    async load() {
      return JSON.parse(JSON.stringify(state));
    },
    async save(next) {
      state = JSON.parse(JSON.stringify(next));
      return state;
    }
  };
}

export const EMPTY_STATE = Object.freeze({
  version: 1,
  totals: {},      // { provider: { unit: number|null } }  null == unknown (never invent)
  used: {},        // { provider: { unit: number } } aggregate, reporting only
  usedByCategory: {}, // { provider: { unit: { category: number } } } enforcement
  reserved: {},    // { provider: { unit: number } }
  reservations: {},// { reservationId: { provider, unit, amount, category, at } }
  emergency: {},   // { provider: { stopped, reason, at } }
  usage: {},       // provider-reported counters, opaque but normalized
  alerts: []
});
