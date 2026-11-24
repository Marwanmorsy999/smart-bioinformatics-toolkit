# M6 Final Report — Production Readiness, Execution Experience and Scientific Integrity

**Date:** 2026-11-25
**Branch:** `phase-1-robustness-safety`
**Baseline:** `8a946a2` (verified identical to GitHub HEAD, clean tree, six M5 commits inspected)
**Verdict:** **All achievable global gates PASS** — staging deployment is live and browser-verified; production promotion is deliberately withheld pending the execution-topology decision below.

> No success claim in this report is based on file creation or unit-test counts alone. Every gate has an independently executed command, an independent reviewer, or a real Chromium run behind it.

---

## 1. M6.1 — Baseline audit (independent)

- Branch `phase-1-robustness-safety`; local HEAD `8a946a2e81fdfb604cd532b5b47fb91a5bb1bc27`; GitHub `refs/heads/phase-1-robustness-safety` identical; working tree clean.
- Six M5 commits inspected: `f884f19`, `0664a0a`, `e37e84d`, `ef7de3e`, `f7d4957`, `8a946a2`. No rewrites, no force pushes.
- Re-ran reported suites: **231 Python / 144 JS** at baseline; plugin compliance OK; M5 reports accurate; real/mock labelling consistent; scientific tests intact.
- Found and fixed a pre-existing CI failure: GitHub Actions run #4 (at `8a946a2`) failed only in `npm test` because the workflow pinned **Node 20** while `tests/ai_contract.test.mjs` imports `node:sqlite` (Node ≥22.5). Workflow now pins Node **24**, `package.json` declares `engines.node >=22.5.0`. Tests were not weakened.

## 2. M6.2 — Execution topology

Decision (documented in `docs/EXECUTION_TOPOLOGY.md`):
- **A — Browser execution:** lightweight FASTA validation/statistics run in-page via existing `fasta.js`/`statistics.js`; zero `/api/*` calls after submit; no terminal.
- **B — Local agent:** heavy tools (phylogenetics, taxonomy, BLAST) run by the polling Python agent. Cross-platform install/start/health/update/uninstall scripts in `scripts/agent-setup/` (PowerShell + sh), user-scoped venv, secure token file, ff-only updates, data-preserving removal.
- **C — Remote workflow execution:** architecture-only; no invented provider, deployment or cost model.

Honesty controls: `/api/ai/backend` reports an agent as observed only from an authenticated heartbeat or job claim, never from configuration; mock mode and missing D1 fail closed; `simulated_results_available: false`. An unavailable backend blocks the heavy route with an actionable message. A 10-minute bounded poll with retry/stop replaced unbounded waiting.

**Cold-start catch-22 fixed:** idle agents are now visible via `agent_heartbeats` (migration 0006) written on every authenticated poll, so a fresh deployment can start its first heavy job from the UI. The agent also sends an identifiable `User-Agent`, eliminating a Cloudflare 403 on Python urllib's default header.

## 3. M6.3 — Dataset and artifact architecture

`docs/DATA_TRANSPORT.md` now separates five domains: browser-local memory, local agent workspace, D1 metadata, content-addressed artifact storage, and external scientific services. D1 is explicitly **not** a general-purpose file store: 64 KiB input cap, 2 MiB result cap, SHA-256 on every dataset/artifact, byte-cap enforcement, sanitized filenames, `TemporaryDirectory` cleanup, and download-time hash checks. No R2 upload exists. Retention/deletion rules are stated, with automatic expiry recorded as an M7 gap. External transmission remains consent-gated.

## 4. M6.4 — Scientific validation and output contracts

- Worker `validateResultShape()` now enforces each tool's declared `output_schema.required` against both `artifacts[].name` and `provenance.output.artifact_names`, validates declared JSON types, rejects malformed JSON, enforces complete provenance, and accepts only `real`/`mock`. Failed steps may still submit a report-only result. Python `validation.py` applies the same generic declared-artifact rule. New tests cover missing outputs, wrong types, malformed artifacts, invalid hashes, incomplete provenance, unexpected fields and invalid modes.
- Independent scientific review of phylogenetics: **PASS WITH NOTES**. Real Biopython `PairwiseAligner` progressive MSA (UPGMA guide) and real `DistanceTreeConstructor.nj()`; known-answer values (120 columns, 92 conserved, A/B bipartition) and eight hashes independently reproduced; indel and ambiguous-IUPAC datasets exercised; no external aligner installed, so **no equivalence to MAFFT/Clustal Omega is claimed**. Replacing the heuristic is **optional, not required**. Limitations documented (indel-blind guide distance, uncorrected p-distance, no branch support, no iterative refinement, trivial bipartition field).

## 5. M6.5 — Cloudflare Workers deployment

- D1 database `smart-bioinformatics-toolkit-blast` created (`d277fe22-f99d-46d8-9ae9-6de17942a6a9`, EEUR); `BLAST_DB` binding configured.
- Standalone Worker (`web-platform/worker.js`) with Workers Assets replaces the broken Pages deployment (the Pages project returned 404 on every path). `wrangler.toml` uses `main`, `assets`, and `[env.staging]`.
- Migrations 0001→0004 + 0006 applied in order and verified: **14 tables** (including `agent_heartbeats`), schema read back from real D1.
- A UTF-8 BOM in `public/_headers` initially broke Workers Assets validation; removed (fix verified in commit `557361e`).
- Secrets set via `wrangler secret put` (never printed, logged or committed): `AI_AGENT_TOKEN`, `MOCK_NCBI=1` for staging safety.
- **Staging URL:** `https://smart-bioinformatics-toolkit-staging.m-2396.workers.dev`, Worker version `f4538286-d5a7-465a-a0f0-3ffd522fbbd8`.
- Live probes: `/` 200 with CSP/nosniff/permissions headers; `/api/tools` 200 (9 tools); `/api/ai/backend` 200 honest status; `/api/blast/history` 200 from real D1; real AI plan row created; unauthenticated `/api/ai/jobs` 401; unknown `/api/**` 404 JSON; no static HTML leaked on API paths.
- **Production promotion deliberately withheld**: staging and production currently share one D1 database, and the no-terminal deployment still depends on a running local agent for heavy jobs. Both are documented deployment decisions/risks, not silent failures.

