# DESIGN SYSTEM — M7.4.1

**Status:** design foundation implemented in worktree `design/ui-ux-overhaul` (HEAD `f0ecc69`).
**Scope:** all seven pages in `web-platform/public/` were redesigned (shell, tokens, components and page layouts). No backend functions, migrations, `wrangler.toml`, `package.json`, Python engine, or scientific/API logic was changed.

## 1. Design direction (fixed contract)

**Precision instrument bench** — a refined scientific research environment, not AI SaaS.

| Decision | Implementation |
| --- | --- |
| Cool porcelain surfaces | `--doc-bg #eef2f4`, `--surface #ffffff`, `--surface-2 #f5f8f9`. No warm cream, no paper texture. |
| Deep ink / slate text | `--ink #16252e`, `--ink-2 #334750`, `--muted #566a74`. |
| Restrained teal / cyan-grey accent | `--accent #176b6e`, `--accent-strong #0d5254`, `--accent-tint #e6f0f0`. |
| Amber for caution | `--caution #8a5a12` on `--caution-bg #fbf2e2`, used for consent / gated / warning states only. |
| No purple / blue gradients | Zero `gradient()` declarations in `tokens.css`, `main.css`, `components.css`. |
| No glassmorphism | Removed `backdrop-filter` and translucent header background; header is solid porcelain with a hairline rule. |
| No glowing DNA / decorative art | Replaced orbit + "DNA card" hero art with an inline SVG **analysis schematic** that carries real information. |
| No emoji icons | All icons are inline SVG, one 1.5px stroke family, `currentColor`, `aria-hidden="true"`. |
| No oversized empty hero | Hero is a compact two-column block: copy + figure, ~1 viewport at 1440×900 including nav. |
| No identical rounded-card grid | Capability cards are hairline-bordered instrument panels with a 2px accent rule on hover/focus, not floating shadows. |
| No fake metrics / testimonials | Every number on the landing page comes from the live validator/statistics tools; no counts, quotes or stars are fabricated. |
| Local/system fonts only | `system-ui` stack for UI; monospace only for FASTA, IDs, hashes, parameters and numeric data. No CDN or `@font-face`. |
| Tabular numerals | `font-variant-numeric: tabular-nums` on tables, summary values, counters and character counts. |
| 4px spacing scale | All layout gaps/paddings resolve to `--space-1 … --space-20` (4…80px). |
| Hairline borders, minimal elevation | 1px rules; elevation limited to `--elev-1`/`--elev-2` (0–2px, ≤6% alpha). |
| 2–6px radii | `--radius-1…4` = 2/3/4/6px. Pills replaced with 2–3px status chips. |
| Visible focus | `:focus-visible` 3px `--focus` ring with 2px offset on every control; light-only `--focus` usage. |
| Reduced motion | `prefers-reduced-motion: reduce` disables smooth scroll and collapses all transitions. |

`tokens.css` is the **first stylesheet** in all seven HTML pages. `main.css` and `components.css` consume its variables; `benchmark.css` is untouched and inherits the aliases (`--info`, `--danger`, `--ink-soft`, `--muted`, `--line`, `--surface-2`, `--font`).

## 2. Token tables

### 2.1 Color

| Token | Value | Role |
| --- | --- | --- |
| `--doc-bg` | `#eef2f4` | Page canvas (cool porcelain) |
| `--surface` | `#ffffff` | Primary work surface |
| `--surface-2` | `#f5f8f9` | Inset / zebra rows |
| `--surface-3` | `#e9eff1` | Recessed controls |
| `--surface-inset` | `#f0f4f5` | Empty / help blocks |
| `--ink` | `#16252e` | Headings, primary text, buttons |
| `--ink-2` | `#334750` | Secondary text |
| `--muted` | `#566a74` | Supporting copy |
| `--faint` | `#5f727b` | Metadata, placeholders (AA on light surfaces) |
| `--ink-inverse` | `#f4f8f9` | Text on dark surfaces |
| `--line` | `#d3dde1` | Default hairline |
| `--line-soft` | `#e6edef` | Subtle divider |
| `--line-strong` | `#b3c3c9` | Emphasised hairline / control border |
| `--accent` | `#176b6e` | Scientific accent (teal/cyan-grey) |
| `--accent-strong` | `#0d5254` | Accent text, focus, headings |
| `--accent-tint` | `#e6f0f0` | Accent surface |
| `--accent-line` | `#bcd6d5` | Accent border |
| `--caution` / `--caution-bg` / `--caution-line` | `#8a5a12` / `#fbf2e2` / `#e4cc9f` | Amber caution, gated states |
| `--success` / `--success-bg` / `--success-line` | `#1d6b54` / `#e7f2ed` / `#bcdccf` | Valid / complete |
| `--danger` / `--danger-bg` / `--danger-line` | `#a23b31` / `#fbecea` / `#e9c4c0` | Invalid / error |
| `--info` / `--info-bg` / `--info-line` | `#2b5b6b` / `#e8f0f3` / `#c2d8e0` | Informational / queued |
| `--focus` | `#0d5254` | Focus ring on light surfaces |
| `--focus-on-dark` | `#a9d8d5` | Focus ring on the dark footer only |

