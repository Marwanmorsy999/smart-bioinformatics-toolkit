// M7 provider API shared helpers.
// No framework. All provider traffic is server-side; secrets never reach the
// browser. Provider-specific formats are normalized by the adapters before
// they reach this layer or the platform's validation/evidence gate.

import {
  jsonResponse, errorResponse, preflightResponse, methodError, requireMethod,
  readJsonBody, getDb, insertRow, listRows, getRow, makeId, audit, nowIso,
  agentTokenError, safeString, isPublicId
} from "../ai/_lib.js";
import { createRegistry } from "../../../providers/registry.js";
import { createGovernor, DEFAULT_ALLOCATION } from "../../../providers/common/governor.js";
import { normalizeProviderError, PROVIDER_IDS, OPERATIONS, EXECUTION_MODE } from "../../../providers/common/contract.js";

export {
  jsonResponse, errorResponse, preflightResponse, methodError, requireMethod,
  readJsonBody, audit, nowIso, safeString, isPublicId, PROVIDER_IDS, OPERATIONS,
  DEFAULT_ALLOCATION
};

// Migration 0007 tables. Kept local to this module so the M6 SQL_META/fake D1
// remains untouched. New tests use a purpose-built fake that understands these.
export const PROVIDER_SQL = {
  getGovernorState: "SELECT state_json FROM provider_governor_state WHERE singleton = ?",
  putGovernorState: "INSERT INTO provider_governor_state (singleton, state_json, updated_at) VALUES (?, ?, ?) ON CONFLICT(singleton) DO UPDATE SET state_json = excluded.state_json, updated_at = excluded.updated_at",
  insertProviderJob: "INSERT INTO provider_jobs (public_id, provider, tool_id, operation, status, provider_job_id, reservation_id, dataset_id, input_hash, byte_count, consent_id, transfer_id, params_json, created_at, finished_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
  getProviderJob: "SELECT * FROM provider_jobs WHERE public_id = ?",
  updateProviderJob: "UPDATE provider_jobs SET status = ?, finished_at = ?, detail_json = ? WHERE public_id = ?",
  insertTransfer: "INSERT INTO provider_transfers (public_id, dataset_id, source, destination, input_hash, byte_count, consent_id, operation, status, created_at, expires_at, deleted_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
  getTransfer: "SELECT * FROM provider_transfers WHERE public_id = ?",
  listTransfers: "SELECT * FROM provider_transfers ORDER BY created_at DESC LIMIT ?",
  insertConsentRecord: "INSERT INTO provider_consents (public_id, dataset_id, provider, destination, scope_json, granted, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
  getConsentRecord: "SELECT * FROM provider_consents WHERE public_id = ?",
  // Single-use consent: after a successful submission the record is spent, so
  // the same consent cannot authorize a second external transfer.
  consumeConsent: "UPDATE provider_consents SET granted = 0, used_at = ? WHERE public_id = ? AND granted = 1",
  insertArtifactRecord: "INSERT INTO provider_artifacts (public_id, dataset_id, object_key, filename, mime, sha256, bytes, status, created_at, deleted_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
  getArtifactRecord: "SELECT * FROM provider_artifacts WHERE public_id = ?",
  markArtifactDeleted: "UPDATE provider_artifacts SET status = ?, deleted_at = ? WHERE public_id = ?",
  listGovernorAlerts: "SELECT * FROM governor_alerts ORDER BY at DESC LIMIT ?"
};

const registryCache = new Map();
const GOVERNOR_STATE_KEY = "singleton";
const CAPABILITIES_TTL_MS = 5 * 60 * 1000;

export function createGovernorStorage(env) {
  const db = getDb(env);
  return {
    async load() {
      if (!db) throw new Error("D1 binding is unavailable.");
      const row = await getRow(db, PROVIDER_SQL.getGovernorState, [GOVERNOR_STATE_KEY]);
      if (!row?.state_json) return null;
      try { return JSON.parse(row.state_json); } catch { return null; }
    },
    async save(state) {
      if (!db) throw new Error("D1 binding is unavailable.");
      await insertRow(db, PROVIDER_SQL.putGovernorState, [GOVERNOR_STATE_KEY, JSON.stringify(state), nowIso()]);
      return state;
    }
  };
}

export function getGovernor(env) {
  if (!env || !getDb(env)) throw new Error("D1 binding is unavailable.");
  return createGovernor({
    storage: createGovernorStorage(env),
    onAlert: (entry) => {
      // Alerts are advisory and must never break a job. Persist best-effort.
      try {
        const db = getDb(env);
        if (db) {
          void insertRow(db, "INSERT INTO governor_alerts (public_id, provider, unit, category, ratio, kind, at) VALUES (?, ?, ?, ?, ?, ?, ?)", [
            makeId("gal"), entry.provider, entry.unit, entry.category ?? null, entry.ratio ?? null, entry.kind, entry.at
          ]).catch(() => {});
        }
      } catch { /* advisory only */ }
    }
  });
}

