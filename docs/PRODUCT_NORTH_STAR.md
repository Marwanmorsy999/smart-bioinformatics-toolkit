# Product North Star â€” CORE PRODUCT COMPLETION

**Verification date:** 2026-11-26
**Branch:** `product/core-completion`
**Base commit:** `8105956c908ea6c0d5c053b5ed2c13b86516d2a2`
**Starting commit (M7.6 reconciliation):** `0303e615e4cdf71a9b97038773a537beab9acdb9`
**Final commit:** `543358f8aa466b78fa8fab8c78eb2392e40f5881` (M7.6 code fix + documentation reconciliation)
**Current staging deployment:** `c00c6245-c91e-4bc2-9b64-881677b97972`
**Status:** P0/P1 product guidance. This document is a **documentation-only** artifact: this worker changed no HTML/CSS/JS/config/migration. A separate code-fix worker is adding the corrected NCBI database identifier and 16S readiness changes after the starting commit; none of that code is claimed here.
**CURRENT implementation snapshot:** branch `product/core-completion`, base `8105956â€¦`, starting commit `0303e615â€¦`, staging deployment `c00c6245-c91e-4bc2-9b64-881677b97972`, verification date 2026-11-26. Earlier snapshot statements (tree at `8105956`, concurrent uncommitted `public/assistant.*`, `worker.js`, `/api/tools/catalog`, `providers/tools/` files) were accurate for the M7.5 documentation pass and are retained below as **history**, not as the current state. Earlier staging deployments `892f4266-2afa-4a0f-aa3f-00585764faf5` and `ed08189a-5db2-41b1-98f3-732b5c97992f` and earlier branch HEAD `32abf86e6ab8da6819454103286c06e0b62d1076` are **history only**.

**Authority:** This document states product direction. Where it describes code, the cited file is the evidence; where it describes a target, the word **TARGET** is explicit. Existing historical documents (`PRODUCT_VISION.md`, `PRODUCT_REQUIREMENTS.md`, `SYSTEM_ARCHITECTURE.md`, `AI_AGENT_ARCHITECTURE.md`, `COMPUTE_INFRASTRUCTURE.md`, `API_INTEGRATION_ROADMAP.md`, all M7.4/M7.5 reports) are retained as evidence and are not rewritten.

---

## 1. The product in one sentence

> A researcher asks a biological question in ordinary language, attaches their own data, reviews an inspectable plan, explicitly approves it, and receives **real tool output, independent validation, an evidence-bounded explanation and a reproducible report** â€” with AI confined to conversation, planning and phrasing.

This is the vision reset already recorded in `PRODUCT_VISION.md:22-33,101-105` and the hard pipeline in `SYSTEM_ARCHITECTURE.md:11-17`. It is **not** "an AI that does science by itself" (`PRODUCT_VISION.md:28`).

### 1.1 The product principle (division of labour)

| Role | Owns | Does **not** own | Evidence |
|---|---|---|---|
| **Assistant = conversational interface** | Understand a request, ask clarifying questions, suggest/review a plan, phrase an explanation, navigate to existing pages. Every reply is marked `evidence_status:"unverified"`, `validated:false`. | Scientific values, validation, approval, consent, execution. | `docs/ASSISTANT_UX_DESIGN.md:56-69,142-153,278-292`; `web-platform/functions/api/assistant/index.js:1-7,14-56,96-104` |
| **Scientific engines = real computation** | FASTA validation, statistics, BLAST TSV parsing, taxonomy consensus/verdict, MSA/tree/report. Numbers come only from executed tools. | Prose claims about their own correctness. | `PRODUCT_VISION.md:30,101`; `AI_AGENT_ARCHITECTURE.md:8-14,150-157`; `web-platform/functions/api/ai/registry.tools.generated.js:5-772` |
| **Worker = orchestration** | Routing, request/dataset identity, plan persistence, approval gate, job queue, consent tokens, provenance, report serving, typed errors, security headers. Heavy science never runs here. | BLAST/aligners/statistics over large data. | `web-platform/worker.js:1-7,129-197`; `COMPUTE_INFRASTRUCTURE.md`; `PRODUCT_REQUIREMENTS.md:113,120-121` |
| **Validators = verification** | Schema conformance, internal consistency, suspicious-output detection, threshold sanity, completeness gate before `succeeded`; cannot rewrite values. | Interpretation or invention of results. | `PRODUCT_REQUIREMENTS.md:69-73`; `AI_AGENT_ARCHITECTURE.md:159-171`; `docs/M7_4_WORKSPACE_DESIGN.md:94-106` |
| **Workspace = organization** | Projects, dataset **metadata**, run history, 11-state lifecycle, provenance and report lookup. Owner-scoped on a derived token principal, not human accounts. | Byte durability, execution, multi-user identity. | `docs/M7_4_WORKSPACE_DESIGN.md:3,19-27,57-61,112-126`; `docs/M7_4_FINAL_REPORT.md:38-49,92-99` |

