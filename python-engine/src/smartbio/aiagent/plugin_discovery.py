"""Automatic, fail-closed plugin discovery.

Two distinct states are reported:

* **Registered** — the manifest, references, contracts and entrypoint are
  valid, so ``TOOL_REGISTRY`` can resolve the adapter for explicit jobs.
* **Available** — additionally the manifest says ``available: true`` and every
  statically checkable requirement is satisfied. Availability governs the
  planner-facing registry and user-facing reports, not explicit execution.

A manifest is never imported before schema, reference, contract and hard
requirement checks pass. The startup manifests directory is guarded against
temp/world-writable locations because importing an adapter executes code.
"""

from __future__ import annotations

import importlib
import importlib.util
import inspect
import json
import os
import shutil
import stat
import sys
import tempfile
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from jsonschema import Draft202012Validator
from jsonschema.exceptions import SchemaError

from smartbio.aiagent.plugin_references import reference_errors

# python-engine/src/smartbio/aiagent/plugin_discovery.py -> repository root.
REPO_ROOT = Path(__file__).resolve().parents[4]
DEFAULT_MANIFEST_DIR = REPO_ROOT / "shared" / "plugins"
DEFAULT_SCHEMA_PATH = REPO_ROOT / "shared" / "schemas" / "plugin.schema.json"

# The import name of the Biopython distribution is ``Bio``.
_PYTHON_PACKAGE_ALIASES = {"biopython": "Bio"}
_HARD_REQUIREMENT_KINDS = {"python-package", "executable"}


def manifests_dir() -> Path:
    configured = os.environ.get("SMARTBIO_PLUGIN_DIR", "").strip()
    return Path(configured).expanduser().resolve() if configured else DEFAULT_MANIFEST_DIR


def schema_path() -> Path:
    configured = os.environ.get("SMARTBIO_PLUGIN_SCHEMA", "").strip()
    return Path(configured).expanduser().resolve() if configured else DEFAULT_SCHEMA_PATH


def _untrusted_reasons(root: Path) -> list[str]:
    reasons: list[str] = []
    try:
        root.relative_to(Path(tempfile.gettempdir()).resolve())
        reasons.append("path is inside the system temporary directory")
    except ValueError:
        pass
    if os.name == "posix":
        try:
            mode = stat.S_IMODE(root.stat().st_mode)
            if mode & stat.S_IWOTH:
                reasons.append("directory is world-writable")
        except OSError:
            pass
    return reasons


def _directory_guard(root: Path, explicit: bool) -> list[str]:
    """Guard startup discovery; explicit paths are for tests and tooling."""
    if explicit:
        return []
    trusted_ack = os.environ.get("SMARTBIO_PLUGIN_DIR_TRUSTED", "").strip() == "1"
    reasons = _untrusted_reasons(root)
    configured = bool(os.environ.get("SMARTBIO_PLUGIN_DIR", "").strip())
    if configured:
        try:
            root.relative_to(REPO_ROOT)
        except ValueError:
            reasons.append(
                "SMARTBIO_PLUGIN_DIR override lies outside the repository; "
                "set SMARTBIO_PLUGIN_DIR_TRUSTED=1 only for a controlled host"
            )
    if reasons and not trusted_ack:
        return [
            f"untrusted_manifest_dir:{root}: {'; '.join(reasons)}. "
            "Use a repo-controlled, non-user-writable directory or set "
            "SMARTBIO_PLUGIN_DIR_TRUSTED=1 to acknowledge the risk"
        ]
    return []


def load_schema(path: Path | None = None) -> dict[str, Any]:
    target = path or schema_path()
    data = json.loads(target.read_text(encoding="utf-8-sig"))
    Draft202012Validator.check_schema(data)
    return data


def schema_errors(
    manifest: Any, validator: Draft202012Validator | None = None
) -> list[str]:
    """Return sorted, human-readable schema errors for one manifest."""
    active = validator or Draft202012Validator(load_schema())
    errors = []
    for error in active.iter_errors(manifest):
        location = ".".join(str(part) for part in error.absolute_path) or "<root>"
        errors.append(f"{location}: {error.message}")
    return sorted(errors)


def _contract_errors(tool: dict[str, Any]) -> list[str]:
    errors: list[str] = []
    for key in ("params_schema", "input_schema", "output_schema"):
        value = tool.get(key)
        if not isinstance(value, dict):
            errors.append(f"{key}: must be a JSON Schema object")
            continue
        if value.get("type") != "object":
            errors.append(f"{key}: must declare type 'object'")
            continue
        try:
            Draft202012Validator.check_schema(value)
        except SchemaError as exc:
            errors.append(f"{key}: invalid JSON Schema ({exc.message})")
    return errors


