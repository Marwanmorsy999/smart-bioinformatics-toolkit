// M7.10 FIXTURE tests for the offline BLAST JSON2 parser and result params.
// No live NCBI call, no provider mock, no 9Router call: these fixtures were
// hand-written for this test file and are labelled FIXTURE in their source.
import test from "node:test";
import assert from "node:assert/strict";

import { buildResultsParams } from "../functions/api/blast/_lib.js";
import { isJson2Report, parseBlastJson2, toDerivedTabular } from "../functions/api/blast/json2.js";
import {
  JSON2_FIXTURE_TEXT,
  JSON2_INVALID_JSON_FIXTURE_TEXT,
  JSON2_MALFORMED_FIXTURE_TEXT,
  JSON2_NO_HITS_FIXTURE_TEXT
} from "./fixtures/m7_10_json2_fixture.mjs";

const ENV = { NCBI_TOOL: "fixture-tests", NCBI_EMAIL: "fixture@example.invalid" };

test("OFFICIAL PARAMS: default results params are unchanged; json2 uses FORMAT_TYPE=JSON2 without ALIGNMENT_VIEW", () => {
  const tabular = buildResultsParams("RID123", ENV);
  assert.equal(tabular.get("CMD"), "Get");
  assert.equal(tabular.get("RID"), "RID123");
  assert.equal(tabular.get("FORMAT_TYPE"), "Text");
  assert.equal(tabular.get("ALIGNMENT_VIEW"), "Tabular");

  const structured = buildResultsParams("RID123", ENV, { format: "json2" });
  assert.equal(structured.get("CMD"), "Get");
  assert.equal(structured.get("RID"), "RID123");
  assert.equal(structured.get("FORMAT_TYPE"), "JSON2");
  assert.equal(structured.get("ALIGNMENT_VIEW"), null);
  assert.equal(structured.toString().includes("rRNA_typestrains%2F16S_ribosomal_RNA"), false);
});

test("FIXTURE: JSON2 parse keeps real query evidence and multi-hit descriptions", () => {
  const parsed = parseBlastJson2(JSON2_FIXTURE_TEXT);
  assert.equal(parsed.query.id, "fixture_query_1 16S isolate");
  assert.equal(parsed.query.length, 40);
  assert.equal(parsed.hits.length, 3);
  assert.equal(parsed.no_hits, false);

  const [first, second, third] = parsed.hits;
  assert.equal(first.rank, 1);
  assert.equal(first.accession, "NR_074666.1");
  assert.equal(first.organism, "Francisella tularensis");
  assert.equal(first.taxid, "1234");
  assert.equal(first.length, 1500);
  assert.equal(first.identity, 97.5);
  assert.equal(first.bitscore, 200);
  assert.equal(first.evalue, 1e-50);
  assert.equal(first.query_coverage, 100);
  assert.equal(second.accession, "WP_000002.1");
  assert.equal(second.taxid, null, "missing taxid stays null, never invented");
  assert.equal(second.organism, null);
  assert.equal(second.length, null);
  assert.equal(third.taxid, "1423", "array-valued taxid uses its first raw value");
});

test("FIXTURE: multi-HSP parse, reverse strand, coordinates and raw alignment strings", () => {
  const parsed = parseBlastJson2(JSON2_FIXTURE_TEXT);
  const hsps = parsed.hits[0].hsps;
  assert.equal(hsps.length, 2);
  assert.deepEqual(
    [hsps[0].hsp, hsps[0].qstart, hsps[0].qend, hsps[0].sstart, hsps[0].send, hsps[0].strand],
    [1, 1, 40, 1, 40, "plus"]
  );
  assert.deepEqual(
    [hsps[1].hsp, hsps[1].qstart, hsps[1].qend, hsps[1].sstart, hsps[1].send, hsps[1].strand],
    [2, 5, 30, 40, 15, "minus"]
  );
  assert.equal(hsps[0].qseq.length, 40);
  assert.equal(hsps[0].midline.length, 40);
  assert.equal(hsps[0].qseq, "ACGT".repeat(10));
  assert.equal(hsps[1].sseq.length, 26, "reverse-strand subject sequence kept verbatim");
  assert.equal(/^[ACGT]+$/.test(hsps[1].sseq), true);
  assert.equal(hsps[0].nident, 39);
  assert.equal(hsps[0].slen, 1500);
});

test("FIXTURE: coverage is computed from coordinates and qcovs is only a cross-check warning", () => {
  const parsed = parseBlastJson2(JSON2_FIXTURE_TEXT);
  const [plus, reverse] = parsed.hits[0].hsps;
  assert.equal(plus.query_coverage, 100); // (40-1+1)/40
  assert.equal(reverse.query_coverage, 65); // (30-5+1)/40
  assert.equal(parsed.hits[1].query_coverage, 50); // (20-1+1)/40
  assert.equal(parsed.hits[2].query_coverage, 27.5); // (20-10+1)/40
  assert.equal(parsed.hits[0].query_coverage, 100, "hit coverage is the max real HSP span");
  assert.equal(
    parsed.warnings.some((warning) => /qcovs \(70\).*coverage \(65\)/.test(warning)),
    true
  );
  assert.equal(
    parsed.warnings.some((warning) => /reverse strand/.test(warning)),
    true
  );
});

