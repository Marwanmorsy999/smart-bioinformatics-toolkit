from pathlib import Path
import sys

ENGINE_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ENGINE_ROOT / "src"))

from smartbio.fasta import parse_fasta_file, parse_fasta_text, validate_records

FIXTURES = Path(__file__).resolve().parents[2] / "shared" / "test-cases"


def test_valid_dna_fixture_parses_and_validates():
    parsed = parse_fasta_file(FIXTURES / "dna_valid.fasta")
    report = validate_records(parsed, "dna")
    assert report["total_records"] == 3
    assert report["valid_records"] == 3
    assert report["invalid_records"] == 0
    assert report["file_valid"] is True


def test_invalid_dna_fixture_flags_invalid_empty_and_duplicate():
    parsed = parse_fasta_file(FIXTURES / "dna_invalid.fasta")
    report = validate_records(parsed, "dna")
    codes = {error["code"] for rec in report["records"] for error in rec["errors"]}
    assert "INVALID_SYMBOLS" in codes
    assert "EMPTY_SEQUENCE" in codes
    assert "DUPLICATE_ID" in codes
    assert report["valid_records"] == 1


def test_sequence_before_header_is_a_file_error():
    parsed = parse_fasta_file(FIXTURES / "sequence_before_header.fasta")
    report = validate_records(parsed, "dna")
    assert report["file_errors"][0]["code"] == "SEQUENCE_BEFORE_HEADER"
    assert report["file_valid"] is False


def test_dna_ambiguity_is_warning_not_error():
    parsed = parse_fasta_text(">x\nACGTRYN\n")
    report = validate_records(parsed, "dna")
    record = report["records"][0]
    assert record["valid"] is True
    assert record["ambiguous_count"] == 3
    assert record["warnings"][0]["code"] == "AMBIGUOUS_SYMBOLS"


def test_protein_symbols_and_stop_are_counted():
    parsed = parse_fasta_text(">p\nMABZJXUOEFG*\n")
    report = validate_records(parsed, "protein")
    record = report["records"][0]
    assert record["valid"] is True
    assert record["ambiguous_count"] == 6
    assert record["stop_count"] == 1
