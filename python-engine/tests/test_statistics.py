from pathlib import Path
import sys

ENGINE_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ENGINE_ROOT / "src"))

from smartbio.fasta import parse_fasta_text, validate_records
from smartbio.statistics import calculate_statistics


def test_dna_gc_uses_only_canonical_bases():
    parsed = parse_fasta_text(">x\nACGTRYN\n")
    validation = validate_records(parsed, "dna")
    result = calculate_statistics(validation)
    row = result["records"][0]
    # A,C,G,T => 2 GC bases out of 4 canonical bases = 50%.
    assert row["gc_percent"] == 50.0
    assert row["ambiguous_count"] == 3


def test_protein_has_no_gc_percentage():
    parsed = parse_fasta_text(">p\nMKWVTFIS\n")
    validation = validate_records(parsed, "protein")
    result = calculate_statistics(validation)
    assert result["records"][0]["gc_percent"] is None
    assert result["summary"]["gc_percent_mean"] is None


def test_n50_and_l50():
    parsed = parse_fasta_text(">a\nAAAAAAAAAA\n>b\nCCCCCC\n>c\nGGGG\n")
    validation = validate_records(parsed, "dna")
    result = calculate_statistics(validation)
    assert result["summary"]["n50"] == 10
    assert result["summary"]["l50"] == 1


def test_invalid_records_are_excluded_from_statistics():
    parsed = parse_fasta_text(">good\nACGT\n>bad\nACGTZ123\n")
    validation = validate_records(parsed, "dna")
    result = calculate_statistics(validation)
    assert result["summary"]["total_records"] == 2
    assert result["summary"]["valid_records"] == 1
    assert result["summary"]["analyzed_records"] == 1
    assert result["summary"]["total_length"] == 4
