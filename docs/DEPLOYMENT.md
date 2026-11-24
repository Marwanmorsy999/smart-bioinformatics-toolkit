# Deployment (Cloudflare Workers)

The control plane deploys as a **standalone Cloudflare Worker**, not a Cloudflare
Pages project. `web-platform/wrangler.toml` points `main` at `web-platform/worker.js`;
that Worker routes every `/api/**` request to the existing `functions/api/**`
`onRequest` handlers and delegates all other paths to the `ASSETS` binding for
`public/`. Static assets are configured with
`assets = { directory = "./public", binding = "ASSETS", run_worker_first = true }`.

The old `pages_build_output_dir = "public"` key was **removed deliberately**:
in Wrangler 4.x its presence marks the configuration as a Pages project and
switches on Pages-specific validation, which conflicts with a `main` + `assets`
Worker deployment. There is no Pages target in this deployment path.

**The orchestrator performs all real (remote) deployment and secret setup.**
Implementation agents do not deploy, create remote resources, or handle secret
values. No secret value may be committed, pasted into a ticket, or written to a
log. This document lists only secret *names*.

All commands below are run from `web-platform/`:

```bash
cd web-platform
```

## 1. Wrangler version and local development

Wrangler 4.168.0 is used via `npx` (it is not a committed dependency of this
project). Start the local Worker with the D1 binding and static assets:

```bash
npx wrangler dev
```

`wrangler dev` reads `wrangler.toml`, serves `public/` through the `ASSETS`
binding, and runs `worker.js` on the Workers runtime with a local D1 database.
Apply local migrations first (section 3) so the API handlers have tables.

## 2. D1 database

The database has already been provisioned on the Free plan; its ID is recorded
in `wrangler.toml` (`database_id` for the `BLAST_DB` binding). Do **not** invent
or overwrite that ID. If a fresh database is ever needed, the creation command is:

```bash
npx wrangler d1 create smart-bioinformatics-toolkit-blast
```

The binding name must remain `BLAST_DB` (handlers read `env.BLAST_DB`) and the
database name must remain `smart-bioinformatics-toolkit-blast`. Wrangler may
suggest a different binding name — ignore that suggestion. The same database
and ID are repeated in `[env.staging]` because Wrangler does **not** inherit
`d1_databases` into named environments.

## 3. Migrations — apply in order 0001 → 0004

Files, in `web-platform/migrations/`:

1. `0001_create_blast_requests.sql` — `blast_requests` table.
2. `0002_ai_platform.sql` — datasets, requests, plans, approvals, jobs, artifacts, tool runs, reports, audit events.
3. `0003_blast_consent.sql` — single-use BLAST consent tokens.
4. `0004_blast_consent_unique.sql` — additive unique indexes on `jobs(plan_id, step_id)` and `approvals(plan_id, step_id)`. It does **not** add a constraint to `blast_consents`; single-use consent is enforced by the atomic claim in `blast/_lib.js`.

Wrangler applies migration files in filename order. Do not renumber or skip a
file: `0002` depends on `0001`, and `0004` is additive to `0003`.

```bash
# local development
npx wrangler d1 migrations apply smart-bioinformatics-toolkit-blast --local

# remote (orchestrator only)
npx wrangler d1 migrations apply smart-bioinformatics-toolkit-blast --remote
```

Migrations are **not** rolled back by a Worker rollback (section 6).

## 4. Secrets and per-environment configuration

Set these with Wrangler's interactive prompt so values never appear in shell
history, process lists, or logs. Never put values in `wrangler.toml`, `.dev.vars`,
source files, or this document.

Required / commonly used names:

- `AI_AGENT_TOKEN` — token the local execution agent presents as `X-Agent-Token`.
- `AI_EXECUTION_MODE` — `real` or `mock`; operator-controlled, authoritative over agent-reported mode.
- `MOCK_NCBI` — set to `1` only for offline demos/tests; no NCBI network calls occur.
- `NCBI_TOOL` — optional NCBI URL API `tool` identifier.
- `NCBI_EMAIL` — optional NCBI URL API `email` contact.

