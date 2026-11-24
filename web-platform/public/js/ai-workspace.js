// AI Research Workspace controller. Only orchestration + safe DOM rendering;
// scientific values come from validated agent results, never from this file.

import { safeCsvCell } from "./csv-safe.js";
import {
  ROUTE_AGENT,
  ROUTE_BROWSER,
  BROWSER_FASTA_MAX_BYTES,
  POLL_INTERVAL_MS,
  browserRecordsCsv,
  browserSummaryText,
  createPollDeadline,
  decideExecution,
  describeBackendStatus,
  educationNotesFromRun,
  executionBadge,
  fastaLimitError,
  localityReceiptFromRun,
  pollExpired,
  redactConsentRef,
  runBrowserProfile
} from "./ai-execution.js";

const POLL_TIMEOUT_MESSAGE = "Local agent did not claim this job within 10 minutes. Check `scripts/agent-setup/health.ps1` (Windows) or `health.sh` (Linux/macOS), then retry.";

const elements = {
  form: document.querySelector("#request-form"),
  question: document.querySelector("#question"),
  phyloExample: document.querySelector("#phylo-example"),
  fastaExample: document.querySelector("#fasta-example"),
  file: document.querySelector("#fasta-file"),
  projectId: document.querySelector("#project-id"),
  fastaText: document.querySelector("#fasta-text"),
  build: document.querySelector("#build-plan"),
  buildLabel: document.querySelector("#build-plan-label"),
  error: document.querySelector("#input-error"),
  status: document.querySelector("#status-line"),
  pollControls: document.querySelector("#poll-controls"),
  pollRetry: document.querySelector("#poll-retry"),
  pollStop: document.querySelector("#poll-stop"),
  mode: document.querySelector("#execution-mode"),
  backendBadge: document.querySelector("#backend-badge"),
  backendStatus: document.querySelector("#backend-status"),
  backendDetail: document.querySelector("#backend-detail"),
  executionRoute: document.querySelector("#execution-route"),
  routeAvailability: document.querySelector("#route-availability"),
  sequenceType: document.querySelector("#sequence-type"),
  planPanel: document.querySelector("#plan-panel"),
  planHuman: document.querySelector("#plan-human"),
  planConfidence: document.querySelector("#plan-confidence"),
  planMeta: document.querySelector("#plan-meta"),
  planSteps: document.querySelector("#plan-steps"),
  planLimitations: document.querySelector("#plan-limitations-note"),
  consentBox: document.querySelector("#consent-box"),
  consentCheck: document.querySelector("#consent-check"),
  consentLabel: document.querySelector("#consent-label-text"),
  approve: document.querySelector("#approve-plan"),
  decline: document.querySelector("#decline-plan"),
  resultsPanel: document.querySelector("#results-panel"),
  resultMode: document.querySelector("#result-mode"),
  resultSummary: document.querySelector("#result-summary"),
  validationBox: document.querySelector("#validation-box"),
  findingsBox: document.querySelector("#findings-box"),
  limitationsBox: document.querySelector("#limitations-box"),
  artifactsBox: document.querySelector("#artifacts-box"),
  educationBox: document.querySelector("#education-box"),
  localityBox: document.querySelector("#locality-box"),
  downloadLinks: document.querySelector("#download-links")
};

let currentPlan = null;
let consentSteps = [];
let activeJobId = null;
let pollTimer = null;
let pollDeadline = null;
let lastRun = null;
let artifactUrls = [];
let backendStatus = {
  execution_mode: "unknown",
  agent_status: "not_connected",
  agent_observation_basis: "backend status has not been checked"
};
let backendDescription = describeBackendStatus(backendStatus);

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined && text !== null) node.textContent = String(text);
  return node;
}

function showError(message) {
  elements.error.textContent = message;
  elements.error.hidden = false;
}

function hideError() {
  elements.error.textContent = "";
  elements.error.hidden = true;
}

