# UI/UX Audit — M7.4.1 Redesign Baseline

**Date:** 2026-11-26  
**Status:** BEFORE snapshot / read-only audit. No HTML, CSS or JS was edited as part of this audit.

---

## 1. Scope, baseline and method

### 1.1 Scope and baseline

| Item | Value |
| --- | --- |
| Purpose | Evidence baseline for the M7.4.1 UI/UX redesign. Identify concrete defects in the current app so the redesign has an explicit list to fix. |
| Worktree | `D:\DevCache\Temp\uiux-overhaul` |
| Branch | `design/ui-ux-overhaul` |
| Baseline commit | `f0ecc69` (verified: `f0ecc698b5124e7d53a99cd37a560c1e95f0802a`) |
| Staging URL | `https://smart-bioinformatics-toolkit-staging.m-2396.workers.dev/` |
| Canonical staging routes | `/`, `/workspace`, `/ai`, `/phylo`, `/blast`, `/taxonomy`, `/benchmark` (the `*.html` aliases redirect to these clean routes; all returned HTTP 200) |
| Screenshots | `web-platform/test-results/uiux/before/` in the worktree |

**Note on worktree state:** at audit time the working tree contained uncommitted, concurrent redesign edits (modified HTML/CSS plus untracked `docs/DESIGN_SYSTEM.md`, `css/tokens.css`, `js/nav.js`). Those edits were **not made by this audit** and were not touched. All findings below are against the **staging baseline** (commit `f0ecc69`), with source structure cross-checked against `git show HEAD:web-platform/public/...`. Do not treat the current working copy as the baseline.

### 1.2 Method

1. **Static reading** of all seven HTML files in `web-platform/public/` plus `css/main.css`, `css/components.css` and `css/benchmark.css` (baseline content).
2. **Repeatable screenshots** with Playwright from the worktree's `web-platform/node_modules` junction, headless Chromium:
   - viewport `1440 × 900`, `fullPage: true`, 1200 ms settle after load;
   - viewport `390 × 844` for the three mobile captures;
   - capture script kept **outside the repo** at `D:\DevCache\Temp\capture-uiux-before.cjs`;
   - run log at `D:\DevCache\Temp\uiux-capture-log.json` (also outside the repo).
3. **DOM measurements** with a second temporary script (`D:\DevCache\Temp\measure-uiux.cjs`) at both widths: nav link counts, active-nav counts, nav horizontal overflow, document overflow, footer class, count of unstyled buttons, heading sizes, and mojibake detection.
4. **Live inspection** with the in-app browser skill: accessibility snapshots, exact rendered text, console errors (none on the landing page).
5. **External research** on scientific-software and design-system sources (Section 5), all accessed 2026-11-26.

### 1.3 Explicit non-execution statement

Only public, read-only **GET** requests were made. **No scientific execution, no analysis submission, no provider/Galaxy job, no file upload, no form submission and no data mutation was performed.** No control on any page was clicked as part of capture. Opening `/ai` does cause the application's own backend-availability GET (observed in the page text: "Backend not connected — heavy analyses unavailable; browser-local tools still work."); that is a status check by the page itself, not an analysis or a provider call. Research sources were fetched as documentation only.

### 1.4 Screenshots actually captured

| File | Route | Viewport | Document size | HTTP | Result |
| --- | --- | --- | --- | --- | --- |
| `landing-1440.png` | `/` | 1440×900 | 1440×3708 | 200 | OK |
| `workspace-1440.png` | `/workspace.html` | 1440×900 | 1440×1226 | 200 | OK |
| `ai-1440.png` | `/ai.html` | 1440×900 | 1440×3208 | 200 | OK |
| `phylo-1440.png` | `/phylo.html` | 1440×900 | 1440×900 | 200 | OK |
| `blast-1440.png` | `/blast.html` | 1440×900 | 1440×1057 | 200 | OK |
| `taxonomy-1440.png` | `/taxonomy.html` | 1440×900 | 1440×1406 | 200 | OK |
| `benchmark-1440.png` | `/benchmark.html` | 1440×900 | 1440×1267 | 200 | OK |
| `landing-390.png` | `/` | 390×844 | 390×7120 | 200 | OK |
| `workspace-390.png` | `/workspace.html` | 390×844 | 390×1398 | 200 | OK |
| `phylo-390.png` | `/phylo.html` | 390×844 | 390×844 | 200 | OK |

All requested captures succeeded; no page failed to load. Note that `phylo-1440.png` and `phylo-390.png` are viewport-height captures because the baseline page is shorter than the viewport after its hidden steps.

---

## 2. Complete page inventory

