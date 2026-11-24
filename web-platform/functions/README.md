# Remote BLAST Pages Functions

These Cloudflare Pages Functions provide an asynchronous remote BLAST backend for the
16S RefSeq database. They are plain ES modules with no framework, no R2 bucket and no
paid services — Cloudflare **Free** (Pages + D1) is sufficient.

## Endpoints

All endpoints live under `/api/blast/`. Responses are JSON except `/results`, which is
plain text. Every response sets a restrictive `Content-Security-Policy`, `nosniff` and
`no-store`, and CORS is echoed only for same-origin requests.

| Method | Path | Description |
| --- | --- | --- |
| `POST` | `/api/blast/submit` | Validate a FASTA job and queue a BLAST search. Body: `{"fasta": ">id\\nACGT...", "database": "16S_ribosomal_RNA", "program": "blastn"}`. Returns `{"rid", "status"}`. |
| `GET` | `/api/blast/status/:rid` | Check job status. Server-side rate limit: at most once per minute per RID (HTTP 429 with `Retry-After` otherwise). Returns `{"status"}`. |
| `GET` | `/api/blast/results/:rid` | Return cached tabular TSV (`Content-Type: text/plain`) once status is `complete`; otherwise HTTP 409. |
| `GET` | `/api/blast/history` | List recent submissions as `{"submissions": [{rid, status, created_at}], count, mock}`. Query sequences are never returned. |

All endpoints accept `OPTIONS` for CORS preflight and reject other methods with HTTP 405.

### Validation

- FASTA must be at most 10,000 characters, start with a `>` header, contain one or more
  records, and use only the ACGT/IUPAC nucleotide alphabet (case-insensitive).
- `database` must be exactly `16S_ribosomal_RNA`; `program` must be exactly `blastn`.
- Only a SHA-256 `input_hash` of the FASTA is stored. The sequence itself is never written
  to D1, logged, or returned by any endpoint.

### NCBI URL API

Verified parameters from `docs/NCBI_API_NOTES.md` are used: submission with
`CMD=Put`, `QUERY`, `DATABASE`, `PROGRAM=blastn`, `MEGABLAST=on`, `EXPECT`,
`HITLIST_SIZE`, `FILTER` and `FORMAT_TYPE`; status with `CMD=Get&RID=...`; results with
`CMD=Get&RID=...&FORMAT_TYPE=Text&ALIGNMENT_VIEW=Tabular`. Requests identify the client
with the `tool` and `email` parameters. Transient NCBI failures are retried with backoff;
the full submission URL (which contains the FASTA) is never logged.

## Environment variables

| Variable | Purpose |
| --- | --- |
| `NCBI_TOOL` | Value of the NCBI URL API `tool` parameter. |
| `NCBI_EMAIL` | Value of the NCBI URL API `email` parameter. |
| `MOCK_NCBI` | Set to `1` to disable all NCBI network calls. |

Set these as Pages environment variables (secrets are not required; no secret belongs in
source control).

## D1 binding

`wrangler.toml` declares a D1 binding named `BLAST_DB`. Create the database on Cloudflare
Free, replace the `database_id` placeholder in `wrangler.toml`, and apply the migration:

```bash
npx wrangler d1 migrations apply smart-bioinformatics-toolkit-blast --remote
```

The migration (`migrations/0001_create_blast_requests.sql`) creates `blast_requests` with
columns `rid`, `status`, `created_at`, `last_checked_at`, `input_hash` and `result_tsv`.
Raw tabular results are cached there so repeated result requests do not re-query NCBI.

## MOCK mode

With `MOCK_NCBI=1`, no network calls occur. Submission returns a deterministic RID
derived from the FASTA hash, the first status check advances the job to `complete`, and
the results endpoint returns a small synthetic TSV explicitly labelled
`blastn_local_v1` / `MOCK DATA` (not real biological data). All tests under `tests/`
use this mode with a fake D1 implementing `prepare`/`bind`/`run`/`all`.

## Tests

From `web-platform/`:

```bash
node --test tests/*.test.mjs
```