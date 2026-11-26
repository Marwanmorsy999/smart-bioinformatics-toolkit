// M7.4 unified research workspace UI controller.
//
// DEFAULT = local browser session. Only metadata JSON is kept in localStorage
// under an explicitly labelled key; no file bytes, no tokens, no URLs. The
// optional operator mode keeps the existing X-Agent-Token only in this module's
// memory and calls the real /api/workspace/** APIs. There is no visitor login.
//
// All dynamic text is inserted with textContent (never parsed as HTML). Launching a
// workflow records a planned/draft run only — this UI never executes a tool.

const $ = (id) => document.getElementById(id);
const LOCAL_KEY = "m74_workspace_local_v1";
const SAMPLE_LABEL = "SAMPLE / PRECOMPUTED";
const DISCLAIMER = "Fixed sample data for interface development only. This is NOT a newly executed analysis, NOT a scientific result, and no bytes, jobs or provider references were created.";

// Offline display mirror of the AUTHORITATIVE catalog in
// functions/api/workspace/catalog.js. tests/workspace.test.mjs asserts these
// ids and availability states match the authoritative module, so they cannot
// silently drift. Operator mode always prefers /api/workspace/workflows.
const LOCAL_CATALOG = Object.freeze([
  Object.freeze({
    id: "16s-rrna-identification",
    name: "16S rRNA identification",
    version: "1.0.0",
    scientific_purpose: "Profile and identify 16S rRNA sequences using the existing local BLAST + consensus/verdict pipeline.",
    expected_input: "One or more 16S rRNA sequences as FASTA text (legacy inline path capped at 64 KiB).",
    supported_formats: Object.freeze(["fasta"]),
    required_parameters: Object.freeze([]),
    expected_outputs: Object.freeze(["taxonomy assignments", "consensus verdict", "explanation", "report"]),
    validation_capabilities: Object.freeze([
      "FASTA syntax and sequence metrics", "taxonomy consensus with explicit ties/abstention",
      "evidence-ledger reference checking", "report generated from persisted run records"
    ]),
    execution_availability: Object.freeze({
      state: "available-browser-and-local-agent", production_ready: true,
      note: "Uses the existing public /api/ai/requests -> approve -> BLAST path with a single-use consent token for external egress. No new execution was added in M7.4."
    }),
    entry_point: "ai.html"
  }),
  Object.freeze({
    id: "msa-phylogenetics",
    name: "MSA phylogenetics (partial)",
    version: "1.0.0",
    scientific_purpose: "Multiple-sequence alignment followed by phylogenetic tree inference and independent topology validation.",
    expected_input: "A set of homologous nucleotide sequences as FASTA text (aligned or unaligned).",
    supported_formats: Object.freeze(["fasta"]),
    required_parameters: Object.freeze(["sequences"]),
    expected_outputs: Object.freeze(["multiple-sequence alignment", "Newick tree", "validation results"]),
    validation_capabilities: Object.freeze([
      "record count and no silently dropped taxa", "equal alignment lengths and DNA alphabet",
      "parseable Newick and taxa-set equality", "expected clades on the synthetic reference (known by construction, not a publication-grade benchmark)"
    ]),
    execution_availability: Object.freeze({
      state: "partial-not-production-ready", production_ready: false,
      note: "Evidence: docs/M7_3_PHYLOGENETICS_WORKFLOW_REPORT.md. A real MAFFT job executed once historically; an existing succeeded Galaxy MAFFT job can now be resumed by provider job id without a second submission. The full multi-step remote tree/retrieval/validation path is NOT verified. No live Galaxy call is made by this workspace API and no provider is newly activated in this milestone."
    }),
    entry_point: "phylo.html"
  })
]);

// Display legend of the 11 authoritative RUN_STATES. This is NOT a second
// transition map — the one map lives in functions/api/workspace/_lib.js.
const RUN_STATES = Object.freeze([
  "draft", "planned", "awaiting_approval", "queued", "running",
  "execution_completed", "artifact_retrieval", "validation", "succeeded", "failed", "cancelled"
]);

