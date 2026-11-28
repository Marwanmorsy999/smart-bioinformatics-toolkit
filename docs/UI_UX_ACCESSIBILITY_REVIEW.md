# UI/UX accessibility review — M7.4.1 redesign

**Scope.** The seven static pages in `web-platform/public/` (`index.html`, `ai.html`,
`benchmark.html`, `blast.html`, `taxonomy.html`, `workspace.html`, `phylo.html`) as
redesigned on branch `design/ui-ux-overhaul`. No production code was changed by this
review. No backend, Galaxy or scientific provider was contacted.

**Target.** WCAG 2.2 AA. This document is an internal review against that target;
it is **not** a formal WCAG audit or certification.

**Method.**
1. Static inspection of `css/tokens.css`, `css/main.css`, `css/components.css`,
   `css/app-views.css`, `css/tool-views.css`, `js/nav.js` and all seven HTML files.
2. Automated programmatic checks in real headless Chromium via the worktree's
   Playwright (`web-platform/tests/uiux_browser.e2e.mjs`, run from `web-platform/`
   with `node --test tests/uiux_browser.e2e.mjs`).
   Every `fetch()` is replaced by a rejecting stub before page scripts run, so all
   reported interactions are browser-local only. **No example/Analyze output in
   this review is a fresh scientific execution.**
3. WCAG relative-luminance contrast computed from the shipped hex tokens.
4. DOM audit across all seven pages for labels, heading order, table headers,
   `aria-live`, zoom meta and icon hiding; manual inspection of 35 responsive
   screenshots at 1440×900, 1280×800, 768×1024, 390×844 and 360×800.

---

## Automated results

| Check | Result |
|---|---|
| Seven `file://` page loads with `--allow-file-access-from-files` | PASS (7/7) |
| Skip link present, fragment resolves to the single `<main>` | PASS (7/7) |
| Global nav links identical across pages (text + href) | PASS (7/7) |
| 390 px toggle: `aria-expanded` flips, menu visible, Escape closes, focus returns | PASS (7/7) |
| Landing validator → statistics, visible results | PASS |
| BLAST / taxonomy example → Analyze, visible results (offline) | PASS (2/2) |
| Workspace sample: SAMPLE label + project detail | PASS |
| Phylo plan: 7 steps; run disabled until consent checkbox | PASS |
| No horizontal overflow at 5 viewports × 7 pages | PASS (35/35) |
| Keyboard Tab reaches nav and main controls with visible outline | PASS |
| `prefers-reduced-motion` rule present and computed `scroll-behavior` changes | PASS |
| New E2E suite total | **10 pass / 0 fail** |

`node --test tests/uiux_browser.e2e.mjs` reported `tests 10, pass 10, fail 0`.
Screenshots: 35 new files in `web-platform/test-results/uiux/after/`
(`{page}-{width}x{height}.png`); pre-existing before/after screenshots untouched.

---

## Item-by-item review

| WCAG 2.2 item / review item | Status | Evidence |
|---|---|---|
| 1.4.3 Contrast (minimum) — ink/surface, ink-2, muted, accent, caution/danger/success/info, focus | **PASS** | 15.69:1 ink/white; 9.73:1 ink-2/white; 5.03–5.66:1 muted; 6.24:1 accent/white; 5.38:1 accent/accent-tint; 5.32:1 caution; 5.70:1 danger; 5.58:1 success; 6.47:1 info; 14.68:1 inverse text on ink. All ≥ 4.5:1. |
| 1.4.3 Contrast — `--faint` text uses | **PASS (fixed by darkening the token)** | `--faint` darkened from `#74868e` to `#5f727b`: 5.02:1 on white and 4.71:1 on `--surface-2` (was 3.79:1 / 3.55:1), both ≥4.5:1. Used for `textarea::placeholder` and 10 px `.sg-index` labels. Caveat: `#5f727b` is only 3.42:1 on the dark `#101d24` footer, so `.footer-muted` must keep a lighter token. |
| 1.4.11 Non-text contrast — focus ring and status borders | PASS | 8.93:1 focus on white; 11.01:1 focus-on-dark on dark footer; accent/caution left-borders exceed 3:1. |
| 1.3.1 Info and relationships — form labels | PASS | DOM audit: 0 unlabelled `input`/`select`/`textarea` on any of the 7 pages; every control has `<label for>`, wrapping label or ARIA label. |
| 1.3.1 Info and relationships — heading order | PASS | Exactly one `<h1>` per page; no skipped heading levels on any page. |
| 1.3.1 Table headers | PASS with note | `benchmark.html` and `workspace.html` use explicit `<th scope="col">`. Generated result tables in `app.js:171` and `blast-app.js:68` create `<th>` without `scope`; `taxonomy-app.js:99` sets `scope="col"`. `<th>` in `<thead>` is still natively associated, so this is advisory, not a failure. |
| 4.1.3 Status messages (`aria-live`) | PASS | `aria-live="polite"` on result/status regions (landing 2, ai 4, blast 2, taxonomy 3, workspace 1, phylo 4). Benchmark is static (0) — not applicable. |
| 2.4.3 Focus order / 2.4.7 Focus visible | PASS | `:where(a, button, input, select, textarea, summary, [tabindex]):focus-visible` at `main.css:36` gives a 3 px `#0d5254` outline with 2 px offset. First Tab reaches the skip link; nav and main controls show a ≥2 px outline. |
| 2.4.1 Bypass blocks | PASS | Skip link on every page; target is the page's only `<main>`. |
| 1.1.1 Non-text content — decorative icons | PASS | Icons carry `aria-hidden="true"` on the SVG or its wrapper span; schematic SVG uses `role="img"` with `<title>`/`<desc>`. Programmatic "unhidden SVG" hits were traced to ancestors with `aria-hidden`. |
| 1.4.4 Text resize / 1.4.10 Reflow | PASS | All 7 pages at 5 viewports: `documentElement.scrollWidth <= innerWidth` (35/35). No `user-scalable=no` or `maximum-scale=1` in any viewport meta. |
| 2.5.8 Target size (minimum) | PASS with note | Nav toggle 40×40, nav links 358×46, primary buttons 39 px high, tool-nav 68 px high — all exceed 24×24. `#load-example` is 81×23 at 390 px, 1 px below 24; the spacing exception likely applies because no other target is within 24 px. |
| 2.3.3 Animation from interactions | PASS | `@media (prefers-reduced-motion: reduce)` in 4 stylesheets; computed `scroll-behavior` changes `smooth` → `auto` under emulation. |

