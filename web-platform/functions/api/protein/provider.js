// M7.13 protein provider: server-side-only access to UniProt, the precomputed
// InterPro Matches API and the InterProScan 6 Job Dispatcher.
//
// No browser-side external call is made and no identifier, job state or result
// is ever fabricated. Every endpoint below is one of the verified contracts;
// all fetches are injectable for offline tests and bounded by explicit limits.

export const PROTEIN_PROVIDER_VERSION = "1.0.0-m7.13";

export const ENDPOINTS = Object.freeze({
  uniprotJson: (accession) => `https://rest.uniprot.org/uniprotkb/${encodeURIComponent(accession)}.json?fields=accession,protein_name,sequence,length`,
  uniprotFasta: (accession) => `https://rest.uniprot.org/uniprotkb/${encodeURIComponent(accession)}.fasta`,
  interproProtein: (accession) => `https://www.ebi.ac.uk/interpro/api/protein/UniProt/${encodeURIComponent(accession)}?extra_fields=sequence`,
  interproEntry: (accession) => `https://www.ebi.ac.uk/interpro/api/entry/interpro/${encodeURIComponent(accession)}`,
  matches: (md5) => `https://www.ebi.ac.uk/interpro/matches/api/matches/${encodeURIComponent(String(md5).toUpperCase())}`,
  matchesBatch: () => "https://www.ebi.ac.uk/interpro/matches/api/matches",
  iprscanBase: "https://www.ebi.ac.uk/Tools/services/rest/iprscan6"
});

export const LIMITS = Object.freeze({
  maxRecords: 20,
  minSequenceLength: 10,
  maxSequenceLength: 10000,
  maxTotalCharacters: 200000,
  maxGoLookupsPerRun: 12,
  requestTimeoutMs: 15000,
  submitTimeoutMs: 30000,
  statusTimeoutMs: 10000,
  resultTimeoutMs: 30000,
  maxPolls: 24,
  pollIntervalMs: 5000,
  retries: 1
});

const STANDARD_AA = new Set("ACDEFGHIKLMNPQRSTVWY".split(""));
// Documented, accepted ambiguous residues. B=D/N, J=I/L, Z=E/Q, X=any,
// U=selenocysteine, O=pyrrolysine. They are carried verbatim, never resolved.
export const AMBIGUOUS_AA = Object.freeze({
  B: "aspartate/asparagine ambiguity (D/N)",
  J: "isoleucine/leucine ambiguity (I/L)",
  Z: "glutamate/glutamine ambiguity (E/Q)",
  X: "any amino acid",
  U: "selenocysteine",
  O: "pyrrolysine"
});
const NUCLEOTIDE_ONLY = new Set("ACGTN".split(""));
const IPRSCAN_JOB_ID = /^iprscan\d?-\S+$/;
const ACCESSION_RE = /^[A-Z0-9]{6,10}(?:-\d+)?$/;

export class ProteinProviderError extends Error {
  constructor(code, message, status = null) {
    super(message);
    this.name = "ProteinProviderError";
    this.code = code;
    this.status = status;
  }
}

// ------------------------------------------------------------------- MD5
// EBI MatchesClient convention: strip whitespace, UPPERCASE, ASCII bytes,
// lowercase hex. Web Crypto has no MD5, so this small pure implementation is
// used both in the Worker and in Node tests.
const MD5_S = [
  7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
  5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
  4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
  6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21
];
const MD5_K = Array.from({ length: 64 }, (_, i) => Math.floor(Math.abs(Math.sin(i + 1)) * 4294967296) >>> 0);

function rotateLeft(value, shift) {
  return ((value << shift) | (value >>> (32 - shift))) >>> 0;
}

