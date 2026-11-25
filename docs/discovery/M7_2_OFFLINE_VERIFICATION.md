# M7.2 offline verification

> ## NOT LIVE EXECUTION
>
> **This document and the tests it describes are OFFLINE contract verification only.** No
> genuine Galaxy job was run, no end-to-end workflow was executed, and no real scientific
> result was produced or claimed. All provider responses are synthetic MOCK fixtures returned
> by injected fakes; all D1 and R2 storage is in-memory. The word "mock" in this document is
> literal — nothing here is a live observation disguised as a test.

## Why this is offline-only

Every M7.2 prerequisite is absent in the current environment:

- no `GALAXY_API_KEY` secret;
- `GALAXY_ENABLED=false`;
- R2 disabled (`error 10042`), so no private bucket is bound;
- no `ARTIFACT_SIGNING_KEY`;
- the Galaxy account is not activated, so it rejects execution with HTTP 403
  "Action requires account activation".

Consequently, no live Galaxy submission or live end-to-end workflow is possible, and none is
claimed. The tests verify that the existing control plane enforces its contracts when fed
canned data — not that science happened.

## Files owned by this work

| File | Purpose |
| --- | --- |
| `web-platform/tests/m7_2_pipeline_offline.test.mjs` | Full control-plane chain, injected fake D1 + injected fake Galaxy fetch + in-memory R2 |
| `web-platform/tests/m7_2_failures_offline.test.mjs` | Failure/usage matrix, bounded retry, reservation accounting |
| `web-platform/tests/fixtures/providers/galaxy/m7_2_galaxy_discovery.json` | MOCK tool/workflow/quota discovery payloads |
| `web-platform/tests/fixtures/providers/galaxy/m7_2_galaxy_jobs.json` | MOCK job/history/dataset payloads |
| `web-platform/tests/fixtures/providers/galaxy/m7_2_galaxy_errors.json` | MOCK 401/403/429/500/404 envelopes |

Every fixture carries an explicit `__fixture` string beginning with `MOCK`, `is_mock: true`
and `execution_mode: "mock"`. Every test name begins with `OFFLINE/MOCK`. The Galaxy base URLs
used by the tests are `.invalid` hosts; the injected fetch is the only "server". Production
code, `wrangler.toml`, existing tests and existing docs were not modified, and no commit was
made.

## How to run

From the repository root:

```powershell
cd web-platform
node --check tests/m7_2_pipeline_offline.test.mjs
node --check tests/m7_2_failures_offline.test.mjs
npm test
```

Targeted run of only the M7.2 files:

```powershell
cd web-platform
node --test tests/m7_2_pipeline_offline.test.mjs tests/m7_2_failures_offline.test.mjs
```

No credentials, environment secrets, network access or Chrome browser are needed. The retry
helper's sleep function is injected as a no-op, so no real backoff timers are awaited.

## Verified counts (this workspace)

- `node --check`: both new test files OK.
- Targeted `node --test` of the two new files: **15 tests, 15 pass, 0 fail**.
- Full `npm test`: **314 tests, 314 pass, 0 fail** (baseline before these files: 299 tests).
  The new files add exactly 15 tests: 1 full-pipeline test and 14 failure/matrix tests.

## What the full-chain test covers

The real Worker router (`createFetch(handlers)`) dispatches every step; only D1, the Galaxy
HTTP server and the R2 bucket are replaced with fakes.

1. `POST /api/ai/requests` — MOCK FASTA + prompt create request, dataset and plan.
2. `validatePlan()` — the generated plan satisfies the structured plan validator.
3. `POST /api/ai/plans/:id/approve` — only the explicitly approved step creates a job.
4. `POST /api/providers/consent` — per-provider, per-dataset `pcon_` consent.
5. `POST /api/providers/jobs` — governed submit; one job + one byte reservation are consumed.
6. `GET /api/providers/jobs/:id` — status monitoring over MOCK queued/running/ok states.
7. `GET /api/providers/jobs/:id/artifacts` — only completed MOCK datasets are artifacts,
   explicitly `evidence_status: "unvalidated"`.
