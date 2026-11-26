# Product Scope Audit — CORE PRODUCT COMPLETION

**Date:** 2026-11-26
**Branch:** `product/core-completion` · **Base:** `8105956c908ea6c0d5c053b5ed2c13b86516d2a2`
**Snapshot note:** the inventory below is of the tree at base `8105956`. Concurrent uncommitted changes appeared during this pass (`public/assistant.html`, `css/assistant.css`, `js/assistant.js`, `worker.js`, new untracked `functions/api/tools/catalog/` and `providers/tools/registry.js`). They were not created or reviewed by this audit and are excluded from the classification tables.

**Method:** read-only inventory of `web-platform/public/**`, `web-platform/worker.js` (`ROUTES`, lines 129–197), `web-platform/functions/api/**`, `web-platform/providers/**`, `python-engine/src/**`, `web-platform/migrations/**`, `scripts/**`, `.github/workflows/tests.yml`, and the M7.4/M7.5 reports. No code, config, migration or credential was changed.

---

## 0. Classification legend

| Class | Meaning |
|---|---|
| **CORE** | Directly serves the 14-step researcher journey in `PRODUCT_NORTH_STAR.md §2`. |
| **SUPPORTING** | Needed to make CORE trustworthy or operable; not itself a headline feature. |
| **OPTIONAL** | Useful but not required for the current product promise. |
| **INCOMPLETE** | Present but cannot complete its advertised job in this tree. |
| **DUPLICATE** | A second implementation/shim of a capability that already has one authoritative owner. |
| **UNNECESSARY** | No demonstrable user or engineering value in the current product. |
| **UNSUPPORTED** | Claimed/documented or routed but not actually reachable/implemented. |

**Recommendations:** **KEEP** (unchanged), **INTEGRATE** (fold into the authoritative owner, do not delete the evidence), **SIMPLIFY** (reduce surface or correct documentation, preserve history), **HIDE** (keep code, remove from user-facing promotion until real), **REMOVE** (only for genuine dead weight; never for migrations, security controls, scientific evidence or historical reports).

**Global preservation rule:** migrations `0001`–`0011` (including the deliberate absence of `0005`), the `metadata-only://` honesty markers, consent/governor/approval code, CSP and same-origin headers, the evidence ledger, benchmark reports and all M7.x historical documents are **KEEP**. Historical claims that were superseded are retained with their status labels, not erased (`docs/M7_5_FOUNDATION_DESIGN.md:29`; `docs/M7_4_FINAL_REPORT.md:3`).

---

## 1. Public pages (`web-platform/public/*.html`)

