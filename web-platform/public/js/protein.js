// M7.13 website controller for real protein annotation.
// The browser never calls EBI/UniProt directly. It validates input locally for
// fast feedback, then uses the Worker routes. All scientific values displayed
// after a run come from the genuine response (or from server recovery).

import { renderProteinViewer, buildViewerModel } from "./protein-viewer.js";
import { captureProteinRun } from "./research-history.js";

const $ = (id) => document.getElementById(id);
const STANDARD = new Set("ACDEFGHIKLMNPQRSTVWY".split(""));
const AMBIGUOUS = new Set("BJZXUO".split(""));
const MAX_RECORDS = 20;
const MAX_LENGTH = 10000;
const MIN_LENGTH = 10;

let state = {
  mode: "single", fasta: "", filename: "", objective: "", validation: null,
  plan: null, body: null, viewer: null, runDetail: null, recovery: null, pollTimer: null, polls: 0
};

if (typeof window !== "undefined") {
  window.__protein = {
    validateProteinInput, buildViewerModel, getState: () => state,
    renderProteinViewer: (annotation) => renderProteinViewer($("protein-viewer"), annotation)
  };
}

function clean(value, max = 500) {
  return typeof value === "string" ? value.slice(0, max) : "";
}

function validateSequence(sequence, header = "") {
  const cleaned = String(sequence).replace(/\s+/g, "").toUpperCase();
  const counts = {};
  for (const residue of cleaned) counts[residue] = (counts[residue] ?? 0) + 1;
  const ambiguous = Object.entries(counts).filter(([residue]) => AMBIGUOUS.has(residue))
    .map(([residue, count]) => ({ residue, count }));
  const invalid = Object.keys(counts).filter((residue) => !STANDARD.has(residue) && !AMBIGUOUS.has(residue));
  const errors = [];
  if (!cleaned) errors.push("Sequence is empty.");
  if (cleaned.length < MIN_LENGTH) errors.push(`Sequence is shorter than ${MIN_LENGTH} residues.`);
  if (cleaned.length > MAX_LENGTH) errors.push(`Sequence exceeds ${MAX_LENGTH} residues.`);
  if (invalid.length) errors.push(`Unsupported characters: ${invalid.join(", ")}.`);
  const nucleic = [...cleaned].filter((residue) => "ACGTN".includes(residue)).length;
  if (cleaned.length >= 40 && nucleic / cleaned.length >= 0.95 && /^[ACGTRYN]+$/.test(cleaned)) {
    errors.push("This looks like a nucleotide sequence, not a protein. No translation is performed.");
  }
  if (/\b(?:dna|rna|nucleotide|cds|16s|18s|its[1-4]?)\b/i.test(header)) {
    errors.push("The header describes a nucleotide sequence; protein input is required.");
  }
  return { sequence: cleaned, length: cleaned.length, ambiguous, errors };
}

export function validateProteinInput(text, mode = "single") {
  if (mode === "accession") {
    const accession = String(text ?? "").trim().toUpperCase();
    return {
      valid: /^[A-Z0-9]{6,10}(?:-\d+)?$/.test(accession),
      records: accession ? [{ id: accession, length: null, ambiguous: [] }] : [],
      errors: accession ? [] : ["Enter a UniProt accession."], mode: "accession"
    };
  }
  const source = String(text ?? "").replace(/\r\n?/g, "\n").trim();
  if (!source) return { valid: false, records: [], errors: ["FASTA/sequence input is empty."], mode: "fasta" };
  const records = [];
  const errors = [];
  if (!source.startsWith(">")) {
    const check = validateSequence(source);
    if (mode !== "single") errors.push("Multi-FASTA mode requires '>' headers on every record.");
    errors.push(...check.errors);
    return { valid: errors.length === 0, records: errors.length ? [] : [{ id: "sequence_1", ...check }], errors, mode: "raw" };
  }
  let current = null;
  for (const line of source.split("\n")) {
    if (!line.trim()) continue;
    if (line.startsWith(">")) {
      if (current) records.push(current);
      current = { id: line.slice(1).trim().split(/\s+/)[0] || "", header: line.slice(1).trim(), sequence: "" };
    } else if (current) current.sequence += line.replace(/\s+/g, "");
    else errors.push("Sequence text appears before any '>' header.");
  }
  if (current) records.push(current);
  const ids = new Set();
  for (const record of records) {
    if (!record.id) errors.push("Empty FASTA identifier.");
    else if (ids.has(record.id)) errors.push(`Duplicate FASTA identifier: ${record.id}.`);
    ids.add(record.id);
    const check = validateSequence(record.sequence, record.header);
    Object.assign(record, check);
    errors.push(...check.errors.map((error) => `${record.id || "record"}: ${error}`));
  }
  if (!records.length) errors.push("No FASTA records were found.");
  if (records.length > MAX_RECORDS) errors.push(`At most ${MAX_RECORDS} records are accepted.`);
  if (mode === "single" && records.length > 1) errors.push("Single-protein mode accepts one record. Choose small multi-FASTA.");
  if (mode === "multi" && records.length === 1) errors.push("Multi-FASTA mode requires at least two records.");
  return { valid: errors.length === 0, records: errors.length ? [] : records, errors, mode: "fasta" };
}

