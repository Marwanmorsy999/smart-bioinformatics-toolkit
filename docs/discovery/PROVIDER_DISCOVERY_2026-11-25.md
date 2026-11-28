# Raw provider discovery notes — 2026-11-25

**Access date for every live source below: 2026-11-25.** Captured by the M7 Worker agent on branch
`phase-1-robustness-safety`. These are raw notes, not claims of integration. No credentials were used,
no secrets were captured, and no code or test file was modified.

Method: `webfetch` for HTML/text pages and `fetch` (Code Mode `execute`) for JSON APIs and client-side
filtering. Every live URL is recorded with its access date. Verification label conventions follow
`docs/EVIDENCE_LEDGER.md`: **[V]** = fetched and read directly; **[N]** = not verified; **[U]** = unknown.

---

## 1. Galaxy Europe (usegalaxy.eu)

| Source URL | Access date | Result |
|---|---|---|
| `https://usegalaxy.eu/api/version` | 2026-11-25 | **[V]** `{"version_major":"26.1","version_minor":"3.dev0"}` |
| `https://usegalaxy.eu/api/tools` | 2026-11-25 | **[V]** Full tool panel. Flattened client-side to **4,686 tool objects** (sections + tools + data-source tools). |
| `https://usegalaxy.eu/api/tools/{exact_versioned_id}` | 2026-11-25 | **[V]** HTTP 200 for every probed tool; returns basic panel metadata only: `model_class`, `id`, `name`, `version`, `description`, `labels`, `icon`, `edam_operations`, `edam_topics`, `hidden`, `is_workflow_compatible`, `xrefs`, `versions`, `hidden_versions`, `tool_shed_repository`, `has_parameters`, `panel_section_id`, `panel_section_name`, `form_style`. **No `inputs`, `outputs` or parameter schema** in the unauthenticated response. |
| `https://usegalaxy.eu/api/tools/{exact_versioned_id}/inputs` | 2026-11-25 | **[V]** HTTP 200 but returns the same basic tool object, **not** an input schema, when unauthenticated. |
| `https://usegalaxy.eu/api/tools?search=fastqc` | 2026-11-25 | **[V]** HTTP 200; returned **103 panel sections / 4,462 tools** — essentially the whole panel. `search=` is **not** a usable server-side filter; must filter client-side. |
| `https://usegalaxy.eu/api/docs` | 2026-11-25 | **[V]** Swagger UI page; loads spec from `/openapi.json` (root, not `/api/`). |
| `https://usegalaxy.eu/api/redoc` | 2026-11-25 | **[V]** ReDoc page (HTTP 200). |
| `https://usegalaxy.eu/openapi.json` | 2026-11-25 | **[V]** HTTP 200; `{"title":"Galaxy API","version":"26.1.3.dev0"}`, **465 paths**. |
| `https://usegalaxy.eu/api/openapi.json`, `/api/schema.json`, `/api/swagger.json` | 2026-11-25 | **[N]** HTTP 404 "No route for ..." — do not use these paths. |

### 1.1 Exact tool IDs and versions observed in the live panel (all 2026-11-25, all **[V]**)

Every row below also had `is_workflow_compatible: true` and `has_parameters: true` unless noted.
The `versions` array was non-empty in every case (see §1.2 for counts).