| Local file | Canonical staging route | Purpose | Shell / styles / scripts |
| --- | --- | --- | --- |
| `index.html` | `/` | Marketing-led landing page **and** the FASTA validator / statistics tool, capability cards and workflow explainer | `main.css` + `components.css`; `js/app.js`; dark `.site-footer`; 6 top-nav links; skip link |
| `workspace.html` | `/workspace` | Project metadata, dataset registry (metadata only), workflow catalog, run history, sample project | `main.css` + `components.css`; `js/workspace.js`; **no footer**; 5 top-nav links; skip link |
| `ai.html` | `/ai` | Plan → approve → execute → validate AI workspace; browser-local route and local-agent route; provider transparency | `main.css` + `components.css`; `js/project-context.js`, `js/ai-workspace.js`, `js/cloud-providers.js`; dark `.site-footer`; 5 links; skip link |
| `phylo.html` | `/phylo` | Galaxy multi-step workflow: multi-FASTA upload → plan approval → job progress → tree + provenance | `main.css` + `components.css`; `js/project-context.js`, `js/phylo.js`; **no footer**; 4 links; skip link |
| `blast.html` | `/blast` | Local BLAST TSV schema inference, filtering, ranking and export | `main.css` **only**; `js/project-context.js`, `js/blast-app.js`; thin `.footer`; 4 links; skip link |
| `taxonomy.html` | `/taxonomy` | Local taxonomic consensus from BLAST hits, with uncertainty reporting | `main.css` **only**; `js/taxonomy-app.js`; thin `.footer`; 3 links; skip link |
| `benchmark.html` | `/benchmark` | Synthetic risk-coverage chart and table; explicitly not a performance measurement | `main.css` + `benchmark.css`; `js/benchmark-app.js`; **no footer, no badge, no skip link**; 3 links |

**Shared across all seven:** `css/main.css`, the `.topbar` header with `.brand`, `.top-nav` and `.local-badge`, and `.section-block`.  
**Shared across most:** `.workspace`, `.workspace-header`, `.results-panel`, `.summary-grid`, `.table-wrap`, `.workflow-strip`, `.info-card`, `.state-pill` and the same design tokens (`--navy`, `--teal`, `--canvas`, spacing scale).  
**Not shared:** the footer (three variants), the nav link set (6/5/5/4/4/3/3 links), the active-nav indicator (present on 4 pages, absent on 3), and the tool form primitives (`.field-group` is used on 5 pages and **not at all** on `/phylo` or `/benchmark`).

---

## 3. Per-page findings

Findings are labelled by the requested dimensions. Screenshot filenames are cited so each claim can be re-checked.

### 3.1 Landing — `landing-1440.png`, `landing-390.png`

- **Visual hierarchy:** H1, two stacked caveat banners, six capability cards, a full interactive tool form, a four-stage workflow strip, an "about" strip and a large dark footer all compete for attention. The actual primary action (the validator form) is roughly two viewport-heights below the hero. The hero illustration occupies a small card inside a large empty right-hand column.
- **Typography:** H1 is 48px at 1440 and 36px at 390 (measured). Eyebrows are 0.72rem uppercase with wide letter-spacing; much of the helper copy is 0.72–0.75rem (~11–12px), which is too small for sustained reading of scientific caveats.
- **Navigation:** Six top links mix in-page anchors (`Tools`, `Capabilities`, `How it works`, `About`) with page links (`Phylogenetics`, `Research workspace`) with no visual distinction. Other pages show 3–5 links, so the nav shifts underfoot.
- **Layout:** `278px` sidebar plus form at 1440; at 390 everything becomes one column and the page reaches **7,120px**.
- **Spacing:** ~72px section padding is consistent but generous; the two caveat banners are adjacent with near-identical weight, so neither reads as dominant.
- **Colour:** Teal/navy is restrained, but a green success badge labelled "Browser processing" attaches a success colour to a neutral privacy statement.
- **Alignment:** The hero art card is rotated −1.5°, a decorative device that sits oddly with a research tool; CTA row is left-aligned while the art is centred.
- **Component consistency:** `.primary-link` is used for the hero CTA while other pages use `.primary-button`. Tool items 01/02 are `<button>` (in-page switching) and 03–05 are `<a>` (navigation), but they are visually identical.
- **Form usability:** Explicit sequence-type selection with "the tool will not guess" is good. However file upload *and* paste are both offered with no clear default, there is no drag-and-drop, and the only character count is passive text.
- **Data presentation:** Results panel is hidden at baseline; the four-column summary grid and results table are never demonstrated. The "Nothing calculated yet" empty state sits **below** the form rather than inside it.
- **Feedback/loading:** `aria-live="polite"` is present on results; there is no visible loading treatment. The empty state is the only baseline feedback.
- **Responsive behaviour:** At 390 the top nav overflows by **65px** (measured) and the last link is clipped; hero art is hidden entirely at ≤640px, leaving a text-only hero; 7,120px of uninterrupted single column.
- **Accessibility:** Skip link, logical h1→h2→h3→h4 order, `:focus-visible` ring and `aria-hidden` on decorative art are present. In-page anchors have no `scroll-margin-top`, so the sticky header can cover targets; muted helper text needs a contrast check.
- **Content clarity:** Heading **"Four ways to examine your data"** sits above **six** capability cards. Footer says "Milestone 0.5.0" while BLAST and Taxonomy say "0.1.0".

