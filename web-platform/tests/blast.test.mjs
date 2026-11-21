import test from "node:test";
import assert from "node:assert/strict";
import { parseBlastTsv, analyzeBlast, toBlastCsv } from "../public/js/blast.js";

const standardTsv = [
  "q1\thitA\t99.0\t100\t1\t0\t1\t100\t1\t100\t1e-50\t200",
  "q1\thitB\t95.0\t80\t5\t0\t1\t80\t1\t80\t1e-20\t120",
  "q2\thitC\t100.0\t50\t0\t0\t1\t50\t1\t50\t1e-10\t90"
].join("\n");

const extendedTsv = [
  "q1\tsacc1\t123\tEscherichia coli\t99.0\t100\t1\t100\t200\t1e-50\t200",
  "q2\tsacc2\t456\tBacillus subtilis\t90.0\t50\t1\t50\t100\t1e-10\t90"
].join("\n");

test("infer standard schema by 12 columns", () => {
  const parsed = parseBlastTsv(standardTsv);
  assert.equal(parsed.schema, "standard");
  assert.equal(parsed.parsed_rows, 3);
});

test("infer extended schema by 11 columns", () => {
  const parsed = parseBlastTsv(extendedTsv);
  assert.equal(parsed.schema, "extended");
  assert.equal(parsed.parsed_rows, 2);
});

test("ambiguous column counts require explicit schema", () => {
  const mixed = standardTsv + "\n" + "q3\thitX\t90\t10\t0\t0\t1\t10\t1\t10\t1e-5\t50\textra";
  const parsed = parseBlastTsv(mixed);
  assert.equal(parsed.schema, null);
  assert.match(parsed.file_errors[0].message, /Ambiguous/);
});

test("malformed row reports row number", () => {
  const tsv = "q1\thitA\t99.0\t100\t1\t0\t1\t100\t1\t100\t1e-50\t200\nq2\tbad\tXX\t10\t0\t0\t1\t10\t1\t10\t1e-5\t50";
  const parsed = parseBlastTsv(tsv);
  assert.equal(parsed.malformed_rows, 1);
  assert.equal(parsed.rows[1].row_number, 2);
  assert.ok(parsed.rows[1].errors.some((e) => e.code === "INVALID_NUMBER"));
});

test("threshold boundaries and ties", () => {
  const tsv = [
    "q1\thitA\t99.0\t100\t1\t0\t1\t100\t1\t100\t1e-50\t200",
    "q1\thitB\t99.0\t100\t1\t0\t1\t100\t1\t100\t1e-50\t200",
    "q1\thitC\t90.0\t100\t1\t0\t1\t100\t1\t100\t1e-50\t200"
  ].join("\n");
  const parsed = parseBlastTsv(tsv);
  const report = analyzeBlast(parsed, { minIdentity: 99, maxEvalue: 1e-10, maxHits: 1 });
  assert.equal(report.rows.length, 3);
  // two hits tie at 200 bitscore
  assert.equal(report.rows[0].tied, true);
  // maxHits=1 but tie preserved => 2 displayed
  assert.equal(report.filtered_rows.length, 2);
});

test("missing qlen labels coverage unavailable (standard)", () => {
  const parsed = parseBlastTsv(standardTsv);
  const report = analyzeBlast(parsed, { minQueryCoverage: 50 });
  // standard has no qlen and no provided lengths -> coverage null -> fail
  assert.ok(report.rows.every((r) => r.query_coverage === null));
  assert.ok(report.rows.every((r) => r.fail_reasons.includes("query coverage unavailable")));
});

test("query lengths from FASTA enable coverage", async () => {
  const mod = await import("../public/js/blast.js");
  const parsed = parseBlastTsv(standardTsv);
  const fasta = ">q1\n" + "A".repeat(100) + "\n>q2\n" + "A".repeat(50) + "\n";
  const ql = mod.queryLengthsFromFasta(fasta);
  const report = analyzeBlast(parsed, { minQueryCoverage: 50, queryLengths: ql });
  const q1 = report.rows.find((r) => r.qseqid === "q1");
  assert.equal(q1.query_coverage, 100);
});

test("multiple queries and no-hit queries", () => {
  const parsed = parseBlastTsv(standardTsv);
  const report = analyzeBlast(parsed, { queryIds: ["q1", "q2", "q3"] });
  assert.deepEqual(report.no_hit_queries, ["q3"]);
});

test("extended coverage uses qlen", () => {
  const parsed = parseBlastTsv(extendedTsv);
  const report = analyzeBlast(parsed, { minQueryCoverage: 80 });
  const row = report.rows[0];
  assert.equal(row.query_coverage, 50);
  // 50 < 80 -> fail
  assert.equal(row.pass_all, false);
});

test("export CSV", () => {
  const parsed = parseBlastTsv(standardTsv);
  const report = analyzeBlast(parsed);
  const csv = toBlastCsv(report.filtered_rows);
  assert.ok(csv.includes("qseqid"));
});