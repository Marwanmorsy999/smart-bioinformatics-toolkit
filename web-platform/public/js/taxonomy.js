import { computeVerdict, DEFAULT_SPECIES_THRESHOLD, DEFAULT_MIN_COVERAGE, DEFAULT_MIN_QUERY_LENGTH, DEFAULT_NEAR_THRESHOLD_MARGIN } from "./verdict.js";
import { DIFFICULT_GROUPS } from "./difficult-groups.js";
export const TAXONOMIC_RANKS = [
  "superkingdom", "kingdom", "phylum", "class", "order", "family", "genus", "species",
];

const DEFAULT_TOP_N = 10;
const DEFAULT_MIN_CONSENSUS = 0.8;

function round4(x) {
  return Math.round((x || 0) * 10000) / 10000;
}

function rankEntry(taxid, name) {
  return { taxid, name };
}

function emptyRanks() {
  const ranks = {};
  for (const r of TAXONOMIC_RANKS) ranks[r] = null;
  return ranks;
}

function normalizeRank(rank) {
  return String(rank || "").trim().toLowerCase();
}

export function splitSemicolon(value) {
  if (value == null || value === "") return [];
  return String(value).split(";").map((p) => p.trim()).filter((p) => p);
}

// ---------------------------------------------------------------------------
// Taxonomy mapping file
// ---------------------------------------------------------------------------
export function parseTaxonomyMap(text) {
  const lines = String(text).replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  const nonEmpty = lines.filter((ln) => ln.trim());
  if (nonEmpty.length === 0) {
    return { valid: false, errors: ["Taxonomy mapping file is empty."], map: {} };
  }
  const header = nonEmpty[0].split("\t").map((c) => c.trim());
  const colIndex = {};
  header.forEach((name, idx) => { colIndex[name] = idx; });
  const required = ["taxid", "scientific_name", "rank", "parent_taxid", "full_lineage"];
  const missing = required.filter((c) => !(c in colIndex));
  if (missing.length) {
    return { valid: false, errors: ["Mapping file missing columns: " + missing.join(", ")], map: {} };
  }
  const map = {};
  const errors = [];
  const seen = new Set();
  const taxidLines = {};
  for (let i = 1; i < nonEmpty.length; i += 1) {
    const lineNo = i + 1;
    const fields = nonEmpty[i].split("\t");
    if (fields.length < header.length) {
      errors.push(`Line ${lineNo}: expected ${header.length} columns, found ${fields.length}.`);
      continue;
    }
    const get = (c) => (fields[colIndex[c]] || "").trim();
    const taxidRaw = get("taxid");
    if (!taxidRaw) { errors.push(`Line ${lineNo}: missing taxid.`); continue; }
    let taxid;
    try { taxid = parseInt(taxidRaw, 10); } catch { taxid = taxidRaw; errors.push(`Line ${lineNo}: non-integer taxid '${taxidRaw}'.`); continue; }
    if (seen.has(taxid)) { errors.push(`Line ${lineNo}: duplicate taxid ${taxid}.`); continue; }
    seen.add(taxid);
    taxidLines[String(taxid)] = lineNo;
    map[taxid] = {
      taxid, scientific_name: get("scientific_name"), rank: get("rank") || null,
      parent_taxid: get("parent_taxid") || null, full_lineage: get("full_lineage") || null,
    };
  }
  // Detect cyclic parent links.
  const parentOf = {};
  for (const tid of Object.keys(map)) {
    const rec = map[tid];
    const p = rec.parent_taxid;
    parentOf[tid] = (p == null || p === "") ? null : String(p);
  }
  const state = {};
  const reported = new Set();
  for (const start of Object.keys(parentOf)) {
    if (state[start]) continue;
    const path = [];
    const pathSet = new Set();
    let cur = start;
    while (true) {
      if (cur === null || !(cur in parentOf)) {
        for (const n of path) state[n] = true;
        break;
      }
      if (pathSet.has(cur)) {
        const idx = path.indexOf(cur);
        for (const n of path.slice(idx)) {
          if (!reported.has(n)) {
            reported.add(n);
            const ln = taxidLines[n] != null ? taxidLines[n] : "?";
            errors.push(`Line ${ln}: cyclic parent link (cycle) detected for taxid ${n}.`);
          }
        }
        for (const n of path) state[n] = true;
        break;
      }
      if (state[cur]) {
        const outcome = state[cur];
        for (const n of path) state[n] = outcome;
        break;
      }
      path.push(cur);
      pathSet.add(cur);
      cur = parentOf[cur];
    }
  }
  return { valid: errors.length === 0, errors, map, taxid_count: Object.keys(map).length };
}

