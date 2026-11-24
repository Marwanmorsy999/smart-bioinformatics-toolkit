> **Status: HISTORICAL — superseded by later verification; findings retained verbatim.**
> **Reconciliation (2026-11-24):** The audit's observation that no browser UI calls the remote BLAST endpoints is still accurate. Browser analysis remains local by default; the approval endpoint now returns a `blast_consent` token so a future legacy caller can submit without re-consenting. See `docs/DATA_TRANSPORT.md` §1.1/§4.
>
> The original report below is unchanged.

---

# Frontend / UX audit — evidence-based (read-only investigation)

Scope: `web-platform/public/**` (4 HTML pages, 12 JS modules, 2 stylesheets, `_headers`),
`web-platform/{package.json,README.md,wrangler.toml,functions/**,tests/**}`, and the
project docs named in the brief. All citations are `path:line` relative to the repo root.
Method: static source review + repo-wide grep for network/AI/chat terms. No UI was executed;
the live `pages.dev` preview is reportedly un-verifiable from the build environment
(`README.md:156-160`, `docs/SLIDES_OUTLINE.md:99-102`).

## Headline

The browser app is a **fully local, framework-free analysis workbench**: FASTA validation,
sequence statistics, BLAST-TSV analysis, and taxonomy consensus/verdict all execute in the
browser with zero network calls. It is genuinely functional, not a mock-up. However:

- **No UI exists for the remote BLAST backend.** `web-platform/functions/api/blast/**`
  implements submit/status/results/history, but there is no `fetch()`/XHR/WebSocket call
  anywhere in `public/` (repo grep returned zero matches). The only nod to it is an inert
  “BLAST search — coming soon” tile (`public/index.html:80`).
- **There is no AI, chat, assistant, prompt or natural-language interface of any kind.**
- Docs describe an opt-in remote BLAST feature and an “NCBI online” taxonomy resolver that
  the deployed UI does not expose.

---

## 1. Pages/views and what a user can actually do

### 1.1 `public/index.html` — landing page + Tool 01/02

| Control | Evidence | Implementation | Real backend call? |
|---|---|---|---|
| Tool tabs “FASTA Validator” / “Sequence Statistics” | `index.html:68-73`; `js/app.js:41-59`, `:244` | Local DOM state (`setTool`); swaps labels, hides secondary button | No |
| Links to BLAST Results Analyzer / Taxonomy Analyzer | `index.html:74-79` | Plain navigation to `blast.html` / `taxonomy.html` | No |
| “More tools are planned — BLAST search” | `index.html:80` | `<div class="coming-soon">`, **not** a link/button; no listener | No — inert placeholder (see §4) |
| Sequence type select (DNA / protein) | `index.html:92-96`; `js/fasta.js:1-12` | Drives alphabet in `validateFasta()` | No |
| FASTA file upload | `index.html:99-102`; `js/app.js:258-274` | `File.text()` read into `<textarea>`, 5 MB cap | No — local file read |
| Paste FASTA / “Load example” / character count | `index.html:105-109`; `js/app.js:254-257`, `:275-281` | Local; examples embedded at `js/app.js:36-39` | No |
| “Validate FASTA” / “Calculate statistics” / “Clear” | `index.html:111-115`; `js/app.js:219-253` | `validateFasta()` (`js/fasta.js:79-142`) and `calculateStatistics()` (`js/statistics.js:2-76`) | No |
| Results table, summary cards, warnings/errors | `index.html:118-123`; `js/app.js:104-205` | Local rendering; `aria-live="polite"` | No |
| “Download JSON” / “Download CSV” / “Download valid FASTA” | `index.html:124-128`; `js/app.js:286-302` | Blob + `URL.createObjectURL`; JSON/CSV produced locally (`js/statistics.js:87-91`) | No |

### 1.2 `public/blast.html` — Tool 03, BLAST TSV analyzer

All controls are local: schema select (`blast.html:48-53`), TSV upload/paste
(`blast.html:56-65`; `js/blast-app.js:199-235`), thresholds and query-length/query-FASTA/
query-ID inputs (`blast.html:68-89`), “Analyze BLAST TSV” / “Clear”
(`blast.html:91-94`; `js/blast-app.js:88-99`, `:199-207`), JSON/CSV export
(`blast.html:103-106`; `js/blast-app.js:237-261`). Parsing, ranking, tie preservation and
filtering are implemented in `js/blast.js:62-221` and `:273-460`. The page states
“No new BLAST request is made” (`blast.html:31`) — accurate.

### 1.3 `public/taxonomy.html` — Tool 04, taxonomy consensus + verdict

