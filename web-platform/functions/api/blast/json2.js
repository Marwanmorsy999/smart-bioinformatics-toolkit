// Pure, offline parser for NCBI BLAST JSON2 reports (FORMAT_TYPE=JSON2).
// No fetch, no environment, no D1, no secrets. It only reads fields that are
// actually present in the payload; absent values stay null and are never
// guessed. Numeric strings are converted deterministically, alignment strings
// (qseq/sseq/midline) are preserved verbatim as raw evidence.
//
// Query coverage is ALWAYS computed from real alignment coordinates:
//   - per HSP: one alignment span, normalized to [min,max], clamped to the
//     [1, query_len] range exactly like the union path, then divided by the
//     FULL query_len * 100 (percent clamped to 0..100, 2 decimals). A wholly
//     out-of-range interval yields null per-HSP coverage, never an invented
//     value; this stays distinct from the hit-level union below;
//   - per hit: the UNION of all valid query-coordinate intervals of that hit,
//     divided by the FULL query_len from the JSON2 search, * 100, clamped to
//     0..100, 2 decimals. Overlapping and adjacent intervals are merged, so
//     bases covered by more than one HSP are never double-counted.
// A provider qcovs/qcovhsp value is used only as a cross-check warning.

const DEFAULT_MAX_WARNINGS = 20;

