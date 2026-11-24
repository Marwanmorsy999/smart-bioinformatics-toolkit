"""Deterministic, evidence-bounded explanation builder and checker.

Every finding cites an artifact name and a field path; every numeric value in
the prose is copied from a validated artifact. Citations are limited to a
curated local reference table.
"""

from __future__ import annotations

import copy
import json
import re
from typing import Any

from smartbio.aiagent.llm import provider_from_env

# Curated local reference ledger. Only entries with ``verified: true`` may be
# emitted. The 16S threshold paper is mentioned in the smartbio source but its
# bibliographic details are NOT verified in-tree, so it stays unverified.
REFERENCES: dict[str, dict[str, Any]] = {
    "smartbio_gc_definition": {
        "key": "smartbio_gc_definition",
        "title": "Smart Bioinformatics Toolkit: DNA GC percentage definition",
        "url": "python-engine/src/smartbio/statistics.py#calculate_statistics",
        "verified": True,
        "verified_by": "in-tree source: smartbio/statistics.py::calculate_statistics",
    },
    "kim2014_16s_species_threshold": {
        "key": "kim2014_16s_species_threshold",
        "title": "16S rRNA gene sequence similarity and species demarcation",
        "url": "https://pubmed.ncbi.nlm.nih.gov/24505072/",
        "verified": False,
        "verified_by": None,
        "note": "Referenced in smartbio source comments; bibliographic details not verified in-tree.",
    },
}

_NUMBER_RE = re.compile(r"-?\d+(?:\.\d+)?")


def _documents(artifacts: list[dict[str, Any]]) -> dict[str, Any]:
    documents: dict[str, Any] = {}
    for artifact in artifacts:
        name = str(artifact.get("name", ""))
        if not name or (artifact.get("kind") != "json" and not name.endswith(".json")):
            continue
        try:
            documents[name] = json.loads(artifact.get("content", ""))
        except (TypeError, ValueError, json.JSONDecodeError):
            continue
    return documents


def _finding(text: str, artifact: str, field_path: str) -> dict[str, str]:
    return {"text": text, "artifact": artifact, "field_path": field_path}


def _hint_findings(
    evidence_hints: Any, documents: dict[str, Any]
) -> list[dict[str, str]]:
    """Resolve plugin-supplied hints against cited artifact fields.

    A hint is ``{text_template, artifact, field_path}`` (``label`` is also
    accepted). The only interpolated value is the cited field value, so every
    number in the resulting text is grounded in that field. Unresolvable hints
    are skipped: they never turn into free-standing claims.
    """
    findings: list[dict[str, str]] = []
    if not isinstance(evidence_hints, (list, tuple)):
        return findings
    for hint in evidence_hints:
        if not isinstance(hint, dict):
            continue
        name = str(hint.get("artifact", ""))
        field_path = str(hint.get("field_path", ""))
        if not name or not field_path or name not in documents:
            continue
        try:
            value = _resolve(documents[name], field_path)
        except (KeyError, TypeError, IndexError):
            continue
        rendered = _value_text(value)
        template = hint.get("text_template")
        label = hint.get("label")
        if isinstance(template, str) and template.strip():
            try:
                text = template.format(value=rendered)
            except (KeyError, IndexError, ValueError):
                continue
        elif isinstance(label, str) and label.strip():
            text = f"{label.strip()}: {rendered}."
        else:
            continue
        text = str(text).strip()
        if text:
            findings.append(_finding(text, name, field_path))
    return findings


