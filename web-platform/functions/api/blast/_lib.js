// Shared helpers for the remote BLAST Pages Functions.
// Plain ES modules: no frameworks, no R2, no paid services, no secrets in code or logs.

export const BLAST_API_URL = "https://blast.ncbi.nlm.nih.gov/Blast.cgi";
// NCBI's current BLAST form submits this value for "16S ribosomal RNA
// sequences (Bacteria and Archaea)". The bare legacy name is not a valid
// database on the provider (it produced a failed job with no alias/index).
export const ALLOWED_DATABASE = "rRNA_typestrains/16S_ribosomal_RNA";
export const DATABASE_LABEL = "16S ribosomal RNA sequences (Bacteria and Archaea)";
export const LEGACY_DATABASE_LABEL = "16S_ribosomal_RNA";
export const ALLOWED_PROGRAM = "blastn";
export const MAX_FASTA_CHARS = 10000;
export const POLL_INTERVAL_MS = 60000;
export const HISTORY_LIMIT = 20;
export const MOCK_RID_PREFIX = "MOCK";
export const DEFAULT_CONSENT_TTL_SECONDS = 15 * 60;

// Server-enforced global throttle for real NCBI CMD=Put submissions. It reuses
// blast_requests.created_at and the existing request list; no new table/column.
export const NCBI_SUBMIT_WINDOW_MS = 60 * 1000;
export const NCBI_SUBMIT_LIMIT = 10;
export const NCBI_FETCH_TIMEOUT_MS = 15 * 1000;
export const QBLAST_PARSER_SCHEMA = "qblast-strict-1";

// IUPAC nucleotide codes (DNA + RNA ambiguity symbols), case-insensitive.
const SEQUENCE_ALPHABET = /^[ACGTURYSWKMBDHVN]+$/i;
const RID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

// SQL is centralised so the D1 mock in tests can assert exactly what runs.
export const SQL = {
  selectByRid: "SELECT rid, status, created_at, last_checked_at, input_hash, result_tsv FROM blast_requests WHERE rid = ?",
  selectRecent: "SELECT rid, status, created_at FROM blast_requests ORDER BY created_at DESC LIMIT ?",
  insert: "INSERT INTO blast_requests (rid, status, created_at, last_checked_at, input_hash, result_tsv) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(rid) DO UPDATE SET status = excluded.status, created_at = excluded.created_at, last_checked_at = excluded.last_checked_at, input_hash = excluded.input_hash, result_tsv = excluded.result_tsv",
  updateStatus: "UPDATE blast_requests SET status = ?, last_checked_at = ? WHERE rid = ?",
  cacheResults: "UPDATE blast_requests SET result_tsv = ?, status = 'complete' WHERE rid = ?",
  selectConsentByToken: "SELECT token, input_hash, database, program, granted, expires_at, created_at, used_at FROM blast_consents WHERE token = ?",
  insertConsent: "INSERT INTO blast_consents (token, input_hash, database, program, granted, expires_at, created_at, used_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
  // Atomic single-use claim. The binding order is [used_at, now_iso, token,
  // input_hash, database, program] so every eligibility predicate lives in the
  // same statement that flips used_at; a second claimant sees zero rows changed.
  claimConsent: "UPDATE blast_consents SET used_at = ? WHERE expires_at > ? AND token = ? AND used_at IS NULL AND granted = 1 AND input_hash = ? AND database = ? AND program = ?",
  // Append-only audit of the actual egress, using the 0002 audit_events schema.
  insertBlastAudit: "INSERT INTO audit_events (public_id, actor, action, target, detail_json, timestamp) VALUES (?, ?, ?, ?, ?, ?)",
  updateBlastAudit: "UPDATE audit_events SET detail_json = ? WHERE public_id = ?",
  // Earliest original-retrieval record for a RID. audit_events has no
  // created_at column in the 0002 schema: its `timestamp` IS the creation time.
  selectBlastRetrieval: "SELECT public_id, detail_json, timestamp FROM audit_events WHERE action = ? AND target = ? ORDER BY timestamp ASC LIMIT 1"
};

export const BLAST_RETRIEVAL_ACTION = "blast_result_retrieval";

// A deliberately synthetic, clearly labelled result used only when MOCK_NCBI=1.
// Matches the 12-column blastn_local_v1 schema understood by public/js/blast.js.
export const MOCK_TSV = [
  "# blastn_local_v1 MOCK DATA - synthetic, not from NCBI. Do not use for biological conclusions.",
  "qseqid\tsacc\tstaxids\tsscinames\tpident\tlength\tqstart\tqend\tqlen\tevalue\tbitscore\tqcovs",
  "mock_q1\tMOCK000001\t999999\tSynthetic mock organism\t100.0\t100\t1\t100\t100\t1e-50\t200\t100"
].join("\n") + "\n";

