// Identification verdict layer. Behaviour must match
// python-engine/src/smartbio/taxonomy/verdict.py; both are tested against
// shared/test-cases/verdict_cases.json.
//
// A verdict interprets BLAST evidence conservatively. It is not proof of
// species identity. 98.65% 16S identity is a screening reference only.

export const DEFAULT_SPECIES_THRESHOLD = 98.65;
export const DEFAULT_MIN_COVERAGE = 80.0;
export const DEFAULT_MIN_QUERY_LENGTH = 500;
export const DEFAULT_NEAR_THRESHOLD_MARGIN = 0.35;

export const DISCLAIMER =
  "Research use only. This verdict interprets BLAST similarity evidence; " +
  "it is not proof of species identity and not a clinical diagnosis.";

const norm = (name) => (name || "").split(/\s+/).filter(Boolean).join(" ").toLowerCase();

function isUninformativeSpecies(name) {
  const n = norm(name);
  if (!n) return true;
  if (/\bsp\.?\b/.test(n)) return true;
  if (n.includes("uncultured")) return true;
  if (n === "bacterium" || n === "uncultured bacterium") return true;
  if (n.startsWith("candidatus")) return true;
  return false;
}

function rankName(item, rank) {
  const entry = item && item.lineage && item.lineage.ranks ? item.lineage.ranks[rank] : null;
  return entry ? entry.name : null;
}

function sortedSpecies(map) {
  return [...map.entries()]
    .map(([species, max_identity]) => ({ species, max_identity }))
    .sort((a, b) => b.max_identity - a.max_identity || (a.species < b.species ? -1 : a.species > b.species ? 1 : 0));
}

