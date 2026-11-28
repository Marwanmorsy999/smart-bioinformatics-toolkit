# M7.1 — Live Provider Activation and Staging Integration Report

**Date:** 2026-11-25
**Branch:** `phase-1-robustness-safety`
**Foundation commits:** `22308d0`, `5f33c29`, `4769b75`; M7.1 config commit `dcbb7cf`
**Verdict:** **BLOCKED — NOT COMPLETE.** No provider is enabled in the deployed Worker. Two complete cloud workflows did not run, because no replacement credentials were installed and the Galaxy account is not activated. Everything that could be safely prepared or verified without those external approvals was done.

> A blocked integration is reported as blocked. No "working" claim in this document rests on a file
> being created or a unit test passing alone; live claims include the exact command/response and date.

---

## 1. Credential safety (Step 1)

- The previously supplied Galaxy and smarts.bio keys were exposed in public chat during M7 and are
  treated as **compromised**. No further live provider call was made with them during M7.1.
- A secure replacement workflow was added under `scripts/secrets/` and is documented in
  `scripts/secrets/README.md`. It prompts interactively, pipes values directly to
  `npx wrangler secret put <NAME> [--env staging]`, never prints values, never writes them to disk,
  and supports a dry-run that prints secret **names only**. Both installers **default to staging**;
  production must be selected explicitly with `-Environment production` / `--environment production`.
- Staging and production are configured independently: the script requires an explicit environment,
  and all flags default to the string `"false"` in `wrangler.toml` for both environments.
- **No replacement credential is installed yet.** `wrangler secret list --env staging` (2026-11-25)
  showed only `AI_AGENT_TOKEN` and `MOCK_NCBI` — no provider keys and no `ARTIFACT_SIGNING_KEY`.
- **Gate:** providers remain disabled until the owner installs replacements via the supported secret
  workflow. This gate is deliberately unchanged.

---

## 2. Cloudflare environment (read-only inspection, 2026-11-25)

| Check | Command / source | Result |
|---|---|---|
| Authentication | `npx wrangler whoami` | OAuth token for `m.2396@nu.edu.eg`, account `d2209cdaa4e0bfe7fc1cb4bc0bb8b84e`, `workers (write)` present; `billing:write` missing (warning only). |
| D1 before | `npx wrangler d1 list` | Only `smart-bioinformatics-toolkit-blast` (`d277fe22...`) — staging shared production's row space. |
| R2 | `npx wrangler r2 bucket list` | **FAILED**, code `10042`: "Please enable R2 through the Cloudflare Dashboard." R2 cannot be provisioned from this account by Wrangler until the owner enables R2 in the dashboard. |
| Staging secrets | `npx wrangler secret list --env staging` | `AI_AGENT_TOKEN`, `MOCK_NCBI` only. |

### Separate staging D1 — DONE

- Created `smart-bioinformatics-toolkit-staging` in region **WEUR**, id
  `72a07465-f0fe-4d32-93af-72bdc18b0cc0`.
- `wrangler.toml` `[env.staging.d1_databases]` now binds `BLAST_DB` to this database; production still
  binds the original `d277fe22...` database.
- Applied migrations with `--remote` in order `0001`, `0002`, `0003`, `0004`, `0006`, `0007`, then
  `0008_consent_used_at.sql` (additive single-use-consent marker). Final schema reported **20 tables**,
  read back from the live D1 via `SELECT name FROM sqlite_master WHERE type='table'`.
- No production D1 was modified.

---

## 3. Staging deployment with all providers OFF — DONE

`npx wrangler deploy --env staging` succeeded:
- Worker: `smart-bioinformatics-toolkit-staging`
- Version id: `40b89a3c-4534-4c6b-a231-12b1d7b43bb0` (redeployed after the single-use-consent fix;
  earlier version `c1a13785-f3d9-4c34-af00-c555dc573cae`). Flags remained `false` in both deployments.
- URL: `https://smart-bioinformatics-toolkit-staging.m-2396.workers.dev`
- Bindings reported by Wrangler: `BLAST_DB (smart-bioinformatics-toolkit-staging)`, `ASSETS`,
  `GALAXY_ENABLED="false"`, `SMARTSBIO_ENABLED="false"`, `NINEROUTER_ENABLED="false"`.

Live probes (2026-11-25, no credentials, no provider traffic):

