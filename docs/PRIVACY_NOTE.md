# Privacy note

> **M7.8 correction (see `docs/PRIVACY_DATA_FLOW_M78.md`).** Two axes are distinct: browser validation is local, but **creating a request (`POST /api/ai/requests`) sends your FASTA to Smart Bioinformatics AI and stores FASTA inline in D1 `datasets.fasta_text` for that request**; **nothing is sent to NCBI until you review and approve the plan and explicitly submit using the single-use consent.** Earlier wording "no sequence is transmitted until you explicitly approve and submit" / "not transmitted" / "no sequence persistence" / "no FASTA column" / "sequence is NOT stored in D1" was imprecise for the M7 AI-request + NCBI-BLAST flow and is corrected below. History is preserved; nothing was erased.

## What user data exists and where it goes

| Data | Browser app | Python CLI | Remote BLAST (explicit opt-in only) |
|---|---|---|---|
| FASTA/sequence text | Parsed locally in the browser; never uploaded by the FASTA validator, statistics, BLAST TSV analyzer or taxonomy analyzer pages. | Read from a local file; never sent anywhere by `validate`, `stats`, `analyze`, `blast`, `taxonomy` (unless `--online` is explicitly used, which sends taxonomy IDs, not sequences). | Sent only when the user explicitly clicks Submit on the remote BLAST feature; the sequence becomes the `QUERY` parameter of the NCBI BLAST URL API. |
| Input hash | Computed locally for the printable report. | SHA-256 computed locally and written into report metadata. | SHA-256 stored in D1 (`blast_requests.input_hash`, `blast_consents.input_hash`, `datasets.sha256`); no sequence in `blast_requests`, logs or history. **FASTA itself is stored inline in D1 `datasets.fasta_text`** for AI-request flows (not in `blast_requests`); nothing in logs. |
| Taxonomy IDs / hits | Local files or user-provided mapping. | Local files; optional E-utilities lookup sends taxonomy IDs only. | NCBI returns hits; raw TSV is cached in D1 for the requesting RID. |

## Retention and access

- `blast_requests` stores: RID, status, created_at, last_checked_at, input_hash, cached result TSV; **no FASTA column**. (**FASTA is stored inline in D1 `datasets.fasta_text`** for `POST /api/ai/requests`; `jobs.inputs_json`; not in `blast_requests`.) No durable object storage; no retention period or user-facing deletion mechanism documented.
- `GET /api/blast/history` returns only RID, status and created_at; no sequences.
- NCBI tool/contact email are read from Cloudflare environment variables/secrets (`NCBI_TOOL`, `NCBI_EMAIL`), never committed or logged.
- Browser CSP (`public/_headers`) forbids inline scripts and restricts connections to the same origin; external requests go through the Pages Functions.

## Known residual risks (see docs/THREAT_MODEL.md)

- History/results endpoints are not per-user authenticated: a known RID can be read by another caller. Do not submit sensitive sequences until per-user auth is added.
- No global anonymous submission rate limit; a local/edge rate limit should be added before public promotion.
