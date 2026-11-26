// Shared helpers for the AI control-plane Pages Functions.
// Plain ES modules: no framework, no heavy compute, no paid services.
// Reuses the response/FH patterns from functions/api/blast/_lib.js.

import { SQL as BLAST_SQL, htmlEscape, hashInput, validateFasta } from "../blast/_lib.js";
import { validateExplanationReferences } from "./reference_ledger.js";
import { getTool, isKnownTool } from "./registry.js";

export { htmlEscape, hashInput, validateFasta };

export const DEFAULT_EXECUTION_MODE = "real";
export const MAX_FASTA_BYTES = 64 * 1024;
export const MAX_REQUEST_BODY_CHARS = 128 * 1024;
export const MAX_RESULT_BODY_CHARS = 2 * 1024 * 1024;
export const MIN_CONFIDENCE = 0.5;

// M7 adds pcon (provider consent), pjob (provider job), xfer (transfer),
// rsv (reservation) and gal (governor alert) identifiers. They share the same
// random 16-hex form and are validated by the same whitelist.
// M7.4 adds prov (provenance record) and reserves rpt for report identifiers
// if a dedicated reports table is ever needed. Additive: previously valid ids
// remain valid.
const PUBLIC_ID_PATTERN = /^(req|ds|plan|job|art|apr|run|proj|ref|pcon|pjob|xfer|rsv|gal|prov|rpt)_[0-9a-f]{16}$/;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;

