# M7.2 — R2-free Galaxy-history artifact storage: design and offline evidence

> ## NOT LIVE EXECUTION — OFFLINE DESIGN / MOCK VERIFICATION ONLY
>
> **No live execution occurred.** No Galaxy job was submitted, no history or dataset id from a
> real run exists, no output hash was measured, and no scientific result was produced or claimed.
> All provider responses in the verification tests are canned MOCK fixtures returned by an
> injected `fetch`; D1 and the Galaxy byte store are in-memory fakes. The operator prerequisites
> are still absent — **no `GALAXY_API_KEY` secret, no confirmed account activation, and
> `GALAXY_ENABLED=false`** — so live activation was **STOPPED** by owner instruction. No
> credential was read, printed, stored or used. This document describes contracts, not science.

**Branch:** `phase-1-robustness-safety`
**Related:** `docs/DATA_TRANSPORT.md` §6 (M7.2 storage architecture), `docs/M7_2_GALAXY_EXECUTION_REPORT.md` §7b, `docs/discovery/M7_2_OFFLINE_VERIFICATION.md`.

---

## 1. Owner decision and scope

The owner deferred R2. The **first Galaxy workflow** therefore uses:

- **Galaxy histories** as the only byte store for both **input and output** datasets;
- **D1** for **metadata only** — dataset references, hashes, provenance pointers and ownership;
- **authenticated Worker endpoints** for every retrieval — there are no public/static artifact URLs;
- **R2 optional and disabled** — the existing R2 code path is left intact but is neither required,
  bound nor configured for this workflow.

This is the first cloud workflow mode in which dataset bytes leave the browser. It remains
consent-gated and audited. Browser-local analysis and the local agent workspace are unchanged.

## 2. Architecture

```
browser (memory / File API)
   |  explicit, consented workflow only
   v
Worker control plane ---------------------------------------------------+
   |  POST /api/providers/galaxy/upload                                 |
   |    - validate ds_ id, extension, SHA-256, <=1 MiB, UTF-8            |
   |    - verify single-use pcon_ consent BEFORE any egress              |
   |    - stream+hash bytes, hand to Galaxy adapter `upload1`            |
   |    - persist metadata only to D1                                    |
   |  GET  /api/providers/galaxy/datasets/:id/{metadata,download}        |
   |    - owner token; resolve registered id; re-check live Galaxy       |
   |    - bounded, hash-verified proxy stream + download audit row        |
   +---------------------------+----------------------------------------+
                               | X-API-Key from env only (never logged/returned)
                               v
                     Galaxy Europe history (job-scoped)
                     input HDA + output HDA = the ONLY byte store
                               |
                               v  provenance/hash/reference (no bytes)
                     D1: galaxy_artifacts, galaxy_artifact_downloads,
                         provider_jobs, provider_transfers, provider_consents
```

Key code seams:

| File | Role |
|---|---|
| `web-platform/storage/galaxy-artifacts.js` | Metadata store + `uploadDataset` / `inspectDataset` / `downloadDataset` via the existing Galaxy adapter. Hard 1 MiB cap; SHA-256 stream verification; typed errors with whitelisted codes. |
| `web-platform/functions/api/providers/galaxy-artifacts/_lib.js` | Consent verification (`verifyConsent`), single-use consume, typed errors, flag gate. |
| `web-platform/functions/api/providers/galaxy-artifacts/upload.js` | Consent-gated, bounded, hash-verified upload; D1 gets metadata only. |
| `web-platform/functions/api/providers/galaxy-artifacts/artifacts.js` | Owner-only, metadata-only registry (max 100 rows). |
| `web-platform/functions/api/providers/galaxy-artifacts/datasets/[id]/metadata.js` | Owner-only live metadata confirmation through the adapter. |
| `web-platform/functions/api/providers/galaxy-artifacts/datasets/[id]/download.js` | Owner-only, bounded, hash-verified byte proxy; writes an audit row on success **and** failure. |
| `web-platform/migrations/0009_galaxy_artifacts.sql` | Additive `galaxy_artifacts` + `galaxy_artifact_downloads` tables. No byte/blob column. |
| `web-platform/worker.js` | Routes registered **before** the dynamic `/api/providers/:id` routes so `galaxy` is never captured as a provider id. |