export function htmlEscape(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function isMock(env) {
  const fromEnv = env && env.MOCK_NCBI;
  const fromProcess = typeof process !== "undefined" && process.env ? process.env.MOCK_NCBI : undefined;
  return fromEnv === "1" || fromEnv === 1 || fromEnv === true || fromProcess === "1";
}

export function mockRid(inputHash) {
  const hex = String(inputHash || "").replace(/[^0-9a-f]/gi, "").slice(0, 16).toUpperCase();
  return MOCK_RID_PREFIX + hex;
}

export function isValidRid(rid) {
  return typeof rid === "string" && RID_PATTERN.test(rid);
}

export function validateFasta(input) {
  if (typeof input !== "string") return { valid: false, error: "FASTA input must be text." };
  const fasta = input.replace(/\r\n?/g, "\n");
  if (!fasta.trim()) return { valid: false, error: "FASTA input is empty." };
  if (fasta.length > MAX_FASTA_CHARS) {
    return { valid: false, error: `FASTA input exceeds the ${MAX_FASTA_CHARS} character limit.` };
  }

  const lines = fasta.split("\n");
  if (!lines[0].trim().startsWith(">")) {
    return { valid: false, error: "FASTA input must start with a '>' header line." };
  }

  let records = 0;
  let sequenceCharacters = 0;
  let currentHasSequence = false;

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i].trim();
    if (!line) continue;
    if (line.startsWith(">")) {
      if (records > 0 && !currentHasSequence) {
        return { valid: false, error: `FASTA record ${records} has no sequence data.` };
      }
      if (line.length === 1) {
        return { valid: false, error: `FASTA record ${records + 1} has an empty header.` };
      }
      records += 1;
      currentHasSequence = false;
      continue;
    }
    if (records === 0) return { valid: false, error: "FASTA input must start with a '>' header line." };
    const sequence = line.replace(/\s+/g, "");
    if (!sequence) continue;
    if (!SEQUENCE_ALPHABET.test(sequence)) {
      return {
        valid: false,
        error: `Invalid nucleotide character in FASTA record ${records} on line ${i + 1}. Only ACGT/IUPAC codes are allowed.`
      };
    }
    currentHasSequence = true;
    sequenceCharacters += sequence.length;
  }

  if (records === 0) return { valid: false, error: "FASTA input must contain at least one record." };
  if (!currentHasSequence) {
    return { valid: false, error: `FASTA record ${records} has no sequence data.` };
  }
  return { valid: true, error: null, records, sequence_characters: sequenceCharacters };
}

export function validateDatabase(value) {
  if (value !== ALLOWED_DATABASE) {
    return {
      valid: false,
      error: `database must be exactly "${ALLOWED_DATABASE}" (${DATABASE_LABEL}, previously named "${LEGACY_DATABASE_LABEL}").`
    };
  }
  return { valid: true, error: null };
}

export function validateProgram(value) {
  if (value !== ALLOWED_PROGRAM) {
    return { valid: false, error: `program must be exactly "${ALLOWED_PROGRAM}".` };
  }
  return { valid: true, error: null };
}

