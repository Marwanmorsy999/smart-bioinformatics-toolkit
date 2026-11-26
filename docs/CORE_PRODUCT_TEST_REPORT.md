# Core Product Test Report - CORE PRODUCT COMPLETION

**Verification date:** 2026-11-26
**Branch:** `product/core-completion`
**Base commit:** `8105956c908ea6c0d5c053b5ed2c13b86516d2a2`
**Starting commit (M7.6 reconciliation):** `0303e615e4cdf71a9b97038773a537beab9acdb9`
**Final commit:** `302cd982461f89a04e5d31784d51b8d4b231f2ff` (M7.6 code fix + documentation reconciliation)
**Current staging deployment:** `c00c6245-c91e-4bc2-9b64-881677b97972`
**Status:** Consolidated report of the program's completed test runs. This document is documentation-only: this worker ran no new test suite, made no commit and made no deployment. A separate code-fix worker is adding the corrected NCBI database identifier and 16S readiness changes after the starting commit.
**CURRENT implementation snapshot:** branch `product/core-completion`, base `8105956â€¦`, starting commit `0303e615â€¦`, staging deployment `c00c6245-c91e-4bc2-9b64-881677b97972`, verification date 2026-11-26.

**Baseline M7.6 re-run totals (previously verified, not re-run by this documentation pass):** JS **542/542**, Python **244/244**, workspace E2E **PASS**, phylo page E2E **PASS** (page/contract only), UI E2E **10/10**, assistant E2E **10/10**, M7.4.2 E2E **9/9**, 16S E2E **3 pass / 1 skipped** (live opt-in). Previously verified routes: `/`, `/16s.html`, `/assistant.html`, `/workspace.html`, `/ai.html`, `/blast.html`, `/taxonomy.html`, `/phylo.html`, `/benchmark.html`, `/research-use.html`; `/api/tools/catalog` (version `1.0.0-m7.4`, 12 tools); `/api/assistant/status` (`available:false`, `reason:"no_enabled_llm_provider"`).

**History (preserved, superseded â€” not current):** earlier branch HEAD at the M7.5 documentation-pass task start was `32abf86e6ab8da6819454103286c06e0b62d1076`; earlier staging deployments were `892f4266-2afa-4a0f-aa3f-00585764faf5` (registry/assistant/16S) then `ed08189a-5db2-41b1-98f3-732b5c97992f` (resume-by-RID). Production untouched. `MOCK_NCBI` on staging was set to `0` to permit live NCBI; no other secret or provider was activated.

**Reporting rule:** mocked/offline, browser-only real, real live submission and real live retrieval are **separate categories**. They are never added together into one aggregate success figure. A skipped live path is reported as skipped, not passed. A blocked result is reported as blocked, not failed silently or replaced by a synthetic payload.

---

## 1. Unit tests

| Category | Command / scope | Result | Notes |
|---|---|---:|---|
| JavaScript unit tests | `npm test` â†’ `node --test tests/*.test.mjs` in `web-platform/` | **526 / 526 PASS** | Covers registry/catalog, assistant gateway, BLAST submit/status/results, planner, workspace, providers, phylo contracts. |
| Python unit tests | `python-engine/tests` (pytest) | **244 / 244 PASS** | `SMARTBIO_PLUGIN_DIR_TRUSTED=1` was set because the tests ran in a temporary worktree (plugin-dir trust guard); this is an environment accommodation, not a scientific claim. |

No unit-test file was deleted or weakened in this program. The assistant gateway tests are **10/10** and include fail-closed assertions (`reply`, `message`, `choices`, `generated_text`, `usage` absent; 503 `assistant_provider_unavailable`), which prove honest unavailability, not working chat.

---

## 2. Offline / mocked browser E2E

