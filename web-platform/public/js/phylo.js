// M7.11 website controller — multi-FASTA validation, metadata-only plan,
// approval gate, real run response, interactive tree, metrics and downloads.
// No illustrative tree, fixture or fabricated result is ever rendered.
import { parseNewick, renderTree, analyzeTree } from "./phylo-tree-view.js";

const $ = (id) => document.getElementById(id);
if (typeof window !== "undefined") window.__phylo = { renderTree, parseNewick, analyzeTree };
const STEP_TEMPLATE = Object.freeze([
  { id: "upload_input", tool: () => "upload1 (platform upload primitive)", inputs: () => "validated multi-FASTA",
    outputs: () => "one Galaxy history dataset", backend: "Galaxy (remote, after approval)" },
  { id: "galaxy_mafft", tool: (tools) => tools.mafft ? `${tools.mafft.id} (v${tools.mafft.version ?? "unknown"})` : "MAFFT — exact id/version discovered at run time",
    inputs: () => "uploaded FASTA dataset (HDA)", outputs: () => "aligned FASTA dataset", backend: "Galaxy (remote, live-discovered)" },
  { id: "galaxy_iqtree", tool: (tools) => tools.iqtree ? `${tools.iqtree.id} (v${tools.iqtree.version ?? "unknown"})` : "IQ-TREE — exact id/version discovered at run time",
    inputs: () => "retrieved MAFFT alignment (HDA)", outputs: () => "Newick tree, IQ-TREE report, log", backend: "Galaxy (remote, live-discovered)" },
  { id: "retrieve_outputs", tool: () => "Galaxy dataset content API", inputs: () => "history dataset ids from the two jobs",
    outputs: () => "alignment FASTA, Newick, report and log content", backend: "Galaxy (remote, read-only)" },
  { id: "validate_alignment", tool: () => "phylogenetics.validate", inputs: () => "retrieved alignment text",
    outputs: () => "record/length/alphabet checks + column metrics", backend: "Worker (local, deterministic)" },
  { id: "validate_tree", tool: () => "phylogenetics.tree", inputs: () => "retrieved Newick + alignment taxon names",
    outputs: () => "parse/support/branch-length/taxa checks", backend: "Worker (local, deterministic)" },
  { id: "generate_report", tool: () => "phylogenetics.report", inputs: () => "persisted job and artifact records",
    outputs: () => "job-derived reproducible report", backend: "Worker (local, deterministic)" }
]);

let state = { fasta: "", filename: "", objective: "", validation: null, plan: null, body: null, treeView: null, pollTimer: null };

// Optional RECOVERY parameters. Strict allow-list + length limit: only a real
// job id / history id is forwarded, never a token, key or arbitrary string.
// These are included in the POST body only after the approval gate is passed.
function readResumeParams() {
  const empty = { resume_provider_job_id: null, resume_iqtree_provider_job_id: null, history_id: null };
  try {
    const params = new URLSearchParams(window.location.search);
    const safe = (key) => {
      const value = params.get(key);
      return value && /^[A-Za-z0-9._-]+$/.test(value) ? value.slice(0, 200) : null;
    };
    return {
      resume_provider_job_id: safe("resume_provider_job_id"),
      resume_iqtree_provider_job_id: safe("resume_iqtree_provider_job_id"),
      history_id: safe("history_id")
    };
  } catch {
    return empty;
  }
}
const RESUME_PARAMS = readResumeParams();

