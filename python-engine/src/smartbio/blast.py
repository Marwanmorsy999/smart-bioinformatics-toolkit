"""BLAST tabular result import and analysis.

This module parses BLAST ``outfmt 6`` style tabular files, validates their
schema and numeric values, and produces filtered/ranked results. It does not
execute BLAST and makes no taxonomic or species-identity claims.
"""

from __future__ import annotations

import math
from pathlib import Path
from typing import Any

STANDARD_COLUMNS = [
    "qseqid", "sseqid", "pident", "length", "mismatch", "gapopen",
    "qstart", "qend", "sstart", "send", "evalue", "bitscore",
]

EXTENDED_COLUMNS = [
    "qseqid", "sacc", "staxids", "sscinames", "pident", "length",
    "qstart", "qend", "qlen", "evalue", "bitscore",
]

BLASTN_LOCAL_COLUMNS = [
    "qseqid", "sacc", "staxids", "sscinames", "pident", "length",
    "qstart", "qend", "qlen", "evalue", "bitscore", "qcovs",
]

SCHEMAS = {
    "standard": STANDARD_COLUMNS,
    "extended": EXTENDED_COLUMNS,
    "blastn_local_v1": BLASTN_LOCAL_COLUMNS,
}

INTEGER_COLUMNS = {
    "standard": {"length", "mismatch", "gapopen", "qstart", "qend", "sstart", "send"},
    "extended": {"length", "qstart", "qend", "qlen"},
    "blastn_local_v1": {"length", "qstart", "qend", "qlen"},
}

FLOAT_COLUMNS = {
    "standard": {"pident", "evalue", "bitscore"},
    "extended": {"pident", "evalue", "bitscore"},
    "blastn_local_v1": {"pident", "evalue", "bitscore", "qcovs"},
}

STRING_REQUIRED = {
    "standard": {"qseqid", "sseqid"},
    "extended": {"qseqid", "sacc"},
    "blastn_local_v1": {"qseqid", "sacc"},
}


def _is_int_text(value: str) -> bool:
    value = value.strip()
    if not value:
        return False
    if value[0] in "+-":
        value = value[1:]
    return value.isdigit()


def _parse_int(value: str) -> int | None:
    value = value.strip()
    if not _is_int_text(value):
        return None
    try:
        return int(value)
    except ValueError:
        return None


def _parse_float(value: str) -> float | None:
    value = value.strip()
    if not value:
        return None
    try:
        number = float(value)
    except ValueError:
        return None
    if not math.isfinite(number):
        return None
    return number


def _split_lines(text: str) -> list[str]:
    return text.replace("\r\n", "\n").replace("\r", "\n").split("\n")


def _infer_schema_from_counts(counts: set[int]) -> str | None:
    if counts == {len(STANDARD_COLUMNS)}:
        return "standard"
    if counts == {len(EXTENDED_COLUMNS)}:
        return "extended"
    return None


def infer_schema(text: str) -> tuple[str | None, str | None]:
    """Infer schema from consistent column counts.

    Returns (schema, error_message). Schema is None when ambiguous or unknown.
    """
    counts: set[int] = set()
    data_lines = 0
    for raw_line in _split_lines(text):
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue
        fields = raw_line.split("\t")
        # Allow trailing empty field from a trailing tab? Keep strict count.
        counts.add(len(fields))
        data_lines += 1
    if data_lines == 0:
        return None, "No BLAST data rows were found."
    schema = _infer_schema_from_counts(counts)
    if schema is None:
        if len(counts) > 1:
            return None, (
                "Ambiguous column count: found rows with "
                + ", ".join(str(c) for c in sorted(counts))
                + " columns. Select a schema explicitly."
            )
        return None, (
            "Unrecognized column count: "
            + ", ".join(str(c) for c in sorted(counts))
            + ". Expected 12 (standard) or 11 (extended)."
        )
    return schema, None


