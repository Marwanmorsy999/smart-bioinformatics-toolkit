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
