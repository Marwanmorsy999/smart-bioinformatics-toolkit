// M7.14.2 LABELLED DIVERSITY / REPORT TESTS — fixture SHAPE only, ZERO live calls.
// Fixtures exercise the deterministic helpers; the production engine uses the
// same helpers on ACTUAL retrieved Galaxy artifacts. No significance, group
// separation or invented release is accepted here.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  aggregateByRank, chooseRarefactionDepth, computeAlphaFromTable, computeBrayCurtis,
  computePcoa, parseFeatureTable, parseRepSeqsFasta, parseTaxonomyTsv,
  validateFeatureTableIntegrity
} from "../functions/api/ai/workflows/microbiome/parsers.js";
import { buildExports, buildResult } from "../functions/api/ai/workflows/microbiome/engine.js";
import { QIIME_CLASSIFIER, classifierProvenance } from "../functions/api/ai/workflows/microbiome/classifier-prep.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const fixture = (name) => readFileSync(resolve(HERE, "fixtures/m7_14_microbiome", name), "utf8");

function parsed() {
  return {
    table: parseFeatureTable(fixture("feature-table.tsv")),
    repSeqs: parseRepSeqsFasta(fixture("rep-seqs.fasta")),
    taxonomy: parseTaxonomyTsv(fixture("taxonomy.tsv"))
  };
}

test("REAL TABLE / alpha, Bray–Curtis and PCoA derive from parsed feature-table counts", () => {
  const { table } = parsed();
  assert.equal(table.available, true);
  assert.deepEqual(table.totals, { sampleA: 12, sampleB: 13, sampleC: 9 });

  const alpha = computeAlphaFromTable(table);
  const sampleA = alpha.samples.find((entry) => entry.sample_id === "sampleA");
  assert.equal(sampleA.observed_features, 2);
  const expectedShannon = -((10 / 12) * Math.log(10 / 12) + (2 / 12) * Math.log(2 / 12));
  assert.equal(sampleA.shannon, Math.round(expectedShannon * 1_000_000) / 1_000_000);
  assert.equal(sampleA.faith_pd, null, "no rooted tree is required or invented");
  assert.match(alpha.basis, /worker_computed_from_real_feature_table_counts/);

  const beta = computeBrayCurtis(table);
  assert.equal(beta.metric, "bray_curtis");
  assert.equal(beta.samples.length, 3);
  assert.equal(beta.matrix[0][1], 0.44); // (5+5+1)/(12+13)
  assert.match(beta.basis, /worker_computed_from_real_feature_table_counts/);

  const pcoa = computePcoa(beta, { dimensions: 2 });
  assert.equal(pcoa.available, true);
  assert.equal(pcoa.coordinates.length, 3);
  assert.ok(pcoa.axes.length >= 1);
  assert.ok(Object.values(pcoa.variance_explained ?? {}).every((value) => value >= 0 && value <= 1));
  assert.match(pcoa.basis, /worker_computed_from_real_distance_matrix/);
});

test("RAREFACTION / depth and excluded samples come from real post-denoising counts", () => {
  const real = parsed().table;
  const withZeroSample = { ...real, sample_ids: [...real.sample_ids, "emptySample"],
    totals: { ...real.totals, emptySample: 0 } };
  const depth = chooseRarefactionDepth(withZeroSample, { metadata: { sample_ids: real.sample_ids } });
  assert.equal(depth.depth, 9); // smallest real non-zero per-sample total
  assert.match(depth.basis, /derived_from_retrieved_feature_table_post_denoising_counts/);
  assert.equal(depth.included.length, 3);
  assert.equal(depth.excluded.length, 1);
  assert.deepEqual(depth.excluded[0], { sample_id: "emptySample", post_denoising_reads: 0,
    reason: "zero_or_insufficient_assignable_reads_after_denoising" });
  const missing = chooseRarefactionDepth(null);
  assert.equal(missing.available, false);
  assert.equal(missing.depth, null);
});