| Screen | Purpose | Works? | Dependencies | User value | Reliability | Class | Recommendation |
|---|---|---|---|---|---|---|---|
| `index.html` (360 lines) | Landing: validate FASTA, compute stats, navigate tools | Yes, browser-local | `js/app.js`, `fasta.js`, `statistics.js`, shared rules | High — entry point and first real utility | High; static + CSP | **CORE** | **KEEP** |
| `ai.html` (306) | AI research workspace: request → plan → approval → run → result/report | Yes for local path; no LLM | `js/ai-workspace.js`, `ai-execution.js`, `functions/api/ai/**` | Highest — primary workflow UI | Medium: real local execution; report/provenance read from D1 | **CORE** | **KEEP**; do not promise chat |
| `assistant.html` (218) | S Bio Assistant conversational shell | **UI only** — status unavailable, chat 503 | `js/assistant.js`, `/api/assistant/status|chat` | Medium as guidance/navigation; zero as chat today | Honest fail-closed; no model | **INCOMPLETE** | **HIDE** chat affordance behind explicit unavailable banner; keep code for future authorized provider (`docs/ASSISTANT_UX_DESIGN.md:336-354`) |
| `workspace.html` (310) | Projects, dataset metadata, catalog, run history/detail, labelled sample | Yes in local-browser mode; operator mode requires token | `js/workspace.js`, `/api/workspace/**` | High for organization; none for byte storage | Medium: default mode is `localStorage` scratchpad, not server state | **CORE** | **KEEP**; label metadata-only and local mode plainly |
| `blast.html` (205) | BLAST TSV import/analyzer, local | Yes, browser-local | `js/blast-app.js`, `blast.js` | High — independent tool | High; no network | **CORE** | **KEEP** |
| `taxonomy.html` (214) | Consensus/verdict analysis of BLAST results, local | Yes, browser-local | `js/taxonomy-app.js`, `taxonomy.js`, `verdict.js`, `difficult-groups.js` | High — scientific core | High; explicit `insufficient_evidence` | **CORE** | **KEEP** |
| `phylo.html` (170) | MSA + phylogenetic tree workflow | UI + local deterministic plugins work; remote Galaxy multi-step **unverified** | `js/phylo.js`, `/api/ai/workflows/phylo/*`, Galaxy adapter | Medium — real local NJ/UPGMA pipeline exists | Low for advertised remote workflow; `production_ready:false` | **INCOMPLETE** | **SIMPLIFY/HIDE** remote claims; keep local computations (`docs/M7_4_2_FINAL_POLISH_REPORT.md:37`) |
| `benchmark.html` (147) | Risk-coverage / benchmark explainer | Yes as explainer; real benchmark source file absent from tree | `js/benchmark-app.js`, `risk-coverage.js` | Low–Medium — scientific evidence presentation | Low for published numbers (`docs/discovery/AUDIT_docs_consistency.md` D2) | **OPTIONAL** | **KEEP** with "numbers unverified here" labelling; do not delete the evidence docs |
| `research-use.html` (129) | Mission research-use statement verbatim | Yes, static | — | High — legal/ethical clarity | High | **SUPPORTING** | **KEEP** (exact text is the mission source of truth, `docs/M7_4_2_ACCESSIBILITY.md:24,88`) |

**Images/assets:** `public/brand/*.svg`, `public/favicon.svg`, `css/tokens.css`, `components.css`, `app-views.css`, `assistant.css`, `benchmark.css`, `main.css`, `tool-views.css`, `public/_headers` — **SUPPORTING / KEEP**, single "Precision Instrument Bench" design system (`docs/DESIGN_SYSTEM.md:8`; `docs/BRAND_IDENTITY.md:5`). No second design system.

---

## 2. API inventory (all routes registered in `web-platform/worker.js:129-197`)

### 2.1 `/api/assistant/*`

| Endpoint | Purpose | Works? | Dependencies | User value | Reliability | Class | Recommendation |
|---|---|---|---|---|---|---|---|
| `GET /api/assistant/status` | Honest capability status | Yes — always `available:false` | `functions/api/assistant/index.js` | High (prevents false promise) | High, fail-closed | **SUPPORTING** | **KEEP** |
| `POST /api/assistant/chat` | Chat gateway | Validation works; **no reply generated**, 503 | same module; no provider | None today | Honest | **INCOMPLETE** | **KEEP fail-closed**; do not wire to mock |
| `/api/assistant/message`, `/plan`, `/stop` (`docs/ASSISTANT_UX_DESIGN.md:157-164`) | Proposed gateway routes | **NOT ROUTED** | — | — | — | **UNSUPPORTED** | **SIMPLIFY** design doc to match the two real routes; do not add routes in this program |

### 2.2 `/api/ai/*` (control plane)