| Path | Status | Evidence |
|---|---|---|
| `/` | 200 | HTML served with CSP present |
| `/api/tools` | 200 | 9 tools, `execution_mode: real` |
| `/api/ai/backend` | 200 | honest backend status, `execution_mode: real` |
| `/api/providers` | 200 | 3 providers, **all** `enabled:false`, `availability:"disabled"`, **0 advertised tools** |
| `/api/providers/usage` | 200 | all three providers have empty unit budgets and `emergency.stopped:false` — fail-closed |
| `/api/providers/transfers` | 401 | `Unauthorized agent token.` — ledger is not public |
| `/api/blast/history` | 200 | `count: 0` from the new staging D1 (confirms row-space separation) |
| `/api/unknown` | 404 | JSON error envelope, no static HTML leak |

Additional live POST probes (no side effects because the providers are disabled):
`POST /api/providers/chat` → 403 `Provider 'ninerouter' is disabled.`;
`POST /api/providers/plan` → 403 `Provider 'ninerouter' is disabled.`;
`POST /api/providers/jobs` → 403 `Provider 'galaxy' is disabled.`;
each with `X-Provider` and `X-Error-Detail: {"reason":"feature_flag_disabled"}`.
No provider was enabled by this deployment and no job was submitted.

---

## 4. Galaxy (Step 2) — BLOCKED: account activation

- Previously observed: authenticated read calls succeed, but `POST /api/tools` returns
  **`403 {"error":"Action requires account activation."}`**.
- Live public confirmation (2026-11-25, no key): `GET https://usegalaxy.eu/api/configuration` → 200
  with **`user_activation_on: true`**. Official Galaxy docs describe self-service email confirmation
  (confirmation link / resend verification); see `docs/discovery/M7_1_RESEARCH.md` for source URLs.
  Re-registration or any bypass is not appropriate and was not attempted.
- M7.1 did **not** retry with the compromised key and did **not** attempt to bypass the restriction.
- No provider secret is installed, so the Worker cannot attempt a Galaxy job.
- **Owner action required:** activate the usegalaxy.eu account through the provider's official process,
  then install a rotated `GALAXY_API_KEY` (and `GALAXY_BASE_URL`) with the secrets script. Evidence to
  capture afterwards: `GET /api/users/current` 200, `GET /api/users/current/usage` quota values, one
  small upload, one real tool job id, artifact hash and full provenance.
- Quota values observed in M7 with the old key (`268435456000` bytes primary, `2199023255552` bytes
  scratch, both 0 used) are **historical** and must be re-read after activation before any budget is
  configured. No quota is invented here.
- Galaxy remains the first provider to enable, but is not enabled.

---

## 5. smarts.bio (Step 3) — PRIVATE TESTING ONLY; PUBLIC ACCESS BLOCKED

- The website-facing integration remains disabled: `SMARTSBIO_ENABLED="false"` in both environments
  and an additional `SMARTSBIO_PUBLIC_AUTHORIZED` gate that is absent/false.
- The published terms restrict reselling/sublicensing and developing competing services. **Written
  permission for the intended public website use has not been documented**, so the public feature must
  not be enabled even though an API key previously authenticated.
- Historical private contract facts (M7, 2026-11-25, old key — not re-used in M7.1): workspace
  `794218e2-...`, 92 tools with parameter schemas, pipeline list requires `workspace_id`, no
  documented usage/quota endpoint. Team Free API/compute/storage allowances remain **UNKNOWN**; they
  are not assumed to equal Personal Free.
- The verified AlphaFold lookup (`alphafold-db`, `P04637` → TP53, `AF-P04637-F1`, mean pLDDT 75.06)
  is retained as an opt-in live smoke regression and an offline MOCK regression test. It is not run
  repeatedly on discovery operations.
- No new smarts.bio call was made in M7.1 with the compromised key.

---

## 6. 9Router (Step 4) — BLOCKED: local-only endpoint

- This repository documents 9Router as a **local** OpenAI-compatible proxy at
  `http://127.0.0.1:20128/v1` (`AI_AGENT_ARCHITECTURE.md:223`, `COMPUTE_INFRASTRUCTURE.md:95`).
- Local check on the development machine (2026-11-25, key read from environment, value not printed):
  `GET http://127.0.0.1:20128/v1/models` → **200**, 558 models, sample `auto`, `gemini/gemini-3.7-flash`.
- That endpoint is unreachable from a deployed Cloudflare Worker. The deployed staging Worker has no
  `NINEROUTER_ENABLED`, `NINEROUTER_BASE_URL` or `NINEROUTER_API_KEY` secret, and the adapter contains
  no loopback fallback.