function finiteNumber(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function rawString(value) {
  if (typeof value === "string") return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

function firstValue(value) {
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

function cellText(value) {
  if (value === null || value === undefined) return "";
  return String(value).replace(/[\t\r\n]+/g, " ").trim();
}

// Per-HSP span coverage: a SINGLE alignment, never the hit-level union. The
// interval is normalized and clamped to [1, query_len] exactly like the union
// path; a wholly out-of-range interval has no coverage in this query and is
// reported as null with a warning rather than a clipped-but-misleading number.
function coverageFromCoordinates(qstart, qend, queryLen, { rank = null, hspIndex = null, warn = () => {} } = {}) {
  if (!Number.isFinite(qstart) || !Number.isFinite(qend) || !Number.isFinite(queryLen) || queryLen <= 0) return null;
  const low = Math.min(qstart, qend);
  const high = Math.max(qstart, qend);
  const label = rank === null ? "Hit" : `Hit ${rank}`;
  const hspLabel = hspIndex === null ? "HSP" : `HSP ${hspIndex}`;
  if (high < 1 || low > queryLen) {
    warn(`${label} ${hspLabel} query interval ${low}-${high} lies entirely outside the query range 1-${queryLen}; per-HSP coverage is unavailable.`);
    return null;
  }
  const clampedStart = Math.max(1, low);
  const clampedEnd = Math.min(queryLen, high);
  if (clampedStart !== low || clampedEnd !== high) {
    warn(`${label} ${hspLabel} query interval ${low}-${high} was clamped to ${clampedStart}-${clampedEnd} for per-HSP coverage (query length ${queryLen}).`);
  }
  const aligned = clampedEnd - clampedStart + 1;
  const percent = (aligned / queryLen) * 100;
  return Number(Math.min(100, Math.max(0, percent)).toFixed(2));
}

/**
 * Hit-level aggregate query coverage: union of the valid query-coordinate
 * intervals of every HSP of one hit. Intervals are normalized to
 * [min(qstart,qend), max(qstart,qend)], clamped to the full [1, query_len]
 * range reported by the JSON2 search, then merged when they overlap or are
 * adjacent. Query coordinates are strand-independent; reverse-strand subject
 * coordinates are not involved. Nothing is inferred for missing/malformed
 * coordinates or an invalid query length.
 * @returns {{percent:number|null, bases:number|null, intervals:Array<{start:number,end:number}>}}
 */
export function unionQueryCoverage(hsps, queryLen, { rank = null, warn = () => {} } = {}) {
  const empty = { percent: null, bases: null, intervals: [] };
  if (!Number.isFinite(queryLen) || queryLen <= 0) return empty;

  const label = rank === null ? "Hit" : `Hit ${rank}`;
  const raw = [];
  for (let index = 0; index < (Array.isArray(hsps) ? hsps.length : 0); index += 1) {
    const hsp = hsps[index];
    if (!hsp || typeof hsp !== "object" || Array.isArray(hsp)) continue;
    const start = finiteNumber(hsp.qstart);
    const end = finiteNumber(hsp.qend);
    if (start === null || end === null) continue; // already warned as missing coverage
    const low = Math.min(start, end);
    const high = Math.max(start, end);
    if (high < 1 || low > queryLen) {
      warn(`${label} HSP ${index + 1} query interval ${low}-${high} lies entirely outside the query range 1-${queryLen}; it was skipped.`);
      continue;
    }
    const clampedStart = Math.max(1, low);
    const clampedEnd = Math.min(queryLen, high);
    if (clampedStart !== low || clampedEnd !== high) {
      warn(`${label} HSP ${index + 1} query interval ${low}-${high} was clamped to ${clampedStart}-${clampedEnd} (query length ${queryLen}).`);
    }
    raw.push({ start: clampedStart, end: clampedEnd });
  }
  if (!raw.length) return empty;

  raw.sort((a, b) => a.start - b.start || a.end - b.end);
  const merged = [];
  for (const interval of raw) {
    const previous = merged[merged.length - 1];
    // Adjacent intervals touch when the next start is at most previous end + 1.
    if (previous && interval.start <= previous.end + 1) {
      previous.end = Math.max(previous.end, interval.end);
    } else {
      merged.push({ start: interval.start, end: interval.end });
    }
  }
  const bases = merged.reduce((total, interval) => total + (interval.end - interval.start + 1), 0);
  const percent = Number(Math.min(100, Math.max(0, (bases / queryLen) * 100)).toFixed(2));
  return { percent, bases, intervals: merged };
}

function emptyResult(warnings) {
  return { query: { id: null, length: null }, hits: [], warnings, no_hits: false };
}

/**
 * Parse a real-format NCBI BLAST JSON2 document.
 * @param {string} raw JSON2 body as returned by CMD=Get&FORMAT_TYPE=JSON2.
 * @param {{maxWarnings?: number}} options Bounds the warning list (default 20).
 * @returns {{query:{id:string|null,length:number|null}, hits:Array, warnings:string[], no_hits:boolean}}
 */
export function parseBlastJson2(raw, options = {}) {
  const maxWarnings = Number.isFinite(options?.maxWarnings) ? Math.max(0, options.maxWarnings) : DEFAULT_MAX_WARNINGS;
  const warnings = [];
  const warn = (message) => {
    if (warnings.length < maxWarnings) warnings.push(String(message));
  };

  if (typeof raw !== "string" || !raw.trim()) {
    warn("Malformed JSON2 payload: empty or non-text response.");
    return emptyResult(warnings);
  }
  let document;
  try {
    document = JSON.parse(raw);
  } catch {
    warn("Malformed JSON2 payload: invalid JSON.");
    return emptyResult(warnings);
  }
  if (!document || typeof document !== "object" || Array.isArray(document)) {
    warn("Malformed JSON2 payload: the top level is not an object.");
    return emptyResult(warnings);
  }
  const blastOutput = document.BlastOutput2;
  if (!blastOutput || typeof blastOutput !== "object" || Array.isArray(blastOutput)) {
    warn("Malformed JSON2 payload: no BlastOutput2 object.");
    return emptyResult(warnings);
  }
  const search = blastOutput.report?.results?.search;
  if (!search || typeof search !== "object" || Array.isArray(search)) {
    warn("Malformed JSON2 payload: no report.results.search object.");
    return emptyResult(warnings);
  }

  const queryId = rawString(search.query_id) ?? rawString(search.query_title);
  const queryLen = finiteNumber(search.query_len);
  if (queryLen === null && search.query_len !== undefined && search.query_len !== null) {
    warn("Query length in the JSON2 payload was not numeric; query coverage is unavailable.");
  }

  const rawHits = Array.isArray(search.hits) ? search.hits : null;
  if (rawHits === null) warn("JSON2 search has no hits array; treating it as no hits.");

  const hits = [];
  let missingDescription = 0;
  let missingCoverage = 0;
  let reverseStrands = 0;

  for (let hitIndex = 0; hitIndex < (rawHits?.length ?? 0); hitIndex += 1) {
    const rawHit = rawHits[hitIndex];
    if (!rawHit || typeof rawHit !== "object" || Array.isArray(rawHit)) {
      warn(`Hit entry ${hitIndex + 1} was not an object and was skipped.`);
      continue;
    }
    const descriptions = Array.isArray(rawHit.description) ? rawHit.description : [];
    if (descriptions.length > 1) {
      warn(`Hit ${hitIndex + 1} had ${descriptions.length} descriptions; only the first one was used.`);
    }
    const description = descriptions.find((item) => item && typeof item === "object" && !Array.isArray(item)) ?? null;
    if (!description) missingDescription += 1;

    const rank = finiteNumber(rawHit.num) ?? (hits.length + 1);
    const accession = description ? (rawString(description.accession) ?? rawString(description.id)) : null;
    const title = description ? rawString(description.title) : null;
    const organism = description ? rawString(description.organism) : null;
    const taxid = description ? rawString(firstValue(description.taxid)) : null;

    const hsps = [];
    const rawHsps = Array.isArray(rawHit.hsps) ? rawHit.hsps : [];
    for (let hspIndex = 0; hspIndex < rawHsps.length; hspIndex += 1) {
      const rawHsp = rawHsps[hspIndex];
      if (!rawHsp || typeof rawHsp !== "object" || Array.isArray(rawHsp)) {
        warn(`Hit ${rank}: HSP entry ${hspIndex + 1} was not an object and was skipped.`);
        continue;
      }
      const qstart = finiteNumber(rawHsp.qstart);
      const qend = finiteNumber(rawHsp.qend);
      const sstart = finiteNumber(rawHsp.sstart);
      const send = finiteNumber(rawHsp.send);
      const queryCoverage = coverageFromCoordinates(qstart, qend, queryLen, {
        rank, hspIndex: hspIndex + 1, warn
      });
      if (queryCoverage === null) missingCoverage += 1;

      const providerCoverage = finiteNumber(firstValue(rawHsp.qcovs ?? rawHsp.qcovhsp));
      if (providerCoverage !== null && queryCoverage !== null && Math.abs(providerCoverage - queryCoverage) > 0.01) {
        warn(`Provider qcovs (${providerCoverage}) disagrees with coordinate-derived coverage (${queryCoverage}) for hit ${rank} HSP ${hspIndex + 1}; the coordinate-derived value is used.`);
      }

      let strand = null;
      if (qstart !== null && qend !== null && sstart !== null && send !== null) {
        strand = sstart > send ? "minus" : "plus";
        if (strand === "minus") reverseStrands += 1;
      }

      hsps.push({
        hsp: finiteNumber(rawHsp.num) ?? (hsps.length + 1),
        bit_score: finiteNumber(rawHsp.bit_score ?? rawHsp.bitscore),
        score: finiteNumber(rawHsp.score),
        evalue: finiteNumber(rawHsp.evalue),
        identity: finiteNumber(rawHsp.identity),
        positive: finiteNumber(rawHsp.positive),
        gaps: finiteNumber(rawHsp.gaps),
        gap: finiteNumber(rawHsp.gap),
        length: finiteNumber(rawHsp.length ?? rawHsp.align_len),
        qstart,
        qend,
        sstart,
        send,
        strand,
        qseq: rawString(rawHsp.qseq),
        sseq: rawString(rawHsp.sseq),
        midline: rawString(rawHsp.midline ?? rawHsp.mline),
        nident: finiteNumber(rawHsp.nident),
        slen: finiteNumber(rawHsp.slen),
        query_coverage: queryCoverage
      });
    }
    if (!hsps.length) warn(`Hit ${rank} had no usable HSPs; only descriptive fields are available.`);

    // Best HSP is the highest bit score actually present; ties keep provider
    // order. Its values become the hit-level score summary — none are invented.
    const best = hsps.slice().sort((a, b) => (b.bit_score ?? -Infinity) - (a.bit_score ?? -Infinity))[0] ?? null;
    // Hit coverage is the union of valid query intervals, with the FULL
    // JSON2 search.query_len as denominator. hsps[].query_coverage stays the
    // single-HSP span; the two are deliberately different measures.
    const union = unionQueryCoverage(hsps, queryLen, { rank, warn });
    hits.push({
      rank,
      accession,
      title,
      organism,
      taxid,
      length: finiteNumber(description?.length) ?? finiteNumber(description?.slen) ?? best?.slen ?? null,
      identity: best?.identity ?? null,
      query_coverage: union.percent,
      query_coverage_method: "union_of_hsp_query_intervals",
      query_coverage_bases: union.bases,
      query_coverage_intervals: union.intervals,
      evalue: best?.evalue ?? null,
      bitscore: best?.bit_score ?? null,
      hsps
    });
  }

  if (missingDescription) {
    warn(`${missingDescription} hit(s) had no usable description; accession, title, organism and taxid are null.`);
  }
  if (missingCoverage) {
    warn(`${missingCoverage} HSP(s) had no coordinate-derived query coverage (missing/malformed coordinates, invalid query length or a wholly out-of-range interval).`);
  }
  if (reverseStrands) {
    warn(`${reverseStrands} HSP(s) align on the reverse strand (sstart > send); strand was derived from coordinates.`);
  }

  return {
    query: { id: queryId, length: queryLen },
    hits,
    warnings,
    no_hits: rawHits === null || rawHits.length === 0
  };
}

/** True when enough real structure exists to treat the response as a report. */
export function isJson2Report(result) {
  return Boolean(result && (
    result.no_hits === true
    || (Array.isArray(result.hits) && result.hits.length > 0)
    || result.query?.id !== null
    || result.query?.length !== null
  ));
}

// The same "best HSP" rule used for hit-level summary values: highest bit
// score actually present, first provider HSP wins a tie. Keeping one HSP for
// every numeric column avoids mixing coordinates from one alignment with
// scores from another.
function bestHspOf(hit) {
  let best = null;
  for (const hsp of (Array.isArray(hit?.hsps) ? hit.hsps : [])) {
    if (!hsp || typeof hsp !== "object" || Array.isArray(hsp)) continue;
    if (best === null || (hsp.bit_score ?? -Infinity) > (best.bit_score ?? -Infinity)) best = hsp;
  }
  return best ?? {};
}

/**
 * Deterministic 12-column tabular compatibility view derived ONLY from parsed
 * JSON2 fields. Every numeric field except qcovs comes from that hit's single
 * best-scoring HSP; qcovs is the hit-level UNION of query intervals (not that
 * HSP's span). It is explicitly labelled as derived, never a provider TSV.
 */
export function toDerivedTabular(result) {
  const queryId = cellText(result?.query?.id);
  const lines = [
    "# derived_from: json2 — derived tabular view; numeric fields use the best-scoring HSP (highest bit_score) except qcovs, which is the hit-level union of query intervals over full query_len; not a verbatim NCBI TSV.",
    "qseqid\tsacc\tstaxids\tsscinames\tpident\tlength\tqstart\tqend\tqlen\tevalue\tbitscore\tqcovs"
  ];
  for (const hit of (Array.isArray(result?.hits) ? result.hits : [])) {
    const hsp = bestHspOf(hit);
    lines.push([
      queryId,
      hit.accession,
      hit.taxid,
      hit.organism ?? hit.title,
      hsp.identity ?? hit.identity,
      hsp.length,
      hsp.qstart,
      hsp.qend,
      result?.query?.length,
      hsp.evalue ?? hit.evalue,
      hsp.bit_score ?? hit.bitscore,
      hit.query_coverage ?? hsp.query_coverage
    ].map(cellText).join("\t"));
  }
  return lines.join("\n") + "\n";
}
