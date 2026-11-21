"""Local BLAST+ execution adapter for the Smart Bioinformatics Toolkit.

This module runs a locally installed NCBI BLAST+ program (initially ``blastn``)
and feeds its tabular output into the existing BLAST Results Analyzer. It does
not duplicate analyzer filtering/ranking logic.
"""

from __future__ import annotations

import hashlib
import json
import shutil
import subprocess
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from smartbio.blast import (
    SCHEMAS,
    analyze_blast,
    blast_dataframe,
    parse_blast_text,
)
from smartbio.fasta import parse_fasta_file, validate_records

BLASTN_LOCAL_SCHEMA = "blastn_local_v1"

# Fields must stay in this exact order; they are recorded in run metadata.
BLASTN_LOCAL_FIELDS = [
    "qseqid", "sacc", "staxids", "sscinames", "pident", "length",
    "qstart", "qend", "qlen", "evalue", "bitscore", "qcovs",
]

BLAST_EXIT_CODES = {
    0: "Success.",
    1: "Invalid input or command-line options.",
    2: "BLAST database error.",
    3: "BLAST engine error.",
    4: "Memory error.",
    5: "File error.",
}


def find_executable(name: str, custom_path: str | None = None) -> str | None:
    """Return an executable path or None."""
    if custom_path:
        candidate = Path(custom_path)
        if candidate.is_file():
            return str(candidate)
        return None
    return shutil.which(name)


def get_blast_version(executable: str, timeout: int = 30) -> str:
    """Run ``executable -version`` and return its version text."""
    result = subprocess.run(
        [executable, "-version"],
        shell=False,
        capture_output=True,
        text=True,
        timeout=timeout,
        check=False,
    )
    if result.returncode != 0:
        raise RuntimeError(
            f"BLAST version check failed (code {result.returncode}): "
            f"{result.stderr.strip() or result.stdout.strip()}"
        )
    output = (result.stdout or result.stderr).strip()
    if not output:
        raise RuntimeError("BLAST version check produced no output.")
    return output.splitlines()[0].strip()


def validate_database(
    database: str,
    blastdbcmd_path: str | None = None,
    timeout: int = 30,
) -> tuple[bool, str, str | None]:
    """Validate a BLAST database using blastdbcmd when available.

    Returns ``(ok, message, raw_info)``.
    """
    exe = find_executable("blastdbcmd", blastdbcmd_path)
    if exe is None:
        return False, "blastdbcmd executable not found; cannot validate database.", None
    try:
        result = subprocess.run(
            [exe, "-info", "-db", database],
            shell=False,
            capture_output=True,
            text=True,
            timeout=timeout,
            check=False,
        )
    except subprocess.TimeoutExpired as exc:
        return False, f"Database validation timed out: {exc}", None
    raw = (result.stdout or "").strip()
    if result.returncode != 0:
        message = (result.stderr or "").strip() or "Database validation failed."
        return False, message, raw or None
    return True, "Database validation succeeded.", raw or None


def _sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(65536), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _blast_exit_message(code: int, stderr: str) -> str:
    base = BLAST_EXIT_CODES.get(code, "Unknown BLAST exit code.")
    detail = stderr.strip()
    if detail:
        return f"{base} (exit code {code}): {detail}"
    return f"{base} (exit code {code})"


