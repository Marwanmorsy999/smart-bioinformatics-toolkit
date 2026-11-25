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

// A normalized error. Never leak provider raw bodies/secrets to callers.
export function normalizeProviderError(provider, error, meta = {}) {
  const reason = error?.message ?? (typeof error === "string" ? error : "unknown error");
  const status = Number(error?.status ?? error?.response?.status ?? meta.status ?? 0) || 0;
  return {
    provider,
    code: String(error?.code ?? meta.code ?? ("http_" + (status || "0"))),
    message: String(reason).slice(0, 500),
    status,
    retryable: Boolean(error?.retryable ?? (status === 408 || status === 429 || status >= 500)),
    at: meta.at ?? null
  };
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
