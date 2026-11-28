# Galaxy API integration — evidence-backed discovery (M7)

**Access date for every live source cited here: 2026-11-25.**
**Status: ARCHITECTURE / DISCOVERY ONLY — no Galaxy adapter is implemented, no credentials were supplied,
and no production integration is claimed.** M6 architecture (`docs/MILESTONE_M6_FINAL_REPORT.md`,
`shared/AI_PLATFORM_CONTRACT.md`) is unchanged. Galaxy is the target **primary scientific execution**
provider; it is not yet wired into the platform.

Raw captured evidence: `docs/discovery/PROVIDER_DISCOVERY_2026-11-25.md` §1.

---

## 1. What was actually verified

| Item | Observation | Source | Access date |
|---|---|---|---|
| Instance version | `{"version_major":"26.1","version_minor":"3.dev0"}` | `https://usegalaxy.eu/api/version` | 2026-11-25 |
| OpenAPI document | `title: Galaxy API`, `version: 26.1.3.dev0`, **465 paths** | `https://usegalaxy.eu/openapi.json` (spec URL discovered from `https://usegalaxy.eu/api/docs`) | 2026-11-25 |
| Tool panel | 4,686 tool objects flattened client-side; exact versioned tool ids listed in `VERIFIED_TOOL_CATALOG.md` | `https://usegalaxy.eu/api/tools` | 2026-11-25 |
| Interactive docs | Swagger UI and ReDoc both return HTTP 200 | `https://usegalaxy.eu/api/docs`, `https://usegalaxy.eu/api/redoc` | 2026-11-25 |
| Non-existent spec URLs | `/api/openapi.json`, `/api/schema.json`, `/api/swagger.json` all HTTP 404 | same hosts | 2026-11-25 |

**Search parameter warning (verified):** `GET /api/tools?search=fastqc` returned 103 sections / 4,462
tools — effectively the entire panel, not a filtered result. Do **not** rely on server-side `search=`.
Fetch the panel once, cache it with a TTL, and filter client-side on `id` / `name` / `description` /
EDAM terms. Pin the **exact versioned tool id** from `id`; never construct an id from a tool name.

## 2. Authentication and account model

- Verified documented paths: `GET /api/authenticate/baseauth` ("Returns an API key for authenticated
  user based on BaseAuth headers"), and `GET|POST|DELETE /api/users/{user_id}/api_key` (get, create,
  revoke a key). Sources: live OpenAPI spec, access 2026-11-25. Prior-session official guidance
  (`docs/discovery/RESEARCH_compute_infra.md` §4.2, access 2026-11-24) places key creation at
  **User → Preferences → Manage API Key** and states a key "acts as an alternate means to access your
  account, and should be treated with the same care as your login password".
- An API key is an **account credential**. Store it only as a Cloudflare Worker secret or the local
  agent's secure token file. Never place it in browser code, a plan/result object, a repository file, a
  URL, or a log. Key rotation = revoke via `DELETE /api/users/{user_id}/api_key` and issue a new one.
- **Platform-owned vs per-user accounts:** a platform-owned key gives one shared quota and entangles
  users' data in one history namespace; a per-user key preserves separation but requires each user to
  supply their own credential. The choice is an owner/operator decision. Until decided, **no Galaxy
  submission is enabled**. The control plane must never fall back to a platform-owned key for a user
  who has not consented.

## 3. Quota discovery — use ACTUAL values, never invented credits

Galaxy exposes real quota and storage telemetry. Verified from the live OpenAPI spec (2026-11-25):

| Need | Endpoint | Verified summary |
|---|---|---|
| Active quotas | `GET /api/quotas` | "Displays a list with information of quotas that are currently active." |
| Usage by source | `GET /api/users/{user_id}/usage` | "Return the user's quota usage summary broken down by quota source" |
| Usage by object store | `GET /api/users/{user_id}/objectstore_usage` | "Return the user's object store usage summary broken down by object store ID" |
| Storage summaries | `GET /api/storage/histories`, `GET /api/storage/datasets` (+ discarded/archived summaries) | present in spec |

