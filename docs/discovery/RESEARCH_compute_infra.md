# Practical Execution Architecture for a Bioinformatics AI Platform (Compute Infrastructure Research)

**Research / access date:** 2026-11-24 (all pages fetched this session unless marked otherwise)
**Scope:** Verify where heavy bioinformatics computation can and cannot run; local execution agents; Galaxy; workflow engines; cost/quotas; scientific limitations of AI-assisted analysis. Produce a tiered reference architecture.
**Method:** Official documentation and official project sources fetched directly by URL. The `websearch` integration returned HTTP 402 in this session, so no search-engine results were used; Cloudflare's official docs search API (`https://developers.cloudflare.com/.well-known/search?q=...`) and the Galaxy Hub GitHub tree were used to locate pages.

**Verification legend**
- **VERIFIED** — read directly from the labelled official page during this session (URL given).
- **PARTIAL** — key facts verified; a sub-item (exact number, exact licence text) not retrieved.
- **UNCERTAIN** — plausible/stable known behaviour, not re-verified this session; confirm before relying on it.
- **NOT VERIFIED** — could not be confirmed from an official source; do not invent a value.

---

## 1. Cloudflare Workers: hard limits and what they mean for BLAST/aligners

Sources: `https://developers.cloudflare.com/workers/platform/limits/` (page dateModified 2026-11-19) and `https://developers.cloudflare.com/workers/configuration/compatibility-dates/` (2026-04-23), both VERIFIED 2026-11-24.

| Limit | Workers Free | Workers Paid | Source |
|---|---|---|---|
| CPU time per HTTP request | **10 ms** | **5 min max (default 30 s)**, set `[limits] cpu_ms = 300_000` | Workers limits |
| CPU time per Cron Trigger | 10 ms | 5 min (30 s default); 15 min for ≥1 h intervals | Workers limits |
| Memory per isolate | **128 MB** | **128 MB** (includes JS heap + WASM) | Workers limits |
| Request body size (incoming) | 100 MB on Free/Pro zone; 200 MB Business; up to 5 GB Enterprise | same (depends on *zone* plan, not Workers plan) | Workers limits |
| Outbound HTTP body from DO / Container | 100 MiB | 100 MiB | Workers limits / Durable Objects limits |
| Worker bundle size | 64 MiB uncompressed | 64 MiB | Workers limits |
| Worker startup time | 1 s | 1 s | Workers limits |
| Wall clock: HTTP request | No hard limit while client connected; `waitUntil()` +30 s | same | Workers limits |
| Wall clock: Cron / Queue consumer / DO alarm | 15 min | 15 min | Workers limits |
| Daily requests | 100,000/day (Error 1027 beyond) | no limit | Workers limits / Workers pricing |
| Subrequests per invocation | 50 | 10,000 (up to 10M) | Workers limits |
| Number of Workers | 100 | 500 | Workers limits |

**Compatibility date:** set `compatibility_date` in `wrangler.toml` `/` `wrangler.jsonc` to the current date (docs example `2022-04-05`; Containers docs example `2026-11-24`) — it opts into all backwards-incompatible runtime changes up to that date. Cloudflare supports old dates forever, but new features may require a current date. If omitted via the API, it defaults to `2021-11-02`. VERIFIED.

**Storage primitives (all VERIFIED 2026-11-24):**

| Product | Free | Paid | Source |
|---|---|---|---|
| **D1** (SQLite) | 10 DBs; 500 MB/DB; 5 GB/account; 5M rows read/day; 100k rows written/day; 7-day Time Travel; 50 queries/invocation | 1,000,000 DBs included; 10 GB/DB (cannot be increased); 1 TB/account; 25B rows read/mo + $0.001/M; 50M written/mo + $1/M; 30-day Time Travel; 1,000 queries/invocation; storage $0.75/GB-mo after 5 GB | `https://developers.cloudflare.com/d1/platform/limits/`, `https://developers.cloudflare.com/d1/platform/pricing/` |
| **D1 query constraints** | 2 MB max row/blob; 100 KB SQL statement; 30 s max query duration; 50 MB max query result (effective 2026-11-04); single-threaded per DB, ~1,000 q/s at 1 ms/query | same per-query constraints | D1 limits |
| **R2** | 10 GB-mo storage; 1M Class A ops/mo; 10M Class B ops/mo; free egress | $0.015/GB-mo, $4.50/M Class A, $0.36/M Class B; Infrequent Access $0.01/GB-mo + $0.01/GB retrieval; **egress always free** | `https://developers.cloudflare.com/r2/pricing/` |
| **Queues** | 10,000 queues; 10,000 ops/day; 24 h retention (fixed) | 1M ops/mo + $0.40/M; 4-day default retention, configurable to 14 days; 5,000 msg/s/queue; 25 GB backlog; 128 KB message; 100 retries; 15-min consumer wall time | `https://developers.cloudflare.com/queues/platform/limits/`, `.../pricing/` |
| **Durable Objects** | SQLite backend only; 100 classes; 5 GB total storage; 10 GB max/object (some docs say 1 GB free per object — verify); 30 s CPU/request | 500 classes; unlimited storage; 10 GB/object; 30 s CPU (configurable to 5 min); 128 MB memory; 100 MiB outbound body | `https://developers.cloudflare.com/durable-objects/platform/limits/` |

