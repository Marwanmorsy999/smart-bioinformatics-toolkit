/* 16S identification — browser-only control flow over the existing APIs.
   Scientific parsing/validation is reused from fasta.js, blast.js and
   taxonomy.js. No value is invented: results come only from a real
   /api/blast/results/:rid response and are labelled synthetic in mock mode. */
import { validateFasta, parseFasta } from "./fasta.js";
import { parseBlast, analyzeBlast, queryLengthsFromFasta } from "./blast.js";
import { analyzeTaxonomy } from "./taxonomy.js";
import {
  alignmentTsv,
  buildInterpretation,
  buildPlanExplanationMessage,
  fullReport,
  hasStructuredHits,
  hitSummaryCsv,
  isSafeAccession
} from "./16s-results-view.js";

const SUBMIT_THROTTLE_MS = 10 * 1000;
const STATUS_INTERVAL_MS = 60 * 1000;
const OPEN_STATUSES = new Set(["queued", "running", "waiting"]);
// status_conflict = contradictory NCBI status evidence; terminal, never success.
const TERMINAL_STATUSES = new Set(["complete", "failed", "error", "unavailable", "no_hits", "status_conflict"]);
// Researcher-facing copy for inconsistent NCBI status evidence. The technical
// `status_conflict` enum stays in the API and a concise details area, never in
// ordinary copy.
const STATUS_CONFLICT_COPY = "NCBI may occasionally return inconsistent status information. When this happens, monitoring stops and the request is held for verification. No scientific result is shown until the platform retrieves and validates a real results file.";
// Ambiguous submission: NCBI did not return a valid RID. Deliberately honest —
// no raw provider error, no job id, no retry button and no invented result.
const SUBMISSION_UNKNOWN_COPY = "NCBI did not return a request ID. The platform cannot confirm whether a job was created, so there is no request to monitor and no result was invented. The one-time consent was consumed and no automatic retry was made. Diagnostic details were recorded for support; contact support with your submission time if follow-up is needed.";
const SUBMISSION_UNKNOWN_NOTE = "Status unknown — no request ID is available, nothing is being monitored, and diagnostics were recorded for support. Review the input and obtain a fresh approval before trying again; no blind retry was performed.";
const RESULT_ENDPOINT = "/api/blast/results/";
const RID_STORAGE_KEY = "m7_6_blast_rid";

const byId = (id) => document.getElementById(id);
const ui = {
  file: byId("fasta-file"),
  fasta: byId("fasta-text"),
  objective: byId("objective"),
  example: byId("load-example"),
  validate: byId("validate-fasta"),
  inputInfo: byId("input-info"),
  create: byId("create-request"),
  plan: byId("plan-view"),
  planExplanation: byId("plan-explanation"),
  approvalBox: byId("approval-box"),
  approveCheck: byId("approve-check"),
  approve: byId("approve-plan"),
  consent: byId("consent-view"),
  submit: byId("submit-blast"),
  submitNote: byId("submit-note"),
  rid: byId("rid-view"),
  providerStatus: byId("provider-status"),
  resumeRid: byId("resume-rid"),
  resumeButton: byId("resume-rid-button"),
  checkStatus: byId("check-status"),
  countdown: byId("status-countdown"),
  clearError: byId("clear-error"),
  banner: byId("results-banner"),
  results: byId("results"),
  resultsEmpty: byId("results-empty"),
  summary: byId("summary"),
  searchOverview: byId("search-overview"),
  interpretation: byId("interpretation-view"),
  bestHitsBody: byId("best-hits-body"),
  hitsBody: byId("hits-body"),
  queryDetails: byId("query-details"),
  taxonomy: byId("taxonomy-view"),
  warnings: byId("warnings-view"),
  provenance: byId("provenance-view"),
  downloadTsv: byId("download-tsv"),
  downloadJson: byId("download-json"),
  downloadCsv: byId("download-csv"),
  downloadReport: byId("download-report"),
  downloadAlignment: byId("download-alignment"),
  error: byId("flow-error")
};

const state = {
  fasta: "", filename: "16s.fasta", byteSize: 0, inputHash: null, inputCheck: null,
  plan: null, planId: null, requestId: null, datasetId: null,
  consent: null, rid: null, status: null, mockRid: false, rtoe: null,
  statusMessage: null, providerError: null, provenance: null, noHits: false,
  lastSubmitAt: 0, lastStatusAt: 0, submittedAt: null, fetchedAt: null,
  tsv: null, parsed: null, analysis: null, taxonomy: null, mockResult: false,
  result: null, resultFormat: null, cached: false, interpretation: [],
  pollTimer: null, countdownTimer: null
};

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined && text !== null) node.textContent = String(text);
  return node;
}

function setError(message) {
  ui.error.textContent = message ? String(message).slice(0, 600) : "";
  ui.error.hidden = !message;
  if (ui.clearError) ui.clearError.hidden = !message;
}

function field(parent, label, value) {
  const row = element("div", "kv-row");
  row.append(element("span", "kv-key", label), element("span", "kv-value", value ?? "—"));
  parent.append(row);
}

function list(parent, label, values) {
  const items = Array.isArray(values) ? values.filter((value) => typeof value === "string" && value.trim()) : [];
  if (!items.length) return;
  parent.append(element("h4", "", label));
  const ul = element("ul");
  for (const item of items) ul.append(element("li", "", item));
  parent.append(ul);
}

function resetResults() {
  state.tsv = null;
  state.parsed = null;
  state.analysis = null;
  state.taxonomy = null;
  state.mockResult = false;
  state.noHits = false;
  state.result = null;
  state.resultFormat = null;
  state.cached = false;
  state.interpretation = [];
  ui.results.hidden = true;
  ui.resultsEmpty.hidden = false;
  ui.banner.hidden = true;
  ui.banner.replaceChildren();
  ui.hitsBody.replaceChildren();
  ui.searchOverview.replaceChildren();
  ui.interpretation.replaceChildren();
  ui.bestHitsBody.replaceChildren();
  ui.downloadCsv.disabled = true;
  ui.downloadReport.disabled = true;
  ui.downloadAlignment.disabled = true;
}

// ------------------------------------------------------------------ step 1
async function sha256(text) {
  if (!globalThis.crypto?.subtle) return "not available in this browser";
  try {
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
    return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  } catch {
    return "not available in this browser";
  }
}

