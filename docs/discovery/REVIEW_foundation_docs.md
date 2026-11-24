> **Status: HISTORICAL — superseded by later verification; findings retained verbatim.**
> **Reconciliation (2026-11-24):** Blocking findings are preserved as written. A later reconciliation pass corrected `SYSTEM_ARCHITECTURE.md` status labels and storage notes (D1 today, R2 future), documented the legacy BLAST consent gate, and updated `API_INTEGRATION_ROADMAP.md` §2/§4/§7; the precise data-flow record is `docs/DATA_TRANSPORT.md`.
>
> The original review below is unchanged.

---

# Independent Review — Eight Foundation Documents (M0 deliverable)

**Reviewer:** independent reviewer agent (read-only; did not author or implement any of the reviewed content)
**Date:** 2026-11-24
**Scope:** `PRODUCT_VISION.md`, `PRODUCT_REQUIREMENTS.md`, `SYSTEM_ARCHITECTURE.md`, `AI_AGENT_ARCHITECTURE.md`, `COMPUTE_INFRASTRUCTURE.md`, `API_INTEGRATION_ROADMAP.md`, `COMPETITOR_ANALYSIS.md`, `IMPLEMENTATION_ROADMAP.md`
**Cross-checks:** `docs/discovery/AUDIT_*.md`, `RESEARCH_*.md`, `BASELINE_TESTS.md`, and actual code/working-tree state.

**Verdict: FAIL** (3 blocking issues; must fix before these can serve as an accurate baseline).

---

## 1. BLOCKING issues

### B1. Present-tense "does not exist / not started" claims are contradicted by code in the same tree
- `PRODUCT_VISION.md:49` states the assistant, planner, plugins, provenance store, validation agents and AI explanation "**Does not exist yet**", with evidence "No `AI`, `chat`, `agent`, or `prompt` UI/API in the codebase".
- `IMPLEMENTATION_ROADMAP.md:139-140` records M0 "In progress" and M1–M5 "**Not started**".
- Reality at review time: substantial, uncommitted AI-platform implementation exists — `python-engine/src/smartbio/aiagent/**` (agent.py, validation.py, explanation.py, provenance.py, report.py, plugins.py), `python-engine/src/smartbio/plugins/**`, `web-platform/functions/api/ai/**` (planner, registry, jobs, plans, runs, reports), `web-platform/functions/api/tools.js`, `web-platform/migrations/0002_ai_platform.sql`, `shared/schemas/{plan,plugin,provenance}.schema.json`, `shared/plugins/{sequence-stats,microbiome-16s}.json`, `shared/AI_PLATFORM_CONTRACT.md`, plus four `test_ai_*.py` tests and `ai_contract.test.mjs`. File timestamps (implementation 22:35–22:41) postdate the docs (22:31–22:34), i.e. the baseline went stale within the same cycle.
- This directly violates the documents' own living-article rule (`IMPLEMENTATION_ROADMAP.md:117-124`, especially `:123`: "eight foundation docs are updated if reality changed") and `PRODUCT_VISION.md:6` ("claims ... must not be upgraded without evidence"). Fix by scoping the baseline explicitly "as of M0 kickoff" or updating it to the current state.

### B2. Contradictory ownership of agent/component responsibilities
- `SYSTEM_ARCHITECTURE.md:96` assigns "Projects, datasets, NL request records, conversation state" to the **Request manager**; `AI_AGENT_ARCHITECTURE.md:194` assigns "projects, datasets, request history ..." to the **Project Manager (10)**. Two components claim the same responsibilities.
- `SYSTEM_ARCHITECTURE.md:99` assigns "approval tokens/expiry" to the **Consent service** and `:106` "approvals, egress, failures" to the **Audit log**, while `AI_AGENT_ARCHITECTURE.md:194` says Project Manager owns "approvals ... and audit events". The single-writer/immutability rules (`PRODUCT_REQUIREMENTS.md:90`, `:113`; `AI_AGENT_ARCHITECTURE.md:196`) become ambiguous. Reconcile the control-plane component table with the 10-agent contract (10 components are otherwise all present, which is good).

### B3. M0 exit criterion is unmeetable/unverifiable as written
- `IMPLEMENTATION_ROADMAP.md:21` requires "Evidence with file:line citations exists for **all 7 audit areas**", but the same cell lists only 5 (code/UX/API/infra/docs) and `docs/discovery/` contains only **4** `AUDIT_*.md` files (`api_infra`, `backend_science`, `docs_consistency`, `frontend_ux`) plus 3 `RESEARCH_*.md`. State the actual number/areas (and produce the missing evidence) so the milestone is measurable.

---

## 2. Non-blocking issues

### Epistemic honesty / overstated claims
- `COMPETITOR_ANALYSIS.md:27` presents "usegalaxy.org quota 250 GB/account" under "Pricing details (**verified** 2026-11-24)", but its own source (`RESEARCH_competitors.md:45`) tags this **[V-S] snippet-only**; the same doc's table at `:22` correctly tags it **[V-S]**. Internal inconsistency; do not upgrade snippet-only to verified.
- `COMPETITOR_ANALYSIS.md:52` correctly flags all benchmark figures as UNVERIFIED (source `benchmark_data/RESULTS.md` absent), yet `:66` says "Retain the existing benchmark as a first-class demo artifact; it is our most credible public evidence." Soften or condition on regeneration. (Vision `:72` handles this correctly.)
- `COMPUTE_INFRASTRUCTURE.md:11` quotes "100 MB incoming and 100 MiB outgoing body" as Worker limits; `RESEARCH_compute_infra.md:24-25` scopes incoming to the *zone* plan (100/200 MB/up to 5 GB) and the 100 MiB cap to **Durable Object / Container outbound**, not a generic Worker request. Minor misattribution.
- `API_INTEGRATION_ROADMAP.md:55` "3 req/s → 10 req/s (enforced since 2018)" adds a date not present in the cited source (`RESEARCH_bio_databases.md:54` cites a 2017 post). Minor.

