// M7.14 controller. All analysis is performed by the Worker routes; this page
// only validates the local files, reviews a plan, drives bounded polling and
// renders genuinely retrieved artifacts. No scientific value is generated here.

import { extractZipEntries, maybeGunzip, PUBLIC_DATASETS } from "./microbiome-zip.js";
import {
  renderAlpha, renderComposition, renderCompositionChart, renderDistance,
  renderNotes, renderPcoa, renderQc, renderTable
} from "./microbiome-viewer.js";
import { captureMicrobiomeRun } from "./research-history.js";

const HAS_DOM = typeof document !== "undefined";
const $ = (id) => (HAS_DOM ? document.getElementById(id) : null);
const state = { payload: null, plan: null, run: null, result: null, polls: 0, timer: null };
const MAX_POLLS = 120;
const ui = {
  status: $("microbiome-status"), public: $("mb-public"), publicNote: $("mb-public-note"),
  uploadFields: $("mb-upload-fields"),
  reads: $("mb-reads"), barcodes: $("mb-barcodes"), metadata: $("mb-metadata"),
  objective: $("mb-objective"), planButton: $("mb-plan-button"), planNote: $("mb-plan-note"),
  plan: $("mb-plan"), planSummary: $("mb-plan-summary"), planTools: $("mb-plan-tools"),
  planValidation: $("mb-plan-validation"), planParams: $("mb-plan-params"),
  planClassifier: $("mb-plan-classifier"), approve: $("mb-approve-button"),
  approvalNote: $("mb-approval-note"), progress: $("mb-progress"), runId: $("mb-run-id"),
  steps: $("mb-step-list"), refresh: $("mb-refresh-button"), resultButton: $("mb-result-button"),
  progressNote: $("mb-progress-note"), results: $("mb-results"), resultsSource: $("mb-results-source"),
  qc: $("mb-qc"), asv: $("mb-asv"), rank: $("mb-rank"), composition: $("mb-composition"),
  compositionChart: $("mb-composition-chart"), alpha: $("mb-alpha"), beta: $("mb-beta"),
  colorBy: $("mb-color-by"), pcoa: $("mb-pcoa"), ordinationNote: $("mb-ordination-note"),
  integrity: $("mb-integrity"), assistant: $("mb-assistant-button"), assistantOutput: $("mb-assistant-output"),
  downloads: $("mb-downloads"), downloadErrors: $("mb-download-errors")
};

function setStatus(text) { if (ui.status) ui.status.textContent = text ?? ""; }
function showError(error) { setStatus(`Error: ${error?.message ?? error}`); }

async function json(url, options) {
  const response = await fetch(url, options);
  const body = await response.json().catch(() => ({}));
  if (!response.ok && !body.validation) throw new Error(body.error ?? `HTTP ${response.status}`);
  return { body, status: response.status };
}

async function fileText(file, { requirePlainText = false } = {}) {
  if (!file) return null;
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (!requirePlainText && bytes[0] === 0x1f && bytes[1] === 0x8b) {
    return new TextDecoder().decode(await maybeGunzip(bytes));
  }
  if (!requirePlainText && bytes[0] === 0x50 && bytes[1] === 0x4b) {
    const entries = await extractZipEntries(bytes, ["sequences.fastq.gz", "barcodes.fastq.gz",
      "sample-metadata.tsv", "sequences.fastq", "barcodes.fastq"]);
    const pick = (patterns) => {
      for (const [name, entry] of entries) {
        if (patterns.some((pattern) => pattern.test(name)) && typeof entry.text === "string") return entry.text;
      }
      return null;
    };
    return pick(patternsFor(file.name));
  }
  return new TextDecoder().decode(bytes);
}

function patternsFor(filename) {
  if (/barcode/i.test(filename)) return [/barcode/i];
  if (/metadata|sample/i.test(filename)) return [/metadata/i, /sample-metadata/i];
  return [/sequences\.fastq/i, /^sequences/i];
}

