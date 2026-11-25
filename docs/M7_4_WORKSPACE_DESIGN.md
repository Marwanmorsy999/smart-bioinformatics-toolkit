# M7.4 — Unified Research Workspace (design, batch 1)

**Status: API LAYER + BROWSER UI IMPLEMENTED (batches 1 and 2).** This document describes the control-plane surface and the local-first browser client. It does not claim new scientific capability, new providers, multi-user accounts, durable file storage, or production deployment.

Batch 1 deliverables: this design, additive migration `0011_workspace.sql`, the static workflow catalog, the workspace API handlers, Worker route registration, and offline tests. Batch 2 deliverables: reconciled compatibility shims, the unified browser workspace and its Playwright E2E (see §11).

---

## 1. Current architecture (verified facts)

- The control plane is a **Cloudflare Worker** (`web-platform/worker.js`). It adapts a Worker `Request` to the existing Pages-Functions-shaped `onRequest(context)` handlers under `functions/api/**`. Non-API paths go to the `ASSETS` binding; unknown `/api/**` paths fail closed with a 404 JSON envelope.
- The only durable store is **D1** (`env.BLAST_DB`, optionally `env.AI_DB`). `getDb(env)` in `functions/api/ai/_lib.js` resolves the binding. **There is no R2 binding and no R2 write path.** Dataset text and report HTML are inline text in D1 rows with `d1://...` metadata markers.
- Existing schema (`migrations/0002_ai_platform.sql`, already present): `projects`, `datasets`, `ai_requests`, `plans`, `approvals`, `jobs`, `tool_runs`, `artifacts`, `evidence_references`, `report_runs`, `audit_events`. `projects` already has `owner`; `datasets` does not.
- Existing run model: `jobs` rows keyed `job_*`, with `plans`, `tool_runs`, `artifacts`, `report_runs` and `provenance_json` on jobs. `GET /api/ai/runs/:id`, `/provenance`, `/report` already exist. No scientific logic is duplicated by this milestone.
- Existing 16S path: public `POST /api/ai/requests` creates a dataset + plan; `POST /api/ai/plans/:id/approve` gates execution and issues a single-use BLAST consent token; `/api/blast/submit`, `/status`, `/results`, `/history` complete it.
- Existing phylogenetics path: `POST /api/ai/workflows/phylo/{run,status,tool}`. A real MAFFT execution happened once, but the full multi-step tree/retrieval/validation path is **NOT verified**. See `docs/M7_3_PHYLOGENETICS_WORKFLOW_REPORT.md`. There is no live Galaxy in this milestone.
- **Auth reality: there is no login and no per-user accounts.** The only authenticated identity is a single operator/agent token `env.AI_AGENT_TOKEN`, presented as `X-Agent-Token`, checked by `agentTokenError(request, env)` (`functions/api/ai/_lib.js`) and re-exported as `requireOwner(request, env)` (`functions/api/providers/_lib.js`). Browser `/api/ai/requests` and the legacy BLAST endpoints are public. This milestone **must not** invent a login/session system.

## 2. Missing capabilities

1. One place to list/open/edit/archive a research **project** with a scientific objective.
2. Registration of **dataset metadata** (format, source, validation state, provider history reference) without uploading bytes.
3. A **unified run history** spanning 16S and phylogenetics, with a single honest lifecycle state machine that keeps execution, artifact retrieval and validation distinct.
4. A **single catalog** describing what each workflow actually does and what it can actually execute today.
5. **Owner scoping** of workspace rows on the existing operator token, so two different tokens see different rows and cross-owner access is impossible.
6. A clearly labelled **sample/demo** payload that can never be mistaken for a freshly executed analysis.

## 3. Reusable modules (do not rewrite)

| Concern | Reuse |
|---|---|
| Responses, security headers, CORS | `jsonResponse`, `errorResponse`, `htmlResponse`, `preflightResponse`, `methodError`, `requireMethod` from `functions/api/ai/_lib.js` |
| Body parsing / normalization | `readJsonBody`, `safeString`, `isPublicId`, `makeId`, `nowIso`, `parseJson` from the same module |
| Token check | `agentTokenError` (`ai/_lib.js`) via `requireOwner` (`providers/_lib.js`) |
| D1 access + audit | `getDb`, `insertRow`, `getRow`, `listRows`, `runStatement`, `audit` |
| Tables | `projects`, `datasets`, `jobs`, `tool_runs`, `artifacts`, `report_runs`, `audit_events` |
| Report content | existing `report_runs.report_html`; no new reports table |
| Hash utility | `hashInput` (SHA-256) for input fingerprinting |
| Test doubles | `createFakeD1AI`, `mockAIEnv` in `tests/helpers/fake-d1.mjs` |

