"""Benchmark tooling tests using SYNTHETIC sequences.

BLAST+ is not required: a tiny same-length identity search stands in for it so
the full chain (queries -> hits -> taxonomy -> verdict -> evaluation) runs
offline. Results demonstrate the pipeline only; they say nothing about
real-world accuracy.
"""

import json
import random
import sys
from pathlib import Path

import pytest

ENGINE_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ENGINE_ROOT / "src"))

from Bio import SeqIO
from io import StringIO

from smartbio.benchmark import evaluate_benchmark, make_benchmark_queries, parse_truth_text
from smartbio.blast import analyze_blast, parse_blast_text
from smartbio.taxonomy import TaxonomyResolver, load_difficult_groups, run_taxonomy_analysis

GROUPS = load_difficult_groups(Path(__file__).resolve().parents[2] / "shared" / "difficult-groups.json")
LENGTH = 500


def _random_seq(rng, n):
    return "".join(rng.choice("ACGT") for _ in range(n))


def _diverge(seq, rate, rng):
    out = list(seq)
    for i in range(len(out)):
        if rng.random() < rate:
            out[i] = rng.choice([b for b in "ACGT" if b != out[i]])
    return "".join(out)


def build_reference(seed=7):
    """B. cereus-like group (very close siblings) plus unrelated species."""
    rng = random.Random(seed)
    root = _random_seq(rng, 700)
    records = []
    for i, sp in enumerate(["Bacillus cereus", "Bacillus thuringiensis", "Bacillus anthracis"]):
        records.append((f"NR_{100+i}.1", sp, _diverge(root, 0.003, rng)))
    records.append(("NR_200.1", "Bacillus subtilis", _diverge(root, 0.09, rng)))
    for i, sp in enumerate(["Escherichia coli", "Pseudomonas aeruginosa", "Listeria monocytogenes"]):
        records.append((f"NR_{300+i}.1", sp, _random_seq(rng, 700)))
    text = "".join(f">{acc} {sp} strain X 16S ribosomal RNA, complete sequence\n{seq}\n" for acc, sp, seq in records)
    return text


def taxonomy_map_for(reference_text, path):
    species = {}
    for rec in SeqIO.parse(StringIO(reference_text), "fasta"):
        parts = rec.description.split()
        species[f"{parts[1]} {parts[2]}"] = rec.id
    genera = sorted({s.split()[0] for s in species})
    lines = ["taxid\tscientific_name\trank\tparent_taxid\tfull_lineage", "2\tBacteria\tsuperkingdom\t\tBacteria"]
    gid = {g: 1000 + i for i, g in enumerate(genera)}
    for g in genera:
        lines.append(f"{gid[g]}\t{g}\tgenus\t2\tBacteria;{g}")
    sid = {}
    for i, sp in enumerate(sorted(species)):
        sid[sp] = 2000 + i
        g = sp.split()[0]
        lines.append(f"{sid[sp]}\t{sp}\tspecies\t{gid[g]}\tBacteria;{g};{sp}")
    lines.append("1\troot\troot\t\troot")
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return sid


def fake_search(queries_text, reference_text, sid):
    """Same-length identity search standing in for BLAST (substitutions only)."""
    refs = [(r.id, " ".join(r.description.split()[1:3]), str(r.seq)[:LENGTH])
            for r in SeqIO.parse(StringIO(reference_text), "fasta")]
    rows = ["qseqid\tsacc\tstaxids\tsscinames\tpident\tlength\tqstart\tqend\tqlen\tevalue\tbitscore\tqcovs"]
    for q in SeqIO.parse(StringIO(queries_text), "fasta"):
        qs = str(q.seq)
        for acc, sp, rs in refs:
            mism = sum(1 for a, b in zip(qs, rs) if a != b)
            pid = round(100 * (1 - mism / len(qs)), 2)
            if pid < 80:
                continue
            rows.append("\t".join(map(str, [q.id, acc, sid[sp], sp, pid, len(qs), 1, len(qs),
                                            len(qs), "0.0", round(pid * 5, 1), 100])))
    return "\n".join(rows) + "\n"


