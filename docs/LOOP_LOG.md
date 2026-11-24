# Loop log

## Loop 1 — audit + report metadata parity

### Task 0: audit hand-off
- Python: 106 passed, 1 skipped (test_blast_integration skipped: BLAST+ not installed)
- JavaScript: 52 passed, 0 failed
- Coverage restored: JS +4 tests (verdict shared cases 16->19, taxonomy_cycle), Python +7 (verdict +3, taxonomy_cycle, build_taxonomy_map, blast_integration, report)
- Playwright QA: loaded taxonomy.html example, ran analysis, 3 verdict banners rendered, JSON/CSV downloads worked, print-report button present. Group links not exercised in the example because no difficult-group members appear; code sets rel="noopener noreferrer".
- Demo benchmark numbers: unchanged (verdict_pipeline fixtures untouched); near_threshold added caution only, did not alter the documented demo counts.

### Task 1: report metadata parity
- Standardized parameters keys across Python/JS (min_coverage instead of verdict_min_coverage, added difficult_groups_loaded).
- Added shared fixture shared/test-cases/report_metadata_keys.json and tests in both languages.

### Files changed
- python-engine/main.py
- python-engine/tests/test_report.py
- web-platform/public/js/report.js
- web-platform/tests/report_metadata.test.mjs
- shared/test-cases/report_metadata_keys.json
- docs/LOOP_LOG.md

### Not verified
- Report HTML visual layout in a real browser print (only generated and key-checked).
- Group-link safety in a real difficult-group run (example lacks such hits).

## Loop 2 — verdict robustness (edge cases)

### Task 3
- Added 8 shared edge cases to verdict_cases.json (identical identities, missing identity/coverage, empty taxonomy, uninformative names, mixed case/whitespace, subspecies/strain names).
- Normalized species names and filtered uninformative names in both verdict.py and verdict.js.
- Added near-threshold caution to early-return branches.

### Counts
- Python: 30 verdict cases pass; full suite 108 passed, 1 skipped.
- JavaScript: 29 verdict cases pass; full suite 52 passed.

## Loop 3 — benchmark readiness
- Added scripts/run_benchmark.py orchestrating queries -> makeblastdb -> blastn -> taxonomy -> benchmark-eval over seeds, failing loudly if BLAST+ or inputs missing.
- Updated BENCHMARK_PROTOCOL.md with usage.

## Loop 4 — difficult groups
- Added Escherichia/Shigella complex group sourced from PMC8441030 (16S similarity >99%).
- Updated shared/difficult-groups.json and embedded difficult-groups.js.
- Updated affected expected verdicts (c2, E. coli cases) to include the new caution.

## Final counts this session
- Python: 116 passed, 1 skipped
- JavaScript: 60 passed, 0 failed

## Loop 5 — Phase 0 audit (last hand-off)
### Task 0: audit hand-off
- Actual baseline (this snapshot): Python 116 passed / 1 skipped (test_blast_integration skipped: BLAST+ not installed); JavaScript 60 passed / 0 failed.
- The mission's reference numbers (JS 52 -> 51, Python 102 -> 106) do not match this snapshot; no test was dropped or merged here. All LOOP_LOG-described coverage (verdict shared cases, taxonomy_cycle, build_taxonomy_map, blast_integration, report metadata) is present and green. Nothing to restore.
- Playwright QA (previously reported): taxonomy.html example loads, analysis runs, 3 verdict banners render, JSON/CSV downloads work, print-report button present; group links not exercised in the example (no difficult-group members appear); code sets rel="noopener noreferrer". Not re-run in this session (no browser fixture change).
- near_threshold: added caution only; did not alter verdict_pipeline expected verdicts or synthetic demo counts (fixtures untouched). Verified by test_verdict_pipeline + test_verdict passing.
- Synthetic demo concept (plain top hit confidently names a missing close sibling while verdict abstains): covered by test_absent_group_member_top_hit_is_wrong_but_verdict_abstains (top_hit wrong >= cereus queries; verdict wrong == 0). These are synthetic pipeline numbers, not real performance.

### Task 1: report metadata parity
- Python build_reproducibility_metadata and JS buildReportHtml share structure: tool, tool_version, generated_at (ISO-8601 UTC), input_file, input_file_hash_sha256, parameters (top_n, min_consensus, species_threshold, min_coverage, min_query_length, near_threshold_margin, difficult_groups_loaded), thresholds, disclaimer. Verified by test_report.py and report_metadata.test.mjs. Both green.

### Files changed
- docs/LOOP_LOG.md (this entry)

### Not verified
- Report HTML visual layout in a real browser print.
- Group-link safety in a real difficult-group run (example lacks such hits).

## Phase 0-2 (this session)

### Phase 0 - audit
- Baseline: Python 116 passed / 1 skipped; JS 60 passed / 0 failed. Mission's 52->51 / 102->106 numbers did not match this snapshot; no test dropped. Near-threshold and demo numbers unchanged (fixtures untouched).
- Report metadata parity verified by existing shared fixture tests (both green).