function setStatus(message) {
  elements.status.textContent = message;
}

function currentRoute() {
  return elements.executionRoute?.value === ROUTE_AGENT ? ROUTE_AGENT : ROUTE_BROWSER;
}

function renderBackendStatus() {
  elements.backendStatus.textContent = backendDescription.message;
  elements.backendStatus.classList.toggle("available", backendDescription.connected);
  elements.backendDetail.textContent = backendDescription.detail;
  // Badge and chip carry the mock label themselves: a mock Worker must never
  // be presented as a connected agent or as a real execution.
  elements.backendBadge.textContent = backendDescription.badge;
  elements.backendBadge.classList.toggle("mock", backendDescription.mode === "mock");
  elements.mode.textContent = executionBadge(currentRoute(), backendDescription);
  elements.mode.classList.toggle("mock", backendDescription.mode === "mock");
  elements.mode.classList.toggle("unavailable", currentRoute() === ROUTE_AGENT && !backendDescription.connected);

  // Block the local-agent option whenever no agent is observed (mock mode
  // included) and explain why through the select's aria-describedby text.
  const agentOption = elements.executionRoute.querySelector(`option[value="${ROUTE_AGENT}"]`);
  if (agentOption) {
    agentOption.disabled = !backendDescription.connected;
    agentOption.title = backendDescription.connected
      ? "Local agent is available; heavy tools require plan approval."
      : backendDescription.mode === "mock"
        ? "Unavailable: Worker is in mock mode. Simulated results are not scientific evidence."
        : "Unavailable: no local agent was observed. Browser-local analysis still works.";
    agentOption.setAttribute("aria-label", agentOption.title);
  }
  elements.routeAvailability.textContent = backendDescription.connected
    ? "The local agent is available. Heavy tools still require plan approval."
    : backendDescription.mode === "mock"
      ? "Mock mode: the local agent is unavailable and simulated results are not scientific evidence. Use browser-local analysis."
      : "The local agent is unavailable, so the local-agent route is blocked. Browser-local analysis still works.";
  if (!backendDescription.connected && currentRoute() === ROUTE_AGENT) {
    elements.executionRoute.value = ROUTE_BROWSER;
    renderRouteLabel();
  }
}

async function refreshBackendStatus() {
  try {
    backendStatus = await fetchJson("/api/ai/backend");
  } catch (error) {
    // Fail closed: an unreachable status endpoint is never evidence of a
    // connected backend.
    backendStatus = {
      execution_mode: "unknown",
      agent_status: "not_connected",
      heavy_analyses_available: false,
      agent_observation_basis: `backend status check failed: ${error.message}`
    };
  }
  backendDescription = describeBackendStatus(backendStatus);
  renderBackendStatus();
  return backendStatus;
}

function stopPolling() {
  if (pollTimer !== null) {
    clearTimeout(pollTimer);
    pollTimer = null;
  }
  pollDeadline = null;
  elements.pollControls.hidden = true;
}

function releaseArtifactUrls() {
  for (const url of artifactUrls) URL.revokeObjectURL(url);
  artifactUrls = [];
}

function resetPanels() {
  stopPolling();
  releaseArtifactUrls();
  currentPlan = null;
  consentSteps = [];
  activeJobId = null;
  lastRun = null;
  elements.planPanel.hidden = true;
  elements.resultsPanel.hidden = true;
  elements.planHuman.textContent = "";
  elements.planMeta.replaceChildren();
  elements.planSteps.replaceChildren();
  elements.planLimitations.textContent = "";
  elements.resultSummary.textContent = "";
  elements.validationBox.replaceChildren();
  elements.findingsBox.replaceChildren();
  elements.limitationsBox.replaceChildren();
  elements.artifactsBox.replaceChildren();
  elements.educationBox.replaceChildren();
  elements.localityBox.replaceChildren();
  elements.downloadLinks.replaceChildren();
  elements.consentBox.hidden = true;
  elements.consentCheck.checked = false;
}