export function computeVerdict(consensus, options = {}) {
  const speciesThreshold = options.species_threshold ?? DEFAULT_SPECIES_THRESHOLD;
  const minCoverage = options.min_coverage ?? DEFAULT_MIN_COVERAGE;
  const minQueryLength = options.min_query_length === undefined ? DEFAULT_MIN_QUERY_LENGTH : options.min_query_length;
  const queryLength = options.query_length ?? null;
  const groups = options.groups || [];
  const nearThresholdMargin =
    options.near_threshold_margin ?? options.nearThresholdMargin ?? DEFAULT_NEAR_THRESHOLD_MARGIN;

  const evidence = [...(consensus.evidence || [])];
  const reasons = [];
  const cautions = [];
  let status = "insufficient_evidence";
  let reportedRank = null;
  let reportedTaxon = null;
  const matchedGroups = [];
  const summary = {
    species_threshold: speciesThreshold,
    min_coverage: minCoverage,
    top_identity: null,
    top_query_coverage: null,
    qualifying_species: [],
    below_threshold_species: [],
  };

  const finish = () => ({
    status,
    reported_rank: reportedRank,
    reported_taxon: reportedTaxon,
    reasons,
    caution_flags: [...new Set(cautions)].sort(),
    difficult_groups: matchedGroups,
    evidence_summary: summary,
    disclaimer: DISCLAIMER,
  });

  if (!evidence.length || !consensus.candidate_count) {
    reasons.push("No qualifying BLAST hits were available for this query.");
    return finish();
  }

  const ranked = [...evidence].sort(
    (a, b) => (b.bitscore ?? 0) - (a.bitscore ?? 0) || (b.pident ?? 0) - (a.pident ?? 0)
  );
  const best = ranked[0];
  const topIdentity = best.pident ?? null;
  const topCoverage = best.query_coverage ?? null;
  summary.top_identity = topIdentity;
  summary.top_query_coverage = topCoverage;

  if (topIdentity === null) {
    reasons.push("Percent identity is unavailable for the top hit.");
    return finish();
  }

  if (topCoverage === null) {
    cautions.push("coverage_unavailable");
    reasons.push("Query coverage is unavailable; provide query lengths so coverage can be checked.");
  } else if (topCoverage < minCoverage) {
    reasons.push(`The top hit covers only ${topCoverage}% of the query (minimum ${minCoverage}%).`);
    return finish();
  }

  if (queryLength !== null && minQueryLength !== null && queryLength < minQueryLength) {
    cautions.push("partial_sequence");
    reasons.push(
      `Query length is ${queryLength} nt; similarity from partial sequences should be interpreted carefully.`
    );
  }

  const coverageOk = (item) => item.query_coverage == null || item.query_coverage >= minCoverage;

  const qualifying = new Map(); // normalized key -> { max_identity, display }
  const below = new Map();
  const qualifyingGenera = new Set();
  for (const item of evidence) {
    const species = rankName(item, "species");
    const pident = item.pident;
    if (!species || pident == null || !coverageOk(item)) continue;
    if (isUninformativeSpecies(species)) continue;
    const key = norm(species);
    if (pident >= speciesThreshold) {
      const prev = qualifying.get(key);
      if (!prev || pident > prev.max_identity) qualifying.set(key, { max_identity: pident, display: species });
      const genus = rankName(item, "genus");
      if (genus) qualifyingGenera.add(genus);
    } else {
      const prev = below.get(key);
      if (!prev || pident > prev.max_identity) below.set(key, { max_identity: pident, display: species });
    }
  }
  for (const key of [...below.keys()]) if (qualifying.has(key)) below.delete(key);
  const qualifyingForSummary = new Map([...qualifying.values()].map((v) => [v.display, v.max_identity]));
  const belowForSummary = new Map([...below.values()].map((v) => [v.display, v.max_identity]));
  summary.qualifying_species = sortedSpecies(qualifyingForSummary);
  summary.below_threshold_species = sortedSpecies(belowForSummary);

  const consStatus = consensus.status;
  const consRank = consensus.supported_rank;

  if (topIdentity < speciesThreshold) {
    status = "below_screening_threshold";
    const genus = rankName(best, "genus");
    if (genus && (consRank === "genus" || consRank === "species")) {
      reportedRank = "genus";
      reportedTaxon = genus;
    }
    reasons.push(
      `Top identity ${topIdentity}% is below the ${speciesThreshold}% screening reference, ` +
        "so a species-level call is not supported. This does not establish a novel species."
    );
    if (speciesThreshold - topIdentity <= nearThresholdMargin) {
      cautions.push("near_threshold");
      reasons.push(
        `Top identity is within ${nearThresholdMargin} percentage points of the species screening threshold.`
      );
    }
    return finish();
  }

  if (consStatus === "conflicting_lineages" || consStatus === "insufficient_evidence") {
    if (topIdentity !== null && topIdentity - speciesThreshold >= 0 && topIdentity - speciesThreshold <= nearThresholdMargin) {
      cautions.push("near_threshold");
      reasons.push(`Top identity is within ${nearThresholdMargin} percentage points of the species screening threshold.`);
    }
    const names = new Set([...qualifying.values()].map((v) => norm(v.display)));
    for (const group of groups) {
      const members = new Set((group.species || []).map(norm));
      if ([...names].some((n) => members.has(n))) {
        matchedGroups.push({
          id: group.id,
          display_name: group.display_name,
          note: group.note,
          source_url: group.source_url,
        });
        cautions.push(`difficult_group:${group.id}`);
      }
    }
    if (matchedGroups.length) reasons.push("A difficult-group caution applies to the candidate species.");
    reasons.push("Reference taxonomies conflict or are insufficient; no identification is reported.");
    return finish();
  }

  if (!qualifying.size) {
    if (topIdentity !== null && topIdentity - speciesThreshold >= 0 && topIdentity - speciesThreshold <= nearThresholdMargin) {
      cautions.push("near_threshold");
      reasons.push(`Top identity is within ${nearThresholdMargin} percentage points of the species screening threshold.`);
    }
    reasons.push(
      "No species-level taxonomy was available for hits above the threshold; " +
        "provide a taxonomy mapping to enable species-level interpretation."
    );
    return finish();
  }

  if (qualifying.size === 1) {
    const v = [...qualifying.values()][0];
    const species = v.display;
    status = "species_supported";
    reportedRank = "species";
    reportedTaxon = species;
    reasons.push(`Only ${species} has hits at or above ${speciesThreshold}% identity.`);
    if (below.size) reasons.push(`${below.size} other candidate species fall below the threshold.`);
  } else if (qualifyingGenera.size === 1) {
    status = "genus_level_only";
    reportedRank = "genus";
    reportedTaxon = [...qualifyingGenera][0];
    reasons.push(
      `${qualifying.size} species have hits at or above ${speciesThreshold}% identity; ` +
        "species-level identification is not supported."
    );
  } else {
    reasons.push("Hits above the threshold span multiple genera; no genus or species call is reported.");
    const names = new Set([...qualifying.values()].map((v) => norm(v.display)));
    for (const group of groups) {
      const members = new Set((group.species || []).map(norm));
      if ([...names].some((n) => members.has(n))) {
        matchedGroups.push({
          id: group.id,
          display_name: group.display_name,
          note: group.note,
          source_url: group.source_url,
        });
        cautions.push(`difficult_group:${group.id}`);
      }
    }
    if (matchedGroups.length) reasons.push("A difficult-group caution applies to the candidate species.");
    if (consRank && consRank !== "genus" && consRank !== "species") {
      reportedRank = consRank;
      reportedTaxon = consensus.consensus_taxon ?? null;
    }
    return finish();
  }

  let nearThreshold = false;
  if (topIdentity !== null && topIdentity - speciesThreshold >= 0 && topIdentity - speciesThreshold <= nearThresholdMargin) {
    nearThreshold = true;
    reasons.push(
      `Top identity is within ${nearThresholdMargin} percentage points of the species screening threshold.`
    );
  }
  const nearBelow = [...below.values()].filter((v) => speciesThreshold - v.max_identity <= nearThresholdMargin);
  if (nearBelow.length) {
    nearThreshold = true;
    reasons.push(
      `${nearBelow.length} candidate species fall within ${nearThresholdMargin} percentage points below the threshold.`
    );
  }
  if (nearThreshold) cautions.push("near_threshold");

  const names = new Set([...qualifying.keys()].map(norm));
  for (const group of groups) {
    const members = new Set((group.species || []).map(norm));
    if ([...names].some((n) => members.has(n))) {
      matchedGroups.push({
        id: group.id,
        display_name: group.display_name,
        note: group.note,
        source_url: group.source_url,
      });
      cautions.push(`difficult_group:${group.id}`);
    }
  }
  if (matchedGroups.length && status === "species_supported") {
    status = "group_level_only";
    reportedRank = "group";
    reportedTaxon = matchedGroups[0].display_name;
    reasons.push(
      "The species belongs to a group that 16S similarity cannot reliably separate; report at group level."
    );
  } else if (matchedGroups.length) {
    reasons.push("A difficult-group caution applies to the candidate species.");
  }

  return finish();
}
