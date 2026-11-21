import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { parseBlastTsv, analyzeBlast } from "../public/js/blast.js";
import {
  analyzeTaxonomy, parseTaxonomyMap,
} from "../public/js/taxonomy.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const shared = path.resolve(here, "../../shared/test-cases");

const EXPECTED = JSON.parse(await readFile(path.join(shared, "taxonomy_expected.json"), "utf8"));
const blastText = await readFile(path.join(shared, EXPECTED.blast_file), "utf8");
const mapText = await readFile(path.join(shared, EXPECTED.mapping_file), "utf8");
const parsedMap = parseTaxonomyMap(mapText);
const map = parsedMap.valid ? parsedMap.map : null;

function analyzeSharedFixture() {
  const parsed = parseBlastTsv(blastText, EXPECTED.schema);
  const report = analyzeBlast(parsed, { queryIds: EXPECTED.query_ids });
  return analyzeTaxonomy(report, map, { top_n: EXPECTED.top_n, min_consensus: EXPECTED.min_consensus });
}

test("shared-fixture consensus matches expected JSON (Python-parity)", () => {
  assert.ok(map, "taxonomy_map.tsv must parse");
  const analysis = analyzeSharedFixture();
  assert.deepEqual(analysis.flags, EXPECTED.flags);
  for (const [qid, expected] of Object.entries(EXPECTED.per_query)) {
    const entry = (analysis.per_query[qid] || analysis.no_hit_queries[qid]);
    const cons = entry.consensus;
    for (const key of ["status", "supported_rank", "consensus_taxon", "candidate_species",
                       "warnings", "candidate_count", "truncated"]) {
      assert.deepEqual(cons[key], expected[key], `${qid}.${key}`);
    }
    assert.equal(cons.consensus_taxid ?? null, expected.consensus_taxid ?? null, `${qid}.consensus_taxid`);
    for (const [key, value] of Object.entries(expected.support)) {
      assert.equal(cons.support[key], value, `${qid}.support.${key}`);
    }
  }
});

test("shared-fixture flags are sorted and unique", () => {
  const analysis = analyzeSharedFixture();
  assert.deepEqual(analysis.flags, [...new Set(analysis.flags)].sort());
});
