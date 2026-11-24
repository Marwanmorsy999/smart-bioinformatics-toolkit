"""Known-answer tests for the real, local phylogenetics plugin.

All inputs come from shared/test-cases/phylo_reference.fasta: six 120 bp DNA
sequences derived from one ancestor, with a clear A1/A2/A3 vs B1/B2/B3 split.
The expected numbers below are derived from that design and verified against
Biopython 1.88; nothing in these tests accepts fabricated results.
"""

from __future__ import annotations

import copy
import hashlib
import inspect
import json
import sys
import tempfile
from io import StringIO
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
SRC = ROOT / "python-engine" / "src"
if str(SRC) not in sys.path:
    sys.path.insert(0, str(SRC))

import Bio
from Bio import AlignIO, Phylo
from Bio.Phylo.TreeConstruction import DistanceCalculator, DistanceTreeConstructor

from smartbio.aiagent.agent import process_job
from smartbio.aiagent.explanation import build_explanation, check_explanation
from smartbio.aiagent.validation import validate
from smartbio.plugins.phylogenetics import (
    PhylogeneticsAlignPlugin,
    PhylogeneticsReportPlugin,
    PhylogeneticsTreePlugin,
    PhylogeneticsValidatePlugin,
    PhylogeneticsWorkflowPlugin,
)

REFERENCE = ROOT / "shared" / "test-cases" / "phylo_reference.fasta"
MANIFEST = ROOT / "shared" / "plugins" / "phylogenetics.json"
FASTA_TEXT = REFERENCE.read_text(encoding="utf-8")

EXPECTED_IDS = {"A1", "A2", "A3", "B1", "B2", "B3"}
EXPECTED_WIDTH = 120
EXPECTED_CONSERVED = 92
CLADE_A = {"A1", "A2", "A3"}
CLADE_B = {"B1", "B2", "B3"}
EXPECTED_INPUT_SHA256 = hashlib.sha256(FASTA_TEXT.encode("utf-8")).hexdigest()

# Byte hashes recorded for Biopython 1.88; other versions may serialize guide
# trees slightly differently, so exact values are asserted only on 1.88.
EXPECTED_HASHES = {
    "phylogenetics.validate": {
        "phylo_validation.json": "56860869a380bb23b7108ec29eea3adfdc17c82a3c9284bad0670fe51f46045c",
    },
    "phylogenetics.align": {
        "alignment.fasta": "831d8b5b0c80d0569bdd312891149cd417336257244ba365462b0ca1a9322bf5",
        "alignment_summary.json": "b668601b52ffaf07583aea35ace1b3580f215893bdf2f644ea241f678b2bd7b7",
    },
    "phylogenetics.tree": {
        "tree.nwk": "5e9d782db4876bbfceb898cd1e85a50279022b1d643a0dadffb74ed6cec1fadf",
        "tree.svg": "add6de6280262906497cf433f52d2b90e187fa3710f0a13a5e70dd1b03abcc21",
        "tree_stats.json": "135e0e8a9d4e46634ddf4b9d04feb236d4ba47d39ea2e652978338ebd379496a",
    },
    "phylogenetics.report": {
        "phylo_report.json": "555d7dee01f455bdada8a2126e8cc45d9a3df060384814cda017559b343cffbe",
        "phylo_report.html": "f6e089399ea58eb4be0dfce2f91e50c7ac4e073962bdf9740add08fd98f78249",
    },
}
# The composite must return exactly the same bytes as the four individual tools.
EXPECTED_HASHES["phylogenetics.workflow"] = {
    name: digest
    for tool_hashes in EXPECTED_HASHES.values()
    for name, digest in tool_hashes.items()
}

PLUGINS = (
    PhylogeneticsValidatePlugin,
    PhylogeneticsAlignPlugin,
    PhylogeneticsTreePlugin,
    PhylogeneticsReportPlugin,
)
ALL_PLUGINS = PLUGINS + (PhylogeneticsWorkflowPlugin,)


def run_plugin(plugin_cls, inputs=None, params=None):
    """Run one adapter in a fresh workspace and return its real result."""
    payload = {
        "fasta_text": FASTA_TEXT,
        "filename": "phylo_reference.fasta",
        "dataset_id": "ds_phylo_known_answer",
    }
    if inputs is not None:
        payload = inputs
    step = {"tool_id": plugin_cls.TOOL_ID, "params": params or {}}
    with tempfile.TemporaryDirectory(prefix="phylo-test-") as workspace:
        return plugin_cls().run(step, payload, {"workspace": workspace, "config": {}})


