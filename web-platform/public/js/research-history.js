// M7.12 browser-local research history index and recovery view.
//
// localStorage holds ONLY a small metadata index: genuine run ids, workflow
// type, short title, first-token sequence identifiers and timestamps. No API
// key, token, raw sequence, alignment or tree text is ever stored here. The
// analysis itself and the original artifact content come from the read-only
// server-side AI-run record, fetched again on every reopen.

import { renderTree } from "./phylo-tree-view.js";

export const STORAGE_KEY = "sbio.research-history.v1";
export const HONEST_LABEL = "Browser-local research history — this index lives in this browser and is not cross-device owner-account sync. The actual analysis and original files remain retrievable from the server-side AI-run record.";

const RUN_ID_RE = /^(job|run)_[0-9a-f]{16}$/;
const AI_RUN_ID_RE = /^job_[0-9a-f]{16}$/;
const SAFE_ID_RE = /^[A-Za-z0-9._-]+$/;
const STATUSES = new Set(["completed", "running", "failed", "unknown", "awaiting_user_action"]);

const $ = (id) => document.getElementById(id);

function cleanText(value, max = 200) {
  return typeof value === "string" ? value.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, max) : "";
}

function safeId(value) {
  const text = cleanText(value, 200);
  return SAFE_ID_RE.test(text) ? text : null;
}

function sequenceIds(values) {
  if (!Array.isArray(values)) return [];
  const seen = new Set();
  const out = [];
  for (const value of values) {
    const token = cleanText(value, 120).split(/\s+/)[0];
    if (!token || seen.has(token)) continue;
    seen.add(token);
    out.push(token);
    if (out.length >= 25) break;
  }
  return out;
}

function storageOrNull(storage) {
  if (storage) return storage;
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

// Only the allow-listed fields below survive. Anything else in a stored entry
// (including a pasted sequence, token or key) is discarded on load.
export function sanitizeEntry(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const runId = safeId(raw.run_id);
  if (!runId || !RUN_ID_RE.test(runId)) return null;
  const workflowType = ["phylo", "16s", "unknown"].includes(raw.workflow_type) ? raw.workflow_type : "unknown";
  const status = STATUSES.has(raw.status) ? raw.status : "unknown";
  const resumeRaw = raw.resume && typeof raw.resume === "object" && !Array.isArray(raw.resume) ? raw.resume : {};
  return {
    run_id: runId,
    workflow_type: workflowType,
    status,
    title: cleanText(raw.title, 200) || `${workflowType} run ${runId}`,
    sequence_ids: sequenceIds(raw.sequence_ids),
    created_at: cleanText(raw.created_at, 40) || null,
    completed_at: cleanText(raw.completed_at, 40) || null,
    history_id: safeId(raw.history_id),
    plan_id: safeId(raw.plan_id),
    workspace_run_id: safeId(raw.workspace_run_id),
    provider_job_ids: sequenceIds(raw.provider_job_ids),
    resume: {
      provider_job_id: safeId(resumeRaw.provider_job_id),
      iqtree_provider_job_id: safeId(resumeRaw.iqtree_provider_job_id),
      history_id: safeId(resumeRaw.history_id)
    }
  };
}

export function readIndex(storage = storageOrNull()) {
  const store = storageOrNull(storage);
  try {
    const raw = store?.getItem(STORAGE_KEY);
    if (!raw) return { entries: [], error: null };
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return { entries: [], error: "The browser-local history index is not a list. Nothing was loaded." };
    }
    const entries = parsed.map(sanitizeEntry).filter(Boolean);
    return { entries, error: entries.length === parsed.length ? null
      : "Some stored history entries were malformed and were ignored; no values were guessed." };
  } catch (error) {
    return { entries: [], error: `The browser-local history index could not be read: ${error?.message ?? error}` };
  }
}

export function loadIndex(storage) {
  return readIndex(storage).entries;
}