| Discovery target | Exact tool id in panel | Version | Name / description | Panel section |
|---|---|---|---|---|
| FastQC | `toolshed.g2.bx.psu.edu/repos/devteam/fastqc/fastqc/0.74+galaxy1` | `0.74+galaxy1` | FastQC — "Read Quality reports"; label `use Falco instead` | FASTA/FASTQ |
| MultiQC | `toolshed.g2.bx.psu.edu/repos/iuc/multiqc/multiqc/1.35+galaxy6` | `1.35+galaxy6` | MultiQC — "aggregate results from bioinformatics analyses into a single report" | Quality Control |
| MAFFT | `toolshed.g2.bx.psu.edu/repos/rnateam/mafft/rbc_mafft/7.526+galaxy2` | `7.526+galaxy2` | MAFFT — "Multiple alignment program for amino acid or nucleotide sequences" | Multiple Alignments |
| MAFFT add | `toolshed.g2.bx.psu.edu/repos/rnateam/mafft/rbc_mafft_add/7.526+galaxy2` | `7.526+galaxy2` | MAFFT add — align sequence/alignment/fragments to existing alignment | Multiple Alignments |
| MUSCLE | `toolshed.g2.bx.psu.edu/repos/crs4/muscle/muscle/0.0.11` | `0.0.11` | MUSCLE — "multiple aligner" | Multiple Alignments |
| FastTree | `toolshed.g2.bx.psu.edu/repos/iuc/fasttree/fasttree/2.1.10+galaxy1` | `2.1.10+galaxy1` | FASTTREE — "build maximum-likelihood phylogenetic trees" | Genome Diversity |
| IQ-TREE | `toolshed.g2.bx.psu.edu/repos/iuc/iqtree/iqtree/3.1.4+galaxy1` | `3.1.4+galaxy1` | IQ-TREE — "Phylogenomic / evolutionary tree construction from multiple sequences" | Evolution |
| BLAST (nucleotide) | `toolshed.g2.bx.psu.edu/repos/devteam/ncbi_blast_plus/ncbi_blastn_wrapper/2.16.0+galaxy1` | `2.16.0+galaxy1` | NCBI BLAST+ blastn — "Search nucleotide database with nucleotide query sequence(s)" | NCBI Blast |
| BLAST (protein) | `.../ncbi_blast_plus/ncbi_blastp_wrapper/2.16.0+galaxy1` | `2.16.0+galaxy1` | NCBI BLAST+ blastp | NCBI Blast |
| BLAST (other) | blastx, tblastn, tblastx, makeblastdb, blastdbcmd, rpsblast, rpstblastn, dustmasker, segmasker, convert2blastmask — all `2.16.0+galaxy1` | `2.16.0+galaxy1` | NCBI BLAST+ suite | NCBI Blast |
| BWA | `toolshed.g2.bx.psu.edu/repos/devteam/bwa/bwa/0.7.19+galaxy2` | `0.7.19+galaxy2` | Map with BWA — short reads (<100 bp) | Mapping |
| BWA-MEM | `toolshed.g2.bx.psu.edu/repos/devteam/bwa/bwa_mem/0.7.19+galaxy2` | `0.7.19+galaxy2` | Map with BWA-MEM — medium/long reads (>100 bp) | Mapping |
| Bowtie2 | `toolshed.g2.bx.psu.edu/repos/devteam/bowtie2/bowtie2/2.5.5+galaxy0` | `2.5.5+galaxy0` | Bowtie2 — "map reads against reference genome" | Mapping |
| HISAT2 | `toolshed.g2.bx.psu.edu/repos/iuc/hisat2/hisat2/2.2.3+galaxy1` | `2.2.3+galaxy1` | HISAT2 — "A fast and sensitive alignment program" | Mapping |
| STAR | `toolshed.g2.bx.psu.edu/repos/iuc/rgrnastar/rna_star/2.7.11b+galaxy1` | `2.7.11b+galaxy1` | RNA STAR — "Gapped-read mapper for RNA-seq data" | Mapping |
| SAMtools | e.g. `toolshed.g2.bx.psu.edu/repos/iuc/samtools_view/samtools_view/1.22+galaxy2`; also flagstat `2.0.8`, sort `2.0.8`, idxstats `2.0.8`, stats `2.0.9`, mpileup `2.2.0`, and many `1.22+galaxyN` subtools | varies by subtool | Samtools view / flagstat / sort / idxstats / etc. | SAM/BAM, Convert Formats, Mapping |
| BEDtools | e.g. `toolshed.g2.bx.psu.edu/repos/iuc/bedtools/bedtools_intersectbed/2.31.1+galaxy1`; ~35 subtools (getfasta, mergebed, sortbed, multicov, closestbed, shufflebed, …) | mostly `2.31.1` / `2.31.1+galaxyN` | bedtools Intersect intervals and suite | BED |
| DESeq2 | `toolshed.g2.bx.psu.edu/repos/iuc/deseq2/deseq2/2.11.40.8+galaxy6` | `2.11.40.8+galaxy6` | DESeq2 — "Determines differentially expressed features from count tables" | RNA Analysis |
| Salmon | `toolshed.g2.bx.psu.edu/repos/bgruening/salmon/salmon/1.10.3+galaxy1` | `1.10.3+galaxy1` | Salmon quant — "dual-phase, reads or mapping-based estimation of transcript abundance" | RNA Analysis |
| kallisto | `toolshed.g2.bx.psu.edu/repos/iuc/kallisto_quant/kallisto_quant/0.48.0+galaxy1` | `0.48.0+galaxy1` | Kallisto quant — "quantify abundances of RNA-Seq transcripts" | RNA Analysis |
| InterProScan | `toolshed.g2.bx.psu.edu/repos/bgruening/interproscan/interproscan/5.59-91.0+galaxy3` | `5.59-91.0+galaxy3` | InterProScan — "functional annotation" | Annotation |
| UniProt retrieval | `toolshed.g2.bx.psu.edu/repos/galaxyp/uniprotxml_downloader/uniprotxml_downloader/2.5.0` | `2.5.0` | UniProt — "download proteome as XML or fasta" | Get Data |
| UniProt ID mapping | `toolshed.g2.bx.psu.edu/repos/bgruening/uniprot_rest_interface/uniprot/0.8` | `0.8` | UniProt — "ID mapping and retrieval" | Convert Formats |
| Other tree tools | PhyML `.../phyml/phyml/3.3.20220408+galaxy0`; RAxML `.../raxml/raxml/8.2.13+galaxy0`; RAxML-NG `.../raxmlng/raxmlng/2.0.4+galaxy0` | as shown | Maximum-likelihood phylogenetics | Phylogenetics |
| QIIME 2 wrappers | `.../q2d2/qiime2__phylogeny__align_to_tree_mafft_fasttree/.../2026.1.0+q2galaxy.2026.1.0` etc. | `2026.1.0+q2galaxy.2026.1.0` | align-to-tree-mafft-{fasttree,iqtree,raxml}, iqtree-ultrafast-bootstrap | QIIME 2 |