New SQL is **added** to `SQL` and `SQL_META` in `functions/api/ai/_lib.js`, so the metadata-driven fake D1 understands every new statement. All new selects use equality predicates only (no joins, aggregates or SQL expressions), which the fake implements exactly.

## 4. Proposed data model (additive migration `0011_workspace.sql`)

### 4.1 Extended existing tables

`projects` — add `description TEXT`, `scientific_objective TEXT`, `status TEXT NOT NULL DEFAULT 'active'`, `updated_at TEXT`.

> **Honesty note:** `projects.owner` **already exists** in `0002_ai_platform.sql`. The migration reuses that column and does **not** try to add it again (which would fail). Every new project row writes this existing column with the derived owner principal.

`datasets` — add `file_format TEXT`, `source TEXT`, `validation_state TEXT`, `provider_history_ref TEXT`, `uploaded_at TEXT`, `owner TEXT`, `is_demo INTEGER NOT NULL DEFAULT 0`.

> `datasets.fasta_text` semantics are **unchanged**: only the legacy `/api/ai/requests` path stores inline FASTA there. Workspace dataset registration stores **metadata only** and leaves `fasta_text` NULL. `storage_ref` for such a row is the explicit marker `metadata-only://provider-history` when a provider/history reference is supplied, or `metadata-only://none` otherwise. These are labels, **not** resolvable file locations and **not** proof that bytes exist anywhere. Public URL fields are rejected.

### 4.2 New tables

`workspace_runs` (one row per unified run, `run_...` public id): `project_id`, `workflow_id`, `workflow_version`, `objective`, `input_datasets_json`, `params_json`, `execution_provider`, `execution_mode`, `state`, `created_at`, `completed_at`, `steps_json`, `artifact_refs_json`, `validation_json`, `provenance_json`, `error_json`, `owner`, `is_demo`.

`provenance_records` (`prov_...` public id): `run_id`, `record_json`, `created_at`, `owner`. One immutable final record is written when a run reaches `succeeded`.

**Decision on `reports`: reuse `report_runs`, no new table.** `report_runs` already stores `report_html` plus references and is keyed by a text `job_id`. For a unified run we set `report_runs.job_id` to the workspace run's `run_...` public id. Authorization is enforced **through the parent run**: the report handler first loads `workspace_runs` with `public_id = ? AND owner = ?`; only if that succeeds does it look up `report_runs` by `job_id`. There is no owner column on `report_runs` and no owner leak, because a caller can never reach a report whose parent run they do not own. If no row exists the handler returns 404 — it never fabricates a report.

Indexes: `owner`, `(owner, project_id)`, `(owner, state)` for the new/extended tables.

## 5. API design

All endpoints are mounted under `/api/workspace/**` and registered in both `handlers` and `ROUTES` in `worker.js` (specific paths before dynamic ones).

| Method + path | Purpose | Auth |
|---|---|---|
| `POST /api/workspace/projects` | Create project (name, description, scientific_objective, status) | required |
| `GET /api/workspace/projects` | List owner's projects with dataset/run counts | required |
| `GET /api/workspace/projects/:id` | Open one project | required, owner-filtered, 404 otherwise |
| `PATCH /api/workspace/projects/:id` | Edit project metadata | required, owner-checked |
| `POST /api/workspace/projects/:id/archive` | `status = 'archived'` | required, owner-checked |
| `POST /api/workspace/projects/:id/activate` | `status = 'active'` (restore; documented companion to archive) | required, owner-checked |
| `GET /api/workspace/projects/:id/datasets` | List project dataset metadata | required, owner-checked |
| `POST /api/workspace/projects/:id/datasets` | Register dataset metadata (no bytes) | required, owner-checked parent |
| `GET /api/workspace/workflows` | Static workflow catalog | required (see §6) |
| `GET /api/workspace/projects/:id/runs` | Unified run history for a project | required, owner-checked |
| `POST /api/workspace/projects/:id/runs` | Create a `draft` unified run record; **never executes** | required, owner-checked |
| `PATCH /api/workspace/runs/:id` | Strict state transition + bookkeeping fields | required, owner-checked |
| `GET /api/workspace/runs/:id` | Full run detail | required, owner-checked |
| `GET /api/workspace/runs/:id/provenance` | Final provenance record | required, owner-checked |
| `GET /api/workspace/runs/:id/report` | Report via parent-run authorization | required, owner-checked |
| `GET /api/workspace/demo` | Fixed, labelled sample payload | required (see §6) |

Every handler calls `deriveOwner` first: `agentTokenError` → if error, return it unchanged (401 wrong token, 503 unconfigured token); otherwise hash the presented token with `crypto.subtle.digest("SHA-256", ...)`, take the first 16 hex characters and build `owner_<hex16>`. The raw token is **never** stored, logged, audited or returned. `deriveOwner` also calls `getDb(env)` later in each handler; a missing DB returns 503 before any read or write.

