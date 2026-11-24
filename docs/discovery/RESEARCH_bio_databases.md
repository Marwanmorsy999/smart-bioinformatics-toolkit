# Biological Database API Integration Facts

**Research date / access date:** 2026-11-24
**Scope:** Current public APIs, authentication, rate limits, terms/licensing, data-use constraints, browser (CORS) behaviour, consent and attribution for the services relevant to a multi-domain bioinformatics toolkit.
**Method:** Official documentation only (service documentation pages, official help/Bookshelf-adjacent pages, and official project blogs). NCBI Bookshelf main pages (`www.ncbi.nlm.nih.gov/books/...`) were behind a reCAPTCHA/bot check at access time; NCBI facts below were taken from the official `blast.ncbi.nlm.nih.gov` documentation and the official NCBI Insights blog. The `websearch` integration returned HTTP 402 during this session, so no search-engine results were used.

**Verification legend**
- **VERIFIED** — read directly from the labelled official page during this session, URL given.
- **PARTIAL** — key facts verified, but a sub-item (exact number, exact licence text) could not be retrieved.
- **UNCERTAIN** — plausible/stable known behaviour, not re-verified this session; must be confirmed before relying on it.
- **STALE-CHECK** — page changed/moved; confirm current URL and terms.

---

## 1. Consolidated API integration facts table

