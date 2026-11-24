"""Provenance record builder matching AI_PLATFORM_CONTRACT.md §3."""

from __future__ import annotations

import hashlib
from typing import Any


def _combined_hash(artifacts: list[dict[str, Any]]) -> str:
    digest = hashlib.sha256()
    for artifact in artifacts:
        line = f"{artifact.get('name', '')}:{artifact.get('sha256', '')}\n"
        digest.update(line.encode("utf-8"))
    return digest.hexdigest()


def build_provenance(
    job: dict[str, Any],
    step: dict[str, Any],
    artifacts: list[dict[str, Any]],
    tool_run_meta: dict[str, Any],
    *,
    started_at: str,
    finished_at: str,
    input_hash: str | None = None,
    execution_mode: str = "real",
) -> dict[str, Any]:
    """Build a content-addressed provenance record for one executed step."""
    inputs = job.get("inputs") or {}
    tool = {
        "id": step.get("tool_id") or job.get("tool_id"),
        "version": tool_run_meta.get("version"),
        "backend": step.get("backend") or job.get("backend") or "local-python",
    }
    database = tool_run_meta.get("database") or {}
    return {
        "run_id": job.get("id"),
        "step_id": step.get("id") or job.get("step_id"),
        "tool": tool,
        "input": {
            "dataset_id": inputs.get("dataset_id"),
            "sha256": input_hash,
            "filename": inputs.get("filename"),
        },
        "parameters": dict(step.get("params") or job.get("params") or {}),
        "database": {
            "name": database.get("name"),
            "release": database.get("release"),
            "retrieved_at": database.get("retrieved_at"),
        },
        "output": {
            "artifact_names": [artifact.get("name") for artifact in artifacts],
            "sha256": _combined_hash(artifacts),
        },
        "timing": {"started_at": started_at, "finished_at": finished_at},
        "execution_mode": execution_mode,
    }


__all__ = ["build_provenance"]
