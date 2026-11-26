# M7.4.2 — Product Copy Audit and Disclaimer Hierarchy Plan

**Status:** Read-only audit. No HTML/CSS/JS was modified.
**Branch:** `design/brand-assistant-polish` @ `3dea99e0bfdeea67e58c81af58f367e200e6ca5d`
**Scope:** all 7 public HTML pages under `web-platform/public/`, all `web-platform/public/js/*.js` user-visible strings, and the evidence documents listed in §0.2.
**Purpose:** supply the implementation worker with a complete copy inventory, a three-level disclaimer hierarchy, claim verification, a naming inventory, final proposed copy, and a prioritized edit list.

---

## 0. Method, sources, and one stated assumption

### 0.1 Files inspected

| Kind | Files |
|---|---|
| Public HTML (7) | `web-platform/public/index.html`, `ai.html`, `phylo.html`, `taxonomy.html`, `blast.html`, `benchmark.html`, `workspace.html` |
| Public JS (20) | `web-platform/public/js/*.js` (notably `app.js`, `ai-execution.js`, `ai-workspace.js`, `phylo.js`, `workspace.js`, `taxonomy-app.js`, `blast-app.js`, `report.js`, `verdict.js`, `cloud-providers.js`, `benchmark-app.js`, `difficult-groups.js`) |
| Evidence / policy docs | `docs/THREAT_MODEL.md`, `docs/PRIVACY_NOTE.md`, `PRODUCT_VISION.md`, `docs/M7_3_PHYLOGENETICS_WORKFLOW_REPORT.md`, `docs/M7_3_2_LIVE_ARTIFACT_RECOVERY_REPORT.md`, `docs/M7_4_FINAL_REPORT.md`, `README.md`, `docs/SCIENTIFIC_RULES.md`, `web-platform/providers/workspace/catalog.js`, `web-platform/functions/api/workspace/catalog.js` |

`web-platform/providers/workspace/catalog.js` is a deprecated shim (`:1-4`) that re-exports the authoritative `functions/api/workspace/catalog.js`; the shim contains no public copy. The authoritative catalog supplies the two workflow availability statements quoted in §3.

### 0.2 Authoritative Level-A statement (source of truth: mission brief)

**Correction (tester follow-up):** the **authoritative** full research-use policy text is the exact sentence supplied in the M7.4.2 mission brief. It is already present verbatim at `web-platform/public/research-use.html:43`. The source of truth is the **mission brief**, **not** this audit document. The mission text is:

> This platform is designed for research and educational use. Its outputs are computational evidence and do not constitute clinical diagnosis. Taxonomic assignments and other scientific interpretations depend on input quality, reference databases, methods and validation. Results do not independently confirm organism identity or pathogenicity and are not validated for clinical, forensic or regulatory decision-making. Users remain responsible for independent scientific assessment and interpretation.

The earlier assumption in this section — that the 7× footer disclaimer was the supplied statement — was **wrong**, and the sentence previously labelled "Canonical Level A statement" in §2.1 (and repeated in §5.5) is a **superseded audit paraphrase**, not the contract. Do not use that wording to judge `research-use.html`. Automated validation compares against the mission text above (quoted here once); see `docs/M7_4_2_ACCESSIBILITY.md` §"D2 — retracted". The audit's claim analysis in §2.1 and §5.5 remains useful as a review of the *superseded* wording only; all disposition and naming guidance below is unaffected, except where explicitly marked.

---

## 1. Page-by-page inventory

Every user-visible occurrence of: (a) research-use/clinical disclaimers, (b) organism-identity/pathogenicity warnings, (c) research/teaching notices, (d) milestone/version/implementation labels, (e) duplicated scientific-limitation text. Quotes are exact (rendered text; HTML entities are shown as written in the source where they matter).

### 1.1 `web-platform/public/index.html` (358 lines)

| # | Category | Exact sentence / string | Line | Notes |
|---|---|---|---|---|
| 1 | Research notice (meta) | "Validate FASTA files, compute sequence statistics and review taxonomic evidence in one browser-based research workspace. Research use only." | `:6` | Description meta; visible in search results. |
| 2 | Brand | "Smart Bioinformatics Toolkit" | `:8`, `:17`, `:19` | Title, brand `aria-label`, brand span. |
| 3 | Hero | "Sequence analysis, made inspectable" | `:37` | Eyebrow. |
| 4 | Hero | "Check your sequences.<br><span>Keep the evidence.</span>" | `:38` | H1. |
| 5 | Hero / limitation | "Validate FASTA files, calculate sequence statistics and review taxonomic evidence in one browser-based workspace — with research-use caveats kept visible at every step." | `:39` | Claim: "caveats kept visible at every step" — see §3. |
| 6 | Claim (upload) | "Runs in your browser" / "No account required" / "Downloadable outputs" | `:46`, `:47`, `:48` | Hero proof list; true for standalone tools, not for agent/Galaxy routes. |
| 7 | Workflow claim | "Five connected stages. INPUT takes a FASTA file or pasted text. VALIDATE runs the FASTA Validator. PLAN records a reviewable plan in the AI workspace. EXECUTE runs Sequence Statistics or an approved job. EVIDENCE keeps the report, provenance and JSON or CSV exports." | `:56` | SVG `<desc>`; "an approved job" is aspirational. |
| 8 | Figure caption | "Read left to right. Browser-local tools run before any external work. The AI workspace records a plan for approval before heavy execution." | `:117` | Design statement. |
| 9 | **Research-use strip** | "Research-use toolkit. Outputs are screening evidence, not proof of identity and not a clinical diagnosis. Interpretation remains the user's responsibility." | `:124` | Duplicates the footer disclaimer's substance. |
| 10 | Privacy/egress | "Standalone tools process locally. FASTA parsing, validation and statistics stay in your browser. The optional AI workspace sends FASTA to the Worker only after you submit a request." | `:129` | Accurate. |
| 11 | Capability intro | "Six ways to examine your data" / "Each capability has a defined input, an inspectable output and an explicit research-use limit. Use one or combine several." | `:136`, `:137` | Six cards exist. |
| 12 | Capability cards | "Check record structure, duplicate identifiers and alphabet compliance for DNA or protein sequences." | `:144` | Verified. |
| 13 | Capability cards | "Compute length, GC content, ambiguous bases and N50 with per-record detail you can export." | `:150` | Verified. |
| 14 | Capability cards | "Filter and summarise BLAST TSV output by identity, coverage and e-value without uploading it." | `:156` | Verified. |
| 15 | Capability cards | "Derive a rank-aware consensus from BLAST hits and see exactly which evidence limits the call." | `:162` | Verified. |
| 16 | Capability cards (AI) | "Describe a question, review the exact plan, approve execution and inspect validated output." | `:168` | "validated output" only if a run completes; no live run evidenced. |
| 17 | Capability cards | "Read how the tools are evaluated and which limitations are known before trusting an output." | `:174` | Verified. |
| 18 | Tools intro | "No account. No mandatory pipeline. Use either tool independently." | `:185` | Verified. |
| 19 | Upload limit | "Maximum file size: 5 MB for this browser MVP." | `:226` | Verified (`app.js:4`). |
| 20 | Empty state | "Results, warnings and export actions appear in the workspace above — nothing is sent to a server for these standalone tools." | `:260` | Accurate, scoped to standalone tools. |
| 21 | Output card | "Each record is marked valid or invalid with a specific code, so you can trace every warning back to its input." | `:264` | Verified. |
| 22 | Output card | "Length, GC%, composition and N50 are computed locally and can be downloaded as JSON or CSV." | `:265` | Verified. |
| 23 | **Identity/pathogenicity warning** | "Outputs are screening evidence. They do not establish identity, pathogenicity or a clinical conclusion." | `:266` | Scientific-limitation copy. |
| 24 | Workflow heading | "Simple now. Connected later." | `:274` | Editorial. |
| 25 | Workflow intro | "Standalone tools run on their own. The AI workspace adds a four-stage path when you need a heavier analysis, with approval before any external work." | `:275` | Design statement. |
| 26 | Workflow stages | "Describe the question. A plan lists the exact tools and parameters before anything runs." | `:281` | Verified UI. |
| 27 | Workflow stages | "Review steps and data egress. Heavy tools wait for explicit consent and approval." | `:286` | Verified UI. |
| 28 | Workflow stages (claim) | "Approved jobs run in order. Status, parameters and limitations remain visible throughout." | `:291` | Unverified as a completed live run. |
| 29 | Workflow stages (claim) | "Inspect findings, evidence and caveats, then download artifacts with their report." | `:296` | Conditional on a real run. |
| 30 | Legend | "Start" / "Requires consent" / "Queued work" / "Reviewed output" | `:301-304` | State labels. |
| 31 | About | "This working foundation provides FASTA validation and sequence statistics in the browser, with a matching Python command-line implementation in the repository. Every result carries its limitations so it can be judged on its evidence." | `:312` | Verified. |
| 32 | Implementation note | "No frontend framework" / "No upload to a server" / "DNA and protein modes" / "CSV and JSON exports" | `:314` | "No upload to a server" is too broad once AI/Galaxy routes exist. |
| 33 | Footer description | "A modular, browser-first research workspace for sequence checks. Inspect the inputs, keep the outputs, and read the caveats." | `:325` | Repeated on all 7 pages. |
| 34 | **Full disclaimer (superseded audit paraphrase — NOT the authoritative Level A text)** | "Research-use disclaimer. This toolkit produces screening evidence for research and teaching. It is not a diagnostic device, does not establish organism identity or pathogenicity, and is not validated for clinical, forensic or regulatory decisions. All outputs require independent interpretation by a qualified user." | `:352` | Pre-rollout verbatim duplicate on 6 other pages. Source of truth is the mission text in §0.2. |
| 35 | Version/implementation label | "Smart Bioinformatics Toolkit · Milestone 0.5.0" / "No external fonts, images or CDNs · Static, framework-free pages" | `:353` | Duplicated on all 7 pages. |

