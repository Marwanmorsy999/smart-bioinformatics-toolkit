"""End-to-end CLI regression test for the local-runner fallback.

When `--schema auto` is used on a `blastn_local_v1` BLAST file that fails to
parse as `standard`, the CLI re-parses using the adjacent `blast_run.json`.
"""

import json
import shutil
import subprocess
import sys
from pathlib import Path

ENGINE_ROOT = Path(__file__).resolve().parents[1]
FIXTURES = Path(__file__).resolve().parents[2] / "shared" / "test-cases"


def _run_cli(args, cwd):
    return subprocess.run(
        [sys.executable, "main.py", *args],
        cwd=cwd,
        capture_output=True,
        text=True,
        timeout=60,
        check=False,
    )


def test_taxonomy_auto_schema_fallback(tmp_path):
    out_dir = tmp_path / "local_blast"
    out_dir.mkdir()
    shutil.copy(FIXTURES / "blast_taxonomy.tsv", out_dir / "blast_results.tsv")
    (out_dir / "blast_run.json").write_text(
        json.dumps({
            "schema": "blastn_local_v1",
            "outfmt_fields": ["qseqid", "sacc", "staxids", "sscinames", "pident",
                              "length", "qstart", "qend", "qlen", "evalue", "bitscore", "qcovs"],
        }),
        encoding="utf-8",
    )
    result = _run_cli(
        ["taxonomy", "--input", str(out_dir / "blast_results.tsv"),
         "--taxonomy-map", str(FIXTURES / "taxonomy_map.tsv"),
         "--out-dir", str(tmp_path / "taxonomy")],
        ENGINE_ROOT,
    )
    assert result.returncode == 0, result.stdout + result.stderr
    report = json.loads((tmp_path / "taxonomy" / "taxonomy_analysis.json").read_text(encoding="utf-8"))
    assert report["summary"]["queries_with_hits"] == 2
    q1 = report["per_query"]["q1"]
    assert q1["consensus"]["status"] == "ambiguous_species"
    assert q1["consensus"]["consensus_taxon"] == "Escherichia"


def test_blast_auto_schema_fallback(tmp_path):
    out_dir = tmp_path / "local_blast"
    out_dir.mkdir()
    shutil.copy(FIXTURES / "blast_taxonomy.tsv", out_dir / "blast_results.tsv")
    (out_dir / "blast_run.json").write_text(
        json.dumps({"schema": "blastn_local_v1"}), encoding="utf-8",
    )
    result = _run_cli(
        ["blast", "--input", str(out_dir / "blast_results.tsv"),
         "--json-out", str(tmp_path / "report.json")],
        ENGINE_ROOT,
    )
    assert result.returncode == 0, result.stdout + result.stderr
    report = json.loads((tmp_path / "report.json").read_text(encoding="utf-8"))
    assert report["schema"] == "blastn_local_v1"
    assert report["schema_source"] == "fallback:blast_run.json"
