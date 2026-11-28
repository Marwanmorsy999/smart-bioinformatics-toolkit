# M7.4.1 — UI/UX and Visual Identity Overhaul: implementation report

**Status:** complete on isolated branch `design/ui-ux-overhaul`; staged deployment verified; **not merged** into the main development branch; production untouched.

## 1. Commits and isolation

| Item | Value |
| --- | --- |
| Main repo at start | `D:\smart-bioinformatics-toolkit-milestone-0_5_0\...\smart-bioinformatics-toolkit`, branch `phase-1-robustness-safety` |
| Starting commit | `f0ecc698b5124e7d53a99cd37a560c1e95f0802a` |
| Design worktree | `D:\DevCache\Temp\uiux-overhaul` (git worktree, `node_modules` junction — no package installation) |
| Design branch | `design/ui-ux-overhaul` |
| Implementation commits | `d7a0cb2` (audit, design system, tokens, shell, landing) → `018ccc6` (six application/tool pages) → `ff37b9b` (E2E, accessibility review, screenshot evidence); this report is a follow-up documentation commit |
| M7.5-A work | Left untouched in the main repo (five M7.5 docs plus `SYSTEM_ARCHITECTURE.md` were not modified) |

No reset, rebase, force-push, merge or deletion was performed. No production deployment.

## 2. Skills investigated and used

No external skill was installed; no install script or dependency was executed. Licenses and source were read before use.

| Source | License | Used for |
| --- | --- | --- |
| Anthropic `frontend-design` — https://github.com/anthropics/skills/tree/main/skills/frontend-design | LICENSE.txt | Distinctive-direction critique, type/layout intent, explicit anti-AI-default list; rejected warm-cream/terracotta and card-kit defaults |
| UI/UX Pro Max — https://github.com/nextlevelbuilder/ui-ux-pro-max-skill | MIT | Priority order (accessibility, touch, performance, layout, forms, charts), local-font and SVG-icon discipline; guidance read from official SKILL.md, search scripts not installed |
| Impeccable — https://github.com/pbakaus/impeccable | Apache-2.0 | Operate/Read mode framing, final critique and polish criteria; launcher not installed, principles applied directly |
| Vercel Web Interface Guidelines — https://github.com/vercel-labs/web-interface-guidelines | repository skill | Accessibility/focus/form/typography/content review checklist; fetched fresh via the local `web-design-guidelines` skill |
| Local skills: `frontend-ui-engineering`, `web-design-guidelines`, `browser` | n/a | Component discipline, WCAG checks, live browser inspection |

Research references (principles only, no visual cloning): Galaxy `https://usegalaxy.eu/`, Galaxy Training Network `https://training.galaxyproject.org/`, DNAnexus docs `https://documentation.dnanexus.com/`, Benchling `https://www.benchling.com/`, IBM Carbon `https://carbondesignsystem.com/`. Findings are recorded in `docs/UI_UX_AUDIT.md`.

## 3. Design decision

**Precision instrument bench.** Cool porcelain surfaces (`#eef2f4`), deep ink/slate text (`#16252e`), restrained teal/cyan-grey accent (`#176b6e`), amber only for caution/gated states, hairline borders, 2–6px radii, minimal elevation, 4px spacing scale, local system fonts only, monospace only for sequences/IDs/parameters and tabular numerals for data. The landing hero's memorable element is an inline SVG **analysis schematic** labelled INPUT → VALIDATE → PLAN → EXECUTE → EVIDENCE with real capability names — information, not decoration. No gradients, glassmorphism, glowing DNA, emoji icons, pill-everything, fake metrics, testimonials or decorative motion. One `<h1>` per page, one navigation contract across all pages, and no fabricated account/auth features. Full tokens and rationale: `docs/DESIGN_SYSTEM.md`.

## 4. Pages and files changed

Redesigned: landing `/`, `workspace.html`, `ai.html`, `phylo.html`, `blast.html`, `taxonomy.html`, `benchmark.html`.

New: `css/tokens.css`, `css/app-views.css`, `css/tool-views.css`, `js/nav.js` (mobile navigation only), `tests/uiux_browser.e2e.mjs`, this report. Refactored: `css/main.css`, `css/components.css`. Small presentation-only change: one class toggle in `js/ai-workspace.js` (`renderBackendStatus`). Documentation: `docs/UI_UX_AUDIT.md`, `docs/DESIGN_SYSTEM.md`, `docs/UI_UX_ACCESSIBILITY_REVIEW.md`.