async function collectPayload() {
  const objective = ui.objective?.value?.trim() ?? "";
  if (ui.public?.value) {
    const dataset = PUBLIC_DATASETS[ui.public.value];
    return { public_dataset: ui.public.value, objective, source_label: dataset?.label ?? ui.public.value };
  }
  const reads = await fileText(ui.reads?.files?.[0]);
  const barcodes = await fileText(ui.barcodes?.files?.[0]);
  const metadata = await fileText(ui.metadata?.files?.[0], { requirePlainText: true });
  if (!reads || !barcodes || !metadata) {
    throw new Error("Choose a sequences FASTQ, a barcode FASTQ and a sample metadata TSV, or select the public dataset.");
  }
  return { reads_text: reads, barcodes_text: barcodes, metadata_text: metadata,
    reads_filename: ui.reads.files[0].name, barcodes_filename: ui.barcodes.files[0].name,
    metadata_filename: ui.metadata.files[0].name, objective };
}

function renderPlan(body) {
  state.plan = body;
  if (!ui.plan) return;
  ui.plan.hidden = false;
  const input = body.input ?? {};
  const validation = body.validation ?? {};
  const readsLabel = input.reads?.records !== null && input.reads?.records !== undefined
    ? `${input.reads.records} reads (complete local parse)`
    : `${input.reads?.sampled_reads ?? 0} reads in bounded sample${input.reads?.sample_size_bytes ? ` of ${input.reads.sample_size_bytes} B` : ""}` +
      (input.reads?.published_expectation?.reads
        ? `; published expectation ${input.reads.published_expectation.reads} reads` : "");
  ui.planSummary.textContent = `${input.mode} input · ${input.sample_count ?? 0} sample(s) · ` +
    `${readsLabel} · ${input.barcode_records ?? input.sampled_barcodes ?? 0} barcodes · ` +
    `correspondence ${input.correspondence?.valid ? "verified" : "FAILED"}${input.correspondence?.basis ? ` (${input.correspondence.basis})` : ""}`;
  renderTable(ui.planTools, [
    { key: "step", label: "Step" }, { key: "tool", label: "Discovered tool" },
    { key: "version", label: "Version" }, { key: "status", label: "Availability" }
  ], (body.plan?.steps ?? []).map((step) => ({ step: step.id,
    tool: step.tool_id ?? "not discovered", version: step.tool_version ?? "—", status: step.status })));
  const samples = (input.samples ?? []).map((sampleId) => ({ sample_id: sampleId,
    has_reads: (input.correspondence?.missing_samples ?? []).includes(sampleId) ? "NO" : "yes" }));
  renderTable(ui.planValidation, [
    { key: "sample_id", label: "Sample" }, { key: "has_reads", label: "Mapped to reads" }
  ], samples);
  if (!(validation.errors ?? []).length) {
    const note = document.createElement("p");
    note.className = "is-valid";
    note.textContent = `Validation passed: ${validation.checked_rules?.length ?? 0} rule(s) checked.`;
    ui.planValidation.append(note);
  } else renderNotes(ui.planValidation, validation.errors);
  ui.planParams.textContent = `trim-left ${body.params?.trim_left ?? "not reported"}; ` +
    `trunc-len ${body.params?.trunc_len ?? "not reported"}. ${body.params?.trunc_rationale ?? ""} ` +
    `${body.params?.rarefaction_reason ?? ""}${body.qc?.note ? ` ${body.qc.note}` : ""}`;
  // Replace the static dataset description with the rationale actually derived
  // from the observed quality values returned by the plan endpoint.
  if (ui.publicNote && body.params?.trunc_rationale) {
    ui.publicNote.textContent = `Observed-data rationale: ${body.params.trunc_rationale} ` +
      "The Worker verifies the recorded checksums before using public files.";
  }
  const classifier = body.classifier ?? {};
  ui.planClassifier.textContent = classifier.available
    ? `Tool ${classifier.tool_id ?? "unknown"} version ${classifier.version ?? "unknown"}; ` +
      `parameter ${classifier.parameter_name ?? "unknown"}; option label ${classifier.option_label ?? classifier.reference_identity ?? "unknown"}; ` +
      `option value ${classifier.option_value ?? "unknown"}; basis ${classifier.selection_basis ?? "unknown"}. ` +
      `No release number was guessed.`
    : `Unavailable: ${classifier.reason ?? "no classifier option discovered"}`;
  ui.approve.disabled = validation.status !== "pass";
  ui.approvalNote.textContent = validation.status === "pass"
    ? "Approval submits exactly one dependent workflow. Refreshing or reopening reuses the stored run."
    : "Input validation failed; approval is disabled. Fix the missing or duplicate sample ids and review again.";
}