async function refreshInput() {
  state.fasta = ui.fasta.value;
  state.byteSize = new TextEncoder().encode(state.fasta).length;
  state.inputCheck = validateFasta(state.fasta, "dna");
  state.inputHash = state.fasta.trim() ? await sha256(state.fasta) : null;
  ui.inputInfo.replaceChildren();
  ui.inputInfo.hidden = false;
  ui.inputInfo.append(element("h3", "", "Detected input"));
  field(ui.inputInfo, "Format", state.fasta.trim()
    ? (state.inputCheck.file_valid ? "FASTA · nucleotide (IUPAC)" : "FASTA · validation failed")
    : "none");
  field(ui.inputInfo, "Records", String(state.inputCheck.total_records));
  field(ui.inputInfo, "Valid / invalid", `${state.inputCheck.valid_records} / ${state.inputCheck.invalid_records}`);
  field(ui.inputInfo, "Size", `${state.byteSize} bytes (${state.fasta.length} characters)`);
  field(ui.inputInfo, "Browser SHA-256", state.inputHash ?? "—");

  const parsed = parseFasta(state.fasta);
  const lengths = parsed.records.map((record) => `${record.id || "(no id)"}: ${record.length} bp`).slice(0, 10);
  if (parsed.records.length > 10) lengths.push(`… and ${parsed.records.length - 10} more`);
  list(ui.inputInfo, "Sequence lengths", lengths);

  const problems = [
    ...state.inputCheck.file_errors.map((error) => error.message),
    ...state.inputCheck.records.flatMap((record) => record.errors.map((error) => `${record.id || "record"}: ${error.message}`))
  ];
  list(ui.inputInfo, "Validation errors", problems.slice(0, 8));
  const warnings = state.inputCheck.records
    .filter((record) => record.ambiguous_count > 0)
    .map((record) => `${record.id || "record"}: ${record.ambiguous_count} ambiguous symbol(s)`);
  list(ui.inputInfo, "Warnings", warnings.slice(0, 8));

  // The BLAST endpoint caps FASTA at 10,000 characters. Do not create a
  // request that cannot be submitted through the real chain.
  const tooLong = state.fasta.length > 10000;
  if (tooLong) {
    ui.inputInfo.append(element("p", "input-warning",
      "FASTA exceeds the 10,000-character BLAST limit. Shorten the input before creating a request."));
  }
  ui.create.disabled = !state.inputCheck.file_valid || tooLong;
  resetResults();
  // Any input change invalidates a previously generated plan, approval,
  // consent, RID and results; nothing is carried forward silently.
  ui.plan.hidden = true;
  ui.plan.replaceChildren();
  clearPlanExplanation();
  ui.approvalBox.hidden = true;
  ui.approveCheck.checked = false;
  ui.approve.disabled = true;
  ui.consent.hidden = true;
  ui.consent.replaceChildren();
  ui.submit.disabled = true;
  ui.rid.hidden = true;
  ui.providerStatus.hidden = true;
  ui.providerStatus.replaceChildren();
  ui.checkStatus.disabled = true;
  clearPollTimer();
  state.plan = null;
  state.planId = null;
  state.requestId = null;
  state.datasetId = null;
  state.consent = null;
  state.rid = null;
  state.rtoe = null;
  state.status = null;
  state.statusMessage = null;
  state.providerError = null;
}

ui.file.addEventListener("change", async () => {
  const file = ui.file.files?.[0];
  if (!file) return;
  state.filename = file.name || "16s.fasta";
  ui.fasta.value = await file.text();
  await refreshInput();
});
ui.fasta.addEventListener("input", refreshInput);
// Any input change re-validates from the ACTUAL value and resets downstream
// plan/consent/results; no hidden default is carried forward.
ui.fasta.addEventListener("change", refreshInput);
ui.validate.addEventListener("click", () => refreshInput());
ui.example.addEventListener("click", async () => {
  // Example INPUT ONLY. It is not a result and no analysis is implied.
  ui.fasta.value = ">example_input_1\nACGTACGTACGTACGTACGTACGTACGTACGT\n>example_input_2\nACGTACGTTCGTACGTACGTACGTACGTACGT\n";
  state.filename = "example-input.fasta";
  await refreshInput();
});

// Changing the objective invalidates any generated plan, approval and consent.
ui.objective.addEventListener("input", () => {
  resetResults();
  clearPollTimer();
  ui.plan.hidden = true;
  ui.plan.replaceChildren();
  clearPlanExplanation();
  ui.approvalBox.hidden = true;
  ui.approveCheck.checked = false;
  ui.approve.disabled = true;
  ui.consent.hidden = true;
  ui.consent.replaceChildren();
  ui.submit.disabled = true;
  ui.rid.hidden = true;
  ui.checkStatus.disabled = true;
  state.plan = null;
  state.planId = null;
  state.requestId = null;
  state.datasetId = null;
  state.consent = null;
  state.rid = null;
  state.rtoe = null;
});

// ------------------------------------------------------------------ step 2
function renderPlan(plan) {
  ui.plan.replaceChildren();
  ui.plan.hidden = false;
  ui.plan.append(element("h3", "", "Generated plan (not executed)"));
  field(ui.plan, "Plan id", plan.plan_id);
  field(ui.plan, "Request id", plan.request_id);
  field(ui.plan, "Intent / domain", `${plan.intent} / ${plan.domain}`);
  const step = plan.steps?.[0] ?? {};
  field(ui.plan, "Step", `${step.id} · ${step.tool_id}`);
  field(ui.plan, "Parameters", JSON.stringify(step.params ?? {}));
  field(ui.plan, "Inputs", (step.inputs ?? []).join(", "));
  field(ui.plan, "External egress", step.external_egress === true ? "yes — NCBI BLAST" : "no");
  field(ui.plan, "Consent required", step.consent_required === true ? "yes" : "no");
  list(ui.plan, "External services", plan.external_services);
  list(ui.plan, "Consents required", plan.consents_required);
  list(ui.plan, "Limitations", plan.limitations);
  ui.plan.append(element("p", "small", "This plan came from the existing deterministic planner. It is not an approval and no job has been created yet."));
}

function clearPlanExplanation() {
  ui.planExplanation.hidden = true;
  ui.planExplanation.replaceChildren();
}