// SQL is centralised so the fake D1 in tests can assert exactly what runs.
export const SQL = {
  insertDataset: "INSERT INTO datasets (public_id, project_id, filename, sha256, size_bytes, mime, storage_ref, fasta_text, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
  getDataset: "SELECT * FROM datasets WHERE public_id = ?",
  insertRequest: "INSERT INTO ai_requests (public_id, project_id, dataset_id, raw_text, inferred_intent, confidence, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
  insertPlan: "INSERT INTO plans (public_id, request_id, version, plan_json, created_at) VALUES (?, ?, ?, ?, ?)",
  getPlan: "SELECT * FROM plans WHERE public_id = ?",
  insertApproval: "INSERT INTO approvals (public_id, plan_id, step_id, approved_by, consents_json, approved_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
  insertJob: "INSERT INTO jobs (public_id, plan_id, step_id, status, tool_id, params_json, inputs_json, consent_json, backend, agent_id, attempts, timeout_s, execution_mode, created_at, started_at, finished_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
  getJob: "SELECT * FROM jobs WHERE public_id = ?",
  // M7.13: finalise the two step rows whose state was pending while an
  // executed protein job was running.
  updateJobByPlanStep: "UPDATE jobs SET status = ?, finished_at = ? WHERE plan_id = ? AND step_id = ?",
  listQueuedJobs: "SELECT * FROM jobs WHERE status = ? ORDER BY created_at ASC LIMIT ?",
  claimJob: "UPDATE jobs SET status = ?, agent_id = ?, started_at = ?, attempts = attempts + 1 WHERE public_id = ? AND status = ?",
  finishJob: "UPDATE jobs SET status = ?, finished_at = ? WHERE public_id = ?",
  // The trailing status predicates make result submission a conditional
  // update: only the first writer (the claimed, running job) changes a row.
  // The extra `status = ?` binding pins the claimed status so both real D1 and
  // the metadata-driven fake enforce the same guard.
  saveJobResult: "UPDATE jobs SET status = ?, finished_at = ?, result_json = ?, validation_json = ?, explanation_json = ?, provenance_json = ?, report_json = ?, execution_mode = ? WHERE public_id = ? AND status IN ('queued','running') AND status = ?",
  listJobsForPlan: "SELECT * FROM jobs WHERE plan_id = ? ORDER BY created_at ASC",
  listApprovalsForPlan: "SELECT * FROM approvals WHERE plan_id = ?",
  listAuditEvents: "SELECT * FROM audit_events ORDER BY timestamp ASC",
  insertArtifact: "INSERT INTO artifacts (public_id, run_id, name, kind, storage_ref, sha256, bytes, mime, content, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
  listArtifactsForRun: "SELECT * FROM artifacts WHERE run_id = ? ORDER BY name ASC",
  insertToolRun: "INSERT INTO tool_runs (public_id, job_id, tool_id, tool_version, params_json, input_refs_json, output_refs_json, provenance_json, started_at, finished_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
  insertReference: "INSERT INTO evidence_references (public_id, key, title, url, doi, license, verified_by, verified_at, notes, verified) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
  insertReportRun: "INSERT INTO report_runs (public_id, plan_id, job_id, report_ref, explanation_ref, validation_ref, report_html, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
  getReportRun: "SELECT * FROM report_runs WHERE job_id = ?",
  insertAudit: "INSERT INTO audit_events (public_id, actor, action, target, detail_json, timestamp) VALUES (?, ?, ?, ?, ?, ?)",

  // M7.4 unified workspace. Additive only; see migrations/0011_workspace.sql.
  // Every workspace statement pins owner with an equality predicate so the
  // metadata-driven fake D1 and real D1 enforce the same authorization filter.
  insertWorkspaceProject: "INSERT INTO projects (public_id, name, owner, settings_json, created_at, description, scientific_objective, status, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
  getWorkspaceProject: "SELECT * FROM projects WHERE public_id = ? AND owner = ?",
  listProjectsByOwner: "SELECT * FROM projects WHERE owner = ?",
  updateProjectMetadata: "UPDATE projects SET name = ?, description = ?, scientific_objective = ?, status = ?, updated_at = ? WHERE public_id = ? AND owner = ?",
  setProjectStatus: "UPDATE projects SET status = ?, updated_at = ? WHERE public_id = ? AND owner = ?",
  insertWorkspaceDataset: "INSERT INTO datasets (public_id, project_id, filename, sha256, size_bytes, mime, storage_ref, fasta_text, created_at, file_format, source, validation_state, provider_history_ref, uploaded_at, owner, is_demo) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
  listDatasetsForProject: "SELECT * FROM datasets WHERE project_id = ? AND owner = ?",
  listDatasetsByOwner: "SELECT * FROM datasets WHERE owner = ?",
  insertWorkspaceRun: "INSERT INTO workspace_runs (public_id, project_id, workflow_id, workflow_version, objective, input_datasets_json, params_json, execution_provider, execution_mode, state, created_at, completed_at, steps_json, artifact_refs_json, validation_json, provenance_json, error_json, owner, is_demo) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
  getWorkspaceRun: "SELECT * FROM workspace_runs WHERE public_id = ? AND owner = ?",
  listRunsForProject: "SELECT * FROM workspace_runs WHERE project_id = ? AND owner = ?",
  listRunsByOwner: "SELECT * FROM workspace_runs WHERE owner = ?",
  updateWorkspaceRun: "UPDATE workspace_runs SET state = ?, completed_at = ?, steps_json = ?, artifact_refs_json = ?, validation_json = ?, provenance_json = ?, error_json = ? WHERE public_id = ? AND owner = ?",
  insertProvenanceRecord: "INSERT INTO provenance_records (public_id, run_id, record_json, created_at, owner) VALUES (?, ?, ?, ?, ?)",
  getProvenanceRecord: "SELECT * FROM provenance_records WHERE run_id = ? AND owner = ?",

  // M7.13 protein annotation. Additive: a small index keyed by the EBI-style
  // protein MD5 so a browser refresh returns the stored run instead of
  // re-submitting to EBI/UniProt. The AI jobs/artifacts tables remain the
  // source of truth for /api/ai/runs/:id and /recovery.
  insertProteinRun: "INSERT INTO protein_runs (public_id, md5, route, provider_job_id, state, result_json, created_at, completed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
  getProteinRunByMd5: "SELECT * FROM protein_runs WHERE md5 = ? ORDER BY created_at ASC",
  // M7.13 fix: the dedupe key is (sequence MD5, route), never MD5 alone. A
  // precomputed reference run and an executed job are distinct workflows;
  // one must never be returned in place of the other.
  getProteinRunsByMd5AndRoute: "SELECT * FROM protein_runs WHERE md5 = ? AND route = ? ORDER BY created_at ASC",
  getProteinRunByPublicId: "SELECT * FROM protein_runs WHERE public_id = ?",
  getProteinRunByJobId: "SELECT * FROM protein_runs WHERE provider_job_id = ?",
  updateProteinRun: "UPDATE protein_runs SET state = ?, provider_job_id = ?, result_json = ?, completed_at = ? WHERE public_id = ?"
};

