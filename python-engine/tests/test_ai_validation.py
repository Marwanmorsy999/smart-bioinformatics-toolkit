import copy
import hashlib
import json
from pathlib import Path
import sys

ENGINE_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ENGINE_ROOT / "src"))
ROOT = Path(__file__).resolve().parents[2]

from smartbio.aiagent.plugins import get_plugin
from smartbio.aiagent.validation import validate

FASTA_PATH = ROOT / "shared" / "test-cases" / "dna_valid.fasta"


def _profile_step():
    return {"id": "step_1", "tool_id": "sequence-stats.profile", "params": {"sequence_type": "dna"}}


def _profile_artifacts(tmp_path):
    plugin_result = get_plugin("sequence-stats.profile").run(
        _profile_step(),
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
        for artifact in plugin_result["artifacts"]
    ]


def _with_json(artifacts, name, document):
    return _with_content(artifacts, name, json.dumps(document, indent=2, ensure_ascii=False))


def _with_content(artifacts, name, content):
    updated = []
    for artifact in artifacts:
        if artifact["name"] == name:
            updated.append(
                {
                    **artifact,
                    "content": content,
                    "sha256": hashlib.sha256(content.encode("utf-8")).hexdigest(),
                }
            )
        else:
            updated.append(dict(artifact))
    return updated


def test_real_profile_artifacts_pass(tmp_path):
    result = validate(_profile_step(), _profile_artifacts(tmp_path))
    assert result["status"] == "pass"
    assert result["flags"] == []
    assert "dna_gc_percent_in_range_and_consistent" in result["checked_rules"]


def test_gc_percent_inconsistent_with_base_counts_fails(tmp_path):
    artifacts = _profile_artifacts(tmp_path)
    statistics = json.loads(next(a for a in artifacts if a["name"] == "statistics.json")["content"])
    statistics["records"][0]["gc_percent"] = 99.9
    result = validate(_profile_step(), _with_json(artifacts, "statistics.json", statistics))
    assert result["status"] == "fail"
    assert any(flag.startswith("gc_percent_inconsistent:") for flag in result["flags"])


def test_summary_count_mismatch_fails(tmp_path):
    artifacts = _profile_artifacts(tmp_path)
    statistics = json.loads(next(a for a in artifacts if a["name"] == "statistics.json")["content"])
    statistics["summary"]["total_length"] += 1
    result = validate(_profile_step(), _with_json(artifacts, "statistics.json", statistics))
    assert result["status"] == "fail"
    assert "statistics_summary_mismatch:total_length" in result["flags"]


def test_missing_required_artifact_fails(tmp_path):
    artifacts = [a for a in _profile_artifacts(tmp_path) if a["name"] != "statistics.csv"]
    result = validate(_profile_step(), artifacts)
    assert result["status"] == "fail"
    assert "missing_artifact:statistics.csv" in result["flags"]


def test_sha256_mismatch_fails(tmp_path):
    artifacts = _profile_artifacts(tmp_path)
    artifacts[0]["sha256"] = "0" * 64
    result = validate(_profile_step(), artifacts)
    assert result["status"] == "fail"
    assert any(flag.startswith("sha256_mismatch:") for flag in result["flags"])


def test_validation_never_modifies_scientific_values(tmp_path):
    artifacts = _profile_artifacts(tmp_path)
    before = copy.deepcopy(artifacts)
    validate(_profile_step(), artifacts)
    assert artifacts == before


def test_declared_required_artifacts_from_meta_must_be_present_and_nonempty(tmp_path):
    artifacts = _profile_artifacts(tmp_path)
    meta = {"required_artifacts": ["validation.json", "statistics.json"]}
    assert validate(_profile_step(), artifacts, meta)["status"] == "pass"

    missing = [a for a in artifacts if a["name"] != "statistics.json"]
    result = validate(_profile_step(), missing, meta)
    assert result["status"] == "fail"
    assert "missing_artifact:statistics.json" in result["flags"]

    empty = _with_content(artifacts, "statistics.json", "   ")
    result = validate(_profile_step(), empty, meta)
    assert result["status"] == "fail"
    assert "empty_artifact:statistics.json" in result["flags"]

    # No meta: the legacy per-tool union still applies (backward compatible).
    assert "required_artifacts_present" in validate(_profile_step(), artifacts)["checked_rules"]


def test_declared_json_artifact_must_decode_to_object(tmp_path):
    artifacts = _profile_artifacts(tmp_path)
    meta = {"required_artifacts": ["validation.json"]}

    result = validate(_profile_step(), _with_json(artifacts, "validation.json", [1, 2]), meta)
    assert result["status"] == "fail"
    assert "declared_artifact_not_object:validation.json" in result["flags"]
    assert "declared_json_objects" in result["checked_rules"]

    result = validate(_profile_step(), _with_content(artifacts, "validation.json", "{not json"), meta)
    assert result["status"] == "fail"
    assert "invalid_json:validation.json" in result["flags"]


def test_execution_mode_label_from_meta_is_checked(tmp_path):
    artifacts = _profile_artifacts(tmp_path)
    result = validate(_profile_step(), artifacts, {"execution_mode": "simulated"})
    assert result["status"] == "fail"
    assert "invalid_execution_mode:simulated" in result["flags"]


def test_taxonomy_verdict_without_evidence_fails():
    step = {"id": "step_1", "tool_id": "microbiome-16s.taxonomy"}
    analysis = {
        "summary": {"total_queries": 1, "queries_with_hits": 1, "queries_without_hits": 0},
        "per_query": {
            "q1": {
                "consensus": {"evidence": []},
                "verdict": {"status": "species_supported"},
            }
        },
        "no_hit_queries": {},
    }
    content = json.dumps(analysis)
    artifacts = [
        {
            "name": "taxonomy_analysis.json",
            "kind": "json",
            "sha256": hashlib.sha256(content.encode("utf-8")).hexdigest(),
            "content": content,
        }
    ]
    result = validate(step, artifacts)
    assert result["status"] == "fail"
    assert "verdict_without_evidence:q1" in result["flags"]


def test_all_no_hits_is_flagged_as_warning():
    step = {"id": "step_1", "tool_id": "microbiome-16s.taxonomy"}
    analysis = {
        "summary": {"total_queries": 1, "queries_with_hits": 0, "queries_without_hits": 1},
        "per_query": {},
        "no_hit_queries": {
            "q1": {"consensus": {"evidence": []}, "verdict": {"status": "insufficient_evidence"}}
        },
    }
    content = json.dumps(analysis)
    artifacts = [{"name": "taxonomy_analysis.json", "kind": "json", "content": content}]
    result = validate(step, artifacts)
    assert result["status"] == "warn"
    assert "all_queries_no_hit" in result["flags"]
