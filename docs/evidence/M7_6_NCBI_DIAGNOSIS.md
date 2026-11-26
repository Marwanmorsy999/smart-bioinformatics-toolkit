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