export const SQL_META = {
  [SQL.insertDataset]: { op: "insert", table: "datasets", columns: ["public_id", "project_id", "filename", "sha256", "size_bytes", "mime", "storage_ref", "fasta_text", "created_at"] },
  [SQL.getDataset]: { op: "select", table: "datasets", where: ["public_id"] },
  [SQL.insertRequest]: { op: "insert", table: "ai_requests", columns: ["public_id", "project_id", "dataset_id", "raw_text", "inferred_intent", "confidence", "created_at"] },
  [SQL.insertPlan]: { op: "insert", table: "plans", columns: ["public_id", "request_id", "version", "plan_json", "created_at"] },
  [SQL.getPlan]: { op: "select", table: "plans", where: ["public_id"] },
  [SQL.insertApproval]: { op: "insert", table: "approvals", columns: ["public_id", "plan_id", "step_id", "approved_by", "consents_json", "approved_at", "expires_at"] },
  [SQL.insertJob]: { op: "insert", table: "jobs", columns: ["public_id", "plan_id", "step_id", "status", "tool_id", "params_json", "inputs_json", "consent_json", "backend", "agent_id", "attempts", "timeout_s", "execution_mode", "created_at", "started_at", "finished_at"] },
  [SQL.getJob]: { op: "select", table: "jobs", where: ["public_id"] },
  [SQL.updateJobByPlanStep]: { op: "update", table: "jobs", where: ["plan_id", "step_id"], assignments: { status: 0, finished_at: 1 } },
  [SQL.listQueuedJobs]: { op: "select", table: "jobs", where: ["status"], orderBy: "created_at", limit: true },
  [SQL.claimJob]: { op: "claim", table: "jobs", where: ["public_id", "status"], assignments: { status: 0, agent_id: 1, started_at: 2 }, increment: "attempts" },
  [SQL.finishJob]: { op: "update", table: "jobs", where: ["public_id"], assignments: { status: 0, finished_at: 1 } },
  [SQL.saveJobResult]: { op: "update", table: "jobs", where: ["public_id", "status"], assignments: { status: 0, finished_at: 1, result_json: 2, validation_json: 3, explanation_json: 4, provenance_json: 5, report_json: 6, execution_mode: 7 } },
  [SQL.listJobsForPlan]: { op: "select", table: "jobs", where: ["plan_id"], orderBy: "created_at" },
  [SQL.listApprovalsForPlan]: { op: "select", table: "approvals", where: ["plan_id"] },
  [SQL.listAuditEvents]: { op: "select", table: "audit_events", where: [], orderBy: "timestamp" },
  [SQL.insertArtifact]: { op: "insert", table: "artifacts", columns: ["public_id", "run_id", "name", "kind", "storage_ref", "sha256", "bytes", "mime", "content", "created_at"] },
  [SQL.listArtifactsForRun]: { op: "select", table: "artifacts", where: ["run_id"], orderBy: "name" },
  [SQL.insertToolRun]: { op: "insert", table: "tool_runs", columns: ["public_id", "job_id", "tool_id", "tool_version", "params_json", "input_refs_json", "output_refs_json", "provenance_json", "started_at", "finished_at"] },
  [SQL.insertReference]: { op: "insert", table: "evidence_references", columns: ["public_id", "key", "title", "url", "doi", "license", "verified_by", "verified_at", "notes", "verified"] },
  [SQL.insertReportRun]: { op: "insert", table: "report_runs", columns: ["public_id", "plan_id", "job_id", "report_ref", "explanation_ref", "validation_ref", "report_html", "created_at"] },
  [SQL.getReportRun]: { op: "select", table: "report_runs", where: ["job_id"] },
  [SQL.insertAudit]: { op: "insert", table: "audit_events", columns: ["public_id", "actor", "action", "target", "detail_json", "timestamp"] },
  // M7.4 workspace metadata (additive). Where columns are always the trailing
  // bind values, matching the fake D1's update/select contract.
  [SQL.insertWorkspaceProject]: { op: "insert", table: "projects", columns: ["public_id", "name", "owner", "settings_json", "created_at", "description", "scientific_objective", "status", "updated_at"] },
  [SQL.getWorkspaceProject]: { op: "select", table: "projects", where: ["public_id", "owner"] },
  [SQL.listProjectsByOwner]: { op: "select", table: "projects", where: ["owner"] },
  [SQL.updateProjectMetadata]: { op: "update", table: "projects", where: ["public_id", "owner"], assignments: { name: 0, description: 1, scientific_objective: 2, status: 3, updated_at: 4 } },
  [SQL.setProjectStatus]: { op: "update", table: "projects", where: ["public_id", "owner"], assignments: { status: 0, updated_at: 1 } },
  [SQL.insertWorkspaceDataset]: { op: "insert", table: "datasets", columns: ["public_id", "project_id", "filename", "sha256", "size_bytes", "mime", "storage_ref", "fasta_text", "created_at", "file_format", "source", "validation_state", "provider_history_ref", "uploaded_at", "owner", "is_demo"] },
  [SQL.listDatasetsForProject]: { op: "select", table: "datasets", where: ["project_id", "owner"] },
  [SQL.listDatasetsByOwner]: { op: "select", table: "datasets", where: ["owner"] },
  [SQL.insertWorkspaceRun]: { op: "insert", table: "workspace_runs", columns: ["public_id", "project_id", "workflow_id", "workflow_version", "objective", "input_datasets_json", "params_json", "execution_provider", "execution_mode", "state", "created_at", "completed_at", "steps_json", "artifact_refs_json", "validation_json", "provenance_json", "error_json", "owner", "is_demo"] },
  [SQL.getWorkspaceRun]: { op: "select", table: "workspace_runs", where: ["public_id", "owner"] },
  [SQL.listRunsForProject]: { op: "select", table: "workspace_runs", where: ["project_id", "owner"] },
  [SQL.listRunsByOwner]: { op: "select", table: "workspace_runs", where: ["owner"] },
  [SQL.updateWorkspaceRun]: { op: "update", table: "workspace_runs", where: ["public_id", "owner"], assignments: { state: 0, completed_at: 1, steps_json: 2, artifact_refs_json: 3, validation_json: 4, provenance_json: 5, error_json: 6 } },
  [SQL.insertProvenanceRecord]: { op: "insert", table: "provenance_records", columns: ["public_id", "run_id", "record_json", "created_at", "owner"] },
  [SQL.getProvenanceRecord]: { op: "select", table: "provenance_records", where: ["run_id", "owner"] },
  [SQL.insertProteinRun]: { op: "insert", table: "protein_runs", columns: ["public_id", "md5", "route", "provider_job_id", "state", "result_json", "created_at", "completed_at"] },
  [SQL.getProteinRunByMd5]: { op: "select", table: "protein_runs", where: ["md5"], orderBy: "created_at" },
  [SQL.getProteinRunsByMd5AndRoute]: { op: "select", table: "protein_runs", where: ["md5", "route"], orderBy: "created_at" },
  [SQL.getProteinRunByPublicId]: { op: "select", table: "protein_runs", where: ["public_id"] },
  [SQL.getProteinRunByJobId]: { op: "select", table: "protein_runs", where: ["provider_job_id"] },
  [SQL.updateProteinRun]: { op: "update", table: "protein_runs", where: ["public_id"], assignments: { state: 0, provider_job_id: 1, result_json: 2, completed_at: 3 } },
  // The approval gate issues a legacy BLAST consent token on the same D1
  // binding, so the fake D1 must understand these statements too. The real SQL
  // also checks expiry/grant/used_at inside the UPDATE; the generic fake models
  // the four bound equality predicates (the last four bind values).
  [BLAST_SQL.insertConsent]: { op: "insert", table: "blast_consents", columns: ["token", "input_hash", "database", "program", "granted", "expires_at", "created_at", "used_at"] },
  [BLAST_SQL.selectConsentByToken]: { op: "select", table: "blast_consents", where: ["token"] },
  [BLAST_SQL.claimConsent]: { op: "update", table: "blast_consents", where: ["token", "input_hash", "database", "program"], assignments: { used_at: 0 } }
};

