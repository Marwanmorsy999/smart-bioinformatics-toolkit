// POST /api/ai/plans/:id/approve - the hard gate between planning and execution.
// Jobs are created ONLY for explicitly approved steps whose consent requirements
// are satisfied. Nothing here runs a tool.

import {
  SQL,
  audit,
  envExecutionMode,
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
  validateApprovalsPayload,
  validatePlan
} from "../../_lib.js";
import {
  ALLOWED_DATABASE,
  ALLOWED_PROGRAM,
  BlastCryptoUnavailableError,
  DEFAULT_CONSENT_TTL_SECONDS,
  cryptoUnavailableResponse,
  issueBlastConsent
} from "../../../blast/_lib.js";

const DEFAULT_TIMEOUT_S = 300;

function isUniqueConflict(error) {
  return Boolean(error) && /UNIQUE|constraint/i.test(String(error.message ?? error));
}

function datasetIdFromStep(step) {
  for (const input of step.inputs ?? []) {
    if (typeof input === "string" && input.startsWith("dataset:")) return input.slice("dataset:".length);
  }
  return null;
}

export async function onRequest(context) {
  const { request, env, params } = context;
  const rejected = requireMethod(request, "POST", "POST, OPTIONS");
  if (rejected) return rejected;
  return handleApprove(request, env, params?.id, context);
}