async function plan() {
  try {
    setStatus("Reviewing inputs and discovering live tools…");
    state.payload = await collectPayload();
    const { body } = await json("/api/ai/workflows/microbiome/plan", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(state.payload)
    });
    if (body.validation?.status !== "pass") {
      renderPlan(body);
      setStatus("Validation failed; no plan was proposed and no job was submitted.");
      return;
    }
    renderPlan(body);
    setStatus(`Plan reviewed for ${body.input.sample_count} sample(s). Approval is required before any submission.`);
  } catch (error) { showError(error); }
}

async function approve() {
  if (!state.payload) return;
  try {
    setStatus("Submitting the single approved workflow…");
    const { body } = await json("/api/ai/workflows/microbiome/run", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(state.payload)
    });
    state.run = body;
    ui.progress.hidden = false;
    ui.runId.textContent = `Run ${body.run_id} · plan ${body.plan_id} · history ${body.history_id ?? "not reported"}`;
    try { captureMicrobiomeRun(body, { objective: state.payload.objective, sample_ids: state.plan?.input?.samples ?? [] }); } catch { /* storage unavailable */ }
    const url = new URL(window.location.href);
    url.searchParams.set("run_id", body.run_id);
    window.history.replaceState({}, "", url);
    setStatus(`Run ${body.run_id} stored. ${body.deduped ? "Existing run reused; no duplicate submission." : "One submitted workflow; no stage duplicated."}`);
    await refreshStatus();
    schedulePoll(body);
  } catch (error) { showError(error); }
}

function schedulePoll(run) {
  if (state.timer) clearTimeout(state.timer);
  if (!run || run.status === "succeeded" || run.status === "failed" || state.polls >= MAX_POLLS) return;
  state.timer = setTimeout(async () => {
    state.timer = null;
    await refreshStatus();
    schedulePoll({ status: state.run?.status ?? "running" });
  }, run.poll_after_ms ?? 1600);
}

let advanceInFlight = false;

// One best-effort bounded operation after a running status poll. The Worker's
// status route is read-only; all progress is driven by this explicit POST. A
// failure is swallowed so the next scheduled poll can retry — never a tight
// retry loop and never a page rebuild.
async function advanceOnce(url) {
  if (advanceInFlight || !state.run?.run_id) return;
  advanceInFlight = true;
  try {
    await json(url ?? "/api/ai/workflows/microbiome/advance", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ run_id: state.run.run_id })
    });
  } catch {
    // Best effort: status stays authoritative and the next poll advances again.
  } finally {
    advanceInFlight = false;
  }
}

