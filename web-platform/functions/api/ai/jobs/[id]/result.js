// POST /api/ai/jobs/:id/result - authenticated agent result submission.
// Stores artifacts/provenance/validation/explanation, verifies artifact hashes,
// assembles a self-contained HTML report and closes the job. No compute here.

import {
  MAX_RESULT_BODY_CHARS,
  SQL,
  agentTokenError,
  audit,
  computeExecutionMode,
  errorResponse,
  getDb,
  getRow,
  hashInput,
  insertRow,
  jsonResponse,
  listRows,
  makeId,
  nowIso,
  parseJson,
  readJsonBody,
  requireMethod,
  runStatement,
  validateResultShape
} from "../../_lib.js";
import { projectExplanationReferences } from "../../reference_ledger.js";
import { deriveLocalityReceipt } from "../../worker_locality.js";
import { deriveEducationNotes } from "../../worker_education.js";
import { buildReportHtml } from "../../report.js";

export async function onRequest(context) {
  const { request, env, params } = context;
  const rejected = requireMethod(request, "POST", "POST, OPTIONS");
  if (rejected) return rejected;
  return handleSubmitResult(request, env, params?.id, context);
}

export async function handleSubmitResult(request, env, jobId, { now = Date.now(), idFactory } = {}) {
  const unauthorized = agentTokenError(request, env);
  if (unauthorized) return unauthorized;

  if (typeof jobId !== "string" || !jobId.startsWith("job_")) {
    return errorResponse("Invalid job id.", 400, request);
  }

  const { payload, error } = await readJsonBody(request, MAX_RESULT_BODY_CHARS);
  if (error) return errorResponse(error, 400, request);

  const checked = validateResultShape(payload, jobId);
  if (!checked.valid) return errorResponse(checked.error, 400, request);

  const db = getDb(env);
  if (!db) return errorResponse("AI database binding is unavailable.", 503, request);

  let jobRow;
  try {
    jobRow = await getRow(db, SQL.getJob, [jobId]);
  } catch {
    return errorResponse("Could not read the job.", 500, request);
  }
  if (!jobRow) return errorResponse("Job not found.", 404, request);
  if (["succeeded", "failed"].includes(jobRow.status)) {
    return errorResponse("Job already has a result.", 409, request);
  }
  // Results are accepted only from an agent that actually polled and claimed
  // this job. A queued/unclaimed job cannot produce a result out of thin air.
  if (jobRow.status !== "running" || typeof jobRow.agent_id !== "string" || !jobRow.agent_id.trim()) {
    return errorResponse("Job must be claimed (running) before a result is submitted.", 409, request);
  }
  if (payload.provenance.run_id !== jobId) {
    return errorResponse("provenance.run_id does not match the job.", 400, request);
  }
  if (payload.provenance.tool.id !== jobRow.tool_id) {
    return errorResponse("provenance.tool.id does not match the job.", 400, request);
  }

  for (const artifact of payload.artifacts) {
    let digest;
    try {
      digest = await hashInput(artifact.content);
    } catch {
      return errorResponse("Could not verify artifact hash.", 500, request);
    }
    if (digest !== artifact.sha256) {
      return errorResponse(`Artifact hash mismatch: ${artifact.name}`, 400, request);
    }
  }

  const createdAt = nowIso(now);
  const mode = computeExecutionMode(payload, env);
  const validation = { ...payload.validation, flags: [...payload.validation.flags] };
  if (mode === "mock") {
    validation.flags.push("Results were produced in mock mode; not valid for scientific conclusions.");
    if (validation.status === "pass") validation.status = "warn";
  }
  const failed = payload.status === "failed" || validation.status === "fail";
  const jobStatus = failed ? "failed" : "succeeded";

  let planRow = null;
  let auditRows = [];
  let approvalRows = [];
  try {
    planRow = await getRow(db, SQL.getPlan, [jobRow.plan_id]);
    auditRows = await listRows(db, SQL.listAuditEvents, []);
    approvalRows = await listRows(db, SQL.listApprovalsForPlan, [jobRow.plan_id]);
  } catch {
    return errorResponse("Could not read the job context.", 500, request);
  }
  const plan = planRow ? parseJson(planRow.plan_json) : null;

  // Rebuild every trust-boundary claim from authoritative rows. Caller copies
  // in provenance.locality_receipt / explanation.education are never persisted
  // or rendered: the receipt is derived from the job, approvals and audits,
  // the education notes from validation.flags, and citations from the ledger.
  const inputs = parseJson(jobRow.inputs_json) ?? {};
  let inputHash = null;
  if (typeof inputs.fasta_text === "string" && inputs.fasta_text.trim()) {
    try {
      inputHash = await hashInput(inputs.fasta_text);
    } catch {
      inputHash = null;
    }
  }
  const localityReceipt = deriveLocalityReceipt({
    jobRow: { ...jobRow, external_services: Array.isArray(plan?.external_services) ? plan.external_services : [] },
    auditRows,
    approvalRows,
    mode,
    inputHash
  });
  const education = deriveEducationNotes(validation);
  const references = projectExplanationReferences(payload.explanation.references);
  const explanation = { ...payload.explanation, references, education };
  // Persist the authoritative mode everywhere, not only in the job row.
  const provenance = { ...payload.provenance, execution_mode: mode, locality_receipt: localityReceipt };

  const reportUrl = `/api/ai/runs/${jobId}/report`;
  const provenanceUrl = `/api/ai/runs/${jobId}/provenance`;
  const reportHtml = buildReportHtml({
    job: { ...jobRow, status: jobStatus },
    plan,
    artifacts: payload.artifacts,
    validation,
    explanation,
    provenance,
    mode,
    createdAt,
    localityReceipt,
    education
  });
  const reportMeta = {
    report_url: reportUrl,
    provenance_url: provenanceUrl,
    built_at: createdAt,
    execution_mode: mode
  };

  // Close the job atomically before writing anything else. Two agents can both
  // read `running` (TOCTOU); only the one whose conditional UPDATE changes a
  // row may insert artifacts/report/tool_run/audit. The loser gets a 409.
  let saved;
  try {
    saved = await runStatement(db, SQL.saveJobResult, [
      jobStatus,
      createdAt,
      JSON.stringify({ ...payload, execution_mode: mode, provenance, explanation }),
      JSON.stringify(validation),
      JSON.stringify(explanation),
      JSON.stringify(provenance),
      JSON.stringify(reportMeta),
      mode,
      jobId,
      "running"
    ]);
  } catch {
    return errorResponse("Could not update the job.", 500, request);
  }
  if ((saved?.meta?.changes ?? 0) !== 1) {
    return errorResponse("Job result was already submitted concurrently.", 409, request);
  }

  try {
    for (const artifact of payload.artifacts) {
      await insertRow(db, SQL.insertArtifact, [
        makeId("art", idFactory),
        jobId,
        artifact.name,
        artifact.kind,
        `d1://artifacts/${jobId}/${artifact.name}`,
        artifact.sha256,
        new TextEncoder().encode(artifact.content).length,
        artifact.kind === "json" ? "application/json" : "text/plain",
        artifact.content,
        createdAt
      ]);
    }
    await insertRow(db, SQL.insertToolRun, [
      makeId("trn", idFactory),
      jobId,
      payload.provenance.tool.id,
      payload.provenance.tool.version ?? null,
      JSON.stringify(provenance.parameters),
      JSON.stringify([`dataset:${provenance.input.dataset_id}`]),
      JSON.stringify(payload.artifacts.map((artifact) => artifact.name)),
      JSON.stringify(provenance),
      payload.provenance.timing?.started_at ?? null,
      payload.provenance.timing?.finished_at ?? null
    ]);
    for (const reference of references) {
      // Verified status comes from the ledger, never from the submitted flag.
      await insertRow(db, SQL.insertReference, [
        makeId("ref", idFactory),
        reference.key,
        reference.title,
        reference.url,
        null,
        null,
        "ledger",
        createdAt,
        null,
        1
      ]);
    }
    await insertRow(db, SQL.insertReportRun, [
      makeId("run", idFactory),
      jobRow.plan_id,
      jobId,
      reportUrl,
      `d1://explanation/${jobId}`,
      `d1://validation/${jobId}`,
      reportHtml,
      createdAt
    ]);
    await audit(db, {
      actor: "agent",
      action: failed ? "ai_result_failed" : "ai_result_succeeded",
      target: jobId,
      detail: { execution_mode: mode, validation: validation.status, artifact_count: payload.artifacts.length },
      timestamp: createdAt,
      idFactory
    });
  } catch {
    return errorResponse("Could not store the result.", 500, request);
  }

  return jsonResponse({ job_id: jobId, status: jobStatus, execution_mode: mode, report_url: reportUrl }, 200, request);
}
