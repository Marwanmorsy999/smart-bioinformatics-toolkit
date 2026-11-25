// M7.4 unified workspace API. One Worker route dispatches here.
// Identity: the platform's existing X-Agent-Token model; owner_id is a hash of
// the token, never the token itself. No visitor login is invented.
import {
  SQL as AI_SQL,
  agentTokenError, errorResponse, getDb, hashInput, jsonResponse,
  makeId, nowIso, readJsonBody, requireMethod, safeString
} from "../ai/_lib.js";
import { publicCatalog, getWorkflow } from "../../../providers/workspace/catalog.js";
import { runSummary, canTransition } from "../../../providers/workspace/states.js";

const WS_SQL = {
  insertProject: "INSERT INTO workspace_projects (public_id, owner_id, name, description, objective, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
  getProject: "SELECT * FROM workspace_projects WHERE public_id = ?",
  listProjects: "SELECT * FROM workspace_projects WHERE owner_id = ? ORDER BY created_at DESC",
  updateProject: "UPDATE workspace_projects SET name = ?, description = ?, objective = ?, status = ?, updated_at = ? WHERE public_id = ? AND owner_id = ?",
  insertDataset: "INSERT INTO workspace_datasets (public_id, project_id, filename, format, size_bytes, sha256, source, validation_state, provider_ref, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
  listDatasets: "SELECT * FROM workspace_datasets WHERE project_id = ? ORDER BY created_at DESC",
  insertRun: "INSERT INTO workspace_runs (public_id, project_id, workflow_id, workflow_version, objective, input_refs_json, params_json, provider, execution_mode, state, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
  listRuns: "SELECT * FROM workspace_runs WHERE project_id = ? ORDER BY created_at DESC",
  getRun: "SELECT * FROM workspace_runs WHERE public_id = ?"
};

async function owner(request, env) {
  const denied = agentTokenError(request, env);
  if (denied) return null;
  const token = String(request.headers.get("X-Agent-Token") ?? "");
  return hashInput(token);
}
function parseJson(value, fallback) {
  try { return JSON.parse(value ?? fallback); } catch { return fallback; }
}
async function ownedProject(db, id, ownerId) {
  const row = (await db.prepare(WS_SQL.getProject).bind(id).all()).results?.[0] ?? null;
  return row && row.owner_id === ownerId ? row : null;
}
function projectDto(row) {
  return { public_id: row.public_id, name: row.name, description: row.description,
    objective: row.objective, status: row.status, created_at: row.created_at, updated_at: row.updated_at };
}
function runDto(row) {
  return { public_id: row.public_id, project_id: row.project_id, workflow_id: row.workflow_id,
    workflow_version: row.workflow_version, objective: row.objective,
    input_refs: parseJson(row.input_refs_json, []), params: parseJson(row.params_json, {}),
    provider: row.provider, execution_mode: row.execution_mode, state: row.state,
    stages: runSummary(row), created_at: row.created_at, updated_at: row.updated_at,
    completed_at: row.completed_at, steps: parseJson(row.steps_json, []),
    artifacts: parseJson(row.artifacts_json, []), validation: parseJson(row.validation_json, null),
    provenance: parseJson(row.provenance_json, null), error: parseJson(row.error_json, null) };
}

const DEMO = {
  sample: true,
  label: "SAMPLE / PRECOMPUTED â€” not a newly executed analysis",
  project: { public_id: "proj_demo00000000000", name: "Demo: bacterial marker study",
    description: "Fixed example dataset used to explore the workspace UI.",
    objective: "Compare a 16S identification with a phylogenetic tree.", status: "active" },
  workflows: publicCatalog(),
  runs: [
    { public_id: "run_demo16s00000000", workflow_id: "16s-identification", state: "succeeded",
      execution_mode: "sample", provider: "local", created_at: "2026-01-01T00:00:00.000Z",
      stages: runSummary({ state: "succeeded" }), validation: { status: "pass", sample: true },
      artifacts: [{ name: "taxonomy.json", sample: true }, { name: "report.html", sample: true }] },
    { public_id: "run_demophylo000000", workflow_id: "phylogenetics-msa-tree", state: "execution_completed",
      execution_mode: "sample", provider: "galaxy", created_at: "2026-01-01T01:00:00.000Z",
      stages: runSummary({ state: "execution_completed" }),
      validation: { status: "not_run", reason: "Remote execution blocked; sample shows stage separation only" },
      artifacts: [] }
  ]
};