function mappingLookup(map, tid) {
  if (tid == null) return null;
  if (map[tid] !== undefined) return map[tid];
  if (typeof tid === "string") {
    const asInt = parseInt(tid, 10);
    if (!Number.isNaN(asInt) && map[asInt] !== undefined) return map[asInt];
  }
  return null;
}

export function buildLineageFromMap(taxid, map) {
  const ranks = emptyRanks();
  const terminalRank = normalizeRank(null);
  const visited = new Set();
  let current = taxid;
  let depth = 0;
  while (current != null && !visited.has(current) && depth < 100) {
    visited.add(current);
    depth += 1;
    const rec = mappingLookup(map, current);
    if (!rec) break;
    const lookupKey = (typeof current === "string" && map[parseInt(current, 10)] !== undefined)
      ? parseInt(current, 10) : current;
    const recRank = normalizeRank(rec.rank);
    if (recRank && TAXONOMIC_RANKS.includes(recRank) && ranks[recRank] == null) {
      ranks[recRank] = rankEntry(lookupKey, rec.scientific_name || null);
    }
    current = rec.parent_taxid;
  }
  return { taxid, name: null, ranks, source: "mapping" };
}

export function lineageFromRow(row, map) {
  const staxids = splitSemicolon(row.staxids);
  const sscinames = splitSemicolon(row.sscinames);
  const resolved = [];
  for (let i = 0; i < staxids.length; i += 1) {
    const raw = staxids[i];
    // Normalize numeric strings to numbers so taxid types match Python.
    const tid = typeof raw === "string" && raw.trim() !== "" && !Number.isNaN(Number(raw))
      ? Number(raw)
      : raw;
    const rec = mappingLookup(map, tid);
    let lineage = null;
    if (rec) {
      lineage = buildLineageFromMap(tid, map);
      lineage.name = rec.scientific_name;
      // ensure terminal rank
      const tr = normalizeRank(rec.rank);
      if (tr && TAXONOMIC_RANKS.includes(tr)) {
        lineage.ranks[tr] = rankEntry(tid, rec.scientific_name || null);
      }
    }
    resolved.push({
      taxid: rec ? rec.taxid : tid,
      scientific_name: rec ? rec.scientific_name : (sscinames[i] || null),
      rank: rec ? rec.rank : null,
      source: rec ? "mapping" : "missing",
      lineage,
      input_name: sscinames[i] || null,
    });
  }
  if (staxids.length === 0 && sscinames.length > 0) {
    for (const name of sscinames) {
      resolved.push({ taxid: null, scientific_name: name, rank: null, source: "missing", lineage: null, input_name: name });
    }
  }
  return {
    staxids_raw: row.staxids,
    sscinames_raw: row.sscinames,
    resolved_taxids: resolved,
    ambiguous: resolved.length > 1,
    has_taxonomy: resolved.some((r) => r.lineage && Object.values(r.lineage.ranks).some((e) => e)),
  };
}

// ---------------------------------------------------------------------------
// Consensus (mirrors Python consensus.py)
// ---------------------------------------------------------------------------
function candidateSortKey(c) {
  return [
    -(c.bitscore != null ? c.bitscore : 0),
    (c.evalue != null ? c.evalue : Infinity),
    -(c.pident != null ? c.pident : 0),
    -(c.query_coverage != null ? c.query_coverage : 0),
    String(c.accession || ""),
  ];
}

