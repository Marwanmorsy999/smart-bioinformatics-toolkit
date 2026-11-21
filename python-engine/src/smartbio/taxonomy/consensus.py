"""Taxonomic consensus engine.

Compares the taxonomic lineages of qualifying BLAST candidates for a single
query and produces a transparent consensus. Consensus support is an
evidence-support fraction, not a calibrated probability of correct
identification.

A species with many database reference records does not dominate merely
because it has more accessions: consensus is computed over unique
species-level taxonomic units, while raw hit-based support is preserved for
comparison.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from smartbio.taxonomy.lineage import (
    Lineage,
    TAXONOMIC_RANKS,
    lowest_common_ancestor,
)

# Defaults are explicitly experimental settings, not biological standards.
DEFAULT_TOP_N = 10
DEFAULT_MIN_CONSENSUS = 0.8


@dataclass
class Candidate:
    """One BLAST hit considered for consensus, with its resolved lineage."""

    accession: str | None
    bitscore: float | None
    evalue: float | None
    pident: float | None
    query_coverage: float | None
    rank: int | None
    lineage: Lineage | None
    raw: dict[str, Any] = field(default_factory=dict)


def sort_key(candidate: Candidate) -> tuple:
    """Deterministic ranking: bitscore desc, evalue asc, pident desc, coverage desc."""
    return (
        -(candidate.bitscore if candidate.bitscore is not None else 0),
        (candidate.evalue if candidate.evalue is not None else float("inf")),
        -(candidate.pident if candidate.pident is not None else 0),
        -(candidate.query_coverage if candidate.query_coverage is not None else 0),
        str(candidate.accession or ""),
    )


def select_candidates(
    hits: list[dict[str, Any]],
    top_n: int = DEFAULT_TOP_N,
) -> list[Candidate]:
    """Select top-N candidates preserving exact ties at the cutoff.

    Hits must already be ranked (analyze_blast assigns `rank` by bitscore).
    Ties at the top-N boundary are all retained.
    """
    if top_n is None or top_n <= 0:
        top_n = DEFAULT_TOP_N
    # Sort deterministically.
    ordered = sorted(hits, key=lambda h: sort_key(_to_candidate(h)))
    candidates = [_to_candidate(h) for h in ordered]
    if not candidates:
        return []
    if len(candidates) <= top_n:
        return candidates
    cutoff_bitscore = candidates[top_n - 1].bitscore
    # Retain every candidate whose bitscore equals the cutoff (exact ties).
    result = []
    for c in candidates:
        if c.bitscore is not None and cutoff_bitscore is not None:
            if c.bitscore >= cutoff_bitscore:
                result.append(c)
        else:
            result.append(c)
    return result


def _to_candidate(hit: dict[str, Any]) -> Candidate:
    lineage = hit.get("_lineage")  # attached by the CLI/browser wiring
    return Candidate(
        accession=hit.get("sacc") or hit.get("sseqid"),
        bitscore=hit.get("bitscore"),
        evalue=hit.get("evalue"),
        pident=hit.get("pident"),
        query_coverage=hit.get("query_coverage"),
        rank=hit.get("rank"),
        lineage=lineage,
        raw=hit,
    )


@dataclass
class ConsensusResult:
    query_id: str
    supported_rank: str | None
    consensus_taxon: str | None
    consensus_taxid: int | str | None
    status: str
    candidate_species: list[str]
    support: dict[str, Any]
    warnings: list[str]
    evidence: list[dict[str, Any]]
    candidate_count: int
    truncated: bool


def _species_key(lineage: Lineage | None) -> str | None:
    """Species-level key: prefer species taxid, fall back to species name."""
    if lineage is None:
        return None
    entry = lineage.get("species")
    if entry and entry["taxid"] is not None:
        return f"taxid:{entry['taxid']}"
    name = lineage.rank_name("species")
    if name:
        return f"name:{name}"
    return None


def _taxon_at_rank(lineage: Lineage | None, rank: str) -> tuple[Any, str | None] | None:
    if lineage is None:
        return None
    entry = lineage.get(rank)
    if entry is None or entry["taxid"] is None:
        return None
    return (entry["taxid"], entry["name"])


def _rank_support(
    candidates: list[Candidate],
    rank: str,
) -> tuple[float, int, str | None, Any | None]:
    """Support fraction at a rank over unique species.

    Returns (support_fraction, total_classified, consensus_taxon, consensus_taxid).
    support = max frequency of a single taxon at this rank / number of unique
    species classified at this rank.
    """
    # Group candidates by species key, take one representative per species.
    species_reps: dict[str, Candidate] = {}
    for c in candidates:
        key = _species_key(c.lineage)
        if key is None:
            continue
        # Keep the highest-scoring representative per species.
        if key not in species_reps or sort_key(c) < sort_key(species_reps[key]):
            species_reps[key] = c

    taxon_counts: dict[Any, int] = {}
    taxon_names: dict[Any, str | None] = {}
    total = 0
    for c in species_reps.values():
        taxon = _taxon_at_rank(c.lineage, rank)
        if taxon is None:
            continue
        total += 1
        taxid = taxon[0]
        taxon_counts[taxid] = taxon_counts.get(taxid, 0) + 1
        taxon_names.setdefault(taxid, taxon[1])

    if total == 0:
        return 0.0, 0, None, None
    best_taxid = max(taxon_counts, key=lambda t: taxon_counts[t])
    support = taxon_counts[best_taxid] / total
    return support, total, taxon_names.get(best_taxid), best_taxid


def compute_consensus(
    candidates: list[Candidate],
    min_consensus: float = DEFAULT_MIN_CONSENSUS,
) -> ConsensusResult:
    """Compute the taxonomic consensus for a list of candidates."""
    warnings: list[str] = []

    if not candidates:
        return ConsensusResult(
            query_id="",
            supported_rank=None,
            consensus_taxon=None,
            consensus_taxid=None,
            status="insufficient_evidence",
            candidate_species=[],
            support={},
            warnings=["No candidates available for consensus."],
            evidence=[],
            candidate_count=0,
            truncated=False,
        )

    # LCA across all candidate lineages that have at least one rank.
    lineages = [c.lineage for c in candidates if c.lineage is not None]
    lca = lowest_common_ancestor(lineages) if lineages else None

    # Species-level keys for unique species counting.
    species_keys: dict[str, None] = {}
    for c in candidates:
        key = _species_key(c.lineage)
        if key is not None:
            species_keys[key] = None
    unique_species = len(species_keys)

    # Candidate species names (unique, in order of first appearance).
    candidate_species: list[str] = []
    seen_species: set[str] = set()
    for c in candidates:
        name = c.lineage.rank_name("species") if c.lineage else None
        if name and name not in seen_species:
            seen_species.add(name)
            candidate_species.append(name)

    # Support at each reporting rank over unique species.
    rank_support: dict[str, float] = {}
    rank_totals: dict[str, int] = {}
    rank_consensus_taxon: dict[str, str | None] = {}
    for rank in TAXONOMIC_RANKS:
        support, total, taxon, taxid = _rank_support(candidates, rank)
        rank_support[rank] = support
        rank_totals[rank] = total
        rank_consensus_taxon[rank] = taxon

    # Determine supported rank: deepest rank where support >= min_consensus
    # and at least two unique species are classified (or one species).
    supported_rank = None
    consensus_taxon = None
    consensus_taxid = None
    if lca is not None:
        # LCA rank is the natural supported rank, but verify support threshold.
        if lca["rank"] and rank_support.get(lca["rank"], 0) >= min_consensus:
            supported_rank = lca["rank"]
            consensus_taxon = lca["name"]
            consensus_taxid = lca["taxid"]
        else:
            # Fall back to deepest rank meeting the threshold.
            for rank in reversed(TAXONOMIC_RANKS):
                if rank_support.get(rank, 0) >= min_consensus and rank_totals.get(rank, 0) > 0:
                    supported_rank = rank
                    consensus_taxon = rank_consensus_taxon.get(rank)
                    consensus_taxid = None
                    break

    # Status determination.
    species_support = rank_support.get("species", 0.0)
    genus_support = rank_support.get("genus", 0.0)
    if unique_species == 0:
        status = "insufficient_evidence"
        warnings.append("No species-level taxonomy available for any candidate.")
    elif unique_species == 1 and species_support >= min_consensus:
        status = "species_agreement"
    elif genus_support >= min_consensus and unique_species > 1:
        status = "ambiguous_species"
        warnings.append(
            "Multiple species share the supported genus; species-level "
            "identification is not supported."
        )
    elif supported_rank is not None and supported_rank not in ("genus", "species"):
        status = "higher_rank_only"
        warnings.append(
            f"Agreement only at {supported_rank}; species/genus not resolved."
        )
    else:
        status = "conflicting_lineages"
        warnings.append("Conflicting reference taxonomies; no reliable consensus.")

    # Evidence list.
    evidence: list[dict[str, Any]] = []
    for c in candidates:
        lineage_dict = c.lineage.to_dict() if c.lineage else None
        evidence.append(
            {
                "accession": c.accession,
                "bitscore": c.bitscore,
                "evalue": c.evalue,
                "pident": c.pident,
                "query_coverage": c.query_coverage,
                "rank": c.rank,
                "lineage": lineage_dict,
                "species": c.lineage.rank_name("species") if c.lineage else None,
                "genus": c.lineage.rank_name("genus") if c.lineage else None,
            }
        )

    support = {
        "reference_hits": len(candidates),
        "unique_accessions": len({c.accession for c in candidates if c.accession}),
        "unique_species": unique_species,
        "rank_support": {r: round(rank_support.get(r, 0.0), 4) for r in TAXONOMIC_RANKS},
        "rank_totals": rank_totals,
        "genus_support": round(genus_support, 4),
        "species_support": round(species_support, 4),
    }

    return ConsensusResult(
        query_id="",  # set by caller
        supported_rank=supported_rank,
        consensus_taxon=consensus_taxon,
        consensus_taxid=consensus_taxid,
        status=status,
        candidate_species=candidate_species,
        support=support,
        warnings=warnings,
        evidence=evidence,
        candidate_count=len(candidates),
        truncated=False,  # set by caller
    )


def consensus_to_dict(result: ConsensusResult, query_id: str) -> dict[str, Any]:
    return {
        "query_id": query_id,
        "supported_rank": result.supported_rank,
        "consensus_taxon": result.consensus_taxon,
        "consensus_taxid": result.consensus_taxid,
        "status": result.status,
        "candidate_species": result.candidate_species,
        "support": result.support,
        "warnings": result.warnings,
        "evidence": result.evidence,
        "candidate_count": result.candidate_count,
        "truncated": result.truncated,
    }
