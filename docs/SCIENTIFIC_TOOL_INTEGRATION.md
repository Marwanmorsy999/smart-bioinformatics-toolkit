# Scientific Tool Integration - Registry, 16S/BLAST Chain and Honest Status - CORE PRODUCT COMPLETION

**Verification date:** 2026-11-26
**Branch:** `product/core-completion`
**Base commit:** `8105956c908ea6c0d5c053b5ed2c13b86516d2a2`
**Starting commit (M7.6 reconciliation):** `0303e615e4cdf71a9b97038773a537beab9acdb9`
**Final commit:** `543358f8aa466b78fa8fab8c78eb2392e40f5881` (M7.6 code fix + documentation reconciliation)
**Current staging deployment:** `c00c6245-c91e-4bc2-9b64-881677b97972`
**Status:** Implementation description. This document is documentation-only: this worker changed no HTML/CSS/JS/config/migration/secret and called no live provider. A separate code-fix worker is implementing the corrected NCBI database identifier and 16S readiness changes after the starting commit; none of that code is claimed here.
**CURRENT implementation snapshot:** branch `product/core-completion`, base `8105956â€¦`, starting commit `0303e615â€¦`, staging deployment `c00c6245-c91e-4bc2-9b64-881677b97972`, verification date 2026-11-26.

**History (preserved, superseded â€” not current):** earlier branch HEAD at the M7.5 documentation-pass task start was `32abf86e6ab8da6819454103286c06e0b62d1076`; earlier staging deployments were `892f4266-2afa-4a0f-aa3f-00585764faf5` (registry, assistant, 16S) then `ed08189a-5db2-41b1-98f3-732b5c97992f` (resume-by-RID). Production untouched. `MOCK_NCBI` on staging was set to `0` to permit live NCBI; no other secret/provider was activated. No new live NCBI call occurred in this documentation pass.

---

## 1. The registry is the single source of truth

`web-platform/providers/tools/registry.js` derives one frozen catalog at module load from three authoritative sources; it invents no capability and upgrades no execution claim (`:1-13,229-233`):

1. `functions/api/ai/registry.tools.generated.js` â†’ `TOOLS` (validated tool manifests; generated from `shared/plugins/*.json`, do not hand-edit).
2. `functions/api/ai/registry.js` â†’ `WORKER_TOOLS` (the Worker-side `ncbi.blastn` capability).
3. `functions/api/workspace/catalog.js` â†’ `WORKFLOWS` and `CATALOG_VERSION`.

`TOOL_CATALOG_VERSION = CATALOG_VERSION = "1.0.0-m7.4"` (`:17`; verified by importing the module). `TOOL_CATALOG` is deep-frozen; `listCatalog()` returns a defensive copy and `getCatalogEntry(id)` / `catalogIds()` are read-only helpers (`:57-65,235-247`).

**Verified count: 12 entries** - 2 workflows + 9 generated local tools + 1 Worker tool:

`16s-rrna-identification`, `msa-phylogenetics`, `phylogenetics.validate`, `phylogenetics.align`, `phylogenetics.tree`, `phylogenetics.report`, `phylogenetics.workflow`, `sequence-stats.validate`, `sequence-stats.profile`, `microbiome-16s.blast-parse`, `microbiome-16s.taxonomy`, `ncbi.blastn`.

### 1.1 Catalog entry schema

Every entry carries the same shape (workflow and tool entries differ only in source fields; `:74-141,143-227`):