// Optional model explanation of the deterministic plan. It reuses the EXISTING
// /api/assistant/chat endpoint with stream:false and sends ONLY plan metadata —
// never the FASTA. Failure is non-fatal and VISIBLE: approval and submission
// stay fully usable, but the panel never silently disappears.
function showPlanExplanationFallback(reason = null) {
  const timedOut = reason === "provider_timeout" || reason === "timeout" || reason === "request_aborted";
  ui.planExplanation.replaceChildren();
  ui.planExplanation.append(element("h3", "", "Plan explanation"));
  ui.planExplanation.append(element("p", "explanation-fallback", timedOut
    ? "The optional AI explanation timed out. The deterministic plan is complete: review and approve it below without waiting for this explanation. No job was created and nothing was sent to NCBI."
    : "The optional AI explanation is unavailable right now. The deterministic plan is complete: review and approve it below without this explanation. No job was created and nothing was sent to NCBI."));
  ui.planExplanation.hidden = false;
}

async function explainPlan(plan) {
  clearPlanExplanation();
  try {
    const message = buildPlanExplanationMessage(plan, ui.objective.value.trim());
    const response = await fetch("/api/assistant/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ message, stream: false })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.generated !== true || typeof data.reply !== "string" || !data.reply.trim()) {
      showPlanExplanationFallback(data.reason ?? data.code ?? (response.status === 504 ? "provider_timeout" : null));
      return;
    }
    ui.planExplanation.replaceChildren();
    ui.planExplanation.append(element("h3", "", "Plan explanation"));
    ui.planExplanation.append(element("p", "explanation-label", "AI-generated explanation; plan is deterministic"));
    ui.planExplanation.append(element("p", "", data.reply.slice(0, 1200)));
    ui.planExplanation.append(element("p", "small", `Source: existing assistant (${data.provider ?? "unknown provider"}). This text does not approve or execute anything.`));
    ui.planExplanation.hidden = false;
  } catch {
    // Assistant unavailable: leave the deterministic plan intact and usable.
    showPlanExplanationFallback();
  }
}

async function jsonOrThrow(response) {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const retry = response.status === 429 ? response.headers.get("Retry-After") : null;
    const suffix = retry ? ` Retry in ${retry} s.` : "";
    throw new Error(`${data.error || `Request failed (HTTP ${response.status}).`}${suffix}`);
  }
  return data;
}

ui.create.addEventListener("click", async () => {
  setError("");
  ui.create.disabled = true;
  try {
    // Validation and submission reflect the ACTUAL textarea value; no hidden
    // default or placeholder text is ever submitted.
    const fasta = ui.fasta.value;
    state.fasta = fasta;
    const check = validateFasta(fasta, "dna");
    const tooLong = fasta.length > 10000;
    if (!check.file_valid || tooLong) {
      setError("Enter a valid FASTA sequence first. Nothing was submitted.");
      ui.create.disabled = false;
      return;
    }
    const data = await jsonOrThrow(await fetch("/api/ai/requests", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({
        text: ui.objective.value.trim() || "Identify taxa for these 16S rRNA sequences using BLASTN",
        fasta,
        filename: state.filename
      })
    }));
    state.plan = data.plan;
    state.planId = data.plan_id;
    state.requestId = data.request_id;
    state.datasetId = data.dataset_id;
    const step = data.plan?.steps?.[0] ?? {};
    if (data.plan?.intent !== "identify_taxa" || step.tool_id !== "ncbi.blastn" || step.external_egress !== true) {
      throw new Error("The generated plan is not the NCBI BLAST identification plan. Nothing was approved or submitted.");
    }
    renderPlan(data.plan);
    explainPlan(data.plan); // best-effort; never blocks approval
    ui.approveCheck.checked = false;
    ui.approve.disabled = true;
    ui.approvalBox.hidden = false;
    ui.consent.hidden = true;
    ui.submit.disabled = true;
    ui.rid.hidden = true;
    ui.checkStatus.disabled = true;
  } catch (error) {
    setError(error.message || "Could not create the request.");
  } finally {
    ui.create.disabled = false;
  }
});

ui.approveCheck.addEventListener("change", () => {
  ui.approve.disabled = !(ui.approveCheck.checked && state.plan);
});

ui.approve.addEventListener("click", async () => {
  setError("");
  if (!ui.approveCheck.checked || !state.planId) {
    setError("Explicit approval and consent are required before a job can be created.");
    return;
  }
  ui.approve.disabled = true;
  try {
    const data = await jsonOrThrow(await fetch(`/api/ai/plans/${encodeURIComponent(state.planId)}/approve`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({
        approvals: [{ step_id: "step_1", approved: true, consent_granted: true }],
        consents: ["external-blast"]
      })
    }));
    if (!data.blast_consent?.token) {
      throw new Error("No BLAST consent token was issued. Nothing was submitted.");
    }
    state.consent = data.blast_consent;
    ui.consent.replaceChildren();
    ui.consent.hidden = false;
    ui.consent.append(element("h3", "", "Consent issued (token value intentionally not displayed)"));
    field(ui.consent, "Jobs created", (data.job_ids ?? []).join(", "));
    field(ui.consent, "Database", state.consent.database);
    field(ui.consent, "Program", state.consent.program);
    field(ui.consent, "Input hash", state.consent.input_hash);
    field(ui.consent, "Expires", state.consent.expires_at);
    ui.submit.disabled = false;
  } catch (error) {
    setError(error.message || "Approval failed. Nothing was submitted.");
  } finally {
    ui.approve.disabled = !(ui.approveCheck.checked && state.plan);
  }
});

// ------------------------------------------------------------------ step 3
function clearPollTimer() {
  if (state.pollTimer !== null) clearTimeout(state.pollTimer);
  state.pollTimer = null;
}

// Stop the countdown ticker on a terminal state; no indefinite animation.
function stopCountdown() {
  if (state.countdownTimer !== null) clearInterval(state.countdownTimer);
  state.countdownTimer = null;
}

function schedulePoll() {
  clearPollTimer();
  state.pollTimer = setTimeout(() => checkStatus(false), STATUS_INTERVAL_MS);
}