Legacy aliases retained so existing selectors and `benchmark.css` keep working: `--navy → --ink`, `--navy-soft #243a44`, `--navy-deep #101d24`, `--teal → --accent`, `--teal-bright #2c8487`, `--teal-deep → --accent-strong`, `--teal-tint → --accent-tint`, `--ink-soft → --ink-2`, `--subtle → --faint`, `--canvas → --doc-bg`, `--surface-alt → --surface-inset`, `--border-strong → --line-strong`, `--warning → --caution`, `--warning-bg → --caution-bg`.

### 2.2 Typography

| Token | Value | Use |
| --- | --- | --- |
| `--font-ui` / `--font` | `system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif` | Body and headings |
| `--font-mono-stack` / `--font-mono` | `ui-monospace, SFMono-Regular, "Cascadia Mono", Consolas, "Liberation Mono", monospace` | Sequences, hashes, IDs, parameters |
| `--fs-100 … --fs-900` | 11 / 12 / 13 / 14 / 16 / 18 / 22 / 28 / clamp(2rem,3.2vw,2.75rem) px | Type scale |
| `--lh-tight` / `--lh-snug` / `--lh-body` | 1.15 / 1.35 / 1.6 | Headings / tight UI / body |
| `--fw-regular … --fw-bold` | 400 / 550 / 650 / 750 | Weight scale |
| `--tracking-tight` / `--tracking-caps` | `-.025em` / `.12em` | Headings / micro labels |
| `--numeric` | `tabular-nums` | Data columns and counters |

### 2.3 Spacing (4px base)

`--space-0 0`, `--space-1 4px`, `--space-2 8px`, `--space-3 12px`, `--space-4 16px`, `--space-5 20px`, `--space-6 24px`, `--space-7 28px`, `--space-8 32px`, `--space-10 40px`, `--space-12 48px`, `--space-14 56px`, `--space-16 64px`, `--space-20 80px`.
Legacy aliases: `--space-xs → 8`, `--space-sm → 12`, `--space-md → 20`, `--space-lg → 32`, `--space-xl → 56` (px).

### 2.4 Radii

`--radius-1 2px`, `--radius-2 3px`, `--radius-3 4px`, `--radius-4 6px`; aliases `--radius-sm → 3px`, `--radius → 4px`, `--radius-lg`/`--radius-xl → 6px`.

### 2.5 Borders

`--border-width 1px`, `--border-accent-width 3px`, `--border-hairline 1px solid --line`, `--border-soft 1px solid --line-soft`, `--border-strong-line 1px solid --line-strong`.

### 2.6 Elevation

`--elev-0 none`, `--elev-1 0 1px 0 rgba(22,37,46,.05)`, `--elev-2 0 2px 6px rgba(22,37,46,.06)`; `--shadow-sm/-/md` alias to these. No other shadow values remain.

### 2.7 Focus

`--focus-ring-width 3px`, `--focus-ring-offset 2px`. Implemented literally as `outline: 3px solid var(--focus); outline-offset: var(--space-1)` so the rule stays greppable and testable. `--focus-on-dark` appears exactly once in the CSS, on `.site-footer a, .footer-links a`.

### 2.8 Motion

`--dur-fast 120ms`, `--dur-base 180ms`, `--ease-standard cubic-bezier(.2,.7,.3,1)`. Only `background-color`, `border-color`, `top` and `opacity` are transitioned; no transform-based hover lift.

### 2.9 Breakpoints

`--bp-xs 360px`, `--bp-sm 480px`, `--bp-md 720px`, `--bp-lg 980px`, `--bp-xl 1180px`, `--maxw 1180px`.
CSS custom properties cannot be used inside `@media` conditions, so these values are documented here and mirrored literally at `980px` and `640px` in `main.css`/`components.css`.

## 3. Component inventory