### 3.2 Research workspace — `workspace-1440.png`, `workspace-390.png`

- **Visual hierarchy:** No single focal point. Mode banner → Access mode → Create-project form → project list → sample project, all in one column with no section navigation and no footer, despite this being the densest data page.
- **Typography:** 48px H1, 32px section headings, 0.75rem helper text. The banner paragraph wraps to eight lines at 390.
- **Navigation:** Five top links with a correct active state, but no in-page navigation for six major sections; no footer escape route.
- **Layout:** Forms stretch to nearly the full 1080px content width — the "Project name" input is ~1070px wide at 1440 and still full-width at 390, which is poor for short values. Run history uses an 8-column table in a scroll container.
- **Spacing:** All headings have `margin: 0` globally, so "Projects", "Project list" and "Sample project (precomputed — not executed)" visually collide with the cards above them in **both** screenshots. There is no reliable vertical rhythm between sections.
- **Colour:** Every card uses the same teal left border (`.info-card`, `.ws-form`, mode banner), so the accent no longer signals anything; the "metadata only" warning is bold but visually equal to ordinary notes.
- **Alignment:** "Clear local sample/session" is orphaned below the Create-project card; status text and badges do not share a consistent alignment line.
- **Component consistency:** **Eight native, unstyled buttons** (`ws-operator-enable`, `ws-operator-disable`, `ws-project-create`, `ws-local-clear`, `ws-edit-save`, `ws-archive`, `ws-dataset-register`, `ws-demo-load`) render as tiny browser-default controls (measured; visible in both screenshots) beside styled cards. This is the most jarring inconsistency in the app.
- **Form usability:** 17 `.field-group`s. The SHA-256 field requires 64 manually typed hex characters with no file-based computation or inline feedback. Size/format/source have no units or examples. The high-stakes "Operator token" control is buried in a collapsed `<details>` behind a long warning.
- **Data presentation:** Project list and registered datasets are plain `<ul>`s even though they hold structured metadata; the 11-state legend is hidden in `<details>`; the 8-column run-history table is empty at baseline with no sample row or caption.
- **Feedback/loading:** `#ws-status` and the mode label exist; no skeleton/loading pattern is described. "Clear local sample/session" and "Archive project" have no confirmation step.
- **Responsive behaviour:** At 390 the nav wraps and overflows slightly (6px measured); inputs stack but remain stretched; heading collisions are more obvious; no footer.
- **Accessibility:** Skip link, `role="status"` and keyboard-reachable `<details>` are present, but the unstyled buttons are very small targets and there is no visible grouping of form sections.
- **Content clarity:** The mode banner combines "not persisted to the server" and "operators can use the authenticated API" in one dense sentence. The dev-only "Sample project (precomputed — not executed)" heading dominates the page.

### 3.3 AI workspace — `ai-1440.png` (no mobile screenshot requested; see §7)

