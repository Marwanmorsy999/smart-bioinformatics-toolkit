# Core Product Test Report - CORE PRODUCT COMPLETION

**Date:** 2026-11-26
**Branch:** `product/core-completion` · **Base:** `8105956c908ea6c0d5c053b5ed2c13b86516d2a2`
**HEAD at task start:** `32abf86e6ab8da6819454103286c06e0b62d1076` (follow-up docs-only commit to be applied by the coordinating session; this worker made no commit and ran no new test suite in this documentation pass).
**Status:** Consolidated report of the program's completed test runs. Documentation-only.

**Staging versions in evidence:** `892f4266-2afa-4a0f-aa3f-00585764faf5` (registry/assistant/16S), then `ed08189a-5db2-41b1-98f3-732b5c97992f` (resume-by-RID). Production untouched. `MOCK_NCBI` on staging was set to `0` to permit live NCBI; no other secret or provider was activated.

**Reporting rule:** mocked/offline, browser-only real, real live submission and real live retrieval are **separate categories**. They are never added together into one aggregate success figure. A skipped live path is reported as skipped, not passed. A blocked result is reported as blocked, not failed silently or replaced by a synthetic payload.

---

## 1. Unit tests

| Category | Command / scope | Result | Notes |
|---|---|---:|---|
| JavaScript unit tests | `npm test` → `node --test tests/*.test.mjs` in `web-platform/` | **526 / 526 PASS** | Covers registry/catalog, assistant gateway, BLAST submit/status/results, planner, workspace, providers, phylo contracts. |
| Python unit tests | `python-engine/tests` (pytest) | **244 / 244 PASS** | `SMARTBIO_PLUGIN_DIR_TRUSTED=1` was set because the tests ran in a temporary worktree (plugin-dir trust guard); this is an environment accommodation, not a scientific claim. |

No unit-test file was deleted or weakened in this program. The assistant gateway tests are **10/10** and include fail-closed assertions (`reply`, `message`, `choices`, `generated_text`, `usage` absent; 503 `assistant_provider_unavailable`), which prove honest unavailability, not working chat.

---

## 2. Offline / mocked browser E2E

| Category | Result | Evidence / notes |
|---|---:|---|
| Workspace E2E | **PASS** | `web-platform/tests/workspace.e2e.mjs`; M7.4/M7.5 workspace flows, operator-token derivation, metadata-only storage. |
| Phylogenetics page E2E | **PASS** | `web-platform/tests/phylo_page.e2e.mjs`; page/contract behaviour only - **not** a claim that the remote MAFFT→IQ-TREE path works. |
| UI/UX browser E2E | **10 / 10 PASS** | `web-platform/tests/uiux_browser.e2e.mjs`; captures under `web-platform/test-results/uiux/`. |
| Assistant gateway tests | **10 / 10 PASS** | `web-platform/tests/assistant.test.mjs`; see §1 note. |
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
| Deterministic plan + explicit approval + single-use consent | **PASS** | Plan step `step_1 · ncbi.blastn`, params `{"database":"16S_ribosomal_RNA","program":"blastn"}`, external egress yes, consent `external-blast`; token value intentionally not displayed. | `03-plan.png`, `04-approved.png`, `live-16s-real.json` |
| Real NCBI submission with `MOCK_NCBI=0` | **PASS (live submission)** | Real RID **`GF4KCK07016`**; confirmed on **NCBI's own status page as "Searching"**. | `05-submitted.png`, `06-status.png`, `live-16s-real.json`, `D:/DevCache/Temp/live-16s-evidence/trace.zip` |
| Resume monitoring by existing RID, no resubmission | **PASS** | Pasted RID `GF4KCK07016`; status checks continued without a new submission or new consent. | `D:/DevCache/Temp/resume-16s.json`, `D:/DevCache/Temp/live-16s-evidence/resume-trace.zip` (staging version `ed08189a-5db2-41b1-98f3-732b5c97992f`) |

**Success here means a real RID was obtained and externally confirmed. It does not mean results were retrieved.**

---

## 5. Real live retrieval (blocked)

| Check | Result | Verified detail | Evidence |
|---|---|---|---|
| `GET /api/blast/results/:rid` for real RID after compliant polling | **BLOCKED - not achieved** | With `MOCK_NCBI=0`, roughly **100 minutes** of compliant **≥60 s** status checks elapsed; the job remained **queued/searching** on NCBI. No real TSV was returned. | `D:/DevCache/Temp/live-16s-real.json` final status `queued`; `resume-16s.json`; console errors `[]` (no client-side failure) |
| Real TSV parse → table → taxonomy → provenance → downloads from live data | **NOT DEMONSTRATED** | The chain is implemented and exercised with labelled synthetic TSV, but no real result ever became available, so no real-data rendering can be claimed. | `retrieved-results.tsv` is the **mock** TSV; `07-results.png` is the labelled synthetic result |

