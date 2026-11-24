# API Integration Roadmap — Smart Bioinformatics AI

**Version:** 1.0 (vision reset, 2026-11-24)
**Detailed research:** `docs/discovery/RESEARCH_bio_databases.md`, `docs/discovery/AUDIT_api_infra.md`.
**Critical rule:** this is a **catalog and plan**, not a list of implemented integrations. An API appears as *implemented* here only when code exists AND tests exercise it. Live-service verification is recorded separately in `docs/EVIDENCE_LEDGER.md`.

---

## 1. Legend

| Status | Meaning |
|---|---|
| **IMPLEMENTED** | Code exists in the repo; tests exist (possibly with mocked network). |
| **LIVE-VERIFIED** | A real call to the service was made and recorded in the evidence ledger. |
| **CATALOG-ONLY** | Researched and documented; no code. Must not be described to users as available. |
| **REJECTED** | Terms/licensing/access unresolved or unacceptable. |

## 2. Current state (verified by the API audit, 2026-11-24)

### 2.1 Implemented endpoints (this project)

| Endpoint | Method | Status | Notes |
|---|---|---|---|
| `/api/blast/submit` | POST | IMPLEMENTED (consent-gated) | Validates FASTA, hashes input, optionally calls NCBI `CMD=Put`, stores RID in D1. **Now requires a single-use `consent_token`** bound to the input hash/database/program; typed 403 on missing/invalid/denied/expired/used/mismatched tokens, in mock mode too. Migration `0003_blast_consent.sql`. Source: `functions/api/blast/submit.js`, `functions/api/blast/_lib.js`. |
| `/api/blast/status/[rid]` | GET | IMPLEMENTED | Polls NCBI `CMD=Get`; 1 request/minute/RID limit (429 + `Retry-After`). Source: `status/[rid].js`, `_lib.js:8`. |
| `/api/blast/results/[rid]` | GET | IMPLEMENTED | Returns cached TSV. Source: `results/[rid].js`. |
| `/api/blast/history` | GET | IMPLEMENTED | Lists stored requests. Source: `history.js`. |

**No browser UI caller exists** for these legacy endpoints (`docs/discovery/AUDIT_frontend_ux.md`) — the browser analysis pages stay local. The consent gap recorded in that audit is **closed**: `POST /api/ai/plans/:id/approve` now returns `blast_consent` (token + hash/database/program/expiry) for an approved external-egress step, and `/api/blast/submit` refuses direct anonymous calls with a typed 403. Status/results transmit only an RID. This closes the M4 part of the integration gap; a legacy UI caller remains a separate, unimplemented item.

### 2.2 Known constraints of the NCBI BLAST URL API

- `CMD=Put` / `CMD=Get` against `https://blast.ncbi.nlm.nih.gov/Blast.cgi` (`functions/api/blast/_lib.js`: `BLAST_API_URL`, `buildPutParams`, `buildStatusParams`, `buildResultsParams`).
- Sequence egress is now **gated**: `CMD=Put` requires an approved, single-use consent token (`migrations/0003_blast_consent.sql`, `resolveBlastConsent` / `consumeBlastConsent`). `CMD=Get` carries only the RID and needs no consent.
- Documented but **unenforced** in current code: 10-second contact floor, no more than ~100 searches per 24 h, avoid peak hours (`docs/NCBI_API_NOTES.md:24-29`). The new consent gate does not replace these provider limits.
- RID lifetime/expiry is **still not handled** — a stale RID is treated like any other failure. **Open gap.**
- Identification is **partially implemented**: `withIdentification` in `blast/_lib.js` adds `tool`/`email` from env when configured, but `wrangler.toml` sets neither. **Open configuration gap.**
- There is **no global submit rate limit**; only status polling is limited to one call per minute per RID (429 + `Retry-After`). **Open gap** under multi-user use.
- Exact transmitted bytes are identified by SHA-256 (`input_hash` in `blast_consents`, `blast_requests` and the `ai_blast_consent_issued` audit event). See `docs/DATA_TRANSPORT.md`.
- Full terms/limits must be re-verified before enabling new API agents; see the evidence ledger.

### 2.3 Other integrations in the codebase

- **NCBI E-utilities** (taxonomy resolution): a real Python client exists in `smartbio/taxonomy/resolver.py:81-201`, with email/API key/rate-limit options. Live verification not recorded.
- **E-utilities / Datasets / LPSN / GTDB / BacDive / SILVA / RDP** appear in `docs/API_CATALOG.md` as "adds to project" ideas — **CATALOG-ONLY**. No code except the E-utilities client above.
- Ledgers disagree: `API_CATALOG.md:129` marks BLAST UNVERIFIED while `EVIDENCE_LEDGER.md:7` marks it verified. Reconcile before publication.
- RDP official pages were unreachable during research → **REJECTED pending re-verification**.
- SILVA rRNA data has access restrictions → treat as **restricted / consent-and-licence review required**, not an open API.

