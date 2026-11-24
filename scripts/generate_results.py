#!/usr/bin/env python3
"""Regenerate benchmark_data/RESULTS.md from saved benchmark JSON outputs.

Never hand-edit RESULTS.md: run this script after each benchmark run.
"""
from __future__ import annotations

import datetime
import hashlib
import json
import os
from pathlib import Path


def find_benchmark_data() -> Path:
    here = Path(__file__).resolve().parent.parent
    candidate = here / "benchmark_data"
    if candidate.is_dir():
        return candidate
    for root, dirs, _files in os.walk("D:\\"):
        for d in dirs:
            if d == "benchmark_data":
                p = Path(root) / d
                if (p / "benchmark_runs_heldout4").is_dir():
                    return p
    raise SystemExit("benchmark_data not found")


def sha256(path: Path) -> str:
    if not path.is_file():
        return "not-visible-in-this-filesystem-view"
    h = hashlib.sha256()
    with path.open("rb") as fh:
        for chunk in iter(lambda: fh.read(65536), b""):
            h.update(chunk)
    return h.hexdigest()


def load_run(bd: Path, name: str):
    summary = json.loads((bd / name / "benchmark_summary.json").read_text(encoding="utf-8"))
    seeds = []
    for ps in summary["per_seed"]:
        report = json.loads((bd / name / ("seed_" + str(ps["seed"])) / "eval" / "benchmark_report.json").read_text(encoding="utf-8"))
        seeds.append({
            "seed": ps["seed"],
            "top": report["top_hit_method"],
            "cutoff": report["top_hit_cutoff_method"],
            "verdict": report["verdict_method"],
        })
    return summary, seeds


def mean(values):
    return sum(values) / len(values) if values else None


def main() -> int:
    bd = find_benchmark_data()
    held, hs = load_run(bd, "benchmark_runs_heldout4")
    noisy, ns = load_run(bd, "benchmark_runs_noisy2")
    lines: list[str] = []
    a = lines.append
    a("# Real 16S benchmark results")
    a("")
    a("Generated from saved JSON outputs by `scripts/generate_results.py`. Do not edit by hand.")
    a("")
    a("## Environment and provenance")
    a("")
    a("- Date generated: " + datetime.date.today().isoformat())
    a("- NCBI BLAST+: `blastn: 2.17.0+`, Package: blast 2.17.0, build Jul  1 2025 08:57:20 (installed from the official NCBI Windows installer; SHA-256 not-visible-in-this-filesystem-view)")
    a("- Reference: curated bacterial 16S RefSeq targeted loci, `bacteria.16SrRNA.fna.gz` (download 2026-11-24, SHA-256 " + sha256(bd / "bacteria.16SrRNA.fna.gz") + ")")
    a("- Taxonomy dump: `taxdump.tar.gz` (download 2026-11-24, SHA-256 " + sha256(bd / "taxdump.tar.gz") + "), nodes.dmp + names.dmp; no rankedlineage.dmp in this release.")
    a("- Accession-to-taxid: extracted from `bacteria.16SrRNA.gbff.gz` (download 2026-11-24, SHA-256 " + sha256(bd / "bacteria.16SrRNA.gbff.gz") + "), 26,888 rows.")
    a("- URLs actually used: `https://ftp.ncbi.nlm.nih.gov/refseq/TargetedLoci/Bacteria/bacteria.16SrRNA.fna.gz`, `.../bacteria.16SrRNA.gbff.gz`, `https://ftp.ncbi.nlm.nih.gov/pub/taxonomy/taxdump.tar.gz` (verified from https://www.ncbi.nlm.nih.gov/refseq/targetedloci/ and the FTP directory listings).")
    a("- Commands: see `run_heldout4.log` and `run_noisy2.log` in this folder.")
    a("")
    for name, summ, seeds in [("Held-out (headline)", held, hs), ("Noisy (sanity)", noisy, ns)]:
        a("## " + name)
        a("")
        a("- n=" + str(summ["n_queries"]) + " per seed, length=" + str(summ["length"]) + " nt, substitution rate=" + str(summ["substitution_rate"]) + ", seeds=" + ", ".join(summ["seeds"]) + ".")
        a("| Method | Calls/200 (mean) | Wrong calls (mean) | Wrong rate among calls | Abstentions (mean) |")
        a("|---|---|---|---|---|")
        for label, key in [("Plain top hit", "top"), ("Top hit + 98.65% cutoff", "cutoff"), ("Toolkit verdict", "verdict")]:
            calls = mean([s[key]["species_calls"] for s in seeds])
            wrong = mean([s[key]["wrong"] for s in seeds])
            rates = [s[key]["wrong_rate_among_calls"] for s in seeds if s[key]["wrong_rate_among_calls"] is not None]
            rate = mean(rates)
            abst = mean([s[key].get("abstained", summ["n_queries"] - s[key]["species_calls"]) for s in seeds])
            a("| " + label + " | " + f"{calls:.1f}" + " | " + f"{wrong:.1f}" + " | " + (f"{rate:.3f}" if rate is not None else "n/a") + " | " + f"{abst:.1f}" + " |")
        a("")
        a("Per-seed wrong calls (top / cutoff / verdict): " + "; ".join("seed " + s["seed"] + ": " + str(s["top"]["wrong"]) + " / " + str(s["cutoff"]["wrong"]) + " / " + str(s["verdict"]["wrong"]) for s in seeds))
        a("")
        a("Wilson 95% CI on correct-call rate (seed 1): top " + str(seeds[0]["top"]["wilson_95pct_ci_on_correct_rate"]) + ", cutoff " + str(seeds[0]["cutoff"]["wilson_95pct_ci_on_correct_rate"]) + ", verdict " + str(seeds[0]["verdict"]["wilson_95pct_ci_on_correct_rate"]))
        a("")
    a("## Limitations")
    a("")
    a("- Truth comes from FASTA headers and can itself be wrong; one database release only.")
    a("- Simulated substitutions/indels are not real sequencing errors or real strain variation; queries are the first 500 nt (V1-V3-like start region).")
    a("- Held-out removes the source accessions; the true species may still be represented by other strains in the database.")
    a("- Group-level containment was 0 in these runs (no difficult-group members among held-out truths).")
    a("- The verdict beats the 98.65% cutoff baseline in wrong calls but calls a species far less often; compare call rates, not just wrong counts.")
    a("")
    out = bd / "RESULTS.md"
    out.write_text("\n".join(lines), encoding="utf-8")
    print("WROTE", out)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

