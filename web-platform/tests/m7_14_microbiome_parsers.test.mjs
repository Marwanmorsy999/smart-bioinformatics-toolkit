// M7.14 PURE PARSER TESTS — labelled fixtures, zero provider calls.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  aggregateByRank, chooseTruncation, computeAlphaFromTable, computeBrayCurtis,
  computePcoa, ordinationEvidence, parseAlphaDiversity, parseDenoisingStats,
  parseDistanceMatrix, parseFastq, parseFeatureTable, parseMetadataTsv, parsePcoa,
  parseQcSummary, parseRepSeqsFasta, parseTaxonomyTsv, rawQcSummary,
  validateFeatureTableIntegrity, validateSampleCorrespondence
} from "../functions/api/ai/workflows/microbiome/parsers.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const fixture = (name) => readFileSync(resolve(HERE, "fixtures/m7_14_microbiome", name), "utf8");

const FASTQ = fixture("sequences.fastq");
const BARCODES = fixture("barcodes.fastq");
const METADATA = fixture("sample-metadata.tsv");
const TABLE = fixture("feature-table.tsv");
const REPSEQS = fixture("rep-seqs.fasta");
const TAXONOMY = fixture("taxonomy.tsv");
const QC = fixture("qc-stats.tsv");
const ALPHA = fixture("alpha.tsv");
const DISTANCE = fixture("distance.tsv");
const PCoA = fixture("pcoa.tsv");

const parsed = () => ({
  reads: parseFastq(FASTQ, { label: "sequences.fastq" }),
  barcodes: parseFastq(BARCODES, { label: "barcodes.fastq" }),
  metadata: parseMetadataTsv(METADATA),
  table: parseFeatureTable(TABLE),
  repSeqs: parseRepSeqsFasta(REPSEQS),
  taxonomy: parseTaxonomyTsv(TAXONOMY)
});

test("FIXTURE: FASTQ parser reads real 4-line records and per-position quality", () => {
  const reads = parseFastq(FASTQ);
  assert.equal(reads.valid, true);
  assert.equal(reads.record_count, 3);
  assert.deepEqual(reads.lengths, [12, 12, 12]);
  assert.equal(reads.total_bases, 36);
  assert.equal(reads.quality_by_position.length, 12);
  assert.ok(reads.quality_by_position.every((value) => value > 30));
  const bad = parseFastq("@a\nACGT\n+\nII");
  assert.equal(bad.valid, false);
  assert.match(bad.errors.join(" "), /mismatch/);
});

test("FIXTURE: metadata parser reports missing, duplicate and invalid sample ids", () => {
  const metadata = parseMetadataTsv(METADATA);
  assert.equal(metadata.valid, true);
  assert.deepEqual(metadata.sample_ids, ["sampleA", "sampleB", "sampleC"]);
  assert.ok(metadata.columns.includes("barcode-sequence"));
  const duplicate = parseMetadataTsv(METADATA + "sampleA\tAAA\tgut\t2026\t10\t1\tsubject-01\tno\t0\n");
  assert.equal(duplicate.valid, false);
  assert.equal(duplicate.duplicates.length, 1);
  const invalid = parseMetadataTsv("sample-id\tbarcode-sequence\nsampleA\tAAA\nbad id\tBBB\n");
  assert.equal(invalid.valid, false);
  assert.ok(invalid.invalid.length >= 1);
  const noColumn = parseMetadataTsv("id\tbarcode\nsampleA\tAAAA\n");
  assert.equal(noColumn.valid, false);
  assert.match(noColumn.errors.join(" "), /no sample-id column/);
});

test("FIXTURE: metadata-to-reads correspondence is strict and honest", () => {
  const { reads, barcodes, metadata } = parsed();
  const ok = validateSampleCorrespondence(metadata, reads, barcodes);
  assert.equal(ok.valid, true);
  assert.equal(ok.barcode_count_matches_reads, true);
  assert.equal(ok.correspondence_basis, "metadata_barcode_sequences_in_barcode_fastq");
  const missing = validateSampleCorrespondence({ sample_ids: ["sampleA", "missingSample"],
    samples: [{ sample_id: "sampleA", barcode_sequence: "ACCGCACTT" },
      { sample_id: "missingSample", barcode_sequence: "NOTPRESENT" }],
    duplicates: [], invalid: [] }, reads, barcodes);
  assert.equal(missing.valid, false);
  assert.deepEqual(missing.missing_samples, ["missingSample"]);
  assert.match(missing.reason, /missingSample/);
  const duplicate = validateSampleCorrespondence({ sample_ids: ["sampleA"], duplicates: [{ sample_id: "sampleA" }], invalid: [] }, reads);
  assert.equal(duplicate.valid, false);
});

