> **Status: HISTORICAL — superseded by later verification; findings retained verbatim.**
> **Reconciliation (2026-11-24):** The audit's finding that `/api/blast/submit` was anonymous and transmitted a sequence without consent is now closed by migration `0003_blast_consent.sql` and the single-use consent gate (typed 403, mock mode included). RID TTL handling, a global submit rate limit, active `tool`/`email` configuration and the evidence-ledger disagreement remain open. Current state: `API_INTEGRATION_ROADMAP.md` §2/§4/§7 and `docs/DATA_TRANSPORT.md`.
>
> The original report below is unchanged.

---

# API / Integration / Infrastructure Audit (read-only)

**Agent:** API/INTEGRATION/INFRASTRUCTURE AUDIT
**Date:** 2026-11-24
**Repo root:** `D:\smart-bioinformatics-toolkit-milestone-0_5_0\smart-bioinformatics-toolkit-milestone-0.5.0\smart-bioinformatics-toolkit`
**Scope:** backend Pages Functions, NCBI integrations, D1 database, deployment config, evidence/privacy/threat docs.

All claims below are grounded in source files with `file:line` citations. No live NCBI calls, no live D1, no deployment actions and no code changes were performed. Where a document claims something the code does not do, the discrepancy is called out explicitly.

---

## Executive summary — real vs catalog-only

| Capability | Status | Evidence |
| --- | --- | --- |
| 4 backend API endpoints (submit/status/results/history) | **REAL, implemented code** | `web-platform/functions/api/blast/*.js` |
| NCBI BLAST URL API (CMD=Put/Get) calls in server code | **REAL code path**, exercised only with mocks / injected fetch; never live | `_lib.js:4`, `submit.js:63-64`, `status/[rid].js:69-70`, `results/[rid].js:62-63`, `blast_lib.test.mjs:134-150`, `LOOP_LOG.md:125` |
| NCBI E-utilities (taxonomy, Python) client | **REAL code**, opt-in via `online=True`, sends taxids only | `resolver.py:36`, `:81-201`, `:204-232` |
| D1 `blast_requests` table | **REAL schema/migration**; no live DB id, no live data | `migrations/0001_create_blast_requests.sql:1-10`, `wrangler.toml:10` |
| Static Cloudflare Pages site deployed | **REPORTED verified** (deploy stage success via Cloudflare API); TLS blocked browser/curl verification | `DEMO_SCRIPT.md:26-28`, `EVIDENCE_LEDGER.md:14`, `LOOP_LOG.md:114-115` |
| Live backend / live NCBI / UI wiring for remote submission | **NOT DONE** | `LOOP_LOG.md:125`; no `fetch` in `web-platform/public`; `blast.html:31` |
| NCBI E-utilities/Datasets/LPSN/GTDB/BacDive/SILVA/RDP "Adds to project" items | **CATALOG / INVESTIGATE only** — no code | `API_CATALOG.md:17-107, 109-123` |

Bottom line: the remote BLAST backend is genuinely implemented against the documented NCBI URL API, but it is **unreachable and unverified end-to-end**: the D1 id is a placeholder, no frontend calls the endpoints, all tests use a fake D1 and mocked/injected fetch, and the repo itself lists live NCBI, live D1 and UI wiring as not verified. Most of `API_CATALOG.md` is a service survey, not implemented integrations.

---

## 1. What API endpoints actually exist

Cloudflare Pages Functions routing maps each file under `web-platform/functions/` to a path. There are exactly four routed functions (plus `_lib.js`, which is a shared module, not a route — its leading underscore keeps it out of routing; `_lib.js:1-2`).