| # | Service / resource | Endpoint examples (verified unless noted) | Auth / rate limit | Consent before sending sequence? | Cache / store results? | Required citation / attribution | Licence & constraints | Status |
|---|---|---|---|---|---|---|---|---|
| 1 | **NCBI BLAST URL API (web BLAST)** | `POST https://blast.ncbi.nlm.nih.gov/Blast.cgi` with `CMD=Put&PROGRAM=blastn&DATABASE=core_nt&QUERY=<FASTA>&FORMAT_TYPE=JSON2&email=&tool=` → returns `RID`; retrieve with `CMD=Get&RID=<RID>` | No auth. Shared resource: **≤1 submission / 10 s**, **≤1 poll of a given RID / minute**, use `email` + `tool`; >100 searches/24 h moved to slower queue or blocked; >50 searches run off-peak (weekends / 21:00–05:00 ET) | **YES** — query sequence leaves the user's machine and is sent to NCBI servers | RID results are short-lived (commonly cited **24 h** — not confirmed on current help text); store parsed results locally if needed | Cite BLAST / NCBI; BLAST software itself is **public domain** | Public-domain software; service usage guidelines above; large jobs must use stand-alone BLAST+, Docker, Elastic BLAST or cloud | VERIFIED (URL API + developer guidelines); RID lifetime UNCERTAIN |
| 2 | **NCBI E-utilities** (ESearch/EFetch/ELink/EInfo/ESummary/EPost/ESpell/EGQuery) | `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=pubmed&term=...&retmode=json`; `efetch.fcgi?db=nuccore&id=...&rettype=fasta`; `elink.fcgi?dbfrom=pubmed&db=protein&id=...` | No auth for basic use; API key from NCBI account settings via `api_key=` param. **3 req/s per IP without key; 10 req/s per key with key**; excess gets errors. Avoid >3 concurrent initiations/s | N/A for lookups; **YES** if submitting sequence data (GenBank/SRA) — deposition makes data public | Yes (cache with source + date); respect rate limits and identifier versioning | Cite NCBI / Entrez as appropriate | Free public service; API key recommended for >3 req/s | VERIFIED (NCBI Insights API-key post; official blog) |
| 3 | **Entrez query terms** (used in BLAST and ESearch) | `protease NOT hiv1[organism]`, `1000:2000[slen]`, `Mus musculus[organism] AND biomol_mrna[properties]` | n/a | n/a | n/a | n/a | Field tags + Boolean AND/OR/NOT; database-specific fields must match database content | VERIFIED (BLAST "Limit by Entrez Query" help) |
| 4 | **NCBI BLAST databases (nt / 16S)** | `DATABASE=core_nt` (nt is auto-switched to `core_nt`; experimental `NO_DATABASE_OVERRIDE=true`); `DATABASE=swissprot`; 16S rRNA database exists in the web UI (exact URL-API name **not re-verified**) | as #1 | as #1 | as #1 | Cite database sources where applicable | nt/16S sequence data derive from INSDC/GenBank; public | PARTIAL — `core_nt`/`swissprot` VERIFIED; 16S DB identifier UNCERTAIN |
| 5 | **NCBI Taxonomy / taxdump** | `ftp.ncbi.nlm.nih.gov/pub/taxonomy/taxdump.tar.gz` (`nodes.dmp`, `names.dmp`, `merged.dmp`, `delnodes.dmp`) | None (anonymous FTP/HTTPS) | No | **Yes — encourage local cached snapshot** with release date | Cite NCBI Taxonomy | Public data; note NCBI Taxonomy's own terms apply to derived taxonomies | UNCERTAIN (standard documented location, not re-fetched this pass) |
| 6 | **EMBL-EBI Job Dispatcher** (NCBI BLAST+, FASTA, Clustal Omega, MUSCLE, InterProScan via job, PfamScan, HMMER, EMBOSS, Infernal…) | `https://www.ebi.ac.uk/jdispatcher/sss/ncbiblast`, `/psa/emboss_needle`, `/msa/clustalo`; REST/SOAP programmatic access docs at `https://www.ebi.ac.uk/jdispatcher/docs/webservices/` | No key; **batches ≤30 jobs at a time; wait for completion**; valid email required for programmatic use; excessive use handled under EBI Terms of Use | **YES** — submitted sequences are uploaded to EMBL-EBI | GDPR compliant: personal data (email/IP) and **submitted data encrypted and deleted after 7 days** | Madeira F et al. (2024) *NAR*, doi:10.1093/nar/gkae241 | EMBL-EBI Terms of Use; fair-use policy | VERIFIED |
| 7 | **EBI Dbfetch** | `https://www.ebi.ac.uk/Tools/dbfetch/` — cross-database entry retrieval | No key | No | Yes | Cite source database(s) | EBI Terms of Use | PARTIAL (existence/scope VERIFIED from JD docs) |
| 8 | **EBI Search** | `https://www.ebi.ac.uk/ebisearch/ws/rest/<domain>?query=...&format=json` | n/a | No | Yes | Cite EBI Search + source | EBI Terms of Use | UNCERTAIN — page did not render this session; confirm current domain/URL |
| 9 | **ENA (European Nucleotide Archive)** | Portal API `https://www.ebi.ac.uk/ena/portal/api/`; Browser API `https://www.ebi.ac.uk/ena/browser/api/` (docs: append `/doc`); `https://www.ebi.ac.uk/ena/xref/rest/`; files via FTP/Aspera | No key; **50 req/s upper limit**, HTTP **429 "Too Many Requests"** above that | No for public data; **YES** before submitting proprietary reads/assemblies | Yes; local/proxy caching of reference sequences explicitly encouraged | Cite ENA / INSDC | INSDC public data; EBI Terms of Use | VERIFIED |
| 10 | **InterPro REST API** | `https://www.ebi.ac.uk/interpro/api/entry/interpro/IPR002117`; `/api/protein/reviewed/P04637`; `/api/entry/pfam/pf06235`; `?page_size=200` (max), default 20 | No key published in docs; no documented hard limit in fetched docs | **YES** if using sequence-search/InterProScan with user sequences | Yes; pin results to InterPro release | Cite InterPro (and member DB, e.g. Pfam) | InterPro is ELIXIR/GCBR core resource; confirm exact data licence on EBI Licensing page | VERIFIED (endpoints/modifiers) / licence PARTIAL |
| 11 | **Ensembl REST API** | `https://rest.ensembl.org/info/ping`, `/lookup/id/ENSG00000139618`, `/sequence/id/...`, `/vep/human/id/...`; version **15.12**, © Nov 2026 | No key for basic use; heavy users may be rate-limited (numbers **not verified**) | No | Yes; record Ensembl release | Cite Ensembl / Ensembl Genomes | EBI Terms of Use | VERIFIED (endpoint list/version) / limits UNCERTAIN |
| 12 | **Pfam** | Via InterPro API `/api/entry/pfam/...`, `/api/set/pfam/...`; PfamScan at JD `/jdispatcher/pfa/pfamscan`; HMM downloads via InterPro | as InterPro / JD | as JD if scanning user sequences | Yes | Cite Pfam + InterPro | Confirm exact Pfam/InterPro data licence (likely CC BY / CC0 — **not verified**) | PARTIAL |
| 13 | **RDP (Ribosomal Database Project II)** | Historically `https://rdp.cme.msu.edu/` | n/a | n/a | n/a | n/a | **SILVA release-144 notes state RDP II has been discontinued** and its taxonomy removed as too old | PARTIAL — discontinuation VERIFIED via SILVA 144 notes; any API UNCERTAIN |
| 14 | **SILVA (SSU/LSU rRNA)** | Web/ARB/API access at `https://www.arb-silva.de/`; release **144 SSU (2026-08-14/26)**, LSU **138.2**; SSU Ref NR 99 = 905,628 sequences | Access/download requires accepting SILVA/DSMZ terms (registration); **commercial use restricted** — exact current licence text **not retrieved** | **YES** for any user rRNA sequence submitted to alignment/classification tools | Yes for analysis output; **redistribution of SILVA datasets restricted — verify** | Chuvochina M et al. (2026) *NAR* 54(D1):D334–D341, doi:10.1093/nar/gkaf1247; SINA: Pruesse et al. (2012) | **RESTRICTED / confirm with DSMZ** — not an unconditional open-data resource | PARTIAL — content/release/citation VERIFIED, licence UNCERTAIN |
| 15 | **UniProt REST** | `https://rest.uniprot.org/uniprotkb/search?query=...&format=json&size=500`; `.../uniprotkb/P12345.fasta`; `/idmapping`; SPARQL `https://sparql.uniprot.org/`; Swagger `https://www.uniprot.org/api-documentation/` | **No auth for basic use**; no hard numeric rate limit published on fetched help pages (use bulk/streaming for large queries) | **YES** if using UniProt BLAST / peptide-search with user sequences | Yes; record UniProt release (e.g. **2026_04**) | Cite UniProt Consortium; see "How to cite us" | **CC BY 4.0** for all copyrightable parts of the databases; disclaimer: no warranty, patents may apply, research/education only for medical/genetic info | VERIFIED (licence + endpoint classes) / rate limit UNCERTAIN |
| 16 | **RCSB PDB Data API** | `https://data.rcsb.org/rest/v1/core/entry/4HHB`; `/rest/v1/core/polymer_entity/4HHB/1`; GraphQL `https://data.rcsb.org/graphql` (GET/POST); holdings `https://data.rcsb.org/rest/v1/holdings/current/entry_ids` | **No rate/complexity limits currently**; batch endpoints max **1000 IDs** | No | **Yes — explicitly recommended** to cache repeat calls within a weekly update window | Rose Y et al. (2020) *JMB*, doi:10.1016/j.jmb.2020.11.003; also Berman et al. (2000) | PDB archive data are public | VERIFIED |
| 17 | **RCSB PDB Search API** | `https://search.rcsb.org/rcsbsearch/v2/query` (JSON query) | n/a | No | Yes | Cite RCSB PDB | Public | UNCERTAIN (not re-fetched; stable documented URL) |
| 18 | **KEGG** | `https://rest.kegg.jp/` (KEGG REST, e.g. `/get/hsa00010`) | Website free for academic users; **academic service-provider use requires a paid academic service-provider licence (KEGG FTP academic subscription)** | No | Cache cautiously — FTP subscription terms may restrict redistribution | Cite Kanehisa Laboratories / KEGG | **PAID / RESTRICTED**: non-academic use requires a **commercial licence from Pathway Solutions** | VERIFIED (kegg.jp/kegg/legal.html, last updated 2024-10-01) |
| 19 | **Reactome** | `https://reactome.org/ContentService/`, `/AnalysisService/` | Content Service open; no key for basic use | No | Yes | Cite Reactome (see reactome.org/cite) | **Data: CC0** (including commercial use, attribution encouraged not required); **illustrations/icons/branding: CC BY 4.0**; software Apache 2.0; **FoamTree special licence** — local installs need free demo-with-logo or own Carrot Search licence | VERIFIED |
| 20 | **STRING** | `https://string-db.org/api/<format>/<action>?identifiers=...` (e.g. `/api/tsv/network?identifiers=TP53`) | No key for basic use; commercial API/redistribution terms **not verified** | No | Yes | Szklarczyk D et al. (2025) *NAR* 53(D1):D730–D737 (STRING 12.5); cite as directed | Free for academic use (assumed); **confirm commercial terms** | PARTIAL — citation/statistics VERIFIED; licence UNCERTAIN |
| 21 | **Gene Ontology** | Downloads `https://release.geneontology.org/...`; PURLs `https://purl.obolibrary.org/obo/GO_0022008`; AmiGO `https://amigo.geneontology.org/amigo` | None | No | Yes — **must surface release date + DOI to end users** | Ashburner et al. (2000) doi:10.1038/75556 **and** GO Consortium (2026) doi:10.1093/nar/gkaf1292; plus tool-specific citations; use Zenodo release DOI | **CC BY 4.0**; attribution notice required; GO logo subject to own terms | VERIFIED |
| 22 | **ChEBI** | `https://www.ebi.ac.uk/chebi/`; ontology/downloads at `/chebi/downloads` | None | No | Yes | Malik A et al. (2025) *NAR*, doi:10.1093/nar/gkaf1271 | **CC BY 4.0**; EMBL-EBI Terms of Use; data non-proprietary | VERIFIED |
| 23 | **PubChem** | PUG REST `https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/name/aspirin/cids/JSON`; PUG View `.../rest/pug_view/data/compound/<CID>/JSON` | No key; rate limit commonly **5 req/s** (**not re-verified**) | No | Yes | Cite PubChem / underlying depositors | Open NIH data; CAS numbers are third-party proprietary identifiers — do not treat PubChem as authoritative for CAS | VERIFIED (open status + PUG REST examples); rate UNCERTAIN |
| 24 | **GDC (TCGA / TARGET etc.)** | `https://api.gdc.cancer.gov/status`, `/projects`, `/cases`, `/files`, `/data`, `/manifest`; e.g. `/files/<uuid>?pretty=true` | Public metadata open; **controlled-access download requires token in `X-Auth-Token` header** (dbGaP authorization required) | **YES** for any controlled-access/patient-derived data; only download under approved access | Yes for open data; controlled data subject to dbGaP/Data Use Agreement — do not redistribute | Cite GDC / TCGA / dbGaP as directed | NCI/NIH; controlled data governed by dbGaP DUA — **RESTRICTED** | VERIFIED |
| 25 | **SRA / ENA / ArrayExpress / GTEx** | SRA runinfo via `https://www.ncbi.nlm.nih.gov/sra/` + SRA Toolkit; ENA as #9; ArrayExpress now at `https://www.ebi.ac.uk/biostudies/arrayexpress` (BioStudies API); GTEx `https://gtexportal.org/home/` (`/home/apiPage`, `/home/datasets`) | Mostly open metadata; controlled individual-level data via dbGaP | **YES** for controlled/patient-derived data | Open metadata cacheable; controlled data restricted | Cite SRA/ENA/GTEx/ArrayExpress + study accessions | INSDC open data; GTEx individual-level genotypes controlled | PARTIAL/UNCERTAIN — SRA, GTEx, ArrayExpress endpoints not re-verified this session |

