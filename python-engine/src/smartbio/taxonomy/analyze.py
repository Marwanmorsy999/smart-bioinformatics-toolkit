"""High-level taxonomy analysis orchestrating the resolver and consensus engine."""

from __future__ import annotations

from typing import Any

from smartbio.taxonomy.ambiguity import report_ambiguity
from smartbio.taxonomy.consensus import (
    ConsensusResult,
    consensus_to_dict,
    compute_consensus,
    select_candidates,
)
from smartbio.taxonomy.lineage import Lineage
from smartbio.taxonomy.resolver import TaxonomyResolver
from smartbio.taxonomy.verdict import (
    DEFAULT_MIN_COVERAGE,
    DEFAULT_MIN_QUERY_LENGTH,
    DEFAULT_NEAR_THRESHOLD_MARGIN,
    DEFAULT_SPECIES_THRESHOLD,
    compute_verdict,
    load_difficult_groups,
)


def _attach_lineages(
    hits: list[dict[str, Any]],
    resolver: TaxonomyResolver,
) -> list[dict[str, Any]]:
    """Resolve taxonomy for each hit and attach a Lineage to the hit dict."""
    enriched: list[dict[str, Any]] = []
    multiple_taxids = False
    missing_taxids = False
    for hit in hits:
        resolution = resolver.resolve_blast_row(hit)
        taxids = resolution["resolved_taxids"]
        if len(taxids) > 1:
            multiple_taxids = True
        if not taxids:
            missing_taxids = True

        # Use the primary (first) resolved taxid's lineage for consensus.
        primary_lineage: Lineage | None = None
        primary_info = None
        if taxids:
            primary_info = taxids[0]
            ld = primary_info.get("lineage")
            if ld:
                primary_lineage = Lineage(
                    taxid=ld["taxid"],
                    name=ld["name"],
                    ranks={
                        r: (None if e is None else dict(e))
                        for r, e in ld["ranks"].items()
                    },
                    source=primary_info.get("source", "unknown"),
                )
            if primary_info.get("source") == "missing":
                missing_taxids = True

        enriched_hit = dict(hit)
        enriched_hit["_lineage"] = primary_lineage
        enriched_hit["_taxonomy"] = resolution
        enriched.append(enriched_hit)

    return enriched, multiple_taxids, missing_taxids


