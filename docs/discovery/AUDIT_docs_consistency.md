# AUDIT: Documentation consistency (read-only discovery)

**Agent:** DOCUMENTATION-CONSISTENCY AUDIT
**Date:** 2026-11-24
**Repo root (all paths below are relative to it):** `smart-bioinformatics-toolkit-milestone-0.5.0/smart-bioinformatics-toolkit`
**Method:** read every file under `docs/**` (20 tracked docs plus the concurrently-created `docs/discovery/*`), `README.md`, `THIRD_PARTY_NOTICES.md`, the full file tree, and `git log --oneline -15` / `git status --short`. Key source files were inspected to verify claims. No files were modified except this report. Tests were **not** executed (read-only scope), so all test counts below are *documented* counts, not independently re-measured.

---

## 1. What the delivery / milestone docs claim was delivered

### `docs/MILESTONE_0.5.0.md` (milestone 0.5.0, 27 lines)
Claims (`:3-11`): cited difficult groups in `shared/difficult-groups.json`; paired Python/JS verdict logic (`verdict.py`, `verdict.js`, generated `difficult-groups.js`) verified by shared fixtures; additive `verdict` + `verdict_counts` + `verdict_settings` keys; a taxonomy page with verdict banner, screening inputs and CSV columns; CLI `taxonomy`, `benchmark-queries`, `benchmark-eval`; benchmark query generator + evaluator; "Python 93+ and JavaScript 47 passing at hand-off" (`:11`). "Verified" (`:13-16`): both suites pass on Linux (Python 3.12 / Node 22 era) and CLI smoke tests. "Not verified" (`:18-27`): **"No real benchmark has been run"** (`:20`), browser UI not exercised in a real browser (`:21`), curator review needed, **Escherichia/Shigella absent** (`:23`), binary threshold, circular parent link in `taxonomy_map.tsv` (`:25`), `--online` mock-only, illustrative taxids.

### `docs/PROJECT_SUMMARY.md` (labelled "Milestone 1.0.0", `:1`)
Claims (`:3-24`): field = 16S rRNA isolate identification; gap = top-hit/cutoff name wrong relatives and need an "insufficient evidence" outcome; evidence = **real NCBI BLAST+ 2.17.0+ local execution against 26,888 records**, taxdump + accession→taxid extraction, downloads/dates/URLs/SHA-256 in `benchmark_data/RESULTS.md` (`:10-12`), fixed seeds, 3 seeds × 200 queries, 500 nt, 0.5% substitutions; results = "REAL numbers" held-out top hit 143.3 wrong/200 (100% call rate), cutoff 38.0 wrong/87.7 calls, verdict 12.7 wrong/49.7 calls, 150.3 abstentions, wrong-rate-among-calls 0.717/0.431/0.257; noisy 9.0/9.0/1.3; honest takeaway "more conservative, not more accurate" (`:17`). Limits (`:20-23`): header truth, one release, simulated noise, first 500 nt, group containment 0, frontend unit-tests only with pages.dev TLS rejection, curator review pending. Architecture Mermaid at `:25-41`.

### `docs/ORCHESTRATION_LOG.md`
Wave 0/G0 (`:3-7`): contracts frozen, baseline Python 126 / JS 102, clean tree on branch `phase-1-robustness-safety`, prior reviewer PASS WITH NOTES, gate frozen. Wave 1/G1 (`:9-14`): literature review (109 lines; PMID corrected to 24505072; full text UNVERIFIED), API catalog (9 candidates; ADOPT BLAST URL API + RefSeq; REJECT RDP), expert questions pending, indel option + expanded benchmark "running in background", G1 accepted pending citation checker. G3 (`:17-20`) is marked **"in progress"**: 5 conditions × 5 seeds × 200 queries, first condition complete, "remaining 4 conditions still running". Citation check (`:23-27`): "Re-opened 44 official URLs: 77 VERIFIED, 3 PARTIAL, 2 UNVERIFIED, 2 N/A", G1/G7 accepted, "G7 ledger: 77 verified entries".

