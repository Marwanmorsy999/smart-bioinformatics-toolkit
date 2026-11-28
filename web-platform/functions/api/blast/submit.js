// POST /api/blast/submit - validate a FASTA job and queue a remote BLAST search.

import {
  BLAST_API_URL,
  BlastCryptoUnavailableError,
  auditBlastEgress,
  buildPutDiagnosticDetail,
  buildPutParams,
  classifyPutResponse,
  consentErrorResponse,
  consumeBlastConsent,
  cryptoUnavailableResponse,
  errorResponse,
  fetchPutUpstream,
  finalizeBlastAudit,
  getRequest,
  hashInput,
  insertRequest,
  isMock,
  isValidRid,
  jsonResponse,
  listRecent,
  mockRid,
  NCBI_SUBMIT_LIMIT,
  NCBI_SUBMIT_WINDOW_MS,
  preflightResponse,
  recentRealSubmissionCount,
  resolveBlastConsent,
  SUBMISSION_UNKNOWN_CODE,
  submissionRetryAfter,
  throttledResponse,
  validateDatabase,
  validateFasta,
  validateProgram
} from "./_lib.js";

const MAX_BODY_CHARS = 64 * 1024;

export async function onRequest(context) {
  const { request, env } = context;
  if (request.method === "OPTIONS") return preflightResponse(request);
  if (request.method !== "POST") {
    return errorResponse("Method not allowed. Use POST.", 405, request, { Allow: "POST, OPTIONS" });
  }
  return handleSubmit(request, env);
}