### 5.1 Run lifecycle

Strict transition map (any other pair is rejected with 409):

```
draft               -> planned | cancelled
planned             -> awaiting_approval | cancelled
awaiting_approval   -> queued | cancelled
queued              -> running | cancelled
running             -> execution_completed | failed | cancelled
execution_completed -> artifact_retrieval | failed
artifact_retrieval  -> validation | failed
validation          -> succeeded | failed
succeeded / failed / cancelled -> (terminal)
```

`execution_completed`, `artifact_retrieval` and `validation` remain **distinct, separately reachable states**. `PATCH` accepts `state` plus optional bookkeeping fields (`steps`, `artifact_refs`, `validation`, `provenance`, `error`). It is an operator bookkeeping endpoint; it does not start, poll or fabricate any execution. Transitioning to `succeeded` requires a **complete** provenance record (input sha256, workflow id + version, tool names/versions, params, timestamps, provider job refs, output hashes, artifact retrieval state, validation outcomes, report generation timestamp); otherwise the transition is rejected. At `succeeded` the run's `provenance_json` is stored and an immutable `provenance_records` row is written.

### 5.2 Input validation and caps

`readJsonBody` caps the whole body at 128 KiB. Individual fields are capped and normalized with `safeString` (name 200, description/scientific_objective 2000, filename 200, source 300, history ref 300, objective 2000, etc.). Public ids must pass `isPublicId` (and the expected prefix). `sha256` must be 64 lowercase hex. Params must be a JSON object of bounded size. Any field named like a public URL (`url`, `download_url`, `public_url`, `href`, `link`, `uri`) is rejected on dataset registration — there are no public artifact URLs.

## 6. Security / authorization model — honest scope

- This is **owner scoping on the existing single operator token, NOT multi-user accounts**. There is no signup, login, session, cookie or per-user credential. Anyone who holds `AI_AGENT_TOKEN` is the same operator; different token values derive different owner principals, which is what isolates rows in tests and in deployments that deliberately issue distinct tokens to distinct agents.
- Owner is a **non-secret derived principal** (`owner_` + 16 hex of SHA-256(token)). It cannot be reversed to the token. It is safe to store and return in DTOs; the token itself never appears in a response, audit row or error message.
- Every project/run/dataset query includes `owner = ?` in SQL. Reads and writes of another owner's rows return **404 (not found)**, not 403, so existence is not leaked. Missing or wrong token returns **401**; unconfigured token returns **503**.
- Every mutating request writes an `audit_events` row with the derived owner as actor.
- **No public artifact URLs.** Artifact references are opaque identifiers/markers stored as JSON text; this API never mints a signed URL and never exposes a file-serving endpoint.
- **No R2.** Provider/history references are references only. `storage_ref` uses a `metadata-only://` marker; the API does not claim bytes were uploaded or durably stored anywhere.
- **No fabricated execution.** Nothing here runs a tool. Catalog availability states are explicit and conservative. Reports are read from `report_runs` or 404.
- **Decision on catalog/demo auth:** these two endpoints require the operator token too, for a uniform authorization surface and to honor "every workspace API first calls requireOwner". They contain no owner-scoped rows; a browser UI must not embed the operator secret — batch 2 should keep token handling server-side. This is documented rather than left implicit.

### Known limitations

- Because there is one real operator identity, owner scoping is an isolation boundary between **tokens issued to different agents/operators**, not between human users. It is not an authorization system for public multi-tenant use.
- D1 is the only store; `fasta_text` remains the legacy inline-text path capped at 64 KiB. Workspace dataset registration deliberately stores no bytes.
- The phylo catalog entry is `partial-not-production-ready` (M7.3 evidence); no live Galaxy call is made by this API.
- Report generation for a unified run is not implemented in batch 1; the endpoint only reads existing rows.

## 7. Workflow catalog (static code data, versioned)

`functions/api/workspace/catalog.js` exports `CATALOG_VERSION` and exactly two entries:

1. `16s-rrna-identification` — availability `available-browser-and-local-agent`. Scientific purpose: profile/identify 16S rRNA sequences via the existing public request → plan → approve → BLAST → verdict/report path. Expected input: FASTA text (cap 64 KiB). Formats: `fasta`. Parameters: provider/database choices are optional and defaults are documented. Outputs: taxonomy assignments, verdict, explanation/report. Validation: FASTA syntax, sequence metrics, consensus/verdict, evidence ledger references.
2. `msa-phylogenetics` — availability `partial-not-production-ready`. Purpose: multiple-sequence alignment + tree inference. Expected input: aligned or unaligned FASTA. Formats: `fasta`. Outputs: alignment, Newick tree, validation. Validation: record counts, no dropped taxa, equal alignment lengths, DNA alphabet, parseable Newick, taxa-set equality. Note explicitly references `docs/M7_3_PHYLOGENETICS_WORKFLOW_REPORT.md`: MAFFT executed once; full multi-step remote run not verified; no live Galaxy in this milestone; `production_ready: false`.