| Category | Result | Evidence / notes |
|---|---:|---|
| Workspace E2E | **PASS** | `web-platform/tests/workspace.e2e.mjs`; M7.4/M7.5 workspace flows, operator-token derivation, metadata-only storage. |
| Phylogenetics page E2E | **PASS** | `web-platform/tests/phylo_page.e2e.mjs`; page/contract behaviour only - **not** a claim that the remote MAFFTâ†’IQ-TREE path works. |
| UI/UX browser E2E | **10 / 10 PASS** | `web-platform/tests/uiux_browser.e2e.mjs`; captures under `web-platform/test-results/uiux/`. |
| Assistant gateway tests | **10 / 10 PASS** | `web-platform/tests/assistant.test.mjs`; see آ§1 note. |
| M7.4.2 accessibility/honesty E2E | **9 / 9 PASS** | `web-platform/tests/m7_4_2_browser.e2e.mjs`; report `docs/M7_4_2_ACCESSIBILITY.md`. Automated offline Chromium with real gateway handlers as stubs; no live provider call. |
| 16S E2E (labelled offline fixture) | **3 PASS / 1 SKIPPED** | `web-platform/tests/sixteen_s.e2e.mjs`: (a) capability browser + deterministic draft, (b) full chain ending in a clearly labelled synthetic result, (c) no live endpoint contacted; (d) live-path test skipped unless the owner sets `LIVE_NCBI=1` and `STAGING_URL`. Mock RID `MOCKOFFLINEFIXTURE`, synthetic TSV, banner `SYNTHETIC / MOCK DATA`. |

**No offline test is counted as evidence of real NCBI retrieval or real AI chat.** The 16S offline fixture makes no NCBI call and is labelled synthetic in the UI (`sixteen_s.e2e.mjs:1-7,65-73,153-285`).

---

## 3. Browser-only real science (no provider, no local agent, no mock)

| Check | Result | Verified values | Evidence |
|---|---|---|---|
| FASTA statistics from public NCBI nuccore `NR_074666.1`, computed in the browser | **PASS (real)** | Records **1**, length **1524**, GC **52.1654%**, composition **A397 T332 G475 C320**; independent calculation **52.17%** (matches to two decimals). | `D:/DevCache/Temp/live-16s-evidence/10-browser-only-statistics.png`; `D:/DevCache/Temp/live-16s-evidence/browser-only-trace.zip` |

This category uses no API provider, no local agent and no mock data. It demonstrates that the browser-side science is genuinely computed from the public input, independent of the cloud path.

---

## 4. Real live submission (with mock off)

| Check | Result | Verified values | Evidence |
|---|---|---|---|
| Public test dataset prepared | **PASS** | NCBI nuccore `NR_074666.1`, **1653 bytes**, SHA-256 `07efc2c1aeac02a2eed1cbe8d8479b59ffa00a730e93ed65881b41069c652853`. | `D:/DevCache/Temp/live-16s-real.json`; evidence screenshots `01-input.png`, `02-validated.png` |
| Deterministic plan + explicit approval + single-use consent | **PASS** | Plan step `step_1 آ· ncbi.blastn`, params `{"database":"16S_ribosomal_RNA","program":"blastn"}`, external egress yes, consent `external-blast`; token value intentionally not displayed. | `03-plan.png`, `04-approved.png`, `live-16s-real.json` |
| Real NCBI submission with `MOCK_NCBI=0` | **PASS (live submission only)** | Real RID **`GF4KCK07016`** from a genuine consent-governed submission. M7.6 raw evidence shows the canonical `CMD=Get` response was `Status=FAILED` (invalid database `16S_ribosomal_RNA`), not a successful search; the earlier app-level "Searching"/`queued` wording is retained as **history**, not as NCBI's canonical status. | `docs/evidence/M7_6_status_url_raw.json`, `docs/evidence/M7_6_searchinfo_raw.json`, `docs/evidence/M7_6_NCBI_DIAGNOSIS.md`; historical `05-submitted.png`, `06-status.png`, `live-16s-real.json`, `D:/DevCache/Temp/live-16s-evidence/trace.zip` |
| Resume monitoring by existing RID, no resubmission | **PASS (history)** | Pasted RID `GF4KCK07016`; status checks continued without a new submission or new consent. No corrected NCBI submission was made. | `D:/DevCache/Temp/resume-16s.json`, `D:/DevCache/Temp/live-16s-evidence/resume-trace.zip` (historical staging version `ed08189a-5db2-41b1-98f3-732b5c97992f`) |

