# Milestone 0.1.0 — FASTA Validator and Sequence Statistics

## Implemented

- Browser application using HTML, CSS and vanilla JavaScript ES modules.
- Browser-side parsing and processing; input sequences are not sent to a server.
- DNA and protein sequence modes.
- FASTA structural checks, empty-record checks, duplicate-ID detection and alphabet validation.
- Ambiguous-symbol and protein stop-symbol warnings.
- Statistics over valid, non-empty records only.
- DNA GC percentage using canonical A/C/G/T as the denominator.
- Sequence length summaries, nucleotide counts, mean per-record GC percentage and DNA N50/L50.
- CSV and JSON exports, plus valid-record FASTA export.
- Python CLI using Biopython, argparse and Pandas.
- Shared rule definitions and shared JavaScript/Python test vectors.
- GitHub Actions workflow for Python and JavaScript tests.
- OpenCode handoff prompt for the next implementation task.

## Test results

Last local verification:

- Python: `python -m pytest -q` — 10 passed.
- JavaScript: `npm test` — 4 passed.
- Python CLI sample: `main.py analyze` generated `validation.json`, `statistics.json`, `statistics.csv` and `analysis.json`.
- Python compile check: passed.

A browser visual QA session was not performed in this build environment. After opening the page in a browser, manually test the included DNA and protein examples, file upload, the two independent actions and each download button.

## Important limits

- No BLAST connection exists in this milestone.
- No taxonomy verdict engine exists in this milestone.
- No AB1 chromatogram processing or Phred quality assessment exists yet.
- DNA N50/L50 are sequence-collection summary metrics, not an isolate identification or quality score.
- The web application currently has no backend and no persistent history.

## Next task

Implement the BLAST Results Analyzer as an independent import tool. It should accept standard and explicitly selected extended BLAST tabular schemas, validate rows, preserve ties and no-hit query records where query metadata is supplied, explain filter decisions, and export CSV/JSON. Implement the behavior in both browser JavaScript and Python Pandas with tests. See `OPENCODE_HANDOFF_PROMPT.md`.