def parse_blast_text(text: str, schema: str = "auto") -> dict[str, Any]:
    if not isinstance(text, str):
        raise TypeError("BLAST input must be text.")

    requested = (schema or "auto").lower().strip()
    if requested not in {"auto", "standard", "extended", "blastn_local_v1"}:
        raise ValueError("schema must be 'auto', 'standard', 'extended', or 'blastn_local_v1'.")

    if requested == "auto":
        resolved_schema, infer_error = infer_schema(text)
        schema_source = "inferred" if resolved_schema else "auto"
    else:
        resolved_schema = requested
        infer_error = None
        schema_source = "user"

    columns = SCHEMAS.get(resolved_schema) if resolved_schema else []

    rows: list[dict[str, Any]] = []
    file_errors: list[dict[str, Any]] = []
    if infer_error:
        file_errors.append({"code": "SCHEMA_INFERENCE_FAILED", "message": infer_error, "line": None})

    data_row_index = 0
    for line_number, raw_line in enumerate(_split_lines(text), start=1):
        if raw_line == "" :
            # skip completely empty lines
            if raw_line.strip() == "":
                continue
        stripped = raw_line.strip()
        if not stripped or stripped.startswith("#"):
            continue
        data_row_index += 1
        fields = raw_line.split("\t")
        # strip each field
        fields = [field.strip() for field in fields]

        # skip a header line that exactly matches the schema columns
        if resolved_schema and fields == columns:
            continue

        row: dict[str, Any] = {
            "row_number": line_number,
            "data_row": data_row_index,
            "raw": raw_line.rstrip("\r\n"),
            "fields": fields,
            "values": None,
            "errors": [],
            "valid": False,
        }

        if not resolved_schema:
            row["errors"].append({"code": "SCHEMA_UNRESOLVED", "message": "Schema could not be resolved; cannot parse row."})
            rows.append(row)
            continue

        if len(fields) != len(columns):
            row["errors"].append({
                "code": "COLUMN_COUNT",
                "message": f"Expected {len(columns)} columns, found {len(fields)}.",
            })
            rows.append(row)
            continue

        values: dict[str, Any] = {}
        row_errors: list[dict[str, Any]] = []

        for idx, col in enumerate(columns):
            values[col] = fields[idx]

        # string required checks
        for col in STRING_REQUIRED[resolved_schema]:
            if not values[col]:
                row_errors.append({"code": "MISSING_VALUE", "message": f"Missing required value for {col}.", "column": col})

        # integer columns
        for col in INTEGER_COLUMNS[resolved_schema]:
            parsed_int = _parse_int(values[col])
            if parsed_int is None:
                row_errors.append({"code": "INVALID_INTEGER", "message": f"Column {col} must be an integer.", "column": col})
                values[col] = None
            else:
                values[col] = parsed_int

        # float columns
        for col in FLOAT_COLUMNS[resolved_schema]:
            parsed_float = _parse_float(values[col])
            if parsed_float is None:
                row_errors.append({"code": "INVALID_NUMBER", "message": f"Column {col} must be a finite number.", "column": col})
                values[col] = None
            else:
                values[col] = parsed_float

        # range checks when values parsed
        if values.get("pident") is not None:
            if not (0 <= values["pident"] <= 100):
                row_errors.append({"code": "RANGE_ERROR", "message": "pident must be between 0 and 100.", "column": "pident"})
        for col in ("length",):
            if values.get(col) is not None and values[col] < 1:
                row_errors.append({"code": "RANGE_ERROR", "message": f"{col} must be >= 1.", "column": col})
        for col in INTEGER_COLUMNS[resolved_schema] - {"length"}:
            if values.get(col) is not None and values[col] < 0 and col in {"mismatch", "gapopen"}:
                row_errors.append({"code": "RANGE_ERROR", "message": f"{col} must be >= 0.", "column": col})
        # coordinates >= 1
        for col in ("qstart", "qend", "sstart", "send", "qlen"):
            if col in values and values.get(col) is not None and values[col] < 1:
                row_errors.append({"code": "RANGE_ERROR", "message": f"{col} must be >= 1.", "column": col})
        # evalue >=0, bitscore finite already
        if values.get("evalue") is not None and values["evalue"] < 0:
            row_errors.append({"code": "RANGE_ERROR", "message": "evalue must be >= 0.", "column": "evalue"})
        if values.get("bitscore") is not None and values["bitscore"] < 0:
            row_errors.append({"code": "RANGE_ERROR", "message": "bitscore must be >= 0.", "column": "bitscore"})
        # mismatch/gapopen >=0
        for col in ("mismatch", "gapopen"):
            if col in values and values.get(col) is not None and values[col] < 0:
                row_errors.append({"code": "RANGE_ERROR", "message": f"{col} must be >= 0.", "column": col})

        # qlen range for query coords
        if resolved_schema in {"extended", "blastn_local_v1"} and values.get("qlen") is not None:
            for col in ("qstart", "qend"):
                if values.get(col) is not None and values[col] > values["qlen"]:
                    row_errors.append({"code": "RANGE_ERROR", "message": f"{col} exceeds qlen.", "column": col})
        if resolved_schema == "blastn_local_v1" and values.get("qcovs") is not None:
            if values["qcovs"] < 0 or values["qcovs"] > 100:
                row_errors.append({"code": "RANGE_ERROR", "message": "qcovs must be between 0 and 100.", "column": "qcovs"})

        # mismatch/gapopen <= length? optional check
        # (not enforced)

        row["errors"] = row_errors
        row["values"] = values if not row_errors else values  # keep parsed values even with errors? Keep.
        row["valid"] = len(row_errors) == 0
        rows.append(row)

    # If schema resolved but no rows? file_errors
    if resolved_schema and not rows:
        file_errors.append({"code": "NO_DATA_ROWS", "message": "No BLAST data rows were found.", "line": None})

    malformed_count = sum(1 for r in rows if not r["valid"])
    parsed_count = sum(1 for r in rows if r["valid"])

    return {
        "schema": resolved_schema,
        "schema_requested": requested,
        "schema_source": schema_source,
        "columns": columns,
        "rows": rows,
        "file_errors": file_errors,
        "total_lines": len(_split_lines(text)),
        "data_rows": len(rows),
        "parsed_rows": parsed_count,
        "malformed_rows": malformed_count,
    }