**Success here means a real RID was obtained and externally confirmed. It does not mean results were retrieved.**

---

## 5. Real live retrieval (not achieved â€” the search FAILED at NCBI)

| Check | Result | Verified detail | Evidence |
|---|---|---|---|
| `GET /api/blast/results/:rid` for real RID | **NOT ACHIEVED** | The genuine RID `GF4KCK07016` did **not** stay queued. NCBI's canonical `CMD=Get` response is `QBlastInfoBegin / Status=FAILED / QBlastInfoEnd` with the exact error `Error: No alias or index file found for nucleotide database [16S_ribosomal_RNA] in search path [â€¦]. Please verify the spelling of â€¦`. Our code used the invalid bare database name; NCBI's current value is `rRNA_typestrains/16S_ribosomal_RNA`. No real TSV was returned. The old app-level `queued` label (`live-16s-real.json`) was produced by a lossy parser and is retained as **history**. | `docs/evidence/M7_6_status_url_raw.json` (HTTP 200, `text/html`, 2026-11-26T09:30:05.386Z); `docs/evidence/M7_6_searchinfo_raw.json` (HTTP 200 OK, `text/html`, 2026-11-26T09:27:54.831Zâ€“09:27:55.868Z); diagnosis `docs/evidence/M7_6_NCBI_DIAGNOSIS.md` |
| `FORMAT_OBJECT=SearchInfo` status page | **MISREAD BY THE OLD PARSER** | Its `Status=READY` and `ThereAreHits=no` describe the **format request**, not the search; its visible `Status: Searching` row is a stale JS placeholder. The old parser scanned the first `Status=` token in the whole HTML body with a `queued` default, did not distinguish search status from format-request status and never surfaced NCBI's error text. | `docs/evidence/M7_6_searchinfo_raw.json`; `docs/evidence/M7_6_NCBI_DIAGNOSIS.md` |

**M7.7 correction (M7.6 line above preserved as history):** `format_status_only` is removed; a valid SearchInfo QBlastInfo block is search-status evidence in `mode="SearchInfo"`. But this SearchInfo `READY`/`no-hits` CONTRADICTS canonical `CMD=Get` `Status=FAILED` for `GF4KCK07016`; `parseQBlastStatus` collects all `Status=` values across QBlastInfo blocks and returns typed `status_conflict` (terminal); `reconcileStatusEvidence(A,B)` -> `status_conflict` preserving both evidences; production re-verifies canonical `CMD=Get`, only canonical `complete` unlocks; nothing malformed/empty/timed-out/non-2xx maps to `queued`. **Corrected P0 conclusion: invalid database identifier is decisive; no real result regardless; no real TSV was ever retrieved; no corrected live submission without explicit owner authorization.** See `docs/evidence/M7_6_NCBI_DIAGNOSIS.md` آ§7. M7.7 additive `rtoe`; no `CMD=Put` in M7.7; no provider change; no D1 migration.
| Real TSV parse â†’ table â†’ taxonomy â†’ provenance â†’ downloads from live data | **NOT DEMONSTRATED** | The browser chain is implemented and exercised with **clearly labelled synthetic TSV only**; no real result ever became available, so no real-data rendering, screenshot, trace or download can be claimed. Browser parser/taxonomy availability is not negated by the unavailable local Python 16S variants. | `mock-offline/retrieved-results.tsv` is the **mock** TSV; `mock-offline/07-results.png` is the labelled synthetic result; mock RID `MOCK07EFC2C1AEAC02A2` is synthetic only |

No fabricated result was rendered. The flow's failed/error-status message is "No results were retrieved; no result is fabricated." (`public/js/16s-flow.js:394-398`), and retrieval errors say "Nothing was fabricated." (`:472-474`).

**Blocker owner:** the invalid NCBI database identifier in our submitted job (bare `16S_ribosomal_RNA` instead of `rRNA_typestrains/16S_ribosomal_RNA`), **not** the provider queue and **not** our TSV parser. The submission, consent, polling, gate and result endpoints are implemented and staging-verified; NCBI rejected the search. A corrected database identifier is implemented in the final commit. **A corrected live submission requires EXPLICIT OWNER AUTHORIZATION and has NOT happened.** The overall 16S end-to-end workflow is PARTIAL / `production_ready:false`; browser-only statistics and the real submission remain individually verified capabilities.

