"""Tests for fail-closed M5 plugin discovery, registry and extension seams."""

from __future__ import annotations

import copy
import json
from pathlib import Path
import sys

ENGINE_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ENGINE_ROOT / "src"))
ROOT = Path(__file__).resolve().parents[2]

sys.path.insert(0, str(ROOT / "scripts"))

from smartbio.aiagent import agent as agent_module  # noqa: E402
from smartbio.aiagent.agent import _step_from_job, process_job  # noqa: E402
from smartbio.aiagent.explanation import build_explanation, check_explanation  # noqa: E402
from smartbio.aiagent.plugin_discovery import (  # noqa: E402
    DiscoveryResult,
    DiscoveredTool,
    check_requirement,
    declares_required_artifacts,
    discover,
)
from smartbio.aiagent.plugins import (  # noqa: E402
    availability_report,
    get_plugin,
    is_available,
    list_tools,
    load_plugins,
    plugin_capabilities,
)
from smartbio.aiagent.validation import validate  # noqa: E402

SHARED_PLUGINS = ROOT / "shared" / "plugins"
TEMPLATE_DIR = ROOT / "docs" / "plugins" / "template"
SEQUENCE_MANIFEST = json.loads(
    (SHARED_PLUGINS / "sequence-stats.json").read_text(encoding="utf-8")
)


def _write(tmp_path: Path, manifest: dict, name: str = "candidate.json") -> Path:
    path = tmp_path / name
    path.write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    return path


def _one_tool_manifest() -> dict:
    manifest = copy.deepcopy(SEQUENCE_MANIFEST)
    manifest["tools"] = manifest["tools"][:1]
    return manifest


def _json_artifact(name: str, document: dict) -> dict:
    return {"name": name, "kind": "json", "content": json.dumps(document)}


# --- discovery / availability ------------------------------------------------


def test_shipped_manifests_are_discovered_and_fails_closed():
    result = discover()
    assert result.errors == []
    assert {"sequence-stats.validate", "sequence-stats.profile", "microbiome-16s.blast-parse",
            "microbiome-16s.taxonomy"} <= set(result.tools)
    assert result.tools["sequence-stats.validate"].available is True
    parse = result.tools["microbiome-16s.blast-parse"]
    assert parse.available is False
    assert parse.declared_available is False
    assert "Unsatisfied runtime requirement" in (parse.unavailable_reason or "")
    assert set(load_plugins()) == {
        tool_id for tool_id, record in result.tools.items() if record.adapter is not None
    }
    assert get_plugin("sequence-stats.profile") is not None
    tools = list_tools()
    assert tools
    assert all("available" in tool and "unavailable_reason" in tool for tool in tools)
    assert is_available("sequence-stats.profile") is True
    assert is_available("microbiome-16s.blast-parse") is False


def test_invalid_manifest_is_never_available(tmp_path):
    manifest = copy.deepcopy(SEQUENCE_MANIFEST)
    del manifest["tools"][0]["limitations"]
    _write(tmp_path, manifest)
    result = discover(tmp_path)
    assert any("limitations" in error for error in result.errors)
    assert "sequence-stats.validate" not in result.tools
    assert "sequence-stats.profile" not in result.tools


def test_missing_hard_requirement_means_no_registration_and_no_execution(
    tmp_path, monkeypatch
):
    manifest = _one_tool_manifest()
    manifest["tools"][0]["requirements"] = ["python-package:definitely_missing_pkg_xyz"]
    _write(tmp_path, manifest)
    result = discover(tmp_path)
    record = result.tools["sequence-stats.validate"]
    assert record.declared_available is True
    assert record.available is False
    assert record.adapter is None
    assert "unsatisfied_hard_requirement" in (record.unavailable_reason or "")
    assert "not importable" in (record.unavailable_reason or "")
    assert "sequence-stats.validate" not in result.adapters()
    monkeypatch.setattr(
        agent_module, "get_plugin", lambda tool_id: result.adapters().get(tool_id)
    )
    job = {"id": "job_invalid", "tool_id": "sequence-stats.validate", "inputs": {}}
    assert process_job(job)["status"] == "failed"


def test_valid_but_unavailable_tool_is_reported_yet_executable():
    record = discover().tools["microbiome-16s.blast-parse"]
    assert record.registered is True
    assert record.available is False
    assert record.unavailable_reason
    assert get_plugin("microbiome-16s.blast-parse") is not None
    assert is_available("microbiome-16s.blast-parse") is False
    report = availability_report()
    assert report["tools"]["microbiome-16s.blast-parse"]["registered"] is True
    assert report["tools"]["microbiome-16s.blast-parse"]["available"] is False


def test_invalid_contract_is_rejected(tmp_path):
    manifest = _one_tool_manifest()
    manifest["tools"][0]["params_schema"] = {"type": "object", "required": "not-a-list"}
    _write(tmp_path, manifest)
    result = discover(tmp_path)
    assert any("invalid JSON Schema" in error for error in result.errors)
    record = result.tools["sequence-stats.validate"]
    assert record.adapter is None
    assert record.available is False


