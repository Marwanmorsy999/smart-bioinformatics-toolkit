# API catalog - candidate free services (API_SCOUT, 2026-11-24)

Scope: official docs/terms pages ONLY, read with webfetch; no logins, no payments, no live API calls, no credentials. Every factual claim is repeated in the ledger at the end (template requires `verified-by=UNVERIFIED`, even where a reviewer previously verified BLAST - see `docs/NCBI_API_NOTES.md`). FREE ONLY is a hard rule.

## 1. NCBI BLAST Common URL API - ADOPT (already adopted; verified-by reviewer)

- URL actually opened: reviewer opened `https://blast.ncbi.nlm.nih.gov/doc/blast-help/urlapi.html` and `https://blast.ncbi.nlm.nih.gov/doc/blast-help/developerinfo.html` (2026-11-24, recorded in `docs/NCBI_API_NOTES.md`); scout read that local file this session. Scout also opened `https://www.ncbi.nlm.nih.gov/home/about/policies/` for terms.
- Auth required: no login; `email` and `tool` URL parameters requested.
- Free tier: YES - official public BLAST help pages document the interface; no payment or key mentioned; reviewer verified.
- Rate limits (verbatim, from NCBI_API_NOTES.md quoting developerinfo.html): "Do not contact the server more often than once every 10 seconds."; "Do not poll for any single RID more often than once a minute."; "Use the URL parameter email and tool, so that the NCBI can contact you if there is a problem."; "Run scripts weekends or between 9 pm and 5 am Eastern time on weekdays if more than 50 searches will be submitted."; >100 searches in 24 h moved to slower queue or blocked.
- Licence/terms: US-government public-domain information; molecular data unrestricted per NCBI policy page; acknowledgement requested.
- Output format: HTML, XML2, XML2_S, JSONSA, JSON2, JSON2_S, SAM, or Tabular Text/CSV.
- Adds to project: remote BLAST submit/status/results behind Pages Functions; curated database `16S_ribosomal_RNA`.
- Failure modes: slow queue/block above volume limits, CGI/network errors, RID polling too often, reference-database release drift.
- Decision: ADOPT - already implemented and documented by reviewer; no change proposed.

## 2. NCBI E-utilities (taxonomy) - INVESTIGATE

- URL actually opened: `https://www.ncbi.nlm.nih.gov/home/about/policies/` (NCBI Website and Data Usage Policies and Disclaimers, section "Guidelines for Scripting Calls to NCBI Servers"). Attempts `https://www.ncbi.nlm.nih.gov/books/NBK25501/` and `?report=reader` returned a browser check and could NOT be read.
- Auth required: none; `email` and `tool` parameters requested for distributed software.
- Free tier: YES - "This site is maintained by the U.S. Government"; "NCBI itself places no restrictions on the use or distribution of the data contained therein." No key or payment mentioned.
- Rate limits (verbatim from policy page): "Make no more than 3 requests every 1 second."; "Run retrieval scripts on weekends or between 9 pm and 5 am Eastern Time weekdays for any series of more than 100 requests."; "Send E-utilities requests to https://eutils.ncbi.nlm.nih.gov, not the standard NCBI Web address."; "Use the URL parameter email, and tool for distributed software, so that we can track your project and contact you if there is a problem."
- Licence/terms (verbatim): "Information that is created by or for the US government on this site is within the public domain."; "NCBI's Disclaimer and Copyright notice must be evident to users of your service."
- Output format: E-utilities XML/JSON/Text - UNVERIFIED this session (Bookshelf docs blocked); do not code against it until confirmed.
- Adds to project: optional online taxid/name and lineage fallback for the taxonomy resolver, complementary to local `taxdump`.
- Failure modes: throttling at 3 requests/s, browser-check blocking observed in this environment, need for `email`/`tool`, offline requirement.
- Decision: INVESTIGATE - free and no-auth confirmed from official policy, but endpoint/output details not verified from the blocked help manual.

## 3. NCBI Datasets (v2) - INVESTIGATE