async function fetchJson(url, options) {
  const response = await fetch(url, options);
  let body = null;
  try {
    body = await response.json();
  } catch {
    throw new Error(`The server returned an unreadable response (HTTP ${response.status}).`);
  }
  if (!response.ok) {
    throw new Error(body?.clarifying_question || body?.error || `Request failed (HTTP ${response.status}).`);
  }
  return body;
}

async function submitRequest(event) {
  event.preventDefault();
  hideError();
  resetPanels();
  const question = elements.question.value.trim();
  if (!question) {
    showError("Enter a question first.");
    return;
  }
  const fasta = elements.fastaText.value.trim();
  if (!fasta) {
    showError("Choose a FASTA file or paste a FASTA sequence.");
    return;
  }
  const route = currentRoute();
  const limitError = fastaLimitError(fasta, route);
  if (limitError) {
    showError(limitError);
    return;
  }

  const decision = decideExecution({
    requestText: question,
    route,
    backend: backendStatus
  });
  if (decision.action === "blocked") {
    showError(decision.message);
    setStatus("");
    return;
  }

  elements.build.disabled = true;
  try {
    if (decision.action === "browser-profile") {
      // No Worker request, no agent, no simulated output: numbers are read
      // from the existing browser validation/statistics modules.
      setStatus("Running browser-local validation and statistics…");
      const report = runBrowserProfile(fasta, elements.sequenceType.value);
      renderBrowserResult(report);
      elements.mode.textContent = executionBadge(currentRoute(), backendDescription);
      setStatus(report.complete
        ? "Completed in your browser; no Worker or agent was used."
        : "Completed with validation issues shown below; no Worker or agent was used.");
      return;
    }

    // Agent route: re-check immediately before queueing so a stale page cannot
    // claim a backend that has gone away.
    setStatus("Checking local agent availability…");
    const latest = await refreshBackendStatus();
    const recheck = decideExecution({ requestText: question, route: ROUTE_AGENT, backend: latest });
    if (recheck.action === "blocked") {
      showError(recheck.message);
      setStatus("");
      return;
    }
    setStatus("Validating input and building a plan…");
    const body = await fetchJson("/api/ai/requests", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text: question,
        fasta,
        filename: elements.file.files?.[0]?.name || "pasted.fasta",
        project_id: elements.projectId.value.trim() || undefined
      })
    });
    elements.mode.textContent = executionBadge(ROUTE_AGENT, backendDescription);
    renderPlan(body.plan, body.preflight);
    setStatus(`Plan ready (${body.plan.plan_id}). Review it before approving.`);
  } catch (error) {
    showError(error.message || "Could not build a plan.");
    setStatus("");
  } finally {
    elements.build.disabled = false;
  }
}

function humanIntent(plan) {
  if (plan.intent === "identify_taxa") {
    return "You asked about taxonomic identification. This MVP can validate and profile the FASTA, but real taxa calls need BLAST hits from a local database. No taxa result will be claimed.";
  }
  if (plan.intent === "phylogenetics") {
    return "You asked for a phylogenetic analysis. One local tool will align the sequences, build a neighbor-joining tree and produce a reproducible report. This is research-use output, not a publication-grade tree.";
  }
  return "You asked for FASTA validation and statistics. The plan will run one local, deterministic tool with the parameters shown below.";
}