def test_tool_id_mismatch_is_rejected(tmp_path):
    manifest = _one_tool_manifest()
    manifest["tools"][0]["id"] = "wrong-domain.tool"
    _write(tmp_path, manifest)
    result = discover(tmp_path)
    record = result.tools["wrong-domain.tool"]
    assert record.adapter is None
    assert record.available is False
    assert any("does not match" in error for error in record.errors)


def test_duplicate_tool_ids_are_rejected(tmp_path):
    manifest = _one_tool_manifest()
    _write(tmp_path, manifest, "first.json")
    _write(tmp_path, copy.deepcopy(manifest), "second.json")
    result = discover(tmp_path)
    assert any(error.startswith("duplicate_tool_id:") for error in result.errors)
    assert "sequence-stats.validate" not in result.tools


def test_availability_report_and_capabilities_are_structured():
    report = availability_report()
    assert report["tools"]["sequence-stats.profile"]["available"] is True
    assert report["tools"]["microbiome-16s.taxonomy"]["declared_available"] is False
    assert report["summary"]["total"] == len(report["tools"])
    assert report["errors"] == []
    capabilities = plugin_capabilities()
    required_fields = {
        "id", "name", "description", "version", "backend", "domain", "available",
        "unavailable_reason", "external_egress", "requirements", "estimated_seconds",
        "params_schema", "input_schema", "output_schema", "references", "limitations",
    }
    assert capabilities["tools"]
    assert all(required_fields <= set(tool) for tool in capabilities["tools"])


def test_requirement_forms_are_checked():
    assert check_requirement("python-package:biopython")["satisfied"] is True
    assert check_requirement("executable:definitely_missing_exe_xyz")["satisfied"] is False
    assert check_requirement("opaque_runtime_condition")["satisfied"] is False


def test_new_manifest_is_discovered_without_code_edits(tmp_path):
    (tmp_path / "newdomain_plugin.py").write_text(
        'TOOL_ID = "newdomain.tool"\n'
        'VERSION = "1.0.0"\n'
        "class NewPlugin:\n"
        '    TOOL_ID = TOOL_ID\n'
        '    VERSION = VERSION\n'
        "    def run(self, step, inputs, context):\n"
        '        return {"artifacts": [], "tool_run_meta": {"status": "succeeded"}}\n',
        encoding="utf-8",
    )
    manifest = _one_tool_manifest()
    tool = manifest["tools"][0]
    tool["id"] = "newdomain.tool"
    tool["entrypoint"] = "newdomain_plugin:NewPlugin"
    tool["available"] = True
    tool.pop("unavailable_reason", None)
    tool["requirements"] = ["python-package:biopython"]
    _write(tmp_path, manifest, "newdomain.json")
    result = discover(tmp_path)
    assert result.errors == []
    record = result.tools["newdomain.tool"]
    assert record.available is True
    assert record.adapter is not None
    assert record.adapter.TOOL_ID == "newdomain.tool"


def test_template_is_a_compliant_unavailable_skeleton():
    result = discover(TEMPLATE_DIR)
    assert result.errors == []
    record = result.tools["template.example"]
    assert record.adapter is not None
    assert record.available is False
    assert "Skeleton" in (record.unavailable_reason or "")
    assert get_plugin("template.example") is None


def test_startup_discovery_rejects_temp_manifest_dir(monkeypatch, tmp_path):
    _write(tmp_path, _one_tool_manifest())
    monkeypatch.setenv("SMARTBIO_PLUGIN_DIR", str(tmp_path))
    monkeypatch.delenv("SMARTBIO_PLUGIN_DIR_TRUSTED", raising=False)
    result = discover()
    assert any(error.startswith("untrusted_manifest_dir:") for error in result.errors)
    assert result.tools == {}
    monkeypatch.setenv("SMARTBIO_PLUGIN_DIR_TRUSTED", "1")
    acknowledged = discover()
    assert acknowledged.errors == []
    assert "sequence-stats.validate" in acknowledged.tools


def test_fabricated_verified_reference_is_unavailable(tmp_path):
    manifest = _one_tool_manifest()
    manifest["tools"][0]["references"][0]["verified"] = True
    manifest["tools"][0]["references"][0]["key"] = "fabricated_claim"
    manifest["tools"][0]["references"][0]["title"] = "Fabricated paper"
    manifest["tools"][0]["references"][0]["url"] = "https://example.invalid/fake"
    manifest["tools"][0]["references"][0].pop("verified_by", None)
    _write(tmp_path, manifest)
    result = discover(tmp_path)
    record = result.tools["sequence-stats.validate"]
    assert record.available is False
    assert record.adapter is None
    assert any("reference_verification_unknown:fabricated_claim" in error for error in result.errors)


