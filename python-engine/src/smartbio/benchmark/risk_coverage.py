"""Risk-coverage sweep: species call rate vs wrong rate across screening thresholds.

Conservative screening: a species is called only when a single species has a
top hit at or above the threshold with sufficient query coverage. All cases
are evaluated from shared fixtures; no performance claim is made from them.
"""
from __future__ import annotations
import json
from pathlib import Path
from typing import Any


def _norm(name: str | None) -> str:
    return " ".join((name or "").split()).lower()


def evaluate_case(case: dict[str, Any], threshold: float, min_coverage: float = 80.0) -> dict[str, bool]:
    species = case.get("top_species")
    identity = case.get("top_identity")
    coverage = case.get("top_query_coverage", case.get("query_coverage"))
    call = False
    correct = False
    if species and identity is not None and (coverage is None or coverage >= min_coverage) and identity >= threshold:
        call = True
        correct = _norm(species) == _norm(case.get("true_species"))
    return {"call": call, "correct": correct, "wrong": call and not correct}


def sweep(cases: list[dict[str, Any]], thresholds: list[float], min_coverage: float = 80.0) -> list[dict[str, Any]]:
    rows = []
    n = len(cases)
    for t in thresholds:
        evals = [evaluate_case(c, t, min_coverage) for c in cases]
        calls = sum(1 for e in evals if e["call"])
        correct = sum(1 for e in evals if e["correct"])
        wrong = sum(1 for e in evals if e["wrong"])
        rows.append({
            "species_threshold": t,
            "species_call_rate": round(calls / n, 4) if n else None,
            "wrong_rate_among_calls": round(wrong / calls, 4) if calls else None,
            "wrong_rate_overall": round(wrong / n, 4) if n else None,
            "calls": calls,
            "wrong": wrong,
        })
    return rows


def load_shared_cases() -> list[dict[str, Any]]:
    p = Path(__file__).resolve().parents[4] / "shared/test-cases/risk_coverage_cases.json"
    return json.loads(p.read_text(encoding="utf-8"))["cases"]