async function sha256(text) {
  try {
    const bytes = new TextEncoder().encode(text);
    const hash = await crypto.subtle.digest("SHA-256", bytes);
    return [...new Uint8Array(hash)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  } catch {
    return "computed-by-worker";
  }
}

function recordList(text) {
  const source = String(text ?? "").replace(/\r\n?/g, "\n");
  if (!source.trim()) return { records: [], errors: [] };
  if (!source.trimStart().startsWith(">")) return { records: [], errors: ["FASTA must begin with a '>' header line."] };
  const records = [];
  let current = null;
  const errors = [];
  source.split("\n").forEach((rawLine, index) => {
    const line = rawLine.trim();
    if (!line) return;
    if (line.startsWith(">")) {
      if (current) records.push(current);
      const name = line.slice(1).trim();
      if (!name) errors.push(`Line ${index + 1}: empty FASTA identifier.`);
      current = { name, sequence: "", headerLine: index + 1 };
    } else if (current) {
      current.sequence += line.replace(/\s+/g, "");
    } else {
      errors.push(`Line ${index + 1}: sequence text before any header.`);
    }
  });
  if (current) records.push(current);
  return { records, errors };
}

function validateMultiFasta(text) {
  const { records, errors } = recordList(text);
  const dna = /^[ACGTURYSWKMBDHVN-]+$/i;
  const names = records.map((record) => record.name);
  const duplicates = names.filter((name, index) => name && names.indexOf(name) !== index);
  if (duplicates.length) errors.push(`Duplicate identifiers: ${[...new Set(duplicates)].join(", ")}.`);
  for (const record of records) {
    if (!record.sequence) errors.push(`${record.name || `record ${record.headerLine}`}: no sequence data.`);
    else if (!dna.test(record.sequence)) errors.push(`${record.name}: contains non-nucleotide characters.`);
  }
  const lengths = records.map((record) => record.sequence.length).filter((length) => length > 0);
  const uniqueLengths = [...new Set(lengths)].sort((a, b) => a - b);
  // Unequal lengths are EXPECTED for raw homologous 16S sequences before
  // MAFFT. They are informational statistics here, never an input error;
  // equal length is required only for the retrieved aligned output.
  const info = uniqueLengths.length > 1
    ? [`Unequal sequence lengths (${uniqueLengths.join(", ")}): expected before alignment; MAFFT will align them.`]
    : [];
  if (records.length === 1) errors.push("Single sequence: use 16S identification, not phylogenetics.");
  else if (records.length === 2) errors.push("At least three taxa are required; four or more are recommended.");
  else if (records.length === 0) errors.push("No FASTA records were found.");
  return {
    valid: errors.length === 0,
    single_sequence: records.length === 1,
    record_count: records.length,
    unique_ids: new Set(names).size,
    duplicates,
    errors,
    info,
    names,
    min_length: lengths.length ? Math.min(...lengths) : null,
    max_length: lengths.length ? Math.max(...lengths) : null,
    lengths: uniqueLengths
  };
}

function appendLine(parent, text, className = "") {
  const item = document.createElement("li");
  item.textContent = text;
  if (className) item.className = className;
  parent.append(item);
  return item;
}

function renderFastaStats(validation) {
  const box = $("phylo-fasta-stats");
  box.replaceChildren();
  if (!validation) {
    box.textContent = "No sequences loaded yet. At least three distinct taxa are required; four or more are recommended.";
    return;
  }
  const summary = document.createElement("p");
  summary.textContent = `Records: ${validation.record_count}; unique IDs: ${validation.unique_ids}; lengths: ${validation.lengths.join(", ") || "n/a"}${validation.min_length !== null ? ` (min ${validation.min_length}, max ${validation.max_length})` : ""}.`;
  box.append(summary);
  // Informational statistics (e.g. unequal raw lengths) are neutral notes,
  // never validation errors — MAFFT aligns the sequences before tree inference.
  if ((validation.info ?? []).length) {
    const notes = document.createElement("ul");
    for (const note of validation.info) appendLine(notes, note, "is-info");
    box.append(notes);
  }
  if (!validation.valid) {
    const list = document.createElement("ul");
    for (const error of validation.errors) appendLine(list, error, "is-invalid");
    box.append(list);
  } else {
    const pass = document.createElement("p");
    pass.className = "is-valid";
    pass.textContent = validation.record_count >= 4
      ? "Valid multi-FASTA: minimum met and 4+ taxa recommended count met."
      : "Valid multi-FASTA: minimum of three distinct taxa met; four or more are recommended.";
    box.append(pass);
  }
  $("phylo-identify-link").hidden = !validation.single_sequence;
  const selector = $("phylo-reference-select");
  const previouslySelected = new Set([...selector.querySelectorAll("input:checked")].map((input) => input.value));
  selector.replaceChildren();
  for (const name of validation.names) {
    const label = document.createElement("label");
    const input = document.createElement("input");
    input.type = "checkbox";
    input.value = name;
    input.checked = previouslySelected.has(name);
    label.append(input, document.createTextNode(` ${name}`));
    selector.append(label);
  }
  $("phylo-reference-fieldset").hidden = validation.names.length === 0;
  $("phylo-plan").disabled = !validation.valid;
}

function syncFasta() {
  state.fasta = $("phylo-fasta-text").value;
  state.validation = validateMultiFasta(state.fasta);
  renderFastaStats(state.validation);
}

$("phylo-file").addEventListener("change", async (event) => {
  const file = event.target.files?.[0];
  if (!file) return;
  const text = await file.text();
  $("phylo-fasta-text").value = text;
  state.filename = file.name;
  syncFasta();
  $("phylo-status").textContent = `Loaded ${file.name}. Validation is shown above; nothing has been uploaded.`;
});

$("phylo-fasta-text").addEventListener("input", () => {
  syncFasta();
  $("phylo-status").textContent = "";
});

async function discoverTools() {
  try {
    const response = await fetch("/api/providers/galaxy/capabilities", { headers: { Accept: "application/json" } });
    if (!response.ok) return { mafft: null, iqtree: null, mode: "unavailable" };
    const body = await response.json();
    const tools = body?.capabilities?.tools ?? [];
    const find = (needles, descriptions) => tools.find((tool) => {
      const name = String(tool?.name ?? "").toLowerCase();
      const description = String(tool?.description ?? "").toLowerCase();
      return needles.some((needle) => name.includes(needle))
        && descriptions.some((needle) => description.includes(needle));
    }) ?? null;
    return {
      mafft: find(["mafft"], ["alignment program"]),
      iqtree: find(["iq-tree", "iqtree"], ["evolutionary tree", "phylogenomic"]),
      mode: body?.capabilities?.discovery_mode ?? "unavailable"
    };
  } catch {
    return { mafft: null, iqtree: null, mode: "unavailable" };
  }
}

function renderPlan(tools) {
  $("phylo-plan-steps").replaceChildren();
  for (const template of STEP_TEMPLATE) {
    const item = document.createElement("li");
    const title = document.createElement("strong");
    title.textContent = template.id;
    item.append(title, document.createTextNode(
      ` — inputs: ${template.inputs()}; outputs: ${template.outputs()}; backend: ${template.backend}; tool: ${template.tool(tools)}`
    ));
    $("phylo-plan-steps").append(item);
  }
}

$("phylo-plan").addEventListener("click", async () => {
  // Re-read synchronously so a just-completed file selection cannot race the
  // plan inspection click in an automated browser.
  state.fasta = $("phylo-fasta-text").value || state.fasta;
  state.validation = validateMultiFasta(state.fasta);
  renderFastaStats(state.validation);
  if (!state.validation.valid) {
    $("phylo-status").textContent = "Fix the validation issues before inspecting the plan.";
    return;
  }
  $("phylo-status").textContent = "Validating input and preparing plan (metadata-only; no upload)…";
  state.objective = $("phylo-objective").value.trim();
  const hash = await sha256(state.fasta);
  state.plan = { input_sha256: hash, filename: state.filename, objective: state.objective, tools: null };
  renderPlan({ mafft: null, iqtree: null });
  $("phylo-plan-view").hidden = false;
  $("phylo-status").textContent = "Plan ready. Nothing has been uploaded yet — approve to execute.";
  const tools = await discoverTools();
  state.plan.tools = tools;
  renderPlan(tools);
});

$("phylo-approve-check").addEventListener("change", (event) => {
  $("phylo-run").disabled = !event.target.checked;
});

function friendlyError(body, status) {
  const message = String(body?.error ?? "");
  if (/MAFFT|IQ-TREE|schema|tool/i.test(message) && /not available|failure|failed/i.test(message)) {
    return "This Galaxy instance could not provide a required tool or its verified input schema. No tree was inferred.";
  }
  if (/database|binding/i.test(message)) return "The run record store is unavailable. No job was accepted.";
  if (/multi-fasta|FASTA|three distinct/i.test(message)) return "The submitted dataset did not pass the multi-sequence checks. Nothing was executed.";
  return `The run could not produce verified results (HTTP ${status}). No outputs are claimed.`;
}

function renderProgress(provenance = []) {
  const list = $("phylo-job-list");
  list.replaceChildren();
  if (!provenance.length) {
    appendLine(list, "No job records were returned by the workflow endpoint.");
    return;
  }
  for (const step of provenance) {
    const details = [step.step_id, step.status];
    if (step.tool_id) details.push(`tool ${step.tool_id}`);
    if (step.tool_version) details.push(`v${step.tool_version}`);
    if (step.provider_job_id) details.push(`provider job ${step.provider_job_id}`);
    if (step.finished_at) details.push(`finished ${step.finished_at}`);
    appendLine(list, details.join(" — "), step.status === "succeeded" ? "is-valid" : "is-invalid");
  }
}

function renderMetrics(metrics) {
  const table = $("phylo-metrics");
  table.replaceChildren();
  const body = document.createElement("tbody");
  const add = (label, value) => {
    const row = document.createElement("tr");
    const key = document.createElement("th");
    key.scope = "row";
    key.textContent = label;
    const cell = document.createElement("td");
    cell.textContent = value ?? "not available";
    row.append(key, cell);
    body.append(row);
  };
  const alignment = metrics?.alignment;
  const tree = metrics?.tree;
  add("Alignment records", alignment?.sequence_count);
  add("Alignment length (columns)", alignment?.alignment_length);
  add("Gap characters", alignment?.gap_count);
  add("Conserved columns", alignment?.conserved_columns);
  add("Variable columns", alignment?.variable_columns);
  add("Tree tips", tree?.tip_count);
  add("Internal nodes", tree?.internal_node_count);
  add("Parsed support values", tree?.support_value_count);
  add("Branch lengths valid", tree ? (tree.branch_length_valid ? "yes" : "no") : null);
  add("Branch lengths complete", tree ? (tree.branch_lengths_complete ? "yes" : "no") : null);
  add("Invalid branch lengths", tree?.branch_lengths?.invalid_count);
  add("Rooting status", tree?.rooting?.status);
  add("Rooting basis", tree?.rooting?.basis);
  table.append(body);
}

function renderInterpretation(body) {
  const alignment = body.metrics?.alignment;
  const tree = body.metrics?.tree;
  const parts = [];
  if (alignment) parts.push(`The retrieved alignment contains ${alignment.sequence_count} sequences across ${alignment.alignment_length ?? "unknown"} columns, with ${alignment.gap_count} gap characters and ${alignment.conserved_columns} conserved columns.`);
  if (tree) {
    parts.push(`The parsed tree has ${tree.tip_count} tips and ${tree.internal_node_count} internal nodes; ${tree.support_value_count} internal support labels were parsed.`);
    parts.push(tree.branch_length_valid
      ? (tree.branch_lengths_complete ? "All branch lengths are finite, non-negative and present, so branch-length-aware layout is used." : "Branch lengths are valid but incomplete; the tree is drawn as a cladogram.")
      : "At least one branch length is invalid; the tree is drawn as a cladogram.");
    parts.push(`Rooting: ${tree.rooting?.status ?? "unknown"}. ${tree.rooting?.basis ?? ""} No outgroup was invented.`);
  }
  parts.push("These are descriptive checks of the retrieved datasets. Topological accuracy, substitution model choice, taxonomic sampling and publication-grade interpretation require independent validation.");
  $("phylo-interpretation").textContent = parts.join(" ");
}

async function requestAiPhrasing(body) {
  const status = $("phylo-ai-status");
  const phrase = $("phylo-ai-phrasing");
  phrase.hidden = true;
  status.textContent = "Requesting AI-generated phrasing of the deterministic metrics…";
  try {
    // Only deterministic metrics enter the message: no sequences, tree text,
    // run ids, provenance or model-generated findings.
    const facts = { alignment: body.metrics?.alignment ?? null, tree: body.metrics?.tree ?? null };
    const response = await fetch("/api/providers/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        category: "explanation_evaluation",
        message: `Rephrase these deterministic workflow metrics in plain language without adding scientific claims or citations: ${JSON.stringify(facts)}`,
        system: "You may only restate the supplied metrics. Do not infer ancestry, taxonomy or significance."
      })
    });
    if (!response.ok) throw new Error(`chat_http_${response.status}`);
    const result = await response.json();
    if (!result?.reply) throw new Error("no_reply");
    status.textContent = "AI-generated phrasing — unverified, not scientific evidence:";
    phrase.textContent = result.reply;
    phrase.hidden = false;
  } catch {
    status.textContent = "AI phrasing is unavailable. The deterministic metrics and evidence-based interpretation above remain the record.";
  }
}