### 1.2 `web-platform/public/ai.html` (304 lines)

| # | Category | Exact sentence / string | Line | Notes |
|---|---|---|---|---|
| 1 | Research notice (meta) | "Ask for a sequence analysis, review the exact plan, approve it, and inspect validated results. Research use only." | `:6` | "validated results" conditional. |
| 2 | Brand | "AI Research Workspace · Smart Bioinformatics Toolkit" | `:8` | Title. |
| 3 | Brand | "Smart Bioinformatics Toolkit home" / "Smart Bioinformatics Toolkit" | `:18`, `:20` | `aria-label`, brand span. |
| 4 | Workflow | "Plan → approve → execute → validate → explain" | `:38` | Eyebrow. |
| 5 | **Capability / limits claim** | "Two labelled routes: Browser (local) validates FASTA and computes statistics in this page with no terminal; Local agent uses the Worker to plan and a local Python agent to run heavy tools. FASTA is capped at 10,000 characters on the local-agent route and at 64 KiB (65,536 bytes) for browser-local analysis; the applicable limit is checked before submission. No backend means a blocked request, never a simulated result." | `:40` | Verified against `ai-execution.js:21-22,24-38,126-146`. |
| 6 | **Research-use strip** | "Research-use workflow. Outputs are screening evidence, not proof of identity and not a clinical diagnosis. Heavy tools require plan approval; browser-local statistics need no approval because nothing leaves this page." | `:45` | Duplicates footer substance. |
| 7 | Stages | "Your question becomes an exact list of tools, parameters and possible data egress." / "Review the plan and grant consent only for the external steps you accept." / "Approved jobs are queued and run locally; status is reported at each step." / "Inspect validation, findings, limitations and artifacts before using any output." | `:53`, `:58`, `:63`, `:68` | UI design, not run evidence. |
| 8 | Honesty note | "The stages above are the real workflow sequence, not a claim about a run. Execution and validation states are reported in the status line and result panel after you submit." | `:72` | KEEP — directly relevant to §3. |
| 9 | **External execution / consent** | "Each service is shown with its real availability. Nothing is sent to a remote service without a separate, dataset-scoped consent. Disabled or unavailable tools are never offered as executable. This check runs only when you ask for it." | `:85` | Verified. |
| 10 | Input limits (repeat of :40) | "Ask for FASTA validation/statistics, or describe a taxonomic question. The local-agent route accepts at most 10,000 characters of FASTA; browser-local analysis accepts at most 64 KiB (65,536 bytes). The applicable limit is checked before submission." | `:100` | Duplicated limit text. |
| 11 | Question help | "Use words such as validate, check, profile, stats or GC; identify, taxa, taxonomy, classify, BLAST; or tree, phylogenetic, alignment, evolutionary." | `:111` | Verified against intent regexes. |
| 12 | Route help | "Browser (local) needs no terminal or backend. Local agent requires the agent on this machine; heavy tools are blocked if it is not observed." | `:120` | Verified. |
| 13 | Upload help (repeat) | "Read locally with File.text(). Browser-local analysis is capped at 64 KiB (65,536 bytes); the local-agent route is capped at 10,000 characters and is checked before submission." | `:137` | Third copy of limit text. |
| 14 | Consent UI | "I consent to the external data use listed in this plan." | `:188` | Verified. |
| 15 | Empty state | "Submit a question and FASTA on the left. The exact plan, approval controls and validated evidence appear here — input and output stay separate." | `:219` | Conditional. |
| 16 | Output guide | "These states are shown before you run anything so that a result can be judged against its evidence, not its presentation." | `:230` | Verified. |
| 17 | Result card | "Nothing is labelled a conclusion: each field is tied to a step in the approved plan, and the execution mode is always displayed." | `:236` | Verified. |
| 18 | Validation card | "Validation records what the evidence supports and where it stops. Restricted calls stay at group or genus level, and insufficient evidence is reported rather than filled in." | `:241` | Verified by `verdict.js`/`taxonomy.js`. |
| 19 | **Education notice** | "Screening evidence narrows a question; it does not answer it. Check the exact parameters, compare against your own controls, and treat every downloadable report as a record of what was run." | `:246` | KEEP. |
| 20 | Locality | "Each route states where data is processed before you submit. This receipt is a fixed reference, not a promise inferred from a result." / "FASTA parsing, validation and statistics stay in this page." / "A plan request is sent only after you build it; heavy tools require approval." / "Approved jobs run on the local machine, with output returned for review." | `:251`, `:253-255` | Verified design; keep. |
| 21 | **Full disclaimer** | Same verbatim text as `index.html:352` | `:296` | Duplicate 2/7. |
| 22 | Version/implementation label | Same verbatim text as `index.html:353` | `:297` | Duplicate 2/7. |

### 1.3 `web-platform/public/phylo.html` (168 lines)

| # | Category | Exact sentence / string | Line | Notes |
|---|---|---|---|---|
| 1 | **Contradicted claim (meta)** | "M7.3 — run a real multi-step Galaxy phylogenetics workflow (MAFFT alignment and IQ-TREE tree) from the browser." | `:7` | See §3.1. |
| 2 | Brand | "Phylogenetics workflow — Smart Bioinformatics Toolkit" | `:8` | Title. |
| 3 | Brand | "Smart Bioinformatics Toolkit home" / "Smart Bioinformatics Toolkit" | `:17`, `:19` | `aria-label`, brand span. |
| 4 | Status badge | "Galaxy execution" | `:30` | Interface label, not a claim of completed execution. |
| 5 | H1 | "Multi-step phylogenetics on Galaxy" | `:37` | Acceptable as workflow description. |
| 6 | **Contradicted claim (kicker)** | "M7.3 — the first cloud workflow: MAFFT alignment → IQ-TREE tree, executed remotely with full provenance." | `:38` | See §3.1. Highest-priority edit. |
| 7 | **Research-use / tree limitation** | "Research use only. Your FASTA is uploaded to Galaxy only after you approve the plan. Trees are hypotheses, not publication-grade inference without independent validation." | `:42` | KEEP — scientifically meaningful. |
| 8 | Honesty note | "This rail is a sequence guide, not a status display. Job state is reported in the progress list and status line; no stage is presented as complete until output is reported." | `:54` | KEEP. |
| 9 | Consent/egress | "The file stays in this page until you approve the plan. The exact step list appears next; no job is submitted by selecting a file." | `:60` | Verified. |
| 10 | Plan | "Seven proposed steps. Review them before granting Galaxy consent." | `:77` | Verified: 7 steps in `phylo.js:33-41`. |
| 11 | **External destination / consent** | "Galaxy consent: approval uploads this dataset to Galaxy Europe for this workflow. Nothing is sent before you check the box and run." / "I approve uploading this dataset to Galaxy Europe for this workflow." | `:80`, `:81` | KEEP. |
| 12 | Tree caption | "Phylogenetic tree — rendered from returned Newick text when a job supplies it." | `:97` | Conditional, accurate. |
| 13 | **Alignment limitation** | "No alignment text has been returned by a completed job. Alignment output is retrieved with the Galaxy job datasets; nothing is shown here until real output is available." | `:101` | KEEP — contradicts `:38`; keep this one. |
| 14 | Download | "Download reproducible report (HTML)" / "Full provenance" | `:107`, `:110` | Conditional on a real job; see `phylo.js:137-139`. |
| 15 | **Empty state** | "No Galaxy job started. Select a multi-FASTA file, inspect the proposed plan and approve it to submit a job. Progress and results appear here with their reported state; blocked or incomplete stages are never shown as succeeded." | `:120-121` | KEEP — contradicts `:38`; keep this one. |
| 16 | **Full disclaimer** | Same verbatim text as `index.html:352` | `:161` | Duplicate 3/7. |
| 17 | Version/implementation label | Same verbatim text as `index.html:353` | `:162` | Duplicate 3/7. |