| Method | Path (file) | Behaviour / outbound calls | Auth | Rate limiting | Error handling |
| --- | --- | --- | --- | --- | --- |
| `POST` | `/api/blast/submit` (`submit.js:1,23-29`) | Reads body (`request.text()`), 64 KiB cap (`submit.js:21,33-34`), JSON object check (`:36-44`), FASTA/DB/program validation (`:46-52`), SHA-256 hash (`:57`), then **NCBI `CMD=Put`** via `ncbiFetchText` (`:63-64`); stores `queued` row (`:71-84`); returns `{rid,status:"queued"}` (`:86`). | **None** (anonymous; `THREAT_MODEL.md:41`) | **No submit rate limit at all** (`THREAT_MODEL.md:77-78`, G2). Only validation caps. | 400 malformed/invalid (`submit.js:40,43,48,50,52`), 413 body too large (`:34`), 503 no D1 (`:55`) / D1 write fail (`:83`), 502 NCBI failure or bad RID (`:66,68`), 405 wrong method (`:27`), 204 OPTIONS preflight (`_lib.js:276-285`). |
| `GET` | `/api/blast/status/:rid` (`status/[rid].js:1,28-36`) | RID from `context.params.rid` or URL segment (`:18-26,34`), validates format (`:39-40` / `_lib.js:53-55,14`), reads D1 row (`:45-51`), enforces 60 s per-RID poll window (`:53-62`), **NCBI `CMD=Get&RID=`** (`:69-70`), updates status/timestamp (`:76-80`). | None | **1 poll/min per RID**, 429 + `Retry-After` (`status/[rid].js:56-61`; `POLL_INTERVAL_MS=60000` at `_lib.js:8`). | 400 invalid RID (`:40`), 503 D1 (`:43,49`) / update fail (`:79`), 404 unknown RID (`:51`), 429 throttled (`:58`), 502 NCBI failure (`:72`), 405/204 (`:31-32`). |
| `GET` | `/api/blast/results/:rid` (`results/[rid].js:1,28-36`) | RID validation + D1 read (`:39-51`), requires `status=complete` (`:52-54`), returns cached `result_tsv` if present, else **NCBI `CMD=Get&RID=&FORMAT_TYPE=Text&ALIGNMENT_VIEW=Tabular`** (`:62-63`), extracts tabular lines (`:63` / `_lib.js:222-226`), caches in D1 (`:68-72`), returns `text/plain` (`:75`). | None | No dedicated rate limit; inherits status throttling indirectly (results endpoint itself has none — see G2). | 400 invalid RID (`:40`), 503 D1 (`:43,49`) / cache fail (`:71`), 404 unknown RID (`:51`), 409 not ready (`:53`), 502 NCBI failure (`:65`), 405/204 (`:31-32`). |
| `GET` | `/api/blast/history` (`history.js:1,5-12`) | Reads recent rows, returns `{submissions:[{rid,status,created_at}],count,mock}` (`:25`); **no sequences and no hash returned** (`:1`, `_lib.js:19`). | None | `limit` clamped to 1..20 (`history.js:17-18`; `HISTORY_LIMIT=20` at `_lib.js:9`). | 503 D1 (`:16,23`), 405/204 (`:9`). |

Cross-cutting endpoint behaviour (`_lib.js`):

- **CORS:** same-origin only. `corsHeaders` echoes `Access-Control-Allow-Origin` only when `Origin` equals the request's own origin and sets `Vary: Origin` (`_lib.js:228-244`); tested at `blast_lib.test.mjs:110-115`.
- **Security headers on every API response:** `Content-Security-Policy: default-src 'none'; frame-ancestors 'none'; base-uri 'none'`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, `Cache-Control: no-store` (`_lib.js:246-256`); tested at `blast_lib.test.mjs:98-108`.
- **Error bodies are HTML-escaped** via `errorResponse` → `htmlEscape` (`_lib.js:33-40,265-267`); upstream error text is reduced to generic messages (`submit.js:66`, `status/[rid].js:72`, `results/[rid].js:65`), so raw FASTA/URL cannot leak through error bodies (`THREAT_MODEL.md:65-68,146-147`).
- **Method handling:** all four accept `OPTIONS` (204 preflight with `Allow-Methods/Headers/Max-Age`, `_lib.js:276-285`) and return 405 with `Allow` for other methods.
- **Documented endpoint table matches code** for method/path/semantics (`functions/README.md:13-20`), with one doc drift elsewhere: `NCBI_API_NOTES.md:33` names the poll path `/api/status/:rid`, but the real path is `/api/blast/status/:rid`.

