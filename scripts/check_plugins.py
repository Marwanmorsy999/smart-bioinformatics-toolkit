"""CI compliance gate for the M5 plugin framework.

Fails (non-zero exit) when any manifest is schema-invalid, an entrypoint cannot
be imported, TOOL_ID does not match, a contract is invalid, references or
limitations are missing, a verification claim is unsupported, an available tool
has unsatisfied requirements or omits the required_artifacts seam, the checked
in registry is stale, or the template is non-compliant.

Usage: python scripts/check_plugins.py
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO_ROOT / "python-engine" / "src"))

from jsonschema import Draft202012Validator  # noqa: E402

from generate_plugin_registry import OUTPUT, build_tools, render  # noqa: E402
from smartbio.aiagent.plugin_discovery import (  # noqa: E402
    declares_required_artifacts,
    discover,
    load_schema,
    schema_errors,
)
from smartbio.aiagent.plugin_references import reference_errors  # noqa: E402

TEMPLATE_DIR = REPO_ROOT / "docs" / "plugins" / "template"


def _check_manifests(errors: list[str]) -> None:
    validator = Draft202012Validator(load_schema())
    paths = sorted((REPO_ROOT / "shared" / "plugins").glob("*.json"))
    if not paths:
        errors.append("no plugin manifests found in shared/plugins/")
        return
    for path in paths:
        try:
            manifest = json.loads(path.read_text(encoding="utf-8-sig"))
        except (OSError, ValueError, json.JSONDecodeError) as exc:
            errors.append(f"{path.name}: invalid JSON ({exc})")
            continue
        for message in schema_errors(manifest, validator):
            errors.append(f"{path.name}: schema:{message}")


def _check_discovered(errors: list[str]) -> None:
    result = discover()
    errors.extend(result.errors)
    for record in result.tools.values():
        where = record.id
        tool = record.tool
        for message in reference_errors(tool.get("references")):
            errors.append(f"{where}: {message}")
        limitations = tool.get("limitations") or []
        if not isinstance(limitations, list) or not limitations:
            errors.append(f"{where}: limitations must contain at least one entry")
        for check in record.requirement_checks:
            if not check["satisfied"] and record.declared_available:
                errors.append(
                    f"{where}: available=true but requirement "
                    f"'{check['declaration']}' is unsatisfied ({check['detail']})"
                )
        if record.declared_available and not record.available and not record.errors:
            errors.append(f"{where}: declared available but discovery marked it unavailable")
        if record.available:
            if record.adapter is None:
                errors.append(f"{where}: available but no valid adapter is registered")
            elif not declares_required_artifacts(record.adapter):
                errors.append(
                    f"{where}: available adapter does not declare required_artifacts "
                    "in tool_run_meta"
                )


def _check_registry(errors: list[str]) -> None:
    if not OUTPUT.is_file():
        errors.append(f"generated registry missing: {OUTPUT}")
        return
    try:
        expected = render(build_tools())
    except Exception as exc:  # invalid plugins must produce a clean failure
        errors.append(f"cannot regenerate registry: {exc}")
        return
    if OUTPUT.read_text(encoding="utf-8") != expected:
        errors.append(
            "generated registry is stale: run python scripts/generate_plugin_registry.py"
        )


def _check_template(errors: list[str]) -> None:
    for name in ("manifest.json", "adapter.py", "README.md", "tests/test_template_plugin.py"):
        if not (TEMPLATE_DIR / name).is_file():
            errors.append(f"template: missing {name}")
    if not TEMPLATE_DIR.is_dir():
        return
    result = discover(TEMPLATE_DIR)
    errors.extend(f"template: {item}" for item in result.errors)
    if len(result.tools) != 1:
        errors.append(f"template: expected exactly one tool, found {len(result.tools)}")
        return
    record = next(iter(result.tools.values()))
    if record.available:
        errors.append("template: skeleton must be marked available=false")
    if not str(record.unavailable_reason or "").strip():
        errors.append("template: skeleton needs an honest unavailable_reason")
    if record.adapter is None:
        errors.append("template: entrypoint is not importable")


def main(argv: list[str] | None = None) -> int:
    errors: list[str] = []
    _check_manifests(errors)
    _check_discovered(errors)
    _check_registry(errors)
    _check_template(errors)

    if errors:
        print(f"PLUGIN COMPLIANCE FAILED ({len(errors)} problem(s))")
        for error in errors:
            print(f"  FAIL {error}")
        return 1
    print("PLUGIN COMPLIANCE OK")
    print("  - manifests: schema-valid")
    print("  - adapters/entrypoints/contracts: valid")
    print("  - references/limitations: present and claims supported")
    print("  - requirements: satisfiable for every available tool")
    print("  - available adapters declare required_artifacts")
    print("  - generated registry: current")
    print("  - template: compliant skeleton")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
