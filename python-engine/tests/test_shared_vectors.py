import json
from pathlib import Path
import sys

ENGINE_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ENGINE_ROOT / "src"))

from smartbio.fasta import parse_fasta_text, validate_records
from smartbio.statistics import calculate_statistics

VECTORS = Path(__file__).resolve().parents[2] / "shared" / "test-cases" / "test-vectors.json"


def test_shared_test_vectors():
    data = json.loads(VECTORS.read_text(encoding="utf-8"))
    for case in data["cases"]:
        validation = validate_records(parse_fasta_text(f">{case['name']}\n{case['sequence']}\n"), case["type"])
        record = validation["records"][0]
        assert record["valid"] is case["valid"], case["name"]
        assert record["length"] == case["length"], case["name"]
        if case.get("ambiguous_count") is not None:
            assert record["ambiguous_count"] == case["ambiguous_count"], case["name"]
        if "stop_count" in case:
            assert record["stop_count"] == case["stop_count"], case["name"]
        if case.get("gc_percent") is not None:
            statistics = calculate_statistics(validation)
            assert statistics["records"][0]["gc_percent"] == case["gc_percent"], case["name"]
