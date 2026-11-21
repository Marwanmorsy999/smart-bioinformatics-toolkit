# OpenCode handoff prompt — continue Smart Bioinformatics Toolkit

Copy the prompt below into OpenCode after opening the repository root.

---

You are continuing an existing university bioinformatics software project named **Smart Bioinformatics Toolkit**. Read `README.md`, `docs/SOURCE_CODE_MAP.md`, `docs/SCIENTIFIC_RULES.md`, and the current source code before making changes.

## Product requirements (do not change without asking)

1. The web frontend must use **plain HTML, CSS and vanilla JavaScript ES modules**. Do not introduce React, Vue, Angular, Svelte, JSX, or a frontend build framework.
2. The Python CLI is a separate local/research interface and must preserve the original assignment technologies: Biopython, `argparse`, `subprocess` when external tools are added, and Pandas.
3. Every feature must be usable independently. A user can choose one task, run it, download its result, and leave. A complete workflow is optional.
4. The project must remain deployable using Cloudflare's Free plan. Do not add R2, paid databases, paid compute, or a paid hosting provider. Use the free `pages.dev` subdomain for the student demo.
5. Do not run BLAST+ inside Cloudflare Workers. The intended split is local BLAST+ for the Python CLI and NCBI remote BLAST for the browser application, subject to NCBI usage policies.
6. Do not upload or persist users' FASTA files unless a feature clearly needs a remote service and the user has initiated that action. The initial FASTA tools process locally in the browser.
7. This is research software, not a clinical diagnostic system. Never claim that a BLAST hit proves species identity or function.

## Existing milestone

Milestone 0.1.0 implements:
- Browser FASTA Validator and Sequence Statistics.
- Python CLI `validate`, `stats`, and `analyze` commands.
- DNA and protein alphabet checks.
- Shared rules and cross-language test vectors.
- Browser downloads for validation JSON, statistics JSON/CSV and valid FASTA.

Do not break existing behavior. Before changing validation logic, read `shared/sequence-rules.json` and update both JavaScript and Python implementations plus the shared tests.

## Immediate next task: BLAST Results Analyzer (independent tool)

Implement an independent BLAST TSV import/analyzer before adding live remote BLAST. The user must be able to bring a BLAST tabular file generated elsewhere and analyze it without making a new BLAST request.

### Requirements

- Accept the standard 12-column BLAST outfmt 6 schema:
  `qseqid sseqid pident length mismatch gapopen qstart qend sstart send evalue bitscore`
- Also support an explicit extended schema containing:
  `qseqid sacc staxids sscinames pident length qstart qend qlen evalue bitscore`
- Let the user select the schema or infer it only when it is unambiguous. Never silently guess arbitrary columns.
- Validate numeric columns, coordinate ranges, missing values and malformed rows. Report row numbers and errors.
- Preserve raw input rows and produce a separate filtered/ranked result.
- Support configurable minimum identity, minimum query coverage, maximum E-value and maximum displayed hits.
- Calculate query coverage from aligned query coordinates and `qlen` when available. For standard 12-column input, `qlen` is absent: do not invent it. Ask the user to provide query lengths from FASTA or label coverage unavailable.
- Preserve ties and near-ties. Do not use arbitrary first-hit ordering as the scientific decision rule.
- Group by query ID and explicitly represent queries with no returned hits if an input query list is available.
- Explain why each row passes or fails configured filters.
- Export filtered results and analysis metadata as CSV and JSON.
- Implement the feature in both the browser (vanilla JavaScript) and Python CLI (Pandas).
- Add Python pytest tests and Node `node:test` tests, including malformed TSV, ties, missing qlen, multiple queries, and threshold boundaries.

## Engineering workflow

1. Inspect existing modules and tests first.
2. Write a short implementation plan before editing.
3. Make small changes; do not rewrite the repository wholesale.
4. Keep browser and Python behavior consistent using shared test fixtures.
5. Run all Python tests: `cd python-engine && python -m pytest`.
6. Run all JS tests: `cd web-platform && node --test tests/*.test.mjs`.
7. Manually test the UI with the sample FASTA files and at least one synthetic BLAST TSV.
8. Update README and documentation with new features, input format, metric definitions and limitations.
9. Report exactly which files changed, commands run, test results, known limitations and the next suggested task.

## Scientific safeguards

- BLAST similarity is not proof of species identity.
- Do not treat 98.65% 16S identity as a universal hard species boundary.
- Separate sequence quality, alignment evidence, taxonomy consensus and model confidence. They are different types of evidence.
- Do not label an organism as a novel species merely because no close BLAST hit was found.
- Do not show FASTQ Phred metrics for FASTA input.
- Do not show Q20/Q30 without quality scores.
- Record database, access date/version where available, program, parameters and software version.
- Make annotation evidence inspectable and support an explicit "insufficient evidence" outcome.

## Code reuse and licensing

Prefer importing maintained libraries rather than copying source code. Review exact licence files and pinned versions before adding dependencies or adapting code. Do not copy GPL-licensed source into this repository unless the project owner explicitly accepts the licence consequences. Maintain `THIRD_PARTY_NOTICES.md`.

## Deliverable

Finish the BLAST TSV Analyzer as an independently usable feature. Do not start the Taxonomy Analyzer or NCBI live-search interface until the TSV analyzer has tests and a working browser UI.

---