function appendLine(list, text, className = "") {
  const item = document.createElement("li");
  item.textContent = text;
  if (className) item.className = className;
  list.append(item);
  return item;
}

function renderValidation(validation) {
  const box = $("protein-validation");
  box.replaceChildren();
  if (!validation) {
    box.textContent = "No input loaded yet.";
    $("protein-plan").disabled = true;
    return;
  }
  const summary = document.createElement("p");
  summary.textContent = `${validation.records.length} record(s). Server validation and MD5 are shown after the plan is inspected.`;
  box.append(summary);
  if (validation.errors.length) {
    const list = document.createElement("ul");
    for (const error of validation.errors) appendLine(list, error, "is-invalid");
    box.append(list);
  } else {
    const pass = document.createElement("p");
    pass.className = "is-valid";
    pass.textContent = "Local checks passed. The Worker re-validates before any provider call.";
    box.append(pass);
    for (const record of validation.records) {
      const line = document.createElement("p");
      line.textContent = `${record.id || "record"}: ${record.length ?? "accession"} residues; ambiguous residues ` +
        `${(record.ambiguous ?? []).map((item) => `${item.residue} ×${item.count}`).join(", ") || "none"}.`;
      box.append(line);
    }
  }
  $("protein-plan").disabled = !validation.valid;
  $("protein-annotate").disabled = true;
}

function syncMode() {
  state.mode = $("protein-mode").value === "accession" ? "accession" : $("protein-mode").value;
  $("protein-accession-group").hidden = state.mode !== "accession";
  $("protein-file-group").hidden = state.mode === "accession";
  $("protein-text-group").hidden = state.mode === "accession";
  syncInput();
}

function syncInput() {
  state.fasta = state.mode === "accession" ? $("protein-accession").value : $("protein-fasta-text").value;
  state.objective = $("protein-objective").value.trim();
  state.validation = validateProteinInput(state.fasta, state.mode);
  renderValidation(state.validation);
  $("protein-status").textContent = "";
}

$("protein-mode").addEventListener("change", syncMode);
$("protein-accession").addEventListener("input", syncInput);
$("protein-fasta-text").addEventListener("input", syncInput);
$("protein-objective").addEventListener("input", () => { state.objective = $("protein-objective").value.trim(); });
$("protein-file").addEventListener("change", async (event) => {
  const file = event.target.files?.[0];
  if (!file) return;
  const text = await file.text();
  $("protein-fasta-text").value = text;
  state.filename = file.name;
  syncInput();
  $("protein-status").textContent = `Loaded ${file.name}. Nothing has been sent to a provider.`;
});

function payload() {
  return {
    mode: state.mode === "accession" ? "accession" : "fasta",
    ...(state.mode === "accession" ? { accession: state.fasta.trim() }
      : { fasta_text: state.fasta, filename: state.filename || "protein.fasta" }),
    objective: state.objective
  };
}

async function fetchJson(url, options) {
  const response = await fetch(url, { headers: { Accept: "application/json" }, ...(options ?? {}) });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body?.error ?? `http_${response.status}`);
  return body;
}

