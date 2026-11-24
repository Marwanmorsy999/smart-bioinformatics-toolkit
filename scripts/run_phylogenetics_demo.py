#!/usr/bin/env python3
"""Run the real phylogenetics pipeline on the known-answer reference FASTA.

Usage (from the repository root):

    python scripts/run_phylogenetics_demo.py
    python scripts/run_phylogenetics_demo.py --out python-engine/output/phylo-demo

The script stages the FASTA through the same adapters as the local agent, writes
every artifact to ``--out``, then repeats the whole run in a fresh workspace to
prove byte-for-byte determinism. No results are precomputed or embedded here.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
import tempfile
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
SRC = REPO_ROOT / "python-engine" / "src"
if str(SRC) not in sys.path:
    sys.path.insert(0, str(SRC))

from smartbio.plugins.phylogenetics import (
    PhylogeneticsAlignPlugin,
    PhylogeneticsReportPlugin,
    PhylogeneticsTreePlugin,
    PhylogeneticsValidatePlugin,
)

PLUGINS = (
    PhylogeneticsValidatePlugin,
    PhylogeneticsAlignPlugin,
    PhylogeneticsTreePlugin,
    PhylogeneticsReportPlugin,
)
DEFAULT_FASTA = REPO_ROOT / "shared" / "test-cases" / "phylo_reference.fasta"
DEFAULT_OUT = REPO_ROOT / "python-engine" / "output" / "phylo-demo"


def run_pipeline(fasta_text: str) -> dict[str, dict[str, dict[str, str]]]:
    """Return {tool_id: {artifact_name: {kind, content, sha256}}}."""
    result: dict[str, dict[str, dict[str, str]]] = {}
    inputs = {
        "fasta_text": fasta_text,
        "filename": "phylo_reference.fasta",
        "dataset_id": "ds_phylo_demo",
    }
    with tempfile.TemporaryDirectory(prefix="phylo-demo-") as workspace:
        for plugin_cls in PLUGINS:
            step = {"tool_id": plugin_cls.TOOL_ID, "params": {}}
            outcome = plugin_cls().run(
                step, inputs, {"workspace": workspace, "config": {}}
            )
            meta = outcome["tool_run_meta"]
            if meta["status"] != "succeeded":
                raise RuntimeError(f"{plugin_cls.TOOL_ID} failed: {meta['reason']}")
            result[plugin_cls.TOOL_ID] = {
                artifact["name"]: {
                    "kind": artifact["kind"],
                    "content": artifact["content"],
                    "sha256": hashlib.sha256(
                        artifact["content"].encode("utf-8")
                    ).hexdigest(),
                }
                for artifact in outcome["artifacts"]
            }
    return result


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--fasta", type=Path, default=DEFAULT_FASTA)
    parser.add_argument("--out", type=Path, default=DEFAULT_OUT)
    args = parser.parse_args(argv)

    fasta_text = args.fasta.read_text(encoding="utf-8-sig")
    first = run_pipeline(fasta_text)
    second = run_pipeline(fasta_text)
    deterministic = first == second

    args.out.mkdir(parents=True, exist_ok=True)
    for tool_id, artifacts in first.items():
        for name, artifact in artifacts.items():
            (args.out / name).write_text(artifact["content"], encoding="utf-8")

    hashes = {
        tool_id: {name: artifact["sha256"] for name, artifact in artifacts.items()}
        for tool_id, artifacts in first.items()
    }
    (args.out / "artifact_hashes.json").write_text(
        json.dumps(
            {
                "input_fasta": args.fasta.name,
                "input_sha256": hashlib.sha256(fasta_text.encode("utf-8")).hexdigest(),
                "deterministic": deterministic,
                "artifacts": hashes,
            },
            indent=2,
            ensure_ascii=False,
        )
        + "\n",
        encoding="utf-8",
    )

    alignment_summary = json.loads(
        first["phylogenetics.align"]["alignment_summary.json"]["content"]
    )
    tree_stats = json.loads(first["phylogenetics.tree"]["tree_stats.json"]["content"])
    print(
        json.dumps(
            {
                "out": str(args.out),
                "deterministic": deterministic,
                "alignment_columns": alignment_summary["alignment_columns"],
                "conserved_sites": alignment_summary["conserved_sites"],
                "gap_count": alignment_summary["gap_count"],
                "tree_tips": tree_stats["tip_count"],
                "newick": tree_stats["newick"],
                "artifact_hashes": hashes,
            },
            indent=2,
            ensure_ascii=False,
        )
    )
    return 0 if deterministic else 2


if __name__ == "__main__":
    raise SystemExit(main())
