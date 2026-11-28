# Privacy & data-flow — M7.8 (16S / NCBI BLASTN)

**Status:** current-state verification, added M7.8. **No production change.**
**Scope:** the 16S identification flow on `web-platform/public/16s.html`
(`public/js/16s-flow.js`) and the Worker endpoints it calls. This document
**corrects** earlier public wording and any prior doc claiming "no sequence is
transmitted until you explicitly approve and submit" / "nothing is transmitted
until you press Submit" and claiming no sequence is stored. It does **not** erase
history; earlier reports (e.g. `docs/DATA_TRANSPORT.md`, `docs/PRIVACY_NOTE.md`,
`docs/THREAT_MODEL.md`, `docs/evidence/M7_6_NCBI_DIAGNOSIS.md`, `docs/evidence/*`)
are preserved unchanged; where a current-state sentence contradicted the verified
behaviour below it has been corrected in place with an M7.8 note.

## 1. Two axes are not the same (the corrected wording)

Previously a single sentence conflated "not sent to NCBI" with "not sent to the
platform". The accurate model has **two separate axes**:

> **Browser validation is local. When you create a request, your FASTA is sent to
> Smart Bioinformatics AI and stored in D1 for that request. It is not sent to
> NCBI until you review and approve the plan and explicitly submit using the
> single-use consent.**

- **Axis 1 — browser → this platform.** Local validation, statistics, parsing and
  previews are browser-only. But **creating a request (`POST /api/ai/requests`)
  sends your FASTA to Smart Bioinformatics AI.** Your FASTA is then stored in D1
  for that request. This happens *before* approval.
- **Axis 2 — platform → external NCBI.** **Nothing is sent to NCBI before you
  review and approve the plan AND explicitly submit using the single-use
  consent.** Approval alone does not contact NCBI; `POST /api/ai/plans/:id/approve`
  has no external egress and only mints a token. External transmission to NCBI
  occurs only at `POST /api/blast/submit` after a valid single-use token is
  claimed. **Nothing else is sent to any external service.**

So "no sequence is transmitted until you explicitly approve and submit" was
wrong on Axis 1 (FASTA reaches the platform at request creation) and imprecise
on Axis 2 (transmission to NCBI requires both approval *and* explicit submit
*and* a single-use consent). The corrected public wording is on `16s.html`.

## 2. What is sent to this platform

`POST /api/ai/requests` receives, in the JSON body:

- `fasta` — your FASTA text (validated server-side; ≤64 KiB; nucleotide IUPAC;
  also re-validated by `validateFasta`); not contacted with NCBI here.
- `text` — a short question/objective (≤4000 chars); used only by the
  deterministic planner to pick from a **fixed allowlisted intent**; it cannot
  choose a tool or a database.
- `filename` (optional, sanitized), `project_id` (optional).
- The Worker **does not accept a client `execution_mode` or `mock` flag**;
  execution mode is server-side only (see §5).

Browser-only steps before this (reading a file into the text box, local FASTA
validation, local SHA-256, statistics, previews, placeholder text) make **no
network call**. (The placeholder grey example is not a value; no sequence is
loaded until you paste one or select a file.)

## 3. What is stored (and what is not)

**Storage is inline in Cloudflare D1. No durable object-storage byte storage.**

On `POST /api/ai/requests`, in D1:

- `datasets.fasta_text` — **FASTA bytes stored inline** (not R2). Also:
  `datasets.sha256` (SHA-256 of FASTA), `datasets.size_bytes`, `datasets.mime`
  (`text/plain`), `datasets.filename`, `datasets.storage_ref`
  (`d1://datasets/<id>`), `datasets.created_at`. (M7.4 adds optional provenance
  columns; the MVP request flow writes the M6 fields.)
- `ai_requests` — `raw_text` (**first 4000 chars** of your objective), inferred
  intent, confidence, timestamps, `dataset_id`. Not the FASTA.
- `plans.plan_json` — the deterministic plan (intent, step, fixed
  database/program, egress/consent flags, limitations). No sequence.
- On approval: `jobs` rows (`inputs_json` includes `fasta_text`, filename,
  dataset id, egress/consent flags), `approvals`, and a `blast_consents` row
  (token, `input_hash`, `database`, `program`, `granted`, `expires_at`,
  `used_at`). The token value is returned to the caller once; it is **not**
  displayed in the UI and **not** sent to NCBI.