---

## 2. Detail notes and integration implications

### 2.1 NCBI

* **BLAST URL API** (VERIFIED — `https://blast.ncbi.nlm.nih.gov/doc/blast-help/urlapi.html`, access 2026-11-24): `CMD=Put` submission requires `QUERY`, `DATABASE`, `PROGRAM`. Supported programs: `blastn`, `blastp`, `blastx`, `tblastn`, `tblastx` (megablast = `PROGRAM=blastn&MEGABLAST=on`). Retrieval: `CMD=Get&RID=<RID>`. Output formats: `HTML`, `Text`, `XML2`, `XML2_S`, `JSONSA`, `JSON2`, `JSON2_S`, `SAM`; tabular via `FORMAT_TYPE=Text&ALIGNMENT_VIEW=Tabular` or `FORMAT_TYPE=CSV`. Databases include `core_nt`, `swissprot`; BLAST auto-switches `nt` → `core_nt` unless experimental `NO_DATABASE_OVERRIDE=true`. **Do not adopt undocumented parameters** — the docs explicitly say only listed parameters are supported.
* **Usage guidelines** (VERIFIED — `https://blast.ncbi.nlm.nih.gov/doc/blast-help/developerinfo.html`): BLAST is public-domain software, but the NCBI *service* is a shared resource with priority to interactive users: ≥1 submission/10 s, RID polling ≥1/min, include `email` and `tool`, high-volume users moved to slower queue/blocked, batch short queries (≤1,000 bases) into one search. Large projects must use stand-alone BLAST+, the NCBI BLAST Docker image, Elastic BLAST or a cloud provider.
* **Entrez terms** (VERIFIED — `.../doc/blast-topics/blastsearchparams.html`): field-limited queries with `[organism]`, `[slen]`, `[properties]`, `[filter]`, `[orgn]`, Boolean AND/OR/NOT; database-specific fields must be appropriate to the chosen database.
* **E-utilities rate limits** (VERIFIED — official NCBI Insights post `https://ncbiinsights.ncbi.nlm.nih.gov/2017/11/02/new-api-keys-for-the-e-utilities/`, access 2026-11-24): 3 req/s per IP without a key (applies to EInfo, ESearch, ESummary, EFetch, ELink, EPost, ESpell, EGQuery), 10 req/s per key with `api_key=`. Key obtained free from NCBI account Settings; one key/account. Requests without key are limited by combined IP activity.
* **RID lifetime / expiry: UNCERTAIN.** The fetched Common URL API page documents `RID` retrieval but does not state an expiry. Common practice cites ~24 h; treat as non-durable and re-run if retrieval fails. Do not build long-term archives on RIDs.
* **Sequence submission implications:** depositing user sequences in GenBank/SRA makes them publicly available under INSDC norms. Sending a sequence as a BLAST query transmits it to NCBI; the official BLAST help does not publish a retention period for query sequences. **Require explicit user consent** before any upload, especially for human-derived, identifiable, unpublished or proprietary sequences.
* **Taxonomy/taxdump** — standard anonymous download; pin the release date in any derived taxonomy product. (UNCERTAIN this pass.)