export function selectCandidates(hits, topN = DEFAULT_TOP_N) {
  if (!topN || topN <= 0) topN = DEFAULT_TOP_N;
  const ordered = [...hits].sort((a, b) => {
    const ka = candidateSortKey(a);
    const kb = candidateSortKey(b);
    for (let i = 0; i < ka.length; i += 1) {
      if (ka[i] < kb[i]) return -1;
      if (ka[i] > kb[i]) return 1;
    }
    return 0;
  });
  if (ordered.length <= topN) return ordered;
  const cutoff = ordered[topN - 1].bitscore;
  return ordered.filter((c) => c.bitscore != null && c.bitscore >= cutoff);
}

function speciesKey(lineage) {
  if (!lineage) return null;
  const sp = lineage.ranks.species;
  if (sp && sp.taxid != null) return `taxid:${sp.taxid}`;
  if (sp && sp.name) return `name:${sp.name}`;
  return null;
}

function taxonAtRank(lineage, rank) {
  if (!lineage) return null;
  const e = lineage.ranks[rank];
  if (!e || e.taxid == null) return null;
  return [e.taxid, e.name];
}

function rankSupport(candidates, rank) {
  const speciesReps = {};
  for (const c of candidates) {
    const key = speciesKey(c.lineage);
    if (key == null) continue;
    if (!(key in speciesReps) || candidateSortKey(c) < candidateSortKey(speciesReps[key])) {
      speciesReps[key] = c;
    }
  }
  const counts = {};
  const names = {};
  let total = 0;
  for (const c of Object.values(speciesReps)) {
    const t = taxonAtRank(c.lineage, rank);
    if (!t) continue;
    total += 1;
    counts[t[0]] = (counts[t[0]] || 0) + 1;
    names[t[0]] = names[t[0]] ?? t[1];
  }
  if (total === 0) return { support: 0, total: 0, taxon: null, taxid: null };
  const best = Object.keys(counts).reduce((a, b) => counts[a] > counts[b] ? a : b);
  return { support: counts[best] / total, total, taxon: names[best], taxid: best };
}

function lca(lineages) {
  if (!lineages.length) return null;
  let lcaRank = null, lcaTaxid = null, lcaName = null;
  for (const rank of TAXONOMIC_RANKS) {
    const taxids = new Set();
    const names = new Set();
    let anyValue = false;
    let allHave = true;
    for (const lin of lineages) {
      const e = lin.ranks[rank];
      if (!e || e.taxid == null) { allHave = false; }
      else { anyValue = true; taxids.add(e.taxid); names.add(e.name); }
    }
    if (!anyValue) continue;
    if (!allHave || taxids.size !== 1) break;
    lcaRank = rank;
    lcaTaxid = taxids.values().next().value;
    lcaName = names.size === 1 ? names.values().next().value : null;
  }
  if (lcaRank == null) return null;
  return { rank: lcaRank, taxid: lcaTaxid, name: lcaName };
}

