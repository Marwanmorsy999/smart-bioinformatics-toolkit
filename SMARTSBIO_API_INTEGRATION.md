# smarts.bio API integration — evidence-backed discovery (M7)

**Access date for every live source cited here: 2026-11-25.**
**Status: NOT PRODUCTION-ENABLED. NO WRITTEN AUTHORIZATION HAS BEEN OBTAINED.** Public API-backed access
MUST remain behind the `SMARTSBIO_ENABLED` feature flag (default `false`) **and** an explicit
authorization gate. This document records official documentation and the exact legal hazard; it does
not authorize, enable or implement any integration.

Raw captured evidence: `docs/discovery/PROVIDER_DISCOVERY_2026-11-25.md` §2.

---

## 1. Sources actually opened (all 2026-11-25)

| Source | Result |
|---|---|
| `https://api.smarts.bio/` | HTTP 404 — the bare host is not an API root. |
| `https://docs.smarts.bio/` | Transport error — not the official docs host. |
| `https://www.smarts.bio/docs` | Quick Start, auth example, `POST /v1/query`, SSE streaming example. |
| `https://www.smarts.bio/llms.txt` | Official docs index; names the OpenAPI spec and MCP endpoint. |
| `https://www.smarts.bio/openapi.json` | HTTP 200; OpenAPI 3.1, `title: smarts.bio API`, `version: 1.0.0`, 32 paths. |
| `https://www.smarts.bio/docs/authentication` | Key format, headers, scopes, workspace scoping. |
| `https://www.smarts.bio/docs/errors` | Error envelope, error codes, retry guidance. |
| `https://www.smarts.bio/docs/reference/pipelines` | Pipeline lifecycle, 12 predefined pipelines, concurrency limit. |
| `https://www.smarts.bio/terms` | Terms of Use **v1.1, last updated 4 October 2026**. |
| `https://www.smarts.bio/pricing` | Personal plan allowances; **no Team Free numbers shown**. |

No key, token or account was used; no authenticated API call was made.

## 2. The exact legal hazard — read before enabling anything

The publicly posted Terms of Use v1.1 (4 October 2026; `https://www.smarts.bio/terms`, access 2026-11-25),
Section 5 **Prohibited Uses**, includes verbatim:

- **"Resell or sublicense the Service"**
- **"Develop competing products/services"**

The same section prohibits "Reverse engineer or attempt unauthorized access", "Circumvent usage limits,
security measures, or export laws", and scraping/harvesting. Section 3 says "one person = one account"
and forbids multiple free accounts to bypass limits. Sections 2A/3A state that 6+ users from one
organization may trigger a required Master Services Agreement / Data Processing Agreement, with
institutional pricing applied retroactively from notification and possible suspension until executed.

**Why this matters to us:** this project is itself a bioinformatics analysis platform with
natural-language objective → plan → execution → reporting, and it offers overlapping capabilities
(sequence QC, phylogenetics, RNA-seq, BLAST-adjacent workflows). Operating a smarts.bio-backed execution
path that is exposed to third parties could plausibly be read as **developing/operating a competing
service** and/or **reselling or sublicensing** the Service. That is a legal risk assessment, not a legal
opinion. **No written authorization from smarts.bio has been obtained.** Therefore:

1. `SMARTSBIO_ENABLED` defaults to `false` in every environment, including staging and production.
2. Even if the flag is set, an **explicit authorization gate** must independently refuse any
   API-backed request unless an owner-recorded authorization (approver identity, written approval
   reference, granted scope, account owner, date) exists. Absent that record: fail closed.
3. No production claim, no UI affordance implying a working smarts.bio execution path, and no user
   traffic may rely on this provider.
4. If authorization is later obtained, re-read the then-current Terms and the account's actual
   agreement before flipping either control, and record the re-check date.

## 3. What IS permitted now

**Private API contract testing inside the account's permitted use is allowed.** That means: an owner's
own account, evaluation/testing only, no third-party/user data, no resale or sublicensing, no service
offered to others, no attempt to bypass limits or workspace scoping, and no secrets written to files or
logs. Such testing must remain behind the same flag + authorization gate, use a dedicated test
workspace, and record endpoint/response shapes only. It does **not** make the provider production-ready.