### Phase 1 - robustness/safety
- Added Candidatus to uninformative-name filter in verdict.py and verdict.js (parity).
- Added shared verdict cases: very_long_hit_lists (500 hits + 50 duplicate accessions), duplicate_accessions, candidatus_uninformative. Python/JS tests both green.
- Added `total_queries` to BLAST summary in Python+JS (additive; fixes the previously-skipped integration test expectation).
- Fixed test_blast_integration.py synthetic sequences (ACGT repeat was dust-masked by blastn -> no hits). Changed input data, not weakened the assertion.
- Playwright UI: not re-run this session (browser tooling was restarted mid-session); prior session verified 3 verdict banners, downloads, print-report button.CSP already excludes inline scripts.

### Phase 2 - REAL benchmark (executed and saved)
- Installed NCBI BLAST+ 2.17.0+ from official installer (blastn/makeblastdb/blastdbcmd verified).
- Downloaded (URLs verified from NCBI targeted-loci page + FTP listings): bacteria.16SrRNA.fna.gz (SHA-256 eefbe0bc...), bacteria.16SrRNA.gbff.gz (251b0201...), taxdump.tar.gz (e6015d1c...). Download date 2026-11-24.
- Built taxonomy_map.tsv (nodes.dmp + names.dmp + 26,888 accession->taxid pairs from gbff) and taxid_map.tsv for makeblastdb.
- Extended scripts/build_taxonomy_map.py to work without rankedlineage.dmp (current taxdump lacks it); extended scripts/run_benchmark.py to add -parse_seqids with -taxid_map and support noisy mode.
- Held-out run (seed 1,2,3; n=200; length 500; 0.5% substitutions): plain top hit mean 143.3 wrong calls/200 (call rate 100%); 98.65% cutoff baseline 38.0 wrong / 87.7 calls; Toolkit verdict 12.7 wrong / 49.7 calls, 150.3 abstentions. Verdict beats the real cutoff baseline on wrong calls among calls (0.257 vs 0.431) with lower call rate.
- Noisy run: top hit 9.0 wrong, cutoff 9.0 wrong, verdict 1.3 wrong.
- Raw outputs, exact commands, logs and generated RESULTS.md saved under benchmark_data/ (benchmark_runs_heldout4, benchmark_runs_noisy2, run_*.log, RESULTS.md).
- Limitations: truth from FASTA headers; one release; simulated noise; group containment 0 in these runs.

### Test counts (final this session)
- Python: 120 passed (116 prior + 3 new verdict cases + 1 integration now running), 0 skipped.
- JS: 63 passed (60 prior + 3 new verdict cases), 0 failed.

### Not verified
- Real browser Playwright run and Cloudflare deployment (wrangler login not available; STOP condition).
- Risk-coverage sweep and per-genus breakdown (phase 3) not completed this session.
- Sourced difficult-group expansion / NCBI remote BLAST API notes (phases 4-5) not completed this session.

## Phase 3-6 checkpoint (this session)

### Phase 3 - risk-coverage sweep
- Added shared synthetic fixture `shared/test-cases/risk_coverage_cases.json` and `risk_coverage.py` / `risk-coverage.js` with tests in both languages (Python +3, JS +2). The accessible inline-SVG chart is in `web-platform/public/benchmark.html`. Clearly labelled synthetic, never presented as performance.
- Production risk-coverage curves from the real benchmark outputs were not swept across thresholds in this session (only the synthetic shared-fixture sweep was implemented); this remains a task.

### Phase 4 - sourced next-step advice / difficult groups
- Not completed this session. Existing difficult groups remain cited and flagged `needs_curator_review`; no new groups added without reading a source. Name-drift notes not written.

### Phase 5 - remote BLAST backend and deployment
- Verified all URL API params, output formats and usage limits from official NCBI pages (docs/NCBI_API_NOTES.md) and the `16S_ribosomal_RNA` database name from the NCBI FTP listing.
- Implemented Pages Functions (submit/status/results/history) with D1 binding, `MOCK_NCBI=1`, input validation, server-side once-per-minute RID polling, result caching, CSP/no-store headers, no sequence persistence (hash only) and tests for every endpoint (+37 JS tests).
- Cloudflare Pages project created on Free plan; static preview deployed successfully (Cloudflare API: deploy stage success) at https://4e5048a8.smart-bioinformatics-toolkit.pages.dev (alias https://phase-1-robustness-safety.smart-bioinformatics-toolkit.pages.dev). D1 database still needs a real database_id and the migration applied before the backend can run live; backend was verified with mocks only.
- Real-browser verification of the live URL was blocked: the paired browser and curl both rejected the pages.dev TLS certificate in this environment; Cloudflare API confirmed the deployment exists and succeeded.

### Phase 6 - documentation
- Added docs/PROJECT_SUMMARY.md (Mermaid diagram, what/gap/evidence/result/limits), docs/DEMO_SCRIPT.md (script-inserted real results), docs/NCBI_API_NOTES.md. benchmark_data/RESULTS.md generated from saved JSON.

### Final counts
- Python: 123 passed, 0 skipped.
- JS: 102 passed, 0 failed.

### Not verified / remaining risks
- Live NCBI remote BLAST call (MOCK mode only), live D1-backed endpoints, real-browser rendering of the live deployment, production risk-coverage sweep from real outputs, Phase 4 sourced additions, UI wiring for remote submission.
