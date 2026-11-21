from pathlib import Path
import hashlib
import json
import subprocess
import sys

ENGINE_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ENGINE_ROOT / "src"))

import smartbio.blast_runner as runner
from smartbio.blast_runner import (
    find_executable,
    get_blast_version,
    validate_database,
    run_blastn,
    BLASTN_LOCAL_FIELDS,
)

FIXTURES = Path(__file__).resolve().parents[2] / "shared" / "test-cases"


class FakeCompleted:
    def __init__(self, returncode=0, stdout="", stderr="", side_effect=None):
        self.returncode = returncode
        self.stdout = stdout
        self.stderr = stderr
        self.side_effect = side_effect


def make_subprocess_side_effect(tmp_path, blast_output, returncode=0, stderr="", timeout=False):
    def _side_effect(cmd, **kwargs):
        if timeout:
            raise subprocess.TimeoutExpired(cmd, kwargs.get("timeout", 1))
        # version check
        if len(cmd) >= 2 and cmd[1] == "-version":
            return FakeCompleted(0, "blastn: 2.16.0+\n", "")
        # database validation
        if len(cmd) >= 2 and cmd[1] == "-info":
            return FakeCompleted(0, "Database: test\n", "")
        # blast execution: create output file
        # find -out
        if "-out" in cmd:
            idx = cmd.index("-out")
            out_file = Path(cmd[idx + 1])
            out_file.write_text(blast_output, encoding="utf-8")
        return FakeCompleted(returncode, "", stderr)
    return _side_effect


def test_find_executable_custom_and_path(monkeypatch):
    monkeypatch.setattr("smartbio.blast_runner.shutil.which", lambda name: "/usr/bin/" + name)
    assert find_executable("blastn") == "/usr/bin/blastn"
    assert find_executable("blastn", "/nope") is None


def test_executable_not_found(monkeypatch):
    monkeypatch.setattr("smartbio.blast_runner.shutil.which", lambda name: None)
    try:
        run_blastn(input_path=FIXTURES / "dna_valid.fasta", database="db", out_dir=Path("/tmp/x"))
    except RuntimeError as exc:
        assert "not found" in str(exc)
    else:
        raise AssertionError("Expected RuntimeError")


def test_version_detection(monkeypatch):
    def side_effect(cmd, **kwargs):
        return FakeCompleted(0, "blastn: 2.16.0+\n", "")
    monkeypatch.setattr("smartbio.blast_runner.subprocess.run", side_effect)
    monkeypatch.setattr("smartbio.blast_runner.shutil.which", lambda name: "/bin/" + name)
    version = get_blast_version("/bin/blastn")
    assert "2.16.0" in version


def test_missing_database(monkeypatch):
    def side_effect(cmd, **kwargs):
        if cmd[1] == "-version":
            return FakeCompleted(0, "blastn: 2.16.0+\n", "")
        if cmd[1] == "-info":
            return FakeCompleted(1, "", "Database not found")
        return FakeCompleted(0, "", "")
    monkeypatch.setattr("smartbio.blast_runner.subprocess.run", side_effect)
    monkeypatch.setattr("smartbio.blast_runner.shutil.which", lambda name: "/bin/" + name)
    ok, msg, info = validate_database("missing_db")
    assert ok is False
    assert "not found" in msg.lower() or "failed" in msg.lower() or msg


def test_successful_run_mock(monkeypatch, tmp_path):
    blast_output = "q1\tsacc1\t123\tEscherichia coli\t99.0\t100\t1\t100\t100\t1e-50\t200\t100\n"
    side_effect = make_subprocess_side_effect(tmp_path, blast_output)
    monkeypatch.setattr("smartbio.blast_runner.subprocess.run", side_effect)
    monkeypatch.setattr("smartbio.blast_runner.shutil.which", lambda name: "/bin/" + name)

    out_dir = tmp_path / "out"
    result = run_blastn(
        input_path=FIXTURES / "dna_valid.fasta",
        database="/path/to/db",
        out_dir=out_dir,
        task="megablast",
    )
    assert (out_dir / "blast_results.tsv").exists()
    assert (out_dir / "filtered_results.csv").exists()
    assert (out_dir / "analysis.json").exists()
    assert (out_dir / "blast_run.json").exists()
    assert (out_dir / "execution.log").exists()
    metadata = result["metadata"]
    assert metadata["task"] == "megablast"
    assert metadata["schema"] == "blastn_local_v1"
    assert metadata["outfmt_fields"] == BLASTN_LOCAL_FIELDS
    assert metadata["input_queries"] == 3
    report = result["report"]
    assert report["no_hit_queries"]  # dna_valid has 3 queries, only dna_001 hit
    assert "dna_002" in report["no_hit_queries"] or "dna_003" in report["no_hit_queries"]