## 4. Officially documented API surface (all access 2026-11-25)

### 4.1 Gateway and authentication

- Base URL: `https://api.smarts.bio/v1`. OpenAPI 3.1 spec: `https://www.smarts.bio/openapi.json`.
- Key format: `sk_live_` followed by 32 characters. Send as `Authorization: Bearer sk_live_...`
  **or** `X-API-Key: sk_live_...`. Keys are created in Organization Settings → API Keys and revoked
  keys stop working within 30 seconds (cache TTL).
- Documented **scopes** (`https://www.smarts.bio/docs/authentication`):

| Scope | Documented endpoints |
|---|---|
| `query` | `POST /v1/query`, `POST /v1/query/stream` |
| `tools` | `GET /v1/tools`, `POST /v1/tools/:id/run` |
| `conversations` | `GET /v1/conversations`, `GET /v1/conversations/:id` |
| `files` | `GET /v1/files` |

`GET /v1/workspaces` is accessible with any scope. Keys may be scoped to specific workspaces or to all
workspaces in an organization; a `workspace_id` outside the allowed set yields `workspace_access_denied`.
The OpenAPI document defines security schemes `bearerApiKey` and `apiKeyHeader` and no finer-grained
OAuth scopes; the scope table above comes from the authentication docs page.

### 4.2 Documented endpoints (32 paths in the live spec)

`/catalog/tools`, `/catalog/pipelines`, `/catalog/pipelines/{id}`, `/query`, `/query/stream`,
`/query/stop`, `/tools`, `/tools/{toolId}/run`, `/pipelines`, `/pipelines/{id}`, `/files`,
`/files/upload`, `/files/upload-url`, `/files/upload-confirm`, `/files/download`, `/files/content`,
`/files/rename`, `/files/move`, `/files/folder`, `/files/metadata`, `/workspaces`, `/conversations`,
`/conversations/{id}`, `/visualizations/viewer-url`, `/visualizations/render`, `/visualizations/{job_id}`,
`/analytics/stream`, `/graph/network`, `/graph/entity/{type}/{id}`, `/reports/generate-pdf`,
`/script/stream`, `/script/resume`.

Tool and pipeline ids are **runtime-discovered** (`GET /v1/tools`, `GET /catalog/pipelines`) — none are
invented in this repository.

### 4.3 Error envelope and retries (documented)

Consistent JSON envelope: `{"status":"error","error":"<code>","message":"...","details":{}}`.
Codes: `auth_required` 401, `key_revoked` 401, `key_expired` 401, `insufficient_scope` 403,
`workspace_access_denied` 403, `rate_limit_exceeded` 429 (honour `Retry-After`), `quota_exceeded` 402,
`validation_error` 400, `agent_error` 500, `not_found` 404, `internal_error` 500.
Documented retry guidance: retry 429 after `Retry-After`; retry 500/502/503/504 with exponential
backoff; network timeouts may be retried; **do not retry 400/401/402/403** — fix the request, key,
scope or plan first. These map onto the platform's normalized error object in
`PROVIDER_INTEGRATION_ARCHITECTURE.md`.

### 4.4 Asynchronous pipelines (documented)

`POST /v1/pipelines` (tools scope) → `GET /v1/pipelines/:id` (poll every 15–30 s) → on `completed`,
download from `output_paths`. Statuses: `queued → running → completed | failed | cancelled`; `DELETE
/v1/pipelines/:id` cancels a queued/running pipeline. Also documented: `GET /v1/pipelines`,
`POST /v1/pipelines/:id/save-spec`, `POST /v1/pipelines/validate`. The docs state **"Each organization
runs at most 5 compute tasks at once"**; extra steps wait in `queued`. Twelve predefined pipelines are
listed (e.g. `alignment-wes`, `whole-genome-sequencing`, `rna-seq-analysis`, `gatk-variant-calling`,
`quality-control`, `structure-based-drug-discovery`). These are vendor-documented capabilities, not
verified runs and not an endorsement.

## 5. Quotas — exactly what is known and what is not