function startCountdown() {
  if (state.countdownTimer !== null) clearInterval(state.countdownTimer);
  const update = () => {
    const waitSubmit = Math.max(0, SUBMIT_THROTTLE_MS - (Date.now() - state.lastSubmitAt));
    const waitStatus = Math.max(0, STATUS_INTERVAL_MS - (Date.now() - state.lastStatusAt));
    if (state.rid) {
      // Terminal states have no next permitted check and no indefinite
      // animation; only open states tick down toward the next poll.
      if (TERMINAL_STATUSES.has(state.status)) {
        ui.countdown.textContent = "No next status check — terminal state.";
        ui.checkStatus.disabled = true;
      } else {
        ui.countdown.textContent = waitStatus > 0
          ? `Next status check allowed in ${Math.ceil(waitStatus / 1000)} s.`
          : "Status check available now.";
        ui.checkStatus.disabled = waitStatus > 0 || !OPEN_STATUSES.has(state.status);
      }
    } else {
      ui.countdown.textContent = waitSubmit > 0
        ? `Submission throttle: ${Math.ceil(waitSubmit / 1000)} s.`
        : "";
    }
  };
  update();
  state.countdownTimer = setInterval(update, 1000);
}

// Honest next-permitted-check text. Terminal states have no next check; open
// states respect the once-per-minute NCBI polling limit. The live countdown
// element mirrors this; nothing animates on a terminal state.
function nextPermittedCheckText(status) {
  if (TERMINAL_STATUSES.has(status)) return "no further checks — terminal state";
  if (!OPEN_STATUSES.has(status)) return "—";
  const wait = Math.max(0, STATUS_INTERVAL_MS - (Date.now() - state.lastStatusAt));
  return wait > 0 ? `${Math.ceil(wait / 1000)} s` : "now";
}

function renderRid(rid, status) {
  ui.rid.replaceChildren();
  ui.rid.hidden = false;
  ui.rid.append(element("h3", "", "Remote BLAST request"));
  field(ui.rid, "RID", rid);
  // Technical `status_conflict` stays in the API + concise details area, not
  // ordinary copy; show researcher-facing status text instead.
  field(ui.rid, "Status", status === "status_conflict" ? "held for verification" : status);
  // Submission time, last check and next permitted check are shown so the
  // researcher can see monitoring state without inferring it; RTOE is shown
  // only when the provider returned a finite value.
  field(ui.rid, "Submission time", state.submittedAt ?? "—");
  field(ui.rid, "Last check", state.lastStatusAt ? new Date(state.lastStatusAt).toISOString() : "—");
  // RTOE = provider-estimated seconds to completion, shown only when present.
  if (Number.isFinite(state.rtoe)) field(ui.rid, "Estimated time to completion (RTOE)", `${state.rtoe} s`);
  field(ui.rid, "Next permitted check", nextPermittedCheckText(status));
  field(ui.rid, "Source", "/api/blast/status/:rid (real NCBI when mock mode is off)");
  if (state.mockRid) {
    ui.rid.append(element("p", "input-warning", "This RID has the mock prefix. Its results must be treated as synthetic, never as a real NCBI result."));
  }

  ui.providerStatus.replaceChildren();
  ui.providerStatus.hidden = false;
  ui.providerStatus.className = `provider-status ${TERMINAL_STATUSES.has(status) && status !== "complete" ? "failed" : "pending"}`;
  // For inconsistent NCBI status evidence, ordinary copy uses researcher
  // wording (STATUS_CONFLICT_COPY); the raw technical message stays in the API
  // and the concise details area, not in ordinary copy.
  if (state.statusMessage && status !== "status_conflict") ui.providerStatus.append(element("p", "", state.statusMessage));
  if (state.providerError) {
    ui.providerStatus.append(element("p", "provider-error", `NCBI error (verbatim, truncated by the server): ${state.providerError}`));
  }
  if (status === "unavailable") {
    ui.providerStatus.append(element("p", "small", "NCBI could not be reached or returned an unusable response. No result was substituted."));
  }
  if (status === "status_conflict") {
    // Contradictory NCBI status evidence: honest, terminal, never success.
    // Researcher-facing wording; technical `status_conflict` stays in the API
    // and the concise details area, not in ordinary copy.
    ui.providerStatus.append(element("p", "", STATUS_CONFLICT_COPY));
    const details = element("details", "data-flow-details");
    details.append(element("summary", "", "Technical detail"));
    details.append(element("p", "small", "The API reports a terminal `status_conflict` state: structured NCBI status evidence disagrees. It is never shown as queued, no-hit or success; monitoring stops; no result is shown until a real results file is retrieved and validated."));
    ui.providerStatus.append(details);
  }
}

ui.submit.addEventListener("click", async () => {
  setError("");
  if (!state.consent?.token || !state.fasta) {
    setError("Approve the plan and issue consent before submitting.");
    return;
  }
  const wait = SUBMIT_THROTTLE_MS - (Date.now() - state.lastSubmitAt);
  if (wait > 0) {
    setError(`NCBI submission throttle: wait ${Math.ceil(wait / 1000)} s.`);
    return;
  }
  ui.submit.disabled = true;
  try {
    const submitResponse = await fetch("/api/blast/submit", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({
        fasta: state.fasta,
        database: state.consent.database,
        program: state.consent.program,
        consent_token: state.consent.token
      })
    });
    const data = await submitResponse.json().catch(() => ({}));
    if (!submitResponse.ok) {
      if (data?.code === "submission_unknown") {
        // Typed ambiguous state: do not surface the raw provider error, do not
        // offer a blind retry, and do not leave a RID in sessionStorage.
        setError(SUBMISSION_UNKNOWN_COPY);
        ui.submitNote.textContent = SUBMISSION_UNKNOWN_NOTE;
        return;
      }
      const retry = submitResponse.status === 429 ? submitResponse.headers.get("Retry-After") : null;
      throw new Error(`${data.error || `Request failed (HTTP ${submitResponse.status}).`}${retry ? ` Retry in ${retry} s.` : ""}`);
    }
    state.rid = data.rid;
    state.status = data.status ?? "queued";
    // RTOE: provider-estimated seconds to completion; only a finite number.
    state.rtoe = Number.isFinite(Number(data.rtoe)) && data.rtoe !== null && data.rtoe !== "" ? Number(data.rtoe) : null;
    state.mockRid = /^MOCK/i.test(String(data.rid));
    state.lastSubmitAt = Date.now();
    state.lastStatusAt = Date.now(); // be conservative: no immediate RID poll
    state.submittedAt = new Date().toISOString();
    try {
      sessionStorage.setItem(RID_STORAGE_KEY, state.rid);
    } catch {
      // Storage may be disabled; the visible RID remains available to copy.
    }
    renderRid(state.rid, state.status);
    ui.checkStatus.disabled = true;
    resetResults();
    startCountdown();
    if (OPEN_STATUSES.has(state.status)) schedulePoll();
    ui.submitNote.textContent = state.mockRid
      ? "Mock submission stored: synthetic output only, not an NCBI result."
      : "Submitted to NCBI. The single-use consent token has been consumed; submissions are globally throttled by the server.";
  } catch (error) {
    setError(error.message || "Submission failed. No RID was obtained.");
  } finally {
    ui.submit.disabled = true;
  }
});

