"""Compare the naive top-hit method with the verdict layer against known truth.

Inputs are a ``taxonomy_analysis.json`` produced by ``main.py taxonomy`` and a
truth table (query id -> true species). Truth is never inferred.

Reported per method:

* top-hit method: always calls the species of the highest-bitscore hit.
* verdict method: calls a species only for ``species_supported`` verdicts and
  otherwise abstains (group, genus, below threshold, insufficient evidence).

The key number is the *wrong species call* rate: how often a method asserts a
species that is not the truth. Abstaining is not an error, but the *species
call rate* is reported so abstention cannot hide as accuracy.
"""

from __future__ import annotations

from typing import Any

import math
from smartbio.taxonomy.verdict import DEFAULT_SPECIES_THRESHOLD


def parse_truth_text(text: str) -> dict[str, str]:
    """Parse a two-column TSV: query_id<TAB>true_species (header optional)."""
    truth: dict[str, str] = {}
    for line_no, raw in enumerate(text.splitlines(), start=1):
        line = raw.strip().lstrip("\ufeff")
        if not line or line.startswith("#"):
            continue
        parts = line.split("\t")
        if len(parts) < 2:
            raise ValueError(f"Truth line {line_no}: expected 2 tab-separated columns")
        query_id, species = parts[0].strip(), parts[1].strip()
        if query_id.lower() == "query_id" and species.lower() in {"true_species", "species"}:
            continue
        if query_id in truth:
            raise ValueError(f"Truth line {line_no}: duplicate query id {query_id!r}")
        truth[query_id] = species
    return truth


def _norm(name: str | None) -> str:
    return " ".join((name or "").split()).lower()


def _genus(species: str) -> str:
    return _norm(species).split(" ")[0] if species else ""


def _top_hit_species(entry: dict[str, Any]) -> str | None:
    evidence = entry["consensus"].get("evidence") or []
    if not evidence:
        return None
    ranked = sorted(
        evidence,
        key=lambda e: (
            -(e.get("bitscore") if e.get("bitscore") is not None else 0),
            -(e.get("pident") if e.get("pident") is not None else 0),
        ),
    )
    lineage = ranked[0].get("lineage") or {}
    species = (lineage.get("ranks") or {}).get("species")
    return species.get("name") if species else None


def _rate(num: int, den: int) -> float | None:
    return round(num / den, 4) if den else None


def wilson_interval(successes: int, trials: int, z: float = 1.959964) -> tuple[float, float] | None:
    """Wilson score 95% confidence interval for a proportion (two-sided 95%)."""
    if trials <= 0:
        return None
    if successes < 0 or successes > trials:
        raise ValueError("successes must be between 0 and trials")
    phat = successes / trials
    z2 = z * z
    denom = 1.0 + z2 / trials
    centre = (phat + z2 / (2.0 * trials)) / denom
    half = (z / denom) * math.sqrt(phat * (1.0 - phat) / trials + z2 / (4.0 * trials * trials))
    return (round(max(0.0, centre - half), 4), round(min(1.0, centre + half), 4))


