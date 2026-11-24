"""Local execution agent: run jobs offline or poll the Worker for jobs.

``--job-file`` / ``--out-file`` supports a fully offline end-to-end run;
``--loop`` polls ``/api/ai/jobs`` with the ``X-Agent-Token`` header and posts
results back. Only the Python standard library is used for HTTP.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import sys
import tempfile
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from smartbio.aiagent.explanation import (
    apply_llm_phrasing,
    build_explanation,
    check_explanation,
)
from smartbio.aiagent.plugins import get_plugin
from smartbio.aiagent.provenance import build_provenance
from smartbio.aiagent.report import build_report_html
from smartbio.aiagent.validation import validate
from smartbio.plugins import MAX_TEXT_BYTES, safe_filename

DEFAULT_TIMEOUT = 30
POLL_INTERVAL_SECONDS = 5
_TEXT_INPUT_KEYS = (
    "fasta_text",
    "tsv_text",
    "blast_tsv_text",
    "blast_text",
    "blast_tsv",
    "taxonomy_map_text",
)
_HTTP_ERRORS = (urllib.error.URLError, OSError, ValueError, json.JSONDecodeError)


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _execution_mode() -> str:
    """The agent owns the execution-mode label; plugins cannot override it."""
    configured = os.environ.get("AI_EXECUTION_MODE", "").strip().lower()
    return "mock" if configured == "mock" else "real"


def _step_from_job(job: dict[str, Any]) -> dict[str, Any]:
    # `consent.granted` records the decision; it is not the requirement. A
    # step requires consent because it egresses data (or because the DTO says
    # so), not because consent happened to be denied.
    consent_required = bool(
        job.get("consent_required", False) or job.get("external_egress", False)
    )
    return {
        "id": job.get("step_id"),
        "tool_id": job.get("tool_id"),
        "backend": job.get("backend") or "local-python",
        "params": dict(job.get("params") or {}),
        "external_egress": bool(job.get("external_egress", False)),
        "consent_required": consent_required,
    }


def _plan_from_job(job: dict[str, Any], step: dict[str, Any]) -> dict[str, Any]:
    plan = job.get("plan") or job.get("plan_json")
    if isinstance(plan, str):
        try:
            plan = json.loads(plan)
        except (TypeError, ValueError, json.JSONDecodeError):
            plan = None
    if not isinstance(plan, dict):
        plan = {
            "plan_id": job.get("plan_id"),
            "request_id": job.get("request_id"),
            "domain": job.get("domain", "sequence-analysis"),
            "intent": job.get("intent", "unknown"),
            "steps": [step],
            "limitations": list(job.get("limitations") or []),
        }
    return plan


def _input_hash(inputs: dict[str, Any]) -> str | None:
    for key in _TEXT_INPUT_KEYS:
        value = inputs.get(key)
        if isinstance(value, str) and value.strip():
            return hashlib.sha256(value.encode("utf-8")).hexdigest()
    return None


def _preflight_reason(inputs: dict[str, Any]) -> str | None:
    for key, value in inputs.items():
        if key.endswith("_text") and isinstance(value, str):
            size = len(value.encode("utf-8"))
            if size > MAX_TEXT_BYTES:
                return (
                    f"Input '{key}' exceeds the {MAX_TEXT_BYTES}-byte cap "
                    f"({size} bytes received)."
                )
    return None


def _sha256(content: str) -> str:
    return hashlib.sha256(content.encode("utf-8")).hexdigest()


def process_job(job: dict[str, Any]) -> dict[str, Any]:
    """Execute one contract job and return the exact contract result object."""
    started_at = _now()
    logs: list[str] = []
    step = _step_from_job(job)
    plan = _plan_from_job(job, step)
    inputs = dict(job.get("inputs") or {})
    tool_id = str(step.get("tool_id", ""))
    plugin = get_plugin(tool_id)
    execution_mode = _execution_mode()

    reason: str | None = None
    if plugin is None:
        reason = f"Unknown tool_id: {tool_id}"
    else:
        reason = _preflight_reason(inputs)

    if reason is None:
        context: dict[str, Any] = {
            "workspace": "",
            "config": dict(job.get("config") or {}),
            "execution_mode": execution_mode,
        }
        database = context["config"].get("blast_database")
        if database:
            context["database"] = database
        try:
            with tempfile.TemporaryDirectory(prefix="smartbio-aiagent-") as workspace:
                context["workspace"] = workspace
                plugin_result = plugin.run(step, inputs, context)
        except Exception as exc:  # keep the poll loop alive on plugin faults
            plugin_result = {
                "artifacts": [],
                "tool_run_meta": {
                    "status": "failed",
                    "reason": f"Plugin execution error: {exc}",
                    "version": plugin.VERSION,
                    "execution_mode": execution_mode,
                },
            }
            logs.append(f"plugin_error:{type(exc).__name__}")
    else:
        plugin_result = {
            "artifacts": [],
            "tool_run_meta": {
                "status": "failed",
                "reason": reason,
                "version": getattr(plugin, "VERSION", None) if plugin else None,
                "execution_mode": execution_mode,
            },
        }
        logs.append("preflight_failed")

    artifacts: list[dict[str, Any]] = []
    for artifact in plugin_result.get("artifacts") or []:
        name = safe_filename(artifact.get("name"), "artifact.txt")
        content = artifact.get("content", "")
        if not isinstance(content, str):
            content = str(content)
        if name != artifact.get("name"):
            logs.append(f"sanitized_artifact_name:{artifact.get('name')}")
        artifacts.append(
            {
                "name": name,
                "kind": artifact.get("kind", "text"),
                "sha256": _sha256(content),
                "content": content,
                "execution_mode": execution_mode,
            }
        )

    tool_run_meta = dict(plugin_result.get("tool_run_meta") or {})
    # Never let a plugin downgrade or upgrade the agent's execution-mode label.
    tool_run_meta["execution_mode"] = execution_mode
    logs.extend(str(item) for item in (tool_run_meta.get("logs") or []))

    try:
        validation = validate(step, artifacts, tool_run_meta)
    except Exception as exc:  # malformed artifacts must not kill the poll loop
        logs.append(f"validation_error:{type(exc).__name__}")
        validation = {
            "status": "fail",
            "flags": [f"validation_error:{exc}"],
            "checked_rules": [],
        }
    explanation = build_explanation(
        step,
        artifacts,
        validation,
        limitations=tool_run_meta.get("limitations"),
        plan_limitations=plan.get("limitations"),
        evidence_hints=tool_run_meta.get("evidence_hints"),
    )
    explanation, llm_flags = apply_llm_phrasing(explanation, artifacts)
    if llm_flags:
        validation["flags"].extend(llm_flags)
        if validation["status"] == "pass":
            validation["status"] = "warn"
    explanation_check = check_explanation(explanation, artifacts)
    if not explanation_check["ok"]:
        logs.append("explanation_check_failed")
        validation["flags"].append("explanation_evidence_check_failed")
        validation["status"] = "fail"
        explanation = {
            "summary": "Explanation withheld because its evidence check did not pass.",
            "findings": [],
            "limitations": explanation.get("limitations", []),
            "references": [],
            "uncertainty": "high",
        }

    finished_at = _now()
    # The report embeds a provenance snapshot. That snapshot is taken before
    # report.html exists; the submitted provenance below covers every artifact.
    report_provenance = build_provenance(
        job,
        step,
        artifacts,
        tool_run_meta,
        started_at=started_at,
        finished_at=finished_at,
        input_hash=_input_hash(inputs),
        execution_mode=execution_mode,
    )
    report_html = build_report_html(
        plan, [job], artifacts, validation, explanation, report_provenance
    )
    artifacts.append(
        {
            "name": "report.html",
            "kind": "html",
            "sha256": _sha256(report_html),
            "content": report_html,
            "execution_mode": execution_mode,
        }
    )
    provenance = build_provenance(
        job,
        step,
        artifacts,
        tool_run_meta,
        started_at=started_at,
        finished_at=finished_at,
        input_hash=_input_hash(inputs),
        execution_mode=execution_mode,
    )

    plugin_ok = tool_run_meta.get("status") != "failed"
    status = "succeeded" if plugin_ok and validation["status"] != "fail" else "failed"
    return {
        "job_id": job.get("id"),
        "status": status,
        "execution_mode": execution_mode,
        "artifacts": artifacts,
        "provenance": provenance,
        "validation": validation,
        "explanation": explanation,
        "logs": logs,
    }


def _request_json(
    url: str,
    *,
    token: str,
    data: dict[str, Any] | None = None,
    timeout: int = DEFAULT_TIMEOUT,
) -> Any:
    headers = {"Accept": "application/json", "X-Agent-Token": token}
    body: bytes | None = None
    if data is not None:
        body = json.dumps(data, ensure_ascii=False).encode("utf-8")
        headers["Content-Type"] = "application/json"
    request = urllib.request.Request(url, data=body, headers=headers)
    with urllib.request.urlopen(request, timeout=timeout) as response:
        payload = response.read().decode("utf-8")
    return json.loads(payload) if payload.strip() else {}


def poll_and_run(
    base_url: str,
    agent_token: str,
    once: bool = False,
    *,
    timeout: int = DEFAULT_TIMEOUT,
    poll_interval: int = POLL_INTERVAL_SECONDS,
) -> list[dict[str, Any]]:
    """Poll the Worker, run each queued job and POST its result back."""
    base = base_url.rstrip("/")
    jobs_url = f"{base}/api/ai/jobs"
    results: list[dict[str, Any]] = []
    while True:
        try:
            payload = _request_json(jobs_url, token=agent_token, timeout=timeout)
        except _HTTP_ERRORS as exc:
            print(f"agent: job poll failed: {exc}", file=sys.stderr)
            if once:
                return results
            time.sleep(poll_interval)
            continue

        jobs = payload.get("jobs", payload) if isinstance(payload, dict) else payload
        if not isinstance(jobs, list):
            jobs = []
        for job in jobs:
            if not isinstance(job, dict):
                continue
            result = process_job(job)
            results.append(result)
            try:
                _request_json(
                    f"{base}/api/ai/jobs/{job.get('id')}/result",
                    token=agent_token,
                    data=result,
                    timeout=timeout,
                )
            except _HTTP_ERRORS as exc:
                print(f"agent: result submission failed: {exc}", file=sys.stderr)
        if once:
            return results
        time.sleep(poll_interval)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="smartbio-aiagent",
        description="Run the local smartbio AI execution agent.",
    )
    parser.add_argument("--job-file", help="Path to a job JSON file (offline mode).")
    parser.add_argument("--out-file", help="Path for the result JSON file.")
    parser.add_argument("--loop", action="store_true", help="Poll the Worker continuously.")
    parser.add_argument("--url", help="Worker base URL for polling mode.")
    parser.add_argument("--token", help="Agent token for the X-Agent-Token header.")
    parser.add_argument("--once", action="store_true", help="Poll once instead of looping.")
    args = parser.parse_args(argv)

    if args.job_file:
        job = json.loads(Path(args.job_file).read_text(encoding="utf-8-sig"))
        result = process_job(job)
        out_path = Path(args.out_file) if args.out_file else Path("result.json")
        out_path.write_text(
            json.dumps(result, indent=2, ensure_ascii=False), encoding="utf-8"
        )
        print(
            json.dumps(
                {
                    "job_id": result["job_id"],
                    "status": result["status"],
                    "out_file": str(out_path),
                }
            )
        )
        return 0 if result["status"] == "succeeded" else 2

    if args.loop or args.once or args.url or args.token:
        if not args.url or not args.token:
            parser.error("polling mode requires --url and --token")
        poll_and_run(args.url, args.token, once=args.once)
        return 0

    parser.error("provide --job-file or polling mode (--loop --url ... --token ...)")
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