- **Exact remote requirement:** an operator-approved, publicly reachable HTTPS URL with a valid TLS
  certificate, an authentication scheme accepted by the Worker, and reachable `/v1/models`,
  `/v1/chat/completions` and health endpoints; secrets set per environment; verification performed
  **from the deployed staging Worker**, not only from the development machine.
- **Stop condition applied:** no approved remote endpoint exists, so 9Router is explicitly BLOCKED.
  No credential was placed in browser code.

---

## 7. R2 artifact storage (Step 5) — BLOCKED at account level

- R2 is not enabled on the Cloudflare account (`wrangler r2 bucket list` code `10042`). No bucket,
  binding or signing secret could be provisioned. No public bucket was created.
- The implementation (`web-platform/storage/r2.js`, artifact endpoints, migration 0007) is unchanged
  and covered by offline contract tests; no live R2 object was uploaded or downloaded.
- **Owner action required:** enable R2 in the Cloudflare Dashboard, then create separate private
  buckets for staging and production and set `ARTIFACT_SIGNING_KEY` per environment. Until then the
  artifact endpoints fail closed.

---

## 8. Usage governor (Step 6)

- Offline tests cover exhausted budgets, category isolation, release/consume, emergency stop and
  fail-closed unknown totals (exact counts in §10).
- Live staging `/api/providers/usage` returns empty unit maps for all providers — correct fail-closed
  behaviour with no configured totals.
- **No real account limits were configured**: Galaxy's historical quota must be re-read after
  activation; smarts.bio has no documented quota endpoint; 9Router has no quota endpoint. Unknown
  quotas stay `null`.
- Non-atomic D1 reservations remain a documented risk under concurrent writers; the in-memory rate
  limiter is best-effort and not a durable per-user quota.

---

## 9. Controlled enablement and website workflows (Steps 7–8) — NOT PERFORMED

No provider was enabled. Consequently these demonstrations did not run and are **not claimed**:
Galaxy remote phylogenetics, Galaxy FASTQ QC, smarts.bio biological lookup through the website,
AI-generated plan → consent → job → artifact → validation → evidence-bounded explanation → report →
download. The local Python engine and all M6 functionality remain operational and unchanged.

---

## 10. Verification counts

| Check | Exact result (2026-11-25) |
|---|---|
| JavaScript suite (`npm test`, web-platform) | **299 tests, 299 pass, 0 fail, 0 skipped, 0 todo** |
| Python suite (`python -m pytest python-engine/tests -q`) | **240 passed** |
| `node --check` on all new M7.1 JS/MJS | clean |
| Live staging probes | 8/8 as documented in §3, including 3 typed 403 POST probes |
| Independent reviewer | PASS WITH NOTES; no blocking correctness/security finding (findings addressed) |
| Independent tester | see companion validation report; offline only |

**No provider job execution ID and no provider artifact hash was produced in M7.1.** No Galaxy job
ran, no R2 object was uploaded, and no live 9Router chat completion was made. Historical hashes and
quota values from M7 are not M7.1 results.

The in-memory rate limiter and the single-use consent claim are best-effort safeguards, not a durable
per-user quota: a malformed or over-budget submission consumes its consent before validation and is
not restored (fail-closed). A transient provider failure therefore requires the visitor to grant a new
consent. See `scripts/secrets/README.md` and `PROVIDER_USAGE_POLICY.md`.

---

## 11. Blockers, acceptance gates and next steps

| Gate | Status |
|---|---|
| Galaxy executes genuine jobs | **BLOCKED** — account activation + rotated secret |
| smarts.bio permissions and quotas established | **BLOCKED** — written authorization; quotas UNKNOWN |
| 9Router reachable from staging or explicitly blocked | **BLOCKED (explicit)** — local-only endpoint |
| Private artifact storage works | **BLOCKED** — R2 not enabled on account |
| Usage governance verified offline / live | offline PASS; live budget configuration pending |
| Two complete cloud workflows pass | **NOT RUN** |
| Website displays actual provider and job statuses | partial — staging shows honest `disabled` status |
| No secrets exposed | PASS |
| Previous tests remain green | see §10 |
| Independent browser verification | **NOT RUN with live data** — no enabled provider or credentials; offline DOM/contract tests only |

**Owner actions (in order):** rotate the two exposed keys; activate the Galaxy account; enable R2 and
create private buckets; supply an approved remote HTTPS 9Router endpoint; document written smarts.bio
authorization; install all secrets per environment with `scripts/secrets/`; then enable Galaxy only,
run the small real workflow, and proceed provider-by-provider. Production promotion additionally
requires a production D1 (already separate from staging), production secrets and a fresh production E2E.
