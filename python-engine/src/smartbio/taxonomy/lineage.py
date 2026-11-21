"""Taxonomic lineage normalization.

A lineage is an ordered mapping from a taxonomic rank to a taxon
(taxid + scientific name). Not every organism is classified at every
rank, so missing ranks are represented explicitly as None. Lineages are
never inferred from organism names by string manipulation.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

# Standard ranks from broadest to most specific.
TAXONOMIC_RANKS: list[str] = [
    "superkingdom",
    "kingdom",
    "phylum",
    "class",
    "order",
    "family",
    "genus",
    "species",
]

# Ranks at which a consensus is considered meaningful for reporting.
REPORTING_RANKS: list[str] = [
    "superkingdom", "kingdom", "phylum", "class", "order", "family", "genus", "species",
]


def empty_rank_entry() -> dict[str, Any]:
    return {"taxid": None, "name": None}


def rank_entry(taxid: Any, name: str | None) -> dict[str, Any]:
    return {"taxid": taxid, "name": name}


@dataclass
class Lineage:
    """A single taxon's lineage across the standard ranks."""

    taxid: int | str | None = None
    name: str | None = None
    ranks: dict[str, dict[str, Any] | None] = field(default_factory=dict)
    source: str = "unknown"  # "mapping" | "ncbi" | "unknown"

    def __post_init__(self) -> None:
        if not self.ranks:
            self.ranks = {rank: None for rank in TAXONOMIC_RANKS}

    def get(self, rank: str) -> dict[str, Any] | None:
        return self.ranks.get(rank)

    def rank_name(self, rank: str) -> str | None:
        entry = self.get(rank)
        return entry["name"] if entry else None

    def rank_taxid(self, rank: str) -> int | str | None:
        entry = self.get(rank)
        return entry["taxid"] if entry else None

    def classified_ranks(self) -> list[str]:
        return [rank for rank in TAXONOMIC_RANKS if self.get(rank) is not None]

    def deepest_classified_rank(self) -> str | None:
        for rank in reversed(TAXONOMIC_RANKS):
            if self.get(rank) is not None:
                return rank
        return None

    def to_dict(self) -> dict[str, Any]:
        return {
            "taxid": self.taxid,
            "name": self.name,
            "source": self.source,
            "ranks": {
                rank: (None if entry is None else dict(entry))
                for rank, entry in self.ranks.items()
            },
            "deepest_classified_rank": self.deepest_classified_rank(),
        }


def lineage_from_ncbi_lineage_ex(
    taxid: int | str,
    scientific_name: str | None,
    lineage_ex: list[dict[str, Any]],
    terminal_rank: str | None = None,
    source: str = "ncbi",
) -> Lineage:
    """Build a Lineage from NCBI E-utilities LineageEx.

    lineage_ex is a list of dicts with keys TaxId, ScientificName, Rank,
    ordered from root toward (but not including) the queried taxon. The
    queried taxon is appended as the terminal rank using ``terminal_rank``
    (the rank reported for the queried taxid itself).
    """
    ranks: dict[str, dict[str, Any] | None] = {rank: None for rank in TAXONOMIC_RANKS}
    for entry in lineage_ex or []:
        rank = str(entry.get("Rank", "")).lower().strip()
        if not rank:
            continue
        rank = _normalize_rank(rank)
        if rank not in TAXONOMIC_RANKS:
            continue
        # Do not let a lineage-ex entry overwrite the terminal taxon.
        if rank == terminal_rank:
            continue
        ranks[rank] = rank_entry(
            entry.get("TaxId"), entry.get("ScientificName")
        )
    # Terminal taxon (the queried taxid) at its own rank.
    if terminal_rank and terminal_rank in TAXONOMIC_RANKS:
        ranks[terminal_rank] = rank_entry(taxid, scientific_name)
    return Lineage(taxid=taxid, name=scientific_name, ranks=ranks, source=source)


def _normalize_rank(rank: str) -> str:
    rank = rank.strip().lower()
    aliases = {
        "superkingdom": "superkingdom",
        "no rank": "",
        "unclassified": "",
    }
    return aliases.get(rank, rank)


def lineage_from_mapping(
    taxid: int | str,
    scientific_name: str | None,
    rank: str | None,
    full_lineage: str | None,
    parent_taxid: int | str | None = None,
    mapping: dict[Any, dict[str, Any]] | None = None,
    source: str = "mapping",
) -> Lineage:
    """Build a Lineage from a local taxonomy mapping row.

    When ``mapping`` (taxid -> record) is provided, the lineage is built by
    walking the ``parent_taxid`` chain so every ancestor keeps its real
    taxid. Names alone are never used to invent rank placement.
    """
    ranks: dict[str, dict[str, Any] | None] = {rank: None for rank in TAXONOMIC_RANKS}
    terminal_rank = _normalize_rank(str(rank or "").lower().strip())

    if mapping is not None:
        visited: set[Any] = set()
        current: int | str | None = taxid
        depth = 0
        while current is not None and current not in visited and depth < 100:
            visited.add(current)
            depth += 1
            rec = mapping.get(current)
            if rec is None and isinstance(current, str):
                try:
                    rec = mapping.get(int(current))
                except ValueError:
                    rec = None
            if rec is None:
                break
            rec_rank = _normalize_rank(str(rec.get("rank") or "").lower().strip())
            lookup_key = current
            if isinstance(current, str):
                try:
                    if int(current) in mapping:
                        lookup_key = int(current)
                except ValueError:
                    pass
            if rec_rank and rec_rank in TAXONOMIC_RANKS and ranks[rec_rank] is None:
                ranks[rec_rank] = rank_entry(lookup_key, rec.get("scientific_name"))
            current = rec.get("parent_taxid")

    # Ensure the terminal taxon is recorded at its own rank (the walk may
    # not have assigned it if its rank was non-standard).
    if terminal_rank and terminal_rank in TAXONOMIC_RANKS:
        ranks[terminal_rank] = rank_entry(taxid, scientific_name)
    return Lineage(taxid=taxid, name=scientific_name, ranks=ranks, source=source)


def lowest_common_ancestor(lineages: list[Lineage]) -> dict[str, Any] | None:
    """Compute the lowest common ancestor of several lineages.

    Returns the deepest rank at which every lineage agrees on the same
    non-None taxid, or None when there is no agreement above root.
    """
    if not lineages:
        return None
    lca_rank: str | None = None
    lca_taxid: int | str | None = None
    lca_name: str | None = None
    for rank in TAXONOMIC_RANKS:
        taxids: set[Any] = set()
        names: set[str | None] = set()
        any_has_value = False
        all_have_value = True
        for lin in lineages:
            entry = lin.get(rank)
            if entry is None or entry["taxid"] is None:
                all_have_value = False
            else:
                any_has_value = True
                taxids.add(entry["taxid"])
                names.add(entry["name"])
        if not any_has_value:
            # No lineage is classified at this rank; keep looking deeper.
            continue
        if not all_have_value or len(taxids) != 1:
            # Some are classified and some are not, or they disagree: stop.
            break
        lca_rank = rank
        lca_taxid = taxids.pop()
        lca_name = names.pop() if len(names) == 1 else None
    if lca_rank is None:
        return None
    return {"rank": lca_rank, "taxid": lca_taxid, "name": lca_name}


def lineage_lca_depth(lineage: Lineage) -> int:
    """Number of classified ranks (broadest-first depth)."""
    return len(lineage.classified_ranks())