function renderPlan(plan, preflight) {
  currentPlan = plan;
  elements.planPanel.hidden = false;
  elements.planHuman.textContent = humanIntent(plan);
  elements.planConfidence.textContent = `Confidence: ${plan.confidence}`;
  elements.planMeta.replaceChildren(
    el("span", "pill", `Domain: ${plan.domain}`),
    el("span", "pill", `Steps: ${plan.steps.length}`),
    el("span", "pill", `Preflight: ${preflight?.valid ? `${preflight.records} record(s)` : "not available"}`)
  );

  const list = el("ol", "step-list-items");
  for (const step of plan.steps) {
    const item = el("li");
    item.append(
      el("strong", null, `${step.id}: ${step.tool_id}`),
      el("p", null, `Backend: ${step.backend} · Inputs: ${step.inputs.join(", ")} · Estimated: ${step.estimated_seconds}s`),
      el("p", null, `External egress: ${step.external_egress ? "yes" : "no"} · Consent required: ${step.consent_required ? "yes" : "no"}`)
    );
    const pre = el("pre", "param-code", JSON.stringify(step.params, null, 2));
    pre.setAttribute("aria-label", `Exact parameters for ${step.id}`);
    item.append(pre);
    list.append(item);
  }
  elements.planSteps.replaceChildren(list);

  const requiresLocalDb = Array.isArray(plan.requires) && plan.requires.includes("local_database");
  const limitations = [...(plan.limitations || [])];
  if (requiresLocalDb) limitations.push("Requires a local BLAST database; not part of this run.");
  elements.planLimitations.textContent = limitations.join(" ");

  // Show consent controls whenever any step needs consent, even if the
  // plan-level consents_required list is empty.
  consentSteps = (plan.steps || []).filter((step) => step.external_egress === true || step.consent_required === true);
  const consentLabels = [
    ...(Array.isArray(plan.consents_required) ? plan.consents_required : []),
    ...consentSteps.map((step) => `${step.id} (${step.tool_id})`)
  ];
  if (consentLabels.length > 0) {
    elements.consentBox.hidden = false;
    elements.consentCheck.checked = false;
    elements.consentLabel.textContent = `I consent to the data use required by: ${[...new Set(consentLabels)].join(", ")}.`;
  } else {
    elements.consentBox.hidden = true;
    elements.consentLabel.textContent = "";
  }
}

function renderBrowserResult(report) {
  elements.resultsPanel.hidden = false;
  elements.resultMode.textContent = "Execution: browser-local";
  elements.resultMode.classList.remove("mock", "unavailable");
  elements.resultSummary.textContent = browserSummaryText(report);

  const validation = report.validation;
  const issues = [
    ...(validation.file_errors || []).map((issue) => `${issue.code}: ${issue.message}`),
    ...(validation.records || []).filter((record) => !record.valid)
      .flatMap((record) => record.errors.map((issue) => `${record.id || `record ${record.record_number}`}: ${issue.code}`))
  ];
  elements.validationBox.replaceChildren(
    el("p", "verdict-head", `Validation: ${report.complete ? "pass" : "needs attention"}`),
    el("p", null, `Records: ${validation.valid_records}/${validation.total_records} valid · ${validation.invalid_records} invalid.`),
    el("p", null, issues.length ? `Issues: ${issues.join("; ")}` : "Issues: none")
  );

  const table = el("table", "stats-table");
  const header = el("tr");
  for (const column of ["ID", "Length", "GC %", "Ambiguous", "Canonical"]) {
    header.append(el("th", null, column));
  }
  const head = el("thead");
  head.append(header);
  table.append(head);
  const body = el("tbody");
  for (const row of report.records) {
    const tr = el("tr");
    tr.append(
      el("td", null, row.id),
      el("td", null, row.length),
      el("td", null, row.gc_percent ?? "n/a"),
      el("td", null, row.ambiguous_count),
      el("td", null, row.canonical_count)
    );
    body.append(tr);
  }
  table.append(body);
  elements.findingsBox.replaceChildren(el("h4", null, "Per-record statistics"), table);

  const limitationList = el("ul");
  for (const limitation of report.limitations) limitationList.append(el("li", null, limitation));
  elements.limitationsBox.replaceChildren(el("h4", null, "Limitations"), limitationList);
  elements.artifactsBox.replaceChildren(
    el("h4", null, "Artifacts"),
    el("p", null, "None — computed in this page from the FASTA you supplied; nothing was uploaded.")
  );

  if (report.records.length > 0) {
    const csvButton = el("button", "secondary-button small-button", "Download CSV (browser-local)");
    csvButton.type = "button";
    csvButton.addEventListener("click", () => downloadText(browserRecordsCsv(report), "smartbio-browser-profile.csv", "text/csv;charset=utf-8"));
    elements.downloadLinks.replaceChildren(csvButton);
  } else {
    elements.downloadLinks.replaceChildren();
  }
  renderTransparencySections(null);
}

