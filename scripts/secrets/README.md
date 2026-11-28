# Provider secrets (public-repository safe)

**Any credential that has been exposed must be rotated at the provider before installation.**
This directory contains the install half of the rotation only; it never
contains, prints, derives, or stores a credential value. Never paste a key into chat,
a ticket, a shell command line, or a file.

## Files

- `set-provider-secrets.ps1` — Windows PowerShell (interactive, `Read-Host -AsSecureString`).
- `set-provider-secrets.sh` — POSIX sh (interactive, hidden terminal input / `read -s`).

Both scripts accept:

| Option | Values | Default |
| --- | --- | --- |
| `-Environment` / `--environment` | `staging`, `production` | `staging` |
| `-Provider` / `--provider` | `galaxy`, `smartsbio`, `ninerouter`, `storage`, `all` | `all` |
| `-WhatIf` (PowerShell) / `--dry-run` (POSIX) | flag | off |

`-WhatIf` / `--dry-run` prints **only the secret names** that would be touched,
prompts for nothing, and makes no network call. Use it to review scope first.

Secret names by provider:

- `galaxy`: `GALAXY_BASE_URL`, `GALAXY_API_KEY`
- `smartsbio`: `SMARTSBIO_ENABLED`, `SMARTSBIO_BASE_URL`, `SMARTSBIO_API_KEY`,
  `SMARTSBIO_WORKSPACE_ID`, `SMARTSBIO_PUBLIC_AUTHORIZED`
- `ninerouter`: `NINEROUTER_ENABLED`, `NINEROUTER_BASE_URL`, `NINEROUTER_API_KEY`,
  `NINEROUTER_MODEL`, `NINEROUTER_TIMEOUT`. Only `NINEROUTER_BASE_URL` and
  `NINEROUTER_API_KEY` are credentials; `NINEROUTER_ENABLED`, `NINEROUTER_MODEL`
  and `NINEROUTER_TIMEOUT` are flags/settings (in `wrangler.toml`, not secrets).
- `storage`: `ARTIFACT_SIGNING_KEY`

## Rotation order

1. **Rotate at the provider first.** Create replacement credentials in the provider's
   own dashboard. Revoke any previously exposed ones before installing.
2. Review scope: `./set-provider-secrets.sh --dry-run` (or `-WhatIf` on PowerShell).
3. Install into **staging**: `--environment staging`. The script passes
   `--env staging` to `wrangler secret put`.
4. Verify with the opt-in live smoke harness (see
   `docs/discovery/M7_1_LIVE_SMOKE.md`). Never paste a key into chat, a ticket,
   a shell command line, or a file.
5. Install into **production**: `--environment production`. Production uses the
   unqualified `wrangler secret put <NAME>` — **no `--env` flag**.

## Independence of staging and production

Secrets are stored per Cloudflare environment. Installing into staging does
**not** change production, and vice versa; run the script twice, once per
environment, with the replacement values. Treat production installation as the
step that actually closes the incident.

Deployment note: as of 2026-11-25 **staging uses its own D1 database**
(`smart-bioinformatics-toolkit-staging`, `72a07465-f0fe-4d32-93af-72bdc18b0cc0`)
and production keeps the original `smart-bioinformatics-toolkit-blast` database.
Earlier M6 reports described a shared database; that is no longer current.
Credentials and application data are therefore isolated per environment.

**Feature flag vs provider availability.** A feature flag being enabled does **not**
mean a provider endpoint is reachable or configured. `GALAXY_ENABLED`,
`SMARTSBIO_ENABLED`, `NINEROUTER_ENABLED`, `SMARTSBIO_PUBLIC_AUTHORIZED` are
feature flags in `web-platform/wrangler.toml`, not credentials. Do not claim a
provider is live merely because a flag is `true`. Provider readiness also
requires the endpoint base URL and API key secrets to be set AND a live smoke
check to pass; absent any of those, treat the provider as unconfigured/unreachable.

## 9Router (Ninerouter) reconciliation

`web-platform/wrangler.toml` currently has, on staging, `NINEROUTER_ENABLED=true`,
`NINEROUTER_MODEL="auto"`, `NINEROUTER_TIMEOUT="60"`; production has
`NINEROUTER_ENABLED=false`. The secrets that make the provider usable are
`NINEROUTER_BASE_URL` and `NINEROUTER_API_KEY` (per-environment); without them
the provider is not reachable even when the flag is `true`. `NINEROUTER_MODEL`
and `NINEROUTER_TIMEOUT` are settings, not secrets. The remote base URL and API
key are staging-only secrets; never print them. Operators should only enable
this once an endpoint is owned/operated by them and a live smoke check passes.

## Flags default off

`SMARTSBIO_ENABLED`, `SMARTSBIO_PUBLIC_AUTHORIZED`, and production `GALAXY_ENABLED`
/`NINEROUTER_ENABLED` default to `false`. They must be `false` unless the
operator deliberately opts in. Staging values in `wrangler.toml` differ by
environment; inspect the actual `[env.*]` block. smarts.bio API access requires
written provider authorization: leave `SMARTSBIO_PUBLIC_AUTHORIZED=false` until
that exists. Galaxy has no separate enable flag in these scripts; `GALAXY_ENABLED`
is in `wrangler.toml`, separate from the `GALAXY_BASE_URL`/`GALAXY_API_KEY`
secrets installed by this script.

## R2 / artifact storage

The Cloudflare account's R2 status is not verified here. `ARTIFACT_SIGNING_KEY`
can be installed but artifact upload/download remains unavailable until a
private bucket is bound; no R2 bucket is activated by this script and no public
bucket is assumed.

## Safety properties

- Secrets are read from the terminal only; a non-interactive stdin is refused.
- Values travel through the child process stdin, never through argv.
- Commands printed or logged contain secret **names** only.
- Nothing is written to disk by either script (no `.env`, no temp files, no
  shell history entries with a value).
- Both scripts `cd` into `web-platform/` so `wrangler.toml` is found regardless
  of the caller's working directory.

Do not add credential values to this directory, to tests, or to fixtures.
MOCK fixtures under `web-platform/tests/fixtures/providers/` are synthetic by
design and must stay that way.