**Invariant chain:** conversation â†’ context â†’ plan â†’ approval â†’ execution â†’ validation â†’ explanation â†’ report. Later stages cannot be reached from earlier ones without the intervening record (`SYSTEM_ARCHITECTURE.md:13,150-152`).

---

## 2. The 14-step researcher journey (program mission)

The mission brief that frames the CORE PRODUCT COMPLETION program is external to this tree; no file in the worktree contains its verbatim 14-step wording. The canonical product reading of that brief, reconciled with the repository's documented pipeline (`SYSTEM_ARCHITECTURE.md:1,آ§4`; `IMPLEMENTATION_ROADMAP.md:9-13`; `PRODUCT_VISION.md:88-97`), is below. Each step is marked with its **actual** state in this branch. Nothing here is claimed as implemented without a cited file.

| # | Step | Researcher action | System response | Current state / evidence |
|---|---|---|---|---|
| 1 | **Arrive** | Opens the public site | Static UI served through the Worker `ASSETS` binding under strict CSP | **WORKS** â€” `web-platform/worker.js:232-251`; `web-platform/public/_headers`; `docs/M7_4_2_FINAL_POLISH_REPORT.md:65` |
| 2 | **Orient** | Reads what the platform can and cannot do | Honest catalog, research-use policy, limitations | **WORKS** â€” `web-platform/functions/api/workspace/catalog.js:5-50`; `web-platform/public/research-use.html:43`; `docs/M7_4_2_FINAL_POLISH_REPORT.md:29,37` |
| 3 | **Ask** | Types a biological question | Request text captured; intent inferred by deterministic rules | **WORKS (deterministic only)** â€” `POST /api/ai/requests` at `web-platform/functions/api/ai/requests/index.js`; plan/intent at `web-platform/functions/api/ai/planner.js`; `AI_AGENT_ARCHITECTURE.md:58-67` |
| 4 | **Attach context** | Selects or uploads a dataset / names a project | Preflight validation (format, size, alphabet); public-id project context only; no bytes to an LLM | **PARTIAL** â€” 64 KiB inline FASTA cap `web-platform/functions/api/ai/_lib.js` (`MAX_FASTA_BYTES`); public-id context `docs/ASSISTANT_UX_DESIGN.md:189`; workspace dataset registration is metadata-only |
| 5 | **Clarify** | Answers a follow-up about sequence type / database / threshold | Assistant asks instead of guessing; `unsupported` intent lists real capabilities | **PARTIAL** â€” deterministic planner/rules; real chat **UNAVAILABLE** (`web-platform/functions/api/assistant/index.js:91-97,134-180`) |
| 6 | **Plan** | Requests an analysis plan | Machine-readable plan with tool ids, params, egress flags, cost hints; validated against registry schemas | **WORKS** â€” `shared/schemas/plan.schema.json`; `web-platform/functions/api/ai/planner.js`; generated tool registry `registry.tools.generated.js` |
| 7 | **Review / disclose** | Reads plain-language steps and exact parameters, including third-party destinations | Plan rendered before any job row exists; destination disclosure on proposals | **WORKS (UI present)** â€” `web-platform/public/ai.html`, `public/js/ai-workspace.js`; `PRODUCT_REQUIREMENTS.md:30-34`; `docs/ASSISTANT_UX_DESIGN.md:25` |
| 8 | **Approve / consent** | Explicitly approves steps; grants per-step, scoped, short-lived consent for egress | Immutable approval rows; single-use BLAST consent token; no job without approval | **WORKS** â€” `web-platform/functions/api/ai/plans/[id]/approve.js`; `migrations/0003_blast_consent.sql`, `0004_blast_consent_unique.sql`; `SYSTEM_ARCHITECTURE.md:150-152`; `docs/DATA_TRANSPORT.md:63-64` |
| 9 | **Execute** | Waits while an approved job runs | Local Python agent polls and runs registered adapters; staged job states; legacy BLAST egress is Worker-side and consent-gated | **WORKS for local tools; UNVERIFIED for full Galaxy phylo; PARTIAL for 16S** â€” `python-engine/src/smartbio/aiagent/agent.py`; `web-platform/functions/api/ai/jobs/index.js`; `docs/M7_3_PHYLOGENETICS_WORKFLOW_REPORT.md:84-98`; `docs/M7_4_3_INTEGRATION_REPORT.md:26`. A genuine consent-governed NCBI submission produced RID `GF4KCK07016`, but that search **FAILED at NCBI** because our code used the invalid bare database `16S_ribosomal_RNA`; no real TSV was retrieved (`docs/evidence/M7_6_NCBI_DIAGNOSIS.md`) |
| 10 | **Retrieve artifacts** | Gets validated outputs | Hashes recomputed server-side; artifacts stored inline in D1; Galaxy datasets remain provider references | **PARTIAL** â€” `web-platform/functions/api/ai/jobs/[id]/result.js`; `docs/M7_5_FOUNDATION_DESIGN.md:236-248` (no durable platform-owned bytes) |
| 11 | **Validate** | Reviews flags and cautions | Generic + domain validation; `fail` blocks explanation/report; warnings visible | **WORKS** â€” `python-engine/src/smartbio/aiagent/validation.py`; `web-platform/functions/api/ai/jobs/[id]/result.js`; `PRODUCT_REQUIREMENTS.md:69-73` |
| 12 | **Explain** | Reads a bounded interpretation | Numbers copied from validated artifacts; only verified citations; abstention allowed; LLM phrasing optional and marked unverified | **WORKS (deterministic); no LLM** â€” `python-engine/src/smartbio/aiagent/explanation.py`; `docs/ASSISTANT_UX_DESIGN.md:35,327-332` |
| 13 | **Report / organize** | Downloads report, provenance and artifacts; files the run under a project | HTML/JSON/CSV/provenance from persisted rows; workspace run history and provenance record; missing report = 404 | **PARTIAL** â€” `python-engine/src/smartbio/aiagent/report.py`; `web-platform/functions/api/workspace/runs/[id]/report.js`; `docs/M7_4_WORKSPACE_DESIGN.md:61,163`; workspace metadata-only |
| 14 | **Reuse / reproduce** | Re-runs, cites and shares the analysis | Input hash, tool versions, parameters, database/release, output hash in provenance; project bundle export is **Later** | **PARTIAL** â€” provenance exists (`docs/EXECUTION_TOPOLOGY.md`); export/import is `FR-8.4` "Later" in `PRODUCT_REQUIREMENTS.md:91`; no durable byte store |