export async function hashInput(input) {
  const bytes = new TextEncoder().encode(String(input));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

// ------------------------------------------------------------ consent gate
// A consent token binds exactly one (input hash, database, program) triple to
// one external transmission. It has a short TTL and is single-use. The token
// never appears in a URL, log or NCBI request.

export const BLAST_CONSENT_ERRORS = Object.freeze({
  consent_missing: "A consent token is required for remote BLAST submission.",
  consent_invalid: "The consent token is invalid.",
  consent_not_granted: "Consent was not granted for this submission.",
  consent_used: "The consent token has already been used.",
  consent_expired: "The consent token has expired.",
  consent_mismatch: "The consent token does not match the submitted FASTA, database or program.",
  consent_unavailable: "Consent could not be verified."
});

// Tokens must be unpredictable: never fall back to Math.random(). Absence of
// Web Crypto is a fail-closed 503, surfaced as BlastCryptoUnavailableError.
export class BlastCryptoUnavailableError extends Error {
  constructor() {
    super("Web Crypto getRandomValues is unavailable.");
    this.name = "BlastCryptoUnavailableError";
  }
}

function randomHex(byteLength) {
  if (!globalThis.crypto || typeof globalThis.crypto.getRandomValues !== "function") {
    throw new BlastCryptoUnavailableError();
  }
  const bytes = new Uint8Array(byteLength);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export function makeConsentToken() {
  return "consent_" + randomHex(16);
}

export function cryptoUnavailableResponse(request = null) {
  return jsonResponse({
    error: htmlEscape("Secure token generation is unavailable."),
    code: "crypto_unavailable"
  }, 503, request);
}

export async function issueBlastConsent(db, {
  inputHash,
  database,
  program,
  granted = true,
  ttlSeconds = DEFAULT_CONSENT_TTL_SECONDS,
  now = Date.now()
} = {}) {
  if (!db) throw new Error("D1 binding is unavailable for consent issuance.");
  const numericTtl = Number(ttlSeconds);
  const ttl = Number.isFinite(numericTtl) ? Math.max(0, numericTtl) : DEFAULT_CONSENT_TTL_SECONDS;
  const createdAt = new Date(now).toISOString();
  const expiresAt = new Date(now + ttl * 1000).toISOString();
  const token = makeConsentToken();
  await db.prepare(SQL.insertConsent).bind(
    token,
    String(inputHash ?? ""),
    String(database ?? ""),
    String(program ?? ""),
    granted ? 1 : 0,
    expiresAt,
    createdAt,
    null
  ).run();
  return token;
}

// Fail-closed resolution: any unknown, denied, expired, consumed or mismatched
// token yields a typed code; the caller maps it to a 403 response.
export async function resolveBlastConsent(db, token, {
  inputHash,
  database,
  program,
  now = Date.now()
} = {}) {
  if (!db) return { valid: false, code: "consent_unavailable", row: null };
  if (typeof token !== "string" || !token.trim()) return { valid: false, code: "consent_missing", row: null };
  let row;
  try {
    const result = await db.prepare(SQL.selectConsentByToken).bind(token).all();
    row = result.results?.[0] ?? null;
  } catch {
    return { valid: false, code: "consent_unavailable", row: null };
  }
  if (!row) return { valid: false, code: "consent_invalid", row: null };
  if (row.granted !== 1 && row.granted !== true) return { valid: false, code: "consent_not_granted", row };
  if (row.used_at) return { valid: false, code: "consent_used", row };
  const expiresAt = Date.parse(row.expires_at);
  if (!Number.isFinite(expiresAt) || expiresAt <= now) return { valid: false, code: "consent_expired", row };
  if (row.input_hash !== inputHash || row.database !== database || row.program !== program) {
    return { valid: false, code: "consent_mismatch", row };
  }
  return { valid: true, code: null, row };
}

// Atomic single-use claim. Expiry, grant, hash, database, program and the
// unused predicate are all enforced by the same UPDATE, so concurrent callers
// cannot both claim one token. A failed claim returns false and the caller must
// fail closed; a successful claim is never released, even if egress fails.
export async function consumeBlastConsent(db, {
  token,
  inputHash,
  database,
  program,
  now = Date.now()
} = {}) {
  if (!db || typeof token !== "string") return false;
  const timestamp = new Date(now).toISOString();
  const result = await db.prepare(SQL.claimConsent).bind(
    timestamp,
    timestamp,
    token,
    String(inputHash ?? ""),
    String(database ?? ""),
    String(program ?? "")
  ).run();
  return (result?.meta?.changes ?? 0) === 1;
}

export function consentErrorResponse(code, request = null) {
  const message = BLAST_CONSENT_ERRORS[code] ?? BLAST_CONSENT_ERRORS.consent_invalid;
  return jsonResponse({ error: htmlEscape(message), code }, 403, request);
}

// The audit row is opened BEFORE egress and finalised afterwards. If the audit
// write fails, no external call is made. Only hashes/counts are recorded — the
// FASTA value itself is never written to audit_events.
export async function auditBlastEgress(db, {
  actor = "browser",
  target = BLAST_API_URL,
  action = "blast_egress",
  detail = {},
  timestamp = new Date().toISOString(),
  idFactory
} = {}) {
  const publicId = typeof idFactory === "function" ? idFactory("aud") : `aud_${randomHex(8)}`;
  await db.prepare(SQL.insertBlastAudit).bind(
    publicId,
    String(actor),
    action,
    String(target),
    JSON.stringify(detail),
    timestamp
  ).run();
  return publicId;
}

export async function finalizeBlastAudit(db, publicId, detail) {
  await db.prepare(SQL.updateBlastAudit).bind(JSON.stringify(detail), publicId).run();
}

// Original retrieval time is persisted WITHOUT a schema migration by reusing
// the append-only audit_events table: one row per RID, action=blast_result_retrieval
// and target=RID. Only metadata is stored (RID, timestamp, hash, format); the
// FASTA/TSV body and any credentials are never written to the audit record.
export async function recordBlastRetrieval(db, { rid, retrievedAt, sha256, resultFormat, idFactory } = {}) {
  return auditBlastEgress(db, {
    actor: "system",
    target: rid,
    action: BLAST_RETRIEVAL_ACTION,
    detail: {
      rid,
      retrieved_at: retrievedAt,
      sha256,
      result_format: resultFormat,
      kind: "original_retrieval"
    },
    timestamp: retrievedAt,
    idFactory
  });
}

// Read-only: the first record wins. On a later cache update this still returns
// the ORIGINAL retrieval time, never the current time.
export async function earliestBlastRetrieval(db, rid) {
  const result = await db.prepare(SQL.selectBlastRetrieval).bind(BLAST_RETRIEVAL_ACTION, rid).all();
  const row = result.results?.[0];
  if (!row) return null;
  let detail = {};
  try { detail = JSON.parse(row.detail_json ?? "{}"); } catch { return null; }
  if (!detail || typeof detail !== "object" || Array.isArray(detail)) return null;
  const retrievedAt = typeof detail.retrieved_at === "string" && detail.retrieved_at ? detail.retrieved_at : null;
  if (!retrievedAt) return null;
  return {
    public_id: row.public_id,
    retrieved_at: retrievedAt,
    sha256: typeof detail.sha256 === "string" ? detail.sha256 : null,
    result_format: typeof detail.result_format === "string" ? detail.result_format : null
  };
}

function withIdentification(params, env) {
  const tool = env && env.NCBI_TOOL;
  const email = env && env.NCBI_EMAIL;
  if (tool) params.set("tool", String(tool));
  if (email) params.set("email", String(email));
  return params;
}

export function buildPutParams(fasta, env) {
  const params = new URLSearchParams();
  params.set("CMD", "Put");
  params.set("QUERY", fasta);
  params.set("DATABASE", ALLOWED_DATABASE);
  params.set("PROGRAM", ALLOWED_PROGRAM);
  params.set("MEGABLAST", "on");
  params.set("EXPECT", "1e-10");
  params.set("HITLIST_SIZE", "50");
  params.set("FILTER", "F");
  params.set("FORMAT_TYPE", "Text");
  return withIdentification(params, env);
}

export function buildStatusParams(rid, env) {
  const params = new URLSearchParams();
  params.set("CMD", "Get");
  params.set("RID", rid);
  return withIdentification(params, env);
}

// CMD=Get results retrieval. The default stays the verified 12-column tabular
// report (byte-for-byte unchanged). `format: "json2"` selects the officially
// supported FORMAT_TYPE=JSON2 report and deliberately omits ALIGNMENT_VIEW,
// which is only meaningful for the tabular Text report.
export function buildResultsParams(rid, env, { format } = {}) {
  const params = new URLSearchParams();
  params.set("CMD", "Get");
  params.set("RID", rid);
  if (format === "json2") {
    params.set("FORMAT_TYPE", "JSON2");
  } else {
    params.set("FORMAT_TYPE", "Text");
    params.set("ALIGNMENT_VIEW", "Tabular");
  }
  return withIdentification(params, env);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// GET-only NCBI calls. Retries 429/5xx and network failures with backoff.
// The URL is never logged: a CMD=Put URL contains the user's FASTA.
export async function ncbiFetchText(url, { fetchImpl, delays = [0, 250, 500] } = {}) {
  const doFetch = fetchImpl || globalThis.fetch;
  if (typeof doFetch !== "function") throw new Error("No fetch implementation is available.");
  let lastError = null;
  for (let attempt = 0; attempt < delays.length; attempt += 1) {
    if (delays[attempt] > 0) await sleep(delays[attempt]);
    let response;
    try {
      response = await doFetch(url, { method: "GET", headers: { "User-Agent": "smart-bioinformatics-toolkit" } });
    } catch (error) {
      lastError = error;
      continue;
    }
    if (response.status === 429 || response.status >= 500) {
      lastError = new Error(`NCBI returned HTTP ${response.status}`);
      continue;
    }
    if (!response.ok) {
      const error = new Error(`NCBI returned HTTP ${response.status}`);
      error.status = response.status;
      throw error;
    }
    return await response.text();
  }
  throw lastError || new Error("NCBI request failed.");
}

export function parsePutResponse(text) {
  const body = String(text || "");
  const patterns = [
    /name=["']RID["']\s+value=["']([A-Za-z0-9_-]+)["']/i,
    /value=["']([A-Za-z0-9_-]+)["']\s+name=["']RID["']/i,
    /\bRID\s*[=:]\s*([A-Za-z0-9_-]{6,})/i,
    /Request ID[^A-Za-z0-9]{0,40}([A-Za-z0-9_-]{6,})/i
  ];
  for (const pattern of patterns) {
    const match = body.match(pattern);
    if (match) return match[1];
  }
  return null;
}

// NCBI CMD=Put also returns RTOE: the estimated seconds until results are
// ready (numeric). A missing or non-numeric RTOE is null, never invented.
export function parseRtoe(text) {
  const body = String(text ?? "");
  const patterns = [
    /name=["']RTOE["']\s+value=["']\s*(\d+(?:\.\d+)?)\s*["']/i,
    /value=["']\s*(\d+(?:\.\d+)?)\s*["']\s+name=["']RTOE["']/i,
    /\bRTOE\s*[=:]\s*(\d+(?:\.\d+)?)/i
  ];
  for (const pattern of patterns) {
    const match = body.match(pattern);
    if (match) {
      const seconds = Number(match[1]);
      return Number.isFinite(seconds) ? seconds : null;
    }
  }
  return null;
}

// Detailed CMD=Put parsing. parsePutResponse above is unchanged; this returns
// the RID plus RTOE. No sequence value is read or returned.
export function parsePutResponseDetailed(text) {
  return { rid: parsePutResponse(text), rtoe: parseRtoe(text) };
}

// ------------------------------------------------ strict QBlastInfo status
// Only QBlastInfoBegin ... QBlastInfoEnd blocks are authoritative; tokens
// outside those blocks (page titles, stale "Status=Searching" tables, hidden
// form fields) are never read as search status.
//
// Two retrieval modes exist. The production canonical CMD=Get body is parsed
// with mode="canonical" (default). A FORMAT_OBJECT=SearchInfo body carries its
// own valid QBlastInfo search-status evidence (Status=READY +
// ThereAreHits=yes/no, WAITING/QUEUED/RUNNING/FAILED/UNKNOWN); parse it with
// mode="SearchInfo" (or it is auto-detected when the body clearly is a
// SearchInfo page AND no canonical error page is present). A SearchInfo READY
// is NOT, by itself, a substitute for the canonical CMD=Get body in the
// results gate: when two structured snapshots disagree on Status the typed
// state is "status_conflict", never queued/no-hit/success, and production
// results require canonical complete. See reconcileStatusEvidence().

export const QBLAST_STATES = Object.freeze({
  QUEUED: "queued",
  RUNNING: "running",
  COMPLETE: "complete",
  FAILED: "failed",
  ERROR: "error",
  UNAVAILABLE: "unavailable",
  CONFLICT: "status_conflict"
});
export const QBLAST_TERMINAL_STATES = new Set([
  QBLAST_STATES.COMPLETE, QBLAST_STATES.FAILED, QBLAST_STATES.ERROR, QBLAST_STATES.UNAVAILABLE, QBLAST_STATES.CONFLICT
]);
const QBLAST_STATUS_VALUES = new Set(["READY", "RUNNING", "WAITING", "QUEUED", "FAILED", "UNKNOWN"]);
const QBLAST_KNOWN_STATES = new Set(Object.values(QBLAST_STATES));
const PROVIDER_DATABASE_ERROR = /No alias or index file found/i;
const SAFE_ERROR_CODES = new Set([
  "timeout", "network_error", "http_error", "empty_response", "malformed_response", "status_conflict"
]);
// A body clearly servicing a FORMAT_OBJECT=SearchInfo request. The visible
// "Format Request Status" title and the hidden FORMAT_OBJECT=SearchInfo field
// mark it; a stale "Status=Searching" table alone does not.
const SEARCHINFO_PAGE = /Format Request Status|FORMAT_OBJECT\s*=\s*["']?SearchInfo/i;
const SEARCHINFO_FORM_FIELD = [
  /name\s*=\s*["']FORMAT_OBJECT["'][^>]*value\s*=\s*["']SearchInfo["']/i,
  /value\s*=\s*["']SearchInfo["'][^>]*name\s*=\s*["']FORMAT_OBJECT["']/i
];

export function extractQBlastBlocks(text) {
  const body = String(text ?? "");
  const blocks = [];
  const pattern = /QBlastInfoBegin([\s\S]*?)QBlastInfoEnd/gi;
  let match;
  while ((match = pattern.exec(body)) !== null) blocks.push(match[1].trim());
  return blocks;
}

function qblastValue(blocks, key) {
  const pattern = new RegExp(`^\\s*${key}\\s*=\\s*([^\\r\\n]+)`, "im");
  for (const block of blocks) {
    const match = block.match(pattern);
    if (match) return match[1].trim();
  }
  return null;
}

function cleanProviderText(value) {
  return String(value ?? "")
    .replace(/<[^>]*>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/consent_[0-9a-f]+/gi, "[redacted]")
    .replace(/\b[?&][^\s]{20,}/g, "[redacted]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 300);
}

export function extractProviderError(text) {
  const body = String(text ?? "");
  const direct = body.match(/(Error:\s*No alias or index file found[^<\r\n]*)/i)
    || body.match(/<p class="usa-alert-text"[^>]*>([\s\S]{0,500}?)<\/p>/i);
  return direct ? cleanProviderText(direct[1]) || null : null;
}

function normalizeTimestamp(at) {
  if (at instanceof Date && !Number.isNaN(at.getTime())) return at.toISOString();
  if (typeof at === "number" && Number.isFinite(at)) return new Date(at).toISOString();
  if (typeof at === "string" && at.trim()) {
    const parsed = Date.parse(at);
    if (Number.isFinite(parsed)) return new Date(parsed).toISOString();
  }
  return new Date().toISOString();
}

// SAFE raw-status evidence: RID, timestamp, upstream HTTP status, canonical
// QBlastInfo status, truncated provider error, hit flag(s), conflicting
// statuses and transport code. Query sequence, HTML, consent tokens and
// credentials are never included. `no_hits` is the boolean form of
// ThereAreHits=no; `there_are_hits` keeps the raw provider token.
export function safeStatusEvidence({
  rid = null,
  at = null,
  httpStatus = null,
  qblastStatus = null,
  providerError = null,
  thereAreHits = null,
  errorCode = null,
  conflictingStatuses = []
} = {}) {
  const status = String(qblastStatus ?? "").toUpperCase();
  const hits = String(thereAreHits ?? "").toLowerCase();
  const thereAreHitsValue = hits === "yes" || hits === "no" ? hits : null;
  const conflicts = (Array.isArray(conflictingStatuses) ? conflictingStatuses : [])
    .map((value) => String(value ?? "").toUpperCase())
    .filter((value) => QBLAST_STATUS_VALUES.has(value))
    .slice(0, 8);
  return Object.freeze({
    rid: isValidRid(rid) ? rid : null,
    timestamp: normalizeTimestamp(at),
    http_status: Number.isInteger(httpStatus) && httpStatus >= 100 && httpStatus <= 599 ? httpStatus : null,
    qblast_status: QBLAST_STATUS_VALUES.has(status) ? status : null,
    // Re-extract rather than trusting an arbitrary string: only a provider
    // error phrase is allowed into evidence, never surrounding HTML/secrets.
    provider_error: providerError ? extractProviderError(providerError) : null,
    there_are_hits: thereAreHitsValue,
    no_hits: thereAreHitsValue === "no",
    conflicting_statuses: Object.freeze(conflicts),
    error_code: SAFE_ERROR_CODES.has(errorCode) ? errorCode : null
  });
}

function statusResult({ state, reason, message, evidence }) {
  return Object.freeze({ state, reason, message, evidence, terminal: QBLAST_TERMINAL_STATES.has(state) });
}

// Map a recognized QBlastInfo Status token to a typed state. WAITING and
// QUEUED both mean not-yet-running; UNKNOWN means unknown, not failed.
function mapQBlastToken(token) {
  switch (String(token ?? "").toUpperCase()) {
    case "READY": return QBLAST_STATES.COMPLETE;
    case "RUNNING": return QBLAST_STATES.RUNNING;
    case "WAITING": case "QUEUED": return QBLAST_STATES.QUEUED;
    case "FAILED": return QBLAST_STATES.FAILED;
    case "UNKNOWN": return QBLAST_STATES.UNAVAILABLE;
    default: return null;
  }
}

// Collect EVERY Status= value across QBlastInfo blocks (not just the first),
// so contradictory blocks cannot hide behind a benign first match.
function collectQBlastStatuses(blocks) {
  const pattern = /^\s*Status\s*=\s*([^\r\n]+)/im;
  const values = [];
  for (const block of blocks) {
    const match = block.match(pattern);
    if (match && match[1].trim()) values.push(match[1].trim());
  }
  return values;
}

export function clearlySearchInfo(text) {
  const body = typeof text === "string" ? text : "";
  if (SEARCHINFO_PAGE.test(body)) return true;
  return SEARCHINFO_FORM_FIELD.some((pattern) => pattern.test(body));
}

export function parseQBlastStatus(text, {
  rid = null,
  httpStatus = 200,
  at = null,
  errorCode = null,
  timeout = false,
  allowBareStatus = false,
  mode = "canonical"
} = {}) {
  const body = typeof text === "string" ? text : "";
  // `mode` selects the documented retrieval flavour ("canonical" default,
  // "SearchInfo"). The typed QBlastInfo mapping is identical for both, so
  // `mode` never loosens a safeguard; canonical error pages always win.
  const transportCode = errorCode || (timeout ? "timeout" : null);
  if (transportCode === "timeout" || transportCode === "network_error") {
    const evidence = safeStatusEvidence({ rid, at, httpStatus, errorCode: transportCode });
    return statusResult({
      state: QBLAST_STATES.UNAVAILABLE,
      reason: transportCode,
      message: "NCBI could not be reached or timed out. The search state is unknown; no result was retrieved.",
      evidence
    });
  }
  if (!Number.isInteger(httpStatus) || httpStatus < 200 || httpStatus >= 300) {
    const evidence = safeStatusEvidence({ rid, at, httpStatus, errorCode: "http_error" });
    return statusResult({
      state: QBLAST_STATES.UNAVAILABLE,
      reason: "http_error",
      message: `NCBI returned HTTP ${Number.isInteger(httpStatus) ? httpStatus : "unknown"}. The search state is unknown; no result was retrieved.`,
      evidence
    });
  }
  if (!body.trim()) {
    const evidence = safeStatusEvidence({ rid, at, httpStatus, errorCode: "empty_response" });
    return statusResult({
      state: QBLAST_STATES.ERROR,
      reason: "empty_response",
      message: "NCBI returned an empty status response. The search state is unknown; no result was retrieved.",
      evidence
    });
  }

  let blocks = extractQBlastBlocks(body);
  if (!blocks.length && allowBareStatus) {
    const bare = body.match(/\bStatus\s*[=:]\s*([A-Za-z]+)/i);
    if (bare) blocks = [`Status=${bare[1]}`];
  }
  if (!blocks.length) {
    const evidence = safeStatusEvidence({ rid, at, httpStatus, errorCode: "malformed_response" });
    return statusResult({
      state: QBLAST_STATES.ERROR,
      reason: "malformed_response",
      message: "NCBI returned no QBlastInfo status block. The search state is unknown; no result was retrieved.",
      evidence
    });
  }

  const thereAreHits = qblastValue(blocks, "ThereAreHits");
  const providerError = extractProviderError(body);
  const canonicalErrorPage = providerError !== null || PROVIDER_DATABASE_ERROR.test(body);
  const rawStatuses = collectQBlastStatuses(blocks);
  const recognized = [...new Set(rawStatuses.map((value) => value.toUpperCase()).filter((value) => QBLAST_STATUS_VALUES.has(value)))];
  const unrecognized = rawStatuses.filter((value) => !QBLAST_STATUS_VALUES.has(value.toUpperCase()));
  const evidenceBase = { rid, at, httpStatus, providerError, thereAreHits };
  const hitsNo = String(thereAreHits ?? "").toLowerCase() === "no";

  // Contradictory search status inside one response: never queued, never
  // no-hit, never success. Preserve every recognized value.
  if (recognized.length > 1) {
    return statusResult({
      state: QBLAST_STATES.CONFLICT,
      reason: "conflicting_status",
      message: `NCBI returned contradictory QBlastInfo status values (${recognized.join(", ")}). The search state is not trustworthy; no result was retrieved.`,
      evidence: safeStatusEvidence({ ...evidenceBase, qblastStatus: null, errorCode: "status_conflict", conflictingStatuses: recognized })
    });
  }
  // Unknown token, or no recognized Status at all: malformed, never queued.
  if (recognized.length === 0 || unrecognized.length > 0) {
    return statusResult({
      state: QBLAST_STATES.ERROR,
      reason: "malformed_response",
      message: "NCBI returned an unrecognised QBlastInfo status. The search state is unknown; no result was retrieved.",
      evidence: safeStatusEvidence({ ...evidenceBase, qblastStatus: recognized[0] ?? null, errorCode: "malformed_response" })
    });
  }

  const normalized = recognized[0];
  const evidence = safeStatusEvidence({ ...evidenceBase, qblastStatus: normalized });
  const state = mapQBlastToken(normalized);

  if (normalized === "READY") {
    // An error page carrying an unrelated READY is contradictory evidence,
    // never a success; a SearchInfo READY requires no canonical error page.
    if (canonicalErrorPage) {
      return statusResult({
        state: QBLAST_STATES.CONFLICT,
        reason: "conflicting_evidence",
        message: "NCBI returned an error page with an unrelated QBlastInfo READY. The search state is not trustworthy; no result was retrieved.",
        evidence: safeStatusEvidence({ ...evidenceBase, qblastStatus: normalized, errorCode: "status_conflict", conflictingStatuses: ["READY"] })
      });
    }
    const noHitsNote = hitsNo ? " NCBI reports ThereAreHits=no." : "";
    return statusResult({
      state: QBLAST_STATES.COMPLETE,
      reason: null,
      message: `NCBI reports the search is complete. Results may now be requested.${noHitsNote}`,
      evidence
    });
  }
  if (normalized === "FAILED" || normalized === "UNKNOWN") {
    const databaseError = PROVIDER_DATABASE_ERROR.test(providerError || "") || PROVIDER_DATABASE_ERROR.test(body);
    const failed = normalized === "FAILED";
    return statusResult({
      state: failed ? QBLAST_STATES.FAILED : QBLAST_STATES.UNAVAILABLE,
      reason: databaseError ? "provider_database_error" : (failed ? "provider_error" : "provider_unknown"),
      message: databaseError
        ? "NCBI rejected the search before retrieving hits: the requested 16S database was not found on the provider. No results exist for this RID and none were fabricated."
        : failed
          ? "NCBI reported a failed search. No results exist for this RID and none were fabricated."
          : "NCBI reports the search state as UNKNOWN. The search state is not trustworthy; no result was retrieved.",
      evidence
    });
  }
  if (normalized === "RUNNING") {
    return statusResult({
      state: QBLAST_STATES.RUNNING,
      reason: null,
      message: "NCBI reports the search is still running. No results have been retrieved.",
      evidence
    });
  }
  // WAITING / QUEUED
  return statusResult({
    state: QBLAST_STATES.QUEUED,
    reason: null,
    message: "NCBI reports the search is queued or waiting. No results have been retrieved.",
    evidence
  });
}

// Reconcile two structured status snapshots (each a parseQBlastStatus result,
// a safe evidence object, or a bare recognized status token). Returns
// { conflict, state, reason, evidences }. When the two snapshots disagree on
// QBlastInfo Status, conflict=true and state="status_conflict"; BOTH original
// evidences are preserved. Never maps contradiction to queued/no-hit/success.
export function reconcileStatusEvidence(a, b) {
  const evidences = [snapshotEvidence(a), snapshotEvidence(b)];
  const rawA = recognizedTokenOf(a);
  const rawB = recognizedTokenOf(b);
  const stateA = snapshotState(a);
  const stateB = snapshotState(b);
  const rawConflict = Boolean(rawA && rawB && rawA !== rawB);
  const stateConflict = Boolean(stateA && stateB && stateA !== stateB);
  if (rawConflict || stateConflict) {
    const pair = [rawA ?? stateA, rawB ?? stateB].filter(Boolean).join(" vs ");
    return { conflict: true, state: QBLAST_STATES.CONFLICT, reason: `conflicting_status: ${pair}`, evidences, a, b };
  }
  return { conflict: false, state: stateA ?? stateB ?? null, reason: null, evidences, a, b };
}

function snapshotEvidence(snapshot) {
  if (snapshot === null || snapshot === undefined) return null;
  if (typeof snapshot === "string") return null;
  if (typeof snapshot !== "object") return null;
  return snapshot.evidence ?? snapshot;
}

function recognizedTokenOf(snapshot) {
  if (snapshot === null || snapshot === undefined) return null;
  if (typeof snapshot === "string") {
    const token = snapshot.trim().toUpperCase();
    return QBLAST_STATUS_VALUES.has(token) ? token : null;
  }
  if (typeof snapshot !== "object") return null;
  const evidence = snapshotEvidence(snapshot);
  const raw = evidence?.qblast_status ?? evidence?.qblastStatus ?? snapshot.qblast_status ?? snapshot.qblastStatus ?? null;
  if (raw === null || raw === undefined || raw === "") return null;
  const token = String(raw).trim().toUpperCase();
  return QBLAST_STATUS_VALUES.has(token) ? token : null;
}

function snapshotState(snapshot) {
  if (snapshot === null || snapshot === undefined) return null;
  const raw = typeof snapshot === "string" ? snapshot : (snapshot.state ?? snapshot.status ?? null);
  if (raw !== null && raw !== undefined && raw !== "") {
    const value = String(raw).toLowerCase();
    if (QBLAST_KNOWN_STATES.has(value)) return value;
    const mapped = mapQBlastToken(raw);
    if (mapped) return mapped;
  }
  const token = recognizedTokenOf(snapshot);
  return token ? mapQBlastToken(token) : null;
}

// Backwards-compatible string view for older callers. It never authorises a
// result retrieval: handlers use parseQBlastStatus above.
const LEGACY_STATUS_MAP = {
  [QBLAST_STATES.COMPLETE]: "complete",
  [QBLAST_STATES.RUNNING]: "queued",
  [QBLAST_STATES.QUEUED]: "queued",
  [QBLAST_STATES.FAILED]: "error",
  [QBLAST_STATES.ERROR]: "error",
  [QBLAST_STATES.UNAVAILABLE]: "error",
  [QBLAST_STATES.CONFLICT]: "error"
};

export function parseStatusResponse(text) {
  return LEGACY_STATUS_MAP[parseQBlastStatus(text, { allowBareStatus: true }).state] ?? "error";
}

// Typed transport result for strict status/results parsing. Never throws and
// never logs the URL: a CMD=Put URL contains the user's FASTA.
export async function fetchUpstream(url, { fetchImpl, timeoutMs = NCBI_FETCH_TIMEOUT_MS } = {}) {
  const doFetch = fetchImpl || globalThis.fetch;
  if (typeof doFetch !== "function") {
    return { ok: false, httpStatus: null, contentType: null, body: "", errorCode: "network_error" };
  }
  let timer = null;
  let signal;
  try {
    if (typeof AbortController === "function") {
      const controller = new AbortController();
      signal = controller.signal;
      timer = setTimeout(() => controller.abort(), timeoutMs);
      if (typeof timer?.unref === "function") timer.unref();
    }
    const response = await doFetch(url, {
      method: "GET",
      headers: { "User-Agent": "smart-bioinformatics-toolkit" },
      signal
    });
    const httpStatus = Number(response?.status) || 0;
    const contentType = response?.headers?.get?.("content-type") ?? null;
    if (httpStatus < 200 || httpStatus >= 300) {
      return { ok: false, httpStatus, contentType, body: "", errorCode: "http_error" };
    }
    let body = "";
    try {
      body = await response.text();
    } catch {
      return { ok: false, httpStatus, contentType, body: "", errorCode: "network_error" };
    }
    return { ok: true, httpStatus, contentType, body, errorCode: null };
  } catch (error) {
    const message = String(error?.message ?? "");
    const timeout = error?.name === "AbortError" || /timeout|abort/i.test(message);
    return { ok: false, httpStatus: null, contentType: null, body: "", errorCode: timeout ? "timeout" : "network_error" };
  } finally {
    if (timer !== null) clearTimeout(timer);
  }
}

// Keep only tabular comment/header/data lines if NCBI wraps the report in HTML.
export function extractTabular(text) {
  const lines = String(text || "").replace(/\r\n?/g, "\n").split("\n")
    .filter((line) => line.startsWith("#") || line.includes("\t"));
  return lines.length ? lines.join("\n") + "\n" : "";
}

function corsHeaders(request) {
  const headers = new Headers();
  if (!request || typeof request.headers?.get !== "function") return headers;
  const origin = request.headers.get("Origin");
  if (!origin) return headers;
  let ownOrigin = null;
  try {
    ownOrigin = new URL(request.url).origin;
  } catch {
    return headers;
  }
  if (origin === ownOrigin) {
    headers.set("Access-Control-Allow-Origin", origin);
    headers.set("Vary", "Origin");
  }
  return headers;
}

function baseHeaders(request, extra = {}) {
  const headers = new Headers({
    "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'; base-uri 'none'",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "Cache-Control": "no-store"
  });
  for (const [name, value] of corsHeaders(request)) headers.set(name, value);
  for (const [name, value] of Object.entries(extra)) headers.set(name, String(value));
  return headers;
}

export function jsonResponse(body, status = 200, request = null, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: baseHeaders(request, { "Content-Type": "application/json; charset=utf-8", ...extraHeaders })
  });
}

export function errorResponse(message, status = 400, request = null, extraHeaders = {}) {
  return jsonResponse({ error: htmlEscape(message) }, status, request, extraHeaders);
}

export function textResponse(body, status = 200, request = null, extraHeaders = {}) {
  return new Response(String(body), {
    status,
    headers: baseHeaders(request, { "Content-Type": "text/plain; charset=utf-8", ...extraHeaders })
  });
}

export function preflightResponse(request) {
  return new Response(null, {
    status: 204,
    headers: baseHeaders(request, {
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Max-Age": "600"
    })
  });
}

export async function getRequest(db, rid) {
  const result = await db.prepare(SQL.selectByRid).bind(rid).all();
  return result.results?.[0] ?? null;
}

export async function insertRequest(db, row) {
  await db.prepare(SQL.insert).bind(
    row.rid,
    row.status,
    row.created_at,
    row.last_checked_at ?? null,
    row.input_hash,
    row.result_tsv ?? null
  ).run();
}

export async function updateStatus(db, rid, status, lastCheckedAt) {
  await db.prepare(SQL.updateStatus).bind(status, lastCheckedAt, rid).run();
}

export async function cacheResults(db, rid, resultTsv) {
  await db.prepare(SQL.cacheResults).bind(resultTsv, rid).run();
}

export async function listRecent(db, limit = HISTORY_LIMIT) {
  const result = await db.prepare(SQL.selectRecent).bind(limit).all();
  return result.results ?? [];
}

// --------------------------------------------------- real-submit throttle
// blast_requests has no mock/real column, but mock RIDs carry MOCK_RID_PREFIX.
// Only real submissions count toward the shared NCBI CMD=Put budget.

function isRealRecentRow(row, cutoff) {
  const created = Date.parse(row?.created_at);
  return Number.isFinite(created)
    && created >= cutoff
    && !String(row?.rid ?? "").toUpperCase().startsWith(MOCK_RID_PREFIX);
}

export function recentRealSubmissionCount(rows, { now = Date.now(), windowMs = NCBI_SUBMIT_WINDOW_MS } = {}) {
  const cutoff = now - windowMs;
  return (Array.isArray(rows) ? rows : []).filter((row) => isRealRecentRow(row, cutoff)).length;
}

export function submissionRetryAfter(rows, {
  now = Date.now(),
  windowMs = NCBI_SUBMIT_WINDOW_MS,
  limit = NCBI_SUBMIT_LIMIT
} = {}) {
  const cutoff = now - windowMs;
  const inWindow = (Array.isArray(rows) ? rows : []).filter((row) => isRealRecentRow(row, cutoff));
  if (inWindow.length < limit) return 0;
  const oldest = Math.min(...inWindow.map((row) => Date.parse(row.created_at)));
  return Math.max(1, Math.ceil((oldest + windowMs - now) / 1000));
}

export function throttledResponse(request, retryAfter, {
  limit = NCBI_SUBMIT_LIMIT,
  windowMs = NCBI_SUBMIT_WINDOW_MS
} = {}) {
  return jsonResponse({
    error: "Global NCBI submission throttle reached. Nothing was sent to NCBI and the consent token was not consumed.",
    code: "ncbi_submit_throttled",
    retry_after_seconds: retryAfter,
    limit,
    window_seconds: Math.round(windowMs / 1000)
  }, 429, request, { "Retry-After": String(retryAfter) });
}