# Dataset transport and data-flow controls

**Status:** Current implementation, verified against source on 2026-11-24.
**Companion:** `SYSTEM_ARCHITECTURE.md` §10, `AI_AGENT_ARCHITECTURE.md`, `COMPUTE_INFRASTRUCTURE.md`, `THREAT_MODEL.md`, `PRIVACY_NOTE.md`.
**Scope:** every path by which sequence/dataset bytes can move between the browser, the Worker control plane, the local execution agent, storage and external scientific APIs.

> **No silent upload of local datasets to Cloudflare R2.** This is true by construction today: no R2 binding exists in `web-platform/wrangler.toml` (only `BLAST_DB`, a D1 binding), and no `functions/**` module references an R2 bucket. Uploaded FASTA text is stored inline in D1 under a `d1://datasets/...` reference; generated artifacts and reports are stored inline in D1 as well. R2 is a **future storage tier**, not an implemented path.

## 1. The four distinct transport domains

### 1.1 Browser-local data — never uploaded by default

The existing analysis pages read FASTA/TSV files with the browser File API into in-memory strings (`web-platform/public/js/blast-app.js`, `taxonomy-app.js`, `fasta.js`). Validation, statistics, BLAST-TSV parsing, taxonomy and verdicts run **in the browser** with plain ES modules; there is no `fetch`, WebSocket or beacon call in those modules. Nothing leaves the device unless the user explicitly starts a workflow that calls a Worker endpoint (AI request submission, or the legacy consent-gated BLAST submit described in §4).

- Trigger: user selects a file or pastes text; a tool button starts local analysis.
- Default: **no network transmission of the dataset**.

### 1.2 Cloud-stored artifacts — D1 today, R2 only on the roadmap

There is no object-storage upload in the current code path:

- An AI request stores the FASTA text directly in the D1 `datasets` row with `storage_ref = d1://datasets/<id>` (`web-platform/functions/api/ai/requests/index.js:74`, `SQL.insertDataset` in `functions/api/ai/_lib.js`).
- Agent result submission verifies each artifact's SHA-256, then stores `artifact.content` inline in the D1 `artifacts` row with `storage_ref = d1://artifacts/<job>/<name>` (`web-platform/functions/api/ai/jobs/[id]/result.js:68-78` for validation and `:119-132` for persistence).
- The generated HTML report is stored inline in D1 via `SQL.insertReportRun` (`report_html` column) at `result.js:161-170`; provenance, validation and explanation are likewise D1 rows (`result.js:134-181`).
- Artifacts are written **after** hash validation and schema validation (`validateResultShape`), never from a raw local file upload.

R2 appears only as a planned storage tier (`SYSTEM_ARCHITECTURE.md` storage box; no binding or code). If R2 is introduced later, moving an artifact there must remain an explicit, consented, recorded action — never a silent side effect of reading a local file.

### 1.3 Local execution — inline inputs, 64 KiB cap, isolated workspace

The agent does not receive an inbound connection. It polls `GET /api/ai/jobs` with `X-Agent-Token`; the Worker returns queued jobs whose `inputs_json` contains the dataset id, filename and `fasta_text` (see `toJobDto` in `functions/api/ai/_lib.js` and `handlePollJobs` in `functions/api/ai/jobs/index.js`). The bytes travel **inline** through the Worker: browser → Worker (`POST /api/ai/requests`) → D1 job row → authenticated agent poll.

- Cap: `MAX_FASTA_BYTES = 64 * 1024` (`functions/api/ai/_lib.js:11`), enforced with `TextEncoder` byte measurement in `validateRequestPayload`. The legacy BLAST submit endpoint has a separate 64 KiB request-body cap (`functions/api/blast/submit.js:21`).
- Workspace: the Python agent stages each job in `tempfile.TemporaryDirectory(prefix="smartbio-aiagent-")` (`python-engine/src/smartbio/aiagent/agent.py:138`) and cleans it up after the job.
- Results return inline: agent → `POST /api/ai/jobs/:id/result` → Worker validation → D1 rows (§1.2). Result body is capped at 2 MiB (`MAX_RESULT_BODY_CHARS`).

**Why heavy compute stays out of Workers:** Workers are an orchestration/control plane with tight CPU and memory limits and per-request wall-clock budgets; BLAST, aligners and taxonomy analyses need local binaries/DBs and long runtimes. The 64 KiB inline cap keeps job payloads cheap and bounded; large data stays on the user's machine or in a local workspace. The Worker validates, plans, stores, serves and audits — it never runs a scientific algorithm over large data.

### 1.4 External scientific API transmission — consented steps only