## 2.4 Verified external-service facts (official docs, accessed 2026-11-24)

Full detail and source URLs: `docs/discovery/RESEARCH_bio_databases.md`.

| Service | Verified facts | Constraint / flag |
|---|---|---|
| **NCBI BLAST URL API** | `CMD=Put` (QUERY/DATABASE/PROGRAM) → RID; `CMD=Get&RID=…`. JSON2/XML2/CSV output. BLAST software public domain. | **≤1 submission / 10 s**, **≤1 RID poll / min**, >100 searches/24 h → slow queue/block. Set `email` + `tool`. RID lifetime **not stated** in current docs (treat as short-lived). 16S DB identifier not confirmed on official page. |
| **NCBI E-utilities** | ESearch/EFetch/ELink; Entrez field tags. Free NCBI API key raises **3 req/s → 10 req/s** (per the official NCBI policy/Insights documentation; see source index in the research report for access date). | Key must stay server-side; identify requests. |
| **EMBL-EBI Job Dispatcher** | Batches ≤30; valid email required; **submitted data deleted after 7 days**; cite Madeira 2024. | GDPR/consent implications; 7-day result expiry. |
| **ENA** | Portal/Browser APIs capped at **50 req/s** (429 above). | Use server-side proxy. |
| **InterPro / Ensembl REST** | REST endpoints verified (Ensembl v15.12). | Verify current release at call time; record version. |
| **RCSB PDB Data API** | No stated rate limit; 1000-ID batches; explicit caching advice. | Cache; attribute. |
| **UniProt REST** | No auth for basic use; data **CC BY 4.0**; release **2026_04**. | Numeric rate limit unpublished — be conservative. |
| **Reactome** | Data **CC0**; artwork CC BY 4.0; FoamTree needs separate licence. | Attribute artwork appropriately. |
| **GO / ChEBI** | **CC BY 4.0**; GO requires showing release date + DOI to users. | Encode in report footer. |
| **KEGG** | **PAID/restricted** — commercial licence for non-academic use; academic service-provider licence. | **Do not enable** without legal decision. |
| **SILVA** | Registration/terms; commercial limits unverified; mandatory citation (Chuvochina 2026). | Restricted — licence review before use. |
| **GDC / dbGaP / GTEx** | Individual-level data restricted (tokens / DUA). | Out of scope. |
| **RDP II** | Reported discontinued by SILVA. | Reject. |

**Consent rule:** explicit opt-in is required before transmitting any user sequence to BLAST, EBI Job Dispatcher, InterProScan or UniProt tools — especially for human or proprietary data. Cache results locally (RID / EBI 7-day expiry) and record source, release, DOI and licence. CORS is **not guaranteed** for these APIs — use a server-side proxy; keep NCBI keys and GDC tokens server-side.

## 3. Integration policy (applies to every new API agent)

1. **Verify before enabling.** Record endpoint, terms, rate limits, licensing, attribution and access date in `docs/EVIDENCE_LEDGER.md` and the detailed research report.
2. **Consent gate.** No request to a third party without `approval` + per-step `consent.granted`; the consent record identifies exactly what bytes are transmitted.
3. **Rate limit and identify.** Per-provider limiter; set `tool`/`email` where required; never expose keys to the browser.
4. **Store provenance.** `source.url`, `source.retrieved_at`, `source.release`, response hash. Cache responses as artifacts; do not silently refetch.
5. **Fail closed.** Unverifiable response schema → step `failed` with flags; never guess values.
6. **Respect data-use terms.** Some databases prohibit redistribution or require citation; encode in the plugin's `references` and report.

## 4. Roadmap by phase

### Phase A — Harden what exists (M1–M4 of `IMPLEMENTATION_ROADMAP.md`)

Status labels below are reconciled against code on 2026-11-24; **CATALOG-ONLY items are never marked implemented**.