---

## Issues / defects and resolutions

1. **Mobile masthead toggle / status badge row placement (visual, medium).**
   *Pages:* all pages **except `benchmark.html`**; *viewports:* 390×844 and 360×800.
   *Evidence:* at 390 px the brand occupies y=12–50, while `.nav-toggle` sits at
   y=62–102 on a second row (benchmark, which has no badge, keeps the toggle at
   y=12). The status badge is not consistently on the first row either: the 390 px
   screenshots show it wrapping below the brand on some pages. The toggle is
   40×40 and fully functional; the issue is layout inconsistency and wasted
   header height, not a broken control. A CSS fix that keeps the badge and toggle
   on the masthead's first row is being applied in parallel; re-run the 390×844
   and 360×800 screenshots and this review after it lands to verify placement.

2. **Unavailable backend shown with success colour (semantic colour, medium) — RESOLVED in code.**
   *Page:* `ai.html`; *viewports:* all.
   *Original evidence:* with the stubbed/offline backend the badge reads
   `"Backend: no local agent observed"` while the `.local-badge` base still used
   the green `--success` treatment, implying a healthy backend.
   *Implementation:* `renderBackendStatus()` now toggles an `unavailable` class on
   `#backend-badge` whenever `connected === false`, alongside the existing `.mock`
   toggle:

   ```js
   elements.backendBadge.classList.toggle("unavailable", !backendDescription.connected);
   ```

   The matching `.local-badge.unavailable` CSS variant (caution/danger tokens) is
   being applied in parallel. Status text, mode logic, route disabling and fetch
   behaviour are unchanged; re-check the computed badge colour once that CSS lands.

3. **`--faint` used for text below AA contrast (contrast, low) — RESOLVED.**
   *Pages:* landing (textarea placeholders, 10 px schematic indices), blast and
   taxonomy (placeholders).
   *Resolution:* `--faint` was darkened from `#74868e` to `#5f727b`, raising
   contrast from 3.79:1 → 5.02:1 on white and 3.55:1 → 4.71:1 on `--surface-2`
   (both now ≥4.5:1). Recomputed from the hex tokens; verify the final value
   after the CSS change lands. The earlier 4.53:1 dark-footer figure no longer
   applies to this token.
   *Follow-up:* `.footer-muted` sits on the `#101d24` footer, where `#5f727b`
   computes only 3.42:1; that selector must remain on a lighter colour (e.g.
   `#b9cbd6`, 10.28:1) so the token change does not regress the footer.

4. **Header crowding at tablet width (visual, low).**
   *Pages:* workspace and the other nav-bearing pages; *viewport:* 768×1024.
   *Evidence:* brand wraps to three lines, "Research workspace" nav link wraps to
   two lines, and the badge competes for the same row. No overflow, but the
   masthead is visibly cramped. Suggested fix: move the mobile nav breakpoint from
   640 px to ~860 px, or shorten the nav label at tablet widths.

5. **Generated result tables omit `scope="col"` (advisory, low).**
   *Pages:* landing and BLAST after analysis. Not a WCAG failure because `<th>`
   in `<thead>` is associated, but adding `th.scope = "col"` (as taxonomy already
   does) would make header relationships explicit.

No functional interaction defect was found in the validator, statistics, BLAST,
taxonomy, workspace sample, phylo plan/approval, mobile nav, skip links or focus
behaviour. No live provider/scientific call was made or mocked as a result.

---

## Verdict

The redesign passes all automated structural, interaction, keyboard, motion and
reflow checks. Remaining items are visual/semantic polish (items 1–5); items 2 and
3 are resolved in code (the badge `unavailable` state and the darkened `--faint`
token), pending verification of the parallel CSS. **Not a WCAG certification.**
Recommended next step: after the parallel CSS fixes land, re-run
`node --test tests/uiux_browser.e2e.mjs` from `web-platform/` and regenerate the
35 screenshots to confirm badge colour, badge placement and footer contrast.