---

## 2. Is the NCBI BLAST integration REAL?

### 2.1 Trace: submit -> status -> results

**Base URL:** `https://blast.ncbi.nlm.nih.gov/Blast.cgi` (`_lib.js:4`), exactly the endpoint documented in `NCBI_API_NOTES.md:12-20`.

**Submit (`submit.js:57-86`):**
1. `hashInput` = SHA-256 of FASTA via `crypto.subtle.digest` (`_lib.js:122-126`).
2. In **mock mode** (`MOCK_NCBI=1`, `_lib.js:42-46`) RID is `MOCK` + first 16 hex chars of the hash (`_lib.js:48-51`); **no network call** (test asserts `fetch` throws if used: `blast_submit.test.mjs:106-119`).
3. Otherwise builds `buildPutParams` (`_lib.js:136-148`): `CMD=Put`, `QUERY` = raw FASTA, `DATABASE=16S_ribosomal_RNA`, `PROGRAM=blastn`, `MEGABLAST=on`, `EXPECT=1e-10`, `HITLIST_SIZE=50`, `FILTER=F`, `FORMAT_TYPE=Text`, plus `tool`/`email` from env when set (`_lib.js:128-134`). All parameters are verified against `NCBI_API_NOTES.md:16-20` and asserted in `blast_lib.test.mjs:67-80`.
4. `ncbiFetchText` issues a **GET** (`_lib.js:170-195`, line 178) with `User-Agent: smart-bioinformatics-toolkit`; retries 429/5xx/network failures with backoff delays `[0,250,500] ms` (`_lib.js:168-175,183-186`); the URL is explicitly **never logged** (`_lib.js:169`).
5. RID parsed from the HTML response by four narrow regexes (`_lib.js:197-210`) then validity-checked (`submit.js:68`). Row inserted as `queued` with only the hash (`submit.js:71-84`).

**Status (`status/[rid].js:38-82`):** validates RID, checks 60 s window from `last_checked_at`, builds `CMD=Get&RID=` (`_lib.js:150-155`), calls `ncbiFetchText`, parses `Status=Ready|Running|Waiting|Queued|Failed|Unknown` into `complete|queued|error` (`_lib.js:212-219`), updates D1 (`status/[rid].js:76-80`). Mock mode short-circuits to `complete` (`:65-67`).

**Results (`results/[rid].js:38-76`):** requires `status=complete` (`:52-54`), builds tabular `CMD=Get&RID=&FORMAT_TYPE=Text&ALIGNMENT_VIEW=Tabular` (`_lib.js:157-164`), calls `ncbiFetchText`, filters response to `#`/tab lines (`_lib.js:222-226`), caches TSV in D1 and returns `text/plain` (`:68-75`). Mock mode returns labelled synthetic `MOCK_TSV` (`_lib.js:25-31`, `results/[rid].js:58-59`).

**Verdict:** the integration is real server-side code using the documented public URL API; there is **no hidden SDK, no auth token, no paid service**. But it has only been executed with mocks/injected fetch: the repo states "Live NCBI remote BLAST call (MOCK mode only), live D1-backed endpoints ... UI wiring for remote submission" are not verified (`LOOP_LOG.md:125`), and "backend was verified with mocks only" (`LOOP_LOG.md:114`). Tests use a fake D1 (`tests/helpers/fake-d1.mjs`) and an injected `fetchImpl` (`blast_lib.test.mjs:134-150`); no test hits `blast.ncbi.nlm.nih.gov`.

### 2.2 Constraints (poll intervals, RID expiry, terms of service)