### 2.2 EMBL-EBI

* **Job Dispatcher** (VERIFIED — `https://www.ebi.ac.uk/jdispatcher/docs/`, access 2026-11-24): fair use = batches **≤30 jobs at a time, do not submit more until results/processing complete**; provide a valid email for programmatic access. GDPR: submitted data, email and IPs are encrypted and **deleted after seven days**. Cite Madeira et al. 2024 (doi:10.1093/nar/gkae241). Programmatic access via REST/SOAP; Dbfetch for cross-database retrieval.
* **ENA** (VERIFIED — `https://ena-docs.readthedocs.io/en/latest/retrieval/programmatic-access.html`): Portal API + Browser API; **50 req/s** upper limit with HTTP 429; file data via FTP/Aspera; `enaBrowserTools` CLI recommended. ENA is also the sequence source used by SILVA.
* **InterPro** (VERIFIED — `https://interpro-documentation.readthedocs.io/en/latest/api.html`): six main endpoints (`entry`, `protein`, `structure`, `set`, `taxonomy`, `proteome`); `page_size` max 200 (default 20); Pfam reachable as `entry/pfam/...`; note `tigrfams` → `ncbifam` since InterPro 94.0; some nested lists limited to 20 hits and not paginatable.
* **Ensembl REST** (VERIFIED — `https://rest.ensembl.org/`, version 15.12, © Nov 2026): endpoints for lookup, sequence, VEP, variation, comparative genomics, GA4GH; no key for basic use, rate limits for heavy users not published on the fetched page.
* **SILVA — restricted** (PARTIAL — `https://www.arb-silva.de/` and `/documentation/release-144/`, access 2026-11-24): rRNA SSU/LSU datasets, release 144 SSU / 138.2 LSU; sequences sourced from ENA; **citation mandatory** (Chuvochina et al. 2026, doi:10.1093/nar/gkaf1247). Download/ARB files are distributed under SILVA/DSMZ licence terms; the download page did not expose the licence text in this session. **Flag as potentially restricted for commercial use and redistribution; confirm with DSMZ before bundling or redistributing SILVA data.** SILVA notes RDP II has been discontinued.
* **Licensing umbrella:** EMBL-EBI Terms of Use `https://www.ebi.ac.uk/about/terms-of-use`; EBI licensing page `https://www.ebi.ac.uk/licencing` (check per-resource licences).

