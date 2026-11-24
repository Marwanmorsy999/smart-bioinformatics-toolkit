"""FR-8.6 Education mode: explain cautions and insufficient-evidence outcomes.

Every note states the rule/threshold that caused the outcome, why the evidence
was insufficient, what evidence would help, and a reference key taken only
from the curated, verified ledger in :mod:`smartbio.aiagent.explanation`.
When no verified reference exists the key is ``null``; an abstention is never
converted into a positive conclusion.
"""

from __future__ import annotations

import json
from typing import Any

from smartbio.aiagent.explanation import REFERENCES
from smartbio.taxonomy.verdict import (
    DEFAULT_MIN_COVERAGE,
    DEFAULT_MIN_QUERY_LENGTH,
    DEFAULT_NEAR_THRESHOLD_MARGIN,
    DEFAULT_SPECIES_THRESHOLD,
)

_ABSTENTIONS = {"insufficient_evidence", "below_screening_threshold"}
_UNVERIFIED_16S_KEY = "kim2014_16s_species_threshold"
_VERIFIED_GC_KEY = "smartbio_gc_definition"


def _fmt(value: Any) -> str:
    return f"{value:g}" if isinstance(value, (int, float)) else str(value)


_T = _fmt(DEFAULT_SPECIES_THRESHOLD)
_M = _fmt(DEFAULT_NEAR_THRESHOLD_MARGIN)
_C = _fmt(DEFAULT_MIN_COVERAGE)
_L = _fmt(DEFAULT_MIN_QUERY_LENGTH)

_NEAR_THRESHOLD = (
    f"species screening identity {_T}% with near-threshold margin {_M} percentage "
    "points (docs/SCIENTIFIC_RULES.md, Verdict layer)"
)
_INSUFFICIENT = (
    f"taxonomy evidence rule: at least one informative hit with coverage >= {_C}% "
    "(docs/SCIENTIFIC_RULES.md, Verdict layer)"
)
_BELOW_THRESHOLD = (
    f"species screening identity {_T}% (docs/SCIENTIFIC_RULES.md, Verdict layer)"
)
_COVERAGE = f"minimum query coverage {_C}% (docs/SCIENTIFIC_RULES.md, Verdict layer)"
_LENGTH = f"minimum query length {_L} nt (docs/SCIENTIFIC_RULES.md, Verdict layer)"
_DIFFICULT_GROUP = (
    "difficult-group caution: each group needs a cited source "
    "(docs/SCIENTIFIC_RULES.md, Verdict layer)"
)
_GC = (
    "dna_gc_percent_in_range_and_consistent: 0 <= GC% <= 100, computed as "
    "(G+C)/(A+C+G+T)*100 with a 0.001 consistency tolerance "
    "(docs/SCIENTIFIC_RULES.md, GC percentage)"
)

