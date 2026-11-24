# Competitor and market research: AI-powered bioinformatics platforms and workflow systems

**Prepared:** 2026-11-24 (all "as of" statements use this date)
**Author role:** Competitor / market research subagent
**Scope:** Publicly discoverable claims only. No private benchmarking, no account sign-ups, no paywalled pages.

## 0. Method, evidence legend, and caveats

The built-in `websearch` tool returned HTTP 402 on every call this session (quota/auth failure). Searches were therefore run by fetching DuckDuckGo HTML result pages through `webfetch`; primary pages were then fetched directly. This changes the confidence of some findings, recorded below.

| Tag | Meaning |
|---|---|
| **[V]** | Verified: primary page fetched directly on 2026-11-24. |
| **[V-S]** | Verified as a search-result snippet only (DuckDuckGo HTML, 2026-11-24); the underlying page was not fetched. Treat numbers as vendor/vendor-adjacent claims. |
| **[U]** | Uncertain: inferred, third-party aggregator, or not confirmed. |
| **[N]** | Negative result: attempted access/query returned no evidence for the claim. |

**Important limitations.** Pricing pages change frequently. Several "pricing" hits are SEO aggregators (`softwr.com`, `toolsinfo.com`, `aicostadvisory.com`) of unknown reliability; where only those were found, the entry is marked **[V-S]** and hedged. Vendor marketing claims (user counts, "never trains on your data", "full reproducibility") are recorded **as claims**, not independently audited facts. No claim of originality is made for this project in this report: §8 lists explicit prior art for every candidate differentiator.

---

## 1. Executive summary

1. **Galaxy is the incumbent and is not a legacy player.** It is free, open source, MIT-licensed since 2025-02-25 (not LGPL — the specific licence question in the brief is answered definitively), has a 250 GB/registered-account quota on usegalaxy.org, and — critically — shipped an **agentic stack in 2026**: Orbit desktop app, 48-tool `galaxy-mcp`, `galaxy-skills`, and a flow where "Orbit drafts a plan for your approval, executes on Galaxy … and records every decision in your notebook" **[V]**.
2. **"smarls.bio" does not appear to exist.** Direct HTTPS fetch failed at transport level and an exact-phrase search returned "No results found" **[N]**. The near-identical, live product is **smarts.bio**, which is a direct competitor: free tier (2 compute hours + 1,000 API calls/month), $25 Pro, $100 Max, 100+ tools, 30+ databases, natural-language agent, local file viewers, VS Code/JupyterLab/CLI/MCP **[V]**.
3. **Pipette.bio is live and is the closest conceptual competitor.** It explicitly advertises **"Plan — Review the approach before execution"**, plan amendments requiring approval, and inspection of methods, parameters, software versions and code **[V]**. Pricing is public: 20 free credits/month, $25/$50/$100 credit packs, $49 and $99 per-seat team plans (waitlisted), Enterprise custom **[V]**.
4. **Plan-before-execute and general provenance are now table stakes**, not differentiators. They are implemented by both Galaxy and Pipette.
5. **The real remaining gap is at the interpretation layer**: none of the surveyed platforms advertises *claim-level* evidence gating — i.e. every explanatory sentence must resolve to a pinned source, with an explicit abstention when it cannot. This aligns with this project's existing `docs/SCIENTIFIC_RULES.md` (evidence fractions, `insufficient_evidence`, `near_threshold` caution, cited difficult-group warnings).
6. The 16S/microbiome analysis layer (QIIME 2, DADA2, mothur) is mature, free and open source **[V-S]**; the differentiation opportunity is **not** in doing ASV/OTU analysis, but in the conservative, traceable *verdict* above it.

---

## 2. Workflow and orchestration platforms

### 2.1 Galaxy (galaxyproject.org / usegalaxy.org)

