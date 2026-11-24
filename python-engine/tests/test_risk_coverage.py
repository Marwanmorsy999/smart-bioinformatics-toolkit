"""Risk-coverage tests driven by the shared fixture (Python/JS parity)."""
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "python-engine" / "src"))
from smartbio.benchmark.risk_coverage import evaluate_case, sweep, load_shared_cases

CASES = json.loads((ROOT / "shared/test-cases/risk_coverage_cases.json").read_text(encoding="utf-8"))["cases"]
THRESHOLDS = [97.0, 98.0, 98.65, 99.0, 99.9]

def test_shared_cases_evaluate():
    for c in CASES:
        out = evaluate_case(c, 98.65)
        assert out["call"] == c["expected_call"], c["name"]
        assert out["correct"] == c["expected_correct"], c["name"]

def test_sweep_call_rate_decreases_as_threshold_rises():
    rows = sweep(CASES, THRESHOLDS)
    assert len(rows) == len(THRESHOLDS)
    assert rows[0]["calls"] >= rows[-1]["calls"]
    for r in rows:
        assert 0 <= r["species_call_rate"] <= 1
        assert r["wrong_rate_among_calls"] is None or 0 <= r["wrong_rate_among_calls"] <= 1

def test_load_shared_cases_matches_fixture():
    assert load_shared_cases() == CASES