Schema select including `blastn_local_v1` (`taxonomy.html:48-54`), BLAST TSV upload/paste
(`taxonomy.html:56-67`), query-ID list (`taxonomy.html:69-73`), optional taxonomy mapping TSV
(`taxonomy.html:75-79`), thresholds (`taxonomy.html:81-92`), run/clear
(`taxonomy.html:94-97`; `js/taxonomy-app.js:249-350`), JSON / summary CSV / “Print report
(PDF)” (`taxonomy.html:106-110`; `js/taxonomy-app.js:408-464`). Computation is entirely local:
`js/taxonomy.js:475-598` orchestrates consensus, `js/verdict.js:40-275` decides verdicts,
`js/difficult-groups.js:1-51` embeds three curated groups. Report HTML (with SHA-256 of input)
is generated locally by `js/report.js:18-96`. “Print report (PDF)” opens a blob URL in a new
tab and calls `win.print()` (`js/taxonomy-app.js:449-463`) — it does not generate a PDF file.

### 1.4 `public/benchmark.html` — static synthetic risk-coverage chart

No user controls. Chart + table are built at load from hardcoded 5-case data
(`js/benchmark-app.js:5-12`, `:48-65`) swept by `js/risk-coverage.js:22-38`. Page explicitly
says “This is NOT a performance measurement” (`benchmark.html:21-22`), consistent with code.
Discrepancy: the page claims data come from `shared/test-cases/risk_coverage_cases.json`
(`benchmark.html:21`) but the values are inlined in JS, not fetched.

### 1.5 What is NOT reachable from the UI

`web-platform/functions/api/blast/submit.js`, `status/[rid].js`, `results/[rid].js`,
`history.js` exist and are tested (`web-platform/tests/blast_*.test.mjs`), but no page
links to them. Searching `public/**/*.{js,html}` for `fetch(`, `/api/`, `XMLHttpRequest`,
`axios`, `WebSocket`, `EventSource` returns **zero matches**. There is no submit form, RID,
status poller or results viewer. `functions/README.md:13-20` documents the endpoints;
`docs/PRIVACY_NOTE.md:7` speaks of a “Submit” click — that click target is absent.

---

## 2. Natural-language / AI / chat / agent interface

**None in the product UI.** Repo-wide grep for
`AI|assistant|chat|agent|prompt|LLM|GPT|chatbot|conversational|natural language|copilot`:

- No match in any `public/` HTML or JS file.
- All 35 matches are documentation/orchestration text:
  - “agent” refers to development subagents, e.g. `docs/CONTRACTS.md:27-35`,
    `docs/EVIDENCE_LEDGER.md:3`, `README.md:22`;
  - `docs/API_CATALOG.md:163-175` records “AI Hero” as a **rejected** external API candidate
    (“teaches AI engineering, not UI assets or bioinformatics”), echoed at
    `docs/SLIDES_OUTLINE.md:94-95`;
  - `docs/OPENCODE_HANDOFF_PROMPT*.md` and `docs/ORCHESTRATION_LOG.md` describe agent prompts,
    not end-user prompt boxes.
- There is no chat widget, prompt textarea, NLP parser, model call, or conversational flow.

Conclusion: any claim of an “AI assistant / chat-based bioinformatics interface” would be
unsupported by the shipped frontend.

---

## 3. FASTA upload flow, data destination, consent/privacy

Flow (index page only; BLAST/taxonomy pages accept TSV, not FASTA, except the optional
query-FASTA helper at `blast.html:82-84`):

1. `<input id="fasta-file" type="file">` (`index.html:100`) → change handler
   (`js/app.js:258-274`) checks the 5 MB cap, calls `await file.text()` and writes the text
   into `#fasta-text`. Nothing leaves the browser.
2. User clicks Validate/Calculate → `getInputText()` (`js/app.js:85-91`) → `validateFasta()`
   (`js/fasta.js:79-142`) → optional `calculateStatistics()` (`js/statistics.js:2-76`) →
   local DOM render (`js/app.js:104-166`).
3. Exports use browser blobs (`js/app.js:207-217`).

**Third-party transmission in the current UI: none.** The homepage privacy strip says so
explicitly: “Your sequence stays in your browser… Nothing is uploaded to a server”
(`index.html:55-58`); the header badge says “Browser processing”
(`index.html:24`, `blast.html:24`, `taxonomy.html:24`). There is **no consent dialog,
checkbox, or third-party-transmission notice** anywhere — because no transmission occurs.
`blast.html:34-37` and `taxonomy.html:34-37` carry research-use disclaimers but no dedicated
privacy statement.