- **Poll interval:** documented verbatim "Do not poll for any single RID more often than once a minute" (`NCBI_API_NOTES.md:25`; `API_CATALOG.md:10`) and implemented server-side at exactly 60 s (`_lib.js:8`, `status/[rid].js:56-61`).
- **General contact limit:** "Do not contact the server more often than once every 10 seconds" (`NCBI_API_NOTES.md:24`). **Not enforced in code** — only the per-RID minute window exists; back-to-back submissions from anonymous callers can violate this.
- **Volume / off-peak:** >100 searches/24 h moved to slower queue or blocked; run >50 searches on weekends or 9 pm–5 am ET; merge short queries (`NCBI_API_NOTES.md:27-29`; `API_CATALOG.md:10`). No client-side quota or schedule enforcement exists.
- **Identification:** `tool`/`email` params requested (`NCBI_API_NOTES.md:26`) and supported via `NCBI_TOOL`/`NCBI_EMAIL` env vars (`_lib.js:128-134`, `functions/README.md:39-48`). Neither is set in `wrangler.toml:1-10`, so a deployment without Pages env vars omits them.
- **RID expiry:** **not handled anywhere.** No TTL, expiry field, cleanup job or age check exists in the functions (`submit.js`, `status/[rid].js`, `results/[rid].js`, `_lib.js`) or the migration (`0001_create_blast_requests.sql:1-10`). An expired NCBI RID would surface as a failed/queued status parsed at `_lib.js:212-219` with no user-facing expiry message.
- **Terms / licence:** US-government public-domain information, acknowledgement requested, molecular data unrestricted (`API_CATALOG.md:11,132-133`; `NCBI_API_NOTES.md` sources at `:5-10`). All of the catalog's own ledger rows are stamped `verified-by=UNVERIFIED` (`API_CATALOG.md:125-161`), including the BLAST parameters, while `EVIDENCE_LEDGER.md:7-8` records the same BLAST claims as reviewer-verified and `EVIDENCE_LEDGER.md:14` deployment as tester-verified. The two ledgers disagree on verification status.

### 2.3 User consent for sending sequence data to NCBI

**Documented but not implemented in the UI.** `PRIVACY_NOTE.md:7` says the sequence is sent "only when the user explicitly clicks Submit on the remote BLAST feature"; `THREAT_MODEL.md:28` says disclosure happens "only as a consequence of the explicit submit action above"; `NCBI_API_NOTES.md:36` says "user sequences uploaded only when the user starts the remote BLAST feature". However:

- There is **no `fetch`/XHR/API client anywhere in `web-platform/public`** (grep for `fetch`, `api/blast`, `consent` returned zero matches in the static site).
- `blast.html:31` explicitly states "No new BLAST request is made"; its only action button is "Analyze BLAST TSV" (`blast.html:92`), wired to a local TSV analyzer (`blast-app.js:88-197,199`).
- No consent checkbox, disclosure dialog or "Submit to NCBI" control exists in `blast.html`, `index.html` or any `public/js` file.

So there is **no actual user-consent gate** in the shipped frontend; the only "consent" is the API boundary itself (a sequence reaches NCBI only if some client POSTs it). The backend correctly forwards the raw FASTA in `QUERY` (`_lib.js:136-148`), so once a client is wired, consent must be implemented there.

---

## 3. Database (D1)

**Schema:** one table, one migration, `migrations/0001_create_blast_requests.sql:1-10`:

```sql
CREATE TABLE IF NOT EXISTS blast_requests (
  rid TEXT PRIMARY KEY,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  last_checked_at TEXT,
  input_hash TEXT NOT NULL,
  result_tsv TEXT
);
CREATE INDEX IF NOT EXISTS idx_blast_requests_created_at ON blast_requests (created_at DESC);
```

**What is stored:** RID, status (`queued|complete|error` as written by `submit.js:74`, `_lib.js:22`), ISO timestamps, SHA-256 of the FASTA, and cached tabular TSV (`_lib.js:17-23` SQL centralised; `submit.js:71-79`; `status/[rid].js:77`; `results/[rid].js:69`). The raw sequence is **never stored** — asserted in `blast_submit.test.mjs:24-33` (hash only, `ACGTACGT` absent from rows). `history` returns no hash (`_lib.js:19`, `history.js:25`).

