# Core Product Completion Report - CORE PRODUCT COMPLETION

**Date:** 2026-11-26
**Branch:** `product/core-completion` · **Base:** `8105956c908ea6c0d5c053b5ed2c13b86516d2a2`
**HEAD at task start:** `32abf86e6ab8da6819454103286c06e0b62d1076`; this report is one of four deliverables in the follow-up documentation-only commit to be applied by the coordinating session. This worker made no commit, no deployment and no provider call.

**Staging deployment versions:**
- `892f4266-2afa-4a0f-aa3f-00585764faf5` - tool registry, assistant capability browser/plan draft, 16S flow.
- `ed08189a-5db2-41b1-98f3-732b5c97992f` - resume-by-RID monitoring without resubmission.
**Production untouched.** `MOCK_NCBI` on staging was set to `0` to permit live NCBI; no other secret or provider was activated.

**Companion deliverables:** `docs/AI_ASSISTANT_IMPLEMENTATION.md`, `docs/SCIENTIFIC_TOOL_INTEGRATION.md`, `docs/CORE_PRODUCT_TEST_REPORT.md`. The four P0/P1 guidance documents (`PRODUCT_NORTH_STAR.md`, `PRODUCT_SCOPE_AUDIT.md`, `CORE_CAPABILITY_MATRIX.md`, `CORE_PRODUCT_ARCHITECTURE.md`) remain authoritative for direction, classification, capability status and architecture; this report is the completion narrative and does not rewrite them.

---

## 1. The product narrative

The product promise is unchanged: a researcher asks a biological question in ordinary language, attaches their own data, reviews an inspectable plan, explicitly approves it, and receives real tool output, independent validation, an evidence-bounded explanation and a reproducible report - with AI confined to conversation, planning and phrasing (`docs/PRODUCT_NORTH_STAR.md` §1).

At the close of this program, that promise is **substantially delivered for the 16S identification chain and for browser-only science**, **fully delivered as an honest UI/capability surface**, and **explicitly not delivered for cloud result retrieval and AI chat**. The distinction is the point of this report: passing tests for a consent-gated mock chain or a disabled chat gateway must never be read as a real scientific result or a real model reply.

Architecture remained exactly as approved: Worker = orchestration, browser/Python = compute, validators = verification, workspace = metadata organization; `conversation → context → plan → approval → execution → validation → explanation → report` is a hard pipeline (`docs/CORE_PRODUCT_ARCHITECTURE.md` §1-2).

---

## 2. What is genuinely working

