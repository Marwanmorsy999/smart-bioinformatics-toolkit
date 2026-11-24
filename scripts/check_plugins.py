"""CI compliance gate for the M5 plugin framework.

Fails (non-zero exit) when any manifest is schema-invalid, an entrypoint cannot
be imported, TOOL_ID does not match, a contract is invalid, references or
limitations are missing, a verification claim is unsupported, an available tool
has unsatisfied requirements, the checked-in registry is stale, or the template
is non-compliant.

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
    discover,
    load_schema,
    schema_errors,
)

# Citations marked verified:true must match this curated ledger. A newly
# verified scientific reference is added here only after checking its metadata
# (DOI/CrossRef, PubMed or an in-tree source); otherwise use verified:false
# with a note explaining the unmet verification claim.
VERIFIED_REFERENCES: dict[str, dict[str, str]] = {
    "iupac_1984_ambiguity": {
        "title": "Nomenclature for incompletely specified bases in nucleic acid sequences: recommendations 1984",
        "url": "https://doi.org/10.1093/nar/13.9.3021",
    },
    "altschul1990_blast": {
        "title": "Basic local alignment search tool",
        "url": "https://doi.org/10.1016/S0022-2836(05)80360-2",
    },
    "smartbio_gc_definition": {
        "title": "Smart Bioinformatics Toolkit: DNA GC percentage definition",
        "url": "python-engine/src/smartbio/statistics.py#calculate_statistics",
    },
    "cock2009_biopython": {
        "title": "Biopython: freely available Python tools for computational molecular biology and bioinformatics",
        "url": "https://doi.org/10.1093/bioinformatics/btp163",
    },
    "thompson1994_clustalw": {
        "title": "CLUSTAL W: improving the sensitivity of progressive multiple sequence alignment",
        "url": "https://doi.org/10.1093/nar/22.22.4673",
    },
    "saitou1987_neighbor_joining": {
        "title": "The neighbor-joining method: a new method for reconstructing phylogenetic trees",
        "url": "https://doi.org/10.1093/oxfordjournals.molbev.a040454",
    },
}

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
        references = tool.get("references") or []
        if not isinstance(references, list) or not references:
            errors.append(f"{where}: references must contain at least one entry")
        for index, reference in enumerate(references):
            if not isinstance(reference, dict):
                errors.append(f"{where}: references[{index}] must be an object")
                continue
            key = str(reference.get("key", ""))
            if reference.get("verified") is True:
                expected = VERIFIED_REFERENCES.get(key)
                if expected is None:
                    errors.append(
                        f"{where}: reference_verification_unknown:{key} - "
                        "add verified metadata to VERIFIED_REFERENCES in "
                        "scripts/check_plugins.py or mark verified=false with a note"
                    )
                    continue
                for field in ("title", "url"):
                    if reference.get(field) != expected[field]:
                        errors.append(
                            f"{where}: reference_metadata_mismatch:{key}.{field} "
                            "(does not match the verified citation)"
                        )
            elif str(reference.get("note") or "").strip() == "":
                errors.append(
                    f"{where}: reference '{key}' is unverified and needs a note "
                    "explaining the unmet verification claim"
                )

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
    print("  - generated registry: current")
    print("  - template: compliant skeleton")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
