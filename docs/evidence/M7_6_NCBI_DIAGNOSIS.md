# M7.6 NCBI Diagnosis — RID `GF4KCK07016` (raw-evidence-based)

**Verification date:** 2026-11-26
**Branch:** `product/core-completion`
**Scope:** diagnosis only. This document was written from two already-captured raw evidence files. No NCBI call was made while writing it, no mock result is cited as real, and no screenshot, trace or download from a live analysis is claimed here.

**Raw evidence (relative paths, in this directory):**
- `M7_6_status_url_raw.json` — canonical `CMD=Get` response for the real RID.
- `M7_6_searchinfo_raw.json` — `CMD=Get` + `FORMAT_OBJECT=SearchInfo` response for the same RID.

---

## 1. Bottom line

The genuine, consent-governed NCBI submission produced real RID **`GF4KCK07016`**, but that search **did not stay queued**. NCBI's canonical status response is **`Status=FAILED`**, with the exact error:

> `Error: No alias or index file found for nucleotide database [16S_ribosomal_RNA] in search path [/export/home/splitd/blastdb/blast0:/netmnt/vastsp01/bdprod/dbsvc/blast:/blast/db/disk.blast/blast3634:/blast/db/disk.blast/blast3635:]. Please verify the spelling of …`

Our code submitted the **invalid bare database identifier `16S_ribosomal_RNA`**. NCBI's current web-BLAST database value is **`rRNA_typestrains/16S_ribosomal_RNA`**. The provider rejected the database name, the search FAILED, and **no real TSV was ever retrieved**. The blocker is the invalid database identifier — **not** queueing, **not** our TSV parser.

A corrected database identifier is implemented in the final commit. **A corrected live submission requires EXPLICIT OWNER AUTHORIZATION and has NOT happened.** Mock RID `MOCK07EFC2C1AEAC02A2` is synthetic evidence only and is never treated as real.

---

## 2. Canonical search-status evidence — `M7_6_status_url_raw.json`

| Field | Recorded value |
|---|---|
| Request URL | `https://blast.ncbi.nlm.nih.gov/Blast.cgi?CMD=Get&RID=GF4KCK07016&tool=smart-bioinformatics-toolkit` |
| Parameters | `CMD=Get`, `RID=GF4KCK07016`, `tool=smart-bioinformatics-toolkit` |
| Captured at | `2026-11-26T09:30:05.386Z` |
| HTTP status | `200` |
| Content type | `text/html` |
| Body length | `74100` bytes |
| Recorded status blocks | `qblastInfoBlocks: ["Status=FAILED"]`, `statusMatches: ["Status=FAILED"]` |
| Page title | `NCBI Blast:NR_074666.1 Francisella tularensis subsp.` |

The canonical status lives inside the HTML comment block in the page body:

```html
<p id="qb"><!--
QBlastInfoBegin
	Status=FAILED
QBlastInfoEnd
--></p>
```

Immediately below it NCBI renders its error panel (emphasis added):

```text
There was a problem with the search. Please, contact Help Desk and include RID GF4KCK07016.
Error: No alias or index file found for nucleotide database [16S_ribosomal_RNA] in search path [/export/home/splitd/blastdb/blast0:/netmnt/vastsp01/bdprod/dbsvc/blast:/blast/db/disk.blast/blast3634:/blast/db/disk.blast/blast3635:]. Please verify the spelling of …
```

This is the authoritative search status for RID `GF4KCK07016`. It is a terminal failure, not a queued/running state.

For reference, the page also reports `meta name="ncbi_db" content="16s_ribosomal_rna"`, `ncbi_program=blastn`, `ncbi_algorithm=megaBlast`, and `ncbi_pcid=GF4KCK07016`. These are page metadata, not a successful result.

---

## 3. Format-request evidence — `M7_6_searchinfo_raw.json`

| Field | Recorded value |
|---|---|
| Request URL | `https://blast.ncbi.nlm.nih.gov/Blast.cgi?CMD=Get&FORMAT_OBJECT=SearchInfo&RID=GF4KCK07016&tool=smart-bioinformatics-toolkit` |
| Parameters | `CMD=Get`, `FORMAT_OBJECT=SearchInfo`, `RID=GF4KCK07016`, `tool=smart-bioinformatics-toolkit` |
| Started at | `2026-11-26T09:27:54.831Z` |
| Finished at | `2026-11-26T09:27:55.868Z` |
| HTTP status | `200 OK` |
| Content type | `text/html` (header `content-type: text/html`) |
| Server / date header | `Apache`; `Thu, 26 Nov 2026 09:27:54 GMT` |
| Body length | `24771` bytes |