$("protein-plan").addEventListener("click", async () => {
  state.fasta = state.mode === "accession" ? $("protein-accession").value : $("protein-fasta-text").value;
  state.validation = validateProteinInput(state.fasta, state.mode);
  renderValidation(state.validation);
  if (!state.validation.valid) {
    $("protein-status").textContent = "Fix the validation issues before inspecting the plan.";
    return;
  }
  $("protein-status").textContent = "Validating on the server (no annotation yet)…";
  try {
    const body = await fetchJson("/api/ai/workflows/protein/plan", {
      method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(payload())
    });
    state.plan = body;
    $("protein-route-fieldset").hidden = false;
    const availability = body?.plan?.route_availability ?? {};
    const routeB = document.querySelector('input[name="protein-route"][value="iprscan6"]');
    routeB.disabled = !availability.iprscan6?.available;
    $("protein-route-note").textContent = availability.iprscan6?.available
      ? "Route B is available: a server-side contact email is configured. One job is submitted per protein; refresh reuses the stored job id."
      : `Route B unavailable: ${availability.iprscan6?.reason ?? "no contact email configured"}. Route A remains available.`;
    $("protein-route-confirm-group").hidden = true;
    document.querySelector('input[name="protein-route"][value="precomputed"]').checked = true;
    $("protein-annotate").disabled = false;
    $("protein-status").textContent = `Plan ready. ${body.input.sequences.length} sequence(s); ` +
      `MD5 ${body.input.md5}. No annotation has run yet.`;
    renderValidatedFromPlan(body);
  } catch (error) {
    $("protein-status").textContent = `Plan unavailable: ${error.message}. Nothing was annotated.`;
  }
});

for (const input of document.querySelectorAll('input[name="protein-route"]')) {
  input.addEventListener("change", () => {
    const routeB = input.value === "iprscan6";
    $("protein-route-confirm-group").hidden = !routeB;
    $("protein-annotate").disabled = routeB && !$("protein-route-confirm").checked;
  });
}
$("protein-route-confirm").addEventListener("change", () => {
  $("protein-annotate").disabled = $("protein-route-confirm").checked === false;
});

function renderValidatedFromPlan(plan) {
  const table = $("protein-sequences").querySelector("tbody") ?? $("protein-sequences");
  table.replaceChildren();
  for (const sequence of plan?.input?.sequences ?? []) {
    const row = document.createElement("tr");
    for (const value of [sequence.id, sequence.length ?? "from UniProt", sequence.md5,
      (sequence.ambiguous ?? []).join(", ") || "none"]) {
      const cell = document.createElement("td");
      cell.textContent = String(value ?? "");
      row.append(cell);
    }
    table.append(row);
  }
}

function friendlyError(body, status) {
  if (body?.error_code === "route_b_unavailable_no_contact_email") {
    return "Executed analysis needs a server-side contact email; none is configured. No job was submitted.";
  }
  if (/nucleotide|alphabet|FASTA|accession/i.test(String(body?.error ?? ""))) {
    return "The input did not pass protein validation. Nothing was submitted.";
  }
  return `${body?.error ?? "the provider did not return evidence"} (HTTP ${status}). No result is claimed.`;
}

$("protein-annotate").addEventListener("click", async () => {
  const route = document.querySelector('input[name="protein-route"]:checked')?.value ?? "precomputed";
  $("protein-annotate").disabled = true;
  $("protein-progress").hidden = false;
  $("protein-job-list").replaceChildren();
  appendLine($("protein-job-list"), "Submitting the validated input. No evidence is claimed yet.");
  $("protein-status").textContent = "Annotating from genuine provider evidence…";
  let response;
  let body;
  try {
    response = await fetch("/api/ai/workflows/protein/annotate", {
      method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ ...payload(), route })
    });
    body = await response.json();
  } catch (error) {
    $("protein-status").textContent = `The annotation endpoint could not be reached (${error.message}). No job is claimed.`;
    $("protein-annotate").disabled = false;
    return;
  }
  state.body = body;
  // Only a genuine run id from the server is ever written to browser history.
  try { captureProteinRun(body, { objective: state.objective, sequence_ids: (state.validation?.records ?? []).map((item) => item.id) }); } catch { /* storage unavailable */ }
  if (body?.reopen?.ai_run_id) {
    try { state.runDetail = await fetchJson(`/api/ai/runs/${encodeURIComponent(body.reopen.ai_run_id)}`); } catch { state.runDetail = null; }
  }
  if (response.status === 202 && body?.status === "running") {
    renderProgress(body);
    await pollRunning(body);
    return;
  }
  if (!response.ok || body?.status === "failed") {
    $("protein-status").textContent = `Run ${body?.run_id ?? "unknown"}: ${friendlyError(body, response.status)}`;
    $("protein-evidence").hidden = false;
    renderEvidenceStatus(body);
    $("protein-annotate").disabled = false;
    return;
  }
  renderProgress(body);
  renderEvidence(body);
  $("protein-status").textContent = `Run ${body.run_id}: ${body.route_label}. Evidence and exports are ready.`;
  $("protein-annotate").disabled = false;
});

