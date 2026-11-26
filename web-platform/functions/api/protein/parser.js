// M7.13 pure parsers for genuine InterPro evidence.
//
// Two input shapes are supported, each with its own honest route label:
//   - the precomputed InterPro Matches API  -> precomputed_reference_annotation
//   - an executed InterProScan 6 JSON result -> executed_interproscan6_analysis
//
// Nothing is inferred into a scientific claim. Optional fields stay null/empty
// with an explicit reason. Integrated InterPro entries, member signatures,
// locations and interpretations are kept as distinct objects.

import { collectReleases, normalizeGoTerms, proteinMd5 } from "./provider.js";

export const ROUTE_LABELS = Object.freeze({
  precomputed: "precomputed_reference_annotation",
  iprscan6: "executed_interproscan6_analysis"
});

const CATEGORY_BY_TYPE = Object.freeze({
  family: "family",
  domain: "domain",
  homologous_superfamily: "superfamily",
  conserved_site: "site",
  region: "region",
  repeat: "repeat",
  binding_site: "site",
  active_site: "site"
});

function clean(value, max = 2000) {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, max) : null;
}

function number(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function categoryFor(signature, source) {
  const type = clean(signature?.type, 100);
  const key = String(type ?? "").toLowerCase().replace(/[\s-]+/g, "_");
  if (source === "MobiDB-lite" && key === "region") return "disorder";
  return CATEGORY_BY_TYPE[key] ?? "other";
}

function parseSites(rawSites) {
  if (!Array.isArray(rawSites)) return [];
  return rawSites.map((site) => {
    const residues = Array.isArray(site?.siteLocations)
      ? site.siteLocations.map((residue) => ({
        start: number(residue?.start),
        end: number(residue?.end),
        residue: clean(residue?.residue, 10)
      })).filter((residue) => residue.start !== null || residue.end !== null)
      : [];
    return {
      description: clean(site?.description, 500),
      num_locations: number(site?.numLocations) ?? residues.length,
      residues
    };
  });
}

function parseLocation(raw, match, index) {
  const location = raw && typeof raw === "object" ? raw : {};
  const fragments = Array.isArray(location["location-fragments"])
    ? location["location-fragments"].map((fragment) => ({
      start: number(fragment?.start), end: number(fragment?.end),
      dc_status: clean(fragment?.["dc-status"], 60)
    })).filter((fragment) => fragment.start !== null && fragment.end !== null)
    : [];
  return {
    index: index + 1,
    start: number(location.start),
    end: number(location.end),
    fragments,
    score: number(location.score) ?? number(match?.score),
    evalue: number(location.evalue) ?? number(match?.evalue),
    hmm_bounds: clean(location.hmmBounds, 60),
    hmm_start: number(location.hmmStart),
    hmm_end: number(location.hmmEnd),
    hmm_length: number(location.hmmLength),
    envelope_start: number(location.envelopeStart),
    envelope_end: number(location.envelopeEnd),
    sequence_feature: clean(location["sequence-feature"], 200),
    sites: parseSites(location.sites),
    motif_number: number(location.motifNumber)
  };
}

// Keyword detection is evidence-led only: a special feature is recorded when
// the genuine provider text actually mentions it. No predictor is run here.
const SPECIAL_PATTERNS = Object.freeze([
  ["transmembrane", /transmembrane/i],
  ["signal_peptide", /signal\s*peptid/i],
  ["coiled_coil", /coiled[\s-]?coil/i],
  ["low_complexity", /low[\s-]?complexit/i],
  ["disorder", /disorder/i]
]);

function specialFeatures(match, feature) {
  const text = [match?.signature?.name, match?.signature?.description,
    feature?.locations?.map((location) => location.sequence_feature).join(" ")].filter(Boolean).join(" ");
  const found = [];
  for (const [label, pattern] of SPECIAL_PATTERNS) {
    if (pattern.test(text)) found.push({ label, evidence: "reported_signature_or_sequence_feature_text" });
  }
  if (feature.category === "disorder" && !found.some((item) => item.label === "disorder")) {
    found.push({ label: "disorder", evidence: "mobidb_lite_source_and_region_type" });
  }
  return found;
}

function parseMatch(match, index) {
  const signature = match?.signature && typeof match.signature === "object" ? match.signature : {};
  const source = clean(match?.source, 120);
  const entryRaw = signature.entry && typeof signature.entry === "object" ? signature.entry : null;
  const entry = entryRaw ? {
    accession: clean(entryRaw.accession, 60),
    name: clean(entryRaw.name, 300),
    description: clean(entryRaw.description, 1000),
    type: clean(entryRaw.type, 100)
  } : null;
  const locations = Array.isArray(match?.locations) ? match.locations.map((location, at) => parseLocation(location, match, at)) : [];
  const feature = {
    id: `feature_${index + 1}`,
    category: categoryFor(signature, source),
    feature_type: clean(signature.type, 100),
    source,
    signature: {
      accession: clean(signature.accession, 120),
      name: clean(signature.name, 300),
      description: clean(signature.description, 1000),
      model_accession: clean(match?.["model-ac"], 120),
      release: signature.signatureLibraryRelease && typeof signature.signatureLibraryRelease === "object"
        ? { library: clean(signature.signatureLibraryRelease.library, 120),
          version: clean(signature.signatureLibraryRelease.version, 60) }
        : null
    },
    // Integrated entry and member signature are deliberately separate fields.
    entry,
    entry_reason: entry ? null : "This member signature is not integrated into an InterPro entry in the reported match.",
    locations,
    score: number(match?.score),
    evalue: number(match?.evalue),
    special_features: []
  };
  feature.special_features = specialFeatures(match, feature);
  return feature;
}

function sortFeatures(features) {
  return [...features].sort((left, right) => {
    const start = (left.locations[0]?.start ?? Number.MAX_SAFE_INTEGER) - (right.locations[0]?.start ?? Number.MAX_SAFE_INTEGER);
    if (start !== 0) return start;
    return [left.category, left.signature.accession ?? "", left.source ?? "", left.id]
      .join("|").localeCompare([right.category, right.signature.accession ?? "", right.source ?? "", right.id].join("|"));
  }).map((feature, index) => ({ ...feature, id: `feature_${index + 1}` }));
}

export function computeCoverage(features, proteinLength) {
  const length = Number.isInteger(proteinLength) && proteinLength > 0
    ? proteinLength
    : Math.max(0, ...features.flatMap((feature) => feature.locations.map((location) => location.end ?? 0)));
  const intervals = features.flatMap((feature) => feature.locations)
    .map((location) => ({ start: location.start, end: location.end }))
    .filter((interval) => Number.isInteger(interval.start) && Number.isInteger(interval.end) && interval.start <= interval.end)
    .map((interval) => ({ start: Math.max(1, interval.start), end: Math.min(length, interval.end) }))
    .filter((interval) => interval.start <= interval.end)
    .sort((a, b) => a.start - b.start || a.end - b.end);
  let covered = 0;
  let cursor = null;
  for (const interval of intervals) {
    if (cursor === null || interval.start > cursor + 1) {
      covered += interval.end - interval.start + 1;
      cursor = interval.end;
    } else if (interval.end > cursor) {
      covered += interval.end - cursor;
      cursor = interval.end;
    }
  }
  return {
    protein_length: length || null,
    covered_residues: covered,
    fraction: length ? Number((covered / length).toFixed(4)) : null,
    basis: "union_of_reported_location_intervals"
  };
}

function aggregateEntries(features) {
  const byAccession = new Map();
  for (const feature of features) {
    if (!feature.entry?.accession) continue;
    const key = feature.entry.accession;
    if (!byAccession.has(key)) {
      byAccession.set(key, { ...feature.entry, member_signatures: [], locations: [], sources: [] });
    }
    const entry = byAccession.get(key);
    if (!entry.member_signatures.includes(feature.signature.accession)) {
      if (feature.signature.accession) entry.member_signatures.push(feature.signature.accession);
    }
    if (feature.source && !entry.sources.includes(feature.source)) entry.sources.push(feature.source);
    for (const location of feature.locations) {
      if (!entry.locations.some((item) => item.start === location.start && item.end === location.end && item.source === feature.source)) {
        entry.locations.push({ start: location.start, end: location.end, source: feature.source });
      }
    }
  }
  return [...byAccession.values()].map((entry) => ({
    ...entry,
    member_signatures: entry.member_signatures.sort(),
    sources: entry.sources.sort(),
    locations: entry.locations.sort((a, b) => (a.start ?? 0) - (b.start ?? 0) || String(a.source).localeCompare(String(b.source)))
  })).sort((a, b) => String(a.accession).localeCompare(String(b.accession)));
}

function mergeGo(primary, enrichment) {
  const terms = new Map();
  const reasons = [];
  for (const [source, value] of [["protein_metadata", primary], ...(enrichment ?? [])]) {
    if (!value) continue;
    if (value.reason && !value.terms?.length) reasons.push(`${source}: ${value.reason}`);
    // Normalise at the boundary so a missing identifier is an explicit null
    // with a reason rather than an undefined property.
    for (const term of normalizeGoTerms(value.terms ?? [])) {
      const key = term.identifier ?? `${term.name ?? ""}|${term.category?.code ?? ""}`;
      if (!terms.has(key)) terms.set(key, { ...term, source });
    }
  }
  const categories = { biological_process: [], molecular_function: [], cellular_component: [], unclassified: [] };
  const bucket = { P: "biological_process", F: "molecular_function", C: "cellular_component" };
  for (const term of terms.values()) {
    categories[bucket[term.category?.code] ?? "unclassified"].push(term);
  }
  return {
    terms: [...terms.values()].sort((a, b) => String(a.identifier ?? a.name).localeCompare(String(b.identifier ?? b.name))),
    categories,
    reasons,
    basis: "protein_metadata_and_integrated_entry_go_terms_when_reported"
  };
}

function extractPathways(input) {
  const items = Array.isArray(input) ? input : [];
  return {
    items: items.map((item) => ({
      source: clean(item?.source, 120),
      name: clean(item?.name ?? item?.description, 300),
      identifier: clean(item?.identifier ?? item?.accession, 120)
    })),
    reason: items.length ? null : "Pathways were not reported by the source; none were inferred."
  };
}

/**
 * Parse a genuine Matches-shaped body (Matches API or one protein of an
 * InterProScan 6 result). `options.go_terms` / `options.go_enrichment` carry
 * genuine source terms; they are never generated here.
 */
export function parseMatchesAnnotation(body, options = {}) {
  const rawMatches = Array.isArray(body?.matches) ? body.matches : [];
  const features = sortFeatures(rawMatches.map(parseMatch).filter(Boolean));
  const proteinLength = Number.isInteger(options.protein_length)
    ? options.protein_length
    : (Number.isInteger(body?.length) ? body.length : null);
  const go = mergeGo(options.go_terms ?? null, options.go_enrichment ?? []);
  const toolVersionInfo = collectReleases(rawMatches, {
    toolVersion: clean(options.tool_version, 120),
    toolVersionSource: clean(options.tool_version_source, 300)
  });
  const reasons = [];
  if (!rawMatches.length) reasons.push("The source returned no matches for this protein.");
  if (features.some((feature) => !feature.entry)) reasons.push("Some member signatures have no integrated InterPro entry; they remain member-signature evidence only.");
  const counts = {};
  for (const feature of features) counts[feature.category] = (counts[feature.category] ?? 0) + 1;
  return {
    route_label: options.route_label ?? ROUTE_LABELS.precomputed,
    md5: String(options.md5 ?? body?.md5 ?? "").toUpperCase() || null,
    protein_length: proteinLength,
    features,
    entries: aggregateEntries(features),
    sites: features.flatMap((feature) => feature.locations.flatMap((location) => location.sites.map((site) => ({
      signature_accession: feature.signature.accession,
      source: feature.source,
      description: site.description,
      residues: site.residues
    })))),
    special_features: features.flatMap((feature) => feature.special_features.map((item) => ({
      ...item, signature_accession: feature.signature.accession
    }))),
    go,
    pathways: extractPathways(options.pathways ?? body?.pathways),
    releases: toolVersionInfo,
    coverage: computeCoverage(features, proteinLength),
    counts,
    missing_field_reasons: reasons,
    parser_version: "m7.13.1"
  };
}

/** Normalise a whole executed InterProScan 6 JSON document. */
export function parseIprscan6Result(body, options = {}) {
  const rows = Array.isArray(body)
    ? body
    : (Array.isArray(body?.results) ? body.results
      : (Array.isArray(body?.proteins) ? body.proteins
        : (body && typeof body === "object" && Array.isArray(body.matches) ? [body] : [])));
  const reasons = [];
  if (!rows.length) reasons.push("The InterProScan 6 result contained no protein match records.");
  const proteins = rows.map((row, index) => {
    const sequence = clean(row?.sequence, 1_000_000) ?? clean(options.sequence, 1_000_000);
    const md5 = String(row?.md5 ?? options.md5 ?? (sequence ? proteinMd5(sequence) : "")).toUpperCase() || null;
    const goTerms = normalizeGoTerms(row?.go_terms ?? row?.go ?? options.go_terms ?? []);
    return parseMatchesAnnotation(row, {
      md5,
      protein_length: Number.isInteger(row?.length) ? row.length : (sequence ? sequence.length : null),
      route_label: ROUTE_LABELS.iprscan6,
      go_terms: goTerms.length ? { terms: goTerms, reason: null } : null,
      pathways: row?.pathways ?? null,
      tool_version: clean(row?.program ?? row?.version ?? body?.version ?? body?.program, 120),
      tool_version_source: "reported_by_interproscan6_response"
    });
  });
  return {
    result_label: ROUTE_LABELS.iprscan6,
    proteins,
    protein_count: proteins.length,
    missing_field_reasons: reasons,
    parser_version: "m7.13.1"
  };
}

/** Deterministic, human-readable evidence summary used by the report and UI. */
export function summarizeAnnotation(annotation) {
  const counts = annotation?.counts ?? {};
  const describe = (label) => `${counts[label] ?? 0}`;
  return [
    `This ${annotation?.route_label ?? "unknown route"} result reports ${annotation?.features?.length ?? 0} match records ` +
    `(${describe("family")} families, ${describe("domain")} domains, ${describe("superfamily")} superfamilies, ` +
    `${describe("site")} sites, ${describe("region")} regions, ${describe("disorder")} disorder regions).`,
    `Integrated InterPro entries: ${annotation?.entries?.length ?? 0}. Member signatures are reported separately and are not presented as entries.`,
    annotation?.coverage?.protein_length
      ? `Reported locations cover ${annotation.coverage.covered_residues} of ${annotation.coverage.protein_length} residues ` +
        `(${annotation.coverage.fraction} of the sequence), as a deterministic union of intervals; overlapping features are retained.`
      : "Sequence length was not reported; coverage could not be computed.",
    `GO terms with identifiers: ${(annotation?.go?.terms ?? []).filter((term) => term.identifier).length}; ` +
    `pathway records: ${annotation?.pathways?.items?.length ?? 0}. Missing optional fields remain null with reasons.`
  ].join(" ");
}