export function computeConsensus(candidates, minConsensus = DEFAULT_MIN_CONSENSUS) {
  const warnings = [];
  if (!candidates.length) {
    return {
      query_id: "", supported_rank: null, consensus_taxon: null, consensus_taxid: null,
      status: "insufficient_evidence", candidate_species: [], support: {},
      warnings: ["No candidates available for consensus."], evidence: [],
      candidate_count: 0, truncated: false,
    };
  }
  const lineages = candidates.map((c) => c.lineage).filter(Boolean);
  const lcaResult = lca(lineages);

  const speciesKeys = {};
  for (const c of candidates) {
    const key = speciesKey(c.lineage);
    if (key) speciesKeys[key] = null;
  }
  const uniqueSpecies = Object.keys(speciesKeys).length;

  const candidateSpecies = [];
  const seenSpecies = new Set();
  for (const c of candidates) {
    const name = c.lineage ? c.lineage.ranks.species : null;
    const spName = name && name.name ? name.name : null;
    if (spName && !seenSpecies.has(spName)) { seenSpecies.add(spName); candidateSpecies.push(spName); }
  }

  const rankSupportMap = {};
  const rankTotals = {};
  const rankConsensusTaxon = {};
  for (const rank of TAXONOMIC_RANKS) {
    const rs = rankSupport(candidates, rank);
    rankSupportMap[rank] = rs.support;
    rankTotals[rank] = rs.total;
    rankConsensusTaxon[rank] = rs.taxon;
  }

  let supportedRank = null, consensusTaxon = null, consensusTaxid = null;
  if (lcaResult) {
    if (rankSupportMap[lcaResult.rank] >= minConsensus) {
      supportedRank = lcaResult.rank;
      consensusTaxon = lcaResult.name;
      consensusTaxid = lcaResult.taxid;
    } else {
      for (let i = TAXONOMIC_RANKS.length - 1; i >= 0; i -= 1) {
        const rank = TAXONOMIC_RANKS[i];
        if (rankSupportMap[rank] >= minConsensus && rankTotals[rank] > 0) {
          supportedRank = rank;
          consensusTaxon = rankConsensusTaxon[rank];
          break;
        }
      }
    }
  }

  const speciesSupport = rankSupportMap.species || 0;
  const genusSupport = rankSupportMap.genus || 0;
  let status;
  if (uniqueSpecies === 0) {
    status = "insufficient_evidence";
    warnings.push("No species-level taxonomy available for any candidate.");
  } else if (uniqueSpecies === 1 && speciesSupport >= minConsensus) {
    status = "species_agreement";
  } else if (genusSupport >= minConsensus && uniqueSpecies > 1) {
    status = "ambiguous_species";
    warnings.push("Multiple species share the supported genus; species-level identification is not supported.");
  } else if (supportedRank && supportedRank !== "genus" && supportedRank !== "species") {
    status = "higher_rank_only";
    warnings.push(`Agreement only at ${supportedRank}; species/genus not resolved.`);
  } else {
    status = "conflicting_lineages";
    warnings.push("Conflicting reference taxonomies; no reliable consensus.");
  }

  const evidence = candidates.map((c) => ({
    accession: c.accession,
    bitscore: c.bitscore,
    evalue: c.evalue,
    pident: c.pident,
    query_coverage: c.query_coverage,
    rank: c.rank,
    lineage: c.lineage ? { taxid: c.lineage.taxid, name: c.lineage.name, ranks: c.lineage.ranks, source: c.lineage.source } : null,
    species: c.lineage && c.lineage.ranks.species ? c.lineage.ranks.species.name : null,
    genus: c.lineage && c.lineage.ranks.genus ? c.lineage.ranks.genus.name : null,
  }));

  const support = {
    reference_hits: candidates.length,
    unique_accessions: new Set(candidates.map((c) => c.accession).filter(Boolean)).size,
    unique_species: uniqueSpecies,
    rank_support: Object.fromEntries(TAXONOMIC_RANKS.map((r) => [r, round4(rankSupportMap[r] || 0)])),
    rank_totals: rankTotals,
    genus_support: round4(genusSupport),
    species_support: round4(speciesSupport),
  };

  return {
    query_id: "", supported_rank: supportedRank, consensus_taxon: consensusTaxon,
    consensus_taxid: consensusTaxid, status, candidate_species: candidateSpecies, support,
    warnings, evidence, candidate_count: candidates.length, truncated: false,
  };
}