function renderProgress(body) {
  const list = $("protein-job-list");
  list.replaceChildren();
  for (const step of body?.provenance ?? []) {
    appendLine(list, `${step.step_id} — ${step.status} — ${step.tool_id ?? "no tool"}` +
      `${step.provider_job_id ? ` — provider job ${step.provider_job_id}` : ""}`);
  }
  if (!(body?.provenance ?? []).length) appendLine(list, "No step records were returned.");
}

async function pollRunning(initial) {
  const runId = initial.run_id;
  const maxPolls = Number(initial.max_polls ?? 24);
  const interval = Number(initial.poll_after_ms ?? 5000);
  state.polls = 0;
  $("protein-poll-note").textContent = `Executor job ${initial.provider_job_id}: polling at most ${maxPolls} times every ${interval} ms. No new job is submitted.`;
  const poll = async () => {
    state.polls += 1;
    try {
      const url = `/api/ai/workflows/protein/status?run_id=${encodeURIComponent(runId)}`;
      const response = await fetch(url, { headers: { Accept: "application/json" } });
      const status = await response.json();
      appendLine($("protein-job-list"), `poll ${state.polls}: ${status.state ?? status.status ?? "unknown"}`);
      if (!response.ok && response.status !== 409) throw new Error(status.error ?? `http_${response.status}`);
      if (status.status === "succeeded") {
        const body = await fetchJson(`/api/ai/workflows/protein/result?run_id=${encodeURIComponent(runId)}`);
        state.body = body;
        if (body?.reopen?.ai_run_id) {
          try { state.runDetail = await fetchJson(`/api/ai/runs/${encodeURIComponent(body.reopen.ai_run_id)}`); } catch { state.runDetail = null; }
        }
        renderProgress(body);
        renderEvidence(body);
        $("protein-status").textContent = `Run ${runId} finished: ${body.route_label}.`;
        $("protein-annotate").disabled = false;
        return;
      }
      if (status.status === "failed" || state.polls >= maxPolls) {
        $("protein-status").textContent = status.status === "failed"
          ? `Executor job failed: ${status.error ?? "no reason reported"}. No result was invented.`
          : `Polling stopped after ${maxPolls} checks while the job was ${status.state ?? "unknown"}. Reopen the stored run later; no new job was submitted.`;
        $("protein-annotate").disabled = false;
        return;
      }
      state.pollTimer = setTimeout(poll, interval);
    } catch (error) {
      $("protein-status").textContent = `Status check failed: ${error.message}. The stored job id ${initial.provider_job_id} was not invalidated.`;
      $("protein-annotate").disabled = false;
    }
  };
  state.pollTimer = setTimeout(poll, Math.min(interval, 1000));
}

function renderEvidenceStatus(body) {
  const status = $("protein-evidence-status");
  status.textContent = `Route label: ${body?.route_label ?? "not reported"}. Status: ${body?.status ?? "unknown"}. ` +
    `Provider job: ${body?.provider_job_id ?? "none for this route"}. ` +
    `Deduplicated: ${body?.deduped ? "yes (stored run)" : "no"}. ` +
    `InterPro release: ${body?.releases?.interpro_release ?? "null"} — ${body?.releases?.interpro_release_reason ?? ""}`;
}

function renderSequences(body) {
  const table = $("protein-sequences").querySelector("tbody") ?? $("protein-sequences");
  table.replaceChildren();
  for (const sequence of body?.input?.sequences ?? []) {
    const row = document.createElement("tr");
    for (const value of [sequence.id, sequence.length ?? "not reported", sequence.md5,
      (sequence.ambiguous ?? []).map((item) => `${item.residue}×${item.count}`).join(", ") || "none"]) {
      const cell = document.createElement("td");
      cell.textContent = String(value ?? "");
      row.append(cell);
    }
    table.append(row);
  }
}