function downloadText(text, filename, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const link = el("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  // Revoking synchronously can abort the download in some browsers.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

async function approvePlan() {
  if (!currentPlan) return;
  if (!elements.consentBox.hidden && !elements.consentCheck.checked) {
    showError("Consent is required before this plan can be approved.");
    return;
  }
  hideError();
  elements.approve.disabled = true;
  setStatus("Creating jobs for approved steps…");
  try {
    const body = await fetchJson(`/api/ai/plans/${currentPlan.plan_id}/approve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        approvals: currentPlan.steps.map((step) => {
          const needsConsent = step.external_egress === true || step.consent_required === true;
          return {
            step_id: step.id,
            approved: true,
            consent_granted: needsConsent ? elements.consentCheck.checked : true
          };
        }),
        consents: currentPlan.consents_required || []
      })
    });
    if (!body.job_ids || body.job_ids.length === 0) {
      setStatus("No jobs were created. The plan was not approved.");
      return;
    }
    elements.planPanel.hidden = true;
    activeJobId = body.job_ids[0];
    pollDeadline = createPollDeadline(Date.now());
    setStatus(`Queued job ${activeJobId}. Waiting for the local execution agent…`);
    pollTimer = setTimeout(pollRun, POLL_INTERVAL_MS);
  } catch (error) {
    showError(error.message || "Could not approve the plan.");
    setStatus("");
  } finally {
    elements.approve.disabled = false;
  }
}

async function declinePlan() {
  if (!currentPlan) return;
  hideError();
  elements.decline.disabled = true;
  try {
    await fetchJson(`/api/ai/plans/${currentPlan.plan_id}/approve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        approvals: currentPlan.steps.map((step) => ({ step_id: step.id, approved: false }))
      })
    });
    elements.planPanel.hidden = true;
    currentPlan = null;
    setStatus("Plan declined. No jobs were created.");
  } catch (error) {
    showError(error.message || "Could not record the decline.");
  } finally {
    elements.decline.disabled = false;
  }
}

async function pollRun() {
  pollTimer = null;
  if (!activeJobId) return;
  if (pollDeadline) pollDeadline.attempts += 1;
  if (pollExpired(pollDeadline, Date.now())) {
    stopPolling();
    showError(POLL_TIMEOUT_MESSAGE);
    elements.pollControls.hidden = false;
    setStatus("Status checking stopped after the 10-minute deadline. No result was produced.");
    return;
  }
  try {
    const run = await fetchJson(`/api/ai/runs/${activeJobId}`);
    lastRun = run;
    if (run.validation && run.explanation) {
      renderRun(run);
      setStatus("Result received and validated.");
      return;
    }
    const statuses = run.jobs?.map((job) => job.status).join(", ") || "queued";
    if (statuses.includes("failed")) {
      setStatus(`Job failed (${statuses}). No result was produced.`);
      return;
    }
    setStatus(`Job status: ${statuses}. Waiting for the local execution agent…`);
    pollTimer = setTimeout(pollRun, POLL_INTERVAL_MS);
  } catch (error) {
    showError(error.message || "Could not check the run status.");
    setStatus("");
  }
}

function retryPolling() {
  if (!activeJobId) return;
  hideError();
  elements.pollControls.hidden = true;
  pollDeadline = createPollDeadline(Date.now());
  setStatus("Checking the run status again…");
  pollTimer = setTimeout(pollRun, POLL_INTERVAL_MS);
}

function cancelPolling() {
  stopPolling();
  activeJobId = null;
  hideError();
  setStatus("Status checking stopped. No result was produced.");
}

