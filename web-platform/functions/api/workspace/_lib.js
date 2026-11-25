// M7.4 workspace shared helpers. Authorization is owner scoping on the ONE
// existing operator token (env.AI_AGENT_TOKEN); it is NOT a user account system.
// The raw token is never stored, audited or returned.

import {
  SQL,
  errorResponse,
  preflightResponse,
  methodError,
  readJsonBody,
  getDb,
  getRow,
  listRows,
  insertRow,
  audit,
  makeId,
  nowIso,
  safeString,
  isPublicId,
  parseJson,
  envExecutionMode
} from "../ai/_lib.js";
import { requireOwner } from "../providers/_lib.js";
import { getWorkflow } from "./catalog.js";

export const WORKSPACE_STATES = Object.freeze([
  "draft",
  "planned",
  "awaiting_approval",
  "queued",
  "running",
  "execution_completed",
  "artifact_retrieval",
  "validation",
  "succeeded",
  "failed",
  "cancelled"
]);

// Strict, forward-only lifecycle. Execution, artifact retrieval and validation
// are deliberately separate and cannot be skipped.
export const STATE_TRANSITIONS = Object.freeze({
  draft: Object.freeze(["planned", "cancelled"]),
  planned: Object.freeze(["awaiting_approval", "cancelled"]),
  awaiting_approval: Object.freeze(["queued", "cancelled"]),
  queued: Object.freeze(["running", "cancelled"]),
  running: Object.freeze(["execution_completed", "failed", "cancelled"]),
  execution_completed: Object.freeze(["artifact_retrieval", "failed"]),
  artifact_retrieval: Object.freeze(["validation", "failed"]),
  validation: Object.freeze(["succeeded", "failed"]),
  succeeded: Object.freeze([]),
  failed: Object.freeze([]),
  cancelled: Object.freeze([])
});

const TERMINAL_STATES = new Set(["succeeded", "failed", "cancelled"]);
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const VALIDATION_STATES = new Set(["unvalidated", "pending", "passed", "warn", "failed"]);
const PROJECT_STATUSES = new Set(["active", "archived"]);
const ARTIFACT_RETRIEVAL_STATES = new Set(["not_required", "pending", "retrieved", "failed"]);
const FORBIDDEN_URL_KEYS = new Set(["url", "download_url", "public_url", "href", "link", "uri", "artifact_url"]);
const MAX_PARAMS_CHARS = 16 * 1024;

// --------------------------------------------------------------- auth / db

/**
 * Check the existing operator token and derive a NON-SECRET owner principal.
 * Different token values produce different owners; the token itself is never
 * persisted, logged or returned.
 */
export async function deriveOwner(request, env) {
  const denied = requireOwner(request, env);
  if (denied) return { owner: null, error: denied };
  const token = request.headers.get("X-Agent-Token") ?? "";
  try {
    if (!globalThis.crypto?.subtle) throw new Error("WebCrypto unavailable");
    const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
    const hex = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
    return { owner: `owner_${hex.slice(0, 16)}`, error: null };
  } catch {
    return { owner: null, error: errorResponse("Owner derivation is unavailable.", 503, request) };
  }
}

export function requireAnyMethod(request, allowed) {
  if (request.method === "OPTIONS") return preflightResponse(request);
  if (!allowed.includes(request.method)) return methodError(request, allowed.join(", "));
  return null;
}

export function requireDb(env, request) {
  const db = getDb(env);
  if (!db) return { db: null, error: errorResponse("Workspace database binding is unavailable.", 503, request) };
  return { db, error: null };
}

export async function workspaceAudit(db, owner, action, target, detail = {}, idFactory, timestamp) {
  await audit(db, { actor: owner, action, target, detail, timestamp: timestamp ?? nowIso(), idFactory });
}

export async function readWorkspaceBody(request) {
  return readJsonBody(request);
}

export async function getProject(db, projectId, owner) {
  return getRow(db, SQL.getWorkspaceProject, [projectId, owner]);
}