| Field | Meaning / derivation |
|---|---|
| `id`, `kind` | `"workflow"` or `"tool"`; id comes from the owning source. |
| `scientific_purpose`, `description` | Paraphrase of the source description; no new scientific claim (`TOOL_PURPOSES`, `:43-55`). |
| `input_schema`, `output_schema` | Copied from the manifest; workflow schemas use names from `required_parameters`/`optional_parameters`/`expected_outputs` with **no invented wire types** (`:93-107`). |
| `supported_formats` | Derived from input schema (`fasta_text â†’ fasta`, `tsv_text â†’ tsv`) or copied from the workflow. |
| `validation_requirements` | Derived from required inputs/params with declared constraints; workflows copy `validation_capabilities`. |
| `execution_location` | One or more of `browser`, `worker`, `python`, `external`; external egress tools use `["worker","external"]`. |
| `availability` | `available`, `browser-only`, `local-only`, `partial`, `disabled`, `blocked` (`AVAILABILITY_STATES`, `:19-22`). |
| `available`, `production_ready`, `availability_reason` | Declared flags only. Generated tools set `production_ready:null` because the manifest declares availability, not readiness (`:195`). |
| `blocked_paths` | For phylogenetics: the unverified remote tree/retrieval/validation path. |
| `version`, `dependencies`, `external_destinations` | Copied from the source; no new backend is implied. |
| `limitations`, `recommended_workflow` | Source limitations plus honest guidance; always end with the approval/consent requirement. |
| `entry_point` | Link to an **existing** page (`16s.html`, `blast.html`, `phylo.html`, `taxonomy.html`, `index.html#tools`). |
| `source` | Names the authoritative file (and workflow version) so the entry can be audited. |
| `workflow_context` (phylo tools only) | Links the adapter to workflow `availability:"partial"` and its real `production_ready` flag without upgrading it (`:198-205`). |

`deepFreeze` and `copy` ensure the browser cannot mutate the source of truth.

---

## 2. `GET /api/tools/catalog` endpoint contract

`web-platform/functions/api/tools/catalog/index.js` (16 lines):

- Public, read-only projection. **No auth, no D1, no provider flags, no secrets, no mutation.**
- Accepts `GET` (and `OPTIONS` preflight) via `requireMethod`; other methods get a typed rejection.
- Response `200`: `{ tools: listCatalog(), catalog_version: TOOL_CATALOG_VERSION }`.
- The existing `GET /api/tools` endpoint is deliberately untouched; the capability browser uses the new catalog endpoint only.
- The route is registered in `web-platform/worker.js`.

The assistant UI requires `Array.isArray(data.tools)` and a string `catalog_version` before rendering, and otherwise displays "Registry unavailable - no capabilities are fabricated." (`public/js/assistant.js:657-689`). Under `file://` it lists nothing. Verified live staging result: 12 entries, version `1.0.0-m7.4`.

---

## 3. Tool inventory classification

| Group | Members | Status (as advertised by the registry) |
|---|---|---|
| Workflows | `16s-rrna-identification` | **PARTIAL / `production_ready:false`** after M7.6 reconciliation. The base catalog declared `available` / `production_ready:true`, but the overall end-to-end workflow is not production-ready until genuine NCBI results are retrieved, validated, displayed and exported. Browser + local agent + existing consent-gated NCBI path are real; the real job `GF4KCK07016` FAILED at NCBI (`Status=FAILED`, invalid database `16S_ribosomal_RNA`) and no real TSV was retrieved (`docs/evidence/M7_6_NCBI_DIAGNOSIS.md`). |
| Workflows | `msa-phylogenetics` | **`partial`**, `production_ready:false`; blocked path: remote tree/retrieval/validation (unverified). |
| Local Python tools (9) | `phylogenetics.validate/align/tree/report/workflow`, `sequence-stats.validate/profile` | `available:true`, `local-only`, v1.0.0; real deterministic adapters in `python-engine/src/smartbio/plugins/`. |
| Local Python tools (9) | `microbiome-16s.blast-parse`, `microbiome-16s.taxonomy` | **`available:false` / `disabled`** - required `tsv_dataset` + `local_database` not satisfiable in this MVP; they parse and decide, never run BLAST. The **browser** BLAST TSV parser and taxonomy remain available and are exercised with clearly labelled synthetic TSV only; browser availability is not negated by these unavailable local Python variants. |
| Worker tool (1) | `ncbi.blastn` | `available:true`, external egress, version `1.0.0`; reachable only through approval + single-use consent and the `/api/blast/*` endpoints (`functions/api/ai/registry.js:15-60`). |
| Browser utilities (not catalog tools) | FASTA validation, statistics, BLAST TSV parse/filter, taxonomy consensus, verdict, CSV-safe, workspace local, project context | Real local code, no network; inventoried in `docs/CORE_CAPABILITY_MATRIX.md` آ§1. |
| External services | NCBI BLAST | The only implemented egress. A genuine consent-governed submission produced real RID `GF4KCK07016`, but the canonical `CMD=Get` response is `Status=FAILED`: NCBI rejected the invalid bare database `16S_ribosomal_RNA` (`Error: No alias or index file found â€¦`). No real TSV was retrieved. The `FORMAT_OBJECT=SearchInfo` `Status=READY`/`ThereAreHits=no` describes the format request, not the search. **M7.7 correction:** valid SearchInfo QBlastInfo is search-status evidence in `mode="SearchInfo"`, but it CONTRADICTS canonical `CMD=Get` `Status=FAILED` for the same RID -> typed `status_conflict`; production re-verifies canonical `CMD=Get`, only canonical `complete` unlocks; invalid database is decisive, no real result regardless (`docs/evidence/M7_6_NCBI_DIAGNOSIS.md` M7.7). Corrected identifier `rRNA_typestrains/16S_ribosomal_RNA` is implemented in the final commit; a corrected live submission requires **explicit owner authorization** and has not happened (`docs/evidence/M7_6_NCBI_DIAGNOSIS.md`). |
| External services | Galaxy, smarts.bio, 9Router | Disabled / fail-closed; no live Galaxy call, no new provider; 9Router is the only chat-capable adapter but has no URL/key. |

