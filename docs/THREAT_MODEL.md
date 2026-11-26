# Threat model — Smart Bioinformatics Toolkit (STRIDE-lite)

Status: audit performed 2026-11-24. This document records the security/privacy posture of the
web platform (`web-platform/`), the local Python engine (`python-engine/`), and their shared
data. It is a lightweight STRIDE review, not a formal certification.

## 1. Scope, assets, and trust boundaries

| Component | Role | Trust |
| --- | --- | --- |
| `web-platform/public/*` | Static Pages site (HTML/CSS/ES modules) | Untrusted browser input; trusted first-party code |
| `web-platform/functions/api/blast/*` | Pages Functions (submit, status, results, history) | Server-side; only boundary to D1 and NCBI |
| D1 `blast_requests` | Request/RID metadata cache | Trusted data store, no raw sequences |
| `python-engine/` CLI | Local FASTA validation, statistics, BLAST/taxonomy/verdict/report | Runs on the user's machine |
| Local `blastn` (`ncbi-blast-2.17.0+-win64.exe`) | BLAST execution via `subprocess` | Bundled binary, provenance not verified in-repo |
| NCBI BLAST + NCBI E-utilities | Remote services | External, only contacted on explicit user action |

Assets worth protecting: raw FASTA sequences, derived hit tables, verdicts/reports, RIDs, D1
metadata, and the NCBI tool identity. Secrets: none are required for the web app; optional
NCBI credentials are supplied as environment variables.

## 2. Privacy note — exactly where user sequences may go, and when

| Destination | Data sent | Trigger | Raw sequence? |
| --- | --- | --- | --- |
| Browser memory / textarea / uploaded file | Full FASTA | As soon as the user types or selects a file | Yes, stays client-side for validation, statistics, verdict and report rendering |
| `POST /api/blast/submit` | FASTA in JSON (`fasta` / `sequence` / `query`) | **Only** when the user starts the remote BLAST action | Yes, over HTTPS to our own origin |
| NCBI BLAST (`https://blast.ncbi.nlm.nih.gov/Blast.cgi?CMD=Put&QUERY=...`) | FASTA in the `QUERY` query-string parameter, plus allow-listed database/program | Server-side, only as a consequence of the explicit submit action above | Yes. The sequence is necessarily disclosed to NCBI to run the search. Our code never logs this URL |
| D1 `blast_requests` | `rid`, `status`, `created_at`, `last_checked_at`, `input_hash` (SHA-256), `result_tsv` | On submit / status poll / result caching | **Never** — only a one-way hash and the hit table are stored |
| `GET /api/blast/status/:rid`, `GET /api/blast/results/:rid` | RID only; results return cached tabular hits | User polling / viewing results | No (hits are NCBI-derived taxonomy names and scores, not the query) |
| `GET /api/blast/history` | `rid`, `status`, `created_at` | User opening history | No (and no hash) |
| NCBI E-utilities (Python taxonomy resolver) | Numeric taxids and optional `tool`/`email`/`api_key` | Only when online taxonomy lookup is enabled | No |
| Python CLI local outputs and stdout | Full `validation` records include the raw `sequence` field | Any CLI `validate` / `analyze` run | Yes — written to local JSON files and printed to stdout (see Gap G5) |

No analytics, telemetry, third-party scripts, fonts or external origins were found in the web
frontend. Client downloads (JSON/CSV/FASTA/printable HTML) are generated locally via Blobs.

## 3. STRIDE-lite findings

### S — Spoofing
- The API has no authentication; callers are anonymous. The RID is the only capability.
- RIDs are validated against `^[A-Za-z0-9_-]{1,64}$` before use in SQL or outbound NCBI URLs
  (`web-platform/functions/api/blast/_lib.js`).
- **Risk R1 (medium):** `GET /api/blast/history` returns recent `rid,status,created_at` to anyone,
  and `/results/:rid` then returns that job's cached hit table to anyone who knows the RID.
  There is no per-user isolation. See Gap G1.

### T — Tampering
- All D1 statements are centralised in `SQL` and use `?` placeholders with `.bind()`; no
  user-controlled value is concatenated into SQL (`_lib.js`, `insertRequest`, `getRequest`,
  `updateStatus`, `cacheResults`, `listRecent`). The `LIMIT` value is clamped to 1..20 in
  `history.js`. **No D1 injection path found.**
