// GET /api/ai/runs/:id/recovery — evidence-only reconstruction of a stored AI run.
//
// Read-only sibling of /api/ai/runs/:id. It NEVER calls a tool, submits a job,
// reconstructs a result from a screenshot/cache, or invents a missing value.
// Every field comes from the stored plan/job/artifact rows or is explicitly
// null with a reason. Metrics are RECOMPUTED from the original stored artifact
// content with the same honest validators the run workflow uses; they are not
// represented as a stored validation record.

import {
  SQL,
  errorResponse,
  getDb,
  getRow,
  hashInput,
  jsonResponse,
  listRows,
  parseJson,
  requireMethod,
  toArtifactDto
} from "../../_lib.js";
import {
  classifyPhyloArtifact,
  iqtreeReportExcerpt,
  parseIqtreeReport
} from "../../workflows/phylo/run.js";
import {
  computeAlignmentMetrics,
  computeTreeMetrics,
  parseNewick
} from "../../workflows/phylo/validators.js";

const REASONS = Object.freeze({
  noAlignment: "No stored artifact could be classified as an alignment; alignment_text is null.",
  noReport: "No stored artifact could be classified as an IQ-TREE report; report-derived fields are null.",
  noTree: "No parseable final tree was found in the stored artifacts or report; tree_newick is null.",
  startingTreeNotDisplayed: "This artifact is the BIONJ/starting tree, not the final maximum-likelihood tree; it is retained as evidence and not displayed.",
  noStoredValidation: "The stored run record has no validation_json; no stored validation is claimed. Metrics below were recomputed from original stored artifact content.",
  noChecksum: "No stored sha256 was present for this artifact; checksum_match is null.",
  checksumUnavailable: "SHA-256 could not be recomputed in this environment; checksum_match is null.",
  noPlan: "No stored plan row was found; plan-derived input and params are null.",
  noProvenance: "No stored provenance_json was present; provenance is null."
});

function cleanText(value, max = 500) {
  return typeof value === "string" ? value.trim().slice(0, max) : null;
}

// Sequence identifiers are ONLY first whitespace-delimited tokens of genuine
// FASTA headers in the stored alignment artifact. Never the sequence itself.
function firstTokenIdentifiers(fastaText, limit = 25) {
  const source = String(fastaText ?? "").replace(/\r\n?/g, "\n");
  const seen = new Set();
  const ids = [];
  for (const line of source.split("\n")) {
    if (!line.startsWith(">")) continue;
    const token = cleanText(line.slice(1), 200)?.split(/\s+/)[0] ?? "";
    if (!/^[A-Za-z0-9_.:|-]+$/.test(token) || seen.has(token)) continue;
    seen.add(token);
    ids.push(token);
    if (ids.length >= limit) break;
  }
  return ids;
}

function deriveWorkflowType(plan, jobs) {
  const toolText = [
    ...(Array.isArray(plan?.steps) ? plan.steps.map((step) => step?.tool_id) : []),
    ...jobs.map((job) => job?.tool_id)
  ].filter((value) => typeof value === "string").join(" ").toLowerCase();
  if (/iqtree|mafft|phylo|tree/.test(toolText) || plan?.domain === "phylogenetics"
    || /phylogenetic/.test(String(plan?.intent ?? "").toLowerCase())) return "phylo";
  if (/blastn|blast|16s|ncbi/.test(toolText) || plan?.domain === "microbiome-16s"
    || /identify_taxa/.test(String(plan?.intent ?? "").toLowerCase())) return "16s";
  return "unknown";
}

// Provider identifiers come only from explicit keys in stored result/provenance
// JSON. A generic "id" or the AI job's own public id is never re-labelled as a
// provider job id.
function genuineProviderReference(row, keys) {
  for (const sourceName of ["result_json", "provenance_json"]) {
    const parsed = parseJson(row?.[sourceName]);
    if (!parsed || typeof parsed !== "object") continue;
    for (const key of keys) {
      const value = cleanText(parsed[key], 200);
      if (value && /^[A-Za-z0-9._-]+$/.test(value)) return value;
    }
  }
  return null;
}

function parseableNewick(text) {
  const source = cleanText(text, 4000);
  if (!source) return null;
  try {
    const root = parseNewick(source);
    return root ? root : null;
  } catch {
    return null;
  }
}

function bestMatch(candidates, predicate, preferPattern) {
  const matches = candidates.filter(predicate);
  return matches.find((item) => preferPattern?.test(String(item.name ?? ""))) ?? matches[0] ?? null;
}