def test_nonzero_return_code(monkeypatch, tmp_path):
    def side_effect(cmd, **kwargs):
        if cmd[1] == "-version":
            return FakeCompleted(0, "blastn: 2.16.0+\n", "")
        if cmd[1] == "-info":
            return FakeCompleted(0, "Database: test\n", "")
        if "-out" in cmd:
            idx = cmd.index("-out")
            Path(cmd[idx + 1]).write_text("", encoding="utf-8")
        return FakeCompleted(2, "", "Database error")
    monkeypatch.setattr("smartbio.blast_runner.subprocess.run", side_effect)
    monkeypatch.setattr("smartbio.blast_runner.shutil.which", lambda name: "/bin/" + name)
    try:
        run_blastn(input_path=FIXTURES / "dna_valid.fasta", database="db", out_dir=tmp_path / "out2")
    except RuntimeError as exc:
        assert "Database error" in str(exc) or "exit code 2" in str(exc)
    else:
        raise AssertionError("Expected RuntimeError")


def test_timeout(monkeypatch, tmp_path):
    def side_effect(cmd, **kwargs):
        if cmd[1] == "-version":
            return FakeCompleted(0, "blastn: 2.16.0+\n", "")
        if cmd[1] == "-info":
            return FakeCompleted(0, "Database: test\n", "")
        raise subprocess.TimeoutExpired(cmd, 1)
    monkeypatch.setattr("smartbio.blast_runner.subprocess.run", side_effect)
    monkeypatch.setattr("smartbio.blast_runner.shutil.which", lambda name: "/bin/" + name)
    try:
        run_blastn(input_path=FIXTURES / "dna_valid.fasta", database="db", out_dir=tmp_path / "out3", timeout=1)
    except RuntimeError as exc:
        assert "timed out" in str(exc)
    else:
        raise AssertionError("Expected RuntimeError")


def test_paths_with_spaces(monkeypatch, tmp_path):
    captured = {}

    def side_effect(cmd, **kwargs):
        if cmd[1] == "-version":
            return FakeCompleted(0, "blastn: 2.16.0+\n", "")
        if cmd[1] == "-info":
            return FakeCompleted(0, "Database: test\n", "")
        captured["cmd"] = list(cmd)
        if "-out" in cmd:
            idx = cmd.index("-out")
            Path(cmd[idx + 1]).write_text("", encoding="utf-8")
        return FakeCompleted(0, "", "")

    monkeypatch.setattr("smartbio.blast_runner.subprocess.run", side_effect)
    monkeypatch.setattr("smartbio.blast_runner.shutil.which", lambda name: "/bin/" + name)

    db_path = "/path/with spaces/db"
    input_path = FIXTURES / "dna_valid.fasta"
    out_dir = tmp_path / "out with spaces"
    try:
        run_blastn(input_path=input_path, database=db_path, out_dir=out_dir)
    except Exception:
        pass
    cmd = captured.get("cmd", [])
    assert db_path in cmd
    assert str(input_path) in cmd


def test_correct_outfmt_arguments(monkeypatch, tmp_path):
    captured = {}

    def side_effect(cmd, **kwargs):
        if cmd[1] == "-version":
            return FakeCompleted(0, "blastn: 2.16.0+\n", "")
        if cmd[1] == "-info":
            return FakeCompleted(0, "Database: test\n", "")
        captured["cmd"] = list(cmd)
        if "-out" in cmd:
            idx = cmd.index("-out")
            Path(cmd[idx + 1]).write_text("", encoding="utf-8")
        return FakeCompleted(0, "", "")

    monkeypatch.setattr("smartbio.blast_runner.subprocess.run", side_effect)
    monkeypatch.setattr("smartbio.blast_runner.shutil.which", lambda name: "/bin/" + name)
    try:
        run_blastn(input_path=FIXTURES / "dna_valid.fasta", database="db", out_dir=tmp_path / "out4", task="blastn", evalue=1e-10, max_target_seqs=10, num_threads=2)
    except Exception:
        pass
    cmd = captured["cmd"]
    assert "-outfmt" in cmd
    outfmt = cmd[cmd.index("-outfmt") + 1]
    assert outfmt.startswith("6 ")
    assert "qcovs" in outfmt
    assert cmd[cmd.index("-task") + 1] == "blastn"
    assert cmd[cmd.index("-evalue") + 1] == "1e-10"
    assert cmd[cmd.index("-max_target_seqs") + 1] == "10"
    assert cmd[cmd.index("-num_threads") + 1] == "2"


