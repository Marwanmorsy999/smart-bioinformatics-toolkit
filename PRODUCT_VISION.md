# Product Vision — Smart Bioinformatics AI

**Status:** Approved direction for the next product cycle (vision reset, 2026-11-24).
**Supersedes:** the milestone-0.5 scope ("16S rRNA identification toolkit") as the *product goal*, not as code. The 16S implementation remains the first production module of the new platform.
**Companion documents:** `PRODUCT_REQUIREMENTS.md`, `SYSTEM_ARCHITECTURE.md`, `AI_AGENT_ARCHITECTURE.md`, `COMPUTE_INFRASTRUCTURE.md`, `API_INTEGRATION_ROADMAP.md`, `COMPETITOR_ANALYSIS.md`, `IMPLEMENTATION_ROADMAP.md`.
**Evidence:** discovery reports in `docs/discovery/`; claims are marked `VERIFIED`, `PARTIAL`, or `ASSUMED` and must not be upgraded without evidence.

---

## 1. The problem we are solving

Biological analysis software is fragmented. A researcher who wants to answer a question such as *"I have these 16S sequences — what taxa are present and how confident can I be?"* must currently:

1. Know which tool to use (BLAST, QIIME 2, DADA2, mothur, ...).
2. Know which database and release to use, and how to cite it.
3. Install and configure the tool, often via conda/Docker.
4. Interpret results that may be ambiguous, with thresholds that are easy to misuse.
5. Assemble a reproducible report manually.

AI chat tools can write plausible-sounding code and explanations, but they **fabricate citations, statistics and results**, and they cannot be trusted to perform the computation. Conversely, established workflow platforms (Galaxy, Nextflow) are powerful but require significant domain expertise.

**The opportunity:** put a verified, deterministic scientific toolchain behind a natural-language research interface — and make every claim traceable to a real tool run.

## 2. Product vision statement

> Smart Bioinformatics AI is a modular research platform where researchers and students describe biological questions in natural language, upload their own datasets, and receive an **inspectable plan, an executed analysis, validated results, and a reproducible report** — with AI used for understanding, planning and explanation, and deterministic software used for all computation.

We are **not** building an "AI that does science by itself". We are building an AI *research workbench* with hard epistemic boundaries:

- **No fabricated findings.** Numbers come only from executed tools. Explanations cite only evidence present in the run's evidence ledger.
- **No silent expensive actions.** A proposed plan is shown before any external API call, database download, or long-running job.
- **No unconsented data transfer.** Uploaded sequences are never sent to a third party (including NCBI) until the user explicitly approves that specific step.
- **Full provenance.** Every result records its input hash, tool name and version, parameters, database/release version, code version, and output hash.

## 3. Where we are today (honest baseline)

The existing milestone-0.5 repository is a **real, working, narrowly-scoped 16S toolkit**, not a prototype shell:

| Capability | State | Evidence |
|---|---|---|
| FASTA parsing, validation, per-record statistics | Implemented and unit-tested | `python-engine/src/smartbio/fasta.py`, `statistics.py`, `python-engine/tests/test_fasta.py`, `test_statistics.py` |
| Local BLAST+ execution with captured metadata | Implemented (requires local `blastn` binary and database) | `smartbio/blast_runner.py`, `test_blast_runner.py`, `output/local_blast_demo/blast_run.json` |
| BLAST tabular parsing and filtering | Implemented | `smartbio/blast.py`, `tests/test_blast.py` |
| Taxonomic consensus, verdicts, caution flags | Implemented with explicit scientific rules | `smartbio/taxonomy/**`, `docs/SCIENTIFIC_RULES.md` |
| Self-contained HTML research report with reproducibility metadata | Implemented | `smartbio/taxonomy/report.py`, `output/report-test/taxonomy_report.html` |
| Browser UI (validate / stats / BLAST / taxonomy / benchmark) | Implemented as static pages + JS calling Worker APIs | `web-platform/public/**` |
| NCBI BLAST URL API proxy, D1 request history | Implemented, with a mock mode for offline demos; no UI caller and no consent gate yet | `web-platform/functions/api/blast/**`, `migrations/0001_create_blast_requests.sql`, `docs/discovery/AUDIT_api_infra.md` |
| Cloudflare Pages deployment, threat model, evidence ledger, API catalog | Documented; deployment reported in `docs/EVIDENCE_LEDGER.md`; docs contain internal contradictions and stale claims | `docs/THREAT_MODEL.md`, `docs/API_CATALOG.md`, `wrangler.toml`, `docs/discovery/AUDIT_docs_consistency.md` |
| Natural-language assistant, planning agent, plugins, provenance store, validation agents, AI explanation | **Implemented in the MVP build on 2026-11-24** (deterministic planner/explainer; rule-based, no LLM required) | `smartbio/aiagent/**`, `smartbio/plugins/**`, `functions/api/ai/**`, `public/ai.html`, `shared/schemas/**`, `0002_ai_platform.sql`; tests in `docs/discovery/TEST_REPORT.md`. Before this reset the audit found no AI/UI layer (`docs/discovery/AUDIT_frontend_ux.md`) — that finding describes the **starting point**, not the current tree. |

