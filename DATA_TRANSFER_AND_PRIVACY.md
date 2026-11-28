# Data transfer and privacy (M7 target design)

**Status: target design, not an implemented feature.** M6 state is unchanged and is recorded in
`docs/MILESTONE_M6_FINAL_REPORT.md` §3 and `docs/DATA_TRANSPORT.md`: D1 metadata is **not** a general
file store (64 KiB input cap, 2 MiB result cap, SHA-256 on every dataset/artifact, sanitized filenames),
artifact `content` is stored inline as TEXT, **no R2 upload exists**, and automatic expiry plus a
user-facing deletion flow are explicit M7 gaps. Everything described as "must"/"target" below is a
requirement for the next cycle, not a claim about the deployed system.

---

## 1. Five distinct destinations

Every dataset and artifact must be classified into exactly one of these destinations before any plan is
approved. The destination is part of the consent record.

| # | Destination | Data path | Current M6 status | Target controls |
|---|---|---|---|---|
| 1 | **Browser-local memory** | In-page FASTA validation/statistics via `fasta.js` / `statistics.js`; zero `/api/*` calls after submit | Implemented and browser-E2E verified (M6 §6) | Keep zero-egress; locality receipt states `no_external_egress` |
| 2 | **Our R2 / private artifact storage** | Platform-owned private bucket for inputs/artifacts | **Not implemented** — D1 inline TEXT today | Private bucket, short-lived signed URLs, SHA-256, size limits, sanitation, ownership checks, expiry |
| 3 | **Galaxy** (usegalaxy.eu or self-host) | Upload to a Galaxy history for real tool execution | Discovery only; no adapter | Explicit per-step consent, dedicated history, rate limit, no PII/HIPAA/FISMA, no silent transfer |
| 4 | **smarts.bio** | Workspace file upload + query/pipeline | **Disabled** (`SMARTSBIO_ENABLED=false` + authorization gate) | Remain disabled until written authorization; then least-privilege scope, workspace isolation, consent |
| 5 | **Other external databases** (NCBI, UniProt, EBI, KEGG, STRING, PDB, …) | Sequence/accession lookups from plugins | Some plugin paths exist with consent gate (M6 §6 scenario 8) | Only minimal necessary identifiers/sequences; consent; terms and rate limits per database |

**No silent third-party transmission.** Any move from destination 1 or 2 to 3, 4 or 5 requires a new,
scoped, revocable consent decision recorded before the bytes move. Blocking a destination must produce
an actionable error, not a reroute (M6 §6 direct consent-gate denial returned 403 with zero NCBI calls).

## 2. Private storage controls (destination 2, target)

- **Private bucket:** no public-read objects; access only through the Worker. Bucket policy denies
  anonymous/list access. R2 is the intended artifact bus (free egress; see
  `docs/discovery/RESEARCH_compute_infra.md` §6).
- **Short-lived signed URLs:** generate GET URLs with a minimal TTL (target: minutes, not hours), scoped
  to the object key and the requesting user; PUT URLs similarly short-lived and single-use where the
  platform supports it. Never publish a permanent URL. Log every issuance.
- **SHA-256:** compute on upload, store with the object metadata, and recompute on download; reject a
  mismatch. Continue the existing M6 rule that caller-supplied hashes are ignored and the platform
  derives its own.
- **Size limits:** enforce the existing 64 KiB input / 2 MiB inline-result caps for D1 paths; define a
  separate explicit per-object cap for the future R2 path before enabling it. Oversize is rejected
  before transfer, with the limit in the error message.
- **Allowed file types:** allow-list by extension **and** content sniffing — FASTA/FASTQ
  (`.fasta`, `.fa`, `.fna`, `.ffn`, `.faa`, `.frn`, `.fastq`, `.fq`, and gzip variants), TSV/CSV,
  VCF/BED/GFF/GTF where a plugin declares them, JSON, and plain text reports. Reject executables,
  scripts, archives with unexpected members, and type/extension mismatches.
- **Sanitized names:** strip path separators and control characters, replace unsafe characters, cap
  length, and never trust a client filename as a storage key. Storage keys are platform-generated;
  the original name is kept only as display metadata.
- **Ownership checks:** every object key is scoped to `(project_id, user_id, dataset_id)`. The Worker
  verifies ownership before issuing a URL or serving metadata; cross-user access returns 404/403 with
  no existence leak. Staging and production must not share a data row space (M6 §10).
- **Expiry and retention:** record `expires_at` on every object; a scheduled sweeper deletes expired
  objects and their signed URLs stop resolving. Retention policy per data class must be published
  before enabling the bucket.