function buildPhyloEvidence(artifacts, reasons) {
  const classified = artifacts.map((artifact) => ({
    ...artifact,
    derived_kind: classifyPhyloArtifact(artifact).kind
  }));

  const alignment = bestMatch(classified, (item) => item.derived_kind === "alignment", /mafft|align|aligned/i);
  const alignmentText = typeof alignment?.content === "string" && alignment.content.trim() ? alignment.content : null;
  if (!alignmentText) reasons.push(REASONS.noAlignment);

  const reportCandidates = classified.filter((item) => {
    if (item.derived_kind !== "report") return false;
    return parseIqtreeReport(item.content).available;
  });
  const report = bestMatch(reportCandidates, () => true, /iqtree/i);
  const reportText = typeof report?.content === "string" && report.content.trim() ? report.content : null;
  if (!reportText) reasons.push(REASONS.noReport);
  const parsedReport = reportText ? parseIqtreeReport(reportText) : null;

  const treeCandidates = classified.filter((item) => item.derived_kind === "tree");
  const startingTrees = treeCandidates
    .filter((item) => /bionj|starting/i.test(String(item.name ?? "")))
    .map((item) => ({ name: item.name, sha256: item.sha256, bytes: item.bytes,
      source_role: "starting_tree_not_displayed", reason: REASONS.startingTreeNotDisplayed }));
  const finalTree = parsedReport?.final_tree ?? null;
  const displayCandidates = treeCandidates.filter((item) => !/bionj|starting/i.test(String(item.name ?? "")));
  let chosen = null;
  let treeSource = null;
  if (finalTree) {
    const identical = displayCandidates.find((item) => cleanText(item.content, 4000) === finalTree);
    if (identical) {
      chosen = { text: finalTree, artifact: identical };
      treeSource = "iqtree_report_final_tree_byte_identical_to_stored_artifact";
    }
  }
  if (!chosen) {
    const maxLikelihood = displayCandidates.find((item) => /maxlikelihood|max_likelihood|ml_tree/i.test(String(item.name ?? "")));
    if (maxLikelihood && parseableNewick(maxLikelihood.content)) {
      chosen = { text: cleanText(maxLikelihood.content, 4000), artifact: maxLikelihood };
      treeSource = "iqtree_maxlikelihood_artifact";
    }
  }
  if (!chosen && finalTree && parseableNewick(finalTree)) {
    chosen = { text: finalTree, artifact: null };
    treeSource = "iqtree_report_final_tree";
  }
  if (!chosen) {
    // Prefer an ML/treefile candidate over an unlabelled download; BIONJ and
    // other starting trees were already excluded from displayCandidates.
    const fallback = displayCandidates.find((item) => /maxlikelihood|ml|treefile|newick/i.test(String(item.name ?? ""))
      && parseableNewick(item.content))
      ?? displayCandidates.find((item) => parseableNewick(item.content));
    if (fallback) {
      chosen = { text: cleanText(fallback.content, 4000), artifact: fallback };
      treeSource = "stored_treefile_artifact";
    }
  }
  if (!chosen) reasons.push(REASONS.noTree);

  const metrics = { basis: "recomputed_from_original_stored_artifacts", alignment: null, tree: null };
  if (alignmentText) {
    try {
      metrics.alignment = computeAlignmentMetrics(alignmentText);
    } catch (error) {
      reasons.push(`alignment_metrics_recompute_failed: ${error?.message ?? error}`);
    }
  }
  if (chosen?.text) {
    const root = parseableNewick(chosen.text);
    if (root) {
      try {
        metrics.tree = computeTreeMetrics(root);
      } catch (error) {
        reasons.push(`tree_metrics_recompute_failed: ${error?.message ?? error}`);
      }
    }
  }

  return {
    alignment_text: alignmentText,
    alignment_artifact: alignment ? { name: alignment.name, sha256: alignment.sha256, bytes: alignment.bytes } : null,
    tree_newick: chosen?.text ?? null,
    tree_source: treeSource,
    tree_artifact: chosen?.artifact
      ? { name: chosen.artifact.name, sha256: chosen.artifact.sha256, bytes: chosen.artifact.bytes } : null,
    starting_trees: startingTrees,
    iqtree_report: reportText,
    iqtree_report_excerpt: reportText ? iqtreeReportExcerpt(reportText) : null,
    iqtree_report_artifact: report ? { name: report.name, sha256: report.sha256, bytes: report.bytes } : null,
    report_fields: {
      model: parsedReport?.model ?? null,
      log_likelihood: parsedReport?.log_likelihood ?? null,
      support: parsedReport?.support ?? null,
      support_settings: parsedReport?.support_settings ?? [],
      rooting_note: parsedReport?.rooting_note ?? null
    },
    metrics,
    sequence_identifiers: alignmentText ? firstTokenIdentifiers(alignmentText) : [],
    sequence_identifier_basis: alignmentText ? "first_token_of_stored_alignment_headers" : null
  };
}