The product reset therefore **extends** a working scientific core; it does not replace it.

## 4. Target domains (phased, not simultaneous)

The long-term platform targets seven domains. They are ordered by proximity to the existing code and by available open-source tooling:

1. **Sequence analysis & molecular biology** — FASTA/FASTQ QC, statistics, translation, restriction sites, primer checks. *Closest to current code; first to ship.*
2. **Microbiome & metagenomics** — 16S/ITS amplicon analysis, ASV/OTU workflows, alpha/beta diversity, taxonomy. *Current 16S module becomes the seed plugin.*
3. **Phylogenetics** — multiple sequence alignment, tree inference, tree visualization. *Requires new local executables.*
4. **Genomics** — read QC, mapping, variant calling, annotation.
5. **Transcriptomics** — RNA-seq QC, quantification, differential expression.
6. **Proteomics** — mass-spectrometry search, protein identification, quantification.
7. **Structural bioinformatics** — PDB retrieval, structure validation, interface/surface analysis.

**Phase 1 of implementation ships domains 1–2 only.** Later domains are enabled through the plugin contract in `SYSTEM_ARCHITECTURE.md`, never by rewriting the control plane.

## 5. Differentiation (evidence-checked 2026-11-24)

Competitor research (`docs/discovery/RESEARCH_competitors.md`, `COMPETITOR_ANALYSIS.md`) shows that **plan-before-execute approval, provenance, local/cloud execution and plugin registries are already shipped** by Galaxy (MIT, agentic stack in 2026), Pipette.bio (Plan→Approve→Run→Inspect), smarts.bio and others. Claiming those as original would be indefensible. Our defensible position is narrower and sharper:

1. **Claim-level evidence gating (primary).** Every scientific sentence in an explanation or report must resolve to a pinned artifact field or a verified reference entry; otherwise the system **abstains**. No surveyed platform advertises this as a hard, enforced gate.
2. **Abstention-first interpretation with a published benchmark.** The existing toolkit already distinguishes "verdict" from "top hit" in its rules (`docs/SCIENTIFIC_RULES.md`). Project docs quote call-rate / wrong-rate figures, but the source results file is **absent from this tree** (`docs/discovery/AUDIT_docs_consistency.md`) — those numbers are UNVERIFIED and must be regenerated before publication. We will publish this honest accounting once re-verified, never claim superior accuracy.
3. **Consent-gated local execution with an auditable locality receipt.** Users can see that their sequence never left the machine, and any third-party egress is an explicit, per-step, recorded decision.
4. **Domain plugins that bundle rules + citations + regression fixtures together**, so scientific responsibility travels with the code rather than living in a separate README.
5. **Education mode** that teaches threshold reasoning (why 16S often stops at genus) instead of only displaying answers.

We explicitly do **not** claim: being the first agentic bioinformatics platform, clinical validity, or higher accuracy than existing tools.

## 6. Non-goals (explicit)

- Not a replacement for Galaxy, QIIME 2, Nextflow or a LIMS.
- Not a clinical or diagnostic device; no medical claims.
- Not a system that invents biological conclusions, citations, p-values or statistics.
- Not an attempt to run heavy aligners inside Cloudflare Workers.
- Not a platform that sends user data to external databases without consent.
- Not "one agent per possible task" — agent count is justified by responsibility, not spectacle.

## 7. Success criteria (measurable)

| Milestone | Measure | Target |
|---|---|---|
| MVP end-to-end | Upload FASTA → NL request → plan → approval → real local execution → validation → explanation → report, with no fabricated values | Working demo on Windows + Linux with the bundled/offline planner |
| Scientific integrity | Every number in a generated report traceable to a tool artifact; zero unverified citations | 100% in automated validation tests |
| Preservation | All pre-existing Python and JS test suites still pass | 0 regressions |
| Extensibility | A second domain plugin added without modifying control-plane code | Demonstrated by a template plugin + its tests |
| Transparency | Every analysis has a persisted provenance record | 100% of completed runs |
| Cost | Platform runs on free/open-source components by default | $0 mandatory paid dependencies |

## 8. Decision record

- **AI is a planner/explainer, never the compute engine.** Deterministic tools produce all scientific values.
- **The existing Python engine is the first execution adapter**, not legacy to be discarded.
- **The Cloudflare Worker remains the control plane and API gateway**; it is not the compute plane.
- **An LLM provider is optional and pluggable.** A deterministic rule-based planner is the default so the platform is functional without a paid key or network access.
- **Documents are living artifacts.** Discoveries that contradict this vision must update it, with the change recorded in `docs/IMPLEMENTATION_LOG.md`.
