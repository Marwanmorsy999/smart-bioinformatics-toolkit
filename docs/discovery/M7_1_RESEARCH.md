# M7.1 Discovery Research — Provider Constraints and Cloudflare Readiness

**Date:** 2026-11-25
**Mode:** Read-only research. No code, tests, configuration, git state or credentials were changed.
**Convention:** Every external claim carries a source URL and access date `2026-11-25`. Local-repo claims cite a local path. Anything not established is marked **UNKNOWN**. No credential value appears in this document.

Sources read first (local): `docs/MILESTONE_M6_FINAL_REPORT.md`, `M7_FINAL_REPORT.md`, `GALAXY_API_INTEGRATION.md`, `SMARTSBIO_API_INTEGRATION.md`, `NINEROUTER_INTEGRATION.md`, plus `docs/M7_1_LIVE_ACTIVATION_REPORT.md`, `web-platform/wrangler.toml`.

---

## 1. Galaxy Europe — "403 Action requires account activation"

### 1.1 What the error is (and is not)

The live usegalaxy.eu instance reports `user_activation_on: true`, `enable_quotas: true`, and the inactivity notice:

> "Your account has not been activated yet.  Feel free to browse around and see what's available, but you won't be able to upload data or run jobs until you have verified your email address."

Source: `https://usegalaxy.eu/api/configuration`, access 2026-11-25. The same instance advertises `terms_url: https://usegalaxy.eu/terms`, `helpsite_url: https://help.galaxyproject.org/c/usegalaxy-eu-support`, `quota_url: https://galaxyproject.org/support/account-quotas/`, and OIDC providers (`lifescience`, `nfdi`, `helmholtz`, `egi_checkin`) with `prefer_oidc_login: false` and `disable_local_accounts: false` (same URL/date).

Official Galaxy configuration semantics (source `https://docs.galaxyproject.org/en/latest/admin/config.html`, access 2026-11-25):

- `user_activation_on`: "User account activation feature global flag. If set to false, the rest of the Account activation configuration is ignored and user activation is disabled (i.e. accounts are active since registration). The activation is also not working in case the SMTP server is not defined."
- `activation_grace_period`: "Activation grace period (in hours). Activation is not forced (login is not disabled) until grace period has passed. Users under grace period can't run jobs. Enter 0 to disable grace period."
- `inactivity_box_content`: "Your account has not been activated yet.  Feel free to browse around and see what's available, but you won't be able to upload data or run jobs until you have verified your email address."

**Interpretation:** a successful `GET /api/users/current` plus a 403 on tool execution is consistent with *authenticated but not yet activated* — an account-state issue, not a bad key and not a quota rejection. Whether OIDC login auto-activates an account is **UNKNOWN** (not stated in the sources above). The 403 does not grant any alternative execution path.

### 1.2 The official activation procedure

Official Galaxy Training Network FAQ (source `https://training.galaxyproject.org/training-material/faqs/galaxy/account_create.html`, access 2026-11-25):

1. "Click on **Register** in the top bar on the server."
2. "Fill in the registration form, then click on **Create**. Your account should now get created, but will remain inactive until you verify the email address you provided in the registration form."
3. "Check for a **Confirmation Email** in the email you used for account creation. Missing? Check your **Trash** and **Spam** folders."
4. "Click on the **Email confirmation link** to fully activate your account."
5. If delivery failed: "Please do **not** register again. Click **Resend Verification** in the banner to get a new confirmation email, or follow the instructions to change the email address registered with your account!"

Galaxy Hub account guidance independently states that terms are "explained in a simple and specific sentence exactly where you clicked on the activation link in the registration email received when the account was first opened" (source `https://galaxyproject.org/support/account-quotas/`, access 2026-11-25). Galaxy config also requires a reachable mailbox: a bounced address triggers retention steps; the owner can update it under *User → User Preferences* (source `https://raw.githubusercontent.com/galaxyproject/galaxy-hub/main/content/news/2026/2026-09-07-eu-updated-terms-of-service/index.md`, access 2026-11-25).