test("UNCLASSIFIED / features without a taxon are retained in composition and exports", async () => {
  const { table, repSeqs, taxonomy } = parsed();
  assert.equal(taxonomy.by_feature.asv3.unclassified, true);
  const composition = aggregateByRank(table, taxonomy, { rank: "phylum" });
  assert.equal(composition.available, true);
  const sampleB = composition.samples.find((entry) => entry.sample_id === "sampleB");
  const unclassified = sampleB.taxa.find((entry) => entry.taxon === "Unclassified");
  assert.ok(unclassified, "unclassified reads must not be dropped");
  assert.equal(unclassified.count, 1);
  const integrity = validateFeatureTableIntegrity({ table, repSeqs, taxonomy,
    metadata: { sample_ids: table.sample_ids } });
  assert.equal(integrity.coverage.features_with_taxonomy, 3, "present assignments are counted, not invented");

  const state = { run_id: "job_aaaaaaaaaaaaaaaa", input: { source: {} }, discovery: { tools: {}, classifier: {} },
    steps: { dada2_denoise: { tool_version: "2026.1.0" }, taxonomy: { tool_version: "2026.1.0" } },
    results: { alpha: computeAlphaFromTable(table), beta: computeBrayCurtis(table),
      pcoa: computePcoa(computeBrayCurtis(table)) },
    _parsed: { table, repSeqs, taxonomy }, artifacts: [] };
  const exports = await buildExports(state, "fixture report");
  const taxonomyExport = exports.find((entry) => entry.name === "taxonomy.tsv");
  assert.match(taxonomyExport.content, /asv3\tUnassigned\t/);
  assert.equal(taxonomyExport.content.split("\n").length, 4, "header plus all three assignments");
  const tableExport = exports.find((entry) => entry.name === "feature-table.tsv");
  assert.match(tableExport.content, /asv1\t10\t5\t0/);
});

test("REPORT / classifier provenance, caveats, real diversity basis and no significance claim", async () => {
  const { table, repSeqs, taxonomy } = parsed();
  const prep = { ...classifierProvenance(), status: "uploaded", source: "verified_url_import_into_existing_history",
    computed_sha256: QIIME_CLASSIFIER.expected_sha256, dataset_id: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    history_id: "11111111111111111111111111111111", job_id: "url-job-0001" };
  const alpha = computeAlphaFromTable(table);
  const beta = computeBrayCurtis(table);
  const pcoa = computePcoa(beta);
  const state = {
    run_id: "job_aaaaaaaaaaaaaaaa", plan_id: "plan_aaaaaaaaaaaaaaaa", status: "succeeded",
    input: { sample_count: 3, sample_ids: table.sample_ids, source: {} },
    input_sha256: "a".repeat(64), metadata_sha256: "b".repeat(64),
    params: { trim_left: 0, trunc_len: 120, rarefaction_depth: 9 },
    discovery: { tools: {}, classifier: { available: true, option_label: QIIME_CLASSIFIER.identity } },
    classifier_prep: prep,
    results: { qc: { available: false, reason: "no tool qc" }, asv: { available: true },
      taxonomy, composition: aggregateByRank(table, taxonomy), alpha, beta, pcoa,
      ordination: { available: true }, rarefaction: chooseRarefactionDepth(table) },
    _parsed: { table, repSeqs, taxonomy }, artifacts: [], errors: [], steps: {},
    validation: { status: "pass" }, execution_mode: "real"
  };
  const result = await buildResult(state);
  for (const fragment of [QIIME_CLASSIFIER.url, QIIME_CLASSIFIER.expected_sha256,
    QIIME_CLASSIFIER.expected_bytes, prep.identity, "sklearn 1.4.2", "2024.5–2026.1",
    prep.dataset_id, prep.history_id, prep.job_id]) {
    assert.ok(result.report.includes(String(fragment)), `report is missing ${fragment}`);
  }
  assert.match(result.report, /Rarefaction depth: 9/);
  assert.equal(result.rarefaction.depth, 9);
  assert.equal(result.diversity_basis.alpha, alpha.basis);
  assert.equal(result.diversity_basis.beta, beta.basis);
  assert.equal(result.diversity_basis.pcoa, pcoa.basis);
  assert.ok(result.limitations.some((item) => /F515–R806/.test(item) && /full-length/.test(item)));
  assert.ok(result.limitations.some((item) => /Species-level SILVA/.test(item)));
  assert.ok(result.limitations.some((item) => /No statistical significance/.test(item)));
  assert.doesNotMatch(JSON.stringify(result), /SILVA 144|silva-144/i);
  // Visualizations/downloads read the stored result, not a fixture value:
  const alphaExport = result.exports.find((entry) => entry.name === "alpha-diversity.tsv");
  assert.match(alphaExport.content, /sampleA\t2\t/);
  assert.doesNotMatch(alphaExport.content, /sampleA\t3\t1\.02/, "fixture alpha must not be reused as a result");
});