async function refreshStatus() {
  if (!state.run?.run_id) return null;
  try {
    const statusUrl = `/api/ai/workflows/microbiome/status?run_id=${encodeURIComponent(state.run.run_id)}`;
    let { body } = await json(statusUrl);
    if (body.status === "running") {
      await advanceOnce(body.advance_url ?? undefined);
      body = (await json(statusUrl)).body;
    }
    state.run = { ...state.run, ...body };
    state.polls += 1;
    if (ui.progress) {
      ui.progress.hidden = false;
      ui.runId.textContent = `Run ${body.run_id} · status ${body.status} · poll ${body.poll_count ?? state.polls}`;
      ui.steps.replaceChildren();
      for (const step of body.steps ?? []) {
        const item = document.createElement("li");
        const label = document.createElement("span");
        label.textContent = step.step_id;
        const badge = document.createElement("span");
        badge.className = "step-state";
        badge.dataset.state = step.status;
        badge.textContent = step.status;
        item.append(label, badge);
        if (step.provider_job_id) {
          const provider = document.createElement("span");
          provider.textContent = `provider job ${step.provider_job_id}`;
          item.append(provider);
        }
        if (step.tool_id) {
          const tool = document.createElement("span");
          tool.textContent = `tool ${step.tool_id}${step.tool_version ? `@${step.tool_version}` : ""}`;
          item.append(tool);
        }
        if (step.reason) {
          const reason = document.createElement("span");
          reason.textContent = step.reason;
          item.append(reason);
        }
        ui.steps.append(item);
      }
    }
    ui.resultButton.disabled = body.status !== "succeeded";
    setStatus(body.terminal
      ? `Run ${body.run_id} is ${body.status}; no further polling is scheduled.`
      : `Run ${body.run_id}: ${body.current_step ?? "starting"} — next bounded poll in ${body.poll_after_ms ?? 1600} ms.`);
    if (body.status === "succeeded") await loadResult();
    return body;
  } catch (error) { showError(error); return null; }
}

function sourceLabel(result) {
  const source = result?.input?.source ?? {};
  if (source.urls?.metadata) {
    const urls = Object.entries(source.urls).filter(([, value]) => value)
      .map(([key, value]) => `${key} ${value}`).join(" · ");
    return `Public dataset direct sources: ${urls} · verified SHA-256 ${JSON.stringify(source.checksums)}` +
      (source.provenance_note ? ` · ${source.provenance_note}` : "");
  }
  return "User-uploaded reads and metadata; original filenames recorded in the stored run.";
}

function renderResult(result) {
  state.result = result;
  if (!ui.results) return;
  ui.results.hidden = false;
  ui.resultsSource.textContent = `${sourceLabel(result)} Tool versions: ${JSON.stringify(result.tools ?? {})}`;
  renderQc(ui.qc, result.qc);
  const asv = result.asv ?? {};
  ui.asv.textContent = asv.available
    ? `${asv.feature_count} ASV(s) across ${asv.sample_count} sample(s); ${asv.total_assignable_reads} assignable reads; ` +
      `${asv.rep_seq_count} representative sequence(s). Parameter rationale: ${asv.parameter_rationale ?? "not reported"}.`
    : `Unavailable: ${asv.reason ?? "no denoising output retrieved"}`;
  const composition = result.composition ?? {};
  renderComposition(ui.composition, composition, { rank: ui.rank?.value });
  renderCompositionChart(ui.compositionChart, composition, { sample: null });
  renderAlpha(ui.alpha, result.alpha);
  renderDistance(ui.beta, result.beta);
  const metadata = result.input?.metadata_text ? parseMetadataRows(result.input.metadata_text) : [];
  const fields = [...new Set(metadata.flatMap((row) => Object.keys(row)))].filter((key) => key !== "barcode_sequence");
  if (ui.colorBy) {
    ui.colorBy.replaceChildren(new Option("No metadata colour", ""));
    for (const field of fields.sort()) ui.colorBy.append(new Option(field, field));
  }
  renderPcoa(ui.pcoa, result.pcoa, metadata, { colorBy: ui.colorBy?.value ?? "" });
  ui.ordinationNote.textContent = `${result.ordination?.note ?? "No ordination artifact note."} ` +
    `Visualization tool: ${result.ordination?.visualization_tool ?? "not reported"}.`;
  renderNotes(ui.integrity, [
    `Integrity: ${result.integrity?.valid ? "passed" : "failed"}.`,
    ...(result.integrity?.warnings ?? []),
    ...(result.integrity?.errors ?? []),
    ...(result.unavailable_reasons ?? []).map((reason) => `Unavailable — ${reason}`),
    ...(result.limitations ?? [])
  ]);
  renderDownloads(result);
}