// Derived stage flags mirror runSummary() in functions/api/workspace/_lib.js.
function stagesFor(state) {
  const value = String(state ?? "");
  return {
    state: value,
    submitted: !["draft", "planned"].includes(value),
    running: ["running", "execution_completed", "artifact_retrieval", "validation", "succeeded"].includes(value),
    execution_completed: ["execution_completed", "artifact_retrieval", "validation", "succeeded"].includes(value),
    artifact_retrieved: ["artifact_retrieval", "validation", "succeeded"].includes(value),
    validated: ["validation", "succeeded"].includes(value),
    full_workflow_completed: value === "succeeded"
  };
}

// Static, clearly labelled local sample with the same DTO field names as
// /api/workspace/demo. It is never presented as a new analysis.
const LOCAL_DEMO = Object.freeze({
  is_demo: true, sample: true, execution_mode: "precomputed", disclaimer: DISCLAIMER,
  project: Object.freeze({
    is_demo: true, sample: true, execution_mode: "precomputed", disclaimer: DISCLAIMER,
    id: "proj_0000000000000000", name: "Sample: 16S isolate panel",
    description: "Illustrative project used only to demonstrate workspace layout.",
    scientific_objective: "Demonstrate how a 16S objective is displayed beside its runs.",
    status: "active"
  }),
  datasets: Object.freeze([
    Object.freeze({ is_demo: true, sample: true, execution_mode: "precomputed", disclaimer: DISCLAIMER,
      id: "ds_0000000000000001", filename: "sample_panel.fasta", file_format: "fasta",
      size_bytes: 1234, validation_state: "passed", provider_history_ref: null }),
    Object.freeze({ is_demo: true, sample: true, execution_mode: "precomputed", disclaimer: DISCLAIMER,
      id: "ds_0000000000000002", filename: "sample_tree_reference.fasta", file_format: "fasta",
      size_bytes: 512, validation_state: "passed", provider_history_ref: "sample-history-ref-only" })
  ]),
  runs: Object.freeze([
    Object.freeze({ is_demo: true, sample: true, execution_mode: "precomputed", disclaimer: DISCLAIMER,
      id: "run_0000000000000001", workflow_id: "16s-rrna-identification", state: "succeeded",
      input_datasets: ["ds_0000000000000001"], validation_status: "passed" }),
    Object.freeze({ is_demo: true, sample: true, execution_mode: "precomputed", disclaimer: DISCLAIMER,
      id: "run_0000000000000002", workflow_id: "msa-phylogenetics", state: "planned",
      input_datasets: ["ds_0000000000000002"], validation_status: "pending" })
  ])
});

// --------------------------------------------------------------- state / DOM

let token = ""; // operator token: memory only, never persisted or put in a URL
let local = emptyLocalState();
let projects = [];
let datasets = [];
let runs = [];
let catalog = LOCAL_CATALOG;
let currentProject = null;

