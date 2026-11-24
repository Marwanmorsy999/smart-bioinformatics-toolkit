"""Plugin adapters for BLAST TSV parsing and 16S taxonomy consensus.

The adapters only call existing ``smartbio.blast`` / ``smartbio.taxonomy``
functions. A real BLAST TSV dataset must be supplied in the job inputs; when it
is missing the adapters return a structured failure instead of inventing hits.
"""

from __future__ import annotations

from typing import Any

from smartbio.blast import analyze_blast, parse_blast_file
from smartbio.blast_runner import find_executable, validate_database
from smartbio.taxonomy import TaxonomyResolver, run_taxonomy_analysis

from smartbio.plugins import failure_result, json_artifact, write_input

_TOOL_VERSION = "1.0.0"
_TSV_KEYS = ("tsv_text", "blast_tsv_text", "blast_text", "blast_tsv")
_BLAST_PARSING_LIMITATIONS = [
    "The adapter parses an existing BLAST TSV; it does not run a new BLAST search.",
    "Parsed similarity is not proof of taxonomic identity.",
]
_TAXONOMY_LIMITATIONS = [
    "16S identity thresholds are screening references, not universal species boundaries.",
    "A verdict interprets BLAST similarity evidence; it is not proof of species identity or a clinical diagnosis.",
    "The adapter uses only the supplied TSV and optional local taxonomy map; no network taxonomy lookup is performed.",
]


def _blast_environment(context: dict[str, Any]) -> dict[str, Any]:
    """Report the *actual* local BLAST availability (never a mock)."""
    blastn_path = find_executable("blastn")
    config = context.get("config") or {}
    database = config.get("blast_database") or context.get("database")
    db_ok = False
    db_message = "No local BLAST database was configured."
    db_info = None
    if database:
        db_ok, db_message, db_info = validate_database(database, timeout=5)
    return {
        "blastn_path": blastn_path,
        "database": database,
        "database_available": db_ok,
        "database_message": db_message,
        "database_info": db_info,
    }


def _tsv_text(inputs: dict[str, Any]) -> str | None:
    for key in _TSV_KEYS:
        value = inputs.get(key)
        if isinstance(value, str) and value.strip():
            return value
    return None


def _parse_and_analyze(
    step: dict[str, Any], inputs: dict[str, Any], context: dict[str, Any]
) -> tuple[dict[str, Any] | None, dict[str, Any] | None, str | None]:
    text = _tsv_text(inputs)
    if text is None:
        env = _blast_environment(context)
        reason = (
            "No BLAST TSV dataset was provided in job inputs. "
            f"blastn executable found: {env['blastn_path'] or 'no'}; "
            f"local database configured: {env['database'] or 'no'}; "
            f"database usable: {'yes' if env['database_available'] else 'no'}. "
            "A real local BLAST run or an uploaded TSV is required; no hits were fabricated."
        )
        return None, {"blast_environment": env}, reason
    try:
        path = write_input(context["workspace"], "blast_results.tsv", text)
    except (ValueError, OSError) as exc:
        return None, {}, f"Could not stage BLAST TSV input: {exc}"

    params = step.get("params") or {}
    schema = str(params.get("schema", "auto") or "auto")
    try:
        parsed = parse_blast_file(path, schema=schema)
        analysis = analyze_blast(
            parsed,
            min_identity=float(params.get("min_identity", 0.0) or 0.0),
            min_query_coverage=float(params.get("min_query_coverage", 0.0) or 0.0),
            query_ids=[rec["id"] for rec in _fasta_query_ids(inputs)],
        )
    except (ValueError, OSError, RuntimeError) as exc:
        return None, {}, f"BLAST TSV parsing failed: {exc}"
    return {"parsed": parsed, "analysis": analysis}, {"input_file": path.name}, None


def _fasta_query_ids(inputs: dict[str, Any]) -> list[dict[str, Any]]:
    """Best-effort query ids from an optional companion FASTA (real parser)."""
    fasta_text = inputs.get("fasta_text")
    if not isinstance(fasta_text, str) or not fasta_text.strip():
        return []
    from smartbio.fasta import parse_fasta_text

    parsed = parse_fasta_text(fasta_text)
    return [rec for rec in parsed.get("records", []) if rec.get("id")]


def _meta(adapter, step, prepared, artifacts, limitations, database=None) -> dict[str, Any]:
    params = step.get("params") or {}
    return {
        "status": "succeeded",
        "tool_id": adapter.TOOL_ID,
        "version": adapter.VERSION,
        "execution_mode": "real",
        "functions": list(adapter._functions),
        "parameters": {
            "schema": str(params.get("schema", "auto") or "auto"),
            "min_identity": float(params.get("min_identity", 0.0) or 0.0),
            "min_query_coverage": float(params.get("min_query_coverage", 0.0) or 0.0),
        },
        "input_file": prepared.get("input_file"),
        "artifact_names": [a["name"] for a in artifacts],
        "limitations": list(limitations),
        "logs": [],
        "database": database
        or {"name": None, "release": None, "retrieved_at": None},
    }


