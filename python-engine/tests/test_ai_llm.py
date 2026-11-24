import hashlib
import json
from pathlib import Path
import sys

ENGINE_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ENGINE_ROOT / "src"))
ROOT = Path(__file__).resolve().parents[2]

from smartbio.aiagent import agent
from smartbio.aiagent import explanation as explanation_module
from smartbio.aiagent.explanation import (
    apply_llm_phrasing,
    build_explanation,
    check_explanation,
)
from smartbio.aiagent.llm import provider_from_env
from smartbio.aiagent.plugins import get_plugin
from smartbio.aiagent.validation import validate

FASTA_PATH = ROOT / "shared" / "test-cases" / "dna_valid.fasta"
STEP = {"id": "step_1", "tool_id": "sequence-stats.profile", "params": {"sequence_type": "dna"}}


class FakeProvider:
    name = "9Router/fake-model"

    def __init__(self, reply=None, error=None):
        self.reply = reply
        self.error = error
        self.prompts = []

    def chat(self, system, user):
        self.prompts.append((system, user))
        if self.error:
            raise self.error
        return self.reply


def _artifacts(tmp_path):
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


def _explanation(artifacts):
    return build_explanation(STEP, artifacts, validate(STEP, artifacts))


def _reply(explanation, first_finding=None, summary=None):
    texts = [finding["text"] for finding in explanation["findings"]]
    if first_finding is not None:
        texts[0] = first_finding
    return json.dumps(
        {"summary": summary if summary is not None else explanation["summary"], "findings": texts}
    )


def test_provider_from_env_requires_explicit_opt_in(monkeypatch):
    monkeypatch.delenv("AI_LLM_PROVIDER", raising=False)
    monkeypatch.delenv("NINEROUTER_API_KEY", raising=False)
    assert provider_from_env() is None
    monkeypatch.setenv("AI_LLM_PROVIDER", "ninerouter")
    assert provider_from_env() is None  # key still missing
    monkeypatch.setenv("NINEROUTER_API_KEY", "test-secret-not-logged")
    provider = provider_from_env()
    assert provider is not None
    assert "test-secret-not-logged" not in provider.name


def test_default_run_has_no_llm_metadata(tmp_path, monkeypatch):
    monkeypatch.delenv("AI_LLM_PROVIDER", raising=False)
    monkeypatch.setattr(explanation_module, "provider_from_env", lambda: None)
    result = agent.process_job(_profile_job(tmp_path))
    assert result["status"] == "succeeded"
    assert "metadata" not in result["explanation"]
    assert not any("llm_phrase" in flag for flag in result["validation"]["flags"])


def _profile_job(tmp_path):
    return {
        "id": "job_llm",
        "plan_id": "plan_llm",
        "step_id": "step_1",
        "status": "queued",
        "tool_id": "sequence-stats.profile",
        "params": {"sequence_type": "dna"},
        "inputs": {
            "dataset_id": "ds_llm",
            "fasta_text": FASTA_PATH.read_text(encoding="utf-8"),
            "filename": FASTA_PATH.name,
        },
        "consent": {"granted": False, "scope": None},
        "backend": "local-python",
        "created_at": "2026-11-24T00:00:00Z",
    }


def test_llm_fabricated_number_falls_back_to_deterministic(tmp_path, monkeypatch):
    artifacts = _artifacts(tmp_path)
    deterministic = _explanation(artifacts)
    provider = FakeProvider(
        reply=_reply(deterministic, first_finding="Validation reported 59 valid records out of 3 total records.")
    )
    monkeypatch.setattr(explanation_module, "provider_from_env", lambda: provider)
    result, flags = apply_llm_phrasing(deterministic, artifacts)
    assert flags == ["llm_phrase_rejected"]
    assert result == deterministic
    assert "metadata" not in result


def test_llm_exception_falls_back_safely(tmp_path, monkeypatch):
    artifacts = _artifacts(tmp_path)
    deterministic = _explanation(artifacts)
    provider = FakeProvider(error=TimeoutError("simulated timeout"))
    monkeypatch.setattr(explanation_module, "provider_from_env", lambda: provider)
    result, flags = apply_llm_phrasing(deterministic, artifacts)
    assert flags == ["llm_phrase_rejected"]
    assert result == deterministic


def test_accepted_llm_phrasing_sets_metadata(tmp_path, monkeypatch):
    artifacts = _artifacts(tmp_path)
    deterministic = _explanation(artifacts)
    provider = FakeProvider(
        reply=_reply(deterministic, first_finding="There were 3 valid records among 3 total records.")
    )
    monkeypatch.setattr(explanation_module, "provider_from_env", lambda: provider)
    result, flags = apply_llm_phrasing(deterministic, artifacts)
    assert flags == []
    assert result["metadata"] == {"phrasing_model": "9Router/fake-model", "llm_used": True}
    assert any("external language model" in item for item in result["limitations"])
    assert check_explanation(result, artifacts)["ok"]
    system, user = provider.prompts[0]
    assert "ATGC" not in user and "fasta_text" not in user


def test_agent_rejects_llm_fabrication_and_labels_warning(tmp_path, monkeypatch):
    artifacts = _artifacts(tmp_path)
    deterministic = _explanation(artifacts)
    provider = FakeProvider(
        reply=_reply(deterministic, first_finding="Validation reported 59 valid records out of 3 total records.")
    )
    monkeypatch.setattr(explanation_module, "provider_from_env", lambda: provider)
    result = agent.process_job(_profile_job(tmp_path))
    assert result["status"] == "succeeded"
    assert "llm_phrase_rejected" in result["validation"]["flags"]
    assert result["validation"]["status"] == "warn"
    assert "metadata" not in result["explanation"]


def test_agent_accepts_llm_phrasing_and_records_model(tmp_path, monkeypatch):
    artifacts = _artifacts(tmp_path)
    deterministic = _explanation(artifacts)
    provider = FakeProvider(
        reply=_reply(deterministic, first_finding="There were 3 valid records among 3 total records.")
    )
    monkeypatch.setattr(explanation_module, "provider_from_env", lambda: provider)
    result = agent.process_job(_profile_job(tmp_path))
    assert result["status"] == "succeeded"
    assert result["explanation"]["metadata"]["llm_used"] is True
    assert result["validation"]["status"] == "pass"
    assert "test-secret-not-logged" not in json.dumps(result)