export async function handleGetRecovery(request, env, runId) {
  const db = getDb(env);
  if (!db) return errorResponse("AI database binding is unavailable.", 503, request);
  if (typeof runId !== "string" || !runId.startsWith("job_")) {
    return errorResponse("Invalid run id.", 400, request);
  }

  try {
    const jobRow = await getRow(db, SQL.getJob, [runId]);
    if (!jobRow) return errorResponse("Run not found.", 404, request);
    const planRow = await getRow(db, SQL.getPlan, [jobRow.plan_id]);
    const jobRows = await listRows(db, SQL.listJobsForPlan, [jobRow.plan_id]);
    const artifactRows = await listRows(db, SQL.listArtifactsForRun, [runId]);
    const reasons = [];

    const jobs = jobRows.map((row) => ({
      id: row.public_id,
      step_id: row.step_id ?? null,
      tool_id: row.tool_id ?? null,
      status: row.status ?? "unknown",
      backend: row.backend ?? null,
      execution_mode: row.execution_mode ?? "real",
      created_at: row.created_at ?? null,
      started_at: row.started_at ?? null,
      finished_at: row.finished_at ?? null,
      provider_job_id: genuineProviderReference(row, ["provider_job_id", "galaxy_job_id", "remote_job_id"]),
      history_id: genuineProviderReference(row, ["history_id", "provider_history_id"])
    }));

    const artifacts = [];
    for (const row of artifactRows) {
      const dto = toArtifactDto(row);
      const stored = typeof dto.sha256 === "string" ? dto.sha256.toLowerCase() : null;
      let checksumMatch = null;
      if (!stored || !/^[0-9a-f]{64}$/.test(stored)) {
        reasons.push(`${dto.name}: ${REASONS.noChecksum}`);
      } else {
        try {
          const computed = await hashInput(dto.content ?? "");
          checksumMatch = computed === stored;
          if (!checksumMatch) reasons.push(`${dto.name}: stored_sha256_does_not_match_stored_content`);
        } catch {
          reasons.push(`${dto.name}: ${REASONS.checksumUnavailable}`);
        }
      }
      artifacts.push({ ...dto, derived_kind: classifyPhyloArtifact(dto).kind, checksum_match: checksumMatch });
    }

    const plan = planRow ? parseJson(planRow.plan_json) : null;
    if (!plan) reasons.push(REASONS.noPlan);
    const storedValidation = parseJson(jobRow.validation_json);
    if (!storedValidation) reasons.push(REASONS.noStoredValidation);
    const provenance = parseJson(jobRow.provenance_json);
    if (!provenance) reasons.push(REASONS.noProvenance);

    const workflowType = deriveWorkflowType(plan, jobs);
    const phylo = workflowType === "phylo"
      ? buildPhyloEvidence(artifacts, reasons)
      : {
        alignment_text: null, tree_newick: null, tree_source: null, iqtree_report: null,
        iqtree_report_excerpt: null, starting_trees: [], metrics: { basis: null, alignment: null, tree: null },
        sequence_identifiers: [], sequence_identifier_basis: null,
        reason: "This stored run is not a phylogenetics run; no phylo fields are reconstructed."
      };

    const datasetIds = [];
    for (const job of jobRows) {
      const inputs = parseJson(job.inputs_json);
      if (typeof inputs?.dataset_id === "string" && !datasetIds.includes(inputs.dataset_id)) {
        datasetIds.push(inputs.dataset_id);
      }
    }

    return jsonResponse({
      run_id: runId,
      workflow_type: workflowType,
      workflow_type_basis: plan ? "stored_plan_steps_and_job_tool_ids" : "stored_job_tool_ids",
      status: jobRow.status ?? "unknown",
      created_at: jobRow.created_at ?? planRow?.created_at ?? null,
      finished_at: jobRow.finished_at ?? null,
      execution_mode: jobRow.execution_mode ?? "real",
      plan_id: jobRow.plan_id ?? null,
      input: {
        objective: cleanText(plan?.goal, 1000),
        dataset_ids: datasetIds,
        sequence_identifiers: phylo.sequence_identifiers,
        sequence_identifier_basis: phylo.sequence_identifier_basis,
        source: plan ? "stored_plan_and_job_inputs" : null
      },
      params: {
        plan_steps: Array.isArray(plan?.steps)
          ? plan.steps.map((step) => ({ id: step?.id ?? null, tool_id: step?.tool_id ?? null, order: step?.order ?? null }))
          : null,
        job_params: jobRows.map((row) => ({ id: row.public_id, tool_id: row.tool_id ?? null, params: parseJson(row.params_json) })),
        source: plan ? "stored_plan_steps_and_job_params" : "stored_job_params"
      },
      jobs,
      artifacts,
      provenance,
      validation: storedValidation,
      validation_source: storedValidation ? "stored_validation_json" : null,
      validation_reason: storedValidation ? null : REASONS.noStoredValidation,
      phylo,
      recovery_basis: "original_stored_ai_run_record",
      evidence_only: true,
      unavailable_reasons: reasons,
      report_url: `/api/ai/runs/${runId}/report`,
      provenance_url: `/api/ai/runs/${runId}/provenance`
    }, 200, request);
  } catch {
    return errorResponse("Could not read the run recovery record.", 500, request);
  }
}

export async function onRequest(context) {
  const { request, env, params } = context;
  const rejected = requireMethod(request, "GET", "GET, OPTIONS");
  if (rejected) return rejected;
  return handleGetRecovery(request, env, params?.id);
}