export function md5Bytes(bytes) {
  const source = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes ?? []);
  const length = source.length;
  const padded = new Uint8Array((((length + 8) >> 6) + 1) * 64);
  padded.set(source);
  padded[length] = 0x80;
  const view = new DataView(padded.buffer);
  const bits = length * 8;
  view.setUint32(padded.length - 8, bits >>> 0, true);
  view.setUint32(padded.length - 4, Math.floor(bits / 4294967296) >>> 0, true);
  let a0 = 0x67452301, b0 = 0xefcdab89, c0 = 0x98badcfe, d0 = 0x10325476;
  for (let offset = 0; offset < padded.length; offset += 64) {
    let a = a0, b = b0, c = c0, d = d0;
    for (let i = 0; i < 64; i += 1) {
      let f;
      let g;
      if (i < 16) { f = (b & c) | (~b & d); g = i; }
      else if (i < 32) { f = (d & b) | (~d & c); g = (5 * i + 1) % 16; }
      else if (i < 48) { f = b ^ c ^ d; g = (3 * i + 5) % 16; }
      else { f = c ^ (b | ~d); g = (7 * i) % 16; }
      const previousD = d;
      d = c;
      c = b;
      const sum = (a + f + MD5_K[i] + view.getUint32(offset + g * 4, true)) >>> 0;
      a = previousD;
      b = (b + rotateLeft(sum, MD5_S[i])) >>> 0;
    }
    a0 = (a0 + a) >>> 0;
    b0 = (b0 + b) >>> 0;
    c0 = (c0 + c) >>> 0;
    d0 = (d0 + d) >>> 0;
  }
  return [a0, b0, c0, d0]
    .map((word) => [word & 0xff, (word >>> 8) & 0xff, (word >>> 16) & 0xff, (word >>> 24) & 0xff])
    .flat()
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export function proteinMd5(sequence) {
  const clean = String(sequence ?? "").replace(/\s+/g, "").toUpperCase();
  return md5Bytes(new TextEncoder().encode(clean));
}

// ------------------------------------------------------------ validation
export function validateProteinSequence(sequence, { header = "", minLength = LIMITS.minSequenceLength,
  maxLength = LIMITS.maxSequenceLength } = {}) {
  const clean = String(sequence ?? "").replace(/\s+/g, "").toUpperCase();
  const counts = new Map();
  const ambiguous = [];
  const invalid = [];
  for (let index = 0; index < clean.length; index += 1) {
    const residue = clean[index];
    counts.set(residue, (counts.get(residue) ?? 0) + 1);
    if (Object.hasOwn(AMBIGUOUS_AA, residue) && !ambiguous.some((item) => item.residue === residue)) {
      const positions = [];
      for (let at = 0; at < clean.length; at += 1) {
        if (clean[at] === residue) positions.push(at + 1);
        if (positions.length >= 100) break;
      }
      ambiguous.push({ residue, meaning: AMBIGUOUS_AA[residue], count: counts.get(residue),
        positions, positions_truncated: counts.get(residue) > positions.length });
    } else if (!STANDARD_AA.has(residue) && !Object.hasOwn(AMBIGUOUS_AA, residue)) {
      if (!invalid.includes(residue)) invalid.push(residue);
    }
  }
  const errors = [];
  if (!clean) errors.push("Sequence is empty.");
  if (clean.length < minLength) errors.push(`Sequence is shorter than the ${minLength} residue minimum.`);
  if (clean.length > maxLength) errors.push(`Sequence exceeds the ${maxLength} residue length limit.`);
  if (invalid.length) errors.push(`Unsupported character(s) for a protein sequence: ${invalid.join(", ")}.`);
  const nucleotideCount = [...clean].filter((residue) => NUCLEOTIDE_ONLY.has(residue)).length;
  const looksNucleotide = clean.length >= 40
    && nucleotideCount / clean.length >= 0.95
    && /^[ACGTRYN]+$/.test(clean);
  // Word boundaries avoid rejecting a legitimate protein whose description
  // merely contains letters such as "its" inside another word.
  const headerHint = /\b(?:dna|rna|nucleotide|cds|16s|18s|its[1-4]?)\b/i.test(String(header ?? ""));
  if (looksNucleotide || headerHint) {
    errors.push("This looks like a nucleotide sequence, not a protein. Protein input uses the 20 standard amino acids plus B/J/Z/X/U/O.");
  }
  return {
    valid: errors.length === 0,
    sequence: clean,
    length: clean.length,
    md5: proteinMd5(clean),
    ambiguous,
    composition: Object.fromEntries([...counts.entries()].sort(([a], [b]) => a.localeCompare(b))),
    errors,
    warnings: ambiguous.length
      ? [`${ambiguous.length} ambiguous residue type(s) retained verbatim; none were resolved to a single amino acid.`] : []
  };
}

