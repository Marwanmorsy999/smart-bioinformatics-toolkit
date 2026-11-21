import json
from pathlib import Path

import sys
ENGINE_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ENGINE_ROOT / "src"))
ROOT = Path(__file__).resolve().parents[2]

from smartbio.taxonomy.report import build_reproducibility_metadata, build_report_html


def test_report_metadata_keys():
    expected = json.loads((ROOT / "shared/test-cases/report_metadata_keys.json").read_text(encoding="utf-8"))
    meta = build_reproducibility_metadata(
        input_file="x.tsv",
        input_file_hash="abc",
        parameters={k: 1 for k in expected["parameter_keys"]},
        thresholds={},
    )
    assert sorted(meta.keys()) == sorted(expected["top_level_keys"])
    assert sorted(meta["parameters"].keys()) == sorted(expected["parameter_keys"])


def test_report_html_contains_metadata():
    meta = build_reproducibility_metadata(input_file="x.tsv", input_file_hash="abc", parameters={}, thresholds={})
    analysis = {"summary": {}, "verdict_counts": {}, "flags": [], "per_query": {}, "no_hit_queries": {}}
    html = build_report_html(analysis, meta)
    assert "x.tsv" in html
    assert "abc" in html