export async function handleSubmit(request, env, { now = Date.now() } = {}) {
  const raw = await request.text();
  if (raw.length > MAX_BODY_CHARS) return errorResponse("Request body is too large.", 413, request);

  let payload;
  try {
    payload = JSON.parse(raw || "{}");
  } catch {
    return errorResponse("Request body must be valid JSON.", 400, request);
  }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return errorResponse("Request body must be a JSON object.", 400, request);
  }
  if (!globalThis.crypto?.subtle || typeof globalThis.crypto?.getRandomValues !== "function") {
    return cryptoUnavailableResponse(request);
  }

  const fasta = payload.fasta ?? payload.sequence ?? payload.query;
  const fastaCheck = validateFasta(fasta);
  if (!fastaCheck.valid) return errorResponse(fastaCheck.error, 400, request);
  const databaseCheck = validateDatabase(payload.database);
  if (!databaseCheck.valid) return errorResponse(databaseCheck.error, 400, request);
  const programCheck = validateProgram(payload.program);
  if (!programCheck.valid) return errorResponse(programCheck.error, 400, request);

  const db = env && env.BLAST_DB;
  if (!db) return errorResponse("BLAST database binding is unavailable.", 503, request);

  const inputHash = await hashInput(fasta);
  const mock = isMock(env);

  // Resume-by-RID is a read-only path. When a browser refresh repeats a submit
  // with a RID it already holds, return that job without another egress and
  // without consuming the (still unused) consent token. The RID is untrusted:
  // it is only honoured when the stored input hash matches this FASTA.
  if (payload.rid !== undefined && payload.rid !== null && payload.rid !== "") {
    if (!isValidRid(payload.rid)) return errorResponse("Invalid request ID.", 400, request);
    let existing;
    try {
      existing = await getRequest(db, payload.rid);
    } catch {
      return errorResponse("BLAST database is unavailable.", 503, request);
    }
    if (!existing || existing.input_hash !== inputHash) {
      return errorResponse("The request ID does not match this FASTA.", 409, request);
    }
    return jsonResponse({ rid: existing.rid, status: existing.status, resumed: true }, 200, request);
  }

  // Global throttle for real CMD=Put submissions only. It runs BEFORE consent
  // resolution/claim so a rejected request never burns single-use consent.
  // Mock mode is distinguishable server-side and does not contact NCBI.
  // LIMITATION: this is a best-effort, non-atomic check over blast_requests;
  // no migration or counter column was added. Concurrent or unsuccessful
  // submissions can slip through, and with more than HISTORY_LIMIT submissions
  // in the window the oldest visible row makes Retry-After conservative.
  if (!mock) {
    const numericWindow = Number(env?.NCBI_SUBMIT_WINDOW_MS);
    const numericLimit = Number(env?.NCBI_SUBMIT_LIMIT);
    const windowMs = Number.isFinite(numericWindow) && numericWindow > 0 ? numericWindow : NCBI_SUBMIT_WINDOW_MS;
    const limit = Number.isInteger(numericLimit) && numericLimit > 0 ? numericLimit : NCBI_SUBMIT_LIMIT;
    let recentRows;
    try {
      recentRows = await listRecent(db);
    } catch {
      return errorResponse("BLAST database is unavailable.", 503, request);
    }
    const count = recentRealSubmissionCount(recentRows, { now, windowMs });
    if (count >= limit) {
      const retryAfter = submissionRetryAfter(recentRows, { now, windowMs, limit });
      return throttledResponse(request, retryAfter, { limit, windowMs });
    }
  }

  // Fail-closed consent gate: applies in mock mode too. A direct POST without a
  // valid, matching, unexpired and unused token never reaches this point's NCBI
  // call (and never stores a BLAST request). `resolve` supplies typed rejection
  // codes; the atomic claim below is the authority that prevents double egress.
  const consent = await resolveBlastConsent(db, payload.consent_token, {
    inputHash,
    database: payload.database,
    program: payload.program,
    now
  });
  if (!consent.valid) return consentErrorResponse(consent.code, request);

  // Claim (burn) the token BEFORE any external call. The single UPDATE enforces
  // expiry, grant, hash, database, program and unused state atomically; exactly
  // one caller can claim a token. A concurrent loser gets consent_used, and a
  // failed NCBI submission leaves the token burned rather than reusable.
  try {
    const claimed = await consumeBlastConsent(db, {
      token: payload.consent_token,
      inputHash,
      database: payload.database,
      program: payload.program,
      now
    });
    if (!claimed) return consentErrorResponse("consent_used", request);
  } catch {
    return errorResponse("Could not claim consent for this submission.", 500, request);
  }

  const createdAt = new Date(now).toISOString();
  const egressDetail = {
    actor: "browser",
    action: "blast_egress",
    target: BLAST_API_URL,
    input_hash: inputHash,
    database: payload.database,
    program: payload.program,
    payload_bytes: new TextEncoder().encode(fasta).length,
    hash_bytes: inputHash.length / 2,
    mock,
    transmitted: !mock,
    success: null,
    status: "pending",
    rtoe: null
  };
  let auditId;
  try {
    auditId = await auditBlastEgress(db, {
      actor: "browser",
      target: BLAST_API_URL,
      detail: egressDetail,
      timestamp: createdAt
    });
  } catch (error) {
    if (error instanceof BlastCryptoUnavailableError) return cryptoUnavailableResponse(request);
    return errorResponse("Could not record BLAST egress audit.", 500, request);
  }

  // One audited egress attempt. The pending row above is written first, so a
  // failure here still leaves an append-only record of the attempted action.
  // RTOE (estimated seconds to completion) is captured when NCBI returns it;
  // no sequence value is read, audited or returned. Nothing new is stored in D1.
  // An ambiguous response is NEVER auto-retried: a job may already exist at
  // NCBI, so only a valid RID can authorise a blast_requests insert.
  let rid = null;
  let rtoe = null;
  let failure = null;
  let transport = null;
  let parsed = null;
  if (mock) {
    rid = mockRid(inputHash);
  } else {
    try {
      const url = `${BLAST_API_URL}?${buildPutParams(fasta, env).toString()}`;
      transport = await fetchPutUpstream(url);
      parsed = classifyPutResponse(transport.body, {
        httpStatus: transport.httpStatus,
        contentType: transport.contentType,
        errorCode: transport.errorCode
      });
      if (parsed.accepted) {
        rid = parsed.rid;
        rtoe = Number.isFinite(parsed.rtoe) ? parsed.rtoe : null;
      } else {
        // Non-2xx means the provider signalled an error. A 2xx with no valid
        // RID is the honest ambiguous state: transmitted, no job id available.
        failure = transport.ok ? SUBMISSION_UNKNOWN_CODE : "ncbi_error";
      }
    } catch {
      // Unexpected local failure: never invent a RID or store a job.
      failure = "ncbi_error";
    }
  }
  const captureDiagnostics = Boolean(transport && parsed && (!parsed.accepted || parsed.ambiguous));
  let diagnosticDetail = null;
  if (captureDiagnostics) {
    try {
      diagnosticDetail = await buildPutDiagnosticDetail({
        transport,
        parsed,
        attemptId: auditId,
        at: createdAt
      });
    } catch {
      // Diagnostics are best-effort; the pending audit row is already durable.
    }
  }
  try {
    await finalizeBlastAudit(db, auditId, {
      ...egressDetail,
      success: failure === null,
      status: failure === null ? "succeeded" : (failure === SUBMISSION_UNKNOWN_CODE ? SUBMISSION_UNKNOWN_CODE : "failed"),
      error: failure,
      rid: failure === null ? rid : null,
      rtoe: failure === null ? rtoe : null,
      ...(diagnosticDetail ? { diagnostics: diagnosticDetail } : {})
    });
  } catch {
    // The pending audit row already holds the hash, target and byte counts.
  }
  if (failure) {
    // Only claim diagnostics were recorded when the detail really exists.
    const diagnosticsNote = diagnosticDetail ? " Diagnostic details were recorded for support." : "";
    if (failure === SUBMISSION_UNKNOWN_CODE) {
      return jsonResponse({
        error: "NCBI did not return a request ID. The platform cannot confirm whether a job was created, so no job can be tracked and no result was invented. The single-use consent was consumed and no automatic retry was made." + diagnosticsNote,
        code: SUBMISSION_UNKNOWN_CODE,
        transmitted: true,
        rid: null,
        diagnostics_available: Boolean(diagnosticDetail)
      }, 502, request);
    }
    return jsonResponse({
      error: "Could not submit the search to NCBI.",
      code: "ncbi_error",
      // A received HTTP response (including 429/5xx) proves transmission. A
      // timeout/network error does NOT: transmission stays unknown (null),
      // never overclaimed as true.
      transmitted: transport && Number.isFinite(transport.httpStatus) ? true : null,
      rid: null,
      diagnostics_available: Boolean(diagnosticDetail)
    }, 502, request);
  }

  const row = {
    rid,
    status: "queued",
    created_at: createdAt,
    last_checked_at: null,
    input_hash: inputHash,
    result_tsv: null
  };
  try {
    await insertRequest(db, row); // upsert: a repeat of the same FASTA resets that RID
  } catch {
    return errorResponse("Could not store the BLAST request.", 500, request);
  }

  // The token was already claimed before egress; nothing can un-burn it here.

  // Real NCBI branch reports RTOE when the provider returned it (numeric
  // seconds, may be null); the labelled mock branch keeps its minimal shape.
  if (mock) return jsonResponse({ rid, status: "queued" }, 200, request);
  return jsonResponse({ rid, status: "queued", rtoe }, 200, request);
}