test("OBSERVED QUALITY: truncation rationale is derived from real means, not the tutorial value", () => {
  const means = [36.66, 37.7, 38.53, 36.59, 30.8, 28.37, 22.65, 21.7, 19.56, 16.66, 13.52, 5.41, 3.79];
  // Map the measured positions onto a dense array for the pure chooser.
  const dense = Array.from({ length: 150 }, (_, index) => {
    const position = index + 1;
    const marks = [1, 10, 30, 60, 90, 100, 110, 115, 120, 125, 130, 140, 150];
    const slot = marks.findIndex((mark) => mark === position);
    return slot >= 0 ? means[slot] : null;
  }).map((value, index, all) => value ?? all.slice(0, index).reverse().find((entry) => entry !== null) ?? null);
  const choice = chooseTruncation(dense, { maxLength: 152 });
  assert.equal(choice.available, true);
  assert.equal(choice.trim_left, 0);
  assert.equal(choice.trunc_len, 120);
  assert.match(choice.reason, /Observed mean quality/);
  assert.ok(choice.observed.some((entry) => entry.position === 120 && entry.mean === 19.56));
  assert.doesNotMatch(choice.reason, /1103/);
  const unavailable = chooseTruncation([]);
  assert.equal(unavailable.available, false);
  assert.ok(unavailable.reason);
});

test("FIXTURE: QC summary totals come only from parsed rows", () => {
  const qc = parseQcSummary(QC);
  assert.equal(qc.available, true);
  assert.equal(qc.samples.length, 3);
  assert.equal(qc.totals.reads, 34);
  assert.equal(qc.totals.reads_available, true);
  const empty = parseQcSummary("");
  assert.equal(empty.available, false);
  assert.ok(empty.reason);
  const raw = rawQcSummary(parseFastq(FASTQ));
  assert.equal(raw.reads.read_count, 3);
  assert.equal(raw.basis, "worker_computed_from_uploaded_fastq");
});

test("FIXTURE: feature table, rep-seqs and taxonomy parse deterministically", () => {
  const { table, repSeqs, taxonomy } = parsed();
  assert.equal(table.available, true);
  assert.deepEqual(table.sample_ids, ["sampleA", "sampleB", "sampleC"]);
  assert.deepEqual(table.feature_ids, ["asv1", "asv2", "asv3"]);
  assert.equal(table.totals.sampleA, 12);
  assert.equal(table.totals.sampleB, 13);
  assert.equal(repSeqs.feature_ids.length, 3);
  assert.equal(repSeqs.records[0].length, 16);
  assert.equal(taxonomy.by_feature.asv1.ranks.phylum, "Firmicutes");
  assert.equal(taxonomy.by_feature.asv3.unclassified, true);
  const biom = parseFeatureTable(JSON.stringify({ sample_ids: ["s1"], observation_ids: ["f1"], data: [[4]] }));
  assert.equal(biom.format, "biom-json");
  assert.equal(biom.totals.s1, 4);
});

test("RELATIVE ABUNDANCE: computed from real counts and keeps unclassified", () => {
  const { table, taxonomy } = parsed();
  const composition = aggregateByRank(table, taxonomy, { rank: "phylum" });
  assert.equal(composition.available, true);
  const sampleA = composition.samples.find((entry) => entry.sample_id === "sampleA");
  assert.equal(sampleA.total, 12);
  const firmicutes = sampleA.taxa.find((entry) => entry.taxon === "Firmicutes");
  assert.equal(firmicutes.count, 10);
  assert.equal(firmicutes.fraction, Math.round((10 / 12) * 1e6) / 1e6);
  assert.ok(sampleA.taxa.some((entry) => entry.taxon === "Unclassified" && entry.count === 0) === false);
  const sampleB = composition.samples.find((entry) => entry.sample_id === "sampleB");
  const unclassified = sampleB.taxa.find((entry) => entry.taxon === "Unclassified");
  assert.equal(unclassified.count, 1);
  assert.equal(unclassified.fraction, Math.round((1 / 13) * 1e6) / 1e6);
  const without = aggregateByRank(table, taxonomy, { includeUnclassified: false });
  assert.equal(without.samples[1].taxa.some((entry) => entry.taxon === "Unclassified"), false);
  const missing = aggregateByRank(null, taxonomy);
  assert.equal(missing.available, false);
  assert.ok(missing.reason);
});