export function saveIndex(entries, storage = storageOrNull()) {
  const store = storageOrNull(storage);
  if (!store) return false;
  try {
    store.setItem(STORAGE_KEY, JSON.stringify(entries.map(sanitizeEntry).filter(Boolean)));
    return true;
  } catch {
    return false;
  }
}

export function upsertEntry(entry, storage = storageOrNull()) {
  const clean = sanitizeEntry(entry);
  if (!clean) return null;
  const entries = loadIndex(storage);
  const index = entries.findIndex((item) => item.run_id === clean.run_id);
  if (index >= 0) entries[index] = { ...entries[index], ...clean };
  else entries.unshift(clean);
  return saveIndex(entries, storage) ? clean : null;
}

export function removeEntry(runId, storage = storageOrNull()) {
  const clean = safeId(runId);
  if (!clean) return false;
  const entries = loadIndex(storage).filter((item) => item.run_id !== clean);
  return saveIndex(entries, storage);
}

export function listEntries(entries, filter = "all") {
  const source = Array.isArray(entries) ? entries.map(sanitizeEntry).filter(Boolean) : [];
  const sorted = source.sort((a, b) => String(b.created_at ?? "").localeCompare(String(a.created_at ?? "")));
  switch (filter) {
    case "16s": return sorted.filter((item) => item.workflow_type === "16s");
    case "phylo": return sorted.filter((item) => item.workflow_type === "phylo");
    case "running": return sorted.filter((item) => item.status === "running");
    case "failed": return sorted.filter((item) => item.status === "failed");
    case "completed": return sorted.filter((item) => item.status === "completed");
    default: return sorted;
  }
}

function titleFor(prefix, objective, ids, runId) {
  const detail = cleanText(objective, 160) || (ids.length
    ? `${ids.slice(0, 3).join(", ")}${ids.length > 3 ? " …" : ""}` : `run ${runId}`);
  return `${prefix} — ${detail}`.slice(0, 200);
}

// Called by phylo.js only AFTER a run response has actually arrived. Providers
// job ids are copied verbatim; FASTA/tree text is never copied into the index.
export function capturePhyloRun(body, options = {}, storage = storageOrNull()) {
  const runId = [body?.reopen?.ai_run_id, body?.run_id].find((value) => AI_RUN_ID_RE.test(value));
  if (!runId) return null; // no genuine AI run id: skip honestly
  const ids = sequenceIds(options.sequence_ids);
  const validationStatus = body?.validation?.status;
  const passed = validationStatus === "pass" || validationStatus === "pass_with_warnings";
  let status = "running";
  if (body?.workflow_completed === true && passed) status = "completed";
  else if (body?.workflow_completed === false || body?.error === true
    || validationStatus === "fail" || validationStatus === "failed") status = "failed";
  const providerJobIds = sequenceIds(Object.values(body?.job_ids ?? {}));
  const now = new Date().toISOString();
  return upsertEntry({
    run_id: runId,
    workflow_type: "phylo",
    status,
    title: titleFor("Phylogenetics", options.objective, ids, runId),
    sequence_ids: ids,
    created_at: now,
    completed_at: status === "completed" ? now : null,
    history_id: safeId(body?.history_id ?? body?.resume?.history_id),
    plan_id: safeId(body?.plan_id),
    workspace_run_id: safeId(body?.reopen?.workspace_run_id),
    provider_job_ids: providerJobIds,
    resume: {
      provider_job_id: safeId(body?.resume?.provider_job_id),
      iqtree_provider_job_id: safeId(body?.resume_iqtree?.provider_job_id),
      history_id: safeId(body?.history_id ?? body?.resume?.history_id)
    }
  }, storage);
}