def artifacts_by_name(result):
    return {artifact["name"]: artifact for artifact in result["artifacts"]}


def document(result, name):
    return json.loads(artifacts_by_name(result)[name]["content"])


def hashes(result):
    return {
        artifact["name"]: hashlib.sha256(artifact["content"].encode("utf-8")).hexdigest()
        for artifact in result["artifacts"]
    }


def resolve(document_value, field_path):
    current = document_value
    for part in field_path.split("."):
        assert isinstance(current, dict) and part in current
        current = current[part]
    return current


def emulated_explanation(tool_run_meta, artifacts):
    """Resolve the documented evidence_hints seam against real artifacts."""
    documents = {
        artifact["name"]: json.loads(artifact["content"])
        for artifact in artifacts
        if artifact["name"].endswith(".json")
    }
    findings = []
    for hint in tool_run_meta["evidence_hints"]:
        value = resolve(documents[hint["artifact"]], hint["field_path"])
        findings.append(
            {
                "text": hint["text"].replace("{value}", str(value)),
                "artifact": hint["artifact"],
                "field_path": hint["field_path"],
            }
        )
    return {
        "summary": "The values below are copied from validated artifacts.",
        "findings": findings,
        "limitations": [],
        "references": [],
        "uncertainty": "low",
    }


def explanation_for(plugin_cls, result):
    """Use the framework seam when available, otherwise mirror its contract."""
    step = {"tool_id": plugin_cls.TOOL_ID}
    signature = inspect.signature(build_explanation)
    if "evidence_hints" in signature.parameters:
        explanation = build_explanation(
            step,
            result["artifacts"],
            {"status": "pass"},
            evidence_hints=result["tool_run_meta"]["evidence_hints"],
        )
    else:
        explanation = emulated_explanation(
            result["tool_run_meta"], result["artifacts"]
        )
    return explanation


# --- Known answers ---------------------------------------------------------


def test_validate_known_answer():
    result = run_plugin(PhylogeneticsValidatePlugin)
    assert result["tool_run_meta"]["status"] == "succeeded"
    validation = document(result, "phylo_validation.json")
    assert validation["sequence_count"] == 6
    assert validation["min_length_bp"] == EXPECTED_WIDTH
    assert validation["max_length_bp"] == EXPECTED_WIDTH
    assert validation["input_sha256"] == EXPECTED_INPUT_SHA256
    assert validation["fasta_validation"]["file_valid"] is True
    assert validation["fasta_validation"]["valid_records"] == 6


def test_align_known_answer_width_and_conservation():
    result = run_plugin(PhylogeneticsAlignPlugin)
    assert result["tool_run_meta"]["status"] == "succeeded"
    msa = AlignIO.read(
        StringIO(artifacts_by_name(result)["alignment.fasta"]["content"]),
        "fasta",
    )
    assert len(msa) == 6
    assert {record.id for record in msa} == EXPECTED_IDS
    lengths = {len(record.seq) for record in msa}
    assert lengths == {EXPECTED_WIDTH}
    columns = list(zip(*(str(record.seq) for record in msa)))
    conserved = sum(1 for column in columns if len(set(column)) == 1 and column[0] != "-")
    assert conserved == EXPECTED_CONSERVED
    summary = document(result, "alignment_summary.json")
    assert summary["alignment_columns"] == EXPECTED_WIDTH
    assert summary["conserved_sites"] == EXPECTED_CONSERVED
    assert summary["gap_count"] == 0
    assert summary["sequence_count"] == 6


def test_tree_known_answer_tips_branches_and_bipartitions():
    result = run_plugin(PhylogeneticsTreePlugin)
    assert result["tool_run_meta"]["status"] == "succeeded"
    tree = Phylo.read(
        StringIO(artifacts_by_name(result)["tree.nwk"]["content"]),
        "newick",
    )
    tips = [clade.name for clade in tree.get_terminals()]
    assert len(tips) == 6
    assert set(tips) == EXPECTED_IDS
    branches = [clade.branch_length for clade in tree.find_clades()]
    assert all(branch is None or branch >= 0 for branch in branches)
    clades = [
        {leaf.name for leaf in clade.get_terminals()}
        for clade in tree.get_nonterminals()
    ]
    recovered = [tips for tips in clades if tips == CLADE_A or tips == CLADE_B]
    assert recovered
    for tips in recovered:
        assert EXPECTED_IDS - tips == (CLADE_B if tips == CLADE_A else CLADE_A)
    stats = document(result, "tree_stats.json")
    assert stats["tip_count"] == 6
    assert set(stats["tip_names"]) == EXPECTED_IDS
    assert stats["newick_length"] == len(
        artifacts_by_name(result)["tree.nwk"]["content"].strip()
    )
    assert statistics_svg_ok(artifacts_by_name(result)["tree.svg"]["content"])