- **Visual hierarchy:** Long lede → caveat strip → four-stage strip (duplicated from landing) → cloud-services panel → Step 1 request form → 2×2 output guide → footer. At 1440 the working form begins roughly 800px down the page.
- **Typography:** Dense 0.75–0.8125rem body copy. The eyebrow renders as mojibake: **"PLAN Â†’ APPROVE Â†’ EXECUTE Â†’ VALIDATE Â†’ EXPLAIN"** (verified in rendered text).
- **Navigation:** Five links with active state; no in-page navigation across the three steps. The header badge reads "Backend not connected — heavy analyses unavailable; browser-local tools still work." in **green** success styling while conveying a limitation.
- **Layout:** Single-column request form; example prompts, two input-grid fields, sequence type and a six-row textarea stacked vertically. Three badges (`stage-tag`, `plan-confidence`, `execution-mode`) share one header row.
- **Spacing:** The warning strip, backend status line, route-availability note and helper text all repeat nearby guidance, creating a wall of caveats with no prioritisation.
- **Colour:** Success tokens on `badge-mode` / `backend-status.available` and warning tokens on unavailable states are defined, but neutral, warning and success states are too similar in weight.
- **Alignment:** Header badges float right; the "Check cloud services" button sits opposite a long paragraph and wraps awkwardly at 1440.
- **Component consistency:** Reuses `.workflow-strip`, `.workspace` and `.info-card`, but adds `provider-workspace`, `step-list`, `consent-box` and `download-links` variations with no single shared action-button hierarchy.
- **Form usability:** The 10,000-character and 64 KiB limits are stated **three times** (lede, Step 1 description, file helper). `execution-route` is a select that changes behaviour and gating but sits below the question textarea; the primary label changes to "Analyze locally" without a preview of the actual plan before submission (the plan panel is hidden).
- **Data presentation:** All result boxes (summary, validation, findings, limitations, artifacts, education, locality) are hidden at baseline; the guide cards describe states but show no example.
- **Feedback/loading:** Multiple `aria-live` regions and `role="status"` elements. Backend availability is checked on load; cloud services show "not checked yet" behind a manual button. No spinner or skeleton is defined.
- **Responsive behaviour:** At 390 the nav overflows by 3px (measured) and CSS collapses `.ai-flow .workspace-header` to a column; no screenshot was requested for this width.
- **Accessibility:** Skip link, `sr-only` workflow heading, `aria-describedby` on key fields and a labelled consent checkbox are present.
- **Content clarity:** "No backend means a blocked request, never a simulated result" — an important safety statement — is buried mid-paragraph in the lede.

### 3.4 Phylogenetics — `phylo-1440.png`, `phylo-390.png`

- **Visual hierarchy:** After H1 and caveat strip only "1. Provide a multi-FASTA dataset" is visible. Steps 2–4 are hidden, leaving more than half the viewport empty at 1440 and roughly the bottom quarter empty at 390.
- **Typography:** H1 is 48px (36px at 390) and wraps to three lines at 390. The kicker renders as mojibake: **"M7.3 â€” the first cloud workflow: MAFFT alignment â†’ IQ-TREE tree…"**.
- **Navigation:** Four links with active state; no footer.
- **Layout — critical defect:** The form uses bare `<label>`, `<input>` and `<textarea>` with **zero `.field-group`s** (measured), so the shared form CSS never applies. At 1440 every control collapses into one inline row: label + native "Choose File / No file chosen" + "Research objective" + a tiny clipped textarea + CTA button. At 390 the label and file input still sit side by side while the CTA becomes full width.
- **Spacing:** No vertical rhythm in the form; labels butt against controls.
- **Colour:** A green "Galaxy execution" badge is attached to a page that is only a plan gate, implying a ready/successful state.
- **Alignment:** Inline controls are misaligned with each other and with the heading; the CTA does not align to any input edge.
- **Component consistency:** Uses `.primary-link` (the hero CTA style) for both "Inspect proposed plan" and "Approve & run on Galaxy". No `.workspace` card, no `.field-group`, no shared tool-page shell — unlike every other tool page.
- **Form usability:** "Inspect proposed plan" is enabled with no file and no objective; the textarea has no helper text or maximum length; file types are described only inside the label text.
- **Data presentation:** Progress list, tree container, download list, report link and `<pre>` provenance are all hidden. No table or structured provenance view is shown at baseline.
- **Feedback/loading:** `#phylo-status` is empty; three sections have `aria-live`, but there is no visible progress affordance before a job starts.
- **Responsive behaviour:** Three-line H1, broken inline form and large empty area at 390; no footer.
- **Accessibility:** Skip link, `aria-live` sections and `label[for]` are present, but the tiny unstyled controls and absent grouping make the form hard to perceive and operate; no footer navigation escape.
- **Content clarity:** "M7.3" is internal milestone jargon in user-facing copy. "Trees are hypotheses, not publication-grade inference" is valuable but delivered in a caveat strip identical to the ones on other pages.

### 3.5 BLAST results — `blast-1440.png`