```bash
# production Worker environment
npx wrangler secret put AI_AGENT_TOKEN
npx wrangler secret put AI_EXECUTION_MODE
npx wrangler secret put MOCK_NCBI
npx wrangler secret put NCBI_TOOL      # optional
npx wrangler secret put NCBI_EMAIL     # optional

# staging Worker environment (each environment has its own secrets)
npx wrangler secret put AI_AGENT_TOKEN --env staging
npx wrangler secret put AI_EXECUTION_MODE --env staging
npx wrangler secret put MOCK_NCBI --env staging
npx wrangler secret put NCBI_TOOL --env staging      # optional
npx wrangler secret put NCBI_EMAIL --env staging     # optional
```

For local development only, a gitignored `.dev.vars` file may hold local values;
never commit it and never copy remote values into it.

## 5. Deploy and endpoint verification checklist

Deployment is performed by the orchestrator:

```bash
npx wrangler deploy                 # production Worker
npx wrangler deploy --env staging   # preview/staging Worker
```

After deployment, verify:

- [ ] `GET /` serves the static landing page (HTML from `public/index.html`).
- [ ] `GET /ai.html`, `/blast.html`, `/taxonomy.html`, `/benchmark.html` serve their static pages.
- [ ] `GET /js/...` and `/css/...` return the correct `Content-Type` from the assets binding.
- [ ] `GET /api/tools` → `200` with `{ tools: [...], execution_mode }` and `Content-Security-Policy` / `X-Content-Type-Options: nosniff`.
- [ ] `GET /api/ai/backend` → `200` with honest agent-connection fields.
- [ ] `POST /api/ai/requests` → `200` with `request_id`, `plan_id`, `plan`, `dataset_id`; invalid FASTA → `400`; unclear intent → `422`.
- [ ] `GET /api/ai/plans/:id` → `200` plan or `400` for an invalid id.
- [ ] `POST /api/ai/plans/:id/approve` → `200` with `job_ids`; repeat call is idempotent.
- [ ] `GET /api/ai/jobs` → `401` without the agent token, `200` with it.
- [ ] `POST /api/ai/jobs/:id/result` → `200` with `report_url`/`provenance_url`; hash mismatch → `400`.
- [ ] `GET /api/ai/runs/:id`, `/provenance`, `/report` → `200` after a result is stored; `404` before.
- [ ] `POST /api/blast/submit` → `200` with `{rid,status}` only with a valid consent token; direct POST without consent is rejected.
- [ ] `GET /api/blast/status/:rid` → `200` `{status}`, or `429` with `Retry-After` when polled within one minute.
- [ ] `GET /api/blast/results/:rid` → `200` TSV when complete, `409` when not ready.
- [ ] `GET /api/blast/history` → `200` `{submissions,count,mock}` with no query sequences.
- [ ] `GET /api/does-not-exist` → JSON `404` error envelope (`error`, `execution_mode`), **not** static HTML.
- [ ] An unknown `/api/**` path never returns the site's HTML and never writes a D1 row.

Use a shell variable for the agent token in any client request and never echo
it; e.g. `curl -H "X-Agent-Token: $AGENT_TOKEN" ...` with the value exported out
of band.

## 6. Rollback and redeploy notes

```bash
npx wrangler deployments list
npx wrangler versions list
npx wrangler rollback <version-id>          # optional -m "reason"
npx wrangler rollback <version-id> --env staging
```

- Rollback restores a previous **Worker version** only. It does not undo D1
  migrations, schema changes, or rows written by that version, and it does not
  change secrets. A forward migration is always preferred; repair schema changes
  with a new additive migration rather than reverting SQL.
- After a rollback, re-verify the checklist above, because secrets and D1 state
  still come from the current environment.
- To redeploy the current source, run `npx wrangler deploy` (or with
  `--env staging`) from `web-platform/`. Re-apply migrations with
  `npx wrangler d1 migrations apply smart-bioinformatics-toolkit-blast --remote`
  only if new migration files were added.
- All remote commands in this section are for the orchestrator. Implementation
  agents run only local tests and local development commands.