| Endpoint | Purpose | Works? | Dependencies | User value | Reliability | Class | Recommendation |
|---|---|---|---|---|---|---|---|
| `POST /api/ai/requests` | Text + inline FASTA → request/dataset/plan | Yes | D1, planner, registry | CORE | Medium (64 KiB cap, 128 KiB body cap) | **CORE** | **KEEP** |
| `GET /api/tools` | Tool registry with schemas/availability | Yes, 9 tools; 2 marked unavailable | `registry.tools.generated.js` | CORE | High | **CORE** | **KEEP** |
| `GET /api/ai/backend` | Backend/availability metadata | Yes | registry | Medium | High | **SUPPORTING** | **KEEP** |
| `GET /api/ai/plans/:id` | Read immutable plan | Yes | D1 | CORE | High | **CORE** | **KEEP** |
| `POST /api/ai/plans/:id/approve` | Human gate; issues single-use BLAST consent | Yes, one-way/idempotent | D1, consent, audit | CORE | High | **CORE** | **KEEP** |
| `GET /api/ai/jobs` | Agent polling (operator token) | Yes | `AI_AGENT_TOKEN`, D1 | CORE (agent) | High | **CORE** | **KEEP** |
| `POST /api/ai/jobs/:id/result` | Agent artifact/provenance submission | Yes; hashes recomputed server-side | D1, Python agent | CORE | Medium — execution label is self-reported unless env forces mock | **CORE** | **KEEP**; document trust gap |
| `GET /api/ai/jobs/:id/report` | Report by job id | Yes | `report_runs` | CORE | Medium | **CORE** | **KEEP** |
| `GET /api/ai/runs/:id`, `/provenance`, `/report` | Results, DAG, HTML report | Yes; 404 if absent | D1 | CORE | Medium — no durable bytes | **CORE** | **KEEP** |
| `POST /api/ai/workflows/phylo/run`, `/status`, `/tool` | Remote phylo plan/submission/status | Handler works; full remote tree path unverified | Galaxy adapter, D1 | Medium | Low; no credential, no live call permitted | **INCOMPLETE** | **HIDE** from promoted flow; keep as engineering path |
| `GET /api/ai/projects/:id`, `GET /api/audit` (`SYSTEM_ARCHITECTURE.md:201,207`) | Documented project history / audit read | **NOT ROUTED** in `worker.js` | — | — | — | **UNSUPPORTED** | **SIMPLIFY** stale architecture doc; no new endpoint in this program |

### 2.3 `/api/blast/*`

| Endpoint | Purpose | Works? | Dependencies | User value | Reliability | Class | Recommendation |
|---|---|---|---|---|---|---|---|
| `POST /api/blast/submit` | NCBI `CMD=Put`, consent-gated | Code real; live call not permitted/credential-free; mock path gated too | single-use consent token, D1 | CORE (optional external step) | Medium; global NCBI rate limit not enforced | **CORE** | **KEEP**; never bypass consent |
| `GET /api/blast/status/:rid` | RID polling, ≤1/min | Yes | D1, NCBI `CMD=Get` | CORE | High | **CORE** | **KEEP** |
| `GET /api/blast/results/:rid` | TSV result | Yes | D1/NCBI | CORE | High | **CORE** | **KEEP** |
| `GET /api/blast/history` | Recent RIDs (no sequences) | Yes | D1 | Low–Medium | Medium — publishes RIDs | **OPTIONAL** | **KEEP** with existing risk note (`docs/discovery/AUDIT_api_infra.md` G1) |

### 2.4 `/api/workspace/*` (operator token required; `deriveOwner`)

| Endpoint | Purpose | Works? | Dependencies | User value | Reliability | Class | Recommendation |
|---|---|---|---|---|---|---|---|
| `POST/GET /api/workspace/projects` | Create/list projects | Yes | D1, `X-Agent-Token` | CORE | High | **CORE** | **KEEP** |
| `GET/PATCH /api/workspace/projects/:id` | Open/edit project | Yes | same | CORE | High | **CORE** | **KEEP** |
| `POST .../archive`, `.../activate` | Status transitions | Yes | same | SUPPORTING | High | **SUPPORTING** | **KEEP** |
| `GET/POST .../datasets` | Register **metadata only** (no bytes, no public URLs) | Yes | same | CORE for organization | High for metadata; byte durability absent | **INCOMPLETE** | **KEEP** with `metadata-only://` labelling |
| `GET/POST .../runs` | Create/list unified run markers; never executes | Yes | same | CORE | High as bookkeeping | **CORE** | **KEEP** |
| `GET/PATCH /api/workspace/runs/:id` | Detail + strict 11-state transition | Yes; transition to `succeeded` blocked on incomplete provenance | same | CORE | High | **CORE** | **KEEP** |
| `GET /runs/:id/provenance`, `/report` | Immutable record / report via parent run | Yes; 404 if absent | `provenance_records`, `report_runs` | CORE | Medium | **CORE** | **KEEP** |
| `GET /api/workspace/workflows` | Authoritative 2-entry catalog | Yes | `catalog.js` | CORE | High | **CORE** | **KEEP** |
| `GET /api/workspace/demo` | Labelled `precomputed` sample | Yes | same | SUPPORTING | High (honest labels) | **SUPPORTING** | **KEEP** |
| `GET /api/workspace/*` catch-all | Fail-closed 404 | Yes | `worker.js:148` | Trust boundary | High | **SUPPORTING** | **KEEP** |
| `providers/workspace/catalog.js`, `states.js`, `functions/api/workspace/index.js` | Compatibility shims re-exporting the authoritative catalog/state | Yes | authoritative modules | Internal only | High | **DUPLICATE** | **INTEGRATE** — retain as deprecated shims, never re-add a second list (`M7_4_FINAL_REPORT.md:27`; `providers/workspace/catalog.js:1-4`) |