### 1.2 Verified metadata extras (all from `/api/tools/{id}`, 2026-11-25)

EDAM operations/topics and `versions` array length (number of published wrapper versions, not a quota):

| Tool | EDAM operations | EDAM topics | Versions count |
|---|---|---|---|
| FastQC | operation_3218, 0236, 2238 | topic_3572, 3168, 0080 | 13 |
| MultiQC | operation_2428 | topic_0091, 3168 | 29 |
| MAFFT | (empty) | (empty) | 11 |
| MUSCLE | operation_0492 | topic_0080 | 1 |
| FASTTREE | operation_0547, 0540 | topic_3293, 0080 | 2 |
| IQ-TREE | operation_0324, 2403 | topic_3293 | 15 |
| PhyML | operation_0547 | topic_0091, 3293 | 3 |
| RAxML-NG | (empty) | (empty) | 6 |
| BLASTN | operation_0346, 0292 | topic_0091, 0080 | 24 |
| BWA-MEM | operation_3211, 0292, 3429, 3198 | topic_0102 | 7 |
| Bowtie2 | operation_3198 | topic_0102, 0622 | 19 |
| HISAT2 | operation_0292 | topic_3170 | 18 |
| RNA STAR | operation_0292 | topic_3170, 3308 | 23 |
| Samtools view | operation_3695, 3802, 3096, 1812, 0335, 0227, 0337 | topic_3168, 3325, 0080, 0102 | 13 |
| bedtools intersect | operation_2429 | topic_0622 | 14 |
| DESeq2 | operation_3800 | topic_3308 | 21 |
| Salmon quant | operation_3800, 0236, 2495 | topic_3308, 3170, 0203 | 15 |
| kallisto quant | operation_0314 | topic_3308, 3170, 0203 | 8 |
| InterProScan | operation_0239, 3092 | topic_0623, 0080 | 6 |
| UniProt download | operation_3778, 3431, 2422, 2421 | topic_0621, 3068, 0080, 0121, 3520 | 8 |
| UniProt REST | operation_3778, 3431, 2422, 2421 | topic_0621, 3068, 0080, 0121, 3520 | 6 |

### 1.3 Documented API endpoints observed in live OpenAPI spec (2026-11-25, **[V]**)

Selected paths and methods (summaries quoted where present):

