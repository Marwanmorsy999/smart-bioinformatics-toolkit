# Source-code implementation map

This document records which external projects to study, what to reuse as dependencies, and what the Smart Bioinformatics Toolkit will implement itself. The review is selective, not a full security or line-by-line audit of every repository.

## Decision principle

- Reuse established scientific algorithms through maintained packages.
- Build our own user interface, orchestration, interoperable schemas, explanations and reports.
- Improve usability and evidence transparency without claiming the underlying biological methods are novel.
- Pin dependency versions and recheck their licence files at the time of integration.

## Module map

| Module | Existing project/source | Reuse or study | Our implementation |
|---|---|---|---|
| FASTA parsing | [Biopython FastaIO](https://github.com/biopython/biopython/blob/master/Bio/SeqIO/FastaIO.py) | Use Biopython SeqIO in Python; study parser behavior | Browser parser in `web-platform/js/fasta.js` |
| Sequence statistics | [SeqKit stat.go](https://github.com/shenwei356/seqkit/blob/master/seqkit/cmd/stat.go), [Biopython SeqUtils](https://github.com/biopython/biopython/blob/master/Bio/SeqUtils/__init__.py) | Study metric definitions; use Biopython where useful | Matched JS/Python metrics and explanatory UI |
| BLAST execution | [NCBI BLAST+](https://blast.ncbi.nlm.nih.gov/doc/blast-help/), [QIIME 2 _blast.py](https://github.com/qiime2/q2-feature-classifier/blob/dev/q2_feature_classifier/_blast.py) | Use BLAST+ in local Python CLI; study subprocess and tabular output patterns | Local CLI adapter and separate NCBI remote adapter for web |
| BLAST result parsing | [QIIME 2 Feature Classifier](https://github.com/qiime2/q2-feature-classifier) | Study result schema and no-hit handling | Independent TSV importer, schema validation, transparent filters and exports |
| Taxonomy consensus | [QIIME 2 consensus assignment](https://github.com/qiime2/q2-feature-classifier/blob/dev/q2_feature_classifier/_consensus_assignment.py) | Study taxonomic consensus and LCA-style logic | Evidence ledger, explicit ties, configurable abstention and explanation |
| Taxonomic classifier comparison | [Taxonova](https://github.com/kardokhk/taxonova) | Use as a comparator/benchmark candidate; do not host large PyTorch models on Workers | Compare its output with BLAST-derived evidence in local evaluation |
| Global alignment | [VSEARCH](https://github.com/torognes/vsearch) | Optional local dependency if an alignment method is needed | Adapter and comparison tests; do not rewrite alignment algorithms |
| Sanger chromatogram QC | [isolateR](https://github.com/bdaisley/isolateR), [Biopython ABI parser](https://biopython.org/docs/latest/api/Bio.SeqIO.AbiIO.html) | Study methods; use Biopython for our implementation; do not copy isolateR source | Future AB1 parser/viewer, quality report and trimming workflow |
| Reports | [MultiQC](https://github.com/MultiQC/MultiQC) | Study report structure and data-module concepts | Lightweight HTML/CSV/JSON reports that accept outputs from independent tools |
| Benchmarking | [TaxoBench](https://github.com/kardokhk/Taxobench) | Study holdout design and metrics | Benchmark tailored to 16S isolate identification and false confident calls |

## Important source-code observations

### FASTA

Biopython's `Bio.SeqIO.FastaIO` provides established FASTA parsing functions. The Python CLI should use Biopython rather than a homemade parser. The browser needs a small JavaScript parser because Biopython is not part of the plain-JavaScript frontend.

### Statistics

SeqKit provides a useful reference for file-level metrics such as sequence count, total length, length distribution, N50/L50 and GC. Our MVP implements a documented subset and adds explanatory outputs. Do not claim FASTA has quality scores: Q20/Q30 require FASTQ or chromatogram information.

### BLAST

QIIME 2 separates BLAST execution from taxonomy consensus. Our architecture should preserve that separation. Its documentation highlights that BLAST `maxaccepts` should not be assumed to mean the top N highest-scoring matches. We should request an adequate candidate set, rank explicitly, and preserve tied/near-tied results.

### Taxonomy

QIIME 2 consensus assignment and Taxonova's rank-specific abstention are useful references. Their confidence values are method-specific and must not be merged into one numerical score without calibration. A BLAST identity percentage is not a model probability.

### Sanger

isolateR is a close workflow competitor and is useful for understanding chromatogram QC and type-strain matching. Its GPL licence has implications for adapted source. Prefer implementing our AB1 handling using Biopython and documented algorithms rather than copying isolateR code.

### Reports

MultiQC is a mature reporting project. We should learn from its modular report design but create our own templates and code unless we explicitly decide to comply with GPL-3.0 requirements.

## Licence and reuse policy

1. Use libraries as dependencies under their own licence terms.
2. Do not copy source code based only on the repository being public.
3. Check the exact pinned commit's `LICENSE` file before copying or adapting any implementation.
4. Check reference-database and model-weight terms separately from source-code licences.
5. Keep `THIRD_PARTY_NOTICES.md` current.
6. If a dependency's licence is ambiguous or absent, study its behavior but do not incorporate its code until permission/licence is clear.

## Reference repositories

- Biopython: https://github.com/biopython/biopython
- SeqKit: https://github.com/shenwei356/seqkit
- QIIME 2 Feature Classifier: https://github.com/qiime2/q2-feature-classifier
- VSEARCH: https://github.com/torognes/vsearch
- isolateR: https://github.com/bdaisley/isolateR
- Taxonova: https://github.com/kardokhk/taxonova
- TaxoBench: https://github.com/kardokhk/Taxobench
- MultiQC: https://github.com/MultiQC/MultiQC
- 16S-Pipeline: https://github.com/tatsu1207/16S-Pipeline

Last reviewed: 2026-11-02. Repository branches and licences can change; check again before integrating code.

## Milestone 0.5.0 additions

- `shared/difficult-groups.json`: cited difficult groups (data, not code).
- `shared/test-cases/verdict_cases.json`, `verdict_pipeline.tsv`, `verdict_pipeline_map.tsv`, `verdict_pipeline_expected.json`: shared verdict fixtures.
- `python-engine/src/smartbio/taxonomy/verdict.py`: verdict logic (Python).
- `web-platform/public/js/verdict.js`, `difficult-groups.js`: verdict logic (JS) and embedded groups (generated from the shared JSON; a test fails if they drift).
- `python-engine/src/smartbio/benchmark/queries.py`, `evaluate.py`: benchmark query generation and evaluation.
- Tests: `tests/test_verdict.py`, `test_verdict_pipeline.py`, `test_benchmark.py`, `web-platform/tests/verdict.test.mjs`, `verdict_pipeline.test.mjs`.

## M7.4 unified research workspace (batch 1, design + API only)

- `docs/M7_4_WORKSPACE_DESIGN.md`: architecture, schema, API, authorization and honesty decisions.
- `web-platform/migrations/0011_workspace.sql`: additive columns on `projects`/`datasets`, new `workspace_runs` and `provenance_records`; reports reuse `report_runs`.
- `web-platform/functions/api/workspace/`: versioned static workflow catalog (`catalog.js`), owner derivation and state machine (`_lib.js`), labelled sample payload (`demo.js`) and owner-scoped project/dataset/run/report handlers.
- Existing code reused unchanged: `functions/api/ai/_lib.js` helpers, `agentTokenError`, D1 tables `projects`/`datasets`/`report_runs`/`audit_events`, and the legacy 16S/phylo engines.
- **Status label:** API + design **EXISTS (batch 1)**; browser workspace UI **NOT BUILT** (batch 2). No new scientific domain, no R2, no login, no production deployment.
