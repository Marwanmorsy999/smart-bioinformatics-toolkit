# Hand-off prompt: continue from Milestone 0.5.0

Paste everything below into OpenCode (or another coding agent) with the repository open.

```
ROLE
You are continuing development of the Smart Bioinformatics Toolkit, a free, framework-free web platform plus Python CLI for interpreting 16S rRNA BLAST results (bacterial isolate identification). Read README.md, docs/SCIENTIFIC_RULES.md, docs/SOURCE_CODE_MAP.md, docs/MILESTONE_0.5.0.md and docs/BENCHMARK_PROTOCOL.md first, then run both test suites to confirm a green baseline:
  cd python-engine && python -m pytest -q
  cd web-platform && node --test tests/*.test.mjs

PROJECT GOAL (do not drift)
Turn BLAST hits into a conservative, explained identification verdict (species / group / genus / below threshold / insufficient evidence) and prove with a benchmark that it makes fewer confident wrong species calls than the plain top-hit method. Research use only; never claim proof of identity or clinical validity.

HARD RULES
- Frontend: vanilla HTML/CSS/JS ES modules only. No React/Vue/Angular, no build framework.
- Backend (later): Cloudflare Pages Functions + D1 only. No R2, no paid services, no Python backend, no BLAST+ inside Workers.
- Python and JavaScript behaviour must stay identical for validation, metrics and verdict logic. Every behaviour change needs shared fixtures in shared/test-cases/ and tests in BOTH languages.
- Keep output schemas additive and backward compatible.
- Never fabricate citations, taxids, accessions or benchmark results. If a source is not retrieved and read, do not add a difficult group or a cited claim. Mark uncertain data as needing curator review.
- Support values are evidence fractions, not probabilities.
- Do not upload user sequences anywhere unless the user starts a feature that requires it.
- Complete files for new files; small targeted edits for existing ones. Give copy-pasteable commands.

TASKS (do in order; stop and report after each; run both suites after each)
1. Fix the circular parent link in shared/test-cases/taxonomy_map.tsv (taxids 1234 and 1423 name each other as parent). Correct the lineage, keep all existing tests green, and add a mapping validation test that rejects cycles in both Python and JS if not already covered.
2. Add scripts/build_taxonomy_map.py: convert NCBI taxdump (rankedlineage.dmp and nodes.dmp) plus an accession-to-taxid file into the mapping TSV format used by the taxonomy command. Offline tests with a tiny hand-made taxdump fixture. Document where users download taxdump.
3. Near-threshold caution: when the top identity is within a configurable margin (default 0.35 percentage points) of the species threshold, or when a non-qualifying species is within that margin below it, add caution flag near_threshold and a reason. Implement in verdict.py and verdict.js, add shared cases, update docs/SCIENTIFIC_RULES.md.
4. Printable report: a self-contained HTML report (browser Print to PDF) per run containing verdicts, reasons, cautions, evidence tables, all parameters and thresholds, tool version, input file hash, date, and the research-use disclaimer. Add to the taxonomy page and a CLI --report option. Reproducibility metadata must be identical in structure across Python and JS.
5. Add an optional integration test that runs real local BLAST+ on a tiny synthetic database and is SKIPPED when blastn is not installed. Do not add network-dependent tests.
6. Browser QA of web-platform/public/taxonomy.html with Playwright (dev dependency only, not required to run the app): load the example, run an analysis, check verdict banners, group links open safely (rel noopener), CSV and JSON downloads. Fix anything found.
7. Cloudflare Pages preparation (static site only): wrangler.toml, _headers (CSP without inline scripts), README deploy steps. Do not add backend code yet.
8. Remote BLAST backend (only after tasks 1-7 are accepted): Pages Functions that submit to NCBI remote BLAST against the curated 16S database, with the browser polling /api/status/:rid at most once per minute per RID (enforce server-side with last_checked_at in D1), caching results in D1, validating inputs, and a MOCK_NCBI=1 mode for demos and tests. Respect NCBI usage policy (identify the tool and email, keep submissions modest, back off on errors). Verify the exact database name and URL API parameters against NCBI documentation before coding; do not guess.

THINGS YOU MUST TELL THE USER HONESTLY
- No real benchmark has been run yet. The user must run docs/BENCHMARK_PROTOCOL.md with real NCBI 16S data; you can prepare scripts but must not invent numbers.
- Difficult-group member lists need curator review.
- Escherichia/Shigella has no cited entry; add one only after reading a source.

REPORT FORMAT AFTER EACH TASK
Files changed, commands run with pass/fail counts, what was not verified, and the next task. Ask questions only when blocked.
```