## 3. D1 shape (metadata only)

`galaxy_artifacts`: `public_id`, `dataset_id` (`ds_…`), `galaxy_dataset_id`, `job_id`,
`history_id`, `filename`, `ext`, `direction` (`input`|`output`), `sha256`, `bytes`, `project_id`,
`created_at`, `deleted_at`. Unique on `(dataset_id, direction)`; indexed by history and provider
dataset id. **There is no content/byte column.**

`galaxy_artifact_downloads`: `public_id`, `artifact_id`, `dataset_id`, `actor` (non-secret owner
label), `at`, `bytes`, `sha256`, `status`, `detail_json`. Append-only; a failed retrieval is also
recorded with its error code.

## 4. Endpoint contracts (all authenticated; no public URLs)

### `POST /api/providers/galaxy/upload`

| Input | Contract |
|---|---|
| Headers | `X-Dataset-Id` (`ds_` + 16 hex), `X-Consent-Id` (`pcon_` + 16 hex), `X-Filename`, `X-Input-Hash` (64 lowercase hex), `X-Size-Bytes` (positive integer ≤ 1 MiB), optional `X-Project-Id` |
| Body | biological **text** bytes; streamed and hashed (UTF-8 validated) |
| Preconditions | Galaxy enabled (`GALAXY_ENABLED=true`); valid, unexpired, unspent consent for this dataset+provider; allowed extension; hash and byte count match; no existing registration for this dataset/direction |
| Success | `201` + metadata-only artifact DTO (no bytes), `X-Artifact-Id` |
| Typed failures | `400` `invalid_dataset_id` / `invalid_consent_id` / `invalid_filename` / `invalid_hash` / `invalid_size` / `size_mismatch` / `invalid_encoding`; `403` `provider_disabled` / consent denial codes; `409` `duplicate_artifact`; `413` `oversize`; provider codes whitelisted from 401/403/404/408/409/410/413/429/5xx |

### `GET /api/providers/galaxy/artifacts?limit=…`

Owner token required. Returns `200` with metadata-only DTOs (max `limit` 100). No bytes, no key,
no public URL. Missing owner token → `401`; disabled provider → `403`.

### `GET /api/providers/galaxy/datasets/:id/metadata`

Owner token required. `:id` resolves by artifact id, platform dataset id or Galaxy dataset id.
Re-checks the live dataset through the adapter and returns `200` with metadata + live Galaxy
fields. Unregistered id → `404 artifact_not_found`; deleted/expired → `410`; wrong history/job →
`409 history_mismatch`; never returns the key.

### `GET /api/providers/galaxy/datasets/:id/download`

Owner token required. Resolves and re-checks ownership (live dataset history **and** recorded job
history), bounds the body at 1 MiB, verifies SHA-256 against the registered hash, streams the
bytes with `default-src 'none'`, `nosniff`, `no-referrer`, `no-store`, and writes a download audit
row with the verified SHA-256. Typed failures: `401` owner token, `403` disabled, `404`
unregistered/missing dataset, `409` wrong job/history or hash mismatch, `410` deleted/expired,
`413` oversize. Failure paths are audited too.

## 5. Failure matrix covered offline

401 invalid credentials; 403 activation restriction / disabled provider / consent denial; missing
history; deleted/expired Galaxy dataset (404/410); unauthorized download (no owner token, wrong
job/history, unregistered dataset); oversized upload; provider timeout; failed remote job;
cancelled job; duplicate submission/registration; missing output dataset; invalid input hash.

