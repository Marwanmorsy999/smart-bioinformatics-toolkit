import json
import os
from pathlib import Path
import subprocess
import sys

ENGINE_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ENGINE_ROOT / "src"))
ROOT = Path(__file__).resolve().parents[2]

from smartbio.aiagent import agent
from smartbio.aiagent.explanation import check_explanation
from smartbio.aiagent.plugins import get_plugin

FASTA_PATH = ROOT / "shared" / "test-cases" / "dna_valid.fasta"


def _profile_job():
    return {
        "id": "job_e2e",
        "plan_id": "plan_e2e",
        "step_id": "step_1",
        "status": "queued",
        "tool_id": "sequence-stats.profile",
        "params": {"sequence_type": "dna"},
        "inputs": {
            "dataset_id": "ds_e2e",
            "fasta_text": FASTA_PATH.read_text(encoding="utf-8"),
            "filename": FASTA_PATH.name,
        },
        "consent": {"granted": False, "scope": None},
        "backend": "local-python",
        "created_at": "2026-11-24T00:00:00Z",
    }


def _artifact(result, name):
    return next(item for item in result["artifacts"] if item["name"] == name)


def test_end_to_end_profile_job_uses_real_numbers(tmp_path):
    result = agent.process_job(_profile_job())
    assert result["job_id"] == "job_e2e"
    assert result["status"] == "succeeded"
    assert result["execution_mode"] == "real"
    assert result["validation"]["status"] == "pass"

    statistics = json.loads(_artifact(result, "statistics.json")["content"])
    assert statistics["summary"]["total_records"] == 3
    assert statistics["summary"]["gc_percent_mean"] == 50.0
    assert statistics["summary"]["total_length"] == 59

    explanation = result["explanation"]
    check = check_explanation(explanation, result["artifacts"])
    assert check["ok"], check["errors"]
    assert any("50.0" in finding["text"] for finding in explanation["findings"])

    report_html = _artifact(result, "report.html")["content"]
    assert "Provenance" in report_html
    assert result["provenance"]["run_id"] in report_html
    assert result["provenance"]["tool"]["version"] in report_html
    assert "<h2>Reproducibility</h2>" in report_html

    fabricated = dict(explanation)
    fabricated["findings"] = list(explanation["findings"]) + [
        {
            "text": "GC content is 87.5 percent.",
            "artifact": "statistics.json",
            "field_path": "summary.gc_percent_mean",
        }
    ]
    assert check_explanation(fabricated, result["artifacts"])["ok"] is False


def test_offline_cli_writes_result_file(tmp_path):
    job_path = tmp_path / "job.json"
    out_path = tmp_path / "result.json"
    job_path.write_text(json.dumps(_profile_job()), encoding="utf-8")
    env = os.environ.copy()
    env["PYTHONPATH"] = str(ENGINE_ROOT / "src") + os.pathsep + env.get("PYTHONPATH", "")
    completed = subprocess.run(
        [
            sys.executable,
            "-m",
            "smartbio.aiagent.agent",
            "--job-file",
            str(job_path),
            "--out-file",
            str(out_path),
        ],
        cwd=str(ENGINE_ROOT),
        env=env,
        capture_output=True,
        text=True,
    )
    assert completed.returncode == 0, completed.stderr
    result = json.loads(out_path.read_text(encoding="utf-8"))
    assert result["status"] == "succeeded"
    assert result["execution_mode"] == "real"
    assert result["validation"]["status"] == "pass"