// Per-run education and locality sections. All values come from the validated
// run/report data and are attached with textContent, so no text can become
// markup even if the upstream data is untrusted.
function renderTransparencySections(run) {
  renderEducationNotes(run);
  renderLocalityReceipt(run);
}

function renderEducationNotes(run) {
  const notes = educationNotesFromRun(run);
  const section = el("section", "result-subsection education-notes");
  section.append(el("h4", null, "Education notes"));
  if (!run) {
    section.append(el("p", "small", "Browser-local profile: no per-run education notes are produced. See Limitations above."));
    elements.educationBox.replaceChildren(section);
    return;
  }
  if (notes.length === 0) {
    section.append(el("p", "small", "No education notes recorded for this run."));
    elements.educationBox.replaceChildren(section);
    return;
  }
  const table = el("table", "compact transparency-table");
  table.append(el("caption", "sr-only", "Education notes recorded for this run"));
  const header = el("tr");
  for (const column of ["Rule / threshold", "Why insufficient", "What would help", "Verified reference"]) {
    header.append(el("th", null, column));
  }
  const head = el("thead");
  head.append(header);
  table.append(head);
  const body = el("tbody");
  for (const note of notes) {
    const row = el("tr");
    row.append(
      el("td", null, note.rule_or_threshold ?? ""),
      el("td", null, note.why_insufficient ?? ""),
      el("td", null, note.what_would_help ?? ""),
      el("td", null, note.verified_reference || "None (no verified reference)")
    );
    body.append(row);
  }
  table.append(body);
  section.append(table);
  elements.educationBox.replaceChildren(section);
}

function renderLocalityReceipt(run) {
  const receipt = localityReceiptFromRun(run);
  const section = el("section", "result-subsection locality-receipt");
  section.append(el("h4", null, "Locality receipt"));
  if (!run) {
    section.append(el("p", "small", "Browser-local run: FASTA parsing, validation and statistics stayed in this page. No Worker or agent was used, so there are no transmissions, consent references or per-run receipt."));
    elements.localityBox.replaceChildren(section);
    return;
  }
  if (!receipt) {
    section.append(el("p", "small", "No locality receipt recorded for this run."));
    elements.localityBox.replaceChildren(section);
    return;
  }
  const summary = el("dl", "receipt-summary");
  summary.append(
    el("dt", null, "Receipt mode"),
    el("dd", null, receipt.mode ?? "not recorded"),
    el("dt", null, "No external egress"),
    el("dd", null, receipt.no_external_egress === true
      ? "yes"
      : receipt.no_external_egress === false ? "no" : "not recorded")
  );
  section.append(summary);

  section.append(el("h5", null, "Local operations"));
  if (receipt.local_operations.length === 0) {
    section.append(el("p", "small", "No local operations recorded."));
  } else {
    const list = el("ul");
    for (const op of receipt.local_operations) {
      list.append(el("li", null, `${op.name ?? op.tool_id ?? "unknown tool"} · step ${op.step_id ?? "unknown"} · backend ${op.backend ?? "unknown"}`));
    }
    section.append(list);
  }

  section.append(el("h5", null, "External transmissions"));
  if (receipt.external_transmissions.length === 0) {
    section.append(el("p", "small", "No external transmissions (no data left the machine)."));
  } else {
    const table = el("table", "compact transparency-table");
    table.append(el("caption", "sr-only", "External transmissions recorded for this run"));
    const header = el("tr");
    for (const column of ["Step", "Destination", "Bytes sent", "Input SHA-256", "Consent ref", "Timestamp"]) {
      header.append(el("th", null, column));
    }
    const head = el("thead");
    head.append(header);
    table.append(head);
    const body = el("tbody");
    for (const tx of receipt.external_transmissions) {
      const row = el("tr");
      row.append(
        el("td", null, tx.step_id ?? ""),
        el("td", null, tx.destination ?? ""),
        el("td", null, tx.bytes_sent ?? ""),
        el("td", null, tx.input_sha256 ?? ""),
        el("td", null, tx.consent ? redactConsentRef(tx.consent) : "n/a"),
        el("td", null, tx.timestamp ?? "")
      );
      body.append(row);
    }
    table.append(body);
    section.append(table);
  }

  section.append(el("h5", null, "Consent references"));
  if (receipt.consent_records.length === 0) {
    section.append(el("p", "small", "None recorded."));
  } else {
    const list = el("ul");
    for (const ref of receipt.consent_records) list.append(el("li", null, redactConsentRef(ref)));
    section.append(list);
  }
  elements.localityBox.replaceChildren(section);
}