**Honest summary (reconciled 2026-11-26):** steps 1, 3, 6, 7, 8 and 11â€“12 have real implementations; step 5 (conversational intelligence) and several external-provider paths are explicitly unavailable; steps 4, 10, 13 and 14 are constrained by metadata-only storage and absent identity; step 9 is real locally but the advertised remote multi-step phylogenetics workflow is unverified. The **overall 16S end-to-end workflow is PARTIAL / `production_ready:false`** until genuine NCBI results are retrieved, validated, displayed and exported: browser-only FASTA statistics and the genuine consent-governed submission are individually verified capabilities, but the real job `GF4KCK07016` FAILED at NCBI because of an invalid database identifier and no real TSV was ever retrieved. The corrected identifier is implemented in the final commit; a corrected live submission requires **explicit owner authorization** and has **not** happened.

---

## 3. Explicit non-goals for this program

These are **not** to be delivered, activated or implied by P0/P1 documentation or UI work:

| Non-goal | Why it is out | Evidence |
|---|---|---|
| **No auth launch** | There is no human signup/login/session in this branch. The only identity is `X-Agent-Token`; workspace `owner_<hex16>` is a hash of that operator token, not a user. The B1 Better Auth work lives on a **separate, unmerged branch** and is a foundation only. | `docs/M7_5_FOUNDATION_DESIGN.md:51,154-203`; `implementation/m7-5-b1-better-auth` (branch not merged at `8105956`); `docs/M7_5_B1_IMPLEMENTATION_REPORT.md` on that branch |
| **No R2 activation** | No `ARTIFACTS` binding, no `ARTIFACT_SIGNING_KEY`; artifact endpoints fail closed. R2 remains a target behind a storage abstraction. | `web-platform/wrangler.toml:20-23`; `docs/M7_5_FOUNDATION_DESIGN.md:58-59,248` |
| **No provider activation** | `GALAXY_ENABLED`, `SMARTSBIO_ENABLED`, `NINEROUTER_ENABLED` are all `"false"` in production; staging enables Galaxy only. No credentials are available; no live Galaxy call is permitted. smarts.bio additionally requires written authorization. | `web-platform/wrangler.toml:15-18,39-43`; `providers/registry.js:25-32`; `providers/smartsbio/index.js:3-9`; `docs/M7_1_LIVE_ACTIVATION_REPORT.md:6,70-81`; `docs/ASSISTANT_UX_DESIGN.md:7,15` |
| **No production deployment** | M7.4 and M7.1 verified **staging** only; M7.5-A was design-only; this program is documentation-only. | `docs/M7_4_FINAL_REPORT.md:66-85,92-99`; `docs/M7_5_FOUNDATION_DESIGN.md:3-9` |
| **No new scientific domains** | Only sequence analysis and microbiome/16S are in scope, plus the existing phylogenetics plugin as partial. Genomics/transcriptomics/proteomics/structural remain architecture-only. | `PRODUCT_VISION.md:53-65`; `PRODUCT_REQUIREMENTS.md:126-132` |
| **No arbitrary agent execution** | The planner may name only registered tool ids; no LLM-generated shell/code is executed; no agent creates tools or approves its own steps. | `AI_AGENT_ARCHITECTURE.md:12,108-115,139-148,237-243`; `PRODUCT_REQUIREMENTS.md:40-43` |
| **No fabricated or "demo" results** | Mock/demo payloads must be labelled; unavailable states must be reported as unavailable; no silent fallback to mock or another provider. | `PRODUCT_REQUIREMENTS.md:116`; `PROVIDER_USAGE_POLICY.md`; `docs/M7_4_WORKSPACE_DESIGN.md:158-165`; `docs/ASSISTANT_UX_DESIGN.md:122,173` |