Phylo caveat is repeated everywhere on purpose: a real MAFFT step completed once historically, but no MAFFTâ†’IQ-TREE completion, artifact retrieval, validation or report is claimed (`docs/M7_3_PHYLOGENETICS_WORKFLOW_REPORT.md`; `functions/api/workspace/catalog.js:44-48`). The local phylo adapters remain real and available as local computations; the remote multi-step path is **partial/not production-ready**. M7.11.1 adds read-only recovery of an already-succeeded provider MAFFT job by id (no second submission) and relaxes the raw-sequence input gate to accept unequal lengths before alignment; neither change claims a verified live end-to-end run.

---

## 4. 16S / BLAST end-to-end chain with real consent binding

Implemented in `web-platform/public/16s.html`, `public/js/16s-flow.js`, `public/css/16s-flow.css`, plus the Worker endpoints. Every stage is user-visible and no stage invents a value.

1. **Public FASTA input.** Paste, file upload, or an explicitly labelled example input (`16s-flow.js:170-175`, "Example INPUT ONLY. It is not a result"). The request endpoint caps inline FASTA at 64 KiB (`functions/api/ai/_lib.js` `MAX_FASTA_BYTES`); the BLAST endpoint caps it at 10,000 characters and the flow disables request creation beyond that (`16s-flow.js:140-147,203-238`).
2. **Local validation.** `validateFasta(state.fasta,"dna")` reuses `public/js/fasta.js`; the browser shows record count, valid/invalid, byte size, per-record lengths, validation errors and ambiguous-symbol warnings, plus a browser SHA-256 (`16s-flow.js:99-159`). No bytes leave the browser at this stage.
3. **Real plan.** `POST /api/ai/requests` with text/fasta/filename returns request/dataset ids and a deterministic plan. The flow refuses to continue unless `intent === "identify_taxa"`, `step.tool_id === "ncbi.blastn"` and `external_egress === true` (`16s-flow.js:203-238`). The rendered plan shows plan id, request id, step/params (`{"database":"16S_ribosomal_RNA","program":"blastn"}`), external egress, consent requirement, external service and limitations, and states "This plan came from the existing deterministic planner. It is not an approval and no job has been created yet." (`16s-flow.js:177-195`). Database/program come from `ALLOWED_DATABASE`/`ALLOWED_PROGRAM`, never free text (`planner.js:94-105`). **M7.6 diagnosis:** the submitted value `16S_ribosomal_RNA` is the invalid bare identifier that NCBI rejected; its current web-BLAST value is `rRNA_typestrains/16S_ribosomal_RNA`. The corrected identifier is implemented in the final commit; this historical plan value is preserved as evidence of what was actually submitted.
4. **Explicit approval and single-use consent.** The user must tick an explicit checkbox, then `POST /api/ai/plans/:id/approve` with `approvals:[{step_id:"step_1",approved:true,consent_granted:true}]` and `consents:["external-blast"]` (`16s-flow.js:240-279`). The UI shows "Consent issued (token value intentionally not displayed)" with database, program, consent-bound input hash and expiry. A missing token aborts with "No BLAST consent token was issued. Nothing was submitted." No chat message or plan draft can substitute for this step.
5. **Submission.** `POST /api/blast/submit` re-hashes the FASTA, validates database/program, resolves consent against (hash, db, program, expiry, unused), then atomically **burns** the token before any external call (`functions/api/blast/submit.js:56-96`). An audited pending egress row with hash, target, byte counts and mock flag is written before the call; it is finalized with success/status/error/RID afterwards (`:98-152`). Real mode performs NCBI `CMD=Put`; mock mode returns a `MOCK...` RID. Response is `{rid,status:"queued"}`. **M7.7 additive:** real NCBI branch additionally returns `rtoe` (`{rid,status:"queued",rtoe}`, numeric seconds or null) captured via `parsePutResponseDetailed`, and records `rtoe` in audit detail; `parsePutResponse` unchanged; no sequence recorded; no D1 migration. **This `queued` label was the app-level status returned at submission time, not NCBI's canonical final status:** the canonical `CMD=Get` response captured on 2026-11-26 is `Status=FAILED` with the exact database error (`docs/evidence/M7_6_NCBI_DIAGNOSIS.md`). Mock RID `MOCK07EFC2C1AEAC02A2` is synthetic only.
6. **60-second-gated status.** `GET /api/blast/status/:rid` requires a stored RID, enforces `POLL_INTERVAL_MS` server-side with `429` + `Retry-After` (`functions/api/blast/status/[rid].js:38-74`), and calls NCBI only when the interval has elapsed. The browser also runs a 10 s submission throttle, a 60 s status countdown, auto-schedules polls for open statuses (`queued`, `running`, `waiting`), handles `429` by backing off, and never re-polls a `complete`/`error`/`failed` job (`public/js/16s-flow.js:9-13,281-411`). Real mode parses the provider status; mock mode returns `complete`. **M7.6 correction:** the historical parser scanned the first `Status=`/`Status:` token anywhere in the HTML with a `queued` default, did not distinguish the canonical `CMD=Get` search-status block from the `FORMAT_OBJECT=SearchInfo` format-request block or its stale `Status: Searching` placeholder, and never surfaced NCBI's error paragraph. It therefore reported an app-level `queued` state while the search had actually FAILED (`docs/evidence/M7_6_NCBI_DIAGNOSIS.md`). **M7.7 correction:** `parseQBlastStatus` now collects ALL `Status=` values across QBlastInfo blocks, treats valid SearchInfo QBlastInfo as search-status evidence, removes `format_status_only`, and surfaces contradictory evidence as typed `status_conflict` (terminal; reconciliation via `reconcileStatusEvidence`, both evidences preserved); nothing malformed/empty/timed-out/non-2xx is mapped to `queued`; canonical `CMD=Get` re-verification and only-canonical-complete gating are unchanged.
7. **Result retrieval.** `GET /api/blast/results/:rid` returns `409` until the row is `complete`, then fetches tabular text from NCBI in real mode (`MOCK_TSV` in mock mode), caches it in D1 and returns `text/plain` (`functions/api/blast/results/[rid].js:38-76`). **No real TSV was ever retrieved** for RID `GF4KCK07016`: the job FAILED at NCBI because of the invalid database identifier. The only TSV obtained in this program was the labelled synthetic/mock TSV.
8. **Real parsing, table, taxonomy, provenance, downloads.** The browser detects the schema (`blastn_local_v1` / `extended` / `standard` / `auto`), parses with `public/js/blast.js`, analyses per-query hits with `analyzeBlast`, derives conservative taxonomy with `analyzeTaxonomy` (no mapping file uploaded, so unresolved lineages are flagged), and renders summary cards, a hit table, sequence detail, taxonomy verdicts, warnings/limitations, provenance and TSV/JSON downloads (`16s-flow.js:442-624`). Banner is `SYNTHETIC / MOCK DATA ...` when a mock marker is present, otherwise "Real tabular result retrieved from NCBI ... Independent interpretation is required." **This parsing/analysis/render path is implemented and exercised with clearly labelled synthetic TSV only**; it has never been exercised on genuine NCBI output, and no real result, screenshot, trace or download from a live analysis is claimed.
9. **Resume by RID (historical staging version `ed08189a-...`).** The user can paste an existing 8-64 character RID; the flow validates the format, sets status to `queued`, zeroes `lastStatusAt`, clears prior results and starts status checks. **No new submission is made and the consent token is not reissued** (`16s-flow.js:413-439`). Evidence: `D:\DevCache\Temp\resume-16s.json`, `resume-trace.zip`.