### 2.3 UniProt

* REST endpoints and SPARQL/Java API (VERIFIED — `https://www.uniprot.org/help/programmatic_access` and `/help/api`): all entries/queries/tools accessible by bookmarkable RESTful URLs; formats text, XML, RDF, FASTA, GFF, TSV; Swagger at `https://www.uniprot.org/api-documentation/`. No auth for basic use.
* **Licence: CC BY 4.0** (VERIFIED — `https://www.uniprot.org/help/license`, modified 2024-12-18). Disclaimer: no warranty; some data may be covered by patents/other rights; medical/genetic information is for research/education/informational purposes only. Record the release (site showed **2026_04**, released 2026-11-04).
* Rate limits: no published numeric limit on the fetched help pages — UNCERTAIN; implement polite backoff and prefer streaming/bulk downloads.

### 2.4 RCSB PDB

* Data API (VERIFIED — `https://data.rcsb.org/`): REST `https://data.rcsb.org/rest/v1/core/<resource>/<id>` and GraphQL `https://data.rcsb.org/graphql`; 200 OK JSON or 404; GraphQL always 200 with errors in body. **No rate or complexity limits currently**; batch endpoints max 1000 IDs; **cache repeat calls within the weekly update window**. Cite Rose et al. 2020 (doi:10.1016/j.jmb.2020.11.003). Public archive data.

