"""Shared helpers for the local smartbio plugin adapters.

Adapters wrap existing ``smartbio`` functions; they never reimplement the
scientific algorithms. These helpers only deal with workspace hygiene and
artifact serialization.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

# The Worker caps inline inputs at 64 KiB (AI_PLATFORM_CONTRACT.md §2).
MAX_TEXT_BYTES = 64 * 1024


def safe_filename(name: Any, fallback: str) -> str:
    """Return a basename only, rejecting traversal and control characters."""
    if not isinstance(name, str) or not name.strip():
        return fallback
    candidate = name.replace("\\", "/").split("/")[-1].strip()
    if candidate in {"", ".", ".."} or ".." in candidate:
        return fallback
    if any(char in candidate for char in ("\x00", "\r", "\n")):
        return fallback
    return candidate


def write_input(workspace: str | Path, name: str, text: str) -> Path:
    """Write a size-capped input text file inside the job workspace."""
    if not isinstance(text, str) or not text.strip():
        raise ValueError("Input text is empty.")
    encoded = text.encode("utf-8")
    if len(encoded) > MAX_TEXT_BYTES:
        raise ValueError(
            f"Input exceeds the {MAX_TEXT_BYTES}-byte cap "
            f"({len(encoded)} bytes received)."
        )
    target = Path(workspace) / safe_filename(name, "input.txt")
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(text, encoding="utf-8")
    return target


def json_artifact(name: str, data: Any) -> dict[str, Any]:
    """Build a JSON artifact from a serializable structure."""
    return {
        "name": safe_filename(name, "artifact.json"),
        "kind": "json",
        "content": json.dumps(data, indent=2, ensure_ascii=False),
    }


def text_artifact(name: str, content: str, kind: str) -> dict[str, Any]:
    return {
        "name": safe_filename(name, "artifact.txt"),
        "kind": kind,
        "content": content,
    }


def dataframe_csv_string(frame: Any, workspace: str | Path, name: str) -> str:
    """Serialize a DataFrame with smartbio.exports.write_csv, then read back.

    Using the existing exporter keeps the CSV injection-safe prefixing logic in
    one place while still producing an inline artifact string.
    """
    from smartbio.exports import write_csv

    target = Path(workspace) / safe_filename(name, "table.csv")
    write_csv(frame, target)
    return target.read_text(encoding="utf-8")


def failure_result(
    adapter: Any,
    reason: str,
    *,
    limitations: list[str] | None = None,
    logs: list[str] | None = None,
    details: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Return a structured failure; no fabricated artifacts are produced."""
    meta: dict[str, Any] = {
        "status": "failed",
        "reason": reason,
        "tool_id": adapter.TOOL_ID,
        "version": adapter.VERSION,
        "execution_mode": "real",
        "limitations": list(limitations or []),
        "logs": list(logs or []),
    }
    if details:
        meta["details"] = details
    return {"artifacts": [], "tool_run_meta": meta}


__all__ = [
    "MAX_TEXT_BYTES",
    "safe_filename",
    "write_input",
    "json_artifact",
    "text_artifact",
    "dataframe_csv_string",
    "failure_result",
]
