"""Plugin adapters for FASTA validation and sequence statistics.

Both adapters call the existing ``smartbio.fasta`` and ``smartbio.statistics``
functions directly. All reported numbers come from those functions.
"""

from __future__ import annotations

from typing import Any

from smartbio.fasta import parse_fasta_file, validate_records
from smartbio.statistics import calculate_statistics, statistics_dataframe

from smartbio.plugins import (
    dataframe_csv_string,
    failure_result,
    json_artifact,
    write_input,
)

_TOOL_VERSION = "1.0.0"
_LIMITATIONS = [
    "Statistics include valid, non-empty records only.",
    "DNA GC percentage uses canonical A/C/G/T bases as its denominator; ambiguous bases are excluded.",
    "FASTA input does not contain per-base sequencing quality scores.",
]


def _sequence_type(step: dict[str, Any]) -> str:
    value = str((step.get("params") or {}).get("sequence_type", "dna")).lower().strip()
    if value not in {"dna", "protein"}:
        raise ValueError("sequence_type must be either 'dna' or 'protein'.")
    return value


class _BaseSequenceAdapter:
    VERSION = _TOOL_VERSION
    _functions: tuple[str, ...] = ()

    def _prepare(
        self, step: dict[str, Any], inputs: dict[str, Any], context: dict[str, Any]
    ) -> tuple[dict[str, Any] | None, str | None]:
        """Stage the FASTA and validate it with the real smartbio functions."""
        fasta_text = inputs.get("fasta_text")
        if not isinstance(fasta_text, str) or not fasta_text.strip():
            return None, "No FASTA text was provided in job inputs."
        try:
            path = write_input(context["workspace"], "input.fasta", fasta_text)
        except (ValueError, OSError) as exc:
            return None, f"Could not stage FASTA input: {exc}"
        try:
            sequence_type = _sequence_type(step)
            parsed = parse_fasta_file(path)
            validation = validate_records(parsed, sequence_type)
        except (ValueError, OSError, RuntimeError) as exc:
            return None, f"FASTA validation failed: {exc}"
        return {
            "sequence_type": sequence_type,
            "validation": validation,
            "filename": inputs.get("filename") or path.name,
        }, None

    def _meta(self, step, prepared, artifacts) -> dict[str, Any]:
        return {
            "status": "succeeded",
            "tool_id": self.TOOL_ID,
            "version": self.VERSION,
            "execution_mode": "real",
            "functions": list(self._functions),
            "parameters": {"sequence_type": prepared["sequence_type"]},
            "input_file": prepared["filename"],
            "artifact_names": [a["name"] for a in artifacts],
            "required_artifacts": [a["name"] for a in artifacts],
            "limitations": list(_LIMITATIONS),
            "logs": [],
        }


class SequenceValidatePlugin(_BaseSequenceAdapter):
    """Adapter for ``sequence-stats.validate``."""

    TOOL_ID = "sequence-stats.validate"
    _functions = ("smartbio.fasta.parse_fasta_file", "smartbio.fasta.validate_records")

    def run(
        self, step: dict[str, Any], inputs: dict[str, Any], context: dict[str, Any]
    ) -> dict[str, Any]:
        prepared, reason = self._prepare(step, inputs, context)
        if reason is not None:
            return failure_result(self, reason, limitations=_LIMITATIONS)
        artifacts = [json_artifact("validation.json", prepared["validation"])]
        return {
            "artifacts": artifacts,
            "tool_run_meta": self._meta(step, prepared, artifacts),
        }


class SequenceProfilePlugin(_BaseSequenceAdapter):
    """Adapter for ``sequence-stats.profile``."""

    TOOL_ID = "sequence-stats.profile"
    _functions = (
        "smartbio.fasta.parse_fasta_file",
        "smartbio.fasta.validate_records",
        "smartbio.statistics.calculate_statistics",
        "smartbio.statistics.statistics_dataframe",
        "smartbio.exports.write_csv",
    )

    def run(
        self, step: dict[str, Any], inputs: dict[str, Any], context: dict[str, Any]
    ) -> dict[str, Any]:
        prepared, reason = self._prepare(step, inputs, context)
        if reason is not None:
            return failure_result(self, reason, limitations=_LIMITATIONS)
        validation = prepared["validation"]
        statistics = calculate_statistics(validation)
        analysis = {
            "tool": "Smart Bioinformatics Toolkit",
            "tool_version": self.VERSION,
            "input_file": str(prepared["filename"]),
            "sequence_type": prepared["sequence_type"],
            "validation": validation,
            "statistics": statistics,
            "notes": list(_LIMITATIONS),
        }
        csv_text = dataframe_csv_string(
            statistics_dataframe(statistics), context["workspace"], "statistics.csv"
        )
        artifacts = [
            json_artifact("validation.json", validation),
            json_artifact("statistics.json", statistics),
            json_artifact("analysis.json", analysis),
            {"name": "statistics.csv", "kind": "csv", "content": csv_text},
        ]
        return {
            "artifacts": artifacts,
            "tool_run_meta": self._meta(step, prepared, artifacts),
        }


__all__ = ["SequenceValidatePlugin", "SequenceProfilePlugin"]