// 16S runs get their genuine AI run id from the plan-approval response. If that
// response contains no job_ id, nothing is written — no id is invented.
export function capture16sRun(data, options = {}, storage = storageOrNull()) {
  const jobIds = Array.isArray(data?.job_ids) ? data.job_ids : [];
  const runId = jobIds.find((value) => AI_RUN_ID_RE.test(value));
  if (!runId) return null;
  const ids = sequenceIds(options.sequence_ids);
  const now = new Date().toISOString();
  return upsertEntry({
    run_id: runId,
    workflow_type: "16s",
    // Approval issued the job; submission/result state is not known here.
    status: "awaiting_user_action",
    title: titleFor("16S identification", options.objective, ids, runId),
    sequence_ids: ids,
    created_at: now,
    completed_at: null,
    history_id: safeId(data?.history_id),
    plan_id: safeId(options.plan_id ?? data?.plan_id),
    provider_job_ids: jobIds.filter((value) => SAFE_ID_RE.test(String(value))).slice(0, 25),
    resume: { provider_job_id: null, iqtree_provider_job_id: null, history_id: safeId(data?.history_id) }
  }, storage);
}

export function classifyJobStatus(raw) {
  const value = String(raw ?? "").toLowerCase();
  if (/await|action_required|needs_(action|input)/.test(value)) return "Awaiting user action";
  if (/succeed|success|complete|\bok\b/.test(value)) return "Completed";
  if (/fail|error|cancel|denied/.test(value)) return "Failed";
  if (/queue|running|process|pending|upload|download/.test(value)) return "Running";
  return "Unknown";
}

async function fetchJson(url) {
  const response = await fetch(url, { headers: { Accept: "application/json" } });
  if (!response.ok) throw new Error(`http_${response.status} for ${url}`);
  return response.json();
}