| Item | Status | Action / acceptance | Evidence or remaining work |
|---|---|---|---|
| NCBI BLAST consent gate | **IMPLEMENTED** | Add consent to plan; block `submit` without approval; automated tests | Migration `0003_blast_consent.sql`; typed 403 gate in `submit.js`; token issuance in `approve.js`; tests in `blast_submit.test.mjs`, `blast_lib.test.mjs`, `ai_contract.test.mjs` (including fake/mock NCBI) |
| RID TTL handling | **GAP** | Mark expired RIDs `failed` with reason; offer re-submit; test with frozen time | No expiry logic in `status/[rid].js`; stale RIDs still surface as generic failures |
| Rate limiting | **PARTIAL** | Global + per-RID limits; configurable; load test with fake clock | Per-RID one-minute poll limit EXISTS (`status/[rid].js`); **no global submit limit and no 10-second NCBI floor** |
| Identification | **PARTIAL** | Set `tool`/`email` from env; config documented | Code path EXISTS (`withIdentification`); `wrangler.toml` leaves both unset → not active in deployment |
| Ledger reconciliation | **GAP** | Resolve BLAST verification disagreement; single source of truth | `docs/API_CATALOG.md` and `docs/EVIDENCE_LEDGER.md` still disagree (§2.3) |
| UI caller | **GAP** | Wire the AI workspace to submit/status/results with consent UI; E2E demo | No browser caller of legacy endpoints; approval now returns `blast_consent` so a future caller can use the token without re-consenting |

### Phase B — Verified, low-risk additions (post-MVP, subject to verification)

| Service | Use | Status | Prerequisites |
|---|---|---|---|
| **NCBI E-utilities** (taxonomy, PubMed metadata) | Resolve tax IDs, verify citations | Code exists; CATALOG-ONLY for new uses | Free API key (10 req/s), contact email, evidence ledger entry for citation use |
| **UniProt REST** | Protein sequences/annotation for future proteomics plugin | CATALOG-ONLY (verified CC BY 4.0, release 2026_04) | Record release; conservative rate limit |
| **InterPro REST** | Protein family/domain annotation | CATALOG-ONLY (endpoint verified) | Record release; consent for sequence submission |
| **RCSB PDB Data API** | Structure metadata for structural plugin | CATALOG-ONLY (verified) | Cache; attribute |
| **EMBL-EBI Job Dispatcher / ENA / ArrayExpress** | Sequence/omics data | CATALOG-ONLY (verified: ≤30 batch, 7-day deletion, 50 req/s ENA) | Server-side proxy; consent; 7-day expiry handling |

### Phase C — Restricted / high-risk (architecture only)

| Service | Why deferred |
|---|---|
| SILVA | rRNA data access restrictions; licence review required |
| RDP | Official site unreachable during research; terms unverifiable |
| GTDB / LPSN / BacDive | Terms need re-verification; BACdivE was previously marked unverified in ledger |
| KEGG | Licensing/terms may restrict programmatic redistribution |
| TCGA / GDC / SRA | Large data, consent and storage burden; out of MVP scope |

## 5. Browser vs server-side

- Existing APIs are called **server-side** (Worker `functions/api/**`). This stays the pattern: biological APIs generally do not set browser-friendly CORS headers, and API keys must not be exposed.
- The local Python agent may call APIs for jobs that require local data, but only via the consent gate and with the same provenance recording.
- All external calls are recorded in the audit log with `actor`, `target`, `bytes_sent` and `timestamp`.

## 6. Cost and quota posture

- No paid API is required for the MVP. NCBI BLAST URL API and E-utilities are free subject to usage limits.
- Public Galaxy servers are free with quotas (250 GB on usegalaxy.org) but must not be hammered; any Galaxy adapter is post-MVP and rate-limited.
- Any future paid service must be documented in `COMPUTE_INFRASTRUCTURE.md` and must not be enabled by default.

## 7. Acceptance checks (reconciled 2026-11-24)

- [x] No code path sends sequence data without a consent record — legacy `CMD=Put` is gated by a single-use token; no other Worker/UI path transmits a dataset (`docs/DATA_TRANSPORT.md`).
- [x] Direct calls to `/api/blast/submit` cannot bypass the gate — 403 typed errors for missing/invalid/denied/expired/used/mismatched tokens, including in mock mode; tested.
- [x] `/api/tools` and the UI never list a CATALOG-ONLY integration as available — four registered local tools only.
- [ ] Every implemented API agent has a source/version/retrieval timestamp in provenance — BLAST Worker records input hash and parameters; the Python E-utilities client has no live-verification record. **Open.**
- [ ] Rate limits and RID expiry have tests — per-RID polling limit is tested; global submit limit and RID TTL are **not implemented**, so they cannot be accepted. **Open.**
- [ ] Evidence ledger and API catalog tell the same story about BLAST verification — still contradictory (§2.3). **Open.**
- [ ] Browser UI caller for legacy BLAST endpoints exists — no caller today. **Open.**
- [x] `tool`/`email` identification code path exists — but env values are unset in `wrangler.toml`; deployment configuration remains **Open**.