class _BaseBlastAdapter:
    VERSION = _TOOL_VERSION
    _functions: tuple[str, ...] = ()
    _limitations: list[str] = []


class BlastParsePlugin(_BaseBlastAdapter):
    """Adapter for ``microbiome-16s.blast-parse``."""

    TOOL_ID = "microbiome-16s.blast-parse"
    _functions = ("smartbio.blast.parse_blast_file", "smartbio.blast.analyze_blast")
    _limitations = _BLAST_PARSING_LIMITATIONS

    def run(
        self, step: dict[str, Any], inputs: dict[str, Any], context: dict[str, Any]
    ) -> dict[str, Any]:
        prepared, extra, reason = _parse_and_analyze(step, inputs, context)
        if reason is not None:
            return failure_result(
                self,
                reason,
                limitations=self._limitations,
                details=extra,
            )
        parsed = prepared["parsed"]
        parse_summary = {
            "schema": parsed.get("schema"),
            "schema_requested": parsed.get("schema_requested"),
            "data_rows": parsed.get("data_rows"),
            "parsed_rows": parsed.get("parsed_rows"),
            "malformed_rows": parsed.get("malformed_rows"),
            "file_errors": parsed.get("file_errors", []),
        }
        document = {
            "tool": "Smart Bioinformatics Toolkit",
            "tool_version": self.VERSION,
            "parse": parse_summary,
            "analysis": prepared["analysis"],
        }
        artifacts = [json_artifact("blast_analysis.json", document)]
        meta = _meta(self, step, prepared, artifacts, self._limitations)
        return {"artifacts": artifacts, "tool_run_meta": meta}


class TaxonomyPlugin(_BaseBlastAdapter):
    """Adapter for ``microbiome-16s.taxonomy``."""

    TOOL_ID = "microbiome-16s.taxonomy"
    _functions = (
        "smartbio.blast.parse_blast_file",
        "smartbio.blast.analyze_blast",
        "smartbio.taxonomy.run_taxonomy_analysis",
    )
    _limitations = _TAXONOMY_LIMITATIONS

    def run(
        self, step: dict[str, Any], inputs: dict[str, Any], context: dict[str, Any]
    ) -> dict[str, Any]:
        prepared, extra, reason = _parse_and_analyze(step, inputs, context)
        if reason is not None:
            return failure_result(
                self,
                reason,
                limitations=self._limitations,
                details=extra,
            )
        params = step.get("params") or {}
        map_text = inputs.get("taxonomy_map_text")
        mapping_path = None
        mapping_report: dict[str, Any] = {}
        if isinstance(map_text, str) and map_text.strip():
            try:
                mapping_path = write_input(
                    context["workspace"], "taxonomy_map.tsv", map_text
                )
            except (ValueError, OSError) as exc:
                return failure_result(
                    self,
                    f"Could not stage taxonomy map input: {exc}",
                    limitations=self._limitations,
                )
        resolver = TaxonomyResolver(mapping_path=mapping_path, online=False)
        if mapping_path is not None:
            mapping_report = resolver.load_mapping()
            if not mapping_report.get("valid", True):
                return failure_result(
                    self,
                    "Taxonomy mapping is invalid; refusing to produce verdicts.",
                    limitations=self._limitations,
                    details={"mapping_errors": mapping_report.get("errors", [])},
                )
        try:
            analysis = run_taxonomy_analysis(
                prepared["analysis"],
                resolver,
                top_n=int(params.get("top_n", 10) or 10),
                min_consensus=float(params.get("min_consensus", 0.8) or 0.8),
                species_threshold=float(
                    params.get("species_threshold", 98.65) or 98.65
                ),
                verdict_min_coverage=float(
                    params.get("verdict_min_coverage", 80.0) or 80.0
                ),
            )
        except (ValueError, OSError, RuntimeError) as exc:
            return failure_result(
                self,
                f"Taxonomy analysis failed: {exc}",
                limitations=self._limitations,
            )

        malformed = prepared["analysis"].get("summary", {}).get("malformed_rows", 0)
        analysis["mapping_validation"] = mapping_report
        analysis["blast_input_quality"] = {
            "malformed_rows": malformed,
            "note": "Malformed BLAST rows were excluded; check the TSV before trusting verdicts.",
        }
        if malformed:
            analysis.setdefault("flags", []).append("malformed_blast_rows")

        artifacts = [json_artifact("taxonomy_analysis.json", analysis)]
        meta = _meta(self, step, prepared, artifacts, self._limitations)
        meta["functions"] = list(self._functions)
        meta["parameters"].update(
            {
                "top_n": int(params.get("top_n", 10) or 10),
                "min_consensus": float(params.get("min_consensus", 0.8) or 0.8),
                "species_threshold": float(
                    params.get("species_threshold", 98.65) or 98.65
                ),
            }
        )
        return {"artifacts": artifacts, "tool_run_meta": meta}


__all__ = ["BlastParsePlugin", "TaxonomyPlugin"]