- **Visual hierarchy:** Clear H1 with a right-aligned note, caveat strip, one `.workspace` card and a thin footer. The scan path is good, but no results are visible at baseline.
- **Typography:** Consistent with the family; the primary button renders as mojibake: **"Analyze BLAST TSV â†’"**.
- **Navigation:** Four links and **no active indicator** (measured), so the user cannot tell which page they are on; the thin footer offers no navigation.
- **Layout:** Input-grid for schema/upload, one large paste textarea, collapsed "Thresholds and options" containing four numeric inputs and three optional textareas.
- **Spacing:** Consistent 18px grid gaps and adequate `<details>` padding.
- **Colour:** Teal top border on the workspace card; warning/error colours appear only after analysis.
- **Alignment:** Helper text aligns under fields; "Load example (synthetic)" is right-aligned above the textarea — acceptable.
- **Component consistency:** Nearly a twin of the Taxonomy page template, but the footer says "Milestone 0.1.0" while landing/AI say "0.5.0"; native file inputs remain unstyled.
- **Form usability:** Auto-infer schema with honest helper text is good. E-value is `type="text"` while adjacent thresholds are `type="number"`, with no explanation of the accepted syntax.
- **Data presentation:** Results table and four-card summary grid are hidden. Unlike the landing page, there is **no visible empty state** saying what will appear after analysis.
- **Feedback/loading:** `#blast-error` is a hidden `role="alert"`; no loading state; result status appears only after a run.
- **Responsive behaviour:** No 390 screenshot (see §7); CSS collapses `.input-grid` and `.summary-grid` to one/two columns.
- **Accessibility:** Skip link, labels with `aria-describedby` and `aria-live` results are present; missing active nav state is an orientation problem.
- **Content clarity:** "Import a BLAST tabular file produced elsewhere. No new BLAST request is made." is clear; version drift ("0.1.0") undermines trust.

### 3.6 Taxonomy — `taxonomy-1440.png`

- **Visual hierarchy:** Same template as BLAST with more visible fields, producing a taller card (1,406px document) and a thin footer.
- **Typography:** Uses correct glyphs (`·`, `→`) where BLAST and others show mojibake — encoding is inconsistent across the app.
- **Navigation:** Only three links, **no active indicator**, and it drops "Research workspace", which BLAST includes. The nav set drifts page to page.
- **Layout:** Full-width stacked fields after the input grid; seven advanced inputs collapsed by default.
- **Spacing:** Helper text sits tightly under labels; "Optional taxonomy mapping TSV" is immediately above its file input with minimal breathing room.
- **Colour:** Blue info-toned caveat strip; verdict state pills are defined but never demonstrated at baseline.
- **Alignment:** Consistent within the card.
- **Component consistency:** A near-duplicate of BLAST with different schema options (`blastn_local_v1`) and its own version string; no shared tool-page abstraction.
- **Form usability:** Species screening identity defaults to `98.65` with the caveat "not a universal species boundary" in tiny helper text. `min-consensus` is a 0–1 decimal while adjacent thresholds are percentages — inconsistent units in the same panel.
- **Data presentation:** Results, flags and `#taxonomy-query-view` are hidden with no baseline placeholder. It is the only page with a "Print report (PDF)" export.
- **Feedback/loading:** `aria-live` on results and flags; error paragraph hidden; no loading indicator.
- **Responsive behaviour:** No 390 screenshot (see §7); CSS collapses grids.
- **Accessibility:** Skip link, labels and `aria-live` regions present; no active nav state.
- **Content clarity:** Three names for one tool — nav "Taxonomy", H1 "Taxonomy Analyzer", section "Taxonomic consensus". "Difficult-group literature notes" are mentioned without a link.

### 3.7 Benchmark — `benchmark-1440.png`

- **Visual hierarchy:** H1, two paragraphs, then a chart section with a very large empty gap above the bars, then a table. No caveat strip, no badge, no footer.
- **Typography:** 48px H1, 15px body, 11px chart axis labels, 0.8125rem table.
- **Navigation:** Three links (Tools, BLAST, Taxonomy), no active indicator, and no route to the AI workspace or Research workspace — the most isolated page.
- **Layout:** `#chart` leaves roughly 300px of dead space between the section heading and the first bar at 1440.
- **Spacing:** Two consecutive `.section-block`s with 72px bottom padding; no shared page shell.
- **Colour:** Blue "call" and red "wrong" bars; the legend is coloured *words* in a plain paragraph, not a legend with swatches, and the chart itself has no colour-independent cue.
- **Alignment:** Bars are grouped and threshold labels centred — the one well-executed data visual here.
- **Component consistency:** The only page with `benchmark.css`; its table uses 1px all-round borders instead of the shared table pattern. It lacks the skip link, badge, `.workspace`, `.info-card` and footer that other pages have.
- **Form usability:** Not applicable (no inputs).
- **Data presentation:** No y-axis scale/ticks, no units and no tooltips. At threshold 99.9 there are no bars while the table reads call rate `0` and wrong rate `n/a` — ambiguous. Rates are shown as decimals (`0.6`, `0.4`) although the threshold column is labelled `(%)`. The caption correctly flags synthetic data.
- **Feedback/loading:** Not applicable (static data); no status region.
- **Responsive behaviour:** No 390 screenshot (see §7); CSS sets `#rc-table { display:block; overflow-x:auto; white-space:nowrap }` — horizontal scrolling with no affordance.
- **Accessibility:** **The only page without a skip link.** `#chart` has `role="img"` with an aria-label and the table has a caption and `scope="col"` headers — good; colour-only series identification is not.
- **Content clarity:** Four labels for one thing: "Benchmark transparency" (landing card), "Benchmarks" (nav), page title "Risk-coverage analysis", H2 "Synthetic risk-coverage curve". The page says "NOT a performance measurement" but still renders a chart that reads as performance.