## 6. M6.6 — Real browser E2E

Playwright 1.65.1 / Chromium 159, real staged site, 10 scenarios, screenshots in `docs/discovery/m6-screenshots/`, full evidence in `docs/discovery/TEST_REPORT_M6_BROWSER.md`.

**FINAL RE-RUN: 10/10 scenarios PASS, 64/64 assertions PASS, 0 FAIL.** Scenarios cover navigation/hero, backend observation from a cold start, browser-local analysis with zero API calls, genuine phylogenetics plan→approve→job→result, validation and evidence-bounded findings, report download with Reproducibility/Limitations/Data locality/Education notes, malformed input, unavailable backend, direct consent-gate denial (403 typed error, zero NCBI calls), and mock-mode labelling. Only expected console messages appeared; no page errors, failed requests or external-host requests.

Timings (ms): 1387, 937, 531, 5930, 92, 856, 534, 806, 492. Screenshot sizes 26–200 KB.

## 7. M6.7 — Research transparency

- FR-8.5 locality receipts: `aiagent/locality.py` produces local operations, transmissions with destination/bytes/input hash, consent references (`token-ref:<hash>`, never raw tokens), mode and `no_external_egress`; the Worker now **derives its own receipt** from job/audit rows and ignores caller-supplied receipts. Run DTO exposes it to the workspace UI.
- FR-8.6 education mode: `aiagent/education.py` produces exactly `{rule_or_threshold, why_insufficient, what_would_help, verified_reference}` from curated thresholds; unverified references become `null`; abstentions are never converted to positive conclusions. The Worker derives notes from validation flags and ignores caller-supplied notes. Both are rendered in the downloadable report and the workspace.

## 8. M6.8 — Independent verification (seven roles)

1. Execution architecture & usability — **PASS WITH NOTES**; cold-start and cap/polling issues fixed.
2. Python & scientific computation — **PASS WITH NOTES**; 240 tests re-run; no weakened scientific tests.
3. Scientific validation — **PASS WITH NOTES**; real NJ, no equivalence claim.
4. Cloudflare deployment & API security — **PASS WITH NOTES**; live probes verified.
5. Frontend & accessibility — **PASS WITH NOTES**; HIGH focus contrast and mock badge fixed.
6. Independent browser E2E — **PASS**, 64/64 final assertions.
7. Red-team assessment — initially **FAIL** (1 HIGH, 4 MEDIUM); all fixed and re-verified:
   - fabricated references could be persisted as verified → curated JS ledger, exact projection, ledger-derived `verified_by`;
   - caller-supplied locality receipt/education could lie → Worker-derived replacements;
   - concurrent result submissions both committed → conditional status claim, 409 for losers;
   - queued unclaimed job accepted → require `running` + `agent_id`;
   - residual LOW: execution_mode still honours the agent label when no operator override is set (mock override works; no 9Router changes).

## 9. Test counts, commits and infrastructure

| Item | Result |
|---|---|
| Python `pytest -q` (final) | **240 passed** |
| JavaScript `npm test` (final) | **211 passed, 0 failed** |
| Plugin compliance / registry freshness | OK / current |
| Independent audit verifier | 26/26 |
| Browser E2E | 64/64 |
| Staging D1 | 14 tables, migrations 0001–0004 + 0006 applied |
| Staging Worker | deployed, version `f4538286`, endpoints probed |

M6 commits: `40194d5`, `fd061db`, `0a31428`, `557361e`, `72293e2`, `1357775`, `df1b08a`, plus the final run-DTO/docs commit. History preserved; no force push.

## 10. Remaining risks and blockers

- **No production promotion** while staging and production share D1 and heavy execution needs a local agent; this is the deliberate "do not promote with broken critical paths" decision.
- Residual LOW: `computeExecutionMode` trusts the agent's `real` label unless the operator sets `mock`; a compromised plugin could mislabel simulated output on a default deployment.
- Staging shares the production D1 row space; use a separate Free-tier D1 for staging before production launch.
- Automatic D1 retention/expiry and a user-facing deletion flow are not implemented; operators must delete rows explicitly.
- Linux/macOS agent setup scripts were syntax-checked but not executed on Linux in this milestone; cross-platform runtime verification remains outstanding.
- A PHP-style "localhost" development agent loop is not bundled; students need the documented setup scripts for heavy tools.
- Office dashboard command `D:\Apps\Star-Office-UI\office-status.cmd` is absent on this host (environmental only).

## 11. Recommended M7

1. Decide the no-terminal execution model for heavy tools (bundled local service vs approved remote workflow adapter with a real cost/deployment model) and implement it.
2. Separate staging and production D1, add automatic retention/deletion, and promote to production only after a fresh E2E run on production URLs.
3. Make `jobs.execution_mode` authoritative at result submission to close the residual LOW mode label risk.
4. Add a lightweight authenticated heartbeat test for Linux/macOS runtime, and a browser E2E job on a fresh clone.
5. Consider publication-grade phylogenetics (MAFFT/ModelFinder/bootstrap) only as a new, separately validated capability — never by silently replacing the existing deterministic heuristic.