export function getRegistry(env, deps = {}) {
  const key = `${String(env?.GALAXY_BASE_URL ?? "")}|${String(env?.SMARTSBIO_BASE_URL ?? "")}|${String(env?.NINEROUTER_BASE_URL ?? "")}`;
  const cached = registryCache.get(key);
  if (cached) return cached.registry;
  const registry = createRegistry(env, deps);
  registryCache.set(key, { registry, at: Date.now() });
  return registry;
}

// Capability discovery is metadata-only and cached briefly so the UI never
// triggers uploads or repeated network calls merely to list tools.
export async function getCachedCapabilities(registry, providerId, env) {
  const key = `${providerId}|${String(env?.GALAXY_BASE_URL ?? "")}|${String(env?.NINEROUTER_BASE_URL ?? "")}`;
  const hit = registryCache.get(`caps:${key}`);
  if (hit && Date.now() - hit.at < CAPABILITIES_TTL_MS) return hit.value;
  const provider = registry.getProvider(providerId);
  const value = provider ? await provider.getCapabilities({ fetch: env?.FETCH_IMPL }) : null;
  registryCache.set(`caps:${key}`, { value, at: Date.now() });
  return value;
}

// Health checks are cached briefly so a list request cannot trigger repeated
// live calls to every provider.
export async function getCachedHealth(provider, id, env) {
  const key = `health:${id}|${String(env?.GALAXY_BASE_URL ?? "")}|${String(env?.NINEROUTER_BASE_URL ?? "")}`;
  const hit = registryCache.get(key);
  if (hit && Date.now() - hit.at < 60 * 1000) return hit.value;
  const value = await provider.healthCheck({ fetch: env?.FETCH_IMPL });
  registryCache.set(key, { value, at: Date.now() });
  return value;
}

export function typedProviderError(message, status, request, provider, detail = {}) {
  return errorResponse(message, status, request, {
    "X-Provider": String(provider ?? "unknown"),
    "X-Error-Detail": JSON.stringify({ provider, ...detail })
  });
}

export function normalizeForApi(provider, error, request) {
  const normalized = normalizeProviderError(provider, error);
  return typedProviderError(normalized.message, normalized.status >= 400 && normalized.status < 600 ? normalized.status : 502, request, provider, {
    code: normalized.code, retryable: normalized.retryable
  });
}

const ENABLED_FLAG = Object.freeze({
  galaxy: "GALAXY_ENABLED",
  smartsbio: "SMARTSBIO_ENABLED",
  ninerouter: "NINEROUTER_ENABLED"
});

export function isEnabled(env, providerId) {
  return env?.[ENABLED_FLAG[providerId] ?? "__never__"] === "true";
}

export function requireEnabled(registry, providerId, request, env) {
  const provider = registry.getProvider(providerId);
  if (!provider) return typedProviderError(`Unknown provider: ${providerId}`, 404, request, providerId);
  if (!isEnabled(env, providerId)) {
    return typedProviderError(`Provider '${providerId}' is disabled.`, 403, request, providerId, { reason: "feature_flag_disabled" });
  }
  return null;
}

export function requireOwner(request, env) {
  return agentTokenError(request, env);
}

// Best-effort in-memory abuse control for public, budget-consuming endpoints.
// Worker isolates are ephemeral, so this is NOT a durable quota: real public
// release requires per-user authentication (see DATA_TRANSFER_AND_PRIVACY.md).
const rateBuckets = new Map();
export function rateLimit(request, scope, limit, windowMs) {
  const forwarded = request?.headers?.get?.("CF-Connecting-IP") ?? request?.headers?.get?.("X-Forwarded-For") ?? "unknown";
  const key = `${scope}:${String(forwarded).slice(0, 100)}`;
  const now = Date.now();
  const hits = (rateBuckets.get(key) ?? []).filter((at) => now - at < windowMs);
  if (hits.length >= limit) {
    return errorResponse("Rate limit exceeded.", 429, request, { "Retry-After": "60" });
  }
  hits.push(now);
  rateBuckets.set(key, hits);
  if (rateBuckets.size > 5000) {
    for (const [storedKey, value] of rateBuckets) {
      if (!value.some((at) => now - at < windowMs)) rateBuckets.delete(storedKey);
    }
  }
  return null;
}

export async function writeAudit(db, action, target, detail = {}, idFactory, timestamp) {
  await audit(db, { actor: "provider-api", action, target, detail, idFactory, timestamp });
}

export function executionMode(env) {
  return env?.AI_EXECUTION_MODE === "mock" ? EXECUTION_MODE.MOCK : EXECUTION_MODE.REAL;
}

export function providerPayload(request, env, extra = {}) {
  return { execution_mode: executionMode(env), generated_at: nowIso(), ...extra };
}
