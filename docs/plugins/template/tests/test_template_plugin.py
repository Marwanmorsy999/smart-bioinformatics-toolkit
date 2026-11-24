"""The shipped template must remain a valid, fail-closed plugin skeleton."""

from __future__ import annotations

import json
from pathlib import Path
import sys

import pytest

TEMPLATE_DIR = Path(__file__).resolve().parents[1]
REPO_ROOT = TEMPLATE_DIR.parents[2]
sys.path.insert(0, str(REPO_ROOT / "python-engine" / "src"))
sys.path.insert(0, str(TEMPLATE_DIR))

from jsonschema import Draft202012Validator  # noqa: E402

from smartbio.aiagent.plugin_discovery import discover, load_schema  # noqa: E402
from smartbio.aiagent.plugins import get_plugin  # noqa: E402


def _manifest():
    return json.loads((TEMPLATE_DIR / "manifest.json").read_text(encoding="utf-8"))


def test_template_manifest_is_schema_valid():
    manifest = _manifest()
    errors = list(Draft202012Validator(load_schema()).iter_errors(manifest))
    assert errors == [], [error.message for error in errors]


def test_template_is_discovered_but_unavailable():
    result = discover(TEMPLATE_DIR)
    assert result.errors == []
    assert list(result.tools) == ["template.example"]
    record = result.tools["template.example"]
    assert record.available is False
    assert record.unavailable_reason
    assert record.adapter is not None


def test_template_adapter_never_fabricates_artifacts():
    from adapter import TemplatePlugin

    result = TemplatePlugin().run({}, {}, {"workspace": str(TEMPLATE_DIR)})
    assert result["artifacts"] == []
    assert result["tool_run_meta"]["status"] == "failed"
    assert result["tool_run_meta"]["tool_id"] == "template.example"


def test_template_is_not_registered_in_the_live_registry():
    assert get_plugin("template.example") is None


if __name__ == "__main__":
    raise SystemExit(pytest.main([__file__, "-q"]))
