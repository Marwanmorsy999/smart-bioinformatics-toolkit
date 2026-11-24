"""Deterministic validation of plugin artifacts.

Validation only reads artifacts: it never edits scientific values. A ``fail``
flag blocks the succeeded status; ``warn`` flags are surfaced to the user.
"""

from __future__ import annotations

import hashlib
import json
from typing import Any

REQUIRED_ARTIFACTS: dict[str, list[str]] = {
    "sequence-stats.validate": ["validation.json"],
    "sequence-stats.profile": [
        "validation.json",
        "statistics.json",
        "analysis.json",
        "statistics.csv",
    ],
    "microbiome-16s.blast-parse": ["blast_analysis.json"],
    "microbiome-16s.taxonomy": ["taxonomy_analysis.json"],
}

_POSITIVE_VERDICTS = {
    "species_supported",
    "group_level_only",
    "genus_level_only",
    "below_screening_threshold",
}


def _decode(artifact: dict[str, Any]) -> Any | None:
    try:
        return json.loads(artifact.get("content", ""))
    except (TypeError, ValueError, json.JSONDecodeError):
        return None


def _artifact_map(artifacts: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    result: dict[str, dict[str, Any]] = {}
    for artifact in artifacts:
        name = str(artifact.get("name", ""))
        if name:
            result[name] = artifact
    return result


def _check_validation_counts(document: dict[str, Any], fail) -> None:
    total = document.get("total_records")
    records = document.get("records", [])
    valid = document.get("valid_records")
    invalid = document.get("invalid_records")
    if not isinstance(records, list):
        fail("validation_records_not_list")
        return
    counts = (total, valid, invalid)
    if not all(isinstance(value, int) and not isinstance(value, bool) for value in counts):
        fail("validation_counts_invalid")
        return
    if total != len(records) or valid + invalid != total:
        fail("validation_counts_inconsistent")


def validate(
    step: dict[str, Any],
    artifacts: list[dict[str, Any]],
    tool_run_meta: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Validate ``artifacts`` for one step without changing any value."""
    fail_flags: list[str] = []
    warn_flags: list[str] = []
    rules: list[str] = []

    def fail(message: str) -> None:
        fail_flags.append(message)

    def warn(message: str) -> None:
        warn_flags.append(message)

    tool_id = str(step.get("tool_id", ""))
    by_name = _artifact_map(artifacts)
    documents: dict[str, Any] = {}

    # --- Generic checks -------------------------------------------------
    # Legacy tool entries and plugin-declared names are a union: a new domain
    # can enforce its own artifact contract without changing this module.
    meta = tool_run_meta or {}
    declared_names = REQUIRED_ARTIFACTS.get(tool_id, [])
    extra_names = meta.get("required_artifacts") or []
    if isinstance(extra_names, str):
        extra_names = [extra_names]
    if not isinstance(extra_names, (list, tuple)):
        extra_names = []
    required_names: list[str] = []
    for name in list(declared_names) + list(extra_names):
        if isinstance(name, str) and name and name not in required_names:
            required_names.append(name)
    rules.append("required_artifacts_present")
    for name in required_names:
        artifact = by_name.get(name)
        if artifact is None:
            fail(f"missing_artifact:{name}")
        elif not str(artifact.get("content", "")).strip():
            fail(f"empty_artifact:{name}")

    rules.append("json_parses")
    for name, artifact in by_name.items():
        if artifact.get("kind") == "json" or name.endswith(".json"):
            decoded = _decode(artifact)
            if decoded is None:
                fail(f"invalid_json:{name}")
            else:
                documents[name] = decoded

    # Adapter-declared outputs are documented as JSON documents. Presence and
    # emptiness are checked above; here a declared JSON artifact must decode to
    # an object, never to a bare list/scalar. The rule is name-driven so new
    # adapters need no change to this module.
    rules.append("declared_json_objects")
    for name in required_names:
        artifact = by_name.get(name)
        if artifact is None or not str(artifact.get("content", "")).strip():
            continue
        if artifact.get("kind") != "json" and not name.endswith(".json"):
            continue
        decoded = documents.get(name)
        if decoded is None:
            continue  # invalid_json is already reported above
        if not isinstance(decoded, dict):
            fail(f"declared_artifact_not_object:{name}")

    rules.append("sha256_consistency")
    for name, artifact in by_name.items():
        expected = artifact.get("sha256")
        if expected:
            content = artifact.get("content", "")
            if not isinstance(content, str):
                fail(f"sha256_mismatch:{name}")
                continue
            actual = hashlib.sha256(content.encode("utf-8")).hexdigest()
            if actual != expected:
                fail(f"sha256_mismatch:{name}")

    rules.append("execution_mode_label")
    mode = meta.get("execution_mode")
    if mode is not None and mode not in {"real", "mock"}:
        fail(f"invalid_execution_mode:{mode}")
    if mode == "mock":
        warn("mock_execution_mode")
    if meta.get("status") == "failed":
        fail(f"plugin_failed:{meta.get('reason', 'unknown reason')}")

    # --- Domain checks --------------------------------------------------
    validation_doc = documents.get("validation.json")
    if tool_id in {"sequence-stats.validate", "sequence-stats.profile"}:
        rules.append("validation_counts_consistent")
        if isinstance(validation_doc, dict):
            _check_validation_counts(validation_doc, fail)
        elif validation_doc is not None:
            fail("validation_document_not_object")

    if tool_id == "sequence-stats.profile":
        statistics_doc = documents.get("statistics.json")
        if isinstance(statistics_doc, dict):
            rules.append("dna_gc_percent_in_range_and_consistent")
            rows = statistics_doc.get("records", [])
            for row in rows:
                percent = row.get("gc_percent")
                if percent is None:
                    continue
                if not isinstance(percent, (int, float)) or isinstance(percent, bool):
                    fail(f"invalid_gc_percent:{row.get('id')}")
                    continue
                if not (0 <= percent <= 100):
                    fail(f"gc_percent_out_of_range:{row.get('id')}")
                canonical = row.get("canonical_count", 0)
                if isinstance(canonical, (int, float)) and canonical > 0:
                    expected = round(
                        (row.get("count_G", 0) + row.get("count_C", 0))
                        / canonical
                        * 100,
                        4,
                    )
                    if abs(expected - percent) > 0.001:
                        fail(f"gc_percent_inconsistent:{row.get('id')}")

            rules.append("statistics_summary_counts_consistent")
            summary = statistics_doc.get("summary", {})
            checks = {
                "total_records": validation_doc.get("total_records")
                if isinstance(validation_doc, dict)
                else None,
                "valid_records": validation_doc.get("valid_records")
                if isinstance(validation_doc, dict)
                else None,
            }
            for key, expected in checks.items():
                if summary.get(key) != expected:
                    fail(f"statistics_summary_mismatch:{key}")
            if summary.get("analyzed_records") != len(rows):
                fail("statistics_summary_mismatch:analyzed_records")
            if summary.get("total_length") != sum(row.get("length", 0) for row in rows):
                fail("statistics_summary_mismatch:total_length")
            nucleotides = summary.get("nucleotide_counts")
            if isinstance(nucleotides, dict):
                for base, expected in nucleotides.items():
                    actual = sum(row.get(f"count_{base}", 0) for row in rows)
                    if actual != expected:
                        fail(f"statistics_summary_mismatch:count_{base}")
        elif statistics_doc is not None:
            fail("statistics_document_not_object")

    if tool_id == "microbiome-16s.blast-parse":
        document = documents.get("blast_analysis.json")
        analysis = document.get("analysis", {}) if isinstance(document, dict) else {}
        summary = analysis.get("summary", {}) if isinstance(analysis, dict) else {}
        rules.append("blast_summary_counts_consistent")
        if summary:
            if summary.get("total_rows") != summary.get("valid_rows", 0) + summary.get(
                "malformed_rows", 0
            ):
                fail("blast_summary_rows_inconsistent")
            if summary.get("displayed_rows", 0) > summary.get("passing_rows", 0):
                fail("blast_displayed_exceeds_passing")
            if summary.get("unique_queries", 0) > summary.get("total_queries", 0):
                fail("blast_query_counts_inconsistent")

    if tool_id == "microbiome-16s.taxonomy":
        document = documents.get("taxonomy_analysis.json")
        if isinstance(document, dict):
            rules.append("taxonomy_verdict_has_evidence")
            entries = dict(document.get("per_query") or {})
            entries.update(document.get("no_hit_queries") or {})
            all_identities: list[Any] = []
            for query_id, entry in entries.items():
                verdict = (entry or {}).get("verdict", {}) or {}
                consensus = (entry or {}).get("consensus", {}) or {}
                evidence = consensus.get("evidence") or []
                status = verdict.get("status")
                if status in _POSITIVE_VERDICTS and not evidence:
                    fail(f"verdict_without_evidence:{query_id}")
                for item in evidence:
                    all_identities.append(item.get("pident"))

            rules.append("suspicious_taxonomy_patterns")
            summary = document.get("summary", {}) or {}
            total_queries = summary.get("total_queries", 0)
            if total_queries and summary.get("queries_without_hits") == total_queries:
                warn("all_queries_no_hit")
            if all_identities and all(value == 100 for value in all_identities):
                warn("all_identities_100_percent")
            if document.get("blast_input_quality", {}).get("malformed_rows", 0):
                warn("malformed_blast_rows")
        elif document is not None:
            fail("taxonomy_document_not_object")

    flags = fail_flags + warn_flags
    if fail_flags:
        status = "fail"
    elif warn_flags:
        status = "warn"
    else:
        status = "pass"
    return {"status": status, "flags": flags, "checked_rules": rules}


__all__ = ["REQUIRED_ARTIFACTS", "validate"]