async function checkStatus(manual) {
  if (!state.rid) return;
  if (!manual && !OPEN_STATUSES.has(state.status)) return;
  const wait = STATUS_INTERVAL_MS - (Date.now() - state.lastStatusAt);
  if (wait > 0) {
    if (manual) setError(`NCBI RID polling limit: wait ${Math.ceil(wait / 1000)} s before checking again.`);
    return;
  }
  setError("");
  ui.checkStatus.disabled = true;
  try {
    const response = await fetch(`/api/blast/status/${encodeURIComponent(state.rid)}`, {
      method: "GET", headers: { Accept: "application/json" }, credentials: "same-origin"
    });
    if (response.status === 429) {
      const retry = Number(response.headers.get("Retry-After")) || 60;
      state.lastStatusAt = Date.now() - (STATUS_INTERVAL_MS - retry * 1000);
      setError(`Status checked too recently. Retry in ${retry} s.`);
      return;
    }
    const data = await jsonOrThrow(response);
    state.status = data.state ?? data.status;
    state.statusMessage = data.message ?? null;
    state.providerError = data.evidence?.provider_error ?? null;
    state.lastStatusAt = Date.now();
    renderRid(state.rid, state.status);
    if (state.status === "complete") {
      clearPollTimer();
      stopCountdown();
      ui.checkStatus.disabled = true;
      ui.countdown.textContent = "No next status check — terminal state.";
      await fetchResults();
    } else if (TERMINAL_STATUSES.has(state.status)) {
      clearPollTimer();
      stopCountdown();
      ui.checkStatus.disabled = true;
      ui.countdown.textContent = "No next status check — terminal state.";
      state.noHits = state.status === "no_hits";
      ui.resultsEmpty.textContent = state.noHits
        ? "NCBI completed the search with no hits. No result table is shown and none was fabricated."
        : (state.status === "status_conflict"
          ? STATUS_CONFLICT_COPY
          : `NCBI reported ${state.status}. No results were retrieved; no result is fabricated.`);
      if (state.status !== "complete") {
        // Ordinary copy uses researcher wording for inconsistent NCBI status;
        // the technical `status_conflict` enum stays in the API + details area.
        setError(state.status === "status_conflict"
          ? STATUS_CONFLICT_COPY
          : (data.message || "The remote provider reported a terminal status. No results are available for this RID."));
      }
    } else {
      schedulePoll();
    }
  } catch (error) {
    setError(error.message || "Could not check status. No results were fetched.");
  } finally {
    // A completed or failed job must never be polled again.
    ui.checkStatus.disabled = !state.rid
      || !OPEN_STATUSES.has(state.status)
      || (Date.now() - state.lastStatusAt) < STATUS_INTERVAL_MS;
  }
}

ui.checkStatus.addEventListener("click", () => checkStatus(true));

async function resumeFromRid(value) {
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(value)) {
    setError("Enter a valid NCBI RID (8–64 letters, digits, hyphen or underscore). Nothing was submitted.");
    return;
  }
  clearPollTimer();
  resetResults();
  state.rid = value;
  state.status = "queued";
  state.rtoe = null;
  state.statusMessage = null;
  state.providerError = null;
  state.lastStatusAt = 0;
  state.submittedAt = null;
  state.fetchedAt = null;
  state.mockRid = /mock/i.test(value);
  ui.rid.hidden = false;
  ui.resultsEmpty.textContent = "Resumed by RID. Results appear only after NCBI reports completion; no new submission was made.";
  renderRid(state.rid, state.status);
  ui.submit.disabled = true;
  ui.checkStatus.disabled = false;
  setError("");
  // Prefer an offline cached reload of a completed result; only fall back to
  // a live status check when no cached result exists or it is unusable.
  const restored = await fetchResults({ cached: true });
  if (!restored) checkStatus(true);
}

ui.resumeButton.addEventListener("click", () => {
  resumeFromRid(String(ui.resumeRid.value ?? "").trim());
});

// ------------------------------------------------------------------ step 4
function detectSchema(tsv) {
  const lines = tsv.split(/\r?\n/);
  if (lines.some((line) => /\tsacc\t/.test(line) && /\tsscinames\t/.test(line))) return "blastn_local_v1";
  const data = lines.filter((line) => line.trim() && !line.startsWith("#") && !line.startsWith("qseqid"));
  if (!data.length) return "auto";
  const columns = data[0].split("\t").length;
  return columns === 11 ? "extended" : "standard";
}