test("FIXTURE: coverage clamps to 0..100 and returns null without coordinates", () => {
  const build = (queryLen, overrides) => ({
    BlastOutput2: {
      report: {
        results: {
          search: {
            query_title: "coverage_fixture",
            query_len: queryLen,
            hits: [{ num: 1, description: [], hsps: [{ ...overrides }] }]
          }
        }
      }
    }
  });
  const clamped = parseBlastJson2(JSON.stringify(build(10, { qstart: 1, qend: 500 })));
  assert.equal(clamped.hits[0].query_coverage, 100);
  const partial = parseBlastJson2(JSON.stringify(build(8, { qstart: 2, qend: 3 })));
  assert.equal(partial.hits[0].query_coverage, 25);
  const missing = parseBlastJson2(JSON.stringify(build(0, { qstart: 1, qend: 8 })));
  assert.equal(missing.hits[0].query_coverage, null);
  assert.equal(missing.query.length, 0);
  assert.equal(missing.warnings.some((warning) => /coordinate-derived query coverage/.test(warning)), true);
});

test("FIXTURE: no-hit JSON2 is typed, not a synthesised hit", () => {
  const parsed = parseBlastJson2(JSON2_NO_HITS_FIXTURE_TEXT);
  assert.equal(parsed.no_hits, true);
  assert.equal(parsed.hits.length, 0);
  assert.equal(parsed.query.id, "fixture_no_hits");
  assert.equal(isJson2Report(parsed), true);
  assert.equal(toDerivedTabular(parsed).trim().split("\n").length, 2, "header + label only");
});

test("FIXTURE: malformed payloads yield warnings and empty results, never invented values", () => {
  for (const [label, raw, pattern] of [
    ["missing search", JSON2_MALFORMED_FIXTURE_TEXT, /report\.results\.search/],
    ["invalid json", JSON2_INVALID_JSON_FIXTURE_TEXT, /invalid JSON/],
    ["empty", "", /empty or non-text/],
    ["non-string", null, /empty or non-text/],
    ["wrong top level", "[]", /top level/]
  ]) {
    const parsed = parseBlastJson2(raw);
    assert.equal(parsed.hits.length, 0, label);
    assert.equal(parsed.no_hits, false, `${label}: cannot claim no hits`);
    assert.equal(isJson2Report(parsed), false, label);
    assert.equal(parsed.warnings.some((warning) => pattern.test(warning)), true, label);
  }
});

test("FIXTURE: derived tabular view is labelled, compatible, and uses only parsed fields", () => {
  const parsed = parseBlastJson2(JSON2_FIXTURE_TEXT);
  const tsv = toDerivedTabular(parsed);
  const lines = tsv.trim().split("\n");
  assert.match(lines[0], /^# derived_from: json2/);
  assert.equal(
    lines[1],
    "qseqid\tsacc\tstaxids\tsscinames\tpident\tlength\tqstart\tqend\tqlen\tevalue\tbitscore\tqcovs"
  );
  assert.equal(lines.length, 5, "label + header + three fixture data rows");
  assert.equal(lines[2].split("\t").length, 12);
  assert.match(lines[2], /^fixture_query_1 16S isolate\tNR_074666\.1\t1234\tFrancisella tularensis\t97\.5\t40\t1\t40\t40\t1e-50\t200\t100$/);
  assert.equal(tsv.includes("ACGTACGTACGTACGT"), false, "alignment strings are not duplicated into the summary");
});

test("FIXTURE: derived row uses the best-scoring HSP for every numeric column", () => {
  const payload = {
    BlastOutput2: {
      report: {
        results: {
          search: {
            query_title: "best_hsp_fixture",
            query_len: 40,
            hits: [{
              num: 1,
              description: [{ accession: "FIX001", organism: "Fixture organism", taxid: 7, length: 100 }],
              hsps: [
                { num: 1, bit_score: 50, identity: 80, evalue: "1e-5", length: 10, qstart: 1, qend: 10, sstart: 1, send: 10, qcovs: 25 },
                { num: 2, bit_score: 150, identity: 99, evalue: "1e-30", length: 40, qstart: 2, qend: 31, sstart: 1, send: 30, qcovs: 75 }
              ]
            }]
          }
        }
      }
    }
  };
  const parsed = parseBlastJson2(JSON.stringify(payload));
  const derived = toDerivedTabular(parsed);
  assert.match(derived, /best-scoring HSP/);
  const row = derived.trim().split("\n")[2].split("\t");
  // qseqid, sacc, staxids, sscinames, pident, length, qstart, qend, qlen, evalue, bitscore, qcovs
  assert.deepEqual(row.slice(4), ["99", "40", "2", "31", "40", "1e-30", "150", "75"]);
  assert.equal(parsed.hits[0].identity, 99, "the same best HSP feeds the hit summary");
  assert.equal(parsed.hits[0].bitscore, 150);
  assert.equal(parsed.hits[0].query_coverage, 75);
});