function renderDownloads(body, view) {
  const list = $("phylo-downloads");
  list.replaceChildren();
  const addButton = (label, handler, disabled = false) => {
    const item = document.createElement("li");
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = label;
    button.disabled = disabled;
    if (!disabled) button.addEventListener("click", handler);
    item.append(button);
    list.append(item);
  };
  addButton("Download Newick", () => view.exportNewick(), !body.tree_newick);
  addButton("Export SVG", () => view.exportSvg(), !view.svg);
  addButton("Download alignment FASTA", () => view.exportAlignment(body.alignment_text), !body.alignment_text);
  addButton("Download analysis report (JSON)", () => view.exportReport({
    run_id: body.run_id, plan_id: body.plan_id, input_sha256: body.input_sha256,
    tool_versions: body.tool_versions, metrics: body.metrics,
    validation: { status: body.validation?.status, retrieval_errors: body.validation?.retrieval_errors ?? [] },
    limitations: ["Research use only", "No publication-grade inference", "Rooting not established without an outgroup"]
  }));
  if (body.job_ids?.galaxy_iqtree || body.job_ids?.galaxy_mafft) {
    const jobId = body.job_ids.galaxy_iqtree ?? body.job_ids.galaxy_mafft;
    const link = $("phylo-report-link");
    link.href = `/api/ai/jobs/${encodeURIComponent(jobId)}/report?format=html`;
    link.hidden = false;
  } else {
    $("phylo-report-link").hidden = true;
  }
}