async function fetchResults({ cached = false } = {}) {
  if (!state.rid) return false;
  try {
    const suffix = `?format=json&structured=1${cached ? "&cached=1" : ""}`;
    const response = await fetch(`${RESULT_ENDPOINT}${encodeURIComponent(state.rid)}${suffix}`, {
      method: "GET", headers: { Accept: "application/json" }, credentials: "same-origin"
    });
    let envelope;
    if (!response.ok) {
      // Typed errors carry honest messages and safe provider evidence. Never
      // show the raw body: it may be HTML or contain sensitive text.
      let data = null;
      try {
        data = await response.json();
      } catch {
        data = null; // non-JSON body: use the safe fallback below
      }
      const typed = data && typeof data === "object" && !Array.isArray(data) ? data : null;
      const providerError = typeof typed?.evidence?.provider_error === "string"
        ? typed.evidence.provider_error : null;
      const baseMessage = typeof typed?.message === "string" && typed.message.trim()
        ? typed.message
        : `Results request failed (HTTP ${response.status}). No result table was fabricated.`;
      envelope = {
        outcome: ["no_hits", "provider_failure", "unavailable"].includes(typed?.outcome)
          ? typed.outcome : "unavailable",
        message: providerError ? `${baseMessage} NCBI error: ${providerError}` : baseMessage,
        mock: false
      };
    } else {
      envelope = await response.json();
    }
    state.provenance = envelope.provenance ?? null;
    state.result = envelope.result ?? null;
    state.resultFormat = state.provenance?.result_format ?? null;
    state.cached = envelope.cached === true || state.provenance?.cached === true;
    if (envelope.outcome === "no_hits" || envelope.outcome === "provider_failure" || envelope.outcome === "unavailable") {
      state.noHits = envelope.outcome === "no_hits";
      clearPollTimer();
      ui.resultsEmpty.hidden = false;
      ui.resultsEmpty.textContent = envelope.message
        || (state.noHits ? "NCBI completed with no hits; no table was fabricated." : "NCBI returned no usable report; no table was fabricated.");
      ui.results.hidden = true;
      ui.banner.hidden = true;
      ui.downloadTsv.disabled = true;
      ui.downloadJson.disabled = true;
      return false;
    }
    state.tsv = envelope.tsv ?? "";
    // A cached reload keeps the ORIGINAL retrieval time from the audit record
    // when one exists; legacy/unknown rows stay null. Never substitute "now".
    state.fetchedAt = state.provenance?.retrieved_at ?? (state.cached ? null : new Date().toISOString());
    state.mockResult = state.mockRid || envelope.mock === true || /MOCK DATA|MOCK000001/i.test(state.tsv);
    const schema = detectSchema(state.tsv);
    state.parsed = parseBlast(state.tsv, schema);
    const queryIds = (state.inputCheck?.records ?? []).map((record) => record.id);
    state.analysis = analyzeBlast(state.parsed, {
      queryLengths: queryLengthsFromFasta(state.fasta),
      queryIds
    });
    // No taxonomy mapping file is uploaded here: consensus uses the scientific
    // names actually present in the retrieved TSV and flags missing lineages.
    state.taxonomy = analyzeTaxonomy(state.analysis, null, {});
    // Results are only served for a canonical-complete RID, so every
    // successful fetch (live or cached) is terminal. state.cached is derived
    // from the RESPONSE, not from this request's cached=1 flag: a live resume
    // that fell back because no cache existed is never labelled as cached.
    state.status = "complete";
    clearPollTimer();
    stopCountdown();
    ui.checkStatus.disabled = true;
    ui.countdown.textContent = "No next status check — terminal state.";
    renderRid(state.rid, state.status);
    renderResults();
    return true;
  } catch (error) {
    setError(error.message || "Could not retrieve results. Nothing was fabricated.");
    return false;
  }
}

function appendCard(parent, label, value) {
  const card = element("div", "summary-card");
  card.append(element("span", "summary-label", label), element("strong", "summary-value", String(value ?? "—")));
  parent.append(card);
}

function renderStructuredResults() {
  const result = state.result;
  ui.searchOverview.replaceChildren();
  ui.interpretation.replaceChildren();
  ui.bestHitsBody.replaceChildren();
  if (!result) return;

  ui.searchOverview.append(element("h3", "", "Search overview"));
  field(ui.searchOverview, "Query id", result.query?.id);
  field(ui.searchOverview, "Query length", result.query?.length);
  field(ui.searchOverview, "Database", state.provenance?.database ?? "—");
  field(ui.searchOverview, "Program", state.provenance?.program ?? "—");
  field(ui.searchOverview, "Parameters", JSON.stringify(state.plan?.steps?.[0]?.params ?? {}));
  field(ui.searchOverview, "RID", state.rid);
  field(ui.searchOverview, "Status", state.status ?? "—");
  field(ui.searchOverview, "Retrieved at", state.fetchedAt ?? (state.cached ? "unknown (cached result without an original retrieval record)" : "—"));
  field(ui.searchOverview, "Result format", state.provenance?.result_format ?? "—");

  state.interpretation = buildInterpretation(result, state.provenance, { synthetic: state.mockResult });
  ui.interpretation.append(element("h3", "", "Evidence-based interpretation"));
  for (const line of state.interpretation) ui.interpretation.append(element("p", "", line));

  for (const hit of result.hits ?? []) {
    const tr = element("tr");
    tr.append(element("td", "", hit.rank ?? "—"));
    const nameCell = element("td");
    const label = hit.organism ?? hit.title ?? "—";
    if (isSafeAccession(hit.accession)) {
      const link = element("a", "", label);
      link.href = `https://www.ncbi.nlm.nih.gov/nuccore/${hit.accession}`;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      nameCell.append(link, element("span", "small", ` ${hit.accession}`));
    } else {
      nameCell.append(element("span", "", label), element("span", "small", hit.accession ? ` ${hit.accession}` : ""));
    }
    tr.append(
      nameCell,
      element("td", "", hit.identity ?? "—"),
      element("td", "", hit.query_coverage === null || hit.query_coverage === undefined ? "—" : `${hit.query_coverage}%`),
      element("td", "", hit.evalue ?? "—"),
      element("td", "", hit.bitscore ?? "—")
    );
    const alignmentCell = element("td");
    const details = element("details", "alignment-detail");
    details.append(element("summary", "", `Alignment for rank ${hit.rank ?? "—"}`));
    const hsps = Array.isArray(hit.hsps) ? hit.hsps : [];
    details.append(element("p", "small", `Hit coverage ${hit.query_coverage === null || hit.query_coverage === undefined ? "—" : `${hit.query_coverage}%`} = union of its HSP query intervals over full query length ${result.query?.length ?? "—"}${hit.query_coverage_bases === null || hit.query_coverage_bases === undefined ? "" : ` (${hit.query_coverage_bases} bp)`}. Each HSP below shows its own single-alignment span, not the hit total.`));
    if (!hsps.length) details.append(element("p", "small", "No alignment HSPs were reported for this hit."));
    for (const hsp of hsps) {
      const box = element("div", "alignment-hsp");
      field(box, "HSP", hsp.hsp ?? "—");
      field(box, "HSP span coverage (this alignment only)", hsp.query_coverage === null || hsp.query_coverage === undefined ? "—" : `${hsp.query_coverage}%`);
      field(box, "Query coordinates", `${hsp.qstart ?? "—"}–${hsp.qend ?? "—"}`);
      field(box, "Subject coordinates", `${hsp.sstart ?? "—"}–${hsp.send ?? "—"}`);
      field(box, "Strand", hsp.strand ?? "—");
      field(box, "Identity / identical", `${hsp.identity ?? "—"} / ${hsp.nident ?? "—"}`);
      const mismatches = Number.isFinite(hsp.length) && Number.isFinite(hsp.nident) ? hsp.length - hsp.nident : null;
      field(box, "Mismatches (derived: length − identical)", mismatches ?? "—");
      field(box, "Gaps", hsp.gaps ?? "—");
      field(box, "Bit score / E-value", `${hsp.bit_score ?? "—"} / ${hsp.evalue ?? "—"}`);
      if (hsp.qseq || hsp.midline || hsp.sseq) {
        box.append(element("pre", "alignment-block", [
          `Query   ${hsp.qseq ?? ""}`,
          `        ${hsp.midline ?? ""}`,
          `Subject ${hsp.sseq ?? ""}`
        ].join("\n")));
      }
      details.append(box);
    }
    alignmentCell.append(details);
    tr.append(alignmentCell);
    ui.bestHitsBody.append(tr);
  }
  if (!(result.hits ?? []).length) {
    const td = element("td", "", "No structured hits were reported.");
    td.colSpan = 7;
    const tr = element("tr");
    tr.append(td);
    ui.bestHitsBody.append(tr);
  }
}