def check_requirement(declaration: str) -> dict[str, Any]:
    """Check one statically verifiable requirement declaration."""
    text = declaration.strip()
    kind, _, name = text.partition(":")
    name = name.strip()
    if kind == "python-package":
        module = _PYTHON_PACKAGE_ALIASES.get(name.lower(), name)
        if not module:
            return {
                "declaration": text,
                "kind": kind,
                "satisfied": False,
                "detail": "missing module name after python-package:",
            }
        try:
            found = importlib.util.find_spec(module) is not None
        except (ImportError, ValueError):
            found = False
        return {
            "declaration": text,
            "kind": kind,
            "satisfied": found,
            "detail": (
                f"python module '{module}' importable"
                if found
                else f"python module '{module}' not importable"
            ),
        }
    if kind == "executable":
        if not name:
            return {
                "declaration": text,
                "kind": kind,
                "satisfied": False,
                "detail": "missing executable name after executable:",
            }
        located = shutil.which(name)
        return {
            "declaration": text,
            "kind": kind,
            "satisfied": located is not None,
            "detail": (
                f"executable '{name}' found at {located}"
                if located
                else f"executable '{name}' not on PATH"
            ),
        }
    return {
        "declaration": text,
        "kind": "unverifiable",
        "satisfied": False,
        "detail": (
            f"requirement '{text}' uses no statically verifiable form; "
            "use python-package:NAME or executable:NAME"
        ),
    }


def check_requirements(declarations: list[str]) -> list[dict[str, Any]]:
    return [check_requirement(item) for item in declarations]


def _load_module(module_name: str, manifest_dir: Path) -> Any:
    try:
        return importlib.import_module(module_name)
    except ModuleNotFoundError:
        local = manifest_dir / Path(*module_name.split("."))
        candidate = local.with_suffix(".py")
        if not candidate.is_file():
            raise
        spec = importlib.util.spec_from_file_location(
            f"_smartbio_local_plugin_{abs(hash(str(candidate)))}", candidate
        )
        if spec is None or spec.loader is None:
            raise ImportError(f"Cannot load local adapter module: {candidate}")
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        return module


def import_adapter(
    entrypoint: str, manifest_dir: Path, expected_tool_id: str | None = None
) -> Any:
    """Import an adapter from ``module:Class`` (local module allowed).

    For a multi-tool manifest with one module-level entrypoint, any class in
    that module whose ``TOOL_ID`` equals the manifest tool id is accepted. This
    is generic and does not require per-tool entrypoints, while a mismatched id
    still fails closed.
    """
    module_name, separator, attribute = str(entrypoint).partition(":")
    if not separator or not module_name.strip() or not attribute.strip():
        raise ImportError(f"Invalid entrypoint '{entrypoint}'; expected module:Class")
    module = _load_module(module_name.strip(), manifest_dir)
    target = getattr(module, attribute.strip())
    if expected_tool_id and getattr(target, "TOOL_ID", None) != expected_tool_id:
        for candidate in vars(module).values():
            if not isinstance(candidate, type):
                continue
            if getattr(candidate, "TOOL_ID", None) != expected_tool_id:
                continue
            if not callable(getattr(candidate, "run", None)) or not getattr(
                candidate, "VERSION", None
            ):
                continue
            target = candidate
            break
    return target() if isinstance(target, type) else target


def declares_required_artifacts(adapter: Any) -> bool:
    """True when an adapter statically declares the ``required_artifacts`` seam.

    Accepted forms are a class-level ``REQUIRED_ARTIFACTS`` declaration or the
    ``required_artifacts`` key in the adapter class/module source (normally in
    ``tool_run_meta``). This avoids running scientific code just to inspect a
    contract while still catching adapters that omit the seam.
    """
    if isinstance(getattr(adapter, "REQUIRED_ARTIFACTS", None), (list, tuple)):
        return True
    owner = type(adapter)
    targets = [owner]
    # Shipped adapters may build meta in a module-level helper; only inspect
    # modules inside the plugin package (not arbitrary caller/test modules).
    if owner.__module__.startswith("smartbio.plugins"):
        module = sys.modules.get(owner.__module__)
        if module is not None:
            targets.append(module)
    for target in targets:
        try:
            if "required_artifacts" in (inspect.getsource(target) or ""):
                return True
        except (OSError, TypeError):
            continue
    return False


def _adapter_errors(adapter: Any, tool_id: str) -> list[str]:
    errors: list[str] = []
    actual_id = getattr(adapter, "TOOL_ID", None)
    version = getattr(adapter, "VERSION", None)
    run = getattr(adapter, "run", None)
    if not isinstance(actual_id, str) or not actual_id.strip():
        errors.append("adapter: TOOL_ID is missing or empty")
    elif actual_id != tool_id:
        errors.append(f"adapter: TOOL_ID '{actual_id}' does not match manifest id '{tool_id}'")
    if not isinstance(version, str) or not version.strip():
        errors.append("adapter: VERSION is missing or empty")
    if not callable(run):
        errors.append("adapter: run is missing or not callable")
    return errors