- URLs actually opened: `https://www.ncbi.nlm.nih.gov/datasets/docs/v2/`; `https://www.ncbi.nlm.nih.gov/datasets/docs/v2/api/api-keys/`.
- Auth required: optional API key only (generated free in My NCBI Account Settings); base access works without one.
- Free tier: YES - documented default 5 rps with no key; "If you don't have a My NCBI account, you'll need to create one." No payment mentioned.
- Rate limits (verbatim): "NCBI Datasets API and command-line tool requests are rate-limited. By default, this rate limit is set at 5 requests per second (rps)."; "API keys provide enhanced access to the NCBI Datasets API and command-line tools by allowing you to make requests at a rate of 10 rps."
- Licence/terms: NCBI policy page (public domain US-government information; molecular data unrestricted; acknowledge NLM); NLM Web Policies linked from docs.
- Output format: JSON, JSON Lines and CSV/TSV data reports (docs reference and taxonomy/genome report schemas).
- Adds to project: taxonomy metadata and genome/type-material reports to support provenance fields required by SCIENTIFIC_RULES.md.
- Failure modes: 5 rps cap without a key, API v2 version drift, large download packages, optional-key dependency.
- Decision: INVESTIGATE - free tier confirmed; useful for provenance but not required for MVP.

## 4. NCBI RefSeq Targeted Loci (16S) - ADOPT (already used as benchmark data)

- URL actually opened: `https://www.ncbi.nlm.nih.gov/refseq/targetedloci/`.
- Auth required: none (public FTP and BLAST).
- Free tier: YES - "RefSeq records are available for Archaea, Bacteria and Fungi which are accessible via Entrez query and BLAST search interfaces." FTP paths published; no payment mentioned.
- Rate limits (verbatim): none published on this page; generic NCBI scripting limits on the policy page apply.
- Licence/terms: NCBI policy page - public-domain government information, molecular data unrestricted, acknowledgement requested.
- Output format: FASTA / GenBank flatfile via FTP; BLAST-searchable.
- Adds to project: the curated bacterial/archaeal 16S type-material reference set already used as the benchmark database (26,888 records per PROJECT_SUMMARY.md).
- Failure modes: release drift, RefSeq corrections versus original INSD submission, type-material-only filtering needed for provenance claims.
- Decision: ADOPT - already the benchmark reference source; reviewer verified database name `16S_ribosomal_RNA`.

## 5. LPSN (List of Prokaryotic Names with Standing in Nomenclature) - INVESTIGATE

- URLs actually opened: `https://lpsn.dsmz.de/`; `https://lpsn.dsmz.de/text/copyright`; `https://api.lpsn.dsmz.de/`; `https://lpsn.dsmz.de/text/lpsn-api`.
- Auth required: YES for the API - "You have to login or register and create a user account, if you want to use the web services."; "Login is required but registration is free."
- Free tier: YES - "LPSN is a free to use service"; "registration is free"; no payment mentioned.
- Rate limits (verbatim): no numeric limit on pages opened. Restriction: "Automated download of material from LPSN is forbidden unless it is done via the LPSN download page or via the LPSN API or it is explicitly permitted by the maintainers of LPSN."
- Licence/terms (verbatim): "are distributed under a CC BY-SA 4.0 license"; "When citing LPSN always mention the date on which you accessed the website or the API."; link back to each LPSN page when displaying data; commercial use allowed if in agreement with licence (otherwise DSMZ MTA); DSI/Cali Fund notice; "as is" warranty disclaimer; not for clinical decisions.
- Output format: paginated JSON via REST endpoints `/fetch/{lpsn_id}`, `/advanced_search`, `/flexible_search`.
- Adds to project: authoritative current names, validly-published status, type-strain names, 16S INSDC accessions (`molecules`), correct-name and taxonomic-status fields - directly supports provenance and difficult-group curation.
- Failure modes: free account required, CC BY-SA share-alike + attribution/link-back duties, taxonomic opinions change, no published rps figure.
- Decision: INVESTIGATE - free but with registration and licence obligations; needs curator review before integration.

## 6. GTDB (Genome Taxonomy Database) - INVESTIGATE

- URLs actually opened: `https://gtdb.ecogenomic.org/`; `https://gtdb.ecogenomic.org/about`; `https://gtdb.ecogenomic.org/downloads`. (`/help` returned 404.)
- Auth required: none observed for public search/downloads; no API key documented on pages opened.
- Free tier: YES - public mirror downloads (data.gtdb.aau.ecogenomic.org, data.gtdb.ecogenomic.org, data.ace.uq.edu.au); "The GTDB taxonomy can be queried and downloaded through a number of tools on this website." No payment mentioned.
- Rate limits (verbatim): none published on pages opened.
- Licence/terms (verbatim): "This work is licensed under a Creative Commons Attribution-ShareAlike 4.0 International License"; citation of GTDB papers requested.
- Output format: bulk downloadable taxonomy/tree files and web search/tree; GTDB-Tk is a separate tool. No REST API verified.
- Adds to project: genome-phylogeny-based taxonomy opinion and placeholder names for uncultured taxa; possible source for difficult-group cautions.
- Failure modes: CC BY-SA share-alike, taxonomy philosophy conflicts with NCBI/LPSN species naming, large bulk downloads, no verified API.
- Decision: INVESTIGATE - free data confirmed, but no documented API and share-alike licence; not an MVP dependency.