- `GET /api/authenticate/baseauth` — "Returns an API key for authenticated user based on BaseAuth headers."
- `GET|POST|DELETE /api/users/{user_id}/api_key` — get / create / delete API key.
- `GET|POST /api/histories` — "Returns histories available to the current user." / "Creates a new history."
- `GET|POST|PUT /api/histories/{history_id}/contents` — list / create HDA or HDCA / batch update.
- `GET|POST /api/histories/{history_id}/contents/{type}s` — typed list / create.
- `GET|POST /api/tools` — tool panel / execute a tool (POST summary empty in spec).
- `GET /api/tools/{tool_id}/inputs` — "Get tool inputs."
- `POST /api/workflows/{workflow_id}/invocations` — "Schedule the workflow specified by workflow_id to run."
- `GET /api/invocations`; `GET|DELETE /api/invocations/{invocation_id}` — "Cancel the specified workflow invocation."
- `GET|POST /api/jobs`; `GET|DELETE /api/jobs/{job_id}` — DELETE "Cancels specified job".
- `GET /api/jobs/{job_id}/outputs`, `/stdout`, `/stderr`, `/metrics`, `/inputs`, `/parameters_display`, `/common_problems`; `POST /api/jobs/{job_id}/error`.
- `GET /api/datasets/{dataset_id}/content/{content_type}` — "Retrieve information about the content of a dataset."
- `GET /api/datasets/{dataset_id}/get_content_as_text`, `/display`, `/parameters_display`, `/provenance`, `/storage`; `PUT /api/datasets/{dataset_id}/hash` — "Compute dataset hash for dataset and update model" (i.e. hash is PUT, not GET).
- `GET /api/quotas` — "Displays a list with information of quotas that are currently active."
- `GET /api/users/{user_id}/usage` — "Return the user's quota usage summary broken down by quota source."
- `GET /api/users/{user_id}/objectstore_usage` — "Return the user's object store usage summary broken down by object store ID."
- `GET /api/storage/histories`, `/api/storage/datasets` and discarded/archived summaries.
- `POST /api/upload/resumable_upload`; `GET|POST /api/tool_data`; `GET /api/tool_panels`.
- Verified absent: `/api/jobs/{job_id}/cancel` ("NOT IN SPEC") — cancellation is `DELETE /api/jobs/{job_id}`.

Prior-session evidence reused (not re-fetched this session; access date 2026-11-24):
`docs/discovery/RESEARCH_compute_infra.md` §4 documents usegalaxy.org quotas 250 GB registered / 5 GB
unregistered, 6/1 concurrent jobs, no PII/HIPAA/FISMA, and the 2026 usegalaxy.eu Terms warning about
AI-enabled abuse. `docs/EVIDENCE_LEDGER.md` tags the 250 GB figure **[V-S]** snippet-only for one source.
Exact usegalaxy.eu **account** quota remains **[U]** until a connected account is queried.

## 2. smarts.bio

| Source URL | Access date | Result |
|---|---|---|
| `https://api.smarts.bio/` | 2026-11-25 | **[N]** HTTP 404 at bare host; the API base is `https://api.smarts.bio/v1`. |
| `https://docs.smarts.bio/` | 2026-11-25 | **[N]** Transport error. Official docs are on the main site, not this subdomain. |
| `https://www.smarts.bio/terms` | 2026-11-25 | **[V]** Terms of Use **v1.1, last updated 4 October 2026**. |
| `https://www.smarts.bio/pricing` | 2026-11-25 | **[V]** Personal Free/Pro/Max allowances. Team Free numbers **not shown** → **[U]**. |
| `https://www.smarts.bio/docs` | 2026-11-25 | **[V]** Quick Start, endpoint examples, SSE streaming. |
| `https://www.smarts.bio/llms.txt` | 2026-11-25 | **[V]** Canonical docs index and resource URLs. |
| `https://www.smarts.bio/openapi.json` | 2026-11-25 | **[V]** HTTP 200; OpenAPI 3.1, `{"title":"smarts.bio API","version":"1.0.0"}`, **32 paths**. |
| `https://www.smarts.bio/docs/authentication` | 2026-11-25 | **[V]** Key format, headers, four scopes, workspace scoping. |
| `https://www.smarts.bio/docs/errors` | 2026-11-25 | **[V]** Error envelope, 14 error codes, retry guidance. |
| `https://www.smarts.bio/docs/reference/pipelines` | 2026-11-25 | **[V]** 12 predefined pipelines, 5 concurrent compute tasks/org, poll 15–30 s, cancel via DELETE. |

### 2.1 Exact documented facts

- Gateway: `https://api.smarts.bio/v1`. Auth: `Authorization: Bearer sk_live_...` **or** `X-API-Key: sk_live_...`.
  Key format `sk_live_` + 32 characters; created in Organization Settings → API Keys; revocation effective within 30 s.
- Scopes (from `/docs/authentication`): `query` → `POST /v1/query`, `POST /v1/query/stream`;
  `tools` → `GET /v1/tools`, `POST /v1/tools/:id/run`; `conversations` → `GET /v1/conversations`,
  `GET /v1/conversations/:id`; `files` → `GET /v1/files`. `GET /v1/workspaces` works with any scope.
  Keys may be scoped to specific workspaces; mismatch → `workspace_access_denied`.