## 3. Transfer ledger

Each transfer — in either direction — appends one immutable ledger record. The Worker derives it from
server-side rows; a caller-supplied receipt is ignored (M6 §7).

Required fields:

| Field | Meaning |
|---|---|
| `source` | Destination id/class the bytes came from (e.g. `browser-local`, `r2-private`, `galaxy`) |
| `destination` | Destination id/class the bytes went to |
| `dataset_id` | Platform dataset id the bytes belong to |
| `input_hash` | SHA-256 of the exact bytes transferred (computed by the platform) |
| `byte_count` | Exact number of bytes transferred |
| `consent_record` | Reference to the scoped consent decision (token reference only, never a raw token) |
| `timestamp` | ISO-8601 time of transfer |
| `expiry` | ISO-8601 time after which the remote copy / URL is no longer valid |
| `deletion_status` | `active | pending_deletion | deleted | unknown` |

Additional recommended fields: `provider_job_id`, `object_key`, `operation`, `actor_id`, and
`no_external_egress` flag. The ledger feeds the locality receipt shown in the report and the workspace.

## 4. Secure streaming transfer

- Uploads and downloads stream through the Worker (or a short-lived signed URL directly to the private
  bucket) with TLS; no plaintext HTTP, no credentials in URLs, no secrets in query strings.
- Stream with a bounded buffer and a byte cap; abort on limit breach, hash mismatch, or connection loss.
  Never materialize an unbounded payload in Worker memory (M6 / compute-infra memory limits).
- Provider uploads (Galaxy, smarts.bio) use the provider's documented upload path and the smallest
  possible payload; the exact request body schema must be verified before use (`GALAXY_API_INTEGRATION.md`
  §4, `SMARTSBIO_API_INTEGRATION.md` §4).
- Retries are deduplicated by ledger key so a repeated chunk never creates a second job or a second
  object; see error normalization in `PROVIDER_INTEGRATION_ARCHITECTURE.md` §1.

## 5. User-facing deletion and retention (M7 gap)

- Provide a user-visible action to delete a dataset/artifact: mark `pending_deletion`, remove remote
  copies and signed URLs, delete the object, flip `deletion_status` to `deleted`, and update the ledger.
- Delete cascades to provider-side copies only where the provider documents a delete operation; otherwise
  report the remote copy as `unknown` and tell the user plainly.
- Publish retention periods per destination and apply the expiry sweeper. Until this flow and sweeper
  exist, operators must delete rows/objects explicitly (M6 §10).

## 6. Consent mechanics

- Consent is scoped to **provider + dataset (hash) + destination + operation + byte count** and is
  revocable. `external_egress: true` always implies `consent_required: true` (contract §1).
- Only a reference (e.g. `token-ref:<hash>`) is stored in receipts — never the raw token.
- A provider switch after approval invalidates consent; re-approval is required
  (`PROVIDER_INTEGRATION_ARCHITECTURE.md` §6).
- Public Galaxy terms prohibit PII/HIPAA/FISMA data (prior-session official evidence, access
  2026-11-24). smarts.bio Terms say user data is not used for public AI training but third-party AI
  models process queries in real time (access 2026-11-25). Neither claim removes our own consent duty.

## 7. Multi-user security

- **Platform-owned vs per-user provider accounts:** a platform-owned account pools quota and data; a
  per-user account isolates them. This is an unresolved operator decision. Until made and documented,
  no remote-provider execution is enabled. If platform-owned, strict per-`(user_id, project_id)`
  history/workspace isolation and ownership checks are mandatory; if per-user, each user supplies and
  revokes their own credential.
- **Secrets in Cloudflare secrets only:** API keys and tokens are stored via `wrangler secret put` /
  Worker secrets or the local agent's secure token file — never in browser code, `wrangler.toml`,
  committed `.dev.vars`, source, plan/result JSON, logs or documentation. Rotate on exposure.
- Least privilege: separate keys per environment and per provider, only the scopes needed for the
  approved operation; revoke immediately when no longer needed.
- Cross-user leakage tests (signed URL ownership, ledger visibility, provider history/workspace
  isolation) must be part of verification before enabling any remote destination.

## 8. Limitations / unfinished edges

- No R2 bucket, signed URL, sweeper, ledger table or user-facing deletion flow was implemented.
- All size/type/TTL numbers above are targets, not deployed configuration, except the existing M6
  D1 caps (64 KiB / 2 MiB) which remain in force.
- Provider-side deletion capabilities differ; remote-copy deletion is not guaranteed.
- Exact usegalaxy.eu and smarts.bio account retention policies are UNKNOWN until queried from the
  connected accounts.
