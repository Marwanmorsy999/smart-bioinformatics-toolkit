# M7.4.2 — UI/UX, accessibility and honesty validation (tester report)

**Status:** Validation report only. No implementation file, package.json, commit or deployment was changed by this pass. No authorized LLM provider was contacted and no mocked reply is treated as evidence of a working AI feature.

**IMPORTANT — not a certification.** This is an automated, offline Chromium/Playwright review of static pages plus token arithmetic. It is **not** a WCAG audit or certification, makes **no claim of WCAG conformance**, and does not replace manual screen-reader testing, real-device testing, zoom/reflow testing at 400%, or an independent accessibility expert review. "Pass" below means the specific automated check passed in this environment, nothing more.

## Method

- Worktree: `D:\DevCache\Temp\uiux-polish`, branch `design/brand-assistant-polish`.
- Real Chromium via Playwright, launched with `--allow-file-access-from-files`; all nine public pages loaded with `file://`.
- `fetch()` was replaced before any page script ran. The two `/api/assistant/*` stubs were generated from the **real** gateway handlers (`onStatus`, `onChat`) imported from `functions/api/assistant/index.js`: status 200 with `available:false, reason:no_enabled_llm_provider`; chat 503 with `type:assistant_provider_unavailable` and no `reply`. Everything else was rejected offline.
- New test: `web-platform/tests/m7_4_2_browser.e2e.mjs` (9 checks). The initial 7/2 run contained one real product defect (D1, now fixed by a separate worker) and one **test expectation error** (D2, corrected — see below). Final run: **9 pass / 0 fail**.
- API probes used the real unit handlers with secret-bearing env vars present.

## Result summary

| Item | Check | Result | Evidence |
|---|---|---|---|
| 1 | Nine pages exist and load from `file://`; every title contains "Smart Bioinformatics AI" | **PASS** | E2E (1) |
| 2 | One skip link targeting a single `<main>` on each page | **PASS** | E2E (1); DOM probe (`h1=1`, skip link present on all 9) |
| 3 | Exactly five nav items in the same order on all nine pages: Tools / Research workspace / Phylogenetics / Assistant / About | **PASS** | E2E (1) |
| 4 | Header wordmark `alt="Smart Bioinformatics AI"`, footer lockup, favicon link on all nine pages; all local SVG images `naturalWidth > 0` including `favicon.svg` | **PASS** | E2E (1), (5) |
| 5 | Footer Level-B short notice + "Full research-use statement" link on **all nine** pages | **PASS** | E2E (1) passes after the separate worker added `.site-footer` to `assistant.html`. See "D1 — resolved" below. |
| 6 | `research-use.html` contains the **exact** Level-A statement supplied in the mission brief | **PASS** (after expectation correction) | E2E (2) now compares against the mission text verbatim at `research-use.html:43`. See "D2 — reclassified" below. |
| 7 | Phylo hero/meta contain no completed MAFFT→IQ-TREE execution claim and no "full provenance" hero claim; results remain hidden with an empty status line | **PASS** | E2E (3) |
| 8 | Assistant banner visible and honest; composer textarea/send/stop disabled; zero fabricated messages; 8 activity stages all `not-started`; suggested prompts do not send or generate | **PASS** | E2E (4) |
| 9 | Zero horizontal overflow on 9 pages × 5 viewports (1440×900, 1280×800, 768×1024, 390×844, 360×800) | **PASS** | E2E (6), 45 page screenshots |
| 10 | Programmatic labels on all visible form controls (`label[for]`, `aria-label` or `aria-labelledby`) | **PASS** | DOM probe: 0 unlabeled visible controls across 9 pages (assistant composer label = "Message S Bio Assistant") |
| 11 | `aria-live` / `role="alert"` on status and error regions | **PASS** | DOM probe + E2E (4): assistant banner `role=status, aria-live=polite`, message list `polite`, conversation list `polite`, error `role=alert, aria-live=assertive` |
| 12 | Keyboard Tab reaches skip link, nav and main controls with a visible focus ring (`outline-style != none`, width ≥ 2px) | **PASS** | E2E (7); `:focus-visible` rule present in every page's loaded stylesheets |
| 13 | Mobile (390px) sidebar opens with Enter, closes with Escape, focus returns to toggle; keyboard-driven "New conversation" works; composer stays disabled | **PASS** | E2E (7) |
| 14 | `prefers-reduced-motion: reduce` collapses `scroll-behavior` to `auto` and assistant transitions to `0s` | **PASS** | E2E (7) |
| 15 | Contrast on key token/assistant banner pairs meets ≥4.5:1 text and ≥3:1 focus-ring thresholds | **PASS** | E2E (8), table below |
| 16 | SVG assets with `aria-hidden="true"` on decorative icons | **PASS (advisory resolved)** | All purely decorative inline SVGs across the eight pages now carry `aria-hidden="true"`; the informative schematic retains `role="img"` with title/description and logo images retain `alt`. |
| 17 | API fail-closed: status 200 `available:false` / `no_enabled_llm_provider`; chat 503 `assistant_provider_unavailable`, no `reply`/`message`/`choices`/`generated_text`/`usage`; no credential or config leakage | **PASS** | `tests/assistant.test.mjs` (10/10) + direct handler probe |
| 18 | No live provider call escaped the offline stub; no browser page errors | **PASS** | E2E (9) |