def parse_blast_file(path: str | Path, schema: str = "auto") -> dict[str, Any]:
    input_path = Path(path)
    if not input_path.exists():
        raise FileNotFoundError(f"Input file does not exist: {input_path}")
    if not input_path.is_file():
        raise IsADirectoryError(f"Input path is not a file: {input_path}")
    text = input_path.read_text(encoding="utf-8-sig")
    return parse_blast_text(text, schema=schema)


def _query_length_from_fasta_text(text: str) -> dict[str, int]:
    # lightweight parse: reuse fasta? Avoid import cycle? fasta module ok.
    from smartbio.fasta import parse_fasta_text
    parsed = parse_fasta_text(text)
    lengths: dict[str, int] = {}
    for rec in parsed.get("records", []):
        if rec.get("id"):
            lengths[rec["id"]] = len(rec.get("sequence", ""))
    return lengths


def parse_query_lengths_text(text: str) -> dict[str, int]:
    lengths: dict[str, int] = {}
    for raw_line in _split_lines(text):
        stripped = raw_line.strip()
        if not stripped or stripped.startswith("#"):
            continue
        parts = stripped.split()
        if len(parts) < 2:
            continue
        try:
            lengths[parts[0]] = int(parts[1])
        except ValueError:
            continue
    return lengths


def _coverage(row_values: dict[str, Any], qlen_override: int | None) -> float | None:
    qlen = row_values.get("qlen")
    if qlen is None:
        qlen = qlen_override
    if not qlen:
        return None
    aligned = abs(row_values["qend"] - row_values["qstart"]) + 1
    if qlen <= 0:
        return None
    return round((aligned / qlen) * 100, 4)


