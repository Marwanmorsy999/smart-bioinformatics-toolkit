# Milestone 0.5.0: identification verdicts and benchmark tooling

## Added

- `shared/difficult-groups.json`: two cited difficult groups. Member lists need curator review.
- `python-engine/src/smartbio/taxonomy/verdict.py` and `web-platform/public/js/verdict.js` (plus generated `difficult-groups.js`): identical logic, verified by shared fixtures.
- `run_taxonomy_analysis` / `analyzeTaxonomy` add a `verdict` per query, plus top-level `verdict_counts` and `verdict_settings` (additive; existing keys unchanged).
- Taxonomy page: verdict banner per query, species screening identity and minimum query length inputs, verdict columns in CSV.
- CLI: verdict options on `taxonomy`; `benchmark-queries` and `benchmark-eval`.
- `python-engine/src/smartbio/benchmark/`: query generator (`noisy`, `heldout` modes) and evaluator (top-hit method vs verdict method).
- Tests: Python 93+ and JavaScript 47 passing at hand-off (run both suites to confirm).

## Verified

- Both test suites pass on Linux (Python 3.12, Node 22 era).
- CLI smoke tests for `taxonomy`, `benchmark-queries`, `benchmark-eval`.

## Not verified / limitations

- **No real benchmark has been run.** All benchmark tests use synthetic sequences and a stand-in identity search; they prove the pipeline, not accuracy.
- The browser UI additions were not exercised in a real browser.
- Difficult-group member lists come from general taxonomy knowledge; only the "hard to separate" claims are cited. A curator must verify them (for example against LPSN).
- Escherichia/Shigella is a known problem pair but has no cited entry yet, so it is deliberately absent.
- The threshold rule is binary; near-threshold results are not yet cautioned.
- `shared/test-cases/taxonomy_map.tsv` has a circular parent link (taxid 1234 and 1423 name each other as parent). It works today but should be corrected.
- `--online` NCBI taxonomy lookup is still only tested with mocks.
- Verdict taxids in `verdict_pipeline_map.tsv` are illustrative, not NCBI-verified.
