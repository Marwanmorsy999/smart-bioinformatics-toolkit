# M7.2 — Galaxy-First Live Execution Report

**Date:** 2026-11-25
**Branch:** `phase-1-robustness-safety`
**Foundation commits:** `dcbb7cf`, `c81a1a5`, `514c274`
**Verdict:** **BLOCKED for the website workflow — NOT COMPLETE.** A genuine two-test Galaxy upload verification has now passed at API level (§7c), proving activation and the corrected upload contract. The rotated key is still not installed as a secret and `GALAXY_ENABLED=false`, so no provider is live in the Worker and no end-to-end website workflow or scientific job has run.

> Per the mission, a blocked integration is reported as blocked. There are **no Galaxy job IDs, no
> input/output hashes from an M7.2 execution, and no execution times** in this report, because no job
> ran. Screenshots below show the real staging site's status presentation, not scientific output.

---

## 1. Phase 1 — prerequisite check (secret presence only, 2026-11-25)

| Prerequisite | Command / source | Result |
|---|---|---|
| Replacement Galaxy key installed | `npx wrangler secret list --env staging` | **MISSING.** Only `AI_AGENT_TOKEN` and `MOCK_NCBI` were listed. No `GALAXY_API_KEY` and no `GALAXY_BASE_URL`. |
| Galaxy activation complete | `GET https://usegalaxy.eu/api/configuration` (public, no key); later live uploads (§7c) | `200`, **`user_activation_on: true`**. The old `403 Action requires account activation` is no longer observed. Two real uploads into dedicated histories succeeded (§7c), which confirms the account can upload data. No bypass was attempted. |
| R2 enabled | `npx wrangler r2 bucket list` | **FAILED**, code `10042`: "Please enable R2 through the Cloudflare Dashboard." |
| Private staging artifact bucket | same | **MISSING** (R2 not enabled, so no bucket can exist). |
| Staging signing secret | `npx wrangler secret list --env staging` | **MISSING** (`ARTIFACT_SIGNING_KEY` absent). |
| Galaxy flag | `web-platform/wrangler.toml` `[vars]` and `[env.staging.vars]` | `GALAXY_ENABLED = "false"` in both. |

No secret value was requested, printed, or stored. Because **all** prerequisites are missing, the mission requires reporting the exact blockers and continuing only with independent offline work.

---

## 2. Phase 2 — Galaxy live verification — NOT PERFORMED

With no replacement key installed, no authenticated Galaxy call was made in M7.2. The public instance remains reachable and its activation requirement is confirmed (§1). Tool identities were previously *discovered* in M7 (e.g. FastQC `0.74+galaxy1`, MAFFT `7.526+galaxy2`, IQ-TREE `3.1.4+galaxy1`), but those are catalogue metadata, **not** evidence that a job can execute on this account. No tool was selected for execution and no workflow id was assumed; the adapter discovers tools dynamically from `/api/tools`.

**Blocker:** activated account + replacement `GALAXY_API_KEY`/`GALAXY_BASE_URL` installed as staging secrets.

---

## 3. Phase 3 — complete website workflow — NOT PERFORMED

The following steps therefore did **not** happen and are not claimed: website upload of biological data, plan generation with a live provider tool, approval and external-data consent for a real transfer, Galaxy submission, live job monitoring, retrieval of actual output datasets, private R2 storage, SHA-256 verification of real outputs, provenance/locality records for a real job, scientific validation of a remote result, evidence-bounded explanation of a real finding, and a downloadable report of real results.

The control-plane code for all of these steps exists (M7 commits) and is covered by **clearly labelled MOCK/offline tests** only. See §5 and `docs/discovery/M7_2_OFFLINE_VERIFICATION.md`.

---

## 4. Phase 4 — failure and usage testing — OFFLINE ONLY

Failure paths (expired credentials, activation failure, insufficient quota, missing tools, failed workflow, cancellation, duplicate requests, consent denial, download authorization, expired/tampered URLs, invalid hashes) and reservation handling were exercised **offline** with injected fake D1/fetch, never against a live provider. Exact counts in §7. No provider usage was consumed.

---

## 5. Phase 5 — second workflow — NOT PERFORMED

A second Galaxy workflow (e.g. multiple sequence alignment using the dynamically discovered MAFFT wrapper) could not be selected or independently validated because the first workflow never executed. This gate is **not** satisfied.

---

## 6. Phase 6 — staging browser verification — REAL, STATUS-ONLY

A genuine Playwright 1.65.1 / Chromium run was made against the deployed staging site
`https://smart-bioinformatics-toolkit-staging.m-2396.workers.dev/ai.html`. This verifies the website's honest status presentation; **it is not a remote scientific execution**.

