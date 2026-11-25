# M7.1 replacement-credential workflow

The Galaxy and smarts.bio keys previously shared in chat are **compromised**.
This directory contains the install half of the rotation only; it never
contains, prints, derives, or stores a credential value.

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
  `NINEROUTER_MODEL`, `NINEROUTER_TIMEOUT`
- `storage`: `ARTIFACT_SIGNING_KEY`

## Rotation order

1. **Rotate at the provider first.** Create a new Galaxy API key and new
   smarts.bio credentials in their own dashboards. Revoke the exposed ones.
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

Other current constraints recorded for this milestone: the Cloudflare account
has **R2 disabled** (`wrangler r2 bucket list` fails with error 10042), so
`ARTIFACT_SIGNING_KEY` can be installed but artifact upload/download remains
unavailable until a private bucket is bound; and **no 9Router endpoint exists**
yet, so 9Router credentials should not be installed until an endpoint is owned
by the operator.

## Flags default off

`SMARTSBIO_ENABLED`, `SMARTSBIO_PUBLIC_AUTHORIZED`, and `NINEROUTER_ENABLED`
are feature flags, not credentials. They must be installed as the literal
string `false` unless the operator deliberately opts in. In particular,
smarts.bio is a direct competitor and its API access requires written provider
authorization: leave `SMARTSBIO_PUBLIC_AUTHORIZED=false` until that exists.
Galaxy has no enable flag in these scripts; its base URL and key are enough.

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
