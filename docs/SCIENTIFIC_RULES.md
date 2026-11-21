# Scientific rules and interpretation safeguards

## Sequence modes

The current MVP requires an explicit choice between DNA and protein.

- DNA alphabet: `ACGTRYSWKMBDHVN`.
- Protein alphabet: `ACDEFGHIKLMNPQRSTVWYBZJXUO*`.
- Lowercase is normalized to uppercase.
- RNA is not accepted in DNA mode (`U` is excluded). Add a separate RNA mode in a later change rather than silently accepting U as DNA.

## FASTA quality checks are not sequencing-quality assessment

FASTA contains sequence characters but not per-base Phred quality scores. The MVP can detect invalid symbols, ambiguous bases, empty sequences, duplicate identifiers and structural issues. It cannot infer chromatogram trace quality. For Phred-based assessment, use FASTQ or original Sanger AB1 data in a future feature.

## GC percentage

For DNA, the MVP defines:

`GC% = (count(G) + count(C)) / (count(A) + count(C) + count(G) + count(T)) * 100`

Ambiguous IUPAC bases are excluded from the denominator and reported separately. If there are no canonical A/C/G/T bases, GC% is null/N/A. The interface must state this definition.

## Statistics inclusion

Per-file aggregate statistics include valid, non-empty records only. Invalid records remain in validation output and are counted in the validation summary, but do not affect statistics.

## Future BLAST interpretation

- BLAST similarity is evidence, not proof of function or species identity.
- Interpret identity with query coverage, aligned length, E-value, score, query quality and reference provenance.
- Preserve ties and near-ties. Never use arbitrary database order as the sole selection criterion.
- Keep BLAST search, candidate filtering, taxonomy mapping and verdict generation as separate stages.
- Distinguish BLAST evidence from machine-learning model confidence.
- A value such as 98.65% 16S identity may be used as a screening reference, not a universal hard species boundary.
- A result below that threshold does not establish a novel species.
- An insufficient-evidence/abstain verdict is an acceptable and often preferable result.
- Type-strain provenance, database release and taxonomy access date should be recorded when available.
- Difficult species groups (for example, the Bacillus cereus group) should trigger cited warnings where supported by evidence.

## Verdict layer (Milestone 0.5.0)

The verdict layer turns a taxonomy consensus into one conservative call per query. It is implemented identically in `python-engine/src/smartbio/taxonomy/verdict.py` and `web-platform/public/js/verdict.js` and tested against `shared/test-cases/verdict_cases.json` and `verdict_pipeline_expected.json`.

Statuses: `species_supported`, `group_level_only`, `genus_level_only`, `below_screening_threshold`, `insufficient_evidence`.

Rules:

- The best hit is chosen by bitscore (ties by identity). Query coverage below the minimum (default 80%) yields `insufficient_evidence`; unavailable coverage is flagged, not assumed.
- Only hits at or above the species screening identity (default 98.65%) count toward a species call. Exactly one qualifying species gives `species_supported`; several species in one genus give `genus_level_only`; several genera give `insufficient_evidence`.
- A top identity below the screening reference gives `below_screening_threshold`, reported at genus level only. It does not mean a novel species.
- Species belonging to a group in `shared/difficult-groups.json` are reported at group level (`group_level_only`) or carry a caution flag. Every group needs a cited source; member lists are illustrative and flagged `needs_curator_review`.
- Queries shorter than the minimum length (default 500 nt) get a `partial_sequence` caution.
- Support values are evidence fractions, never calibrated probabilities. Every verdict carries a research-use disclaimer.
- Species names are normalized (whitespace collapsed, case-insensitive) before counting distinct species, but the original display name is retained. Uninformative names ("sp.", "uncultured", "bacterium") do not support a species call. Subspecies/strain names count as distinct species unless they share a taxid. Missing identity or coverage yields an insufficient-evidence or cautioned result rather than a crash. Hit lists of any length are handled.
- A query whose top identity is within a configurable margin (default 0.35 percentage points) of the species screening threshold, or that has a non-qualifying species within that margin below it, carries the `near_threshold` caution flag and a reason. The margin is configurable; defaults are experimental.

## Research-use limitation

This application is for research and education. It is not a validated clinical diagnostic device and must not produce clinical treatment recommendations.

## N50/L50 scope

N50/L50 are calculated only for DNA sequence collections. They are commonly used to summarize assembled contig collections. In an isolate-identification context, they are descriptive collection metrics only; they are not measures of isolate identity, 16S identification confidence, or Sanger chromatogram quality. Protein N50/L50 is not displayed in this MVP.
