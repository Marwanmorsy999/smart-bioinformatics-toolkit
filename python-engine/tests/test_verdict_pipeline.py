"""End-to-end verdict test: BLAST TSV + taxonomy map -> verdicts.

The same fixture is verified by web-platform/tests/verdict_pipeline.test.mjs.
"""

import json
import sys
from pathlib import Path

ENGINE_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ENGINE_ROOT / "src"))

from smartbio.blast import analyze_blast, parse_blast_text
from smartbio.taxonomy import TaxonomyResolver, run_taxonomy_analysis

FIXTURES = Path(__file__).resolve().parents[2] / "shared" / "test-cases"
EXPECTED = json.loads((FIXTURES / "verdict_pipeline_expected.json").read_text(encoding="utf-8"))


def run():
    tsv = (FIXTURES / EXPECTED["blast_file"]).read_text(encoding="utf-8-sig")
    parsed = parse_blast_text(tsv, schema=EXPECTED["schema"])
    report = analyze_blast(parsed, query_ids=EXPECTED["query_ids"])
    resolver = TaxonomyResolver(mapping_path=FIXTURES / EXPECTED["mapping_file"])
    resolver.load_mapping()
    return run_taxonomy_analysis(
        report, resolver, top_n=EXPECTED["top_n"], min_consensus=EXPECTED["min_consensus"]
    )


def test_pipeline_verdicts_match_expected():
    analysis = run()
    for qid, exp in EXPECTED["verdicts"].items():
        entry = analysis["per_query"].get(qid) or analysis["no_hit_queries"][qid]
        v = entry["verdict"]
        assert v["status"] == exp["status"], (qid, v["status"], v["reasons"])
        assert v["reported_rank"] == exp["reported_rank"], qid
        assert v["reported_taxon"] == exp["reported_taxon"], qid
        assert v["caution_flags"] == sorted(exp["caution_flags"]), qid


def test_pipeline_verdict_counts():
    assert run()["verdict_counts"] == EXPECTED["verdict_counts"]