## 7. BacDive - INVESTIGATE (strongest new candidate)

- URLs actually opened: `https://bacdive.dsmz.de/`; `https://api.bacdive.dsmz.de/`; `https://bacdive.dsmz.de/about`. (`https://bacdive.dsmz.de/api/` returned 404; correct API host is `api.bacdive.dsmz.de`.)
- Auth required: NO - "From February 2026, registration through the DSMZ Keycloak server is not required anymore to use the BacDive API. Our API is now freely accessible - no sign-up, no account needed."
- Free tier: YES - same quote plus "make freely available strain-level research data"; CC BY 4.0; no payment mentioned.
- Rate limits (verbatim): "Limit of 100 IDs per call"; "Paginated with 100 entries per page." No global requests/second figure on pages opened.
- Licence/terms (verbatim): "This work is licensed under a Creative Commons Attribution 4.0 International License. If you wish to use BacDive commercially contact us."; DSI/Cali Fund benefit-sharing notice; cite the 2025 BacDive paper.
- Output format: JSON via `/v2/fetch/{bacdive_id}`, `/v2/taxon/{genus}/{species?}/{subspecies?}`, `/v2/sequence_16s/{acc}`, `/v2/culturecollectionno/{no}`, `/v2/sequence_genome/{acc}`.
- Adds to project: type-strain records, 16S accession lookup, culture collection numbers and taxonomy for provenance and curation.
- Failure modes: 100-ID/page caps, v1 endpoints frozen at April 2025 (use v2), commercial-use contact needed, DSI benefit-sharing, no published rps limit.
- Decision: INVESTIGATE - free, no-auth, JSON and direct 16S/type-strain mapping; needs rate-limit confirmation and integration design.

## 8. SILVA - INVESTIGATE

- URLs actually opened: `https://www.arb-silva.de/`; `https://www.arb-silva.de/silva-license-information`; `https://www.arb-silva.de/download/archive/`; `https://www.arb-silva.de/download`.
- Auth required: not stated on pages opened; a TaskManager download tool exists but any login requirement is UNVERIFIED.
- Free tier: YES - "All data is freely available for academic and commercial use as long as SILVA is credited as original author and a link to the full license is provided."
- Rate limits (verbatim): none published on pages opened.
- Licence/terms (verbatim): "The SILVA databases, its taxonomy, and all files provided for download are licensed under Create Commons Attribution 4.0 (CC-BY 4.0)."; DSI/Cali Fund notice; logo not for commercial use.
- Output format: aligned SSU/LSU rRNA sequence files (FASTA/ARB) via downloads; web tools TestPrime/TestProbe/ACT/SILVAngs. No REST API verified.
- Adds to project: alternative curated 16S reference/taxonomy; would change the benchmark basis if substituted.
- Failure modes: no documented API, very large aligned datasets, taxonomy differs from NCBI, possible download login (unverified).
- Decision: INVESTIGATE - free and CC BY 4.0, but bulk-data only; not needed for MVP.

## 9. RDP (Ribosomal Database Project) - REJECT (unverifiable)

- URLs attempted (all failed): `https://rdp.cme.msu.edu/`, `https://rdp.cme.msu.edu/index.jsp`, `https://rdp.cme.msu.edu/classifier/classifier.jsp` - each returned "Transport error" through webfetch. Web search for an alternate official URL failed (HTTP 402).
- Auth / free tier / rate limits / licence / output format: UNVERIFIED - nothing could be read; no claim made.
- Adds to project: potentially a 16S classifier, but unverified and not required (local BLAST+ already classifies).
- Failure modes: site unreachable in this environment; terms cannot be confirmed; no fallback official page located.
- Decision: REJECT - hard rule FREE ONLY: a service whose free status and terms cannot be verified from official documentation is rejected, not assumed free. Revisit only if an official accessible page is supplied.

## Decision summary