### 4.1 NCBI usage-limit handling

- At most one submission per 10 seconds: enforced client-side by `SUBMIT_THROTTLE_MS = 10 * 1000` and shown as a countdown (`16s-flow.js:9,330-334,359`). The repository notes this as a documented limit; the final commit adds a server-enforced global submission throttle before consent, with typed 429 and Retry-After (best-effort, non-atomic; no schema change).
- At most one status check per minute: enforced server-side by `POLL_INTERVAL_MS` with `429`/`Retry-After` (`blast/status/[rid].js:53-62`) and mirrored by a client countdown with conservative backoff (`16s-flow.js:292-310,367-409`).
- A `MOCK_NCBI` RID or TSV is never reported as real; this is checked both in the endpoint labels and in the browser banner/download filenames.
- **History:** NCBI limits were respected during the earlier live observation: compliant â‰¥60 s checks were used for roughly 100 minutes. M7.6 raw evidence shows the job had actually FAILED at NCBI (`Status=FAILED`) because of the invalid bare database identifier; continued polling of a failed job did not and could not produce a real TSV.

---

## 5. Result fields produced by the real parser

Fields are read only from the retrieved TSV; absent values are rendered as em dashes, never estimated (`16s-flow.js:483-590`).

| Area | Fields shown | Source |
|---|---|---|
| Tabular rows | `qseqid`, `sacc` (fallback `sseqid`), `sscinames` (fallback `sscinames_raw`), `pident`, `qcovs` (fallback computed coverage), `evalue`, `bitscore` | Retrieved TSV columns; `parseBlast` normalizes `standard`, `extended`, `blastn_local_v1`. |
| Parse integrity | `schema`, `data_rows`, `parsed_rows`, `malformed_rows`, `file_errors`; invalid rows are excluded and listed with their error codes | `public/js/blast.js` via `parseBlast`. |
| Sequence-level detail | Per-query passing-hit count, best bit score, best E-value; filtering is deterministic and uses only retrieved fields | `analyzeBlast` (`grouped`, `hit.pass_all`). |
| Taxonomy | Per-query `verdict.status`, `reported_taxon`, `reported_rank`, `candidate_count`, `reasons`, `caution_flags`; `summary.total_queries`, `queries_with_hits`, `queries_without_hits`; global `flags` | `analyzeTaxonomy` with no taxonomy map; ties/abstention/no-hit are explicit. |
| Provenance | RID, tool id/version, parameters, browser input SHA-256, consent-bound input hash, submitted-at, results-fetched-at, result source path, mock-mode state | Plan + consent object + browser/endpoint state. |