def statistics_svg_ok(svg: str) -> bool:
    return svg.startswith("<svg") and svg.rstrip().endswith("</svg>") and "A1" in svg


def test_tree_matches_direct_biopython_computation():
    """Independently recompute NJ from the emitted alignment inside the test."""
    tree_result = run_plugin(PhylogeneticsTreePlugin)
    align_result = run_plugin(PhylogeneticsAlignPlugin)
    alignment_text = artifacts_by_name(align_result)["alignment.fasta"]["content"]
    msa = AlignIO.read(StringIO(alignment_text), "fasta")
    calculator = DistanceCalculator("identity")
    compute = getattr(calculator, "get_distance", None) or calculator.compute_distances
    dm = compute(msa)
    expected_tree = DistanceTreeConstructor().nj(dm)
    handle = StringIO()
    Phylo.write(expected_tree, handle, "newick")
    expected_newick = handle.getvalue().strip()
    actual_newick = artifacts_by_name(tree_result)["tree.nwk"]["content"].strip()
    assert actual_newick == expected_newick
    expected_tips = {clade.name for clade in expected_tree.get_terminals()}
    assert expected_tips == EXPECTED_IDS
    expected_branches = [
        clade.branch_length if clade.branch_length is not None else 0.0
        for clade in expected_tree.find_clades()
    ]
    stats = document(tree_result, "tree_stats.json")
    assert stats["distance_matrix_lower_triangle"] == [
        [float(dm[i, j]) for j in range(i + 1)] for i in range(len(dm.names))
    ]
    assert stats["total_branch_length"] == round(sum(expected_branches), 10)


def test_artifact_hashes_are_byte_identical_on_repeat_runs():
    for plugin_cls in ALL_PLUGINS:
        first = hashes(run_plugin(plugin_cls))
        second = hashes(run_plugin(plugin_cls))
        assert first == second
        if Bio.__version__ == "1.88":
            assert first == EXPECTED_HASHES[plugin_cls.TOOL_ID]


# --- Fail closed -----------------------------------------------------------


def _records_fasta(records):
    return "\n".join(
        f">{record['id']}\n{record['sequence']}" for record in records
    ) + "\n"


def invalid_inputs():
    # Re-read the real FASTA with the project parser for the mutation cases.
    from smartbio.fasta import parse_fasta_text

    records = parse_fasta_text(FASTA_TEXT)["records"]
    assert len(records) == 6
    two = [{"id": r["id"], "sequence": r["sequence"]} for r in records[:2]]
    short = [
        {"id": r["id"], "sequence": r["sequence"][:40]} for r in records[:3]
    ]
    protein = [
        {"id": r["id"], "sequence": "Z" * 60} for r in records[:3]
    ]
    empty = [
        {"id": "A1", "sequence": ""},
        *({"id": r["id"], "sequence": r["sequence"]} for r in records[:3]),
    ]
    duplicate = [
        {"id": "A1", "sequence": records[0]["sequence"]},
        {"id": "A1", "sequence": records[1]["sequence"]},
        {"id": "A3", "sequence": records[2]["sequence"]},
    ]
    return {
        "fewer_than_three": _records_fasta(two),
        "too_short": _records_fasta(short),
        "wrong_alphabet": _records_fasta(protein),
        "empty_record": _records_fasta(empty),
        "duplicate_ids": _records_fasta(duplicate),
    }


INVALID_CASES = None


@pytest.mark.parametrize("case", ["fewer_than_three", "wrong_alphabet", "empty_record"])
@pytest.mark.parametrize("plugin_cls", PLUGINS)
def test_invalid_inputs_fail_closed(plugin_cls, case):
    global INVALID_CASES
    if INVALID_CASES is None:
        INVALID_CASES = invalid_inputs()
    inputs = {
        "fasta_text": INVALID_CASES[case],
        "filename": "invalid.fasta",
        "dataset_id": "ds_invalid",
    }
    result = run_plugin(plugin_cls, inputs=inputs)
    meta = result["tool_run_meta"]
    assert meta["status"] == "failed"
    assert meta["reason"]
    assert result["artifacts"] == []
    assert meta["execution_mode"] == "real"


