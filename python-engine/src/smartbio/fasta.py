"""FASTA parsing and validation using Biopython."""

from __future__ import annotations

from collections import Counter
from io import StringIO
from pathlib import Path
from typing import Any, TextIO

from Bio import SeqIO

DNA_ACCEPTED = set("ACGTRYSWKMBDHVN")
DNA_CANONICAL = set("ACGT")
DNA_AMBIGUOUS = set("RYSWKMBDHVN")
PROTEIN_ACCEPTED = set("ACDEFGHIKLMNPQRSTVWYBZJXUO*")
PROTEIN_CANONICAL = set("ACDEFGHIKLMNPQRSTVWY")
PROTEIN_AMBIGUOUS = set("BZJXUO")


def _preflight_structure(text: str) -> list[dict[str, Any]]:
    """Detect non-empty sequence text before the first FASTA header.

    Biopython is responsible for parsing records. This preflight adds a clearer
    diagnostic for a common structural mistake that parsers may otherwise skip.
    """
    errors: list[dict[str, Any]] = []
    found_header = False
    for line_number, raw_line in enumerate(text.lstrip("\ufeff").splitlines(), start=1):
        line = raw_line.strip()
        if not line:
            continue
        if line.startswith(">"):
            found_header = True
        elif not found_header:
            errors.append(
                {
                    "code": "SEQUENCE_BEFORE_HEADER",
                    "message": "Sequence data appears before the first FASTA header.",
                    "line": line_number,
                }
            )
            # One structural error is enough; don't emit one per preamble line.
            break
    return errors


def parse_fasta_text(text: str) -> dict[str, Any]:
    """Parse FASTA text into normalized records and structural diagnostics."""
    if not isinstance(text, str):
        raise TypeError("FASTA input must be text.")

    cleaned_text = text.lstrip("\ufeff")
    file_errors = _preflight_structure(cleaned_text)
    records: list[dict[str, Any]] = []

    parse_text = cleaned_text
    if file_errors:
        # Skip the invalid preamble while retaining a diagnostic; this avoids
        # relying on Biopython's deprecated handling of text before a header.
        lines = cleaned_text.splitlines()
        first_header = next((i for i, line in enumerate(lines) if line.strip().startswith(">")), None)
        parse_text = "\n".join(lines[first_header:]) if first_header is not None else ""

    try:
        for record_number, record in enumerate(SeqIO.parse(StringIO(parse_text), "fasta"), start=1):
            header = (record.description or "").strip()
            sequence = "".join(str(record.seq).split()).upper()
            identifier = header.split()[0] if header else ""
            records.append(
                {
                    "record_number": record_number,
                    "id": identifier,
                    "description": header,
                    "sequence": sequence,
                    "length": len(sequence),
                    "errors": [],
                    "warnings": [],
                    "valid": True,
                }
            )
    except Exception as exc:  # Biopython parser exceptions should become user-facing diagnostics.
        file_errors.append(
            {
                "code": "FASTA_PARSE_ERROR",
                "message": f"Biopython could not parse the FASTA input: {exc}",
                "line": None,
            }
        )

    if not records and not file_errors:
        file_errors.append(
            {
                "code": "NO_FASTA_RECORDS",
                "message": "No FASTA records were found. Check that the file contains headers beginning with '>'.",
                "line": None,
            }
        )

    return {"records": records, "file_errors": file_errors}


def parse_fasta_file(path: str | Path) -> dict[str, Any]:
    """Read a UTF-8/ASCII FASTA file and parse it."""
    input_path = Path(path)
    if not input_path.exists():
        raise FileNotFoundError(f"Input file does not exist: {input_path}")
    if not input_path.is_file():
        raise IsADirectoryError(f"Input path is not a file: {input_path}")
    text = input_path.read_text(encoding="utf-8-sig")
    return parse_fasta_text(text)


def validate_records(parsed: dict[str, Any], sequence_type: str) -> dict[str, Any]:
    """Validate parsed records and return a report.

    sequence_type must be explicitly selected as 'dna' or 'protein'.
    The later record with a duplicate identifier is marked invalid.
    """
    sequence_type = sequence_type.lower().strip()
    if sequence_type not in {"dna", "protein"}:
        raise ValueError("sequence_type must be either 'dna' or 'protein'.")

    accepted = DNA_ACCEPTED if sequence_type == "dna" else PROTEIN_ACCEPTED
    canonical = DNA_CANONICAL if sequence_type == "dna" else PROTEIN_CANONICAL
    ambiguous = DNA_AMBIGUOUS if sequence_type == "dna" else PROTEIN_AMBIGUOUS
    id_counts = Counter(
        record.get("id", "")
        for record in parsed.get("records", [])
        if record.get("id", "")
    )
    validated: list[dict[str, Any]] = []

    for original in parsed.get("records", []):
        record = {**original, "errors": list(original.get("errors", [])), "warnings": list(original.get("warnings", []))}
        identifier = record.get("id", "")
        sequence = record.get("sequence", "")

        if not identifier:
            record["errors"].append({"code": "EMPTY_HEADER", "message": "FASTA header is empty."})
        if not sequence:
            record["errors"].append({"code": "EMPTY_SEQUENCE", "message": "Sequence is empty."})
        if identifier and id_counts[identifier] > 1:
            record["errors"].append(
                {"code": "DUPLICATE_ID", "message": f"Sequence identifier is not unique: {identifier}. All records with this ID are invalid."}
            )

        invalid_symbols = sorted(set(sequence) - accepted)
        if invalid_symbols:
            record["errors"].append(
                {
                    "code": "INVALID_SYMBOLS",
                    "message": "Sequence contains symbols not accepted for the selected sequence type.",
                    "symbols": invalid_symbols,
                }
            )

        ambiguous_count = sum(1 for symbol in sequence if symbol in ambiguous)
        if ambiguous_count:
            record["warnings"].append(
                {
                    "code": "AMBIGUOUS_SYMBOLS",
                    "message": f"Sequence contains {ambiguous_count} accepted ambiguous/non-canonical symbol(s).",
                    "count": ambiguous_count,
                }
            )

        stop_count = sequence.count("*") if sequence_type == "protein" else 0
        if stop_count:
            record["warnings"].append(
                {
                    "code": "STOP_SYMBOLS",
                    "message": f"Protein sequence contains {stop_count} stop symbol(s) (*).",
                    "count": stop_count,
                }
            )

        record["ambiguous_count"] = ambiguous_count
        record["stop_count"] = stop_count
        record["canonical_count"] = sum(1 for symbol in sequence if symbol in canonical)
        record["valid"] = len(record["errors"]) == 0
        validated.append(record)

    file_errors = list(parsed.get("file_errors", []))
    valid_count = sum(1 for record in validated if record["valid"])
    invalid_count = len(validated) - valid_count
    return {
        "sequence_type": sequence_type,
        "records": validated,
        "file_errors": file_errors,
        "total_records": len(validated),
        "valid_records": valid_count,
        "invalid_records": invalid_count,
        "file_valid": len(file_errors) == 0 and len(validated) > 0 and invalid_count == 0,
    }