| Component | Selector(s) | States / notes |
| --- | --- | --- |
| Navigation shell | `.topbar`, `.brand`, `.brand-mark`, `#primary-nav.top-nav`, `.nav-toggle` | Sticky solid header; `aria-current` marks the active route; mobile toggle with `aria-expanded`/`aria-controls`. |
| Skip link | `.skip-link` | First focusable element on every page; targets the `<main>` id. |
| Buttons / links | `.primary-button`, `.secondary-button`, `.quiet-button`, `.primary-link`, `.secondary-link`, `.text-link`, `.card-link` | Hover changes colour, never lifts; all keyboard reachable; 3px focus ring. |
| Inputs | `.field-group label/select/input`, `textarea` | Always labelled; help text via `aria-describedby`; monospace + tabular numerals for FASTA text. |
| File upload | `#fasta-file`, `::file-selector-button` | Native control, styled to match the button family; 5 MB limit stated next to it. |
| Tables | `table`, `.table-wrap`, `thead`, `.pill` | Horizontal scroll wrapper, zebra rows, tabular numerals, status chips (2px radius). |
| Badges / status | `.local-badge`, `.badge-mode`, `.state-pill`, `.result-status`, `#backend-badge` | Text-first labels; colour is never the only signal; `.mock` uses amber. |
| Tabs / tool switcher | `.tool-nav[data-tool]`, `[aria-pressed]` | Real buttons for validator/statistics; anchors for other routes. |
| Modals / dialogs | None in this scope | No modal was introduced; consent review stays in the plan card flow on `ai.html`. |
| Alerts | `.research-strip`, `.privacy-strip`, `.input-error`, `.message` | Inline, text-labelled, `role="note"` / `role="alert"`/ live regions as appropriate. |
| Empty / loading / error | `.empty-state`, `.poll-controls`, `#input-error`, `.result-status.has-errors` | Explain the next action instead of showing a blank panel; no spinners invented. |
| Workflow steps | `.workflow-strip`, `.workflow-stage[data-state]`, `.stage-state`, `.workflow-legend` | Four stages, data-state drives colour + rule, text state repeated in a chip. |
| Data visualisation | `.schematic`, `.schematic-svg`, `.sg-*`; `#chart` in `benchmark.css` | Schematic is a labelled `role="img"` with `<title>`/`<desc>` and a visible caption; benchmark chart unchanged. |
| Cards | `.capability-card`, `.output-card`, `.info-card`, `.step-card`, `.result-card` | Hairline borders, 4–6px radii, 0–1px elevation. |
| Footer | `.site-footer`, `.footer-grid`, `.footer-disclaimer` | Dark slate; its links are the only users of `--focus-on-dark`. |

## 4. Accessibility decisions

- **Headings / landmarks:** one `<h1>` per page, ordered `<h2>`→`<h3>`, `<main id>` + skip link, `<nav aria-label="Main navigation">`, `<aside aria-label>`.
- **Icon policy:** every decorative SVG has `aria-hidden="true"`. The schematic is the only informative SVG and has `role="img"` plus `aria-labelledby` pointing to `<title>` and `<desc>`; its `<figcaption>` repeats the takeaway in text.
- **Focus:** `:focus-visible` only (no ring on mouse click). `:where(...)` keeps specificity low so component overrides cannot silently remove the ring. Focused controls on the dark footer use `--focus-on-dark`.
- **State is never colour-only:** valid/invalid, gated/queued/verified and current/start states all carry text labels or chips.
- **Forms:** explicit `<label for>`, `aria-describedby` help, `role="alert"` for errors, `aria-live="polite"` results region; paste is never blocked and `spellcheck="false"` is used on FASTA input.
- **Motion:** `prefers-reduced-motion: reduce` disables smooth scrolling and all transitions globally.
- **Contrast:** body and accent text are ≥4.5:1 on porcelain; focus ring ≥3:1 on light surfaces; caution/danger always paired with text.
- **No fake auth:** no sign-in, avatar, user menu or multi-user affordance appears anywhere in the shell.
- **Touch / zoom:** viewport meta does not disable zoom; controls are ≥40px tall on mobile.

## 5. Responsive rules

| Width | Behaviour |
| --- | --- |
| ≥981px | Two-column hero (copy + schematic), 3-column capability grid, 4-stage workflow strip, sidebar + workspace. |
| ≤980px | Hero stacks; tool sidebar becomes two columns; capability/output grids become two columns; workflow becomes 2×2. |
| ≤640px | Single-column everything; nav collapses behind the accessible toggle; hero art keeps its SVG scale via `width:100%;height:auto`; summary grid 2 columns; footer 1 column. |
| ≤360px | Text and controls remain readable; table wrapper scrolls horizontally; no horizontal page overflow. |

## 6. Sources and skills used

