// M7.11 OFFLINE FIXTURE TESTS — labelled fixtures, no network, no Galaxy jobs.
// These fixtures are test inputs only. They are NOT presented as real results.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import {
  validateAlignment, validateTree, parseNewick, parseSupportValues,
  computeAlignmentMetrics, computeTreeMetrics, collectTipNames
} from "../functions/api/ai/workflows/phylo/validators.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const fixture = (name) => readFileSync(resolve(HERE, "fixtures/m7_11_phylo", name), "utf8");
const ALIGNMENT = fixture("valid_alignment.fasta");
const NAMES = ["taxon_a", "taxon_b", "taxon_c"];

test("FIXTURE: gapped aligned FASTA is valid and metrics are deterministic", () => {
  const result = validateAlignment(ALIGNMENT);
  assert.equal(result.valid, true, JSON.stringify(result));
  assert.equal(result.records, 3);
  assert.equal(result.alphabet, "dna");
  assert.equal(result.lengths.length, 1);
  assert.equal(result.metrics.alignment_length, 12);
  assert.equal(result.metrics.gap_count, 1);
  // Only the first four columns are identical across all three records.
  assert.equal(result.metrics.conserved_columns, 4);
  assert.equal(result.metrics.variable_columns, 8);
  const again = computeAlignmentMetrics(ALIGNMENT);
  assert.deepEqual(again, result.metrics);
});

test("FIXTURE: duplicate identifiers are reported, not silently dropped", () => {
  const result = validateAlignment(fixture("duplicate_ids.fasta"));
  assert.equal(result.valid, false);
  assert.ok(result.errors.includes("alignment_duplicate_names"));
  assert.deepEqual(result.duplicates, ["taxon_a"]);
});

test("FIXTURE: invalid nucleotide characters are rejected", () => {
  const result = validateAlignment(fixture("invalid_sequence.fasta"));
  assert.equal(result.valid, false);
  assert.ok(result.errors.includes("alignment_alphabet_mixed"));
});

test("FIXTURE: unequal alignment lengths are rejected and metrics do not invent a length", () => {
  const result = validateAlignment(fixture("unequal_lengths.fasta"));
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => error.startsWith("alignment_sequences_unequal_length")));
  assert.equal(result.metrics.alignment_length, null);
  assert.deepEqual(result.metrics.lengths, [8, 10]);
});

test("FIXTURE single sequence: validator reports one record (the UI/run gate requires >=3)", () => {
  const result = validateAlignment(fixture("single_sequence.fasta"));
  assert.equal(result.valid, true);
  assert.equal(result.records, 1);
});

test("FIXTURE: support labels parse in slash, named and plain forms", () => {
  assert.deepEqual(parseSupportValues("95/87").values.map((item) => item.value), [95, 87]);
  assert.equal(parseSupportValues("95/87").format, "slash-separated");
  assert.deepEqual(parseSupportValues("UFboot:95").values, [{ kind: "UFboot", value: 95 }]);
  assert.equal(parseSupportValues("SH-aLRT/UFboot").format, "named-only");
  assert.deepEqual(parseSupportValues("0.95").values, [{ kind: "unspecified", value: 0.95 }]);
  assert.deepEqual(parseSupportValues("no numbers here").values, []);
});

test("FIXTURE: tree metrics count tips, internals, support values and branch validity", () => {
  const root = parseNewick(fixture("tree_support.nwk"));
  assert.deepEqual(collectTipNames(root), ["A", "B", "C", "D"]);
  const metrics = computeTreeMetrics(root);
  assert.equal(metrics.tip_count, 4);
  assert.equal(metrics.internal_node_count, 2);
  assert.equal(metrics.support_value_count, 1);
  assert.deepEqual(metrics.support_values[0].values.map((item) => item.value), [95, 87]);
  assert.equal(metrics.branch_lengths.present, 5);
  assert.equal(metrics.branch_length_valid, true);
  assert.equal(metrics.usable_for_length_layout, true);
  assert.equal(metrics.rooting.status, "unrooted-representation");
  assert.equal(metrics.rooting.invented_outgroup, false);
});

