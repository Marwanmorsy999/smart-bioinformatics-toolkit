#!/usr/bin/env python3
"""Run the 16S benchmark end to end across several seeds.

Requires BLAST+ (blastn, makeblastdb) on PATH and a reference FASTA.
Optionally accepts a taxonomy mapping TSV (--taxonomy-map) and a BLAST
taxid map (--taxid-map) for makeblastdb.
"""

from __future__ import annotations

import argparse
import json
import shutil
import statistics
import subprocess
import sys
from pathlib import Path


def fail(msg: str) -> None:
    print(f"ERROR: {msg}", file=sys.stderr)
    raise SystemExit(2)


def require_binary(name: str) -> str:
    path = shutil.which(name)
    if not path:
        fail(f"Required binary '{name}' not found on PATH.")
    return path


def run(cmd: list[str], cwd: Path | None = None) -> None:
    print("RUN:", " ".join(cmd))
    res = subprocess.run(cmd, cwd=cwd, capture_output=True, text=True)
    if res.returncode != 0:
        print(res.stdout, file=sys.stderr)
        print(res.stderr, file=sys.stderr)
        fail(f"Command failed (exit {res.returncode}): {' '.join(cmd)}")


def main() -> int:
    parser = argparse.ArgumentParser(description="Run the 16S benchmark end to end.")
    parser.add_argument("--reference", required=True, type=Path)
    parser.add_argument("--out-dir", required=True, type=Path)
    parser.add_argument("--mode", default="heldout", choices=("noisy", "heldout"))
    parser.add_argument("--seeds", default="1,2,3")
    parser.add_argument("--n", type=int, default=20)
    parser.add_argument("--length", type=int, default=200)
    parser.add_argument("--substitution-rate", type=float, default=0.005)
    parser.add_argument("--indel-rate", type=float, default=0.0)
    parser.add_argument("--taxonomy-map", type=Path, default=None)
    parser.add_argument("--taxid-map", type=Path, default=None)
    parser.add_argument("--max-target-seqs", type=int, default=50)
    parser.add_argument("--evalue", default="1e-5")
    parser.add_argument("--min-consensus", type=float, default=0.8)
    parser.add_argument("--species-threshold", type=float, default=98.65)
    parser.add_argument("--python", default=sys.executable)
    args = parser.parse_args()

    if not args.reference.is_file():
        fail(f"Reference FASTA not found: {args.reference}")
    if args.taxonomy_map is not None and not args.taxonomy_map.is_file():
        fail(f"Taxonomy map not found: {args.taxonomy_map}")
    if args.taxid_map is not None and not args.taxid_map.is_file():
        fail(f"Taxid map not found: {args.taxid_map}")

    blastn = require_binary("blastn")
    makeblastdb = require_binary("makeblastdb")
    main_py = Path(__file__).resolve().parents[1] / "python-engine" / "main.py"
    if not main_py.is_file():
        fail(f"main.py not found: {main_py}")

    seeds = [s.strip() for s in args.seeds.split(",") if s.strip()]
    args.out_dir.mkdir(parents=True, exist_ok=True)
    per_seed = []

    for seed in seeds:
        seed_dir = args.out_dir / f"seed_{seed}"
        seed_dir.mkdir(parents=True, exist_ok=True)
        qdir = seed_dir / "queries"
        qdir.mkdir(parents=True, exist_ok=True)

        # 1. generate queries
        run([
            args.python, str(main_py), "benchmark-queries",
            "--reference", str(args.reference),
            "--mode", args.mode,
            "--n", str(args.n),
            "--length", str(args.length),
            "--substitution-rate", str(args.substitution_rate),
            "--indel-rate", str(args.indel_rate),
            "--seed", seed,
            "--out-dir", str(qdir),
        ])

        ref_without = qdir / "reference_without_queries.fasta"
        queries = qdir / "queries.fasta"
        truth = qdir / "truth.tsv"
        if not queries.is_file() or not truth.is_file():
            fail("benchmark-queries did not produce expected files.")
        db_input = ref_without if ref_without.is_file() else args.reference

        # 2. build BLAST db
        db = seed_dir / "db"
        dbdir = seed_dir
        mcmd = [makeblastdb, "-in", str(db_input), "-dbtype", "nucl", "-out", str(db)]
        if args.taxid_map is not None:
            mcmd += ["-parse_seqids", "-taxid_map", str(args.taxid_map)]
        run(mcmd)

        # 3. blastn
        hits = seed_dir / "hits.tsv"
        outfmt = "6 qseqid sacc staxids sscinames pident length qstart qend qlen evalue bitscore qcovs"
        run([
            blastn, "-query", str(queries), "-db", str(db),
            "-outfmt", outfmt, "-out", str(hits),
            "-evalue", args.evalue,
            "-max_target_seqs", str(args.max_target_seqs),
            "-num_threads", "1",
        ])

        # 4. taxonomy
        taxdir = seed_dir / "taxonomy"
        taxdir.mkdir(parents=True, exist_ok=True)
        tcmd = [
            args.python, str(main_py), "taxonomy",
            "--input", str(hits),
            "--schema", "blastn_local_v1",
            "--top-n", "10",
            "--min-consensus", str(args.min_consensus),
            "--species-threshold", str(args.species_threshold),
            "--query-fasta", str(queries),
            "--out-dir", str(taxdir),
        ]
        if args.taxonomy_map is not None:
            tcmd += ["--taxonomy-map", str(args.taxonomy_map)]
        run(tcmd)

        # 5. benchmark-eval
        evaldir = seed_dir / "eval"
        evaldir.mkdir(parents=True, exist_ok=True)
        run([
            args.python, str(main_py), "benchmark-eval",
            "--analysis", str(taxdir / "taxonomy_analysis.json"),
            "--truth", str(truth),
            "--out-dir", str(evaldir),
        ])
        report = json.loads((evaldir / "benchmark_report.json").read_text(encoding="utf-8"))
        per_seed.append({"seed": seed, "report": report})

    # Aggregate
    def collect(keypath):
        vals = []
        for ps in per_seed:
            r = ps["report"]
            for part in keypath:
                r = r[part]
            vals.append(r)
        return vals

    summary = {
        "mode": args.mode,
        "n_seeds": len(seeds),
        "seeds": seeds,
        "n_queries": args.n,
        "length": args.length,
        "substitution_rate": args.substitution_rate,
        "indel_rate": args.indel_rate,
        "per_seed": [
            {
                "seed": ps["seed"],
                "top_hit": ps["report"]["top_hit_method"],
                "verdict": ps["report"]["verdict_method"],
            }
            for ps in per_seed
        ],
    }
    # spread of wrong counts
    top_wrong = [ps["report"]["top_hit_method"]["wrong"] for ps in per_seed]
    verdict_wrong = [ps["report"]["verdict_method"]["wrong"] for ps in per_seed]
    summary["top_hit_wrong_mean"] = statistics.mean(top_wrong) if top_wrong else None
    summary["top_hit_wrong_spread"] = (max(top_wrong) - min(top_wrong)) if top_wrong else None
    summary["verdict_wrong_mean"] = statistics.mean(verdict_wrong) if verdict_wrong else None
    summary["verdict_wrong_spread"] = (max(verdict_wrong) - min(verdict_wrong)) if verdict_wrong else None

    (args.out_dir / "benchmark_summary.json").write_text(
        json.dumps(summary, indent=2), encoding="utf-8"
    )
    print(json.dumps(summary, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