### 1.1 Verdict: Workers CANNOT run heavy BLAST, aligners, or QIIME 2

**VERIFIED inference from the documented limits** (not an assumption): a Worker isolate has **128 MB RAM** and **10 ms CPU (free) / 30 s default–5 min max CPU (paid)**, a **64 MiB bundle**, and a **100 MB default request body**; BLAST databases (nt, refseq) and aligner indices are multiple GB, and `makeblastdb`/BWA/minimap2/QIIME 2 jobs routinely need multi-GB RAM and minutes-to-hours of CPU. Workers are appropriate only for the **control plane**: auth, request validation, job enqueue, status reads, signed R2 URLs, result aggregation and LLM planning/explanation. Cloudflare's own CPU-limit guidance says to "offload work — move expensive computation to Durable Objects or process data in smaller chunks"; Durable Objects share the same 128 MB/5 min CPU envelope, so they are not a solution for BLAST either. Heavy compute must run in **Containers, a local agent, Galaxy, or an external VM/HPC**.

---

## 2. Cloudflare Containers and Sandboxes (GA) — running Docker images at the edge

- **GA status: VERIFIED** — "Containers and Sandboxes are now generally available" on the Workers Paid plan, changelog 2026-04-13: `https://developers.cloudflare.com/changelog/post/2026-04-13-containers-sandbox-ga/`. Some sub-features remain beta (snapshot pricing "public beta" on `https://developers.cloudflare.com/containers/platform/pricing/`; DO scheduling policy for Sandboxes described as public beta on `https://developers.cloudflare.com/sandbox/`). Treat the product as GA, but check individual feature status.
- **Instance types (VERIFIED,** `https://developers.cloudflare.com/containers/platform/limits/`**):** lite 1/16 vCPU / 256 MiB / 2 GB disk; basic 1/4 / 1 GiB / 4 GB; standard-1 1/2 / 4 GiB / 8 GB; standard-2 1 / 6 GiB / 12 GB; standard-3 2 / 8 GiB / 16 GB; standard-4 4 / 12 GiB / 20 GB. Custom types allowed (min 1/16 vCPU, 256 MiB, 2 GB). Per instance max 4 vCPU / 12 GiB / 20 GB; image size = instance disk; 50 GB total image storage/account; snapshots ≤20 GB, 30-day retention.
- **Pricing (VERIFIED,** `https://developers.cloudflare.com/containers/platform/pricing/`**):** included in **$5/month Workers Paid**: 25 GiB-hours memory/mo, 375 vCPU-minutes/mo, 200 GB-hours disk/mo. Overage: **$0.0000025/GiB-s** memory, **$0.000020/vCPU-s** active CPU (CPU billed on *active use only*, not provisioned), **$0.00000007/GB-s** disk; billed every 10 ms; scale-to-zero on inactivity timeout. Container egress $0.025/GB (NA/EU, 1 TB included), $0.05/GB (Oceania/Korea/Taiwan, 500 GB), $0.04/GB (elsewhere, 500 GB). Workers + Durable Objects usage billed separately. Snapshots free during public beta.
- **Operational caveats (VERIFIED):** local disk is temporary (use R2/KV/D1 for durable data); outbound HTTP body from a Container via outbound handler capped at **100 MiB** — use multipart/R2 signed PUTs for large results; cold starts typically 1–3 s; each Container backed by a Durable Object; inbound TCP/gRPC via Spectrum is still beta; Docker Hub images supported.
- **Security (VERIFIED,** `https://developers.cloudflare.com/sandbox/`**, dateModified 2026-09-30):** a Container instance is a **microVM with its own kernel and network**; Internet access is off unless `enableInternet: true`; your Worker decides which APIs/data the code receives. Sandboxes (`@cloudflare/sandbox`) are the official mechanism for **untrusted or agent-generated code**; Dynamic Workers isolate JS/Python/WASM with `globalOutbound: null`. This is the right pattern if an LLM writes or imports workflow code.