The backend, if it were wired up, *would* send sequence text to NCBI: `submit.js:46-52`
reads `fasta`, and `submit.js:63-64` builds the NCBI `CMD=Put` URL with the FASTA as `QUERY`
(`functions/README.md:30-37`); only a SHA-256 hash is stored in D1 (`submit.js:57`, `:71-79`).
`docs/PRIVACY_NOTE.md:5-9` and `README.md:14-16` describe this as “explicit opt-in only” —
but with no submit UI there is currently no way to opt in, and therefore no consent
experience to audit. `docs/PRIVACY_NOTE.md:20-21` itself flags missing per-user auth and a
global rate limit as residual risks for when such a UI exists.

---

## 4. Impressive-looking buttons for non-existent functionality

- **“More tools are planned / BLAST search”** — `index.html:80`. Rendered inside the tool
  sidebar using the same visual family as the real, clickable tool entries
  (`.tool-nav` / `.coming-soon` share typography at `css/main.css:229-236`; the tile even
  spans the grid at `css/main.css:429`). It is a `<div>`, has no `href`, no `data-tool`, no
  click listener, and `js/app.js:6` selects only `[data-tool]` elements. It looks like a
  fourth tool card but is decorative/inert. This is the only placeholder control found.
- **Inverse discrepancy (functionality without a button):** the four Pages Functions under
  `web-platform/functions/api/blast/` are fully implemented and tested but have no UI entry
  point (§1.5). The homepage therefore under-advertises real backend capability while the
  docs over-advertise a UI that does not exist.
- **Not a stub, but narrower than labelled:** “Print report (PDF)” (`taxonomy.html:109`)
  only opens a printable HTML view (`js/taxonomy-app.js:449-463`); there is no PDF export and
  no fallback if `window.open` is popup-blocked.
- **Dead code, not a fake control:** `js/blast-app.js:181-183` has a ternary whose two
  branches are identical arrays; `resultsTitle` is assigned at `js/blast-app.js:27`,`:143`
  but never read. `js/blast-app.js:99-103` computes `parsed` errors but the `if` body is only
  a comment, so unresolved-schema messages surface later via the row list instead of a
  dedicated error.

Every other button in `public/*.html` has a corresponding event listener: index
(`js/app.js:244-302`), BLAST (`js/blast-app.js:199-261`), taxonomy (`js/taxonomy-app.js:339-464`).
No `href="#"`, `onclick=`, or `disabled` placeholder buttons were found.

---

## 5. Accessibility, responsiveness, UX quality

**Strengths (evidence):**
- Skip links on the three main pages (`index.html:12`, `blast.html:12`, `taxonomy.html:12`);
  `benchmark.html` gets one injected at runtime (`js/benchmark-app.js:37-46`).
- Semantic labels with `for=`, help text via `aria-describedby`, `role="alert"` errors,
  `aria-live="polite"` result panels (`index.html:85-127`, `blast.html:47-105`,
  `taxonomy.html:48-110`), `aria-pressed` on tool tabs (`index.html:68-73`; `js/app.js:45-46`).
- Visible 3 px `:focus-visible` outline with separate dark-surface colour
  (`css/main.css:57-62`), `.sr-only` utility (`:78-81`), `prefers-reduced-motion`
  handling (`:462-469`; `css/benchmark.css:34`).
- Responsive layout: 980 px and 640 px breakpoints collapse hero, tool sidebar, input grid,
  summary cards and footer to single/two columns (`css/main.css:424-460`); chart scales
  (`css/benchmark.css:4-5`).
- No external fonts/images/CDNs — consistent with CSP (`css/main.css:1-2`, `public/_headers:2`).
- Scientifically cautious copy is prominent (research strips at `index.html:50-53`,
  `blast.html:34-37`, `taxonomy.html:34-37`).

**Weaknesses / risks:**
- `benchmark.html:26` puts `role="img"` on the chart container, and `renderChart()` inserts
  a nested `<svg role="img" aria-label=...>` plus `<desc>` (`js/benchmark-app.js:22-23`):
  redundant img roles may confuse screen readers.
- The benchmark page has no static skip link or footer/research-use strip (only JS injection);
  it depends entirely on JS for content.
- Tables use `<th scope="col">` only (`js/app.js:170-175`, `js/blast-app.js:67-72`,
  `js/taxonomy-app.js:98-100`); no row headers for long result tables. Wide tables rely on
  `.table-wrap` horizontal scrolling (`index.html:122`).
- Status is conveyed by pill colour classes (`js/app.js:182-186`, `js/taxonomy-app.js:185-188`)
  but text labels are present, so colour is not the sole channel.
- No privacy/third-party notice on `blast.html` or `taxonomy.html` (§3), and no progress or
  cancellation UI (all work is synchronous and sub-second, so low impact).
- Footer/version drift: all three main pages say “Milestone 0.1.0”
  (`index.html:149`, `blast.html:112`, `taxonomy.html:116`) and the About section says
  “Milestone 01” (`index.html:144`), while repo docs are Milestone 0.5.0/1.0.0.