## Text contrast (computed, not estimated)

Ratios are WCAG relative-luminance ratios computed in E2E (8) from `web-platform/public/css/tokens.css` tokens and the literal footer colours in `components.css`.

| Pair | Foreground / background | Ratio | Threshold | Result |
|---|---|---:|---:|---|
| Body text / work surface | `--ink` `#16252e` / `--surface` `#ffffff` | 15.69:1 | 4.5 | PASS |
| Supporting copy / page canvas | `--muted` `#566a74` / `--doc-bg` `#eef2f4` | 5.03:1 | 4.5 | PASS |
| Stage labels / inset surface | `--faint` `#5f727b` / `--surface-2` `#f5f8f9` | 4.71:1 | 4.5 | PASS |
| Accent / surface | `--accent` `#176b6e` / `--surface` | 6.24:1 | 4.5 | PASS |
| Unavailable banner title | `--caution` `#8a5a12` / `--caution-bg` `#fbf2e2` | 5.32:1 | 4.5 | PASS |
| Unavailable banner detail | `--ink-2` `#334750` / `--caution-bg` | 8.76:1 | 4.5 | PASS |
| Unavailable banner link | `--accent-strong` `#0d5254` / `--caution-bg` | 8.04:1 | 4.5 | PASS |
| Error text / error background | `--danger` `#a23b31` / `--danger-bg` `#fbecea` | 5.70:1 | 4.5 | PASS |
| Focus ring / light surface | `--focus` `#0d5254` / `--surface` | 8.93:1 | 3 | PASS |
| Footer body / navy | `#dce8ee` / `--navy-deep` `#101d24` | 13.75:1 | 4.5 | PASS |
| Footer dim text / navy | `#b9cbd6` / `#101d24` | 10.28:1 | 4.5 | PASS |
| Footer links / navy | `#bfe6dd` / `#101d24` | 12.73:1 | 4.5 | PASS |
| Footer bottom line / navy | `#94acba` / `#101d24` | 7.25:1 | 4.5 | PASS |

These are token-level calculations. They do not verify every rendered text/background combination (e.g. text over images or gradients), and no automated tool was used to scan the rendered tree for all combinations.

## API evidence (real handlers, no provider contacted)

With `NINEROUTER_ENABLED=true`, a secret URL/key and `AI_AGENT_TOKEN` present in env, and a `FETCH_IMPL` that throws if called:

- `GET /api/assistant/status` → `200`, `{available:false, reason:"no_enabled_llm_provider", type:"assistant_provider_unavailable", execution_mode:"real"}`, 8 stages all `not_started`.
- `POST /api/assistant/chat` → `503`, `{type:"assistant_provider_unavailable", reason:"no_enabled_llm_provider", available:false}`; `reply`, `message`, `choices`, `generated_text` and `usage` are all absent.
- None of the injected secret values or configuration names appeared in status/chat bodies or headers.

This is fail-closed behaviour. It is **not** evidence that chat works with a real model.

## Screenshot evidence

All captures are under `web-platform/test-results/uiux/m742/`:

- 45 page screenshots: 9 pages × 5 viewports (`<page>-<width>x<height>.png`), including new landing, assistant and research-use pages.
- 6 footer element captures: `footer-index-1440x900.png`, `footer-index-390x844.png`, `footer-research-use-1440x900.png`, `footer-research-use-390x844.png`, `footer-assistant-1440x900.png`, `footer-assistant-390x844.png` (the last two added after D1 was fixed).
- `before/` holds eight M7.4.1 baseline captures copied verbatim from git history at `ff37b9b:docs/uiux-screenshots/before/` (`landing-1440/390`, `phylo-1440/390`, `workspace-1440/390`, `ai-1440`, `benchmark-1440`). The M7.4.1 working tree retains only the `after/` set; the original `before/` files are not present at HEAD, hence the explicit historical source.

## Defects

### D1 — RESOLVED: assistant page had no footer / Level-B notice
- **Reproduce:** load `file:///.../public/assistant.html` at any viewport; run E2E test (1). `document.querySelector('.site-footer')` is `null`; `.footer-disclaimer` text is empty and its policy link is absent.
- **Expected:** the same one-line notice ("Research and educational use only. Results require independent scientific interpretation.") and "Full research-use statement" → `research-use.html` link that exists on the other eight pages.
- **Why it matters:** the assistant page is the only page that discusses what AI does not do, yet it is the only page missing the universal scope notice and the route to the full policy. `docs/DESIGN_SYSTEM.md` §8 requires "One `.site-footer` structure everywhere".
- **Resolution:** a separate worker added the standard `.site-footer` block to `assistant.html` (dark lockup, link columns, short notice + policy link; verified at lines ~183-195). E2E (1) and (6) now pass, including two new assistant footer screenshots. No implementation change was made by this tester.

### D2 — RETRACTED: test expectation error, not a product defect
- **Original finding:** E2E (2) compared `research-use.html:43` against the differently worded sentence in `docs/PRODUCT_COPY_AUDIT.md` §2.1/§5.5 and reported a mismatch.
- **Correction:** the **source of truth is the M7.4.2 mission brief**, not the audit document. The mission supplies the full policy text verbatim, and `web-platform/public/research-use.html:43` already contains it exactly. The audit's "canonical Level A statement" ("Research-use disclaimer. This toolkit produces screening evidence for research and teaching. …") is a superseded paraphrase; `docs/PRODUCT_COPY_AUDIT.md` has been updated to record this (§0.2 and §2.1).
- **Action taken:** assertion (2) in `web-platform/tests/m7_4_2_browser.e2e.mjs` now checks the exact mission sentence. No change was needed to `research-use.html` or any implementation file.
- **Status:** closed — expectation error only.

### Advisory A1 — Decorative SVG icons — RESOLVED
- All purely decorative inline SVGs on index, workspace, ai, phylo, blast, taxonomy, benchmark and research-use now carry `aria-hidden="true"` (14 added in the final pass; 29 marked in total). The informative schematic keeps `role="img"` plus `<title>`/`<desc>`, and logo/avatar `<img>` elements keep their `alt` text. No functional regression; `npm test` remained 515/515.

## Non-findings (verified honest)

- The `<summary>Full provenance</summary>` on the phylo page is inside the hidden, job-conditional `#phylo-results` section; it is not a hero claim and is not shown without a real job.
- The assistant status stub is consumed exactly once, sets the banner reason to `no_enabled_llm_provider`, and no chat request is made. A suggested prompt only fills the disabled composer.
- `GET /api/assistant/status` and `POST /api/assistant/chat` are explicitly routed before the catch-all and preserve same-origin CORS.

## Verdict

**READY FOR STAGING.** D1 was fixed (assistant footer) and D2 was a retracted test expectation error (the exact mission statement is present at `research-use.html:43`; the audit's paraphrase is superseded). Advisory A1 was resolved in the final pass. Final `node --test tests/m7_4_2_browser.e2e.mjs`: **9 pass / 0 fail**. All functional, responsive, keyboard, reduced-motion, contrast, asset-loading and API fail-closed checks pass. This verdict is not a WCAG certification or a claim that AI chat works; no authorized provider was contacted.