### 1.4 `web-platform/public/taxonomy.html` (212 lines)

| # | Category | Exact sentence / string | Line | Notes |
|---|---|---|---|---|
| 1 | Research notice (meta) | "Taxonomic consensus analysis of BLAST results, locally in your browser. Research use only." | `:6` | Verified. |
| 2 | Brand | "Taxonomy Analyzer · Smart Bioinformatics Toolkit" | `:8` | Title. |
| 3 | Brand | "Smart Bioinformatics Toolkit home" / "Smart Bioinformatics Toolkit" | `:17`, `:19` | `aria-label`, brand span. |
| 4 | Scope | "Build a transparent taxonomic consensus from BLAST results. No new BLAST request is made." | `:37` | Verified. |
| 5 | **Research-use / identity / reference warning** | "Research-use tool. Consensus support is an evidence fraction, not a probability of correct identification and not a clinical diagnosis. Difficult-group literature notes are references for review, not validated identification rules." | `:42` | KEEP substance; link to full statement. |
| 6 | Scope | "Compare competing BLAST candidates, resolve lineages, and report consensus with uncertainty." | `:47` | Verified. |
| 7 | Privacy | "All parsing and consensus analysis happens in this browser. Nothing is uploaded." | `:56` | Verified; scope to this tool. |
| 8 | Upload limit | "Maximum file size: 5 MB for this browser MVP." | `:75` | Verified (`taxonomy-app.js:10`). |
| 9 | **Reference-database coverage** | "If supplied, queries that return no BLAST hits are reported as insufficient evidence." | `:90` | KEEP. |
| 10 | **Reference-database coverage** | "Columns: taxid, scientific_name, rank, parent_taxid, full_lineage. Without it, taxa are reported as unresolved." | `:99` | KEEP. |
| 11 | **Method limit** | "Screening reference, not a universal species boundary." | `:110` | Attached to 98.65% field; KEEP. |
| 12 | Output | "Per-query verdicts, evidence support and caveats are reported together. Exports use the last completed analysis." | `:135` | Verified. |
| 13 | Empty state | "Load the synthetic example or paste BLAST tabular output on the left, then choose Analyze taxonomy. Per-query verdicts, support fractions and caveats will appear here." | `:163` | Verified. |
| 14 | **Full disclaimer** | Same verbatim text as `index.html:352` | `:206` | Duplicate 4/7. |
| 15 | Version/implementation label | Same verbatim text as `index.html:353` | `:207` | Duplicate 4/7. |

### 1.5 `web-platform/public/blast.html` (203 lines)

| # | Category | Exact sentence / string | Line | Notes |
|---|---|---|---|---|
| 1 | Research notice (meta) | "Analyze a BLAST tabular result file locally in your browser. Research use only." | `:6` | Verified. |
| 2 | Brand | "BLAST Results Analyzer · Smart Bioinformatics Toolkit" | `:8` | Title. |
| 3 | Brand | "Smart Bioinformatics Toolkit home" / "Smart Bioinformatics Toolkit" | `:17`, `:19` | `aria-label`, brand span. |
| 4 | Scope | "Import a BLAST tabular file produced elsewhere. No new BLAST request is made." | `:38` | Verified. |
| 5 | **Research-use / identity warning** | "Research-use tool. Similarity hits are screening evidence, not proof of species identity and not a clinical diagnosis." | `:43` | KEEP. |
| 6 | Privacy | "All parsing and filtering happens in this browser. Nothing is uploaded." | `:57` | Verified; scope to this tool. |
| 7 | Upload limit | "Maximum file size: 5 MB for this browser MVP." | `:75` | Verified (`blast-app.js:9`). |
| 8 | Input help | "Tab-separated. Standard 12 columns or extended 11 columns. Lines starting with # are ignored." | `:85` | Verified. |
| 9 | **Method limit** | "Used to calculate query coverage for standard 12-column input, which has no qlen column." | `:105` | KEEP. |
| 10 | Output | "Rows are filtered and ranked locally. Exports use the currently displayed result." | `:129` | Verified. |
| 11 | Empty state | "Load an example or paste BLAST tabular output on the left, then choose Analyze BLAST TSV. The validated hit table, summary counts and export actions will appear here." | `:153` | Verified. |
| 12 | **Full disclaimer** | Same verbatim text as `index.html:352` | `:196` | Duplicate 5/7. |
| 13 | Version/implementation label | Same verbatim text as `index.html:353` | `:197` | Duplicate 5/7. |

### 1.6 `web-platform/public/benchmark.html` (145 lines)

| # | Category | Exact sentence / string | Line | Notes |
|---|---|---|---|---|
| 1 | Brand | "Risk-coverage analysis - Smart Bioinformatics Toolkit" | `:7` | Title. |
| 2 | Brand | "Smart Bioinformatics Toolkit home" / "Smart Bioinformatics Toolkit" | `:16`, `:18` | `aria-label`, brand span. |
| 3 | **Implementation / non-result label** | "Demonstration / not a benchmark result" | `:32` | KEEP. |
| 4 | H1 | "Risk-coverage analysis" | `:33` | Fine. |
| 5 | **Unverifiable source claim** | "A walkthrough of the risk-coverage sweep calculation using synthetic demonstration data from `shared/test-cases/risk_coverage_cases.json`. Real held-out numbers are in `benchmark_data/RESULTS.md`." | `:34` | Fixture exists; `benchmark_data/RESULTS.md` **does not exist in this tree**. See §3.3. |
| 6 | **Limitation label** | "Synthetic demonstration — not a performance measurement" / "The sweep varies the species screening identity and shows species call rate against wrong rate. Lower wrong rate at the same call rate is better; abstentions are counted in the table." | `:38-39` | KEEP. |
| 7 | Figure caption | "At each screening threshold, the two bars describe the same five synthetic cases: species calls made, and calls that are wrong when counted against all cases." | `:48` | KEEP. |
| 8 | Explain section | "What is and is not measured" | `:59` | KEEP. |
| 9 | **Method limit** | "Call rate is calls divided by all cases. Overall wrong rate is wrong calls divided by all cases, so abstentions remain in the denominator." | `:67` | KEEP. |
| 10 | **Method limit** | "These are fixture values, not performance on held-out or real samples." | `:75` | KEEP. |
| 11 | **Identity warning** | "Correct and wrong are judged only against the fixture's supplied `true_species` labels; this is not proof of species identity." | `:76` | KEEP. |
| 12 | **Method limit** | "No confidence intervals, uncertainty estimates or generalisation beyond these five cases are reported." | `:77` | KEEP. |
| 13 | **Clinical warning** | "No clinical validity or diagnostic claim follows from this illustration." | `:79` | KEEP. |
| 14 | Table caption | "Synthetic risk-coverage sweep values (not performance data)" | `:93` | KEEP. |
| 15 | **Limitations + unverifiable source claim** | "The five threshold points are chosen to illustrate how the rates move, not to establish a rule: differences between adjacent points are properties of this small fixture. Treat every value on this page as an illustration of the calculation, never as an accuracy estimate. For measured results, consult `benchmark_data/RESULTS.md`." | `:102` | Same missing-file problem as `:34`. |
| 16 | **Full disclaimer** | Same verbatim text as `index.html:352` | `:139` | Duplicate 6/7. |
| 17 | Version/implementation label | Same verbatim text as `index.html:353` | `:140` | Duplicate 6/7. |

### 1.7 `web-platform/public/workspace.html` (308 lines)

