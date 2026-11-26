# Core Capability Matrix — CORE PRODUCT COMPLETION

**Date:** 2026-11-26
**Branch:** `product/core-completion` · **Base:** `8105956c908ea6c0d5c053b5ed2c13b86516d2a2`
**Snapshot note:** capability statuses are those at base `8105956`. Concurrent uncommitted work (`/api/tools/catalog`, `providers/tools/registry.js`, assistant UI changes) appeared after this snapshot and is not represented in the matrix.

**Purpose:** the single authoritative, catalog-style inventory of **actual** capabilities in this branch. Every row is grounded in a file path (and, where useful, line numbers). No capability is inferred from an aspiration, a design document or a mock test.

**Status vocabulary:** `production_ready:true` is used only where the repository itself declares it. `available:true` comes from the generated tool registry or the live adapter code. `UNAVAILABLE` means the code refuses the call and reports why. `UNVERIFIED` means evidence exists but the end-to-end claim has not been demonstrated.

**Authoritative sources of truth used here:**
- Tool registry (9 tools): `web-platform/functions/api/ai/registry.tools.generated.js` (generated from `shared/plugins/*.json` by `scripts/generate_plugin_registry.py`; do not hand-edit, lines 1–3).
- Workflow catalog (2 workflows, `CATALOG_VERSION = "1.0.0-m7.4"`): `web-platform/functions/api/workspace/catalog.js:5-50`. `web-platform/providers/workspace/catalog.js` is a deprecated re-export shim (`:1-17`).
- Route table: `web-platform/worker.js:129-197`.
- Provider enablement: `web-platform/providers/registry.js:25-32`; flags in `web-platform/wrangler.toml:15-18,39-43`.

---

## 1. Browser-side utilities (no network; no server state)