def run_blastn(
    *,
    input_path: str | Path,
    database: str,
    out_dir: str | Path,
    task: str = "megablast",
    evalue: float = 1e-5,
    max_target_seqs: int = 500,
    num_threads: int = 1,
    timeout: int = 600,
    blastn_path: str | None = None,
    blastdbcmd_path: str | None = None,
    min_identity: float = 0.0,
    min_query_coverage: float = 0.0,
    max_evalue_filter: float | None = None,
    max_hits: int = 0,
    query_ids: list[str] | None = None,
) -> dict[str, Any]:
    """Run local blastn and analyze its output with the existing analyzer.

    Returns a dict with ``report``, ``metadata``, and output paths.
    """
    input_path = Path(input_path)
    out_dir = Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    # Validate FASTA input first.
    parsed_fasta = parse_fasta_file(input_path)
    validation = validate_records(parsed_fasta, "dna")
    if not validation.get("file_valid"):
        raise ValueError(
            "FASTA validation failed before BLAST execution: "
            + "; ".join(
                err.get("message", str(err))
                for rec in validation.get("records", [])
                for err in rec.get("errors", [])
            )
        )
    if validation.get("valid_records", 0) == 0:
        raise ValueError("No valid DNA records found in the input FASTA.")

    # Executable detection.
    blastn_exe = find_executable("blastn", blastn_path)
    if blastn_exe is None:
        raise RuntimeError(
            "BLAST+ executable 'blastn' was not found. Install NCBI BLAST+ and "
            "ensure it is on PATH, or provide --blastn-path."
        )
    blast_version = get_blast_version(blastn_exe, timeout=30)

    # Database validation.
    db_ok, db_message, db_info = validate_database(database, blastdbcmd_path, timeout=30)
    if not db_ok:
        raise RuntimeError(f"BLAST database validation failed: {db_message}")

    # Query identifiers from FASTA if not supplied.
    if not query_ids:
        query_ids = [rec["id"] for rec in validation.get("records", []) if rec.get("id")]

    # Output files.
    results_tsv = out_dir / "blast_results.tsv"
    filtered_csv = out_dir / "filtered_results.csv"
    analysis_json = out_dir / "analysis.json"
    run_json = out_dir / "blast_run.json"
    execution_log = out_dir / "execution.log"

    outfmt = "6 " + " ".join(BLASTN_LOCAL_FIELDS)
    command = [
        blastn_exe,
        "-task", task,
        "-query", str(input_path),
        "-db", database,
        "-evalue", str(evalue),
        "-max_target_seqs", str(max_target_seqs),
        "-num_threads", str(num_threads),
        "-outfmt", outfmt,
        "-out", str(results_tsv),
    ]

    started_at = datetime.now(timezone.utc)
    try:
        completed = subprocess.run(
            command,
            shell=False,
            capture_output=True,
            text=True,
            timeout=timeout,
            check=False,
        )
    except subprocess.TimeoutExpired as exc:
        raise RuntimeError(f"BLAST execution timed out after {timeout} seconds.") from exc

    finished_at = datetime.now(timezone.utc)
    duration = (finished_at - started_at).total_seconds()

    stderr_text = completed.stderr or ""
    stdout_text = completed.stdout or ""
    warnings: list[str] = [line for line in stderr_text.splitlines() if line.strip()]
    # Candidate-limit detection is performed after parsing.

    execution_log.write_text(
        "COMMAND:\n" + " ".join(command) + "\n\n"
        + "STDOUT:\n" + stdout_text + "\n\n"
        + "STDERR:\n" + stderr_text + "\n",
        encoding="utf-8",
    )

    if completed.returncode != 0:
        raise RuntimeError(_blast_exit_message(completed.returncode, stderr_text))

    # Parse BLAST output with the existing analyzer.
    if results_tsv.exists():
        tsv_text = results_tsv.read_text(encoding="utf-8-sig")
    else:
        tsv_text = ""
    parsed = parse_blast_text(tsv_text, schema=BLASTN_LOCAL_SCHEMA)

    report = analyze_blast(
        parsed,
        min_identity=min_identity,
        min_query_coverage=min_query_coverage,
        max_evalue=max_evalue_filter if max_evalue_filter is not None else evalue,
        max_hits=max_hits,
        query_ids=query_ids,
    )

    # Write analyzer outputs.
    write_csv(filtered_csv, blast_dataframe(report, filtered_only=True))
    write_json(analysis_json, report)

    # Candidate limit warning.
    candidate_limit_reached = False
    grouped = report.get("grouped", {})
    for qid, hits in grouped.items():
        if len(hits) >= max_target_seqs:
            candidate_limit_reached = True
            break
    if candidate_limit_reached:
        warnings.append(
            f"Returned hit count reached max_target_seqs={max_target_seqs} for at least "
            "one query; tied or additional matches may have been truncated by BLAST."
        )

    no_hit_queries = report.get("no_hit_queries", [])
    queries_with_hits = len(grouped)

    metadata = {
        "run_id": str(uuid.uuid4()),
        "tool": "Smart Bioinformatics Toolkit",
        "tool_version": "0.1.0",
        "input_file": input_path.name,
        "input_sha256": _sha256_file(input_path),
        "program": "blastn",
        "task": task,
        "blast_version": blast_version,
        "database": database,
        "database_info": db_info,
        "database_validation_message": db_message,
        "evalue": evalue,
        "max_target_seqs": max_target_seqs,
        "num_threads": num_threads,
        "timeout_seconds": timeout,
        "schema": BLASTN_LOCAL_SCHEMA,
        "outfmt_fields": list(BLASTN_LOCAL_FIELDS),
        "timestamp_utc": started_at.isoformat(),
        "finished_at_utc": finished_at.isoformat(),
        "duration_seconds": duration,
        "return_code": completed.returncode,
        "warnings": warnings,
        "stderr": stderr_text,
        "input_queries": len(query_ids),
        "queries_with_hits": queries_with_hits,
        "queries_without_hits": len(no_hit_queries),
        "candidate_limit_reached": candidate_limit_reached,
        "no_hit_queries": no_hit_queries,
    }
    write_json(run_json, metadata)

    return {
        "report": report,
        "metadata": metadata,
        "paths": {
            "results_tsv": str(results_tsv),
            "filtered_csv": str(filtered_csv),
            "analysis_json": str(analysis_json),
            "run_json": str(run_json),
            "execution_log": str(execution_log),
        },
    }


def write_json(path: Path, data: Any) -> None:
    path.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")


def write_csv(path: Path, dataframe: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    dataframe.to_csv(path, index=False)