test("INTEGRITY: rep-seq and taxonomy coverage is checked, never assumed", () => {
  const { table, repSeqs, taxonomy, metadata } = parsed();
  const ok = validateFeatureTableIntegrity({ table, repSeqs, taxonomy, metadata });
  assert.equal(ok.valid, true);
  assert.equal(ok.coverage.features, 3);
  assert.equal(ok.coverage.features_with_taxonomy, 3);
  const short = { ...repSeqs, feature_ids: ["asv1"] };
  const partial = validateFeatureTableIntegrity({ table, repSeqs: short, taxonomy: { ...taxonomy,
    by_feature: { asv1: taxonomy.by_feature.asv1 } }, metadata });
  assert.equal(partial.valid, true);
  assert.ok(partial.warnings.some((warning) => /representative sequence/.test(warning)));
  assert.ok(partial.warnings.some((warning) => /no taxonomy/.test(warning)));
  const bad = validateFeatureTableIntegrity({ table: { ...table, duplicates: ["asv1"] }, repSeqs, taxonomy, metadata });
  assert.equal(bad.valid, false);
});

test("FIXTURE: alpha diversity withholds Faith's PD without a rooted tree", () => {
  const alpha = parseAlphaDiversity(ALPHA);
  assert.equal(alpha.available, true);
  assert.equal(alpha.samples[0].observed_features, 3);
  assert.equal(alpha.samples[0].faith_pd, null);
  assert.match(alpha.faith_reason, /rooted tree/);
  const withTree = parseAlphaDiversity(ALPHA, { rootedTree: true });
  assert.equal(withTree.samples[0].faith_pd, 2.4);
  const worker = computeAlphaFromTable(parsed().table);
  assert.equal(worker.available, true);
  assert.equal(worker.samples[0].observed_features, 2);
  assert.equal(worker.samples[0].faith_pd, null);
  assert.equal(worker.basis, "worker_computed_from_real_feature_table_counts");
});

test("FIXTURE: Bray–Curtis and PCoA are parsed or computed from actual data", () => {
  const distance = parseDistanceMatrix(DISTANCE);
  assert.equal(distance.available, true);
  assert.equal(distance.matrix[0][1], 0.42);
  const workerDistance = computeBrayCurtis(parsed().table);
  assert.equal(workerDistance.matrix[0][0], 0);
  assert.notEqual(workerDistance.matrix[0][1], 0);
  assert.equal(workerDistance.basis, "worker_computed_from_real_feature_table_counts");
  const pcoa = parsePcoa(PCoA);
  assert.equal(pcoa.available, true);
  assert.deepEqual(pcoa.axes, ["PC1", "PC2"]);
  assert.equal(pcoa.coordinates[0].values.PC1, -0.42);
  assert.equal(pcoa.variance_explained.PC1, 62);
  const computed = computePcoa(distance, { dimensions: 2 });
  assert.equal(computed.available, true);
  assert.equal(computed.coordinates.length, 3);
  assert.equal(computed.basis, "worker_computed_from_real_distance_matrix");
  assert.equal(computePcoa(null).available, false);
});

test("FIXTURE: denoising stats and ordination evidence report honest nulls", () => {
  const stats = parseDenoisingStats(QC);
  assert.equal(stats.available, true);
  assert.equal(parseDenoisingStats("").available, false);
  const pcoa = parsePcoa(PCoA);
  const evidence = ordinationEvidence([{ name: "emperor visualization.qzv", sha256: "a".repeat(64), bytes: 12 }], pcoa,
    { visualizationTool: "qiime2 emperor plot" });
  assert.equal(evidence.available, true);
  assert.equal(evidence.visualization_artifacts.length, 1);
  assert.equal(evidence.visualization_tool, "qiime2 emperor plot");
  const none = ordinationEvidence([], null);
  assert.equal(none.available, false);
  assert.match(none.reason, /No PCoA coordinates/);
});