Interpretation limits are printed with the result: similarity is not proof of species identity; 16S thresholds are screening references; lineages may be unresolved because no mapping file was uploaded; research use only, not clinical or diagnostic.

---

## 6. Validation, provenance and honesty labels

- **Validation:** local FASTA structure/alphabet validation before a request; schema-aware TSV parsing with typed malformed-row reporting; conservative taxonomy verdicts with abstention; a completeness gate blocks `succeeded` provenance records elsewhere in the control plane (`docs/M7_4_WORKSPACE_DESIGN.md:94-106`). No validator rewrites a scientific value (`docs/PRODUCT_NORTH_STAR.md` آ§1).
- **Provenance:** the 16S result view records both the browser-computed input hash and the server/consent-bound hash, the exact RID, the exact result endpoint, database/program and timestamps. Downloads carry `synthetic` flag and a disclaimer in JSON, and a `mock-` filename prefix when synthetic.
- **No fabricated results:** a failed status produces "NCBI reported a failed job. No results were retrieved; no result is fabricated." (`16s-flow.js:394-398`). A result-fetch error says "Nothing was fabricated." (`:472-474`).

---

## 7. Real / synthetic / unavailable - explicit separation

| Category | What happened | Evidence | How it is labelled |
|---|---|---|---|
| **REAL - browser-only science** | FASTA statistics computed in the browser from NCBI nuccore `NR_074666.1`: 1 record, length 1524, GC 52.1654% (A397 T332 G475 C320), matching an independent calculation of 52.17%. No provider, no local agent, no mock. | `D:/DevCache/Temp/live-16s-evidence/10-browser-only-statistics.png`, `browser-only-trace.zip` | Real browser computation; no third-party egress. |
| **REAL - live submission (and real NCBI failure)** | With `MOCK_NCBI=0`: a genuine consent-governed NCBI submission produced real RID `GF4KCK07016`. Input: 1653 bytes, SHA-256 `07efc2c1aeac02a2eed1cbe8d8479b59ffa00a730e93ed65881b41069c652853`. The canonical `CMD=Get` response is `QBlastInfoBegin / Status=FAILED / QBlastInfoEnd` with `Error: No alias or index file found for nucleotide database [16S_ribosomal_RNA] in search path [â€¦]. Please verify the spelling of â€¦`. NCBI's current database value is `rRNA_typestrains/16S_ribosomal_RNA`; our code used the invalid bare name. | `docs/evidence/M7_6_status_url_raw.json` (URL, HTTP 200 `text/html`, timestamp 2026-11-26T09:30:05.386Z); `docs/evidence/M7_6_searchinfo_raw.json`; diagnosis `docs/evidence/M7_6_NCBI_DIAGNOSIS.md`. Historical app-level record `D:/DevCache/Temp/live-16s-real.json` (final label `queued`) is retained as **history**, not as NCBI's canonical status. | Real submission **only**; the search FAILED at NCBI; no real TSV retrieved. Old "Searching"/"queued" descriptions were the app/format-page view, not the canonical search status. |
| **SYNTHETIC / MOCK** | With `MOCK_NCBI` on: RID `MOCK07EFC2C1AEAC02A2` and a synthetic TSV (`MOCK DATA` / `MOCK000001` / `Synthetic mock organism`). | `D:/DevCache/Temp/live-16s-evidence/mock-offline/retrieved-results.tsv`, screenshots `07`, `web-platform/tests/sixteen_s.e2e.mjs` offline fixture | Banner says SYNTHETIC / MOCK DATA and "NOT a real NCBI result"; downloads prefixed `mock-`. |
| **UNAVAILABLE / BLOCKED** | Real NCBI result retrieval was **never achieved**: the job FAILED at NCBI because our code submitted the invalid bare database `16S_ribosomal_RNA`; no real TSV was ever retrieved. The corrected identifier is implemented in the final commit; a corrected live submission requires **explicit owner authorization** and has not happened. AI chat: no authorized model provider. Remote phylo: partial/no live Galaxy call. R2/auth: inactive. Overall 16S workflow: PARTIAL / `production_ready:false`. | `docs/evidence/M7_6_NCBI_DIAGNOSIS.md`; `functions/api/assistant/index.js`; `docs/CORE_CAPABILITY_MATRIX.md`. Historical `live-16s-real.json` final label `queued` is retained as **history**. | Reported as failed/unavailable, never as success. No fabricated result, screenshot, trace or download from a live analysis was rendered. Mock RID `MOCK07EFC2C1AEAC02A2` is synthetic only. |
| **BROWSER PARSER / TAXONOMY** | Browser BLAST TSV parser and taxonomy are implemented and exercised with **clearly labelled synthetic TSV only**; they are available even though the local-agent Python 16S variants are unavailable. | `public/js/blast.js`, `public/js/taxonomy.js`, `web-platform/tests/sixteen_s.e2e.mjs` offline fixture | Labelled synthetic; not presented as real NCBI output. |

These categories are kept in separate test tables in `docs/CORE_PRODUCT_TEST_REPORT.md`; they are never merged into a single success count. The raw, evidence-based account of why the live job FAILED â€” including exact error text, request URLs/parameters, HTTP status/content-type, timestamps, the search-status vs format-request distinction, and why the old parser misclassified it â€” is `docs/evidence/M7_6_NCBI_DIAGNOSIS.md`, which references `M7_6_status_url_raw.json` and `M7_6_searchinfo_raw.json` by relative path.

---

## 8. Constraints preserved

No auth B2, no R2 activation, no new provider, no migration, no scientific algorithm change, no production deployment and no live Galaxy call. The single "Precision Instrument Bench" design system and existing names are preserved; no second catalog or second design system was introduced. `providers/tools/registry.js` is a derived projection, not a competing registry: `functions/api/ai/registry.js` + the generated manifest and `functions/api/workspace/catalog.js` remain authoritative.