### 2.5 `/api/providers/*` (metadata public; governor/transfer routes operator-only)

| Endpoint group | Purpose | Works? | Dependencies | User value | Reliability | Class | Recommendation |
|---|---|---|---|---|---|---|---|
| `GET /api/providers`, `/:id`, `/:id/capabilities`, `/:id/limits`, `/usage` | Discovery, limits, usage | Yes; all three `enabled:false`, 0 advertised tools | registry, governor | Medium | High, fail-closed | **SUPPORTING** | **KEEP** |
| `POST /api/providers/chat`, `/plan` | Real model chat/plan path | Code exists; production and staging flags off → 403 | 9Router adapter, governor, D1 | None today | Honest 403 | **INCOMPLETE** | **HIDE** from UI; keep engineering path |
| `POST /api/providers/consent` | Scoped ≤30 min single-use egress consent | Yes | D1 `provider_consents` | CORE safety | High | **SUPPORTING** | **KEEP** |
| `GET/POST /api/providers/transfers`, `POST /budget`, `/emergency-stop` | governor/transfer ledger & controls | Yes; operator token required | D1 governor state | SUPPORTING | High | **SUPPORTING** | **KEEP** |
| `GET/POST /api/providers/jobs`, `/jobs/:id`, `/cancel`, `/artifacts` | Governed provider job lifecycle | Yes; refuses submissions when disabled | adapters, consent, D1 | Potential CORE | Low without providers | **INCOMPLETE** | **KEEP** engineering; no activation |
| `GET/POST /api/providers/galaxy/artifacts`, `/upload`, `/datasets/:id/metadata|download` | Galaxy dataset references and 1 MiB text artifacts | Yes; fail closed when Galaxy disabled | Galaxy adapter, D1 | Medium | Low — provider references, not canonical bytes | **INCOMPLETE** | **KEEP**; label as references |

### 2.6 `/api/artifacts/*` (R2 intended, not bound)

| Endpoint | Purpose | Works? | Dependencies | User value | Reliability | Class | Recommendation |
|---|---|---|---|---|---|---|---|
| `POST /upload-url`, `PUT /upload`, `GET /content` | Signed-ticket byte upload/read | Code exists; **503 fail-closed** | R2 `ARTIFACTS` binding + `ARTIFACT_SIGNING_KEY` — neither set | None today | Honest failure | **UNSUPPORTED** | **KEEP** code as target seam; never invent a public bucket |
| `GET /:id/download-url`, `POST /delete` | Ticket/consent-scoped download/delete | Same fail-closed state | same | None today | Honest failure | **UNSUPPORTED** | **KEEP**; document as inactive |

---

## 3. Provider adapters (`web-platform/providers/**`) and execution backends