| Service | Free (verified) | Auth | Decision |
| --- | --- | --- | --- |
| NCBI BLAST URL API | yes (reviewer) | none | ADOPT |
| NCBI E-utilities taxonomy | yes | none | INVESTIGATE |
| NCBI Datasets | yes | optional free key | INVESTIGATE |
| NCBI RefSeq targeted loci 16S | yes | none | ADOPT |
| LPSN | yes | free account for API | INVESTIGATE |
| GTDB | yes | none seen | INVESTIGATE |
| BacDive | yes | none | INVESTIGATE |
| SILVA | yes | unverified | INVESTIGATE |
| RDP | unverified | unverified | REJECT |

Sources opened (all 2026-11-24): NCBI policy, NCBI Datasets docs + API keys, NCBI RefSeq targeted loci, LPSN home/copyright/API/API-content, api.lpsn.dsmz.de, GTDB home/about/downloads, BacDive home/about/API, SILVA home/license/archive/download, and local `docs/NCBI_API_NOTES.md`. Failures honestly logged: NCBI Bookshelf E-utilities pages (browser check), RDP (transport error x3), BacDive `/api/` and GTDB `/help` (404), web search (HTTP 402). No live API requests, credentials or payments were made.

## Claim ledger (claim | URL | date | agent=API_SCOUT | verified-by=UNVERIFIED)

| Claim | URL | Date | Agent | Verified-by |
| --- | --- | --- | --- | --- |
| BLAST URL API params and 10 s / 1 min limits documented | https://blast.ncbi.nlm.nih.gov/doc/blast-help/developerinfo.html | 2026-11-24 | API_SCOUT | UNVERIFIED |
| BLAST database `16S_ribosomal_RNA` listed on FTP | https://ftp.ncbi.nlm.nih.gov/blast/db/ | 2026-11-24 | API_SCOUT | UNVERIFIED |
| RefSeq 16S curated type-material set exists | https://www.ncbi.nlm.nih.gov/refseq/targetedloci/ | 2026-11-24 | API_SCOUT | UNVERIFIED |
| US-government info public domain; acknowledge NLM | https://www.ncbi.nlm.nih.gov/home/about/policies/ | 2026-11-24 | API_SCOUT | UNVERIFIED |
| NCBI imposes no restrictions on molecular data reuse | https://www.ncbi.nlm.nih.gov/home/about/policies/ | 2026-11-24 | API_SCOUT | UNVERIFIED |
| "Make no more than 3 requests every 1 second." | https://www.ncbi.nlm.nih.gov/home/about/policies/ | 2026-11-24 | API_SCOUT | UNVERIFIED |
| "Run retrieval scripts on weekends or between 9 pm and 5 am Eastern Time weekdays for any series of more than 100 requests." | https://www.ncbi.nlm.nih.gov/home/about/policies/ | 2026-11-24 | API_SCOUT | UNVERIFIED |
| "Send E-utilities requests to https://eutils.ncbi.nlm.nih.gov" | https://www.ncbi.nlm.nih.gov/home/about/policies/ | 2026-11-24 | API_SCOUT | UNVERIFIED |
| E-utilities output formats unverified (books page blocked) | https://www.ncbi.nlm.nih.gov/books/NBK25501/ | 2026-11-24 | API_SCOUT | UNVERIFIED |
| Datasets default 5 rps; API key raises to 10 rps | https://www.ncbi.nlm.nih.gov/datasets/docs/v2/api/api-keys/ | 2026-11-24 | API_SCOUT | UNVERIFIED |
| Datasets key created free via My NCBI | https://www.ncbi.nlm.nih.gov/datasets/docs/v2/api/api-keys/ | 2026-11-24 | API_SCOUT | UNVERIFIED |
| Datasets reports in JSON/JSON Lines/CSV-TSV | https://www.ncbi.nlm.nih.gov/datasets/docs/v2/ | 2026-11-24 | API_SCOUT | UNVERIFIED |
| LPSN is a free to use service | https://lpsn.dsmz.de/ | 2026-11-24 | API_SCOUT | UNVERIFIED |
| LPSN data and API are CC BY-SA 4.0 | https://lpsn.dsmz.de/text/copyright | 2026-11-24 | API_SCOUT | UNVERIFIED |
| LPSN forbids automated download outside download page/API | https://lpsn.dsmz.de/text/copyright | 2026-11-24 | API_SCOUT | UNVERIFIED |
| LPSN API requires free login/registration | https://api.lpsn.dsmz.de/ | 2026-11-24 | API_SCOUT | UNVERIFIED |
| LPSN API is REST returning paginated JSON | https://lpsn.dsmz.de/text/lpsn-api | 2026-11-24 | API_SCOUT | UNVERIFIED |
| LPSN JSON has type strain names and 16S accessions | https://lpsn.dsmz.de/text/lpsn-api | 2026-11-24 | API_SCOUT | UNVERIFIED |
| GTDB release 232, ~901,341 genomes | https://gtdb.ecogenomic.org/ | 2026-11-24 | API_SCOUT | UNVERIFIED |
| GTDB data licensed CC BY-SA 4.0 | https://gtdb.ecogenomic.org/downloads | 2026-11-24 | API_SCOUT | UNVERIFIED |
| GTDB taxonomy available via website tools/downloads | https://gtdb.ecogenomic.org/about | 2026-11-24 | API_SCOUT | UNVERIFIED |
| BacDive API needs no sign-up/account since Feb 2026 | https://api.bacdive.dsmz.de/ | 2026-11-24 | API_SCOUT | UNVERIFIED |
| BacDive API limit 100 IDs per call / 100 per page | https://api.bacdive.dsmz.de/ | 2026-11-24 | API_SCOUT | UNVERIFIED |
| BacDive endpoints v2 (fetch/taxon/16s/genome) return JSON | https://api.bacdive.dsmz.de/ | 2026-11-24 | API_SCOUT | UNVERIFIED |
| BacDive data licensed CC BY 4.0; commercial contact | https://bacdive.dsmz.de/about | 2026-11-24 | API_SCOUT | UNVERIFIED |
| SILVA data free for academic and commercial use with credit | https://www.arb-silva.de/silva-license-information | 2026-11-24 | API_SCOUT | UNVERIFIED |
| SILVA databases/taxonomy/files are CC BY 4.0 | https://www.arb-silva.de/silva-license-information | 2026-11-24 | API_SCOUT | UNVERIFIED |
| SILVA SSU 144 / LSU 138.2 releases and download tools | https://www.arb-silva.de/ | 2026-11-24 | API_SCOUT | UNVERIFIED |
| SILVA download/TaskManager login requirement unverified | https://www.arb-silva.de/download | 2026-11-24 | API_SCOUT | UNVERIFIED |
| RDP official pages unreachable (transport error) | https://rdp.cme.msu.edu/ | 2026-11-24 | API_SCOUT | UNVERIFIED |
| RDP classifier page unreachable (transport error) | https://rdp.cme.msu.edu/classifier/classifier.jsp | 2026-11-24 | API_SCOUT | UNVERIFIED |
| NCBI Bookshelf E-utilities docs blocked by browser check | https://www.ncbi.nlm.nih.gov/books/NBK25501/?report=reader | 2026-11-24 | API_SCOUT | UNVERIFIED |
| Web search for alternate RDP source failed (HTTP 402) | (websearch tool, no URL) | 2026-11-24 | API_SCOUT | UNVERIFIED |