// ---------------------------------------------------------------- responses

function corsHeaders(request) {
  const headers = new Headers();
  if (!request || typeof request.headers?.get !== "function") return headers;
  const origin = request.headers.get("Origin");
  if (!origin) return headers;
  let ownOrigin = null;
  try {
    ownOrigin = new URL(request.url).origin;
  } catch {
    return headers;
  }
  if (origin === ownOrigin) {
    headers.set("Access-Control-Allow-Origin", origin);
    headers.set("Vary", "Origin");
  }
  return headers;
}

function baseHeaders(request, extra = {}) {
  const headers = new Headers({
    "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'; base-uri 'none'",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "Cache-Control": "no-store"
  });
  for (const [name, value] of corsHeaders(request)) headers.set(name, value);
  for (const [name, value] of Object.entries(extra)) headers.set(name, String(value));
  return headers;
}

export function jsonResponse(body, status = 200, request = null, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: baseHeaders(request, { "Content-Type": "application/json; charset=utf-8", ...extraHeaders })
  });
}

export function errorResponse(message, status = 400, request = null, extraHeaders = {}) {
  // JSON is a data format: escape at render time, not here (no double encoding).
  return jsonResponse({ error: String(message ?? ""), execution_mode: DEFAULT_EXECUTION_MODE }, status, request, extraHeaders);
}

export function htmlResponse(body, status = 200, request = null, extraHeaders = {}) {
  return new Response(String(body), {
    status,
    headers: baseHeaders(request, {
      "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'",
      "Content-Type": "text/html; charset=utf-8",
      ...extraHeaders
    })
  });
}

export function preflightResponse(request) {
  return new Response(null, {
    status: 204,
    headers: baseHeaders(request, {
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, X-Agent-Token",
      "Access-Control-Max-Age": "600"
    })
  });
}

export function methodError(request, allowed) {
  return errorResponse(`Method not allowed. Use ${allowed}.`, 405, request, { Allow: allowed });
}

export function requireMethod(request, method, allowed) {
  if (request.method === "OPTIONS") return preflightResponse(request);
  if (request.method !== method) return methodError(request, allowed);
  return null;
}

// ------------------------------------------------------------------- utils

