# Privacy note

## What user data exists and where it goes

| Data | Browser app | Python CLI | Remote BLAST (explicit opt-in only) |
|---|---|---|---|
| FASTA/sequence text | Parsed locally in the browser; never uploaded by the FASTA validator, statistics, BLAST TSV analyzer or taxonomy analyzer pages. | Read from a local file; never sent anywhere by `validate`, `stats`, `analyze`, `blast`, `taxonomy` (unless `--online` is explicitly used, which sends taxonomy IDs, not sequences). | Sent only when the user explicitly clicks Submit on the remote BLAST feature; the sequence becomes the `QUERY` parameter of the NCBI BLAST URL API. |
| Input hash | Computed locally for the printable report. | SHA-256 computed locally and written into report metadata. | SHA-256 only is stored in D1 (`blast_requests.input_hash`); the sequence is NOT stored in D1, logs or history. |
| Taxonomy IDs / hits | Local files or user-provided mapping. | Local files; optional E-utilities lookup sends taxonomy IDs only. | NCBI returns hits; raw TSV is cached in D1 for the requesting RID. |

## Retention and access

- D1 stores: RID, status, created_at, last_checked_at, input_hash, cached result TSV. No FASTA column exists.
- `GET /api/blast/history` returns only RID, status and created_at; no sequences.
- NCBI tool/contact email are read from Cloudflare environment variables/secrets (`NCBI_TOOL`, `NCBI_EMAIL`), never committed or logged.
- Browser CSP (`public/_headers`) forbids inline scripts and restricts connections to the same origin; external requests go through the Pages Functions.

## Known residual risks (see docs/THREAT_MODEL.md)

- History/results endpoints are not per-user authenticated: a known RID can be read by another caller. Do not submit sensitive sequences until per-user auth is added.
- No global anonymous submission rate limit; a local/edge rate limit should be added before public promotion.