---

## 6. Blocked / unavailable test categories

| Category | Status | Why no success count is reported |
|---|---|---|
| Real NCBI result retrieval | **NOT ACHIEVED** (آ§5) | The search FAILED at NCBI (invalid bare database `16S_ribosomal_RNA`); 0 real results. Overall 16S workflow is PARTIAL / `production_ready:false`. |
| 16S live-path E2E test | **SKIPPED** by design | Requires owner-set `LIVE_NCBI=1` and `STAGING_URL`; the live path was exercised manually instead (آ§4), not by that unit test. |
| AI chat with an authorized remote model | **UNAVAILABLE** | `reason:"no_enabled_llm_provider"`; `/api/assistant/chat` â†’ 503 `generated:false`; no provider contacted. Assistant UI tests prove the fail-closed shell, not model capability. |
| Remote phylogenetics (MAFFTâ†’IQ-TREE full path) | **PARTIAL / UNVERIFIED** | Local phylo adapters are real; remote path unverified, `production_ready:false`; no live Galaxy call was permitted. |
| R2 artifact bytes, auth B2, new providers, migrations, production deploy | **OUT OF SCOPE / INACTIVE** | Explicit program constraints; no test claims these work. |

---

## 7. Accessibility summary

From `docs/M7_4_2_ACCESSIBILITY.md` (9/9 automated E2E) and the assistant implementation:

- **Not a certification.** The review is automated offline Chromium plus token arithmetic; it makes no WCAG conformance claim and does not replace manual screen-reader, real-device, 400% zoom/reflow or expert review.
- Nine public pages: one skip link to a single `<main>`, consistent 5-item nav, wordmark/footer/favicon on all pages, universal research-use notice on all pages (including the assistant page after the D1 fix).
- Zero horizontal overflow on 9 pages أ— 5 viewports (1440أ—900, 1280أ—800, 768أ—1024, 390أ—844, 360أ—800); 45 page screenshots plus 6 footer captures.
- Zero unlabeled visible form controls; `aria-live`/`role="alert"` on status/error regions; visible focus ring on keyboard Tab; Escape closes the mobile sidebar and returns focus; `prefers-reduced-motion` collapses transitions.
- Computed contrast on key token pairs meets â‰¥4.5:1 text and â‰¥3:1 focus-ring thresholds (e.g. body text 15.69:1, unavailable banner title 5.32:1, focus ring 8.93:1). This is token-level calculation, not a full rendered-tree scan.
- Assistant honesty: banner visible, composer/send/stop disabled, zero fabricated messages, 8 activity stages `not-started`; suggested prompts do not generate. All text is rendered via DOM/text nodes, never `innerHTML`.
- Fail-closed API probe with injected secret env values: no call escaped the stub and no credential/config name or value appeared in bodies or headers.

---

## 8. Screenshots, traces and evidence paths

