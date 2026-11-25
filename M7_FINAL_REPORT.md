# M7 Final Report — Cloud-First Provider Integration and Scientific Platform Expansion

**Date:** 2026-11-25
**Branch:** `phase-1-robustness-safety`
**Baseline:** M6 (`docs/MILESTONE_M6_FINAL_REPORT.md`), branch history preserved, no force push or rewrite.
**Verdict:** **ARCHITECTURE + CONTRACT FOUNDATION COMPLETE; NO PROVIDER IS PRODUCTION-ENABLED.**

> No success claim below rests on file creation alone. Live claims are backed by fetched public API
> responses with URLs and an access date; code claims are backed by tests; everything else is marked
> as blocked or unverified.

---

## 1. What was delivered

### 1.1 Common provider contract and registry
`web-platform/providers/common/contract.js` defines the normalized vocabulary: provider ids, operations,
job statuses, availability, discovery mode, `normalizeProviderError()`, `assertAdapter()`,
`executableTools()` and `isOperationSupported()`. `ADAPTER_METHODS` requires
`healthCheck / getCapabilities / getLimits / validateRequest / submitJob / getJobStatus / cancelJob /
getArtifacts / getUsage`.

`web-platform/providers/registry.js` builds adapters from feature flags, and `executableTools()` is the
only path by which a tool can be advertised. Unavailable or non-executable tools are filtered out.

### 1.2 Adapters
- **Galaxy Europe** (`providers/galaxy/`): generic adapter for `GALAXY_BASE_URL` / `GALAXY_API_KEY`.
  Dynamic discovery only — no hardcoded tool or workflow ids in the adapter. Bounded retries,
  timeouts, injectable `fetch`, normalized errors.
- **smarts.bio** (`providers/smartsbio/`): server-side adapter behind both `SMARTSBIO_ENABLED` and an
  explicit `SMARTSBIO_PUBLIC_AUTHORIZED` gate. Without the authorization gate it reports disabled and
  advertises zero operations and zero tools. Chat/streaming shapes are implemented for private
  contract testing only.
- **9Router** (`providers/ninerouter/`): orchestration reasoner over `NINEROUTER_BASE_URL`,
  `NINEROUTER_API_KEY`, `NINEROUTER_MODEL`, `NINEROUTER_TIMEOUT`. Model discovery, chat, structured JSON
  planning, streaming, token-usage reporting. No `localhost` fallback. A system guard forbids
  scientific measurements and citations in its output.

### 1.3 Provider Usage Governor
`providers/common/governor.js` + migration `0007_provider_governor.sql` implement a D1-backed central
governor. Budgets are split by **unit** and **category** with the exact M7 Part 8 planning ratios
(smarts.bio API 15/30/30/15/10; compute 10/40/30/10/10; 9Router 10/35/30/15/10). No total is ever
invented: an unknown total is `null` and reservations fail closed. Galaxy is governed by real account
quota plus operator-configured operational caps, not fictional credits. Pre-job checks cover
availability, budget, reservation, consent, size and operation; post-job accounting consumes actual
usage and releases unused reservations. Per-provider emergency stop and threshold alerts are included.
Owner-only `POST /api/providers/budget` is the sole way to configure totals from observed quota.

### 1.4 Consent, transfer ledger and private artifacts
- `POST /api/providers/consent` issues short-lived consent scoped to **one dataset + one provider**.
  A provider switch after approval therefore requires fresh consent.
- `POST /api/providers/jobs` refuses submission without a matching, unexpired consent record, and
  records a transfer with source, destination, dataset id, input hash, byte count, consent, timestamp,
  expiry and deletion status. `GET /api/providers/transfers` exposes the ledger.
- `storage/r2.js` + `storage/sha256.js` provide a private bucket design with HMAC-signed, short-lived,
  operation-scoped URLs, sanitized filenames, allowed biological file types, size caps, and **streaming**
  SHA-256 verification (no large Worker-memory buffering; hash mismatch deletes the object).
- Artifact endpoints: signed upload URL, streaming upload, signed download URL, streamed download and
  user-facing deletion. All require an `ARTIFACTS` R2 binding plus `ARTIFACT_SIGNING_KEY`; otherwise
  they fail closed. No public bucket is assumed.

### 1.5 Orchestration endpoints and UI
New Worker routes provide provider discovery, health/limits, usage, chat, structured plan proposals,
consent, governed jobs, status/cancel/artifacts, transfers, budget, emergency stop and artifacts.
`POST /api/providers/plan` never submits a job; it rejects proposed tool ids that are not registered
and available, and discloses every destination that would receive data. Chat and plan outputs are
marked `unverified` and cannot enter the evidence gate as findings. The AI workspace gained a
click-only "Check cloud services" panel that renders availability and the transfer ledger; it makes
no network call until activated, preserving M6 E2E behaviour.