def analyze_blast(
    parsed: dict[str, Any],
    min_identity: float = 0.0,
    min_query_coverage: float = 0.0,
    max_evalue: float | None = None,
    max_hits: int = 0,
    query_lengths: dict[str, int] | None = None,
    query_ids: list[str] | None = None,
    thresholds: dict[str, Any] | None = None,
) -> dict[str, Any]:
    schema = parsed.get("schema")
    columns = parsed.get("columns") or (SCHEMAS.get(schema) if schema else [])
    query_lengths = dict(query_lengths or {})
    query_ids = list(query_ids or [])

    if thresholds:
        min_identity = thresholds.get("min_identity", thresholds.get("minIdentity", min_identity))
        min_query_coverage = thresholds.get("min_query_coverage", thresholds.get("minQueryCoverage", min_query_coverage))
        max_evalue = thresholds.get("max_evalue", thresholds.get("maxEvalue", max_evalue))
        max_hits = thresholds.get("max_hits", thresholds.get("maxHits", max_hits))

    # augment query_ids from query_lengths
    for qid in query_lengths:
        if qid not in query_ids:
            query_ids.append(qid)

    min_identity = float(min_identity) if min_identity is not None else 0.0
    min_query_coverage = float(min_query_coverage) if min_query_coverage is not None else 0.0
    if max_evalue is not None:
        max_evalue = float(max_evalue)
    max_hits = int(max_hits) if max_hits else 0

    analyzed_rows: list[dict[str, Any]] = []
    for row in parsed.get("rows", []):
        base = {
            "row_number": row["row_number"],
            "data_row": row.get("data_row"),
            "raw": row["raw"],
            "valid": row["valid"],
            "errors": list(row.get("errors", [])),
            "schema": schema,
        }
        # flatten schema values
        values = row.get("values") or {}
        for col in columns:
            base[col] = values.get(col)
        if not row["valid"] or not values:
            base.update({
                "query_coverage": None,
                "identity_pass": False,
                "coverage_pass": False,
                "evalue_pass": False,
                "pass_all": False,
                "fail_reasons": ["invalid or unparseable row"],
                "rank": None,
                "tied": False,
                "displayed": False,
            })
            analyzed_rows.append(base)
            continue

        qlen_override = query_lengths.get(values["qseqid"])
        coverage = _coverage(values, qlen_override)
        fail_reasons: list[str] = []

        identity_pass = values["pident"] >= min_identity
        if not identity_pass:
            fail_reasons.append(
                f"identity {values['pident']}% is below minimum {min_identity}%"
            )

        if coverage is None:
            coverage_pass = not (min_query_coverage > 0)
            if min_query_coverage > 0:
                fail_reasons.append("query coverage unavailable")
        else:
            coverage_pass = coverage >= min_query_coverage
            if not coverage_pass:
                fail_reasons.append(
                    f"query coverage {coverage}% is below minimum {min_query_coverage}%"
                )

        evalue_pass = True
        if max_evalue is not None:
            evalue_pass = values["evalue"] <= max_evalue
            if not evalue_pass:
                fail_reasons.append(
                    f"E-value {values['evalue']} exceeds maximum {max_evalue}"
                )

        pass_all = identity_pass and coverage_pass and evalue_pass

        base.update({
            "query_coverage": coverage,
            "identity_pass": identity_pass,
            "coverage_pass": coverage_pass,
            "evalue_pass": evalue_pass,
            "pass_all": pass_all,
            "fail_reasons": fail_reasons,
            "rank": None,
            "tied": False,
            "displayed": False,
            "_values": values,
        })
        analyzed_rows.append(base)

    # ranking per query (all valid rows)
    by_query: dict[str, list[dict[str, Any]]] = {}
    for r in analyzed_rows:
        if r.get("valid") and r.get("_values"):
            by_query.setdefault(r["_values"]["qseqid"], []).append(r)

    for q, grp in by_query.items():
        def sort_key(r):
            v = r["_values"]
            sseqid = v.get("sseqid", v.get("sacc", ""))
            aligned = abs(v["qend"] - v["qstart"]) + 1
            return (
                -v["bitscore"],
                v["evalue"],
                -v["pident"],
                -aligned,
                str(sseqid),
            )
        grp.sort(key=sort_key)
        rank = 0
        prev_bitscore = None
        for r in grp:
            v = r["_values"]
            if prev_bitscore is None or v["bitscore"] != prev_bitscore:
                rank += 1
                prev_bitscore = v["bitscore"]
            r["rank"] = rank
            r["tied"] = sum(1 for other in grp if other["_values"]["bitscore"] == v["bitscore"]) > 1

    # displayed limit among passing rows per query
    for q, grp in by_query.items():
        passing = [r for r in grp if r["pass_all"]]
        if max_hits and max_hits > 0 and len(passing) > max_hits:
            cutoff_rank = passing[max_hits - 1]["rank"]
            for r in passing:
                r["displayed"] = r["rank"] <= cutoff_rank
        else:
            for r in passing:
                r["displayed"] = True
        for r in grp:
            if not r["pass_all"]:
                r["displayed"] = False

    # filtered rows = passing & displayed, in ranked order
    filtered_rows: list[dict[str, Any]] = []
    for q in sorted(by_query.keys()):
        for r in by_query[q]:
            if r["pass_all"] and r["displayed"]:
                filtered_rows.append(r)

    # no-hit queries
    no_hit_queries = [q for q in query_ids if q not in by_query]

    # remove internal _values? Keep for convenience but maybe remove from output.
    # We'll keep a clean copy without _values in returned rows.
    def clean(row):
        out = {k: v for k, v in row.items() if k != "_values"}
        return out

    cleaned_rows = [clean(r) for r in analyzed_rows]
    cleaned_filtered = [clean(r) for r in filtered_rows]

    grouped = {}
    for q, grp in by_query.items():
        grouped[q] = [clean(r) for r in grp]

    thresholds = {
        "min_identity": min_identity,
        "min_query_coverage": min_query_coverage,
        "max_evalue": max_evalue,
        "max_hits": max_hits,
    }

    passing_count = sum(1 for r in analyzed_rows if r.get("pass_all"))

    return {
        "schema": schema,
        "columns": columns,
        "thresholds": thresholds,
        "rows": cleaned_rows,
        "filtered_rows": cleaned_filtered,
        "passing_rows": [clean(r) for r in analyzed_rows if r.get("pass_all")],
        "grouped": grouped,
        "queries": sorted(by_query.keys()),
        "no_hit_queries": no_hit_queries,
        "query_lengths": query_lengths,
        "summary": {
            "schema": schema,
            "total_rows": parsed.get("data_rows", len(parsed.get("rows", []))),
            "valid_rows": parsed.get("parsed_rows", sum(1 for r in parsed.get("rows", []) if r.get("valid"))),
            "malformed_rows": parsed.get("malformed_rows", sum(1 for r in parsed.get("rows", []) if not r.get("valid"))),
            "unique_queries": len(by_query),
            "total_queries": len(by_query),
            "queries_with_no_hits": len(no_hit_queries),
            "passing_rows": passing_count,
            "displayed_rows": len(filtered_rows),
            "thresholds": thresholds,
        },
    }


def blast_dataframe(report: dict[str, Any], filtered_only: bool = True) -> "pd.DataFrame":
    import pandas as pd
    source = report["filtered_rows"] if filtered_only else report["rows"]
    # Convert list fields to strings for CSV
    records: list[dict[str, Any]] = []
    for row in source:
        flat = dict(row)
        if isinstance(flat.get("fail_reasons"), list):
            flat["fail_reasons"] = "; ".join(flat["fail_reasons"])
        if isinstance(flat.get("errors"), list):
            flat["errors"] = "; ".join(
                e.get("message", str(e)) if isinstance(e, dict) else str(e) for e in flat["errors"]
            )
        records.append(flat)
    return pd.DataFrame(records)


# Aliases for compatibility
parse_blast = parse_blast_text
parseBlast = parse_blast_text
parse_blast_tsv = parse_blast_text
parseBlastTsv = parse_blast_text
analyze_blast_results = analyze_blast
analyzeBlast = analyze_blast
analyzeBlastResults = analyze_blast
blast_analyze = analyze_blast
infer_schema_auto = infer_schema


def parse_blast_file_with_schema(path, schema="auto"):
    return parse_blast_file(path, schema=schema)
