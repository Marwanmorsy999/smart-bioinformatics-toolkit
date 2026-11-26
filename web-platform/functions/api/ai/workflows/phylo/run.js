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
  let resumedMafftRecord = null;

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
    // The uploaded input dataset is NEVER an alignment output. Identify it by
    // the uploaded filename and any history HDA carrying that name, then reject
    // it from the candidate set by id/name.
    const historyContents = await adapter.getArtifacts({ history_id: resumeHistoryId }, ctx);
    const inputNames = new Set([filename, sanitizeFilename(filename)].filter(Boolean));
    const inputIds = new Set((historyContents.artifacts ?? [])
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
    const isUsableAssociation = (item) => {
      const name = String(item.name ?? "");
      const okState = ["ok", "success"].includes(String(item.state ?? "").toLowerCase());
      const notInput = !inputIds.has(String(item.id)) && !inputNames.has(name);
      return item.valid !== false && okState && fastaExts.has(fastaExtensionOf(item)) && notInput;
    };
    const candidates = (jobOutputs.outputs ?? []).filter(isUsableAssociation);
    const inHistory = candidates.filter((item) => !item.history_id || String(item.history_id) === String(resumeHistoryId));
    // Name matching is only a tie-breaker among extension-valid candidates.
    const alignmentName = (item) => /alignment|aligned|\bmsa\b|mafft/i.test(String(item.name ?? ""));
    const selected = inHistory.find(alignmentName) ?? inHistory[0] ?? null;
    if (!selected) {
      const mismatch = candidates.length > 0;
      // Honest, sanitized diagnostic for a genuinely unresolvable job: only
      // association identifiers/metadata and a verified-history count. Never
      // include credentials, URLs, FASTA content or raw provider error objects.
      const diagnostic = mismatch ? {} : {
        output_associations: (jobOutputs.outputs ?? []).map((item) => ({
          id: safeString(item.id, 200) || null,
          uuid: safeString(item.uuid, 200) || null,
          dataset_id: safeString(item.dataset_id, 200) || null,
          name: safeString(item.name, 300) || null,
          extension: safeString(item.extension, 100) || null,
          state: safeString(item.state, 80) || null,
          history_id: safeString(item.history_id, 200) || null,
          usable: isUsableAssociation(item)
        })),
        history_contents_count: historyContents?.ok === true ? (historyContents.artifacts ?? []).length : null
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
    resolvedResumeHistoryId = String(selected.history_id ?? resumeHistoryId);
    resumedOutputUuid = selected.uuid ?? null;
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
    retrieve_outputs: null,
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
    await insertRow(db, SQL.insertJob, [jobId, planId, stepId, status, toolId, JSON.stringify(extra.params ?? {}),
      JSON.stringify({ dataset_id: datasetId }), JSON.stringify({}), "galaxy", "phylo-worker", 1, 120,
      envExecutionMode(env), createdAt, startedAt ?? createdAt, finishedAt ?? null]);
    const record = { step_id: stepId, job_id: jobId, tool_id: toolId, provider_job_id: providerJobId,
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
      const contents = await adapter.getArtifacts({ history_id: resumeHistoryId }, ctx);
      const match = (contents.artifacts ?? []).find((item) => (
        item.id === resumeId || item.uuid === resumeId || item.dataset_id === resumeId || item.name === resumeId
      ));
      if (!match) throw new Error("resume output association unavailable: no HDA matching the reference in verified history contents");
      if (match.history_id && String(match.history_id) !== String(resumeHistoryId)) {
        throw new Error("resume output association unavailable: history membership mismatch");
      }
      readyId = match.id;
      historyId = String(match.history_id ?? resumeHistoryId);
      await recordStep("upload_input", "upload1", null, "succeeded", createdAt, nowIso(now), { resumed: true });
      await recordStep("galaxy_mafft", tools.mafft.id, resumeByJobId ? resumeProviderJobId : null, "succeeded", createdAt, nowIso(now),
        { resumed: true, dataset_id: readyId, history_id: historyId, tool_version: tools.mafft.version,
          tool_id: tools.mafft.id, discovery_mode: toolVersions.discovery_mode,
          provider_job_state: resumedJobState, output_uuid: resumedOutputUuid,
          alignment_checksum: resumedAlignmentChecksum, resumed_from_provider_job: resumeByJobId });
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

    // Step 4 — retrieve intermediate and final datasets. Selection is based on
    // name/extension and the real output mapping; unmatched files are stored as
    // evidence but never presented as the alignment or tree.
    retrievalStartedAt = nowIso(now);
    const finalArtifacts = await adapter.getArtifacts({ history_id: historyId }, ctx);
    const outputArtifacts = (finalArtifacts.artifacts ?? []).filter((item) => item.id !== uploadedHdaId);
    const selected = selectPhyloArtifacts(outputArtifacts, [...mafftOutputs, ...iqtreeOutputs]);
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
      retrievedFiles.push({ dataset_id: item.id, hda_id: item.id, name: item.name, kind,
        extension: item.type ?? null, retrieved_at: retrievedAt, retrieval_order: ordinal,
        tool_version: toolVersion, source_step: sourceStep, bytes });
      // Artifact rows are keyed to the AI job id so the existing
      // GET /api/ai/runs/:jobId endpoint can reopen them.
      await insertRow(db, SQL.insertArtifact, [makeId("art", idFactory), jobIds.galaxy_iqtree ?? runId, item.name, kind,
        `galaxy:${item.id}`, await hashInput(downloaded.content), bytes,
        "text/plain", downloaded.content, retrievedAt]);

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
    }
    if (!alignmentText) retrievalErrors.push({ reason: "no_valid_alignment_retrieved" });
    if (!treeText) retrievalErrors.push({ reason: "no_valid_newick_tree_retrieved" });
    await recordStep("retrieve_outputs", null, null, retrievalErrors.length ? "partial" : "succeeded",
      retrievalStartedAt, nowIso(now),
      { dataset_ids: (finalArtifacts.artifacts ?? []).map((item) => item.id),
        files: retrievedFiles, tool_versions: toolVersions, errors: retrievalErrors,
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
  const validation = {
    status: failed ? "failed" : (alignment.valid && tree.valid ? "pass" : "fail"),
    alignment, tree, error: failed, retrieval_errors: retrievalErrors,
    checked_rules: ["input_min_three_distinct_records", "input_hash", "alignment_records",
      "alignment_lengths", "alignment_alphabet", "newick_parse", "taxa_set", "duplicate_taxa",
      "branch_lengths", "support_labels", "explicit_rooting"]
  };
  await recordStep("validate_alignment", "phylogenetics.validate", null, alignment.valid ? "succeeded" : "failed",
    createdAt, nowIso(now), { validation: { records: alignment.records, lengths: alignment.lengths,
      metrics: alignment.metrics } });
  await recordStep("validate_tree", "phylogenetics.tree", null, tree.valid ? "succeeded" : "failed",
    createdAt, nowIso(now), { validation: { taxa: tree.taxa, missing: tree.missing, unknown: tree.unknown,
      duplicates: tree.duplicates, branch_lengths: tree.branch_lengths, rooting: tree.rooting } });
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
        validation.status === "pass" ? "succeeded" : "failed", createdAt,
        validation.status === "pass" ? nowIso(now) : null,
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
    metrics: { alignment: alignment.metrics ?? null, tree: tree.metrics ?? null },
    retrieval: { started_at: retrievalStartedAt,
      files: retrievedFiles, errors: retrievalErrors,
      classification: "name_extension_and_output_mapping" },
    workflow_completed: validation.status === "pass",
    // Recovery provenance: the ORIGINAL provider job and its real, observed
    // state/output — never a resubmitted MAFFT job or an invented identifier.
    resume: resumeByJobId ? {
      provider_job_id: resumeProviderJobId,
      provider_job_state: resumedJobState,
      alignment_hda_id: resumeId,
      output_uuid: resumedOutputUuid,
      alignment_checksum: resumedAlignmentChecksum,
      history_id: resolvedResumeHistoryId ?? historyId,
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
  }, (failed || validation.status !== "pass") ? 502 : 200, request);
}
