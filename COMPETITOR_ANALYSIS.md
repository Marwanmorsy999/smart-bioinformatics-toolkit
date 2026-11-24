# Competitor Analysis — Smart Bioinformatics AI

**Prepared:** 2026-11-24
**Detailed research:** `docs/discovery/RESEARCH_competitors.md` (281 lines, source index with access dates).
**Method note:** the built-in `websearch` returned HTTP 402; research used DuckDuckGo HTML result pages plus direct fetches of primary pages. Findings are tagged in the research report as **[V]** verified primary page, **[V-S]** search snippet, **[N]** negative result. Claims here are positioning statements, not novelty claims.

---

## 1. Executive summary

1. **The market is crowded and mature.** Galaxy (MIT since 2025-02-25), smarts.bio, Pipette.bio, Seqera/Nextflow, Snakemake/nf-core, Cromwell/WDL, Terra, Benchling, DNAnexus, Seven Bridges and vendor clouds all exist. At least seven academic systems (BioPlanner, BioMedAgent, BioFlowAgent, BioMaster, PromptBio-Bench, TIAgent, BioGAIP) study natural-language → workflow generation in 2026.
2. **Plan-before-execute is table stakes.** Galaxy Orbit ("drafts a plan for your approval … records every decision in your notebook") and Pipette ("review the plan before execution", amendment approval) already ship it. We must not claim it as original.
3. **Provenance is table stakes.** Galaxy histories, Pipette methods/params/versions/code, smarts.bio parameter recording. We must not claim it as original.
4. **"smarls.bio" appears to be a typo for smarts.bio** (direct fetch failed, exact-phrase search returned no results). smarts.bio is live: 100+ tools, 30+ databases, free tier (2 compute hours + 1,000 API calls/month), $25 Pro, $100 Max; cloud execution for analyses, browser-local viewers.
5. **The empty column is interpretation integrity.** No surveyed platform advertises claim-level evidence gating (every explanatory sentence pinned to a source, abstention otherwise) or publishes a wrong-call-rate benchmark for conservative verdicts. This is our defensible strip of ground — with the honest qualifier that absence of a marketing claim is not proof of absence of a feature.
6. **The 16S analysis layer is commoditised** (QIIME 2, mothur, DADA2 — free/open source). Differentiation lives *above* the pipeline, in conservative, traceable interpretation.

## 2. Direct competitors

| Platform | NL interface | Plan → approve | Provenance | Claim-level evidence gate | Local execution | Free tier | Licence |
|---|---|---|---|---|---|---|---|
| **Galaxy + Orbit (2026)** | Yes **[V]** | **Yes** **[V]** | **Yes** (history + decision notebook) **[V]** | Not claimed **[N]** | Self-host / Orbit local+Galaxy **[V]** | Free public server, 250 GB **[V-S]** | **MIT** **[V]** |
| **smarts.bio** | Yes **[V]** | Not claimed **[N]** | Claimed (params recorded) **[V-S]** | Not claimed **[N]** | Viewers only; analysis cloud **[V]** | 2 h + 1,000 calls/mo **[V]** | Proprietary |
| **Pipette.bio** | Yes **[V]** | **Yes** + amendment approval **[V]** | **Yes** (methods, params, versions, code) **[V]** | Not claimed **[N]** | No **[N]** | 20 credits/mo **[V]** | Proprietary |
| **This project (target)** | Yes | Yes | Yes | **Yes — primary differentiator** | **Yes, consent-gated** | Yes, $0 mandatory | Open source |

Pricing details (verified 2026-11-24): smarts.bio Pro $25/mo, Max $100/mo, edu/gov/nonprofit discounts 10–30%; Pipette credit packs $25/$50/$100, team Premium $49/seat/mo and Scale $99/seat/mo (waitlisted), enterprise custom. Galaxy is free; the usegalaxy.org 250 GB/account quota is **snippet-only [V-S]** in this survey and must be re-verified before publication (compute research independently reports 250 GB registered / 5 GB unregistered from Galaxy Hub).

## 3. Adjacent platforms and tooling

- **Workflow engines:** Nextflow/Seqera (academic free program), Snakemake (MIT), nf-core (MIT required), Cromwell/WDL (BSD-3). Production-grade, but DSL-first; no end-user interpretation layer.
- **Cloud workspaces:** Terra (free for individuals, cloud-only, opaque consumption cost), Benchling (academic free, ELN-centred), DNAnexus / Seven Bridges (quote-only, regulated/enterprise), Illumina BaseSpace (credits, 1 TB free trial), Partek (license server).
- **Domain tools:** QIIME 2, mothur, DADA2 — free, mature, local-first. We integrate/emulate their *interpretation conventions*, not reimplement them.
- **Biomedical LLMs:** BioGPT (MIT), BioMedLM (2.7B) — text models over literature, no workflow execution or provenance; components, not competitors.
- **AlphaFold DB:** CC BY 4.0, 200M+ structures; a precedent for permissive data + mandatory citation (useful for our evidence bundle licensing).