export async function getRun(db, runId, owner) {
  return getRow(db, SQL.getWorkspaceRun, [runId, owner]);
}

// -------------------------------------------------------------- validation

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function field(payload, key, max, fallback = null) {
  const value = safeString(payload[key], max);
  return value || fallback;
}

function hasForbiddenUrl(payload) {
  return Object.keys(payload).some((key) => FORBIDDEN_URL_KEYS.has(key.toLowerCase()));
}

export function validateProjectCreate(payload) {
  if (!isPlainObject(payload)) return { error: "Request body must be an object." };
  const name = field(payload, "name", 200);
  if (!name) return { error: "name is required (max 200 characters)." };
  const status = field(payload, "status", 40, "active");
  if (!PROJECT_STATUSES.has(status)) return { error: "status must be 'active' or 'archived'." };
  return {
    error: null,
    value: {
      name,
      description: field(payload, "description", 2000),
      scientific_objective: field(payload, "scientific_objective", 2000),
      status
    }
  };
}

export function validateProjectPatch(payload) {
  if (!isPlainObject(payload)) return { error: "Request body must be an object." };
  const value = {};
  if (Object.hasOwn(payload, "name")) {
    value.name = field(payload, "name", 200);
    if (!value.name) return { error: "name must not be empty." };
  }
  if (Object.hasOwn(payload, "description")) value.description = field(payload, "description", 2000);
  if (Object.hasOwn(payload, "scientific_objective")) value.scientific_objective = field(payload, "scientific_objective", 2000);
  if (Object.hasOwn(payload, "status")) {
    value.status = field(payload, "status", 40);
    if (!PROJECT_STATUSES.has(value.status)) return { error: "status must be 'active' or 'archived'." };
  }
  if (Object.keys(value).length === 0) return { error: "No editable project fields were supplied." };
  return { error: null, value };
}

export function validateDatasetCreate(payload) {
  if (!isPlainObject(payload)) return { error: "Request body must be an object." };
  if (hasForbiddenUrl(payload)) return { error: "Public URL fields are not accepted; dataset bytes are not uploaded." };
  const filename = field(payload, "filename", 200);
  if (!filename || filename.includes("/") || filename.includes("\\")) {
    return { error: "filename is required and must not contain path separators." };
  }
  const sha256 = field(payload, "sha256", 64);
  if (!SHA256_PATTERN.test(sha256)) return { error: "sha256 must be 64 lowercase hex characters." };
  const sizeBytes = payload.size_bytes;
  if (!Number.isInteger(sizeBytes) || sizeBytes < 0 || sizeBytes > 1e12) {
    return { error: "size_bytes must be a non-negative integer." };
  }
  const validationState = field(payload, "validation_state", 40, "unvalidated");
  if (!VALIDATION_STATES.has(validationState)) return { error: "validation_state is invalid." };
  const providerHistoryRef = field(payload, "provider_history_ref", 300);
  if (providerHistoryRef && /^https?:\/\//i.test(providerHistoryRef)) {
    return { error: "provider_history_ref must be a reference, not a public URL." };
  }
  return {
    error: null,
    value: {
      filename,
      sha256,
      size_bytes: sizeBytes,
      mime: field(payload, "mime", 100),
      file_format: field(payload, "file_format", 50),
      source: field(payload, "source", 300),
      validation_state: validationState,
      provider_history_ref: providerHistoryRef
    }
  };
}