@dataclass
class DiscoveredTool:
    id: str
    manifest_path: str
    manifest_name: str
    domain: str
    version: str
    entrypoint: str
    adapter: Any | None
    available: bool
    unavailable_reason: str | None
    declared_available: bool
    requirements: list[str]
    requirement_checks: list[dict[str, Any]] = field(default_factory=list)
    errors: list[str] = field(default_factory=list)
    tool: dict[str, Any] = field(default_factory=dict)
    order: int = 0

    @property
    def registered(self) -> bool:
        return self.adapter is not None

    def capability(self) -> dict[str, Any]:
        """Projection used by the Worker registry and capability endpoint."""
        tool = self.tool
        return {
            "id": self.id,
            "name": tool.get("name") or self.id,
            "description": tool.get("description", ""),
            "version": self.version,
            "backend": "local-python",
            "domain": self.domain,
            "available": self.available,
            "unavailable_reason": self.unavailable_reason,
            "external_egress": bool(tool.get("external_egress", False)),
            "requirements": list(self.requirements),
            "estimated_seconds": int(tool.get("estimated_seconds", 0) or 0),
            "params_schema": tool.get("params_schema", {}),
            "input_schema": tool.get("input_schema", {}),
            "output_schema": tool.get("output_schema", {}),
            "references": list(tool.get("references", [])),
            "limitations": list(tool.get("limitations", [])),
        }


@dataclass
class DiscoveryResult:
    tools: dict[str, DiscoveredTool] = field(default_factory=dict)
    errors: list[str] = field(default_factory=list)
    manifest_paths: list[str] = field(default_factory=list)

    def adapters(self) -> dict[str, Any]:
        """All *valid* adapters, including valid-but-unavailable tools.

        Availability governs planner selection and reporting; explicit jobs
        may still call a valid adapter whose manifest is `available: false`.
        """
        result: dict[str, Any] = {}
        for tool_id, record in self.tools.items():
            if record.adapter is None:
                continue
            if tool_id in result:
                raise ValueError(f"Duplicate plugin tool_id: {tool_id}")
            result[tool_id] = record.adapter
        return result