## Late candidate: AI Hero (investigated 2026-11-24, REJECT)

| Field | Value |
|---|---|
| URL actually opened | https://aihero.dev/ , https://www.aihero.dev/llms.txt , https://www.aihero.dev/api , https://www.aihero.dev/api/search?q=frontend%20UI%20design%20accessibility |
| Auth | Public content is free; privileged CMS reads require a scoped `aih_pat_*` bearer token (admin mint). No token requested or used. |
| Free tier | Public posts/skills/tutorial markdown are free (`/:slug.md`), but the site teaches AI engineering, not UI assets or bioinformatics. |
| Rate limits | Not published on the pages opened; no authenticated calls made. |
| Licence/terms | Not stated on the pages opened; content reuse terms UNVERIFIED. |
| What it adds | Nothing to this project's benchmark or trust: no verified 16S/taxonomy/UI asset value. |
| Failure modes | `https://www.aihero.dev/.well-known/api-catalog` returned 404 although linked from the homepage; `https://www.aihero.com/` and `https://aihero.com/` transport error. |
| Decision | **REJECT** - not a UI asset library; no verifiable benefit; licence unverified. No content downloaded into the repo. |
| Ledger claim | AI Hero is an AI-engineering education site with free public markdown | https://www.aihero.dev/llms.txt | 2026-11-24 | API_SCOUT | UNVERIFIED (licence/reuse terms not opened) |