**Injection defenses:** all statements use `?` placeholders with `.bind()` (`_lib.js:287-314`); no user value is concatenated into SQL; `LIMIT` clamped 1..20 (`history.js:17-18`). The fake D1 asserts exact SQL and bound values (`tests/helpers/fake-d1.mjs:2`). `THREAT_MODEL.md:49-52,138-141` found no D1 injection path.

**Provenance / versioning:** **absent in the database.** There is no schema-version table, no release/version column, no reference-database release identifier and no NCBI accession of the query in the D1 schema (`0001_create_blast_requests.sql:1-10`). The only versioning found in the project is a static report metadata field `tool_version` default `"0.1.0"` (`python-engine/src/smartbio/taxonomy/report.py:19,28,56`) and the expected metadata keys `tool`, `tool_version`, `generated_at`, `input_file`, `input_file_hash_sha256`, thresholds (`shared/test-cases/report_metadata_keys.json:3-12`) — no database-release or tool-build provenance there either. `NCBI_API_NOTES.md:9` records the FTP listing `16S_ribosomal_RNA` last-modified 2026-11-19, but that release fact is not stored in D1 or surfaced via any endpoint. This matters because `API_CATALOG.md:14` lists "reference-database release drift" as a failure mode with no mitigation.

---

## 4. Deployment

**`wrangler.toml` (entire file, `wrangler.toml:1-10`):**
- `name = "smart-bioinformatics-toolkit"` (`:1`)
- `compatibility_date = "2026-11-22"` (`:2`)
- `pages_build_output_dir = "public"` (`:3`)
- one D1 binding `BLAST_DB`, database name `smart-bioinformatics-toolkit-blast`, **`database_id = "REPLACE_WITH_D1_DATABASE_ID"`** (`:5-10`) — a placeholder that must be replaced and migrated (`functions/README.md:50-61`).

**Worker limits:** `wrangler.toml` contains **no `[limits]` block and no CPU/memory/request-size configuration**; only the app-level caps exist (64 KiB body `submit.js:21,34`; 10,000-char FASTA `_lib.js:7,61-63`; 5 MB browser-side file `blast-app.js:9,95-98`). No doc in the repo quantifies Worker CPU/memory limits (grep across `docs/` found no CPU/memory figures). Cloudflare Workers default limits therefore apply, unconfigured and untested here. **Heavy bioinformatics is explicitly excluded by design:** `OPENCODE_HANDOFF_PROMPT.md:15` — "Do not run BLAST+ inside Cloudflare Workers. The intended split is local BLAST+ for the Python CLI and NCBI remote BLAST for the browser application"; `OPENCODE_HANDOFF_PROMPT_0.5.0.md:16` — "No ... Python backend, no BLAST+ inside Workers". The bundled `ncbi-blast-2.17.0+-win64.exe` is a local Windows binary, not deployed to Workers.

**What is actually deployed vs documented:**
- **Reported deployed:** static Cloudflare Pages Free preview at `https://4e5048a8.smart-bioinformatics-toolkit.pages.dev` (alias `phase-1-robustness-safety...`), deploy stage success per Cloudflare API (`DEMO_SCRIPT.md:26-28`, `EVIDENCE_LEDGER.md:14`, `LOOP_LOG.md:114`). Verification of that URL in a real browser/curl was **blocked by TLS certificate rejection** in the environment (`LOOP_LOG.md:115`, `PROJECT_SUMMARY.md:22`).
- **Not deployed / not live:** D1 id is a placeholder and migration not applied to a live DB, so the backend cannot run live (`LOOP_LOG.md:114`); no live NCBI call, no live D1 endpoints, no UI wiring (`LOOP_LOG.md:125`). `web-platform/README.md:31` is stale — it says "Pages Functions can be added under `web-platform/functions/` in a later milestone when the API is implemented", although they already exist.
- **CI:** `.github/workflows/tests.yml:1-25` runs Python pytest (`:8-16`) and `cd web-platform && npm test` (`:18-25`) on push/PR with mutable action tags (`checkout@v4`, `setup-python@v5`, `setup-node@v4`) — flagged in `THREAT_MODEL.md:153-163`. No deploy step, no D1 migration step, no live smoke test.