export async function onRequest(context) {
  const { request, env } = context;
  const path = new URL(request.url).pathname.replace(/\/+$/, "");
  const db = getDb(env);
  if (!db) return errorResponse("D1 binding unavailable.", 503, request);
  const method = request.method === "OPTIONS" ? "OPTIONS" : request.method;

  if (path === "/api/workspace/catalog") {
    const denied = requireMethod(request, "GET", "GET, OPTIONS");
    if (denied) return denied;
    return jsonResponse({ workflows: publicCatalog() }, 200, request);
  }
  if (path === "/api/workspace/demo") {
    const denied = requireMethod(request, "GET", "GET, OPTIONS");
    if (denied) return denied;
    return jsonResponse(DEMO, 200, request);
  }

  const ownerId = await owner(request, env);
  if (!ownerId) return errorResponse("Agent authentication required.", 401, request);
  const now = nowIso();

  if (path === "/api/workspace/projects") {
    if (method === "GET") {
      const rows = (await db.prepare(WS_SQL.listProjects).bind(ownerId).all()).results ?? [];
      return jsonResponse({ projects: rows.map(projectDto) }, 200, request);
    }
    const denied = requireMethod(request, "POST", "POST, OPTIONS");
    if (denied) return denied;
    const { payload, error } = await readJsonBody(request);
    if (error) return errorResponse(error, 400, request);
    const name = safeString(payload?.name, 200);
    if (!name) return errorResponse("Project name is required.", 400, request);
    const publicId = makeId("proj");
    await db.prepare(WS_SQL.insertProject).bind(publicId, ownerId, name,
      safeString(payload?.description, 4000), safeString(payload?.objective, 4000), "active", now, now).run();
    return jsonResponse({ project: { public_id: publicId, name, status: "active", created_at: now } }, 201, request);
  }

  const projectMatch = path.match(/^\/api\/workspace\/projects\/([^/]+)$/);
  if (projectMatch) {
    const project = await ownedProject(db, projectMatch[1], ownerId);
    if (!project) return errorResponse("Project not found.", 404, request);
    if (method === "GET") return jsonResponse({ project: projectDto(project) }, 200, request);
    const denied = requireMethod(request, "PATCH", "PATCH, OPTIONS");
    if (denied && request.method !== "POST") return denied;
    const { payload, error } = await readJsonBody(request);
    if (error) return errorResponse(error, 400, request);
    const archive = request.method === "POST" && payload?.action === "archive";
    const status = archive ? "archived" : safeString(payload?.status, 40) || project.status;
    await db.prepare(WS_SQL.updateProject).bind(
      safeString(payload?.name, 200) || project.name,
      payload?.description !== undefined ? safeString(payload.description, 4000) : project.description,
      payload?.objective !== undefined ? safeString(payload.objective, 4000) : project.objective,
      status, now, project.public_id, ownerId).run();
    return jsonResponse({ project: { ...projectDto(project), status, updated_at: now } }, 200, request);
  }

  const datasetMatch = path.match(/^\/api\/workspace\/projects\/([^/]+)\/datasets$/);
  if (datasetMatch) {
    const project = await ownedProject(db, datasetMatch[1], ownerId);
    if (!project) return errorResponse("Project not found.", 404, request);
    if (method === "GET") {
      const rows = (await db.prepare(WS_SQL.listDatasets).bind(project.public_id).all()).results ?? [];
      return jsonResponse({ datasets: rows }, 200, request);
    }
    const denied = requireMethod(request, "POST", "POST, OPTIONS");
    if (denied) return denied;
    const { payload, error } = await readJsonBody(request);
    if (error) return errorResponse(error, 400, request);
    const filename = safeString(payload?.filename, 200);
    const sha256 = safeString(payload?.sha256, 64).toLowerCase();
    if (!filename || !/^[0-9a-f]{64}$/.test(sha256)) return errorResponse("filename and 64-hex sha256 are required.", 400, request);
    const publicId = makeId("ds");
    await db.prepare(WS_SQL.insertDataset).bind(publicId, project.public_id, filename,
      safeString(payload?.format, 40) || "fasta", Number(payload?.size_bytes) || 0, sha256,
      safeString(payload?.source, 100) || "metadata-only", "metadata_only",
      safeString(payload?.provider_ref, 200) || null, now).run();
    return jsonResponse({ dataset: { public_id: publicId, project_id: project.public_id, filename, sha256,
      validation_state: "metadata_only", note: "Metadata only; no file bytes stored in D1." } }, 201, request);
  }

  const runsMatch = path.match(/^\/api\/workspace\/projects\/([^/]+)\/runs$/);
  if (runsMatch) {
    const project = await ownedProject(db, runsMatch[1], ownerId);
    if (!project) return errorResponse("Project not found.", 404, request);
    if (method !== "GET") return errorResponse("Method not allowed. Use GET.", 405, request);
    const rows = (await db.prepare(WS_SQL.listRuns).bind(project.public_id).all()).results ?? [];
    return jsonResponse({ runs: rows.map(runDto) }, 200, request);
  }

  const runMatch = path.match(/^\/api\/workspace\/runs\/([^/]+)$/);
  if (runMatch) {
    const denied = requireMethod(request, "GET", "GET, OPTIONS");
    if (denied) return denied;
    const row = (await db.prepare(WS_SQL.getRun).bind(runMatch[1]).all()).results?.[0] ?? null;
    if (!row) return errorResponse("Run not found.", 404, request);
    const project = await ownedProject(db, row.project_id, ownerId);
    if (!project) return errorResponse("Run not found.", 404, request);
    return jsonResponse({ run: runDto(row) }, 200, request);
  }

  // Dedicated run-creation endpoint: associates a new run with an owned project.
  if (path === "/api/workspace/runs" && method === "POST") {
    const { payload, error } = await readJsonBody(request);
    if (error) return errorResponse(error, 400, request);
    const project = await ownedProject(db, safeString(payload?.project_id, 100), ownerId);
    if (!project) return errorResponse("Project not found.", 404, request);
    const workflow = getWorkflow(payload?.workflow_id);
    if (!workflow) return errorResponse("Unknown workflow.", 400, request);
    if (!canTransition("draft", "planned")) return errorResponse("Invalid state machine.", 500, request);
    const publicId = makeId("run");
    await db.prepare(WS_SQL.insertRun).bind(publicId, project.public_id, workflow.id, workflow.version,
      safeString(payload?.objective, 2000), JSON.stringify(payload?.input_refs ?? []),
      JSON.stringify(payload?.params ?? {}), workflow.provider, "real", "planned", now, now).run();
    return jsonResponse({ run: { public_id: publicId, project_id: project.public_id, workflow_id: workflow.id,
      workflow_version: workflow.version, state: "planned", stages: runSummary({ state: "planned" }) } }, 201, request);
  }

  if (path.startsWith("/api/workspace/")) return errorResponse("Workspace route not found.", 404, request);
  return errorResponse("Not found.", 404, request);
}