| Capability | Verified state | Evidence |
|---|---|---|
| **Public tool catalog** | `GET /api/tools/catalog` serves **12 real entries** at version `1.0.0-m7.4`, derived from the authoritative registry/workflow sources; no invented capability. | `web-platform/providers/tools/registry.js`, `functions/api/tools/catalog/index.js`; module import confirmed count and ids. |
| **Assistant capability browser + deterministic draft** | Real catalog cards, readiness chips, entry-point links and a draft assembled from registry fields. Explicitly "Deterministic draft", not AI-generated; grants nothing and executes nothing. | `web-platform/public/js/assistant.js:529-689`; screenshots `test-results/core/assistant-capability-*.png`, `assistant-plan-draft-1440x900.png`. |
| **Assistant chat UI** | Conversations, timeline, composer, keyboard/ARIA behaviour, honest unavailable banner; composer disabled; no canned replies. | `public/js/assistant.js`, `public/assistant.html`; `assistant.test.mjs` 10/10; UI E2E 10/10; M7.4.2 E2E 9/9. |
| **Deterministic planner** | Closed intent map, registered tool ids only, schema-validated params, egress/consent declarations; no LLM required. | `functions/api/ai/planner.js:10-173`, `functions/api/ai/registry.js:82-135`; live plan in `live-16s-real.json`. |
| **16S request → plan → approval → consent** | Real `POST /api/ai/requests`, explicit checkbox approval, single-use token bound to input hash/database/program, token value not displayed. | `public/js/16s-flow.js:203-279`; `blast/submit.js:69-96`; migrations `0003/0004_blast_consent`; screenshots `03-plan.png`, `04-approved.png`. |
| **Real NCBI submission** | With `MOCK_NCBI=0`, real RID `GF4KCK07016` obtained and confirmed on NCBI's own status page as "Searching". | `D:/DevCache/Temp/live-16s-real.json`, `05-submitted.png`, `06-status.png`, `trace.zip`. |
| **Resume by RID** | Existing RID can be pasted to continue status checks with no resubmission and no new consent. | `public/js/16s-flow.js:413-439`; `D:/DevCache/Temp/resume-16s.json`, `resume-trace.zip`; staging version `ed08189a-...`. |
| **Rate-limit compliant polling** | 10 s submission throttle; 60 s status gate enforced server-side (`429` + `Retry-After`) and mirrored client-side; completed/failed RIDs are never re-polled. | `blast/status/[rid].js:53-62`; `16s-flow.js:9-13,281-411`. |
| **Real TSV → table/taxonomy/provenance/downloads** | Schema detection, typed malformed-row reporting, per-query detail, conservative verdicts, provenance and labelled downloads. Exercised with clearly labelled synthetic TSV; the code path is real. | `16s-flow.js:442-624`; `public/js/blast.js`, `taxonomy.js`; `07-results.png`, `retrieved-results.tsv`. |
| **Browser-only real science** | FASTA statistics from `NR_074666.1`: 1 record, 1524 bp, GC 52.1654% (A397 T332 G475 C320), matching independent 52.17%. No provider, no local agent, no mock. | `10-browser-only-statistics.png`, `browser-only-trace.zip`. |
| **Honest synthetic labelling** | `MOCK_NCBI` produced RID `MOCK07EFC2C1AEAC02A2` and synthetic TSV; UI banner says SYNTHETIC / MOCK DATA and "NOT a real NCBI result"; downloads prefixed `mock-`. | `retrieved-results.tsv`; `16s-flow.js:319-321,483-490`; `sixteen_s.e2e.mjs`. |
| **Local scientific adapters** | 7 available local Python tools (5 phylogenetics + 2 sequence-stats), plus browser utilities; real deterministic computation. | `registry.tools.generated.js`; `python-engine/src/smartbio/plugins/`; `docs/CORE_CAPABILITY_MATRIX.md` §3. |
| **Accessibility/honesty checks** | 9/9 M7.4.2 E2E; zero fabricated assistant messages; keyboard/ARIA/contrast checks pass as automated checks. | `docs/M7_4_2_ACCESSIBILITY.md`; `tests/m7_4_2_browser.e2e.mjs`. |

Test totals by category are in `docs/CORE_PRODUCT_TEST_REPORT.md`: JS **526/526**, Python **244/244**, workspace E2E PASS, phylo E2E PASS, UI E2E **10/10**, assistant **10/10**, M7.4.2 E2E **9/9**, 16S E2E **3 pass / 1 skipped**. These are not merged into an aggregate.

---

## 3. What is blocked, and why

| Blocked / unavailable | Cause | Evidence |
|---|---|---|
| **Real NCBI result retrieval** | With `MOCK_NCBI=0`, the real RID `GF4KCK07016` stayed queued/searching on NCBI for roughly **100 minutes** of compliant ≥60 s checks. No real TSV ever became available; `GET /api/blast/results/:rid` correctly refuses until `complete` (`409`). No fabricated result was rendered. **Blocker is the external provider queue, not platform code.** | `D:/DevCache/Temp/live-16s-real.json` (final status `queued`), `resume-16s.json`, `06-status.png`. |
| **AI chat with a real model** | No authorized, reachable remote model provider exists for the Worker. `/api/assistant/status` → `available:false`, `reason:"no_enabled_llm_provider"`; `/api/assistant/chat` → 503 `generated:false`. 9Router is the only chat-capable adapter but is disabled with no URL/key; smarts.bio is disabled and needs written authorization; `AI_LLM_PROVIDER` is Python-only and unread by the Worker. | `functions/api/assistant/index.js:91-180`; `docs/ASSISTANT_UX_DESIGN.md`; `docs/CORE_CAPABILITY_MATRIX.md` §4. |
| **Remote phylogenetics (MAFFT→IQ-TREE full path)** | `production_ready:false`; a real MAFFT step completed once historically, but the full remote tree/retrieval/validation path is unverified. No live Galaxy call was permitted and no provider was activated. Local phylo adapters remain real. | `functions/api/workspace/catalog.js:44-48`; `docs/M7_3_PHYLOGENETICS_WORKFLOW_REPORT.md:84-98`. |
| **R2 durable bytes / auth B2** | No `ARTIFACTS` binding or signing key; artifact endpoints fail closed. No human signup/login/session; workspace owner is a hash of the operator token; B1 identity work is on a separate unmerged branch. Both are explicit non-goals of this program. | `wrangler.toml:20-23`; `docs/M7_5_FOUNDATION_DESIGN.md`; `docs/PRODUCT_SCOPE_AUDIT.md`. |
| **Live-path unit test** | `sixteen_s.e2e.mjs`'s live test is opt-in (`LIVE_NCBI=1` + `STAGING_URL`) and was skipped in the suite; live evidence was gathered manually instead and is reported separately. | `web-platform/tests/sixteen_s.e2e.mjs:270-278`. |