---

## 2. Live discovery (evidence-backed)

### 2.1 Galaxy Europe — VERIFIED metadata
- Instance: `26.1.3.dev0` — `https://usegalaxy.eu/api/version`, access 2026-11-25.
- Tool panel: `https://usegalaxy.eu/api/tools`, access 2026-11-25. `?search=` returned the entire
  panel (~4,462 tools), so it is **not** a usable server-side filter; filtering must be client-side.
- Exact versioned ids were verified for FastQC `0.74+galaxy1`, MultiQC `1.35+galaxy6`, MAFFT
  `7.526+galaxy2`, MUSCLE `0.0.11` (wrapper version only), FastTree `2.1.10+galaxy1`, IQ-TREE
  `3.1.4+galaxy1`, BLAST+ `2.16.0+galaxy1`, BWA `0.7.19+galaxy2`, Bowtie2 `2.5.5+galaxy0`, HISAT2
  `2.2.3+galaxy1`, RNA STAR `2.7.11b+galaxy1`, SAMtools, BEDtools, DESeq2 `2.11.40.8+galaxy6`,
  Salmon `1.10.3+galaxy1`, kallisto `0.48.0+galaxy1`, InterProScan and UniProt wrappers, plus
  PhyML/RAxML-NG/QIIME 2. Full source URLs, limitations and statuses are in
  `VERIFIED_TOOL_CATALOG.md` and `docs/discovery/PROVIDER_DISCOVERY_2026-11-25.md`.
- **NOT VERIFIED:** tool input/output schemas, parameter names/defaults, successful execution,
  runtime, reference-data availability, and account quota. Unauthenticated tool detail and `/inputs`
  responses contain panel metadata only; authenticated tool config is required.

### 2.2 smarts.bio — documented but NOT authorized
- Official OpenAPI 3.1 (32 paths) and gateway/scopes/errors were documented from official sources
  (access 2026-11-25) in `SMARTSBIO_API_INTEGRATION.md`.
- The published terms restrict reselling/sublicensing and developing competing services. **Written
  authorization has not been obtained.** Public API-backed access therefore remains disabled behind
  both `SMARTSBIO_ENABLED=false` and the authorization gate. Possession of an API key does not change
  this. Team Free entitlements are UNKNOWN and must be discovered from the connected account.
- Private API contract testing is permitted within the account's permitted use; no real call was made
  in this milestone.

### 2.3 Live authenticated tests (2026-11-25)

The owner supplied two API keys for live verification. They were used only in transient, read-only
commands plus one cheap instant lookup; **no key was written to any file**. Both must be rotated.

- **Galaxy**: key authenticates (`GET /api/users/current` → `marawan20`). **Real quota discovered**:
  primary `268435456000` bytes (268.4 GB), scratch `2199023255552` bytes (2.2 TB), both 0 used.
  A history was created. `POST /api/upload` returned **404** on this instance; `POST /api/tools`
  (`upload1`) returned **403 `Action requires account activation.`** — execution is blocked until
  the owner activates the account. No Galaxy scientific job ran.
- **smarts.bio**: key authenticates. Workspace `794218e2-...` discovered; `GET /v1/tools` returned
  **92 tools with explicit parameter schemas**; pipelines require `workspace_id` and return
  `processes`. A **real instant tool run** of `alphafold-db` for UniProt `P04637` (TP53) returned
  HTTP 200 with a genuine result including `AF-P04637-F1`, model version 6 and `mean_plddt 75.06`.
  The correct body shape is `{input:{...}, workspace_id}`. No quota/usage endpoint exists, so Team
  Free allowances stay UNKNOWN. These were private contract tests; public access remains disabled
  pending written authorization.
- **9Router**: no endpoint/credential verified; nothing invented.

### 2.4 9Router — not verifiable yet
No remotely reachable URL or credential was supplied in a usable form for this workspace. No model
name, quota or endpoint was invented. `NINEROUTER_INTEGRATION.md` records the required checks (HTTPS,
valid TLS, auth, health, model discovery, chat, structured JSON, streaming, timeout, token usage) and
the exact `wrangler secret put` commands to be run for staging and production.

---

## 3. Verification