**Rule:** the governor reads these endpoints for the connected account and uses the returned bytes,
remaining quota and observed concurrency. **No "Galaxy credits" are defined — none may be invented.**
Exact usegalaxy.eu account quota is UNKNOWN until a credentialed account is queried. Prior-session
evidence (access 2026-11-24, `docs/discovery/RESEARCH_compute_infra.md` §4.1) documents usegalaxy.org
**250 GB registered / 5 GB unregistered** storage and **6 / 1 concurrent jobs**, tagged **[V-S]**
snippet-only in `docs/EVIDENCE_LEDGER.md` for one source; these are **usegalaxy.org** figures and must
not be silently applied to usegalaxy.eu or treated as the connected account's entitlement.

## 4. History creation and uploads

Verified from live OpenAPI spec (2026-11-25):

- `GET /api/histories` — list histories of current user. `POST /api/histories` — **"Creates a new history."**
- `GET /api/histories/{history_id}/contents` and `/contents/{type}s` — list contents; `POST` on both —
  "Create a new `HDA` or `HDCA` in the given History"; `PUT /api/histories/{history_id}/contents` —
  batch update.
- `GET /api/histories/{history_id}/contents/{id}/provenance` — dataset provenance.
- `POST /api/upload/resumable_upload` — documented resumable upload path (full request schema NOT verified).
- The panel contains `upload1` ("Upload File", `1.1.7`, `has_parameters:false`) and source tools such as
  `ncbi_acc_download`, `uniprotxml_downloader`, ENA/SRA retrievers.

**Target flow:** create one dedicated history per platform run (or per user project), tag it with the
run id, upload only consented input bytes via the documented content-create or resumable endpoint, and
record dataset ids in the transfer ledger (`DATA_TRANSFER_AND_PRIVACY.md`). Do not reuse an unrelated
user history. Verify the server-side byte count and hash against the ledger before submitting a job.

## 5. Tool execution and workflow invocation

- **Single tool:** `POST /api/tools` exists in the live spec (2026-11-25) with `GET` and `POST`; the
  spec's human-readable summary is empty, so the **exact request schema is NOT VERIFIED**. The standard
  Galaxy shape is `{history_id, tool_id, inputs, parameters}`; confirm it against an authenticated
  instance or the instance docs before coding. Use the exact versioned `id` from the panel.
- **Input/output schemas:** unauthenticated `GET /api/tools/{id}` and `GET /api/tools/{tool_id}/inputs`
  both returned only panel metadata (no `inputs`/`outputs`/parameters) on 2026-11-25. Therefore all
  tool input types, output types and parameter names in `VERIFIED_TOOL_CATALOG.md` are explicitly
  marked **NOT VERIFIED**. They must be read from an authenticated tool config at adapter build time.
- **Workflow:** import/list/download via `GET|POST /api/workflows`, `/api/workflows/upload`,
  `/api/workflows/{workflow_id}/download`; invoke via
  **`POST /api/workflows/{workflow_id}/invocations`** — "Schedule the workflow specified by
  `workflow_id` to run." Track `GET /api/invocations`, `GET /api/invocations/{invocation_id}`, and cancel
  with **`DELETE /api/invocations/{invocation_id}`** — "Cancel the specified workflow invocation."
- Only tools that are `is_workflow_compatible: true` (verified for every primary tool in the catalog)
  are eligible for workflow invocation.

## 6. Job monitoring, cancellation, output discovery and download

All paths below are present in the live OpenAPI spec (2026-11-25):