---

## 4. Stage-by-stage evidence

| Stage | What was observed | Evidence path |
|---|---|---|
| Public input | NCBI nuccore `NR_074666.1`, 1653 bytes, SHA-256 `07efc2c1aeac02a2eed1cbe8d8479b59ffa00a730e93ed65881b41069c652853`. | `01-input.png`, `02-validated.png`, `live-16s-real.json` |
| Plan | Deterministic plan `identify_taxa / microbiome-16s`, `step_1 · ncbi.blastn`, database `16S_ribosomal_RNA`, program `blastn`, egress and consent declared. | `03-plan.png`, `live-16s-real.json` |
| Approval / consent | Explicit approval; single-use consent issued with expiry; token value withheld from the UI. | `04-approved.png`, `live-16s-real.json` |
| Submission | Real RID `GF4KCK07016`; NCBI status page "Searching". | `05-submitted.png`, `06-status.png`, `trace.zip` |
| Polling | ~100 minutes of ≥60 s compliant checks; status remained queued/searching; no console errors. | `live-16s-real.json`, `trace.zip` |
| Resume | Same RID resumed for status checks without resubmission. | `resume-16s.json`, `resume-trace.zip` |
| Mock branch (labelled) | RID `MOCK07EFC2C1AEAC02A2`, synthetic TSV, SYNTHETIC/MOCK banner. | `07-results.png`, `retrieved-results.tsv` |
| Browser-only science | 1 record / 1524 bp / GC 52.1654% (A397 T332 G475 C320), independent 52.17%. | `10-browser-only-statistics.png`, `browser-only-trace.zip` |
| Assistant surfaces | 12 real catalog entries; deterministic draft; chat disabled with honest banner. | `test-results/core/assistant-capability-*.png`, `assistant-plan-draft-1440x900.png` |

All paths are under `D:/DevCache/Temp/live-16s-evidence/` unless prefixed with `D:/DevCache/Temp/core-completion/` (worktree) or given in full.

---

## 5. Branches, commits and deployments

**Branch:** `product/core-completion`; **base:** `8105956c908ea6c0d5c053b5ed2c13b86516d2a2`; **HEAD at task start:** `32abf86e6ab8da6819454103286c06e0b62d1076`.

Observed branch history at task start (short hashes from `git log`):

| Commit | Subject |
|---|---|
| `32abf86` | `feat(core): resume 16S monitoring by existing RID without resubmitting` |
| `b1a6eff` | `docs(core): product north star, scope audit, capability matrix and architecture` (the four P0/P1 docs) |
| `059a150` | `Add 16S handoff unit tests and labelled-offline browser E2E with screenshots` |
| `b6881a0` | `Add browser-only 16S NCBI BLAST workflow page and nav entry` |
| `e098c11` | `Fix 16S planner handoff to consent-gated Worker BLAST tool` |

The four documents delivered in this pass are the documentation-only commit that follows `32abf86`; no commit was created by this worker.

**Staging deployments:** `892f4266-2afa-4a0f-aa3f-00585764faf5` (registry/assistant/16S), then `ed08189a-5db2-41b1-98f3-732b5c97992f` (resume-by-RID). **Production untouched.** There was no production deploy, no migration and no credential installation in this program.

---

## 6. Design and naming preservation