export function parseProteinFasta(text, options = {}) {
  const source = String(text ?? "").replace(/\r\n?/g, "\n");
  if (!source.trim()) return { valid: false, records: [], errors: ["FASTA/sequence input is empty."] };
  const trimmed = source.trim();
  const records = [];
  const errors = [];
  if (!trimmed.startsWith(">")) {
    const check = validateProteinSequence(trimmed, { header: options.header ?? "", ...options });
    if (!check.valid) return { valid: false, records: [], errors: check.errors };
    return { valid: true, records: [{ id: "sequence_1", header: null, ...check }], errors: [], mode: "raw" };
  }
  let current = null;
  for (const line of source.split("\n")) {
    if (!line.trim()) continue;
    if (line.startsWith(">")) {
      if (current) records.push(current);
      const header = line.slice(1).trim();
      current = { id: header.split(/\s+/)[0] ?? "", header: header || null, sequence: "", line: records.length + 1 };
    } else if (current) {
      current.sequence += line.replace(/\s+/g, "");
    } else {
      errors.push("Sequence text appears before any '>' header line.");
    }
  }
  if (current) records.push(current);
  if (records.length > LIMITS.maxRecords) errors.push(`Small multi-FASTA is limited to ${LIMITS.maxRecords} records; this input has ${records.length}.`);
  const total = records.reduce((sum, record) => sum + record.sequence.length, 0);
  if (total > LIMITS.maxTotalCharacters) errors.push(`Total sequence length exceeds the ${LIMITS.maxTotalCharacters} residue limit.`);
  const ids = new Set();
  const duplicates = [];
  const validated = [];
  for (const record of records) {
    if (!record.id) errors.push(`Record ${record.line}: empty FASTA identifier.`);
    else if (ids.has(record.id)) duplicates.push(record.id);
    ids.add(record.id);
    const check = validateProteinSequence(record.sequence, { header: record.header ?? "", ...options });
    if (!check.valid) errors.push(`${record.id || `record ${record.line}`}: ${check.errors.join(" ")}`);
    validated.push({ id: record.id || `record_${record.line}`, header: record.header, ...check });
  }
  if (duplicates.length) errors.push(`Duplicate FASTA identifiers: ${[...new Set(duplicates)].join(", ")}.`);
  if (!validated.length) errors.push("No FASTA records were found.");
  return { valid: errors.length === 0, records: validated, errors, duplicates, mode: "fasta" };
}

export function normalizeAccession(value) {
  const accession = String(value ?? "").trim().toUpperCase();
  return ACCESSION_RE.test(accession) ? accession : null;
}

// ------------------------------------------------------------ HTTP helper
function providerFetch(ctx) {
  const candidate = ctx?.fetch ?? globalThis.fetch;
  if (typeof candidate !== "function") {
    throw new ProteinProviderError("fetch_unavailable", "No fetch implementation is available for provider calls.");
  }
  return candidate;
}

async function providerRequest(url, { ctx = {}, method = "GET", headers = {}, body = null,
  timeoutMs = LIMITS.requestTimeoutMs, attempts = LIMITS.retries + 1 } = {}) {
  const fetchImpl = providerFetch(ctx);
  let lastError = null;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const options = { method, headers: { Accept: "application/json", ...headers }, signal: controller.signal };
      if (body !== null) options.body = body;
      const response = await fetchImpl(url, options);
      return response;
    } catch (error) {
      lastError = error;
    } finally {
      clearTimeout(timer);
    }
  }
  throw new ProteinProviderError("provider_timeout_or_network_error",
    `Provider request failed after ${attempts} attempt(s): ${lastError?.message ?? lastError}`);
}

async function readJson(response, code = "provider_invalid_json") {
  try {
    return await response.json();
  } catch {
    throw new ProteinProviderError(code, "The provider response was not valid JSON.");
  }
}

export function createProviderCache() {
  return { matches: new Map(), proteins: new Map(), entries: new Map() };
}