| # | Category | Exact sentence / string | Line | Notes |
|---|---|---|---|---|
| 1 | Brand | "Research workspace — Smart Bioinformatics Toolkit" | `:6` | Title. |
| 2 | Brand | "Smart Bioinformatics Toolkit home" / "Smart Bioinformatics Toolkit" | `:12`, `:14` | `aria-label`, brand span. |
| 3 | Scope | "Projects, dataset metadata, workflow catalog and run history in one place." | `:32` | Verified. |
| 4 | **Persistence / privacy notice** | "Local browser session — not persisted to the server; no server-side ownership applies. For durable owner-scoped projects, operators can use the authenticated API." / "Current mode: local browser session (no token in use)." | `:37-38` | Verified (`workspace.js:3-9,121-152,156-159`). |
| 5 | Access notice | "Existing operator identity for platform operators — not a visitor login. Local browser sessions need no token." | `:48` | Verified. |
| 6 | **Token handling warning** | "Warning: the token is held only in this page's memory. It is never written to localStorage, a URL or a link, and it is never cleared by the browser storage clear control. This is the platform's existing operator identity (`X-Agent-Token`), not a visitor login." | `:51` | KEEP — security-relevant. |
| 7 | **Sample notice** | "Sample project (precomputed — not executed)" / "Fixed sample data for interface development only. Opening it never starts an analysis." | `:99-100` | KEEP. |
| 8 | **Persistence limit** | "Metadata only — no file bytes are stored; provider references are not proof of durable storage." | `:150` | KEEP. |
| 9 | **Execution-status claim** | "Launching a workflow records a planned/draft run only. This workspace never executes a scientific tool." | `:194` | KEEP — accurate and important. |
| 10 | State legend | "draft — record created, not planned." / "planned — intended work, no execution." / "execution_completed — execution stage done; no artifacts or validation implied." / "succeeded — all stages complete with a provenance record." | `:207-217` | KEEP. |
| 11 | **Sample notice** | "SAMPLE / PRECOMPUTED — not a newly executed analysis." | `:247` | KEEP. |
| 12 | Empty state | "Create a project or select one from the project rail to inspect its overview, dataset registry, workflow catalog and run history. You can also open the clearly labelled sample below. This workspace records metadata only; it never executes a scientific tool." | `:260` | KEEP. |
| 13 | **Full disclaimer** | Same verbatim text as `index.html:352` | `:301` | Duplicate 7/7. |
| 14 | Version/implementation label | Same verbatim text as `index.html:353` | `:302` | Duplicate 7/7. |

### 1.8 User-visible JS strings (limitation / disclaimer / claim text)

| File:line | Exact string | Category |
|---|---|---|
| `js/app.js:115` | "Ambiguous IUPAC symbols are accepted but reported as warnings. Invalid records are excluded from sequence statistics." | Method limit |
| `js/app.js:149-151` | "Statistics include valid, non-empty records only. GC% = (G + C) / (A + C + G + T) × 100; ambiguous bases are excluded from the denominator. N50 is a collection-level summary, not identification or sequencing-quality evidence. …" | Method/identity limit |
| `js/blast-app.js:159` | "Standard 12-column input has no qlen column. Query coverage is unavailable unless query lengths are provided; rows fail the coverage filter only when a minimum coverage threshold is set. BLAST similarity is evidence, not proof of species identity." | Reference-data + identity limit |
| `js/blast-app.js:161` | "Query coverage calculated from aligned query coordinates and qlen. BLAST similarity is evidence, not proof of species identity." | Identity limit (duplicates tail of `:159`) |
| `js/taxonomy-app.js:215` | "Why this rank / caveats" | Contextual warning label |
| `js/taxonomy-app.js:325-328` | "Some queries returned no BLAST hits and are reported as insufficient evidence." / "Some candidate sets were truncated at the configured top-N." / "Some hits carry multiple taxonomy identifiers." / "Some hits have no taxonomy identifiers." | Reference-database coverage/confidence |
| `js/taxonomy-app.js:329` | "Consensus support is an evidence fraction, not a probability of correct identification. BLAST similarity is not proof of species identity." | Duplicates `taxonomy.html:42` and `verdict.js:13-15` substance |
| `js/verdict.js:13-15` | "Research use only. This verdict interprets BLAST similarity evidence; it is not proof of species identity and not a clinical diagnosis." | Disclaimer in result panels/reports |
| `js/report.js:22,39` | "Smart Bioinformatics Toolkit" (metadata tool + report title); version "0.1.0" | Brand/version in downloaded HTML report |
| `js/report.js:34` | "Research use only. This verdict interprets BLAST similarity evidence; it is not proof of species identity and not a clinical diagnosis." | Disclaimer in downloaded report (duplicate of `verdict.js:13-15`) |
| `js/report.js:74,93` | Per-verdict and full-report disclaimer rendering (`verdict.disclaimer`, `metadata.disclaimer`) | Duplicated report disclaimer |
| `js/ai-execution.js:29,35` | "The local-agent route accepts at most 10,000 characters of FASTA…" / "The browser-local route accepts at most 64 KiB (65,536 bytes) of FASTA…" | Upload limits (duplicated in `ai.html:40,100,137`) |
| `js/ai-execution.js:57-66` | "Agent not connected — heavy analyses unavailable; browser-local tools still work." / "Backend: mock — simulated results not scientific evidence" / "Execution: mock (not scientific evidence)" | Honest capability/egress labels |
| `js/ai-execution.js:133` | "Browser (local) can validate FASTA and compute statistics only. This request needs the local agent; no simulated result will be produced." | Capability limit |
| `js/ai-execution.js:159-163` | "Computed in your browser from the FASTA on this page; nothing was uploaded and no Worker or agent was used." / "Descriptive screening statistics only; not a taxonomic identification or a clinical result." | Method + research limit |
| `js/ai-workspace.js:24` | "Local agent did not claim this job within 10 minutes. …" | Execution status |
| `js/ai-workspace.js:128-139` | "Unavailable: Worker is in mock mode. Simulated results are not scientific evidence." / "The local agent is unavailable, so the local-agent route is blocked. Browser-local analysis still works." | External-execution limit |
| `js/ai-workspace.js:298` | "You asked about taxonomic identification. This MVP can validate and profile the FASTA, but real taxa calls need BLAST hits from a local database. No taxa result will be claimed." | Reference-database coverage warning |
| `js/ai-workspace.js:301` | "You asked for a phylogenetic analysis. One local tool will align the sequences, build a neighbor-joining tree and produce a reproducible report. This is research-use output, not a publication-grade tree." | Phylo limitation |
| `js/ai-workspace.js:334` | "Requires a local BLAST database; not part of this run." | Reference-database coverage warning |
| `js/ai-workspace.js:400,590,623` | "None — computed in this page from the FASTA you supplied; nothing was uploaded." / "Browser-local run: FASTA parsing, validation and statistics stayed in this page. No Worker or agent was used…" / "No external transmissions (no data left the machine)." | Locality/consent receipts |
| `js/phylo.js:45,122,131,132,134,144` | "Plan ready. Nothing has been uploaded yet — approve to execute." / "Approved — submitting to Galaxy…" / "FULL WORKFLOW COMPLETED" / "JOB SUBMITTED / INCOMPLETE — artifacts may not be retrieved or validated" / "Alignment: PASS/FAIL; Tree: PASS/FAIL" / "Tree is available in the job-derived report; awaiting tree dataset text." | Runtime status; honest conditional labels |
| `js/workspace.js:14` | "Fixed sample data for interface development only. This is NOT a newly executed analysis, NOT a scientific result, and no bytes, jobs or provider references were created." | Sample disclaimer (duplicates `workspace.html:100,247`) |
| `js/workspace.js:25,36,55` | 16S catalog: "Profile and identify 16S rRNA sequences using the existing local BLAST + consensus/verdict pipeline." / "Uses the existing public /api/ai/requests -> approve -> BLAST path with a single-use consent token for external egress. No new execution was added in M7.4." / phylo: "A real MAFFT step executed once, but the full multi-step remote tree/retrieval/validation path is NOT verified." | Workflow availability claims |
| `js/workspace.js:35` | `production_ready: true` (16S) | Public readiness claim — see §3.6 |
| `js/workspace.js:51` | "expected clades on the synthetic reference (known by construction, not a publication-grade benchmark)" | Phylo validation limit |
| `js/workspace.js:187` | "Execution availability: ${state} (production_ready: ${…}) — ${note}" | Renders readiness claim in UI |
| `js/workspace.js:438` | "(metadata only; … — not proof of durable bytes)" | Persistence limit |
| `js/cloud-providers.js:28,29` | "Public API access is disabled pending written provider authorization." / "No provider text is treated as a scientific conclusion." | External-service warning |
| `js/cloud-providers.js:68` | "Cloud service status checked. Files leave the platform only with explicit, dataset-scoped consent." | Consent reassurance |
| `js/benchmark-app.js:21` | "Synthetic risk-coverage demonstration. … These are example values, not measured performance; the table below gives exact numbers." | Method limit (duplicates `benchmark.html:38-39`) |
| `js/difficult-groups.js:16,31,46` | "16S similarity cannot separate these species reliably; report at group level and confirm with other evidence…" / "Viridans streptococci frequently cannot be resolved to species by 16S sequencing alone; genus-level reporting is common practice." / "16S rRNA similarity alone cannot reliably separate Escherichia coli from Shigella spp.…" | Organism-identity warnings; all three entries carry `needs_curator_review: true` (`:19,34,49`) and must not be upgraded to validated rules |

