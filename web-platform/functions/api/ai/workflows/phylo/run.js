// POST /api/ai/workflows/phylo/run — M7.11 real multi-step Galaxy workflow.
//
// Upload FASTA -> validate -> MAFFT (MSA) -> IQ-TREE (tree) -> retrieve ->
// validate alignment/tree -> persist provenance/jobs in D1. No provider key is
// read from or returned to the browser: the Galaxy adapter reads it from env
// (a Worker secret) internally. Tool ids and versions always come from live
// discovery; this file never hardcodes them as the source of truth.
//
// All external calls in tests are stubbed through the injected fetchImpl and a
// stubbed global fetch. No test starts a live Galaxy or NCBI job.

import {
  SQL,
  audit,
  envExecutionMode,
  errorResponse,
  getDb,
  hashInput,
  insertRow,
  jsonResponse,
  makeId,
  nowIso,
  readJsonBody,
  requireMethod,
  sanitizeFilename,
  safeString
} from "../../_lib.js";
import { createAdapter } from "../../../../../providers/galaxy/index.js";
import { findPhyloTools } from "../../../../../providers/galaxy/galaxy_phylo.js";
import { fetchToolSchema, buildSchemaPayload } from "../../../../../providers/galaxy/galaxy_schema.js";
import { classifyJobState } from "../../../../../providers/galaxy/galaxy_ids.js";
import { deriveOwner } from "../../../workspace/_lib.js";
import { validateAlignment, validateInputFasta, validateTree, parseNewick } from "./validators.js";

const STEP_IDS = Object.freeze([
  "upload_input", "galaxy_mafft", "galaxy_iqtree", "retrieve_outputs",
  "validate_alignment", "validate_tree", "generate_report"
]);
const ALIGNMENT_EXTS = new Set(["fasta", "fa", "fna", "fas", "aln", "msa", "clustal", "phylip", "phy", "afasta"]);
const TREE_EXTS = new Set(["nwk", "newick", "tree", "treefile", "contree", "ufboot", "nhx"]);
const REPORT_EXTS = new Set(["iqtree", "iqtree2", "log", "txt", "html", "json"]);

function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

export function classifyPhyloArtifact(artifact = {}) {
  const name = String(artifact.name ?? "").trim();
  const declared = String(artifact.type ?? artifact.extension ?? artifact.file_ext ?? "").trim().replace(/^\./, "").toLowerCase();
  const fromName = name.includes(".") ? name.slice(name.lastIndexOf(".") + 1).toLowerCase() : "";
  const ext = declared || fromName;
  const lowered = name.toLowerCase();
  // Extension is authoritative; the name only resolves ambiguous text outputs.
  if (TREE_EXTS.has(ext) || /\.(nwk|newick|treefile|contree)$/.test(lowered)
    || (!ALIGNMENT_EXTS.has(ext) && /(^|[\s_.-])(treefile|newick|contree)([\s_.-]|$)/i.test(name))) {
    return { kind: "tree", reason: `extension:${ext || "name"}` };
  }
  if (ALIGNMENT_EXTS.has(ext) || /alignment|aligned|\bmsa\b/.test(lowered) && !ext) return { kind: "alignment", reason: `extension:${ext || "name"}` };
  if (ext === "iqtree" || /\biqtree\b/i.test(name) && !TREE_EXTS.has(ext)) return { kind: "report", reason: `name:${ext || "iqtree"}` };
  if (ext === "log" || /\blog\b/i.test(name)) return { kind: "log", reason: `name:${ext || "log"}` };
  if (REPORT_EXTS.has(ext) && /report|summary|stats/i.test(name)) return { kind: "report", reason: `name:${ext}` };
  return { kind: "other", reason: "unclassified" };
}