| ID | Scientific purpose | Input → Output | Formats | Validation | Execution location | Availability / version | Dependencies | Limitations + evidence |
|---|---|---|---|---|---|---|---|---|
| `BW-FASTA-VALIDATE` | FASTA structure + IUPAC alphabet check | FASTA text → validation JSON (records, alphabet, flags) | FASTA (DNA/protein, explicit type) | Structure, header/sequence presence, duplicate ids, invalid symbols; ambiguous symbols warn-only | Browser ES module | **Available**; shared rules `shared/sequence-rules.json` | `public/js/fasta.js:79-142`, `shared/sequence-rules.json` | Structure/alphabet only — not quality or biological correctness; `docs/discovery/AUDIT_backend_science.md:41` |
| `BW-STATS` | Per-record and collection sequence statistics | FASTA text → length, GC%, composition, N50 (JSON/CSV) | FASTA | Reuses validated records only | Browser | **Available** | `public/js/statistics.js:2-76` | GC% denominator is canonical A/C/G/T; no FASTQ quality scores; `registry.tools.generated.js:571-576` |
| `BW-BLAST-TSV` | Import/filter/rank BLAST tabular results | 12-col outfmt 6 or extended TSV → raw + filtered/ranked rows, metadata CSV/JSON | `standard` (12), `extended` (11 with taxids), `blastn_local_v1` | Typed column parsing, ranges, malformed-row reporting; ties/near-ties preserved | Browser | **Available** | `public/js/blast.js:131-293`, `public/js/blast-app.js` | Never executes BLAST; `qlen` absent in 12-col input → coverage unavailable, never invented; `docs/discovery/AUDIT_backend_science.md:43`; `docs/OPENCODE_HANDOFF_PROMPT.md:36-47` |
| `BW-TAXONOMY` | Consensus/lineage analysis of parsed hits | BLAST TSV (+ optional local taxonomy map) → per-query consensus, evidence/support | TSV (`taxonomy_map.tsv`, `verdict_pipeline.tsv`) | 8 fixed ranks, LCA, ties-at-cutoff, support over unique species; explicit `insufficient_evidence` | Browser | **Available** | `public/js/taxonomy.js:1-601`, `public/js/taxonomy-app.js` | Support is evidence fraction, not probability; no name-string inference; `docs/discovery/AUDIT_backend_science.md:48-52` |
| `BW-VERDICT` | Conservative identification verdict + caution flags | Consensus/TDV inputs → verdict, cautions, reasons | JSON from BW-TAXONOMY | Near-threshold, conflicting-lineage and no-hit rules | Browser | **Available** | `public/js/verdict.js`, `shared/test-cases/verdict_cases.json` | Not proof of species identity; threshold is screening, not universal boundary; `PRODUCT_VISION.md:75`; `docs/discovery/AUDIT_backend_science.md:264` |
| `BW-RISK-COVERAGE` | Benchmark/risk-coverage explainer | Curated case table → call-rate/wrong-rate display | JSON cases | Display only | Browser | **Available as explainer**; underlying real benchmark data **absent from tree** | `public/js/risk-coverage.js`, `public/js/benchmark-app.js`, `shared/test-cases/risk_coverage_cases.json` | Historical numbers UNVERIFIED (`docs/discovery/AUDIT_docs_consistency.md` D2); do not present as measured here |
| `BW-CSV-SAFE` | Neutralise spreadsheet formula injection on export | Cell value → escaped cell | CSV | `safe_csv_cell` | Browser | **Available but narrowly used** | `public/js/csv-safe.js:13`, `python-engine/src/smartbio/csv_safe.py` | Audit found production export paths do not all use the guard (`docs/discovery/AUDIT_backend_science.md:172,265`) |
| `BW-WORKSPACE-LOCAL` | Local scratchpad for project/dataset/run metadata | `{projects,datasets,runs}` JSON → UI state | `localStorage` key `m74_workspace_local_v1` | No server auth, no bytes, no tokens, no URLs | Browser only | **Available, explicitly non-durable** | `public/js/workspace.js`, `docs/M7_4_WORKSPACE_DESIGN.md:171` | Not a session, not server ownership; disclaimer shown |
| `BW-PROJECT-CONTEXT` | Show a text-only `?project=<id>` label | URL query → label | Public id string | No API call, no token | Browser | **Available** | `public/js/project-context.js:11`, `docs/M7_5_FOUNDATION_DESIGN.md:123` | Does not read a dataset or claim ownership |
| `BW-ASSISTANT-UI` | Conversational shell: sidebar, timeline, composer, copy/retry | Typed text → local transcript UI | Markdown/code/table rendering; ≤4000 chars | No simulated activity; disabled when status unavailable | Browser only | **UI-complete / chat unavailable**; `docs/ASSISTANT_UX_DESIGN.md:336-347` | `public/js/assistant.js`, `public/assistant.html`, `/api/assistant/status` | No model reply, no attachments, no execution; conversations tab-local (`:325-332`) |

---

## 2. Worker APIs (control plane; `web-platform/worker.js`)

