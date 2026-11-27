// M7.14 pure parsers for REAL Galaxy / QIIME 2 16S outputs.
//
// Every function here is deterministic, side-effect free and works only on the
// text supplied to it. No value is invented: a missing optional input yields
// null (or an empty list) together with an explicit `reason`. Nothing here
// submits a job or calls a provider. Tests use labelled fixtures derived from
// the official Moving Pictures data SHAPE; the live run uses real tool output.

const EOL = /\r\n?/g;
const norm = (text) => String(text ?? "").replace(EOL, "\n");
const clean = (value, max = 300) => (typeof value === "string" ? value.trim().slice(0, max) : "");
const num = (value) => {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

function splitDelimited(line) {
  const trimmed = clean(line, 20000);
  if (trimmed.includes("\t")) return trimmed.split("\t");
  if (trimmed.includes(",")) return trimmed.split(",");
  return [trimmed];
}

function headerIndex(header, candidates) {
  const lowered = header.map((cell) => clean(cell).toLowerCase());
  for (const candidate of candidates) {
    const found = lowered.indexOf(candidate);
    if (found >= 0) return found;
  }
  return -1;
}

// ------------------------------------------------------------------ FASTQ

// Parse a real FASTQ file (4 lines per record). Supports multi-line sequences
// and quality strings only when they are on the canonical 4 lines; anything
// else is reported rather than silently coerced.
export function parseFastq(text, { label = "reads" } = {}) {
  const source = norm(text);
  const lines = source.split("\n");
  const records = [];
  const errors = [];
  let index = 0;
  let recordNumber = 0;
  while (index < lines.length) {
    while (index < lines.length && !lines[index].trim()) index += 1;
    if (index >= lines.length) break;
    recordNumber += 1;
    const header = lines[index]?.trim() ?? "";
    if (!header.startsWith("@")) {
      errors.push(`${label}: record ${recordNumber} has no @ header`);
      break;
    }
    const id = header.slice(1).split(/\s+/)[0];
    const sequence = lines[index + 1]?.trim() ?? "";
    const plus = lines[index + 2]?.trim() ?? "";
    const quality = lines[index + 3]?.trim() ?? "";
    if (!plus.startsWith("+")) {
      errors.push(`${label}: record ${recordNumber} has no + separator`);
      break;
    }
    if (sequence.length !== quality.length) {
      errors.push(`${label}: record ${recordNumber} sequence/quality length mismatch (${sequence.length}/${quality.length})`);
    }
    if (!sequence || !quality) {
      errors.push(`${label}: record ${recordNumber} has an empty sequence or quality string`);
      break;
    }
    records.push({ id, header, sequence, sequence_length: sequence.length, quality });
    index += 4;
  }
  const lengths = records.map((record) => record.sequence_length);
  // Spread into Math.min/Math.max would overflow the stack on the real
  // 302,581-read file; accumulate in bounded loops instead.
  let minLength = null;
  let maxLength = 0;
  for (const length of lengths) {
    if (minLength === null || length < minLength) minLength = length;
    if (length > maxLength) maxLength = length;
  }
  const qualityByPosition = [];
  for (let position = 0; position < maxLength; position += 1) {
    let total = 0;
    let count = 0;
    for (const record of records) {
      const code = record.quality.charCodeAt(position);
      if (!Number.isNaN(code)) { total += code - 33; count += 1; }
    }
    qualityByPosition.push(count ? Math.round((total / count) * 100) / 100 : null);
  }
  return {
    valid: errors.length === 0 && records.length > 0,
    label, records, record_count: records.length, read_count: records.length, lengths,
    total_bases: lengths.reduce((sum, length) => sum + length, 0),
    min_length: minLength,
    max_length: maxLength,
    quality_by_position: qualityByPosition,
    errors
  };
}

// Quality-driven truncation rationale. Only observed means are used; the
// tutorial's 1103 rarefaction depth is NEVER copied as a result.
export function chooseTruncation(qualityByPosition, { maxLength = null, dropAfter = 0.08 } = {}) {
  const positions = Array.isArray(qualityByPosition) ? qualityByPosition : [];
  const usable = positions
    .map((mean, index) => ({ position: index + 1, mean }))
    .filter((item) => typeof item.mean === "number" && Number.isFinite(item.mean));
  if (!usable.length) {
    return { available: false, reason: "No observed per-position quality values were available; no truncation length was chosen.",
      trim_left: null, trunc_len: null, observed: [] };
  }
  const peak = Math.max(...usable.map((item) => item.mean));
  const steepDrop = usable.find((item) => item.position > 20 && item.mean <= Math.max(20, peak * 0.55));
  const cutoff = steepDrop?.position ?? (maxLength ?? usable.length);
  const truncLen = Math.max(20, Math.min(usable.length, cutoff));
  const later = usable.find((item) => item.position >= cutoff + 10);
  const observed = [1, 10, 30, 60, 90, 100, 110, 115, 120, 125, 130, 140, 150]
    .map((position) => ({ position, mean: positions[position - 1] ?? null }))
    .filter((item) => item.mean !== null);
  return {
    available: true,
    reason: `Observed mean quality is ${steepDrop?.mean ?? "unmeasured"} at position ${cutoff} and ` +
      `${later?.mean ?? "lower"} by position ${later?.position ?? "unknown"}; ` +
      `truncation at ${truncLen} keeps the higher-quality prefix. No tutorial value was copied.`,
    trim_left: 0,
    trunc_len: truncLen,
    observed,
    drop_after_threshold: dropAfter
  };
}

// ---------------------------------------------------------------- metadata

export function parseMetadataTsv(text) {
  const source = norm(text);
  const rows = source.split("\n").filter((line) => line.trim());
  if (!rows.length) {
    return { valid: false, columns: [], samples: [], errors: ["metadata is empty"], duplicates: [], invalid: [] };
  }
  const header = splitDelimited(rows[0]);
  const sampleIndex = headerIndex(header, ["sample-id", "sample id", "sampleid", "sample_id"]);
  const barcodeIndex = headerIndex(header, ["barcode-sequence", "barcode sequence", "barcode"]);
  const errors = [];
  if (sampleIndex < 0) errors.push("metadata has no sample-id column");
  const samples = [];
  const seen = new Map();
  const duplicates = [];
  const invalid = [];
  for (let offset = 1; offset < rows.length; offset += 1) {
    const cells = splitDelimited(rows[offset]);
    const sampleId = sampleIndex >= 0 ? clean(cells[sampleIndex], 200) : "";
    const barcode = barcodeIndex >= 0 ? clean(cells[barcodeIndex], 200) : "";
    if (!sampleId || !/^[A-Za-z0-9._-]+$/.test(sampleId)) {
      invalid.push({ row: offset + 1, sample_id: sampleId || null, reason: "missing_or_invalid_sample_id" });
      continue;
    }
    if (seen.has(sampleId)) {
      duplicates.push({ row: offset + 1, sample_id: sampleId, first_row: seen.get(sampleId) });
      continue;
    }
    seen.set(sampleId, offset + 1);
    const record = { sample_id: sampleId, barcode_sequence: barcode || null };
    header.forEach((column, index) => {
      if (index === sampleIndex) return;
      record[clean(column, 120)] = clean(cells[index], 500) || null;
    });
    samples.push(record);
  }
  for (const item of duplicates) errors.push(`duplicate sample id ${item.sample_id} at row ${item.row}`);
  for (const item of invalid) errors.push(`invalid sample id at row ${item.row}`);
  return {
    valid: errors.length === 0,
    columns: header.map((cell) => clean(cell, 120)),
    samples,
    sample_ids: samples.map((sample) => sample.sample_id),
    duplicates, invalid, errors
  };
}

// Verify that EVERY metadata sample maps to exactly one read set. Barcodes may
// be supplied in a separate FASTQ file; there we only verify record counts.
export function validateSampleCorrespondence(metadata, reads, barcodes = null) {
  const metadataIds = Array.isArray(metadata?.sample_ids) ? metadata.sample_ids : [];
  const readIds = Array.isArray(reads?.records)
    ? reads.records.map((record) => record.id)
    : (Array.isArray(reads?.sample_ids) ? reads.sample_ids : []);
  const seen = new Set();
  const missing = [];
  const duplicateReads = [];
  for (const id of readIds) {
    if (seen.has(id)) duplicateReads.push(id);
    seen.add(id);
  }
  const metadataSamples = Array.isArray(metadata?.samples) ? metadata.samples
    : metadataIds.map((sample_id) => ({ sample_id, barcode_sequence: null }));
  const matchedById = metadataSamples.filter((sample) => seen.has(sample.sample_id)).length;
  let basis = "read_header_sample_ids";
  if (matchedById === metadataIds.length) {
    for (const sample of metadataSamples) if (!seen.has(sample.sample_id)) missing.push(sample.sample_id);
  } else if (barcodes?.records?.length) {
    // A multiplexed run has instrument ids in the FASTQ headers. Correspondence
    // is then established through the barcode sequences in the metadata.
    basis = "metadata_barcode_sequences_in_barcode_fastq";
    const barcodeSequences = new Set(barcodes.records.map((record) => record.sequence));
    for (const sample of metadataSamples) {
      if (!sample.barcode_sequence || !barcodeSequences.has(sample.barcode_sequence)) missing.push(sample.sample_id);
    }
  } else {
    for (const sample of metadataSamples) if (!seen.has(sample.sample_id)) missing.push(sample.sample_id);
  }
  const metadataDuplicates = Array.isArray(metadata?.duplicates) ? metadata.duplicates.map((item) => item.sample_id) : [];
  const invalid = Array.isArray(metadata?.invalid) ? metadata.invalid.map((item) => item.row) : [];
  return {
    valid: metadataIds.length > 0 && missing.length === 0 && duplicateReads.length === 0
      && metadataDuplicates.length === 0 && invalid.length === 0,
    metadata_samples: metadataIds.length,
    read_records: readIds.length,
    barcode_records: barcodes?.record_count ?? null,
    barcode_count_matches_reads: barcodes && reads ? barcodes.record_count === reads.record_count : null,
    correspondence_basis: basis,
    missing_samples: missing,
    duplicate_read_ids: duplicateReads,
    duplicate_metadata_samples: metadataDuplicates,
    invalid_metadata_rows: invalid,
    reason: metadataIds.length === 0
      ? "No metadata samples were parsed; no correspondence was established."
      : missing.length
        ? `${missing.length} metadata sample(s) have no matching ${basis === "metadata_barcode_sequences_in_barcode_fastq" ? "barcode sequence" : "reads"}: ${missing.slice(0, 10).join(", ")}.`
        : (duplicateReads.length || metadataDuplicates.length || invalid.length)
          ? "Duplicate or invalid identifiers were found; correspondence is not unique."
          : null
  };
}

// ------------------------------------------------------------ QC summaries

// Parse a real per-sample QC TSV (QIIME 2 vsearch fastq-stats / DADA2 stats /
// a worker-computed raw-read summary). Columns are located by name, never by a
// guessed fixed position.
export function parseQcSummary(text) {
  const source = norm(text);
  const rows = source.split("\n").filter((line) => line.trim());
  if (!rows.length) return { available: false, reason: "QC table is empty.", samples: [], totals: null };
  const header = splitDelimited(rows[0]).map((cell) => clean(cell).replace(/^#/, ""));
  const sampleIndex = headerIndex(header, ["sample-id", "sample id", "sampleid", "sample_id", "#sampleid"]);
  const countIndex = headerIndex(header, ["read count", "reads", "total-input-reads", "total_input_reads",
    "total-reads", "total reads", "input", "count", "sequence count"]);
  if (sampleIndex < 0) return { available: false, reason: "QC table has no sample-id column.", samples: [], totals: null };
  const samples = [];
  for (const row of rows.slice(1)) {
    const cells = splitDelimited(row);
    const sampleId = clean(cells[sampleIndex], 200);
    if (!sampleId) continue;
    const record = { sample_id: sampleId, read_count: countIndex >= 0 ? num(cells[countIndex]) : null };
    header.forEach((column, index) => {
      if (index === sampleIndex || index === countIndex) return;
      const value = num(cells[index]);
      record[clean(column, 120)] = value === null ? (clean(cells[index], 200) || null) : value;
    });
    samples.push(record);
  }
  const counts = samples.map((sample) => sample.read_count).filter((value) => typeof value === "number");
  return {
    available: samples.length > 0,
    reason: samples.length ? null : "No sample rows were present in the QC table.",
    samples,
    totals: samples.length ? {
      samples: samples.length,
      reads: counts.reduce((sum, value) => sum + value, 0),
      reads_available: counts.length === samples.length
    } : null,
    basis: "parsed_from_tool_output"
  };
}

// Local, evidence-only raw FASTQ summary. Used before any Galaxy job exists.
export function rawQcSummary(reads, barcodes = null) {
  return {
    available: Boolean(reads?.valid),
    reason: reads?.valid ? null : "No valid FASTQ reads were parsed; raw QC is unavailable.",
    reads: reads
      ? { read_count: reads.read_count, total_bases: reads.total_bases, min_length: reads.min_length,
        max_length: reads.max_length, length_histogram: histogram(reads.lengths),
        quality_by_position: reads.quality_by_position }
      : null,
    barcodes: barcodes?.valid ? { record_count: barcodes.record_count } : null,
    basis: "worker_computed_from_uploaded_fastq"
  };
}

function histogram(values) {
  const out = new Map();
  for (const value of values) out.set(value, (out.get(value) ?? 0) + 1);
  return [...out.entries()].sort((a, b) => a[0] - b[0]).map(([length, count]) => ({ length, count }));
}

// ------------------------------------------------------------- rep-seqs FASTA

export function parseRepSeqsFasta(text) {
  const source = norm(text);
  const records = [];
  let current = null;
  for (const line of source.split("\n")) {
    if (line.startsWith(">")) {
      if (current) records.push(current);
      const header = clean(line.slice(1), 300);
      current = { id: header.split(/\s+/)[0], header, sequence: "", length: 0 };
    } else if (current && line.trim()) {
      current.sequence += line.trim();
    }
  }
  if (current) records.push(current);
  for (const record of records) record.length = record.sequence.length;
  return {
    available: records.length > 0,
    reason: records.length ? null : "No FASTA records were found in the representative sequences artifact.",
    records,
    feature_ids: records.map((record) => record.id),
    duplicates: duplicatesOf(records.map((record) => record.id))
  };
}

function duplicatesOf(values) {
  const seen = new Set();
  const duplicates = new Set();
  for (const value of values) {
    if (seen.has(value)) duplicates.add(value);
    seen.add(value);
  }
  return [...duplicates];
}

// ------------------------------------------------------------- feature table

// QIIME 2 / BIOM TSV: first header cell is "#OTU ID" (or "#Feature ID"), the
// remaining columns are samples, and an optional trailing "Taxon" column may
// carry taxonomy. JSON BIOM (text) is accepted with an explicit `format` label.
export function parseFeatureTable(text) {
  const source = norm(text).trim();
  if (!source) return { available: false, reason: "Feature table is empty.", format: null,
    feature_ids: [], sample_ids: [], counts: {}, totals: {}, taxonomy: {}, rows: [] };
  if (source.startsWith("{")) return parseBiomJson(source);
  const lines = source.split("\n").filter((line) => line.trim());
  const header = splitDelimited(lines[0]).map((cell) => clean(cell).replace(/^#/, ""));
  let sampleEnd = header.length;
  const taxonIndex = headerIndex(header, ["taxon", "taxonomy", "consensus", "classification"]);
  if (taxonIndex >= 0 && taxonIndex === header.length - 1) sampleEnd = taxonIndex;
  const sampleIds = header.slice(1, sampleEnd).map((cell) => clean(cell, 200));
  const rows = [];
  const counts = {};
  const taxonomy = {};
  const featureIds = [];
  const errors = [];
  for (const line of lines.slice(1)) {
    const cells = splitDelimited(line);
    const featureId = clean(cells[0], 300);
    if (!featureId) continue;
    if (featureIds.includes(featureId)) errors.push(`duplicate feature id ${featureId}`);
    featureIds.push(featureId);
    const values = {};
    sampleIds.forEach((sample, index) => {
      const value = num(cells[index + 1]) ?? 0;
      values[sample] = value;
    });
    counts[featureId] = values;
    if (taxonIndex >= 0) taxonomy[featureId] = clean(cells[taxonIndex], 2000) || null;
    rows.push({ feature_id: featureId, counts: values, taxonomy: taxonomy[featureId] ?? null });
  }
  const totals = {};
  for (const sample of sampleIds) totals[sample] = rows.reduce((sum, row) => sum + (row.counts[sample] ?? 0), 0);
  return {
    available: rows.length > 0 && sampleIds.length > 0,
    reason: rows.length && sampleIds.length ? null : "Feature table has no features or no samples.",
    format: "tsv", feature_ids: featureIds, sample_ids: sampleIds, counts, totals, taxonomy, rows,
    duplicates: duplicatesOf(featureIds), errors
  };
}

function parseBiomJson(source) {
  try {
    const biom = JSON.parse(source);
    const sampleIds = (biom.sample_ids ?? []).map((value) => clean(value, 200));
    const featureIds = (biom.observation_ids ?? biom.otu_ids ?? []).map((value) => clean(value, 300));
    const data = Array.isArray(biom.data) ? biom.data : [];
    const declaredType = String(biom.matrix_type ?? "").toLowerCase();
    // Real QIIME 2 BIOM v1 "sparse" stores [row, col, value] triplets. A dense
    // table stores one row of sample values per observation. Detect the shape
    // explicitly (and validate triplet indices) so a dense row of small counts
    // is not misread as a sparse triple.
    const first = Array.isArray(data[0]) ? data[0] : null;
    const looksSparse = Boolean(first && first.length === 3
      && Number.isInteger(first[0]) && first[0] >= 0 && first[0] < featureIds.length
      && Number.isInteger(first[1]) && first[1] >= 0 && first[1] < sampleIds.length
      && typeof first[2] === "number");
    const sparse = declaredType === "sparse"
      || (declaredType !== "dense" && looksSparse);
    const errors = [];
    const counts = {};
    featureIds.forEach((featureId) => {
      const values = {};
      sampleIds.forEach((sample) => { values[sample] = 0; });
      counts[featureId] = values;
    });
    if (sparse) {
      for (const entry of data) {
        if (!Array.isArray(entry) || entry.length < 3) {
          errors.push("malformed_sparse_biom_triplet");
          continue;
        }
        const feature = featureIds[entry[0]];
        const sample = sampleIds[entry[1]];
        const value = num(entry[2]) ?? 0;
        if (!feature || !sample) { errors.push("sparse_biom_index_out_of_range"); continue; }
        counts[feature][sample] += value;
      }
    } else {
      featureIds.forEach((featureId, featureIndex) => {
        const row = data[featureIndex];
        if (!Array.isArray(row)) return;
        row.forEach((value, sampleIndex) => {
          const sample = sampleIds[sampleIndex];
          if (sample) counts[featureId][sample] = num(value) ?? 0;
        });
      });
    }
    const rows = featureIds.map((featureId) => ({ feature_id: featureId,
      counts: counts[featureId], taxonomy: null }));
    const totals = {};
    sampleIds.forEach((sample) => {
      totals[sample] = rows.reduce((sum, row) => sum + (row.counts[sample] ?? 0), 0);
    });
    return {
      available: rows.length > 0 && sampleIds.length > 0,
      reason: rows.length && sampleIds.length ? null : "BIOM JSON has no observations or no samples.",
      format: "biom-json", matrix_type: sparse ? "sparse" : "dense",
      feature_ids: featureIds, sample_ids: sampleIds, counts, totals,
      taxonomy: {}, rows, duplicates: duplicatesOf(featureIds), errors
    };
  } catch (error) {
    return { available: false, reason: `BIOM JSON could not be parsed: ${error?.message ?? error}`,
      format: "biom-json", feature_ids: [], sample_ids: [], counts: {}, totals: {}, taxonomy: {}, rows: [] };
  }
}

// ------------------------------------------------------------------ taxonomy

const RANK_PREFIXES = { d: "domain", k: "kingdom", p: "phylum", c: "class", o: "order", f: "family", g: "genus", s: "species" };

export function parseTaxonomyTsv(text) {
  const source = norm(text).trim();
  if (!source) return { available: false, reason: "Taxonomy table is empty.", by_feature: {}, assignments: [] };
  const lines = source.split("\n").filter((line) => line.trim());
  const header = splitDelimited(lines[0]).map((cell) => clean(cell).replace(/^#/, "").toLowerCase());
  const idIndex = headerIndex(header, ["feature id", "feature-id", "otu id", "asv id", "id"]);
  const taxonIndex = headerIndex(header, ["taxon", "taxonomy", "consensus", "classification"]);
  const confidenceIndex = headerIndex(header, ["confidence", "score"]);
  if (idIndex < 0 || taxonIndex < 0) {
    return { available: false, reason: "Taxonomy table has no feature-id or taxon column.", by_feature: {}, assignments: [] };
  }
  const byFeature = {};
  const assignments = [];
  for (const line of lines.slice(1)) {
    const cells = splitDelimited(line);
    const featureId = clean(cells[idIndex], 300);
    if (!featureId) continue;
    const taxon = clean(cells[taxonIndex], 2000) || null;
    const confidence = confidenceIndex >= 0 ? num(cells[confidenceIndex]) : null;
    const ranks = {};
    if (taxon) {
      for (const token of taxon.split(";")) {
        const trimmed = token.trim();
        const match = trimmed.match(/^([dkpcofgs])__\s*(.*)$/i);
        if (match) ranks[RANK_PREFIXES[match[1].toLowerCase()]] = clean(match[2], 200) || null;
      }
    }
    const record = { feature_id: featureId, taxon, confidence, ranks,
      unclassified: !taxon || Object.values(ranks).every((value) => !value || /^unassigned|unclassified$/i.test(value)) };
    byFeature[featureId] = record;
    assignments.push(record);
  }
  return {
    available: assignments.length > 0,
    reason: assignments.length ? null : "No taxonomy assignments were present.",
    by_feature: byFeature, assignments
  };
}

export function aggregateByRank(table, taxonomy, { rank = "phylum", includeUnclassified = true } = {}) {
  if (!table?.available || !taxonomy?.available) {
    return { available: false, reason: "Feature table or taxonomy is unavailable; no composition was computed.",
      rank, samples: [] };
  }
  const rankKey = Object.values(RANK_PREFIXES).includes(rank) ? rank : "phylum";
  const labelFor = (featureId) => {
    const entry = taxonomy.by_feature[featureId];
    if (!entry?.taxon) return null;
    const value = entry.ranks?.[rankKey];
    return value && !/^unassigned|unclassified$/i.test(value) ? value : null;
  };
  const samples = table.sample_ids.map((sample) => {
    const buckets = new Map();
    let unclassifiedCount = 0;
    let total = 0;
    for (const featureId of table.feature_ids) {
      const count = table.counts[featureId]?.[sample] ?? 0;
      if (count <= 0) continue;
      total += count;
      const label = labelFor(featureId);
      if (!label) unclassifiedCount += count;
      else buckets.set(label, (buckets.get(label) ?? 0) + count);
    }
    const taxa = [...buckets.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([name, count]) => ({ taxon: name, count, fraction: total ? Math.round((count / total) * 1_000_000) / 1_000_000 : 0 }));
    if (includeUnclassified && unclassifiedCount > 0) {
      taxa.push({ taxon: "Unclassified", count: unclassifiedCount,
        fraction: total ? Math.round((unclassifiedCount / total) * 1_000_000) / 1_000_000 : 0 });
    }
    return { sample_id: sample, total, unclassified_count: unclassifiedCount, taxa, rank: rankKey };
  });
  return {
    available: samples.length > 0,
    reason: samples.length ? null : "No samples were present in the feature table.",
    basis: "computed_from_real_feature_table_counts",
    rank: rankKey, samples
  };
}

// --------------------------------------------------------- integrity checks

export function validateFeatureTableIntegrity({ table, repSeqs, taxonomy, metadata } = {}) {
  const errors = [];
  const warnings = [];
  if (!table?.available) errors.push("feature_table_unavailable");
  if (!repSeqs?.available) errors.push("rep_seqs_unavailable");
  if (!taxonomy?.available) errors.push("taxonomy_unavailable");
  const featureIds = table?.feature_ids ?? [];
  const repIds = repSeqs?.feature_ids ?? [];
  const repSet = new Set(repIds);
  const tableSet = new Set(featureIds);
  const missingRepSeqs = featureIds.filter((id) => !repSet.has(id));
  const extraRepSeqs = repIds.filter((id) => !tableSet.has(id));
  const missingTaxonomy = featureIds.filter((id) => !taxonomy?.by_feature?.[id]);
  const sampleIds = table?.sample_ids ?? [];
  const metadataIds = metadata?.sample_ids ?? [];
  const unknownSamples = sampleIds.filter((id) => !metadataIds.includes(id));
  if (missingRepSeqs.length) warnings.push(`${missingRepSeqs.length} feature(s) have no representative sequence.`);
  if (extraRepSeqs.length) warnings.push(`${extraRepSeqs.length} representative sequence(s) are absent from the feature table.`);
  if (missingTaxonomy.length) warnings.push(`${missingTaxonomy.length} feature(s) have no taxonomy assignment; they remain unclassified.`);
  if (unknownSamples.length) warnings.push(`${unknownSamples.length} feature-table sample(s) are absent from metadata.`);
  if ((table?.duplicates ?? []).length) errors.push(`duplicate feature ids: ${table.duplicates.join(", ")}`);
  if ((repSeqs?.duplicates ?? []).length) errors.push(`duplicate rep-seq ids: ${repSeqs.duplicates.join(", ")}`);
  const totalReads = Object.values(table?.totals ?? {}).reduce((sum, value) => sum + value, 0);
  return {
    valid: errors.length === 0,
    errors, warnings,
    coverage: {
      features: featureIds.length,
      rep_seqs: repIds.length,
      features_with_rep_seq: featureIds.length - missingRepSeqs.length,
      features_with_taxonomy: featureIds.length - missingTaxonomy.length,
      samples: sampleIds.length,
      metadata_samples: metadataIds.length,
      total_assignable_reads: totalReads
    },
    missing_rep_seqs: missingRepSeqs, extra_rep_seqs: extraRepSeqs,
    missing_taxonomy: missingTaxonomy, unknown_samples: unknownSamples
  };
}

// ------------------------------------------------------------- alpha / beta

export function parseAlphaDiversity(text, { faithRequiresRootedTree = true, rootedTree = false } = {}) {
  const source = norm(text).trim();
  if (!source) return { available: false, reason: "Alpha-diversity table is empty.", samples: [] };
  const lines = source.split("\n").filter((line) => line.trim());
  const header = splitDelimited(lines[0]).map((cell) => clean(cell).replace(/^#/, "").toLowerCase());
  const sampleIndex = headerIndex(header, ["sample-id", "sampleid", "sample id", "sample_id"]);
  if (sampleIndex < 0) return { available: false, reason: "Alpha table has no sample-id column.", samples: [] };
  const observedIndex = headerIndex(header, ["observed-features", "observed_features", "observed_otus", "richness"]);
  const shannonIndex = headerIndex(header, ["shannon", "shannon_index", "shannon diversity"]);
  const faithIndex = headerIndex(header, ["faith_pd", "faith-pd", "faith pd", "faith's phylogenetic diversity"]);
  const samples = [];
  for (const line of lines.slice(1)) {
    const cells = splitDelimited(line);
    const sampleId = clean(cells[sampleIndex], 200);
    if (!sampleId) continue;
    const record = { sample_id: sampleId, observed_features: observedIndex >= 0 ? num(cells[observedIndex]) : null,
      shannon: shannonIndex >= 0 ? num(cells[shannonIndex]) : null };
    if (faithIndex >= 0 && (!faithRequiresRootedTree || rootedTree)) record.faith_pd = num(cells[faithIndex]);
    else record.faith_pd = null;
    samples.push(record);
  }
  return {
    available: samples.length > 0,
    reason: samples.length ? null : "No alpha-diversity sample rows were found.",
    samples,
    faith_reason: faithIndex < 0 ? "No Faith's PD column was present in the tool output."
      : (!rootedTree ? "Faith's PD is withheld: no valid rooted tree was available." : null),
    basis: "parsed_from_tool_output"
  };
}

// Worker-computed alpha diversity from a REAL feature table. Clearly labelled;
// never represented as a QIIME 2 tool result.
export function computeAlphaFromTable(table) {
  if (!table?.available) return { available: false, reason: "Feature table is unavailable.", samples: [] };
  const samples = table.sample_ids.map((sample) => {
    let total = 0;
    let observed = 0;
    let shannon = 0;
    for (const featureId of table.feature_ids) {
      const count = table.counts[featureId]?.[sample] ?? 0;
      if (count <= 0) continue;
      total += count;
      observed += 1;
      const fraction = count / Math.max(1, table.totals[sample]);
      shannon -= fraction * Math.log(fraction);
    }
    return { sample_id: sample, observed_features: observed, shannon: Math.round(shannon * 1_000_000) / 1_000_000,
      faith_pd: null, faith_reason: "Faith's PD is not computed by the worker: it requires a valid rooted tree." };
  });
  return { available: true, samples, basis: "worker_computed_from_real_feature_table_counts",
    reason: null };
}

export function parseDistanceMatrix(text, { metric = "bray_curtis" } = {}) {
  const source = norm(text).trim();
  if (!source) return { available: false, reason: "Distance matrix is empty.", samples: [], matrix: [], metric };
  const lines = source.split("\n").filter((line) => line.trim());
  const header = splitDelimited(lines[0]).slice(1).map((cell) => clean(cell, 200));
  const samples = [];
  const matrix = [];
  for (const line of lines.slice(1)) {
    const cells = splitDelimited(line);
    const sampleId = clean(cells[0], 200);
    if (!sampleId) continue;
    samples.push(sampleId);
    matrix.push(cells.slice(1).map((cell) => num(cell) ?? 0));
  }
  if (!samples.length) return { available: false, reason: "No distance-matrix rows were found.", samples: [], matrix: [], metric };
  return { available: true, reason: null, samples, matrix, metric, basis: "parsed_from_tool_output" };
}

// Worker-computed Bray–Curtis from the REAL feature table (counts), used only
// when no genuine distance-matrix artifact was retrieved. Labelled accordingly.
export function computeBrayCurtis(table) {
  if (!table?.available) return { available: false, reason: "Feature table is unavailable.", samples: [], matrix: [], metric: "bray_curtis" };
  const samples = table.sample_ids;
  const matrix = samples.map((left) => samples.map((right) => {
    if (left === right) return 0;
    let numerator = 0;
    let leftTotal = 0;
    let rightTotal = 0;
    for (const featureId of table.feature_ids) {
      const a = table.counts[featureId]?.[left] ?? 0;
      const b = table.counts[featureId]?.[right] ?? 0;
      numerator += Math.abs(a - b);
      leftTotal += a;
      rightTotal += b;
    }
    const denominator = leftTotal + rightTotal;
    return denominator ? Math.round((numerator / denominator) * 1_000_000) / 1_000_000 : 0;
  }));
  return { available: true, reason: null, samples, matrix, metric: "bray_curtis",
    basis: "worker_computed_from_real_feature_table_counts" };
}

// ---------------------------------------------------------------------- PCoA

export function parsePcoa(text) {
  const source = norm(text).trim();
  if (!source) return { available: false, reason: "PCoA coordinate file is empty.", samples: [], coordinates: [] };
  const lines = source.split("\n").filter((line) => line.trim());
  const header = splitDelimited(lines[0]).map((cell) => clean(cell).replace(/^#/, ""));
  const sampleIndex = headerIndex(header, ["sample-id", "sampleid", "sample id", "sample_id"]);
  if (sampleIndex < 0) return { available: false, reason: "PCoA file has no sample-id column.", samples: [], coordinates: [] };
  const axes = header.map((cell, index) => ({ name: clean(cell, 120), index }))
    .filter((entry) => entry.index !== sampleIndex && /^(pc|pcoa|axis)/i.test(entry.name));
  const coordinates = [];
  for (const line of lines.slice(1)) {
    if (line.trim().startsWith("#")) continue; // QIIME 2 variance footer, not a sample
    const cells = splitDelimited(line);
    const sampleId = clean(cells[sampleIndex], 200);
    if (!sampleId) continue;
    const values = {};
    for (const axis of axes) values[axis.name] = num(cells[axis.index]);
    coordinates.push({ sample_id: sampleId, values });
  }
  return {
    available: coordinates.length > 0,
    reason: coordinates.length ? null : "No PCoA sample rows were found.",
    samples: coordinates.map((entry) => entry.sample_id),
    axes: axes.map((axis) => axis.name),
    coordinates,
    // Fractions (0-1) from here on, matching computePcoa(). The QIIME 2 footer
    // reports percentages; they are divided by 100 exactly once at this boundary.
    variance_explained: extractVariance(source, axes.map((axis) => axis.name)),
    variance_units: "fraction_of_total_variance",
    basis: "parsed_from_tool_output"
  };
}

function extractVariance(source, axes) {
  const out = {};
  for (const axis of axes) {
    const match = source.match(new RegExp(`${axis.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[^\\n]{0,120}?([0-9]+(?:\\.[0-9]+)?)\\s*%`, "i"));
    if (match) out[axis] = Math.round((num(match[1]) / 100) * 1_000_000) / 1_000_000;
  }
  return Object.keys(out).length ? out : null;
}

// Classic multidimensional scaling (principal coordinates) computed from a real
// distance matrix. Deterministic power iteration; no random seed. Labelled as
// worker-derived, never as an emperor/QIIME 2 artifact.
export function computePcoa(distance, { dimensions = 3 } = {}) {
  if (!distance?.available || distance.matrix.length < 2) {
    return { available: false, reason: "A usable distance matrix is unavailable; no PCoA was computed.",
      samples: [], axes: [], coordinates: [] };
  }
  const n = distance.samples.length;
  const d2 = distance.matrix.map((row) => row.map((value) => value * value));
  const rowMeans = d2.map((row) => row.reduce((sum, value) => sum + value, 0) / n);
  const grand = rowMeans.reduce((sum, value) => sum + value, 0) / n;
  const gram = d2.map((row, i) => row.map((value, j) => 0.5 * (rowMeans[i] + rowMeans[j] - grand - value)));
  // Power iteration on the centering projection B = H G H, applied implicitly
  // so no dense eigendecomposition library is needed.
  const centeredMultiply = (vector) => {
    const mean = vector.reduce((sum, value) => sum + value, 0) / n;
    const shifted = vector.map((value) => value - mean);
    return gram.map((row, i) => {
      let sum = 0;
      for (let j = 0; j < n; j += 1) sum += row[j] * shifted[j];
      return sum - (gram[i] ?? []).reduce((acc, value, j) => acc + value * shifted[j], 0) / n;
    });
  };
  const axes = [];
  const used = [];
  for (let axis = 0; axis < Math.min(dimensions, n - 1); axis += 1) {
    let vector = distance.samples.map((_, index) => Math.cos((index + 1) * (axis + 1) * 0.618));
    for (let iteration = 0; iteration < 200; iteration += 1) {
      let next = centeredMultiply(vector);
      for (const prior of used) {
        const dot = next.reduce((sum, value, index) => sum + value * prior.vector[index], 0);
        next = next.map((value, index) => value - dot * prior.vector[index]);
      }
      const normValue = Math.sqrt(next.reduce((sum, value) => sum + value * value, 0));
      if (normValue < 1e-12) break;
      vector = next.map((value) => value / normValue);
    }
    const projected = centeredMultiply(vector);
    let eigenvalue = vector.reduce((sum, value, index) => sum + value * projected[index], 0);
    if (eigenvalue <= 0) break;
    used.push({ vector, eigenvalue });
    axes.push(`PC${axis + 1}`);
  }
  const coordinates = used.map(({ vector, eigenvalue }, axisIndex) => ({
    vector: vector.map((value) => value * Math.sqrt(eigenvalue)), axis: axes[axisIndex], eigenvalue
  }));
  const totalEigen = used.reduce((sum, entry) => sum + Math.max(0, entry.eigenvalue), 0);
  const rows = distance.samples.map((sample, index) => {
    const values = {};
    coordinates.forEach((entry, axisIndex) => {
      values[entry.axis] = Math.round(entry.vector[index] * 1_000_000) / 1_000_000;
    });
    return { sample_id: sample, values };
  });
  return {
    available: rows.length > 0 && axes.length > 0,
    reason: rows.length && axes.length ? null : "The distance matrix had no positive eigenvalues; no coordinates were computed.",
    samples: distance.samples, axes, coordinates: rows,
    variance_explained: totalEigen
      ? Object.fromEntries(coordinates.map((entry) => [entry.axis, Math.round((Math.max(0, entry.eigenvalue) / totalEigen) * 1_000_000) / 1_000_000]))
      : null,
    variance_units: "fraction_of_total_variance",
    basis: "worker_computed_from_real_distance_matrix"
  };
}

export function parseDenoisingStats(text) {
  const parsed = parseQcSummary(text);
  return {
    ...parsed,
    reason: parsed.available ? null : (parsed.reason ?? "No denoising statistics were retrieved."),
    basis: parsed.available ? "parsed_from_tool_output" : null
  };
}

// Ordination/visualization evidence. The emperor QIIME 2 visualization is a
// binary .qzv artifact: its coordinates come from the real PCoA parsing above,
// never from a synthetic layout here.
export function ordinationEvidence(artifacts, pcoa, { visualizationTool = null } = {}) {
  const visuals = (artifacts ?? []).filter((artifact) => /\.(qzv|html)$/i.test(String(artifact?.name ?? ""))
    || /emperor|ordination|plot/i.test(String(artifact?.name ?? "")));
  return {
    available: Boolean(pcoa?.available),
    reason: pcoa?.available ? null : "No PCoA coordinates are available; no ordination view was drawn.",
    coordinates_source: pcoa?.basis ?? null,
    coordinates: pcoa?.coordinates ?? [],
    visualization_artifacts: visuals.map((artifact) => ({ name: artifact.name,
      sha256: artifact.sha256 ?? artifact.checksum ?? null,
      bytes: artifact.bytes ?? null, kind: artifact.kind ?? null })),
    visualization_tool: visualizationTool,
    note: visuals.length
      ? "Visualization artifact(s) are original tool downloads; the plotted points use the reported PCoA coordinates."
      : "No emperor/ordination visualization artifact was retrieved; only the coordinate table is displayed."
  };
}
