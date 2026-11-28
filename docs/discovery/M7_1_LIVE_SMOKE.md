# M7.1 opt-in live smoke harness

`scripts/live-smoke/provider-live-smoke.mjs` is a **manual, opt-in** check of
provider reachability and response shapes. It is never part of `npm test`, never
runs automatically, and never contacts a provider unless the operator has set
the configuration described below.

The harness reads **all** configuration from `process.env`. There are no
hardcoded endpoints, credentials, workspaces, or models in the script. Every
line of output is prefixed `[LIVE]` (a call was attempted) or `[SKIPPED]`
(missing configuration or suppressed). Output contains HTTP status codes, item
counts and `OK`/`MISMATCH` flags only: request headers, values and response
bodies are never printed, and known secret values are scrubbed defensively.

## Invocation

From the repository root (Node >= 22.5):

```sh
# Review what is configured; nothing is contacted if variables are missing.
node scripts/live-smoke/provider-live-smoke.mjs

# One provider only.
node scripts/live-smoke/provider-live-smoke.mjs --provider galaxy

# Avoid spending credits on repeated discovery (recommended).
node scripts/live-smoke/provider-live-smoke.mjs --once
```

On Windows PowerShell use the same command with `node`. Arguments:

| Flag | Meaning |
| --- | --- |
| `--provider galaxy\|smartsbio\|ninerouter` | Restrict the run; default is all three. |
| `--once` | Skip if a previous discovery finished less than 30 minutes ago. |
| `--help` | Print usage; contacts nothing. |

## Configuration (names only - no values belong in docs, files or chat)

Galaxy — requires both:

- `GALAXY_BASE_URL`
- `GALAXY_API_KEY`

smarts.bio — requires all three **and** the written-authorization gate:

- `SMARTSBIO_BASE_URL`
- `SMARTSBIO_API_KEY`
- `SMARTSBIO_WORKSPACE_ID`
- `SMARTSBIO_PUBLIC_AUTHORIZED=true`

If the gate is not exactly `true`, smarts.bio is reported as `[SKIPPED]` and no
request is sent. This is deliberate: smarts.bio is a direct competitor and the
public API may not be used without written authorization.

9Router — requires both (no endpoint exists yet, so expect `[SKIPPED]`):

- `NINEROUTER_BASE_URL`
- `NINEROUTER_API_KEY`
- `NINEROUTER_MODEL` (optional; when set, the harness checks that the model is advertised)

Optional tuning:

- `LIVE_SMOKE_TIMEOUT_MS` (request timeout, default 15000)
- `LIVE_SMOKE_CACHE_DIR` (override the `--once` marker directory; must stay outside the repo)
- `LIVE_SMOKE_ALPHAFOLD_TOOL`, `LIVE_SMOKE_UNIPROT_ID`,
  `LIVE_SMOKE_EXPECTED_GENE`, `LIVE_SMOKE_EXPECTED_UNIPROT_ID`,
  `LIVE_SMOKE_EXPECTED_MODEL_PREFIX`, `LIVE_SMOKE_UPLOAD_FILENAME`
  (regression constants with safe defaults)

Install replacement values with the interactive scripts in `scripts/secrets/`.
Never paste a value into this document, a test, a fixture, a shell command line,
or a ticket.

## What is called

Read-only, metadata-only requests:

- Galaxy: `GET /api/version`, `GET /api/tools`, `GET /api/workflows`,
  `GET /api/users/current/usage`.
- smarts.bio: `GET /v1/workspaces`, `GET /v1/tools`, and one AlphaFold DB lookup
  via `POST /v1/tools/alphafold-db/run` (body uses the singular `input` key).
- 9Router: `GET /v1/models` only — no chat/completion call, so no credits.

The AlphaFold lookup is a query, not a workflow run, but it is an external call:
use `--once` to prevent repeated discovery from consuming credits. The
regression check asserts gene `TP53`, `uniprot_id` `P04637`, a `model_identifier`
starting with `AF-P04637`, and at least one returned artifact path. A failed
check sets a non-zero exit code.

### The one write path

Nothing is written unless **all** of the following hold: Galaxy is selected and
configured, and `LIVE_WRITE=1` is set in the environment. In that case the
harness creates one small history and uploads one tiny FASTA text through
Galaxy's `upload1` API primitive. It never invokes a scientific workflow. With
`LIVE_WRITE` unset (the default and recommended state) the harness prints
`[SKIPPED] galaxy WRITE` and performs no write at all.

## `--once` guard

With `--once`, a short marker (`m7-1-live-smoke-once.json`, containing only a
timestamp) is written to `D:\DevCache\Temp\opencode`, which is outside this
repository. A later `--once` run within 30 minutes prints `[SKIPPED]` for every
selected provider and makes no call. The harness refuses to start if the
resolved cache directory is inside the repository. The marker contains no
credential or response data.

## Known environment limits

- The Cloudflare account has **R2 disabled** (`wrangler r2 bucket list` fails
  with error 10042). Artifact storage handlers therefore fail closed in
  staging/production until a private bucket is bound; the offline tests cover
  them with an injected fake bucket.
- **Staging and production use separate D1 databases** as of 2026-11-25
  (`72a07465-…` vs `d277fe22-…`). Earlier documentation about a shared row space
  is historical. Do not use live smoke writes as a data-cleansing test.
- **No 9Router endpoint exists** at the time of writing, so that provider is
  expected to be `[SKIPPED]` even when the flag is enabled.

## Offline coverage

`npm test` in `web-platform/` runs the `m7_1_*.test.mjs` files entirely offline
using a fake D1 and injected `fetch`. They never need this harness or any
credential.