| ID | Purpose | Input → Output | Formats | Validation | Execution location | Availability / version | Dependencies | Limitations + evidence |
|---|---|---|---|---|---|---|---|---|
| `WR-TOOLS` | Advertise registered tools with schemas + availability | `GET` → `{tools:[9], execution_mode}` | JSON | `requireMethod`, generated registry | Worker | **Available** | `functions/api/tools.js:1-11` | 2 of 9 tools report `available:false` (`registry.tools.generated.js:585,671`) |
| `WR-REQUEST` | Capture natural-language request + inline FASTA, infer intent | `POST {text,dataset}` → request/dataset ids, intent, confidence | FASTA ≤64 KiB, body ≤128 KiB | `validateFasta`, `isPublicId`, size caps | Worker (D1) | **Available** | `functions/api/ai/requests/index.js`, `planner.js`, `ai/_lib.js` | Deterministic planner; no LLM in Worker; `AI_AGENT_ARCHITECTURE.md:58-67` |
| `WR-PLAN` | Read immutable, schema-validated plan | `GET` → `plan_json` | JSON, `shared/schemas/plan.schema.json` | Tool ids must exist in registry; egress flags set | Worker (D1) | **Available** | `functions/api/ai/plans/[id]/index.js` | Plan is not executable until approval; `PRODUCT_REQUIREMENTS.md:30-34` |
| `WR-APPROVE` | Human gate + single-use BLAST consent issuance | `POST` approvals → jobs; returns consent token | JSON | Consent required for `external_egress`/`consent_required`; one-way idempotent | Worker (D1) | **Available** | `functions/api/ai/plans/[id]/approve.js`, `migrations/0003/0004` | Approval is never inferred from chat; `docs/ASSISTANT_UX_DESIGN.md:49-51` |
| `WR-JOBS-POLL` | Agent-only queued-job queue | `GET` (token) → job list | JSON | `agentTokenError` constant-time compare | Worker (D1) | **Available** | `functions/api/ai/jobs/index.js` | Operator identity only; no user accounts |
| `WR-JOB-RESULT` | Receive artifacts/provenance from local agent | `POST` → persisted run | ≤2 MiB, ≤20 artifacts, 64-hex SHA-256 | Hashes recomputed server-side; validation applied | Worker (D1) | **Available** | `functions/api/ai/jobs/[id]/result.js` | `execution_mode` accepts agent self-report unless env forces mock — trust gap (`ai/_lib.js:270-281`; `docs/discovery/REVIEW_worker_ui.md:36`) |
| `WR-RUN` | Retrieve results, validation flags, explanation | `GET /api/ai/runs/:id` → run DTO | JSON | Public id pattern | Worker (D1) | **Available** | `functions/api/ai/runs/[id]/index.js` | No per-user authorization (`docs/M7_5_FOUNDATION_DESIGN.md:182-190`) |
| `WR-PROVENANCE` | Return provenance DAG | `GET` → provenance JSON | JSON | Completeness gate at `succeeded` | Worker (D1) | **Available** | `functions/api/ai/runs/[id]/provenance.js` | `provenance_records` only written at `succeeded` |
| `WR-REPORT` | Serve stored HTML report | `GET` → `report_html` | HTML/JSON | 404 when absent; never fabricated | Worker (D1) | **Available** | `functions/api/ai/runs/[id]/report.js`, `report_runs` | No R2; inline D1 report only |
| `WR-BLAST-SUBMIT` | NCBI `CMD=Put`, consent-gated | `POST {consent_token}` → `{rid,status}` | FASTA text | Single-use token bound to (hash, db, program); mock path gated too | Worker → NCBI | **Code available; no live call permitted** | `functions/api/blast/submit.js`, `blast/_lib.js` | Global NCBI submission rate limit not enforced in code (`docs/discovery/AUDIT_api_infra.md:78`) |
| `WR-BLAST-STATUS` / `WR-BLAST-RESULTS` | RID polling / TSV fetch | `GET` → status or TSV | RID, TSV | 60 s per-RID poll, 429 + `Retry-After`; no sequence in URL | Worker → NCBI | **Available (mock-verified)** | `functions/api/blast/status/[rid].js`, `results/[rid].js` | Live NCBI call not exercised in tree |
| `WR-BLAST-HISTORY` | Recent RID list | `GET` → `{submissions,count,mock}` | JSON | limit clamped 1..20; no sequence/hash | Worker (D1) | **Available** | `functions/api/blast/history.js` | Publishes RIDs; documented gap in legacy threat model |
| `WR-WORKSPACE-CRUD` | Projects, metadata-only datasets, unified runs, 11-state machine, provenance/report reads | `POST/GET/PATCH /api/workspace/**` | JSON | `deriveOwner` on every call; cross-owner 404; `succeeded` requires complete provenance | Worker (D1) | **Available**; `metadata-only://` for bytes | `functions/api/workspace/**`, `migrations/0011_workspace.sql` | No bytes, no public artifact URLs, no multi-user auth (`docs/M7_4_WORKSPACE_DESIGN.md:112-126`) |
| `WR-WORKSPACE-CATALOG` | Authoritative 2-workflow listing | `GET` → frozen catalog | JSON | Drift-checked across 4 surfaces | Worker (static code data) | **Available**; `CATALOG_VERSION "1.0.0-m7.4"` | `functions/api/workspace/catalog.js:5-65` | `msa-phylogenetics` `production_ready:false` (`:44-48`) |
| `WR-WORKSPACE-DEMO` | Clearly labelled sample payload | `GET` → `sample/precomputed/disclaimer` | JSON | Labels mandatory | Worker | **Available** | `functions/api/workspace/demo.js` | Not a real execution |
| `WR-PHYLO-RUN/STATUS/TOOL` | Remote Galaxy phylo plan/submission/status | `POST/GET` → job refs, state | FASTA, JSON | FASTA validation + SHA-256; D1 job rows | Worker → Galaxy | **Handler works; full path UNVERIFIED; no live call permitted** | `functions/api/ai/workflows/phylo/*`, `providers/galaxy/index.js` | `docs/M7_3_PHYLOGENETICS_WORKFLOW_REPORT.md:84-98` |
| `WR-PROVIDER-META` | Provider list/detail/capabilities/limits/usage | `GET /api/providers/**` | JSON | Disabled providers return empty operations/tools | Worker | **Available but all providers disabled** | `functions/api/providers/index.js`, `_lib.js`, `providers/registry.js` | Live probe: 3 providers, all `enabled:false`, 0 tools (`docs/M7_1_LIVE_ACTIVATION_REPORT.md:70`) |
| `WR-PROVIDER-CHAT/PLAN` | Real model chat/plan path | `POST` → provider reply | JSON | Governor reserve; provider must be enabled | Worker → 9Router | **403 `feature_flag_disabled`** | `functions/api/providers/chat.js:25-36`, `plan.js` | No fallback, no mock; `PROVIDER_USAGE_POLICY.md` |
| `WR-CONSENT/GOVERNOR` | Scoped single-use egress consent; budgets; emergency stop; transfers | `POST /api/providers/consent|budget|emergency-stop|transfers` | JSON | ≤30 min TTL, dataset+provider scope, consume-once; operator token for controls | Worker (D1) | **Available** | `functions/api/providers/consent.js`, `_lib.js`, `providers/common/governor.js` | Security control; never bypass |
| `WR-PROVIDER-JOBS` | Governed provider job lifecycle | `GET/POST /api/providers/jobs/**` | JSON | Consent required before submission | Worker (D1) | **Refuses when provider disabled** | `functions/api/providers/jobs/**` | No activation in this program |
| `WR-GALAXY-ARTIFACTS` | Galaxy dataset metadata/download/upload listing | `GET/POST /api/providers/galaxy/**` | Text (≤1 MiB) | Fail closed when Galaxy off; SHA-256 recheck on download | Worker → Galaxy | **Fail-closed here** | `functions/api/providers/galaxy-artifacts/**`, `storage/galaxy-artifacts.js` | Provider references, not canonical platform bytes |
| `WR-ARTIFACT-TICKETS` | R2 signed upload/download/delete tickets | `POST /api/artifacts/**` | HMAC ticket | Sign/verify, size caps, delete-on-mismatch | Worker → R2 (intended) | **503 fail-closed — no binding/key** | `functions/api/artifacts/**`, `storage/r2.js`, `wrangler.toml:20-23` | Inoperative by design; do not invent public bucket |
| `WR-ASSISTANT-STATUS` | Honest assistant availability | `GET` → `available:false`, stages `not_started` | JSON | No flag/key read or echoed | Worker | **Available** | `functions/api/assistant/index.js:91-139` | `reason:"no_enabled_llm_provider"` |
| `WR-ASSISTANT-CHAT` | Fail-closed chat gateway | `POST` → 503 `generated:false` | JSON ≤16 KiB, message ≤4000 chars | Rejects client `system/model/provider/messages/content` | Worker | **UNAVAILABLE by design** | `functions/api/assistant/index.js:141-180` | `"No response was generated. No model provider was contacted."` |

