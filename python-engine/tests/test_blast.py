from pathlib import Path
import sys

ENGINE_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ENGINE_ROOT / "src"))

from smartbio.blast import (
    parse_blast_text,
    parse_blast_file,
    analyze_blast,
    blast_dataframe,
    parse_query_lengths_text,
)

STANDARD_TSV = "\n".join([
    "q1\thitA\t99.0\t100\t1\t0\t1\t100\t1\t100\t1e-50\t200",
    "q1\thitB\t95.0\t80\t5\t0\t1\t80\t1\t80\t1e-20\t120",
    "q2\thitC\t100.0\t50\t0\t0\t1\t50\t1\t50\t1e-10\t90",
])

EXTENDED_TSV = "\n".join([
    "q1\tsacc1\t123\tEscherichia coli\t99.0\t100\t1\t100\t200\t1e-50\t200",
    "q2\tsacc2\t456\tBacillus subtilis\t90.0\t50\t1\t50\t100\t1e-10\t90",
])


def test_infer_standard():
    parsed = parse_blast_text(STANDARD_TSV)
    assert parsed["schema"] == "standard"
    assert parsed["parsed_rows"] == 3


def test_infer_extended():
    parsed = parse_blast_text(EXTENDED_TSV)
    assert parsed["schema"] == "extended"
    assert parsed["parsed_rows"] == 2


def test_ambiguous_counts():
    mixed = STANDARD_TSV + "\n" + "q3\thitX\t90\t10\t0\t0\t1\t10\t1\t10\t1e-5\t50\textra"
    parsed = parse_blast_text(mixed)
    assert parsed["schema"] is None
    assert "Ambiguous" in parsed["file_errors"][0]["message"]


def test_malformed_row_reports_number():
    tsv = "q1\thitA\t99.0\t100\t1\t0\t1\t100\t1\t100\t1e-50\t200\nq2\tbad\tXX\t10\t0\t0\t1\t10\t1\t10\t1e-5\t50"
    parsed = parse_blast_text(tsv)
    assert parsed["malformed_rows"] == 1
    assert parsed["rows"][1]["row_number"] == 2
    assert any(e["code"] == "INVALID_NUMBER" for e in parsed["rows"][1]["errors"])


def test_ties_and_max_hits():
    tsv = "\n".join([
        "q1\thitA\t99.0\t100\t1\t0\t1\t100\t1\t100\t1e-50\t200",
        "q1\thitB\t99.0\t100\t1\t0\t1\t100\t1\t100\t1e-50\t200",
        "q1\thitC\t90.0\t100\t1\t0\t1\t100\t1\t100\t1e-50\t200",
    ])
    parsed = parse_blast_text(tsv)
    report = analyze_blast(parsed, min_identity=99, max_evalue=1e-10, max_hits=1)
    assert report["rows"][0]["tied"] is True
    assert len(report["filtered_rows"]) == 2


def test_standard_coverage_unavailable():
    parsed = parse_blast_text(STANDARD_TSV)
    report = analyze_blast(parsed, min_query_coverage=50)
    assert all(r["query_coverage"] is None for r in report["rows"])
    assert all("query coverage unavailable" in r["fail_reasons"] for r in report["rows"])


def test_query_lengths_enable_coverage():
    parsed = parse_blast_text(STANDARD_TSV)
    ql = {"q1": 100, "q2": 50}
    report = analyze_blast(parsed, min_query_coverage=50, query_lengths=ql)
    q1 = [r for r in report["rows"] if r["qseqid"] == "q1"][0]
    assert q1["query_coverage"] == 100.0


def test_no_hit_queries():
    parsed = parse_blast_text(STANDARD_TSV)
    report = analyze_blast(parsed, query_ids=["q1", "q2", "q3"])
    assert report["no_hit_queries"] == ["q3"]


def test_extended_coverage():
    parsed = parse_blast_text(EXTENDED_TSV)
    report = analyze_blast(parsed, min_query_coverage=80)
    row = report["rows"][0]
    assert row["query_coverage"] == 50.0
    assert row["pass_all"] is False


def test_dataframe_export():
    parsed = parse_blast_text(STANDARD_TSV)
    report = analyze_blast(parsed)
    df = blast_dataframe(report, filtered_only=True)
    assert "qseqid" in df.columns


def test_query_lengths_text_parse():
    text = "q1 100\nq2\t50\n# comment\n"
    ql = parse_query_lengths_text(text)
    assert ql == {"q1": 100, "q2": 50}


def test_explicit_schema_selection():
    tsv = "q1\thitA\t99.0\t100\t1\t0\t1\t100\t1\t100\t1e-50\t200"
    parsed = parse_blast_text(tsv, schema="standard")
    assert parsed["schema"] == "standard"
    assert parsed["schema_source"] == "user"


def test_coord_range_validation():
    tsv = "q1\thitA\t99.0\t100\t1\t0\t1\t200\t1\t100\t1e-50\t200"
    # qend 200 with no qlen (standard) allowed? standard has no qlen, so only >=1. qend=200 ok.
    parsed = parse_blast_text(tsv, schema="standard")
    assert parsed["parsed_rows"] == 1
    # extended with qend > qlen
    tsv2 = "q1\tsacc1\t1\tX\t99.0\t100\t1\t200\t150\t1e-50\t200"
    parsed2 = parse_blast_text(tsv2, schema="extended")
    assert parsed2["malformed_rows"] == 1


def test_empty_input():
    parsed = parse_blast_text("")
    assert parsed["schema"] is None
    assert parsed["file_errors"]