- **Personal plan, from `https://www.smarts.bio/pricing` (2026-11-25):** Free $0 — **2 compute hours/mo,
  1,000 API calls/mo, 10 GB storage, 1 active project**; Pro $25/mo — 20 h, 10,000 calls, 100 GB,
  10 projects; Max $100/mo — 100 h, 100,000 calls, 1 TB, unlimited projects. Team Pro minimum 3 users,
  Team Max minimum 5, Enterprise from 50; 14-day trial on Pro/Team Pro; volume discounts 10–30 % for
  edu/gov/nonprofit.
- **Team Free: UNKNOWN.** The public pricing page did not expose Team Free numbers. They **must be
  discovered from the connected account** (workspace/billing view or an authenticated, permitted usage
  query) and never assumed to equal Personal Free. No quota is asserted for the connected account.
- **Numeric rate limit: UNKNOWN.** The docs document a 429 with `Retry-After` but no fixed requests/sec.
- **Tool-level limits, output retention, and whether compute-hour accounting is per step: UNKNOWN.**

## 6. Required gating when (and only when) authorization exists

- Feature flag `SMARTSBIO_ENABLED=false` by default; setting it is necessary but **not sufficient**.
- Authorization gate record: approver identity, written approval reference, granted scope, account
  owner, date of re-check of Terms. No record ⇒ refuse, even with the flag on.
- Least-privilege keys: request only the scopes a specific step needs; separate keys per environment;
  store them only in Cloudflare secrets / the agent's secure token store; rotate on exposure. Revocation
  takes up to 30 s to propagate — plan for that.
- Workspace scoping enforced on every request; reject mismatches instead of relying on the vendor.
- Per-step consent is still required for any transmission of user data (`DATA_TRANSFER_AND_PRIVACY.md`);
  no raw sequences in prompts unless separately and explicitly consented.
- All results still pass the M6 validation/evidence gate; vendor claims ("validated tools", "full
  reproducibility") are vendor assertions, not independent audits (`COMPETITOR_ANALYSIS.md`).

## 7. Live verification (2026-11-25, authenticated private contract testing)

With the owner's key (transient, never stored in files), read-only calls and **one real instant tool run**
were made to `https://api.smarts.bio/v1`:

| Call | Result |
|---|---|
| `GET /v1/workspaces` | 200 — workspace `794218e2-7263-4e81-b612-3d5a4d8046bc`, "My Workspace", created 2026-11-24. |
| `GET /v1/tools` | 200 — `{status:"success", tools:[...]}` with **92 tools**, each with explicit parameter schemas (e.g. `bowtie2-toolkit`, `bwa-toolkit`, `hisat2-toolkit`, `alphafold-db`, `protein-structure-prediction`, `molecular-docking`). |
| `GET /v1/pipelines?workspace_id=<id>` | 200 — `{processes:[...], total:N, pagination:{...}}`. `workspace_id` is mandatory; without it the API returns 400 `workspace_id is required`. |
| `GET /v1/usage`, `GET /v1/workspaces/:id/usage` | 404 — no documented usage/quota endpoint; **Team Free allowances remain UNKNOWN** and no counters were invented. |
| `POST /v1/tools/alphafold-db/run` with `{input:{query_type:"uniprot",identifier:"P04637",format:"json",limit:1}, workspace_id:"..."}` | **200, real result**: `{"status":"success","result":{"success":true,"data":{"type":"uniprot","results":[{"uniprot_id":"P04637","gene_name":"TP53","organism":"Homo sapiens","model_identifier":"AF-P04637-F1","mean_plddt":75.06,...}]}}}`. No job id, no cost reported. |

Verified request shapes that differ from earlier assumptions:
- Tool run body key is **`input`** (singular), not `inputs`, `arguments` or flat parameters. All three
  wrong shapes returned `Validation failed: query_type parameter is required`.
- Tool list response key is `tools`, not `data`; pipeline list response key is `processes`, not `data`.

**Legal status unchanged.** These calls were private contract tests in the owner's own account, which
the terms permit. They do **not** authorize a public integration: the reselling/competing-service
restriction still applies, written authorization has NOT been obtained, and public API-backed access
remains behind `SMARTSBIO_ENABLED=false` plus the `SMARTSBIO_PUBLIC_AUTHORIZED` gate. No UI claims a
production-enabled smarts.bio path. The exposed key must be rotated and set with
`wrangler secret put SMARTSBIO_API_KEY` per environment.