# rule -> (why_insufficient, what_would_help, candidate reference key)
_RULES: dict[str, tuple[str, str, str | None]] = {
    _NEAR_THRESHOLD: (
        f"The best hit is within {_M} percentage points of the {_T}% screening "
        "reference, an experimental margin. Species-level interpretation is "
        "withheld rather than forced: a small identity difference could flip the call.",
        "Provide full-length, high-coverage BLAST hits whose identity is clearly "
        "separated from the screening reference, with E-value, aligned length and "
        "a type-strain-backed taxonomy mapping under a recorded database release.",
        _UNVERIFIED_16S_KEY,
    ),
    _INSUFFICIENT: (
        "No qualifying BLAST evidence, taxonomy mapping or concordant lineage was "
        "available, so the verdict abstains. The abstention is not converted into "
        "a species identification.",
        "Supply parsed BLAST hits with percent identity, query coverage and a "
        "curated taxonomy map, including database release and type-strain "
        "provenance where available.",
        None,
    ),
    _BELOW_THRESHOLD: (
        f"The best identity is below the {_T}% screening reference, so a "
        "species-level call is not supported. The result stays at genus level or "
        "as an abstention and does not establish a novel species.",
        "Use an independent validated identification method or additional "
        "consistent loci; a single screening reference is not proof of novelty.",
        _UNVERIFIED_16S_KEY,
    ),
    _COVERAGE: (
        "Coverage could not be verified from the supplied data, so the rule "
        "cannot confirm that the alignment spans enough of the query.",
        "Provide query lengths (qlen) in the BLAST TSV so coverage can be computed "
        f"and checked against the {_C}% minimum.",
        None,
    ),
    _LENGTH: (
        "The query is shorter than the minimum length, so similarity evidence is "
        "partial and the call is cautioned rather than conclusive.",
        "Use a full-length sequence, or keep the current result explicitly labelled "
        "as partial-evidence screening.",
        None,
    ),
    "taxonomy_verdict_has_evidence (at least one BLAST hit required)": (
        "Every query lacked hits, so no evidence exists to support any taxonomic "
        "conclusion.",
        "Re-run with a valid BLAST TSV from an appropriate database; verify the "
        "input format and database choice.",
        None,
    ),
    "suspicious_taxonomy_patterns (all identities exactly 100%)": (
        "Every identity is exactly 100%, a pattern that warrants a caution because "
        "it can indicate synthetic or uncurated input rather than independent "
        "evidence.",
        "Check the provenance of the BLAST input and reference database and confirm "
        "the hits are genuine and independently curated.",
        None,
    ),
    "blast_summary_counts_consistent (all rows must parse)": (
        "Malformed BLAST TSV rows were excluded, so the evidence set is incomplete.",
        "Re-export the BLAST TSV with the full 12-column schema and no truncated rows.",
        None,
    ),
    "execution_mode_label (scientific results require mode 'real')": (
        "The run was labelled mock, so its outputs are not valid scientific evidence.",
        "Re-run in real execution mode with the local tools before drawing any "
        "conclusion.",
        None,
    ),
    _DIFFICULT_GROUP: (
        "The candidate belongs to a difficult species group. Group membership "
        "is illustrative and requires a cited source, so species-level identity "
        "is not asserted from this evidence alone.",
        "Provide a cited, curated difficult-group definition and confirm membership "
        "against the reference taxonomy under a recorded database release.",
        None,
    ),
    _GC: (
        "The reported GC percentage is outside the valid range or inconsistent "
        "with the canonical base counts, so the statistic is not accepted as "
        "validated evidence.",
        "Provide a valid DNA FASTA with canonical A/C/G/T counts. Ambiguous bases "
        "are excluded from the denominator and GC% is null when no canonical bases "
        "exist.",
        _VERIFIED_GC_KEY,
    ),
    "validation_contract (doctor validation input, then re-run)": (
        "The validation layer could not complete, so no validated result is available.",
        "Correct the validation input described in the validation flag and re-run "
        "the registered tool.",
        None,
    ),
}

_FLAG_RULES: dict[str, str] = {
    "near_threshold": _NEAR_THRESHOLD,
    "insufficient_evidence": _INSUFFICIENT,
    "below_screening_threshold": _BELOW_THRESHOLD,
    "coverage_unavailable": _COVERAGE,
    "partial_sequence": _LENGTH,
    "all_queries_no_hit": "taxonomy_verdict_has_evidence (at least one BLAST hit required)",
    "all_identities_100_percent": "suspicious_taxonomy_patterns (all identities exactly 100%)",
    "malformed_blast_rows": "blast_summary_counts_consistent (all rows must parse)",
    "mock_execution_mode": "execution_mode_label (scientific results require mode 'real')",
    "difficult_group": _DIFFICULT_GROUP,
    "gc_percent_out_of_range": _GC,
    "gc_percent_inconsistent": _GC,
    "invalid_gc_percent": _GC,
    "validation_error": "validation_contract (doctor validation input, then re-run)",
}


def _verified(key: str | None) -> str | None:
    """Emit a reference key only when the curated ledger marks it verified."""
    if not key:
        return None
    entry = REFERENCES.get(key)
    return key if entry and entry.get("verified") is True else None