function renderTable(body, onSelect) {
  const tbody = $("protein-annotations").querySelector("tbody") ?? $("protein-annotations");
  tbody.replaceChildren();
  let rows = 0;
  for (const protein of body?.proteins ?? []) {
    for (const feature of protein.annotation?.features ?? []) {
      for (const location of feature.locations) {
        const row = document.createElement("tr");
        const cells = [
          `${location.start ?? "?"}–${location.end ?? "?"}`,
          feature.category ?? feature.feature_type ?? "other",
          feature.signature.accession ?? "no accession",
          feature.source ?? "unknown",
          feature.entry?.accession ?? "not integrated",
          `${location.score ?? feature.score ?? "n/a"}${location.evalue !== null && location.evalue !== undefined ? ` / ${location.evalue}` : ""}`
        ];
        for (const value of cells) {
          const cell = document.createElement("td");
          cell.textContent = String(value);
          row.append(cell);
        }
        row.addEventListener("click", () => onSelect(feature, { protein }));
        tbody.append(row);
        rows += 1;
      }
    }
  }
  if (!rows) {
    const row = document.createElement("tr");
    const cell = document.createElement("td");
    cell.colSpan = 6;
    cell.textContent = "No source-reported features were returned. No row was synthesised.";
    row.append(cell);
    tbody.append(row);
  }
}

function renderDetail(feature, context = {}) {
  const panel = $("protein-detail");
  panel.replaceChildren();
  if (!feature) { panel.textContent = "Select a feature in the viewer or the table."; return; }
  const list = document.createElement("dl");
  const add = (key, value) => {
    const dt = document.createElement("dt");
    dt.textContent = key;
    const dd = document.createElement("dd");
    dd.textContent = value ?? "not reported";
    list.append(dt, dd);
  };
  add("Signature", feature.signature?.accession);
  add("Description", feature.signature?.description ?? feature.entry?.description);
  add("Source database", feature.source);
  add("Source release", feature.signature?.release
    ? `${feature.signature.release.library ?? "unknown"} ${feature.signature.release.version ?? "no version"}` : null);
  add("Category", `${feature.category ?? "other"}${feature.feature_type ? ` (source type: ${feature.feature_type})` : ""}`);
  add("Integrated entry", feature.entry
    ? `${feature.entry.accession} — ${feature.entry.name ?? feature.entry.description ?? "no description"}`
    : feature.entry_reason);
  add("Residue coordinates", (feature.locations ?? []).map((location) =>
    `${location.start ?? "?"}–${location.end ?? "?"}${location.fragments?.length ? ` (${location.fragments.length} fragment(s))` : ""}`).join("; "));
  add("Score / E-value", (feature.locations ?? []).map((location) =>
    `${location.score ?? feature.score ?? "n/a"} / ${location.evalue ?? feature.evalue ?? "n/a"}`).join("; "));
  add("GO terms (protein/entry)", (context.go_terms ?? []).map((term) =>
    `${term.identifier ?? "no identifier"} ${term.name ?? ""}`).join("; ") || "none reported for this selection");
  panel.append(list);
  const links = document.createElement("p");
  const entry = feature.entry?.accession
    ? `https://www.ebi.ac.uk/interpro/entry/InterPro/${encodeURIComponent(feature.entry.accession)}` : null;
  for (const [label, href] of [
    ["InterPro entry", entry],
    ["Matches evidence", context.md5 ? `https://www.ebi.ac.uk/interpro/matches/api/matches/${encodeURIComponent(context.md5)}` : null]
  ]) {
    if (!href) continue;
    const anchor = document.createElement("a");
    anchor.href = href;
    anchor.textContent = label;
    anchor.target = "_blank";
    anchor.rel = "noopener noreferrer";
    links.append(anchor, document.createTextNode(" "));
  }
  panel.append(links);
}

