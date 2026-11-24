// Shared helpers for the remote BLAST Pages Functions.
// Plain ES modules: no frameworks, no R2, no paid services, no secrets in code or logs.

export const BLAST_API_URL = "https://blast.ncbi.nlm.nih.gov/Blast.cgi";
export const ALLOWED_DATABASE = "16S_ribosomal_RNA";
export const ALLOWED_PROGRAM = "blastn";
export const MAX_FASTA_CHARS = 10000;
export const POLL_INTERVAL_MS = 60000;
export const HISTORY_LIMIT = 20;
export const MOCK_RID_PREFIX = "MOCK";

// IUPAC nucleotide codes (DNA + RNA ambiguity symbols), case-insensitive.
const SEQUENCE_ALPHABET = /^[ACGTURYSWKMBDHVN]+$/i;
const RID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

// SQL is centralised so the D1 mock in tests can assert exactly what runs.
export const SQL = {
  selectByRid: "SELECT rid, status, created_at, last_checked_at, input_hash, result_tsv FROM blast_requests WHERE rid = ?",
  selectRecent: "SELECT rid, status, created_at FROM blast_requests ORDER BY created_at DESC LIMIT ?",
  insert: "INSERT INTO blast_requests (rid, status, created_at, last_checked_at, input_hash, result_tsv) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(rid) DO UPDATE SET status = excluded.status, created_at = excluded.created_at, last_checked_at = excluded.last_checked_at, input_hash = excluded.input_hash, result_tsv = excluded.result_tsv",
  updateStatus: "UPDATE blast_requests SET status = ?, last_checked_at = ? WHERE rid = ?",
  cacheResults: "UPDATE blast_requests SET result_tsv = ?, status = 'complete' WHERE rid = ?"
};

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
    return { valid: false, error: `database must be exactly "${ALLOWED_DATABASE}".` };
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

export function buildResultsParams(rid, env) {
  const params = new URLSearchParams();
  params.set("CMD", "Get");
  params.set("RID", rid);
  params.set("FORMAT_TYPE", "Text");
  params.set("ALIGNMENT_VIEW", "Tabular");
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

export function parseStatusResponse(text) {
  const match = String(text || "").match(/Status\s*[=:]\s*(Ready|Running|Waiting|Queued|Failed|Unknown)/i);
  if (!match) return "queued";
  const raw = match[1].toLowerCase();
  if (raw === "ready") return "complete";
  if (raw === "failed" || raw === "unknown") return "error";
  return "queued";
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