def test_empty_blast_output(monkeypatch, tmp_path):
    side_effect = make_subprocess_side_effect(tmp_path, "")
    monkeypatch.setattr("smartbio.blast_runner.subprocess.run", side_effect)
    monkeypatch.setattr("smartbio.blast_runner.shutil.which", lambda name: "/bin/" + name)
    out_dir = tmp_path / "empty"
    result = run_blastn(input_path=FIXTURES / "dna_valid.fasta", database="db", out_dir=out_dir)
    report = result["report"]
    assert report["rows"] == []
    assert len(report["no_hit_queries"]) == 3


def test_candidate_limit_warning(monkeypatch, tmp_path):
    # 3 hits for q1 equals max_target_seqs=3 -> warning
    blast_output = "".join(
        f"q1\tsacc{i}\t1\tX\t99.0\t10\t1\t10\t10\t1e-5\t50\t100\n" for i in range(3)
    )
    side_effect = make_subprocess_side_effect(tmp_path, blast_output)
    monkeypatch.setattr("smartbio.blast_runner.subprocess.run", side_effect)
    monkeypatch.setattr("smartbio.blast_runner.shutil.which", lambda name: "/bin/" + name)
    out_dir = tmp_path / "limit"
    result = run_blastn(input_path=FIXTURES / "dna_valid.fasta", database="db", out_dir=out_dir, max_target_seqs=3)
    assert result["metadata"]["candidate_limit_reached"] is True
    assert any("max_target_seqs" in w for w in result["metadata"]["warnings"])


def test_metadata_fields(monkeypatch, tmp_path):
    side_effect = make_subprocess_side_effect(tmp_path, "")
    monkeypatch.setattr("smartbio.blast_runner.subprocess.run", side_effect)
    monkeypatch.setattr("smartbio.blast_runner.shutil.which", lambda name: "/bin/" + name)
    out_dir = tmp_path / "meta"
    result = run_blastn(input_path=FIXTURES / "dna_valid.fasta", database="db", out_dir=out_dir, evalue=1e-5)
    md = result["metadata"]
    required = [
        "run_id", "input_file", "input_sha256", "program", "task", "blast_version",
        "database", "evalue", "max_target_seqs", "num_threads", "schema",
        "outfmt_fields", "timestamp_utc", "duration_seconds", "return_code",
        "warnings", "input_queries", "queries_with_hits", "queries_without_hits",
    ]
    for key in required:
        assert key in md, key
    # sha256 check
    expected = hashlib.sha256((FIXTURES / "dna_valid.fasta").read_bytes()).hexdigest()
    assert md["input_sha256"] == expected
    assert md["database_info"] is not None


def test_schema_mapping(monkeypatch, tmp_path):
    blast_output = "q1\tsacc1\t123\tX\t99.0\t100\t1\t100\t100\t1e-50\t200\t100\n"
    side_effect = make_subprocess_side_effect(tmp_path, blast_output)
    monkeypatch.setattr("smartbio.blast_runner.subprocess.run", side_effect)
    monkeypatch.setattr("smartbio.blast_runner.shutil.which", lambda name: "/bin/" + name)
    out_dir = tmp_path / "schema"
    result = run_blastn(input_path=FIXTURES / "dna_valid.fasta", database="db", out_dir=out_dir)
    row = result["report"]["rows"][0]
    assert row["qcovs"] == 100.0
    assert row["staxids"] == "123"
    # ensure qcovs is float column
    assert isinstance(row["qcovs"], float)


def test_backwards_compat_existing_schemas():
    from smartbio.blast import parse_blast_text
    tsv = "q1\thitA\t99.0\t100\t1\t0\t1\t100\t1\t100\t1e-50\t200\n"
    parsed = parse_blast_text(tsv, schema="standard")
    assert parsed["schema"] == "standard"
    tsv2 = "q1\tsacc1\t123\tX\t99.0\t100\t1\t100\t200\t1e-50\t200\n"
    parsed2 = parse_blast_text(tsv2, schema="extended")
    assert parsed2["schema"] == "extended"


def test_invalid_input(monkeypatch, tmp_path):
    # create invalid FASTA
    bad = tmp_path / "bad.fasta"
    bad.write_text(">x\nACGTZ123\n", encoding="utf-8")
    monkeypatch.setattr("smartbio.blast_runner.shutil.which", lambda name: "/bin/" + name)
    try:
        run_blastn(input_path=bad, database="db", out_dir=tmp_path / "out_bad")
    except ValueError as exc:
        assert "validation failed" in str(exc).lower() or "invalid" in str(exc).lower()
    else:
        raise AssertionError("Expected ValueError")