---

## 5. Evidence ledger: verified vs assumed, and catalog/implementation gaps

**Verification posture:**
- `EVIDENCE_LEDGER.md:3` rule: UNVERIFIED claims may not appear in README/UI/slides.
- Verified (different agent): BLAST URL API params/limits (`:7`), `16S_ribosomal_RNA` database name (`:8`), RefSeq targeted-loci data (`:9`), benchmark numbers (`:13`), deployment success (`:14`).
- UNVERIFIED: B. cereus 16S resolution (`:10`), viridans genus-only (`:11`), E. coli/Shigella >99% (`:12`), Kim et al. PMID correction (`:16`), E-utilities 3 req/s (`:17`), BacDive (`:18`), RDP (`:19`).
- `API_CATALOG.md:3` says its own claim ledger uses `verified-by=UNVERIFIED` **for every row, including BLAST**, explicitly "even where a reviewer previously verified BLAST" — so `API_CATALOG.md:129` (BLAST params/limits) conflicts with `EVIDENCE_LEDGER.md:7`. The catalog's "ADOPT" status for BLAST (`:5-15`) is backed by `NCBI_API_NOTES.md`, whose items are reviewer-read official pages (`NCBI_API_NOTES.md:3-10`), not by a live call.

**Gaps between `API_CATALOG.md` ("catalog") and implemented integrations:**

1. **E-utilities taxonomy** — catalog INVESTIGATE (`API_CATALOG.md:17-27`, output formats UNVERIFIED at `:24`); **but a working client exists** in `resolver.py:81-201` (`esummary.fcgi`, retmode json, 3 req/s default at `:36,39,114-123`, optional `api_key` at `:158-163`). The catalog is more conservative than the code.
2. **NCBI Datasets v2, LPSN, GTDB, BacDive, SILVA, E-utilities (as an adopted service), AI Hero, RDP** — all INVESTIGATE/REJECT only (`:29-107,163-175`; decision table `:109-123`); **zero code references found** in `web-platform/functions`, `public` or `python-engine`. Their "Adds to project" bullets are proposals, not capabilities.
3. **RefSeq targeted loci 16S** — catalog ADOPT as benchmark data (`:41-51`); code only uses the string `16S_ribosomal_RNA` as an NCBI BLAST `DATABASE` parameter (`_lib.js:5,140`) and as a validation allow-list (`_lib.js:108-113`). No reference FASTA/download pipeline is wired to the endpoint.
4. **"Rate-limit submissions"** is documented as an implementation constraint (`NCBI_API_NOTES.md:35`) but is not implemented (see §1).
5. **`functions/README.md:32-37` claims integration is "verified parameters"** — the parameters are verified against docs, but no live verification is recorded (`LOOP_LOG.md:125`).
6. **CSV/tests gap** in `THREAT_MODEL.md` is now partly stale (see §6) — the risk table at `:167-176` and gaps G3–G8 (`:203-214`) were written before the CSV guard modules landed.

---

## 6. Security / privacy

**CSV injection defenses — partially fixed, docs stale:**
- JS guard exists and is **wired into all three browser CSV writers**: `csv-safe.js:3-12` (RFC4180 quote + prefix `'` for leading `= + - @ TAB CR`), imported/used by `blast.js:1,477`, `statistics.js:1,90`, `taxonomy-app.js:1,442`. Regression tests: `csv_safe.test.mjs:1-13` with shared vectors `shared/test-cases/csv_injection_cases.json:1-13`.
- Python: `csv_safe.py:6-16` exists and is tested (`test_csv_safe.py:8-14`), and `exports.py:18-27` **does neutralise** object columns inline (`:21-26`).
- **Remaining gap:** `blast_runner.py:317-319` still calls `dataframe.to_csv(path, index=False)` with **no neutralisation**; `blast_runner.py:249` writes `filtered_csv` through that function. `THREAT_MODEL.md:90-100` (G3) and `:174` incorrectly state there is no mitigation anywhere — the accurate statement is: browser exports and `exports.write_csv` are fixed; `blast_runner.write_csv` is not.

