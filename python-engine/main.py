#!/usr/bin/env python3
"""CLI entry point for the Smart Bioinformatics Toolkit first milestone."""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
from pathlib import Path

# Allow running `python main.py` directly from this directory without an install step.
sys.path.insert(0, str(Path(__file__).resolve().parent / "src"))

from smartbio.exports import write_csv, write_json
from smartbio.fasta import parse_fasta_file, validate_records
from smartbio.statistics import calculate_statistics, statistics_dataframe
from smartbio.blast import (
    parse_blast_file,
    parse_blast_text,
    analyze_blast,
    blast_dataframe,
    parse_query_lengths_text,
)
from smartbio.blast_runner import run_blastn
from smartbio.taxonomy import run_taxonomy_analysis, TaxonomyResolver, load_difficult_groups


def _base_report(input_path: str, validation: dict) -> dict:
    return {
        "tool": "Smart Bioinformatics Toolkit",
        "tool_version": "0.1.0",
        "input_file": str(Path(input_path).name),
        "sequence_type": validation["sequence_type"],
        "validation": validation,
    }


def _parse_blast_with_fallback(input_path: str, requested_schema: str) -> dict:
    """Parse BLAST TSV, with a deterministic fallback for local-runner output.

    Auto-inference is based on column count only, so a `blastn_local_v1` file
    (12 columns) is inferred as `standard` and every row fails validation.
    When that happens, we re-parse with the schema recorded by the adjacent
    `blast_run.json` written by `blast-run`. This is a deterministic,
    documented fallback - not arbitrary guessing.
    """
    parsed = parse_blast_file(input_path, schema=requested_schema)
    if requested_schema == "auto" and parsed["parsed_rows"] == 0 and parsed["data_rows"] > 0:
        meta_path = Path(input_path).with_name("blast_run.json")
        if meta_path.exists():
            try:
                meta = json.loads(meta_path.read_text(encoding="utf-8"))
                schema = meta.get("schema")
                if schema in ("blastn_local_v1", "extended"):
                    parsed = parse_blast_file(input_path, schema=schema)
                    parsed["schema_source"] = "fallback:blast_run.json"
                    parsed.setdefault("file_errors", []).append({
                        "code": "SCHEMA_FROM_RUN_METADATA",
                        "message": (
                            f"Schema '{schema}' was selected automatically from {meta_path.name} "
                            "because all rows failed to parse as standard outfmt 6."
                        ),
                        "line": None,
                    })
            except (OSError, json.JSONDecodeError):
                pass
    return parsed


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="smartbio",
        description="Validate FASTA files and calculate sequence statistics.",
        epilog="Statistics are calculated from valid, non-empty records only.",
    )
    subparsers = parser.add_subparsers(dest="command", required=True)

    for command in ("validate", "stats", "analyze"):
        child = subparsers.add_parser(command, help=f"Run the {command} operation.")
        child.add_argument("--input", required=True, help="Input FASTA file.")
        child.add_argument("--type", required=True, choices=("dna", "protein"), dest="sequence_type")
        if command == "validate":
            child.add_argument("--json-out", help="Optional path for validation JSON.")
        elif command == "stats":
            child.add_argument("--csv-out", help="Optional path for per-record statistics CSV.")
            child.add_argument("--json-out", help="Optional path for statistics JSON.")
        else:
            child.add_argument("--out-dir", required=True, help="Directory for all analysis outputs.")

    blast = subparsers.add_parser("blast", help="Analyze a BLAST tabular (outfmt 6) file.")
    blast.add_argument("--input", required=True, help="Input BLAST TSV file.")
    blast.add_argument("--schema", choices=("auto", "standard", "extended", "blastn_local_v1"), default="auto")
    blast.add_argument("--min-identity", type=float, default=0.0, dest="min_identity")
    blast.add_argument("--min-query-coverage", type=float, default=0.0, dest="min_query_coverage")
    blast.add_argument("--max-evalue", type=float, default=None, dest="max_evalue")
    blast.add_argument("--max-hits", type=int, default=0, dest="max_hits")
    blast.add_argument("--query-fasta", help="Optional FASTA of query sequences to derive lengths and no-hit list.")
    blast.add_argument("--query-lengths", help="Optional TSV/whitespace file mapping query id to length.")
    blast.add_argument("--query-list", help="Optional file with one query id per line.")
    blast.add_argument("--csv-out", help="Optional path for filtered results CSV.")
    blast.add_argument("--json-out", help="Optional path for analysis JSON.")
    blast.add_argument("--out-dir", help="Directory for all BLAST analysis outputs.")

    blast_run = subparsers.add_parser("blast-run", help="Run local BLAST+ (blastn) and analyze results.")
    blast_run.add_argument("--input", required=True, help="Input DNA FASTA file.")
    blast_run.add_argument("--database", required=True, help="BLAST database name or path.")
    blast_run.add_argument("--type", choices=("dna",), default="dna", dest="sequence_type")
    blast_run.add_argument("--program", choices=("blastn",), default="blastn")
    blast_run.add_argument("--task", choices=("megablast", "blastn", "dc-megablast", "blastn-short"), default="megablast")
    blast_run.add_argument("--evalue", type=float, default=1e-5)
    blast_run.add_argument("--max-target-seqs", type=int, default=500, dest="max_target_seqs")
    blast_run.add_argument("--threads", type=int, default=1, dest="num_threads")
    blast_run.add_argument("--timeout", type=int, default=600)
    blast_run.add_argument("--blastn-path", help="Optional path to blastn executable.")
    blast_run.add_argument("--blastdbcmd-path", help="Optional path to blastdbcmd executable.")
    blast_run.add_argument("--out-dir", required=True, help="Directory for all BLAST run outputs.")
    blast_run.add_argument("--min-identity", type=float, default=0.0, dest="min_identity")
    blast_run.add_argument("--min-query-coverage", type=float, default=0.0, dest="min_query_coverage")
    blast_run.add_argument("--max-evalue-filter", type=float, default=None, dest="max_evalue_filter")
    blast_run.add_argument("--max-hits", type=int, default=0, dest="max_hits")

    bq = subparsers.add_parser("benchmark-queries", help="Generate benchmark queries and a truth table from a reference FASTA.")
    bq.add_argument("--reference", required=True, help="Reference FASTA (RefSeq-style headers: accession Genus species ...).")
    bq.add_argument("--mode", choices=("noisy", "heldout"), default="noisy")
    bq.add_argument("--n", type=int, default=20, help="Number of queries.")
    bq.add_argument("--length", type=int, default=500, help="Query length in nt (default 500).")
    bq.add_argument("--substitution-rate", type=float, default=0.005, dest="substitution_rate")
    bq.add_argument("--seed", type=int, default=1)
    bq.add_argument("--out-dir", required=True)

    be = subparsers.add_parser("benchmark-eval", help="Compare top-hit calls with verdicts against a truth table.")
    be.add_argument("--analysis", required=True, help="taxonomy_analysis.json from the taxonomy command.")
    be.add_argument("--truth", required=True, help="TSV: query_id<TAB>true_species.")
    be.add_argument("--difficult-groups", dest="difficult_groups")
    be.add_argument("--out-dir", required=True)

    taxonomy = subparsers.add_parser("taxonomy", help="Run taxonomic consensus analysis on BLAST results.")
    taxonomy.add_argument("--input", required=True, help="Input BLAST TSV file.")
    taxonomy.add_argument("--schema", choices=("auto", "standard", "extended", "blastn_local_v1"), default="auto")
    taxonomy.add_argument("--taxonomy-map", help="Optional local taxonomy mapping TSV.")
    taxonomy.add_argument("--online", action="store_true", help="Enable online NCBI taxonomy resolution.")
    taxonomy.add_argument("--email", help="Contact email for NCBI E-utilities.")
    taxonomy.add_argument("--api-key", help="Optional NCBI API key.")
    taxonomy.add_argument("--rate-limit", type=float, default=3.0, help="Max NCBI requests per second.")
    taxonomy.add_argument("--top-n", type=int, default=10, dest="top_n")
    taxonomy.add_argument("--min-consensus", type=float, default=0.8, dest="min_consensus")
    taxonomy.add_argument("--min-identity", type=float, default=0.0, dest="min_identity")
    taxonomy.add_argument("--min-query-coverage", type=float, default=0.0, dest="min_query_coverage")
    taxonomy.add_argument("--max-evalue", type=float, default=None, dest="max_evalue")
    taxonomy.add_argument("--max-hits", type=int, default=0, dest="max_hits")
    taxonomy.add_argument("--query-fasta", help="Optional FASTA of query sequences to derive lengths and no-hit list.")
    taxonomy.add_argument("--query-lengths", help="Optional TSV/whitespace file mapping query id to length.")
    taxonomy.add_argument("--query-list", help="Optional file with one query id per line.")
    taxonomy.add_argument("--species-threshold", type=float, default=98.65, dest="species_threshold", help="16S identity screening reference for species-level verdicts (default 98.65; not a universal boundary).")
    taxonomy.add_argument("--verdict-min-coverage", type=float, default=80.0, dest="verdict_min_coverage", help="Minimum top-hit query coverage for a verdict (default 80).")
    taxonomy.add_argument("--min-query-length", type=int, default=500, 
dest="min_query_length", help="Warn when the query is shorter than this many nt (default 500).")
    taxonomy.add_argument("--report", dest="report", help="Path to write a self-contained HTML report (default: <out-dir>/taxonomy_report.html).")
    taxonomy.add_argument("--difficult-groups", dest="difficult_groups", help="Path to a difficult-groups JSON (default shared/difficult-groups.json).")
    taxonomy.add_argument("--out-dir", required=True, help="Directory for all taxonomy outputs.")
    return parser