export async function handleApprove(request, env, planId, { now = Date.now(), idFactory } = {}) {
  const { payload, error } = await readJsonBody(request);
  if (error) return errorResponse(error, 400, request);

  const checked = validateApprovalsPayload(payload);
  if (!checked.valid) return errorResponse(checked.error, 400, request);

  const db = getDb(env);
  if (!db) return errorResponse("AI database binding is unavailable.", 503, request);
  if (typeof planId !== "string" || !planId.startsWith("plan_")) {
    return errorResponse("Invalid plan id.", 400, request);
  }

  let planRow;
  try {
    planRow = await getRow(db, SQL.getPlan, [planId]);
  } catch {
    return errorResponse("Could not read the plan.", 500, request);
  }
  if (!planRow) return errorResponse("Plan not found.", 404, request);
  const plan = parseJson(planRow.plan_json);
  const planCheck = validatePlan(plan);
  if (!planCheck.valid) return errorResponse(`Stored plan is invalid: ${planCheck.error}`, 500, request);

  // Approval is a one-way gate: a repeat call returns the existing jobs rather
  // than duplicating work.
  const existing = await listRows(db, SQL.listJobsForPlan, [planId]);
  if (existing.length) {
    return jsonResponse({
      job_ids: existing.map((job) => job.public_id),
      skipped: [],
      execution_mode: envExecutionMode(env)
    }, 200, request);
  }

  const approvalByStep = new Map();
  for (const item of payload.approvals) approvalByStep.set(item.step_id, item);
  const consents = payload.consents ?? [];
  const createdAt = nowIso(now);
  const jobIds = [];
  const skipped = [];
  let blastConsent = null;
  let conflicted = false;

  // Resolve the dataset once; the MVP plan has a single FASTA-backed step.
  const datasetId = datasetIdFromStep(plan.steps[0] ?? {});
  let dataset = null;
  if (datasetId) {
    try {
      dataset = await getRow(db, SQL.getDataset, [datasetId]);
    } catch {
      return errorResponse("Could not read the dataset.", 500, request);
    }
  }

  try {
    for (const step of plan.steps) {
      const approval = approvalByStep.get(step.id);
      if (!approval) {
        skipped.push({ step_id: step.id, reason: "not_approved" });
        await audit(db, { actor: "browser", action: "ai_step_not_approved", target: planId, detail: { step_id: step.id }, timestamp: createdAt, idFactory });
        continue;
      }
      const approved = approval.approved === true
        || (approval.approved === undefined && approval.consent_granted === true);
      if (approval.approved === false || !approved) {
        skipped.push({ step_id: step.id, reason: "declined" });
        await audit(db, { actor: "browser", action: "ai_step_declined", target: planId, detail: { step_id: step.id }, timestamp: createdAt, idFactory });
        continue;
      }
      const consentGranted = approval.consent_granted === true;
      // Either flag is a data-flow gate; external_egress alone must never
      // produce a job without explicit consent.
      if ((step.external_egress === true || step.consent_required === true) && !consentGranted) {
        skipped.push({ step_id: step.id, reason: "consent_denied" });
        await audit(db, { actor: "browser", action: "ai_consent_denied", target: planId, detail: { step_id: step.id }, timestamp: createdAt, idFactory });
        continue;
      }

      const jobId = makeId("job", idFactory);
      const stepDatasetId = datasetIdFromStep(step) ?? datasetId;
      const inputs = {
        dataset_id: stepDatasetId,
        fasta_text: dataset?.fasta_text ?? "",
        filename: dataset?.filename ?? "upload.fasta",
        // Surfaced in toJobDto so the local agent sees the exact data-flow gate.
        external_egress: step.external_egress === true,
        consent_required: step.consent_required === true
      };
      const consent = { granted: consentGranted, scope: consents.length ? consents : null };
      const timeoutS = Number.isInteger(step.timeout_s) ? step.timeout_s : DEFAULT_TIMEOUT_S;

      // Claim the job row first. The additive unique (plan_id, step_id) index
      // makes this atomic; a concurrent loser conflicts and mints no token.
      try {
        await insertRow(db, SQL.insertJob, [
          jobId,
          planId,
          step.id,
          "queued",
          step.tool_id,
          JSON.stringify(step.params ?? {}),
          JSON.stringify(inputs),
          JSON.stringify(consent),
          step.backend,
          null,
          0,
          timeoutS,
          envExecutionMode(env),
          createdAt,
          null,
          null
        ]);
      } catch (error) {
        if (isUniqueConflict(error)) {
          conflicted = true;
          break;
        }
        throw error;
      }
      try {
        await insertRow(db, SQL.insertApproval, [
          makeId("apr", idFactory),
          planId,
          step.id,
          "browser",
          JSON.stringify({ consent_granted: consentGranted, consents }),
          createdAt,
          null
        ]);
      } catch (error) {
        if (isUniqueConflict(error)) {
          conflicted = true;
          break;
        }
        throw error;
      }
      await audit(db, {
        actor: "browser",
        action: "ai_job_created",
        target: jobId,
        detail: { plan_id: planId, step_id: step.id, tool_id: step.tool_id, consent_granted: consentGranted },
        timestamp: createdAt,
        idFactory
      });
      jobIds.push(jobId);

      // Token only AFTER this step's job row was atomically claimed. It binds
      // the approved dataset bytes, database and program for the legacy submit.
      if (step.external_egress === true && consentGranted && typeof dataset?.fasta_text === "string" && dataset.fasta_text.trim()) {
        try {
          const inputHash = await hashInput(dataset.fasta_text);
          const database = typeof step.params?.database === "string" ? step.params.database : ALLOWED_DATABASE;
          const program = typeof step.params?.program === "string" ? step.params.program : ALLOWED_PROGRAM;
          const token = await issueBlastConsent(db, {
            inputHash,
            database,
            program,
            granted: true,
            ttlSeconds: DEFAULT_CONSENT_TTL_SECONDS,
            now
          });
          const expiresAt = new Date(now + DEFAULT_CONSENT_TTL_SECONDS * 1000).toISOString();
          blastConsent = { token, input_hash: inputHash, database, program, expires_at: expiresAt };
          await audit(db, {
            actor: "system",
            action: "ai_blast_consent_issued",
            target: planId,
            detail: { step_id: step.id, input_hash: inputHash, database, program, expires_at: expiresAt },
            timestamp: createdAt,
            idFactory
          });
        } catch (error) {
          if (error instanceof BlastCryptoUnavailableError) return cryptoUnavailableResponse(request);
          throw error;
        }
      }
    }
    if (!conflicted && jobIds.length) {
      await audit(db, {
        actor: "browser",
        action: "ai_plan_approved",
        target: planId,
        detail: { job_ids: jobIds, skipped },
        timestamp: createdAt,
        idFactory
      });
    }
  } catch {
    return errorResponse("Could not create jobs for this plan.", 500, request);
  }

  // A unique-constraint loser is an idempotent repeat approval: return the
  // already-created jobs and no token (it must not mint a second grant).
  if (conflicted) {
    let current;
    try {
      current = await listRows(db, SQL.listJobsForPlan, [planId]);
    } catch {
      return errorResponse("Could not read the existing jobs.", 500, request);
    }
    return jsonResponse({
      job_ids: current.map((job) => job.public_id),
      skipped: [],
      execution_mode: envExecutionMode(env)
    }, 200, request);
  }

  const response = { job_ids: jobIds, skipped, execution_mode: envExecutionMode(env) };
  if (blastConsent) response.blast_consent = blastConsent;
  return jsonResponse(response, 200, request);
}