Also retained from the approved vision: no clinical/diagnostic claims, no replacement for Galaxy/QIIME/Nextflow/LIMS, no invented citations/statistics, no heavy compute in Workers, no silent third-party egress (`PRODUCT_VISION.md:79-86`).

---

## 4. Success criteria: what counts, and what does not

### 4.1 Genuine model responses (currently **not achievable**)

| Criterion | Counts as success | Does **not** count | Today |
|---|---|---|---|
| Real provider call | A deployed Worker receives a real reply from an authorized server-side model, with timestamp, environment and request/response evidence | A mocked test, a design doc, a UI shell, a client-side canned string | **FAIL** â€” `/api/assistant/status` returns `available:false`, `reason:"no_enabled_llm_provider"`; `/api/assistant/chat` returns `503` with `generated:false`; `web-platform/functions/api/assistant/index.js:91-97,106-180` |
| Authorized provider | Owner explicitly enabled an existing adapter via the supported secret flow | Flipping a flag in documentation, installing a new key, using `AI_LLM_PROVIDER` (Python-only, unread by Worker) | **FAIL** â€” `wrangler.toml:15-18,39-43`; `docs/ASSISTANT_UX_DESIGN.md:15,33-34` |
| Evidence-bounded prose | Every number resolves to a validated artifact field; every citation is in the verified ledger; abstention when insufficient | Plausible prose, unverified reference `kim2014_16s_species_threshold` presented as established | **Rule enforced in Python engine** â€” `aiagent/explanation.py`; `ASSISTANT_UX_DESIGN.md:35,93,239-240`; Worker chat marks `evidence_status:"unverified"` (`providers/chat.js:90-98`) |

### 4.2 Real execution (partially achievable)