export function validateRunCreate(payload, projectDatasetIds, env) {
  if (!isPlainObject(payload)) return { error: "Request body must be an object." };
  const workflowId = field(payload, "workflow_id", 100);
  if (!workflowId) return { error: "workflow_id is required." };
  const workflow = getWorkflow(workflowId);
  if (!workflow) return { error: `Unknown workflow_id: ${workflowId}` };
  const datasetIds = payload.dataset_ids;
  if (!Array.isArray(datasetIds) || datasetIds.length < 1 || datasetIds.length > 20) {
    return { error: "dataset_ids must contain between 1 and 20 entries." };
  }
  for (const datasetId of datasetIds) {
    if (!isPublicId(datasetId) || !datasetId.startsWith("ds_")) {
      return { error: "Each dataset id must be a valid ds_ public id." };
    }
    if (!projectDatasetIds.includes(datasetId)) {
      return { error: `Dataset ${datasetId} does not belong to this project.` };
    }
  }
  const params = payload.params ?? {};
  if (!isPlainObject(params)) return { error: "params must be an object." };
  let serialized;
  try {
    serialized = JSON.stringify(params);
  } catch {
    return { error: "params must be JSON-serializable." };
  }
  if (serialized.length > MAX_PARAMS_CHARS) return { error: "params are too large." };
  const requestedMode = field(payload, "execution_mode", 20, null);
  if (requestedMode && requestedMode !== "real" && requestedMode !== "mock") {
    return { error: "execution_mode must be 'real' or 'mock'." };
  }
  const effectiveMode = env?.AI_EXECUTION_MODE === "mock" ? "mock" : (requestedMode ?? envExecutionMode(env));
  return {
    error: null,
    value: {
      workflow,
      objective: field(payload, "objective", 2000),
      dataset_ids: [...datasetIds],
      params,
      execution_provider: field(payload, "execution_provider", 100),
      execution_mode: effectiveMode
    }
  };
}

// Optional PATCH bookkeeping fields are serialized here (bounded) so the setters
// in handlers never persist unbounded or non-JSON caller data.
export function validateBookkeeping(payload) {
  const limits = {
    steps: 64 * 1024,
    artifact_refs: 64 * 1024,
    validation: 32 * 1024,
    provenance: 64 * 1024,
    error: 16 * 1024
  };
  const value = {};
  for (const [key, max] of Object.entries(limits)) {
    if (!Object.hasOwn(payload, key)) continue;
    const candidate = payload[key];
    if (candidate === null) {
      value[key] = null;
      continue;
    }
    if (!isPlainObject(candidate) && !Array.isArray(candidate)) {
      return { error: `${key} must be an object, array or null.` };
    }
    let serialized;
    try {
      serialized = JSON.stringify(candidate);
    } catch {
      return { error: `${key} must be JSON-serializable.` };
    }
    if (serialized.length > max) return { error: `${key} is too large.` };
    value[key] = serialized;
  }
  return { error: null, value };
}

export function isValidTransition(current, next) {
  return STATE_TRANSITIONS[current]?.includes(next) === true;
}

export function isTerminalState(state) {
  return TERMINAL_STATES.has(state);
}

/**
 * A succeeded run must have a complete provenance record. This is the honesty
 * gate: the API never marks a run successful on incomplete evidence.
 */
export function validateProvenanceRecord(record, run) {
  if (!isPlainObject(record)) return { valid: false, error: "provenance must be an object." };
  if (!SHA256_PATTERN.test(String(record.input_sha256 ?? ""))) {
    return { valid: false, error: "provenance.input_sha256 must be 64 lowercase hex characters." };
  }
  if (record.workflow_id !== run.workflow_id || record.workflow_version !== run.workflow_version) {
    return { valid: false, error: "provenance workflow id/version must match the run." };
  }
  if (!Array.isArray(record.tools) || record.tools.length === 0) {
    return { valid: false, error: "provenance.tools must list at least one tool." };
  }
  for (const tool of record.tools) {
    if (!isPlainObject(tool) || !field(tool, "name", 200) || !field(tool, "version", 100)) {
      return { valid: false, error: "Each provenance tool needs a name and version." };
    }
  }
  if (!isPlainObject(record.params)) return { valid: false, error: "provenance.params must be an object." };
  if (!isPlainObject(record.timestamps) || !field(record.timestamps, "started_at", 60) || !field(record.timestamps, "completed_at", 60)) {
    return { valid: false, error: "provenance.timestamps need started_at and completed_at." };
  }
  if (!Array.isArray(record.provider_job_refs)) {
    return { valid: false, error: "provenance.provider_job_refs must be an array (may be empty for local execution)." };
  }
  if (!Array.isArray(record.output_hashes) || record.output_hashes.length === 0) {
    return { valid: false, error: "provenance.output_hashes must list at least one artifact hash." };
  }
  for (const output of record.output_hashes) {
    if (!isPlainObject(output) || !field(output, "artifact_ref", 200) || !SHA256_PATTERN.test(String(output.sha256 ?? ""))) {
      return { valid: false, error: "Each output hash needs artifact_ref and a 64-hex sha256." };
    }
  }
  if (!ARTIFACT_RETRIEVAL_STATES.has(String(record.artifact_retrieval_state ?? ""))) {
    return { valid: false, error: "provenance.artifact_retrieval_state is invalid." };
  }
  const outcomes = record.validation_outcomes;
  if (!(Array.isArray(outcomes) && outcomes.length > 0) && !(isPlainObject(outcomes) && Object.keys(outcomes).length > 0)) {
    return { valid: false, error: "provenance.validation_outcomes must be a non-empty array or object." };
  }
  if (!field(record, "report_generated_at", 60)) {
    return { valid: false, error: "provenance.report_generated_at is required." };
  }
  return { valid: true, error: null };
}