- OpenAPI paths (32): `/catalog/tools`, `/catalog/pipelines`, `/catalog/pipelines/{id}`, `/query`,
  `/query/stream`, `/query/stop`, `/tools`, `/tools/{toolId}/run`, `/pipelines`, `/pipelines/{id}`,
  `/files`, `/files/upload`, `/files/upload-url`, `/files/upload-confirm`, `/files/download`,
  `/files/content`, `/files/rename`, `/files/move`, `/files/folder`, `/files/metadata`, `/workspaces`,
  `/conversations`, `/conversations/{id}`, `/visualizations/viewer-url`, `/visualizations/render`,
  `/visualizations/{job_id}`, `/analytics/stream`, `/graph/network`, `/graph/entity/{type}/{id}`,
  `/reports/generate-pdf`, `/script/stream`, `/script/resume`.
  Security schemes: `bearerApiKey` (http bearer) and `apiKeyHeader` (`X-API-Key`). No OAuth scopes in spec.
- Error codes: `auth_required` 401, `key_revoked` 401, `key_expired` 401, `insufficient_scope` 403,
  `workspace_access_denied` 403, `rate_limit_exceeded` 429 (honour `Retry-After`), `quota_exceeded` 402,
  `validation_error` 400, `agent_error` 500, `not_found` 404, `internal_error` 500.
  Retry: 429 after Retry-After; 500/502/503/504 with exponential backoff; never retry 400, 401, 402, 403.
- Pipelines: `POST /v1/pipelines` (tools scope), `GET /v1/pipelines/:id` (poll 15–30 s),
  `DELETE /v1/pipelines/:id` (cancel), `GET /v1/pipelines`, `POST /v1/pipelines/:id/save-spec`,
  `POST /v1/pipelines/validate`. Statuses `queued → running → completed | failed | cancelled`.
  "Each organization runs at most 5 compute tasks at once."
- Personal plan allowances from pricing page: Free $0 — 2 compute hours/mo, 1,000 API calls/mo,
  10 GB storage, 1 active project; Pro $25/mo — 20 h, 10,000 calls, 100 GB, 10 projects;
  Max $100/mo — 100 h, 100,000 calls, 1 TB, unlimited projects. Team Pro min 3 users, Team Max min 5,
  Enterprise from 50; 10–30 % volume discounts for 50+ / edu / gov / nonprofit; 14-day trial on Pro.
- Terms §5 Prohibited Uses verbatim relevant lines: **"Resell or sublicense the Service"**,
  **"Develop competing products/services"**, "Reverse engineer or attempt unauthorized access",
  "Circumvent usage limits, security measures, or export laws", "Spam, phishing, scrape, or harvest data".
  §3: "one person = one account"; no multiple free accounts to bypass limits. §2A/§3A: 6+ users from one
  organization may require an MSA/DPA and institutional pricing retroactively; 15-day audit response.
  §4: user retains ownership; no public-AI training on research data; third-party AI models process
  queries in real time. §9/§9A: research only, not for clinical use, verify results independently.

### 2.2 Honest status

Written authorization from smarts.bio has **NOT** been obtained. No integration is production-enabled.
Public API-backed access must remain behind `SMARTSBIO_ENABLED=false` plus an explicit authorization gate.
Private, non-production API contract testing inside the account's permitted use is allowed.
Actual **Team Free** limits are **[U]** and must be discovered from the connected account, never copied
from Personal Free. Numeric rate limits are **[U]**. Tool IDs must be discovered at runtime via
`GET /v1/tools`; none are invented here.

## 3. 9Router

No endpoint URL, no credentials and no staging/production deployment were supplied for M7. **[U]** for
endpoint, key, model names, quotas and latency. Repo docs (`AI_AGENT_ARCHITECTURE.md:223`,
`COMPUTE_INFRASTRUCTURE.md:93-105`, access date recorded there 2026-11-24) describe a *local*
OpenAI-compatible proxy at `http://127.0.0.1:20128/v1` with 555 models and a `NINEROUTER_API_KEY`; that is
prior-milestone evidence, **not** a supplied deployable endpoint and **not** reachable from a Cloudflare
Worker. It is not treated as the M7 staging endpoint. No model name is asserted as current.

Required properties before any use: HTTPS with valid TLS; authentication via Cloudflare secret; health
check; model discovery; chat completion; structured JSON output; streaming; explicit timeout; token-usage
reporting; model name recorded in provenance. Owner must supply, via `wrangler secret put`, distinct
staging and production values: `NINEROUTER_API_KEY`, `NINEROUTER_BASE_URL` (HTTPS), and any model
identifier (only an owner-supplied, server-discovered exact id). Never put these in files, code or browser.