- FASTA is validated (structure, IUPAC alphabet, 10,000-char cap) and `database`/`program` are
  allow-listed to exact values before any NCBI call (`_lib.js`, `submit.js`).
- NCBI traffic is GET-only with bounded retry/backoff for 429/5xx/network failures
  (`ncbiFetchText`). Response parsing uses narrow regexes and an RID validity check.
- HTML is escaped before being returned in error messages (`errorResponse` -> `htmlEscape`).

### R — Repudiation
- No actor identity is recorded. D1 keeps timestamps and a hash but no caller identifier, so
  abusive submissions cannot be attributed. Acceptable for an anonymous research tool; noted
  because it limits incident response.

### I — Information disclosure
- Positive controls: no sequences in `blast_requests`/history; generic upstream-error messages; same-origin
  > **M7.8 correction (`docs/PRIVACY_DATA_FLOW_M78.md`):** "no sequences in D1" applies to `blast_requests`; **FASTA is stored inline in D1 `datasets.fasta_text`** (and `jobs.inputs_json`) for `POST /api/ai/requests`, with no sequence in audit/logs; no retention period or user-facing deletion mechanism is documented.
  CORS only (`corsHeaders`); `Cache-Control: no-store`, `Referrer-Policy: no-referrer`,
  `X-Content-Type-Options: nosniff` and a restrictive `Content-Security-Policy` on API
  responses (`baseHeaders`); strict transport headers in `public/_headers`.
- **Risk R1** (cross-user RID enumeration) above.
- **Low-risk disclosure:** the Python CLI prints and persists full FASTA sequences (Gap G5).
- `report.js` `esc()` does not escape `'`; harmless in the text nodes where it is used today,
  but unsafe if reused inside single-quoted attributes (Gap G6).

### D — Denial of service / resource abuse
- Controls present: 64 KiB request body cap, 10,000-char FASTA cap, one status check per RID
  per 60 s with `429` + `Retry-After`, history limit 20, bounded NCBI retries.
- **Risk R2 (medium):** no global rate limiting or authentication on submit/status/results.
  Anonymous callers can drive unlimited NCBI BLAST submissions and D1 writes (Gap G2).

### E — Elevation of privilege
- No roles, admin endpoints or elevated APIs exist. Pages Functions can only use their bound
  D1 database. A known RID grants read of that job's result — a capability URL, not a
  privilege escalation, but see R1.

## 4. Required control audits

### 4.1 FASTA privacy and remote disclosure
See section 2. The remote service is contacted only on explicit user action. No raw sequence is persisted server-side; D1 keeps a SHA-256 digest for deduplication.

### 4.2 CSV formula injection in exports — GAP G3
Audit of the export code found **no formula-injection mitigation**:
- `web-platform/public/js/statistics.js` `toCsv`, `blast.js` `toBlastCsv`, and the inline
  exporter in `taxonomy-app.js` only RFC4180-quote cells containing `,`, `"`, CR or LF.
- `python-engine/src/smartbio/exports.py` `write_csv` and `blast_runner.py` `write_csv` call
  pandas `to_csv(index=False)` with no neutralisation.