**Implication:** a standard-4 Container (4 vCPU/12 GiB) can run many real bioinformatics CLI tools, but memory-hungry steps (large genome indexes, QIIME 2, some aligners) exceed the documented per-instance maximum. For those, use a local agent or self-hosted Galaxy/HPC.

---

## 3. Local execution agent pattern (user-installed CLI/daemon)

### 3.1 Job transport — three verified options

1. **Cloudflare Queues HTTP pull consumer — RECOMMENDED.** VERIFIED (`https://developers.cloudflare.com/queues/configuration/pull-consumers/`, dateModified 2026-07-01; `https://developers.cloudflare.com/queues/platform/limits/`): "A pull-based consumer allows you to pull from a queue over HTTP from any environment and/or programming language outside of Cloudflare Workers... useful when your message consumption rate is limited by upstream infrastructure or long-running tasks." Flow: enable HTTP pull (`npx wrangler queues consumer http add $QUEUE`), create a scoped API token with `queues#read` + `queues#write` (Bearer header), `POST /accounts/{id}/queues/{id}/messages/pull` with `batch_size` (max 100) and `visibility_timeout_ms` (max 12 h), then `POST .../messages/ack` with `lease_id`s (or retry with delay). **Short polling** (empty response when idle); multiple concurrent clients get unique batches; at-least-once delivery. Messages are capped at **128 KB**, so carry only a job ID + R2 object keys + checksums, never sequence data. Pulls on an empty queue still cost a read operation — choose polling interval accordingly.
2. **D1 status-table polling.** VERIFIED (D1 limits/pricing above): a Worker exposes authenticated `POST /jobs` and `GET /jobs?status=queued`; agent polls D1. Free tier allows 5 GB / 5M rows read/day; paid adds 1,000 queries per invocation and 10 GB/DB. Simpler than Queues but you implement leasing/heartbeats/idempotency yourself.
3. **Plain authenticated HTTPS endpoint / webhook.** Worker issues short-lived signed URLs; agent polls. Appropriate for a single user/machine; lacks durable backpressure.

### 3.2 Recommended agent design (synthesis; not a quoted source)

```
pipx/uv install bioagent-cli  ->  bioagent login (device flow / API key)
   -> daemon loop:
       1. POST /messages/pull (Bearer token, visibility_timeout = expected runtime + margin)
       2. For each job: verify HMAC-signed manifest, job ID, allowed tool+version, checksums
       3. Download inputs from short-lived R2 signed URLs to a per-job scratch dir
       4. Execute: docker/podman run --rm --network=none --read-only --memory=... --cpus=...
                  pinned image@sha256:...  OR  conda env (pinned) / Apptainer image
          (Nextflow -resume / Snakemake / CWL runner as the workflow driver)
       5. Heartbeat + progress events back to control plane; stream logs to R2
       6. Upload outputs with checksums via multipart (each request <100 MiB), validate
       7. ACK only after verified upload; on failure ACK-with-retry or let lease expire -> DLQ
```

**Reliability:** idempotency keyed by `(job_id, step)`; at-least-once semantics mean duplicate execution is possible — make outputs content-addressed; bounded retries (Queues allows 100); explicit dead-letter handling; lease renewal for jobs longer than 12 h (or split into steps).

### 3.3 Security model

- **Job tokens:** per-job, least-privilege, short-TTL, signed (HMAC/JWT) manifests binding `job_id → input keys, allowed tool/container digest, output prefix, expiry`. Never give the agent the account's Cloudflare API key with broad scopes; scope the Queues token to `queues#read`/`queues#write` on one queue and store it in OS keychain/secret file with `0600` permissions. Revoke by rotating the token.
- **Untrusted workflow code:** assume LLM-authored YAML/Nextflow/shell is hostile. Run non-root, no privileged mode, read-only root FS, dropped capabilities, seccomp/AppArmor, cgroup CPU/memory/pids limits, no network by default, allowlisted mounted input directories, pinned image **digests** (not mutable tags). On Cloudflare, use the GA Sandbox/Container pattern above: microVM isolation, `enableInternet: false`, Worker-mediated access to R2/D1.
- **Data governance:** public Galaxy Terms explicitly **prohibit PII/HIPAA/FISMA data** (VERIFIED: `https://usegalaxy.org/static/terms.html`); local agents keep sensitive data on-premise. Validate user consent before any upload to a public service (consistent with the companion `RESEARCH_bio_databases.md`).
- **Audit:** record tool name + exact version, container digest, full command, all inputs/parameters, output checksums, stdout/stderr/exit code — the same provenance tuple Galaxy records (VERIFIED below) and FAIR R1.2 requires.