| Path | What it proves |
|---|---|
| `D:/DevCache/Temp/live-16s-evidence/01-input.png` â€¦ `06-status.png` | Public FASTA input, validation, plan, approval, real submission, status. |
| `D:/DevCache/Temp/live-16s-evidence/mock-offline/07-results.png` | Labelled **synthetic/mock** result (not a real NCBI result). |
| `D:/DevCache/Temp/live-16s-evidence/10-browser-only-statistics.png` | Browser-only real FASTA statistics (آ§3). |
| `D:/DevCache/Temp/live-16s-evidence/trace.zip` | Browser trace of the real submission/status run. |
| `D:/DevCache/Temp/live-16s-evidence/resume-trace.zip` | Browser trace of resume-by-RID without resubmission. |
| `D:/DevCache/Temp/live-16s-evidence/browser-only-trace.zip` | Browser trace of the browser-only statistics run. |
| `D:/DevCache/Temp/live-16s-evidence/mock-offline/retrieved-results.tsv` | **Mock** TSV with `MOCK DATA` marker - synthetic evidence only. |
| `D:/DevCache/Temp/live-16s-real.json` | **History** â€” stage-by-stage live record with the old parser's final label `queued`; RID `GF4KCK07016`; no console errors. Not NCBI's canonical final status. |
| `docs/evidence/M7_6_status_url_raw.json` | **Authoritative raw evidence** â€” canonical `CMD=Get` request URL/params, HTTP 200 `text/html`, timestamp 2026-11-26T09:30:05.386Z, `Status=FAILED` and the exact NCBI error text. |
| `docs/evidence/M7_6_searchinfo_raw.json` | **Authoritative raw evidence** â€” `FORMAT_OBJECT=SearchInfo` request URL/params, HTTP 200 OK `text/html`, timestamps 2026-11-26T09:27:54.831Zâ€“09:27:55.868Z, `Status=READY`, `ThereAreHits=no`, stale `Status: Searching` row. |
| `docs/evidence/M7_6_NCBI_DIAGNOSIS.md` | Raw-evidence-based diagnosis: search status vs format-request status, old-parser misclassification, invalid database identifier conclusion. |
| `D:/DevCache/Temp/resume-16s.json` | Resume-by-RID poll history for `GF4KCK07016` (history). |
| `D:/DevCache/Temp/core-completion/web-platform/test-results/core/` | `assistant-capability-1440x900.png`, `assistant-capability-390x844.png`, `assistant-plan-draft-1440x900.png`, `sixteen-input-1440x900.png`, `sixteen-results-1440x900.png`, `sixteen-results-390x844.png`. |
| `D:/DevCache/Temp/core-completion/web-platform/test-results/uiux/` | M7.4.2 and UI/UX responsive captures (`m742/`, `after/`), including assistant and footer views. |
| `D:/DevCache/Temp/core-completion/docs/m742-screenshots/` | Historical M7.4.2 captures retained from the branch (assistant/blast, five viewports). |

---

## 9. Honest final scoreboard

| Category | Count / verdict |
|---|---|
| JS unit tests | **526 / 526 PASS** |
| Python unit tests | **244 / 244 PASS** (`SMARTBIO_PLUGIN_DIR_TRUSTED=1`) |
| Workspace E2E | **PASS** |
| Phylo page E2E | **PASS** (page/contract only) |
| UI E2E | **10 / 10 PASS** |
| Assistant tests | **10 / 10 PASS** (fail-closed shell) |
| M7.4.2 E2E | **9 / 9 PASS** |
| 16S E2E | **3 PASS / 1 SKIPPED** (live path opt-in; offline path synthetic) |
| Browser-only statistics (real) | **PASS** |
| Real NCBI submission (live) | **PASS (submission only)** - genuine consent-governed submission, RID `GF4KCK07016`; the job later FAILED at NCBI |
| Real NCBI result retrieval (live) | **NOT ACHIEVED** - search FAILED at NCBI (invalid bare database `16S_ribosomal_RNA`); 0 real TSV results |
| Overall 16S end-to-end workflow | **PARTIAL / `production_ready:false`** - browser-only statistics and real submission individually verified; no genuine NCBI result retrieved, validated, displayed or exported |
| AI chat with remote model | **UNAVAILABLE** - no authorized provider, `reason:"no_enabled_llm_provider"`; no fake AI prose |

**There is no combined "X/Y passed" number across these rows.** Mocked passes, UI passes, browser-only real computation, real live submission and blocked live retrieval describe different claims and must be read separately.

## 11. M7.6 final regression (post-fix, separate categories)

- JavaScript full suite: **542/542** pass, 0 fail, 0 skipped.
- Python: **244 passed**.
- 16S E2E: **3 PASS / 1 SKIPPED** (live opt-in) after the JSON results fixture fix.
- New mocked-NCBI honesty suite: **15/15** pass; targeted blast suites: **48/48** pass.
- Workspace E2E PASS, phylo page E2E PASS, UI E2E 10/10, assistant 10/10, M7.4.2 E2E 9/9.
- Live NCBI: **no new submission**; no real result retrieved. Mock/offline evidence remains quarantined in `mock-offline/`.