| Adapter | Purpose | Works? | Dependencies | User value | Reliability | Class | Recommendation |
|---|---|---|---|---|---|---|---|
| **Galaxy** (`providers/galaxy/index.js`) | Discovery, job submit/status/cancel, dataset upload/download, workflows; 11 operations declared (`:71-83`) | Code complete; **staging flag only**, no credential available, account not activated; a historical real MAFFT run exists but no new live call permitted | `GALAXY_ENABLED`, `GALAXY_BASE_URL`, `GALAXY_API_KEY`, account activation | High potential | Low in this branch | **INCOMPLETE** | **KEEP**; *enabled staging-only, inactive here*; no flag change, no live call |
| **smarts.bio** (`providers/smartsbio/index.js`) | Chat/plan/tools/pipelines/files | Disabled in both envs **and** gated by written authorization `SMARTSBIO_PUBLIC_AUTHORIZED`; no network call when inactive (`:3-9,75-81,88-111`) | Written provider authorization + secrets | Unresolved | Fail-closed | **UNSUPPORTED** | **KEEP** code, **HIDE** everywhere; do not request credentials |
| **9Router** (`providers/ninerouter/index.js`) | Only chat-capable adapter; `/v1/models`, `/v1/chat/completions`, `SYSTEM_GUARD` | Disabled in both envs; no URL/key; endpoint documented as machine-local `127.0.0.1:20128` unreachable from Worker | `NINEROUTER_ENABLED`, base URL, key | Highest potential, zero today | Fail-closed 403 | **UNSUPPORTED** | **KEEP** code, **HIDE** chat; no provider activation |
| **Python engine local** (`python-engine/src/smartbio/**`, `aiagent/agent.py`, `plugins/**`) | Real FASTA/stats, phylo MSA/tree/report, 16S adapters; polls jobs with operator token | **WORKS** for 7 available tools; 2 16S registry tools marked unavailable (need TSV dataset + local DB) | Local install, Biopython, optional BLAST+ | Highest | High for available tools | **CORE** | **KEEP**; do not reimplement in Worker |
| **Provider registry** (`providers/registry.js:25-32,84-113`) | Single enablement/discovery/tool-resolution authority | Yes | flags, adapters | SUPPORTING | High | **SUPPORTING** | **KEEP** — single source of truth for advertised tools |
| **Usage governor / consent / retry / normalize** (`providers/common/**`) | Budget reservations, single-use consent, typed errors | Yes; fail-closed on missing D1 | D1 | SUPPORTING | High | **SUPPORTING** | **KEEP** — security control |

---

## 4. Operator tooling (engineering infrastructure — default **KEEP**)

| Item | Purpose | Works? | Value / risk | Class | Recommendation |
|---|---|---|---|---|---|
| `web-platform/migrations/0001…0011` (no `0005`) | Additive schema: BLAST, AI platform, consent, heartbeat, governor, Galaxy artifacts, workspace | Applied in staging; local `wrangler d1 migrations apply --local` fails with a Wrangler 4.168.0 tool error, but direct SQLite application passed (`docs/M7_4_FINAL_REPORT.md:59,64`) | Essential, non-destructive history | **SUPPORTING** | **KEEP**; never drop or rewrite; do not "fix" by deleting |
| `web-platform/wrangler.toml` | Worker entrypoint, assets, D1 prod/staging split, all provider flags off, R2 comments | Yes | Security/environment control | **SUPPORTING** | **KEEP**; no flag or binding changes in this program |
| `web-platform/worker.js` | Explicit route table, same-origin CORS, fail-closed 404, asset delegation | Yes | Control plane | **CORE** | **KEEP** |
| `web-platform/storage/r2.js`, `storage/galaxy-artifacts.js` | Signed tickets / 1 MiB Galaxy text artifacts | R2 code present but unbound; Galaxy path fail-closed | Target seam, not active | **INCOMPLETE** | **KEEP** as engineering infrastructure |
| `scripts/agent-setup/*` (install/start/health/update/uninstall, ps1+sh) | Local agent operations | Documented scripts | Operational value | **SUPPORTING** | **KEEP** |
| `scripts/secrets/*` | Operator secret-setting workflow | Documented | Avoids committed secrets | **SUPPORTING** | **KEEP**; never inline a secret |
| `scripts/live-smoke/provider-live-smoke.mjs`, `galaxy-upload-tests.mjs` | Live provider probes | Require credentials; not run here | Evidence tooling | **SUPPORTING** | **KEEP**; no live call in this program |
| `scripts/check_plugins.py`, `generate_plugin_registry.py` | Plugin compliance + generated registry | Yes; registry is generated from manifests | Single-source enforcement | **SUPPORTING** | **KEEP** |
| `scripts/build_taxonomy_map.py`, `run_benchmark.py`, `run_phylogenetics_demo.py`, `generate_results.py` | Scientific reproducibility tooling | Present; benchmark source data absent from tree | Scientific evidence | **OPTIONAL/SUPPORTING** | **KEEP**; do not delete because numbers are unverified |
| `.github/workflows/tests.yml`, `web-platform/package.json` scripts | CI + `npm test`, E2E scripts | Yes | Quality gate | **SUPPORTING** | **KEEP** |
| `web-platform/tests/**`, `python-engine/tests/**`, `shared/test-cases/**` | Regression suites and shared vectors | Green in M7.4/M7.5 reports (505 JS / 244 Python at M7.4; later 515/240 in polish reports) | Preservation requirement `NFR-5` | **SUPPORTING** | **KEEP**; no test deletion |
| `docs/**` (audits, discovery, M7.1–M7.5 reports, evidence ledger, design system) | Historical evidence and decisions | Present | Scientific/documentation evidence | **SUPPORTING** | **KEEP**; correct with status notes, never erase |

