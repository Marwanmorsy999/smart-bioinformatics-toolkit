# M7.4.2 — Brand Identity, AI Research Assistant and Final Product Polish

**Status:** complete on isolated branch `design/brand-assistant-polish`; staging verified; **not merged** into the main development branch; production untouched. M7.5-A documents in the main repository were not touched.

## 1. Branch and commits

| Item | Value |
| --- | --- |
| Starting point | `3dea99e0bfdeea67e58c81af58f367e200e6ca5d` (reviewed M7.4.1 design branch) |
| Worktree | `D:\DevCache\Temp\uiux-polish` (`node_modules` junction; no installation) |
| Branch | `design/brand-assistant-polish` |
| Commits | `6a6c63e` brand/naming/policy/copy → `52f072d` assistant UI + gateway → `8e371f6` E2E/accessibility/evidence; this report is a final documentation commit |
| Staging version | `0e2bf6cf-c714-4708-98ce-373af60382e4` |

## 2. Brand identity and logo

Original handcrafted SVG mark: an **S** spine whose head bifurcates into a two-tip clade — biological sequence alignment, branching phylogeny and an S/B monogram in one glyph. No emoji, stock logo, generic brain/robot/glowing helix/atom or unmodified library icon; no external font/image/CDN.

Assets under `web-platform/public/brand/`: `sbio-logo-primary.svg` (full-colour horizontal wordmark), `sbio-symbol.svg` (compact), `sbio-logo-mono.svg`, `sbio-logo-dark.svg`, `sbio-assistant.svg` (same glyph on an accent plate). `web-platform/public/favicon.svg` is an opaque keylined favicon readable on light and dark chrome. The shipped pages reference the primary wordmark in headers, the dark lockup in footers, the assistant avatar in chat, and the favicon; the compact and mono variants are documented as available for future tiles/badges.

All variants share identical path geometry and the Precision Instrument Bench palette (`--ink #16252e`, `--accent #176b6e`, `--accent-strong #0d5254`, porcelain `#eef2f4`). Clear space = symbol height `X`; minimum sizes 16 px (favicon), 24 px (assistant), 32 px (compact), ~28 px header. Detail, construction geometry, prohibited treatments and contrast notes: `docs/BRAND_IDENTITY.md`; token summary: `docs/DESIGN_SYSTEM.md` §8.

## 3. Product naming and public copy

Public brand is now **Smart Bioinformatics AI** in all page titles, headers, footers, aria-labels, downloaded report metadata and assistant meta. "Milestone 0.5.0", framework-free/no-CDN notes, branch names and implementation details were removed from public UI. Repository name and historical documentation are unchanged.

**Disclaimer hierarchy:**

- **Level A:** one dedicated `research-use.html` containing the mission's full statement verbatim: “This platform is designed for research and educational use. Its outputs are computational evidence and do not constitute clinical diagnosis. Taxonomic assignments and other scientific interpretations depend on input quality, reference databases, methods and validation. Results do not independently confirm organism identity or pathogenicity and are not validated for clinical, forensic or regulatory decision-making. Users remain responsible for independent scientific assessment and interpretation.”
- **Level B:** one short footer notice on all nine pages — “Research and educational use only. Results require independent scientific interpretation.” — linked to the policy.
- **Level C:** contextual warnings kept only on taxonomy (reference coverage/confidence), phylogenetics (hypotheses + independent validation), external execution (destination/consent) and reports (evidence quality). Generic legal copy was removed from repeated cards and panels; no scientific limitation was hidden.

Full inventory and KEEP/MOVE/SHORTEN/REMOVE decisions: `docs/PRODUCT_COPY_AUDIT.md`. A review dispute about which policy wording was canonical was resolved in favour of the **mission brief**; the audit and test constants were corrected to match.

## 4. Scientific claim corrections

- Phylogenetics meta/title/hero no longer claim a completed MAFFT → IQ-TREE execution with full provenance. Verified wording: MAFFT submission/completion was evidenced once; full multi-step execution is unverified; the workflow is not production-ready. Honest result placeholders and `production_ready: false` for `msa-phylogenetics` are unchanged.
- Removed dead `benchmark_data/RESULTS.md` references and qualified "validated output/results" copy.
- Kept consent, approval, provider governor, provenance, catalog availability statuses and all scientific limits intact. No scientific algorithms, taxonomy logic, BLAST interpretation, Galaxy logic, schema or migrations were changed.

## 5. S Bio Assistant

