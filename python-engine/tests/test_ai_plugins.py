import json
from pathlib import Path
import sys

ENGINE_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ENGINE_ROOT / "src"))
ROOT = Path(__file__).resolve().parents[2]

from smartbio.aiagent.plugins import TOOL_REGISTRY, get_plugin, list_tools
from smartbio.fasta import parse_fasta_text, validate_records
from smartbio.statistics import calculate_statistics

FASTA_PATH = ROOT / "shared" / "test-cases" / "dna_valid.fasta"
BLAST_TSV_PATH = ROOT / "shared" / "test-cases" / "blast_sample.tsv"


def _context(tmp_path):
    return {"workspace": str(tmp_path), "execution_mode": "real"}


def _step(tool_id, params=None):
    return {"id": "step_1", "tool_id": tool_id, "params": params or {}}


def test_registry_contains_four_contract_tools():
    # New domains are discovered from manifests, so the registry may grow.
    assert {
        "sequence-stats.validate",
        "sequence-stats.profile",
        "microbiome-16s.blast-parse",
        "microbiome-16s.taxonomy",
    } <= set(TOOL_REGISTRY)
    assert len(list_tools()) >= 4
    assert get_plugin("sequence-stats.profile").VERSION == "1.0.0"


def test_validate_plugin_uses_real_fasta_functions(tmp_path):
    fasta_text = FASTA_PATH.read_text(encoding="utf-8")
    result = get_plugin("sequence-stats.validate").run(
        _step("sequence-stats.validate", {"sequence_type": "dna"}),
        {"fasta_text": fasta_text, "filename": "dna_valid.fasta"},
        _context(tmp_path),
    )
    assert result["tool_run_meta"]["status"] == "succeeded"
    assert [artifact["name"] for artifact in result["artifacts"]] == ["validation.json"]
    validation = json.loads(result["artifacts"][0]["content"])
    expected = validate_records(parse_fasta_text(fasta_text), "dna")
    assert validation["total_records"] == expected["total_records"] == 3
    assert validation["valid_records"] == expected["valid_records"] == 3
    assert validation["file_valid"] is True


def test_profile_plugin_reports_real_statistics(tmp_path):
    fasta_text = FASTA_PATH.read_text(encoding="utf-8")
    result = get_plugin("sequence-stats.profile").run(
        _step("sequence-stats.profile", {"sequence_type": "dna"}),
        {"fasta_text": fasta_text},
        _context(tmp_path),
    )
    names = [artifact["name"] for artifact in result["artifacts"]]
    assert names == ["validation.json", "statistics.json", "analysis.json", "statistics.csv"]
    artifacts = {artifact["name"]: artifact for artifact in result["artifacts"]}
    statistics = json.loads(artifacts["statistics.json"]["content"])
    expected = calculate_statistics(validate_records(parse_fasta_text(fasta_text), "dna"))
    assert statistics == expected
    assert statistics["summary"]["gc_percent_mean"] == 50.0
    assert statistics["summary"]["total_length"] == 59
    assert "gc_percent" in artifacts["statistics.csv"]["content"]
    analysis = json.loads(artifacts["analysis.json"]["content"])
    assert analysis["statistics"] == statistics


def test_blast_parse_plugin_parses_real_tsv(tmp_path):
    tsv_text = BLAST_TSV_PATH.read_text(encoding="utf-8")
    result = get_plugin("microbiome-16s.blast-parse").run(
        _step("microbiome-16s.blast-parse"),
        {"tsv_text": tsv_text},
        _context(tmp_path),
    )
    assert result["tool_run_meta"]["status"] == "succeeded"
    document = json.loads(result["artifacts"][0]["content"])
    summary = document["analysis"]["summary"]
    assert summary["total_rows"] == 2
    assert summary["valid_rows"] == 2
    assert summary["unique_queries"] == 2


def test_blast_parse_without_tsv_fails_without_fabricating_hits(tmp_path):
    result = get_plugin("microbiome-16s.blast-parse").run(
        _step("microbiome-16s.blast-parse"), {}, _context(tmp_path)
    )
    assert result["tool_run_meta"]["status"] == "failed"
    assert "No BLAST TSV dataset" in result["tool_run_meta"]["reason"]
    assert result["artifacts"] == []


def test_taxonomy_without_tsv_fails_without_fabricating_hits(tmp_path):
    result = get_plugin("microbiome-16s.taxonomy").run(
        _step("microbiome-16s.taxonomy"), {}, _context(tmp_path)
    )
    assert result["tool_run_meta"]["status"] == "failed"
    assert result["artifacts"] == []