function renderResults() {
  ui.resultsEmpty.hidden = true;
  ui.results.hidden = false;
  ui.banner.hidden = false;
  ui.banner.className = `results-banner ${state.mockResult ? "synthetic" : "real"}`;
  ui.banner.textContent = state.mockResult
    ? "SYNTHETIC / MOCK DATA — a mock marker was detected in the RID or report. This is NOT a real NCBI result and must not be used for biological conclusions."
    : (state.resultFormat === "json2"
      ? "Real NCBI JSON2 result parsed into a derived table through /api/blast/results/:rid. Independent interpretation is required."
      : "Real tabular result retrieved from NCBI through /api/blast/results/:rid. Independent interpretation is required.");

  const parsed = state.parsed;
  const analysis = state.analysis;
  const taxonomy = state.taxonomy;
  ui.summary.replaceChildren();
  appendCard(ui.summary, "Detected schema", parsed.schema ?? "unresolved");
  appendCard(ui.summary, "Data rows", parsed.data_rows);
  appendCard(ui.summary, "Parsed rows", parsed.parsed_rows);
  appendCard(ui.summary, "Malformed rows", parsed.malformed_rows);
  appendCard(ui.summary, "Queries", taxonomy.summary.total_queries);
  appendCard(ui.summary, "Queries with hits", taxonomy.summary.queries_with_hits);
  appendCard(ui.summary, "No-hit queries", taxonomy.summary.queries_without_hits);
  appendCard(ui.summary, "Synthetic", state.mockResult ? "YES" : "no");

  renderStructuredResults();

  ui.hitsBody.replaceChildren();
  for (const row of parsed.rows) {
    const tr = element("tr");
    const values = row.values ?? {};
    if (!row.valid) {
      tr.append(element("td", "invalid-hit", `Row ${row.data_row}: excluded (${row.errors.map((e) => e.code).join(", ")})`));
      tr.querySelector("td").colSpan = 7;
      ui.hitsBody.append(tr);
      continue;
    }
    const description = values.sscinames || values.sscinames_raw || "— (not present in retrieved TSV)";
    const coverage = values.qcovs ?? row.query_coverage ?? "—";
    const cells = [values.qseqid, values.sacc || values.sseqid, description,
      values.pident, coverage, values.evalue, values.bitscore];
    for (const value of cells) tr.append(element("td", "", value ?? "—"));
    ui.hitsBody.append(tr);
  }
  if (!parsed.rows.length) {
    const tr = element("tr");
    const td = element("td", "", "No BLAST rows were present in the retrieved report.");
    td.colSpan = 7;
    tr.append(td);
    ui.hitsBody.append(tr);
  }

  ui.queryDetails.replaceChildren();
  ui.queryDetails.append(element("h3", "", "Sequence-level detail"));
  const grouped = analysis.grouped ?? {};
  for (const [queryId, hits] of Object.entries(grouped).sort(([a], [b]) => a.localeCompare(b))) {
    const details = element("details", "query-detail");
    details.append(element("summary", "", `${queryId} — ${hits.length} hit(s)`));
    const passing = hits.filter((hit) => hit.pass_all);
    field(details, "Passing hits", String(passing.length));
    field(details, "Best bit score", passing.length ? String(Math.max(...passing.map((hit) => hit.bitscore ?? 0))) : "—");
    field(details, "Best E-value", passing.length ? String(Math.min(...passing.map((hit) => hit.evalue ?? Infinity))) : "—");
    details.append(element("p", "small", "Filtering is deterministic and uses only fields from the retrieved TSV."));
    ui.queryDetails.append(details);
  }

  ui.taxonomy.replaceChildren();
  ui.taxonomy.append(element("h3", "", "Taxonomy consensus and verdict"));
  const verdicts = [
    ...Object.entries(taxonomy.per_query ?? {}),
    ...Object.entries(taxonomy.no_hit_queries ?? {})
  ];
  if (!verdicts.length) ui.taxonomy.append(element("p", "small", "No query-level taxonomy evidence was available in the retrieved report."));
  for (const [queryId, entry] of verdicts.sort(([a], [b]) => a.localeCompare(b))) {
    const card = element("div", "verdict-card");
    card.append(element("h4", "", queryId));
    field(card, "Verdict", entry.verdict?.status ?? "—");
    field(card, "Reported taxon", entry.verdict?.reported_taxon ?? "—");
    field(card, "Reported rank", entry.verdict?.reported_rank ?? "—");
    field(card, "Candidate hits", String(entry.candidate_count ?? 0));
    list(card, "Reasons", entry.verdict?.reasons);
    list(card, "Cautions", entry.verdict?.caution_flags);
    ui.taxonomy.append(card);
  }

  ui.warnings.replaceChildren();
  ui.warnings.append(element("h3", "", "Warnings and limitations"));
  const warnings = [
    ...(taxonomy.flags ?? []),
    ...parsed.file_errors.map((error) => error.message),
    ...parsed.rows.filter((row) => !row.valid).map((row) => `Row ${row.data_row} excluded: ${row.errors.map((e) => e.message).join("; ")}`),
    "Similarity evidence is not proof of species identity; 16S identity thresholds are screening references, not universal species boundaries.",
    "No taxonomy mapping file was uploaded, so lineages may be unresolved and verdicts deliberately remain conservative.",
    "Research use only; not a clinical or diagnostic result."
  ];
  list(ui.warnings, "Flags", warnings);

  ui.provenance.replaceChildren();
  ui.provenance.append(element("h3", "", "Provenance"));
  const step = state.plan?.steps?.[0] ?? {};
  field(ui.provenance, "RID", state.rid);
  field(ui.provenance, "Tool", step.tool_id ?? "ncbi.blastn");
  field(ui.provenance, "Tool version", "1.0.0");
  field(ui.provenance, "Parameters", JSON.stringify(step.params ?? {}));
  field(ui.provenance, "Browser input SHA-256", state.inputHash);
  field(ui.provenance, "Consent-bound input hash", state.consent?.input_hash);
  field(ui.provenance, "Submitted at", state.submittedAt);
  field(ui.provenance, "Results fetched at", state.fetchedAt ?? (state.cached ? "unknown (cached result without an original retrieval record)" : "—"));
  field(ui.provenance, "Result source", `${RESULT_ENDPOINT}${state.rid}?format=json&structured=1${state.cached ? "&cached=1" : ""}`);
  field(ui.provenance, "Mock mode", state.mockResult ? "SYNTHETIC — not real" : "no synthetic marker detected");
  const proof = state.provenance ?? {};
  field(ui.provenance, "Result format", proof.result_format ?? "—");
  field(ui.provenance, "Derived from", proof.derived_from ?? "—");
  field(ui.provenance, "Cached reload", proof.cached === true ? "yes — no fresh NCBI fetch" : "no");
  field(ui.provenance, "Database", proof.database ?? "—");
  field(ui.provenance, "Provider parser schema", proof.parser_schema ?? "—");
  field(ui.provenance, "Raw SHA-256", proof.sha256 ?? "—");
  field(ui.provenance, "Rows received / parsed / rejected",
    `${proof.rows_received ?? "—"} / ${proof.rows_parsed ?? "—"} / ${proof.rows_rejected ?? "—"}`);
  list(ui.provenance, "Retrieval warnings", proof.warnings);
  ui.downloadTsv.disabled = false;
  ui.downloadJson.disabled = false;
  ui.downloadCsv.disabled = !hasStructuredHits(state.result) && parsed.parsed_rows === 0;
  ui.downloadReport.disabled = false;
  ui.downloadAlignment.disabled = !(state.result?.hits ?? []).some((hit) => (hit.hsps ?? []).length > 0);
}