---

## 4. Cross-page repeated problems, ranked

### 4.1 Ranked problem list

| Rank | Severity | Problem | Evidence |
| --- | --- | --- | --- |
| 1 | **P0** | Broken form styling on `/phylo`: zero `.field-group`s, bare controls rendered inline at both widths | `phylo-1440.png`, `phylo-390.png`; measured `fieldGroups: 0` |
| 2 | **P0** | Native unstyled buttons: 8 on `/workspace`, 2 on `/phylo` | `workspace-1440.png`, `workspace-390.png`, `phylo-1440.png`; measured plain-button IDs |
| 3 | **P0** | Mojibake on 4 of 7 pages, including page titles and CTAs (`â€”`, `â†’`, `Â†’`) | `landing-1440.png`, `ai-1440.png`, `phylo-1440.png`, `phylo-390.png`, `blast-1440.png`; rendered-text extraction |
| 4 | **P0** | Shell fragmentation: 7 nav variants (6/5/5/4/4/3/3 links), 3 footer treatments plus 3 pages with none, active state missing on 3 pages, skip link missing on 1 | all screenshots; measured nav/footer counts |
| 5 | **P1** | No vertical rhythm: `margin: 0` on all headings causes visible heading/card collisions on `/workspace`; inputs stretched to full width | `workspace-1440.png`, `workspace-390.png` |
| 6 | **P1** | No visible empty/loading state on BLAST, Taxonomy, AI, Workspace or Phylo; hidden result panels with no preview | `blast-1440.png`, `taxonomy-1440.png`, `ai-1440.png`, `workspace-1440.png`, `phylo-1440.png` |
| 7 | **P1** | Dense, repetitive explanatory copy and 0.72–0.75rem helper text; "Four ways" over six cards; limits repeated three times | `landing-1440.png`, `ai-1440.png` |
| 8 | **P1** | Weak data presentation: chart without y-axis/units/legend, 8-column run table in an unaffordanced scroll container | `benchmark-1440.png`, `workspace-1440.png` |
| 9 | **P1** | Mobile nav overflow/clipping (65px landing), no hamburger or single-line scroller, 7,120px landing page, hero art hidden | `landing-390.png`, `workspace-390.png`, `phylo-390.png`; measured |
| 10 | **P1** | Semantic colour overload: green success badges on neutral or negative statuses | `landing-1440.png`, `phylo-1440.png`, `ai-1440.png` |
| 11 | **P2** | Product-name and version drift: `0.1.0` vs `0.5.0`; "Benchmark transparency"/"Benchmarks"/"Risk-coverage analysis"; three names for Taxonomy | `blast-1440.png`, `taxonomy-1440.png`, `landing-1440.png`, `benchmark-1440.png` |
| 12 | **P2** | Poor file intake: native file inputs only, no drag-and-drop, manual 64-character SHA-256 entry | `workspace-1440.png`, `taxonomy-1440.png` |
| 13 | **P2** | Decorative motion/tilt and hover lifts that conflict with a research tone (reduced-motion is respected but the decoration remains) | `landing-1440.png` |
| 14 | **P2** | Destructive actions without confirmation ("Clear local sample/session", "Archive project") | `workspace-1440.png`, `workspace-390.png` |
| 15 | **P2** | In-page anchors lack `scroll-margin-top` under the sticky header | all in-page nav screenshots |

### 4.2 Prioritized fix list for the redesign

**P0 — must fix before any visual polish**

1. Define **one canonical app shell**: identical nav link set, visible active state, one footer treatment and a skip link on all 7 pages. Decide once whether nav items are in-page anchors or routes; make the two visually distinct.
2. Define **one form primitive library** (label + control + helper + error) and apply it to *every* control, including `/phylo` and the operator/dataset forms on `/workspace`. No bare `<input>`/`<textarea>` outside a field group.
3. Define **one button hierarchy** (primary / secondary / quiet / link) and replace all native `<button>`s that currently render as browser defaults. Use `<a>` for navigation and `<button>` for actions.
4. **Fix text encoding globally** (UTF-8 source + correct meta charset on all pages) and re-check every literal arrow, dash and separator, including `<title>`.

**P1 — core of the redesign**