function renderInterpretation(body) {
  const protein = body?.proteins?.[0];
  const annotation = protein?.annotation;
  if (!annotation) {
    $("protein-interpretation").textContent = body?.error ?? "No evidence was returned; no interpretation is claimed.";
    return;
  }
  const parts = [];
  parts.push(`${body.route_label}: ${(body.proteins ?? []).length} protein(s), ` +
    `${annotation.features.length} match record(s), ${annotation.entries.length} integrated InterPro entry/entries.`);
  parts.push(`Coverage: ${annotation.coverage.covered_residues} of ${annotation.coverage.protein_length ?? "unknown"} residues ` +
    `(${annotation.coverage.fraction ?? "unknown"}); overlapping matches are retained separately.`);
  for (const [category, count] of Object.entries(annotation.counts ?? {})) parts.push(`${category}: ${count}.`);
  parts.push(`GO identifiers reported: ${(annotation.go.terms ?? []).filter((term) => term.identifier).length}. ` +
    `Pathway records: ${annotation.pathways.items.length}.`);
  parts.push(`Member database releases: ${Object.entries(body.releases?.member_databases ?? {}).map(([name, version]) => `${name} ${version}`).join(", ") || "none reported"}. ` +
    `${body.releases?.interpro_release_reason ?? ""}`);
  for (const reason of annotation.missing_field_reasons ?? []) parts.push(reason);
  parts.push("Database signatures are evidence, not proof of function. Independent experimental validation is required.");
  $("protein-interpretation").textContent = parts.join(" ");
}

function renderReport(body) {
  const host = $("protein-report");
  host.replaceChildren();
  for (const section of body?.report?.sections ?? []) {
    const article = document.createElement("section");
    const heading = document.createElement("h4");
    heading.textContent = section.title;
    const pre = document.createElement("pre");
    pre.textContent = section.body;
    article.append(heading, pre);
    host.append(article);
  }
  if (!(body?.report?.sections ?? []).length) {
    host.textContent = "No stored ten-section report is available; none was generated for this run.";
  }
}

async function sha256(text) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function renderDownloads(body) {
  const list = $("protein-downloads");
  list.replaceChildren();
  const checksums = $("protein-checksums");
  checksums.replaceChildren();
  const artifacts = Array.isArray(state.runDetail?.artifacts) ? state.runDetail.artifacts : [];
  const labels = {
    "input.fasta": "Original protein FASTA",
    "provider.json": "Structured provider JSON",
    "annotations.tsv": "Annotation TSV",
    "annotations.gff3": "GFF3 (source coordinates)",
    "report.txt": "Human-readable report",
    "summary.json": "Machine-readable summary",
    "annotation.json": "Parsed annotation JSON"
  };
  for (const artifact of artifacts) {
    const item = document.createElement("li");
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = labels[artifact.name] ?? artifact.name;
    button.addEventListener("click", async () => {
      try {
        if (typeof artifact.content !== "string") throw new Error("stored artifact content is unavailable");
        const computed = await sha256(artifact.content);
        const matches = computed === String(artifact.sha256 ?? "").toLowerCase();
        appendLine(checksums, `${artifact.name}: SHA-256 ${matches ? "MATCHES" : "DOES NOT MATCH"} stored checksum (${computed}).`,
          matches ? "is-valid" : "is-invalid");
        const url = URL.createObjectURL(new Blob([artifact.content], { type: artifact.mime || "text/plain;charset=utf-8" }));
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = artifact.name;
        anchor.click();
        URL.revokeObjectURL?.(url);
      } catch (error) {
        appendLine(checksums, `Download failed for ${artifact.name}: ${error.message}`, "is-invalid");
      }
    });
    item.append(button);
    list.append(item);
  }
  if (!artifacts.length) {
    appendLine(list, "No stored artifacts are available for this run.");
  }
}

function renderReopen(body) {
  const detail = $("protein-reopen-detail");
  detail.replaceChildren();
  detail.textContent = `Run ${body?.run_id ?? "unknown"}; plan ${body?.plan_id ?? "unknown"}. ` +
    "The browser-local index stores only this reference; evidence is re-read from the server record on reopen.";
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = "Re-read this analysis from the server recovery record";
  button.addEventListener("click", async () => {
    try {
      const recovery = await fetchJson(`/api/ai/runs/${encodeURIComponent(body.run_id)}/recovery`);
      state.recovery = recovery;
      const protein = recovery?.protein;
      if (protein?.proteins?.length) {
        renderEvidenceStatus({ route_label: protein.route_label, status: recovery.status,
          provider_job_id: protein.original_execution_state?.provider_job_id, releases: protein.releases });
        renderProteinViewerFromFeatures(protein.proteins[0]);
      }
      detail.textContent = `Server recovery read for ${recovery.run_id}: workflow ${recovery.workflow_type}, ` +
        `${protein?.proteins?.length ?? 0} protein(s). Evidence above was re-read from stored artifacts.`;
    } catch (error) {
      detail.textContent = `Server recovery failed: ${error.message}. No values were reconstructed.`;
    }
  });
  detail.append(document.createElement("br"), button);
  const historyLink = document.createElement("a");
  historyLink.href = "history.html";
  historyLink.textContent = "Open research history (protein filter)";
  detail.append(document.createElement("br"), historyLink);
}

