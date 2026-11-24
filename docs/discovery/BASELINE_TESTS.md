> **Status: HISTORICAL — superseded by later verification; findings retained verbatim.**
> **Reconciliation (2026-11-24):** These 130 Python / 103 JS results remain the preservation baseline and are intentionally unchanged. Later verification recorded a larger JS suite (129 passed, 0 failed) after the M4 consent-gate tests were added; no Python change was made in that work.
>
> The original report below is unchanged.

---

# Baseline test run — milestone 0.5 (before platform work)

**Date:** 2026-11-24
**Environment:** Windows, Python 3.14 (pytest 8.4.2), Node v24.21.0
**Purpose:** Preservation baseline for the platform vision reset. All pre-existing tests must remain green after every change.

## Commands and results

| Command (from repo root) | Result |
|---|---|
| `cd python-engine; python -m pytest -q` | **130 passed in 6.65s** |
| `cd web-platform; npm test` (script: `node --test tests/*.test.mjs`) | **103 passed, 0 failed, 303ms** |

Note: invoking `node --test tests/` directly fails with `MODULE_NOT_FOUND` because the test script uses a glob (`tests/*.test.mjs`). Use `npm test`.

## Preserve

- `python-engine/tests/**` (pytest) — FASTA, statistics, BLAST parsing/runner, taxonomy, verdict, consensus, lineage, risk coverage, reports, CSV safety, benchmark, shared vectors.
- `web-platform/tests/**` (node:test) — verdict pipeline, taxonomy, risk coverage, report metadata, BLAST submit/status/results/history/lib, CSV safety, core.

## Observations

- Tests are deterministic and offline-capable; no network required for the baseline.
- Playwright is declared in `web-platform/package.json` but no browser tests are present.
- The NCBI BLAST Worker integration has a mock mode (`isMock(env)`) — tests exercise both paths.
- Any new AI-platform test suite must be additive and must not modify these baselines.