- `blast_requests` — `rid`, `status`, `created_at`, `last_checked_at`,
  `input_hash`, `result_tsv`. **No sequence column.** `result_tsv` is the
  retrieved NCBI results table (cached for the requesting RID), not raw input.
- `audit_events` — append-only; `ai_request_created`, `ai_step_*`,
  `ai_job_created`, `ai_blast_consent_issued`, `blast_egress`. **No sequence in
  any audit event.** BLAST egress audit records `input_hash`, target, byte
  counts, database, program, mock/transmitted flags, success/status, `rid`,
  `rtoe`, truncated safe provider error — **never the sequence**, **never the
  consent token**, **never secrets**. The outgoing NCBI URL (which contains
  FASTA on `CMD=Put`) is **never logged**.
- **Provenance** records and **retrieved result table** (`result_tsv` /
  artifacts) are kept in D1. Research-use warning retained.

**Not short-lived:** stored FASTA and records are not described as short-lived.
**Only the consent token is short-lived** (single-use, ~15-minute TTL) and
**only external-transmission authorization is single-use**, not data storage.

**Retention & deletion:** **no retention period is documented, and no
user-facing deletion mechanism is implemented.** No dataset/FASTA deletion route
exists in this change. (`docs/DATA_TRANSPORT.md` §5.4 records append-only audit
and operator-driven deletion as a gap.) Do not submit sequences you are not
authorised to transmit.

**R2:** **no durable R2 byte storage.** R2 is not bound or used in this path;
this flow writes nothing to object storage. No silent upload to R2.

## 4. What goes to NCBI, and when

External transmission to **NCBI BLAST** (`https://blast.ncbi.nlm.nih.gov/Blast.cgi`)
occurs **only** after: explicit approval (`approved` + `consent_granted`),
a valid single-use consent token, **and** explicit submit
(`POST /api/blast/submit`). Sequence is never sent before approval + submission.

**What is sent to NCBI on submission (`CMD=Put`):** only the **approved FASTA**
(`QUERY`, exact approved bytes) plus **approved parameters**:

- `DATABASE=rRNA_typestrains/16S_ribosomal_RNA` — **corrected database**;
  the bare legacy name `16S_ribosomal_RNA` is **not** valid on the provider and
  is rejected. `ALLOWED_DATABASE = "rRNA_typestrains/16S_ribosomal_RNA"`.
- `PROGRAM=blastn`.
- `CMD=Put`; plus fixed `MEGABLAST=on`, `EXPECT=1e-10`, `HITLIST_SIZE=50`,
  `FILTER=F`, `FORMAT_TYPE=Text`; plus optional `tool`/`email` NCBI
  identification read from server env `NCBI_TOOL`/`NCBI_EMAIL` (not secrets;
  never committed/logged). Not from client input.
- `database` and `program` are re-validated server-side; a client cannot widen
  them; the consent token is bound to `inputHash`+`database`+`program`.

**Not sent to NCBI:** no unrelated data, no project files, no secrets, no API
keys, **no consent token** (it is consumed locally, never forwarded), no
`execution_mode`/`mock`, no other client fields. `QUERY` is sent via HTTP **GET**
(`ncbiFetchText`, method `GET`, `User-Agent: smart-bioinformatics-toolkit`;
no auth header). The full outgoing NCBI URL **is never logged** because a
`CMD=Put` URL contains FASTA. No secrets are placed in the URL.

**Status / results (`CMD=Get`):** `GET ...CMD=Get&RID=...` for status, and
`CMD=Get&RID=...&FORMAT_TYPE=Text&ALIGNMENT_VIEW=Tabular` for results; **only
the RID** is sent; **no sequence**; not consent-gated. GET-only, bounded
retry/backoff for 429/5xx/network, `NCBI_FETCH_TIMEOUT_MS`.

**Nothing else is sent to external services.** No other external egress in this
flow.

## 5. Execution mode & provider are server-side only

- **AI execution mode:** `execution_mode` returned is `envExecutionMode(env)` =
  `AI_EXECUTION_MODE === "mock" ? "mock" : "real"`. **A client cannot set it.**