---

## 5. Blunt findings

1. **AI chat is unavailable.** `GET /api/assistant/status` reports `available:false`; `POST /api/assistant/chat` returns 503 with `generated:false` and contacts no provider (`web-platform/functions/api/assistant/index.js:91-97,106-180`). No enabled, authorized, reachable LLM exists; `AI_LLM_PROVIDER` is Python-only. This is an honest state, not a bug to paper over.
2. **The full phylogenetics workflow is unverified.** One real MAFFT job completed historically (`docs/M7_3_PHYLOGENETICS_WORKFLOW_REPORT.md:84`); tree job, remote artifact retrieval, independent validation, run-derived report and full website E2E are **NOT ACHIEVED** (`:88`). `production_ready:false` is authoritative (`functions/api/workspace/catalog.js:44-48`).
3. **Dataset bytes are not durable.** D1 inline text, `d1://` and `metadata-only://` markers, and Galaxy dataset ids are references/labels, not platform-owned file storage; no R2 binding or signing key exists (`docs/M7_5_FOUNDATION_DESIGN.md:236-248`; `wrangler.toml:20-23`).
4. **The workspace is metadata-only and non-multi-user.** Browser default mode stores `{projects, datasets, runs}` metadata in `localStorage` under `m74_workspace_local_v1`; operator mode holds the token only in memory; there is no signup/login/session (`docs/M7_4_WORKSPACE_DESIGN.md:169-176`; `docs/M7_5_FOUNDATION_DESIGN.md:198-203`).
5. **Provider flags are off; no credential is available.** All three are `"false"` in production; staging enables Galaxy only; M7.1 live probes showed 3 disabled providers, 0 advertised tools, typed 403s (`docs/M7_1_LIVE_ACTIVATION_REPORT.md:6,70-81`). **No live Galaxy call is permitted in this program.**
6. **Two documented endpoints do not exist in the route table** (`/api/ai/projects/:id`, `/api/audit`) and three designed assistant routes are not implemented. Fix the docs, not the code, in this program.
7. **Execution-mode honesty has a seam.** Worker `computeExecutionMode()` accepts a self-reported `"real"`/`"mock"` from the agent unless the deployment forces mock (`functions/api/ai/_lib.js:270-281`); this is a known trust-boundary gap (`docs/discovery/REVIEW_worker_ui.md:36`).

**Net recommendation:** no feature in this inventory should be deleted to "simplify". The correct P0/P1 actions are: **HIDE** unavailability behind honest labels, **INTEGRATE** the duplicate shims under their authoritative owners, **SIMPLIFY** stale doc claims, and **KEEP** all engineering infrastructure, migrations, security controls, scientific evidence and historical reports.