**Headers / CSP:**
- Static site `public/_headers:1-6`: `default-src 'self' blob:; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-src 'none'; frame-ancestors 'none'` (`:2`), `X-Frame-Options: DENY` (`:3`), `nosniff` (`:4`), `Referrer-Policy: strict-origin-when-cross-origin` (`:5`), `Permissions-Policy` denies geolocation/microphone/camera (`:6`). No external origins or `unsafe-inline`/`unsafe-eval` (`THREAT_MODEL.md:115-125`).
- API responses: stricter CSP `default-src 'none'` etc. (`_lib.js:246-256`). `THREAT_MODEL.md:120-123` (G4) reports `benchmark.html` has an inline module script and inline `style` attribute that the CSP would block — the deployed page's chart/table would not render.

**Threat model:** `THREAT_MODEL.md:1-216` STRIDE-lite, audit dated 2026-11-24. Key residual risks:
- R1 (`:44-46,69`): no authentication; `history` publishes RIDs to anyone and `/results/:rid` returns the job's cached hits to anyone who knows the RID — no per-user isolation.
- R2 (`:77-78,127-135`): no global anonymous rate limit; NCBI quota and D1 writes can be exhausted — directly conflicts with the unverified "rate-limit submissions" claim.
- R–I (`:70-72`): Python CLI prints/persists raw FASTA in validation JSON/stdout; JS `report.js esc()` omits `'`; minor `innerHTML` issues.
- Supply chain (`:153-163`): no Python lock/hashes, prebuilt BLAST+ exe with no checksum/provenance, mutable CI action tags.
- Secret scan (`:182-201`): 19 benign keyword hits across 150 files, zero live secrets. No `--api-key` handling change: G7 notes the CLI flag is process-list visible (`:148-150,213`).

**Data retention:**
- D1 keeps rows indefinitely — no deletion/TTL/expiry logic in functions or migration (§2.2, §3). `Cache-Control: no-store` applies to API responses only (`_lib.js:251`), not to stored rows.
- Raw FASTA is not persisted server-side, but is transiently in the `QUERY` parameter of the NCBI GET URL (`_lib.js:136-148`) — outside our control once sent. `PRIVACY_NOTE.md:13-16` summarises retention; `:20-21` explicitly warns "Do not submit sensitive sequences until per-user auth is added" and that a global rate limit should be added before public promotion.

---

## Appendix — files inspected

`web-platform/functions/api/blast/{submit.js,status/[rid].js,results/[rid].js,history.js,_lib.js}`, `web-platform/functions/README.md`, `web-platform/migrations/0001_create_blast_requests.sql`, `web-platform/wrangler.toml`, `web-platform/public/{_headers,blast.html}`, `web-platform/public/js/{blast-app.js,csv-safe.js,blast.js,statistics.js,taxonomy-app.js}`, `web-platform/tests/{blast_submit.test.mjs,blast_lib.test.mjs,csv_safe.test.mjs,helpers/fake-d1.mjs}`, `web-platform/{README.md,package.json}`, `python-engine/src/smartbio/{csv_safe.py,exports.py}`, `python-engine/src/smartbio/blast_runner.py`, `python-engine/src/smartbio/taxonomy/{resolver.py,report.py}`, `python-engine/tests/test_csv_safe.py`, `shared/test-cases/{csv_injection_cases.json,report_metadata_keys.json}`, `.github/workflows/tests.yml`, and `docs/` files: `API_CATALOG.md`, `NCBI_API_NOTES.md`, `THREAT_MODEL.md`, `PRIVACY_NOTE.md`, `EVIDENCE_LEDGER.md`, `LOOP_LOG.md`, `DEMO_SCRIPT.md`, `PROJECT_SUMMARY.md`, `OPENCODE_HANDOFF_PROMPT.md`, `OPENCODE_HANDOFF_PROMPT_0.5.0.md`, `CONTRACTS.md`.