def run_chain(reference_text, queries_text, truth_text, tmp_path, seed_label="x"):
    map_path = tmp_path / f"map_{seed_label}.tsv"
    sid = taxonomy_map_for(reference_text, map_path)
    tsv = fake_search(queries_text, reference_text, sid)
    parsed = parse_blast_text(tsv, schema="blastn_local_v1")
    qids = [r.id for r in SeqIO.parse(StringIO(queries_text), "fasta")]
    report = analyze_blast(parsed, query_ids=qids)
    resolver = TaxonomyResolver(mapping_path=map_path)
    resolver.load_mapping()
    analysis = run_taxonomy_analysis(report, resolver, difficult_groups=GROUPS)
    return evaluate_benchmark(analysis, parse_truth_text(truth_text), groups=GROUPS), analysis


def test_make_queries_is_deterministic_and_has_truth():
    ref = build_reference()
    a = make_benchmark_queries(ref, mode="noisy", n=5, length=LENGTH, seed=3)
    b = make_benchmark_queries(ref, mode="noisy", n=5, length=LENGTH, seed=3)
    assert a["queries_fasta"] == b["queries_fasta"] and a["truth_tsv"] == b["truth_tsv"]
    assert a["truth_tsv"].startswith("query_id\ttrue_species\n")
    assert a["reference_fasta"] is None
    assert len(parse_truth_text(a["truth_tsv"])) == 5


def test_heldout_removes_query_sources_from_reference():
    ref = build_reference()
    out = make_benchmark_queries(ref, mode="heldout", n=3, length=LENGTH, seed=1)
    sources = {line.split("source=")[1].strip() for line in out["queries_fasta"].splitlines() if line.startswith(">")}
    kept_ids = {r.id for r in SeqIO.parse(StringIO(out["reference_fasta"]), "fasta")}
    assert sources and not (sources & kept_ids)


def test_make_queries_rejects_bad_input():
    with pytest.raises(ValueError):
        make_benchmark_queries("", mode="noisy")
    with pytest.raises(ValueError):
        make_benchmark_queries(build_reference(), mode="other")
    with pytest.raises(ValueError):
        make_benchmark_queries(build_reference(), substitution_rate=0.9)


def test_truth_parser_errors():
    assert parse_truth_text("query_id\ttrue_species\nq1\tA b\n") == {"q1": "A b"}
    with pytest.raises(ValueError):
        parse_truth_text("q1\tA b\nq1\tC d\n")
    with pytest.raises(ValueError):
        parse_truth_text("only_one_column\n")


def test_noisy_copies_of_database_records_run_end_to_end(tmp_path):
    """Easy case: the true record is in the database, so top hit is usually right.

    This only proves the chain runs and every query receives a verdict. It is
    NOT evidence of improved accuracy (see the absent-member test below).
    """
    ref = build_reference()
    q = make_benchmark_queries(ref, mode="noisy", n=7, length=LENGTH, substitution_rate=0.006, seed=11)
    report, analysis = run_chain(ref, q["queries_fasta"], q["truth_tsv"], tmp_path)
    assert report["n_evaluated"] == 7
    assert sum(report["verdict_method"]["verdict_counts"].values()) == 7
    assert report["verdict_method"]["wrong"] <= report["top_hit_method"]["wrong"]


def test_absent_group_member_top_hit_is_wrong_but_verdict_abstains(tmp_path):
    """The claim under test: when the true species is missing from the database,
    the top-hit method confidently names a close sibling, while the verdict layer
    does not assert a species."""
    ref = build_reference()
    q = make_benchmark_queries(ref, mode="noisy", n=7, length=LENGTH, substitution_rate=0.0, seed=5)
    truth = parse_truth_text(q["truth_tsv"])
    cereus_queries = [qid for qid, sp in truth.items() if sp == "Bacillus cereus"]
    assert cereus_queries, "fixture must contain a B. cereus query"

    # Remove B. cereus from the database but keep its close siblings.
    reduced = "".join(
        f">{r.description}\n{str(r.seq)}\n"
        for r in SeqIO.parse(StringIO(ref), "fasta")
        if " ".join(r.description.split()[1:3]) != "Bacillus cereus"
    )
    report, _ = run_chain(reduced, q["queries_fasta"], q["truth_tsv"], tmp_path, "absent")
    rows = {r["query_id"]: r for r in report["rows"]}
    for qid in cereus_queries:
        row = rows[qid]
        assert row["top_hit_species"] in {"Bacillus thuringiensis", "Bacillus anthracis"}
        assert row["top_hit_correct"] is False
        assert row["verdict_species_call"] is None, row
        assert row["verdict"] in {"group_level_only", "genus_level_only"}
        assert row["verdict_genus_correct"] is True
    assert report["top_hit_method"]["wrong"] >= len(cereus_queries)
    assert report["verdict_method"]["wrong"] == 0