function renderReopen(body) {
  const reopen = body.reopen ?? {};
  $("phylo-reopen-detail").textContent = `Run ${body.run_id}; plan ${body.plan_id}.${reopen.workspace_persisted ? " Workspace index record was persisted." : " No owner-scoped workspace record was created; the AI run record remains available."}`;
  const aiButton = $("phylo-reopen-ai");
  const wsButton = $("phylo-reopen-workspace");
  aiButton.disabled = !reopen.ai_run_url;
  wsButton.disabled = !reopen.workspace_run_url;
  aiButton.onclick = async () => {
    try {
      const response = await fetch(reopen.ai_run_url, { headers: { Accept: "application/json" } });
      if (!response.ok) throw new Error(`http_${response.status}`);
      const run = await response.json();
      const artifacts = (run.artifacts ?? []).map((item) => item.name).join(", ") || "none";
      $("phylo-reopen-detail").textContent = `AI run ${run.run_id}: validation ${run.validation?.status ?? "unknown"}; artifacts: ${artifacts}.`;
    } catch {
      $("phylo-reopen-detail").textContent = "The AI run record could not be read. No additional claims are made.";
    }
  };
  wsButton.onclick = async () => {
    try {
      const response = await fetch(reopen.workspace_run_url, { headers: { Accept: "application/json" } });
      if (!response.ok) throw new Error(`http_${response.status}`);
      const detail = await response.json();
      $("phylo-reopen-detail").textContent = `Workspace run ${detail.run?.id ?? body.run_id}: state ${detail.run?.state ?? "unknown"}; validation ${detail.run?.validation?.status ?? detail.run?.validation_status ?? "unknown"}.`;
    } catch {
      $("phylo-reopen-detail").textContent = "Workspace reopen is owner-scoped and requires the operator token used by workspace.html. The AI run record is available without it.";
    }
  };
}