### 2.5 Other knowledge resources

* **KEGG — PAID/RESTRICTED** (VERIFIED — `https://www.kegg.jp/kegg/legal.html`, last updated 2024-10-01): academic users may use the website freely, but providing services with KEGG requires an **academic service-provider licence included in the KEGG FTP academic subscription**; non-academic use requires a **commercial licence from Pathway Solutions**. Do not bundle KEGG Flat-Files into a distributed product without a licence.
* **Reactome** (VERIFIED — `https://reactome.org/license`): **data CC0**, illustrations/icons/art/branding **CC BY 4.0**, software Apache 2.0 (except copyleft dependencies and FoamTree). FoamTree: images/analyses generated on the website free to use; local installation must use free demo with promotional logo or obtain a Carrot Search licence — **restricted edge**.
* **STRING** (PARTIAL — `https://string-db.org/cgi/about.pl`): version 12.5; cite Szklarczyk et al. 2025 (doi:10.1093/nar/gkaf1083-equivalent NAR 53(D1):D730–D737; PubMed 39558183). Licensing page not fetched; confirm academic/commercial split.
* **Gene Ontology** (VERIFIED — `https://geneontology.org/docs/go-citation-policy/`): **CC BY 4.0**; cite Ashburner 2000 + GO Consortium 2026 (doi:10.1093/nar/gkaf1292); **tools/services must provide the GO release date and DOI with results**; use PURLs for GO identifiers; include CC BY attribution elements.
* **ChEBI** (VERIFIED — `https://www.ebi.ac.uk/chebi/aboutChebiForward.do`): **CC BY 4.0**, non-proprietary data, EBI Terms of Use; cite Malik et al. 2025 (doi:10.1093/nar/gkaf1271).
* **PubChem** (VERIFIED — `https://pubchem.ncbi.nlm.nih.gov/docs/about`, updated 2026-05-14): open NIH chemistry database; PUG REST/PUG View examples given; CAS numbers are proprietary third-party identifiers and PubChem is not authoritative for them.