| Attribute | Finding |
|---|---|
| What it is | Open-source, web-based scientific workflow system, originally for genomics, now domain-agnostic. "No programming required", 10,000+ tools, free public servers. **[V]** `https://galaxyproject.org/` |
| Workflow engine | Native Galaxy workflow engine: datasets, workflows (recipe without data), histories (recipe + data + intermediates), pages. Code-free GUI workflow builder, CLI access, scheduled jobs, cloud infrastructure management. ToolShed for distributing command-line tools. **[V]** `https://galaxyproject.org/`; **[V]** `https://en.wikipedia.org/wiki/Galaxy_(computational_biology)` (last edited 2026-10-22) |
| Public server | usegalaxy.org, plus usegalaxy.eu, .fr, .org.au, .ca. Homepage states "400K+ Registered Users", "750K Jobs per Month", "22K+ Citations", "150+ Countries" **[V]**. Wikipedia states "over 750,000 registered users" **[V-S]** — **the two figures conflict; treat user count as uncertain**. |
| Training | Galaxy Training Network (GTN), free peer-reviewed tutorials; 2025 Galaxy Training Academy had 3,500+ participants. Claimed 2025's largest biological data analysis training event. **[V]** `https://galaxyproject.org/` |
| API | Galaxy API key from User → Preferences; agentic stack exposes **48 MCP tools** (histories, datasets, tools, IWC workflows, user-defined tools) plus `galaxy-skills` (7 skills), `galaxy-dev-skills` (9), `foundry-skills` (69 "casts" turning papers/Nextflow/CWL into validated Galaxy workflows). REST/CLI ecosystem. **[V]** `https://galaxyproject.org/agents/` |
| Licensing | **MIT since 2025-02-25**, expressly "entirely under the MIT License". Some Silk icons CC-BY-2.5; other images/docs CC-BY-3.0. **Not LGPL.** **[V]** `https://raw.githubusercontent.com/galaxyproject/galaxy/dev/LICENSE.txt` (Wikipedia's older "MIT and Academic Free License" is stale **[V-S]**). |
| Quotas | usegalaxy.org: **250 GB per registered account** (disk storage); quotas are set per-server by administrators. Multiple accounts are tracked and subject to termination/data deletion. EU server also 250 GB/user. **[V-S]** `https://galaxyproject.org/support/account-quotas/`, `https://usegalaxy.org/register/start`, `https://galaxyproject.org/eu/storage/` |
| Business model | Free public infrastructure + self-hosted open-source deployment. Current NAR citation: Galaxy Community, *NAR* 2026, gkag469, doi:10.1093/nar/gkag469. Stable release 26.1 (July 2026). **[V]/[V-S]** |
| Strengths | Mature provenance ("Every step is tracked"; histories are inspectable/repeatable/publishable); enormous tool catalogue; best-in-class free training; genuinely free public compute; self-hostable; now has AI agents with plan approval and a notebook recording decisions. **[V]** |
| Weaknesses | Web UI prioritises usability over highly complex workflow constructs (e.g. looping) **[V-S]**; public-server quotas and fair-use limits; provenance records *computation* (inputs, parameters, steps) but the surveyed pages make **no claim** about verifying the *interpretive prose* attached to results; AI agent features are new/beta (User-Defined Tools require beta approval). **[V]/[N]** |

**Agentic prior art (critical).** The Galaxy agents page states: "Describe your analysis — Orbit drafts a plan for your approval, executes on Galaxy (including custom containerized UDTs), and records every decision in your notebook." It also documents local + Galaxy execution in Orbit, model switching, and a `reproduciblify` skill. **[V]** `https://galaxyproject.org/agents/`, `https://galaxyproject.org/agents/orbit/`

### 2.2 Nextflow / Seqera Platform (formerly Tower)

- Nextflow is a workflow DSL/engine; Seqera Platform is the orchestration/monitoring layer by the same creators. Supports IWC (infrastructure-as-code) workflows in Galaxy, Seqera CLI (`tw`), `-with-tower` monitoring. **[V-S]** `https://seqera.io/`, `https://docs.seqera.io/platform-cloud/getting-started/deployment-options`
- Pricing: Academic Program gives **free expanded access** for qualifying researchers, educators and students; Cloud Professional is a hosted paid edition; Enterprise is custom. Exact public dollar figures were **not** found. **[V-S]** `https://seqera.io/pricing/`, AWS Marketplace listing.
- Strength: production-grade scaling, reproducibility, cloud/HPC portability. Weakness: requires DSL fluency; not a natural-language interface. **[U]**

### 2.3 Snakemake and nf-core

- Snakemake is **MIT-licensed** (current docs v9.27.2). **[V-S]** `https://snakemake.readthedocs.io/en/stable/project_info/license.html`
- nf-core pipelines **MUST** be MIT-licensed; incompatible scripts should live on bioconda instead. **[V-S]** `https://nf-co.re/docs/guidelines/pipelines/requirements/mit_license`
- Snakemake Workflow Catalog is open source under MIT; peer-reviewed study attempted automatic reproduction of catalog workflows and found reproducibility in practice is limited. **[V-S]** `https://snakemake.github.io/snakemake-workflow-catalog/docs/catalog.html`, `https://dl.acm.org/doi/10.1145/3589806.3600037`
- Strength: standards, containerisation, community review. Weakness: command-line/DSL first; no natural-language planning; existing evidence shows reproduction is not guaranteed even for curated workflows.

### 2.4 Cromwell / WDL

- Broad Institute Cromwell: open-source scientific workflow engine, **BSD 3-Clause**, executes WDL across cloud/HPC backends. v80+ no longer supports CWL. **[V-S]** `https://cromwell.readthedocs.io/`, `https://github.com/broadinstitute/cromwell/blob/develop/README.md`
- Strength: GATK ecosystem, mature. Weakness: WDL authoring required; no end-user interpretation layer. **[U]**

### 2.5 Terra

- Developed by Broad Institute (MIT/Harvard) with Microsoft and Verily; cloud-native workspace on Google Cloud and Azure. **[V-S]** `https://terra.bio/`
- "Terra serves the public good and is free for individual use"; Enterprise plans exist. Third-party summary: users pay underlying cloud compute/storage/egress. Broad states 65,000+ users. **[V-S]** `https://terra.bio/terra-plans/`, `https://www.broadinstitute.org/news/terra-azure-release`
- Strength: free to individuals, strong data-sharing/collaboration. Weakness: cloud only; cost is opaque and tied to cloud consumption. **[U]**

---

## 3. Direct "natural language → analysis" competitors

### 3.1 smarts.bio — **live** (note: the brief's "smarls.bio" appears to be a misspelling)

**Identity resolution.** `GET https://smarls.bio/` returned a transport error; exact-phrase search for `"smarls.bio"` returned "No results found"; generic "smarls" results were unrelated (a GitHub user, gaming forums). **[N]** Searches for "smarls.bio bioinformatics platform pricing" returned **smarts.bio** as the top result. Conclusion: **"smarls.bio" is very likely a typo for smarts.bio**, not a separate defunct company. No evidence of a dead "smarls.bio" product was found. **[U]**

| Attribute | Finding |
|---|---|
| Status | Live, actively maintained, footer © 2026. **[V]** `https://www.smarts.bio/` |
| What it does | "Ask a biological question, smarts.bio picks the tools, builds the pipeline, and lets you explore the results." Products: **bioSTUDIO** (AI viewers for FASTA/BAM/VCF/PDB, Python editor) and **bioCHAT** (natural-language agent; QC, RNA-seq, variant calling; PubMed/GenBank/UniProt + 30+ databases). 100+ preinstalled tools (GATK, STAR, SAMtools, BLAST, Boltz-2). Multi-step pipelines with live progress. **[V]** |
| Business model / pricing | Free: $0, 2 compute hours/mo, 1,000 API calls/mo, 10 GB storage, 1 active project. **Pro $25/mo**: 20 h, 10,000 calls, 100 GB, 10 projects. **Max $100/mo**: 100 h, 100,000 calls, 1 TB, unlimited. Team Pro min 3 users; Team Max min 5; Enterprise from 50. 14-day trial on Pro/Team Pro. Volume discounts 10–30% for edu/gov/nonprofit. **[V]** `https://www.smarts.bio/pricing` |
| Integrations | VS Code plugin, JupyterLab plugin, `smarts CLI`, MCP server (ChatGPT, Claude, Gemini, Cursor, Windsurf), Python/Node SDKs, REST API, `/llms.txt`. **[V]** |
| Privacy claims | "Never used to train AI"; single-use isolated containers destroyed after each job; standalone file viewers parse files **in the browser** and never upload them; TLS 1.3 in transit, AES-256 at rest; OAuth 2.0 + PKCE; hashed/revocable API keys; prompts not sent to model vendor's own API; export and deletion available; security page "last reviewed 4 October 2026". Caveat: external MCP assistants' own terms apply. **[V]** `https://www.smarts.bio/security` |
| Scale claim | "2,000+ scientists", institutions listed at sign-up with explicit no-endorsement disclaimer. **[V]** |
| Open source | No — proprietary. Public GitHub org exists for plugins/CLI (`github.com/smartsbio`) **[V-S]**, but the platform is commercial. |
| Strengths | Low-friction free tier; broad tool/database coverage; strong editor integration; unusually specific security/privacy commitments. **[V]** |
| Weaknesses | Compute-hour and API-call caps; cloud execution for analyses (only *viewing* is local) **[V]**; claims "All analyses are tracked and documented automatically … complete parameter settings … full reproducibility" and "AI uses validated bioinformatics tools" — these are **vendor assertions**, not independent audits, and no claim-level evidence gating or abstention was found **[V]/[N]** `https://www.smarts.bio/about`. |

### 3.2 Pipette.bio — **live**

| Attribute | Finding |
|---|---|
| Status | Live, © 2026, developed by Variome Analytics. **[V]** `https://pipette.bio/platform.html` |
| What it does | "Go from biological data to results you can inspect. Pipette plans and runs analyses across genomics, transcriptomics, drug design, and more, with the methods and code alongside the outputs." Domains: genomics, transcriptomics, single-cell, ChIP-seq, proteomics, metagenomics, genomic prediction, molecular docking. **[V]** |
| **Plan/approve flow** | Four steps: **Plan** ("Review the approach before execution") → Run → Inspect → Continue with context. FAQ: "You review the plan before execution and can request changes. **If execution needs to deviate from the approved plan, Pipette requests approval or a plan amendment.**" **[V]** |
| Provenance | Explicit sections for Inputs (data and reference resources), Methods (steps and parameters), Execution (code and software versions), Results (figures/tables/files), Report (findings and interpretation). "Shared project history and provenance" is a team-plan feature. Reproduction caveat is honest: running elsewhere also needs input data, references, dependencies and compute environment. **[V]** |
| Pricing | Free $0/mo, 20 credits/mo. Credit packs (one-time, non-expiring): Standard $25/55 credits, Pro $50/120, Power $100/300 — each 50 GB input/session, 100 GB active workspace. Pipette Lab: **Premium $49/seat/mo** (35 credits/week, 100 GB/session, 250 GB workspace), **Scale $99/seat/mo** (75 credits/week, 250 GB/session, 500 GB workspace) — both **waitlist**; Enterprise custom (up to 1 TB standard). Credits cover "AI reasoning and cloud compute". **[V]** `https://pipette.bio/pricing.html` |
| Open source | No evidence found; proprietary commercial. **[N]** |
| Strengths | The clearest plan-approval implementation surveyed; transparent pricing; explicit code/versions outputs; honest reproduction caveat. **[V]** |
| Weaknesses | Paid team tiers are waitlisted → availability uncertain **[V]**; cloud-only execution (no local mode found) **[N]**; no evidence of claim-level citation/abstention gating **[N]**. |

---

## 4. Enterprise / cloud platforms (context, not direct substitutes)

| Platform | What it does | Model / pricing | Open source | Notes | Source |
|---|---|---|---|---|---|
| **Benchling** | ELN, lab management, cloud R&D software for life sciences; 200,000+ scientists, 1,300+ companies, 7,500+ academic institutions as of 2025. "Much of its software is offered free of charge for academic use." Private; 810 employees (2026); filed S-1 in 2021, no IPO as of 2026. | Enterprise/commercial + academic free | No | Lab-notebook and registry centred, not an analysis agent. | **[V]** Wikipedia `https://en.wikipedia.org/wiki/Benchling` |
| **Dotmatics** | R&D data platform: ELN, sample/sequence registration, inventory, workflow automation, scientific data search/analytics; Luma data layer. | Quote-only; no public price list. Acquired by Siemens for $5.1B, completed 2025-07-01 (third-party claim). | No | Enterprise R&D data governance; not a natural-language analysis agent. | **[V-S]** `https://www.scispot.com/blog/dotmatics-pricing`, `https://www.g2.com/products/dotmatics-dotmatics/reviews`, `https://tooldirectory.ai/tools/dotmatics-scientific-rd-data-management` |
| **DNAnexus** | Cloud platform for large-scale multi-omic and clinical data; GxP, FedRAMP, CLIA, CAP, HIPAA coverage claimed. | Quote-only ("rate card negotiated at signing"); no free tier found. | No | Regulated/clinical-grade; heavy compliance focus. | **[V-S]** `https://www.dnanexus.com/`, `https://academy.dnanexus.com/billing-access-and-orgs/billing_and_pricing`, `https://www.softwr.com/software/dnanexus` |
| **Seven Bridges** | Cloud biomedical analysis platform; collaborative, multi-cloud/on-prem; FedRAMP-listed. Still sold under the name after parent merged into Velsera. | Quote-only; no public pricing found. | No | Pharma/government focus. | **[V-S]** `https://www.sevenbridges.com/platform/`, `https://www.fedramp.gov/marketplace/products/FR2033152148/`, `https://www.softwr.com/software/seven-bridges` |
| **EPI2ME (Oxford Nanopore)** | "Open-analysis platform": desktop app + CLI, preconfigured workflows, real-time analysis, custom workflow sharing, runs on laptop/cluster/cloud/MinION. EPI2ME Cloud is a managed Nextflow-based compute environment. | Desktop/workflows broadly free/open; Cloud/compute is vendor-managed, exact pricing not found on public pages. | Workflows are published openly ("open-analysis"); exact licence not verified. | Vendor-lock to Nanopore workflows; strong for ONT data only. | **[V-S]** `https://nanoporetech.com/products/analyse/epi2me`, `https://aws.amazon.com/blogs/hpc/reducing-costs-by-50-while-processing-population-scale-genomics-with-mountpoint-for-amazon-s3-and-aws-batch/` |
| **Illumina BaseSpace / BioInsight Platform** | Cloud NGS analysis, run monitoring, DRAGEN, 16S metagenomics apps among many. | Free trial: **1 TB free storage + 250 iCredits** valid 30 days; then BioInsight Credits ("common currency") for compute, storage, third-party apps; subscription/pay-as-you-go/commit options. All plans start with 1 TB free storage. | No | Vendor-ecosystem platform; credit metering opaque. | **[V-S]** `https://help.basespace.illumina.com/overview/account-types`, `https://www.illumina.com/products/by-type/informatics-products/pricing.html`, `https://assets.illumina.com/products/by-type/informatics-products/basespace-sequence-hub/order.html` |
| **Partek (Flow / Genomics Suite)** | Visual multiomic analysis: bulk/single-cell RNA-seq, spatial, ChIP-seq, ATAC-seq, DNA-seq, metagenomics. Genomics Suite uses a network **license server** with unlimited client installs. | Quote-only; no public price list found. | No | Desktop/server GUI statistics package; now under Illumina. | **[V-S]** `https://www.illumina.com/products/by-type/informatics-products/partek-flow.html`, `https://help.partek.illumina.com/partek-genomics-suite/installation-guide/license-types` |

---

## 5. The 16S / microbiome analysis layer (the domain this project starts from)

| Tool | What it does | Cost / licence | Implication |
|---|---|---|---|
| **QIIME 2** | "Microbiome multi-omics data science platform. Trusted, **free, open source**, extensible, community developed and supported." Docs moved to an "amplicon distribution" as of the 2025.4 release. | Free, open source **[V-S]** `https://qiime2.org/` | The analysis layer is commoditised. A new platform should integrate/emit to it, not re-implement it. |
| **mothur** | "One of the most widely used tools for analyzing 16S rRNA gene sequence data", with SOPs and an active community. Separate licence page exists. | Free/open source (exact licence not verified) **[V-S]** `https://mothur.org/`, `https://mothur.org/wiki/mothur_license/` | Same as above. |
| **DADA2** | ASV inference; available as a QIIME 2 plugin; widely used for 16S V4 etc. | Open source (exact licence not verified) **[V-S]** `https://docs.qiime2.org/2024.10/plugins/available/dada2/index.html`, `https://pmc.ncbi.nlm.nih.gov/articles/PMC12906231/` | Same as above. |
| **Illumina 16S metagenomics app (BaseSpace)** | Vendor-supplied 16S metagenomics workflow inside BaseSpace. | Credit-metered **[V-S]** | Shows vendors already bundle 16S; differentiation must be above the pipeline. |

**Conclusion:** the defensible strip of ground is **not** "we do 16S analysis" but "we turn 16S similarity evidence into a conservative, explained, traceable verdict and teach the user why the verdict was reached".

---

## 6. AI models and research-grade agents

### 6.1 Biomedical language models

- **BioGPT** (Microsoft Research, Luo et al. 2022, *Briefings in Bioinformatics*): domain-specific generative Transformer pre-trained on ~15M PubMed titles/abstracts; tasks include relation extraction, QA, text generation. Open source, MIT, available on Hugging Face (`microsoft/biogpt`, `BioGPT-Large`) and Microsoft Foundry. 1K context. **[V-S]** `https://github.com/microsoft/BioGPT`, `https://huggingface.co/microsoft/biogpt`, `https://www.microsoft.com/en-us/research/publication/biogpt-generative-pre-trained-transformer-for-biomedical-text-generation-and-mining/`, `https://casrai.org/guides/biogpt`
- **BioMedLM** (Stanford CRFM + MosaicML, Dec 2022): 2.7B-parameter model trained on PubMed abstracts and full articles; reported 50.3% on MedQA at release. Publicly available on Hugging Face; authors state reliability, truthfulness and explainability are top concerns. **[V-S]** `https://crfm.stanford.edu/2022/12/15/biomedlm.html`, `https://arxiv.org/html/2403.18421v1`, `https://huggingface.co/stanford-crfm/BioMedLM`
- **Relevance:** these are *text* models over literature. They do **not** execute workflows and do not produce provenance. They are components, not competitors. No evidence found that any surveyed platform uses them as an evidence-verification gate. **[N]**

### 6.2 Natural-language → workflow research products

| Work | Claim | Source |
|---|---|---|
| **BioPlanner** (EMNLP 2023) | Converts natural-language protocols to pseudocode and evaluates LLM reconstruction; introduces BioProt dataset; one model-generated protocol was executed in a real lab. | **[V-S]** `https://arxiv.org/abs/2310.10632`, `https://aclanthology.org/2023.emnlp-main.162/` |
| **BioMedAgent** (2026, *Nature* family journal) | "Self-evolving LLM multi-agent framework … learns to use diverse bioinformatics tools and chain them into executable workflows through interactive exploration and memory retrieval", initiated in natural language. | **[V-S]** `https://www.nature.com/articles/s41551-026-01634-6`, `https://ibp.cas.cn/zxfblw/202606/t20260610_8227082.html` |
| **BioFlowAgent** (IEEE, 2026) | "Registry-constrained LLM agent for credential-free workflows over public bioinformatics databases"; LLM produces a plan; paper explicitly names typed API calls, execution monitoring, artifact validation and **provenance-aware reporting**. | **[V-S]** `https://ieeexplore.ieee.org/abstract/document/11682665` |
| **BioMaster** (2026) | Knowledge-guided multi-agent framework for automated construction/execution of bioinformatics workflows from high-level task descriptions. | **[V-S]** `https://www.sciencedirect.com/science/article/pii/S2666389926001200` |
| **PromptBio-Bench** (bioRxiv 2026) | Benchmark for LLM-based bioinformatics agents; defines "agentic bioinformatics" as natural-language understanding + autonomous code generation + dynamic tool use + self-refinement. | **[V-S]** `https://www.biorxiv.org/content/10.64898/2026.05.05.723092v1.full.pdf` |
| **Single-cell agent benchmark** (2026, *Genome Biology*) | Empirical guidance for selecting LLM-agent combinations; capability analysis for bioinformatics agents. | **[V-S]** `https://link.springer.com/article/10.1186/s13059-026-03998-z` |
| **BioGAIP** (2026), **TIAgent** (NeurIPS 2026) | BioGAIP: scalable LLM multi-agent system. TIAgent: natural language → **verifiable computational graph** for tissue image analysis. | **[V-S]** `https://www.jgenetgenomics.cn/en/article/doi/10.1016/j.jgg.2026.09.013`, `https://neurips.cc/virtual/2026/172652` |
| **Surveys** | Two 2026 surveys of LLMs in bioinformatics confirm this is an active, crowded research area. | **[V-S]** `https://onlinelibrary.wiley.com/doi/full/10.1002/qub2.70014`, `https://www.frontiersin.org/journals/genetics/articles/10.3389/fgene.2026.1797863/full` |

**Implication:** "LLM agent that builds a workflow from natural language" is **crowded** in 2026, both commercially (smarts.bio, Pipette, Galaxy) and academically (≥7 works above). Filing any originality claim on that idea alone would be indefensible.

### 6.3 AlphaFold ecosystem

- AlphaFold DB is a DeepMind + EMBL-EBI collaboration; data free for academic **and commercial** use under **CC BY 4.0**; attribution/citation expected (AlphaFold methods paper, Jumper et al. 2021; Fleming et al. 2025 for the DB). 200M+ structures. **[V-S]** `https://alphafold.ebi.ac.uk/download`, `https://www.ebi.ac.uk/about/news/technology-and-innovation/alphafold-200-million/`
- It is a **reference data resource**, not a workflow agent. Its licence model (permissive data + mandatory citation) is a useful precedent for how this project should license and attribute evidence bundles. **[U]**

---

## 7. Cross-cutting comparison

| Platform | NL interface | Plan → approve | Execution provenance | Claim-level evidence gate | Local execution | Free tier | Licence |
|---|---|---|---|---|---|---|---|
| Galaxy (+ Orbit agents) | Yes (2026) | **Yes** **[V]** | **Yes** (history + notebook of decisions) **[V]** | Not claimed **[N]** | Yes (self-host; Orbit local+Galaxy) **[V]** | Yes, free public server, 250 GB | **MIT** **[V]** |
| smarts.bio | **Yes** **[V]** | Not claimed **[N]** | Claimed (parameters recorded) **[V-S]** | Not claimed **[N]** | Viewers only; analysis cloud **[V]** | 2 h + 1,000 calls/mo **[V]** | Proprietary |
| Pipette.bio | **Yes** **[V]** | **Yes**, with amendment approval **[V]** | **Yes** (methods, params, versions, code) **[V]** | Not claimed **[N]** | No **[N]** | 20 credits/mo **[V]** | Proprietary |
| Terra / Seqera / Nextflow / Snakemake / nf-core / Cromwell | No | No | Yes (workflow-level) | No | Yes (self-host for most) | Mostly free / academic | MIT / BSD-3 / varies **[V-S]** |
| Benchling / Dotmatics / DNAnexus / Seven Bridges / BaseSpace / Partek | Limited/none | No | ELN/data-level | No | Some desktop | Academic free (Benchling); mostly quote-only | Proprietary |
| QIIME 2 / mothur / DADA2 | No | No | Tool-level | No | **Yes (local first)** | Free | Open source **[V-S]** |

**Reading of the table:** the "Claim-level evidence gate" column is empty across the entire survey. That is the gap this project is positioned to fill — with the honest qualifier that *absence of a marketing claim is not proof of absence of the feature*.

---

## 8. Prior art / non-originality warning — read before claiming differentiation

The brief asked for differentiators "considering: provenance, verified-evidence-only explanations, plan-before-execute with user approval, local/private execution with consent, education/student accessibility, plugin domain architecture". Findings:

| Candidate | Already implemented by | Verdict |
|---|---|---|
| Scientific traceability / provenance | Galaxy histories and published histories; Pipette methods/params/versions/code; smarts.bio parameter recording | **Not original.** Table stake. |
| Plan-before-execute with user approval | **Galaxy Orbit** ("drafts a plan for your approval") **[V]**; **Pipette** ("review the plan before execution", amendment approval) **[V]**; academic BioFlowAgent **[V-S]** | **Not original.** Table stake. |
| Local/private execution | Galaxy self-hosting; Galaxy Orbit local+Galaxy; EPI2ME desktop; QIIME 2/mothur/DADA2; smarts.bio browser-side file viewers **[V]/[V-S]** | **Not original.** Only the *consent receipt* + proof-of-locality framing appears open. |
| Education/student access | Galaxy Training Network (free, peer-reviewed, 3,500+ at 2025 academy) **[V]**; Seqera Academic Program, smarts.bio edu discounts **[V-S]/[V]** | **Not original.** Only *interpretation/abstention* teaching is distinct. |
| Plugin domain architecture | Galaxy ToolShed + 48 MCP tools + skills + Foundry casts **[V]**; smarts.bio integrations/SDKs **[V]**; Pipette org-owned workflows **[V]**; nf-core/Snakemake catalogs **[V-S]** | **Not original as a concept.** A plugin that bundles *rules + citations + benchmark* is a narrower, possibly novel composition. |
| Verified-evidence-only explanations with abstention | **No surveyed source claims this.** | **Best candidate**, but phrase as "we found no comparable claim in this survey", never as "nobody has done this". |
| Conservative verdict with explicit `insufficient_evidence` and benchmarked wrong-call rate | No surveyed source claims this for an interpretation layer. | **Good candidate**, subject to the same qualifier. |

**Instruction followed:** this report makes **no originality claim** for this project. All differentiators below are framed as *defensible positioning against the surveyed set*, not as novelty claims.

---

## 9. Proposed differentiators (5)

These are grounded in the gaps identified above and in this project's existing `docs/SCIENTIFIC_RULES.md`, `docs/EVIDENCE_LEDGER.md` and `docs/PROJECT_SUMMARY.md`.

### D1 — Verified-evidence-only explanations (highest priority)
Every non-trivial sentence of an AI explanation must resolve to a pinned evidence record: database release + accession/taxid + SHA-256 + retrieval date, or a cited paper with a stable identifier. If it cannot, the system emits an explicit "insufficient evidence" line instead of prose. **Gap evidence:** Galaxy tracks computation steps; Pipette exposes methods/parameters/code; smarts.bio claims full parameter recording — none advertises claim-level verification or suppression **[V]/[N]**. **Implementation anchor:** extend the existing evidence ledger so explanations are generated *from* ledger entries rather than alongside them. **Risk:** high engineering cost and slower answers; mitigate by limiting to scientific claims, not UI narration.

### D2 — Abstention-first interpretation with a published, reproducible benchmark
Make `insufficient_evidence` a first-class, celebrated outcome and publish call rate **together with** wrong-call rate. The project already has real numbers: held-out top-hit 143.3 wrong calls/200 at 100% call rate; 98.65% cutoff baseline 38.0 wrong across 87.7 calls; toolkit verdict 12.7 wrong across 49.7 calls with 150.3 abstentions **[project doc: PROJECT_SUMMARY.md]**. **Gap evidence:** no surveyed platform advertises conservative abstention as a product outcome **[N]**. **Honesty requirement (already in project docs):** do not say "more accurate"; say "fewer confident wrong calls, at lower call rate". This is a defensible, measurable position that marketing-led competitors cannot easily copy without re-benchmarking.

### D3 — Consent-gated execution with a locality receipt
Default to browser/local execution; when a step would upload data or invoke a third-party model, require explicit, scoped, revocable consent and write the consent decision (who consented, to what, when, which bytes) into the same provenance record as the computation. **Gap evidence:** smarts.bio's viewers are local but analyses are cloud **[V]**; Galaxy can self-host but has no advertised per-step consent receipt **[N]**; Pipette is cloud-only **[N]**. **Honesty requirement:** do not claim to invent local execution — claim the *auditable consent boundary*.

### D4 — Domain plugins as rules + citations + benchmarks, not just tool wrappers
A domain plugin should ship (a) the tool invocation, (b) a versioned scientific rule set (thresholds, caution flags, group definitions), (c) a citation bundle with access dates, and (d) a regression fixture set. Adding 16S → ITS → variant interpretation then extends *interpretation*, not only the tool catalogue. **Gap evidence:** Galaxy ToolShed, nf-core, smarts.bio integrations and Pipette org workflows are tool/workflow registries; none surveyed bundles interpretation rules and citations as a versioned unit **[V]/[N]**. **Implementation anchor:** `shared/test-cases/verdict_cases.json`, `shared/difficult-groups.json` and the dual Python/JS verdict implementation are already the seed of this architecture.

### D5 — Education mode that teaches interpretation and abstention, not just tool operation
A student-facing mode that explains *why* a threshold was not met, shows the near-threshold evidence, and links the citation for each caution flag. **Gap evidence:** GTN is excellent at teaching tool workflows **[V]**, but the surveyed training materials make no claim about teaching conservative interpretation or abstention **[N]**. **Positioning:** complementary to GTN, not competitive with it — ideally export a GTN-style tutorial that uses this project's benchmark as teaching data.

### Explicitly *not* differentiators
"Natural-language agent", "plan before execute with approval", "provenance", "plugin architecture", "student pricing" — all are already shipped by at least one surveyed platform (§8).

---

## 10. Recommended positioning statement (cautious wording)

> A research-and-education toolkit that turns raw 16S similarity evidence into a conservative, explicitly sourced verdict — and shows its work, including when it refuses to call a species. Built to grow into a modular platform where each domain plugin carries its own versioned rules, citations and benchmark. Not a clinical diagnostic; not a claim to be the first agentic bioinformatics platform.

---

## 11. Source index (all accessed 2026-11-24)

### Primary pages fetched directly
1. `https://galaxyproject.org/` — platform overview, statistics, GTN, NAR 2026 citation.
2. `https://galaxyproject.org/agents/` — agentic stack, Orbit, 48 MCP tools, plan approval, Foundry casts.
3. `https://raw.githubusercontent.com/galaxyproject/galaxy/dev/LICENSE.txt` — MIT since 2025-02-25.
4. `https://en.wikipedia.org/wiki/Galaxy_(computational_biology)` — history, features, licence (stale), stable release 26.1.
5. `https://www.smarts.bio/`, `/pricing`, `/about`, `/security`, `/status` — product, prices, claims, privacy, live status.
6. `https://pipette.bio/pricing.html`, `https://pipette.bio/platform.html` — prices, plan/approve flow, provenance.
7. `https://en.wikipedia.org/wiki/Benchling` — company, scale, academic-free model.
8. `https://smarls.bio/` — transport error (negative result).
9. DuckDuckGo HTML `?q="smarls.bio"` — no results (negative result).

### Search-result snippets only (lower confidence)
10. `https://galaxyproject.org/support/account-quotas/` — 250 GB quota.
11. `https://usegalaxy.org/register/start`, `https://galaxyproject.org/eu/storage/` — free service, quotas, account policy.
12. `https://terra.bio/`, `https://terra.bio/terra-plans/`, `https://www.broadinstitute.org/news/terra-azure-release` — free individual use, 65,000 users.
13. `https://seqera.io/pricing/`, `https://seqera.io/` — Academic Program free, hosted editions.
14. `https://snakemake.readthedocs.io/en/stable/project_info/license.html`, `https://nf-co.re/docs/guidelines/pipelines/requirements/mit_license`, `https://snakemake.github.io/snakemake-workflow-catalog/docs/catalog.html` — MIT licences.
15. `https://cromwell.readthedocs.io/`, `https://github.com/broadinstitute/cromwell/blob/develop/README.md` — BSD 3-Clause, WDL, CWL dropped v80+.
16. `https://nanoporetech.com/products/analyse/epi2me`, `https://aws.amazon.com/blogs/hpc/reducing-costs-by-50-while-processing-population-scale-genomics-with-mountpoint-for-amazon-s3-and-aws-batch/` — EPI2ME platform and EPI2ME Cloud.
17. `https://help.basespace.illumina.com/overview/account-types`, `https://www.illumina.com/products/by-type/informatics-products/pricing.html`, `https://assets.illumina.com/products/by-type/informatics-products/basespace-sequence-hub/order.html` — credits, 1 TB free, 16S app.
18. `https://help.partek.illumina.com/partek-genomics-suite/installation-guide/license-types`, `https://www.illumina.com/products/by-type/informatics-products/partek-flow.html` — licence server, capabilities.
19. `https://qiime2.org/`, `https://mothur.org/`, `https://docs.qiime2.org/2024.10/plugins/available/dada2/index.html` — 16S stack.
20. `https://github.com/microsoft/BioGPT`, `https://huggingface.co/microsoft/biogpt`, `https://casrai.org/guides/biogpt` — BioGPT.
21. `https://crfm.stanford.edu/2022/12/15/biomedlm.html`, `https://arxiv.org/html/2403.18421v1` — BioMedLM.
22. `https://alphafold.ebi.ac.uk/download`, `https://www.ebi.ac.uk/about/news/technology-and-innovation/alphafold-200-million/` — CC BY 4.0, 200M structures.
23. `https://arxiv.org/abs/2310.10632`, `https://aclanthology.org/2023.emnlp-main.162/` — BioPlanner.
24. `https://www.nature.com/articles/s41551-026-01634-6` — BioMedAgent 2026.
25. `https://ieeexplore.ieee.org/abstract/document/11682665` — BioFlowAgent.
26. `https://www.sciencedirect.com/science/article/pii/S2666389926001200` — BioMaster.
27. `https://www.biorxiv.org/content/10.64898/2026.05.05.723092v1.full.pdf` — PromptBio-Bench.
28. `https://link.springer.com/article/10.1186/s13059-026-03998-z` — single-cell agent benchmark.
29. `https://www.scispot.com/blog/dotmatics-pricing`, `https://tooldirectory.ai/tools/dotmatics-scientific-rd-data-management` — Dotmatics pricing/ownership.
30. `https://www.dnanexus.com/`, `https://academy.dnanexus.com/billing-access-and-orgs/billing_and_pricing`, `https://www.softwr.com/software/dnanexus` — DNAnexus quote-only pricing.
31. `https://www.sevenbridges.com/platform/`, `https://www.fedramp.gov/marketplace/products/FR2033152148/` — Seven Bridges.

### Project-internal documents referenced
- `docs/SCIENTIFIC_RULES.md` — verdict statuses, evidence fractions, thresholds, caution flags, research-use limitation.
- `docs/PROJECT_SUMMARY.md` — benchmark numbers and honest takeaway.
- `docs/EVIDENCE_LEDGER.md`, `docs/PRIVACY_NOTE.md`, `docs/THREAT_MODEL.md` — existing provenance/privacy scaffolding (not independently audited here).

---

## 12. Known limitations of this research

- `websearch` was unavailable (HTTP 402); many findings rest on DuckDuckGo snippets rather than full pages. Prices and user counts should be re-verified against vendor pages before publication.
- No accounts were created and no paid tiers were exercised; feature behaviour was assessed from vendor marketing only.
- Absence of a claim on a vendor page (e.g. "claim-level evidence gating") is **not** proof the feature does not exist. All gap statements use "no surveyed source claims…".
- The identity of "smarls.bio" is unresolved with certainty; the evidence supports "likely a typo for smarts.bio", not a verified defunct company.
- Legal/licence summaries are informational, not legal advice; verify current licence files before relying on them.