export function nowIso(now = Date.now()) {
  return new Date(now).toISOString();
}

export function makeId(prefix, idFactory) {
  if (typeof idFactory === "function") return idFactory(prefix);
  const bytes = new Uint8Array(8);
  if (globalThis.crypto?.getRandomValues) {
    globalThis.crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i += 1) bytes[i] = Math.floor(Math.random() * 256);
  }
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `${prefix}_${hex}`;
}

export function isPublicId(value) {
  return typeof value === "string" && PUBLIC_ID_PATTERN.test(value);
}

export function parseJson(text) {
  if (!text) return null;
  const parsed = JSON.parse(text);
  return parsed && typeof parsed === "object" ? parsed : null;
}

export function safeString(value, maxLength = 2000) {
  if (typeof value !== "string") return "";
  return value.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, maxLength);
}

export function sanitizeFilename(value) {
  const text = safeString(value, 200).split(/[\\/]/).pop() ?? "";
  return text || "upload.fasta";
}

export async function readJsonBody(request, maxChars = MAX_REQUEST_BODY_CHARS) {
  const raw = await request.text();
  if (raw.length > maxChars) return { payload: null, error: "Request body is too large." };
  try {
    const payload = JSON.parse(raw || "{}");
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      return { payload: null, error: "Request body must be a JSON object." };
    }
    return { payload, error: null };
  } catch {
    return { payload: null, error: "Request body must be valid JSON." };
  }
}

function constantTimeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let difference = 0;
  for (let i = 0; i < a.length; i += 1) difference |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return difference === 0;
}

export function agentTokenError(request, env) {
  if (!env || !env.AI_AGENT_TOKEN) {
    return errorResponse("Agent token is not configured.", 503, request);
  }
  const provided = request.headers.get("X-Agent-Token") ?? "";
  if (!constantTimeEqual(provided, String(env.AI_AGENT_TOKEN))) {
    return errorResponse("Unauthorized agent token.", 401, request);
  }
  return null;
}

export function computeExecutionMode(result, env) {
  // Operator configuration is authoritative: an agent cannot claim "real"
  // when the deployment is in mock mode, and cannot bypass the validation
  // downgrade that mock mode triggers.
  if (env?.AI_EXECUTION_MODE === "mock") return "mock";
  const reported = result?.execution_mode;
  if (reported === "real" || reported === "mock") return reported;
  return DEFAULT_EXECUTION_MODE;
}

export function envExecutionMode(env) {
  return env?.AI_EXECUTION_MODE === "mock" ? "mock" : DEFAULT_EXECUTION_MODE;
}

export function getDb(env) {
  // 0002 is additive to the same D1 database as 0001. A dedicated AI_DB
  // binding may be configured later; otherwise reuse the existing binding.
  return env?.AI_DB ?? env?.BLAST_DB ?? null;
}

// ---------------------------------------------------------------- D1 access

export async function insertRow(db, sql, values) {
  await db.prepare(sql).bind(...values).run();
}

export async function getRow(db, sql, values) {
  const result = await db.prepare(sql).bind(...values).all();
  return result.results?.[0] ?? null;
}

export async function listRows(db, sql, values) {
  const result = await db.prepare(sql).bind(...values).all();
  return result.results ?? [];
}

export async function runStatement(db, sql, values) {
  return db.prepare(sql).bind(...values).run();
}

export async function audit(db, { actor, action, target, detail = {}, timestamp, idFactory }) {
  await insertRow(db, SQL.insertAudit, [
    makeId("aud", idFactory),
    actor,
    action,
    target,
    JSON.stringify(detail),
    timestamp
  ]);
}

// --------------------------------------------------------------- validation

const isStringArray = (value) => Array.isArray(value) && value.every((item) => typeof item === "string");

