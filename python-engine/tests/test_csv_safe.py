"""CSV injection parity tests driven by the shared fixture."""
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "python-engine" / "src"))
from smartbio.csv_safe import safe_csv_cell

CASES = json.loads((ROOT / "shared/test-cases/csv_injection_cases.json").read_text(encoding="utf-8"))["cases"]

def test_shared_csv_injection_cases():
    for c in CASES:
        assert safe_csv_cell(c["input"]) == c["expected"], c