---

## 2. Disclaimer hierarchy and disposition

### 2.1 The three levels

| Level | Location | Content | Rationale |
|---|---|---|---|
| **A** | New dedicated `/research-use.html` | The complete policy: the verbatim full statement plus scope, evidence limits, difficult groups, reference-database coverage, phylogenetics status, external execution/consent, validation/downloads, benchmark limits. | One authoritative, linkable source; removes 7 duplicated full disclaimers without losing substance. |
| **B** | Footer of all 7 pages | Exactly one short notice: **"Research and educational use only. Results require independent scientific interpretation."** + link text "Full research-use statement" → `/research-use.html`. | Uniform baseline; every page signals scope and points to Level A. |
| **C** | Contextual locations only | Four families: (i) taxonomy reference-database coverage/confidence, (ii) phylo tree limits + independent validation, (iii) external execution destination/consent, (iv) report/method-specific limits. | Limits belong next to the claim they constrain; a generic footer cannot carry them. **No meaningful scientific limitation is removed.** |

**Superseded audit paraphrase (NOT authoritative — do not treat as the Level-A contract).** This was the 7× footer text at pre-rollout `index.html:352` (identical at `ai.html:296`, `phylo.html:161`, `taxonomy.html:206`, `blast.html:196`, `benchmark.html:139`, `workspace.html:301`):

> **Research-use disclaimer.** This toolkit produces screening evidence for research and teaching. It is not a diagnostic device, does not establish organism identity or pathogenicity, and is not validated for clinical, forensic or regulatory decisions. All outputs require independent interpretation by a qualified user.

**Superseded consistency review of that paraphrase:** "screening evidence for research and teaching" is consistent with the browser FASTA/statistics/BLAST-TSV/taxonomy tools and with `README.md:236-238` and `PRODUCT_VISION.md:28-33`; "does not establish organism identity or pathogenicity" is consistent with `verdict.js:13-15` and `SCIENTIFIC_RULES.md:58`; "not validated for clinical, forensic or regulatory decisions" is consistent with `PRODUCT_VISION.md:82` ("Not a clinical or diagnostic device; no medical claims"). This review was written before the mission text in §0.2 was confirmed. The **authoritative** statement is quoted once in §0.2 and is already in place at `research-use.html:43`; keep that mission text verbatim and do not replace it with the paraphrase above.

### 2.2 Disposition of each occurrence group

| Occurrence(s) | Level | Disposition | Exact replacement copy / action |
|---|---|---|---|
| `index.html:352`; `ai.html:296`; `phylo.html:161`; `taxonomy.html:206`; `blast.html:196`; `benchmark.html:139`; `workspace.html:301` (7× full disclaimer) | B + A | **MOVE** full text to `/research-use.html`; **SHORTEN** each footer to Level B notice | Footer: `<p class="footer-disclaimer">Research and educational use only. Results require independent scientific interpretation. <a href="/research-use.html">Full research-use statement</a>.</p>` |
| `index.html:124` research strip | B/C | **SHORTEN** (keep local scope, drop duplicated definition) | "Research use only. These outputs are screening evidence, not proof of identity; interpretation stays with you. [Full statement](research-use.html)" |
| `ai.html:45` research strip | B/C | **SHORTEN** | "Research use only. Outputs are screening evidence; heavy tools require plan approval. [Full statement](research-use.html)" |
| `phylo.html:42` research strip | C (phylo) | **KEEP** verbatim | No change. This is the only page-level statement of the tree limitation. |
| `taxonomy.html:42` research strip | C (taxonomy) | **KEEP** verbatim; add link | Append: " [Full statement](research-use.html)" |
| `blast.html:43` research strip | C (method) | **KEEP** verbatim | No change. |
| `benchmark.html:32,38-39,48,59,65-79,93,102` | C (method) | **KEEP**; **FIX** `:34` and `:102` source reference (see §3.3) | See §3.3 for replacement sentences. |
| `index.html:266` output card "Outputs are screening evidence. They do not establish identity, pathogenicity or a clinical conclusion." | C (context) | **KEEP** | No change; it is next to the output it constrains. |
| `taxonomy.html:90,99,110`; `taxonomy-app.js:325-329`; `verdict.js:13-15`; `report.js:34,74,93`; `difficult-groups.js:16,31,46` | C (taxonomy/reference DB) | **KEEP** substance; **SHORTEN** duplicated tail of `taxonomy-app.js:329` and `blast-app.js:159/161` | Keep every coverage/insufficient-evidence flag. Replace the repeated tail with one short line per result panel: "Support is an evidence fraction, not an identification probability. [Limits](research-use.html)" |
| `phylo.html:101`, `:120-121`, `:54`; `ai-workspace.js:301`; `workspace.js:51,55`; `phylo.js:131-134,144` | C (phylo) | **KEEP** verbatim | Do not remove placeholders, "No Galaxy job started", "INCOMPLETE — artifacts may not be retrieved or validated", "not a publication-grade tree", "known by construction". |
| `phylo.html:7`, `:38` | — | **REMOVE/REPLACE** (false claim) | Verified replacement copy in §3.1. |
| `ai.html:40,85,100,120,137,188`; `phylo.html:42,60,80-81`; `cloud-providers.js:28,29,68`; `ai-execution.js:57-66,133`; `ai-workspace.js:128-139,347,590,623`; `workspace.html:37-38,48,51,150,194,247,260` | C (egress/consent) | **KEEP** consent semantics; **SHORTEN** the three repeated FASTA-limit copies `ai.html:40,100,137` into one + one cross-reference | Keep "Nothing is sent to a remote service without a separate, dataset-scoped consent" (`ai.html:85`) and "Files leave the platform only with explicit, dataset-scoped consent" (`cloud-providers.js:68`). |
| `index.html:314` "No upload to a server"; `taxonomy.html:56`; `blast.html:57` | B/C | **SHORTEN** (overbroad) | "Standalone tools do not upload data; the AI workspace and phylogenetics pages send data only after you approve the step." |
| `index.html:353`; `ai.html:297`; `phylo.html:162`; `taxonomy.html:207`; `blast.html:197`; `benchmark.html:140`; `workspace.html:302` (version/implementation notes) | — | **MOVE** to About/docs; **SHORTEN** footer to brand only | Footer-bottom: "Smart Bioinformatics AI" (optionally "· Milestone 0.5.0" if a version marker is required; see §4.3). Keep "No external fonts, images or CDNs · framework-free" once in `index.html#about` (`about-points`, `:314`) and in `docs/DESIGN_SYSTEM.md:176`, not in 7 footers. |
| `index.html:124` "Research-use toolkit"; footer "This toolkit produces…" | — | **KEEP** as generic noun in the pre-rollout footer copy only (the authoritative Level-A text is the mission statement in §0.2, which does not use "toolkit"); **REPLACE** brand uses with "Smart Bioinformatics AI" (§4) | Hero strip can read "Research-use workspace." if "toolkit" is retired as a brand. |

No occurrence is recommended for silent removal except the two contradicted phylogenetics claims (`phylo.html:7,38`), which are replaced rather than deleted, and the duplicated footer text, which is consolidated into Level A.

---

## 3. Scientific claim verification

Legend: **VERIFIED** = supported by inspected source/docs; **PARTIAL** = true as UI/design intent, no completed live run evidenced; **UNVERIFIED** = no supporting artifact in this tree; **CONTRADICTED** = directly opposed by inspected evidence.

### 3.1 The phylogenetics contradiction (highest priority)

**Public claim A** — `phylo.html:7`:
> "M7.3 — run a real multi-step Galaxy phylogenetics workflow (MAFFT alignment and IQ-TREE tree) from the browser."