User-controlled FASTA headers become `qseqid` / `query_id` / `description` columns, so a header
such as `=HYPERLINK("http://evil","x")` can be interpreted as a formula when the CSV is opened
in Excel or Sheets. Quoting does not stop formula evaluation in those tools. No test asserts
formula safety. Recommendation (outside this agent's file ownership): prefix risky leading
characters (`= + - @`, also tab/CR) with `'` in every CSV writer and add a regression test.

### 4.3 HTML injection in verdict / report / UI
- Server: `_lib.js` `htmlEscape` escapes `& < > " '`; `errorResponse` escapes all messages.
- Python report: `taxonomy/report.py` `_esc` uses `html.escape` (quotes included) for every
  interpolated metadata, verdict, reason, evidence and disclaimer value.
- JS report: `report.js` `esc` escapes `& < > "` (not `'`, see G6) and is applied to all
  interpolated values.
- UI: `taxonomy-app.js` uses `innerHTML` only with `escapeHtml()`-processed values; other
  dynamic text uses `textContent`. `benchmark.html` builds its SVG/table from a hard-coded
  fixture. `difficult_groups` links use `group.source_url` from a repo-controlled JSON file —
  a `javascript:` URL there would be dangerous; treat that file as trusted input.
- Minor gaps: `taxonomy-app.js` `supportLine.innerHTML` interpolates numeric support values
  without `escapeHtml`; `qTitle.textContent` double-escapes a query ID (cosmetic). G6.

### 4.4 CSP / no-inline-scripts
`web-platform/public/_headers` sets `default-src 'self' blob:; script-src 'self'; style-src 'self';
connect-src 'self'` with no `unsafe-inline`, `unsafe-eval`, nonce or external origin. This is
correct for the stated goal, and `connect-src 'self'` confines browser network access to the
same-origin Pages API. `blob:` is required by the client-side download helper.
- **Gap G4:** `benchmark.html` contains an inline `<script type="module">` and an inline
  `style="..."` attribute; the current CSP will block both, so that page's table/chart will not
  render. The fix (move the script/style into first-party files under `public/`) is outside
  this agent's ownership and has not been made.
- This revision of `_headers` additionally pins `form-action 'self'` and `frame-src 'none'`
  (form-action has no `default-src` fallback; frame-src is pinned explicitly).

### 4.5 RID enumeration / rate-limit abuse
RID format is validated, polling is throttled per RID, unknown RIDs return 404, and results
require `status = complete`. However there is no authentication and no per-IP/global limit, and
history publishes recent RIDs (G1) and submit has no abuse controls (G2).

### 4.6 NCBI API abuse
Allow-listed `DATABASE=16S_ribosomal_RNA` and `PROGRAM=blastn`, fixed parameters, `tool`/`email`
identification from env vars, bounded backoff, and a `MOCK_NCBI` test mode that never contacts
NCBI. Residual risk: anonymous submit calls can consume the project's NCBI quota (G2).
NCBI identification values are not secrets.

### 4.7 D1 injection
No injection found. Statements are parameterised and RIDs are pattern-validated; the LIMIT
parameter is a clamped number. `tests/helpers/fake-d1.mjs` asserts the exact SQL and bound
values for every statement.

### 4.8 Secret handling
- Web: `BLAST_DB` (binding), `NCBI_TOOL`, `NCBI_EMAIL` and `MOCK_NCBI` come from environment /
  Pages settings; no credential literals are required in the repository.
- API responses are `no-store` and upstream errors are reduced to generic messages, so secrets
  and the raw FASTA cannot leak through error bodies.
- **Gap G7:** the Python CLI accepts `--api-key` (`main.py`), which is visible in process lists
  and shell history. It deviates from "env vars only" even though the code does not log the
  URL or the key. Prefer an env var.
- Secret-scan result: see section 6. No live secret value was found.

### 4.9 Dependency supply chain
- npm `package-lock.json` pins exact versions with `integrity` hashes, but the only package is
  the dev-only `playwright` (plus transitive `playwright-core`): **no runtime npm dependencies**.
- `python-engine/requirements.txt` uses version ranges and there is no Python lock or hash
  file, so deployed versions are not reproducible; no `pip-audit`/Dependabot step in CI.
- CI uses mutable action tags (`checkout@v4`, `setup-python@v5`, `setup-node@v4`) rather than
  commit SHAs.
- A prebuilt `ncbi-blast-2.17.0+-win64.exe` is committed without a checksum or licence text
  (see `THIRD_PARTY_NOTICES.md`); its provenance is UNVERIFIED in-repo.
- Recommended (outside ownership): pin Python versions/hashes, enable dependency scanning, and
  record a SHA-256 + provenance for the bundled BLAST+ binary.

## 5. Test coverage mapping

| Control | Existing tests | Coverage gap |
| --- | --- | --- |
| FASTA validation / limits | `python-engine/tests/test_fasta.py`; `web-platform/tests/core.test.mjs`; `blast_lib.test.mjs` ("rejects unsafe or empty FASTA inputs") | none significant |
| D1 parameterisation / RID SQL | `web-platform/tests/helpers/fake-d1.mjs` asserts exact SQL + bound values; `blast_submit.test.mjs`, `blast_status.test.mjs`, `blast_results.test.mjs`, `blast_history.test.mjs` | no test against a real D1 instance |
| HTML escaping / response headers | `blast_lib.test.mjs` ("htmlEscape escapes all HTML-sensitive characters", "restrictive CSP and nosniff headers", same-origin CORS) | Python `test_report.py` checks metadata keys only — no escaping regression test |
| RID validation / 404 / throttling | `blast_lib.test.mjs` (`isValidRid` via RID cases), `blast_status.test.mjs` (429 + Retry-After), `blast_results.test.mjs` (unknown/invalid RIDs) | no test for cross-user RID enumeration (G1) or global rate limiting (G2) |
| NCBI usage / retry / mock isolation | `blast_lib.test.mjs` (params, response parsing, `ncbiFetchText` retries), `blast_submit.test.mjs` ("mock mode never contacts NCBI"), `test_taxonomy_online.py` | no test asserting an overall submit rate cap |
| CSV exports | `web-platform/tests/blast.test.mjs` ("export CSV"), Python `test_blast.py` (`test_dataframe_export`) | **no formula-injection test (G3)** |
| Verdict / report integrity | `test_verdict.py`, `test_report.py`, `verdict.test.mjs`, `report_metadata.test.mjs`, Python/JS parity suites | no escaping test in report tests |
| Secret hygiene | none | no automated secret scan in CI; checklist in section 6 is manual |

Commands used for the local check (from repo root):
`python -m pytest python-engine/tests` and `cd web-platform && npm test`. These were not
modified; this agent added no tests because it owns no test files.

## 6. Secret-scanning checklist and observed result

Patterns to grep (case-insensitive, repo-wide, excluding `node_modules`, `.git`, caches,
compiled binaries): `api[_-]?key|apikey`, `secret`, `token`, `password|passwd`,
`AKIA[0-9A-Z]{16}`, `private[_-]?key|-----BEGIN [A-Z ]*PRIVATE KEY-----`.

Command actually run from the repo root (PowerShell):

    $pattern = '(?i)(api[_-]?key|apikey|secret|token|password|passwd|AKIA[0-9A-Z]{16}|private[_-]?key|-----BEGIN [A-Z ]*PRIVATE KEY-----)'
    $files = Get-ChildItem -Recurse -File -Force | Where-Object { $_.FullName -notmatch '\\(node_modules|\.git|\.pytest_cache|__pycache__)\\' -and $_.Extension -notin @('.exe','.pyc','.dll','.gz') }
    $files | Select-String -Pattern $pattern -AllMatches | ForEach-Object { "{0}:{1}: {2}" -f $_.Path, $_.LineNumber, $_.Line.Trim() }

Result: **19 matching lines across 150 scanned files; zero live secrets found.** All hits were
benign keyword uses: parameter/variable names (`api_key` in `main.py` and `resolver.py`),
documentation URLs about NCBI API keys (`docs/API_CATALOG.md`, `docs/NCBI_API_NOTES.md`),
prose such as "no secrets in repo or logs" (`docs/CONTRACTS.md`, `_lib.js`, `functions/README.md`),
and "token" meaning a whitespace-delimited FASTA token (`README.md`, `benchmark/queries.py`).
No `AKIA...` access-key IDs, no PEM "BEGIN PRIVATE KEY" blocks, and no literal credential
assignments were found. This is a keyword scan, not an entropy scan; repeat it before each
release and investigate any new hit.

## 7. Genuine risks and recommended follow-ups (not fixed here)

| ID | Severity | Issue | Owner-side remediation |
| --- | --- | --- | --- |
| G1 | Medium | Public `history` enumerates RIDs; `/results/:rid` has no per-user check | Add auth or sign/encrypt RIDs into per-user capabilities; stop publishing RIDs globally |
| G2 | Medium | No global submit/rate limit; NCBI quota and D1 can be exhausted anonymously | Cloudflare rate limiting / Turnstile on `/api/blast/submit` and `/api/blast/status/*` |
| G3 | Medium | CSV formula injection in all CSV exports | Neutralise leading `= + - @` in every CSV writer; add regression tests |
| G4 | Low | CSP blocks `benchmark.html` inline script/style | Move them to first-party `public/js`/`public/css` files |
| G5 | Low | CLI writes/prints raw FASTA in validation JSON/stdout | Strip `sequence` from printed/written validation, or document local-only handling |
| G6 | Low | JS report `esc()` lacks `'`; `supportLine.innerHTML` unescaped | Escape all dynamic values; prefer `textContent` |
| G7 | Low | Python `--api-key` CLI argument | Accept the key from an environment variable instead |
| G8 | Info | No Python dependency lock/hashes; BLAST+ binary unverified | Pin and hash dependencies; record binary provenance |

No tests were weakened, deleted or skipped by this audit.