---

## 4. Galaxy integration

### 4.1 Public vs self-hosted (VERIFIED)

- Five UseGalaxy servers: **usegalaxy.org** (>100,000 registered users, backed by TACC), **usegalaxy.eu** (University of Freiburg), **usegalaxy.org.au**, **usegalaxy.fr**, **usegalaxy.ca**. Members commit to free access, >90% uptime, common tools/reference data, public infrastructure config. Source: `https://galaxyproject.org/usegalaxy/`, access 2026-11-24.
- **UseGalaxy.org quotas** (VERIFIED, Galaxy Hub `content/main/index.md` and `content/support/account-quotas/index.md`, read from `raw.githubusercontent.com/galaxyproject/galaxy-hub/main/...`): **250 GB registered / 5 GB unregistered** data; **6 concurrent jobs registered / 1 unregistered**; one account per user; typical jobs 1 core/8 GB, some 16 GB, multi-core 6 cores/30 GB (Galaxy cluster) or 10 cores/30 GB (Jetstream), 36 h walltime; large HPC resources up to 48 h; increased-memory tools 1 concurrent job. "Some work is simply too large for the public resource... consider moving to a local or cloud Galaxy."
- **No hammering public servers (VERIFIED):** Galaxy Terms (`https://usegalaxy.org/static/terms.html`) require compliance with "any published quotas on data storage, job submissions, or any other limitations"; "Attempts to subvert these limits by creating multiple accounts or through any other method may result in termination of all associated accounts"; access may be revoked at any time; service "AS IS", no PII/HIPAA/FISMA. UseGalaxy.eu's revised 2026 Terms (`https://galaxyproject.org/news/2026/2026-09-07-eu-updated-terms-of-service/`, verified via official Galaxy Hub post) explicitly call out **abuse "increasingly enabled by 'AI' tooling"**; acceptable use is science/research/education; prohibited: non-scientific cryptography, illegitimate data, compute solely to generate revenue, cybercrime; automated temporary suspension on abuse detection; 12-month inactivity → notice → deactivation, then data deletion after 6 months. **Design implication: rate-limit and cap automated API submissions; do not run bulk/AI-generated job floods against public servers; prefer a self-hosted Galaxy or local agent for high volume.**

### 4.2 Galaxy API and AI-agent integration (VERIFIED)

- API overview: `https://galaxyproject.org/develop/api/` (Galaxy Hub). Generate an API key at **User → Preferences → Manage API Key**; it "acts as an alternate means to access your account, and should be treated with the same care as your login password" (also `/api/authenticate/baseauth`). REST + language bindings: **BioBlend** (Python; primary choice), Parsec CLI, blend4j, blend4php. Workflows are **JSON files**; ToolShed stores **versioned** tool archives; Galaxy supports complex control flow better via API than UI.
- **Official agent stack (2026, VERIFIED):** `https://galaxyproject.org/agents/` (source `content/agents/index.md`) — `galaxy-mcp` (48 MCP tools: histories, datasets, tools, IWC workflows, UDTs) + `galaxy-skills` plugins for Claude Code, Codex CLI, Antigravity, Claude Desktop, Pi, Cursor, and the **Orbit** desktop app. Orbit "drafts a plan for your approval, executes on Galaxy ... and records every decision in your notebook." Optional `galaxy-dev-skills` (ToolShed XML wrappers, **nf-to-galaxy**) and `foundry-skills` (69 Workflow Foundry casts converting papers/Nextflow/CWL into validated Galaxy workflows).
- **User-Defined Tools (UDTs, beta):** YAML with `container`, `shell_command`, typed inputs/outputs; validated by Galaxy; beta/per-account on usegalaxy.org (`https://udt-signup.galaxyproject.org/`). Limits: cannot see reference data/BAM indexes/`extra_files`; no test cases; YAML validated but container tag existence is not — use digests/lookup; each revision is a new version. Source: `https://galaxyproject.org/agents/stack/` (VERIFIED).
- **Provenance (VERIFIED, same source):** every Galaxy job records tool name + exact version, container image, full command line, all datasets/parameters, outputs with formats/sizes, and stdout/stderr/exit code; histories are shareable and extractable to workflows. This is an excellent fit for the platform's "validation → report" tier.

