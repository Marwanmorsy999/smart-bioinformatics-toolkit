// M7.9 parity: the Worker executor must return the exact same objects as the
// already-shipped browser functions. No calculation is changed or re-derived.
import test from "node:test";
import assert from "node:assert/strict";

import { executeTool, getAssistantToolDefinitions } from "../functions/api/assistant/tools.js";
import { validateFasta } from "../public/js/fasta.js";
import { calculateStatistics } from "../public/js/statistics.js";

const FASTA = ">test_sequence\nACGTACGTACGT";
const PROJECT_DATASET = "ds_0123456789abcdef";

function args(sequenceType, fastaText = FASTA) {
  return {
    sequence_type: sequenceType,
    dataset_id: PROJECT_DATASET,
    filename: "test.fasta",
    fasta_text: fastaText
  };
}

test("sequence-stats.validate matches validateFasta exactly", () => {
  const expected = validateFasta(FASTA, "dna");
  const result = executeTool("sequence-stats.validate", args("dna"));
  assert.equal(result.ok, true);
  assert.deepEqual(result.output.validation, expected);
  assert.equal(result.execution_location, "worker");
  assert.equal(result.backend_declared, "local-python");
  assert.equal(result.evidence, "actual tool output");
  assert.ok(result.source.includes("public/js/fasta.js"));
});

test("sequence-stats.profile matches validateFasta + calculateStatistics exactly", () => {
  const validation = validateFasta(FASTA, "dna");
  const statistics = calculateStatistics(validation);
  const result = executeTool("sequence-stats.profile", args("dna"));

  assert.equal(result.ok, true);
  assert.deepEqual(result.output.validation, validation);
  assert.deepEqual(result.output.statistics, statistics);
  assert.equal(result.output.statistics.summary.total_length, 12);
  assert.equal(result.output.statistics.summary.n50, 12);
  assert.equal(result.output.statistics.records[0].gc_percent, 50);
  assert.deepEqual(result.output.statistics.summary.nucleotide_counts, { A: 3, T: 3, G: 3, C: 3 });
  assert.equal(result.result_card.statistics.gc_percent_mean, 50);
  assert.equal(result.result_card.evidence, "actual tool output");
});

test("protein profile uses the same pure functions and reports no GC value", () => {
  const protein = ">test_protein\nACDEFGHIKLMNPQRSTVWY";
  const validation = validateFasta(protein, "protein");
  const statistics = calculateStatistics(validation);
  const result = executeTool("sequence-stats.profile", args("protein", protein));
  assert.equal(result.ok, true);
  assert.deepEqual(result.output.validation, validation);
  assert.deepEqual(result.output.statistics, statistics);
  assert.equal(result.output.statistics.records[0].gc_percent, null);
});

test("invalid FASTA is a real tool result with the same validation report", () => {
  const bad = ">bad\nACGTZ";
  const validation = validateFasta(bad, "dna");
  const result = executeTool("sequence-stats.validate", args("dna", bad));
  assert.equal(result.ok, true);
  assert.deepEqual(result.output.validation, validation);
  assert.equal(result.output.validation.file_valid, false);
  assert.equal(result.result_card.status, "invalid");
});

test("a tool implementation failure is reported, never replaced with fake output", () => {
  const result = executeTool("sequence-stats.validate", args("dna"), {
    validateFasta() { throw new Error("injected failure"); }
  });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "tool_execution_failed");
  assert.equal(result.error.message, "injected failure");
  assert.equal(Object.hasOwn(result, "output"), false);
  assert.equal(Object.hasOwn(result, "result_card"), false);
});

test("tool definitions come only from the registry and stay within the allowlist", () => {
  const definitions = getAssistantToolDefinitions();
  assert.deepEqual(definitions.map((item) => item.function.name), [
    "sequence-stats.validate", "sequence-stats.profile"
  ]);
  for (const definition of definitions) {
    assert.deepEqual(definition.function.parameters.required, [
      "sequence_type", "dataset_id", "fasta_text", "filename"
    ]);
    assert.equal(definition.function.parameters.additionalProperties, false);
    assert.equal(definition.function.parameters.properties.fasta_text.maxLength, 65536);
  }
});
