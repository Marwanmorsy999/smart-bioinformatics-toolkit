"""Skeleton plugin adapter (documentation template).

Copy this file alongside a new manifest. It is intentionally *not* available:
``run`` returns a structured failure and never fabricates artifacts. Replace
it with a real adapter that calls existing scientific functions, then set
``available`` to true in the manifest once validation passes.
"""

from __future__ import annotations

from typing import Any

TOOL_ID = "template.example"
VERSION = "0.1.0"
LIMITATIONS = [
    "This is a skeleton template and deliberately produces no scientific artifacts.",
    "Replace these limitations with domain-specific ones before enabling the tool.",
]


class TemplatePlugin:
    """Minimal adapter contract: TOOL_ID, VERSION and run()."""

    TOOL_ID = TOOL_ID
    VERSION = VERSION

    def run(
        self, step: dict[str, Any], inputs: dict[str, Any], context: dict[str, Any]
    ) -> dict[str, Any]:
        return {
            "artifacts": [],
            "tool_run_meta": {
                "status": "failed",
                "reason": "Template skeleton: no implementation is enabled.",
                "tool_id": TOOL_ID,
                "version": VERSION,
                "limitations": list(LIMITATIONS),
                "required_artifacts": [],
                "evidence_hints": [],
            },
        }


__all__ = ["TemplatePlugin", "TOOL_ID", "VERSION", "LIMITATIONS"]
