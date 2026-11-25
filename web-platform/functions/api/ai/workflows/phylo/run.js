// POST /api/ai/workflows/phylo/run â€” M7.3 real multi-step Galaxy workflow.
//
// Upload FASTA -> validate -> MAFFT (MSA) -> IQ-TREE (tree) -> retrieve ->
// validate alignment/tree -> persist provenance and job records in D1.
// No provider key is read from or returned to the browser: the Galaxy adapter
// reads it from env (a Worker secret) internally.

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
import { validateFasta } from "../../../blast/_lib.js";
import { createAdapter } from "../../../../../providers/galaxy/index.js";
import { findPhyloTools } from "../../../../../providers/galaxy/galaxy_phylo.js";
import { fetchToolSchema, buildSchemaPayload } from "../../../../../providers/galaxy/galaxy_schema.js";
import { classifyJobState, parseJobOutputs, parseHistoryContents, resolveJobOutput } from "../../../../../providers/galaxy/galaxy_ids.js";
import { validateAlignment, validateTree } from "./validators.js";

const STEP_IDS = Object.freeze([
  "upload_input", "galaxy_mafft", "galaxy_iqtree", "retrieve_outputs",
  "validate_alignment", "validate_tree", "generate_report"
]);

function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

function terminal(state) {
  return ["ok", "success", "succeeded", "failed", "error", "cancelled", "canceled"].includes(String(state ?? "").toLowerCase());
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
  const resumeId = safeString(payload?.resume_alignment_dataset_id, 200);
  const checked = validateFasta(fasta);
  if (!checked.valid) return errorResponse(`Invalid multi-FASTA: ${checked.error}`, 400, request);
  const db = getDb(env);
  if (!db) return errorResponse("AI database binding is unavailable.", 503, request);

  const createdAt = nowIso(now);
  const planId = makeId("plan", idFactory);
  const runId = makeId("run", idFactory);
  const datasetId = makeId("ds", idFactory);
  const inputHash = await hashInput(fasta);
  const ctx = fetchImpl ? { fetch: fetchImpl } : {};

  const adapter = createAdapter(env);
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
      // A dataset UUID is NOT an HDA id. Resolve it against history contents
      // and use the HDA id for all dataset content/download routes.
      const contents = historyId ? await adapter.getArtifacts({ history_id: historyId }, ctx) : { artifacts: [] };
      const match = (contents.artifacts ?? []).find((a) => a.id === resumeId || a.uuid === resumeId || a.dataset_id === resumeId);
      if (!match) throw new Error("resume output association unavailable: no HDA matching UUID in verified history contents");
      readyId = match.id;
      historyId = prior.artifacts[0].history_id ?? null;
      await recordStep("upload_input", "upload1", null, "succeeded", createdAt, nowIso(now), { resumed: true });
      await recordStep("galaxy_mafft", tools.mafft.id, null, "succeeded", createdAt, nowIso(now),
        { resumed: true, dataset_id: readyId, tool_version: tools.mafft.version });
    } else {
      const upload = await adapter.submitJob({
        operation: "submit_job", tool_id: "upload1",
        inputs: { file1: { filename, extension: "fasta", content: fasta } }
      }, ctx);
      historyId = upload.output?.structured?.history_id ?? null;
      if (upload.error) throw new Error(`Galaxy upload failed: ${upload.error.message ?? upload.error.code}`);
      await recordStep("upload_input", "upload1", upload.provider_job_id, "succeeded", createdAt, nowIso(now),
        { dataset_id: upload.output?.structured?.dataset_id ?? null, history_id: historyId });
      readyId = upload.output?.structured?.dataset_id ?? null;
      for (let i = 0; i < 30 && historyId; i += 1) {
        const contents = await adapter.getArtifacts({ history_id: historyId }, ctx);
        const ready = (contents.artifacts ?? []).find((a) => a.id === readyId || a.name === filename);
        if (ready) { readyId = ready.id; break; }
        await sleep(1500);
      }
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
      await recordStep("galaxy_mafft", tools.mafft.id, mafft.provider_job_id, "succeeded", createdAt, nowIso(now),
        { tool_version: tools.mafft.version, output_ids: mafft.output?.structured?.outputs ?? [] });
    }
    // Step 3 â€” IQ-TREE phylogenetic inference from the alignment dataset.
    const alignmentArtifacts = await adapter.getArtifacts({ history_id: historyId }, ctx);
    const alignmentDataset = (alignmentArtifacts.artifacts ?? []).find((a) => /fasta|aln|msa/i.test(`${a.name}.${a.type}`)) ?? null;
    if (!alignmentDataset) throw new Error("no retrieved alignment dataset available for tree inference");
    const treeSchema = await fetchToolSchema(env, tools.iqtree.id, tools.iqtree.version);
    const treePayload = buildSchemaPayload(treeSchema, alignmentDataset.id);
    if (!treePayload.valid) throw new Error(`tree schema failure: ${treePayload.errors.join(", ")}`);
    const treeInput = treePayload.inputs;
    const iqtree = await adapter.submitJob({ operation: "submit_job", tool_id: tools.iqtree.id, inputs: treeInput }, ctx);
    if (iqtree.error) throw new Error(`IQ-TREE submission failed: ${iqtree.error.message ?? iqtree.error.code}`);
    const iqState = await poll(adapter, iqtree.provider_job_id, ctx);
    if (!["ok", "success", "succeeded"].includes(String(iqState.status).toLowerCase())) {
      throw new Error(`IQ-TREE job ${iqtree.provider_job_id} ended in state ${iqState.status}`);
    }
    await recordStep("galaxy_iqtree", tools.iqtree.id, iqtree.provider_job_id, "succeeded", createdAt, nowIso(now),
      { tool_version: tools.iqtree.version, output_ids: iqtree.output?.structured?.outputs ?? [] });

    // Step 4 â€” retrieve intermediate and final datasets.
    const finalArtifacts = await adapter.getArtifacts({ history_id: historyId }, ctx);
    for (const item of finalArtifacts.artifacts ?? []) {
      const downloaded = await adapter.downloadArtifact({ dataset_id: item.id }, ctx);
      if (!downloaded.ok) continue;
      const kind = /tree|nwk|newick/i.test(item.name) ? "newick"
        : /fasta|aln|msa|aligned/i.test(item.name) ? "alignment" : "other";
      if (kind === "alignment" && alignmentText === null) alignmentText = downloaded.content;
      if (kind === "newick" && treeText === null) treeText = downloaded.content;
      await insertRow(db, SQL.insertArtifact, [makeId("art", idFactory), runId, item.name, kind,
        `galaxy:${item.id}`, await hashInput(downloaded.content), downloaded.content.length,
        "text/plain", downloaded.content, nowIso(now)]);
    }
    await recordStep("retrieve_outputs", null, null, "succeeded", createdAt, nowIso(now),
      { dataset_ids: (finalArtifacts.artifacts ?? []).map((a) => a.id) });
  } catch (e) {
    failed = e?.message ?? String(e);
  }

  // Steps 5-7 â€” validation and report (independent of remote success, never fabricated).
  const alignment = alignmentText ? validateAlignment(alignmentText) : { valid: false, error: "no alignment retrieved" };
  const tree = treeText && alignment.names ? validateTree(treeText, alignment.names) : { valid: false, error: "no tree retrieved" };
  const validation = { status: failed ? "failed" : (alignment.valid && tree.valid ? "pass" : "fail"),
    alignment, tree, error: failed, checked_rules: ["input_hash", "alignment_records", "alignment_lengths", "newick_parse", "taxa_set"] };
  await recordStep("validate_alignment", "phylogenetics.validate", null, alignment.valid ? "succeeded" : "failed",
    createdAt, nowIso(now), { validation: { records: alignment.records, lengths: alignment.lengths } });
  await recordStep("validate_tree", "phylogenetics.tree", null, tree.valid ? "succeeded" : "failed",
    createdAt, nowIso(now), { validation: { taxa: tree.taxa, missing: tree.missing, unknown: tree.unknown } });
  await recordStep("generate_report", "phylogenetics.report", null, "succeeded", createdAt, nowIso(now),
    { report_endpoint: `/api/ai/jobs/${jobIds.galaxy_iqtree}/report` });
  await audit(db, { actor: "phylo-worker", action: "phylo_workflow_completed", target: runId,
    detail: { plan_id: planId, dataset_id: datasetId, input_sha256: inputHash, status: validation.status }, timestamp: nowIso(now), idFactory });

  return jsonResponse({
    plan_id: planId, run_id: runId, dataset_id: datasetId, input_sha256: inputHash,
    job_ids: jobIds, history_id: historyId, tool_versions: {
      mafft: tools.mafft.version, iqtree: tools.iqtree.version,
      discovery_mode: capabilities.discovery_mode ?? "unavailable"
    },
    validation, provenance, execution_mode: envExecutionMode(env),
    tree_newick: treeText, alignment_text: alignmentText
  }, failed ? 502 : 200, request);
}