test("FIXTURE: UFboot internal label is a support value, not a branch length", () => {
  const checked = validateTree(fixture("tree_ufboot.nwk"), ["A", "B", "C"]);
  assert.equal(checked.valid, true, JSON.stringify(checked));
  assert.deepEqual(checked.support_values[0].values, [{ kind: "UFboot", value: 95 }]);
  assert.equal(checked.metrics.branch_length_valid, true);
});

test("FIXTURE: an unrecognized numeric-support prefix stays a support label", () => {
  // `UFboot2` is not in the known-prefix list; `95` must not become a length.
  const root = parseNewick("(A:0.1,B:0.2)UFboot2:95;");
  assert.equal(root.name, "UFboot2:95");
  assert.equal(root.length, null);
  assert.equal(root.raw_length, null);
  const metrics = computeTreeMetrics(root);
  assert.equal(metrics.support_value_count, 1);
  assert.deepEqual(metrics.support_values[0].values, [{ kind: "UFboot2", value: 95 }]);
  assert.equal(metrics.branch_length_valid, true);
  assert.equal(metrics.branch_lengths_complete, true);
  // A sub-unit numeric tail is still a genuine branch length.
  const withLength = parseNewick("(A:0.1,B:0.2)Inner:0.3;");
  assert.equal(withLength.name, "Inner");
  assert.equal(withLength.length, 0.3);
});

test("FIXTURE: negative and non-numeric branch lengths are invalid", () => {
  const checked = validateTree(fixture("tree_invalid_branch.nwk"), ["A", "B", "C", "D"]);
  assert.equal(checked.valid, false);
  assert.ok(checked.errors.includes("tree_invalid_branch_length"));
  assert.equal(checked.branch_lengths.invalid_count, 2);
  assert.equal(checked.metrics.usable_for_length_layout, false);
  assert.deepEqual(checked.branch_lengths.invalid.map((item) => item.raw).sort(), ["-0.1", "NaN"]);
});

test("FIXTURE: wrong and duplicate tips are detected independently", () => {
  const wrong = validateTree(fixture("tree_wrong_tips.nwk"), NAMES);
  assert.deepEqual(wrong.missing, ["taxon_a", "taxon_b", "taxon_c"]);
  assert.deepEqual(wrong.unknown, ["A", "B", "X"]);
  const duplicates = validateTree(fixture("tree_duplicate_tips.nwk"), ["A", "B"]);
  assert.deepEqual(duplicates.duplicates, ["A"]);
  assert.equal(duplicates.valid, false);
});

test("FIXTURE: unrooted representation is explicit and no outgroup is invented", () => {
  const unrooted = validateTree(fixture("tree_unrooted.nwk"), ["A", "B", "C", "D"]);
  assert.equal(unrooted.rooting.status, "unrooted-representation");
  assert.equal(unrooted.rooting.declared_outgroup, null);
  assert.equal(unrooted.rooting.invented_outgroup, false);
  const rooted = validateTree(fixture("tree_support.nwk"), ["A", "B", "C", "D"], { outgroup: "D" });
  assert.equal(rooted.rooting.status, "rooted-by-declared-outgroup");
  assert.equal(rooted.rooting.outgroup_verified, true);
  const absent = validateTree(fixture("tree_support.nwk"), ["A", "B", "C", "D"], { outgroup: "ghost" });
  assert.equal(absent.rooting.status, "outgroup-not-found");
  assert.equal(absent.rooting.outgroup_verified, false);
});

test("FIXTURE: malformed Newick fails closed with an explicit unknown rooting", () => {
  const checked = validateTree("(A:0.1,B:0.2", ["A", "B"]);
  assert.equal(checked.valid, false);
  assert.equal(checked.code, "tree_parse_failed");
  assert.equal(checked.rooting.status, "unknown");
});