- One design system only: **Precision Instrument Bench** (`docs/DESIGN_SYSTEM.md:8`, `docs/BRAND_IDENTITY.md:5`). No second design system, token set or component vocabulary was introduced.
- Names preserved: "S Bio Assistant" and its SVG mark `brand/sbio-assistant.svg`, "Smart Bioinformatics AI", the five-item nav (Tools / Research workspace / Phylogenetics / Assistant / About), and the existing page set. The 16S page uses an existing nav entry; no new top-level product name was invented.
- Copy discipline: the assistant banner, synthetic-data warning, plan disclaimer and research-use notice are the exact honest strings already used in the codebase and M7.4.2 evidence. Historical documentation is retained with status notes, not erased.

---

## 7. Scope cleanup decisions

Decisions recorded in `docs/PRODUCT_SCOPE_AUDIT.md` and honoured here:

- **KEEP** historical audits, discovery notes and M7.x reports as evidence; correct with status notes rather than delete.
- **KEEP** all test suites (`web-platform/tests/**`, `python-engine/tests/**`, `shared/test-cases/**`); no test was deleted, skipped-by-deletion or weakened to turn green.
- **KEEP** the single design system, existing page structure and brand assets; no parallel design or naming scheme.
- **NO** auth B2 launch, R2 activation, new provider, migration, scientific algorithm change, production deploy or live Galaxy call.
- **NO** new registry: `providers/tools/registry.js` is a derived read-only projection of `functions/api/ai/registry.js` + the generated manifest + `functions/api/workspace/catalog.js`, not a second source of truth.
- **NO** upgrade of partial claims: phylogenetics remains `partial`/`production_ready:false`; `microbiome-16s.blast-parse` and `.taxonomy` remain `available:false`; AI chat remains unavailable.
- **NO** merging of evidence categories: mocked, browser-only real and live records are reported separately with their own paths.

---

## 8. Remaining blockers and unfinished edges

1. **NCBI result retrieval** - the real job `GF4KCK07016` never completed within the observation window. A later retry against a new RID (with owner authorization and continued ≥60 s polling) is the only way to obtain a real TSV; none is fabricated here.
2. **AI chat** - requires an explicitly authorized, configured server-side model provider. The system instruction is ready but deliberately unused; its literal tool-id list should be reconciled to include the Worker-side `ncbi.blastn` before activation (`docs/AI_ASSISTANT_IMPLEMENTATION.md` §5).
3. **Remote phylogenetics** - needs a separately authorized Galaxy integration and a verified end-to-end MAFFT→IQ-TREE run with artifacts, validation and report; out of scope here.
4. **Durable bytes and identity** - R2 and auth B2 remain inactive by design; workspace is metadata-only with an operator-token-derived owner, not user accounts.
5. **Global submission throttle** - the 10 s NCBI submission limit is enforced client-side in the 16S flow but not centrally in the Worker (`docs/CORE_CAPABILITY_MATRIX.md`, `WR-BLAST-SUBMIT`).
6. **Cross-surface trust note** - historical independent review flagged that `execution_mode` can accept the local agent's self-report unless the deployment forces mock (`ai/_lib.js:270-281`; `docs/discovery/REVIEW_worker_ui.md:36`). No change was made in this program.

---

## 9. Verdict

**Successful:**
- Integration of a single-source 12-entry tool catalog and public `/api/tools/catalog` endpoint.
- Assistant UI, capability browser and deterministic plan draft - explicitly not AI-generated and not executable from chat.
- The complete 16S chain through real NCBI submission, consent binding, audited egress, rate-limit-compliant polling, resume-by-RID, and a real parser/validator/provenance/download surface.
- Genuine browser-only science computed from a public NCBI dataset.
- Honest labelling in every direction: mock is labelled synthetic, partial is labelled partial, unavailable is labelled unavailable.

**Blocked / not achieved:**
- **Live cloud result retrieval**: NCBI kept the real job queued/searching for roughly 100 minutes; no real result was rendered. This is an external-provider blocker, not a code defect, and it is not counted as a pass.
- **AI chat with a real model**: no authorized provider exists; the UI is complete and the gateway fails closed, but chat-operational status is **NOT ACHIEVED**.

**Final statement:** the CORE PRODUCT COMPLETION program has delivered a genuinely working, honest product surface and a real, consent-governed 16S submission pipeline with browser-only scientific computation, while transparently leaving live cloud result retrieval blocked by NCBI and AI chat unavailable for lack of an authorized provider. Mocked tests and UI completeness are not presented as substitutes for either. No production deployment, provider activation or scientific algorithm change occurred.