| Check | Result |
|---|---|
| Page title | `AI Research Workspace · Smart Bioinformatics Toolkit` |
| Backend badge | `Agent not connected — heavy analyses unavailable; browser-local tools still work.` |
| "Check cloud services" button | visible and functional |
| Cloud status after check | `Cloud service status checked. Files leave the platform only with explicit, dataset-scoped consent.` |
| Galaxy row | `disabled · Enabled: no · executable tools: 0 · discovery: unavailable` |
| smarts.bio row | `disabled · … Public API access is disabled pending written provider authorization.` |
| 9Router row | `disabled · Enabled: no · executable tools: 0 · discovery: unavailable` |
| Transfer ledger | `Transfer ledger requires operator authorization.` |
| Console errors | one expected `401` from the anonymous ledger request; no page errors |
| External host requests | none |
| Screenshot | `docs/discovery/m7-2-screenshots/staging-provider-status.png` (40,685 bytes) |

No provider job progress, output artifact or report download was observable because no provider is enabled.

---

## 7. Test counts and fixes from independent verification

| Check | Exact result |
|---|---|
| JavaScript suite (`npm test`, web-platform) | **396 tests, 396 pass, 0 fail, 0 skipped, 0 todo** (M7.1 baseline 299) |
| Python suite (`python -m pytest python-engine/tests -q`) | **240 passed** |
| New M7.2 offline files | `m7_2_pipeline_offline.test.mjs` (1 full-chain test) + `m7_2_failures_offline.test.mjs` (14 failure/usage tests) + `m7_2_verify_jobs.test.mjs`/`m7_2_verify_report.test.mjs` (6 independent regression tests) = **21/21 pass** |
| R2-free Galaxy artifact tests | `galaxy_artifacts_store` (13), `galaxy_artifacts_handlers` (13), `galaxy_artifacts_failures` (16), `galaxy_artifacts_boundaries` (7), `m7_2_galaxy_verify_offline` (8) = **57/57 pass**, all OFFLINE/MOCK |
| Real Playwright staging run | page loaded, button worked, 3 provider rows rendered, 0 external hosts, 0 page errors, 1 expected anonymous-ledger 401; screenshot captured |

All M7.2 tests use labelled MOCK fixtures and injected D1/fetch/R2. They are explicitly **not** remote execution evidence.

Two real defects found by the offline work were fixed before sign-off:
1. `web-platform/functions/api/providers/jobs/index.js` now preserves the provider HTTP status/code on a failed submission, so expired credentials return **401** and account-activation failure returns **403** instead of a misleading Worker 502. Regression assertions tightened to the exact status and code.
2. `web-platform/functions/api/ai/report.js` now renders `job.public_id` (e.g. `job_…`) instead of the internal numeric row id. Both fixes have regression assertions (exact 401/403 status and code; report title/header contain the public id). Reviewer notes about stale "NOT patched" documentation were corrected; the `retryable` default for transient 5xx errors is preserved.

---

## 7b. Continuation — R2-free Galaxy storage (owner decision, 2026-11-25)

The owner deferred R2. R2 is therefore **no longer a prerequisite** for the first Galaxy workflow:
it stays implemented but optional and disabled, with no bucket, binding or signing key required.
Galaxy histories hold input and output datasets; D1 holds metadata, hashes, provenance and ownership;
the Worker exposes authenticated retrieval and on-demand reports. No large biological file is stored
in D1 and no public artifact URL is created.

Prerequisite re-check (secret presence only, no values):
`npx wrangler secret list --env staging` still lists only `AI_AGENT_TOKEN` and `MOCK_NCBI` — **no
installed replacement `GALAXY_API_KEY` and no `GALAXY_BASE_URL`**; `wrangler.toml` still has
`GALAXY_ENABLED = "false"` for both top level and staging.

A replacement key value was pasted into chat by the owner and was used **only** in transient
verification commands (never written to a file, secret store, git or browser). These included
read-only calls plus one history creation and several failed upload attempts — no successful job
or result was obtained:
- `GET /api/users/current` → 200, account `marawan20`, quota `268.4 GB` / scratch `2.2 TB`, 0 used.
  The live OpenAPI spec confirms `GET /api/whoami` exists as the canonical identity endpoint; it will
  be used for the final authentication gate once the secret is installed.
- `GET /api/users/current/usage` → 200 (two quota sources).
- `POST /api/histories` → 200, history `11ac94870d0bb33ad52bef73e8f312cd` ("M7.2 activation check").
- Multiple upload shapes to `POST /api/tools` (`tool_id=upload1`) — JSON `inputs.file1.file_content`,
  input-array, multipart form, `?key=` variant, and `tool_version` pin — **all returned 400**
  `No data was entered in the upload form, please go back and choose data to upload.`
  No dataset id, no job id, no successful upload.

  **Root cause (investigated from the live specification, 2026-11-25):** the adapter used the wrong
  endpoint and payload. `https://usegalaxy.eu/openapi.json` shows uploads are performed by
  **`POST /api/tools/fetch`** with `multipart/form-data` fields `history_id` (required), `targets`
  (required, JSON-encoded `DataElementsTarget[]`) and optional `files` parts. `targets` items are
  `{destination:{type:"hdas"}, elements:[{src:"pasted", paste_content, name, ext} | {src:"files", name, ext}]}`.
  There is no `/api/upload` route on this instance (404), and `/api/tools/{id}/inputs` does not
  expose the upload form (400008). The 400 was therefore a **request-contract error**, not proof of
  an account-activation restriction. The adapter has been corrected to this contract with six OFFLINE/MOCK regression tests
  (`galaxy_upload_fetch.test.mjs`) and an opt-in two-test live script
  (`scripts/live-smoke/galaxy-upload-tests.mjs`: pasted text + real FASTA file). The live script
  has **not** been run: staging has no installed Galaxy secret and activation is unconfirmed.