function renderRun(run) {
  elements.resultsPanel.hidden = false;
  elements.resultMode.textContent = run.execution_mode === "mock"
    ? "Execution: local agent — mock (not scientific evidence)"
    : "Execution: local agent";
  elements.resultMode.classList.toggle("mock", run.execution_mode === "mock");
  elements.resultMode.classList.remove("unavailable");
  elements.resultSummary.textContent = run.explanation?.summary || "No explanation was supplied.";

  const validation = run.validation || {};
  elements.validationBox.replaceChildren(
    el("p", "verdict-head", `Validation: ${validation.status || "unknown"}`),
    el("p", null, `Checked rules: ${(validation.checked_rules || []).join(", ") || "none recorded"}`),
    el("p", null, `Flags: ${(validation.flags || []).join("; ") || "none"}`)
  );
  elements.validationBox.classList.toggle("verdict-mock", run.execution_mode === "mock");

  const findings = el("ul");
  for (const finding of run.explanation?.findings || []) {
    findings.append(el("li", null, `${finding.text || ""} (${finding.artifact || "unknown"}${finding.field_path ? ` · ${finding.field_path}` : ""})`));
  }
  elements.findingsBox.replaceChildren(el("h4", null, "Findings"), findings);

  const limitations = [...(run.plan?.limitations || []), ...(run.explanation?.limitations || [])];
  const limitationList = el("ul");
  for (const limitation of limitations) limitationList.append(el("li", null, limitation));
  elements.limitationsBox.replaceChildren(el("h4", null, "Limitations"), limitationList);

  // Render emitted artifacts generically so any tool's named outputs (for
  // example a FASTA alignment, a Newick tree, an SVG or an HTML report) are
  // visible and downloadable without tool-specific branching here.
  releaseArtifactUrls();
  const artifactList = el("ul", "artifact-list");
  for (const artifact of run.artifacts || []) {
    const size = typeof artifact.bytes === "number" ? `${artifact.bytes} bytes` : "size unknown";
    const item = el("li", null, `${artifact.name} · ${artifact.kind} · ${size}`);
    if (typeof artifact.content === "string") {
      const url = URL.createObjectURL(new Blob([artifact.content], { type: "text/plain;charset=utf-8" }));
      artifactUrls.push(url);
      const link = el("a", "artifact-link", "Download");
      link.href = url;
      link.download = artifact.name;
      item.append(" ", link);
    }
    artifactList.append(item);
  }
  elements.artifactsBox.replaceChildren(el("h4", null, "Artifacts"), artifactList);

  const links = el("div", "download-links-row");
  const jsonLink = el("a", "secondary-button small-button", "Download JSON");
  jsonLink.href = `/api/ai/runs/${run.run_id}`;
  jsonLink.setAttribute("download", `smartbio-run-${run.run_id}.json`);
  const htmlLink = el("a", "secondary-button small-button", "Download HTML report");
  htmlLink.href = run.report_url;
  htmlLink.target = "_blank";
  htmlLink.rel = "noopener noreferrer";
  const provenanceLink = el("a", "secondary-button small-button", "Download provenance");
  provenanceLink.href = run.provenance_url;
  provenanceLink.setAttribute("download", `smartbio-provenance-${run.run_id}.json`);
  const csvButton = el("button", "secondary-button small-button", "Download CSV");
  csvButton.type = "button";
  csvButton.addEventListener("click", () => downloadCsv(run));
  links.append(jsonLink, csvButton, htmlLink, provenanceLink);
  elements.downloadLinks.replaceChildren(links);
  renderTransparencySections(run);
}