- Monitor: `GET /api/jobs`, `GET /api/jobs/{job_id}` ("Return dictionary containing description of job
  data"), `GET /api/jobs/{job_id}/metrics`, `/inputs`, `/outputs`, `/parameters_display`,
  `/common_problems`, `/stdout`, `/stderr`.
- Cancel: **`DELETE /api/jobs/{job_id}`** — "Cancels specified job". `/api/jobs/{job_id}/cancel` was
  verified **absent** from the spec; do not implement it. Invocation cancellation is the DELETE above.
- Error detail: `POST /api/jobs/{job_id}/error` is a **bug-report submission**, not a status read; read
  failures from the job object and stdout/stderr instead.
- Output discovery: `GET /api/histories/{history_id}/contents`, `GET /api/histories/{history_id}/contents/{id}`,
  `GET /api/jobs/{job_id}/outputs`, `GET /api/datasets/{dataset_id}/get_content_as_text` and `/display`.
- Download/hash: `GET /api/datasets/{dataset_id}/content/{content_type}`;
  `GET /api/datasets/{dataset_id}/hash` does **not** exist — the verified method is
  `PUT /api/datasets/{dataset_id}/hash` ("Compute dataset hash for dataset and update model"). Read the
  hash from dataset metadata or compute SHA-256 on the downloaded bytes locally; never trust a
  client-supplied hash.
- Poll with bounded backoff, a hard timeout, and a terminal-state check; mirror the M6 bounded-poll
  pattern (`docs/MILESTONE_M6_FINAL_REPORT.md` §2) rather than waiting indefinitely.

## 7. Error normalization and retries

Normalize every provider response into one platform error object before it reaches the planner:

```
{ provider: "galaxy", code: <stable string>, message: <safe text>, retryable: boolean,
  retry_after_seconds: number|null, provider_status: number|null, job_id: string|null }
```

Rules:

1. **Idempotent reads** (history list, job status, dataset content) may be retried on 429/5xx/network
   timeout with exponential backoff and jitter, honouring any `Retry-After` header.
2. **Submissions are not blindly retried.** Attach a deterministic idempotency/run key to the job's
   provenance; on timeout, query `GET /api/jobs` / history contents first to see whether the job was
   created, and only then decide. Never create duplicate jobs from a retry.
3. Normalize Galaxy terminal states into the platform's `succeeded | failed` job vocabulary; preserve
   the raw state string in `logs` for provenance. A failed job may still produce a report-only result
   (M6 §4 rule), never a success claim.
4. **Rate limiting is a ToS obligation, not a performance tweak.** Prior-session official evidence
   (access 2026-11-24, `docs/discovery/RESEARCH_compute_infra.md` §4.1) records published quotas, a ban on
   subverting them with multiple accounts, and the 2026 usegalaxy.eu Terms calling out abuse
   "increasingly enabled by 'AI' tooling", with automated temporary suspension on abuse detection.
   Cap automated submissions per run and globally; do not flood the public server. For high volume use
   a self-hosted Galaxy or the local agent.
5. Public Galaxy Terms prohibit PII/HIPAA/FISMA data (prior-session verification, 2026-11-24). No user
   data may be uploaded without explicit per-step consent (`DATA_TRANSFER_AND_PRIVACY.md`).

## 8. Live verification (2026-11-25, authenticated, read-only + one blocked execution)

With the owner's API key (supplied transiently in chat, **not** stored in any file) these calls were made
to `https://usegalaxy.eu`:

| Call | Result |
|---|---|
| `GET /api/users/current` | 200 — account `marawan20` |
| `GET /api/users/current/usage` | 200 — primary quota `268435456000` bytes (268.4 GB), 0 used, 0%; scratch quota `2199023255552` bytes (2.2 TB), 0 used, 0%. **Real quota data for the governor.** |
| `POST /api/histories` | 200 — created history `11ac94870d0bb33a23074b25a9ed0bfe`, "M7 verification 2026-11-25" |
| `POST /api/upload` (multipart) | **404 — no such endpoint on this instance.** Use `POST /api/tools` with the generic `upload1` tool instead. |
| `POST /api/tools` (`tool_id=upload1`, tiny FASTA) | **403 — `{"error":"Action requires account activation."}`.** Authentication works but execution is blocked until the owner activates the account. |

Consequences:
- No Galaxy job executed; no output artifact was produced; no equivalence claim is made.
- The adapter's upload path was corrected to `POST /api/tools` + `upload1`. `upload1` is Galaxy's generic
  upload tool, not a scientific tool id; capability discovery remains fully dynamic.
- Governor totals may be configured from the **actual** values above via `POST /api/providers/budget`
  (e.g. `{"totals":{"galaxy":{"bytes":268435456000}},"source":"GET /api/users/current/usage, 2026-11-25"}`).
  No concurrency/jobs-remaining quota is published by this endpoint, so `jobs` totals stay `null`.
- The exposed key must be rotated and set with `wrangler secret put GALAXY_API_KEY` per environment.

Tool equivalence is **not** claimed: a Galaxy MAFFT/IQ-TREE run is not asserted to be equivalent to the
existing deterministic phylogenetics plugin without comparative validation (M6 §4, §11).
