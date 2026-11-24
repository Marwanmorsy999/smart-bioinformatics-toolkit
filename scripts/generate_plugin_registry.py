"""Generate the Worker tool registry from validated plugin manifests.

Usage:
    python scripts/generate_plugin_registry.py           # write generated file
    python scripts/generate_plugin_registry.py --check    # fail if stale

The generated JavaScript is checked in so Workers and tests need no build step.
Availability is computed by the same discovery/validation code as the Python
agent; an invalid plugin is never advertised as available.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO_ROOT / "python-engine" / "src"))

from smartbio.aiagent.plugin_discovery import discover, ordered_tools  # noqa: E402

OUTPUT = (
    REPO_ROOT / "web-platform" / "functions" / "api" / "ai" / "registry.tools.generated.js"
)
HEADER = (
    "// GENERATED FILE - do not edit by hand.\n"
    "// Source: shared/plugins/*.json (validated by scripts/check_plugins.py).\n"
    "// Regenerate with: python scripts/generate_plugin_registry.py\n"
)


def build_tools() -> list[dict[str, object]]:
    result = discover()
    if result.errors:
        details = "\n".join(f"  - {error}" for error in result.errors)
        raise ValueError(f"Refusing to generate a registry from invalid plugins:\n{details}")
    return [item.capability() for item in ordered_tools(result)]


def render(tools: list[dict[str, object]]) -> str:
    payload = json.dumps(tools, indent=2, ensure_ascii=False)
    return f"{HEADER}\nexport const TOOLS = {payload};\n"


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true", help="only check that the file is current")
    args = parser.parse_args(argv)

    try:
        content = render(build_tools())
    except ValueError as exc:
        print(exc, file=sys.stderr)
        return 1
    if args.check:
        if not OUTPUT.is_file():
            print(f"registry missing: {OUTPUT}")
            return 1
        if OUTPUT.read_text(encoding="utf-8") != content:
            print(f"registry is stale: {OUTPUT}")
            print("run: python scripts/generate_plugin_registry.py")
            return 1
        print(f"registry is current: {OUTPUT}")
        return 0
    OUTPUT.write_text(content, encoding="utf-8")
    print(f"wrote {OUTPUT}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