// ---------------------------------------------------------------------------
// Ambiguity
// ---------------------------------------------------------------------------
export function reportAmbiguity(result, opts = {}) {
  const flags = [];
  const messages = [...result.warnings];
  const addFlag = (flag, message) => {
    flags.push(flag);
    if (message) messages.push(message);
  };
  // Flag + explicit message, matching Python ambiguity.py branches.
  if (opts.multipleTaxidsPerHit) addFlag("multiple_taxids_per_hit", "One or more BLAST hits carry multiple taxonomy identifiers; the subject is taxonomically ambiguous.");
  if (opts.missingTaxids) addFlag("missing_taxids", "Some hits have no taxonomy identifier; they cannot contribute to a taxonomic consensus.");
  if (opts.incompleteLineages) addFlag("incomplete_lineages", "Some resolved lineages are missing taxonomic ranks (for example genus or species); consensus may be limited to higher ranks.");
  if (opts.candidateTruncation) addFlag("candidate_truncation", "The candidate set reached the configured top-N limit; tied or additional matches may have been excluded from consensus.");
  if (opts.conflictingReferenceTaxonomies) addFlag("conflicting_reference_taxonomies", "Reference records assign conflicting taxonomies to the same or overlapping subjects.");

  // Status-driven flags only; no extra messages, matching Python.
  if (result.status === "insufficient_evidence") {
    addFlag("insufficient_evidence", "Insufficient candidate evidence for a consensus.");
  } else if (result.status === "ambiguous_species") {
    flags.push("ambiguous_species");
  } else if (result.status === "higher_rank_only") {
    flags.push("higher_rank_only_consensus");
  } else if (result.status === "conflicting_lineages") {
    flags.push("conflicting_lineages");
  }

  if (result.supported_rank && result.supported_rank !== "species" && result.supported_rank !== "genus") {
    flags.push(`consensus_limited_to_${result.supported_rank}`);
  }
  if (result.support && result.support.unique_species > 1) {
    flags.push("multiple_candidate_species");
  }

  return {
    status: result.status, supported_rank: result.supported_rank,
    consensus_taxon: result.consensus_taxon, flags, messages,
    candidate_species: result.candidate_species, support: result.support,
  };
}

export function highestDefensibleRank(result) {
  if (result.status === "species_agreement") return "species";
  if (result.status === "ambiguous_species") return "genus";
  return result.supported_rank;
}

// ---------------------------------------------------------------------------
// High-level orchestration (mirrors Python taxonomy/analyze.py)
// ---------------------------------------------------------------------------
function hitToCandidate(hit) {
  return {
    accession: hit.sacc || hit.sseqid || null,
    bitscore: hit.bitscore,
    evalue: hit.evalue,
    pident: hit.pident,
    query_coverage: hit.query_coverage,
    rank: hit.rank,
    lineage: null,
    raw: hit,
  };
}

function hasConflictingTaxonomies(hits, map) {
  if (!map) return false;
  const seen = {};
  for (const hit of hits) {
    const acc = hit.sacc || hit.sseqid;
    if (!acc) continue;
    const res = lineageFromRow(hit, map);
    const prim = res.resolved_taxids[0];
    let sig = "none";
    if (prim && prim.lineage) {
      const ranks = prim.lineage.ranks;
      sig = ["species", "genus", "family"]
        .map((r) => (ranks[r] && ranks[r].taxid ? `${r}:${ranks[r].taxid}` : `${r}:none`))
        .join("|");
    }
    if (!seen[acc]) seen[acc] = new Set();
    seen[acc].add(sig);
    if (seen[acc].size > 1) return true;
  }
  return false;
}