---

## 3. Python-engine tools (`functions/api/ai/registry.tools.generated.js` — exact ids/versions/status)

All nine tools are `backend:"local-python"`, `version:"1.0.0"`, `external_egress:false`. Input FASTA/TSV text is capped at `maxLength:65536` (64 KiB) per the Worker transport contract.

| ID | Scientific purpose | Input → Output artifacts | Formats / params | Validation | Execution location | Availability / version | Dependencies | Limitations + evidence |
|---|---|---|---|---|---|---|---|---|
| `phylogenetics.validate` | Parse FASTA; require ≥3 unique non-empty DNA sequences ≥50 bp; fail closed | `dataset_id,fasta_text,filename` → `phylo_validation.json` | FASTA; params `{}` | Record count, alphabet, length | Local Python plugin | **`available:true`**, v1.0.0 | `python-package:biopython` | Ambiguous bases not resolved; no quality assessment; `registry.tools.generated.js:6-69` |
| `phylogenetics.align` | Deterministic progressive MSA: UPGMA guide tree from pairwise identity distances, Bio.Align.PairwiseAligner (+2/-1/-5/-2) | same → `alignment.fasta`, `alignment_summary.json` | FASTA; params `{}` | Fixed scoring scheme, conserved-column rule | Local Python | **`available:true`**, v1.0.0 | biopython | Heuristic, no global optimum; `:70-143` |
| `phylogenetics.tree` | Neighbour-joining tree from Biopython identity distances | `dataset_id` (+ optional FASTA/alignment text) → `tree.nwk`, `tree.svg`, `tree_stats.json` | FASTA/alignment; params `{}` | Parseable Newick, tree stats | Local Python | **`available:true`**, v1.0.0 | biopython | Distance heuristic; ignores saturation/rate variation; trifurcating root; `:144-223` |
| `phylogenetics.report` | Reproducible HTML+JSON report with hashes, versions, refs, limitations | `dataset_id,fasta_text,filename` → `phylo_report.json`, `phylo_report.html` | FASTA; params `{}` | Artifact hash declaration; `execution_mode real` stated | Local Python | **`available:true`**, v1.0.0 | biopython | Hashes cover bundled artifacts, not source FASTA; `:224-304` |
| `phylogenetics.workflow` | Single-job website pipeline chaining the four adapters | same → 8 artifacts (validation, alignment, summary, nwk, svg, stats, report.json/html) | FASTA; param `sequence_type:"dna"` | Required-artifact declaration | Local Python | **`available:true`**, v1.0.0 | biopython | Composite does not change computation; site chaining workaround; `:305-417` |
| `sequence-stats.validate` | FASTA structure + IUPAC alphabet validation | `dataset_id,fasta_text,filename` (+ `sequence_type`) → `validation` | FASTA; `sequence_type ∈ {dna,protein}` | IUPAC 1984; explicit alphabet required | Local Python | **`available:true`**, v1.0.0 | none | No quality/biological correctness check; `:418-491` |
| `sequence-stats.profile` | Validation + per-record statistics and collection summaries | same → `validation`, `statistics` | FASTA; `sequence_type ∈ {dna,protein}` | Valid non-empty records only | Local Python | **`available:true`**, v1.0.0 | none | GC% canonical bases only; N50 not assembly quality; `:492-577` |
| `microbiome-16s.blast-parse` | Parse existing BLAST TSV into normalized hits | `dataset_id,tsv_text,filename` → `parse` | TSV; `schema ∈ {auto,standard,extended,blastn_local_v1}`, `min_identity`, `min_query_coverage` | Malformed rows excluded and flagged | Local Python | **`available:false`** — requires `tsv_dataset` + `local_database`, not statically verifiable / not wired into MVP planner | TSV dataset, local BLAST DB | Parses, never runs BLAST; similarity ≠ identity; `:578-663` |
| `microbiome-16s.taxonomy` | Conservative per-query taxonomic verdict from parsed hits | same → `taxonomy` | TSV; `schema`, identity/coverage, `top_n`, `min_consensus`, `species_threshold` | Ties/abstention, thresholds, no-hit reporting | Local Python | **`available:false`** — same unsatisfied requirements | TSV dataset, local BLAST DB | 16S thresholds are screening only; no network lookup; unverified Kim 2014 ref deliberately not cited; `:664-772` |