def build_explanation(
    step: dict[str, Any],
    artifacts: list[dict[str, Any]],
    validation: dict[str, Any],
    limitations: list[str] | None = None,
    plan_limitations: list[str] | None = None,
    evidence_hints: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    """Build a deterministic explanation from validated artifact fields.

    ``evidence_hints`` is the plugin-agnostic extension seam: any adapter can
    supply cited findings in ``tool_run_meta`` without editing this module.
    Existing tool IDs keep their original branches and behaviour.
    """
    docs = _documents(artifacts)
    tool_id = str(step.get("tool_id", ""))
    findings: list[dict[str, str]] = []
    references: list[dict[str, Any]] = []
    summary: str

    if validation.get("status") == "fail":
        summary = "No validated result is available; see the validation flags for the reason."
        uncertainty = "high"
    elif tool_id == "sequence-stats.profile":
        summary = (
            "Local sequence statistics were computed from the validated FASTA; "
            "the values below are copied from the validated artifacts."
        )
        validation_doc = docs.get("validation.json") or {}
        statistics_doc = docs.get("statistics.json") or {}
        stats_summary = statistics_doc.get("summary") or {}
        if "valid_records" in validation_doc and "total_records" in validation_doc:
            findings.append(
                _finding(
                    "Validation reported "
                    f"{validation_doc['valid_records']} valid records out of "
                    f"{validation_doc['total_records']} total records.",
                    "validation.json",
                    "valid_records",
                )
            )
        if stats_summary.get("gc_percent_mean") is not None:
            findings.append(
                _finding(
                    "Mean GC content over analyzed records is "
                    f"{stats_summary['gc_percent_mean']} percent of canonical bases.",
                    "statistics.json",
                    "summary.gc_percent_mean",
                )
            )
        if "total_length" in stats_summary:
            findings.append(
                _finding(
                    f"Analyzed records span {stats_summary['total_length']} nucleotides in total.",
                    "statistics.json",
                    "summary.total_length",
                )
            )
        if "analyzed_records" in stats_summary:
            findings.append(
                _finding(
                    f"Statistics were calculated for {stats_summary['analyzed_records']} records.",
                    "statistics.json",
                    "summary.analyzed_records",
                )
            )
        references.append(_reference_projection(REFERENCES["smartbio_gc_definition"]))
        uncertainty = "low" if validation.get("status") == "pass" else "moderate"
    elif tool_id == "sequence-stats.validate":
        summary = "The FASTA validation result below is copied from the validated artifact."
        validation_doc = docs.get("validation.json") or {}
        if "valid_records" in validation_doc and "total_records" in validation_doc:
            findings.append(
                _finding(
                    f"{validation_doc['valid_records']} of {validation_doc['total_records']} "
                    "records passed validation.",
                    "validation.json",
                    "valid_records",
                )
            )
        uncertainty = "low" if validation.get("status") == "pass" else "moderate"
    elif tool_id == "microbiome-16s.blast-parse":
        summary = "BLAST TSV parsing was performed locally; counts below are copied from the artifact."
        document = docs.get("blast_analysis.json") or {}
        blast_summary = (document.get("analysis") or {}).get("summary") or {}
        for key, label in (
            ("total_rows", "Total BLAST rows"),
            ("valid_rows", "Valid rows"),
            ("unique_queries", "Unique queries"),
        ):
            if key in blast_summary:
                findings.append(
                    _finding(
                        f"{label}: {blast_summary[key]}.",
                        "blast_analysis.json",
                        f"analysis.summary.{key}",
                    )
                )
        uncertainty = "moderate"
    elif tool_id == "microbiome-16s.taxonomy":
        summary = (
            "Taxonomy assignments are interpretations of the supplied BLAST evidence, "
            "not proof of species identity."
        )
        document = docs.get("taxonomy_analysis.json") or {}
        tax_summary = document.get("summary") or {}
        for key, label in (
            ("total_queries", "Queries considered"),
            ("queries_with_hits", "Queries with hits"),
            ("queries_without_hits", "Queries without hits"),
        ):
            if key in tax_summary:
                findings.append(
                    _finding(
                        f"{label}: {tax_summary[key]}.",
                        "taxonomy_analysis.json",
                        f"summary.{key}",
                    )
                )
        uncertainty = "high" if validation.get("status") == "fail" else "moderate"
    elif isinstance(evidence_hints, (list, tuple)):
        findings = _hint_findings(evidence_hints, docs)
        if findings:
            summary = (
                "Findings below were resolved from cited artifact fields supplied "
                "by the plugin; no control-plane tool-specific logic was used."
            )
            uncertainty = "moderate" if validation.get("status") == "pass" else "high"
        else:
            summary = "No interpretable finding could be resolved from the supplied evidence hints."
            uncertainty = "high"
    else:
        summary = "No registered adapter produced interpretable findings for this step."
        uncertainty = "high"

    merged_limitations: list[str] = []
    for item in list(limitations or []) + list(plan_limitations or []):
        if item and item not in merged_limitations:
            merged_limitations.append(item)

    return {
        "summary": summary,
        "findings": findings,
        "limitations": merged_limitations,
        "references": references,
        "uncertainty": uncertainty,
    }


def _reference_projection(entry: dict[str, Any]) -> dict[str, Any]:
    """Only these four fields are emitted for a citation (contract §3)."""
    return {key: entry.get(key) for key in ("key", "title", "url", "verified")}


def _numbers_in_text(text: Any) -> list[float]:
    """Extract numeric tokens, ignoring identifiers such as ``16S``."""
    source = str(text or "")
    numbers: list[float] = []
    for match in _NUMBER_RE.finditer(source):
        start, end = match.span()
        before = source[start - 1] if start > 0 else ""
        after = source[end] if end < len(source) else ""
        if before.isalnum() or before == "_" or after.isalnum() or after == "_":
            continue
        try:
            numbers.append(float(match.group()))
        except ValueError:
            continue
    return numbers


def _value_text(value: Any) -> str:
    if isinstance(value, str):
        return value
    try:
        return json.dumps(value, indent=2, sort_keys=True, ensure_ascii=False)
    except (TypeError, ValueError):
        return str(value)


def _allowed_numbers(value: Any) -> set[float]:
    """Numbers that may legitimately appear when citing this field value."""
    allowed = set(_numbers_in_text(_value_text(value)))
    if isinstance(value, bool):
        return allowed
    if isinstance(value, (int, float)):
        allowed.add(float(value))
    elif isinstance(value, dict):
        for child in value.values():
            allowed.update(_allowed_numbers(child))
    elif isinstance(value, (list, tuple)):
        for child in value:
            allowed.update(_allowed_numbers(child))
    return allowed


def _resolve(document: Any, field_path: str) -> Any:
    current = document
    for part in field_path.split("."):
        if isinstance(current, dict) and part in current:
            current = current[part]
        elif isinstance(current, list) and part.isdigit() and int(part) < len(current):
            current = current[int(part)]
        else:
            raise KeyError(field_path)
    return current


def check_explanation(
    explanation: dict[str, Any], artifacts: list[dict[str, Any]]
) -> dict[str, Any]:
    """Reject ungrounded numbers and unverified citations.

    Finding numbers are checked against the *cited field value only* (with
    equivalent formats such as ``50``/``50.0`` accepted). Limitations must use
    numbers that are actually cited by a finding.
    """
    errors: list[str] = []
    documents = _documents(artifacts)
    all_document_numbers: set[float] = set()
    for document in documents.values():
        all_document_numbers.update(_allowed_numbers(document))

    def check_text(text: Any, where: str, allowed: set[float]) -> None:
        for number in _numbers_in_text(text):
            if not any(abs(number - known) < 1e-6 for known in allowed):
                errors.append(f"unsupported_number:{where}:{number:g}")

    # The summary has no field reference of its own; require its numbers to be
    # present in the validated artifacts.
    check_text(explanation.get("summary", ""), "summary", all_document_numbers)

    cited_numbers: set[float] = set()
    findings = explanation.get("findings", [])
    if not isinstance(findings, list):
        errors.append("findings_not_list")
        findings = []
    for index, finding in enumerate(findings):
        where = f"finding[{index}]"
        if not isinstance(finding, dict):
            errors.append(f"invalid_finding:{where}")
            continue
        name = str(finding.get("artifact", ""))
        field_path = str(finding.get("field_path", ""))
        if not name or not field_path:
            errors.append(f"missing_evidence_reference:{where}")
            continue
        if name not in documents:
            errors.append(f"unknown_artifact:{where}:{name}")
            continue
        try:
            cited_value = _resolve(documents[name], field_path)
        except (KeyError, TypeError, IndexError):
            errors.append(f"unknown_field_path:{where}:{field_path}")
            continue
        allowed = _allowed_numbers(cited_value)
        cited_numbers.update(allowed)
        check_text(finding.get("text", ""), where, allowed)

    limitations = explanation.get("limitations", [])
    if not isinstance(limitations, list):
        errors.append("limitations_not_list")
    else:
        for index, limitation in enumerate(limitations):
            check_text(limitation, f"limitations[{index}]", cited_numbers)

    references = explanation.get("references", [])
    if not isinstance(references, list):
        errors.append("references_not_list")
        references = []
    for index, reference in enumerate(references):
        if not isinstance(reference, dict):
            errors.append(f"invalid_reference:ref[{index}]")
            continue
        key = str(reference.get("key", ""))
        entry = REFERENCES.get(key)
        if entry is None:
            errors.append(f"unverified_reference:ref[{index}]:{key}")
            continue
        if not isinstance(reference.get("verified"), bool):
            errors.append(f"invalid_reference_metadata:ref[{index}]:{key}")
            continue
        if reference != _reference_projection(entry):
            errors.append(f"reference_metadata_mismatch:ref[{index}]:{key}")
            continue
        if entry.get("verified") is not True:
            errors.append(f"unverified_reference:ref[{index}]:{key}")

    return {"ok": not errors, "errors": errors}


_LLM_SYSTEM = (
    "You are a phrasing editor for a scientific report. Rephrase the supplied "
    "summary and finding texts into clearer prose. Preserve every number, "
    "citation and meaning exactly. Do not add numbers, facts or citations. Do "
    "not discuss raw sequences or uploaded data. Reply with JSON only, shaped "
    'as {"summary": string, "findings": [string, ...]} with exactly the same '
    "number of findings, in the same order."
)
_LLM_LIMITATION = (
    "An external language model assisted with phrasing; scientific values "
    "remain those of the validated artifacts."
)


def _parse_llm_json(text: str) -> Any:
    """Parse the model reply, tolerating a markdown JSON fence."""
    candidate = text.strip()
    if candidate.startswith("```"):
        candidate = candidate.strip("`").strip()
        if candidate.lower().startswith("json"):
            candidate = candidate[4:].strip()
    return json.loads(candidate)


def apply_llm_phrasing(
    explanation: dict[str, Any], artifacts: list[dict[str, Any]]
) -> tuple[dict[str, Any], list[str]]:
    """Optionally rephrase validated prose; never bypass the evidence gates.

    Returns ``(explanation, validation_flags)``. Without explicit opt-in this
    is a no-op and performs no network call.
    """
    provider = provider_from_env()
    findings = explanation.get("findings") or []
    if provider is None or not findings:
        return explanation, []

    # The prompt contains only artifact-derived, already-validated text.
    prompt = json.dumps(
        {
            "summary": explanation.get("summary", ""),
            "findings": [finding.get("text", "") for finding in findings],
        },
        ensure_ascii=False,
    )
    try:
        reply = provider.chat(_LLM_SYSTEM, prompt)
        payload = _parse_llm_json(reply)
        new_summary = payload["summary"]
        new_texts = payload["findings"]
        if not isinstance(new_summary, str) or not isinstance(new_texts, list):
            raise ValueError("unexpected LLM reply shape")
        if len(new_texts) != len(findings) or not all(
            isinstance(text, str) and text.strip() for text in new_texts
        ):
            raise ValueError("unexpected LLM finding count")
    except Exception:
        # Timeouts, malformed JSON and provider errors all fall back silently.
        return explanation, ["llm_phrase_rejected"]

    candidate = copy.deepcopy(explanation)
    candidate["summary"] = new_summary
    for finding, text in zip(candidate["findings"], new_texts):
        finding["text"] = text
    candidate["limitations"] = list(candidate.get("limitations") or []) + [_LLM_LIMITATION]
    candidate["metadata"] = {"phrasing_model": provider.name, "llm_used": True}

    if not check_explanation(candidate, artifacts)["ok"]:
        return explanation, ["llm_phrase_rejected"]
    return candidate, []


__all__ = [
    "REFERENCES",
    "build_explanation",
    "check_explanation",
    "apply_llm_phrasing",
]