| Criterion | Counts as success | Does **not** count | Today |
|---|---|---|---|
| Scientific value | Output artifact produced by a registered tool adapter running real Python code with recorded input hash and tool version | Precomputed sample, `is_demo:true` payload, UI placeholder, "planned" run marker | **PASS for local plugins** â€” 7 available tools in `registry.tools.generated.js` (phylogenetics.* 5, sequence-stats.* 2); `docs/M7_4_FINAL_REPORT.md:33-36`; **FAIL for remote phylo** â€” `docs/M7_3_PHYLOGENETICS_WORKFLOW_REPORT.md:88` |
| Approval before work | `approvals` row precedes `jobs` row; consent token claimed before egress | A chat message, a suggested prompt, or an assistant card treated as approval | **PASS** â€” `ai/plans/[id]/approve.js`; `docs/ASSISTANT_UX_DESIGN.md:49-51`; `docs/discovery/TEST_REPORT.md:212` |
| Honest execution label | `execution_mode` present on every response: `real` or `mock`; mock never presented as science | A self-reported `"real"` with no server-side proof | **PARTIAL** â€” `computeExecutionMode()` honours the agent's self-report unless the deployment forces mock (`functions/api/ai/_lib.js:270-281`); independent review flags this as a trust-boundary gap (`docs/discovery/REVIEW_worker_ui.md:36`) |
| Workflow production readiness | Full multi-step execution, artifact retrieval, validation and report evidenced end-to-end | One MAFFT job completion advertised as the whole workflow | **FAIL for phylo** â€” `production_ready:false` in `functions/api/workspace/catalog.js:44-48`; MAFFT once evidenced (`M7_3â€¦:84`) |
| 16S end-to-end readiness | Genuine NCBI results retrieved, validated, displayed and exported | A real RID, a queued label or a labelled synthetic TSV treated as a completed live analysis | **PARTIAL / `production_ready:false`** â€” browser-only statistics and the consent-governed submission are individually verified; the real job `GF4KCK07016` FAILED at NCBI (`Status=FAILED`, invalid database `16S_ribosomal_RNA`), no real TSV retrieved (`docs/evidence/M7_6_NCBI_DIAGNOSIS.md`). Corrected identifier is implemented in the final commit; corrected live submission needs explicit owner authorization and has not happened |
| Provenance completeness | Every tool invocation has input/output hashes, tool versions, params, timestamps; `succeeded` blocked otherwise | A run reaching `succeeded` on partial evidence | **PASS (gate exists)** â€” `docs/M7_4_WORKSPACE_DESIGN.md:94-106`; `provenance_records` written only at `succeeded` |
| Durable bytes | User bytes survive, are re-downloadable, and are under platform retention control | `d1://` text, `metadata-only://` markers, Galaxy history ids | **FAIL** â€” `docs/M7_5_FOUNDATION_DESIGN.md:236-248`; R2 not bound |

### 4.3 Honest unavailable states (the success criterion that **is** achievable now)

A correct product response today is an explicit, typed, actionable unavailability â€” not an answer:

- `GET /api/assistant/status` â†’ `{available:false, reason:"no_enabled_llm_provider", generated_at, notice, stages:[not_startedâ€¦]}` (`assistant/index.js:106-139`).
- `POST /api/assistant/chat` â†’ `503`, `generated:false`, `"No response was generated. No model provider was contacted."` (`assistant/index.js:119-131,141-180`).
- `GET /api/tools` â†’ `available:false` with `unavailable_reason` for `microbiome-16s.blast-parse` and `microbiome-16s.taxonomy` (`registry.tools.generated.js:585-586,671-672`).
- `GET /api/workspace/workflows` â†’ `msa-phylogenetics` with `production_ready:false` and the M7.3 caveat (`workspace/catalog.js:44-48`).
- Provider probes â†’ `403 feature_flag_disabled`; no fallback, no mock (`docs/M7_1_LIVE_ACTIVATION_REPORT.md:77-81`).
- The 16S workflow is reported **PARTIAL / `production_ready:false`**, not as a completed live analysis. The genuine consent-governed submission produced RID `GF4KCK07016`; NCBI's canonical `CMD=Get` response is `Status=FAILED` with the exact error `No alias or index file found for nucleotide database [16S_ribosomal_RNA] â€¦`. The FORMAT-object `Status=READY` / `ThereAreHits=no` page describes the format request, not the search (`docs/evidence/M7_6_NCBI_DIAGNOSIS.md`).
- No corrected live NCBI submission has been made: it requires **explicit owner authorization**. The mock RID `MOCK07EFC2C1AEAC02A2` is synthetic evidence only and is never cited as real. Browser BLAST parser and taxonomy are implemented and exercised with clearly labelled synthetic TSV only; they are not claims of real NCBI output, and they remain available even though the local-agent Python 16S variants are unavailable.

**Program-level definition of done:** the P0/P1 documentation is correct when a reader can (a) trace all 14 journey steps to code or to a named blocker, (b) distinguish real from unavailable in every surface, and (c) find no invented capability. Passing mocked tests or shipping UI does not satisfy criteria in آ§4.1â€“4.2.

### 4.4 Cross-reference

- Feature/screen/endpoint classification: `docs/PRODUCT_SCOPE_AUDIT.md`
- Authoritative capability ids and statuses: `docs/CORE_CAPABILITY_MATRIX.md`
- Target architecture and blockers: `docs/CORE_PRODUCT_ARCHITECTURE.md`