// Pure, evidence-only parser for a GENUINE IQ-TREE report file. Every value
// returned comes from the supplied text; absent fields stay null, never guessed.
export function parseIqtreeReport(text) {
  // Galaxy text datasets are commonly CRLF: normalize at the entry so every
  // line-anchored pattern below works identically on CRLF and LF reports.
  const source = String(text ?? "").replace(/\r\n?/g, "\n");
  const empty = { model: null, log_likelihood: null, support: null, support_settings: [],
    final_tree: null, rooting_note: null, available: false };
  if (!source.trim()) return empty;
  const capture = (pattern) => {
    const match = source.match(pattern);
    return match ? match[1].trim() : null;
  };
  // Prefer the real "Best-fit model according to AIC/BIC:" line, then a plain
  // "Model:" line. Anchoring to the line start prevents a citation/author line
  // that merely mentions a model from ever being captured.
  const bestFit = capture(/(?:^|\n)[ \t]*Best-fit model according to (?:AIC|BIC)[^\n:]*:[ \t]*([^\r\n]+)/i);
  const plainModel = capture(/(?:^|\n)[ \t]*Model[ \t]*:[ \t]*([^\r\n]+)/i);
  const substitutionModel = capture(/(?:^|\n)[ \t]*Model of substitution[ \t]*:[ \t]*([^\r\n]+)/i);
  const model = bestFit ?? plainModel ?? substitutionModel;
  let likelihoodText = capture(/Log-likelihood[ \t]*:[ \t]*([-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?)/i);
  // No explicit line: use the selected model's own row in the model score
  // table (e.g. "TPM3u+F+I  -2197.612 ..."). Never guess a column otherwise.
  if (likelihoodText === null && model) {
    const escaped = model.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    likelihoodText = capture(new RegExp(`(?:^|\\n)[ \\t]*${escaped}[ \\t]+([-+]?(?:\\d+\\.?\\d*|\\.\\d+)(?:[eE][-+]?\\d+)?)`, "i"));
  }
  const likelihood = likelihoodText === null ? null : Number(likelihoodText);
  const support = capture(/((?:^|\n)[^\n]*?(?:UFboot|SH-aLRT|bootstrap|replicates)[^\r\n]*)/i);
  // Real support settings from the file only; no defaults are invented.
  const supportSettings = source.split(/\r?\n/)
    .filter((line) => /(UFboot|SH-aLRT|bootstrap|replicates)/i.test(line))
    .slice(0, 5)
    .map((line) => safeString(line, 200))
    .filter(Boolean);
  // The FINAL ML tree is printed in the report; a separately downloaded .nhx
  // can be the BIONJ starting tree and must not silently replace it.
  // IQ-TREE sometimes prints the newick on the SAME line as the label and
  // sometimes on the following line. Both come from the FULL report text.
  // Locate the LABEL, then scan forward to the first non-empty line beginning
  // with '(' (skipping blank lines). Real reports put the newick on its own
  // line after a blank line; a same-line newick is handled by the same scan.
  const label = "tree in newick format:";
  const labelIndex = source.toLowerCase().indexOf(label);
  let scannedTree = null;
  if (labelIndex >= 0) {
    const afterLabel = source.slice(labelIndex + label.length);
    for (const line of afterLabel.split("\n")) {
      const trimmed = line.trim();
      if (trimmed.startsWith("(")) { scannedTree = trimmed; break; }
    }
  }
  const sameLineTree = capture(/(?:^|\n)[ \t]*Tree in newick format[ \t]*:[ \t]*([^\r\n]+)/i);
  const nextLineTree = capture(/(?:^|\n)[ \t]*Tree in newick format[ \t]*:[ \t]*(?:\r?\n)[ \t]*([^\r\n]+)/i);
  const unanchoredTree = capture(/Tree in newick format[ \t]*:[ \t]*([^\r\n]+)/i);
  const finalTree = scannedTree || sameLineTree || nextLineTree || unanchoredTree;
  const rootingNote = capture(/((?:^|\n)[^\n]*?NOTE:[^\r\n]*UNROOTED[^\r\n]*)/i);
  return {
    model: model ? model.slice(0, 200) : null,
    log_likelihood: likelihood !== null && Number.isFinite(likelihood) ? likelihood : null,
    support: support ? support.slice(0, 300) : null,
    support_settings: supportSettings,
    final_tree: finalTree ? finalTree.slice(0, 2000) : null,
    rooting_note: rootingNote ? rootingNote.slice(0, 300) : null,
    available: Boolean(model || support || supportSettings.length || finalTree || rootingNote
      || (likelihood !== null && Number.isFinite(likelihood)))
  };
}

// Bounded excerpt of a GENUINE report for audit. The ONLY redaction applied is
// for X-API-Key-shaped values; other report text is carried verbatim (bounded).
// null when no report content was read.
export function iqtreeReportExcerpt(text) {
  const clean = safeString(text, 100_000).replace(/X-API-Key\s*:\s*\S+/gi, "[redacted]");
  if (!clean) return null;
  if (clean.length <= 2000) return clean;
  return `${clean.slice(0, 2000)}\n...[truncated]...\n${clean.slice(-2000)}`;
}

export function parseOutputDescriptors(stepId, outputs) {
  if (Array.isArray(outputs)) {
    return outputs.map((id) => ({ id: String(id), name: null, step: stepId })).filter((item) => item.id);
  }
  if (!outputs || typeof outputs !== "object") return [];
  return Object.entries(outputs).map(([name, value]) => {
    const id = typeof value === "string" ? value : String(value?.id ?? value?.dataset_id ?? "");
    return { id, name: String(value?.name ?? name), step: stepId };
  }).filter((item) => item.id);
}

// Select real datasets by output mapping first, then by name/extension. Missing
// categories stay null; nothing is synthesised from other artifacts.
export function selectPhyloArtifacts(artifacts, descriptors = []) {
  const candidates = (artifacts ?? []).map((artifact) => ({
    artifact,
    ...classifyPhyloArtifact(artifact)
  }));
  const score = (candidate, kind, preferredStep) => {
    const name = String(candidate.artifact.name ?? "");
    let value = candidate.kind === kind ? 0 : -100;
    if (descriptors.some((entry) => entry.id === String(candidate.artifact.id))) value += 2;
    if (descriptors.some((entry) => entry.step === preferredStep && entry.id === String(candidate.artifact.id))) value += 4;
    if (descriptors.some((entry) => entry.step === preferredStep && entry.name === name)) value += 3;
    if (kind === "alignment" && /mafft|alignment|aligned/i.test(name)) value += 1;
    if (kind === "tree" && /treefile|newick|iqtree/i.test(name)) value += 1;
    return value;
  };
  const best = (kind, preferredStep) => {
    const ranked = candidates
      .filter((candidate) => score(candidate, kind, preferredStep) >= 0)
      .sort((left, right) => score(right, kind, preferredStep) - score(left, kind, preferredStep));
    return ranked.length ? ranked[0].artifact : null;
  };
  return {
    alignment: best("alignment", "galaxy_mafft"),
    tree: best("tree", "galaxy_iqtree"),
    report: best("report", "galaxy_iqtree"),
    logs: candidates.filter((candidate) => candidate.kind === "log").map((candidate) => candidate.artifact)
  };
}

async function poll(adapter, jobId, ctx, { attempts = 60, intervalMs = 2000 } = {}) {
  for (let i = 0; i < attempts; i += 1) {
    const status = await adapter.getJobStatus({ job_id: jobId }, ctx);
    const state = String(status.status ?? "").toLowerCase();
    const classified = classifyJobState(state);
    if (classified === "succeeded" || classified === "failed") return { ...status, status: classified };
    await sleep(intervalMs);
  }
  return { status: "timeout", provider_job_id: jobId, timed_out: true };
}

export async function onRequest(context) {
  const rejected = requireMethod(context.request, "POST", "POST, OPTIONS");
  if (rejected) return rejected;
  return handlePhyloRun(context.request, context.env, context);
}

export async function handlePhyloRun(request, env, { now = Date.now(), idFactory, fetchImpl } = {}) {
  const { payload, error } = await readJsonBody(request);
  if (error) return errorResponse(error, 400, request);
  const fasta = String(payload?.fasta_text ?? "");
  const filename = sanitizeFilename(payload?.filename ?? "phylo.fasta");
  const objective = safeString(payload?.objective, 2000);
  let resumeId = safeString(payload?.resume_alignment_dataset_id, 200);
  const resumeHistoryId = safeString(payload?.history_id, 200);
  const resumeProviderJobId = safeString(payload?.resume_provider_job_id, 200);
  const resumeIqtreeJobId = safeString(payload?.resume_iqtree_provider_job_id, 200);
  const outgroup = safeString(payload?.outgroup, 200);
  // Raw homologous 16S sequences are legitimately unequal-length BEFORE MAFFT.
  // Equal length is required only for the retrieved MAFFT alignment.
  const inputCheck = validateInputFasta(fasta);
  if (!inputCheck.valid || inputCheck.records < 3) {
    return errorResponse("Provide at least three distinct, non-empty DNA/IUPAC sequences. Unequal lengths are expected before alignment.", 400, request);
  }
  const db = getDb(env);
  if (!db) return errorResponse("AI database binding is unavailable.", 503, request);

  const ctx = fetchImpl ? { fetch: fetchImpl } : {};
  const adapter = createAdapter(env);

  // OPTIONAL RECOVERY — resume from a real, already-succeeded Galaxy MAFFT job.
  // Every call here is READ-ONLY: no job is submitted, cancelled or fabricated.
  const resumeByJobId = Boolean(resumeProviderJobId && !resumeId);
  let resumedJobState = null;
  let resumedOutputUuid = null;
  let resumedAlignmentChecksum = null;
  let resolvedResumeHistoryId = null;
  let effectiveResumeHistoryId = null;
  let resumedMafftRecord = null;
  let iqtreeResumeState = null;
  let recoveredIqtree = null;
  let recoveredIqtreeRecord = null;
  let recoveredIqtreeReport = { model: null, log_likelihood: null, support: null, support_settings: [],
    final_tree: null, rooting_note: null, available: false };
  let recoveredIqtreeExcerpt = null;
  let displayedTreeSource = null;

  function resumeError(message, errorCode, status = 409, extra = {}) {
    return jsonResponse({
      error: message,
      error_code: errorCode,
      provider_job_id: resumeProviderJobId,
      provider_job_state: resumedJobState,
      provider_job_state_class: extra.state_class ?? null,
      resumed_from_provider_job: false,
      workflow_completed: false,
      execution_mode: envExecutionMode(env),
      ...extra
    }, status, request);
  }

  if (resumeByJobId) {
    const status = await adapter.getJobStatus({ job_id: resumeProviderJobId }, ctx);
    resumedJobState = String(status.output?.structured?.state ?? status.status ?? "") || null;
    const classified = classifyJobState(resumedJobState);
    if (classified !== "succeeded") {
      return resumeError(
        `Provider job ${resumeProviderJobId} is in state '${resumedJobState ?? "unknown"}'; it has not succeeded. No job was submitted and no result was created.`,
        "provider_job_not_succeeded", 409, { state_class: classified });
    }
    if (!resumeHistoryId) {
      return resumeError("resume by provider job id requires the history_id returned by the original run",
        "resume_history_required", 400);
    }
    const jobOutputs = await adapter.getJobOutputs({ job_id: resumeProviderJobId }, ctx);
    if (!jobOutputs.ok) {
      return resumeError(`Provider job outputs could not be read: ${jobOutputs.error?.message ?? jobOutputs.error?.code ?? "unavailable"}`,
        "provider_job_outputs_unavailable", 502);
    }
    // Dedupe READ-ONLY associations from /outputs and job details by identity.
    const statusAssociations = status.output?.structured?.output_associations ?? [];
    const seenAssociations = new Set();
    const associations = [...(jobOutputs.outputs ?? []), ...statusAssociations].filter((item) => {
      const keys = [item?.galaxyHdaId ?? item?.id, item?.galaxyDatasetUuid ?? item?.uuid,
        item?.galaxyDatasetId ?? item?.dataset_id]
        .filter((value) => value !== null && value !== undefined && String(value) !== "")
        .map(String);
      if (!keys.length) return true;
      if (keys.some((key) => seenAssociations.has(key))) return false;
      keys.forEach((key) => seenAssociations.add(key));
      return true;
    });

    // A provider job's outputs may live in a DIFFERENT history from the uploaded
    // input. Inspect every reported history (plus the caller's) exactly once.
    const historyIdsToInspect = [];
    const addHistoryId = (value) => {
      const id = safeString(value, 200);
      if (id && !historyIdsToInspect.includes(id) && historyIdsToInspect.length < 20) historyIdsToInspect.push(id);
    };
    addHistoryId(resumeHistoryId);
    for (const item of associations) addHistoryId(item.history_id);
    const historyCache = new Map();
    for (const id of historyIdsToInspect) {
      const result = await adapter.getArtifacts({ history_id: id }, ctx);
      historyCache.set(id, result?.ok === true ? (result.artifacts ?? []) : []);
    }
    const allVerifiedArtifacts = [...new Map([...historyCache.values()].flat()
      .filter((artifact) => artifact?.id)
      .map((artifact) => [String(artifact.id), artifact])).values()];

    // The uploaded input dataset is NEVER an alignment output. Identify it by
    // the uploaded filename and any verified HDA carrying that name.
    const inputNames = new Set([filename, sanitizeFilename(filename)].filter(Boolean));
    const inputIds = new Set(allVerifiedArtifacts
      .filter((item) => inputNames.has(String(item.name ?? "")))
      .map((item) => String(item.id)));
    const fastaExts = new Set(["fasta", "fa", "fna", "fas", "aln", "msa"]);
    // A name mentioning MAFFT/alignment is NOT enough: a log or report can carry
    // that name. The declared extension is authoritative, with the file-name
    // suffix only as an explicit fallback; both are case-insensitive.
    const fastaExtensionOf = (item) => {
      const declared = String(item.extension ?? item.file_ext ?? item.type ?? "")
        .trim().replace(/^\./, "").toLowerCase();
      if (declared) return declared;
      const name = String(item.name ?? "");
      const dot = name.lastIndexOf(".");
      return dot > 0 ? name.slice(dot + 1).trim().toLowerCase() : "";
    };
    const okState = (value) => ["ok", "success"].includes(String(value ?? "").toLowerCase());
    const notUploadedInput = (id, name) => !inputIds.has(String(id ?? "")) && !inputNames.has(String(name ?? ""));
    // An association is usable only if it has a real HDA id, an ok/success
    // state, a FASTA-like extension and is not the uploaded input.
    const isUsableAssociation = (item) => item?.valid !== false && okState(item?.state)
      && fastaExts.has(fastaExtensionOf(item))
      && notUploadedInput(item?.id, item?.name);

    // Look up verified artifacts by HDA id and uuid ACROSS inspected histories.
    // Membership follows the PROVIDER-reported history id, never the caller's.
    const artifactByHda = new Map();
    const artifactByUuid = new Map();
    for (const artifact of allVerifiedArtifacts) {
      if (artifact.id) artifactByHda.set(String(artifact.id), artifact);
      if (artifact.uuid) artifactByUuid.set(String(artifact.uuid), artifact);
    }
    const candidates = [];
    let historyMismatchSeen = false;
    for (const item of associations) {
      const hda = String(item.galaxyHdaId ?? item.id ?? "").trim();
      const uuid = String(item.galaxyDatasetUuid ?? item.uuid ?? "").trim();
      const datasetId = String(item.galaxyDatasetId ?? item.dataset_id ?? "").trim();
      const match = (hda && artifactByHda.get(hda))
        || (uuid && artifactByUuid.get(uuid))
        || (datasetId && allVerifiedArtifacts.find((artifact) => String(artifact.dataset_id ?? "") === datasetId))
        || null;
      if (!match || !match.id || match.deleted === true) continue;
      // Trust the provider's history when it reports one; never force the
      // caller-supplied upload history onto a job output.
      const providerHistoryId = safeString(item.history_id, 200) || null;
      if (providerHistoryId && match.history_id && String(match.history_id) !== providerHistoryId) {
        historyMismatchSeen = true;
        continue;
      }
      // Supplement missing display metadata from the verified artifact, but
      // keep both the association's and the artifact's strict gates.
      const assocState = String(item.state ?? "").trim().toLowerCase();
      const assocExt = String(item.extension ?? item.file_ext ?? item.type ?? "")
        .trim().replace(/^\./, "").toLowerCase();
      if (assocState && !okState(assocState)) continue;
      if (assocExt && !fastaExts.has(assocExt)) continue;
      if (!okState(match.state) || !fastaExts.has(fastaExtensionOf(match))) continue;
      const name = String(item.name ?? match.name ?? "");
      if (!notUploadedInput(match.id, name)) continue;
      candidates.push({
        id: match.id,
        // Preserve the ORIGINAL job-output UUID for provenance.
        uuid: uuid || match.uuid || null,
        dataset_id: datasetId || match.dataset_id || null,
        name,
        extension: String(item.extension ?? match.type ?? match.extension ?? ""),
        state: String(match.state ?? item.state ?? ""),
        history_id: providerHistoryId || match.history_id || resumeHistoryId,
        provider_history_id: providerHistoryId,
        caller_history_id: resumeHistoryId,
        resolved_from_history: true
      });
    }
    const inHistory = candidates.filter((item) => !item.history_id || historyIdsToInspect.includes(String(item.history_id)));
    // Name matching is only a tie-breaker among extension-valid candidates.
    const alignmentName = (item) => /alignment|aligned|\bmsa\b|mafft/i.test(String(item.name ?? ""));
    const selected = inHistory.find(alignmentName) ?? inHistory[0] ?? null;
    if (!selected) {
      const mismatch = candidates.length > 0 || historyMismatchSeen;
      // Honest, sanitized diagnostic for a genuinely unresolvable job: only
      // association identifiers/metadata and a verified-history count. Never
      // include credentials, URLs, FASTA content or raw provider error objects.
      // The normalized association's own reason and persistent identities are
      // included even when it has no usable HDA id, so the operator can resolve
      // the dataset against the verified history contents.
      const diagnostic = mismatch ? {} : {
        output_associations: associations.map((item) => {
          const hdaId = safeString(item.galaxyHdaId ?? item.hda_id ?? item.id, 200) || null;
          const datasetId = safeString(item.galaxyDatasetId ?? item.dataset_id, 200) || null;
          const uuid = safeString(item.galaxyDatasetUuid ?? item.uuid, 200) || null;
          return {
            id: hdaId,
            uuid,
            dataset_id: datasetId,
            name: safeString(item.name, 300) || null,
            extension: safeString(item.extension, 100) || null,
            state: safeString(item.state, 80) || null,
            history_id: safeString(item.history_id, 200) || null,
            usable: isUsableAssociation(item),
            error: safeString(item.error, 200) || null,
            galaxy_hda_id: hdaId,
            galaxy_dataset_id: datasetId,
            galaxy_dataset_uuid: uuid
          };
        }),
        inspected_history_ids: historyIdsToInspect.slice(0, 20),
        history_contents_count: allVerifiedArtifacts.length,
        history_artifacts: allVerifiedArtifacts.map((artifact) => ({
          id: safeString(artifact.id, 200) || null,
          name: safeString(artifact.name, 300) || null,
          state: safeString(artifact.state, 80) || null,
          extension: safeString(artifact.type ?? artifact.extension, 100) || null,
          uuid: safeString(artifact.uuid, 200) || null
        })),
        recovery_version: "m7111-uuid-resolution",
        job_output_keys: Array.isArray(jobOutputs.output_keys) ? jobOutputs.output_keys.slice(0, 50) : [],
        job_detail_output_keys: Array.isArray(status.output?.structured?.raw_output_keys)
          ? status.output.structured.raw_output_keys.slice(0, 50)
          : (Array.isArray(jobOutputs.job_detail_output_keys) ? jobOutputs.job_detail_output_keys.slice(0, 50) : [])
      };
      return resumeError(
        mismatch
          ? `No succeeded FASTA alignment output from provider job ${resumeProviderJobId} belongs to history ${resumeHistoryId}.`
          : `Provider job ${resumeProviderJobId} has no succeeded FASTA alignment output that is not the uploaded input.`,
        mismatch ? "resume_history_membership_mismatch" : "no_usable_alignment_output", 409, diagnostic);
    }
    // Resolve to the REAL HDA id; the existing fixed resume path then uses it
    // for IQ-TREE and for display, with no second MAFFT submission.
    resumeId = selected.id;
    effectiveResumeHistoryId = String(selected.provider_history_id ?? selected.history_id ?? resumeHistoryId);
    resolvedResumeHistoryId = effectiveResumeHistoryId;
    resumedOutputUuid = selected.uuid ?? null;
  }

  // OPTIONAL READ-ONLY IQ-TREE RECOVERY — an already-completed tree job is
  // inspected and its genuine outputs downloaded. NO new IQ-TREE submission.
  if (resumeIqtreeJobId) {
    const iqStatus = await adapter.getJobStatus({ job_id: resumeIqtreeJobId }, ctx);
    iqtreeResumeState = String(iqStatus.output?.structured?.state ?? iqStatus.status ?? "") || null;
    if (classifyJobState(iqtreeResumeState) !== "succeeded") {
      return jsonResponse({
        error: `IQ-TREE provider job ${resumeIqtreeJobId} is in state '${iqtreeResumeState ?? "unknown"}'; it has not succeeded. No job was submitted and no result was created.`,
        error_code: "iqtree_provider_job_not_succeeded",
        provider_job_id: resumeIqtreeJobId,
        provider_job_state: iqtreeResumeState,
        resumed_from_provider_job: false,
        workflow_completed: false,
        execution_mode: envExecutionMode(env)
      }, 409, request);
    }
    const iqOutputs = await adapter.getJobOutputs({ job_id: resumeIqtreeJobId }, ctx);
    if (!iqOutputs.ok) {
      return jsonResponse({
        error: `IQ-TREE provider job outputs could not be read: ${iqOutputs.error?.message ?? iqOutputs.error?.code ?? "unavailable"}`,
        error_code: "iqtree_provider_job_outputs_unavailable",
        provider_job_id: resumeIqtreeJobId,
        provider_job_state: iqtreeResumeState,
        resumed_from_provider_job: false,
        workflow_completed: false,
        execution_mode: envExecutionMode(env)
      }, 502, request);
    }
    const iqAssociations = [...(iqOutputs.outputs ?? []), ...(iqStatus.output?.structured?.output_associations ?? [])];
    // Verify output HDAs against the contents of every reported history (plus
    // the caller's), reading each unique history once.
    const iqHistoryIds = [];
    const addIqHistory = (value) => {
      const id = safeString(value, 200);
      if (id && !iqHistoryIds.includes(id) && iqHistoryIds.length < 20) iqHistoryIds.push(id);
    };
    addIqHistory(resumeHistoryId);
    addIqHistory(effectiveResumeHistoryId);
    for (const item of iqAssociations) addIqHistory(item.history_id);
    const iqHistoryCache = new Map();
    for (const id of iqHistoryIds) {
      const result = await adapter.getArtifacts({ history_id: id }, ctx);
      iqHistoryCache.set(id, result?.ok === true ? (result.artifacts ?? []) : []);
    }
    const iqVerified = [...new Map([...iqHistoryCache.values()].flat()
      .filter((artifact) => artifact?.id)
      .map((artifact) => [String(artifact.id), artifact])).values()];
    const iqByHda = new Map(iqVerified.map((artifact) => [String(artifact.id), artifact]));
    const outputArtifacts = [];
    const seenIqIds = new Set();
    for (const item of iqAssociations) {
      const hda = String(item.galaxyHdaId ?? item.id ?? "").trim();
      const uuid = String(item.galaxyDatasetUuid ?? item.uuid ?? "").trim();
      const datasetId = String(item.galaxyDatasetId ?? item.dataset_id ?? "").trim();
      const match = (hda && iqByHda.get(hda))
        || (uuid && iqVerified.find((artifact) => String(artifact.uuid ?? "") === uuid))
        || (datasetId && iqVerified.find((artifact) => String(artifact.dataset_id ?? "") === datasetId))
        || null;
      if (!match?.id || match.deleted === true || seenIqIds.has(String(match.id))) continue;
      if (item.history_id && match.history_id && String(match.history_id) !== String(item.history_id)) continue;
      seenIqIds.add(String(match.id));
      outputArtifacts.push(match);
    }
    recoveredIqtree = {
      provider_job_id: resumeIqtreeJobId,
      state: iqtreeResumeState,
      artifacts: outputArtifacts,
      output_ids: outputArtifacts.map((artifact) => artifact.id),
      history_ids: iqHistoryIds
    };
  }

  const createdAt = nowIso(now);
  const planId = makeId("plan", idFactory);
  const runId = makeId("run", idFactory);
  const datasetId = makeId("ds", idFactory);
  const inputHash = await hashInput(fasta);
  const capabilities = await adapter.getCapabilities(ctx);
  const tools = findPhyloTools(capabilities.tools ?? []);
  const toolMap = {
    upload_input: "upload1",
    galaxy_mafft: tools.mafft?.id ?? null,
    galaxy_iqtree: tools.iqtree?.id ?? null,
    retrieve_outputs: "galaxy:retrieve_outputs",
    validate_alignment: "phylogenetics.validate",
    validate_tree: "phylogenetics.tree",
    generate_report: "phylogenetics.report"
  };
  if (!tools.mafft || !tools.iqtree) {
    return errorResponse("MAFFT and IQ-TREE are not available on this Galaxy instance.", 503, request, {
      "X-Discovery-Mode": capabilities.discovery_mode ?? "unavailable"
    });
  }
  const discoveredAt = capabilities.at ?? createdAt;
  const toolVersions = {
    mafft: tools.mafft.version ?? null,
    iqtree: tools.iqtree.version ?? null,
    mafft_tool_id: tools.mafft.id ?? null,
    iqtree_tool_id: tools.iqtree.id ?? null,
    discovery_mode: capabilities.discovery_mode ?? "unavailable",
    discovered_at: discoveredAt
  };

  let workspaceOwner = null;
  if (env?.AI_AGENT_TOKEN && request?.headers?.get?.("X-Agent-Token")) {
    const derived = await deriveOwner(request, env);
    if (!derived.error) workspaceOwner = derived.owner;
  }

  try {
    await insertRow(db, SQL.insertDataset, [datasetId, null, filename, inputHash,
      new TextEncoder().encode(fasta).length, "text/plain", `phylo:${datasetId}`, fasta, createdAt]);
    await insertRow(db, SQL.insertPlan, [planId, runId, 1, JSON.stringify({
      goal: objective || "Multiple sequence alignment and phylogenetic tree",
      steps: STEP_IDS.map((id, index) => ({ id, tool_id: toolMap[id], order: index + 1 }))
    }), createdAt]);
  } catch (e) {
    return errorResponse(`Could not persist the workflow plan: ${e?.message ?? e}`, 500, request);
  }

  const jobIds = {};
  const provenance = [];
  let historyId = null;
  let alignmentText = null;
  let treeText = null;
  let failed = null;
  const retrievalErrors = [];
  const retrievedFiles = [];
  let mafftOutputs = [];
  let iqtreeOutputs = [];
  // In a fresh run the uploaded HDA is an INPUT, never a MAFFT output. In a
  // resumed run the resolved HDA already IS the MAFFT alignment.
  let uploadedHdaId = null;
  let retrievalStartedAt = null;

  async function recordStep(stepId, toolId, providerJobId, status, startedAt, finishedAt, extra = {}) {
    const jobId = makeId("job", idFactory);
    jobIds[stepId] = jobId;
    // D1 jobs.tool_id is NOT NULL; never let a null internal id reach it.
    const safeToolId = String(toolId ?? "galaxy:internal");
    await insertRow(db, SQL.insertJob, [jobId, planId, stepId, status, safeToolId, JSON.stringify(extra.params ?? {}),
      JSON.stringify({ dataset_id: datasetId }), JSON.stringify({}), "galaxy", "phylo-worker", 1, 120,
      envExecutionMode(env), createdAt, startedAt ?? createdAt, finishedAt ?? null]);
    const record = { step_id: stepId, job_id: jobId, tool_id: safeToolId, provider_job_id: providerJobId,
      status, started_at: startedAt ?? createdAt, finished_at: finishedAt ?? null, ...extra };
    provenance.push(record);
    return jobId;
  }

  try {
    let readyId = null;
    if (resumeId) {
      // A dataset UUID is NOT an HDA id. Resolve it against the verified
      // contents of the history returned by the original run, then use the HDA
      // id for every dataset content/download route.
      if (!resumeHistoryId) throw new Error("resume requires the history_id returned by the original run");
      // A resumed provider output can live in a DIFFERENT history from the
      // uploaded input; use the provider-reported history when available.
      const targetHistoryId = effectiveResumeHistoryId ?? resumeHistoryId;
      const contents = await adapter.getArtifacts({ history_id: targetHistoryId }, ctx);
      const match = (contents.artifacts ?? []).find((item) => (
        item.id === resumeId || item.uuid === resumeId || item.dataset_id === resumeId || item.name === resumeId
      ));
      if (!match) throw new Error("resume output association unavailable: no HDA matching the reference in verified history contents");
      if (match.history_id && String(match.history_id) !== String(targetHistoryId)) {
        throw new Error("resume output association unavailable: history membership mismatch");
      }
      readyId = match.id;
      historyId = String(match.history_id ?? targetHistoryId);
      await recordStep("upload_input", "upload1", null, "succeeded", createdAt, nowIso(now), { resumed: true });
      await recordStep("galaxy_mafft", tools.mafft.id, resumeByJobId ? resumeProviderJobId : null, "succeeded", createdAt, nowIso(now),
        { resumed: true, dataset_id: readyId, history_id: historyId, tool_version: tools.mafft.version,
          tool_id: tools.mafft.id, discovery_mode: toolVersions.discovery_mode,
          provider_job_state: resumedJobState, output_uuid: resumedOutputUuid,
          alignment_checksum: resumedAlignmentChecksum, resumed_from_provider_job: resumeByJobId,
          caller_history_id: resumeHistoryId, provider_history_id: effectiveResumeHistoryId });
      if (resumeByJobId) resumedMafftRecord = provenance[provenance.length - 1];
    } else {
      const upload = await adapter.submitJob({
        operation: "submit_job", tool_id: "upload1",
        inputs: { file1: { filename, extension: "fasta", content: fasta } }
      }, ctx);
      historyId = upload.output?.structured?.history_id ?? null;
      if (upload.error) throw new Error(`Galaxy upload failed: ${upload.error.message ?? upload.error.code}`);
      await recordStep("upload_input", "upload1", upload.provider_job_id, "succeeded", createdAt, nowIso(now),
        { dataset_id: upload.output?.structured?.dataset_id ?? null, history_id: historyId,
          job_submit_result: upload.status ?? null });
      readyId = upload.output?.structured?.dataset_id ?? null;
      for (let i = 0; i < 30 && historyId; i += 1) {
        const contents = await adapter.getArtifacts({ history_id: historyId }, ctx);
        const ready = (contents.artifacts ?? []).find((item) => item.id === readyId || item.name === filename);
        if (ready) { readyId = ready.id; break; }
        await sleep(1500);
      }
      if (!readyId) throw new Error("uploaded dataset was not present in verified history contents");
      uploadedHdaId = readyId;
      // MAFFT payload built from the live schema discovered on this instance.
      const mafftSchema = await fetchToolSchema(env, tools.mafft.id, tools.mafft.version);
      const mafftPayload = buildSchemaPayload(mafftSchema, readyId);
      if (!mafftPayload.valid) throw new Error(`MAFFT schema failure: ${mafftPayload.errors.join(", ")}`);
      const mafft = await adapter.submitJob({ operation: "submit_job", tool_id: tools.mafft.id, inputs: mafftPayload.inputs }, ctx);
      if (mafft.error) throw new Error(`MAFFT submission failed: ${mafft.error.message ?? mafft.error.code}`);
      const mafftState = await poll(adapter, mafft.provider_job_id, ctx);
      if (!["ok", "success", "succeeded"].includes(String(mafftState.status).toLowerCase())) {
        throw new Error(`MAFFT job ${mafft.provider_job_id} ended in state ${mafftState.status}`);
      }
      mafftOutputs = parseOutputDescriptors("galaxy_mafft", mafft.output?.structured?.outputs);
      await recordStep("galaxy_mafft", tools.mafft.id, mafft.provider_job_id, "succeeded", createdAt, nowIso(now),
        { tool_version: tools.mafft.version, tool_id: tools.mafft.id, discovery_mode: toolVersions.discovery_mode,
          output_ids: mafft.output?.structured?.outputs ?? [], input_dataset_id: readyId });
    }

    // Step 3 — IQ-TREE phylogenetic inference from the REAL MAFFT alignment.
    const alignmentArtifacts = await adapter.getArtifacts({ history_id: historyId }, ctx);
    let alignmentDataset = null;
    if (resumeId) {
      // Resume is keyed by the resolved MAFFT HDA, never by a name/extension
      // guess. A history may contain several FASTA datasets; only the HDA
      // resolved from the original run's history is eligible.
      const verified = (alignmentArtifacts.artifacts ?? []).find((item) => item.id === readyId);
      if (!verified || (verified.history_id && String(verified.history_id) !== String(historyId))) {
        throw new Error("resolved MAFFT dataset is not in the verified history");
      }
      alignmentDataset = verified;
    } else {
      const alignmentCandidates = (alignmentArtifacts.artifacts ?? []).filter((item) => item.id !== uploadedHdaId);
      alignmentDataset = selectPhyloArtifacts(alignmentCandidates, mafftOutputs).alignment;
    }
    if (!alignmentDataset) throw new Error("no retrieved alignment dataset available for tree inference");
    if (recoveredIqtree) {
      // READ-ONLY: use the genuine outputs of the already-completed job.
      iqtreeOutputs = parseOutputDescriptors("galaxy_iqtree", recoveredIqtree.output_ids);
      await recordStep("galaxy_iqtree", tools.iqtree.id, resumeIqtreeJobId, "succeeded", createdAt, nowIso(now),
        { tool_version: tools.iqtree.version, tool_id: tools.iqtree.id, discovery_mode: toolVersions.discovery_mode,
          output_ids: recoveredIqtree.output_ids, input_dataset_id: alignmentDataset.id,
          resumed: true, provider_job_state: iqtreeResumeState, resumed_from_provider_job: true,
          history_ids: recoveredIqtree.history_ids });
      recoveredIqtreeRecord = provenance[provenance.length - 1];
    } else {
      const treeSchema = await fetchToolSchema(env, tools.iqtree.id, tools.iqtree.version);
      const treePayload = buildSchemaPayload(treeSchema, alignmentDataset.id);
      if (!treePayload.valid) throw new Error(`tree schema failure: ${treePayload.errors.join(", ")}`);
      const iqtree = await adapter.submitJob({ operation: "submit_job", tool_id: tools.iqtree.id, inputs: treePayload.inputs }, ctx);
      if (iqtree.error) throw new Error(`IQ-TREE submission failed: ${iqtree.error.message ?? iqtree.error.code}`);
      const iqState = await poll(adapter, iqtree.provider_job_id, ctx);
      if (!["ok", "success", "succeeded"].includes(String(iqState.status).toLowerCase())) {
        throw new Error(`IQ-TREE job ${iqtree.provider_job_id} ended in state ${iqState.status}`);
      }
      iqtreeOutputs = parseOutputDescriptors("galaxy_iqtree", iqtree.output?.structured?.outputs);
      await recordStep("galaxy_iqtree", tools.iqtree.id, iqtree.provider_job_id, "succeeded", createdAt, nowIso(now),
        { tool_version: tools.iqtree.version, tool_id: tools.iqtree.id, discovery_mode: toolVersions.discovery_mode,
          output_ids: iqtree.output?.structured?.outputs ?? [], input_dataset_id: alignmentDataset.id });
    }

    // Step 4 — retrieve intermediate and final datasets. Selection is based on
    // name/extension and the real output mapping; unmatched files are stored as
    // evidence but never presented as the alignment or tree.
    retrievalStartedAt = nowIso(now);
    const finalArtifacts = await adapter.getArtifacts({ history_id: historyId }, ctx);
    let outputArtifacts = (finalArtifacts.artifacts ?? []).filter((item) => item.id !== uploadedHdaId);
    if (recoveredIqtree) {
      // A recovered IQ-TREE job may live in another history: merge its genuine
      // verified artifacts by HDA id so their real content is downloaded.
      const merged = new Map(outputArtifacts.map((artifact) => [String(artifact.id), artifact]));
      for (const artifact of recoveredIqtree.artifacts) {
        if (artifact.id && artifact.id !== uploadedHdaId) merged.set(String(artifact.id), artifact);
      }
      outputArtifacts = [...merged.values()];
    }
    const selected = selectPhyloArtifacts(outputArtifacts, [...mafftOutputs, ...iqtreeOutputs]);
    // Among GENUINE tree artifacts, prefer the final ML tree (MaxLikelihood /
    // treefile) over a BIONJ starting tree; never invent or rename content.
    const treeCandidates = outputArtifacts.filter((item) => classifyPhyloArtifact(item).kind === "tree");
    if (treeCandidates.length > 1) {
      const rank = (item) => {
        const name = String(item.name ?? "");
        if (/maxlikelihood|maximum likelihood|final tree/i.test(name)) return 3;
        if (/\.treefile\b|treefile|newick/i.test(name)) return 2;
        if (/bionj|starting tree|initial tree/i.test(name)) return -1;
        return 1;
      };
      selected.tree = [...treeCandidates].sort((left, right) => rank(right) - rank(left))[0];
    }
    if (resumeId) {
      // Keep the reported alignment identical to the HDA used for IQ-TREE.
      const verified = outputArtifacts.find((item) => item.id === readyId);
      if (!verified || (verified.history_id && String(verified.history_id) !== String(historyId))) {
        throw new Error("resolved MAFFT dataset is not in the verified history");
      }
      selected.alignment = verified;
    }
    const selectedIds = new Set([selected.alignment?.id, selected.tree?.id, selected.report?.id,
      ...selected.logs.map((item) => item.id)].filter(Boolean));
    if (recoveredIqtree) {
      // Every genuine tree artifact (e.g. the BIONJ starting tree / .nhx) is
      // evidence in its own right: keep and label it even when another tree or
      // the report's final tree is the one actually displayed.
      for (const item of treeCandidates) selectedIds.add(item.id);
      for (const item of outputArtifacts) {
        if (/\.nhx\b/i.test(String(item.name ?? "")) || /^nhx$/i.test(String(item.type ?? ""))) {
          selectedIds.add(item.id);
        }
      }
    }
    let ordinal = 0;
    for (const item of outputArtifacts) {
      if (!selectedIds.has(item.id)) continue;
      ordinal += 1;
      const downloaded = await adapter.downloadArtifact({ dataset_id: item.id }, ctx);
      const kind = classifyPhyloArtifact(item).kind;
      const sourceStep = [...mafftOutputs, ...iqtreeOutputs].find((entry) => entry.id === item.id)?.step ?? null;
      const toolVersion = sourceStep === "galaxy_mafft" ? tools.mafft.version
        : sourceStep === "galaxy_iqtree" ? tools.iqtree.version : null;
      // One honest batch timestamp: the Worker did not observe distinct times
      // per dataset, so none are claimed. `retrieval_order` is deterministic.
      const retrievedAt = retrievalStartedAt;
      if (!downloaded.ok || typeof downloaded.content !== "string") {
        retrievalErrors.push({ dataset_id: item.id, name: item.name, reason: "content_unavailable" });
        continue;
      }
      const bytes = new TextEncoder().encode(downloaded.content).length;
      const checksum = await hashInput(downloaded.content);
      const isNhkArtifact = /\.nhx\b/i.test(String(item.name ?? "")) || /^nhx$/i.test(String(item.type ?? ""));
      retrievedFiles.push({ dataset_id: item.id, hda_id: item.id, name: item.name, kind,
        extension: item.type ?? null, retrieved_at: retrievedAt, retrieval_order: ordinal,
        tool_version: toolVersion, source_step: sourceStep, bytes, checksum,
        ...(isNhkArtifact ? { source_role: "starting_tree_not_displayed" } : {}) });
      // Artifact rows are keyed to the AI job id so the existing
      // GET /api/ai/runs/:jobId endpoint can reopen them. Each real artifact
      // keeps its own name and checksum, including the BIONJ .nhx file.
      await insertRow(db, SQL.insertArtifact, [makeId("art", idFactory), jobIds.galaxy_iqtree ?? runId, item.name, kind,
        `galaxy:${item.id}`, checksum, bytes, "text/plain", downloaded.content, retrievedAt]);

      if (kind === "alignment" && item.id === selected.alignment?.id) {
        const check = validateAlignment(downloaded.content);
        if (!check.valid || check.records < 2) {
          retrievalErrors.push({ dataset_id: item.id, name: item.name, reason: check.error ?? "alignment_has_fewer_than_two_records" });
        } else {
          alignmentText = downloaded.content;
          if (resumeByJobId && item.id === readyId) {
            resumedAlignmentChecksum = await hashInput(downloaded.content);
            if (resumedMafftRecord) resumedMafftRecord.alignment_checksum = resumedAlignmentChecksum;
          }
        }
      }
      if (kind === "tree" && item.id === selected.tree?.id) {
        try {
          parseNewick(downloaded.content);
          treeText = downloaded.content;
        } catch (e) {
          retrievalErrors.push({ dataset_id: item.id, name: item.name, reason: `newick_parse_failed: ${e?.message ?? e}` });
        }
      }
      if (recoveredIqtree && kind === "report") {
        // Parse the FULL genuine report (a real .iqtree file can be tens of KB
        // and print its final tree near the END). Only the bounded excerpt is
        // ever exposed in the response; the full text is never sent to the UI.
        const fullReportText = downloaded.content;
        recoveredIqtreeReport = parseIqtreeReport(fullReportText);
        if (recoveredIqtreeRecord) {
          recoveredIqtreeRecord.model = recoveredIqtreeReport.model;
          recoveredIqtreeRecord.log_likelihood = recoveredIqtreeReport.log_likelihood;
          recoveredIqtreeRecord.support = recoveredIqtreeReport.support;
          recoveredIqtreeRecord.support_settings = recoveredIqtreeReport.support_settings;
          recoveredIqtreeRecord.final_tree = recoveredIqtreeReport.final_tree;
          recoveredIqtreeRecord.rooting_note = recoveredIqtreeReport.rooting_note;
        }
        retrievedFiles[retrievedFiles.length - 1].report_fields = {
          model: recoveredIqtreeReport.model,
          log_likelihood: recoveredIqtreeReport.log_likelihood,
          final_tree_present: Boolean(recoveredIqtreeReport.final_tree)
        };
        recoveredIqtreeExcerpt = iqtreeReportExcerpt(fullReportText);
      }
    }
    // The report's exact final ML tree wins over a starting-tree artifact; it
    // is used ONLY if it is parseable. Otherwise the downloaded treefile stays
    // the displayed tree with an explicit source label.
    if (recoveredIqtreeReport.final_tree) {
      try {
        parseNewick(recoveredIqtreeReport.final_tree);
        treeText = recoveredIqtreeReport.final_tree;
        displayedTreeSource = "iqtree_report_final_tree";
      } catch (e) {
        retrievalErrors.push({ reason: `iqtree_report_final_tree_unparseable: ${e?.message ?? e}; displayed tree falls back to the downloaded treefile` });
        displayedTreeSource = treeText ? "downloaded_treefile" : null;
      }
    } else if (treeText) {
      displayedTreeSource = "downloaded_treefile";
    }
    // Label retained tree artifacts OUTSIDE the try: the fallback path must be
    // labelled too, so no tree is ever displayed without an explicit source.
    if (displayedTreeSource) {
      const displayedHda = displayedTreeSource === "iqtree_report_final_tree"
        ? null : String(selected.tree?.id ?? "");
      for (const file of retrievedFiles) {
        if (file.kind !== "tree" && file.source_role !== "starting_tree_not_displayed") continue;
        const name = String(file.name ?? "");
        const isStarting = /bionj|starting tree|initial tree|\.nhx\b/i.test(name)
          || !displayedHda || String(file.dataset_id) !== displayedHda;
        file.source_role = isStarting ? "starting_tree_not_displayed" : "displayed_tree";
      }
    }
    if (!alignmentText) retrievalErrors.push({ reason: "no_valid_alignment_retrieved" });
    if (!treeText) retrievalErrors.push({ reason: "no_valid_newick_tree_retrieved" });
    await recordStep("retrieve_outputs", "galaxy:retrieve_outputs", null, retrievalErrors.length ? "partial" : "succeeded",
      retrievalStartedAt, nowIso(now),
      { dataset_ids: (finalArtifacts.artifacts ?? []).map((item) => item.id),
        files: retrievedFiles, tool_versions: toolVersions, errors: retrievalErrors,
        tree_source: displayedTreeSource,
        classification: "name_extension_and_output_mapping" });
  } catch (e) {
    failed = e?.message ?? String(e);
  }

  // Steps 5-7 — validation and report (independent of remote success, never fabricated).
  const alignment = alignmentText ? validateAlignment(alignmentText)
    : { valid: false, error: "no alignment retrieved", code: "alignment_missing", records: 0,
      lengths: [], names: [], errors: ["alignment_missing"], metrics: null };
  // Invalid retrieved alignment content is evidence, not a result: keep it in
  // the artifact table but never present it or its tree as verified outputs.
  if (!alignment.valid) { alignmentText = null; treeText = null; }
  const tree = treeText && alignment.names
    ? validateTree(treeText, alignment.names, { outgroup })
    : { valid: false, error: "no tree retrieved", code: "tree_missing", taxa: [], missing: [],
      unknown: [], duplicates: [], errors: ["tree_missing"], metrics: null,
      rooting: { status: "unknown", basis: "No tree was retrieved.", declared_outgroup: outgroup || null,
        outgroup_verified: false, invented_outgroup: false } };
  const warnings = [...(tree.warnings ?? []), ...(alignment.warnings ?? [])];
  // A captured alignment/tree is NOT proof the workflow completed: an exception
  // in the try block sets `failed`, and must force failure everywhere downstream.
  const passed = !failed && alignment.valid && tree.valid;
  const validationStatus = failed ? "failed"
    : (passed ? (warnings.length ? "pass_with_warnings" : "pass") : "fail");
  const validation = {
    status: validationStatus,
    alignment, tree, warnings, error: failed, retrieval_errors: retrievalErrors,
    label_normalization: tree.label_normalization ?? null,
    checked_rules: ["input_min_three_distinct_records", "input_hash", "alignment_records",
      "alignment_lengths", "alignment_alphabet", "newick_parse", "taxa_set_normalized", "duplicate_taxa",
      "branch_lengths_finite", "branch_lengths_nonnegative_warning", "support_labels", "explicit_rooting"]
  };
  await recordStep("validate_alignment", "phylogenetics.validate", null, alignment.valid ? "succeeded" : "failed",
    createdAt, nowIso(now), { validation: { records: alignment.records, lengths: alignment.lengths,
      metrics: alignment.metrics } });
  await recordStep("validate_tree", "phylogenetics.tree", null, tree.valid ? "succeeded" : "failed",
    createdAt, nowIso(now), { validation: { taxa: tree.taxa, missing: tree.missing, unknown: tree.unknown,
      duplicates: tree.duplicates, branch_lengths: tree.branch_lengths, rooting: tree.rooting,
      warnings, label_normalization: tree.label_normalization ?? null } });
  // Never emit `/api/ai/jobs/undefined/report`: a run that failed before any
  // provider job was recorded has no report endpoint (null), not a fake id.
  const jobReportId = jobIds.galaxy_iqtree ?? jobIds.galaxy_mafft ?? null;
  await recordStep("generate_report", "phylogenetics.report", null,
    failed ? "skipped_due_to_failure" : "succeeded", createdAt, nowIso(now),
    { report_endpoint: jobReportId ? `/api/ai/jobs/${jobReportId}/report` : null,
      skipped_reason: failed ? "workflow_failed" : null });
  await audit(db, { actor: "phylo-worker", action: "phylo_workflow_completed", target: runId,
    detail: { plan_id: planId, dataset_id: datasetId, input_sha256: inputHash, status: validation.status }, timestamp: nowIso(now), idFactory });

  // Workspace index: only written when the caller supplies the existing
  // operator token, because /api/workspace/runs/:id is owner-scoped. The AI run
  // endpoint (keyed by the real job id) is always available without a token.
  let workspaceRunUrl = null;
  if (workspaceOwner) {
    try {
      const projectId = makeId("proj", idFactory);
      await insertRow(db, SQL.insertWorkspaceProject, [projectId, `Phylogenetics ${filename}`, workspaceOwner,
        JSON.stringify({ source: "phylo_run", run_id: runId }), createdAt, null,
        objective || "Galaxy MAFFT → IQ-TREE run", "active", createdAt]);
      await insertRow(db, SQL.insertWorkspaceRun, [runId, projectId, "msa-phylogenetics", "1.0.0",
        objective || null, JSON.stringify([datasetId]), JSON.stringify({ outgroup: outgroup || null,
          tool_versions: toolVersions }), "galaxy", envExecutionMode(env),
        passed ? "succeeded" : "failed", createdAt,
        passed ? nowIso(now) : null,
        JSON.stringify(provenance.map((step) => ({ id: step.step_id, status: step.status }))),
        JSON.stringify(retrievedFiles.map((file) => ({ dataset_id: file.dataset_id, name: file.name, kind: file.kind }))),
        JSON.stringify(validation), JSON.stringify(provenance),
        failed ? JSON.stringify({ error: failed }) : null, workspaceOwner, 0]);
      workspaceRunUrl = `/api/workspace/runs/${runId}`;
    } catch (e) {
      retrievalErrors.push({ reason: `workspace_index_unavailable: ${e?.message ?? e}` });
    }
  }

  const aiRunJobId = jobIds.galaxy_iqtree ?? jobIds.galaxy_mafft ?? null;
  return jsonResponse({
    plan_id: planId, run_id: runId, dataset_id: datasetId, input_sha256: inputHash,
    job_ids: jobIds, history_id: historyId, tool_versions: toolVersions,
    validation, provenance, execution_mode: envExecutionMode(env),
    error: failed,
    tree_newick: treeText, alignment_text: alignmentText,
    tree_source: displayedTreeSource,
    tree_artifacts: retrievedFiles
      .filter((file) => file.kind === "tree" || file.name?.toLowerCase?.().endsWith(".nhx")
        || file.source_role === "starting_tree_not_displayed")
      .map((file) => ({ dataset_id: file.dataset_id, name: file.name, extension: file.extension,
        checksum: file.checksum, bytes: file.bytes, source_role: file.source_role ?? "downloaded_treefile" })),
    metrics: { alignment: alignment.metrics ?? null, tree: tree.metrics ?? null, warnings },
    retrieval: { started_at: retrievalStartedAt,
      files: retrievedFiles, errors: retrievalErrors,
      classification: "name_extension_and_output_mapping" },
    workflow_completed: passed,
    // Recovery provenance: the ORIGINAL provider job and its real, observed
    // state/output — never a resubmitted MAFFT job or an invented identifier.
    resume: resumeByJobId ? {
      provider_job_id: resumeProviderJobId,
      provider_job_state: resumedJobState,
      alignment_hda_id: resumeId,
      output_uuid: resumedOutputUuid,
      alignment_checksum: resumedAlignmentChecksum,
      history_id: resolvedResumeHistoryId ?? historyId,
      caller_history_id: resumeHistoryId,
      provider_history_id: effectiveResumeHistoryId ?? resolvedResumeHistoryId ?? historyId,
      resumed_from_provider_job: true
    } : null,
    resume_iqtree: recoveredIqtree ? {
      provider_job_id: resumeIqtreeJobId,
      provider_job_state: iqtreeResumeState,
      output_ids: recoveredIqtree.output_ids,
      history_ids: recoveredIqtree.history_ids,
      model: recoveredIqtreeReport.model,
      log_likelihood: recoveredIqtreeReport.log_likelihood,
      support: recoveredIqtreeReport.support,
      support_settings: recoveredIqtreeReport.support_settings,
      final_tree_present: Boolean(recoveredIqtreeReport.final_tree),
      rooting_note: recoveredIqtreeReport.rooting_note,
      tree_source: displayedTreeSource,
      iqtree_report_excerpt: recoveredIqtreeExcerpt,
      resumed_from_provider_job: true
    } : null,
    reopen: {
      ai_run_id: aiRunJobId,
      ai_run_url: aiRunJobId ? `/api/ai/runs/${aiRunJobId}` : null,
      workspace_run_id: runId,
      workspace_run_url: workspaceRunUrl,
      workspace_persisted: Boolean(workspaceRunUrl),
      plan_id: planId
    }
  }, (failed || !passed) ? 502 : 200, request);
}
