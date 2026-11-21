"""Taxonomic ambiguity reporting.

Identifies why a species-level identification cannot be made and reports
uncertainty explicitly rather than forcing a conclusion.
"""

from __future__ import annotations

from typing import Any

from smartbio.taxonomy.lineage import Lineage, TAXONOMIC_RANKS
from smartbio.taxonomy.consensus import ConsensusResult


def report_ambiguity(
    result: ConsensusResult,
    *,
    multiple_taxids_per_hit: bool = False,
    missing_taxids: bool = False,
    incomplete_lineages: bool = False,
    candidate_truncation: bool = False,
    conflicting_reference_taxonomies: bool = False,
) -> dict[str, Any]:
    """Build an explicit ambiguity report from a consensus result.

    Flags are set by the caller based on the raw BLAST rows and resolver
    output. This function assembles a human- and machine-readable summary.
    """
    flags: list[str] = []
    messages: list[str] = list(result.warnings)

    if multiple_taxids_per_hit:
        flags.append("multiple_taxids_per_hit")
        messages.append(
            "One or more BLAST hits carry multiple taxonomy identifiers; "
            "the subject is taxonomically ambiguous."
        )

    if missing_taxids:
        flags.append("missing_taxids")
        messages.append(
            "Some hits have no taxonomy identifier; they cannot contribute "
            "to a taxonomic consensus."
        )

    if incomplete_lineages:
        flags.append("incomplete_lineages")
        messages.append(
            "Some resolved lineages are missing taxonomic ranks (for example "
            "genus or species); consensus may be limited to higher ranks."
        )

    if candidate_truncation:
        flags.append("candidate_truncation")
        messages.append(
            "The candidate set reached the configured top-N limit; tied or "
            "additional matches may have been excluded from consensus."
        )

    if conflicting_reference_taxonomies:
        flags.append("conflicting_reference_taxonomies")
        messages.append(
            "Reference records assign conflicting taxonomies to the same or "
            "overlapping subjects."
        )

    # Derive additional flags from the consensus result.
    if result.status == "insufficient_evidence":
        flags.append("insufficient_evidence")
        if "No species-level taxonomy" not in " ".join(messages):
            messages.append("Insufficient candidate evidence for a consensus.")
    elif result.status == "ambiguous_species":
        flags.append("ambiguous_species")
    elif result.status == "higher_rank_only":
        flags.append("higher_rank_only_consensus")
    elif result.status == "conflicting_lineages":
        flags.append("conflicting_lineages")

    # Highest supported rank below species.
    supported_rank = result.supported_rank
    if supported_rank and supported_rank not in ("species", "genus"):
        flags.append(f"consensus_limited_to_{supported_rank}")

    if result.support and result.support.get("unique_species", 0) > 1:
        flags.append("multiple_candidate_species")

    return {
        "status": result.status,
        "supported_rank": supported_rank,
        "consensus_taxon": result.consensus_taxon,
        "flags": flags,
        "messages": messages,
        "candidate_species": result.candidate_species,
        "support": result.support,
    }


def is_species_level_supported(result: ConsensusResult) -> bool:
    """Return True only when a species-level consensus is defensible."""
    return result.status == "species_agreement"


def is_genus_level_supported(result: ConsensusResult) -> bool:
    """Return True when at least genus-level agreement exists."""
    return result.status in ("species_agreement", "ambiguous_species")


def highest_defensible_rank(result: ConsensusResult) -> str | None:
    """The deepest rank at which identification is defensible.

    Never returns species unless species_agreement; never returns genus
    unless at least genus-level agreement exists.
    """
    if result.status == "species_agreement":
        return "species"
    if result.status in ("ambiguous_species",):
        return "genus"
    return result.supported_rank
