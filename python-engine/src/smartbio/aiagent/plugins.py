"""Plugin loader and registry built from validated manifests.

A plugin adapter exposes ``TOOL_ID``, ``VERSION`` and
``run(step, inputs, context) -> {artifacts, tool_run_meta}``. Adapters are
discovered from ``shared/plugins/*.json`` (or ``SMARTBIO_PLUGIN_DIR``).

**Registered** means the manifest, references, contracts and entrypoint are
valid; such an adapter can resolve for explicit jobs even when the manifest is
``available: false`` (for example a tool that needs a dataset supplied by the
caller). **Available** is the planner-facing flag: it additionally requires
``available: true`` and all statically checkable requirements satisfied. Use
``is_available()`` as the gate for planner-facing lists; availability is
reported precisely by ``availability_report()``, ``list_tools()`` and the
generated Worker registry.
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
    """Return a copy of every *valid* registered adapter, keyed by tool id."""
    return dict(TOOL_REGISTRY)


def get_plugin(tool_id: str) -> PluginAdapter | None:
    """Resolve a valid adapter; availability does not block explicit jobs."""
    return TOOL_REGISTRY.get(tool_id)


def require_plugin(tool_id: str) -> PluginAdapter:
    plugin = get_plugin(tool_id)
    if plugin is None:
        raise KeyError(f"Unknown or invalid tool_id: {tool_id}")
    return plugin


def is_available(tool_id: str) -> bool:
    """True only for tools advertised as available to the planner/UI."""
    record = DISCOVERY.tools.get(tool_id)
    return bool(record is not None and record.available)


def list_tools() -> list[dict[str, Any]]:
    """Planner-facing tool projection with authoritative availability flags."""
    tools: list[dict[str, Any]] = []
    for record in sorted(
        DISCOVERY.tools.values(),
        key=lambda item: (not item.available, item.manifest_path, item.order),
    ):
        adapter = TOOL_REGISTRY.get(record.id)
        if adapter is None:
            continue
        tools.append(
            {
                "id": adapter.TOOL_ID,
                "version": adapter.VERSION,
                "backend": "local-python",
                "available": is_available(record.id),
                "unavailable_reason": record.unavailable_reason,
            }
        )
    return tools


__all__ = [
    "PluginAdapter",
    "DISCOVERY",
    "TOOL_REGISTRY",
    "availability_report",
    "discover",
    "get_plugin",
    "is_available",
    "list_tools",
    "load_plugins",
    "plugin_capabilities",
    "require_plugin",
]