// ---------------------------------------------------- accession resolution
export async function resolveAccession(rawAccession, { ctx = {}, cache = createProviderCache() } = {}) {
  const accession = normalizeAccession(rawAccession);
  if (!accession) throw new ProteinProviderError("invalid_accession", "Provide a valid UniProt accession (e.g. P04637).");
  if (cache.proteins.has(accession)) return cache.proteins.get(accession);
  const response = await providerRequest(ENDPOINTS.uniprotJson(accession), { ctx, timeoutMs: LIMITS.requestTimeoutMs });
  if (response.status === 404) {
    throw new ProteinProviderError("uniprot_accession_not_found", `UniProt has no entry for accession ${accession}.`, 404);
  }
  if (!response.ok) {
    throw new ProteinProviderError("uniprot_request_failed", `UniProt returned HTTP ${response.status}.`, response.status);
  }
  const body = await readJson(response, "uniprot_invalid_json");
  const sequence = String(body?.sequence?.value ?? "").replace(/\s+/g, "").toUpperCase();
  if (!sequence) throw new ProteinProviderError("uniprot_sequence_missing", "UniProt did not report a sequence for this accession.");
  const check = validateProteinSequence(sequence, { header: accession });
  if (!check.valid) {
    throw new ProteinProviderError("uniprot_sequence_invalid", `UniProt sequence failed protein validation: ${check.errors.join(" ")}`);
  }
  const reportedMd5 = String(body?.sequence?.md5 ?? "").trim().toUpperCase();
  if (reportedMd5 && reportedMd5 !== check.md5.toUpperCase()) {
    throw new ProteinProviderError("uniprot_md5_mismatch",
      "The sequence MD5 computed from the UniProt response does not match the MD5 reported by UniProt. Nothing was annotated.");
  }
  const id = String(body?.uniProtkbId ?? body?.proteinDescription?.recommendedName?.fullName?.value ?? accession).slice(0, 120);
  const fastaText = `>${accession} ${id}\n${sequence.match(/.{1,60}/g).join("\n")}\n`;
  let interpro = null;
  let interproReason = null;
  try {
    const ipResponse = await providerRequest(ENDPOINTS.interproProtein(accession), { ctx, timeoutMs: LIMITS.requestTimeoutMs });
    if (!ipResponse.ok) {
      interproReason = `InterPro protein metadata returned HTTP ${ipResponse.status}; metadata fields are null.`;
    } else {
      interpro = await readJson(ipResponse, "interpro_invalid_json");
    }
  } catch (error) {
    interproReason = `InterPro protein metadata was unavailable: ${error?.message ?? error}`;
  }
  const result = {
    accession,
    fasta_text: fastaText,
    record: { id: accession, header: `${accession} ${id}`, ...check },
    uniprot: {
      entry_type: String(body?.entryType ?? "") || null,
      reviewed: /reviewed/i.test(String(body?.entryType ?? "")),
      protein_name: String(body?.proteinDescription?.recommendedName?.fullName?.value ?? "") || null,
      organism: String(body?.organism?.scientificName ?? "") || null,
      length: Number(body?.sequence?.length ?? sequence.length),
      reported_md5: reportedMd5.toLowerCase() || null
    },
    interpro_metadata: interpro,
    interpro_reason: interproReason,
    source: "UniProt REST + InterPro protein metadata"
  };
  cache.proteins.set(accession, result);
  return result;
}

// ---------------------------------------------------------- Matches API
export async function lookupMatches(md5, { ctx = {}, cache = createProviderCache() } = {}) {
  const key = String(md5 ?? "").toUpperCase();
  if (!/^[0-9a-f]{32}$/.test(key.toLowerCase())) {
    throw new ProteinProviderError("invalid_md5", "A 32-character protein MD5 is required.");
  }
  if (cache.matches.has(key)) return cache.matches.get(key);
  const response = await providerRequest(ENDPOINTS.matches(key), { ctx, timeoutMs: LIMITS.requestTimeoutMs });
  if (response.status === 404) {
    const miss = { status: "miss", body: null, match_count: 0,
      reason: "No precomputed InterPro matches exist for this sequence MD5." };
    cache.matches.set(key, miss);
    return miss;
  }
  if (!response.ok) {
    throw new ProteinProviderError("matches_request_failed", `InterPro Matches API returned HTTP ${response.status}.`, response.status);
  }
  const body = await readJson(response, "matches_invalid_json");
  const reported = String(body?.md5 ?? "").toUpperCase();
  if (reported !== key) {
    throw new ProteinProviderError("matches_md5_mismatch",
      "The Matches API response MD5 does not match the requested sequence MD5; the response was discarded.");
  }
  const hit = { status: "hit", body, match_count: Array.isArray(body?.matches) ? body.matches.length : 0,
    reason: null };
  cache.matches.set(key, hit);
  return hit;
}