### Differentiators with no implementation plan ("impressive-looking feature" test)
- **Education mode** is a headline differentiator (`PRODUCT_VISION.md:75`; `COMPETITOR_ANALYSIS.md:55`, D5) but has **no FR ID, no milestone, no acceptance test** anywhere in `PRODUCT_REQUIREMENTS.md` or `IMPLEMENTATION_ROADMAP.md`. Either plan it (FR + M-task + test) or drop it from the differentiator list. Positive: the one actual inert UI control, the "BLAST coming soon" tile (`AUDIT_frontend_ux.md:135-142`), *is* explicitly scheduled for removal in `IMPLEMENTATION_ROADMAP.md:70` — good.
- **"Locality receipt"** (`PRODUCT_VISION.md:73`; `COMPETITOR_ANALYSIS.md:53`; `COMPUTE_INFRASTRUCTURE.md:113`) is claimed as a differentiator but is not a testable FR in `PRODUCT_REQUIREMENTS.md` (provenance FR-8.2 only partially covers it). Also note the design at `COMPUTE_INFRASTRUCTURE.md:52` ("sequences stored in the browser until a job is approved, then written to the agent workspace") is contradicted by actual `0002_ai_platform.sql`, which stores inline `fasta_text` in D1 — a privacy/locality design divergence worth resolving.

### Doc-vs-code drift (docs predate implementation; update next revision)
- API paths: docs use `/api/jobs` and `/api/jobs/:id/result` (`SYSTEM_ARCHITECTURE.md:130,139,195,196`; `COMPUTE_INFRASTRUCTURE.md:66,68`); code uses `/api/ai/jobs` and `/api/ai/jobs/:id/result` (`aiagent/agent.py`).
- Plan example invents tool IDs/params: `AI_AGENT_ARCHITECTURE.md:93,97` use `microbiome-16s.blastn` with `database`/`evalue`; the registry/manifests define `microbiome-16s.blast-parse` and `.taxonomy` over TSV text, and `sequence-stats.validate`/`.profile`.
- Job states: `AI_AGENT_ARCHITECTURE.md:142` includes `planned`; `PRODUCT_REQUIREMENTS.md:60` starts at `queued`.

### Internal consistency / clarity
- `AI_AGENT_ARCHITECTURE.md:218` typo `OpenAIBcompatibilityProvider` (probably `OpenAICompatibilityProvider`).
- `PRODUCT_VISION.md:6` defines evidence tags VERIFIED/PARTIAL/ASSUMED, but companion docs use other schemes (IMPLEMENTED/LIVE-VERIFIED/CATALOG-ONLY/REJECTED; VERIFIED/PARTIAL/UNCERTAIN/NOT VERIFIED) and the vision's own differentiator claims (`:69-76`) are untagged. Standardise on one vocabulary.
- `IMPLEMENTATION_ROADMAP.md:71` "Full 9-step flow" is undefined; the pipeline is described as 6 stages (`SYSTEM_ARCHITECTURE.md:13`) or 8 steps (`PRODUCT_VISION.md:92`).
- `PRODUCT_REQUIREMENTS.md:12` cross-references `docs/plugins/<domain>/`, which does not exist (planned path). No other broken file cross-reference found; all referenced `docs/*.md`, schemas and manifests exist.
- Mermaid: no definitive syntax errors by inspection in the 5 diagrams. The compact dotted-link-with-label form (`-.optional.->` `SYSTEM_ARCHITECTURE.md:71`, `-.future.->` `COMPUTE_INFRASTRUCTURE.md:47-48`, `-.needs.->` `IMPLEMENTATION_ROADMAP.md:98-100`) is renderer-sensitive — validate once with a Mermaid renderer. `SYSTEM_ARCHITECTURE.md:63` `LOCAL` is an unconnected node.

---

## 3. What the documents get right
- All 10 required architecture components are present and named (`AI_AGENT_ARCHITECTURE.md:22-37, 58-196`); coverage is traceable.
- Plan-before-execute, per-step consent, immutable plans/approvals, no-fabrication (citation + number checkers), abstention, and "LLM never computes" are enforced as normative, testable rules throughout (`PRODUCT_REQUIREMENTS.md:30-34,51,69-82,106-114`; `AI_AGENT_ARCHITECTURE.md:8-14,108-115,178-190`; `SYSTEM_ARCHITECTURE.md:13,147`).
- Worker limits are respected: `COMPUTE_INFRASTRUCTURE.md:9-16,93-98,121` correctly keeps heavy compute off Workers and defers Containers/Galaxy to post-MVP, with figures traceable to `RESEARCH_compute_infra.md`.
- UNVERIFIED/CATALOG-ONLY/RESTRICTED markers are mostly preserved honestly for RID lifetime (`API_INTEGRATION_ROADMAP.md:35,54,86`), SILVA/KEGG (`:46,63-64,106-109`), deployment (`:5,44`; `PRODUCT_VISION.md:48`) and benchmark numbers (`PRODUCT_VISION.md:72`; `COMPETITOR_ANALYSIS.md:52`).
- Requirements are largely testable and milestones have measurable acceptance criteria and exit criteria (`PRODUCT_REQUIREMENTS.md` FR/NFR acceptance columns; `IMPLEMENTATION_ROADMAP.md` M1–M5 tables), aside from B3 and the unplanned differentiators above.