def _note(
    rule: str, why: str, help_text: str, reference_key: str | None
) -> dict[str, Any]:
    """A note has exactly the four FR-8.6 fields."""
    return {
        "rule_or_threshold": rule,
        "why_insufficient": why,
        "what_would_help": help_text,
        "verified_reference": _verified(reference_key),
    }


class _Notes:
    """Ordered, de-duplicated collection keyed by rule."""

    def __init__(self) -> None:
        self._items: dict[str, dict[str, Any]] = {}

    def add(self, rule: str, *, extra: str = "") -> None:
        if rule in self._items:
            if extra and extra not in self._items[rule]["why_insufficient"]:
                self._items[rule]["why_insufficient"] += " " + extra
            return
        spec = _RULES.get(rule)
        if spec is None:  # plugin-supplied flag: no invented rule or threshold
            spec = (
                "The deterministic validation layer flagged this run, and no "
                "curated rule text is available for it.",
                "Resolve the validation flag and re-run the registered tool; no "
                "conclusion is inferred from a flagged result.",
                None,
            )
        full_why = spec[0] + (" " + extra if extra else "")
        self._items[rule] = _note(rule, full_why, spec[1], spec[2])

    def as_list(self) -> list[dict[str, Any]]:
        return list(self._items.values())


def _flag_spec(flag: str) -> tuple[str, str]:
    """Return (rule, extra reason) for a validation flag."""
    name = flag.split(":", 1)[0]
    if name.startswith("difficult_group"):
        name = "difficult_group"
    if name in _FLAG_RULES:
        return _FLAG_RULES[name], flag
    if name.startswith("gc_percent") or name.startswith("invalid_gc"):
        return _GC, flag
    if name.startswith("validation_error"):
        return "validation_contract (doctor validation input, then re-run)", flag
    return f"validation flag: {name}", flag


def _taxonomy_specs(
    artifacts: list[dict[str, Any]],
) -> list[tuple[str, str]]:
    """Extract rules and reasons from taxonomy verdicts and caution flags."""
    specs: list[tuple[str, str]] = []
    for artifact in artifacts or []:
        name = str(artifact.get("name", ""))
        if not name.endswith("taxonomy_analysis.json"):
            continue
        try:
            document = json.loads(artifact.get("content", ""))
        except (TypeError, ValueError, json.JSONDecodeError):
            continue
        if not isinstance(document, dict):
            continue
        entries: dict[str, Any] = {}
        entries.update(document.get("per_query") or {})
        entries.update(document.get("no_hit_queries") or {})
        reasons: list[str] = []
        cautions: set[str] = set()
        abstained = False
        for entry in entries.values():
            verdict = (entry or {}).get("verdict") or {}
            status = verdict.get("status")
            if status in _ABSTENTIONS:
                abstained = True
                reasons.extend(str(item) for item in verdict.get("reasons") or [])
            for caution in verdict.get("caution_flags") or []:
                cautions.add(str(caution))
            for item in (entry or {}).get("flags") or []:
                label = str(item)
                if label == "insufficient_evidence":
                    abstained = True
                else:
                    cautions.add(label)
        extra = " ".join(dict.fromkeys(reasons))
        if abstained:
            specs.append((_INSUFFICIENT, extra))
        for caution in sorted(cautions):
            key = caution.split(":", 1)[0]
            rule = _FLAG_RULES.get(key)
            if rule:
                specs.append((rule, extra))
    return specs


def build_education(
    step: dict[str, Any],
    artifacts: list[dict[str, Any]],
    validation: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Build FR-8.6 education notes for cautions and abstentions in one run."""
    validation = validation or {}
    notes = _Notes()
    for flag in validation.get("flags") or []:
        rule, extra = _flag_spec(str(flag))
        notes.add(rule, extra=extra)
    for rule, extra in _taxonomy_specs(artifacts or []):
        notes.add(rule, extra=extra)
    return {"notes": notes.as_list()}


__all__ = ["build_education"]