**No external skill was installed.** Only skills already present in the environment were used; no package or skill was added to the repository.

| Source / skill | URL | Contribution |
| --- | --- | --- |
| `frontend-ui-engineering` (local OpenCode skill) | `C:\Users\maram\.agents\skills\frontend-ui-engineering` | Design-system adherence, 4px spacing discipline, semantic tokens over raw hex, WCAG 2.1 AA keyboard/focus/empty-state guidance, explicit anti-AI-aesthetic table. |
| `web-design-guidelines` (local OpenCode skill) | `C:\Users\maram\.agents\skills\web-design-guidelines` | Requested fresh guidelines before review; supplied the review checklist used below. |
| Web Interface Guidelines (fetched via that skill) | https://raw.githubusercontent.com/vercel-labs/web-interface-guidelines/main/command.md | Skip link + hierarchical headings; focus-visible instead of outline-none; `aria-label` on icon-only buttons; `aria-hidden` on decorative icons; `aria-live` for async results; `tabular-nums` for number columns; `text-wrap: balance` on headings; reduced-motion honouring; specific button labels; links for navigation vs buttons for actions. |
| WCAG 2.1 AA (contrast / focus visible) | https://www.w3.org/TR/WCAG21/#contrast-minimum , https://www.w3.org/TR/WCAG21/#focus-visible | 4.5:1 text, 3:1 focus indicator, visible keyboard focus decisions. |
| MDN CSS custom properties | https://developer.mozilla.org/en-US/docs/Web/CSS/--* | Token architecture; documented why breakpoint tokens cannot drive `@media`. |
| MDN `:focus-visible` | https://developer.mozilla.org/en-US/docs/Web/CSS/:focus-visible | Keyboard-only focus ring decision. |
| MDN `font-variant-numeric` | https://developer.mozilla.org/en-US/docs/Web/CSS/font-variant-numeric | Tabular numerals for analytical data. |
| Project UI quality test contract | `web-platform/tests/ui_quality.test.mjs` | Preserved every queried element id, `data-tool` hook, four-stage workflow markup and focus-selector contract. |

## 7. Design rationale and critique against AI-slop patterns

The landing page used to show a tilted "DNA card" inside rotating orbit rings, radial gradients, pill badges, 18–24px rounded cards with hover lift, and a large empty art area. That is the recognisable generated-UI template: friendly rounding, decorative pseudo-science, and no information density.

| AI-slop pattern observed / risk | How this redesign answers it |
| --- | --- |
| Glowing DNA / orbiting decoration | Replaced by a hand-drawn **analysis schematic** with five labelled stages and real capability names; it explains the product instead of decorating it. |
| Purple/indigo + multi-stop gradients | Removed entirely; a single teal/cyan-grey accent on porcelain and slate. |
| Glassmorphism (`backdrop-filter`, translucent header) | Solid surface, hairline bottom rule. |
| Pill-everything (99px radii) | All status chips now 2–3px; panels 4–6px. |
| Oversized empty hero | Hero copy and figure are both information-bearing; no blank art column. |
| Identical rounded card grid | Capability panels use a 2px accent rule on hover/focus rather than lift + heavy shadow; workflow uses a connected rail, not four separate cards. |
| Fake metrics / testimonials | None added. All displayed numbers are produced by the validator/statistics tool at runtime. |
| Placeholder copy | All copy is the project's existing, reviewed research-use text; no lorem ipsum and no new scientific claims. |
| Invisible / inconsistent focus | One documented `:focus-visible` rule; footer-only dark variant; tested by `ui_quality.test.mjs`. |
| Broad transitions / transform hovers | Explicit short colour transitions only; `prefers-reduced-motion` collapses them. |

**Known critique / conscious trade-offs**

- The schematic's smallest labels are 10px (`.sg-index`). At 1440px they render at about 10px; below 640px the figure scales down further, so the `<desc>` and caption carry the same information for assistive tech and small screens. A dedicated mobile re-layout of the SVG was deliberately not added to avoid a second diagram that could drift from the first.
- The nav contract fixed the item set to Tools / Research workspace / Phylogenetics / About. Direct top-level links to AI workspace, BLAST, taxonomy and benchmarks were removed from the header; those routes remain reachable from the capability cards, tool sidebar and footer. This is a navigation trade-off, not a broken route.
- Legacy token aliases are kept intentionally: removing them would require editing scientific page scripts and `benchmark.css`, which is outside this task's scope. They are documented above so the alias surface stays visible.
- Other pages were given the shell and tokens only; their body copy and scripts are unchanged, so some older glyph-based check marks remain outside the landing page.
