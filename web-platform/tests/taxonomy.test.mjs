import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  parseTaxonomyMap, buildLineageFromMap, lineageFromRow, selectCandidates,
  computeConsensus, reportAmbiguity, highestDefensibleRank, TAXONOMIC_RANKS,
} from "../public/js/taxonomy.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const shared = path.resolve(here, "../../shared/test-cases");

const mapText = await readFile(path.join(shared, "taxonomy_map.tsv"), "utf8");
const parsedMap = parseTaxonomyMap(mapText);
const taxonomyMap = parsedMap.map;

test("parse taxonomy map valid", () => {
  assert.equal(parsedMap.valid, true);
  assert.ok(parsedMap.taxid_count > 0);
  assert.equal(taxonomyMap[562].scientific_name, "Escherichia coli");
});

test("parse taxonomy map missing columns", () => {
  const bad = parseTaxonomyMap("taxid\tname\n1\tX\n");
  assert.equal(bad.valid, false);
  assert.ok(bad.errors.length > 0);
});

test("build lineage from map walks parents", () => {
  const lin = buildLineageFromMap(562, taxonomyMap);
  assert.equal(lin.ranks.species.taxid, 562);
  assert.equal(lin.ranks.genus.taxid, 561);
  assert.equal(lin.ranks.family.taxid, 543);
});

test("lineageFromRow resolves single taxid", () => {
  const row = { staxids: "562", sscinames: "Escherichia coli" };
  const res = lineageFromRow(row, taxonomyMap);
  assert.equal(res.ambiguous, false);
  assert.equal(res.has_taxonomy, true);
  assert.equal(res.resolved_taxids[0].lineage.ranks.genus.name, "Escherichia");
});

test("lineageFromRow resolves multiple taxids independently", () => {
  const row = { staxids: "562;623", sscinames: "Escherichia coli;Escherichia albertii" };
  const res = lineageFromRow(row, taxonomyMap);
  assert.equal(res.ambiguous, true);
  assert.equal(res.resolved_taxids.length, 2);
});

test("selectCandidates preserves ties at cutoff", () => {
  const hits = [
    { accession: "a", bitscore: 200, evalue: 1e-50, pident: 99, query_coverage: 100, rank: 1, lineage: null },
    { accession: "b", bitscore: 200, evalue: 1e-50, pident: 99, query_coverage: 100, rank: 1, lineage: null },
    { accession: "c", bitscore: 199, evalue: 1e-40, pident: 98, query_coverage: 100, rank: 2, lineage: null },
    { accession: "d", bitscore: 199, evalue: 1e-40, pident: 98, query_coverage: 100, rank: 2, lineage: null },
    { accession: "e", bitscore: 100, evalue: 1e-10, pident: 90, query_coverage: 100, rank: 3, lineage: null },
  ];
  const cands = selectCandidates(hits, 3);
  // cutoff bitscore = 199, so a,b,c,d retained
  assert.equal(cands.length, 4);
});

test("computeConsensus species agreement", () => {
  const lin = { taxid: 562, name: "Escherichia coli", ranks: { genus: { taxid: 561, name: "Escherichia" }, species: { taxid: 562, name: "Escherichia coli" } }, source: "mapping" };
  const cands = [
    { accession: "a", bitscore: 200, evalue: 1e-50, pident: 99, query_coverage: 100, rank: 1, lineage: lin },
    { accession: "b", bitscore: 190, evalue: 1e-40, pident: 98, query_coverage: 100, rank: 2, lineage: lin },
  ];
  const result = computeConsensus(cands);
  assert.equal(result.status, "species_agreement");
  assert.equal(result.supported_rank, "species");
  assert.equal(result.consensus_taxon, "Escherichia coli");
  assert.equal(result.support.unique_species, 1);
  assert.equal(result.support.species_support, 1);
});

test("computeConsensus ambiguous species (genus agreement)", () => {
  const linEco = { taxid: 562, name: "Escherichia coli", ranks: { genus: { taxid: 561, name: "Escherichia" }, species: { taxid: 562, name: "Escherichia coli" } }, source: "mapping" };
  const linAlb = { taxid: 623, name: "Escherichia albertii", ranks: { genus: { taxid: 561, name: "Escherichia" }, species: { taxid: 623, name: "Escherichia albertii" } }, source: "mapping" };
  const result = computeConsensus([
    { accession: "a", bitscore: 200, evalue: 1e-50, pident: 99, query_coverage: 100, rank: 1, lineage: linEco },
    { accession: "b", bitscore: 190, evalue: 1e-40, pident: 98, query_coverage: 100, rank: 2, lineage: linAlb },
  ]);
  assert.equal(result.status, "ambiguous_species");
  assert.equal(result.supported_rank, "genus");
  assert.equal(result.consensus_taxon, "Escherichia");
  assert.equal(result.support.unique_species, 2);
  assert.equal(result.support.genus_support, 1);
  assert.equal(result.support.species_support, 0.5);
});

test("computeConsensus insufficient evidence (no candidates)", () => {
  const result = computeConsensus([]);
  assert.equal(result.status, "insufficient_evidence");
});

test("reportAmbiguity flags", () => {
  const result = computeConsensus([], 0.8);
  const rep = reportAmbiguity(result, { multipleTaxidsPerHit: true, missingTaxids: true });
  assert.ok(rep.flags.includes("multiple_taxids_per_hit"));
  assert.ok(rep.flags.includes("missing_taxids"));
  assert.ok(rep.flags.includes("insufficient_evidence"));
});

test("highest defensible rank", () => {
  const sp = computeConsensus([{ accession: "a", bitscore: 200, evalue: 1e-50, pident: 99, query_coverage: 100, rank: 1, lineage: { taxid: 562, name: "E. coli", ranks: { genus: { taxid: 561, name: "Escherichia" }, species: { taxid: 562, name: "Escherichia coli" } }, source: "mapping" } }]);
  assert.equal(highestDefensibleRank(sp), "species");
  const amb = computeConsensus([
    { accession: "a", bitscore: 200, evalue: 1e-50, pident: 99, query_coverage: 100, rank: 1, lineage: { taxid: 562, name: "E. coli", ranks: { genus: { taxid: 561, name: "Escherichia" }, species: { taxid: 562, name: "Escherichia coli" } }, source: "mapping" } },
    { accession: "b", bitscore: 190, evalue: 1e-40, pident: 98, query_coverage: 100, rank: 2, lineage: { taxid: 623, name: "E. albertii", ranks: { genus: { taxid: 561, name: "Escherichia" }, species: { taxid: 623, name: "Escherichia albertii" } }, source: "mapping" } },
  ]);
  assert.equal(highestDefensibleRank(amb), "genus");
});