The QBlastInfo blocks in this page are:

```html
<!-- QBlastInfoBegin Status=READY QBlastInfoEnd -->
<!-- QBlastInfoBegin ThereAreHits=no QBlastInfoEnd -->
```

The visible status table is:

```html
<table id="statInfo" class="READY">
  <tr><td>Request ID</td><td>GF4KCK07016</td></tr>
  <tr class="odd"><td>Status</td><td>Searching</td></tr>
  <tr><td>Submitted at</td><td></td></tr>
  <tr class="odd"><td>Current time</td><td></td></tr>
  <tr><td>Time since submission</td><td></td></tr>
</table>
<p class="READY">This page will be automatically updated in <b></b> seconds</p>
```

### 3.1 Why these values are not the search status

> **M7.7 correction (not erasing the M7.6 text below; see §7 "M7.7 Status-evidence reconciliation").** The M7.6 framing below that a `FORMAT_OBJECT=SearchInfo` `Status=READY`/`ThereAreHits=no` "describes the formatting request, not the search" is **not acceptable without correction**. M7.7 re-reading of the same raw bytes (`M7_7_recheck_searchinfo_raw.json`, re-confirmed reproducible) treats a **valid SearchInfo QBlastInfo block as search-status evidence**: in `mode:"SearchInfo"` (or a clearly-SearchInfo body with no canonical error page) `Status=READY` -> `complete`, `ThereAreHits=yes/no` -> `no_hits` flag, `WAITING/QUEUED` -> `queued`, `RUNNING` -> `running`, `FAILED` -> `failed`, `UNKNOWN` -> `unavailable`. The visible stale `Status=Searching` placeholder table is still **not** authoritative. **But** this evidence CONTRADICTS the canonical `CMD=Get` `Status=FAILED` for the same RID; reconciliation yields typed `status_conflict`, never queued/no-hit/success, and the production results gate re-verifies the canonical `CMD=Get` body where only canonical `complete` unlocks. The M7.6 conclusion is unchanged.

- **`Status=READY`** and **`ThereAreHits=no`** in a `FORMAT_OBJECT=SearchInfo` response describe the **formatting/retrieval request** that the page is servicing, not the underlying BLAST search. They answer "can a result-format object be served for this RID?", not "did the search succeed and produce hits?".
- The visible `Status: Searching` row sits in a JavaScript-driven placeholder table (`statInfo`, empty `Submitted at` / `Current time` / `Time since submission` cells, and an empty auto-update interval). It is a **stale JS placeholder**, not a live NCBI status value.
- For this RID, the authoritative `CMD=Get` response captured about two minutes later is `Status=FAILED` with the database error (§2). A `READY`/`Searching` reading from the SearchInfo page is therefore a misclassification, not evidence of a running or successful search.

---

## 4. Why the old parser misclassified the job

The historical Worker status handler (`web-platform/functions/api/blast/status/[rid].js`) called `parseStatusResponse()` on the HTML returned by `buildStatusParams()` (`CMD=Get`, `RID`, `tool`, `email`). The historical parser was:

```js
const match = String(text || "").match(/Status\s*[=:]\s*(Ready|Running|Waiting|Queued|Failed|Unknown)/i);
if (!match) return "queued";
const raw = match[1].toLowerCase();
if (raw === "ready") return "complete";
if (raw === "failed" || raw === "unknown") return "error";
return "queued";
```

Its defects, in the light of the raw evidence:

1. **Whole-body first-match scan.** It takes the first `Status=`/`Status:` token anywhere in the HTML and never checks which QBlastInfo block it came from. The canonical search-status block and the `FORMAT_OBJECT=SearchInfo` format-request block both emit `Status=` tokens, and the visible `statInfo` table emits a `Status:` row. The parser cannot tell them apart.
2. **No acknowledgement that `READY` on the format page is not search success.** On a SearchInfo page the first match is `Status=READY`, which the parser maps to `complete` — a false success. The visible `Status: Searching` row is not in its vocabulary at all, so a body without a recognised token falls through to the `queued` default — a false "still running".
3. **No error extraction.** It never reads the adjacent NCBI error paragraph. The exact invalid-database message was present in the provider response but was never surfaced to the application, so the failure was invisible.
4. **Consequence in the historical record.** The app-level statuses recorded in `D:/DevCache/Temp/live-16s-real.json` (final label `queued`) and the earlier "Searching" wording were produced by this lossy mapping and by reading format/placeholder pages. They are retained as **history**. They are not NCBI's canonical final status. The canonical `CMD=Get` evidence in §2 is authoritative: `Status=FAILED`.

