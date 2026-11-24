import hashlib
import json
from pathlib import Path
import sys

ENGINE_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ENGINE_ROOT / "src"))
ROOT = Path(__file__).resolve().parents[2]

from smartbio.aiagent.explanation import (
    REFERENCES,
    build_explanation,
    check_explanation,
)
from smartbio.aiagent.plugins import get_plugin
from smartbio.aiagent.validation import validate

FASTA_PATH = ROOT / "shared" / "test-cases" / "dna_valid.fasta"
STEP = {"id": "step_1", "tool_id": "sequence-stats.profile", "params": {"sequence_type": "dna"}}


def _profile_artifacts(tmp_path):
    result = get_plugin("sequence-stats.profile").run(
        STEP,
        {"fasta_text": FASTA_PATH.read_text(encoding="utf-8")},
        {"workspace": str(tmp_path)},
    )
    return [
        {
            "name": artifact["name"],
            "kind": artifact["kind"],
            "sha256": hashlib.sha256(artifact["content"].encode("utf-8")).hexdigest(),
            "content": artifact["content"],
        }
        for artifact in result["artifacts"]
    ]


def test_explanation_numbers_are_traceable(tmp_path):
    artifacts = _profile_artifacts(tmp_path)
    validation = validate(STEP, artifacts)
    explanation = build_explanation(STEP, artifacts, validation, limitations=["local only"])
    assert explanation["findings"]
    assert "local only" in explanation["limitations"]
    result = check_explanation(explanation, artifacts)
    assert result["ok"], result["errors"]


def test_fabricated_number_is_rejected(tmp_path):
    artifacts = _profile_artifacts(tmp_path)
    explanation = build_explanation(STEP, artifacts, validate(STEP, artifacts))
    explanation["findings"].append(
        {
            "text": "The mean GC content is 99.99 percent.",
            "artifact": "statistics.json",
            "field_path": "summary.gc_percent_mean",
        }
    )
    result = check_explanation(explanation, artifacts)
    assert result["ok"] is False
    assert any(error.startswith("unsupported_number:") for error in result["errors"])


def _citation(entry):
    return {key: entry[key] for key in ("key", "title", "url", "verified")}


def test_unverified_citation_is_rejected(tmp_path):
    artifacts = _profile_artifacts(tmp_path)
    explanation = build_explanation(STEP, artifacts, validate(STEP, artifacts))
    explanation["references"].append(_citation(REFERENCES["kim2014_16s_species_threshold"]))
    result = check_explanation(explanation, artifacts)
    assert result["ok"] is False
    assert any(error.startswith("unverified_reference:") for error in result["errors"])


def test_finding_number_from_another_field_is_rejected(tmp_path):
    """A number present elsewhere in the artifact cannot back a wrong field."""
    artifacts = _profile_artifacts(tmp_path)
    explanation = build_explanation(STEP, artifacts, validate(STEP, artifacts))
    explanation["findings"].append(
        {
            "text": "Mean GC content is 59 percent.",
            "artifact": "statistics.json",
            "field_path": "summary.gc_percent_mean",
        }
    )
    result = check_explanation(explanation, artifacts)
    assert result["ok"] is False
    assert any(error.startswith("unsupported_number:finding[") for error in result["errors"])
    explanation["findings"].append(
        {
            "text": "There are 59 valid records.",
            "artifact": "validation.json",
            "field_path": "valid_records",
        }
    )
    result = check_explanation(explanation, artifacts)
    assert result["ok"] is False


def test_limitation_fabricated_number_is_rejected(tmp_path):
    artifacts = _profile_artifacts(tmp_path)
    explanation = build_explanation(STEP, artifacts, validate(STEP, artifacts))
    # 12 is an artifact value (a nucleotide count) but is not cited by any
    # finding, so it must not appear in limitations text either.
    explanation["limitations"].append("Mean GC content is 12 percent of bases.")
    result = check_explanation(explanation, artifacts)
    assert result["ok"] is False
    assert any(error.startswith("unsupported_number:limitations[") for error in result["errors"])


def test_fabricated_reference_metadata_is_rejected(tmp_path):
    artifacts = _profile_artifacts(tmp_path)
    explanation = build_explanation(STEP, artifacts, validate(STEP, artifacts))
    explanation["references"][0]["title"] = "FABRICATED TITLE"
    explanation["references"][0]["url"] = "https://evil.example/fake"
    result = check_explanation(explanation, artifacts)
    assert result["ok"] is False
    assert any(error.startswith("reference_metadata_mismatch:") for error in result["errors"])


def test_missing_verified_flag_is_rejected(tmp_path):
    artifacts = _profile_artifacts(tmp_path)
    explanation = build_explanation(STEP, artifacts, validate(STEP, artifacts))
    del explanation["references"][0]["verified"]
    result = check_explanation(explanation, artifacts)
    assert result["ok"] is False
    assert any(error.startswith("invalid_reference_metadata:") for error in result["errors"])


def test_extra_reference_field_is_rejected(tmp_path):
    artifacts = _profile_artifacts(tmp_path)
    explanation = build_explanation(STEP, artifacts, validate(STEP, artifacts))
    explanation["references"][0]["verified_by"] = "fabricated"
    result = check_explanation(explanation, artifacts)
    assert result["ok"] is False
    assert any(error.startswith("reference_metadata_mismatch:") for error in result["errors"])


def test_verified_reference_is_accepted(tmp_path):
    artifacts = _profile_artifacts(tmp_path)
    explanation = build_explanation(STEP, artifacts, validate(STEP, artifacts))
    assert any(
        ref["key"] == "smartbio_gc_definition" and ref["verified"] is True
        for ref in explanation["references"]
    )
    assert check_explanation(explanation, artifacts)["ok"] is True


def test_unknown_field_path_is_rejected(tmp_path):
    artifacts = _profile_artifacts(tmp_path)
    explanation = build_explanation(STEP, artifacts, validate(STEP, artifacts))
    explanation["findings"][0]["field_path"] = "summary.does_not_exist"
    result = check_explanation(explanation, artifacts)
    assert result["ok"] is False
    assert any(error.startswith("unknown_field_path:") for error in result["errors"])


def test_unknown_artifact_reference_is_rejected(tmp_path):
    artifacts = _profile_artifacts(tmp_path)
    explanation = build_explanation(STEP, artifacts, validate(STEP, artifacts))
    explanation["findings"][0]["artifact"] = "missing.json"
    result = check_explanation(explanation, artifacts)
    assert result["ok"] is False
    assert any(error.startswith("unknown_artifact:") for error in result["errors"])
