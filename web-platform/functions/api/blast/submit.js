// POST /api/blast/submit - validate a FASTA job and queue a remote BLAST search.

import {
  BLAST_API_URL,
  BlastCryptoUnavailableError,
  auditBlastEgress,
  buildPutParams,
  consentErrorResponse,
  consumeBlastConsent,
  cryptoUnavailableResponse,
  errorResponse,
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
  ncbiFetchText,
  parsePutResponse,
  preflightResponse,
  recentRealSubmissionCount,
  resolveBlastConsent,
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
    status: "pending"
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
  let rid = null;
  let failure = null;
  if (mock) {
    rid = mockRid(inputHash);
  } else {
    try {
      const url = `${BLAST_API_URL}?${buildPutParams(fasta, env).toString()}`;
      rid = parsePutResponse(await ncbiFetchText(url));
      if (!isValidRid(rid)) failure = "invalid_rid";
    } catch {
      failure = "ncbi_error";
    }
  }
  try {
    await finalizeBlastAudit(db, auditId, {
      ...egressDetail,
      success: failure === null,
      status: failure === null ? "succeeded" : "failed",
      error: failure,
      rid: failure === null ? rid : null
    });
  } catch {
    // The pending audit row already holds the hash, target and byte counts.
  }
  if (failure) {
    return errorResponse(
      failure === "invalid_rid" ? "NCBI did not return a valid request ID." : "Could not submit the search to NCBI.",
      502,
      request
    );
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

  return jsonResponse({ rid, status: "queued" }, 200, request);
}