### 4.3 Containers in Galaxy / package ecosystems (VERIFIED)

- **Bioconda** (`https://bioconda.github.io/`): >12,000 bioinformatics packages for Conda/Pixi; Linux (64-bit, AArch64) and macOS (x86_64, ARM64); recommended channels `conda-forge` then `bioconda`, `channel_priority strict`.
- **BioContainers** (`https://github.com/BioContainers` / `https://biocontainers.pro/`): >100,000 containers for >12,000 tools; every Bioconda package automatically becomes a Docker/OCI image on `quay.io/biocontainers` (nightly); Galaxy converts/distributes images as **Singularity/Apptainer** via the Galaxy Singularity Depot; for heavy use, use `singularity.galaxyproject.org` **CVMFS** rather than repeatedly downloading images. Mulled multi-package containers available.

---

## 5. Workflow engines and AI generation

All four are mature DAG engines with provenance support; sources VERIFIED 2026-11-24.

| Engine | Official source | Strengths / fit for AI planner |
|---|---|---|
| **Nextflow** (+ nf-core) | `https://www.nextflow.io/docs/latest/index.html`, `https://www.nextflow.io/docs/latest/tracing.html`, `https://nf-co.re/` (nf-core site not fetched this session — PARTIAL) | Dataflow DSL, per-task containers/Conda/Spack, stages inputs into per-task dirs, `-resume`, same pipeline on laptop/HPC/cloud, Apache 2.0. Provenance: execution log, HTML execution report, timeline, CSV trace (hash/command/status/duration/peak RSS), DAG via `-with-dag`. Good for production; DSL is Groovy-based (less natural for LLM generation than Python/YAML), but nf-core templates reduce need to generate from scratch. |
| **Snakemake** | `https://snakemake.readthedocs.io/en/stable/` (v9.27.2) | Human-readable **Python-based** rules; scales to cluster/grid/cloud unchanged; automatic software deployment; portable interactive reports combining results with parameters, code, software; workflow catalog/wrappers. **Likely easiest for an LLM to author correctly**, but generated Python must still be sandboxed and tested. |
| **WDL** (Cromwell and other engines) | `https://openwdl.org/` | Open, community-governed, typed declarative language; WDL **1.3.0** latest (2026) adds enums/else-if/dynamic retry resources; explicit scatter/gather, runtime containers, imports; portable across local/HPC/cloud; conformance-tested engines. Very suitable for **schema-constrained structured generation**. |
| **CWL** | `https://www.commonwl.org/` | Open standard for describing command-line tools and workflows; YAML/JSON; portable from laptop to HPC/cloud; vendor-neutral, reusable/reproducible, parallelization; strong ecosystem. Verbose but machine-friendly — good **interchange format** for an AI planner's output. |

**Recommendation for the AI planner:** do not ask the LLM to emit a full pipeline in one step. Generate a **typed intermediate DAG** (nodes = pinned tool + version/digest + parameters + resource hints; edges = typed files), validate against a JSON schema, then render to **CWL/WDL** for portability or **Snakemake** for local execution. Prefer importing known-good nf-core/Snakemake workflows and modifying configuration. Gate on `--dry-run`/`-preview`/`nextflow -with-dag -preview`, unit tests with small reference datasets, and container digest pinning. Galaxy Workflow Foundry's paper/Nextflow/CWL→Galaxy casts show this conversion approach is already practiced (VERIFIED above).

---

## 6. Cost / quota model — free options and paid dependencies

All figures VERIFIED from the official pricing page named in the row, accessed 2026-11-24. **No figures are invented.** "Free" means a documented no-cost allowance, not unlimited use.

