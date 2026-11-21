"""Shared-fixture consistency test: Python must match the expected consensus output.

The same fixture is verified by the JavaScript suite (taxonomy.test.mjs).
"""

import json
from pathlib import Path
import sys

ENGINE_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ENGINE_ROOT / "src"))

from smartbio.blast import parse_blast_text, analyze_blast
from smartbio.taxonomy import TaxonomyResolver, run_taxonomy_analysis

FIXTURES = Path(__file__).resolve().parents[2] / "shared" / "test-cases"
EXPECTED = json.loads((FIXTURES / "taxonomy_expected.json").read_text(encoding="utf-8"))


def analyze_expected():
    tsv = (FIXTURES / EXPECTED["blast_file"]).read_text(encoding="utf-8-sig")
    parsed = parse_blast_text(tsv, schema=EXPECTED["schema"])
    report = analyze_blast(parsed, query_ids=EXPECTED["query_ids"])
    resolver = TaxonomyResolver(mapping_path=FIXTURES / EXPECTED["mapping_file"])
    resolver.load_mapping()
    analysis = run_taxonomy_analysis(
        report, resolver, top_n=EXPECTED["top_n"], min_consensus=EXPECTED["min_consensus"]
    )
    return analysis


def test_shared_fixture_consensus():
    analysis = analyze_expected()
    assert analysis["flags"] == EXPECTED["flags"]
    for qid, expected in EXPECTED["per_query"].items():
        entry = analysis["per_query"].get(qid) or analysis["no_hit_queries"][qid]
        cons = entry["consensus"]
        for key in ("status", "supported_rank", "consensus_taxon", "candidate_species",
                    "warnings", "candidate_count", "truncated"):
            assert cons[key] == expected[key], (qid, key, cons[key], expected[key])
        # consensus_taxid key may be absent in partial results (None values)
        assert cons.get("consensus_taxid") == expected.get("consensus_taxid"), (qid, "consensus_taxid", cons, expected)
        for key, value in expected["support"].items():
            assert cons["support"][key] == value, (qid, key, cons["support"][key], value)
        assert cons["candidate_species"] == expected["candidate_species"]


def test_shared_fixture_flags_order():
    analysis = analyze_expected()
    assert analysis["flags"] == sorted(set(EXPECTED["flags"]))