**Public claim B** — `phylo.html:38`:
> "M7.3 — the first cloud workflow: MAFFT alignment → IQ-TREE tree, executed remotely with full provenance."

**Contradicting public text on the same page** — `phylo.html:101`:
> "No alignment text has been returned by a completed job. Alignment output is retrieved with the Galaxy job datasets; nothing is shown here until real output is available."

and `phylo.html:120-121`:
> "No Galaxy job started. Select a multi-FASTA file, inspect the proposed plan and approve it to submit a job. Progress and results appear here with their reported state; blocked or incomplete stages are never shown as succeeded."

**Contradicting evidence** — `docs/M7_3_PHYLOGENETICS_WORKFLOW_REPORT.md:3` ("a real remote multi-step Galaxy run has NOT yet been demonstrated through the website"), `:47-54` (no job IDs/datasets/hashes/times; acceptance gates unmet), `:71` (MAFFT HTTP 400 on all attempts), `:84-88` (one MAFFT job `4838ba20a6d8676526e1c47a033d95de` state `ok`, exit 0; alignment retrieval, tree job, remote validation and run-derived report NOT ACHIEVED); `docs/M7_3_2_LIVE_ARTIFACT_RECOVERY_REPORT.md:17,29,32,41` (no further live calls; no alignment/Newick hashes; verdict BLOCKED); `docs/M7_4_FINAL_REPORT.md:47,49,97` (`partial-not-production-ready`; no scientific execution in M7.4). The authoritative catalog agrees — `web-platform/functions/api/workspace/catalog.js:44-48`: state `partial-not-production-ready`, `production_ready: false`, note "A real MAFFT step executed once, but the full multi-step remote tree/retrieval/validation path is NOT verified."

**Verdict:** CONTRADICTED. The page presents a completed, fully-provenanced MAFFT→IQ-TREE run that the repository evidence does not support.

**Verified replacement copy (use exactly; do not invent new claims):**

- For `phylo.html:7` (meta description):
  > "M7.3 phylogenetics: proposed MAFFT → IQ-TREE workflow with plan review and consent. MAFFT submission/completion was evidenced once; full multi-step execution is unverified; workflow not production-ready."
- For `phylo.html:38` (section kicker):
  > "M7.3 — a proposed cloud workflow: MAFFT alignment → IQ-TREE tree. MAFFT submission/completion was evidenced once; full multi-step execution is unverified; workflow not production-ready."
- Keep verbatim: `phylo.html:42` (tree limitation/consent), `:54` (rail is not status), `:80-81` (Galaxy consent), `:101` (no alignment returned), `:120-121` (no job started), and `phylo.js:131` runtime status (which already distinguishes `FULL WORKFLOW COMPLETED` from `JOB SUBMITTED / INCOMPLETE`).

### 3.2 Workflows, AI capability, uploads/persistence, validation, downloads

| Claim | Source | Verdict | Notes / required qualification |
|---|---|---|---|
| Six capabilities exist (FASTA validation, statistics, BLAST TSV, taxonomy, AI workspace, benchmark) | `index.html:136-177` | VERIFIED | All six pages/cards exist. |
| Standalone FASTA tools validate, compute statistics, and export JSON/CSV/FASTA locally; 5 MB cap; no account | `index.html:46-48,185,226,260,264-265`; `app.js:4,89,115,149-151` | VERIFIED | Downloads generated via Blobs (`THREAT_MODEL.md:35-36`). |
| Standalone BLAST/taxonomy pages parse user TSV locally; no new BLAST request; 5 MB cap | `blast.html:38,57,75`; `taxonomy.html:37,56,75`; `blast-app.js:9`; `taxonomy-app.js:10` | VERIFIED | `PRIVACY_NOTE.md:7`; `DATA_TRANSPORT.md:15`. |
| AI workspace browser route validates/statistics locally; agent route needs a connected local agent; no backend → blocked, never simulated | `ai.html:40,120`; `ai-execution.js:21-38,57-66,126-146` | VERIFIED | Mock mode is explicitly labelled, not presented as evidence (`ai-execution.js:61-66`). |
| "inspect validated output" / "inspect validated results" | `index.html:168`; `ai.html:6,219,236` | PARTIAL | UI implements the validation panel; **no completed live end-to-end run is evidenced** in this tree. Qualify as "inspect validation findings when a run completes". |
| "Approved jobs run in order. Status, parameters and limitations remain visible throughout." | `index.html:291` | PARTIAL | Design intent in `ai-workspace.js:426-520`; no live run artifact. Add "when an agent claims the job" or point to `ai.html:72` honesty note. |
| Workspace records metadata only, never executes a scientific tool; sample is precomputed | `workspace.html:37-38,99-100,150,194,247,260`; `workspace.js:3-9,14,121-152` | VERIFIED | Strongest honest copy on the site; KEEP. |
| Durable owner-scoped projects exist via authenticated API; operator token memory-only, no visitor login | `workspace.html:37,48,51`; `workspace.js:113,156-159,203-230` | VERIFIED | `docs/M7_4_FINAL_REPORT.md`; `THREAT_MODEL.md:80-83`. |
| Data-transfer ledger, dataset-scoped consent, locality receipt | `ai.html:85,251-255`; `cloud-providers.js:35-68`; `ai-workspace.js:585-660` | VERIFIED (design) | `DATA_TRANSPORT.md:41,63-64,116-118`; `PRODUCT_REQUIREMENTS.md:FR-8.5`. |
| "Download reproducible report (HTML)" / "Full provenance" on phylo results | `phylo.html:105-112`; `phylo.js:135-139` | PARTIAL | Only rendered when a real `treeJob` exists; no such job evidenced in tree. Keep conditional wording. |
| 16S workflow `production_ready: true` rendered publicly | `workspace.js:35,187`; `functions/api/workspace/catalog.js:23-27` | UNVERIFIED as a live-service claim | Authoritative catalog asserts it, but `PRODUCT_VISION.md:72` says benchmark source absent and `docs/discovery/REVIEW_worker_ui.md:36` notes execution mode is self-reported by the agent. Do not surface `production_ready: true` as a public promise without a reviewer decision (§6, P8). |
| Benchmark "Real held-out numbers are in `benchmark_data/RESULTS.md`" | `benchmark.html:34,102` | UNVERIFIED (file absent) | See §3.3. |
| `msa-phylogenetics` `partial-not-production-ready`, `production_ready: false` | `workspace.js:53-56`; `catalog.js:44-48`; `M7_4_FINAL_REPORT.md:47,49` | VERIFIED | Use this as the public status source of truth. |

### 3.3 Missing benchmark results file

Both `benchmark.html:34` and `:102` promise "real held-out numbers" in `benchmark_data/RESULTS.md`. That path **does not exist** in this worktree (`Test-Path` = false), and `PRODUCT_VISION.md:72` explicitly records that the source results file is absent and quoted figures are UNVERIFIED. The synthetic fixture `shared/test-cases/risk_coverage_cases.json` **does** exist.

**Verified replacement copy:**
- `benchmark.html:34` → "A walkthrough of the risk-coverage sweep calculation using synthetic demonstration data from `shared/test-cases/risk_coverage_cases.json`. No held-out results file is present in this repository; every value shown here is illustrative."
- `benchmark.html:102` (final sentence) → "For measured results, no results file is available in this repository; do not treat these values as an accuracy estimate."

Keep the existing "Demonstration / not a benchmark result" (`:32`), "not a performance measurement" (`:38`) and "not proof of species identity" (`:76`) statements unchanged.

### 3.4 Phylogenetics status — one-line summary for reuse

> MAFFT submission/completion evidenced once; full multi-step execution unverified; workflow not production-ready.

This sentence is the only status wording that should appear on public pages and in the research-use page; it is drawn from `M7_3_2_LIVE_ARTIFACT_RECOVERY_REPORT.md:26,29,32` and `catalog.js:44-48`.

### 3.5 Claims deliberately **not** made

Per `PRODUCT_VISION.md:77-86`: no claim of being the first agentic bioinformatics platform, no clinical validity, no higher accuracy than existing tools, no replacement for Galaxy/QIIME 2/Nextflow/LIMS, no invention of conclusions/citations/p-values/statistics, no unconsented data transfer. The current public copy is consistent with these non-goals except for the two phylo claims in §3.1 and the two benchmark file references in §3.3.

### 3.6 Threat-model/privacy cross-check