The only implemented external sequence transmission is the legacy NCBI BLAST URL API `CMD=Put` (`functions/api/blast/submit.js`, `buildPutParams` in `functions/api/blast/_lib.js`). It is now gated by a single-use consent token (§4). The Worker adds `tool`/`email` identification from env when configured (`withIdentification` in `blast/_lib.js`); exact bytes are identified by the SHA-256 `input_hash` bound to the token and stored in `blast_requests`/`blast_consents` and in an `ai_blast_consent_issued` audit event. The FASTA is never logged and never placed in a URL by status/results calls.

`GET /api/blast/status/:rid` and `GET /api/blast/results/:rid` call NCBI with `CMD=Get&RID=...` only (`buildStatusParams`, `buildResultsParams`); they carry **no sequence**, use the RID as the sole identifier, and are not consent-gated (no user bytes are transmitted). This is confirmed in `functions/api/blast/status/[rid].js` and `results/[rid].js` and asserted by `tests/blast_lib.test.mjs`.

Other services in `docs/API_CATALOG.md` are CATALOG-ONLY; no browser or Worker code transmits datasets to them. `docs/API_INTEGRATION_ROADMAP.md` records the remaining gaps (RID TTL, global rate limit, tool/email identification, ledger disagreement).

## 2. Transport matrix

| Path | What moves | Trigger | Consent requirement | Validation | Provenance | Storage |
|---|---|---|---|---|---|---|
| Browser-local file → in-memory text | Local FASTA/TSV bytes | File input or paste; local "Analyze" button | None — stays on device | Client-side format/alphabet/size checks | None needed (not transmitted) | Memory only |
| Browser → Worker `POST /api/ai/requests` | FASTA text (≤64 KiB), question text | User submits an AI request | No external egress at this step | `validateRequestPayload`, `validateFasta`, byte cap | `ai_requests` row + dataset SHA-256 | D1 `datasets.fasta_text`, `d1://datasets/<id>` |
| Worker → D1 job row → agent poll | Dataset id, filename, `fasta_text` (≤64 KiB) inline | Agent authenticated poll of `GET /api/ai/jobs` | Plan approval required to create the job; consent for egress steps | Job/plan schema checks, agent token | `jobs.inputs_json`, audit `ai_job_created` | D1 `jobs` row; agent temp workspace copy |
| Agent → Worker `POST /api/ai/jobs/:id/result` | Artifacts, provenance, validation, explanation, logs (≤2 MiB) | Agent completes a job | No external data at this hop | `validateResultShape` + SHA-256 hash check per artifact | `tool_runs`, `artifacts`, provenance JSON | D1 rows; no R2 |
| Worker → NCBI `CMD=Put` | Validated FASTA bytes identified by `input_hash` | Explicit consented submit with a valid token | **Required**: single-use `consent_token` (§4) | FASTA/database/program validation + token hash/db/program match | `blast_consents` row + `ai_blast_consent_issued` audit + `blast_requests.input_hash` | D1 RID row; RID/results cached in D1 |
| Worker → NCBI `CMD=Get` (status/results) | RID only; **no sequence** | Polling an existing RID | Not applicable (no user bytes leave) | RID syntax check; one poll/minute/RID | `last_checked_at`, cached `result_tsv` | D1 `blast_requests` row |
| Worker → R2 | Nothing today | **None — not implemented** | Would require explicit consent when introduced | N/A | N/A | Roadmap only |

## 3. Consent and provenance invariants

1. No external sequence transmission without a recorded approval and a token whose `input_hash`, `database` and `program` match the submitted bytes and target.
2. Tokens are short-lived (15 minutes by default) and single-use. They are claimed atomically **before** any egress; a failed NCBI submission leaves the token burned, so one consent can never authorize two transmissions (including under concurrent requests).
3. The consent gate is enforced inside the endpoint; calling `/api/blast/submit` directly cannot bypass it, including in mock mode.
4. The exact bytes are identified by SHA-256 in the consent row and BLAST request row; the full sequence is never written to audit or logs.
5. D1 artifacts are hash-verified before storage; report HTML is assembled only from validated fields.

## 4. Legacy BLAST consent gate (M4 remediation)