The earlier `403 Action requires account activation` was not reproduced with the new key, but
**successful upload/execution was not achieved**, so activation and execution eligibility remain
**UNCONFIRMED**. Per the mission, **live provider activation was stopped**: no flag change, no
secret installation from a chat-pasted value, no deployment with a provider enabled. The key must
still be installed through `scripts/secrets/` (or `wrangler secret put`) per environment, and the
owner must confirm activation with a successful small upload before enablement. The R2-free
architecture, authenticated retrieval endpoints and failure tests were completed offline.
Migration `0009_galaxy_artifacts.sql` was applied to the real staging D1 with `--remote`
(22 tables after migration); no file bytes are stored there, only dataset references, hashes,
ownership and download audit rows. No Galaxy job id, output dataset id, output hash or execution
time from a successful live run exists in this report.

---

## 7c. Live upload-contract verification (2026-11-25) — BOTH TESTS PASSED

Using the previously supplied (therefore compromised) key **transiently via environment variables
only** — never written to a file, secret store, git or browser — the opt-in smoke script was run
once. This did **not** install a secret or enable any provider.

| Step | Test A — pasted text (`src:"pasted"`) | Test B — real FASTA (`src:"files"` + `files` part) |
|---|---|---|
| `POST /api/histories` | 200 | 200 |
| `POST /api/tools/fetch` | **200** | **200** |
| History id | `11ac94870d0bb33a421fe648fe235638` | `11ac94870d0bb33aee565b9befc94a7d` |
| Dataset id (exact filename match) | `40160950115d555e4a07f3ebf2c9631f` | `40160950115d555e37e69b35a2a071e4` |
| Final state after bounded polling | `ok` | `ok` |
| History membership | OK | OK |
| Content endpoint | `GET /api/datasets/{id}/get_content_as_text` → `{item_data, truncated:false}` | same |
| Input SHA-256 | `e7d09d04a66bb582cc87f76bd8671bef87b7cbcc7df60f7a2dbe71fe5478867c` | `9614b1b4e5192b84786c4e907f1426b66c9911c5c9d3baa687b23c40bc3fe950` |
| Retrieved-content SHA-256 | **identical** | **identical** |

Additional verified endpoint facts: `GET /api/datasets/{id}/content` has **no route** (404); the
documented content route is `/api/datasets/{id}/get_content_as_text` (or
`/api/histories/{history_id}/contents/{id}/display`). Datasets transition `queued → running → ok`,
so content retrieval must poll with a bounded wait.

After the content-endpoint fix and bounded polling were added, the corrected script was re-run
once with the same transient configuration. Both tests reported `complete: OK`: each created a
history, `POST /api/tools/fetch` → 200, polled to `state=ok` (attempt 19/30 and 25/30), confirmed
history membership, read content via `get_content_as_text` → 200, and verified SHA-256.

**Conclusion:** the `400 No data was entered in the upload form` was caused by the adapter using
`POST /api/tools` with `upload1`, not by account activation. Activation, upload, content retrieval
and hash verification are now proven at API level. These are **API-level** results: no website
workflow, no remote scientific job, no output artifact and no report has been produced through the
Worker. The key used is exposed and must be rotated; no provider is enabled.

---

## 8. Remaining blockers and next steps

1. Rotate the exposed Galaxy key and install `GALAXY_API_KEY`/`GALAXY_BASE_URL` with `scripts/secrets/` for staging only.
2. Account activation is now evidenced by two successful real uploads (§7c); no bypass was used.
3. Supply rotated `GALAXY_API_KEY` and `GALAXY_BASE_URL` as staging secrets through `scripts/secrets/`; R2 is **deferred** and not required.
4. Set `GALAXY_ENABLED="true"` for staging **only**, deploy, and re-run the live probes before any website workflow.
5. Then execute one small real Galaxy job through the consent-gated pipeline, record job id, history id, dataset ids, output hashes and provenance, and only afterwards select a second workflow.
6. Production promotion remains forbidden in this milestone; staging and production credentials and D1 stay separate.

**Acceptance gate:** M7.2 is incomplete until at least one genuine Galaxy workflow has passed through the complete website pipeline. That condition is **not met**.