### 2.6 Transcriptomics / genomics data access

* **GDC** (VERIFIED — `https://docs.gdc.cancer.gov/API/Users_Guide/Getting_Started/`): JSON REST at `https://api.gdc.cancer.gov/<endpoint>`; endpoints `status`, `projects`, `cases`, `files`, `annotations`, `data`, `manifest`, `slicing`, `submission`; versioned URLs `https://api.gdc.cancer.gov/v0/status`; auth token in `X-Auth-Token` header for controlled-access downloads and submission; keep tokens secure. TCGA data are served primarily through GDC.
* **SRA / ENA / ArrayExpress / GTEx** (PARTIAL): SRA and ENA are INSDC mirrors (ENA APIs verified above); ArrayExpress has migrated to EBI BioStudies; GTEx portal offers datasets and an API page. Controlled/individual-level data (GTEx genotypes, TCGA germline, dbGaP studies) require approved access and must never be cached in a shared/public artefact.

---

## 3. Browser / CORS, proxies and key handling (general)

* **CORS — UNCERTAIN, verify per deployment.** Documentation fetched did not publish definitive `Access-Control-Allow-Origin` behaviour. Empirically, NCBI E-utilities/BLAST and several legacy endpoints do not set permissive CORS headers, so a browser fetch from a web app will be blocked; UniProt, InterPro, Ensembl, RCSB and ENA often permit cross-origin GETs, but this is **not guaranteed**. **Recommendation: route all third-party calls through a server-side proxy/BFF.** A proxy also centralises rate limiting, `email`/`tool`/`api_key` injection, retries, response caching and audit logging.
* **API key handling:** NCBI `api_key` is a URL query parameter — prevent it entering browser bundles, logs, error trackers and shared URLs; store in server-side secrets. GDC token belongs in the `X-Auth-Token` header. Do not ship any user's key in client-side code; let users enter their own key server-side if high-rate access is needed.
* **Attribution / export:** implement a per-source attribution manifest capturing source name, endpoint, release/version, retrieval date, DOI/citation and licence. GO specifically requires release date + DOI surfaced to end users; UniProt/ChEBI/GO CC BY require creator/licence/disclaimer notice and link; SILVA/KEGG require care before redistribution; EBI JD uses a 7-day deletion policy so results needed longer must be stored locally by the user with consent.
* **Consent rule of thumb:** any operation that transmits a user-supplied sequence, identifier list, or patient-derived data to an external service must be opt-in with a plain-language notice naming the destination and purpose. Never silently BLAST or upload. Do not submit human/personal data to services without a documented DUA/GDPR basis.