- Migration `web-platform/migrations/0003_blast_consent.sql` adds a `blast_consents` table (`token`, `input_hash`, `database`, `program`, `granted`, `expires_at`, `created_at`, `used_at`). It is additive; no existing table is changed.
- `issueBlastConsent(db, { inputHash, database, program, granted, ttlSeconds, now })` (`functions/api/blast/_lib.js`) issues a random `consent_<32 hex>` token.
- `resolveBlastConsent(...)` rejects with typed 403 codes `consent_missing`, `consent_invalid`, `consent_not_granted`, `consent_used`, `consent_expired`, `consent_mismatch`, `consent_unavailable`.
- `consumeBlastConsent(...)` performs one conditional `UPDATE ... WHERE used_at IS NULL AND granted = 1 AND expires_at > now AND input_hash/database/program = ?` and succeeds only when exactly one row changes. It runs **before** the NCBI call; a failed submit burns the token rather than restoring it.
- `POST /api/ai/plans/:id/approve` mints a token when an approved step has `external_egress === true` and `consent_granted === true`, and returns it in `blast_consent` so the browser/legacy flow can call `/api/blast/submit` without re-uploading or re-consenting. Denied egress never issues a token.
- Mock mode (`MOCK_NCBI=1`) applies the same gate; it never contacts NCBI, but token validation is identical for testability.
- Deployment note: migration 0003 must be applied before approving any external-egress step; otherwise approval fails closed with 500.

---

## 5. Storage boundaries, limits and retention (M6.3)

### 5.1 The five domains, explicitly separated

| Domain | Owner | Lifetime | May contain sequence bytes? | Notes |
|---|---|---|---|---|
| **Browser-local data** | Browser memory / File API | Until the tab closes | Yes, in memory only | Never uploaded by default; lightweight validation/statistics run here. |
| **Local agent workspace data** | Local machine, `tempfile.TemporaryDirectory` | Single job; deleted when the job ends | Yes | Staged inputs and intermediate files; never sent to R2. |
| **Cloudflare D1 metadata** | Worker control plane | Retained per policy (§5.4) | **Limited**: FASTA text ≤64 KiB and inline artifacts ≤2 MiB only | D1 is a metadata/control store, **not** a general-purpose biological file store. |
| **Artifact storage** | Content-addressed by SHA-256 | Same as the parent run | Yes, for small validated artifacts | Today: inline D1 rows with hash verification. Large artifacts stay local; R2 is a future tier requiring a binding and explicit configuration. |
| **External scientific services** | Third party | Governed by their terms | Only with consent | Only NCBI `CMD=Put` is implemented; destination, byte count and consent are recorded in the locality receipt (FR-8.5). |

### 5.2 Integrity and size controls

- Every uploaded dataset is hashed with SHA-256 (`datasets.sha256`); the same hash is carried into the job, provenance and result.
- Every artifact hash is recomputed by the Worker before storage (`jobs/[id]/result.js`) and again by `validate()` (`sha256_consistency`). A mismatch is a 400, never a stored result.
- Input text cap: **64 KiB** (`MAX_TEXT_BYTES` / `MAX_FASTA_BYTES`). Result body cap: **2 MiB** (`MAX_RESULT_BODY_CHARS`). Oversize input is rejected before planning; oversize results are rejected before storage.
- The agent stages inputs in a temporary directory with a sanitized basename and removes the whole directory after the job (`tempfile.TemporaryDirectory`). No path traversal is possible via artifact names (`safe_filename`).
- Upload validation: FASTA header-first, IUPAC alphabet, non-empty records, byte-cap. Download validation: artifact `sha256` must match content before a report link is rendered.

### 5.3 D1 is not a file store

D1 rows hold control metadata and **small** validated payloads only. The 64 KiB input cap and 2 MiB result cap bound the total. Large FASTA/FASTQ/BAM files are expected to stay in the browser or the local agent workspace; a future R2 tier must be introduced explicitly (new binding, consent record, tested migration) and must never be a side effect of reading a local file. No code path currently writes an R2 object.

### 5.4 Retention and deletion rules (current policy)

| Data | Retention | Deletion rule |
|---|---|---|
| D1 datasets, jobs, artifacts, reports | Until the project/run is deleted by an operator | `DELETE` cascades by `job_id`/`plan_id`; no automatic expiry yet — documented as a gap for M7 |
| Local agent workspace | Job duration | Removed by `TemporaryDirectory` on success, failure or exception |
| External NCBI RID/results | Provider-side, short-lived | Cached RID/TSV in D1; RID TTL is not handled yet (documented gap) |
| Audit events / consent records | Append-only | Never deleted by application code |

Adding automatic retention/expiry and a user-facing deletion flow is an M7 item; until then, operators must delete D1 rows explicitly and the UI must not imply automatic deletion.

### 5.5 External transmission remains consent-gated

Nothing in this section changes the consent invariant of §3/§4: a sequence leaves the machine only through a consented `CMD=Put` step with a single-use token. Browser-local and local-agent steps produce `external_transmissions: []` in the locality receipt.