| Option | FREE quota / price | Paid beyond free | Constraint relevant to bioinformatics | Source |
|---|---|---|---|---|
| **Cloudflare Workers Free** | 100,000 requests/day; 10 ms CPU/invocation; 128 MB; KV 100k reads + 1k writes/day, 1 GB; D1 5 GB, 5M rows read/day, 100k written/day; R2 10 GB-mo, 1M A + 10M B ops; Queues 10k ops/day, 24 h retention; Durable Objects 5 GB | Workers Paid **$5/mo** (10M requests/mo, 30M CPU-ms/mo, 1M Queues ops/mo) | No heavy compute; control plane only | `.../workers/platform/pricing/`, `.../workers/platform/limits/` |
| **Cloudflare Containers** | none (Free plan: N/A) | Included in $5/mo: 25 GiB-h RAM, 375 vCPU-min, 200 GB-h disk; then $0.0000025/GiB-s, $0.000020/vCPU-s, $0.00000007/GB-s | Max 4 vCPU/12 GiB/20 GB per instance; 100 MiB outbound HTTP body | `.../containers/platform/pricing/`, `.../containers/platform/limits/` |
| **Cloudflare R2** | 10 GB-mo + 1M Class A + 10M Class B monthly; free egress | $0.015/GB-mo; $4.50/M A; $0.36/M B; IA $0.01/GB-mo + $0.01/GB retrieval | Ideal artifact store; large uploads via multipart | `.../r2/pricing/` |
| **GitHub Actions** | Standard runners **free for public repositories**; every plan includes monthly compute credit: Free/org **$12**, Pro/Team $18, Enterprise Cloud $300 (Linux 2-core = $0.006/min ⇒ Free ≈ 2,000 min/mo); 10 GB/repo cache | $0.002/min Linux 1-core, $0.006/min Linux 2-core, $0.010/min Windows; artifacts/Packages beyond allowance $0.25/GB-mo; cache $0.07/GB-mo | GitHub-hosted jobs max **6 h**, workflow 35 days, 20 concurrent (Free); not a general queue | `https://docs.github.com/en/billing/concepts/product-and-packages/github-actions-billing`, `https://docs.github.com/en/actions/reference/limits` |
| **Hugging Face Spaces** | **CPU Basic: 2 vCPU / 16 GB — FREE**; ZeroGPU — FREE | CPU Upgrade 8 vCPU/32 GB $0.03/h ($22/mo); T4 from $0.40/h; A100 from $2.50/h; Inference Endpoints from $0.033/h; PRO $9/mo | Good for demos/UI and small analysis apps; not for long-running genome jobs | `https://huggingface.co/pricing` |
| **Fly.io** | Personal org: **$1 credit with no card; $5/mo usage with card**; 10 GB snapshot storage free; first 10 SSL certs free | Smallest always-on VM (shared 1x/256 MB) **$2.19/30 days**; 1 GB volume $0.15/mo; egress $0.02/GB (NA/EU); no platform fee | Real Docker VMs, auto-stop to save cost | `https://fly.io/docs/about/pricing/` |
| **Google Colab** | Free notebooks exist (**free-tier existence VERIFIED** at `https://colab.research.google.com/`); **exact GPU/RAM/time quotas NOT VERIFIED from official docs this session** — do not quote numbers | Colab Pro/Enterprise paid (pricing page not retrievable) | Interactive notebooks; runtime disconnects; not a durable job runner | `https://cloud.google.com/colab/docs/` (Enterprise docs) |
| **Academic / startup credits** | **Azure for Students:** free, no credit card, **$100 credit/12 months**, 65+ always-free services, 750 h/12 mo burstable Linux VM, 1M Azure Functions requests, 180k vCPU-s Container Apps; **AWS Activate:** up to **$200,000** credits (eligibility required) | Standard cloud rates after credits | One-off/educational; not a sustainable production base | `https://azure.microsoft.com/en-us/free/students/`, `https://aws.amazon.com/activate/` |
| **Open-source software** | Nextflow (Apache 2.0), Snakemake, WDL/CWL specs, Galaxy, Bioconda/BioContainers, BLAST+ are free/open | Infrastructure + LLM API tokens are the real cost | Avoid vendor lock-in; pin versions | engine docs above |
| **LLM planning dependency** | Cloudflare Workers AI advertises a daily free allocation (**number NOT VERIFIED** this session) | Example official list price: Claude Sonnet 5.5 **$2/M input, $10/M output** tokens; Haiku 5.5 from $0.10/M input | Token cost scales with context; keep datasets out of prompts | `https://docs.claude.com/en/docs/about-claude/models/overview` |

**Paid dependencies to flag explicitly:** Workers Paid **$5/mo** is mandatory for Containers/Sandboxes and for paid Queues/D1 allowances; LLM API tokens are paid beyond free allocations; any cloud VM/HPC allocation beyond credits is paid. R2 egress is free, which makes object storage the cheapest central artifact bus.

---

## 7. Scientific limitations of AI-assisted analysis

### 7.1 Hallucinated citations and statistics (VERIFIED)

