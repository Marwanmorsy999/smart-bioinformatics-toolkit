// POST /api/blast/submit - validate a FASTA job and queue a remote BLAST search.

import {
  BLAST_API_URL,
  buildPutParams,
  errorResponse,
  hashInput,
  insertRequest,
  isMock,
  isValidRid,
  jsonResponse,
  mockRid,
  ncbiFetchText,
  parsePutResponse,
  preflightResponse,
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
  let rid;
  if (isMock(env)) {
    rid = mockRid(inputHash);
  } else {
    try {
      const url = `${BLAST_API_URL}?${buildPutParams(fasta, env).toString()}`;
      rid = parsePutResponse(await ncbiFetchText(url));
    } catch {
      return errorResponse("Could not submit the search to NCBI.", 502, request);
    }
    if (!isValidRid(rid)) return errorResponse("NCBI did not return a valid request ID.", 502, request);
  }

  const createdAt = new Date(now).toISOString();
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

  return jsonResponse({ rid, status: "queued" }, 200, request);
}