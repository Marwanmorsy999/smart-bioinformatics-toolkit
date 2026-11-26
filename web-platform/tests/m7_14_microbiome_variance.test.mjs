// M7.14 boundary test: PCoA variance units are consistent across the parser,
// the worker computation and the exported coordinates. All values are labelled
// percentages in the export and fractions (0-1) in the result payload.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { computePcoa, parseDistanceMatrix, parsePcoa } from "../functions/api/ai/workflows/microbiome/parsers.js";
import { buildExports } from "../functions/api/ai/workflows/microbiome/engine.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const fixture = (name) => readFileSync(resolve(HERE, "fixtures/m7_14_microbiome", name), "utf8");

function stateWith(pcoa) {
  return {
    run_id: "job_aaaaaaaaaaaaaaaa",
    input: { source: {} }, discovery: { tools: {}, classifier: {} },
    artifacts: [], steps: {}, results: { pcoa }
  };
}

function exportedPercents(text) {
  const out = {};
  for (const match of text.matchAll(/# (PC\d+) explains ([\d.]+)% of variance/g)) {
    out[match[1]] = Number(match[2]);
  }
  return out;
}

test("EXPORT: parsed QIIME 2 footer percentages are not multiplied twice", async () => {
  const source = fixture("pcoa.tsv");
  assert.match(source, /# PC1 explains 62\.0% of variance/);
  const pcoa = parsePcoa(source);
  assert.equal(pcoa.variance_explained.PC1, 0.62);
  assert.equal(pcoa.variance_units, "fraction_of_total_variance");
  const exports = await buildExports(stateWith(pcoa), "fixture report");
  const coordinates = exports.find((entry) => entry.name === "pcoa-coordinates.tsv");
  assert.ok(coordinates);
  const percentages = exportedPercents(coordinates.content);
  // Source footer: PC1 62.0%, PC2 25.0%; never 6200% / 2500%.
  assert.equal(percentages.PC1, 62);
  assert.equal(percentages.PC2, 25);
  assert.ok(Object.values(percentages).every((value) => value >= 0 && value <= 100));
});

test("EXPORT: worker-computed variance uses the same 0-1 fraction unit", async () => {
  const distance = parseDistanceMatrix(fixture("distance.tsv"));
  const pcoa = computePcoa(distance, { dimensions: 2 });
  assert.equal(pcoa.variance_units, "fraction_of_total_variance");
  assert.ok(Object.values(pcoa.variance_explained ?? {}).every((value) => value >= 0 && value <= 1));
  const exports = await buildExports(stateWith(pcoa), "fixture report");
  const coordinates = exports.find((entry) => entry.name === "pcoa-coordinates.tsv");
  assert.ok(coordinates);
  const percentages = exportedPercents(coordinates.content);
  assert.ok(Object.keys(percentages).length > 0);
  assert.ok(Object.values(percentages).every((value) => value >= 0 && value <= 100));
  for (const [axis, fraction] of Object.entries(pcoa.variance_explained)) {
    assert.equal(percentages[axis], Math.round(fraction * 1000) / 10);
  }
  assert.doesNotMatch(coordinates.content, /\b(?:[1-9]\d{3,}|6200|2500)%/);
});