def test_available_adapter_must_declare_required_artifacts(monkeypatch):
    import check_plugins

    class NoSeamPlugin:
        TOOL_ID = "synthetic.noseam"
        VERSION = "1.0.0"

        def run(self, step, inputs, context):
            return {"artifacts": [], "tool_run_meta": {"status": "succeeded"}}

    assert declares_required_artifacts(NoSeamPlugin()) is False
    assert declares_required_artifacts(get_plugin("sequence-stats.profile")) is True
    record = DiscoveredTool(
        id="synthetic.noseam",
        manifest_path="synthetic.json",
        manifest_name="synthetic",
        domain="synthetic",
        version="1.0.0",
        entrypoint="synthetic:NoSeamPlugin",
        adapter=NoSeamPlugin(),
        available=True,
        unavailable_reason=None,
        declared_available=True,
        requirements=[],
        tool={
            "id": "synthetic.noseam",
            "description": "synthetic",
            "references": [
                {
                    "key": "iupac_1984_ambiguity",
                    "title": "Nomenclature for incompletely specified bases in nucleic acid sequences: recommendations 1984",
                    "url": "https://doi.org/10.1093/nar/13.9.3021",
                    "verified": True,
                }
            ],
            "limitations": ["synthetic"],
        },
    )
    monkeypatch.setattr(check_plugins, "discover", lambda: DiscoveryResult(tools={record.id: record}))
    errors: list[str] = []
    check_plugins._check_discovered(errors)
    assert any("required_artifacts" in error for error in errors)


def test_step_flags_follow_egress_not_denied_consent():
    denied_without_egress = _step_from_job(
        {"tool_id": "sequence-stats.profile", "consent": {"granted": False}}
    )
    assert denied_without_egress["external_egress"] is False
    assert denied_without_egress["consent_required"] is False
    egress_job = {
        "tool_id": "external.tool",
        "external_egress": True,
        "consent": {"granted": False},
    }
    egress_step = _step_from_job(egress_job)
    assert egress_step["external_egress"] is True
    assert egress_step["consent_required"] is True


# --- generic evidence seams --------------------------------------------------


def test_generic_evidence_hints_produce_grounded_findings():
    artifacts = [_json_artifact("tree_summary.json", {"summary": {"taxa_count": 7}})]
    hints = [
        {
            "text_template": "The tree contains {value} taxa.",
            "artifact": "tree_summary.json",
            "field_path": "summary.taxa_count",
        }
    ]
    explanation = build_explanation(
        {"tool_id": "synthetic.tree"}, artifacts, {"status": "pass"}, evidence_hints=hints
    )
    assert len(explanation["findings"]) == 1
    assert "7 taxa" in explanation["findings"][0]["text"]
    assert check_explanation(explanation, artifacts)["ok"] is True


def test_fabricated_number_in_hint_is_rejected():
    artifacts = [_json_artifact("tree_summary.json", {"summary": {"taxa_count": 7}})]
    hints = [
        {
            "text_template": "The tree contains 99.99 taxa.",
            "artifact": "tree_summary.json",
            "field_path": "summary.taxa_count",
        }
    ]
    explanation = build_explanation(
        {"tool_id": "synthetic.tree"}, artifacts, {"status": "pass"}, evidence_hints=hints
    )
    result = check_explanation(explanation, artifacts)
    assert result["ok"] is False
    assert any(error.startswith("unsupported_number:finding[") for error in result["errors"])


def test_plugin_declared_required_artifacts_are_enforced():
    artifacts = [_json_artifact("tree_summary.json", {"summary": {"taxa_count": 7}})]
    meta = {"required_artifacts": ["tree_summary.json", "missing.json"]}
    result = validate({"tool_id": "synthetic.tree"}, artifacts, meta)
    assert result["status"] == "fail"
    assert result["flags"].count("missing_artifact:missing.json") == 1
    assert "missing_artifact:tree_summary.json" not in result["flags"]


def test_required_artifacts_union_with_legacy_entries_without_duplicates():
    step = {"tool_id": "sequence-stats.profile"}
    result = validate(step, [], {"required_artifacts": ["validation.json"]})
    assert result["status"] == "fail"
    assert result["flags"].count("missing_artifact:validation.json") == 1
    result = validate(step, [], {"required_artifacts": ["extra.json"]})
    assert result["flags"].count("missing_artifact:validation.json") == 1
    assert result["flags"].count("missing_artifact:extra.json") == 1


def test_agent_wires_hints_and_required_artifacts_from_plugin_meta(monkeypatch):
    class SyntheticPlugin:
        TOOL_ID = "synthetic.tree"
        VERSION = "1.0.0"

        def run(self, step, inputs, context):
            return {
                "artifacts": [
                    _json_artifact("tree_summary.json", {"summary": {"taxa_count": 7}})
                ],
                "tool_run_meta": {
                    "status": "succeeded",
                    "required_artifacts": ["tree_summary.json"],
                    "evidence_hints": [
                        {
                            "text_template": "The tree contains {value} taxa.",
                            "artifact": "tree_summary.json",
                            "field_path": "summary.taxa_count",
                        }
                    ],
                },
            }

    monkeypatch.setattr(
        agent_module,
        "get_plugin",
        lambda tool_id: SyntheticPlugin() if tool_id == "synthetic.tree" else None,
    )
    result = process_job({"id": "job_test", "tool_id": "synthetic.tree", "inputs": {}})
    assert result["status"] == "succeeded"
    assert result["validation"]["status"] == "pass"
    assert any("7 taxa" in item["text"] for item in result["explanation"]["findings"])
