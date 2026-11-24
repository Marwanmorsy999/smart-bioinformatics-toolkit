"""Generate benchmark queries from a reference FASTA.

Two modes, both deterministic for a given seed:

* ``noisy``    - queries are noisy partial copies of reference records that
                 stay in the database. Tests ambiguity handling when close
                 relatives exist.
* ``heldout``  - selected records are removed from the reference database
                 before searching, so the true species is absent. Tests
                 whether the method over-claims when the species is unknown.

Truth species is parsed from the reference FASTA header: first token is the
accession, the next two words are genus and species (RefSeq style:
``>NR_074334.1 Bacillus cereus ATCC 14579 16S ribosomal RNA ...``).
"""

from __future__ import annotations

import random
from pathlib import Path
from typing import Any

from io import StringIO

from Bio import SeqIO

BASES = "ACGT"


def species_from_header(header: str) -> str | None:
    """Extract a genus/species label from a RefSeq-style FASTA header.

    Handles the observed header shapes: ``>ACC Genus species ...``,
    ``>ACC Candidatus Genus species ...`` and subgenus notes in parentheses.
    Returns None for headers without a recognisable binomial, so such records
    are excluded from truth rather than silently mislabelled.
    """
    raw = header.lstrip(">")
    # Local (lcl|) headers have no accession token; other RefSeq-style headers
    # begin with an accession. Drop it for the binomial extraction.
    parts = raw.replace("|", " ").split()
    if len(parts) < 3:
        return None
    words = parts[1:] if not raw.lower().startswith("lcl|") else parts[2:]
    # Skip subgenus / bracketed qualifiers before the binomial.
    cleaned = []
    skip = False
    for w in words:
        if w.startswith("(") or w.startswith("["):
            skip = True
        if not skip:
            cleaned.append(w)
        if skip and (w.endswith(")") or w.endswith("]")):
            skip = False
    # "Candidatus" is part of the formal name: keep the next two words.
    if cleaned and cleaned[0].lower().startswith("candidatus"):
        if len(cleaned) >= 3:
            return f"{cleaned[0]} {cleaned[1]} {cleaned[2]}"
        return None
    if len(cleaned) >= 2:
        genus, epithet = cleaned[0], cleaned[1]
        # Exclude obvious non-binomial tokens (e.g. "only", "16S").
        if epithet.lower().startswith("16s") or genus.lower().startswith("16s"):
            return None
        return f"{genus} {epithet}"
    return None


def _mutate(sequence: str, rate: float, rng: random.Random, indel_rate: float = 0.0) -> str:
    """Substitute bases and (optionally) insert/delete one base at ``indel_rate``.

    Insertions add a random base; deletions remove the current base. The
    mutation process is deterministic for a given seed. These are simulated
    errors, NOT real sequencing error models.
    """
    out: list[str] = []
    for base in sequence:
        if rng.random() < indel_rate:
            if rng.random() < 0.5:
                continue  # deletion
            out.append(rng.choice(list(BASES)))  # insertion
        if rng.random() < rate:
            out.append(rng.choice([b for b in BASES if b != base]))
        else:
            out.append(base)
    return "".join(out)


def make_benchmark_queries(
    reference_text: str,
    *,
    mode: str = "noisy",
    n: int = 20,
    length: int = 500,
    substitution_rate: float = 0.005,
    indel_rate: float = 0.0,
    seed: int = 1,
) -> dict[str, Any]:
    """Return query FASTA text, truth TSV text and (heldout) reference FASTA text."""
    if mode not in {"noisy", "heldout"}:
        raise ValueError("mode must be 'noisy' or 'heldout'")
    if not 0 <= substitution_rate < 0.5:
        raise ValueError("substitution_rate must be in [0, 0.5)")
    if not 0 <= indel_rate < 0.5:
        raise ValueError("indel_rate must be in [0, 0.5)")

    records = list(SeqIO.parse(StringIO(reference_text.lstrip("\ufeff")), "fasta"))
    usable = []
    for rec in records:
        species = species_from_header(rec.description)
        seq = str(rec.seq).upper()
        if species and len(seq) >= length and set(seq) <= set(BASES):
            usable.append((rec, species, seq))
    if not usable:
        raise ValueError("No usable reference records (need header species and ACGT-only sequences)")

    rng = random.Random(seed)
    chosen = rng.sample(usable, min(n, len(usable)))

    queries, truth = [], []
    for i, (rec, species, seq) in enumerate(chosen, start=1):
        start = 0  # first `length` nt (V1-V3 region for a 16S record)
        fragment = _mutate(seq[start : start + length], substitution_rate, rng, indel_rate)
        qid = f"bq{i:03d}"
        queries.append(f">{qid} source={rec.id}\n{fragment}\n")
        truth.append(f"{qid}\t{species}\n")

    held = {rec.id for rec, _, _ in chosen} if mode == "heldout" else set()
    reference_out = None
    if mode == "heldout":
        reference_out = "".join(
            f">{rec.description}\n{str(rec.seq).upper()}\n"
            for rec in records
            if rec.id not in held
        )

    return {
        "queries_fasta": "".join(queries),
        "truth_tsv": "query_id\ttrue_species\n" + "".join(truth),
        "reference_fasta": reference_out,
        "mode": mode,
        "n_queries": len(chosen),
        "seed": seed,
        "length": length,
        "substitution_rate": substitution_rate,
        "indel_rate": indel_rate,
        "simulated_errors_not_sequencing_errors": True,
    }