export async function batchMatches(md5s, { ctx = {} } = {}) {
  const keys = [...new Set(md5s.map((value) => String(value ?? "").toUpperCase()))];
  if (!keys.length || keys.length > LIMITS.maxRecords) {
    throw new ProteinProviderError("invalid_batch", "Provide between 1 and 20 MD5 values.");
  }
  for (const key of keys) {
    if (!/^[0-9A-F]{32}$/.test(key)) throw new ProteinProviderError("invalid_md5", "A 32-character protein MD5 is required.");
  }
  const response = await providerRequest(ENDPOINTS.matchesBatch(), {
    ctx, method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ md5: keys })
  });
  if (!response.ok) {
    throw new ProteinProviderError("matches_batch_failed", `InterPro batch Matches API returned HTTP ${response.status}.`, response.status);
  }
  const body = await readJson(response, "matches_batch_invalid_json");
  const rows = Array.isArray(body) ? body : (Array.isArray(body?.results) ? body.results : []);
  return rows.filter((row) => keys.includes(String(row?.md5 ?? "").toUpperCase()));
}

// --------------------------------------------------------- InterProScan 6
export function hasContactEmail(env) {
  const email = String(env?.INTERPROSCAN_EMAIL ?? "").trim();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
}

export function routeBUnavailable(reason = "route_b_unavailable_no_contact_email") {
  return new ProteinProviderError(reason,
    "Executed InterProScan 6 analysis is unavailable: no server-side INTERPROSCAN_EMAIL is configured. " +
    "No contact address was invented and no job was submitted.", 503);
}

export async function submitIprscan6({ email, sequence, stype = "p", goterms = true, pathways = true,
  appl = null, ctx = {} } = {}) {
  const address = String(email ?? "").trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) throw routeBUnavailable();
  const check = validateProteinSequence(sequence);
  if (!check.valid) throw new ProteinProviderError("invalid_protein_sequence", check.errors.join(" "));
  const form = new URLSearchParams();
  form.set("email", address);
  form.set("sequence", check.sequence);
  form.set("stype", stype === "p" ? "p" : "p");
  form.set("goterms", goterms ? "on" : "off");
  form.set("pathways", pathways ? "on" : "off");
  if (typeof appl === "string" && /^[A-Za-z0-9,_-]{1,120}$/.test(appl)) form.set("appl", appl);
  const response = await providerRequest(`${ENDPOINTS.iprscanBase}/run`, {
    ctx, method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "text/plain" },
    body: form.toString(), timeoutMs: LIMITS.submitTimeoutMs, attempts: 1
  });
  if (!response.ok) {
    throw new ProteinProviderError("iprscan6_submit_failed", `InterProScan 6 /run returned HTTP ${response.status}.`, response.status);
  }
  const jobId = String(await response.text()).trim();
  if (!IPRSCAN_JOB_ID.test(jobId)) {
    throw new ProteinProviderError("iprscan6_invalid_job_id",
      "InterProScan 6 did not return a valid job identifier; no job reference was fabricated.");
  }
  return { job_id: jobId, submitted_sequence_md5: check.md5, email_used: address };
}

export function classifyIprscanState(raw) {
  const state = String(raw ?? "").trim().toUpperCase();
  if (state === "FINISHED") return "succeeded";
  if (["ERROR", "FAILURE", "NOT_FOUND"].includes(state)) return "failed";
  if (["QUEUED", "RUNNING"].includes(state)) return "running";
  return "unknown";
}

export async function getIprscanStatus(jobId, { ctx = {} } = {}) {
  if (!IPRSCAN_JOB_ID.test(String(jobId ?? ""))) {
    throw new ProteinProviderError("invalid_job_id", "Invalid InterProScan 6 job id.");
  }
  const response = await providerRequest(`${ENDPOINTS.iprscanBase}/status/${encodeURIComponent(jobId)}`, {
    ctx, timeoutMs: LIMITS.statusTimeoutMs
  });
  if (response.status === 404) {
    return { job_id: jobId, state: "NOT_FOUND", state_class: "failed", reason: "The job dispatcher reported NOT_FOUND." };
  }
  if (!response.ok) {
    throw new ProteinProviderError("iprscan6_status_failed", `InterProScan 6 /status returned HTTP ${response.status}.`, response.status);
  }
  const state = String(await response.text()).trim().toUpperCase();
  return { job_id: jobId, state: state || null, state_class: classifyIprscanState(state), reason: null };
}