$("phylo-run").addEventListener("click", async () => {
  $("phylo-run").disabled = true;
  $("phylo-status").textContent = "Approved — submitting the validated dataset to Galaxy…";
  $("phylo-progress").hidden = false;
  $("phylo-job-list").replaceChildren();
  appendLine($("phylo-job-list"), "Submitting the approved dataset. No job state is claimed yet.");
  let response;
  let body;
  try {
    response = await fetch("/api/ai/workflows/phylo/run", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fasta_text: state.fasta, filename: state.filename || "phylo.fasta",
        objective: state.objective, sequence_type: "dna",
        ...(RESUME_PARAMS.resume_provider_job_id ? { resume_provider_job_id: RESUME_PARAMS.resume_provider_job_id } : {}),
        ...(RESUME_PARAMS.resume_iqtree_provider_job_id ? { resume_iqtree_provider_job_id: RESUME_PARAMS.resume_iqtree_provider_job_id } : {}),
        ...(RESUME_PARAMS.history_id ? { history_id: RESUME_PARAMS.history_id } : {}) })
    });
    body = await response.json();
  } catch {
    $("phylo-status").textContent = "The workflow endpoint could not be reached. No Galaxy job is claimed.";
    $("phylo-run").disabled = false;
    return;
  }
  state.body = body;
  renderProgress(body.provenance ?? []);
  const completed = body.workflow_completed === true && body.validation?.status === "pass";
  $("phylo-status").textContent = !response.ok || !completed
    ? `Run ${body.run_id ?? "unknown"}: ${friendlyError(body, response.status)}`
    : `Run ${body.run_id}: workflow outputs validated (alignment and tree checks passed).`;
  $("phylo-results").hidden = false;
  renderMetrics(body.metrics);
  renderInterpretation(body);
  $("phylo-provenance").textContent = JSON.stringify(body.provenance ?? [], null, 2);
  $("phylo-validation").textContent = `Alignment: ${body.validation?.alignment?.valid ? "PASS" : "FAIL"}; Tree: ${body.validation?.tree?.valid ? "PASS" : "FAIL"}. Retrieval: ${(body.validation?.retrieval_errors ?? []).length} issue(s) recorded.`;

  const queryTaxon = $("phylo-query-taxon").value.trim();
  const referenceTaxa = [...$("phylo-reference-select").querySelectorAll("input:checked")].map((input) => input.value);
  state.treeView = renderTree(body.tree_newick, $("phylo-tree"), {
    metrics: body.metrics, queryTaxon, referenceTaxa,
    inspector: document.createElement("div")
  });
  const alignmentBox = $("phylo-alignment");
  if (body.alignment_text) {
    const pre = document.createElement("pre");
    pre.textContent = body.alignment_text;
    alignmentBox.replaceChildren(pre);
  } else {
    alignmentBox.textContent = "No alignment text was retrieved by this run. Nothing is shown.";
  }
  renderDownloads(body, state.treeView);
  renderReopen(body);
  requestAiPhrasing(body);
});