function runToCsv(run) {
  const rows = [
    ["section", "key", "value"],
    ["run", "run_id", run.run_id],
    ["run", "execution_mode", run.execution_mode],
    ["plan", "plan_id", run.plan?.plan_id],
    ["plan", "intent", run.plan?.intent],
    ["validation", "status", run.validation?.status],
    ["validation", "uncertainty", run.explanation?.uncertainty]
  ];
  for (const flag of run.validation?.flags || []) rows.push(["validation", "flag", flag]);
  for (const finding of run.explanation?.findings || []) {
    rows.push(["finding", finding.field_path || "text", finding.text]);
  }
  for (const limitation of run.explanation?.limitations || []) rows.push(["limitation", "note", limitation]);
  for (const artifact of run.artifacts || []) rows.push(["artifact", artifact.name, artifact.sha256]);
  return rows.map((row) => row.map(safeCsvCell).join(",")).join("\r\n");
}

function downloadCsv(run) {
  if (!run) return;
  const blob = new Blob([runToCsv(run)], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = el("a");
  link.href = url;
  link.download = `smartbio-run-${run.run_id}.csv`;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

// Example prompts must lead to a runnable route. FASTA profiling stays on the
// default browser route; phylogenetics switches to the local agent when it is
// actually available and explains the block when it is not.
function applyExampleRoute(route, label) {
  const option = elements.executionRoute.querySelector(`option[value="${route}"]`);
  if (!option || option.disabled) {
    setStatus(route === ROUTE_AGENT
      ? `${label} needs the local agent, which is unavailable. Use the FASTA preset for a browser-local check.`
      : "");
    return false;
  }
  elements.executionRoute.value = route;
  renderRouteLabel();
  renderBackendStatus();
  setStatus("");
  return true;
}

elements.phyloExample.addEventListener("click", () => {
  elements.question.value = elements.phyloExample.dataset.question;
  applyExampleRoute(ROUTE_AGENT, "Phylogenetics");
  elements.question.focus();
  hideError();
});
elements.fastaExample.addEventListener("click", () => {
  elements.question.value = elements.fastaExample.dataset.question;
  applyExampleRoute(ROUTE_BROWSER, "FASTA profiling");
  elements.question.focus();
  hideError();
});
elements.form.addEventListener("submit", submitRequest);
elements.approve.addEventListener("click", approvePlan);
elements.decline.addEventListener("click", declinePlan);
function renderRouteLabel() {
  elements.buildLabel.textContent = currentRoute() === ROUTE_AGENT ? "Build plan" : "Analyze locally";
}

elements.file.addEventListener("change", () => {
  const file = elements.file.files?.[0];
  if (!file) return;
  if (file.size > BROWSER_FASTA_MAX_BYTES) {
    elements.file.value = "";
    showError("This file exceeds the 64 KiB limit.");
    return;
  }
  file.text().then((text) => {
    elements.fastaText.value = text;
    const limitError = fastaLimitError(text, currentRoute());
    if (limitError) showError(limitError);
    else hideError();
  }).catch(() => showError("The selected file could not be read as text."));
});
elements.executionRoute.addEventListener("change", () => {
  renderRouteLabel();
  renderBackendStatus();
  const limitError = fastaLimitError(elements.fastaText.value.trim(), currentRoute());
  if (limitError) showError(limitError);
  else hideError();
});
elements.pollRetry.addEventListener("click", retryPolling);
elements.pollStop.addEventListener("click", cancelPolling);
renderRouteLabel();
renderBackendStatus();
refreshBackendStatus();