- **BLAST real/mock:** `isMock(env)` reads server `MOCK_NCBI` (and process env);
  **a client cannot force mock or real** via `execution_mode`/`mock`/`MOCK_NCBI`
  in the request body. Mock mode still applies the same consent gate; mock never
  contacts NCBI; mock results are labelled **synthetic**, never a real NCBI
  result. **No provider change** in M7.8; **no scientific change**.
- **No migration**, no new endpoint, no second pipeline in M7.8.

## 6. Status correctness (P2) — official vs legacy, canonical, rate limits

Verified in `functions/api/blast/_lib.js` (`parseQBlastStatus`,
`reconcileStatusEvidence`, `QBLAST_STATES`, `QBLAST_TERMINAL_STATES`) and
`docs/evidence/M7_6_NCBI_DIAGNOSIS.md`.

**Official vs legacy SearchInfo.** Official NCBI QBlastInfo status values are
`READY`, `RUNNING`, `WAITING`, `QUEUED`, `FAILED`, `UNKNOWN`. `ThereAreHits`
(`yes`/`no`) is separate from `Status`. **`FORMAT_OBJECT=SearchInfo` is NOT in
NCBI's official documented parameter list** (it is a real re-check query used by
the NCBI form, but undocumented). The legacy app-level `Status=Searching`
table / page title / hidden fields are **not** authoritative. Only
`QBlastInfoBegin … QBlastInfoEnd` blocks are authoritative; every `Status=`
across blocks is collected so contradictory blocks cannot hide; a canonical
error page always wins.

**Official-vs-legacy SearchInfo modes.** `parseQBlastStatus(text, { mode })`
supports `mode="canonical"` (production default; canonical `CMD=Get` body) and
`mode="SearchInfo"` (a `FORMAT_OBJECT=SearchInfo` body carrying its own valid
QBlastInfo evidence; auto-detected when clearly a SearchInfo page and no
canonical error page). `mode` never loosens a safeguard. **Only canonical
`CMD=Get` unlocks results; production checks only NCBI's canonical status for
the RID.**

**Runtime canonical + no live SearchInfo fetch.** **Production queries the
canonical `CMD=Get` endpoint only; it does NOT live-fetch `FORMAT_OBJECT=SearchInfo`
at runtime.** `reconcileStatusEvidence(a, b)` is a **tested helper** that
reconciles two already-obtained structured snapshots; it does not fetch
anything. `FORMAT_OBJECT=SearchInfo` not being in the official documented list
does not matter because production does not rely on it.

**`status_conflict`.** When structured status evidence disagrees (contradictory
`Status=` values in one body; conflicting statuses across two snapshots; an
error page carrying an unrelated `READY`; etc.) the typed terminal state is
**`status_conflict`**, never queued / no-hit / success. Monitoring stops; **no
scientific result is shown until the platform retrieves and validates a real
results file.** Keep **technical `status_conflict` in the API** and a concise
`<details>` area; **ordinary copy uses researcher wording** (not enum-exposing):

> **NCBI may occasionally return inconsistent status information. When this
> happens, monitoring stops and the request is held for verification. No
> scientific result is shown until the platform retrieves and validates a real
> results file.**

**A canonical `FAILED` is not a conflict.** Production queries canonical only; a
canonical `FAILED` returns `failed` / `provider_database_error` (provider error
preserved, not fabricated, **not** escalated to `status_conflict`). The
historical canonical `Status=FAILED` + `Error: No alias or index file found`
for the **bare `16S_ribosomal_RNA`** database is recorded in
`docs/evidence/M7_6_NCBI_DIAGNOSIS.md`; M7.8 uses the **corrected**
`rRNA_typestrains/16S_ribosomal_RNA`. The canonical `FAILED` error is **not
lost**.

**Honest terminal states.** `failed`, `no_hits`, `unavailable`, `error`, and
`status_conflict` are honest; **no scientific result is shown without a real
retrieved + validated results file**; nothing is fabricated. `no_hits` =
completed with no hits; `unavailable` = NCBI couldn't be reached / unusable
response / UNKNOWN. Terminal states **stop polling**; **no indefinite animation
on terminal**; countdown stops. Resume-by-RID is read-only (no new egress, no
consent burn, no duplicate job; RID must match stored input hash).

