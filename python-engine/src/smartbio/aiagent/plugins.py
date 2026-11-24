"""Plugin loader and registry built from validated manifests.

A plugin adapter exposes ``TOOL_ID``, ``VERSION`` and
``run(step, inputs, context) -> {artifacts, tool_run_meta}``. Adapters are
discovered from ``shared/plugins/*.json`` (or ``SMARTBIO_PLUGIN_DIR``); a tool
is only registered when its manifest, contracts, entrypoint and requirements
all pass validation. Existing tool IDs and call signatures are preserved.
"""

from __future__ import annotations

from typing import Any, Protocol

from smartbio.aiagent.plugin_discovery import (
    DiscoveryResult,
    availability_report,
    discover,
    plugin_capabilities,
)


class PluginAdapter(Protocol):
    TOOL_ID: str
    VERSION: str

    def run(
        self,
        step: dict[str, Any],
        inputs: dict[str, Any],
        context: dict[str, Any],
    ) -> dict[str, Any]: ...


DISCOVERY: DiscoveryResult = discover()
TOOL_REGISTRY: dict[str, PluginAdapter] = DISCOVERY.adapters()


def load_plugins() -> dict[str, PluginAdapter]:
    """Return a copy of the registered adapters keyed by contract tool ID."""
    return dict(TOOL_REGISTRY)


def get_plugin(tool_id: str) -> PluginAdapter | None:
    return TOOL_REGISTRY.get(tool_id)


def require_plugin(tool_id: str) -> PluginAdapter:
    plugin = get_plugin(tool_id)
    if plugin is None:
        raise KeyError(f"Unknown tool_id: {tool_id}")
    return plugin


def list_tools() -> list[dict[str, str]]:
    tools: list[dict[str, str]] = []
    for record in sorted(
        DISCOVERY.tools.values(),
        key=lambda item: (not item.available, item.manifest_path, item.order),
    ):
        adapter = TOOL_REGISTRY.get(record.id)
        if adapter is None:
            continue
        tools.append(
            {"id": adapter.TOOL_ID, "version": adapter.VERSION, "backend": "local-python"}
        )
    return tools


__all__ = [
    "PluginAdapter",
    "DISCOVERY",
    "TOOL_REGISTRY",
    "availability_report",
    "discover",
    "get_plugin",
    "list_tools",
    "load_plugins",
    "plugin_capabilities",
    "require_plugin",
]