function parseMetadataRows(text) {
  const lines = String(text ?? "").replace(/\r\n?/g, "\n").split("\n").filter((line) => line.trim());
  if (!lines.length) return [];
  const header = lines[0].split("\t").map((cell) => cell.trim().replace(/^#/, ""));
  return lines.slice(1).map((line) => {
    const cells = line.split("\t");
    const row = {};
    header.forEach((key, index) => { row[key] = cells[index]?.trim() ?? null; });
    return row;
  });
}

function textFile(name, content, mime = "text/plain;charset=utf-8") {
  return { name, content, mime };
}

function exportFiles(result) {
  const files = [];
  const table = result.integrity?.coverage ?? {};
  files.push(textFile("microbiome-report.json", JSON.stringify(result, null, 2), "application/json"));
  for (const artifact of result.artifacts ?? []) {
    // Original tool artifacts are downloaded from the stored record below; the
    // in-memory list keeps their checksum so the UI can verify any export.
    files.push({ name: artifact.name, stored_sha256: artifact.checksum, source_step: artifact.source_step });
  }
  if (table.features) files.push({ name: "feature-table (original artifact)", stored_sha256: null });
  return files;
}

function renderDownloads(result) {
  if (!ui.downloads) return;
  ui.downloads.replaceChildren();
  if (ui.downloadErrors) ui.downloadErrors.textContent = "";
  const files = Array.isArray(result.exports) && result.exports.length ? result.exports : exportFiles(result);
  for (const file of files) {
    if (typeof file.content !== "string") continue;
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = `Download ${file.name}${file.tool_version ? ` (${file.tool_version})` : ""}`;
    button.addEventListener("click", async () => {
      try {
        const computed = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(file.content));
        const sha = [...new Uint8Array(computed)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
        const match = file.checksum ? (sha === file.checksum ? "MATCHES" : "DOES NOT MATCH") : "no stored checksum";
        if (ui.downloadErrors) ui.downloadErrors.textContent = `${file.name}: SHA-256 ${sha} ${match}; source ${file.source ?? "stored export"}.`;
        const url = URL.createObjectURL(new Blob([file.content], { type: "text/plain;charset=utf-8" }));
        const anchor = document.createElement("a");
        anchor.href = url; anchor.download = file.name; anchor.click();
        setTimeout(() => URL.revokeObjectURL(url), 10_000);
      } catch (error) {
        if (ui.downloadErrors) ui.downloadErrors.textContent = `Download failed for ${file.name}: ${error?.message ?? error}`;
      }
    });
    ui.downloads.append(button);
  }
  const recovery = document.createElement("a");
  recovery.href = `/api/ai/runs/${encodeURIComponent(result.run_id)}/recovery`;
  recovery.textContent = "Original tool artifacts and recomputed checksums (server recovery)";
  ui.downloads.append(recovery);
  if (ui.downloadErrors && !(result.artifacts ?? []).length) {
    ui.downloadErrors.textContent = "No original tool artifacts were retrieved; no download was fabricated.";
  }
}

async function loadResult() {
  if (!state.run?.run_id) return;
  try {
    const { body } = await json(`/api/ai/workflows/microbiome/result?run_id=${encodeURIComponent(state.run.run_id)}`);
    if (body.status === "succeeded" || body.result) renderResult(body);
    else setStatus(body.reason ?? "No stored result is available yet.");
  } catch (error) { showError(error); }
}

async function explain() {
  if (!state.result) return;
  if (!ui.assistantOutput) return;
  ui.assistantOutput.hidden = false;
  ui.assistantOutput.textContent = "Requesting an explanation from the existing assistant gateway…";
  const context = {
    workflow_type: "microbiome", run_id: state.result.run_id,
    observed: {
      samples: state.result.input?.sample_count ?? null,
      features: state.result.asv?.feature_count ?? null,
      reads: state.result.asv?.total_assignable_reads ?? null,
      rank: state.result.composition?.rank ?? null,
      alpha: (state.result.alpha?.samples ?? []).slice(0, 5),
      // variance_explained is a fraction (0-1), never a percentage, from both
      // the parsed QIIME 2 footer and the worker-computed PCoA path.
      pcoa_variance_fraction: state.result.pcoa?.variance_explained ?? null,
      pcoa_variance_units: "fraction_of_total_variance (0-1; percent = fraction * 100)",
      unavailable: state.result.unavailable_reasons ?? []
    },
    note: "Use only these values; no significance claim."
  };
  try {
    const response = await fetch("/api/assistant/chat", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: "Explain these observed microbiome workflow values.", context })
    });
    const body = await response.json().catch(() => ({}));
    ui.assistantOutput.textContent = body.available === false
      ? `Assistant unavailable: ${body.reason ?? "no authorized model provider"}. No invented explanation was shown.`
      : JSON.stringify(body, null, 2).slice(0, 8000);
  } catch (error) {
    ui.assistantOutput.textContent = `Assistant request failed: ${error?.message ?? error}. No explanation was invented.`;
  }
}