export function validatePlan(plan) {
  if (!plan || typeof plan !== "object" || Array.isArray(plan)) return { valid: false, error: "Plan must be an object." };
  if (!PUBLIC_ID_PATTERN.test(String(plan.plan_id ?? "")) || !String(plan.plan_id).startsWith("plan_")) {
    return { valid: false, error: "Invalid plan_id." };
  }
  if (!String(plan.request_id ?? "").startsWith("req_")) return { valid: false, error: "Invalid request_id." };
  if (!["sequence-analysis", "microbiome-16s", "phylogenetics"].includes(plan.domain)) return { valid: false, error: "Invalid domain." };
  if (!["validate_and_profile", "identify_taxa", "phylogenetics"].includes(plan.intent)) return { valid: false, error: "Invalid intent." };
  if (typeof plan.confidence !== "number" || plan.confidence < 0 || plan.confidence > 1) {
    return { valid: false, error: "confidence must be between 0 and 1." };
  }
  if (typeof plan.created_at !== "string") return { valid: false, error: "created_at must be a timestamp." };
  if (!Array.isArray(plan.steps) || plan.steps.length === 0) return { valid: false, error: "Plan must have at least one step." };
  for (const step of plan.steps) {
    if (!step || typeof step !== "object" || Array.isArray(step)) return { valid: false, error: "Each step must be an object." };
    if (typeof step.id !== "string" || !/^step_[0-9]+$/.test(step.id)) return { valid: false, error: "Invalid step id." };
    if (!isKnownTool(step.tool_id)) return { valid: false, error: `Unknown tool in plan: ${step.tool_id}` };
    if (step.backend !== "local-python") return { valid: false, error: "Unsupported backend." };
    if (!step.params || typeof step.params !== "object" || Array.isArray(step.params)) return { valid: false, error: "Step params must be an object." };
    if (!isStringArray(step.inputs)) return { valid: false, error: "Step inputs must be strings." };
    if (typeof step.external_egress !== "boolean" || typeof step.consent_required !== "boolean") {
      return { valid: false, error: "Egress and consent flags must be booleans." };
    }
    if (step.external_egress === true && step.consent_required !== true) {
      return { valid: false, error: "external_egress requires consent_required." };
    }
    if (typeof step.estimated_seconds !== "number") return { valid: false, error: "estimated_seconds must be a number." };
  }
  if (!isStringArray(plan.external_services) || !isStringArray(plan.consents_required) || !isStringArray(plan.limitations)) {
    return { valid: false, error: "Plan lists must be arrays of strings." };
  }
  return { valid: true, error: null };
}

export function validateRequestPayload(payload) {
  if (typeof payload.text !== "string" || !payload.text.trim()) {
    return { valid: false, error: "text must be a non-empty question." };
  }
  if (payload.text.length > 4000) return { valid: false, error: "text is too long (4000 character limit)." };
  if (typeof payload.fasta !== "string" || !payload.fasta.trim()) {
    return { valid: false, error: "fasta must be provided as text." };
  }
  const bytes = new TextEncoder().encode(payload.fasta).length;
  if (bytes > MAX_FASTA_BYTES) return { valid: false, error: `FASTA input exceeds the ${MAX_FASTA_BYTES} byte limit.` };
  const fastaCheck = validateFasta(payload.fasta);
  if (!fastaCheck.valid) return { valid: false, error: fastaCheck.error };
  if (payload.project_id !== undefined && typeof payload.project_id !== "string") {
    return { valid: false, error: "project_id must be a string." };
  }
  return { valid: true, error: null, preflight: fastaCheck };
}

export function validateApprovalsPayload(payload) {
  if (!Array.isArray(payload.approvals)) return { valid: false, error: "approvals must be an array." };
  for (const item of payload.approvals) {
    if (!item || typeof item !== "object" || Array.isArray(item)) return { valid: false, error: "Each approval must be an object." };
    if (typeof item.step_id !== "string" || !/^step_[0-9]+$/.test(item.step_id)) {
      return { valid: false, error: "Invalid approval step_id." };
    }
    if (item.approved !== undefined && typeof item.approved !== "boolean") {
      return { valid: false, error: "approved must be a boolean." };
    }
    if (item.consent_granted !== undefined && typeof item.consent_granted !== "boolean") {
      return { valid: false, error: "consent_granted must be a boolean." };
    }
  }
  if (payload.consents !== undefined && !isStringArray(payload.consents)) {
    return { valid: false, error: "consents must be an array of strings." };
  }
  return { valid: true, error: null };
}

// Artifacts the local agent adds for every job, or that the shared wire
// contract names explicitly (shared/AI_PLATFORM_CONTRACT.md §3), rather than
// through a tool's output_schema. These are generic: no tool id is involved.
const AGENT_GENERATED_ARTIFACTS = new Set(["report.html", "analysis.json"]);
const EXECUTION_MODES = new Set(["real", "mock"]);

// A declared output (e.g. "validation") may be delivered as the logical key
// itself or serialized to a file (e.g. "validation.json"). Both forms satisfy
// the same declaration; no tool-specific name list is needed.
function matchesDeclaredName(artifactName, declaredName) {
  if (artifactName === declaredName) return true;
  const dot = artifactName.lastIndexOf(".");
  return dot > 0 && artifactName.slice(0, dot) === declaredName;
}

function matchesJsonType(value, type) {
  switch (type) {
    case "object": return value !== null && typeof value === "object" && !Array.isArray(value);
    case "array": return Array.isArray(value);
    case "number": return typeof value === "number" && Number.isFinite(value);
    case "integer": return Number.isInteger(value);
    case "boolean": return typeof value === "boolean";
    case "string": return typeof value === "string";
    default: return true; // unconstrained when the schema has no known type
  }
}