def test_heldout_species_are_not_called_at_species_level_when_far(tmp_path):
    ref = build_reference()
    q = make_benchmark_queries(ref, mode="heldout", n=3, length=LENGTH, substitution_rate=0.0, seed=2)
    report, _ = run_chain(q["reference_fasta"], q["queries_fasta"], q["truth_tsv"], tmp_path, "held")
    # Truth species are absent from the database: any species-level call is wrong.
    assert report["verdict_method"]["correct"] == 0
    assert report["top_hit_method"]["correct"] == 0


def test_missing_results_are_reported_not_hidden():
    analysis = {"per_query": {}, "no_hit_queries": {}}
    report = evaluate_benchmark(analysis, {"q1": "A b"})
    assert report["n_evaluated"] == 0
    assert report["truth_without_result"] == ["q1"]

from smartbio.benchmark.evaluate import wilson_interval, evaluate_benchmark


def test_wilson_interval_bounds_and_input_validation():
    lo, hi = wilson_interval(5, 10)
    assert 0 <= lo <= 0.5 <= hi <= 1
    assert wilson_interval(0, 5) == (0.0, 0.0) or wilson_interval(0, 5)[0] == 0.0
    assert wilson_interval(3, 3)[1] == 1.0
    assert wilson_interval(1, 0) is None
    with pytest.raises(ValueError):
        wilson_interval(6, 5)
    with pytest.raises(ValueError):
        wilson_interval(-1, 5)


def test_cutoff_baseline_and_wilson_in_report():
    analysis = {"per_query": {
        "q1": {
            "consensus": {"evidence": [{"bitscore": 10, "pident": 99.5, "lineage": {"ranks": {"species": {"name": "Escherichia  coli"}}}}], "status": "species_agreement"},
            "verdict": {"status": "species_supported", "reported_taxon": "Escherichia coli", "reported_rank": "species", "caution_flags": [], "difficult_groups": [], "evidence_summary": {"top_identity": 99.5}},
        },
        "q2": {
            "consensus": {"evidence": [{"bitscore": 10, "pident": 97.0, "lineage": {"ranks": {"species": {"name": "Escherichia coli"}}}}], "status": "species_agreement"},
            "verdict": {"status": "below_screening_threshold", "reported_taxon": "Escherichia", "reported_rank": "genus", "caution_flags": [], "difficult_groups": [], "evidence_summary": {"top_identity": 97.0}},
        },
    }}
    # minimal verdict for q1
    analysis["per_query"]["q1"]["verdict"] = {"status": "species_supported", "reported_taxon": "Escherichia coli", "reported_rank": "species", "caution_flags": [], "difficult_groups": [], "evidence_summary": {"top_identity": 99.5}}
    report = evaluate_benchmark(analysis, {"q1": "Escherichia coli", "q2": "Escherichia coli"})
    c = report["top_hit_cutoff_method"]
    assert c["species_calls"] == 1 and c["wrong"] == 0
    assert report["top_hit_method"]["wilson_95pct_ci_on_correct_rate"] is not None
    assert report["verdict_method"]["wilson_95pct_ci_on_correct_rate"] is not None


def test_total_queries_includes_no_hit_queries():
    from smartbio.blast import parse_blast_text, analyze_blast
    parsed = parse_blast_text("", schema="standard")
    rep = analyze_blast(parsed, query_ids=["q1", "q2"])
    assert rep["summary"]["total_queries"] == 2
    assert rep["summary"]["queries_with_no_hits"] == 2
    assert rep["summary"]["unique_queries"] == 0


def test_indel_option_is_deterministic_and_recorded():
    ref = build_reference()
    a = make_benchmark_queries(ref, mode="noisy", n=3, length=LENGTH, substitution_rate=0.005, indel_rate=0.01, seed=9)
    b = make_benchmark_queries(ref, mode="noisy", n=3, length=LENGTH, substitution_rate=0.005, indel_rate=0.01, seed=9)
    no_indel = make_benchmark_queries(ref, mode="noisy", n=3, length=LENGTH, substitution_rate=0.005, indel_rate=0.0, seed=9)
    assert a["queries_fasta"] == b["queries_fasta"]
    assert a["queries_fasta"] != no_indel["queries_fasta"]
    assert a["indel_rate"] == 0.01 and no_indel["indel_rate"] == 0.0
    assert a["simulated_errors_not_sequencing_errors"] is True
    with pytest.raises(ValueError):
        make_benchmark_queries(ref, indel_rate=0.9)