def discover(
    directory: Path | str | None = None,
    validator: Draft202012Validator | None = None,
) -> DiscoveryResult:
    """Scan ``directory`` for manifests; validate before importing any code."""
    explicit = directory is not None
    root = Path(directory).expanduser().resolve() if explicit else manifests_dir()
    result = DiscoveryResult()
    result.errors.extend(_directory_guard(root, explicit))
    if result.errors:
        return result
    active = validator or Draft202012Validator(load_schema())
    if not root.is_dir():
        result.errors.append(f"manifests_directory_not_found:{root}")
        return result

    for path in sorted(root.glob("*.json")):
        result.manifest_paths.append(str(path))
        try:
            manifest = json.loads(path.read_text(encoding="utf-8-sig"))
        except (OSError, ValueError, json.JSONDecodeError) as exc:
            result.errors.append(f"{path.name}: invalid JSON ({exc})")
            continue
        problems = schema_errors(manifest, active)
        if problems:
            result.errors.extend(f"{path.name}: schema:{item}" for item in problems)
            continue
        if manifest.get("backend") != "local-python":
            result.errors.append(f"{path.name}: unsupported backend")
            continue

        domain = str(manifest.get("domain") or manifest.get("name") or path.stem)
        manifest_version = str(manifest.get("version", ""))
        for tool_index, raw_tool in enumerate(manifest.get("tools", [])):
            tool_id = str(raw_tool.get("id", ""))
            order = tool_index
            entrypoint = str(raw_tool.get("entrypoint") or manifest.get("entrypoint") or "")
            # Validation happens BEFORE importing the declared module.
            tool_problems = _contract_errors(raw_tool)
            tool_problems.extend(
                f"references:{item}" for item in reference_errors(raw_tool.get("references"))
            )
            requirements = list(raw_tool.get("requirements") or []) + list(
                raw_tool.get("requires") or []
            )
            requirements = list(dict.fromkeys(requirements))
            checks = check_requirements(requirements)
            hard_failures = [
                item
                for item in checks
                if not item["satisfied"] and item["kind"] in _HARD_REQUIREMENT_KINDS
            ]
            if hard_failures:
                details = "; ".join(item["detail"] for item in hard_failures)
                tool_problems.append(f"unsatisfied_hard_requirement:{details}")
            declared_available = bool(raw_tool.get("available", False))
            adapter: Any | None = None

            if not tool_problems:
                if not entrypoint:
                    tool_problems.append(
                        "entrypoint: neither the tool nor the manifest declares one"
                    )
                else:
                    try:
                        adapter = import_adapter(entrypoint, root, tool_id)
                    except Exception as exc:  # fail closed on import/constructor faults
                        tool_problems.append(
                            f"entrypoint: cannot import '{entrypoint}' ({exc})"
                        )
                        adapter = None
                    else:
                        tool_problems.extend(_adapter_errors(adapter, tool_id))

            failed = [item for item in checks if not item["satisfied"]]
            if tool_problems:
                reason = "; ".join(tool_problems)
                if failed:
                    reason += "; " + "; ".join(item["detail"] for item in failed)
                result.errors.append(f"{path.name}:{tool_id}: {reason}")
                _append_tool(
                    result,
                    DiscoveredTool(
                        id=tool_id,
                        manifest_path=str(path),
                        manifest_name=str(manifest.get("name") or path.stem),
                        domain=domain,
                        version=manifest_version,
                        entrypoint=entrypoint,
                        adapter=None,
                        available=False,
                        unavailable_reason=reason,
                        declared_available=declared_available,
                        requirements=requirements,
                        requirement_checks=checks,
                        errors=tool_problems,
                        tool=raw_tool,
                        order=order,
                    ),
                )
                continue

            unavailable_reason: str | None = None
            if not declared_available:
                unavailable_reason = str(
                    raw_tool.get("unavailable_reason") or "Manifest declares available=false."
                )
            if failed:
                details = "; ".join(item["detail"] for item in failed)
                unavailable_reason = (
                    f"Unsatisfied runtime requirement(s): {details}."
                    if unavailable_reason is None
                    else f"{unavailable_reason} Unsatisfied runtime requirement(s): {details}."
                )
            _append_tool(
                result,
                DiscoveredTool(
                    id=tool_id,
                    manifest_path=str(path),
                    manifest_name=str(manifest.get("name") or path.stem),
                    domain=domain,
                    version=manifest_version,
                    entrypoint=entrypoint,
                    adapter=adapter,
                    available=declared_available and not failed,
                    unavailable_reason=unavailable_reason,
                    declared_available=declared_available,
                    requirements=requirements,
                    requirement_checks=checks,
                    tool=raw_tool,
                    order=order,
                ),
            )
    return result


def _append_tool(result: DiscoveryResult, record: DiscoveredTool) -> None:
    if record.id in result.tools:
        result.errors.append(
            f"duplicate_tool_id:{record.id}:{record.manifest_path} "
            "conflicts with an already discovered tool"
        )
        # Fail closed: neither copy may be registered.
        result.tools.pop(record.id, None)
        return
    result.tools[record.id] = record


def _ordered_tools(result: DiscoveryResult) -> list[DiscoveredTool]:
    # Available tools first keeps the historical /api/tools ordering while new
    # domains are still picked up automatically from their manifest filename.
    return sorted(
        result.tools.values(),
        key=lambda item: (not item.available, Path(item.manifest_path).name, item.order),
    )


def plugin_capabilities() -> dict[str, Any]:
    """Structured capability projection for the control plane and tooling."""
    result = discover()
    return {
        "tools": [item.capability() for item in _ordered_tools(result)],
        "errors": list(result.errors),
        "manifest_dir": str(manifests_dir()),
    }


def availability_report() -> dict[str, Any]:
    """Structured availability report, including precise failure reasons."""
    result = discover()
    tools = {
        item.id: {
            "available": item.available,
            "registered": item.registered,
            "unavailable_reason": item.unavailable_reason,
            "declared_available": item.declared_available,
            "entrypoint": item.entrypoint,
            "manifest": item.manifest_path,
            "requirements": list(item.requirements),
            "requirement_checks": list(item.requirement_checks),
            "errors": list(item.errors),
        }
        for item in _ordered_tools(result)
    }
    available = sum(1 for item in tools.values() if item["available"])
    return {
        "manifest_dir": str(manifests_dir()),
        "tools": tools,
        "errors": list(result.errors),
        "summary": {
            "total": len(tools),
            "available": available,
            "unavailable": len(tools) - available,
        },
    }


ordered_tools = _ordered_tools


__all__ = [
    "REPO_ROOT",
    "DEFAULT_MANIFEST_DIR",
    "DEFAULT_SCHEMA_PATH",
    "DiscoveryResult",
    "DiscoveredTool",
    "availability_report",
    "check_requirement",
    "check_requirements",
    "declares_required_artifacts",
    "discover",
    "import_adapter",
    "load_schema",
    "manifests_dir",
    "ordered_tools",
    "plugin_capabilities",
    "schema_errors",
    "schema_path",
]