No fabricated result was rendered. The flow's failed/error-status message is "No results were retrieved; no result is fabricated." (`public/js/16s-flow.js:394-398`), and retrieval errors say "Nothing was fabricated." (`:472-474`).

**Blocker owner:** the external NCBI service (provider queue), not the platform code. The submission, consent, polling, gate and result endpoints are implemented and staging-verified; the provider did not finish the job within the observation window.

---

## 6. Blocked / unavailable test categories

| Category | Status | Why no success count is reported |
|---|---|---|
| Real NCBI result retrieval | **BLOCKED** (§5) | External provider kept the job queued/searching; 0 real results. |
| 16S live-path E2E test | **SKIPPED** by design | Requires owner-set `LIVE_NCBI=1` and `STAGING_URL`; the live path was exercised manually instead (§4), not by that unit test. |
| AI chat with an authorized remote model | **UNAVAILABLE** | `reason:"no_enabled_llm_provider"`; `/api/assistant/chat` → 503 `generated:false`; no provider contacted. Assistant UI tests prove the fail-closed shell, not model capability. |
| Remote phylogenetics (MAFFT→IQ-TREE full path) | **PARTIAL / UNVERIFIED** | Local phylo adapters are real; remote path unverified, `production_ready:false`; no live Galaxy call was permitted. |
| R2 artifact bytes, auth B2, new providers, migrations, production deploy | **OUT OF SCOPE / INACTIVE** | Explicit program constraints; no test claims these work. |

---

## 7. Accessibility summary

From `docs/M7_4_2_ACCESSIBILITY.md` (9/9 automated E2E) and the assistant implementation:

- **Not a certification.** The review is automated offline Chromium plus token arithmetic; it makes no WCAG conformance claim and does not replace manual screen-reader, real-device, 400% zoom/reflow or expert review.
- Nine public pages: one skip link to a single `<main>`, consistent 5-item nav, wordmark/footer/favicon on all pages, universal research-use notice on all pages (including the assistant page after the D1 fix).
- Zero horizontal overflow on 9 pages × 5 viewports (1440×900, 1280×800, 768×1024, 390×844, 360×800); 45 page screenshots plus 6 footer captures.
- Zero unlabeled visible form controls; `aria-live`/`role="alert"` on status/error regions; visible focus ring on keyboard Tab; Escape closes the mobile sidebar and returns focus; `prefers-reduced-motion` collapses transitions.
- Computed contrast on key token pairs meets ≥4.5:1 text and ≥3:1 focus-ring thresholds (e.g. body text 15.69:1, unavailable banner title 5.32:1, focus ring 8.93:1). This is token-level calculation, not a full rendered-tree scan.
- Assistant honesty: banner visible, composer/send/stop disabled, zero fabricated messages, 8 activity stages `not-started`; suggested prompts do not generate. All text is rendered via DOM/text nodes, never `innerHTML`.
- Fail-closed API probe with injected secret env values: no call escaped the stub and no credential/config name or value appeared in bodies or headers.

---

## 8. Screenshots, traces and evidence paths

| Path | What it proves |
|---|---|
| `D:/DevCache/Temp/live-16s-evidence/01-input.png` … `06-status.png` | Public FASTA input, validation, plan, approval, real submission, status. |
| `D:/DevCache/Temp/live-16s-evidence/07-results.png` | Labelled **synthetic/mock** result (not a real NCBI result). |
| `D:/DevCache/Temp/live-16s-evidence/10-browser-only-statistics.png` | Browser-only real FASTA statistics (§3). |
| `D:/DevCache/Temp/live-16s-evidence/trace.zip` | Browser trace of the real submission/status run. |
| `D:/DevCache/Temp/live-16s-evidence/resume-trace.zip` | Browser trace of resume-by-RID without resubmission. |
| `D:/DevCache/Temp/live-16s-evidence/browser-only-trace.zip` | Browser trace of the browser-only statistics run. |
| `D:/DevCache/Temp/live-16s-evidence/retrieved-results.tsv` | **Mock** TSV with `MOCK DATA` marker - synthetic evidence only. |
| `D:/DevCache/Temp/live-16s-real.json` | Stage-by-stage live record; final status `queued`; RID `GF4KCK07016`; no console errors. |
| `D:/DevCache/Temp/resume-16s.json` | Resume-by-RID poll history for `GF4KCK07016`. |
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
| Real NCBI submission (live) | **PASS** - RID `GF4KCK07016`, externally confirmed "Searching" |
| Real NCBI result retrieval (live) | **BLOCKED** - provider queue, 0 real results |
| AI chat with remote model | **UNAVAILABLE** - no authorized provider |

**There is no combined "X/Y passed" number across these rows.** Mocked passes, UI passes, browser-only real computation, real live submission and blocked live retrieval describe different claims and must be read separately.