`THREAT_MODEL.md:35-36` confirms no analytics, telemetry, third-party scripts, fonts or external origins in the frontend, and client downloads generated locally via Blobs — supporting the footer implementation notes and "nothing is uploaded" copy **for standalone tools only**. `PRIVACY_NOTE.md:7` confirms FASTA is never uploaded by validator/statistics/BLAST-TSV/taxonomy pages. `PRIVACY_NOTE.md:20-21` flags residual risks (cross-user RID read, no global rate limit) that argue against adding new public assurance language about remote submission safety.

---

## 4. Product naming inventory

| Term | Public occurrences (exact locations) | Verdict / action |
|---|---|---|
| "Smart Bioinformatics Toolkit" (brand) | Titles: `index.html:8`, `ai.html:8`, `phylo.html:8`, `taxonomy.html:8`, `blast.html:8`, `benchmark.html:7`, `workspace.html:6` (7). Brand spans: `index.html:19,323`; `ai.html:20,267`; `phylo.html:19,132`; `taxonomy.html:19,177`; `blast.html:19,167`; `benchmark.html:18,110`; `workspace.html:14,272` (14). `aria-label="Smart Bioinformatics Toolkit home"`: `index.html:17`, `ai.html:18`, `phylo.html:17`, `taxonomy.html:17`, `blast.html:17`, `benchmark.html:16`, `workspace.html:12` (7). Downloaded report: `js/report.js:22,39` (2). **Total public-facing: 30.** | **REPLACE** with "Smart Bioinformatics AI" on all 30 public strings. `PRODUCT_VISION.md:1,26` is the approved name ("Product Vision — Smart Bioinformatics AI"; vision statement begins "Smart Bioinformatics AI is a modular research platform…"). |
| "Smart Bioinformatics AI" | `PRODUCT_VISION.md:1,26` only; **zero public occurrences** | Adopt as the public brand. Do not change product capability claims while renaming. |
| "toolkit" (generic noun) | `index.html:124` "Research-use toolkit."; superseded 7× footer disclaimer "This toolkit produces screening evidence for research and teaching." (§2.2); `README.md` / `docs/THREAT_MODEL.md:1` (non-public docs) | Historical/superseded copy only. The authoritative Level-A statement is the mission text in §0.2 (already at `research-use.html:43`); do not edit it. Elsewhere, prefer "workspace" or the brand name to avoid implying the old product name. |
| "Milestone 0.5.0" | Footer-bottom on all 7 pages: `index.html:353`, `ai.html:297`, `phylo.html:162`, `taxonomy.html:207`, `blast.html:197`, `benchmark.html:140`, `workspace.html:302` (7) | **MOVE** to docs/About. It is a milestone label, not a product identity; `PRODUCT_VISION.md:4` says the milestone-0.5 scope is superseded as product goal. If a version marker is required in the footer, keep exactly one neutral "Smart Bioinformatics AI · Milestone 0.5.0" and treat it as a version label, not capability copy. |
| "framework-free" / "no external fonts, images or CDNs" / "Static … pages" | Same 7 footer-bottom lines; plus `index.html:314` "No frontend framework" | **KEEP one** in `index.html#about` (`about-points`, `:314`) and in `docs/DESIGN_SYSTEM.md:176`; **REMOVE** the 6 duplicated footer copies. Verified by `THREAT_MODEL.md:35-36` and `docs/discovery/AUDIT_api_infra.md:164`. |
| "M7.3" milestone label | `phylo.html:7,38` (2) | Replace with status wording from §3.4; keep the identifier only if the team wants milestone traceability in a docs link, not as a claim. |
| "Demonstration / not a benchmark result" | `benchmark.html:32` | KEEP — accurate implementation/limitation label. |
| "SAMPLE / PRECOMPUTED" | `workspace.html:99,247`; `js/workspace.js:13,666` | KEEP — accurate status label. |

---

## 5. Proposed final copy set

Tone: professional, non-marketing, accurate. Nothing in this section asserts unverified execution, accuracy or clinical utility.

### 5.1 Hero (index.html:37-39)

- Eyebrow: "Sequence analysis, made inspectable" *(keep)*
- Headline: "Check your sequences.<br><span>Keep the evidence.</span>" *(keep)*
- Subhead: "Validate FASTA files, calculate sequence statistics and review taxonomic evidence from BLAST results in your browser. Research-use caveats stay visible with each output."

Rationale: replaces "one browser-based workspace" with the precise data flow (taxonomy consumes BLAST TSV; it does not run BLAST) and avoids implying all listed work happens in the browser.

### 5.2 Capability section intro (index.html:136-137)

- Heading: "Six ways to examine your data" *(keep)*
- Lede: "Six capabilities are available: FASTA validation, sequence statistics, BLAST TSV analysis, taxonomic consensus, the AI workspace and benchmark transparency. Each has a defined input and an inspectable output. The AI workspace and phylogenetics pages add plan review and consent-gated external work."

### 5.3 Workflow explanation (index.html:274-275, 281-296; ai.html:72)

> "Standalone tools run in the page with no account. The AI workspace adds a four-stage path — plan, approve, execute, validate — for heavier analysis. An external step runs only after you review the plan and grant consent. This describes the workflow, not the outcome of any particular run."

Keep the four stage cards and the legend, but qualify `index.html:291` to: "Approved jobs run in order when a local agent claims them; status, parameters and limitations remain visible." Keep `ai.html:72` verbatim — it is the best existing anti-overclaim sentence.

### 5.4 Footer notice (all 7 pages; replaces `index.html:352` et al.)

> "Research and educational use only. Results require independent scientific interpretation. [Full research-use statement](research-use.html)"

Footer-bottom: "Smart Bioinformatics AI" (optionally append "· Milestone 0.5.0" per §4). Move "No external fonts, images or CDNs · Static, framework-free pages" to `index.html#about` only.

### 5.5 `/research-use.html` outline (Level A)

1. **Full statement:** use the authoritative mission text quoted once in §0.2 (present verbatim at `web-platform/public/research-use.html:43`). The older footer wording previously listed here is superseded and must not replace the mission text.
2. **What this covers.** Browser FASTA validation and statistics; BLAST TSV filtering; taxonomic consensus from user-supplied BLAST TSV; the AI workspace plan/approval flow; the synthetic benchmark walkthrough; the research workspace metadata view. No clinical, forensic or regulatory decision is supported. *(Sources: `index.html:141-176`; `README.md:236-238`; `PRODUCT_VISION.md:79-86`.)*
3. **Evidence limits.** BLAST similarity is evidence, not proof of species identity or function; support fractions are evidence fractions, not calibrated probabilities; 98.65% is a screening reference, not a universal species boundary; 16S alone often cannot separate members of the Bacillus cereus group, mitis-group viridans streptococci, or Escherichia/Shigella; difficult-group notes need curator review. *(Sources: `verdict.js:13-15`; `SCIENTIFIC_RULES.md:54-58`; `taxonomy.html:42,110`; `difficult-groups.js:16,31,46`; `README.md:239-251`.)*
4. **Reference-database coverage and confidence.** Results depend on the user's BLAST TSV and, optionally, a taxonomy mapping; without a mapping, taxa are reported as unresolved; queries with no hits, truncated candidate sets, multiple taxids or missing taxids are flagged as insufficient or caveated. Local-agent taxa calls need a local BLAST database and are not claimed without it. *(Sources: `taxonomy.html:90,99`; `taxonomy-app.js:325-329`; `ai-workspace.js:298,334`.)*
5. **Phylogenetics (M7.3).** Use the verified status sentence: "MAFFT submission/completion evidenced once; full multi-step execution unverified; workflow not production-ready." Trees are hypotheses, not publication-grade inference without independent validation; the reference clades are known by construction, not from an external benchmark. FASTA is uploaded to Galaxy only after explicit approval. *(Sources: §3.1; `phylo.html:42,80-81`; `workspace.js:51,55`.)*
6. **External execution and consent.** Standalone tools parse locally; a Worker plan request is sent only after the user submits; heavy tools require a local agent, plan approval and per-step consent; the data-transfer ledger and locality receipt record destinations, byte counts and consent references. Files leave the platform only with explicit, dataset-scoped consent. *(Sources: `ai.html:85,251-255`; `cloud-providers.js:68`; `DATA_TRANSPORT.md:63-64`.)*
7. **Validation and downloads.** JSON/CSV/HTML exports and printable reports carry parameters, thresholds, input hashes, limitations and provenance metadata; a completed stage does not imply validated artifacts (`workspace.html:207-218`). No output is labelled a conclusion. *(Sources: `report.js:21-35,93`; `workspace.html:150,194`.)*
8. **Benchmark limits.** The risk-coverage page is a synthetic five-case calculation, not measured performance; no held-out results file is present in this repository; no confidence intervals or generalisation are claimed; no clinical validity follows. *(Sources: `benchmark.html:32,38-39,75-79,102`; §3.3.)*
9. **Version contact line.** "Smart Bioinformatics AI · Milestone 0.5.0" (documentation-level marker only).