**Admin approval:** no official source found that says usegalaxy.eu requires manual admin approval for ordinary registration; it appears to be self-service email verification. Whether any specific account needs operator intervention is **UNKNOWN**; contact `contact@usegalaxy.eu` (published in the instance's GDPR documentation, `https://usegalaxy.eu/terms`, access 2026-11-25) if the link/resend flow fails.

### 1.3 What is explicitly NOT permitted (no bypass)

- Live instance registration warning: "Please register only one account to ensure fair sharing of computational resources. Multiple registrations are monitored and will result in account termination and data deletion." (source `https://usegalaxy.eu/api/configuration`, access 2026-11-25).
- "Do not allow other people to log into or use your account, for any reason. Do not log into other people's accounts. Both can lead to duplicated account issues. Use Galaxy's built-in share functions for collaborative work." — "Creating another account is not the solution — the new account will also be detected up as a duplicate and removed." (source `https://galaxyproject.org/support/account/`, access 2026-11-25).
- Revised UseGalaxy.eu Terms took effect 2026-09-07. Official Galaxy Hub announcement (source `https://raw.githubusercontent.com/galaxyproject/galaxy-hub/main/content/news/2026/2026-09-07-eu-updated-terms-of-service/index.md`, canonical `https://galaxyproject.org/news/2026/2026-09-07-eu-updated-terms-of-service/`, access 2026-11-25) states verbatim: "abusive behaviour, increasingly enabled by 'AI' tooling, is a daily challenge for our administrators"; acceptable use is "science, research, and education"; prohibited uses include "running non-scientific cryptography applications, processing data from illegitimate sources, using compute resources solely to generate revenue, and any activity that constitutes a (cyber)crime"; and "When our systems detect abusive behaviour, they may **temporarily disable access automatically** to protect the Service." Human review is available via `contact@usegalaxy.eu`. Inactivity: 12 months without login → notice → deactivation after one month; data deleted six months after deactivation; 10 years → account record deleted.
- The instance's `terms_url` resolves to `https://usegalaxy.eu/terms` → GDPR documentation index (source `https://usegalaxy.eu/terms`, `https://usegalaxy.eu/gdpr/tos`, access 2026-11-25). The full ToS body did not render through the read-only fetch; its exact clauses beyond the announcement summary are **UNKNOWN** and must be read in a browser before enabling automated submissions.
- **Prohibited here:** re-registering to sidestep activation, using/borrowing another account, fabricating activation, or submitting jobs through a different account while this one is inactive. This research did **not** attempt activation, resend, impersonation or any bypass.

### 1.4 Quotas and limits

- "Each Galaxy server is independent. How much disk space to allocate for end users is determined by the administrators of that server." The 250 GB registered / 5 GB unregistered figures on that page are explicitly for **usegalaxy.org**, not usegalaxy.eu (source `https://galaxyproject.org/support/account-quotas/`, access 2026-11-25).
- usegalaxy.eu quota sources are exposed (`GET /api/quotas`, `GET /api/users/{user_id}/usage`, `GET /api/users/{user_id}/objectstore_usage`; `GALAXY_API_INTEGRATION.md` §3), and `enable_quotas: true` is live (`https://usegalaxy.eu/api/configuration`, access 2026-11-25).
- Per-account **concurrent-job limit for usegalaxy.eu is UNKNOWN**; no official usegalaxy.eu number was published in the sources consulted. Historical M7 values (primary 268435456000 bytes, scratch 2199023255552 bytes, both 0 used) came from the now-compromised key and are stale; see `docs/M7_1_LIVE_ACTIVATION_REPORT.md` §4. No "Galaxy credits" exist — governor totals must come from re-read bytes/concurrency, never invented.

### 1.5 Owner action and evidence to capture

1. Owner checks the registered mailbox (including Spam/Trash), clicks the **email confirmation link**, or uses **Resend Verification** / changes the registered email — never a second account (sources in §1.2–1.3).
2. Owner installs a **rotated** `GALAXY_API_KEY` (and `GALAXY_BASE_URL` if required) per environment through `scripts/secrets/`; the old exposed key is not reused (`docs/M7_1_LIVE_ACTIVATION_REPORT.md` §1, §4).
3. Minimum evidence after activation:
   - `GET https://usegalaxy.eu/api/users/current` → **200** with the account identity (proves the key is valid).
   - **One small real tool execution** — create a dedicated history, submit a tiny input, record the returned **job id**, terminal state, artifact name, byte count and SHA-256/full provenance. The 403 must be gone before any job is claimed.
   - Recommended additions: `GET /api/users/current/usage` (fresh quota bytes) and one download/hash check; configure governor totals only from those observed values via owner-only `POST /api/providers/budget`.
4. Until steps 1–3 complete, Galaxy stays disabled and no Galaxy job is claimed.

---

## 2. smarts.bio — published terms, API restrictions and allowances

All sources in this section accessed **2026-11-25**.

### 2.1 Sources

| Source | Observation |
|---|---|
| `https://www.smarts.bio/terms` | Terms of Use **v1.1, Last Updated: 4 October 2026** |
| `https://www.smarts.bio/pricing` | Personal Free/Pro/Max numbers; "Team" tab present but empty in rendered and raw HTML |
| `https://www.smarts.bio/docs/getting-started` | "Keep it safe. Never commit API keys to source control. Use environment variables or a secrets manager." |
| `https://www.smarts.bio/docs/authentication` | Key format, `Authorization`/`X-API-Key`, scopes, workspace scoping |
| `https://www.smarts.bio/security` | "API keys are stored only as hashes, shown to you once, scoped and revocable."; last reviewed 4 October 2026 |
| `https://www.smarts.bio/openapi.json` | OpenAPI 3.1, 32 paths; no `usage`/`quota` path |
| `https://www.smarts.bio/llms.txt`, `https://www.smarts.bio/llms-full.txt` | Official full docs text; concurrency and 402 `quota_exceeded` documented |

### 2.2 Exact restrictions relevant to a public website

From Terms of Use v1.1 §5 **Prohibited Uses** (`https://www.smarts.bio/terms`, access 2026-11-25), verbatim bullets:

> "Resell or sublicense the Service"
> "Develop competing products/services"
> "Circumvent usage limits, security measures, or export laws"
> "Reverse engineer or attempt unauthorized access"
> "Spam, phishing, scrape, or harvest data"
> "Circumvent institutional account requirements by registering multiple individual accounts from the same organization"

Other relevant clauses (same URL/date): §3 "one person = one account" and "No impersonation or multiple free accounts to bypass limits"; §2A/§3A six-or-more users from one organization may require an MSA/DPA, "Institutional pricing and liability terms will apply retroactively from the date we notify you of the requirement" and service may be suspended until executed; §9 "Research only; verify results; uptime not guaranteed"; §16 "waivers must be in writing".

**Assessment (not a legal opinion):** this project is itself an analysis platform with natural-language objective → plan → execution → reporting and overlapping capabilities. Exposing a smarts.bio-backed path to third parties could plausibly be read as **developing/operating a competing service** and/or **reselling or sublicensing**. No written authorization is documented (local `M7_FINAL_REPORT.md` §2.2, `docs/M7_1_LIVE_ACTIVATION_REPORT.md` §5). Therefore website-facing access must remain **DISABLED**.

### 2.3 API keys in browser code / public API-backed access

- Official guidance: "Keep it safe. Never commit API keys to source control. Use environment variables or a secrets manager." and the recommended pattern is loading the key from an environment variable (`https://www.smarts.bio/docs/getting-started`, `https://www.smarts.bio/docs/authentication`, access 2026-11-25).
- Keys are organization-scoped, have `query`/`tools`/`conversations`/`files` scopes and can be restricted to workspaces; revocation propagates within 30 seconds (`https://www.smarts.bio/docs/authentication`, access 2026-11-25).
- The TypeScript SDK is documented as working "in Node.js 18+ and modern browsers" (`https://www.smarts.bio/llms-full.txt`, access 2026-11-25). **No published sentence was found that explicitly permits embedding a live key in browser code for a public website, and none found that explicitly forbids it — that specific point is UNKNOWN.** Either way, a browser-visible key would expose the organization credential and is not the documented recommended pattern; keeping keys server-side remains mandatory.
- **Permitted now:** private contract testing in the owner's own account, evaluation only, no third-party data, no service offered to others, no limit bypass, no secrets in files/logs (`https://www.smarts.bio/terms` §5 and local `SMARTSBIO_API_INTEGRATION.md` §3; access 2026-11-25). That does **not** authorize a public integration.

### 2.4 Team Free vs Personal Free — published numbers

From `https://www.smarts.bio/pricing` (access 2026-11-25):

- **Personal Free ($0):** "2 compute hours per month", "1,000 API calls per month", "10GB storage", "1 active project", "Community support".
- Personal Pro ($25/mo): 20 h, 10,000 calls, 100 GB, 10 active projects. Personal Max ($100/mo): 100 h, 100,000 calls, 1 TB, unlimited active projects.
- FAQ: "Team Pro requires a minimum of 3 users, while Team Max requires a minimum of 5 users. Enterprise plans start at 50 users."; 14-day trial on Pro/Team Pro; 10–30% volume discounts for 50+ users, edu/gov/nonprofit.
- **Team Free: UNKNOWN.** The rendered page and raw HTML contain a "Team" tab toggle but an empty Team panel; no Team Free compute-hour, API-call, storage or project numbers are published (same URL/date). Team Free must not be assumed equal to Personal Free.
- Published concurrency: "Each organization runs at most 5 compute tasks at once; further steps wait in `queued`" and the limits table "Concurrent compute tasks per organization | 5" (`https://www.smarts.bio/llms-full.txt`, access 2026-11-25). This is a vendor-documented limit, not a verified run.
- **Account-level usage/quota endpoint: NOT DOCUMENTED.** The 32-path OpenAPI spec has no usage/quota/billing path (`https://www.smarts.bio/openapi.json`, access 2026-11-25); the only related published signal is the 429 `RateLimited` response: "Rate limit or monthly quota exceeded. Inspect `RateLimit-Remaining` and `Retry-After` headers." (same URL/date) and 402 `quota_exceeded` = "Organization compute quota exhausted" (`https://www.smarts.bio/llms-full.txt`, access 2026-11-25). Live `GET /v1/usage` and `GET /v1/workspaces/:id/usage` returned 404 in M7 (`SMARTSBIO_API_INTEGRATION.md` §7).

**Numeric limits still UNKNOWN:** Team Free API calls/month, compute hours/month, storage and active projects; connected account's used/remaining counters and plan tier; fixed requests-per-second limit; per-tool compute-hour cost and output retention.

### 2.5 Conclusion

**Website-facing smarts.bio access cannot be enabled: NO** until written authorization exists. Keep `SMARTSBIO_ENABLED=false` and the independent `SMARTSBIO_PUBLIC_AUTHORIZED` gate absent/false in every environment; store any key only as a server-side Cloudflare secret with least-privilege scopes; enforce workspace scoping and per-step consent; pass all results through the M6 validation/evidence gate. Private testing only, and only under the flag + gate.

---

## 3. 9Router — remote connectivity requirement and staging verification

### 3.1 Workspace state

No 9Router endpoint URL, credential or approved deployment exists in this workspace (`NINEROUTER_INTEGRATION.md` §1; `docs/M7_1_LIVE_ACTIVATION_REPORT.md` §6). A historical local proxy at `http://127.0.0.1:20128/v1` is documented in old repo files but is a loopback address, is not a deployable Worker endpoint and is not carried forward as current. Endpoint, model set, quotas and latency are **UNKNOWN**.

### 3.2 Cloudflare-side constraints (official)

All sources accessed 2026-11-25:

- Workers outbound requests are mediated: "all outbound HTTP requests are sent over a UNIX domain socket to a local proxy service. That service implements restrictions on the request. For example, it verifies that the request is either addressed to a public Internet service or to the Worker's zone's own origin server, not to internal services that might be visible on the local machine or network." (`https://developers.cloudflare.com/workers/reference/security-model/`).
- "Your socket is connecting to an address that was disallowed. Examples of a disallowed address include Cloudflare IPs, localhost, and private network IPs." (`https://developers.cloudflare.com/workers/runtime-apis/tcp-sockets/`).
- "For Workers subrequests, requests can only be made to URLs, not to IP addresses directly." (`https://developers.cloudflare.com/workers/platform/known-issues/`).
- "Workers subrequests to any hostname outside your Cloudflare zone that is not proxied by Cloudflare are always made using the **Full (strict)** SSL mode, regardless of the Workers zone configuration." → a CA-valid, unexpired, complete-chain certificate matching the hostname is required (`https://developers.cloudflare.com/support/troubleshooting/http-status-codes/cloudflare-5xx-errors/error-526/`).
- "Automated clients that send some default library User-Agent headers (for example, the default Python urllib user agent) receive error 1010 before your Worker runs." Use a descriptive `User-Agent` when probing (`https://developers.cloudflare.com/workers/configuration/routing/workers-dev/`).
- `wrangler secret put` "creates a new version of the Worker and deploys it immediately"; secrets are encrypted bindings, not plaintext `vars`, and `.dev.vars`/`.env` must not be committed (`https://developers.cloudflare.com/workers/configuration/secrets/`).

### 3.3 Exact endpoint contract

An operator-approved endpoint must provide:

1. Publicly resolvable **HTTPS hostname** with a valid TLS certificate — no `localhost`, `127.0.0.1`, private/RFC1918 IP, or raw-IP URL.
2. **Server-side authentication** via a header (key held only as a Cloudflare secret); never from the browser, code, repository or log.
3. A cheap authenticated **health** route and **model discovery** (e.g. `/v1/models`) returning a concrete list.
4. **Chat completion** and **structured JSON** output with strict schema validation, plus SSE-style **streaming** with a terminating event.
5. Explicit **connect and total-request timeouts** with bounded backoff; a dead provider fails closed to the deterministic path.
6. **Token/prompt/completion usage** in responses, and provenance recording the exact server-provided model id, timestamp and latency.
7. Scope constraint unchanged from M5/M6: phrasing aid only; validated text/numbers in, never raw uploaded sequences; every LLM string still passes the deterministic number/citation gate.

### 3.4 Verification FROM the deployed staging Worker

Nothing is enabled until an operator does all of the following **from the deployed staging Worker**, not merely the dev machine (source `NINEROUTER_INTEGRATION.md` §3; Cloudflare constraints §3.2 above):

1. Confirm `NINEROUTER_BASE_URL` is HTTPS, resolves from the Worker, and presents a valid TLS chain (no 526).
2. Confirm `NINEROUTER_API_KEY` authenticates and the health/model-discovery call succeeds from the Worker.
3. Copy the **exact** server-provided model id into an operator record; do not hard-code a guessed default.
4. Make one chat-completion call returning valid structured JSON; make one streaming call that emits a terminating event.
5. Confirm token-usage fields are readable and map to the usage ledger.
6. Simulate an unreachable endpoint: fail closed to deterministic explanation with a rejection flag; scientific artifact hashes unchanged.
7. Record access date, endpoint host (never the key), model id and observed latency in `docs/discovery/`.

**Stop condition:** no approved remotely reachable endpoint exists; 9Router is **BLOCKED** and no model name, quota, endpoint or token price is asserted.

### 3.5 Secrets — exact commands, placeholders only

Run interactively as the owner; values are typed at the prompt, never printed, pasted into files or committed. `NINEROUTER_ENABLED` is a boolean flag defaulting to `false`, not a secret.

```sh
# staging
npx wrangler secret put NINEROUTER_API_KEY  --env staging
npx wrangler secret put NINEROUTER_BASE_URL --env staging   # <OWNER-SUPPLIED-HTTPS-BASE-URL>
npx wrangler secret put NINEROUTER_MODEL    --env staging   # <OWNER-SUPPLIED-DISCOVERED-MODEL-ID> (optional)

# production
npx wrangler secret put NINEROUTER_API_KEY
npx wrangler secret put NINEROUTER_BASE_URL                 # <OWNER-SUPPLIED-HTTPS-BASE-URL>
npx wrangler secret put NINEROUTER_MODEL                    # <OWNER-SUPPLIED-DISCOVERED-MODEL-ID> (optional)
```

Never place values in `wrangler.toml`, a committed `.dev.vars`, browser bundles, plan/job JSON or documentation (`https://developers.cloudflare.com/workers/configuration/secrets/`, access 2026-11-25).

---

## 4. Cloudflare account facts supplied by the orchestrator, and M7.1 gate consequences

**Source note:** these are **orchestrator-supplied read-only `wrangler` inspection facts dated 2026-11-25**, not public URLs. This research did not re-run `wrangler`, did not print or store credentials, and did not change any Cloudflare resource.

| Fact (orchestrator, 2026-11-25) | Exact consequence for M7.1 |
|---|---|
| Account `d2209cdaa4e0bfe7fc1cb4bc0bb8b84e` | Identifies the target account for every `wrangler` command; it is an identifier, not a credential. All enablement actions must be verified against this account. |
| `wrangler r2 bucket list` fails with code **10042** — "Please enable R2 through the Cloudflare Dashboard" | R2 cannot be provisioned from this account via Wrangler. Private artifacts gate **BLOCKED**: no bucket, no `ARTIFACTS` binding, no `ARTIFACT_SIGNING_KEY`; signed upload/download and user deletion endpoints fail closed. Neither of the two complete cloud workflows can pass because no artifact can be stored, hashed on download or delivered. Owner must enable R2 in the dashboard first. |
| Only one D1 database `smart-bioinformatics-toolkit-blast` existed; staging shared it (baseline snapshot) | Staging/production row-space separation gate **FAILS** for that baseline: live E2E in staging would write into production data and production promotion is forbidden. Note a local-file discrepancy: `web-platform/wrangler.toml:44-49` declares a separate staging D1 `smart-bioinformatics-toolkit-staging`, and `docs/M7_1_LIVE_ACTIVATION_REPORT.md` §2 records it as created and bound, so the "shares it" observation is the earlier snapshot. This research snapshot is historical: `docs/M7_1_LIVE_ACTIVATION_REPORT.md` §2–§3 records the new database as created, migrated and bound, and a live staging probe (`/api/blast/history` → count 0) confirming the deployed Worker uses it. Do not rely on the earlier snapshot. |
| Staging secrets are only `AI_AGENT_TOKEN` and `MOCK_NCBI` | No `GALAXY_API_KEY`, `SMARTSBIO_API_KEY`, `NINEROUTER_*` or `ARTIFACT_SIGNING_KEY` exists in staging. All providers therefore fail closed and no live provider call can be made by the Worker; the "genuine Galaxy job", "smarts.bio lookup through website", "9Router from staging" and "private artifacts work" gates cannot pass. `MOCK_NCBI=1` also means staging results are expected to be labelled mock until deliberately changed. Owner must install rotated, per-environment secrets via the supported workflow. |

**Gate summary implied by the above:** Galaxy execution **BLOCKED** (activation + rotated secret); smarts.bio **BLOCKED** (written authorization, unknown quotas); 9Router **BLOCKED** (no approved remote endpoint); R2 artifacts **BLOCKED** (account not enabled); live governor budget configuration **PENDING** (unknown real totals); two complete cloud workflows **NOT RUN**; no secrets exposed **PASS** as of the supplied snapshot.

---

## 5. Limitations and unfinished edges

- Web search was unavailable this session (HTTP 402); all external sources were fetched by direct URL on 2026-11-25 and are recorded above.
- The usegalaxy.eu ToS page rendered only the GDPR index; its full text was not retrievable read-only. The quoted ToS content comes from the official Galaxy Hub announcement, with the ToS URL recorded; exact clause wording beyond that summary is **UNKNOWN**.
- No provider activation, resend, bypass, live provider call or secret installation was attempted. No key value appears here.
- No code, test, other document or git state was modified; only this file was created.
- The office dashboard command `D:\Apps\Star-Office-UI\office-status.cmd` is absent on this host, so the required status updates could not be executed (environmental, already noted in `docs/MILESTONE_M6_FINAL_REPORT.md` §10 and `M7_FINAL_REPORT.md` §6).