**Not changed:** scientific algorithms, sequence calculations, taxonomy/BLAST interpretation, Galaxy/provider integrations, auth, D1 schema/migrations, API contracts, consent/provenance, `wrangler.toml`, `package.json`, `benchmark.css`, Python engine, or any other scientific JS. Programmatic HEAD comparison found zero removed IDs, zero duplicate IDs, zero removed `data-*` hooks and zero removed script tags.

## 5. Evidence: screenshots

Before (staging baseline) and after (redesigned) captures are tracked under `docs/uiux-screenshots/before/` (10) and `docs/uiux-screenshots/after/` (59): all seven pages at 1440×900, 1280×800, 768×1024, 390×844 and 360×800, plus interaction states (workspace sample, AI plan/form, phylo plan, mobile nav). Originals also exist under `web-platform/test-results/uiux/`.

Representative improvements visible in the captures: generic orbit/DNA art → labelled analysis schematic; stacked unbounded cards → two-column input/output benches; unstyled form controls → labelled token-based field groups; empty state → explicit next-action guidance; cramped 390px phylo form → stacked full-width controls; inconsistent footers → one product footer.

## 6. Accessibility and responsive results

`docs/UI_UX_ACCESSIBILITY_REVIEW.md` records the method and per-item result (WCAG 2.2 AA target; **not** a certification). Checks passed: one `h1`, ordered headings, skip link to `<main>` on 7/7, labels on all form controls, `aria-live` result regions, decorative SVG `aria-hidden`, informative schematic with `role="img"` + `<title>`/`<desc>`, visible `:focus-visible` rings, no disabled zoom, table headers, reduced-motion support, keyboard-reachable navigation with Escape/focus return.

Contrast after fixes: `--faint` `#5f727b` = 5.02:1 on white / 4.71:1 on `--surface-2`; ink 15.69:1, muted 5.66:1, accent 6.24:1, caution 5.32:1, danger 5.70:1; dark footer text 13.75:1. The previously green negative backend badge now computes amber (`rgb(138,90,18)`) with class `local-badge unavailable`.

Responsive: zero document-level horizontal overflow on 7 pages × 5 viewports (35/35). At ≤640px the mobile toggle stays on the first row and the status badge wraps below; tables scroll inside their own wrappers with a visible small-screen hint; micro-labels in the schematic are hidden in favour of the caption/description. At 768px the masthead is crowded but readable and does not overflow — the main remaining visual limitation.

## 7. Tests

| Suite | Result |
| --- | --- |
| `npm test` (web-platform) | **505 pass / 0 fail** |
| `node tests/workspace.e2e.mjs` | PASS |
| `node tests/phylo_page.e2e.mjs` | PASS |
| `node --test tests/uiux_browser.e2e.mjs` (new) | **10 pass / 0 fail** — 7 page loads, nav parity and toggle, landing validator/statistics, BLAST and taxonomy example→Analyze offline, workspace sample, phylo plan/consent gate, 35 viewport checks, keyboard focus, reduced motion; all fetches stubbed, no mocked output presented as a fresh execution |
| `python -m pytest tests/ -q` (python-engine) | **244 passed** with `SMARTBIO_PLUGIN_DIR_TRUSTED=1` |

The worktree lives under `D:\DevCache\Temp`; the project's plugin-discovery guard correctly fails closed for manifest directories in the system temp directory, so the local Python run requires that documented acknowledgement. The main repository passes 244/244 without it. No live Galaxy or other scientific provider was called.

## 8. Staging deployment and verification

Existing Worker `smart-bioinformatics-toolkit-staging` via `npx wrangler deploy --env staging`; **Version ID `8064afa5-9f56-4734-ba2f-4974abb93662`**. All seven public routes plus `/css/tokens.css`, `/css/app-views.css`, `/css/tool-views.css`, `/js/nav.js` and `/api/tools` returned HTTP 200. Real-browser checks on staging confirmed consistent nav, correct active navigation on landing/workspace/phylo, tokens loaded, no console errors and no horizontal overflow. Production was not deployed.

## 9. Remaining limitations

- Tablet-width (768px) masthead is denser than ideal; it is readable and overflow-free but not yet fully refined.
- Header nav intentionally exposes only Tools / Research workspace / Phylogenetics / About; AI workspace, BLAST, taxonomy and benchmarks remain reachable through capability panels, tool sidebars and the shared footer. This simplifies the shell but adds one click to those routes.
- The schematic's stage boxes are legible at 390px, but detailed micro-labels are deliberately hidden there; the visible caption and SVG description carry that detail.
- File upload, download buttons and print-report were not clicked in the browser suite; example-driven offline analysis and the existing unit/legacy E2E suites cover the corresponding logic.
- Real Galaxy job progress/tree retrieval remains untested (no live provider calls permitted); honest placeholders are preserved.
- `office-status.cmd` was absent, so no office-dashboard status updates were written.