def run(args: argparse.Namespace) -> int:
    if args.command in {"blast", "blast-run", "taxonomy", "benchmark-queries", "benchmark-eval"}:
        # Handle BLAST/taxonomy commands independently; no top-level FASTA parsing.
        pass
    else:
        parsed = parse_fasta_file(args.input)
        validation = validate_records(parsed, args.sequence_type)

    if args.command == "blast":
        parsed = _parse_blast_with_fallback(args.input, args.schema)
        query_lengths: dict[str, int] = {}
        query_ids: list[str] = []
        if args.query_fasta:
            from smartbio.fasta import parse_fasta_file as _pf
            p = _pf(args.query_fasta)
            for rec in p["records"]:
                if rec.get("id"):
                    query_lengths[rec["id"]] = len(rec.get("sequence", ""))
                    query_ids.append(rec["id"])
        if args.query_lengths:
            text = Path(args.query_lengths).read_text(encoding="utf-8-sig")
            ql = parse_query_lengths_text(text)
            query_lengths.update(ql)
            for qid in ql:
                if qid not in query_ids:
                    query_ids.append(qid)
        if args.query_list:
            for line in Path(args.query_list).read_text(encoding="utf-8-sig").splitlines():
                qid = line.strip()
                if qid and qid not in query_ids:
                    query_ids.append(qid)

        report = analyze_blast(
            parsed,
            min_identity=args.min_identity,
            min_query_coverage=args.min_query_coverage,
            max_evalue=args.max_evalue,
            max_hits=args.max_hits,
            query_lengths=query_lengths,
            query_ids=query_ids,
        )
        report["schema_source"] = parsed.get("schema_source")

        if args.out_dir:
            output_dir = Path(args.out_dir)
            output_dir.mkdir(parents=True, exist_ok=True)
            write_json(report, output_dir / "blast_analysis.json")
            write_csv(blast_dataframe(report, filtered_only=True), output_dir / "blast_filtered.csv")
            write_csv(blast_dataframe(report, filtered_only=False), output_dir / "blast_all_rows.csv")
            print(json.dumps({"output_dir": str(output_dir), "summary": report["summary"]}, indent=2))
            return 0 if report["summary"]["malformed_rows"] == 0 else 2

        if args.csv_out:
            write_csv(blast_dataframe(report, filtered_only=True), args.csv_out)
        if args.json_out:
            write_json(report, args.json_out)
        print(json.dumps(report, indent=2, ensure_ascii=False))
        return 0 if report["summary"]["malformed_rows"] == 0 else 2

    if args.command == "blast-run":
        result = run_blastn(
            input_path=args.input,
            database=args.database,
            out_dir=args.out_dir,
            task=args.task,
            evalue=args.evalue,
            max_target_seqs=args.max_target_seqs,
            num_threads=args.num_threads,
            timeout=args.timeout,
            blastn_path=args.blastn_path,
            blastdbcmd_path=args.blastdbcmd_path,
            min_identity=args.min_identity,
            min_query_coverage=args.min_query_coverage,
            max_evalue_filter=args.max_evalue_filter,
            max_hits=args.max_hits,
        )
        print(json.dumps({"output_dir": args.out_dir, "summary": result["report"]["summary"], "metadata": result["metadata"]}, indent=2))
        return 0 if result["report"]["summary"]["malformed_rows"] == 0 else 2

    if args.command == "benchmark-queries":
        from smartbio.benchmark import make_benchmark_queries
        result = make_benchmark_queries(
            Path(args.reference).read_text(encoding="utf-8-sig"),
            mode=args.mode, n=args.n, length=args.length,
            substitution_rate=args.substitution_rate, seed=args.seed,
        )
        out = Path(args.out_dir)
        out.mkdir(parents=True, exist_ok=True)
        (out / "queries.fasta").write_text(result["queries_fasta"], encoding="utf-8")
        (out / "truth.tsv").write_text(result["truth_tsv"], encoding="utf-8")
        if result["mode"] == "heldout":
            sources = [ln.split("source=")[1].strip() for ln in result["queries_fasta"].splitlines() if ln.startswith(">") and "source=" in ln]
            (out / "heldout_seqids.txt").write_text("\n".join(sources) + "\n", encoding="utf-8")
        if result["reference_fasta"] is not None:
            (out / "reference_without_queries.fasta").write_text(result["reference_fasta"], encoding="utf-8")
        meta = {k: v for k, v in result.items() if k not in {"queries_fasta", "truth_tsv", "reference_fasta"}}
        write_json(meta, out / "benchmark_queries.json")
        print(json.dumps({"output_dir": str(out), **meta}, indent=2))
        return 0

    if args.command == "benchmark-eval":
        from smartbio.benchmark import evaluate_benchmark, parse_truth_text
        analysis = json.loads(Path(args.analysis).read_text(encoding="utf-8-sig"))
        truth = parse_truth_text(Path(args.truth).read_text(encoding="utf-8-sig"))
        report = evaluate_benchmark(
            analysis, truth, groups=load_difficult_groups(args.difficult_groups) if args.difficult_groups else load_difficult_groups()
        )
        out = Path(args.out_dir)
        out.mkdir(parents=True, exist_ok=True)
        write_json(report, out / "benchmark_report.json")
        import pandas as pd
        pd.DataFrame(
            [{**r, "caution_flags": "; ".join(r["caution_flags"])} for r in report["rows"]]
        ).to_csv(out / "benchmark_rows.csv", index=False)
        print(json.dumps({k: report[k] for k in ("n_evaluated", "n_truth_without_result", "top_hit_method", "verdict_method")}, indent=2))
        return 0

    if args.command == "taxonomy":
        parsed = _parse_blast_with_fallback(args.input, args.schema)
        query_lengths: dict[str, int] = {}
        query_ids: list[str] = []
        if args.query_fasta:
            from smartbio.fasta import parse_fasta_file as _pf
            p = _pf(args.query_fasta)
            for rec in p["records"]:
                if rec.get("id"):
                    query_lengths[rec["id"]] = len(rec.get("sequence", ""))
                    query_ids.append(rec["id"])
        if args.query_lengths:
            text = Path(args.query_lengths).read_text(encoding="utf-8-sig")
            ql = parse_query_lengths_text(text)
            query_lengths.update(ql)
            for qid in ql:
                if qid not in query_ids:
                    query_ids.append(qid)
        if args.query_list:
            for line in Path(args.query_list).read_text(encoding="utf-8-sig").splitlines():
                qid = line.strip()
                if qid and qid not in query_ids:
                    query_ids.append(qid)

        report = analyze_blast(
            parsed,
            min_identity=args.min_identity,
            min_query_coverage=args.min_query_coverage,
            max_evalue=args.max_evalue,
            max_hits=args.max_hits,
            query_lengths=query_lengths,
            query_ids=query_ids,
        )
        report["schema_source"] = parsed.get("schema_source")

        resolver = TaxonomyResolver(
            mapping_path=args.taxonomy_map,
            online=args.online,
            tool="smartbio",
            email=args.email,
            api_key=args.api_key,
            rate_limit=args.rate_limit,
        )
        mapping_report = {}
        if args.taxonomy_map:
            mapping_report = resolver.load_mapping()

        analysis = run_taxonomy_analysis(
            report,
            resolver,
            top_n=args.top_n,
            min_consensus=args.min_consensus,
            species_threshold=args.species_threshold,
            verdict_min_coverage=args.verdict_min_coverage,
            min_query_length=args.min_query_length,
            difficult_groups=load_difficult_groups(args.difficult_groups) if args.difficult_groups else None,
        )
        analysis["mapping_validation"] = mapping_report

        output_dir = Path(args.out_dir)
        output_dir.mkdir(parents=True, exist_ok=True)
        write_json(analysis, output_dir / "taxonomy_analysis.json")

        # Flatten per-query results into a CSV for convenient review.
        import pandas as pd
        csv_rows = []
        for qid, entry in analysis["per_query"].items():
            cons = entry["consensus"]
            csv_rows.append({
                "query_id": qid,
                "verdict": entry["verdict"]["status"],
                "reported_rank": entry["verdict"]["reported_rank"],
                "reported_taxon": entry["verdict"]["reported_taxon"],
                "top_identity": entry["verdict"]["evidence_summary"]["top_identity"],
                "verdict_cautions": "; ".join(entry["verdict"]["caution_flags"]),
                "status": cons["status"],
                "supported_rank": cons["supported_rank"],
                "consensus_taxon": cons["consensus_taxon"],
                "candidate_count": cons["candidate_count"],
                "unique_species": cons["support"].get("unique_species"),
                "genus_support": cons["support"].get("genus_support"),
                "species_support": cons["support"].get("species_support"),
                "candidate_species": "; ".join(cons["candidate_species"]),
                "warnings": "; ".join(cons["warnings"]),
            })
        for qid, entry in analysis["no_hit_queries"].items():
            cons = entry["consensus"]
            csv_rows.append({
                "query_id": qid,
                "verdict": entry["verdict"]["status"],
                "reported_rank": entry["verdict"]["reported_rank"],
                "reported_taxon": entry["verdict"]["reported_taxon"],
                "top_identity": None,
                "verdict_cautions": "",
                "status": cons["status"],
                "supported_rank": cons["supported_rank"],
                "consensus_taxon": cons["consensus_taxon"],
                "candidate_count": cons["candidate_count"],
                "unique_species": None,
                "genus_support": None,
                "species_support": None,
                "candidate_species": "",
                "warnings": "; ".join(cons["warnings"]),
            })
        if csv_rows:
            pd.DataFrame(csv_rows).to_csv(output_dir / "taxonomy_summary.csv", index=False)

        # Printable HTML report.
        from smartbio.taxonomy.report import build_report_html, build_reproducibility_metadata
        try:
            input_bytes = Path(args.input).read_bytes()
            input_hash = hashlib.sha256(input_bytes).hexdigest()
        except OSError:
            input_hash = None
        metadata = build_reproducibility_metadata(
            input_file=str(args.input),
            input_file_hash=input_hash,
            parameters={
                "top_n": args.top_n,
                "min_consensus": args.min_consensus,
                "species_threshold": args.species_threshold,
                "min_coverage": args.verdict_min_coverage,
                "min_query_length": args.min_query_length,
                "near_threshold_margin": getattr(args, "near_threshold_margin", 0.35),
                "difficult_groups_loaded": analysis.get("verdict_settings", {}).get("difficult_groups_loaded"),
            },
            thresholds=analysis.get("thresholds", {}),
        )
        # merge metadata into analysis? not necessary
        report_html = build_report_html(analysis, metadata)
        report_path = Path(args.report) if args.report else (output_dir / "taxonomy_report.html")
        report_path.parent.mkdir(parents=True, exist_ok=True)
        report_path.write_text(report_html, encoding="utf-8")
        print(json.dumps({"report": str(report_path)}, indent=2))

        print(json.dumps({"output_dir": str(output_dir), "summary": analysis["summary"], "verdict_counts": analysis["verdict_counts"], "flags": analysis["flags"]}, indent=2))
        return 0

    if args.command == "validate":
        report = _base_report(args.input, validation)
        if args.json_out:
            write_json(report, args.json_out)
        print(json.dumps(report, indent=2, ensure_ascii=False))
        return 0 if validation["file_valid"] else 2

    statistics = calculate_statistics(validation)
    if args.command == "stats":
        if args.csv_out:
            write_csv(statistics_dataframe(statistics), args.csv_out)
        if args.json_out:
            write_json(statistics, args.json_out)
        print(json.dumps(statistics, indent=2, ensure_ascii=False))
        return 0 if validation["valid_records"] > 0 else 2

    output_dir = Path(args.out_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    combined = {
        "tool": "Smart Bioinformatics Toolkit",
        "tool_version": "0.1.0",
        "input_file": str(Path(args.input).name),
        "sequence_type": args.sequence_type,
        "validation": validation,
        "statistics": statistics,
        "notes": [
            "Statistics include valid, non-empty records only.",
            "DNA GC percentage uses canonical A/C/G/T bases as its denominator; ambiguous bases are excluded.",
            "FASTA input does not contain per-base sequencing quality scores.",
        ],
    }
    write_json({"validation": validation}, output_dir / "validation.json")
    write_json(statistics, output_dir / "statistics.json")
    write_json(combined, output_dir / "analysis.json")
    write_csv(statistics_dataframe(statistics), output_dir / "statistics.csv")
    print(json.dumps({"output_dir": str(output_dir), "validation": validation, "statistics": statistics["summary"]}, indent=2))
    return 0 if validation["valid_records"] > 0 else 2


def main() -> None:
    parser = build_parser()
    args = parser.parse_args()
    try:
        exit_code = run(args)
    except (FileNotFoundError, IsADirectoryError, UnicodeDecodeError, ValueError, RuntimeError) as exc:
        print(f"error: {exc}", file=sys.stderr)
        raise SystemExit(2) from exc
    raise SystemExit(exit_code)


if __name__ == "__main__":
    main()