- **Survey of Hallucination in Natural Language Generation** — Ji et al., arXiv:2202.03629 (ACM Computing Surveys), covers metrics, mitigation and LLM hallucinations: `https://arxiv.org/abs/2202.03629`.
- **"Phantom References: Hallucinated Citations That Survive Peer Review at Top-Tier Conferences"** — arXiv:2607.00738: with a conservative definition (non-existent works / major author mismatch), reference-level rates usually <1%, but in 2025 **roughly one in twenty NeurIPS and USENIX Security papers contained ≥2 likely hallucinated references**; their RefChecker pipeline audits citations (~$0.04/paper in one venue scan). `https://arxiv.org/abs/2607.00738`.
- **"Testing Our Foundations: Citation Trends, Errors, and Emerging Hallucinations..."** — arXiv:2609.16574: at SIGCSE venues verified hallucinated references grew from 3 (2025) to 17 (2026), **2.3% of 2026 proceedings papers**. `https://arxiv.org/abs/2609.16574`.
- **"Are Large Language Models Good Statisticians?"** — arXiv:2406.07815 (NeurIPS 2024 D&B): StatQA has 11,623 examples; best model (GPT-4o) reached only **64.83%**; LLMs mainly made **applicability errors** (choosing the wrong statistical test). `https://arxiv.org/abs/2406.07815`.
- **"Diagnosing Structural Failures in LLM-Based Evidence Extraction for Meta-Analysis"** — arXiv:2602.10881: full meta-analytic association tuples extracted with **near-zero reliability**, long-context inputs worsened failures, and **downstream aggregation amplified small upstream errors** into unreliable corpus-level statistics. `https://arxiv.org/abs/2602.10881`.
- **"Detecting Hallucinated and Suspicious Citations: What Current Tools Can and Cannot Do"** — arXiv:2607.22693: detectors provide early warnings but are limited by extraction errors, incomplete metadata and database coverage. **HALLMARK** (arXiv:2607.18360) finds verifiers can miss hallucinations and wrongly flag correct papers; every flag still needs human review. Conclusion: verification must be multi-source + deterministic + human-checked.

### 7.2 Context limits (VERIFIED)

Anthropic's official model overview (`https://docs.claude.com/en/docs/about-claude/models/overview`, access 2026-11-24) lists current Claude models at **1M-token context windows and 128K max output** (older generations 200K/64K). Even 1M tokens ≈ 2.5M Unicode characters — orders of magnitude smaller than a single human genome (~3×10⁹ bases) or a FASTQ run (gigabytes). **Consequence:** never paste datasets into prompts; the LLM plans and interprets, while deterministic tools compute over full data; pass only aggregates, schemas, and sampled previews to the model.

### 7.3 Reproducibility requirements (VERIFIED)

- **FAIR principles** (`https://www.go-fair.org/fair-principles/`, Wilkinson et al. 2016, doi:10.1038/sdata.2016.18): R1 = rich attributes, R1.1 = clear licence, **R1.2 = detailed provenance**, R1.3 = community standards; A1.1 = open/free protocol, A1.2 = authentication where needed.
- **Ten Simple Rules for Reproducible Computational Research** (Sandve, Nekrutenko, Taylor & Hovig, PLoS Comput Biol 2013, doi:10.1371/journal.pcbi.1003285; `https://journals.plos.org/ploscompbiol/article?id=10.1371/journal.pcbi.1003285`): track how every result was produced with exact program versions and parameters; avoid manual data manipulation; archive exact program versions; version-control scripts; record intermediate results and random seeds; store raw data behind plots; connect textual claims to underlying results; provide public access. It explicitly names Galaxy and workflow-management systems as frameworks that can supply many of these guarantees.

### 7.4 Verification strategy for the platform