---

## 4. Paid / restricted dependency flags

| Service | Flag | Reason |
|---|---|---|
| **KEGG** | **PAID** | Non-academic use needs commercial licence (Pathway Solutions); service provision needs paid academic service-provider licence (KEGG FTP subscription) |
| **SILVA** | **RESTRICTED / confirm** | Licence/terms for downloads and commercial use not verified; likely registration + use restrictions; citation mandatory |
| **Reactome FoamTree** | **RESTRICTED edge** | Local install needs demo-with-logo or separate Carrot Search licence |
| **GDC / dbGaP controlled data** | **RESTRICTED** | Token + dbGaP DUA; no redistribution |
| **GTEx individual-level genotypes** | **RESTRICTED** | dbGaP-controlled |
| **NCBI BLAST web service / EBI JD** | **CAPACITY-LIMITED (free)** | Usage guidelines can throttle/block high-volume users; use stand-alone/locally hosted tools for scale |
| **ENA / UniProt / InterPro / Ensembl / RCSB / Reactome data / GO / ChEBI / PubChem** | **FREE / OPEN** (respective terms/CORS/citation apply) | No auth for basic use; permissive licences (CC BY 4.0 / CC0 / public data) |

---

## 5. Source index (all accessed 2026-11-24 unless noted)

1. https://blast.ncbi.nlm.nih.gov/doc/blast-help/urlapi.html — Common URL API parameters, formats
2. https://blast.ncbi.nlm.nih.gov/doc/blast-help/developerinfo.html — public domain, usage guidelines
3. https://blast.ncbi.nlm.nih.gov/doc/blast-topics/blastsearchparams.html — Entrez query limits
4. https://ncbiinsights.ncbi.nlm.nih.gov/2017/11/02/new-api-keys-for-the-e-utilities/ — 3/10 req/s, API key
5. https://www.ebi.ac.uk/jdispatcher/docs/ — fair use, GDPR, citation
6. https://ena-docs.readthedocs.io/en/latest/retrieval/programmatic-access.html — ENA APIs, 50 req/s
7. https://interpro-documentation.readthedocs.io/en/latest/api.html — InterPro REST
8. https://rest.ensembl.org/ — Ensembl REST endpoints/version
9. https://data.rcsb.org/ — RCSB Data API, caching, citation
10. https://www.uniprot.org/help/api; /help/programmatic_access; /help/license — UniProt REST, CC BY 4.0
11. https://www.kegg.jp/kegg/legal.html — KEGG licensing
12. https://reactome.org/license — Reactome CC0/CC BY/Apache/FoamTree
13. https://string-db.org/cgi/about.pl — STRING version/citation
14. https://geneontology.org/docs/go-citation-policy/ — GO CC BY 4.0, citation, PURLs
15. https://www.ebi.ac.uk/chebi/aboutChebiForward.do — ChEBI CC BY 4.0
16. https://pubchem.ncbi.nlm.nih.gov/docs/about — PubChem open data, PUG REST, CAS caveat
17. https://www.arb-silva.de/; https://www.arb-silva.de/documentation/release-144/ — SILVA releases/citation
18. https://docs.gdc.cancer.gov/API/Users_Guide/Getting_Started/ — GDC API/tokens
19. https://www.ebi.ac.uk/about/terms-of-use — EMBL-EBI Terms of Use

**Known gaps to resolve before implementation:** exact NCBI RID expiry; NCBI 16S BLAST database URL-API identifier; SILVA current licence text and commercial terms; UniProt/Ensembl/PubChem numeric rate limits; definitive CORS headers per API; STRING/InterPro/Pfam commercial licensing; GTEx/SRA/ArrayExpress current API URLs.