### 5.6 Assistant role line (ai.html:38 / capability card)

> "The assistant plans and explains; deterministic tools produce all scientific values. It does not invent results, citations or conclusions."

Consistent with `PRODUCT_VISION.md:26,30-33,101` and `ai-execution.js:1-5`. Do **not** describe the assistant as performing computation or as an autonomous scientist.

### 5.7 Contextual warnings (Level C) — proposed exact copy

| Context | Proposed copy | Source to preserve |
|---|---|---|
| Taxonomy result panel | "Support is an evidence fraction, not an identification probability. BLAST similarity is not proof of species identity. [Limits](research-use.html)" | `taxonomy-app.js:329`; `taxonomy.html:42` |
| Taxonomy reference coverage | Keep verbatim: "Some queries returned no BLAST hits and are reported as insufficient evidence." / "Without it, taxa are reported as unresolved." / "Screening reference, not a universal species boundary." | `taxonomy-app.js:325`; `taxonomy.html:99,110` |
| BLAST result panel (merge duplicated tails) | "Query coverage is unavailable without query lengths. BLAST similarity is evidence, not proof of species identity." | `blast-app.js:159,161` |
| Phylogenetics header | Use §3.1 replacement sentences; keep `:42` verbatim | `phylo.html:7,38,42` |
| Phylogenetics results | Keep verbatim: "No alignment text has been returned by a completed job…" and "No Galaxy job started…" | `phylo.html:101,120-121` |
| External execution / consent | Keep verbatim: "Nothing is sent to a remote service without a separate, dataset-scoped consent." and "Files leave the platform only with explicit, dataset-scoped consent." | `ai.html:85`; `cloud-providers.js:68` |
| FASTA limits (single location) | "Browser-local analysis accepts at most 64 KiB (65,536 bytes); the local-agent route accepts at most 10,000 characters. The applicable limit is checked before submission." | `ai.html:40,100,137`; `ai-execution.js:29,35` |
| Benchmark | "These are fixture values, not performance on held-out or real samples." and "No clinical validity or diagnostic claim follows from this illustration." | `benchmark.html:75,79` |
| Sample/project data | Keep verbatim: "Metadata only — no file bytes are stored; provider references are not proof of durable storage." | `workspace.html:150` |

---

## 6. Prioritized edit list for the implementation worker

All line references are to the current tree at `3dea99e`. **No edits were made by this audit.**

| Priority | Action | Exact files / lines |
|---|---|---|
| **P0** | Replace the two contradicted MAFFT→IQ-TREE claims with the verified copy from §3.1. Do not touch the tree-limitation strip, alignment placeholder or "No Galaxy job started" empty state. | `web-platform/public/phylo.html:7`, `:38` (keep `:42`, `:54`, `:101`, `:120-121`) |
| **P1** | Create `web-platform/public/research-use.html` with the authoritative Level-A mission text from §0.2 (not the superseded paraphrase) and the §5.5 outline. Add it to the nav/footer links on all pages (e.g. `index.html:345-350` About column and the equivalent blocks in the other 6 files). | new `web-platform/public/research-use.html`; nav blocks: `index.html:24-29`, `ai.html:25-30`, `phylo.html:24-29`, `taxonomy.html:24-29`, `blast.html:24-29`, `benchmark.html:23-28`, `workspace.html:19-24` |
| **P2** | Replace all 7 full footers with the single Level B notice + link from §5.4. | `index.html:352`; `ai.html:296`; `phylo.html:161`; `taxonomy.html:206`; `blast.html:196`; `benchmark.html:139`; `workspace.html:301` |
| **P3** | Fix the two references to the absent `benchmark_data/RESULTS.md` using §3.3 replacement copy; keep every limitation bullet. | `web-platform/public/benchmark.html:34`, `:102` |
| **P4** | Rename public brand strings to "Smart Bioinformatics AI" (30 occurrences) and update the downloaded report metadata/title. Keep the authoritative Level-A mission text in §0.2 unchanged. | Titles: `index.html:8`, `ai.html:8`, `phylo.html:8`, `taxonomy.html:8`, `blast.html:8`, `benchmark.html:7`, `workspace.html:6`; brand spans: `index.html:19,323`, `ai.html:20,267`, `phylo.html:19,132`, `taxonomy.html:19,177`, `blast.html:19,167`, `benchmark.html:18,110`, `workspace.html:14,272`; aria-labels: `index.html:17`, `ai.html:18`, `phylo.html:17`, `taxonomy.html:17`, `blast.html:17`, `benchmark.html:16`, `workspace.html:12`; `web-platform/public/js/report.js:22,39` |
| **P5** | Move version/implementation notes out of the 7 footers; keep one copy in About. Shorten hero/about "No upload to a server" to the standalone-scoped wording in §2.2. | Footer-bottom: `index.html:353`, `ai.html:297`, `phylo.html:162`, `taxonomy.html:207`, `blast.html:197`, `benchmark.html:140`, `workspace.html:302`; About: `index.html:314`; overbroad privacy: `index.html:314`, `taxonomy.html:56`, `blast.html:57` |
| **P6** | Apply the §5.1-5.3, §5.6 copy refresh and qualify "validated output/results" claims so they describe UI behavior, not a completed live run. | `index.html:37-39,136-137,168,274-275,291,296`; `ai.html:6,38,219,236`; `ai.html:72` keep verbatim |
| **P7** | Deduplicate scientific-limitation copy without dropping substance: merge the two BLAST tails, shorten the taxonomy result-panel tail, consolidate the three FASTA-limit copies, add one link to `/research-use.html` in each result panel. | `js/blast-app.js:159,161`; `js/taxonomy-app.js:329`; `js/taxonomy.html:42`; `ai.html:40,100,137`; `js/ai-execution.js:29,35`; `js/verdict.js:13-15`; `js/report.js:34,74,93` |
| **P8** | Reviewer decision: stop rendering `production_ready: true` as a public assurance until a live end-to-end run is evidenced, or document the evidence for keeping it. | `js/workspace.js:35,187`; authoritative source `web-platform/functions/api/workspace/catalog.js:23-27`; contradicting context `docs/discovery/REVIEW_worker_ui.md:36`, `PRODUCT_VISION.md:72` |

### Validation after implementation

No code changes were made here, so no build/test was run. The implementation worker should run the existing suites (`cd web-platform && npm test`; `python -m pytest python-engine/tests`) and any static-page checks, and must confirm that `/research-use.html` is linked from all 7 footers and that no page still contains the phrase "executed remotely with full provenance".

---

## 7. Claims that could not be verified / known limitations

1. **Mission statement text — resolved.** The mission text was confirmed in a tester follow-up; §0.2 now quotes it once as the source of truth and records that this audit's earlier footer paraphrase is superseded. `research-use.html:43` already contains the exact mission sentence; no implementation change is required.
2. **`benchmark_data/RESULTS.md`.** Referenced at `benchmark.html:34,102` but absent from the worktree; all quoted held-out figures are therefore UNVERIFIED (`PRODUCT_VISION.md:72`). Replacement copy supplied in §3.3.
3. **Completed AI/agent runs.** No persisted end-to-end run with validation and artifacts was available for inspection; AI "validated output" copy is PARTIAL (UI exists, live run unverified).
4. **16S `production_ready: true`.** Asserted by the authoritative catalog but not corroborated by a live run in this tree; left as a reviewer decision (P8).
5. **Phylo artifact hashes / Newick.** Not recovered in any inspected report (`M7_3_2_LIVE_ARTIFACT_RECOVERY_REPORT.md:29`); all phylo result UI is conditional and must remain so.
6. **Difficult-group member lists.** Marked `needs_curator_review: true` in `difficult-groups.js:19,34,49` and UNVERIFIED in `README.md:239-245`; do not promote them to validated identification rules in the research-use page.
7. **Office dashboard.** The required `D:\Apps\Star-Office-UI\office-status.cmd` was not present at that path; status updates could not be written. This did not affect the read-only audit.
8. **Scope.** The screenshot artifact `docs/discovery/m7-2-screenshots/m7-2-galaxy-reverse-complement-report.html` is not one of the 7 public pages and was excluded from the inventory; CSS was not inspected because the task is copy-only.
