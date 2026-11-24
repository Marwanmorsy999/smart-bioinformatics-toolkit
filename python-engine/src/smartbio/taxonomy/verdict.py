"""Identification verdict layer.

Turns a per-query taxonomy consensus (see :mod:`smartbio.taxonomy.consensus`)
into one explicit, conservative verdict. The verdict is an interpretation of
BLAST evidence, not proof of species identity, and abstaining is an
acceptable outcome.

Verdict statuses
----------------
species_supported          one species above the screening threshold
group_level_only           species falls in a documented difficult group
genus_level_only           several species above threshold share a genus
below_screening_threshold  top identity under the screening reference
insufficient_evidence      no hits, low coverage, no taxonomy, or conflict

The 98.65% 16S identity value is a screening reference (Kim et al. 2014),
not a universal species boundary. Behaviour here must stay identical to
``web-platform/public/js/verdict.js``; both are tested against
``shared/test-cases/verdict_cases.json``.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

DEFAULT_SPECIES_THRESHOLD = 98.65
DEFAULT_MIN_COVERAGE = 80.0
DEFAULT_MIN_QUERY_LENGTH = 500
DEFAULT_NEAR_THRESHOLD_MARGIN = 0.35

DISCLAIMER = (
    "Research use only. This verdict interprets BLAST similarity evidence; "
    "it is not proof of species identity and not a clinical diagnosis."
)

_DEFAULT_GROUPS_PATH = (
    Path(__file__).resolve().parents[4] / "shared" / "difficult-groups.json"
)


def load_difficult_groups(path: str | Path | None = None) -> list[dict[str, Any]]:
    """Load difficult-group definitions; returns [] when the file is absent."""
    target = Path(path) if path else _DEFAULT_GROUPS_PATH
    if not target.is_file():
        return []
    data = json.loads(target.read_text(encoding="utf-8-sig"))
    return list(data.get("groups", []))


def _norm(name: str | None) -> str:
    return " ".join((name or "").split()).lower()


def _is_uninformative_species(name: str | None) -> bool:
    n = _norm(name)
    if not n:
        return True
    import re
    if re.search(r"\bsp\.?\b", n):
        return True
    if "uncultured" in n:
        return True
    if n in {"bacterium", "uncultured bacterium"}:
        return True
    if n.startswith("candidatus"):
        return True
    return False


def _rank_name(evidence_item: dict[str, Any], rank: str) -> str | None:
    lineage = evidence_item.get("lineage") or {}
    entry = (lineage.get("ranks") or {}).get(rank)
    if not entry:
        return None
    return entry.get("name")


def _sorted_species(mapping: dict[str, float]) -> list[dict[str, Any]]:
    rows = [{"species": k, "max_identity": v} for k, v in mapping.items()]
    rows.sort(key=lambda r: (-r["max_identity"], r["species"]))
    return rows


def compute_verdict(
    consensus: dict[str, Any],
    *,
    species_threshold: float = DEFAULT_SPECIES_THRESHOLD,
    min_coverage: float = DEFAULT_MIN_COVERAGE,
    min_query_length: int | None = DEFAULT_MIN_QUERY_LENGTH,
    query_length: int | None = None,
    groups: list[dict[str, Any]] | None = None,
    near_threshold_margin: float = DEFAULT_NEAR_THRESHOLD_MARGIN,
) -> dict[str, Any]:
    """Compute the verdict for one query from its consensus dictionary."""
    groups = groups or []
    evidence = list(consensus.get("evidence") or [])
    reasons: list[str] = []
    cautions: list[str] = []
    status = "insufficient_evidence"
    reported_rank: str | None = None
    reported_taxon: str | None = None
    matched_groups: list[dict[str, Any]] = []
    summary: dict[str, Any] = {
        "species_threshold": species_threshold,
        "min_coverage": min_coverage,
        "top_identity": None,
        "top_query_coverage": None,
        "qualifying_species": [],
        "below_threshold_species": [],
    }

    def finish() -> dict[str, Any]:
        return {
            "status": status,
            "reported_rank": reported_rank,
            "reported_taxon": reported_taxon,
            "reasons": reasons,
            "caution_flags": sorted(set(cautions)),
            "difficult_groups": matched_groups,
            "evidence_summary": summary,
            "disclaimer": DISCLAIMER,
        }

    if not evidence or not consensus.get("candidate_count"):
        reasons.append("No qualifying BLAST hits were available for this query.")
        return finish()

    ranked = sorted(
        evidence,
        key=lambda e: (
            -(e.get("bitscore") if e.get("bitscore") is not None else 0),
            -(e.get("pident") if e.get("pident") is not None else 0),
        ),
    )
    best = ranked[0]
    top_identity = best.get("pident")
    top_coverage = best.get("query_coverage")
    summary["top_identity"] = top_identity
    summary["top_query_coverage"] = top_coverage

    if top_identity is None:
        reasons.append("Percent identity is unavailable for the top hit.")
        return finish()

    if top_coverage is None:
        cautions.append("coverage_unavailable")
        reasons.append(
            "Query coverage is unavailable; provide query lengths so coverage can be checked."
        )
    elif top_coverage < min_coverage:
        reasons.append(
            f"The top hit covers only {top_coverage}% of the query "
            f"(minimum {min_coverage}%)."
        )
        return finish()

    if (
        query_length is not None
        and min_query_length is not None
        and query_length < min_query_length
    ):
        cautions.append("partial_sequence")
        reasons.append(
            f"Query length is {query_length} nt; similarity from partial "
            "sequences should be interpreted carefully."
        )

    def coverage_ok(item: dict[str, Any]) -> bool:
        cov = item.get("query_coverage")
        return cov is None or cov >= min_coverage

    qualifying: dict[str, float] = {}
    qualifying_display: dict[str, str] = {}
    below: dict[str, float] = {}
    below_display: dict[str, str] = {}
    qualifying_genera: set[str] = set()
    for item in evidence:
        species = _rank_name(item, "species")
        pident = item.get("pident")
        if not species or pident is None or not coverage_ok(item):
            continue
        if _is_uninformative_species(species):
            continue
        key = _norm(species)
        if pident >= species_threshold:
            if key not in qualifying or pident > qualifying[key]:
                qualifying[key] = pident
                qualifying_display[key] = species
            genus = _rank_name(item, "genus")
            if genus:
                qualifying_genera.add(genus)
        else:
            if key not in below or pident > below[key]:
                below[key] = pident
                below_display[key] = species
    for species in list(below):
        if species in qualifying:
            del below[species]
            if species in below_display:
                del below_display[species]
    summary["qualifying_species"] = _sorted_species(
        {qualifying_display[k]: v for k, v in qualifying.items()}
    )
    summary["below_threshold_species"] = _sorted_species(
        {below_display[k]: v for k, v in below.items()}
    )

    cons_status = consensus.get("status")
    cons_rank = consensus.get("supported_rank")

    if top_identity < species_threshold:
        status = "below_screening_threshold"
        genus = _rank_name(best, "genus")
        if genus and cons_rank in ("genus", "species"):
            reported_rank, reported_taxon = "genus", genus
        reasons.append(
            f"Top identity {top_identity}% is below the {species_threshold}% "
            "screening reference, so a species-level call is not supported. "
            "This does not establish a novel species."
        )
        if species_threshold - top_identity <= near_threshold_margin:
            cautions.append("near_threshold")
            reasons.append(
                f"Top identity is within {near_threshold_margin} percentage points "
                "of the species screening threshold."
            )
        return finish()

    if cons_status in ("conflicting_lineages", "insufficient_evidence"):
        if top_identity is not None and 0 <= (top_identity - species_threshold) <= near_threshold_margin:
            cautions.append("near_threshold")
            reasons.append(
                f"Top identity is within {near_threshold_margin} percentage points "
                "of the species screening threshold."
            )
        _names = {_norm(s) for s in qualifying_display.values()}
        for group in groups:
            members = {_norm(s) for s in group.get("species", [])}
            if _names & members:
                matched_groups.append(
                    {
                        "id": group.get("id"),
                        "display_name": group.get("display_name"),
                        "note": group.get("note"),
                        "source_url": group.get("source_url"),
                    }
                )
                cautions.append(f"difficult_group:{group.get('id')}")
        if matched_groups:
            reasons.append("A difficult-group caution applies to the candidate species.")
        reasons.append(
            "Reference taxonomies conflict or are insufficient; no identification is reported."
        )
        return finish()

    if not qualifying:
        if top_identity is not None and 0 <= (top_identity - species_threshold) <= near_threshold_margin:
            cautions.append("near_threshold")
            reasons.append(
                f"Top identity is within {near_threshold_margin} percentage points "
                "of the species screening threshold."
            )
        reasons.append(
            "No species-level taxonomy was available for hits above the threshold; "
            "provide a taxonomy mapping to enable species-level interpretation."
        )
        return finish()

    if len(qualifying) == 1:
        key = next(iter(qualifying))
        species = qualifying_display[key]
        status = "species_supported"
        reported_rank, reported_taxon = "species", species
        reasons.append(
            f"Only {species} has hits at or above {species_threshold}% identity."
        )
        if below:
            reasons.append(
                f"{len(below)} other candidate species fall below the threshold."
            )
    elif len(qualifying_genera) == 1:
        status = "genus_level_only"
        reported_rank, reported_taxon = "genus", next(iter(qualifying_genera))
        reasons.append(
            f"{len(qualifying)} species have hits at or above {species_threshold}% "
            "identity; species-level identification is not supported."
        )
    else:
        reasons.append(
            "Hits above the threshold span multiple genera; no genus or species call is reported."
        )
        _names = {_norm(s) for s in qualifying_display.values()}
        for group in groups:
            members = {_norm(s) for s in group.get("species", [])}
            if _names & members:
                matched_groups.append(
                    {
                        "id": group.get("id"),
                        "display_name": group.get("display_name"),
                        "note": group.get("note"),
                        "source_url": group.get("source_url"),
                    }
                )
                cautions.append(f"difficult_group:{group.get('id')}")
        if matched_groups:
            reasons.append("A difficult-group caution applies to the candidate species.")
        if cons_rank and cons_rank not in ("genus", "species"):
            reported_rank = cons_rank
            reported_taxon = consensus.get("consensus_taxon")
        return finish()

    near_threshold = False
    if (
        top_identity is not None
        and 0 <= (top_identity - species_threshold) <= near_threshold_margin
    ):
        near_threshold = True
        reasons.append(
            f"Top identity is within {near_threshold_margin} percentage points "
            "of the species screening threshold."
        )
    near_below = [
        sp for sp, pid in below.items()
        if (species_threshold - pid) <= near_threshold_margin
    ]
    if near_below:
        near_threshold = True
        reasons.append(
            f"{len(near_below)} candidate species fall within "
            f"{near_threshold_margin} percentage points below the threshold."
        )
    if near_threshold:
        cautions.append("near_threshold")

    names = {_norm(s) for s in qualifying}
    for group in groups:
        members = {_norm(s) for s in group.get("species", [])}
        if names & members:
            matched_groups.append(
                {
                    "id": group.get("id"),
                    "display_name": group.get("display_name"),
                    "note": group.get("note"),
                    "source_url": group.get("source_url"),
                }
            )
            cautions.append(f"difficult_group:{group.get('id')}")
    if matched_groups and status == "species_supported":
        status = "group_level_only"
        reported_rank = "group"
        reported_taxon = matched_groups[0]["display_name"]
        reasons.append(
            "The species belongs to a group that 16S similarity cannot reliably separate; "
            "report at group level."
        )
    elif matched_groups:
        reasons.append("A difficult-group caution applies to the candidate species.")

    return finish()