8. `POST /api/ai/jobs/:id/result` after an authenticated poll/claim — the M6 gate verifies
   artifact hashes, declared output schema, provenance and the curated citation ledger. Mock
   mode downgrades validation `pass` to `warn` and adds a mock-mode flag.
9. `GET /api/ai/runs/:id`, `/provenance` — Worker-derived locality receipt (`no_external_egress`,
   local operations, approval reference), provenance fields, ledger-projected references and
   education notes.
10. `GET /api/ai/runs/:id/report` — HTML contains honest `Execution mode: mock`, the
    research-use disclaimer, findings, data-locality section and a verified ledger reference;
    no inline script.
11. Upload ticket → hash-verified streaming upload → signed download ticket → streamed
    download via the in-memory bucket.

Nothing in this test asserts that a real measurement, taxon call or scientific result was
produced.

## What the failure/matrix test covers

- 401 expired credentials and 403 "Action requires account activation" — normalized at the
  adapter seam with the real MOCK status/code; the control plane refuses the job.
- 429 `budget_exhausted`, both from a depleted governor category and from a MOCK provider
  error; capped retry counts (2 for submit POST, 5 maximum from `requestResponse`).
- unadvertised tool → 400 with no governor write;
- failed remote workflow invocation → failed result never persisted as submitted;
- cancellation via owner token and via status monitoring — consumption stays charged;
- duplicate consent → 409 `duplicate_submission`;
- consent denial → 403 `consent_denied`, provider/dataset mismatch and scope mismatch → 403;
- download authorization denial (anonymous, unknown consent, expired consent);
- expired, tampered and wrong-operation signed tickets → 403;
- invalid artifact hash rejected by the M6 gate and by streaming upload (object deleted).

For every submit path the test asserts that reservations are either consumed exactly once or
fully released: `reservations === {}`, `reserved === 0`, and `used.jobs` is 1 only for a job
that was actually submitted.

## Findings exposed by the offline tests (NOT patched)

Per the task constraint, no production code was changed. These are observations to review.

### 1. Provider 401/403 status is collapsed to HTTP 502 by the governed submit handler

`web-platform/functions/api/providers/jobs/index.js:163-166` converts an adapter failure into
`new Error(message)` (no `status`), then
`web-platform/functions/api/providers/_lib.js:121-126` calls `normalizeProviderError`, which
sees status 0 and maps it to 502. The adapter itself retains the correct 401/403 and code.

Minimal repro (fully offline): configure Galaxy with a MOCK fetch that returns HTTP 401
`{"error":"expired_api_key"}` for `POST /api/tools`, then `POST /api/providers/jobs` with a
valid MOCK consent. The response is 502 with `X-Error-Detail.code === "http_0"` and
`error === "galaxy returned HTTP 401"`, rather than 401 with the provider code. No job is
persisted and reservations are released, so the safety behaviour is intact; only the outward
status/code is lost. The same applies to the 403 activation failure.

### 2. HTML report renders the internal numeric row id instead of the public job id

`web-platform/functions/api/ai/report.js:89` and `:103` interpolate `job.id`. The result
handler passes the raw job row at
`web-platform/functions/api/ai/jobs/[id]/result.js:139-150`, and the `jobs` table has both an
integer primary key `id` and a `public_id` (`web-platform/migrations/0002_ai_platform.sql:60-62`).
The rendered title/label therefore contain the internal numeric id (for example `1`), not
`job_...`.

Minimal repro (fully offline): run the full MOCK pipeline test's submit-result step, then
`GET /api/ai/runs/:id/report`; the HTML title reads `Analysis report - <numeric id>` and the
header reads `Job <numeric id>`, never the public job id. Plan id, provenance and all other
report content render correctly.

## Limitations

- Correctness here means contract conformance against synthetic data, not scientific validity.
- Random public ids are captured from responses rather than asserted as fixed constants; the
  behaviour, order and accounting are deterministic, the hex suffixes are not.
- The MOCK Galaxy fixtures exercise documented wire shapes only; they cannot reveal unknown
  provider behaviour or verify the live account's quota/activation state.
- The R2 and D1 fakes model only the statements used by these paths; they are not a database
  conformance test.