function emptyLocalState() {
  return { projects: [], datasets: [], runs: [] };
}
function nowIso() {
  return new Date().toISOString();
}
function localId(prefix) {
  return `${prefix}_local_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}
function loadLocalState() {
  try {
    const raw = localStorage.getItem(LOCAL_KEY);
    if (!raw) return emptyLocalState();
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.projects) || !Array.isArray(parsed.datasets) || !Array.isArray(parsed.runs)) {
      return emptyLocalState();
    }
    // Only metadata is ever read back; unexpected fields are ignored by renderers.
    return { projects: parsed.projects, datasets: parsed.datasets, runs: parsed.runs };
  } catch {
    return emptyLocalState(); // file:// storage may be restricted in some browsers
  }
}
function saveLocalState() {
  try {
    localStorage.setItem(LOCAL_KEY, JSON.stringify({
      projects: local.projects, datasets: local.datasets, runs: local.runs
    }));
  } catch {
    // Keep working from the in-memory copy; never store a token as a fallback.
  }
}
function setStatus(message) {
  $("ws-status").textContent = message;
}
function updateModeLabel() {
  $("ws-mode-label").textContent = token
    ? "Current mode: operator API (token held in memory only; not stored in this browser)."
    : "Current mode: local browser session (no token in use).";
}
function node(tag, text, className) {
  const created = document.createElement(tag);
  if (text !== undefined && text !== null) created.textContent = String(text);
  if (className) created.className = className;
  return created;
}
function fillList(target, entries, emptyText) {
  target.replaceChildren();
  if (entries.length === 0) {
    target.append(node("li", emptyText));
    return;
  }
  for (const entry of entries) target.append(node("li", entry));
}
function workflowName(id) {
  const fromCatalog = catalog.find((workflow) => workflow.id === id);
  if (fromCatalog?.name) return fromCatalog.name;
  if (id === "16s-rrna-identification") return "16S rRNA identification";
  if (id === "msa-phylogenetics") return "MSA phylogenetics";
  return String(id ?? "unknown workflow");
}
function runId(run) {
  return run.id ?? run.public_id ?? "unknown-run";
}
function workflowAvailability(workflow) {
  const availability = workflow.execution_availability ?? {};
  return `${availability.state ?? "unspecified"} (production_ready: ${availability.production_ready ?? "unspecified"}) — ${availability.note ?? "no note"}`;
}

async function api(path, options = {}) {
  const headers = { ...(options.headers ?? {}) };
  if (token) headers["X-Agent-Token"] = token;
  if (options.body) headers["Content-Type"] = "application/json";
  const response = await fetch(path, { ...options, headers });
  let body = {};
  try { body = await response.json(); } catch { body = {}; }
  if (!response.ok) throw new Error(body?.error ?? `HTTP ${response.status}`);
  return body;
}

// -------------------------------------------------------------- access modes

$("ws-operator-enable").addEventListener("click", async () => {
  const candidate = $("ws-agent-token").value.trim();
  if (!candidate) {
    setStatus("Enter the existing operator token before enabling operator mode.");
    return;
  }
  token = candidate;
  updateModeLabel();
  try {
    await loadProjects();
    setStatus("Operator mode enabled. The token is in memory only; no visitor login exists.");
  } catch (error) {
    token = "";
    $("ws-agent-token").value = "";
    updateModeLabel();
    setStatus(`Operator mode failed: ${error.message}`);
  }
});

$("ws-operator-disable").addEventListener("click", () => {
  token = "";
  $("ws-agent-token").value = "";
  updateModeLabel();
  currentProject = null;
  $("ws-detail").hidden = true;
  loadProjects().catch((error) => setStatus(`Local load failed: ${error.message}`));
  setStatus("Returned to local browser session; the operator token was cleared from memory.");
});

$("ws-local-clear").addEventListener("click", () => {
  try { localStorage.removeItem(LOCAL_KEY); } catch { /* nothing persisted */ }
  local = emptyLocalState();
  currentProject = null;
  $("ws-detail").hidden = true;
  loadProjects().catch((error) => setStatus(`Local load failed: ${error.message}`));
  setStatus("Cleared the local sample/session metadata. No server data was touched.");
});

// --------------------------------------------------------------- projects

async function loadProjects() {
  if (token) {
    const body = await api("/api/workspace/projects");
    projects = body.projects ?? [];
  } else {
    projects = [...local.projects].sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
  }
  renderProjects();
  if (currentProject && projects.some((project) => (project.id ?? project.public_id) === currentProject)) {
    await openProject(currentProject);
  }
  setStatus(`${projects.length} project(s) available in ${token ? "operator" : "local"} mode.`);
}

function projectId(project) {
  return project.id ?? project.public_id;
}

function renderProjects() {
  const list = $("ws-project-list");
  list.replaceChildren();
  if (projects.length === 0) {
    list.append(node("li", "No projects yet. Create one above or open the labelled sample below."));
    return;
  }
  for (const project of projects) {
    const item = node("li");
    const button = node("button", project.name);
    button.type = "button";
    button.dataset.project = projectId(project);
    button.addEventListener("click", () => {
      openProject(projectId(project)).catch((error) => setStatus(`Open failed: ${error.message}`));
    });
    item.append(button, node("span", ` — ${project.status ?? "active"}`));
    list.append(item);
  }
}

$("ws-project-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const payload = {
    name: $("ws-project-name").value.trim(),
    description: $("ws-project-description").value,
    scientific_objective: $("ws-project-objective").value,
    status: $("ws-project-status").value
  };
  if (!payload.name) {
    setStatus("Project name is required.");
    return;
  }
  try {
    if (token) {
      const body = await api("/api/workspace/projects", { method: "POST", body: JSON.stringify(payload) });
      currentProject = projectId(body.project);
    } else {
      const createdAt = nowIso();
      const project = {
        id: localId("proj"), name: payload.name, description: payload.description,
        scientific_objective: payload.scientific_objective, status: payload.status,
        created_at: createdAt, updated_at: createdAt, is_demo: false
      };
      local.projects.push(project);
      saveLocalState();
      currentProject = project.id;
    }
    $("ws-project-form").reset();
    await loadProjects();
    setStatus("Project created. No analysis was executed.");
  } catch (error) {
    setStatus(`Create failed: ${error.message}`);
  }
});

$("ws-edit-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!currentProject) return;
  const patch = {
    name: $("ws-edit-name").value.trim(),
    description: $("ws-edit-description").value,
    scientific_objective: $("ws-edit-objective").value,
    status: $("ws-edit-status").value
  };
  if (!patch.name) {
    setStatus("Project name must not be empty.");
    return;
  }
  try {
    if (token) {
      await api(`/api/workspace/projects/${encodeURIComponent(currentProject)}`, {
        method: "PATCH", body: JSON.stringify(patch)
      });
    } else {
      const project = local.projects.find((entry) => entry.id === currentProject);
      if (project) Object.assign(project, patch, { updated_at: nowIso() });
      saveLocalState();
    }
    await loadProjects();
    setStatus("Project metadata saved.");
  } catch (error) {
    setStatus(`Save failed: ${error.message}`);
  }
});

$("ws-archive").addEventListener("click", async () => {
  if (!currentProject) return;
  try {
    if (token) {
      await api(`/api/workspace/projects/${encodeURIComponent(currentProject)}/archive`, { method: "POST" });
    } else {
      const project = local.projects.find((entry) => entry.id === currentProject);
      if (project) {
        project.status = "archived";
        project.updated_at = nowIso();
      }
      saveLocalState();
    }
    await loadProjects();
    setStatus("Project archived. Its metadata and history remain readable.");
  } catch (error) {
    setStatus(`Archive failed: ${error.message}`);
  }
});

// ------------------------------------------------------------ project view

async function openProject(id) {
  currentProject = id;
  let project;
  if (token) {
    const encoded = encodeURIComponent(id);
    const [projectBody, datasetBody, runBody] = await Promise.all([
      api(`/api/workspace/projects/${encoded}`),
      api(`/api/workspace/projects/${encoded}/datasets`),
      api(`/api/workspace/projects/${encoded}/runs`)
    ]);
    project = projectBody.project;
    datasets = datasetBody.datasets ?? [];
    runs = runBody.runs ?? [];
    try {
      const catalogBody = await api("/api/workspace/workflows");
      catalog = catalogBody.workflows ?? LOCAL_CATALOG;
    } catch {
      catalog = LOCAL_CATALOG; // offline mirror, drift-checked by unit tests
    }
  } else {
    project = local.projects.find((entry) => entry.id === id) ?? null;
    datasets = local.datasets.filter((entry) => entry.project_id === id);
    runs = local.runs.filter((entry) => entry.project_id === id);
    catalog = LOCAL_CATALOG;
  }
  if (!project) {
    setStatus("Project not found.");
    return;
  }
  $("ws-detail").hidden = false;
  $("ws-run-detail").hidden = true;
  renderProject(project);
}

function renderProject(project) {
  $("ws-detail-title").textContent = project.name ?? "Untitled project";
  $("ws-detail-meta").textContent = `Status: ${project.status ?? "active"} · Scientific objective: ${project.scientific_objective ?? "not recorded"}`;
  renderOverview(project);
  $("ws-edit-form").hidden = false;
  $("ws-edit-name").value = project.name ?? "";
  $("ws-edit-description").value = project.description ?? "";
  $("ws-edit-objective").value = project.scientific_objective ?? "";
  $("ws-edit-status").value = project.status ?? "active";
  renderDatasets();
  renderCatalog();
  renderRuns();
}

function renderOverview(project) {
  $("ws-overview-description").textContent = project.description ?? "No description recorded.";
  $("ws-overview-counts").textContent = `Dataset metadata: ${datasets.length} · Analyses in run history: ${runs.length} (no execution started by this page)`;
  $("ws-overview-workflows").textContent = `Available workflows: ${catalog.map((workflow) => workflowName(workflow.id)).join(", ") || "none"}`;
  const activity = [...runs].sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
  fillList($("ws-activity"), activity.map((run) =>
    `${runId(run)} — ${workflowName(run.workflow_id)} — ${run.state} — ${run.created_at ?? "no date"}`), "No activity recorded.");
}

function renderDatasets() {
  const list = $("ws-datasets");
  list.replaceChildren();
  if (datasets.length === 0) {
    list.append(node("li", "No dataset metadata registered in this project."));
  } else {
    for (const dataset of datasets) {
      const sha = String(dataset.sha256 ?? "");
      list.append(node("li",
        `${dataset.filename ?? "unnamed"} — format ${dataset.file_format ?? "unspecified"}, ` +
        `${dataset.size_bytes ?? 0} bytes, sha256 ${sha.slice(0, 12)}${sha.length > 12 ? "…" : ""}, ` +
        `validation ${dataset.validation_state ?? dataset.validation ?? "unvalidated"}, ` +
        `source ${dataset.source ?? "not recorded"}, provider ref ${dataset.provider_history_ref ?? dataset.provider_ref ?? "none"} ` +
        `(metadata only; ${dataset.storage_ref ?? "no storage marker"} — not proof of durable bytes)`));
    }
  }
  const select = $("ws-run-dataset");
  select.replaceChildren();
  select.append(node("option", "No dataset selected", null));
  select.firstElementChild.value = "";
  for (const dataset of datasets) {
    const option = node("option", dataset.filename ?? dataset.id ?? dataset.public_id ?? "unnamed dataset");
    option.value = dataset.id ?? dataset.public_id ?? "";
    select.append(option);
  }
  if (datasets.length > 0) select.value = datasets[0].id ?? datasets[0].public_id ?? "";
}

$("ws-dataset-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!currentProject) return;
  const payload = {
    filename: $("ws-dataset-filename").value.trim(),
    size_bytes: Number($("ws-dataset-size").value),
    sha256: $("ws-dataset-sha256").value.trim().toLowerCase(),
    file_format: $("ws-dataset-format").value.trim() || "fasta",
    source: $("ws-dataset-source").value.trim(),
    validation_state: $("ws-dataset-validation").value,
    provider_history_ref: $("ws-dataset-provider-ref").value.trim()
  };
  if (!payload.filename || !/^[0-9a-f]{64}$/.test(payload.sha256)) {
    setStatus("A filename and a 64-character lowercase hex SHA-256 are required.");
    return;
  }
  try {
    if (token) {
      await api(`/api/workspace/projects/${encodeURIComponent(currentProject)}/datasets`, {
        method: "POST", body: JSON.stringify(payload)
      });
    } else {
      local.datasets.push({
        id: localId("ds"), project_id: currentProject, filename: payload.filename,
        size_bytes: payload.size_bytes, sha256: payload.sha256, file_format: payload.file_format,
        source: payload.source, validation_state: payload.validation_state,
        provider_history_ref: payload.provider_history_ref || null,
        storage_ref: "metadata-only://none", created_at: nowIso(), is_demo: false
      });
      saveLocalState();
    }
    $("ws-dataset-form").reset();
    await openProject(currentProject);
    setStatus("Dataset metadata registered. No file bytes were stored.");
  } catch (error) {
    setStatus(`Dataset registration failed: ${error.message}`);
  }
});

function renderCatalog() {
  const list = $("ws-catalog");
  list.replaceChildren();
  for (const workflow of catalog) {
    const item = node("li");
    item.append(node("h4", workflowName(workflow.id)));
    item.append(node("p", workflow.scientific_purpose ?? "No purpose recorded."));

    const facts = node("ul");
    facts.append(node("li", `Expected input: ${workflow.expected_input ?? "not recorded"}`));
    facts.append(node("li", `Supported formats: ${(workflow.supported_formats ?? []).join(", ") || "none"}`));
    facts.append(node("li", `Required parameters: ${(workflow.required_parameters ?? []).join(", ") || "none"}`));
    facts.append(node("li", `Expected outputs: ${(workflow.expected_outputs ?? []).join(", ") || "none"}`));
    facts.append(node("li", `Validation capabilities: ${(workflow.validation_capabilities ?? []).join("; ") || "none"}`));
    facts.append(node("li", `Execution availability: ${workflowAvailability(workflow)}`));
    item.append(facts);

    const entryPoint = workflow.entry_point ?? (workflow.id === "msa-phylogenetics" ? "phylo.html" : "ai.html");
    const link = node("a", `Open ${entryPoint} with project context`);
    link.href = `${entryPoint}?project=${encodeURIComponent(currentProject ?? "")}`;
    const launch = node("button", "Create planned run (no execution)");
    launch.type = "button";
    launch.dataset.workflow = workflow.id;
    launch.addEventListener("click", () => launchWorkflow(workflow));
    const actions = node("p");
    actions.append(link, document.createTextNode(" "), launch);
    item.append(actions);
    list.append(item);
  }
}

function launchWorkflow(workflow) {
  if (!currentProject) {
    setStatus("Open a project before creating a run.");
    return;
  }
  const datasetId = $("ws-run-dataset").value;
  if (!datasetId) {
    setStatus("Register and select a dataset before creating a run; no run was recorded.");
    return;
  }
  const objective = `Planned ${workflow.id} analysis (no execution performed by this workspace)`;
  if (token) {
    api(`/api/workspace/projects/${encodeURIComponent(currentProject)}/runs`, {
      method: "POST",
      body: JSON.stringify({
        workflow_id: workflow.id, dataset_ids: [datasetId], objective,
        params: {}, execution_mode: "real"
      })
    }).then(() => refreshRuns()).then(() => {
      setStatus("Draft run recorded through the authenticated API. No tool was executed.");
    }).catch((error) => setStatus(`Run record failed: ${error.message}`));
    return;
  }
  local.runs.push({
    id: localId("run"), project_id: currentProject, workflow_id: workflow.id,
    workflow_name: workflow.scientific_purpose ?? workflow.name ?? workflow.id,
    workflow_version: workflow.version ?? "1.0.0", objective, state: "planned",
    created_at: nowIso(), completed_at: null, input_datasets: [datasetId],
    execution_provider: null, execution_mode: "local-browser-session",
    validation_status: "unvalidated", validation: null, artifact_refs: [], steps: [],
    provenance: null, params: {}, report_available: false, is_demo: false
  });
  saveLocalState();
  refreshRuns();
  setStatus("Planned run recorded in local run history. No tool was executed.");
}

async function refreshRuns() {
  if (token) {
    const body = await api(`/api/workspace/projects/${encodeURIComponent(currentProject)}/runs`);
    runs = body.runs ?? [];
  } else {
    runs = local.runs.filter((run) => run.project_id === currentProject);
  }
  const project = projects.find((entry) => projectId(entry) === currentProject);
  if (project) renderOverview(project);
  renderRuns();
}

function renderRuns() {
  const body = $("ws-runs");
  body.replaceChildren();
  if (runs.length === 0) {
    const row = node("tr");
    const cell = node("td", "No runs recorded for this project.", null);
    cell.colSpan = 8;
    row.append(cell);
    body.append(row);
    return;
  }
  const sorted = [...runs].sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
  for (const run of sorted) {
    const row = node("tr");
    const inputIds = run.input_datasets ?? run.input_refs ?? [];
    const inputLabel = inputIds.map((id) =>
      datasets.find((dataset) => (dataset.id ?? dataset.public_id) === id)?.filename ?? id).join(", ") || "none";
    const cells = [
      workflowName(run.workflow_id),
      runId(run),
      run.created_at ?? "no date",
      run.state ?? "unknown",
      inputLabel,
      run.execution_mode ?? "not recorded",
      run.validation?.status ?? run.validation_status ?? "not available"
    ];
    for (const value of cells) row.append(node("td", value));
    const detailCell = node("td");
    const button = node("button", "View detail");
    button.type = "button";
    button.dataset.run = runId(run);
    button.addEventListener("click", () => {
      openRunDetail(runId(run)).catch((error) => setStatus(`Run detail failed: ${error.message}`));
    });
    detailCell.append(button);
    row.append(detailCell);
    body.append(row);
  }
}

// --------------------------------------------------------------- run detail

async function openRunDetail(id) {
  let run;
  if (token) {
    const body = await api(`/api/workspace/runs/${encodeURIComponent(id)}`);
    run = body.run;
  } else {
    run = local.runs.find((entry) => runId(entry) === id) ?? null;
  }
  if (!run) {
    setStatus("Run not found.");
    return;
  }
  renderRunDetail(run);
}

function renderRunDetail(run) {
  const target = $("ws-run-fields");
  target.replaceChildren();
  const append = (label, value) => {
    target.append(node("dt", label), node("dd", value ?? "not available"));
  };
  const stages = stagesFor(run.state);
  const provenance = run.provenance ?? null;
  append("Run identifier", runId(run));
  append("Workflow", `${workflowName(run.workflow_id)} (${run.workflow_id ?? "unknown"}), version ${run.workflow_version ?? "not recorded"}`);
  append("Scientific objective", run.objective ?? "not recorded");
  append("Input data", (run.input_datasets ?? run.input_refs ?? []).map((id) =>
    datasets.find((dataset) => (dataset.id ?? dataset.public_id) === id)?.filename ?? id).join(", ") || "not available");
  append("Parameters", JSON.stringify(run.params ?? {}));
  append("Workflow steps", (run.steps ?? []).length
    ? (run.steps ?? []).map((step) => typeof step === "string" ? step : JSON.stringify(step)).join("; ")
    : "not available");
  // Three deliberately separate statuses. A completed stage never implies the next.
  append("Execution status", `${run.state ?? "unknown"} — execution mode: ${run.execution_mode ?? "not recorded"}, provider: ${run.execution_provider ?? "not recorded"}; stages: ${JSON.stringify(stages)}`);
  append("Artifact retrieval status", provenance?.artifact_retrieval_state ?? "not available");
  append("Validation status", run.validation?.status ?? run.validation_status ?? "not available");
  append("Tool versions", provenance?.tools?.length
    ? provenance.tools.map((tool) => `${tool.name ?? "unknown tool"} ${tool.version ?? "unknown version"}`).join("; ")
    : "not available");
  append("Output artifacts", (run.artifact_refs ?? run.artifacts ?? []).length
    ? (run.artifact_refs ?? run.artifacts).map((artifact) =>
      typeof artifact === "string" ? artifact : (artifact.name ?? artifact.artifact_ref ?? JSON.stringify(artifact))).join("; ")
    : "not available");
  append("Provenance", provenance
    ? `workflow ${provenance.workflow_id ?? "not recorded"}@${provenance.workflow_version ?? "not recorded"}; ` +
      `input_sha256 ${provenance.input_sha256 ?? "not recorded"}; provider_job_refs ${(provenance.provider_job_refs ?? []).length}; ` +
      `output_hashes ${(provenance.output_hashes ?? []).length}; report_generated_at ${provenance.report_generated_at ?? "not recorded"}`
    : "not available");
  append("Report access", run.report_available && run.report_access
    ? `${run.report_access} (authenticated API only; no public URL)`
    : "not available");
  if (run.is_demo || run.sample) {
    append("Sample labeling", `${SAMPLE_LABEL} — precomputed, never a newly executed analysis`);
  }
  $("ws-run-detail").hidden = false;
}

// ------------------------------------------------------------------- sample

$("ws-demo-load").addEventListener("click", async () => {
  let demo;
  if (token) {
    try {
      demo = await api("/api/workspace/demo");
    } catch (error) {
      setStatus(`Sample API failed: ${error.message}`);
      return;
    }
  } else {
    demo = LOCAL_DEMO;
  }
  const view = $("ws-demo-view");
  $("ws-demo-disclaimer").textContent = demo.disclaimer ?? DISCLAIMER;
  const content = $("ws-demo-content");
  content.replaceChildren();
  content.append(node("p", `${SAMPLE_LABEL} — ${demo.project?.name ?? "sample project"}`));
  content.append(node("p", `Scientific objective: ${demo.project?.scientific_objective ?? "not recorded"}`));
  content.append(node("p", `Datasets: ${(demo.datasets ?? []).map((dataset) => dataset.filename ?? dataset.id ?? "unnamed").join(", ") || "none"}`));
  const sampleRuns = $("ws-demo-runs");
  sampleRuns.replaceChildren();
  for (const run of demo.runs ?? []) {
    sampleRuns.append(node("li",
      `${SAMPLE_LABEL} — ${workflowName(run.workflow_id)} — ${runId(run)} — state ${run.state ?? "not recorded"} — ` +
      `execution mode ${run.execution_mode ?? "precomputed"} — validation ${run.validation_status ?? "not available"} — no new execution`));
  }
  view.hidden = false;
  setStatus(`Opened ${SAMPLE_LABEL.toLowerCase()} sample. It is not a new analysis.`);
});

// ------------------------------------------------------------------- startup

local = loadLocalState();
updateModeLabel();
loadProjects().catch((error) => setStatus(`Startup load failed: ${error.message}`));
