"""Verdict layer tests driven by shared fixtures (parity with JavaScript)."""

import json
import sys
from pathlib import Path

import pytest

ENGINE_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ENGINE_ROOT / "src"))

from smartbio.taxonomy.verdict import compute_verdict, load_difficult_groups

ROOT = Path(__file__).resolve().parents[2]
CASES = json.loads((ROOT / "shared/test-cases/verdict_cases.json").read_text(encoding="utf-8"))["cases"]
GROUPS = load_difficult_groups(ROOT / "shared/difficult-groups.json")


@pytest.mark.parametrize("case", CASES, ids=[c["name"] for c in CASES])
def test_shared_verdict_cases(case):
    out = compute_verdict(case["consensus"], groups=GROUPS, **case["options"])
    exp = case["expected"]
    assert out["status"] == exp["status"]
    assert out["reported_rank"] == exp["reported_rank"]
    assert out["reported_taxon"] == exp["reported_taxon"]
    assert out["caution_flags"] == sorted(exp["caution_flags"])
    assert {r["species"] for r in out["evidence_summary"]["qualifying_species"]} == set(exp["qualifying_species"])


def test_groups_load_and_are_cited():
    assert GROUPS, "difficult groups must load"
    for g in GROUPS:
        assert g["source_url"].startswith("https://")
        assert g["evidence"]


def test_verdict_always_carries_disclaimer():
    out = compute_verdict({"candidate_count": 0, "evidence": []})
    assert "not proof" in out["disclaimer"]


def test_missing_groups_file_returns_empty(tmp_path):
    assert load_difficult_groups(tmp_path / "nope.json") == []