Each entry exposes: scientific purpose, expected input, supported formats, required parameters, expected outputs, validation capabilities, and execution availability (state + production readiness + note). The catalog is code, not D1, so it cannot drift from deployed data.

## 8. Implementation plan — M7.4 phases 0–9

| Phase | Content | Batch 1 status |
|---|---|---|
| 0 | Audit architecture, auth reality, schema, existing run paths | Done (documented in §1) |
| 1 | Additive schema migration with honest owner handling | Done (`0011_workspace.sql`) |
| 2 | Extend `SQL`/`SQL_META` so the fake D1 supports new statements | Done |
| 3 | Static, versioned workflow catalog with honest availability | Done |
| 4 | Owner derivation (`deriveOwner`) on the existing token | Done |
| 5 | Project CRUD + archive/activate + owner-filtered counts | Done |
| 6 | Dataset metadata registration (no bytes, no URLs) | Done |
| 7 | Unified runs, strict lifecycle, provenance completeness, report authorization | Done |
| 8 | Demo/sample payload with explicit precomputed labels | Done |
| 9 | Worker route registration and offline tests (>30 new cases) | Done; browser UI explicitly deferred to batch 2 |

## 9. Scope exclusions

No new scientific domain; no live Galaxy calls; no new provider activation; no R2; no production deployment; no billing/teams; no login/session; no public artifact URLs; no fabricated results; no rewrite of the 16S or phylo scientific engines; no destructive migration (no `ALTER ... DROP`, no column redefinition).

## 10. Honesty rules

1. Label availability with explicit states; never imply phylo is production-ready.
2. `metadata-only://` markers mean metadata only; never imply bytes are stored.
3. Demo objects always carry `is_demo: true`, `sample: true`, `execution_mode: "precomputed"` and a `disclaimer`.
4. Reports come from persisted rows or 404; never generated on the fly from unverified data.
5. `execution_mode` is always present in responses; no handler claims a real execution it did not perform.
6. Audit and DTOs use the derived owner principal only — never the raw token.

---

## 11. Batch 2 — browser workspace

**Local mode (default).** `public/workspace.html` + `public/js/workspace.js` open with no token. Projects, dataset metadata and planned/draft run records live in `localStorage` under the labelled key `m74_workspace_local_v1` as metadata JSON only — never file bytes, never a token, never a URL. The page displays the exact banner: "Local browser session — not persisted to the server; no server-side ownership applies. For durable owner-scoped projects, operators can use the authenticated API." A **Clear local sample/session** control removes only that key.

**Operator mode (optional).** A collapsed `<details>` "Operator access" panel accepts the existing `X-Agent-Token`. The token is kept only in a module-scoped variable in page memory; it is never written to localStorage, a URL or a link, and is explicitly described as the operator identity — not a visitor login. With a token present the UI calls the real `/api/workspace/**` handlers (projects, datasets, runs, workflows, demo, run detail). Without one it uses the labelled local metadata. No login was invented.

**One catalog.** The competing implementations were rewritten as compatibility shims, not deleted: `functions/api/workspace/index.js` now aliases the authoritative `/api/workspace/workflows` catalog DTO and delegates `/api/workspace/demo` to `demo.js`, 404-ing everything else with security headers and no SQL; `providers/workspace/catalog.js` and `providers/workspace/states.js` re-export the authoritative `functions/api/workspace/catalog.js` / `_lib.js`. There is exactly one transition map (`STATE_TRANSITIONS`) and one workflow id list. The offline UI catalog mirror is drift-checked against the authoritative ids by unit tests. Authoritative availability remains `available-browser-and-local-agent` for 16S and `partial-not-production-ready` for phylogenetics.

**UI and E2E.** The page uses the existing topbar/nav, `.research-strip`, `.section-block`, `.info-card` and `.field-group` visual language; labels, `aria-live` status, keyboard focusable controls and `hidden` panels. It provides project create/list/open/edit/archive, metadata-only dataset registration (64-hex SHA-256), a two-entry scientific catalog, a real run-history table with an 11-state legend, a run detail that separates execution / artifact retrieval / validation and reports "not available" when provenance or reports do not exist, and a visibly `SAMPLE / PRECOMPUTED` demo. Launching a workflow records a planned/draft run only (local metadata or the authenticated draft-run API) and links to `ai.html?project=<id>` / `phylo.html?project=<id>`; those destination pages show a small text-only project-context note. `tests/workspace.e2e.mjs` drives the full local flow in real Chromium, asserts no console/page errors and writes `web-platform/test-results/m7_4_workspace.png`. No scientific execution is claimed anywhere.