def evaluate_benchmark(
    analysis: dict[str, Any],
    truth: dict[str, str],
    groups: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    """Evaluate every truth query present in the analysis.

    ``groups`` are the difficult-group definitions used to check whether a
    group-level verdict actually contains the true species.
    """
    group_members = {g.get("id"): list(g.get("species", [])) for g in (groups or [])}
    entries: dict[str, dict[str, Any]] = {}
    entries.update(analysis.get("per_query", {}))
    entries.update(analysis.get("no_hit_queries", {}))

    missing = sorted(q for q in truth if q not in entries)
    rows: list[dict[str, Any]] = []
    for qid in sorted(truth):
        if qid not in entries:
            continue
        entry = entries[qid]
        verdict = entry["verdict"]
        true_species = truth[qid]
        top_species = _top_hit_species(entry)

        top_correct = top_species is not None and _norm(top_species) == _norm(true_species)
        v_status = verdict["status"]
        v_species = verdict["reported_taxon"] if v_status == "species_supported" else None
        v_species_correct = v_species is not None and _norm(v_species) == _norm(true_species)

        reported_genus = None
        if verdict["reported_rank"] == "genus":
            reported_genus = verdict["reported_taxon"]
        elif v_species:
            reported_genus = _genus(v_species)
        genus_correct = (
            reported_genus is not None and _norm(reported_genus) == _genus(true_species)
        )

        group_ok = None
        if v_status == "group_level_only":
            members = {
                _norm(sp)
                for g in verdict.get("difficult_groups", [])
                for sp in group_members.get(g.get("id"), [])
            }
            group_ok = _norm(true_species) in members

        rows.append(
            {
                "query_id": qid,
                "true_species": true_species,
                "top_hit_species": top_species,
                "top_hit_correct": top_correct,
                "verdict": v_status,
                "verdict_reported_rank": verdict["reported_rank"],
                "verdict_reported_taxon": verdict["reported_taxon"],
                "verdict_species_call": v_species,
                "verdict_species_correct": v_species_correct,
                "verdict_genus_correct": genus_correct,
                "caution_flags": verdict["caution_flags"],
                "group_contains_truth": group_ok,
            }
        )

    n = len(rows)

    # Baseline (b): plain top hit, only when its identity meets the
    # conservative species screening reference (98.65 by default); otherwise
    # the method abstains (no species call).
    cutoff_rows = []
    for r in rows:
        top_pid = None
        if r["top_hit_species"] is not None:
            for e in (entries[r["query_id"]]["consensus"].get("evidence") or []):
                v = (e.get("lineage") or {}).get("ranks", {}).get("species", {}) or {}
                if _norm(v.get("name", "")) == _norm(r["top_hit_species"]):
                    top_pid = e.get("pident")
                    break
        cutoff_call = r["top_hit_species"] if top_pid is not None and top_pid >= DEFAULT_SPECIES_THRESHOLD else None
        cutoff_correct = cutoff_call is not None and _norm(cutoff_call) == _norm(r["true_species"])
        cutoff_rows.append({**r, "cutoff_species_call": cutoff_call, "cutoff_species_correct": cutoff_correct})

    top_calls = sum(1 for r in rows if r["top_hit_species"] is not None)
    top_correct = sum(1 for r in rows if r["top_hit_correct"])
    top_wrong = top_calls - top_correct

    cut_calls = sum(1 for r in cutoff_rows if r["cutoff_species_call"] is not None)
    cut_correct = sum(1 for r in cutoff_rows if r["cutoff_species_correct"])
    cut_wrong = cut_calls - cut_correct

    v_calls = sum(1 for r in rows if r["verdict_species_call"] is not None)
    v_correct = sum(1 for r in rows if r["verdict_species_correct"])
    v_wrong = v_calls - v_correct

    v_counts: dict[str, int] = {}
    for r in rows:
        v_counts[r["verdict"]] = v_counts.get(r["verdict"], 0) + 1

    group_rows = [r for r in rows if r["group_contains_truth"] is not None]
    group_ok_n = sum(1 for r in group_rows if r["group_contains_truth"])
    abstained = [r for r in rows if r["verdict_species_call"] is None]
    abstain_genus_ok = sum(1 for r in abstained if r["verdict_genus_correct"])

    top_wi = wilson_interval(top_correct, top_calls)
    cut_wi = wilson_interval(cut_correct, cut_calls)
    v_wi = wilson_interval(v_correct, v_calls)

    return {
        "n_evaluated": n,
        "species_screening_threshold": DEFAULT_SPECIES_THRESHOLD,
        "n_truth_without_result": len(missing),
        "truth_without_result": missing,
        "top_hit_method": {
            "species_calls": top_calls,
            "species_call_rate": _rate(top_calls, n),
            "correct": top_correct,
            "wrong": top_wrong,
            "wrong_rate_among_calls": _rate(top_wrong, top_calls),
            "wrong_rate_overall": _rate(top_wrong, n),
            "wilson_95pct_ci_on_correct_rate": top_wi,
        },
        "top_hit_cutoff_method": {
            "species_calls": cut_calls,
            "species_call_rate": _rate(cut_calls, n),
            "correct": cut_correct,
            "wrong": cut_wrong,
            "wrong_rate_among_calls": _rate(cut_wrong, cut_calls),
            "wrong_rate_overall": _rate(cut_wrong, n),
            "wilson_95pct_ci_on_correct_rate": cut_wi,
        },
        "verdict_method": {
            "species_calls": v_calls,
            "species_call_rate": _rate(v_calls, n),
            "correct": v_correct,
            "wrong": v_wrong,
            "wrong_rate_among_calls": _rate(v_wrong, v_calls),
            "wrong_rate_overall": _rate(v_wrong, n),
            "abstained": len(abstained),
            "abstained_with_correct_genus": abstain_genus_ok,
            "group_level_verdicts": len(group_rows),
            "group_level_containing_truth": group_ok_n,
            "verdict_counts": dict(sorted(v_counts.items())),
            "wilson_95pct_ci_on_correct_rate": v_wi,
        },
        "notes": [
            "Wrong species calls are the headline metric; compare it together with the species call rate.",
            "Results depend entirely on the benchmark queries, reference database and taxonomy supplied; "
            "synthetic data demonstrates the pipeline, not real-world accuracy.",
        ],
        "rows": rows,
    }