function renderProteinViewerFromFeatures(protein) {
  const annotation = { protein_length: protein.length, features: protein.features ?? [] };
  state.viewer = renderProteinViewer($("protein-viewer"), annotation, {
    onSelect: (feature) => renderDetail(feature, { md5: protein.md5,
      go_terms: protein.go?.terms ?? [] })
  });
  $("protein-viewer-note").textContent = `Drawn from ${state.viewer.model.tracks.length} stored interval(s) ` +
    `across ${state.viewer.model.protein_length ?? "unknown"} residues. ` +
    `${state.viewer.model.skipped_features} feature(s) had no usable coordinates.`;
}

function renderEvidence(body) {
  $("protein-evidence").hidden = false;
  $("protein-ai-optin").hidden = false;
  $("protein-ai-status").textContent = "AI-generated phrasing: not requested. The deterministic interpretation above is always shown.";
  $("protein-ai-phrasing").hidden = true;
  renderEvidenceStatus(body);
  renderSequences(body);
  renderProteinViewerFromFeatures({
    length: body?.proteins?.[0]?.length ?? body?.proteins?.[0]?.annotation?.protein_length,
    md5: body?.proteins?.[0]?.md5,
    features: body?.proteins?.[0]?.annotation?.features ?? [],
    go: body?.proteins?.[0]?.annotation?.go
  });
  renderTable(body, (feature, context) => renderDetail(feature, {
    md5: context.protein?.md5, go_terms: context.protein?.annotation?.go?.terms ?? []
  }));
  renderDetail(null);
  renderInterpretation(body);
  renderReport(body);
  renderDownloads(body);
  renderReopen(body);
  $("protein-provenance").textContent = JSON.stringify(body.provenance ?? [], null, 2);
}

// Opt-in only, after a genuine result. The message carries deterministic
// annotation context only: no FASTA, no sequence, no run id and no invented
// claims. Any provider failure is shown as a status, not a console error.
$("protein-ai-optin").addEventListener("click", async () => {
  const body = state.body;
  if (!body) return;
  const annotation = body.proteins?.[0]?.annotation;
  if (!annotation) return;
  const button = $("protein-ai-optin");
  button.disabled = true;
  const facts = {
    route_label: body.route_label, counts: annotation.counts, coverage: annotation.coverage,
    entries: (annotation.entries ?? []).map((entry) => ({ accession: entry.accession, name: entry.name })),
    go_identifiers: (annotation.go?.terms ?? []).map((term) => term.identifier).filter(Boolean),
    member_databases: body.releases?.member_databases ?? {}
  };
  $("protein-ai-status").textContent = "Requesting optional AI-generated phrasing through S Bio Assistant…";
  try {
    const response = await fetch("/api/assistant/chat", {
      method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        message: "Rephrase only this deterministic protein annotation context in plain language. " +
          "Do not add, estimate or invent any accession, GO term, score, citation or biological claim. " +
          "Say when the evidence is insufficient: " + JSON.stringify(facts),
        stream: false
      })
    });
    if (!response.ok) throw new Error(`assistant_http_${response.status}`);
    const result = await response.json();
    if (!result?.reply) throw new Error("no_reply");
    $("protein-ai-status").textContent = "AI-generated phrasing — unverified, not scientific evidence:";
    $("protein-ai-phrasing").textContent = result.reply;
    $("protein-ai-phrasing").hidden = false;
  } catch (error) {
    $("protein-ai-status").textContent = `AI phrasing unavailable (${error.message}). The deterministic interpretation and evidence above remain the record.`;
  } finally {
    button.disabled = false;
  }
});

syncMode();