1. **Deterministic computation only** for numbers: BLAST/aligners/QC/statistics run in pinned containers; LLM never invents a p-value, count, citation or interpretation of a result.
2. **Structured planning with validation:** LLM emits a typed DAG/JSON plan; schema + allowlist validation; dry-run/`-preview`; human approval before execution (as Orbit does: "drafts a plan for your approval").
3. **Provenance bundle per run:** workflow file + container digests + exact commands + inputs/parameters + output checksums + logs + environment + seed; match Galaxy's recorded fields and FAIR R1.2.
4. **Independent checks:** re-run on a small reference dataset with known expected output; checksum/metric comparisons; cross-tool agreement; validate statistics with code, not prose; citation verification via DOI/Crossref/Semantic Scholar lookup with human review of flags.
5. **Grounded reporting:** generate narrative only from verified artifacts; render numbers from machine-readable result files; mark any AI-generated interpretation clearly; keep claims linked to result IDs (Ten Simple Rules #9).
6. **Abstention:** when grounding or evidence is insufficient, decline to answer rather than guess; surface uncertainty to the user.

---

## 8. Practical recommendation — tiered architecture

```
[1] BROWSER / CONTROL PLANE  (Cloudflare Workers + Pages static assets)
    - Auth, consent, job submission, plan review/approval, status
    - D1 = job metadata/status; R2 = inputs, logs, artifacts; Queues = job messages
    - LLM = planning + explanation only (never computation)
                         |
                         v  (signed manifest: job_id, tool digest, R2 keys, token TTL)
[2] JOB QUEUE  (Cloudflare Queues, 128 KB control messages; pull-based HTTP consumer
    with 12 h visibility_timeout, ack/retry/DLQ; D1 status table as fallback)
                         |
      +------------------+-------------------+-------------------+
      v                  v                   v                   v
[3a] LOCAL AGENT    [3b] GALAXY          [3c] CONTAINER       [3d] CI / SMALL
     user-installed      public or             runner              JOBS
     CLI/daemon          self-hosted           Cloudflare          GitHub Actions
     (pull/ack,          (BioBlend /           Containers +        (public repos free,
      sandbox,           galaxy-mcp,           Sandboxes,          6 h limit), HF
      local BLAST,       UDTs, IWC,            microVM,            Spaces CPU Basic
      QIIME 2,           quotas/ToS!)          GA, $5/mo           (free), Fly.io
      Bioconda)                                                    small VMs
      +------------------+-------------------+-------------------+
                         v
[4] OBJECT STORAGE / ARTIFACT BUS (R2; presigned multipart uploads; checksums; free egress)
                         v
[5] VALIDATION (schema checks, pinned versions/digests, reference-data tests,
    independent recomputation, citation/DOI verification, human approval gate)
                         v
[6] REPORT (deterministic result tables/plots from artifacts + LLM explanation
    grounded in verified provenance; FAIR R1.2 bundle exported)
```

**What runs where, and why**

| Workload | Runs | Why |
|---|---|---|
| Auth, UI, validation, LLM planning, job state, signed URLs | **Workers + D1 + R2** | Global low latency, free/cheap tiers; no heavy CPU needed |
| Job transport/backpressure | **Cloudflare Queues (pull consumers)** | Native external-HTTP pull with leases, retries, multiple agents, 12 h visibility timeout; messages stay <128 KB |
| BLAST/aligners/QIIME 2, proprietary or large data | **Local agent** | Needs GB RAM, hours CPU, local/reference databases, data stays on user's machine; agent uses container/Conda/Apptainer sandbox |
| Curated public analyses without local install | **UseGalaxy.org / regional public Galaxy** | Thousands of pinned tools, shared reference data, full provenance, free — but respect quotas and ToS (no PII, no flooding) |
| High-volume or policy-sensitive Galaxy workloads | **Self-hosted Galaxy** | Avoid public-server quotas/abuse rules; support Apptainer/CVMFS and Bioconda |
| Moderate Dockerized steps, untrusted agent-generated code | **Cloudflare Containers / Sandboxes** | GA, microVM isolation, scale-to-zero, predictable $/10 ms; max 4 vCPU/12 GiB — not for genome-scale indexes |
| CI-scale reproducible demos | **GitHub Actions / HF Spaces / Fly.io** | Free or near-free allowances; short jobs and demos only |

**Explicit anti-patterns:** running BLAST in a Worker isolate (128 MB / 10 ms–5 min CPU); sending large sequence files through a 128 KB queue message or a 100 MiB outbound HTTP body; flooding public Galaxy with automated jobs or creating multiple accounts to bypass quotas; putting PII/HIPAA data on public Galaxy; trusting LLM-generated statistics or citations without deterministic verification.

---

## 9. Known gaps / follow-ups

- Exact Google Colab free-tier quotas and current Colab Pro prices could not be retrieved from an official URL in this session — verify before documenting numbers.
- nf-core website fetch failed (transport error); Nextflow docs confirm nf-core exists as the community workflow catalogue, but pipeline counts/version details were not verified.
- Durable Objects free-plan per-object storage limit differs between docs pages (1 GB vs 10 GB mentioned); confirm in the live dashboard before relying on it.
- Public Galaxy quotas and terms change (UseGalaxy.eu revised ToS effective 2026-09-07); re-check the relevant server's terms before enabling automated submissions.
- The "Containers GA" statement is from the 2026-04-13 changelog; individual features (snapshots, inbound TCP/gRPC, DO scheduling policy for Sandboxes) were still marked public beta in the docs on 2026-11-24.
