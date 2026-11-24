"""Shared verification ledger for plugin reference claims.

Both discovery (at runtime) and ``scripts/check_plugins.py`` (in CI) use this
module, so a fabricated ``verified: true`` claim fails closed in both places.
A reference is added to the ledger only after its bibliographic metadata has
been checked (DOI/CrossRef, PubMed or an in-tree source file).
"""

from __future__ import annotations

from typing import Any

VERIFIED_REFERENCES: dict[str, dict[str, str]] = {
    "iupac_1984_ambiguity": {
        "title": "Nomenclature for incompletely specified bases in nucleic acid sequences: recommendations 1984",
        "url": "https://doi.org/10.1093/nar/13.9.3021",
    },
    "altschul1990_blast": {
        "title": "Basic local alignment search tool",
        "url": "https://doi.org/10.1016/S0022-2836(05)80360-2",
    },
    "smartbio_gc_definition": {
        "title": "Smart Bioinformatics Toolkit: DNA GC percentage definition",
        "url": "python-engine/src/smartbio/statistics.py#calculate_statistics",
    },
    "cock2009_biopython": {
        "title": "Biopython: freely available Python tools for computational molecular biology and bioinformatics",
        "url": "https://doi.org/10.1093/bioinformatics/btp163",
    },
    "thompson1994_clustalw": {
        "title": "CLUSTAL W: improving the sensitivity of progressive multiple sequence alignment",
        "url": "https://doi.org/10.1093/nar/22.22.4673",
    },
    "saitou1987_neighbor_joining": {
        "title": "The neighbor-joining method: a new method for reconstructing phylogenetic trees",
        "url": "https://doi.org/10.1093/oxfordjournals.molbev.a040454",
    },
}


def reference_errors(references: Any) -> list[str]:
    """Return precise errors for missing or falsely verified citations."""
    errors: list[str] = []
    if not isinstance(references, list) or not references:
        return ["references must contain at least one entry"]
    for index, reference in enumerate(references):
        where = f"references[{index}]"
        if not isinstance(reference, dict):
            errors.append(f"{where}: must be an object")
            continue
        key = str(reference.get("key", ""))
        if reference.get("verified") is True:
            expected = VERIFIED_REFERENCES.get(key)
            if expected is None:
                errors.append(
                    f"{where}: reference_verification_unknown:{key} - "
                    "add verified metadata to the shared ledger or mark "
                    "verified=false with a note"
                )
                continue
            for field in ("title", "url"):
                if reference.get(field) != expected[field]:
                    errors.append(
                        f"{where}: reference_metadata_mismatch:{key}.{field} - "
                        "does not match the verified citation"
                    )
        elif not str(reference.get("note") or "").strip():
            errors.append(
                f"{where}: unverified reference '{key}' needs a note "
                "explaining the unmet verification claim"
            )
    return errors


__all__ = ["VERIFIED_REFERENCES", "reference_errors"]