`assistant.html`, `css/assistant.css`, `js/assistant.js` implement a native conversational workspace: collapsible session-only conversation sidebar (new, recent, search, rename, delete, clear, project context), message timeline with assistant avatar and safe DOM-based Markdown/code/table rendering, copy/retry, suggested prompts, composer with Enter/Shift+Enter, stop, loading/error/disabled states and character counter, and the shared five-item navigation/footer. Decorative icons use `aria-hidden`; informative graphics retain accessible names.

**Genuine backend integration, fail-closed:** `functions/api/assistant/index.js` and two explicit `worker.js` routes provide `GET /api/assistant/status` and `POST /api/assistant/chat`. The full scientific system instruction is present server-side but unused. Input validation, size/message limits, typed errors and no credential disclosure are implemented. There is **no canned or regex "AI" reply**.

**Exact blocker:** the only chat-capable adapter is 9Router (`providers/ninerouter/index.js`), requiring `NINEROUTER_ENABLED=true`, `NINEROUTER_BASE_URL` and `NINEROUTER_API_KEY`. `wrangler.toml` sets both `NINEROUTER_ENABLED` and `SMARTSBIO_ENABLED` to `false` in production and staging; M7.1 evidence records no deployed provider secrets and a live `403 Provider 'ninerouter' is disabled`. `AI_LLM_PROVIDER` is Python-engine-only and unread by the Worker. The mission forbids enabling disabled providers or adding credentials. Therefore **AI chat is NOT operational**: status reports `available:false`, reason `no_enabled_llm_provider`; chat returns 503 `assistant_provider_unavailable` with `generated:false` and no reply. Conversations are in-memory for the tab only; no durable ownership is claimed. Full design: `docs/ASSISTANT_UX_DESIGN.md`.

## 6. Tests and verification

| Suite | Result |
| --- | --- |
| `npm test` (web-platform) | **515 pass / 0 fail** (505 baseline + 10 assistant) |
| `node tests/workspace.e2e.mjs` | PASS |
| `node tests/phylo_page.e2e.mjs` | PASS |
| `node --test tests/uiux_browser.e2e.mjs` | 10 / 0 |
| `node --test tests/assistant.test.mjs` | 10 / 0 |
| `node --test tests/m7_4_2_browser.e2e.mjs` | **9 / 0** — all nine pages, naming/nav/logo/favicon/footer, exact policy text, phylo honesty, fail-closed assistant UI, 9×5 viewport overflow, keyboard/mobile/reduced motion, contrast, asset loading, offline-only |
| Python `pytest` | **244 passed** with `SMARTBIO_PLUGIN_DIR_TRUSTED=1` (worktree under system temp) |

Real staging API probe: `/api/assistant/status` → 200 with `available:false`, `reason:"no_enabled_llm_provider"`, eight stages `not_started`; `/api/assistant/chat` → 503 with `type:"assistant_provider_unavailable"`, `generated:false`, no `reply`/`choices`/`usage` and no secret or flag values. `/api/tools` still returns 200.

## 7. Screenshots and accessibility

Before/after and responsive evidence is tracked under `docs/m742-screenshots/` (98 PNGs), including brand proof renders, nine pages × five viewports (1440×900, 1280×800, 768×1024, 390×844, 360×800), assistant desktop/mobile/sidebar, research-use page, footer captures and M7.4.1 baseline copies. All nine public routes and SVG assets returned HTTP 200 on staging; the real browser showed correct product naming, no console errors and no horizontal overflow.

`docs/M7_4_2_ACCESSIBILITY.md` records pass/fail per item, contrast arithmetic, keyboard/focus/aria-live checks and the resolution of the decorative-SVG advisory. All purely decorative inline SVGs carry `aria-hidden="true"` (29 total); the informative schematic and logo images keep their accessible names. This is **not** a WCAG certification or a claim that AI chat works.

## 8. Remaining limitations

- AI chat requires owner authorization of a server-side model provider; no real assistant response has been received, so chat is explicitly incomplete by the acceptance rule.
- Conversations are session-only in the current tab; no durable history or human-account ownership exists.
- Streaming, server-side cancellation and per-user chat quotas are not implemented; Stop only aborts the browser request.
- Manual screen-reader, 400% zoom and real-device testing were not performed.
- 16S capability remains marked `production_ready: true` in the workspace catalog; this pre-existing label reflects the working browser/local-agent tools and was left as an explicit reviewer decision.
- `office-status.cmd` is absent on this machine, so no dashboard status updates were written.