function download(text, filename, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const anchor = element("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// Clear a surfaced error without touching RID/results state.
if (ui.clearError) ui.clearError.addEventListener("click", () => setError(""));

ui.downloadTsv.addEventListener("click", () => {
  if (!state.tsv || !state.rid) return;
  download(state.tsv, `${state.mockResult ? "mock-" : ""}ncbi-blast-${state.rid}.tsv`, "text/plain;charset=utf-8");
});
ui.downloadJson.addEventListener("click", () => {
  if (!state.tsv || !state.rid) return;
  const payload = {
    rid: state.rid,
    synthetic: state.mockResult,
    tool: "ncbi.blastn",
    parameters: state.plan?.steps?.[0]?.params ?? {},
    input_hash: state.consent?.input_hash ?? null,
    retrieved_at: state.fetchedAt,
    cached: state.cached,
    result_format: state.resultFormat,
    structured_result: state.result,
    interpretation: state.interpretation,
    provenance: state.provenance,
    parsed: state.parsed,
    analysis: state.analysis,
    taxonomy: state.taxonomy,
    disclaimer: state.mockResult
      ? "Synthetic mock data — not a real NCBI result."
      : "Real retrieved data; research use only, requires independent interpretation."
  };
  download(JSON.stringify(payload, null, 2), `${state.mockResult ? "mock-" : ""}ncbi-blast-${state.rid}.json`, "application/json");
});

function csvHits() {
  if (hasStructuredHits(state.result)) return hitSummaryCsv(state.result);
  // Fallback: the same fields from the retrieved tabular report, never invented.
  const hits = (state.parsed?.rows ?? []).filter((row) => row.valid).map((row) => ({
    rank: null,
    accession: row.values?.sacc ?? row.values?.sseqid ?? null,
    organism: row.values?.sscinames ?? row.values?.sscinames_raw ?? null,
    taxid: row.values?.staxids ?? null,
    identity: row.values?.pident ?? null,
    query_coverage: row.query_coverage ?? row.values?.qcovs ?? null,
    evalue: row.values?.evalue ?? null,
    bitscore: row.values?.bitscore ?? null
  }));
  return hitSummaryCsv({ hits });
}

ui.downloadCsv.addEventListener("click", () => {
  if (!state.rid || ui.downloadCsv.disabled) return;
  download(csvHits(), `${state.mockResult ? "mock-" : ""}ncbi-blast-${state.rid}-hits.csv`, "text/csv;charset=utf-8");
});
ui.downloadReport.addEventListener("click", () => {
  if (!state.rid || ui.downloadReport.disabled) return;
  const report = fullReport({
    rid: state.rid,
    result: state.result,
    provenance: state.provenance,
    parameters: state.plan?.steps?.[0]?.params ?? {},
    interpretation: state.interpretation,
    synthetic: state.mockResult,
    cached: state.cached,
    fetchedAt: state.fetchedAt
  });
  download(report, `${state.mockResult ? "mock-" : ""}ncbi-blast-${state.rid}-report.txt`, "text/plain;charset=utf-8");
});
ui.downloadAlignment.addEventListener("click", () => {
  if (!state.rid || ui.downloadAlignment.disabled) return;
  download(alignmentTsv(state.result), `${state.mockResult ? "mock-" : ""}ncbi-blast-${state.rid}-alignment.tsv`, "text/plain;charset=utf-8");
});

// Initial state: no input and no result. If this browser tab already submitted
// a job, resume by RID (a status read) instead of creating a duplicate job.
ui.downloadTsv.disabled = true;
ui.downloadJson.disabled = true;
ui.downloadCsv.disabled = true;
ui.downloadReport.disabled = true;
ui.downloadAlignment.disabled = true;
refreshInput();
try {
  const savedRid = String(sessionStorage.getItem(RID_STORAGE_KEY) ?? "").trim();
  if (savedRid && /^[A-Za-z0-9_-]{8,64}$/.test(savedRid)) {
    ui.resumeRid.value = savedRid;
    resumeFromRid(savedRid);
  }
} catch {
  // Storage may be disabled; the manual resume controls still work.
}