5. Introduce a **spacing scale with heading margins**; remove card-adjacent heading collisions; constrain short-input widths instead of stretching them across the page.
6. Design **empty, loading and error states** for every results area, including a sample/preview row so users can see the output shape before running anything.
7. **Rewrite and compress copy**: remove triplicated limits, replace "Four ways" with the correct count or fix the card set, move safety statements to a consistent, prominent position, and raise helper text to a readable size.
8. Establish **data-presentation patterns**: sortable/expandable tables with captions and sticky headers; charts with axes, units, legends and non-colour cues; explicit scroll affordances on narrow tables.
9. Implement a **mobile navigation pattern** (single-line scroller or disclosure menu) and progressive disclosure for the 7,120px landing page; keep at least one visual element on small screens.
10. Write **semantic status-colour rules**: green only for confirmed success; neutral/negative/awaiting states get distinct text labels and shapes, not just colour.

**P2 — consistency and trust**

11. Unify product naming and the version string; make nav/H1/section titles agree.
12. Add drag-and-drop file intake and compute SHA-256 from the selected file instead of asking users to type it.
13. Remove decorative tilt/hover lifts or confine them to the hero; keep reduced-motion behaviour.
14. Add confirmation to destructive actions.
15. Add `scroll-margin-top` to anchor targets under the sticky header.

### 4.3 Mobile-specific findings

- Measured nav horizontal overflow at 390: landing **65px**, workspace **6px**, AI **3px**; other pages 0 but with inconsistent link counts.
- Landing at 390 is **7,120px** tall (vs 3,708px at 1440) with no progressive disclosure; hero art is hidden by `@media (max-width: 640px)`.
- H1 drops from 48px to 36px; on `/phylo` it wraps to three lines.
- `/phylo`'s inline form remains broken at 390: tiny textarea, label and file input side by side, full-width CTA.
- `/workspace` heading/card collisions and stretched inputs are more visible at 390; its local-mode banner wraps to eight lines.
- Tables (`#rc-table`, `.table-wrap`) rely on horizontal scrolling with no visual hint; no mobile screenshots were requested for AI, BLAST, Taxonomy or Benchmark (see §7).

---

## 5. Scientific software research — design principles (accessed 2026-11-26)

These sources were **read for principles only**. No visual style, palette, component appearance or asset was copied; the redesign should apply the principles using this project's own tokens and research-use caveats.

| Source | URL | What was read | Design principle extracted | Relevance here |
| --- | --- | --- | --- | --- |
| Galaxy (usegalaxy.eu) | https://usegalaxy.eu/ | Server-rendered shell and meta description: "community-driven web-based analysis platform for life science research"; the interface is a JS app mounted at `#app` | An analysis environment is organised around **data → history → workflow**, not around a single button; the current dataset and its state must remain legible | `/workspace` treats dataset registry and run history as secondary lists; the redesign should make the dataset → run → artifact chain the primary spine |
| Galaxy Training Network | https://training.galaxyproject.org/ and https://training.galaxyproject.org/training-material/topics/galaxy-interface/index.html | Home page topic taxonomy, learning pathways, accessibility guarantee and FAIR/Open Science policy; topic "Using Galaxy and Managing your Data" separates **Uploading Data**, **Histories — Managing your analysis histories efficiently**, **Workflows — Using Galaxy workflows to scale analysis**, **Downloading and Deleting Data** | Task-oriented navigation with explicit learning pathways; a visible data lifecycle; accessibility treated as policy, not polish | Provide task-based entry points ("validate", "analyse BLAST", "review taxonomy") rather than feature lists; show dataset lifecycle states; treat accessibility checks as a release gate |
| DNAnexus documentation | https://documentation.dnanexus.com/ ; https://documentation.dnanexus.com/getting-started/key-concepts/projects.md ; https://documentation.dnanexus.com/getting-started/key-concepts/apps-and-workflows.md | Projects as a shared storehouse with a **Manage** tab, object info panels showing unique ID, owner, creation time, size, tags and properties, deletion/recycle-bin lifecycle with purge times; Tools Library with search filters by name/category/type, detail pane showing **inputs and outputs**, pinning, version history and launch configuration | Make **metadata and provenance inspectable**; expose tool inputs/outputs before launch; filterable catalogs; explicit, reversible lifecycle states | `/workspace` should surface dataset metadata, run provenance and a filterable workflow catalog with declared inputs/outputs before the "planned run" action; destructive controls need lifecycle clarity |
| Benchling | https://www.benchling.com/ | Product messaging: "structured notebook entries", underlying entities/samples/results "recorded automatically — no duplicates"; "Historical Context"; automation "from instrument run to scientific decision"; scientist-guided agentic workflows | **Structured capture with automatic provenance**; carry scientific context forward into the next step; keep a human-guided approval boundary | Reduce manual metadata typing (compute checksums, infer schema), show a context/provenance trail between steps, and keep plan approval visually explicit rather than buried |
| IBM Carbon Design System | https://carbondesignsystem.com/ ; https://carbondesignsystem.com/components/data-table/usage/ ; https://carbondesignsystem.com/components/form/usage/ | Data table guidance: "ideal for organizing and displaying data"; sortable column headers, expandable rows for progressive disclosure, single/batch row actions, toolbar for global controls. Form guidance: labels and helper text so users submit correct data, consistent vertical alignment, defined input sizes, footer with submit/cancel | **Predictable table affordances** and **forms aligned to a grid with labels/helper text**; progressive disclosure for dense data | Results tables and the 8-column run history need sorting/expansion/toolbar patterns; taxonomy/BLAST/workspace forms need consistent alignment and visible helper text |