| Gate | Result |
|---|---|
| Python suite (`python -m pytest python-engine/tests -q`) | 240 passed |
| JavaScript suite (`npm test`, web-platform) | 275 passed, 0 failed (M6 baseline 211) |
| `node --check` on all new JS modules | clean |
| M6 routing suite re-run (`worker_routing.test.mjs`) | all pass |
| M7 routing suite (`provider_routing_m7.test.mjs`) | all pass |
| Independent reviewer | see §5 |
| Independent tester | see §5 |

Tests use labelled MOCK fixtures and injected `fetch`; no real provider call, no credentials and no
scientific result was produced by a test.

---

## 4. Security incident during this milestone

The owner pasted a live smarts.bio key and a Galaxy API key into public chat. They were **not** written
to code, fixtures, docs or configuration, and no grep of the working tree found actual key material
(only documentation examples of the `sk_live_` prefix). Both credentials must be considered exposed
and **rotated**, then supplied only via `wrangler secret put` for staging and production. This report
deliberately does not repeat the values.

---

## 5. Independent verification

- **Independent reviewer — initially FAIL, all findings addressed.** Blocking: adapters received a bare
  string instead of a request object from status/cancel/artifacts handlers; job reservations were never
  consumed; governor category isolation used aggregate usage. High: unauthenticated state-changing
  endpoints, unauthenticated artifact download/transfer ledger, and provider failures persisted as
  successful jobs. Fixes: request-object calls, immediate post-submission accounting, per-category
  usage tracking, owner-only cancellation/transfers, consent-scoped download tickets, rate limiting on
  public endpoints, failed-result rejection in chat/plan/jobs, and provider-specific governor categories.
  Medium/low items (stale policy doc, uncached health checks, non-atomic D1 reservations) were either
  fixed or explicitly recorded as risks below.
- **Independent tester — initially 3 reproduced bugs, all fixed.** `advertisedTools()` is async and was
  used synchronously in the jobs and plan handlers; the consent id prefix `pcon` was rejected by the
  public-id whitelist; the consent round-trip failed. After fixes the targeted validation suites pass
  (18/18). The tester also verified migration 0007 applies cleanly in SQLite, `node --check` on 34
  modules, and no skipped/weakened tests.
- **Re-verification:** full JS and Python suites were re-run after all fixes; see §3.

---

## 6. Remaining blockers and risks

- **No provider is production-enabled.** All three flags default `false`; smarts.bio additionally
  requires documented written authorization.
- **Live coverage is partial**: authenticated discovery succeeded for Galaxy and smarts.bio, and one
  real smarts.bio instant tool run succeeded. Galaxy execution is blocked by the account
  (`Action requires account activation`); no real upload/download, no real 9Router endpoint, and no
  comparative validation of any remote result has been performed.
- **Galaxy tool I/O schemas and parameters are unverified**, so no remote workflow can yet be safely
  registered as executable against real inputs. See `VERIFIED_TOOL_CATALOG.md` Note A.
- **Governor is fail-closed until an owner configures real totals** via `/api/providers/budget`; this
  is intentional but means Galaxy jobs are refused by default.
- **R2 is not provisioned.** No private bucket binding or signing secret exists in staging or
  production; artifact endpoints fail closed until both are configured.
- **Deployment not updated.** Staging was not redeployed and production was not promoted; M6 staging
  remains untouched. No browser E2E run was made against the new M7 panel.
- **Multi-user ownership** is still unresolved: platform-owned vs per-user provider account model,
  per-user attribution and abuse controls need an operator decision before public release.
- **Python/JS parity** was not extended to the provider layer; the M6 scientific algorithms and their
  parity tests are unchanged.
- **M6 residual LOW** (`computeExecutionMode` trusting an agent's `real` label without an operator
  override) is unchanged.
- The office dashboard command `D:\Apps\Star-Office-UI\office-status.cmd` is absent on this host
  (also noted in M6 §10); status updates could not be executed.

---

## 7. Recommended next cycle

1. Rotate the exposed keys; set secrets per environment via `wrangler secret put`; provision a private
   R2 bucket and signing key.
2. Obtain written smarts.bio authorization before enabling any public API-backed feature.
3. Verify the 9Router endpoint from the *deployed* staging Worker; record model list and token usage.
4. Read authenticated Galaxy tool configs and record verified I/O schemas for a small first tool set
   (FASTQ QC and one alignment tool); register only those tools as executable.
5. Read the real Galaxy account quota/storage/concurrency and configure governor totals through the
   owner-only endpoint; then run small real execution + upload/download smoke tests.
6. Re-run the full browser E2E on staging and only then consider production promotion; keep staging
   and production D1 databases separate (an M6 gap).
