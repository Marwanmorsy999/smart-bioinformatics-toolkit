"""Sequence statistics with explicit, documented metric definitions."""

from __future__ import annotations

from collections import Counter
from typing import Any

import pandas as pd


def _n50_l50(lengths: list[int]) -> tuple[int, int]:
    nonzero = sorted((length for length in lengths if length > 0), reverse=True)
    if not nonzero:
        return 0, 0
    halfway = sum(nonzero) / 2
    cumulative = 0
    for index, length in enumerate(nonzero, start=1):
        cumulative += length
        if cumulative >= halfway:
            return length, index
    return nonzero[-1], len(nonzero)


def calculate_statistics(validation_report: dict[str, Any]) -> dict[str, Any]:
    """Calculate metrics over valid, non-empty records only.

    DNA GC percentage uses canonical A/C/G/T symbols as its denominator;
    ambiguous IUPAC symbols are excluded and reported separately.
    """
    sequence_type = validation_report["sequence_type"]
    valid_records = [
        record for record in validation_report.get("records", [])
        if record.get("valid") and record.get("sequence")
    ]

    rows: list[dict[str, Any]] = []
    for record in valid_records:
        sequence = record["sequence"]
        counts = Counter(sequence)
        canonical_count = record.get("canonical_count", 0)
        gc_percent = None
        if sequence_type == "dna" and canonical_count:
            gc_percent = round(((counts["G"] + counts["C"]) / canonical_count) * 100, 4)

        row: dict[str, Any] = {
            "id": record["id"],
            "length": len(sequence),
            "canonical_count": canonical_count,
            "ambiguous_count": record.get("ambiguous_count", 0),
            "gc_percent": gc_percent,
            "valid": True,
        }
        if sequence_type == "dna":
            row.update({f"count_{base}": counts[base] for base in "ATGC"})
        else:
            row["stop_count"] = record.get("stop_count", 0)
        rows.append(row)

    lengths = [row["length"] for row in rows]
    total_length = sum(lengths)
    if sequence_type == "dna":
        n50, l50 = _n50_l50(lengths)
    else:
        n50, l50 = None, None
    summary: dict[str, Any] = {
        "sequence_type": sequence_type,
        "total_records": validation_report.get("total_records", 0),
        "valid_records": validation_report.get("valid_records", 0),
        "invalid_records": validation_report.get("invalid_records", 0),
        "analyzed_records": len(rows),
        "total_length": total_length,
        "minimum_length": min(lengths) if lengths else 0,
        "maximum_length": max(lengths) if lengths else 0,
        "average_length": round(total_length / len(lengths), 4) if lengths else 0,
        "median_length": float(pd.Series(lengths).median()) if lengths else 0,
        "n50": n50,
        "l50": l50,
        "gc_definition": "(G + C) / (A + C + G + T) * 100; ambiguous symbols excluded",
        "gc_percent_mean": None,
    }
    if sequence_type == "dna":
        gc_values = [row["gc_percent"] for row in rows if row["gc_percent"] is not None]
        summary["gc_percent_mean"] = round(sum(gc_values) / len(gc_values), 4) if gc_values else None
        summary["nucleotide_counts"] = {
            base: sum(row.get(f"count_{base}", 0) for row in rows) for base in "ATGC"
        }
    return {"summary": summary, "records": rows}


def statistics_dataframe(statistics_report: dict[str, Any]) -> pd.DataFrame:
    """Convert per-record statistics to a Pandas DataFrame."""
    return pd.DataFrame(statistics_report.get("records", []))
