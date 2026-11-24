"""FR-8.5 locality receipts and FR-8.6 education notes."""

import json
from pathlib import Path
import sys

ENGINE_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ENGINE_ROOT / "src"))
ROOT = Path(__file__).resolve().parents[2]

from smartbio.aiagent import agent
from smartbio.aiagent.education import build_education

FASTA_PATH = ROOT / "shared" / "test-cases" / "dna_valid.fasta"
FASTA_TEXT = FASTA_PATH.read_text(encoding="utf-8")


def _profile_job():
    return {
        "id": "job_locality",
        "plan_id": "plan_locality",
        "step_id": "step_1",
        "status": "queued",
        "tool_id": "sequence-stats.profile",
        "params": {"sequence_type": "dna"},
        "inputs": {
            "dataset_id": "ds_locality",
            "fasta_text": FASTA_TEXT,
            "filename": FASTA_PATH.name,
        },
        "consent": {"granted": False, "scope": None},
        "backend": "local-python",
    }


def test_no_egress_job_has_empty_external_transmissions():
    result = agent.process_job(_profile_job())
    receipt = result["locality_receipt"]
    assert receipt["external_transmissions"] == []
    assert receipt["no_external_egress"] is True
    assert receipt["mode"] == "real"
    assert any(
        op["name"] == "sequence-stats.profile" and op["backend"] == "local-python"
        for op in receipt["local_operations"]
    )
    # Backward-compatible: the receipt is also inside provenance.
    assert result["provenance"]["locality_receipt"] == receipt
    report = next(a for a in result["artifacts"] if a["name"] == "report.html")["content"]
    assert "Data locality" in report
    assert "Education notes" in report


def test_simulated_egress_records_destination_bytes_and_consent():
    job = _profile_job()
    secret = "consent_0123456789abcdef0123456789abcdef"
    job["external_egress"] = True
    job["consent"] = {"granted": True, "scope": "external-blast", "id": "appr_abc123"}
    job["external_transmission"] = {
        "destination": "https://blast.ncbi.nlm.nih.gov/Blast.cgi",
        "consent_token": secret,
        "timestamp": "2026-11-25T10:00:00+00:00",
    }
    result = agent.process_job(job)
    receipt = result["locality_receipt"]
    assert receipt["no_external_egress"] is False
    assert len(receipt["external_transmissions"]) == 1
    transmission = receipt["external_transmissions"][0]
    assert transmission["destination"] == "https://blast.ncbi.nlm.nih.gov/Blast.cgi"
    assert transmission["bytes_sent"] == len(FASTA_TEXT.encode("utf-8"))
    assert (
        transmission["input_sha256"]
        == __import__("hashlib").sha256(FASTA_TEXT.encode("utf-8")).hexdigest()
    )
    assert transmission["timestamp"] == "2026-11-25T10:00:00+00:00"
    assert transmission["consent"].startswith("token-ref:")
    assert "appr_abc123" in receipt["consent_records"]
    assert "external-blast" in receipt["consent_records"]
    # No bearer secret is echoed anywhere in the result or the HTML report.
    assert secret not in json.dumps(result)
    report = next(a for a in result["artifacts"] if a["name"] == "report.html")["content"]
    assert "https://blast.ncbi.nlm.nih.gov/Blast.cgi" in report
    assert secret not in report


def test_mock_mode_is_labelled_in_receipt(monkeypatch):
    monkeypatch.setenv("AI_EXECUTION_MODE", "mock")
    result = agent.process_job(_profile_job())
    assert result["locality_receipt"]["mode"] == "mock"
    assert result["provenance"]["locality_receipt"]["mode"] == "mock"
    assert result["locality_receipt"]["no_external_egress"] is True


def test_gc_caution_names_threshold_and_verified_reference():
    education = build_education(
        {"tool_id": "sequence-stats.profile"},
        [],
        {"status": "fail", "flags": ["gc_percent_out_of_range:seq1"]},
    )
    notes = education["notes"]
    assert notes, "a GC caution must produce an education note"
    note = notes[0]
    assert set(note) == {
        "rule_or_threshold",
        "why_insufficient",
        "what_would_help",
        "verified_reference",
    }
    assert "0 <= GC% <= 100" in note["rule_or_threshold"]
    assert note["verified_reference"] == "smartbio_gc_definition"


def test_insufficient_evidence_keeps_null_reference_and_abstention():
    taxonomy = {
        "per_query": {
            "q1": {
                "verdict": {
                    "status": "insufficient_evidence",
                    "reasons": ["The top hit covers only 61% of the query (minimum 80%)."],
                    "caution_flags": ["near_threshold"],
                }
            }
        },
        "no_hit_queries": {},
        "summary": {},
    }
    artifact = [
        {
            "name": "taxonomy_analysis.json",
            "kind": "json",
            "content": json.dumps(taxonomy),
        }
    ]
    education = build_education(
        {"tool_id": "microbiome-16s.taxonomy"},
        artifact,
        {"status": "warn", "flags": []},
    )
    notes = {note["rule_or_threshold"]: note for note in education["notes"]}
    near = next(note for note in notes.values() if "98.65%" in note["rule_or_threshold"])
    assert "0.35" in near["rule_or_threshold"]
    assert near["verified_reference"] is None  # curated 16S reference is unverified
    abstention = next(
        note
        for note in notes.values()
        if "coverage >=" in note["rule_or_threshold"]
    )
    assert abstention["verified_reference"] is None
    assert "abstains" in abstention["why_insufficient"]
    assert "not converted" in abstention["why_insufficient"]
    assert "80%" in abstention["rule_or_threshold"]
    # No note promotes the abstention to a species identification.
    assert all("species_supported" not in note["why_insufficient"] for note in notes.values())


def test_education_is_wired_into_every_process_job_result():
    result = agent.process_job(_profile_job())
    assert "education" in result
    assert result["education"] == result["explanation"]["education"]
    assert isinstance(result["education"]["notes"], list)
