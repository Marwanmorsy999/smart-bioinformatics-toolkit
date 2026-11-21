import json
import shutil
import subprocess
import sys
from pathlib import Path

import pytest

ENGINE_ROOT = Path(__file__).resolve().parents[1]
ROOT = ENGINE_ROOT.parents[0]

pytestmark = pytest.mark.skipif(
    shutil.which("blastn") is None or shutil.which("makeblastdb") is None,
    reason="BLAST+ not installed",
)


def test_blast_run_integration(tmp_path):
    ref = tmp_path / "ref.fasta"
    qry = tmp_path / "qry.fasta"
    ref.write_text(">ref1 test ref\nACGTACGTACGTACGTACGTACGTACGTACGT\n", encoding="utf-8")
    qry.write_text(">q1 test query\nACGTACGTACGTACGTACGTACGTACGTACGT\n", encoding="utf-8")
    db = tmp_path / "db"
    subprocess.run(["makeblastdb", "-in", str(ref), "-dbtype", "nucl", "-out", str(db)], check=True, capture_output=True)
    out_dir = tmp_path / "out"
    cmd = [
        sys.executable, str(ENGINE_ROOT / "main.py"), "blast-run",
        "--input", str(qry),
        "--database", str(db),
        "--out-dir", str(out_dir),
        "--evalue", "10",
        "--max-target-seqs", "5",
        "--threads", "1",
    ]
    res = subprocess.run(cmd, capture_output=True, text=True)
    assert res.returncode == 0, res.stderr
    assert (out_dir / "blast_results.tsv").exists()
    assert (out_dir / "analysis.json").exists()
    analysis = json.loads((out_dir / "analysis.json").read_text(encoding="utf-8"))
    assert analysis["summary"]["total_queries"] >= 1