// --------------------------------------------------------------------- DTOs

export function toProjectDto(row, counts = {}) {
  return {
    id: row.public_id,
    name: row.name,
    description: row.description ?? null,
    scientific_objective: row.scientific_objective ?? null,
    status: row.status ?? "active",
    owner: row.owner ?? null,
    created_at: row.created_at,
    updated_at: row.updated_at ?? null,
    dataset_count: counts.dataset_count ?? 0,
    run_count: counts.run_count ?? 0
  };
}

export function toDatasetDto(row) {
  return {
    id: row.public_id,
    project_id: row.project_id,
    filename: row.filename,
    sha256: row.sha256,
    size_bytes: row.size_bytes,
    mime: row.mime ?? null,
    file_format: row.file_format ?? null,
    source: row.source ?? null,
    validation_state: row.validation_state ?? "unvalidated",
    provider_history_ref: row.provider_history_ref ?? null,
    // A label, not a resolvable location and not proof bytes exist anywhere.
    storage_ref: row.storage_ref ?? null,
    uploaded_at: row.uploaded_at ?? null,
    created_at: row.created_at,
    owner: row.owner ?? null,
    is_demo: Number(row.is_demo ?? 0) === 1,
    fasta_text_present: Boolean(row.fasta_text)
  };
}

function validationStatus(row) {
  const validation = parseJson(row.validation_json);
  if (validation && typeof validation.status === "string") return validation.status;
  return "pending";
}

export function toRunSummary(row) {
  const workflow = getWorkflow(row.workflow_id);
  const inputs = parseJson(row.input_datasets_json) ?? [];
  return {
    id: row.public_id,
    project_id: row.project_id,
    workflow_id: row.workflow_id,
    workflow_name: workflow?.scientific_purpose ?? row.workflow_id,
    workflow_version: row.workflow_version,
    objective: row.objective ?? null,
    state: row.state,
    created_at: row.created_at,
    completed_at: row.completed_at ?? null,
    input_datasets: inputs,
    execution_provider: row.execution_provider ?? null,
    execution_mode: row.execution_mode ?? "real",
    validation_status: validationStatus(row),
    is_demo: Number(row.is_demo ?? 0) === 1
  };
}

export function toRunDetail(row, { reportAvailable = false, provenance = null } = {}) {
  return {
    ...toRunSummary(row),
    params: parseJson(row.params_json) ?? {},
    steps: parseJson(row.steps_json) ?? [],
    artifact_refs: parseJson(row.artifact_refs_json) ?? [],
    validation: parseJson(row.validation_json),
    provenance: provenance ?? parseJson(row.provenance_json),
    error: parseJson(row.error_json),
    report_available: reportAvailable,
    report_access: reportAvailable ? `/api/workspace/runs/${row.public_id}/report` : null
  };
}