def run_taxonomy_analysis(
    blast_report: dict[str, Any],
    resolver: TaxonomyResolver,
    *,
    top_n: int = 10,
    min_consensus: float = 0.8,
    species_threshold: float = DEFAULT_SPECIES_THRESHOLD,
    verdict_min_coverage: float = DEFAULT_MIN_COVERAGE,
    min_query_length: int | None = DEFAULT_MIN_QUERY_LENGTH,
    near_threshold_margin: float = DEFAULT_NEAR_THRESHOLD_MARGIN,
    difficult_groups: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    """Run taxonomy consensus analysis for every query in a BLAST report.

    Parameters
    ----------
    blast_report : dict
        Output of :func:`smartbio.blast.analyze_blast`.
    resolver : TaxonomyResolver
        Configured taxonomy resolver (mapping and/or online).
    top_n : int
        Maximum candidate count per query (ties at cutoff preserved).
    min_consensus : float
        Minimum support fraction required for a consensus rank.
    species_threshold, verdict_min_coverage, min_query_length : screening
        settings for the verdict layer (see :mod:`smartbio.taxonomy.verdict`).
    difficult_groups : list or None
        Difficult-group definitions; ``None`` loads ``shared/difficult-groups.json``.

    Returns
    -------
    dict with per-query results, summary, and flags.
    """
    if difficult_groups is None:
        difficult_groups = load_difficult_groups()

    def _verdict(consensus_dict: dict[str, Any], qlen: int | None) -> dict[str, Any]:
        return compute_verdict(
            consensus_dict,
            species_threshold=species_threshold,
            min_coverage=verdict_min_coverage,
            min_query_length=min_query_length,
            query_length=qlen,
            groups=difficult_groups,
            near_threshold_margin=near_threshold_margin,
        )

    grouped = blast_report.get("grouped", {})
    no_hit_queries = blast_report.get("no_hit_queries", [])
    thresholds = blast_report.get("thresholds", {})

    per_query: dict[str, dict[str, Any]] = {}
    summary_flags: list[str] = []
    total_queries_with_hits = 0
    total_candidates = 0
    total_truncated = 0

    for query_id in sorted(grouped.keys()):
        hits = grouped[query_id]
        passing = [h for h in hits if h.get("pass_all")]
        enriched, multiple_taxids, missing_taxids = _attach_lineages(passing, resolver)

        # Ranked candidate selection (top-N with ties).
        candidates = select_candidates(enriched, top_n=top_n)
        # A query is "truncated" if more passing hits exist than candidates kept.
        truncated = len(passing) > len(candidates)
        if truncated:
            total_truncated += 1
            summary_flags.append("candidate_truncation")
        if multiple_taxids:
            summary_flags.append("multiple_taxids_per_hit")
        if missing_taxids:
            summary_flags.append("missing_taxids")

        total_queries_with_hits += 1 if passing else 0
        total_candidates += len(candidates)

        consensus = compute_consensus(candidates, min_consensus=min_consensus)
        consensus.query_id = query_id
        consensus.truncated = truncated
        result_dict = consensus_to_dict(consensus, query_id)

        ambiguity = report_ambiguity(
            consensus,
            multiple_taxids_per_hit=multiple_taxids,
            missing_taxids=missing_taxids,
            incomplete_lineages=False,  # computed below
            candidate_truncation=truncated,
            conflicting_reference_taxonomies=False,
        )

        # Detect incomplete lineages: any candidate lineage missing genus/species.
        incomplete = any(
            (c.lineage is None
             or c.lineage.get("genus") is None
             or c.lineage.get("species") is None)
            for c in candidates
        ) if candidates else False
        if incomplete:
            ambiguity["flags"].append("incomplete_lineages")
            ambiguity["messages"].append(
                "Some candidate lineages lack genus or species ranks."
            )
            summary_flags.append("incomplete_lineages")

        # Conflicting reference taxonomies: same accession mapped to >1 lineage.
        conflicting = _has_conflicting_taxonomies(enriched)
        if conflicting:
            ambiguity["flags"].append("conflicting_reference_taxonomies")
            ambiguity["messages"].append(
                "Reference records assign conflicting taxonomies."
            )
            summary_flags.append("conflicting_reference_taxonomies")

        per_query[query_id] = {
            "consensus": result_dict,
            "ambiguity": ambiguity,
            "candidate_count": len(candidates),
            "passing_hit_count": len(passing),
            "truncated": truncated,
            "verdict": _verdict(
                result_dict,
                next((h.get("qlen") for h in hits if h.get("qlen")), None),
            ),
        }

    # No-hit queries explicitly represented.
    no_hit_results = {}
    if no_hit_queries:
        summary_flags.append("no_hit_queries")
    for qid in no_hit_queries:
        consensus = compute_consensus([], min_consensus=min_consensus)
        consensus.query_id = qid
        consensus_dict = consensus_to_dict(consensus, qid)
        no_hit_results[qid] = {
            "consensus": consensus_dict,
            "ambiguity": report_ambiguity(consensus),
            "candidate_count": 0,
            "passing_hit_count": 0,
            "truncated": False,
            "verdict": _verdict(consensus_dict, None),
        }

    verdict_counts: dict[str, int] = {}
    for entry in list(per_query.values()) + list(no_hit_results.values()):
        key = entry["verdict"]["status"]
        verdict_counts[key] = verdict_counts.get(key, 0) + 1

    return {
        "tool": "Smart Bioinformatics Toolkit",
        "tool_version": "0.1.0",
        "top_n": top_n,
        "min_consensus": min_consensus,
        "thresholds": thresholds,
        "summary": {
            "total_queries": len(grouped) + len(no_hit_queries),
            "queries_with_hits": total_queries_with_hits,
            "queries_without_hits": len(no_hit_queries),
            "total_candidates": total_candidates,
            "queries_truncated": total_truncated,
        },
        "verdict_settings": {
            "species_threshold": species_threshold,
            "min_coverage": verdict_min_coverage,
            "min_query_length": min_query_length,
            "near_threshold_margin": near_threshold_margin,
            "difficult_groups_loaded": len(difficult_groups),
        },
        "verdict_counts": dict(sorted(verdict_counts.items())),
        "flags": sorted(set(summary_flags)),
        "per_query": per_query,
        "no_hit_queries": no_hit_results,
    }


def _has_conflicting_taxonomies(hits: list[dict[str, Any]]) -> bool:
    """True if the same accession is associated with multiple distinct lineages."""
    seen: dict[str, set[str]] = {}
    for h in hits:
        acc = h.get("sacc") or h.get("sseqid")
        if not acc:
            continue
        lin = h.get("_lineage")
        sig = None
        if lin is not None:
            ranks = lin.ranks
            sig = "|".join(
                f"{r}:{(ranks[r] or {}).get('taxid')}"
                for r in ["species", "genus", "family"]
                if ranks.get(r)
            )
        seen.setdefault(acc, set()).add(sig)
        if len(seen[acc]) > 1:
            return True
    return False