**Supporting Python components (not separately advertised tool ids):** `aiagent/agent.py` (job dispatch, plugin isolation, validation, report assembly), `aiagent/validation.py`, `aiagent/explanation.py` (number/citation checker), `aiagent/report.py`, `aiagent/provenance.py`, `aiagent/locality.py`, `aiagent/education.py`, `plugins/*.py`; `smartbio/fasta.py`, `statistics.py`, `blast.py`, `blast_runner.py`, `taxonomy/**`. Evidence: `python-engine/src/smartbio/**`; `AI_AGENT_ARCHITECTURE.md:150-196`.

---

## 4. External provider tools and scientific services

| ID | Purpose | Input → Output | Formats | Validation | Execution location | Availability / version | Dependencies | Limitations + evidence |
|---|---|---|---|---|---|---|---|---|
| `EX-NCBI-BLAST-PUT` | Remote 16S BLAST submission | FASTA → RID | FASTA, `CMD=Put` | Single-use consent token bound to input hash/db/program; 1 poll/min per RID | Worker → NCBI (the only implemented egress) | **Code present; no live call permitted here** | `blast/_lib.js` `buildPutParams`, `tool`/`email` env | ≤1 submission/10 s documented but not enforced in code; RID TTL not recorded (`docs/discovery/AUDIT_api_infra.md:73-78`) |
| `EX-GALAXY-DISCOVERY` | Live tool/workflow discovery (MAFFT, IQ-TREE historically found) | `GET /api/tools`, `/api/workflows` → descriptors | JSON | No hardcoded ids; only real executable tools advertised | Galaxy instance | **Staging flag only; no credential; no live call** | `GALAXY_ENABLED`, base URL, API key, account activation | `providers/galaxy/index.js:1-55,71-83`; `docs/M7_3_PHYLOGENETICS_WORKFLOW_REPORT.md:68` |
| `EX-GALAXY-JOBS` | Submit/status/cancel jobs; retrieve datasets | job payload → provider job state + dataset refs | JSON / multipart `/api/tools/fetch` | Typed errors, no fabricated success; `truncated:true` rejected | Galaxy | **Fail-closed here** | same | Historical MAFFT job `4838ba…` completed once; full tree path NOT ACHIEVED (`M7_3…:84-98`) |
| `EX-GALAXY-ARTIFACTS` | 1 MiB text artifact upload/download with hash recheck | dataset id → text/metadata | Text extensions only | SHA-256 recheck, soft delete | Galaxy history (provider reference) | **Fail-closed here** | `storage/galaxy-artifacts.js`, D1 `galaxy_artifacts` | Not durable platform storage; `docs/M7_5_FOUNDATION_DESIGN.md:244-248` |
| `EX-SMARTSBIO-*` | Chat, plan, tool run, pipelines, files | `/v1/query`, `/v1/tools/:id/run`, `/v1/pipelines` | JSON/SSE | `SMARTSBIO_PUBLIC_AUTHORIZED` written-authorization gate + `SMARTSBIO_ENABLED` | smarts.bio | **DISABLED in both envs; no network call** | written authorization + secrets | Competitor terms risk; `providers/smartsbio/index.js:3-9,75-81,88-111` |
| `EX-NINEROUTER-CHAT/PLAN` | Only chat-capable adapter; OpenAI-compatible models/chat/SSE/plan | `/v1/models`, `/v1/chat/completions` → reply/usage | JSON/SSE | Fixed `SYSTEM_GUARD` forbids measurements/citations | Remote OpenAI-compatible endpoint | **DISABLED in both envs; no URL/key; endpoint local and unreachable** | `NINEROUTER_ENABLED`, base URL, key | No fallback/default endpoint; `providers/ninerouter/index.js:1-20,32-46,58-73`; `docs/ASSISTANT_UX_DESIGN.md:15` |
| `EX-PYTHON-LLM-PHRASING` | Optional rephrasing of already-validated explanations | validated text → phrased text | JSON | Number/citation gate still applies; output marked with limitation | Local Python agent only | **Optional, not active for Worker chat** | `AI_LLM_PROVIDER == "ninerouter"` + key | `AI_LLM_PROVIDER` is Python-only; Worker never reads it (`aiagent/llm.py:105`; `docs/ASSISTANT_UX_DESIGN.md:34`) |