async function sha256(text) {
  if (!globalThis.crypto?.subtle) throw new Error("Web Crypto SHA-256 is unavailable in this browser");
  const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(String(text)));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function initResearchHistory() {
  const list = $("history-list");
  if (!list) return null;
  const ui = {
    list,
    empty: $("history-empty"),
    error: $("history-error"),
    detail: $("history-detail"),
    detailEmpty: $("history-detail-empty"),
    status: $("history-recovery-status"),
    jobs: $("history-jobs"),
    artifacts: $("history-artifacts"),
    validation: $("history-validation"),
    provenance: $("history-provenance"),
    alignment: $("history-alignment"),
    tree: $("history-tree"),
    treeNote: $("history-tree-note"),
    reportLink: $("history-report-link"),
    reportExcerpt: $("history-report-excerpt"),
    startingTrees: $("history-starting-trees"),
    downloads: $("history-downloads"),
    checksums: $("history-checksums"),
    provider: $("history-provider"),
    continuation: $("history-continuation")
  };
  let entries = [];
  let filter = "all";
  let treeView = null;
  let objectUrls = [];
  let currentRunId = null;

  const setError = (message) => {
    if (!ui.error) return;
    ui.error.hidden = !message;
    ui.error.textContent = message ? `Error: ${message}` : "";
  };
  const text = (node, value) => { if (node) node.textContent = value ?? ""; };
  const appendLine = (node, message, className = "") => {
    if (!node) return;
    const item = document.createElement("li");
    item.textContent = message;
    if (className) item.className = className;
    node.append(item);
    return item;
  };

  function resetObjectUrls() {
    for (const url of objectUrls) URL.revokeObjectURL?.(url);
    objectUrls = [];
  }

  function renderList() {
    const shown = listEntries(entries, filter);
    ui.list.replaceChildren();
    if (!shown.length) {
      text(ui.empty, "No research history entries match this filter. Analyses appear here only after a genuine run id is returned by a workflow.");
      ui.empty.hidden = false;
      return;
    }
    ui.empty.hidden = true;
    for (const entry of shown) {
      const item = document.createElement("li");
      item.className = "history-item";
      const open = document.createElement("button");
      open.type = "button";
      open.className = "history-entry";
      open.dataset.runId = entry.run_id;
      open.setAttribute("aria-label", `Open recovery view for ${entry.title}`);
      const heading = document.createElement("strong");
      heading.textContent = entry.title;
      const meta = document.createElement("span");
      meta.className = "history-entry-meta";
      meta.textContent = `${entry.workflow_type} · ${entry.status} · run ${entry.run_id}${entry.created_at ? ` · captured ${entry.created_at}` : ""}`;
      const ids = document.createElement("span");
      ids.className = "history-entry-ids";
      ids.textContent = entry.sequence_ids.length ? `Identifiers: ${entry.sequence_ids.join(", ")}` : "No sequence identifiers recorded";
      open.append(heading, meta, ids);
      open.addEventListener("click", () => openEntry(entry));
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "history-remove";
      remove.dataset.action = "remove";
      remove.dataset.runId = entry.run_id;
      remove.setAttribute("aria-label", `Remove ${entry.title} from this browser's index`);
      remove.textContent = "Remove";
      remove.addEventListener("click", () => {
        if (!window.confirm(`Remove ${entry.title} from this browser's research history index? The server-side run record is not deleted.`)) return;
        if (!removeEntry(entry.run_id)) {
          setError("The browser-local index could not be updated. Check that browser storage is enabled.");
          return;
        }
        entries = loadIndex();
        if (currentRunId === entry.run_id) {
          currentRunId = null;
          ui.detail.hidden = true;
          if (ui.detailEmpty) ui.detailEmpty.hidden = false;
        }
        renderList();
      });
      item.append(open, remove);
      ui.list.append(item);
    }
  }

  function renderDownloads({ recovery, entry }) {
    if (!ui.downloads) return;
    ui.downloads.replaceChildren();
    text(ui.checksums, "");
    const artifacts = Array.isArray(recovery?.artifacts) ? recovery.artifacts : [];
    const phylo = recovery?.phylo ?? {};
    const byName = (name) => artifacts.find((artifact) => artifact?.name === name) ?? null;

    const addDownload = (label, filename, mime, contentGetter, artifactName) => {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = label;
      button.addEventListener("click", async () => {
        try {
          const content = await contentGetter();
          if (typeof content !== "string") throw new Error("original artifact content is unavailable");
          const stored = artifactName ? byName(artifactName) : null;
          let comparison = "No stored checksum available for this file.";
          if (stored?.sha256 && /^[0-9a-f]{64}$/i.test(stored.sha256)) {
            const computed = await sha256(content);
            const matches = computed === stored.sha256.toLowerCase();
            comparison = `SHA-256 ${matches ? "MATCHES" : "DOES NOT MATCH"} the stored artifact checksum. computed ${computed}; stored ${stored.sha256}.`;
          } else if (artifactName) {
            comparison = "The stored artifact has no usable sha256; no checksum comparison is possible.";
          }
          appendLine(ui.checksums, `${filename}: ${comparison}`, comparison.includes("DOES NOT") ? "is-invalid" : "is-valid");
          const url = URL.createObjectURL(new Blob([content], { type: mime }));
          objectUrls.push(url);
          const anchor = document.createElement("a");
          anchor.href = url;
          anchor.download = filename;
          anchor.click();
        } catch (error) {
          setError(`Download failed for ${label}: ${error?.message ?? error}`);
        }
      });
      const item = document.createElement("li");
      item.append(button);
      ui.downloads.append(item);
    };

    const treeArtifact = phylo.tree_artifact ? byName(phylo.tree_artifact.name) : null;
    addDownload("Download original Newick (.nwk)", "recovered-tree.nwk", "text/plain;charset=utf-8",
      () => treeArtifact?.content ?? phylo.tree_newick ?? null, treeArtifact?.name ?? null);
    const alignmentArtifact = phylo.alignment_artifact ? byName(phylo.alignment_artifact.name) : null;
    addDownload("Download original alignment FASTA", "recovered-alignment.fasta", "text/plain;charset=utf-8",
      () => alignmentArtifact?.content ?? phylo.alignment_text ?? null, alignmentArtifact?.name ?? null);

    const storedAnalysis = artifacts.find((artifact) => String(artifact?.name ?? "").toLowerCase() === "analysis.json");
    addDownload("Download analysis JSON", "recovered-analysis.json", "application/json;charset=utf-8",
      () => storedAnalysis?.content ?? JSON.stringify({
        run_id: recovery?.run_id ?? entry.run_id,
        evidence_only: true,
        note: "Derived from the stored AI-run recovery record; no stored analysis.json artifact was present.",
        workflow_type: recovery?.workflow_type ?? entry.workflow_type,
        status: recovery?.status ?? null,
        validation: recovery?.validation ?? null,
        metrics: recovery?.phylo?.metrics ?? null
      }, null, 2), storedAnalysis?.name ?? null);

    const svgItem = document.createElement("li");
    const svgButton = document.createElement("button");
    svgButton.type = "button";
    svgButton.textContent = "Export SVG (generated from restored tree)";
    svgButton.disabled = !treeView?.svg;
    svgButton.addEventListener("click", () => {
      try {
        treeView?.exportSvg("recovered-tree.svg");
        appendLine(ui.checksums, "recovered-tree.svg: generated from the restored tree; no stored checksum to compare.");
      } catch (error) {
        setError(`SVG export failed: ${error?.message ?? error}`);
      }
    });
    svgItem.append(svgButton);
    ui.downloads.append(svgItem);
  }

  function renderProviderSection(recovery, entry) {
    if (!ui.provider) return;
    ui.provider.replaceChildren();
    const ids = [];
    const push = (value) => {
      const id = safeId(value);
      if (id && !ids.includes(id)) ids.push(id);
    };
    for (const job of recovery?.jobs ?? []) push(job?.provider_job_id);
    for (const id of entry.provider_job_ids ?? []) push(id);
    if (!ids.length) return;
    const heading = document.createElement("h3");
    heading.textContent = "Recorded provider job ids (read-only)";
    const listNode = document.createElement("ul");
    listNode.className = "data-list";
    for (const id of ids) appendLine(listNode, id);
    const refresh = document.createElement("button");
    refresh.type = "button";
    refresh.textContent = "Refresh provider job state (read-only)";
    refresh.addEventListener("click", async () => {
      try {
        ui.provider.replaceChildren(heading, listNode, refresh);
        for (const id of ids) {
          const status = await fetchJson(`/api/providers/jobs/${encodeURIComponent(id)}`);
          const raw = status?.status ?? status?.state ?? status?.job?.status ?? null;
          appendLine(listNode, `${id}: reported state ${raw ?? "not reported"} — ${classifyJobStatus(raw)}`);
        }
      } catch (error) {
        setError(`Provider status query failed: ${error?.message ?? error}`);
      }
    });
    ui.provider.append(heading, listNode, refresh);
  }

  function renderContinuation(recovery, entry) {
    if (!ui.continuation) return;
    ui.continuation.replaceChildren();
    if (entry.workflow_type !== "phylo" || entry.status === "completed") return;
    const params = new URLSearchParams();
    const providerJobId = safeId(recovery?.jobs?.find((job) => job?.provider_job_id)?.provider_job_id
      ?? entry.resume?.provider_job_id);
    const iqtreeJobId = safeId(entry.resume?.iqtree_provider_job_id);
    const historyId = safeId(recovery?.jobs?.find((job) => job?.history_id)?.history_id
      ?? entry.history_id ?? entry.resume?.history_id);
    if (providerJobId) params.set("resume_provider_job_id", providerJobId);
    if (iqtreeJobId) params.set("resume_iqtree_provider_job_id", iqtreeJobId);
    if (historyId) params.set("history_id", historyId);
    const link = document.createElement("a");
    link.href = params.size ? `phylo.html?${params.toString()}` : "phylo.html";
    link.textContent = "Open the existing phylo resume flow (review the plan and approval gate; no stage is resubmitted automatically)";
    const note = document.createElement("p");
    note.className = "panel-note";
    note.textContent = "This recovery view never launches a job. Already-completed stages keep their original provider job ids above.";
    ui.continuation.append(note, link);
  }

  async function openEntry(entry) {
    const clean = sanitizeEntry(entry);
    if (!clean) {
      setError("This history entry is malformed. Nothing was opened.");
      return;
    }
    currentRunId = clean.run_id;
    ui.detail.hidden = false;
    if (ui.detailEmpty) ui.detailEmpty.hidden = true;
    text(ui.status, `Opening run ${clean.run_id} from the stored AI-run record…`);
    setError("");
    resetObjectUrls();
    treeView = null;
    for (const node of [ui.jobs, ui.artifacts, ui.checksums, ui.downloads, ui.provider, ui.continuation, ui.startingTrees]) {
      if (node) node.replaceChildren();
    }
    text(ui.provenance, "");
    text(ui.alignment, "");
    text(ui.tree, "");
    text(ui.treeNote, "");
    text(ui.reportExcerpt, "");
    if (ui.reportLink) { ui.reportLink.removeAttribute("href"); ui.reportLink.hidden = true; }

    const runUrl = `/api/ai/runs/${encodeURIComponent(clean.run_id)}`;
    const recoveryUrl = `${runUrl}/recovery`;
    const [detailResult, recoveryResult] = await Promise.allSettled([fetchJson(runUrl), fetchJson(recoveryUrl)]);
    const detail = detailResult.status === "fulfilled" ? detailResult.value : null;
    const recovery = recoveryResult.status === "fulfilled" ? recoveryResult.value : null;
    const failures = [];
    if (detailResult.status === "rejected") failures.push(`run detail: ${detailResult.reason?.message ?? detailResult.reason}`);
    if (recoveryResult.status === "rejected") failures.push(`recovery: ${recoveryResult.reason?.message ?? recoveryResult.reason}`);
    if (failures.length) setError(`The stored record could not be read (${failures.join("; ")}). No values were invented.`);
    if (!detail && !recovery) {
      text(ui.status, `Run ${clean.run_id} is unavailable from the server. It may have been deleted; no recovered content is shown.`);
      return;
    }

    const statusValue = recovery?.status ?? "unknown";
    text(ui.status, `Run ${recovery?.run_id ?? detail?.run_id ?? clean.run_id} · workflow ${recovery?.workflow_type ?? clean.workflow_type} · recorded status ${statusValue} · execution ${recovery?.execution_mode ?? detail?.execution_mode ?? "unknown"}${recovery?.created_at ? ` · created ${recovery.created_at}` : ""}${recovery?.finished_at ? ` · finished ${recovery.finished_at}` : ""}`);

    const jobs = Array.isArray(recovery?.jobs) && recovery.jobs.length ? recovery.jobs : (Array.isArray(detail?.jobs) ? detail.jobs : []);
    for (const job of jobs) {
      appendLine(ui.jobs, `${job?.id ?? "unknown job"} — step ${job?.step_id ?? "unknown"} — state ${job?.status ?? "unknown"}${job?.provider_job_id ? ` — provider job ${job.provider_job_id}` : ""}${job?.finished_at ? ` — finished ${job.finished_at}` : ""}`);
    }
    if (!jobs.length) appendLine(ui.jobs, "No job records were returned by the stored run.");

    for (const artifact of recovery?.artifacts ?? detail?.artifacts ?? []) {
      const checksum = artifact?.checksum_match === true ? "checksum matches" : artifact?.checksum_match === false ? "checksum MISMATCH" : "no checksum comparison";
      appendLine(ui.artifacts, `${artifact?.name ?? "unnamed artifact"} — ${artifact?.derived_kind ?? artifact?.kind ?? "unclassified"} — ${artifact?.bytes ?? "unknown"} B — sha256 ${artifact?.sha256 ?? "not stored"} — ${checksum}`);
    }
    if (!(recovery?.artifacts ?? detail?.artifacts ?? []).length) appendLine(ui.artifacts, "No artifacts are present in the stored run.");

    const validation = recovery?.validation ?? detail?.validation ?? null;
    text(ui.validation, validation
      ? `Stored validation: ${validation.status ?? "status not recorded"}. ${(validation.warnings ?? []).join("; ")}`.trim()
      : `No stored validation is claimed. ${recovery?.validation_reason ?? "The run record has no validation_json."} ${recovery?.phylo?.metrics?.basis ? `Metrics basis: ${recovery.phylo.metrics.basis}.` : ""}`);
    text(ui.provenance, JSON.stringify(recovery?.provenance ?? detail?.provenance ?? null, null, 2)
      ?? "No provenance was returned by the stored run.");

    const phylo = recovery?.phylo ?? {};
    if (phylo.alignment_text) {
      const pre = document.createElement("pre");
      pre.textContent = phylo.alignment_text;
      ui.alignment.replaceChildren(pre);
    } else {
      text(ui.alignment, "No alignment artifact is available in the stored run. Nothing is reconstructed.");
    }
    if (phylo.tree_newick) {
      try {
        treeView = renderTree(phylo.tree_newick, ui.tree, { metrics: phylo.metrics });
        text(ui.treeNote, `Displayed tree source: ${phylo.tree_source ?? "not reported"}. No new tree was inferred.`);
      } catch (error) {
        text(ui.tree, `The stored tree could not be rendered: ${error?.message ?? error}`);
      }
    } else {
      text(ui.tree, "No final tree is available in the stored run. No tree is drawn.");
      text(ui.treeNote, phylo.metrics?.basis ? `Metrics basis: ${phylo.metrics.basis}.` : "");
    }
    if (phylo.iqtree_report && ui.reportLink) {
      try {
        const url = URL.createObjectURL(new Blob([phylo.iqtree_report], { type: "text/plain;charset=utf-8" }));
        objectUrls.push(url);
        ui.reportLink.href = url;
        ui.reportLink.download = "recovered-iqtree-report.iqtree";
        ui.reportLink.hidden = false;
      } catch (error) {
        setError(`The original IQ-TREE report link could not be created: ${error?.message ?? error}`);
      }
    }
    text(ui.reportExcerpt, phylo.iqtree_report_excerpt ?? "No IQ-TREE report excerpt is available from the stored run.");
    for (const tree of phylo.starting_trees ?? []) {
      appendLine(ui.startingTrees, `${tree.name ?? "unnamed tree"} — ${tree.source_role ?? "starting_tree_not_displayed"}${tree.reason ? ` — ${tree.reason}` : ""}`);
    }
    renderDownloads({ recovery, entry: clean });
    renderProviderSection(recovery, clean);
    renderContinuation(recovery, clean);
  }

  for (const button of document.querySelectorAll("[data-history-filter]")) {
    button.addEventListener("click", () => {
      filter = button.dataset.historyFilter || "all";
      for (const other of document.querySelectorAll("[data-history-filter]")) {
        other.setAttribute("aria-pressed", String(other === button));
      }
      renderList();
    });
  }

  const initial = readIndex();
  entries = initial.entries;
  if (initial.error) setError(initial.error);
  renderList();

  return { renderList, openEntry, listEntries, getEntries: () => entries };
}

if (typeof window !== "undefined") {
  window.__researchHistory = {
    STORAGE_KEY, HONEST_LABEL, sanitizeEntry, readIndex, loadIndex, saveIndex,
    upsertEntry, removeEntry, listEntries, capturePhyloRun, capture16sRun, classifyJobStatus
  };
  initResearchHistory();
}
