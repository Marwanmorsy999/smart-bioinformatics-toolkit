#!/usr/bin/env python3
"""Build a taxonomy_map.tsv from NCBI taxdump files.

Inputs:
  --rankedlineage   NCBI taxdump rankedlineage.dmp
  --nodes           NCBI taxdump nodes.dmp
  --accessions      a two-column (accession<TAB>taxid) file
  --output          destination taxonomy_map.tsv

The accession file may include a header row; it is detected and skipped.
Only the taxids referenced by the accession file (and their ancestors) are
emitted, so the resulting map stays small.
"""

from __future__ import annotations

import argparse
from pathlib import Path


def parse_nodes(path: Path) -> dict[int, tuple[int | None, str]]:
    out: dict[int, tuple[int | None, str]] = {}
    with path.open(encoding="utf-8") as fh:
        for line in fh:
            line = line.strip()
            if not line:
                continue
            fields = [f.strip() for f in line.split("\t|\t")]
            if not fields or not fields[0]:
                continue
            try:
                tid = int(fields[0])
            except ValueError:
                continue
            parent_raw = fields[1] if len(fields) > 1 else ""
            rank = fields[2] if len(fields) > 2 else ""
            try:
                parent = int(parent_raw) if parent_raw else None
            except ValueError:
                parent = None
            if parent == tid:
                parent = None
            if parent == 0:
                parent = None
            out[tid] = (parent, rank)
    return out


def parse_names(path: Path) -> dict[int, str]:
    """Parse names.dmp: tax_id, name_txt, unique_name, name_class (tab|tab separated)."""
    out: dict[int, str] = {}
    with path.open(encoding="utf-8") as fh:
        for line in fh:
            line = line.rstrip("\n")
            if not line.strip():
                continue
            fields = [f.strip() for f in line.split("\t|\t")]
            if fields and fields[-1].endswith("\t|"):
                fields[-1] = fields[-1][:-2].strip()
            if not fields or not fields[0]:
                continue
            try:
                tid = int(fields[0])
            except ValueError:
                continue
            name = fields[1] if len(fields) > 1 else ""
            cls = fields[3] if len(fields) > 3 else ""
            # Prefer scientific name; keep first non-empty otherwise.
            if cls == "scientific name" or cls == "":
                if tid not in out or not out[tid]:
                    out[tid] = name
    return out


def parse_rankedlineage(path: Path) -> dict[int, dict[str, str]]:
    out: dict[int, dict[str, str]] = {}
    with path.open(encoding="utf-8") as fh:
        for line in fh:
            line = line.rstrip("\n")
            if not line.strip():
                continue
            fields = [f.strip() for f in line.split("\t|\t")]
            # Strip a trailing separator remnant from the last field.
            if fields and fields[-1].endswith("\t|"):
                fields[-1] = fields[-1][:-2].strip()
            if not fields or not fields[0]:
                continue
            try:
                tid = int(fields[0])
            except ValueError:
                continue
            # tax_id, tax_name, species, genus, family, order, class, phylum, kingdom, superkingdom
            names = {
                "name": fields[1] if len(fields) > 1 else "",
                "species": fields[2] if len(fields) > 2 else "",
                "genus": fields[3] if len(fields) > 3 else "",
                "family": fields[4] if len(fields) > 4 else "",
                "order": fields[5] if len(fields) > 5 else "",
                "class": fields[6] if len(fields) > 6 else "",
                "phylum": fields[7] if len(fields) > 7 else "",
                "kingdom": fields[8] if len(fields) > 8 else "",
                "superkingdom": fields[9] if len(fields) > 9 else "",
            }
            out[tid] = names
    return out


def read_accession_taxids(path: Path) -> set[int]:
    out: set[int] = set()
    with path.open(encoding="utf-8") as fh:
        for line in fh:
            line = line.strip()
            if not line:
                continue
            parts = line.split()
            if len(parts) < 2:
                # Maybe comma or tab separated.
                parts = [p for p in line.replace(",", "\t").split("\t") if p.strip()]
            if len(parts) < 2:
                continue
            if parts[0].lower() in {"accession", "accession_id", "acc", "id"}:
                continue
            try:
                out.add(int(parts[1]))
            except ValueError:
                # second column might be first? try first
                try:
                    out.add(int(parts[0]))
                except ValueError:
                    continue
    return out


def ancestors(tid: int, nodes: dict[int, tuple[int | None, str]]) -> list[int]:
    result: list[int] = []
    seen: set[int] = set()
    cur: int | None = tid
    while cur is not None and cur not in seen:
        seen.add(cur)
        result.append(cur)
        parent = nodes.get(cur, (None, ""))[0]
        if parent is None:
            break
        cur = parent
    return result


def build_lineage(rl: dict[str, str]) -> str:
    parts: list[str] = []
    for key in ("superkingdom", "kingdom", "phylum", "class", "order", "family", "genus", "species"):
        val = (rl.get(key) or "").strip()
        if val and val not in parts:
            parts.append(val)
    return ";".join(parts)


def main() -> int:
    parser = argparse.ArgumentParser(description="Build taxonomy_map.tsv from NCBI taxdump.")
    parser.add_argument("--rankedlineage", required=False, type=Path, default=None)
    parser.add_argument("--names", required=False, type=Path, default=None)
    parser.add_argument("--nodes", required=True, type=Path)
    parser.add_argument("--accessions", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()

    nodes = parse_nodes(args.nodes)
    if args.rankedlineage is not None:
        ranked = parse_rankedlineage(args.rankedlineage)
    else:
        names_map = parse_names(args.names) if args.names else {}
        ranked = {}
        for tid in nodes:
            ranked[tid] = {"name": names_map.get(tid, "") or ""}

    taxids: set[int] = set()
    for tid in read_accession_taxids(args.accessions):
        for a in ancestors(tid, nodes):
            taxids.add(a)

    rows: list[tuple[int, str, str, str, str]] = []
    seen_rows: set[int] = set()
    for tid in sorted(taxids):
        if tid in seen_rows:
            continue
        seen_rows.add(tid)
        parent, rank = nodes.get(tid, (None, ""))
        rl = ranked.get(tid, {})
        name = (rl.get("name") or "").strip()
        parent_str = "" if parent is None else str(parent)
        lineage = build_lineage(rl)
        rows.append((tid, name, rank, parent_str, lineage))

    args.output.parent.mkdir(parents=True, exist_ok=True)
    with args.output.open("w", encoding="utf-8", newline="") as fh:
        fh.write("taxid\tscientific_name\trank\tparent_taxid\tfull_lineage\n")
        for tid, name, rank, parent, lineage in rows:
            fh.write(f"{tid}\t{name}\t{rank}\t{parent}\t{lineage}\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
