// Pure, offline parser for NCBI BLAST JSON2 reports (FORMAT_TYPE=JSON2).
// No fetch, no environment, no D1, no secrets. It only reads fields that are
// actually present in the payload; absent values stay null and are never
// guessed. Numeric strings are converted deterministically, alignment strings
// (qseq/sseq/midline) are preserved verbatim as raw evidence.
//
// Query coverage is ALWAYS computed from real alignment coordinates:
//   (qend - qstart + 1) / query_len * 100, clamped to 0..100, 2 decimals.
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

function coverageFromCoordinates(qstart, qend, queryLen) {
  if (!Number.isFinite(qstart) || !Number.isFinite(qend) || !Number.isFinite(queryLen) || queryLen <= 0) return null;
  const aligned = Math.abs(qend - qstart) + 1;
  const percent = (aligned / queryLen) * 100;
  return Number(Math.min(100, Math.max(0, percent)).toFixed(2));
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
      const queryCoverage = coverageFromCoordinates(qstart, qend, queryLen);
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
    // order. Its values become the hit-level summary — none are invented.
    const best = hsps.slice().sort((a, b) => (b.bit_score ?? -Infinity) - (a.bit_score ?? -Infinity))[0] ?? null;
    const coverages = hsps.map((item) => item.query_coverage).filter((value) => value !== null);
    hits.push({
      rank,
      accession,
      title,
      organism,
      taxid,
      length: finiteNumber(description?.length) ?? finiteNumber(description?.slen) ?? best?.slen ?? null,
      identity: best?.identity ?? null,
      // Maximum per-HSP query span; not a union of coordinates (never claimed).
      query_coverage: coverages.length ? Math.max(...coverages) : null,
      evalue: best?.evalue ?? null,
      bitscore: best?.bit_score ?? null,
      hsps
    });
  }

  if (missingDescription) {
    warn(`${missingDescription} hit(s) had no usable description; accession, title, organism and taxid are null.`);
  }
  if (missingCoverage) {
    warn(`${missingCoverage} HSP(s) had no coordinate-derived query coverage (missing coordinates or query length).`);
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
 * JSON2 fields. Every numeric field in a row comes from that hit's single
 * best-scoring HSP. It is explicitly labelled as derived, never a provider TSV.
 */
export function toDerivedTabular(result) {
  const queryId = cellText(result?.query?.id);
  const lines = [
    "# derived_from: json2 — tabular compatibility view; each hit row uses its best-scoring HSP (highest bit_score) for all numeric fields, not a verbatim NCBI TSV.",
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
      hsp.query_coverage ?? hit.query_coverage
    ].map(cellText).join("\t"));
  }
  return lines.join("\n") + "\n";
}