---

## 6. Skills investigated

No external skill was **installed**: no install scripts were executed (e.g. `npx impeccable install` was **not** run). Guidance was read from official sources only; the three locally available skills were loaded through the normal skill mechanism.

| Skill / source | License (verified) | Investigated | Actually used? | Contribution |
| --- | --- | --- | --- | --- |
| Anthropic `frontend-design` — https://github.com/anthropics/skills/tree/main/skills/frontend-design (`SKILL.md`) | `LICENSE.txt` = Apache-2.0 | Yes | **Yes** | Read its guidance on intentional typography, deliberate palette/layout choices and avoiding templated defaults. Used as a criterion for the verdict that the current navy/teal system applied identically to all pages reads generic rather than subject-specific. |
| UI/UX Pro Max — https://github.com/nextlevelbuilder/ui-ux-pro-max-skill | MIT | Yes | Read only | Reviewed its README (194 reasoning rules, searchable UI styles). Not applied: using it would require installing the skill, which this read-only audit deliberately did not do. |
| Impeccable — https://github.com/pbakaus/impeccable | Apache-2.0 | Yes | Read only | Reviewed its README. Its ideas of deterministic "slop" checks and P0–P3 ranked findings informed the severity ranking in §4; no install or install script was run. |
| Vercel web-interface-guidelines — https://github.com/vercel-labs/web-interface-guidelines (`command.md`) | MIT | Yes | **Yes** | Used as a concrete checklist: skip link, semantic HTML, form labels, `aria-live`, `:focus-visible`, reduced motion, `<button>` for actions vs `<a>` for navigation, errors next to fields. Many findings in §3 map directly to these rules. |
| Local skill `frontend-ui-engineering` | Local skill | Loaded | **Yes** | Supplied design-system adherence, WCAG 2.1 AA and "no AI aesthetic" criteria, meaningful empty/error states, and the 320/768/1024/1440 breakpoint checklist. |
| Local skill `web-design-guidelines` | Local skill | Loaded | **Yes** | Fetched the live guidelines source and applied the accessibility, focus, form and semantic-HTML rules; encouraged terse, evidence-first findings. |
| Local skill `browser` | Local skill | Loaded | **Yes** | Used for live accessibility snapshots, exact rendered-text extraction and console checking. Playwright remained the source of record for repeatable screenshots. |

---

## 7. Honest limitations

1. **Screenshots are the staging baseline**, not a local build of the worktree. Staging currently has Galaxy enabled and an AI backend that reports "not connected"; those states are as observed and may differ in another environment.
2. The worktree contained **concurrent uncommitted redesign edits** when this audit was written. Findings are based on `f0ecc69` / staging; re-reading the working copy will not reproduce the baseline exactly.
3. **Only three mobile screenshots were requested** (`landing-390`, `workspace-390`, `phylo-390`). AI, BLAST, Taxonomy and Benchmark mobile behaviour is described from CSS and DOM measurements, not from images.
4. **Hidden states were not exercised**: plan review, approval, job progress, result tables, verdicts, flags and error messages require local data or a submission. No scientific execution or provider call was made, so those states remain unobserved.
5. **No automated accessibility or contrast audit** (e.g. axe/Lighthouse) was run. Statements about focus rings, labels and ARIA are observations of markup and rendered structure, not a conformance claim.
6. Full-page screenshots at 390 capture the whole document; sticky/fixed header behaviour in a real viewport was checked only through DOM measurements.
7. The capture and measurement scripts and their JSON log live in `D:\DevCache\Temp`, **outside the repo**, so the only files added to the worktree are this document and the requested PNGs.
8. The prescribed office dashboard path `D:\Apps\Star-Office-UI\office-status.cmd` does not exist on this machine, so dashboard status updates could not be applied.
