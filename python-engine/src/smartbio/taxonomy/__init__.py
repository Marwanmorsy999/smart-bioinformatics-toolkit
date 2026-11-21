"""Taxonomy Analyzer package for the Smart Bioinformatics Toolkit."""

from smartbio.taxonomy.analyze import run_taxonomy_analysis
from smartbio.taxonomy.ambiguity import report_ambiguity
from smartbio.taxonomy.consensus import (
    DEFAULT_MIN_CONSENSUS,
    DEFAULT_TOP_N,
    ConsensusResult,
    compute_consensus,
    consensus_to_dict,
    select_candidates,
)
from smartbio.taxonomy.lineage import Lineage, TAXONOMIC_RANKS, lowest_common_ancestor
from smartbio.taxonomy.resolver import TaxonomyResolver, TaxonInfo
from smartbio.taxonomy.verdict import compute_verdict, load_difficult_groups

__all__ = [
    "run_taxonomy_analysis",
    "report_ambiguity",
    "DEFAULT_TOP_N",
    "DEFAULT_MIN_CONSENSUS",
    "ConsensusResult",
    "compute_consensus",
    "consensus_to_dict",
    "select_candidates",
    "Lineage",
    "TAXONOMIC_RANKS",
    "lowest_common_ancestor",
    "TaxonomyResolver",
    "TaxonInfo",
    "compute_verdict",
    "load_difficult_groups",
]