---

## 5. Unavailable / experimental / documented-not-implemented

| ID | Claim | Actual state | Evidence | Recommendation |
|---|---|---|---|---|
| `UN-ARTIFACTS-R2` | Durable user-file bytes and signed URLs | No `ARTIFACTS` binding, no signing key; all artifact endpoints 503 | `wrangler.toml:20-23`, `functions/api/artifacts/**`, `docs/M7_5_FOUNDATION_DESIGN.md:248` | Keep code, report unavailable; no activation |
| `UN-ASSISTANT-CHAT` | AI chat replies | `available:false`; 503; `generated:false`; no provider contacted | `functions/api/assistant/index.js:91-97,106-180` | Keep fail-closed; label "assistant unavailable" |
| `UN-PHYLO-REMOTE` | MAFFT → IQ-TREE with full provenance | One MAFFT completion; tree/retrieval/validation/report/E2E NOT ACHIEVED; `production_ready:false` | `docs/M7_3_PHYLOGENETICS_WORKFLOW_REPORT.md:84-98`; `functions/api/workspace/catalog.js:44-48` | Hide remote claim; keep historical evidence |
| `UN-MULTIUSER` | Human signup/login/session | No user accounts; workspace owner is `owner_<hash>` of operator token | `docs/M7_5_FOUNDATION_DESIGN.md:51,154-203`; `M7_4_FINAL_REPORT.md:38-40` | No auth launch; B1 is separate branch |
| `UN-B1-IDENTITY` | Better Auth identity foundation | Exists only on `implementation/m7-5-b1-better-auth` (HEAD `5d397de`), not merged at base `8105956`; `AUTH_ENABLED="false"`, no `/api/auth/*` route, additive `0012_identity.sql`, better-auth@1.7.28 | `docs/M7_5_B1_IMPLEMENTATION_REPORT.md` on that branch; `git diff 8105956..implementation/m7-5-b1-better-auth` | Document as inactive separate foundation; do not import |
| `UN-DOC-ENDPOINTS` | `/api/ai/projects/:id`, `/api/audit` | Not present in `worker.js:129-197` | `SYSTEM_ARCHITECTURE.md:201,207` | Correct docs; no new route |
| `UN-BENCHMARK-NUMBERS` | Published real benchmark figures | Source `benchmark_data/RESULTS.md` absent; figures UNVERIFIED | `docs/discovery/AUDIT_docs_consistency.md` D2; `docs/DEMO_SCRIPT.md:91` | Keep protocol/evidence; do not assert numbers here |

---

## 6. Grep evidence appendix (commands run, 2026-11-26)

```text
# Authoritative workflow catalog and production_ready flags
grep -n "production_ready\|CATALOG_VERSION\|msa-phylogenetics" web-platform/functions/api/workspace/catalog.js
  -> 5 (CATALOG_VERSION), 30 (msa-phylogenetics), 45-47 (partial-not-production-ready / false)

# Generated tool registry ids and availability
grep -n '"id"\|"version"\|"available"\|unavailable_reason' web-platform/functions/api/ai/registry.tools.generated.js
  -> ids at 7,71,145,225,306,419,493,579,665; available:false at 585 and 671

# Provider flags
grep -n "_ENABLED" web-platform/wrangler.toml
  -> 16-18 (all false), 41-43 (staging Galaxy true only)

# Assistant honest state
grep -n "UNAVAILABLE_REASON\|generated: false\|No response was generated" web-platform/functions/api/assistant/index.js
  -> 91, 129, 180

# Route inventory
grep -n 'key: "' web-platform/worker.js
  -> 132-196 (all registered API routes)
```

All statuses above are the states of **this branch at `8105956`**. Nothing in this matrix should be read as evidence that a provider is enabled, a credential exists, or a live scientific call may be made.