export function validateResultShape(payload, expectedJobId) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return { valid: false, error: "Result must be an object." };
  if (typeof payload.job_id !== "string") return { valid: false, error: "job_id is required." };
  if (payload.job_id !== expectedJobId) return { valid: false, error: "job_id does not match the URL." };
  if (!["succeeded", "failed"].includes(payload.status)) return { valid: false, error: "status must be succeeded or failed." };
  if (!EXECUTION_MODES.has(payload.execution_mode)) return { valid: false, error: "execution_mode must be real or mock." };
  if (!Array.isArray(payload.artifacts) || payload.artifacts.length > 20) {
    return { valid: false, error: "artifacts must be an array with at most 20 entries." };
  }
  let artifactBytes = 0;
  for (const artifact of payload.artifacts) {
    if (!artifact || typeof artifact !== "object" || Array.isArray(artifact)) return { valid: false, error: "Each artifact must be an object." };
    if (typeof artifact.name !== "string" || !artifact.name || artifact.name.includes("/") || artifact.name.includes("\\")) {
      return { valid: false, error: "Artifact name is invalid." };
    }
    if (typeof artifact.kind !== "string" || !artifact.kind) return { valid: false, error: "Artifact kind is required." };
    if (!SHA256_PATTERN.test(String(artifact.sha256 ?? ""))) return { valid: false, error: "Artifact sha256 must be 64 lowercase hex characters." };
    if (typeof artifact.content !== "string") return { valid: false, error: "Artifact content must be text." };
    artifactBytes += new TextEncoder().encode(artifact.content).length;
  }
  if (artifactBytes > MAX_RESULT_BODY_CHARS) return { valid: false, error: "Artifact content is too large." };

  const provenance = payload.provenance;
  if (!provenance || typeof provenance !== "object" || Array.isArray(provenance)) return { valid: false, error: "provenance must be an object." };
  if (typeof provenance.run_id !== "string" || !provenance.run_id) return { valid: false, error: "provenance.run_id is required." };
  if (typeof provenance.step_id !== "string" || !provenance.step_id) return { valid: false, error: "provenance.step_id is required." };
  if (!provenance.tool || typeof provenance.tool.id !== "string" || !provenance.tool.id) {
    return { valid: false, error: "provenance.tool.id is required." };
  }
  if (typeof provenance.tool.version !== "string" || !provenance.tool.version) {
    return { valid: false, error: "provenance.tool.version is required." };
  }
  if (typeof provenance.tool.backend !== "string" || !provenance.tool.backend) {
    return { valid: false, error: "provenance.tool.backend is required." };
  }
  if (!provenance.input || typeof provenance.input.dataset_id !== "string") return { valid: false, error: "provenance.input.dataset_id is required." };
  // A missing hash means "not computed"; the key itself is always required.
  if (!Object.hasOwn(provenance.input, "sha256")) return { valid: false, error: "provenance.input.sha256 must be present (may be null)." };
  if (!provenance.parameters || typeof provenance.parameters !== "object" || Array.isArray(provenance.parameters)) {
    return { valid: false, error: "provenance.parameters must be an object." };
  }
  if (!provenance.database || typeof provenance.database !== "object") return { valid: false, error: "provenance.database is required." };
  if (!provenance.output || !isStringArray(provenance.output.artifact_names)) return { valid: false, error: "provenance.output.artifact_names must be strings." };
  if (typeof provenance.output.sha256 !== "string" || !provenance.output.sha256) {
    return { valid: false, error: "provenance.output.sha256 is required." };
  }
  if (!provenance.timing || typeof provenance.timing !== "object") return { valid: false, error: "provenance.timing is required." };
  if (typeof provenance.timing.started_at !== "string" || !provenance.timing.started_at) {
    return { valid: false, error: "provenance.timing.started_at is required." };
  }
  if (typeof provenance.timing.finished_at !== "string" || !provenance.timing.finished_at) {
    return { valid: false, error: "provenance.timing.finished_at is required." };
  }
  if (!EXECUTION_MODES.has(provenance.execution_mode)) {
    return { valid: false, error: "provenance.execution_mode must be real or mock." };
  }

  // Output contracts are read from the registry, never hardcoded per tool.
  const tool = getTool(provenance.tool.id);
  if (!tool) return { valid: false, error: `Unknown provenance.tool.id: ${provenance.tool.id}` };
  const outputSchema = tool.output_schema ?? {};
  const properties = outputSchema.properties ?? {};
  const declaredNames = [...new Set([...Object.keys(properties), ...(isStringArray(outputSchema.required) ? outputSchema.required : [])])];
  for (const artifact of payload.artifacts) {
    const allowed = declaredNames.some((name) => matchesDeclaredName(artifact.name, name)) || AGENT_GENERATED_ARTIFACTS.has(artifact.name);
    if (!allowed) {
      return { valid: false, error: `Unexpected artifact name: ${artifact.name} (not declared in output_schema.properties).` };
    }
  }
  // Failed steps legitimately emit only the generic report; declarations
  // describe successful outputs.
  if (payload.status === "succeeded") {
    for (const name of outputSchema.required ?? []) {
      if (typeof name !== "string" || !name) return { valid: false, error: "output_schema.required must contain names." };
      const inArtifacts = payload.artifacts.some((artifact) => matchesDeclaredName(artifact.name, name));
      const inProvenance = provenance.output.artifact_names.some((submitted) => matchesDeclaredName(submitted, name));
      if (!inArtifacts || !inProvenance) {
        return { valid: false, error: `Missing declared output: ${name} (artifacts and provenance.output.artifact_names must both contain it).` };
      }
      const type = properties[name]?.type;
      if (["object", "array", "number", "integer", "boolean"].includes(type)) {
        const jsonArtifact = payload.artifacts.some((artifact) => (
          matchesDeclaredName(artifact.name, name) && (artifact.kind === "json" || artifact.name.endsWith(".json"))
        ));
        if (!jsonArtifact) {
          return { valid: false, error: `Declared output ${name} must be delivered as a JSON artifact.` };
        }
      }
    }
  }
  for (const [name, rule] of Object.entries(properties)) {
    const type = rule?.type;
    if (!["object", "array", "number", "integer", "boolean", "string"].includes(type)) continue;
    for (const artifact of payload.artifacts) {
      if (!matchesDeclaredName(artifact.name, name)) continue;
      if (artifact.kind !== "json" && !artifact.name.endsWith(".json")) continue;
      let value;
      try {
        value = JSON.parse(artifact.content);
      } catch {
        return { valid: false, error: `Declared output ${name} in artifact ${artifact.name} is not valid JSON.` };
      }
      if (type === "string") continue; // serialized text documents are strings on the wire
      if (!matchesJsonType(value, type)) {
        return { valid: false, error: `Declared output ${name} in artifact ${artifact.name} must be a JSON ${type}.` };
      }
    }
  }

  const validation = payload.validation;
  if (!validation || !["pass", "warn", "fail"].includes(validation.status)) {
    return { valid: false, error: "validation.status must be pass, warn or fail." };
  }
  if (!isStringArray(validation.flags) || !isStringArray(validation.checked_rules)) {
    return { valid: false, error: "validation.flags and checked_rules must be strings." };
  }

  const explanation = payload.explanation;
  if (!explanation || typeof explanation !== "object" || Array.isArray(explanation)) {
    return { valid: false, error: "explanation must be an object." };
  }
  if (typeof explanation.summary !== "string") return { valid: false, error: "explanation.summary must be text." };
  if (!Array.isArray(explanation.findings) || !isStringArray(explanation.limitations) || !Array.isArray(explanation.references)) {
    return { valid: false, error: "explanation findings/limitations/references are required." };
  }
  // Citations are a trust boundary: exact ledger projection or reject.
  const referencesCheck = validateExplanationReferences(explanation.references);
  if (!referencesCheck.valid) return referencesCheck;
  if (!["none", "low", "moderate", "high"].includes(explanation.uncertainty)) {
    return { valid: false, error: "explanation.uncertainty is invalid." };
  }
  if (payload.logs !== undefined && !isStringArray(payload.logs)) return { valid: false, error: "logs must be an array of strings." };
  return { valid: true, error: null };
}

// ------------------------------------------------------------------- DTOs

export function toJobDto(row) {
  if (!row) return null;
  const inputs = parseJson(row.inputs_json) ?? {};
  const consent = parseJson(row.consent_json) ?? { granted: false, scope: null };
  return {
    id: row.public_id,
    plan_id: row.plan_id,
    step_id: row.step_id,
    status: row.status,
    tool_id: row.tool_id,
    params: parseJson(row.params_json) ?? {},
    inputs,
    // Persisted from the approved step at approval time so the polling agent
    // can enforce the data-flow gate without re-reading the plan.
    external_egress: inputs.external_egress === true,
    consent_required: inputs.consent_required === true,
    consent,
    backend: row.backend,
    execution_mode: row.execution_mode ?? DEFAULT_EXECUTION_MODE,
    agent_id: row.agent_id ?? null,
    created_at: row.created_at,
    started_at: row.started_at ?? null,
    finished_at: row.finished_at ?? null
  };
}

export function toArtifactDto(row) {
  return {
    name: row.name,
    kind: row.kind,
    sha256: row.sha256,
    bytes: row.bytes,
    mime: row.mime ?? null,
    content: row.content ?? "",
    storage_ref: row.storage_ref ?? null
  };
}
