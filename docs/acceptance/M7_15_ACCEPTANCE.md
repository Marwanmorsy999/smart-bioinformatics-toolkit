# M7.15 Product Acceptance Evidence

Concise acceptance record. **No scientific jobs submitted; no production/staging or D1 changes; no new provider/model calls.**

- Branch `sync/m7-15-github-source-of-truth`, starting HEAD `f5ecbc55680e3040032a92c3859c286fb38759e6`, worktree `D:\DevCache\Temp\github-sync`.
- Environment: isolated read-only local preview `scripts/m715-preview.mjs` (no D1/secrets/provider; GET-only; 405 writes; `{}`/404 unsupported API). **This is read-only preview data, not live production.**
- Viewports tested in Chromium: desktop 1440×900, tablet 768×1024, mobile 390×844. 24 page renders + 1 download.

## Workflow acceptance results

| # | Workflow | Result used | Finding |
|---|----------|-------------|---------|
| 1 | **Homepage & sequence analysis** | Static app; FASTA validation/stats/exports; empty/error states | Navigation/entry points render; no overflow; no console errors. Valid/invalid validation covered by `npm test`. Export names wired. (Offline; no scientific backend call.) |
| 2 | **16S identification** | Offline fixtures + mocked NCBI lifecycle | Honest partial/unavailable where no valid RID/verified result; deterministic plan; consent + submission gate present; **no real NCBI PUT**. |
| 3 | **Phylogenetics** | Fixtures + recovered runs; no Galaxy submit | FASTA validation; tool-version plan; approval gate; progress; tree SVG; support/metric/interpretation; downloads/checksum; reopen/recovery. **Phylo E2E PASS.** |
| 4 | **Protein annotation** | Genuine stored annotation fixtures | Validation/plan; Route A/B availability labels; genuine evidence + architecture viewer; table+detail; interpretation/report/exports/checksum; recovery/provenance. **No InterProScan submission.** |
| 5 | **Microbiome** | `job_a8817e35d7534d98` read-only snapshot | Loads directly w/o new upload/plan; 702 ASVs/34 samples/134,820 reads; taxonomy + per-sample proportions labelled; alpha; Bray–Curtis; **real PCoA**; provenance/limitations; **exports SHA-256 match**; missing honestly unavailable. |
| 6 | **Workspace** | Static + fixtures | Projects/access labels; metadata-only registration; catalog/availability; run list/detail; **demo labelled precomputed/not executed**; no D1 writes. **Workspace E2E PASS.** |
| 7 | **Research history** | Stored entries + recovery snapshot | Filters; open run; server-side recovery; artifacts/report/provenance/checksum; missing/deleted honest. (Isolated preview: `{}` fallback; no fabrication.) |
| 8 | **AI assistant** | Read-only contextual snapshot | Conversation/composer/catalog/plan/activity; provider status **unavailable** in isolated preview; **no fabricated replies; no paid LLM**. (404 resource = no provider API; honest.) |

## Browser interaction checks
Primary buttons/links, forms/validation, result panels, charts, every visible download, URL recovery params, console errors, failed requests, keyboard/focus, no horizontal overflow at all 3 viewports. **Microbiome E2E PASS** (real-coordinate PCoA, 768px/390px). Screenshots: `docs/acceptance/evidence/*.png`. `results.json` in same folder.

## Export / checksum
`feature-table.tsv` downloaded in Chromium: `72865` bytes, SHA-256 `ba92b7020d63f5679c43c79832f9c6a2c244faed2b4ef824fdec746b06c0f697`, matches stored `ba92b7020d63…`. Other 7 exports checksum-match in snapshot. No invented data.

## Console / network status
Microbiome, homepage, workspace, history, phylo, protein, 16S: no console errors, no failed requests, no overflow. **Assistant (isolated preview):** `HTTP 404` resource notices + honest unavailable (no model provider); page renders; no `requestfailed` network failures; no fabricated output. No `pageerror`.

## Defects found & fixed
No P0/P1 defects found in this acceptance pass; no scientific/security/privacy regression. **No code fixes.** Only acceptance evidence committed. (Earlier PR-readiness fixes in `f5ecbc5`.)

## Tests (exact counts)
`npm ci` clean + `npx playwright install --with-deps chromium` + `npm test`: **1041/1041**. E2E: microbiome/phylo/workspace PASS. `git diff --check` 0. Plugin compliance + `24 passed`. Python suite on local Python 3.14 not green (baseline; CI 3.11 passed previously; no Python change). `SMARTBIO_PLUGIN_DIR_TRUSTED=1`. 

## Remaining limitations
Isolated read-only preview: no live provider/model, no writable API, no D1; original raw `.qza` not proxied; historical `Cloudflare Pages` docs labelled legacy; Python 3.11 CI vs local 3.14; assistant provider availability honest. No production/staging/D1/secret/provider/scientific service modified.