Cross-cutting assertions: **no secret exposure** (a distinctive fake key is scanned for in every
response body/header), **no D1 byte storage** (registered rows carry hashes and ids only), **no
unregistered dataset retrieval** (typed 404), **clear typed errors** (status + whitelisted code),
and **no uncontrolled retry** (401/403/404/410 are single-attempt; 5xx capped at the adapter's
configured maximum).

## 6. Risk notes and limitations

- **Galaxy retention / expiry:** the account's history quota and purge policy are provider-side.
  A dataset that Galaxy deletes or expires becomes 404/410; the Worker must not cache or
  reconstruct bytes. The local MOCK account also rejects execution with 403
  "Action requires account activation" — no bypass was attempted.
- **History ownership:** a provider dataset id is only trusted after the live dataset's history
  matches the registered `history_id` **and** the recorded job's history matches it. This is the
  barrier against "wrong job / wrong history" retrieval. It is verified offline with MOCK ids
  only; live ownership cannot be confirmed until activation.
- **Worker limits:** the 1 MiB cap is an MVP memory ceiling, enforced before any provider call and
  again on the response body. Binary containers are excluded because Galaxy's `file_content`
  transport is a JSON string. Larger files must be split into multiple registered datasets.
  Timeouts are bounded and retries are capped; POST retries are at-least-once, so callers
  reconcile duplicates by provider job id / consent single-use.
- **Consent/ledger:** consent is single-use and spent even if the provider call fails; that is
  deliberate (one consent can never authorize two transfers) but means a retry needs a fresh
  consent.
- **R2:** optional and disabled. Enabling it later requires its own binding, signing key,
  migration and explicit consent — it is not a side effect of this workflow.
- **Static verification only:** correctness here means contract conformance against synthetic
  data, not scientific validity and not proof of live provider behaviour.

### Finding observed during this offline work (production, NOT patched here)

While this verification was running, `web-platform/functions/api/providers/galaxy-artifacts/datasets/[id]/metadata.js:9`
imported `../../../../../storage/galaxy-artifacts.js`, which resolves to
`web-platform/functions/storage/galaxy-artifacts.js` (missing). The module lives at
`web-platform/storage/galaxy-artifacts.js`, so the correct relative path is one level higher
(`../../../../../../storage/galaxy-artifacts.js`). The same off-by-one was present at
`.../datasets/[id]/download.js:9`. Repro at that moment: `node --input-type=module -e
"import('./worker.js')"` → `ERR_MODULE_NOT_FOUND`; every test importing `worker.js` failed at
module load. The **owning worker corrected both imports in parallel**; the final verification run
imports `worker.js` cleanly. This verification task did **not** modify any production file.

### Additional contract gap (reported, not patched)

`createGalaxyArtifactStore.inspectDataset()` (`web-platform/storage/galaxy-artifacts.js:301-331`)
checks `live.deleted === true` / a deleted/expired state to raise typed `410 dataset_deleted`, but
the Galaxy adapter's `getArtifacts()` (`web-platform/providers/galaxy/index.js:489-501`) filters
out deleted and non-`ok` datasets and its DTO does not carry `deleted`. A locally *filtered*
deleted/expired dataset therefore surfaces as `404 dataset_not_found`, not `410`. The explicit
`410` is still reachable when Galaxy returns an HTTP 404 whose body code contains
`deleted`/`expired`/`purged` (`galaxy-artifacts.js:101-110`); that is the path the OFFLINE/MOCK
tests assert. No production file was changed to close this gap.

## 7. How this was verified (offline)

```powershell
cd web-platform
node --check tests/galaxy_artifacts_failures.test.mjs
node --check tests/galaxy_artifacts_boundaries.test.mjs
npm test
```

Exact counts and any remaining failures are reported in the worker's completion report; they are
not restated here because production was being edited in parallel. No network access, credentials
or browser were used.

**Explicit statement:** no live execution occurred; nothing in this document is a claim that a
Galaxy job ran, that a real history/dataset id was observed, or that a scientific result was
produced.