Note on evidence handling: the historical JSON records `queued` after compliant ≥60 s polling for roughly 100 minutes. That observation is preserved as history. The M7.6 raw capture establishes the terminal state and its cause; it does not retroactively turn the old app-level observation into a real result or a completed analysis.

---

## 5. Conclusion and capability statement

- **Root cause:** invalid NCBI database identifier. Our submission used the bare `16S_ribosomal_RNA`; NCBI's current web-BLAST value is `rRNA_typestrains/16S_ribosomal_RNA`. NCBI rejected the database name and the search FAILED.
- **Not the cause:** provider queueing (the job is terminally FAILED, not queued) and our TSV parser (no real TSV was ever retrieved for it to parse).
- **Capability truth:** the overall 16S end-to-end workflow is **PARTIAL / `production_ready:false`** until genuine NCBI results are retrieved, validated, displayed and exported. Individually verified capabilities remain: browser-only FASTA statistics from public `NR_074666.1` (1 record, 1524 bp, GC 52.1654%, independent 52.17%, SHA-256 `07efc2c1aeac02a2eed1cbe8d8479b59ffa00a730e93ed65881b41069c652853), and the genuine consent-governed submission that produced RID `GF4KCK07016`.
- **Browser parser and taxonomy:** implemented and exercised with **clearly labelled synthetic TSV only**. They remain available even though the local-agent Python 16S tool variants are unavailable; browser availability must not be denied on that basis.
- **Next live step (not performed):** the corrected database identifier is implemented in the final commit. A corrected live submission requires **EXPLICIT OWNER AUTHORIZATION** and has **not** happened. No real results, screenshots, traces or downloads are claimed beyond the two raw evidence files referenced above.

---

## 6. Constraints preserved

No new NCBI call, no other provider call, no Galaxy call, no R2, no auth B2, no new provider, no production deploy, no billing change and no new scientific algorithm. Historical evidence (older commits, older staging deployments, earlier app-level status records and the labelled mock RID `MOCK07EFC2C1AEAC02A2`) is preserved with explicit history/synthetic labels, not erased or relabelled as current or real.

---

## 7. M7.7 Status-evidence reconciliation

**Milestone:** M7.7. This section is added without erasing any original M7.6 text above; history is preserved.
**Correction scope:** M7.6 §3.1 and §4 described `FORMAT_OBJECT=SearchInfo` `Status=READY`/`ThereAreHits=no` as "not a search status / formatting request" and called it a misclassification. M7.7 finds that reading **not acceptable without correction**.

### 7.1 The real raw pair is contradictory and reproducible

Same RID `GF4KCK07016`, same `tool`, no new NCBI call in M7.7 (raw already captured; re-confirmed reproducible). M7.7 re-check raw files in this directory:

- `M7_7_recheck_canonical_raw.json` = evidence **A** (re-check of §2).
- `M7_7_recheck_searchinfo_raw.json` = evidence **B** (re-check of §3).

| Snapshot | Request | QBlastInfo blocks | Visible table | Canonical error |
|---|---|---|---|---|
| **A** canonical | `CMD=Get&RID=...` | `Status=FAILED` | — | `Error: No alias or index file found for nucleotide database [16S_ribosomal_RNA]...` |
| **B** SearchInfo | `CMD=Get&FORMAT_OBJECT=SearchInfo&RID=...` | `Status=READY`, `ThereAreHits=no` | stale `Status=Searching` placeholder | none |

The two snapshots **disagree on `Status`** (`FAILED` vs `READY`). `ThereAreHits=no` on B is not itself evidence that the search failed; it is not evidence that it succeeded either. The contradiction is real.

### 7.2 Corrected parser semantics (`web-platform/functions/api/blast/_lib.js`, `parseQBlastStatus`)

- Only `QBlastInfoBegin...QBlastInfoEnd` blocks are authoritative; `Status=`/`Status:` tokens elsewhere (page titles, stale `Status=Searching` tables, hidden form fields, `FORMAT_OBJECT=Alignment` links) are ignored.
- New `mode` option: `"canonical"` (default; production `CMD=Get`) or `"SearchInfo"`. When `mode==="SearchInfo"` (or the body clearly is a SearchInfo page **and** no canonical error page is present): `READY` -> `complete`; `ThereAreHits=yes/no` -> `no_hits` flag (`no_hits` added alongside `there_are_hits`); `WAITING`/`QUEUED` -> `queued`; `RUNNING` -> `running`; `FAILED` -> `failed`; `UNKNOWN` -> `unavailable`.
- **Removed `format_status_only` misclassification.** The M7.6 `reason:"format_status_only"` state no longer exists; a valid SearchInfo `READY` is not marked unavailable.
- **Conflict detection:** collect ALL `Status=` values across QBlastInfo blocks; **>1 distinct recognized value -> typed `status_conflict`** (`QBLAST_STATES.CONFLICT="status_conflict"`, added to `QBLAST_TERMINAL_STATES` so auto-polling stops). Never mapped to `queued`, `no_hits`, `complete`, `failed`, or success. Unknown token -> `malformed`; missing block -> `malformed`; empty body -> `empty_response`; timeout/network -> `unavailable`; non-2xx -> `unavailable`. **Nothing malformed/empty/timed-out/non-2xx is ever mapped to `queued`.** A canonical error page with an unrelated `READY` -> `status_conflict`, not success.
- **`reconcileStatusEvidence(a,b)`** returns `{ conflict, state, reason, evidences }`; two structured snapshots that disagree on `Status` -> `conflict:true`, `state:"status_conflict"`, **both original evidences preserved**. `reconcileStatusEvidence(A,B)` for the real pair -> `status_conflict`. Agreeing snapshots do not conflict.
- **Production gate unchanged & conservative:** `GET /api/blast/results/:rid` re-verifies a **canonical `CMD=Get`** body (no `FORMAT_OBJECT`); only canonical `complete` unlocks; `status_conflict` -> `409` typed; `ThereAreHits=no` -> `no_hits`; no real TSV is fabricated; SHA-256 + provenance preserved; HTML/empty/non-TSV rejected; mock/real separation preserved.
- **Status endpoint** passes `mode:"canonical"`, keeps the 60 s gate, `429`+`Retry-After`, terminal stop, safe evidence; `status_conflict` is returned typed and terminal.

### 7.3 Submission: RTOE (no provider change, no D1 migration)

`CMD=Put` real branch now uses `parsePutResponseDetailed(text)` -> `{ rid, rtoe }`, keeps `parsePutResponse` unchanged, adds `parseRtoe` (numeric seconds; null if absent/non-numeric; **no RTOE handling existed before**), returns `{ rid, status:"queued", rtoe }`, and records `rtoe` in the audit detail. **No sequence value is read or recorded; nothing new is stored in D1; no provider change; no migration.** Official docs list `CMD=Get` retrieval `FORMAT_TYPE=Text&ALIGNMENT_VIEW=Tabular`; `FORMAT_OBJECT=SearchInfo` is **not** in the official documented parameter list but is a real re-check query; production relies on canonical `CMD=Get`. No `CMD=Put` is performed in M7.7. **Owner authorization for a corrected live submission has NOT been given; no corrected live submission was made.** No real TSV was ever retrieved.

### 7.4 Corrected P0 conclusion

**The invalid database identifier is decisive.** Our submission used bare `16S_ribosomal_RNA`; NCBI's correct value is `rRNA_typestrains/16S_ribosomal_RNA` (already `ALLOWED_DATABASE`, `PROGRAM=blastn`). NCBI returned canonical `Status=FAILED` + `No alias or index file found for nucleotide database [16S_ribosomal_RNA]`. **No real result exists regardless** of the SearchInfo `READY`/`ThereAreHits=no` contradiction, regardless of `status_conflict` handling, and regardless of reconciliation. **No real TSV was ever retrieved.** Corrected identifier implemented; **corrected live submission requires EXPLICIT OWNER AUTHORIZATION and has NOT happened.** Overall 16S workflow remains **PARTIAL / `production_ready:false`.** Mock RIDs/results are synthetic only. No provider change, no scientific algorithm change, no scope expansion, no weakening of existing tests; no new NCBI call in M7.7.

### 7.5 UI honesty (P5 input honesty + status rendering)

`status_conflict` rendered honestly; terminal states stop polling; no indefinite animation. `RTOE` shown when present. The 16S input placeholder is clearly labelled **placeholder, not a value**; **no sequence is loaded until pasted/selected**; validation reflects actual `textarea.value`; any input change resets validation/plan/consent/results; create disabled until valid; no hidden default submission; truthful data-handling disclosure (what leaves the browser, what is stored in D1, what is sent to NCBI) retained. Concise note on RID/monitoring honesty added.

