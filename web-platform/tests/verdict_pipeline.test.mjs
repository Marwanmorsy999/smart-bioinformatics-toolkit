import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { parseBlastTsv, analyzeBlast } from "../public/js/blast.js";
import { analyzeTaxonomy, parseTaxonomyMap } from "../public/js/taxonomy.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const shared = path.resolve(here, "../../shared/test-cases");
const EXPECTED = JSON.parse(await readFile(path.join(shared, "verdict_pipeline_expected.json"), "utf8"));
const blastText = await readFile(path.join(shared, EXPECTED.blast_file), "utf8");
const parsedMap = parseTaxonomyMap(await readFile(path.join(shared, EXPECTED.mapping_file), "utf8"));

function run() {
  const parsed = parseBlastTsv(blastText, EXPECTED.schema);
  const report = analyzeBlast(parsed, { queryIds: EXPECTED.query_ids });
  return analyzeTaxonomy(report, parsedMap.map, { top_n: EXPECTED.top_n, min_consensus: EXPECTED.min_consensus });
}

test("pipeline verdicts match shared expected JSON (Python parity)", () => {
  assert.ok(parsedMap.valid, "verdict_pipeline_map.tsv must parse");
  const analysis = run();
  for (const [qid, exp] of Object.entries(EXPECTED.verdicts)) {
    const entry = analysis.per_query[qid] || analysis.no_hit_queries[qid];
    const v = entry.verdict;
    assert.equal(v.status, exp.status, `${qid} status: ${v.reasons.join(" | ")}`);
    assert.equal(v.reported_rank, exp.reported_rank, `${qid} rank`);
    assert.equal(v.reported_taxon, exp.reported_taxon, `${qid} taxon`);
    assert.deepEqual(v.caution_flags, [...exp.caution_flags].sort(), `${qid} cautions`);
  }
});

test("pipeline verdict counts match", () => {
  assert.deepEqual(run().verdict_counts, EXPECTED.verdict_counts);
});