async function reopenFromUrl() {
  const runId = new URL(window.location.href).searchParams.get("run_id");
  if (!runId || !/^job_[0-9a-f]{16}$/.test(runId)) return false;
  try {
    const { body } = await json(`/api/ai/workflows/microbiome/status?run_id=${encodeURIComponent(runId)}`);
    state.run = { ...(state.run ?? {}), ...body };
    ui.progress.hidden = false;
    ui.runId.textContent = `Reopened stored run ${runId} · status ${body.status}`;
    setStatus(`Reopened run ${runId} from the server; no browser memory or new submission was used.`);
    if (body.status === "succeeded") await loadResult();
    else schedulePoll({ status: body.status, poll_after_ms: body.poll_after_ms });
    return true;
  } catch (error) { showError(error); return false; }
}

function wire() {
  if (ui.public) ui.public.addEventListener("change", () => {
    const isPublic = Boolean(ui.public.value);
    if (ui.uploadFields) ui.uploadFields.hidden = isPublic;
    if (ui.planNote) ui.planNote.textContent = isPublic
      ? `${PUBLIC_DATASETS[ui.public.value]?.rationale ?? ""} The Worker verifies checksums before use.`
      : "Reviewing a plan is read-only and submits no job.";
  });
  ui.planButton?.addEventListener("click", plan);
  ui.approve?.addEventListener("click", approve);
  ui.refresh?.addEventListener("click", () => { setStatus("Refreshing the stored run state…"); refreshStatus(); });
  ui.resultButton?.addEventListener("click", loadResult);
  ui.assistant?.addEventListener("click", explain);
  ui.colorBy?.addEventListener("change", () => {
    if (state.result) renderPcoa(ui.pcoa, state.result.pcoa,
      state.result.input?.metadata_text ? parseMetadataRows(state.result.input.metadata_text) : [],
      { colorBy: ui.colorBy.value });
  });
  ui.rank?.addEventListener("change", async () => {
    if (!state.run?.run_id) return;
    try {
      const { body } = await json(`/api/ai/workflows/microbiome/result?run_id=${encodeURIComponent(state.run.run_id)}`);
      const recomputed = { ...body, composition: { ...(body.composition ?? {}), rank: ui.rank.value } };
      renderComposition(ui.composition, recomputed.composition, { rank: ui.rank.value });
      renderCompositionChart(ui.compositionChart, recomputed.composition);
    } catch (error) { showError(error); }
  });
}

if (HAS_DOM) {
  wire();
  reopenFromUrl();
}

if (typeof window !== "undefined") {
  window.__microbiome = { state, plan, approve, refreshStatus, loadResult, renderResult,
    exports: { renderTable, renderComposition, renderPcoa } };
}