def test_additional_invalid_cases():
    cases = invalid_inputs()
    assert len(cases) == 5
    for key in ("too_short", "duplicate_ids"):
        inputs = {"fasta_text": cases[key], "filename": "invalid.fasta"}
        result = run_plugin(PhylogeneticsValidatePlugin, inputs=inputs)
        assert result["tool_run_meta"]["status"] == "failed"
        assert result["artifacts"] == []


# --- Provenance, manifest and framework seams ------------------------------


def test_workflow_reuses_the_four_adapters_and_combines_metadata():
    result = run_plugin(PhylogeneticsWorkflowPlugin, params={"sequence_type": "dna"})
    meta = result["tool_run_meta"]
    assert meta["status"] == "succeeded"
    assert meta["tool_id"] == "phylogenetics.workflow"
    expected_order = [
        "phylo_validation.json",
        "alignment.fasta",
        "alignment_summary.json",
        "tree.nwk",
        "tree.svg",
        "tree_stats.json",
        "phylo_report.json",
        "phylo_report.html",
    ]
    assert [artifact["name"] for artifact in result["artifacts"]] == expected_order
    assert meta["required_artifacts"] == expected_order
    assert len(meta["evidence_hints"]) == 11
    assert meta["parameters"]["sequence_type"] == "dna"
    assert meta["parameters"]["pipeline"] == [plugin.TOOL_ID for plugin in PLUGINS]
    assert meta["limitations"]

    combined = artifacts_by_name(result)
    for plugin_cls in PLUGINS:
        for artifact in run_plugin(plugin_cls)["artifacts"]:
            assert combined[artifact["name"]]["content"] == artifact["content"]
    if Bio.__version__ == "1.88":
        assert hashes(result) == EXPECTED_HASHES["phylogenetics.workflow"]


def test_workflow_invalid_fasta_fails_closed():
    cases = invalid_inputs()
    inputs = {
        "fasta_text": cases["fewer_than_three"],
        "filename": "invalid.fasta",
        "dataset_id": "ds_invalid",
    }
    result = run_plugin(PhylogeneticsWorkflowPlugin, inputs=inputs)
    meta = result["tool_run_meta"]
    assert meta["status"] == "failed"
    assert "Sub-step phylogenetics.validate failed" in meta["reason"]
    assert meta["details"]["failed_step"] == "phylogenetics.validate"
    assert result["artifacts"] == []


def test_workflow_process_job_end_to_end_with_all_artifacts():
    job = {
        "id": "job_phylo_workflow",
        "step_id": "step_1",
        "tool_id": "phylogenetics.workflow",
        "params": {"sequence_type": "dna"},
        "inputs": {
            "dataset_id": "ds_phylo_known_answer",
            "fasta_text": FASTA_TEXT,
            "filename": "phylo_reference.fasta",
        },
        "backend": "local-python",
    }
    result = process_job(job)
    assert result["status"] == "succeeded"
    assert result["validation"]["status"] == "pass"
    assert len(result["explanation"]["findings"]) >= 2
    assert check_explanation(result["explanation"], result["artifacts"])["ok"] is True
    by_name = artifacts_by_name(result)
    for name in EXPECTED_HASHES["phylogenetics.workflow"]:
        assert by_name[name]["sha256"] == EXPECTED_HASHES["phylogenetics.workflow"][name]
    assert "report.html" in by_name
    if Bio.__version__ == "1.88":
        assert hashlib.sha256(
            by_name["phylo_report.json"]["content"].encode("utf-8")
        ).hexdigest() == EXPECTED_HASHES["phylogenetics.workflow"]["phylo_report.json"]