### `docs/LOOP_LOG.md`
Six loops plus three phase checkpoints. Loop 1 (`:3-27`): audit hand-off Python 106+1 skip / JS 52; **Playwright QA of `taxonomy.html`** with 3 verdict banners, JSON/CSV downloads, print button; report-metadata parity. Loop 2 (`:28-38`): 8 verdict edge cases, name normalization, near-threshold caution; 108/52. Loop 3 (`:39-42`): `scripts/run_benchmark.py`. Loop 4 (`:43-47`): **added Escherichia/Shigella group** from PMC8441030. Counts 116/60 (`:49-50`), Loop 5 baseline 116+1 skip/60 (`:52-69`), Phase 0-2 (`:70-100`): **"REAL benchmark (executed and saved)"** — BLAST+ installed, three downloads with hashes dated 2026-11-24, taxonomy map with 26,888 pairs, 3-seed held-out and noisy results matching PROJECT_SUMMARY, raw outputs/RESULTS.md under `benchmark_data/`; Python 120 passed / JS 63 (`:93-95`). Phase 3-6 checkpoint (`:102-125`): synthetic risk-coverage sweep; real production sweep not done; Phase 4 sourced additions not done; Phase 5 mock-only Pages Functions, static preview deployed, D1 `database_id` still a placeholder, live browser blocked by TLS; Phase 6 docs added; **final counts Python 123 / JS 102** (`:120-122`); remaining risks list (`:124-125`).

### `README.md`
Scope (`:1-16`): "RESEARCH AND EDUCATION USE ONLY — NOT A CLINICAL DIAGNOSTIC DEVICE"; framework-free browser app + Python CLI for FASTA checks and 16S BLAST evidence; local validation, opt-in remote BLAST via Pages Functions + D1. Claim provenance (`:18-43`): ledger mapping; benchmark numbers "copied verbatim from `benchmark_data/RESULTS.md` … **not tracked in git** and must be obtained separately" (`:23-25`); 10-row claim table. Quickstart (`:45-152`): test commands, static serving, 8 CLI commands (`:113-114`), reproduction chain, note that no `rankedlineage.dmp` exists in the 2026-11-24 taxdump. Deployment (`:154-186`): live preview at `4e5048a8…pages.dev`, D1 placeholder to replace, MOCK mode, "No live NCBI request was exercised" (`:184`). Architecture (`:188-206`). Limitations and benchmark tables (`:208-260`) with the same held-out/noisy numbers. Layout (`:319-332`) and contributor rules (`:334-346`).

### `THIRD_PARTY_NOTICES.md`
Audited 2026-11-24 (`:3-8`): runtime deps Biopython 1.88, pandas 2.3.3, bundled `ncbi-blast-2.17.0+-win64.exe` with **UNVERIFIED in-repo licence/checksum** (`:14-16`); transitive deps (`:22-28`); dev-only pytest 8.4.2, playwright 1.65.1 (`:32-39`); no runtime npm deps (`:41-45`); caveats on uncommitted datasets and unpinned Python ranges (`:47-57`).

---

## 2. Cross-check against the repository: concrete discrepancies

Tree facts: no `benchmark_data/` directory; no reference FASTA, taxdump, `accession2taxid.tsv`, `results.md` or D1 id in the tree. `git log --all -- benchmark_data` returns **no commits** (never tracked). `git status --short` shows a clean tracked tree; only new untracked discovery/vision docs exist. Branch is `phase-1-robustness-safety`; HEAD `64f6c15` "G5: red-team fixes …".