## 4. Prior-art warning (read before any originality claim)

| Candidate differentiator | Already shipped by | Verdict |
|---|---|---|
| Scientific provenance | Galaxy, Pipette, smarts.bio | **Not original** — table stake |
| Plan-before-execute with approval | Galaxy Orbit, Pipette, BioFlowAgent | **Not original** — table stake |
| Local/private execution | Galaxy self-host/Orbit, EPI2ME desktop, QIIME 2/mothur/DADA2 | **Not original** — only the *auditable consent receipt* framing is open |
| Education/student access | Galaxy Training Network (3,500+ at 2025 academy), Seqera Academic, smarts.bio edu discounts | **Not original** — only *abstention teaching* is distinct |
| Plugin architecture | Galaxy ToolShed + 48 MCP tools + skills, smarts.bio SDKs, nf-core catalogs | **Not original as a concept** — bundling rules + citations + benchmark is narrower |
| Verified-evidence-only explanations with abstention | **No surveyed source claims this** | **Best candidate**, phrase as "no comparable claim found in this survey" |
| Conservative verdict with explicit `insufficient_evidence` and benchmarked wrong-call rate | No surveyed source claims this for an interpretation layer | **Good candidate**, same qualifier |

## 5. Recommended differentiation

1. **D1 — Claim-level evidence gating (primary).** Every scientific sentence resolves to a pinned artifact field (SHA-256, accession/taxid, retrieval date) or a verified reference; otherwise the system emits `insufficient evidence`. Implementation anchor: generate explanations *from* `docs/EVIDENCE_LEDGER.md`-backed records.
2. **D2 — Abstention-first interpretation with a published benchmark.** Treat `insufficient_evidence` as a positive outcome. Publish call rate **and** wrong-call rate together. **Evidence warning:** `docs/PROJECT_SUMMARY.md:10-17`, `docs/LOOP_LOG.md` and `README.md` quote held-out top-hit 143.3 wrong calls/200 at 100% call rate; 98.65% cutoff baseline 38.0 wrong across 87.7 calls; toolkit verdict 12.7 wrong across 49.7 calls with 150.3 abstentions — but the source `benchmark_data/RESULTS.md` is **absent and was never tracked** (`docs/discovery/AUDIT_docs_consistency.md`). These numbers are **UNVERIFIED in this tree** and must be re-generated before any external publication. The *design* (abstention + call-rate/wrong-rate accounting) is sound; the specific figures are not currently evidence. Say "fewer confident wrong calls, at lower call rate" — never "more accurate".
3. **D3 — Consent-gated execution with a locality receipt.** Default local; any egress requires scoped, revocable consent recorded in the same provenance record as the computation. Claim the *auditable boundary*, not local execution itself.
4. **D4 — Domain plugins as rules + citations + regression fixtures**, not just tool wrappers. Seed already exists: `shared/test-cases/verdict_cases.json`, `shared/difficult-groups.json`, dual Python/JS verdict implementations.
5. **D5 — Education mode teaching interpretation and abstention** — complementary to Galaxy Training Network, not competitive.

**Explicitly not differentiators:** "AI agent", "plan before execute", "provenance", "plugin architecture", "student pricing".

## 6. Positioning statement (safe wording)

> A research-and-education toolkit that turns raw 16S similarity evidence into a conservative, explicitly sourced verdict — and shows its work, including when it refuses to call a species. Built to grow into a modular platform where each domain plugin carries its own versioned rules, citations and benchmark. Not a clinical diagnostic; not a claim to be the first agentic bioinformatics platform.

## 7. Implications for this project's plan

- Do **not** spend the MVP budget re-implementing plan/approval UI as a novelty — implement it competently because it is required, and put the differentiation effort into the **citation checker + number checker + abstention paths** (FR-6.x, FR-7.x).
- Re-generate and version the benchmark before any external use; once reproduced it becomes our strongest public evidence. Until then it is an internal design input, **not** a publishable result.
- In reports, always show call rate, abstention count and wrong-call rate together.
- Verify competitor prices/quota facts against vendor pages before any external publication; several rest on search snippets.