def test_report_bundles_real_hashes_and_versions():
    result = run_plugin(PhylogeneticsReportPlugin)
    report = document(result, "phylo_report.json")
    assert report["execution_mode"] == "real"
    assert report["input_sha256"] == EXPECTED_INPUT_SHA256
    assert report["tool_versions"]["biopython"] == Bio.__version__
    assert report["tool_versions"]["phylogenetics_adapter"] == "1.0.0"
    assert report["artifact_count"] == len(report["artifact_hashes"])
    for plugin_cls in (PhylogeneticsValidatePlugin, PhylogeneticsAlignPlugin, PhylogeneticsTreePlugin):
        upstream = hashes(run_plugin(plugin_cls))
        for name, digest in upstream.items():
            assert report["artifact_hashes"][name] == digest
    assert len(report["references"]) == 3
    assert all(reference["verified"] is True for reference in report["references"])
    assert report["limitations"]
    html = artifacts_by_name(result)["phylo_report.html"]["content"]
    assert EXPECTED_INPUT_SHA256 in html
    assert "execution mode: real" in html


def test_manifest_references_limitations_and_tool_ids():
    manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))
    assert manifest["name"] == "phylogenetics"
    assert manifest["domain"] == "phylogenetics"
    assert manifest["backend"] == "local-python"
    assert manifest["entrypoint"].startswith("smartbio.plugins.phylogenetics:")
    ids = [tool["id"] for tool in manifest["tools"]]
    assert ids == [plugin.TOOL_ID for plugin in ALL_PLUGINS]
    for tool in manifest["tools"]:
        assert tool["available"] is True
        assert tool["external_egress"] is False
        assert "python-package:biopython" in tool["requirements"]
        assert tool["limitations"]
        assert tool["references"]
        for reference in tool["references"]:
            assert set(reference) >= {"key", "title", "url", "verified"}
            assert reference["verified"] is True
            assert reference["url"].startswith("https://")
        assert tool["params_schema"]["type"] == "object"


@pytest.mark.parametrize("plugin_cls", ALL_PLUGINS)
def test_evidence_hints_produce_grounded_explanation(plugin_cls):
    result = run_plugin(plugin_cls)
    meta = result["tool_run_meta"]
    hints = meta["evidence_hints"]
    assert len(hints) >= 2
    for hint in hints:
        assert {"text", "artifact", "field_path"} <= set(hint)
        assert "{value}" in hint["text"]
        assert hint["artifact"] in artifacts_by_name(result)
        assert hint["field_path"]
    explanation = explanation_for(plugin_cls, result)
    assert len(explanation["findings"]) >= 2
    checked = check_explanation(explanation, result["artifacts"])
    assert checked["ok"] is True, checked["errors"]


@pytest.mark.parametrize("plugin_cls", ALL_PLUGINS)
def test_agent_end_to_end_grounded_explanation(plugin_cls):
    """The control plane resolves the hints without any tool-specific code."""
    job = {
        "id": "job_phylo_test",
        "step_id": "step_1",
        "tool_id": plugin_cls.TOOL_ID,
        "params": {},
        "inputs": {
            "dataset_id": "ds_phylo_known_answer",
            "fasta_text": FASTA_TEXT,
            "filename": "phylo_reference.fasta",
        },
        "backend": "local-python",
    }
    result = process_job(job)
    assert result["status"] == "succeeded"
    assert result["validation"]["status"] == "pass"
    assert len(result["explanation"]["findings"]) >= 2
    assert check_explanation(result["explanation"], result["artifacts"])["ok"] is True
    assert any(artifact["name"] == "report.html" for artifact in result["artifacts"])


@pytest.mark.parametrize("plugin_cls", ALL_PLUGINS)
def test_required_artifacts_cannot_silently_disappear(plugin_cls):
    result = run_plugin(plugin_cls)
    required = result["tool_run_meta"]["required_artifacts"]
    present = set(artifacts_by_name(result))
    assert required
    assert set(required) == present
    step = {"tool_id": plugin_cls.TOOL_ID}
    # The agent adds sha256 hashes to the artifact envelope before validation;
    # reproduce that envelope here so tampering is detectable.
    envelope = [
        {**artifact, "sha256": hashlib.sha256(artifact["content"].encode("utf-8")).hexdigest()}
        for artifact in result["artifacts"]
    ]

    removed = [a for a in envelope if a["name"] != required[0]]
    missing_check = validate(step, removed, result["tool_run_meta"])
    assert missing_check["status"] == "fail"
    assert f"missing_artifact:{required[0]}" in missing_check["flags"]

    tampered = copy.deepcopy(envelope)
    target = next(a for a in tampered if a["name"] == required[0])
    target["content"] = target["content"] + "\n"
    tamper_check = validate(step, tampered, result["tool_run_meta"])
    assert tamper_check["status"] == "fail"
    assert any(flag.startswith("sha256_mismatch:") for flag in tamper_check["flags"])