export function analyzeTaxonomy(blastReport, map, options = {}) {
  const topN = options.top_n ?? options.topN ?? DEFAULT_TOP_N;
  const minConsensus = options.min_consensus ?? options.minConsensus ?? DEFAULT_MIN_CONSENSUS;
  const speciesThreshold = options.species_threshold ?? DEFAULT_SPECIES_THRESHOLD;
  const verdictMinCoverage = options.verdict_min_coverage ?? DEFAULT_MIN_COVERAGE;
  const minQueryLength =
    options.min_query_length === undefined ? DEFAULT_MIN_QUERY_LENGTH : options.min_query_length;
  const groups = options.difficult_groups ?? DIFFICULT_GROUPS;
  const nearThresholdMargin =
    options.near_threshold_margin ?? DEFAULT_NEAR_THRESHOLD_MARGIN;
  const makeVerdict = (consensus, qlen) =>
    computeVerdict(consensus, {
      species_threshold: speciesThreshold,
      min_coverage: verdictMinCoverage,
      min_query_length: minQueryLength,
      query_length: qlen,
      groups,
      near_threshold_margin: nearThresholdMargin,
    });
  const grouped = blastReport.grouped || {};
  const noHitQueries = blastReport.no_hit_queries || [];

  const perQuery = {};
  let queriesWithHits = 0;
  let totalCandidates = 0;
  let totalTruncated = 0;
  const flags = new Set();

  for (const qid of Object.keys(grouped).sort()) {
    const hits = grouped[qid];
    const passing = hits.filter((h) => h.pass_all);
    if (passing.length) queriesWithHits += 1;
    const candidates = selectCandidates(passing.map(hitToCandidate), topN);
    const truncated = passing.length > candidates.length;
    if (truncated) totalTruncated += 1;
    totalCandidates += candidates.length;

    for (const c of candidates) {
      const resolution = map
        ? lineageFromRow(c.raw, map)
        : { resolved_taxids: [], ambiguous: false, has_taxonomy: false };
      const primary = resolution.resolved_taxids[0];
      c.lineage = primary && primary.lineage ? primary.lineage : null;
      c._taxonomy = resolution;
    }

    const consensus = computeConsensus(candidates, minConsensus);
    consensus.query_id = qid;
    consensus.truncated = truncated;
    const ambiguity = reportAmbiguity(consensus, {
      multipleTaxidsPerHit: candidates.some((c) => c._taxonomy && c._taxonomy.ambiguous),
      missingTaxids: candidates.some((c) => !c.lineage),
      incompleteLineages: candidates.some(
        (c) => !c.lineage || !c.lineage.ranks.genus || !c.lineage.ranks.species
      ),
      candidateTruncation: truncated,
      conflictingReferenceTaxonomies: hasConflictingTaxonomies(passing, map),
    });

    if (truncated) flags.add("candidate_truncation");
    if (candidates.some((c) => c._taxonomy && c._taxonomy.ambiguous)) flags.add("multiple_taxids_per_hit");
    if (candidates.some((c) => !c.lineage)) flags.add("missing_taxids");
    if (candidates.some((c) => !c.lineage || !c.lineage.ranks.genus || !c.lineage.ranks.species)) flags.add("incomplete_lineages");
    if (hasConflictingTaxonomies(passing, map)) flags.add("conflicting_reference_taxonomies");

    perQuery[qid] = {
      consensus,
      ambiguity,
      candidate_count: candidates.length,
      passing_hit_count: passing.length,
      truncated,
      verdict: makeVerdict(
        consensus,
        (hits.find((h) => h.qlen) || {}).qlen ?? null
      ),
    };
  }

  const noHitResults = {};
  if (noHitQueries.length) flags.add("no_hit_queries");
  for (const qid of noHitQueries) {
    const consensus = computeConsensus([], minConsensus);
    consensus.query_id = qid;
    noHitResults[qid] = {
      consensus,
      ambiguity: reportAmbiguity(consensus),
      candidate_count: 0,
      passing_hit_count: 0,
      truncated: false,
      verdict: makeVerdict(consensus, null),
    };
  }

  const verdictCounts = {};
  for (const entry of [...Object.values(perQuery), ...Object.values(noHitResults)]) {
    verdictCounts[entry.verdict.status] = (verdictCounts[entry.verdict.status] || 0) + 1;
  }

  return {
    tool: "Smart Bioinformatics AI",
    tool_version: "0.1.0",
    top_n: topN,
    min_consensus: minConsensus,
    thresholds: blastReport.thresholds,
    summary: {
      total_queries: Object.keys(grouped).length + noHitQueries.length,
      queries_with_hits: queriesWithHits,
      queries_without_hits: noHitQueries.length,
      total_candidates: totalCandidates,
      queries_truncated: totalTruncated,
    },
    verdict_settings: {
      species_threshold: speciesThreshold,
      min_coverage: verdictMinCoverage,
      min_query_length: minQueryLength,
      near_threshold_margin: nearThresholdMargin,
      difficult_groups_loaded: groups.length,
    },
    verdict_counts: Object.fromEntries(Object.entries(verdictCounts).sort(([a], [b]) => (a < b ? -1 : 1))),
    flags: [...flags].sort(),
    per_query: perQuery,
    no_hit_queries: noHitResults,
  };
}

export const DEFAULT_TOP_N_VALUE = DEFAULT_TOP_N;
export const DEFAULT_MIN_CONSENSUS_VALUE = DEFAULT_MIN_CONSENSUS;