| # | Severity | Discrepancy | Evidence |
|---|---|---|---|
| D1 | **Critical** | "No real benchmark has been run" vs "REAL benchmark (executed and saved)". The two claims coexist in the *same delivery*. | `docs/MILESTONE_0.5.0.md:20`, `docs/OPENCODE_HANDOFF_PROMPT_0.5.0.md:35` **vs** `docs/PROJECT_SUMMARY.md:10-17`, `docs/LOOP_LOG.md:83-91`, `README.md:116-152,239-260`, `docs/DEMO_SCRIPT.md:19-46`. |
| D2 | **Critical** | All "verified real numbers", download hashes and the 26,888-record DB are sourced to `benchmark_data/RESULTS.md`, which is absent from the repo and was never committed. Every "verified" benchmark figure is therefore unverifiable from this tree; `README.md:25,120-122` admits the gap but `PROJECT_SUMMARY.md:14-17` and the slides present the numbers as delivered fact. | `README.md:23-25,116-122`; `docs/PROJECT_SUMMARY.md:11,15`; `docs/SLIDES_OUTLINE.md:3-7`; tree listing; `git log --all -- benchmark_data` empty. |
| D3 | High | Difficult-group membership contradicts itself: milestone says Escherichia/Shigella "deliberately absent"; shipped `shared/difficult-groups.json` contains **three** groups including `escherichia_shigella_complex`. | `docs/MILESTONE_0.5.0.md:23` vs `shared/difficult-groups.json` (3 groups), `docs/LOOP_LOG.md:43-47`, `README.md:213-219`, `docs/EXPERT_REVIEW_REQUEST.md:24`. |
| D4 | High | Browser verification: milestone says UI "not exercised in a real browser"; LOOP_LOG documents Playwright QA with 3 verdict banners, downloads and print button. The *accurate* narrower claim is that only the **live pages.dev** page was not browser-verified (TLS rejection). | `docs/MILESTONE_0.5.0.md:21` vs `docs/LOOP_LOG.md:9,56,81`; live limitation at `docs/LOOP_LOG.md:115`, `README.md:157-160`. |
| D5 | High | Test counts irreconcilable: 93+/47; 106+1skip/52; 108/52; 116/60; 120/63; 123/102; 126/102. No doc gives an authoritative current count; HEAD adds tests (`64f6c15`) not reflected anywhere in the docs. | `docs/MILESTONE_0.5.0.md:11`, `docs/LOOP_LOG.md:6-8,36-37,49-50,54,93-95,121-122`, `docs/ORCHESTRATION_LOG.md:5-6`, `git show --stat 64f6c15`. |
| D6 | High | Version mismatch: code declares **0.1.0** while docs label the delivery 0.5.0 and 1.0.0. | `python-engine/main.py:32,453` (`"tool_version": "0.1.0"`), `web-platform/package.json:4` (`"version": "0.1.0"`) vs `docs/MILESTONE_0.5.0.md:1`, `docs/SCIENTIFIC_RULES.md:41`, `docs/EXPERT_REVIEW_REQUEST.md:4`, `docs/PROJECT_SUMMARY.md:1`, `docs/DEMO_SCRIPT.md:1`. |
| D7 | Medium | `ORCHESTRATION_LOG` is frozen mid-workflow ("G3 not yet complete", 4 conditions "still running") although `LOOP_LOG` Phase 2/3-6 marks the benchmark and documentation done. G0 baseline 126/102 conflicts with LOOP_LOG's final 123/102. | `docs/ORCHESTRATION_LOG.md:5,17-20` vs `docs/LOOP_LOG.md:83-125`. |
| D8 | Medium | Threat model gaps G3/G4/G6 are **fixed in code** after the threat model was written, but the doc still lists them as open. `CSV guard` modules exist, `benchmark.html` now loads an external module, `report.js` escapes `'`. G1/G2/G5/G7/G8 remain listed and were not re-verified here. | `docs/THREAT_MODEL.md:90-100,71-72,115-125,203-216` vs `python-engine/src/smartbio/csv_safe.py`, `web-platform/public/js/csv-safe.js`, `web-platform/public/benchmark.html:34`, `web-platform/public/js/report.js:8,15`; commit order `8bd3985` (threat model) → `1b4edcd`, `faa4269`, `b6cbd3d` (fixes). |
| D9 | Medium | `RESEARCH_REVIEW` still says "All rows below are UNVERIFIED pending the citation checker", but the citation check is documented as complete and the ledger has reviewer-verified rows. | `docs/RESEARCH_REVIEW.md:82,84-109` vs `docs/ORCHESTRATION_LOG.md:23-27`, `docs/EVIDENCE_LEDGER.md:7-9`. (Also the log's "44 official URLs: 77 VERIFIED …" is arithmetically opaque at `docs/ORCHESTRATION_LOG.md:24`.) |
| D10 | Medium | `BENCHMARK_PROTOCOL` internally contradictory: "draft" and "No real numbers are produced by the repository" vs "Verified real pipeline (executed 2026-11-24)"; its step 4 still instructs building from `rankedlineage.dmp`, which the verified section says does not exist in the 2026-11-24 taxdump. | `docs/BENCHMARK_PROTOCOL.md:1,17-22,31,43-57`. |
| D11 | Medium | Deployment/backend overstated as complete: preview URL claimed live, but `wrangler.toml:10` is still `REPLACE_WITH_D1_DATABASE_ID`; backend mock-only, no live NCBI call, live browser not verified. | `README.md:154-186` (esp. `:169-184`), `docs/LOOP_LOG.md:111-115,124-125`, `web-platform/wrangler.toml:5-10`, `docs/PROJECT_SUMMARY.md:22`. |
| D12 | Low | Handoff prompts are stale task lists: `OPENCODE_HANDOFF_PROMPT.md:30-81` asks for the BLAST TSV analyzer (already shipped, `README.md:284-294`, `python-engine/main.py:91`); `OPENCODE_HANDOFF_PROMPT_0.5.0.md:24-32` lists 8 tasks all now complete and `:35` repeats the false "No real benchmark has been run yet". | As cited. |
| D13 | Low | `SOURCE_CODE_MAP` last reviewed 2026-11-02 and uses stale paths (`web-platform/js/fasta.js`) vs actual `web-platform/public/js/fasta.js`; lists comparator repos (Taxonova, TaxoBench, isolateR) never integrated. | `docs/SOURCE_CODE_MAP.md:16-25,74,76-83`; tree listing. |
| D14 | Low (new) | The new platform docs reference companion files not present at audit time: `docs/IMPLEMENTATION_LOG.md`, `COMPUTE_INFRASTRUCTURE.md`, `API_INTEGRATION_ROADMAP.md`, `COMPETITOR_ANALYSIS.md`. `PRODUCT_VISION.md:104` makes the implementation log mandatory for living-doc updates. | `PRODUCT_VISION.md:5,104`, `IMPLEMENTATION_ROADMAP.md:5,119`; `Test-Path` = false for all four. |

**Verified as present (not discrepancies):** the 8 CLI commands claimed in `README.md:113-114` exist (`python-engine/main.py:91,105,123,133,139,166`); `verdict.py`/`verdict.js`, `benchmark/`, `difficult-groups.js`, `csv_safe.py`/`csv-safe.js`, Pages Functions, migration, tests and `scripts/generate_results.py` all exist; `git status --short` was clean for tracked files at first inspection.

---

## 3. Documented product scope and vision; AI / agents / multi-domain / natural-language

### Pre-existing (tracked) scope
The delivered scope is deliberately narrow: **FASTA quality checks + 16S rRNA BLAST evidence interpretation for bacterial isolate identification**, research/education only, explicitly not clinical (`README.md:1-16`, `docs/PROJECT_SUMMARY.md:4`, `docs/OPENCODE_HANDOFF_PROMPT.md:9-17`, `docs/SCIENTIFIC_RULES.md:58-60`). The hard rules forbid a frontend framework, paid services, R2, BLAST+ in Workers, clinical claims, and unconsented uploads (`docs/OPENCODE_HANDOFF_PROMPT.md:9-17`; `README.md:334-346`).

**There is no AI/agent/chat/natural-language/multi-domain *product* feature anywhere in the tracked delivery.** Concrete findings:

- "Agent" always means a **development subagent / orchestration role**, never a runtime product component: `docs/CONTRACTS.md:24-37` ("Literature agent", "Backend agent", …), `docs/ORCHESTRATION_LOG.md:10-14`, `docs/EVIDENCE_LEDGER.md:3-5`, `docs/NAME_DRIFT_NOTES.md:1`.
- The only product-adjacent "AI" string is a **rejected external API candidate**: `docs/API_CATALOG.md:163-175` — "Late candidate: AI Hero (investigated 2026-11-24, REJECT)", "the site teaches AI engineering, not UI assets or bioinformatics", "Decision: **REJECT** – not a UI asset library; no verifiable benefit" (`:169,172,174`); echoed in `docs/SLIDES_OUTLINE.md:94-95` and commit `e412fdd`.
- ML references are comparators/ cautions only: `docs/SCIENTIFIC_RULES.md:34` "Distinguish BLAST evidence from machine-learning model confidence."; `docs/SOURCE_CODE_MAP.md:21` "do not host large PyTorch models on Workers" (Taxonova); `:43` "must not be merged into one numerical score without calibration".
- No "natural language", "multi-domain", "LLM", "chat", "assistant", "prompt box", or "MCP" occurs in any tracked doc as a product capability. The corroborating UX audit states: "**There is no AI, chat, assistant, prompt or natural-language interface of any kind.**" (`docs/discovery/AUDIT_frontend_ux.md:20`; grep conclusion at `:83-99`).

### New, untracked vision docs (created during this discovery cycle, not part of the delivered product)
These *do* define the reset and must not be confused with delivered scope:

- `PRODUCT_VISION.md:3-6` — "Approved direction for the next product cycle (vision reset, 2026-11-24). Supersedes: the milestone-0.5 scope … as the *product goal*, not as code."
- `PRODUCT_VISION.md:26` — "Smart Bioinformatics AI is a modular research platform where researchers and students describe biological questions in natural language … receive an **inspectable plan, an executed analysis, validated results, and a reproducible report** — with AI used for understanding, planning and explanation, and deterministic software used for all computation."
- `PRODUCT_VISION.md:49` — explicitly honest: "Natural-language assistant, planning agent, multi-domain plugins, provenance store, validation agents, AI explanation | **Does not exist yet**".
- `PRODUCT_VISION.md:53-65` — seven target domains (sequence analysis, microbiome/metagenomics, phylogenetics, genomics, transcriptomics, proteomics, structural bioinformatics); Phase 1 ships only domains 1–2.
- `PRODUCT_VISION.md:100-104` — "AI is a planner/explainer, never the compute engine"; existing Python engine is the first execution adapter; LLM optional/pluggable with deterministic default.
- `SYSTEM_ARCHITECTURE.md:12,44,97`, `AI_AGENT_ARCHITECTURE.md:14,26,54,58,108,206-221`, `PRODUCT_REQUIREMENTS.md:16,82`, `IMPLEMENTATION_ROADMAP.md:63-74`, and `docs/discovery/RESEARCH_competitors.md:78-90,138-159` flesh out the LLM-adapter / agent / multi-domain design and the crowded competitor field.

**Conclusion:** version 0.5.0/1.0.0 documentation describes a *single-domain deterministic 16S toolkit*. The AI/agent/multi-domain/NL vision exists only in brand-new untracked strategy documents, and those documents themselves state it "Does not exist yet" (`PRODUCT_VISION.md:49`).

---

## 4. Living documents already present

| Document | What it is / currency |
|---|---|
| `docs/EVIDENCE_LEDGER.md` | Claim-provenance ledger (`claim \| URL opened \| date \| agent \| verified-by`), format at `:3`, 14 rows dated 2026-11-24 (`:7-19`). Current to the citation-check wave, but several rows remain UNVERIFIED (difficult groups `:10-12`, Kim correction `:16`, RDP `:19`) and it contains no AI/platform claims. |
| `docs/API_CATALOG.md` | Nine external-service decisions (ADOPT/INVESTIGATE/REJECT) plus the AI Hero rejection, all dated 2026-11-24 (`:1,109-123,163-175`). Its own claim ledger marks all scout claims `verified-by=UNVERIFIED` (`:125-161`), even where a reviewer verified BLAST (`:3`). Useful baseline for integration terms; needs re-verification before any new API agent. |
| `docs/ORCHESTRATION_LOG.md` | Wave/gate log (G0/G1/G3 + citation check), all 2026-11-24 (`:3-27`). **Stale**: ends with G3 "in progress" (`:17-20`). |
| `docs/LOOP_LOG.md` | Implementation/test loop log with six loops and Phase 0–6 checkpoints (`:3-125`). Most current *historical* record: final Phase 3-6 checkpoint, Python 123 / JS 102 (`:120-122`) and explicit remaining risks (`:124-125`). Does not cover HEAD `64f6c15`. |
| `docs/CONTRACTS.md` | "Frozen at Gate G0, 2026-11-24" (`:1-3`): TSV/JSON schemas, Pages API contracts, error formats, **file-ownership map for development agents** (`:24-37`). Schemas remain useful; the ownership map is a process artifact of the old wave workflow. |
| `docs/THREAT_MODEL.md` | STRIDE-lite audit dated 2026-11-24 (`:3-5`), privacy data-flow table (`:22-36`), STRIDE findings, 8 residual gaps (`:203-216`). **Partly stale** — G3/G4/G6 fixed in code (D8). |
| `docs/PRIVACY_NOTE.md` | Short data-location/retention note (`:1-21`) with residual risks; consistent with the threat model, same date; not updated for any platform/LLM data flow. |
| `docs/SCIENTIFIC_RULES.md` | Domain rules: sequence alphabets, GC, statistics, BLAST safeguards (`:3-39`), verdict layer rules incl. near-threshold (`:41-56`), research-use limit (`:58-60`), N50/L50 scope (`:62-64`). Current for the 16S module; silent on AI agents and on multi-domain evidence rules. |
| `docs/SOURCE_CODE_MAP.md` | Reuse/licence study of externals, "Last reviewed: 2026-11-02" (`:74`), plus 0.5.0 additions (`:76-83`). **Stale** paths and comparators (D13). |
| `docs/BENCHMARK_PROTOCOL.md` | "Draft" + "Verified real pipeline" (`:1,43-59`). Internally contradictory and points to untracked data (D10). |
| `docs/NAME_DRIFT_NOTES.md` | Research memo: "**NOT IMPLEMENTED / UNVERIFIED**" (`:3-6`), rule decision "Adopted: none" (`:95-112`), ledger (`:114-123`). Still accurate as a negative finding. |
| `docs/EXPERT_REVIEW_REQUEST.md` | "**Status: PENDING HUMAN REVIEW**", prepared 2026-11-24 (`:3-4`); questions on group membership, wording, 98.65% (`:20-68`). Nothing has been answered; still pending. |
| `docs/RESEARCH_REVIEW.md` | Literature evidence on 16S limits, dated 2026-11-24 (`:1-4`), 23 claims C1–C23 (`:84-109`). Marked all-UNVERIFIED (`:82`) despite later acceptance (D9). |
| `docs/DEMO_SCRIPT.md`, `docs/SLIDES_OUTLINE.md` | Demo commands/results ("Milestone 1.0.0", `DEMO_SCRIPT.md:1`) and 10-slide outline with per-number provenance (`SLIDES_OUTLINE.md:1-15`). Both derive all numbers from the untracked benchmark data (D1/D2). |
| `docs/MILESTONE_0.1.0.md`, `docs/MILESTONE_0.5.0.md` | Point-in-time milestone records; 0.1.0 (10 tests/4 tests, `:23-24`) and 0.5.0 (`:1-27`). Historical, not living. |
| `docs/OPENCODE_HANDOFF_PROMPT*.md` | Agent task prompts for 0.1.0→BLAST analyzer (`:30-81`) and 0.5.0→8 tasks (`:24-32`). Both fully superseded (D12). |
| New (untracked) | `PRODUCT_VISION.md`, `PRODUCT_REQUIREMENTS.md`, `SYSTEM_ARCHITECTURE.md`, `AI_AGENT_ARCHITECTURE.md`, `IMPLEMENTATION_ROADMAP.md` (all 2026-11-24, "vision reset"); `docs/discovery/AUDIT_*.md`, `RESEARCH_competitors.md`, `BASELINE_TESTS.md`. Roadmap declares itself a living doc (`IMPLEMENTATION_ROADMAP.md:3-5`) and calls for `docs/IMPLEMENTATION_LOG.md` (`:5,119`), which does not yet exist (D14). |

---

## 5. Current version / milestone and last documented state

- **Code version:** `0.1.0` in both CLI and web package (`python-engine/main.py:32,453`; `web-platform/package.json:4`). No code artifact declares 0.5.0 or 1.0.0.
- **Documentation versions:** "Milestone 0.5.0" (`docs/MILESTONE_0.5.0.md:1`, `SCIENTIFIC_RULES.md:41`, `SOURCE_CODE_MAP.md:76`, `EXPERT_REVIEW_REQUEST.md:4`) and "Milestone 1.0.0" (`docs/PROJECT_SUMMARY.md:1`, `docs/DEMO_SCRIPT.md:1`) coexist; `OPENCODE_HANDOFF_PROMPT.md` still describes 0.1.0 (`:19-27`). There is no single authoritative version.
- **Last documented state:** `docs/LOOP_LOG.md:102-125` "Phase 3-6 checkpoint (this session)" — synthetic risk-coverage implemented, real production sweep not done (`:104-106`), Phase 4 sourced additions not done (`:108-109`), Phase 5 Pages Functions mock-only + static preview deployed with D1 placeholder and TLS-blocked live browser (`:111-115`), Phase 6 docs added (`:117-118`), final Python 123 / JS 102 (`:120-122`), remaining risks (`:124-125`). `ORCHESTRATION_LOG.md` stops earlier at G3-in-progress (`:17-20`).
- **Actual repository state is ahead of the docs:** HEAD `64f6c15` adds fail-closed invalid mapping, malformed BLAST flags, header truth and computed group containment (11 files, 105 insertions); `b6cbd3d` redesigned the frontend and `faa4269`/`1b4edcd` fixed the security gaps. None of this is logged in `ORCHESTRATION_LOG.md`, `LOOP_LOG.md`, `MILESTONE_0.5.0.md`, `THREAT_MODEL.md` or `CONTRACTS.md`. Branch `phase-1-robustness-safety`, tracked tree clean.
- **New direction:** `PRODUCT_VISION.md:3-6` declares a vision reset superseding 0.5.0 as the *product goal* while retaining 16S as the first module; `IMPLEMENTATION_ROADMAP.md:3-4` version 1.0 living roadmap with M0 (discovery) as "this deliverable".

---

## 6. PRESERVE vs OBSOLETE under a platform vision reset

### Preserve (update in place; they are evidence, safeguards, or reusable contracts)
- `docs/EVIDENCE_LEDGER.md` — provenance discipline is directly required by the new vision (`PRODUCT_VISION.md:30,33,72`); extend it with AI/platform claims rather than replace it.
- `docs/RESEARCH_REVIEW.md` — the 16S scientific-rationale source base; keep as the first domain's literature evidence, but reconcile its UNVERIFIED status (D9).
- `docs/API_CATALOG.md` — verified terms/decisions (incl. AI Hero REJECT) are reusable when onboarding new external agents; re-verify dates before integration.
- `docs/SCIENTIFIC_RULES.md` + `docs/NAME_DRIFT_NOTES.md` — encoded domain safeguards and an honest negative finding; keep as the 16S plugin's rule set and a template for domain rule docs.
- `docs/THREAT_MODEL.md` + `docs/PRIVACY_NOTE.md` + `THIRD_PARTY_NOTICES.md` — must be **extended**, not discarded, for LLM/provenance/consent and dependency/licensing risks; first correct D8 and the unverified BLAST binary (`THIRD_PARTY_NOTICES.md:16`).
- `docs/CONTRACTS.md` — keep the data schemas and error formats as the seed of the new typed contracts; retire the "wave 1 file ownership map" (`:24-37`) as a process artifact.
- `docs/SOURCE_CODE_MAP.md` — keep the licence/reuse policy (`:53-60`); refresh review date and paths (D13).
- `docs/LOOP_LOG.md` + `docs/ORCHESTRATION_LOG.md` — retain as **historical archive** of the 0.5.0 build and gate decisions; stop treating them as current state and replace with the missing `docs/IMPLEMENTATION_LOG.md`.
- `README.md` — keep as the user-facing baseline for the existing code; rewrite the "Product scope" framing to point at `PRODUCT_VISION.md`, and remove or clearly caveat the untracked-benchmark numbers.

### Obsolete / supersede (do not carry forward as current truth)
- `docs/MILESTONE_0.5.0.md` — factually stale (D1, D3, D4, D5); keep only as a dated historical record.
- `docs/PROJECT_SUMMARY.md`, `docs/DEMO_SCRIPT.md`, `docs/SLIDES_OUTLINE.md` — all labelled "Milestone 1.0.0" and built on untracked benchmark data; they present the single-domain 16S toolkit as the *finished product*, which the vision reset supersedes. Recast as "16S module case study" before reuse.
- `docs/OPENCODE_HANDOFF_PROMPT.md` and `docs/OPENCODE_HANDOFF_PROMPT_0.5.0.md` — completed task lists with false current-state claims (D12); replace with the new roadmap.
- `docs/MILESTONE_0.1.0.md` — purely historical (superseded by 0.5.0 and the new platform).
- `docs/BENCHMARK_PROTOCOL.md` — draft/verified sections conflict (D10); consolidate into a single protocol **and** publish the benchmark data or stop presenting the numbers as verified.
- `docs/EXPERT_REVIEW_REQUEST.md` — still pending and domain-specific; fold into the 16S plugin backlog rather than a platform-wide action item.
- The `"tool_version": "0.1.0"` constants in `python-engine/main.py:32,453` and `web-platform/package.json:4` — not docs, but they must be reconciled before any "current version" claim is made.

---

## Appendix — git history used

`git log --oneline -15`: `64f6c15` G5 red-team fixes (HEAD) → `b6cbd3d` frontend/accessibility redesign → `1d8f4d5` slides outline → `b3b1623` README refresh → `e412fdd` AI Hero REJECT → `60335a9` privacy note → `faa4269` CSV guards/report escaping → `1b4edcd` CSP-safe benchmark page → `266423a` citation fixes → `8bd3985` threat model/notices → `1d42ca2` G3 note → `992ae3d` benchmark protocol → `1fff876` name-drift notes → `0cbb2ec` ledger corrections → `f54f151` literature review + API catalog. Full history is 28 commits; the roots are `4e47ec6` "initialize repository at milestone 0.5.0 baseline", `beec4a4` "real NCBI 16S benchmark with 3 baselines", `a4fdae8` "G0: freeze contracts". `git status --short` was clean for tracked files; the new vision/discovery docs are untracked.
