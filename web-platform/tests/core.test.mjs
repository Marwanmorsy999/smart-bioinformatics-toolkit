import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { parseFasta, validateFasta } from "../public/js/fasta.js";
import { calculateStatistics } from "../public/js/statistics.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const shared = path.resolve(here, "../../shared/test-cases/test-vectors.json");
const vectors = JSON.parse(await readFile(shared, "utf8"));

test("shared sequence test vectors follow the documented rules", () => {
  for (const item of vectors.cases) {
    const validation = validateFasta(`>${item.name}\n${item.sequence}\n`, item.type);
    const record = validation.records[0];
    assert.equal(record.valid, item.valid, `${item.name}: valid`);
    assert.equal(record.length, item.length, `${item.name}: length`);
    if (item.ambiguous_count !== null) assert.equal(record.ambiguous_count, item.ambiguous_count, `${item.name}: ambiguity`);
    if (item.stop_count !== undefined) assert.equal(record.stop_count, item.stop_count, `${item.name}: stops`);
    if (item.gc_percent !== null && item.gc_percent !== undefined) {
      const stats = calculateStatistics(validation);
      assert.equal(stats.records[0].gc_percent, item.gc_percent, `${item.name}: GC%`);
    }
  }
});

test("parser detects sequence before first header", () => {
  const parsed = parseFasta("ACGT\n>x\nACGT\n");
  assert.equal(parsed.file_errors[0].code, "SEQUENCE_BEFORE_HEADER");
  assert.equal(parsed.records.length, 1);
  assert.equal(parsed.records[0].id, "x");
});

test("duplicate IDs mark every record sharing that ID invalid", () => {
  const validation = validateFasta(">dup first\nACGT\n>dup second\nACGT\n", "dna");
  assert.equal(validation.records[0].valid, false);
  assert.equal(validation.records[1].valid, false);
  assert.equal(validation.records[1].errors[0].code, "DUPLICATE_ID");
});

test("statistics exclude invalid records and calculate N50", () => {
  const validation = validateFasta(">a\nAAAAAAAAAA\n>b\nCCCCCC\n>bad\nACGTZ123\n", "dna");
  const stats = calculateStatistics(validation);
  assert.equal(stats.summary.valid_records, 2);
  assert.equal(stats.summary.analyzed_records, 2);
  assert.equal(stats.summary.n50, 10);
  assert.equal(stats.summary.l50, 1);
});
