# NCBI BLAST Common URL API - verified parameters

All items below were read from official NCBI documentation pages opened on 2026-11-24.

## Sources (opened and read)

- Common URL API parameters: https://blast.ncbi.nlm.nih.gov/doc/blast-help/urlapi.html
- Developer information and usage guidelines: https://blast.ncbi.nlm.nih.gov/doc/blast-help/developerinfo.html
- BLAST database list (database names): https://ftp.ncbi.nlm.nih.gov/blast/db/ (listing shows `16S_ribosomal_RNA.tar.gz` and `16S_ribosomal_RNA-nucl-metadata.json`, last modified 2026-11-19)
- RefSeq targeted loci (curated 16S data): https://www.ncbi.nlm.nih.gov/refseq/targetedloci/

## Verified endpoint

Base: `https://blast.ncbi.nlm.nih.gov/Blast.cgi`

Submission (`CMD=Put`) required parameters: `CMD`, `QUERY` (accession, GI or FASTA), `DATABASE` (database file name), `PROGRAM` (blastn/blastp/blastx/tblastn/tblastx; megablast via `PROGRAM=blastn&MEGABLAST=on`). Common optional parameters: `FILTER`, `EXPECT`, `WORD_SIZE`, `HITLIST_SIZE`, `FORMAT_TYPE`, `DESCRIPTIONS`, `ALIGNMENTS`, `SHORT_QUERY_ADJUST`, `NCBI_GI`.

Status/results (`CMD=Get`) required: `CMD`, `RID` (request ID returned on submission). Optional: `FORMAT_TYPE`, `DESCRIPTIONS`, `ALIGNMENTS`, `NCBI_GI`. Tabular output: `FORMAT_TYPE=Text&ALIGNMENT_VIEW=Tabular` or `FORMAT_TYPE=CSV&ALIGNMENT_VIEW=Tabular`. Other report types: HTML, XML2, XML2_S, JSONSA, JSON2, JSON2_S, SAM.

Verified database name for the curated bacterial 16S RefSeq BLAST database: `16S_ribosomal_RNA` (from the NCBI FTP listing above). This is the preformatted database corresponding to the RefSeq targeted-loci 16S set used in the benchmark.

## Usage limits (verbatim from developerinfo.html)

- "Do not contact the server more often than once every 10 seconds."
- "Do not poll for any single RID more often than once a minute."
- "Use the URL parameter email and tool, so that the NCBI can contact you if there is a problem."
- "Run scripts weekends or between 9 pm and 5 am Eastern time on weekdays if more than 50 searches will be submitted."
- >100 searches in 24 h are moved to a slower queue or blocked; the service is a shared resource and not for high-volume projects.
- Prefer merging short queries (< a few hundred bases) into one search of up to 1,000 bases.

## Implementation constraints for this project

- Browser polls `/api/status/:rid` at most once per minute per RID, enforced server-side with `last_checked_at` in D1.
- Pages Functions identify the tool and email via env vars (`NCBI_TOOL`, `NCBI_EMAIL`), never hard-coded secrets.
- Results cached in D1; `MOCK_NCBI=1` mode for demos/tests; back off on errors; rate-limit submissions.
- No secrets in repo or logs; user sequences uploaded only when the user starts the remote BLAST feature.