export async function getIprscanResult(jobId, { ctx = {} } = {}) {
  if (!IPRSCAN_JOB_ID.test(String(jobId ?? ""))) {
    throw new ProteinProviderError("invalid_job_id", "Invalid InterProScan 6 job id.");
  }
  const response = await providerRequest(`${ENDPOINTS.iprscanBase}/result/${encodeURIComponent(jobId)}/json`, {
    ctx, timeoutMs: LIMITS.resultTimeoutMs
  });
  if (!response.ok) {
    throw new ProteinProviderError("iprscan6_result_failed", `InterProScan 6 /result returned HTTP ${response.status}.`, response.status);
  }
  return readJson(response, "iprscan6_invalid_json");
}

// -------------------------------------------------------------- GO terms
export async function fetchEntryGo(accession, { ctx = {}, cache = createProviderCache() } = {}) {
  const key = String(accession ?? "").toUpperCase();
  if (!/^IPR\d{6}$/.test(key)) return { terms: [], reason: "Not an InterPro entry accession." };
  if (cache.entries.has(key)) return cache.entries.get(key);
  const response = await providerRequest(ENDPOINTS.interproEntry(key), { ctx, timeoutMs: LIMITS.requestTimeoutMs });
  if (!response.ok) {
    const value = { terms: [], reason: `InterPro entry ${key} returned HTTP ${response.status}; no GO terms were added.` };
    cache.entries.set(key, value);
    return value;
  }
  const body = await readJson(response, "interpro_entry_invalid_json");
  const terms = normalizeGoTerms(body?.metadata?.go_terms ?? body?.go_terms ?? []);
  const value = { terms, reason: terms.length ? null : `InterPro entry ${key} reported no GO terms.` };
  cache.entries.set(key, value);
  return value;
}

export function normalizeGoTerms(input) {
  if (!Array.isArray(input)) return [];
  const seen = new Set();
  const terms = [];
  for (const item of input) {
    const raw = item?.identifier ?? item?.goTerm ?? item?.id ?? null;
    const identifier = typeof raw === "string" && /^GO:\d{7}$/.test(raw) ? raw : null;
    const name = String(item?.name ?? item?.label ?? "") || null;
    const code = String(item?.category?.code ?? item?.category ?? "") || null;
    const categoryName = String(item?.category?.name ?? "") || null;
    const key = identifier ?? `${name ?? ""}|${code ?? ""}`;
    if (!identifier && !name) continue;
    if (seen.has(key)) continue;
    seen.add(key);
    terms.push({
      identifier,
      name,
      category: code ? { code: code.slice(0, 1).toUpperCase(), name: categoryName } : null,
      identifier_reason: identifier ? null : "GO identifier was not reported by the source; no identifier was invented."
    });
  }
  return terms.sort((a, b) => String(a.identifier ?? a.name ?? "").localeCompare(String(b.identifier ?? b.name ?? "")));
}

// -------------------------------------------------------------- releases
export function collectReleases(matches, { toolVersion = null, toolVersionSource = null } = {}) {
  const memberDatabases = {};
  for (const match of Array.isArray(matches) ? matches : []) {
    const library = String(match?.signature?.signatureLibraryRelease?.library ?? "").trim();
    const version = String(match?.signature?.signatureLibraryRelease?.version ?? "").trim();
    if (library && version && !memberDatabases[library]) memberDatabases[library] = version;
  }
  return {
    interpro_release: null,
    interpro_release_reason: "not reported by the source (no public InterPro release endpoint was available; no version was guessed)",
    member_databases: Object.fromEntries(Object.entries(memberDatabases).sort(([a], [b]) => a.localeCompare(b))),
    tool_version: toolVersion,
    tool_version_reason: toolVersion ? toolVersionSource : "the provider response did not report a tool version"
  };
}
