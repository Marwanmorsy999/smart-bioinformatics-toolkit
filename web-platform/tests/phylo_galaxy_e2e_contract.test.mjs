import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import { validateAlignment, validateTree, parseNewick } from "../functions/api/ai/workflows/phylo/validators.js";
import { findPhyloTools } from "../providers/galaxy/galaxy_phylo.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..", "..");
const FASTA = readFileSync(resolve(REPO, "shared/test-cases/phylo_reference/reference.fasta"), "utf8");
const EXPECTED = JSON.parse(readFileSync(resolve(REPO, "shared/test-cases/phylo_reference/expected_topology.json"), "utf8"));

test("M7.3 validators account for every reference sequence", () => {
  const result = validateAlignment(FASTA);
  assert.equal(result.valid, true, JSON.stringify(result));
  assert.equal(result.records, 5);
  assert.deepEqual(new Set(result.names), new Set(EXPECTED.expected_taxa));
  assert.deepEqual(result.lengths, [60]);
});

test("M7.3 independent Newick parser validates the expected tree and taxa", () => {
  const root = parseNewick(EXPECTED.example_newick);
  assert.ok(root.children.length > 0);
  const result = validateTree(EXPECTED.example_newick, EXPECTED.expected_taxa);
  assert.equal(result.valid, true, JSON.stringify(result));
  assert.deepEqual(new Set(result.taxa), new Set(EXPECTED.expected_taxa));
});

test("M7.3 tree validator detects a silently dropped taxon", () => {
  const result = validateTree("((Human:0.1,Chimp:0.1):0.2,(Mouse:0.1,Rat:0.1):0.2);", EXPECTED.expected_taxa);
  assert.equal(result.valid, false);
  assert.ok(result.missing.includes("Fish"));
});

test("M7.3 tool discovery finds MAFFT + IQ-TREE in a live-shaped panel, no hardcoded ids", () => {
  const panel = [
    { name: "MAFFT", description: "Multiple alignment program for amino acid or nucleotide sequences", version: "7.526+galaxy2" },
    { name: "IQ-TREE", description: "Phylogenomic / evolutionary tree construction from multiple sequences", version: "3.1.4+galaxy1" }
  ];
  const found = findPhyloTools(panel);
  assert.equal(found.mafft.version, "7.526+galaxy2");
  assert.equal(found.iqtree.version, "3.1.4+galaxy1");
});

test("M7.3 discovery fails closed when the panel lacks the required tools", () => {
  const found = findPhyloTools([{ name: "Unrelated", description: "nothing", version: "1" }]);
  assert.equal(found.mafft, null);
  assert.equal(found.iqtree, null);
});