- `playwright` is declared as a devDependency (`package.json:9-11`) but no browser/UI test
  exists (`web-platform/tests/**` contains only module tests; grep for `page.goto`,
  `chromium`, `browser` returns zero matches). Accessibility and rendering are not tested.

---

## 6. Serving / deployment / environment configuration

- Static assets served from `public/`: `wrangler.toml:3`
  (`pages_build_output_dir = "public"`), `web-platform/README.md:21-29` (Cloudflare Pages,
  root `web-platform`, no build command, output `public`); `README.md:75-86` recommends
  `python -m http.server 8000 --directory public` locally.
- `public/_headers:1-6` sets a restrictive CSP (`default-src 'self' blob:`,
  `script-src 'self'`, `connect-src 'self'`), `X-Frame-Options: DENY`, `nosniff`,
  Referrer-Policy and Permissions-Policy. `connect-src 'self'` would permit a future UI to
  call same-origin `/api/blast/*`; no such call exists today.
- **No API base-URL configuration in the frontend.** Grep of `public/**/*.{js,html}` for
  `import.meta.env`, `process.env`, `API_BASE`, `VITE_`, `baseUrl` returns zero relevant
  matches. All computation is self-contained.
- Backend-only configuration (irrelevant until a UI is wired): `wrangler.toml:5-10` D1 binding
  `BLAST_DB` with placeholder `database_id = "REPLACE_WITH_D1_DATABASE_ID"`;
  `functions/README.md:39-48` env vars `NCBI_TOOL`, `NCBI_EMAIL`, `MOCK_NCBI`.
- CI: `.github/workflows/tests.yml` runs Python and Node tests on push/PR; it does not
  deploy. No Pages deploy workflow found.
- Live URL asserted at `README.md:156` and `docs/DEMO_SCRIPT.md:26-28`
  (`https://4e5048a8.smart-bioinformatics-toolkit.pages.dev`); `README.md:156-160` and
  `docs/SLIDES_OUTLINE.md:99-102` acknowledge live browser verification failed due to TLS
  rejection in the build environment.

---

## 7. Docs vs deployed UI discrepancies

| Doc claim | Actual UI | Evidence |
|---|---|---|
| “Remote BLAST is an explicit, opt-in feature” with a Submit action | No submit form, RID, status or results UI; backend unreachable from UI | `README.md:14-16`, `docs/PRIVACY_NOTE.md:5-9` vs `index.html:66-81`; zero `fetch(` in `public/` |
| “Pages Functions can be added in a later milestone when the API is implemented” | Functions and D1 migration already exist | `web-platform/README.md:31` vs `web-platform/functions/api/blast/**`, `wrangler.toml:3-10` |
| Slide 3: “taxonomy resolver (local map / NCBI online)” | Browser supports local map upload only; no online lookup UI | `docs/SLIDES_OUTLINE.md:34-36` vs `taxonomy.html:75-79`; no fetch in `js/taxonomy-app.js` |
| Demo quickstart implies the web app demonstrates the full pipeline | Web app offers local validators/analyzers only; BLAST/run/benchmark are CLI-driven | `docs/DEMO_SCRIPT.md:7-17`, `README.md:88-114` vs `index.html:60-132` |
| Benchmark page: data “from `shared/test-cases/risk_coverage_cases.json`” | Values hardcoded in `benchmark-app.js` | `benchmark.html:21` vs `js/benchmark-app.js:5-12` |
| UI labels “Milestone 0.1.0” / “Milestone 01” | Repo is Milestone 0.5.0/1.0.0 in docs | `index.html:144`,`:149`, `blast.html:112`, `taxonomy.html:116` vs `README.md:1-16`, `docs/DEMO_SCRIPT.md:1` |
| Verified live deployment | Deploy stage confirmed by API but rendering not independently verified | `docs/DEMO_SCRIPT.md:26-28`, `README.md:156-160`, `docs/SLIDES_OUTLINE.md:99-102` |
| UI exposes `blastn_local_v1` schema option | That schema is produced by the Python CLI (`README.md:296-304`); browser has no way to generate such a TSV | `taxonomy.html:50`, `README.md:103`,`:299-302` |

## Bottom line

Real functionality: four local analysis tools plus a static synthetic chart, with solid
scientific caveats and reasonable accessibility/responsive styling. Stubs/placeholders: one
inert “BLAST search” tile and a PDF-labelled print action. Missing entirely: any AI/chat/NL
interface and any frontend connection to the existing remote BLAST API. The main risk is a
**documentation–UI mismatch** around remote BLAST, not fake buttons in the shipped pages.