def test_poll_and_run_posts_result_once(monkeypatch, tmp_path):
    job = _profile_job()
    calls = []

    class FakeResponse:
        def __init__(self, payload):
            self._payload = json.dumps(payload).encode("utf-8")

        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, tb):
            return False

        def read(self):
            return self._payload

    def fake_urlopen(request, timeout=None):
        calls.append(request)
        return FakeResponse({"jobs": [job]} if request.full_url.endswith("/api/ai/jobs") else {})

    monkeypatch.setattr(agent.urllib.request, "urlopen", fake_urlopen)
    results = agent.poll_and_run("http://worker.test/", "agent-token", once=True)

    assert len(results) == 1
    assert results[0]["job_id"] == job["id"]
    assert results[0]["status"] == "succeeded"
    assert calls[0].full_url == "http://worker.test/api/ai/jobs"
    assert any(
        key.lower() == "x-agent-token" and value == "agent-token"
        for key, value in calls[0].headers.items()
    )
    assert calls[1].full_url == f"http://worker.test/api/ai/jobs/{job['id']}/result"
    posted = json.loads(calls[1].data.decode("utf-8"))
    assert posted["execution_mode"] == "real"


def test_oversized_input_is_rejected():
    job = _profile_job()
    job["inputs"]["fasta_text"] = ">" + "A" * (65 * 1024)
    result = agent.process_job(job)
    assert result["status"] == "failed"
    assert any("exceeds" in flag for flag in result["validation"]["flags"])


def test_unknown_tool_is_rejected():
    job = _profile_job()
    job["tool_id"] = "not-a-registered-tool"
    result = agent.process_job(job)
    assert result["status"] == "failed"
    assert result["artifacts"][0]["name"] == "report.html"


def test_registry_plugin_version_is_real():
    assert get_plugin("sequence-stats.profile").TOOL_ID == "sequence-stats.profile"


def test_provenance_covers_all_submitted_artifacts():
    result = agent.process_job(_profile_job())
    names = [artifact["name"] for artifact in result["artifacts"]]
    assert "report.html" in result["provenance"]["output"]["artifact_names"]
    assert sorted(result["provenance"]["output"]["artifact_names"]) == sorted(names)
    expected = ""
    for artifact in result["artifacts"]:
        expected += f"{artifact['name']}:{artifact['sha256']}\n"
    import hashlib

    assert result["provenance"]["output"]["sha256"] == hashlib.sha256(
        expected.encode("utf-8")
    ).hexdigest()


def test_execution_mode_mock_from_env_overrides_plugin(monkeypatch):
    monkeypatch.setenv("AI_EXECUTION_MODE", "mock")
    result = agent.process_job(_profile_job())
    assert result["execution_mode"] == "mock"
    assert result["provenance"]["execution_mode"] == "mock"
    assert all(artifact["execution_mode"] == "mock" for artifact in result["artifacts"])
    assert "mock_execution_mode" in result["validation"]["flags"]
    assert result["validation"]["status"] == "warn"


def test_validation_exception_is_contained(monkeypatch):
    def broken_validate(*args, **kwargs):
        raise TypeError("simulated malformed artifact")

    monkeypatch.setattr(agent, "validate", broken_validate)
    result = agent.process_job(_profile_job())
    assert result["status"] == "failed"
    assert result["validation"]["status"] == "fail"
    assert any(flag.startswith("validation_error:") for flag in result["validation"]["flags"])
    assert "report.html" in [artifact["name"] for artifact in result["artifacts"]]


def test_failed_blast_job_has_no_fabricated_hits():
    job = _profile_job()
    job["id"] = "job_blast_failed"
    job["tool_id"] = "microbiome-16s.blast-parse"
    job["params"] = {}
    job["inputs"] = {"dataset_id": "ds_blast"}
    result = agent.process_job(job)
    assert result["status"] == "failed"
    assert result["execution_mode"] == "real"
    assert result["validation"]["status"] != "pass"
    assert any(flag.startswith("plugin_failed:") for flag in result["validation"]["flags"])
    submitted = [artifact for artifact in result["artifacts"] if artifact["name"] != "report.html"]
    assert submitted == []
    report = _artifact(result, "report.html")["content"]
    assert "No BLAST TSV dataset" in report
    assert "species_supported" not in report  # no fabricated verdict was rendered


def test_analysis_tool_version_matches_plugin():
    result = agent.process_job(_profile_job())
    analysis = json.loads(_artifact(result, "analysis.json")["content"])
    assert analysis["tool_version"] == get_plugin("sequence-stats.profile").VERSION