**What is shown:** RID, status, **submission time**, **RTOE** (provider
estimated seconds; shown only when a finite value is returned; never invented),
**last check**, **next permitted check**, **clear error**, **resume**; verbatim
truncated provider error when present.

**Rate limits.** NCBI usage rules: at most **one submission per 10 seconds**
(client `SUBMIT_THROTTLE_MS=10_000`, server-enforced too) and **at most one
status check per minute per RID** (`POLL_INTERVAL_MS=60_000`,
`STATUS_INTERVAL_MS=60_000`, server-enforced, `429` + `Retry-After`).
`ncbiFetchText` bounded retry/backoff for 429/5xx. **Server-enforced global
submission throttle for real `CMD=Put` only:** `NCBI_SUBMIT_WINDOW_MS=60_000`,
`NCBI_SUBMIT_LIMIT=10`; mock RIDs don't count; runs before consent claim;
rejected request never burns consent; `429` + `Retry-After`; nothing sent to
NCBI and token not consumed when throttled. (Documented limitation: best-effort,
non-atomic.) `FORMAT_OBJECT=SearchInfo` is not used at runtime, so no separate
rate budget for it.

## 7. Consent (single-use) summary

`POST /api/ai/plans/:id/approve` requires explicit `approved` + `consent_granted`
(+ `consents`); approval creates jobs and, for the egress step, mints a
**single-use** token. `POST /api/blast/submit` re-validates
FASTA/database/program, recomputes `inputHash`, resolves the token (unexpired,
granted, unused, matching `inputHash`+`database`+`program`), then **atomically
claims/burns it BEFORE any external call**; a concurrent loser gets
`consent_used`; a failed NCBI submission leaves it burned; never reusable; bound
to exactly one external submission. Token bound to canonical
`rRNA_typestrains/16S_ribosomal_RNA`+`blastn`. Token not sent to NCBI; not in
audit; not in URL; not displayed. `consent_*` typed 403s. Nothing reaches NCBI
without it (also in mock mode). **Approval itself has no external egress.**

## 8. No live PUT, no NCBI call, production untouched, history preserved

- **No live `CMD=Put`** and **no NCBI call** is made in M7.8; no live SearchInfo
  fetch; production real-submission path is **unchanged**; corrected DB; no
  provider change; no scientific change; no scope expansion; no migration; no
  new endpoint; no second pipeline; no weakening tests.
- **Production untouched:** no deploy; no production change; nothing activated;
  mock/real remains operator-controlled server-side (`MOCK_NCBI`).
- The `CMD=Put` real branch exists in code (audited, consent-gated, URL never
  logged) but is not exercised live here; owner authorization for any corrected
  live submission is separate (see `docs/evidence/M7_6_NCBI_DIAGNOSIS.md`).
- **Preserve history:** this document is additive; it corrects contradictory
  current-state wording and points to preserved evidence; it does not delete or
  rewrite historical records.

## 9. Verification (offline; re-read real code; no NCBI)

Re-read: `web-platform/functions/api/ai/requests/index.js`,
`web-platform/functions/api/ai/planner.js`,
`web-platform/functions/api/ai/_lib.js`,
`web-platform/functions/api/ai/plans/[id]/approve.js`,
`web-platform/functions/api/blast/submit.js`,
`web-platform/functions/api/blast/_lib.js`, `web-platform/public/16s.html`,
`web-platform/public/js/16s-flow.js`.

Mocked, no-network tests: `web-platform/tests/m7_8_privacy_contract.test.mjs`
proves (a) `/api/ai/requests` receives FASTA, makes **no external request**,
stores `fasta_text` inline in D1 `datasets`, audit has no sequence; (b) NCBI not
contacted before consent, mocked fetch counter = 0 before approval, consent
required, single-use; (c) submit sends **only** approved FASTA +
`DATABASE=rRNA_typestrains%2F16S_ribosomal_RNA` + `PROGRAM=blastn`, no secrets,
token not in NCBI URL, audit no sequence, **real/mock server-side only** (client
`execution_mode`/`mock` cannot force real or mock); (d) exact outgoing request
inspection via stubbed fetch; plus UI/wording checks. A read-only grep confirms
no `no sequence is transmitted` phrasing remains in `web-platform/public/`.
All pre-existing tests remain green; none weakened.

**Research use only.** Similarity is evidence, not proof of species identity or
clinical diagnosis; results require independent interpretation.
