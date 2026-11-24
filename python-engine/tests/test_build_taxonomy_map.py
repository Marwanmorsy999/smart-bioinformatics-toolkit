from pathlib import Path
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[2]
SCRIPT = ROOT / "scripts" / "build_taxonomy_map.py"
FIXTURE = ROOT / "shared" / "test-cases" / "taxdump_mini"


def test_build_taxonomy_map(tmp_path):
    out = tmp_path / "taxonomy_map.tsv"
    cmd = [
        sys.executable, str(SCRIPT),
        "--rankedlineage", str(FIXTURE / "rankedlineage.dmp"),
        "--nodes", str(FIXTURE / "nodes.dmp"),
        "--accessions", str(FIXTURE / "accessions.tsv"),
        "--output", str(out),
    ]
    res = subprocess.run(cmd, capture_output=True, text=True)
    assert res.returncode == 0, res.stderr
    text = out.read_text(encoding="utf-8")
    assert "taxid\tscientific_name\trank\tparent_taxid\tfull_lineage" in text
    assert "562" in text
    assert "561" in text
    for line in text.splitlines():
        if line.startswith("562\t"):
            assert "Escherichia coli" in line


def test_build_taxonomy_map_requires_name_source(tmp_path):
    """No --rankedlineage and no --names must fail instead of emitting blanks."""
    out = tmp_path / "taxonomy_map.tsv"
    cmd = [
        sys.executable, str(SCRIPT),
        "--nodes", str(FIXTURE / "nodes.dmp"),
        "--accessions", str(FIXTURE / "accessions.tsv"),
        "--output", str(out),
    ]
    res = subprocess.run(cmd, capture_output=True, text=True)
    assert res.returncode != 0, res.stdout
    assert "--rankedlineage" in res.stderr
    assert "--names" in res.stderr
    assert "empty" in res.stderr
    assert not out.exists(), "no output file should be written on failure"
