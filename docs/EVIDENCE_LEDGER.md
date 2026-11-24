# Evidence ledger

Format: `claim | source URL actually opened | date | agent | verified-by (different agent)`. UNVERIFIED claims may not appear in README, UI or slides.

| Claim | Source URL opened | Date | Agent | Verified-by |
|---|---|---|---|---|
| NCBI BLAST URL API CMD=Put/Get params and limits | https://blast.ncbi.nlm.nih.gov/doc/blast-help/urlapi.html | 2026-11-24 | backend | reviewer (re-opened) |
| 16S database name `16S_ribosomal_RNA` | https://ftp.ncbi.nlm.nih.gov/blast/db/ | 2026-11-24 | backend | reviewer |
| Bacterial 16S RefSeq targeted-loci data | https://www.ncbi.nlm.nih.gov/refseq/targetedloci/ | 2026-11-24 | data | reviewer |
| Curated 16S unresolved at species level (B. cereus group) | https://kb.ezbiocloud.net/kb/science-blogs/identify/identification-with-16s-rrna | prior session | prior agent | UNVERIFIED (needs literature agent + citation checker) |
| Viridans streptococci genus-only ID | https://pmc.ncbi.nlm.nih.gov/articles/PMC1594676 | prior session | prior agent | UNVERIFIED |
| E. coli/Shigella 16S >99% similarity | https://pmc.ncbi.nlm.nih.gov/articles/PMC8441030 | prior session | prior agent | UNVERIFIED |
| Benchmark numbers (held-out/noisy) | saved outputs `benchmark_data/benchmark_runs_heldout4/`, `.../noisy2/` | 2026-11-24 | data | reviewer (numbers match JSON) |
| Deployment succeeded (Cloudflare Pages Free) | Cloudflare API `pages_deployments_list` (deploy stage success) | 2026-11-24 | orchestrator | tester (independent) |

| Correction: Kim et al. 2014 98.65% paper is PMID 24505072, NOT 24357014 (which is Lippmann et al., stem cells) | https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?db=pubmed&id=24505072 | 2026-11-24 | LITERATURE | UNVERIFIED (citation checker to re-open) |
| NCBI E-utilities scripting limit 3 requests/second without API key | https://www.ncbi.nlm.nih.gov/home/about/policies/ | 2026-11-24 | API_SCOUT | UNVERIFIED |
| BacDive free JSON API, 100 IDs/call, CC BY 4.0 | https://bacdive.dsmz.de/ and https://api.bacdive.dsmz.de/ | 2026-11-24 | API_SCOUT | UNVERIFIED |
| RDP official pages unreachable -> REJECT (unverifiable terms) | http://rdp.cme.msu.edu/ (transport error) | 2026-11-24 | API_SCOUT | UNVERIFIED |

## Vision-reset discovery additions (2026-11-24)

| Claim | Source actually opened | Date | Agent | Verified-by |
|---|---|---|---|---|
| Benchmark headline numbers are NOT reproducible in this tree; `benchmark_data/RESULTS.md` absent and never tracked | `git log --all -- benchmark_data` empty; `docs/discovery/AUDIT_docs_consistency.md` | 2026-11-24 | docs-audit | orchestrator (confirmed file absent) |
| Galaxy is MIT-licensed since 2025-02-25 (not LGPL) | https://raw.githubusercontent.com/galaxyproject/galaxy/dev/LICENSE.txt | 2026-11-24 | competitor-research | orchestrator (report read) |
| Galaxy Orbit ships plan-approval + decision notebook (plan-before-execute is NOT original) | https://galaxyproject.org/agents/ | 2026-11-24 | competitor-research | orchestrator (report read) |
| Pipette.bio ships Plan→Review→Run→Inspect with amendment approval | https://pipette.bio/platform.html | 2026-11-24 | competitor-research | orchestrator (report read) |
| "smarls.bio" not found; likely typo for live smarts.bio | https://smarls.bio/ (transport error) + exact-phrase search no results | 2026-11-24 | competitor-research | orchestrator (report read) |
| NCBI BLAST URL API: ≤1 submission/10 s, ≤1 RID poll/min, >100 searches/24 h throttled | https://blast.ncbi.nlm.nih.gov/doc/blast-help/urlapi.html | 2026-11-24 | bio-db-research | orchestrator (report read) |
| NCBI E-utilities: 3 req/s without key, 10 req/s with free API key | https://www.ncbi.nlm.nih.gov/home/about/policies/ (official NCBI Insights referenced) | 2026-11-24 | bio-db-research | orchestrator (report read) |
| EMBL-EBI Job Dispatcher: batches ≤30, data deleted after 7 days | EBI official docs (see `docs/discovery/RESEARCH_bio_databases.md` source index) | 2026-11-24 | bio-db-research | orchestrator (report read) |
| UniProt data CC BY 4.0, release 2026_04; no auth for basic use | UniProt official docs (source index in research report) | 2026-11-24 | bio-db-research | orchestrator (report read) |
| KEGG is paid/restricted for non-academic use; SILVA restricted with mandatory citation | KEGG/SILVA official docs (source index in research report) | 2026-11-24 | bio-db-research | orchestrator (report read) |
| Cloudflare Workers: 10 ms CPU (Free), 30 s default/5 min max CPU (Paid), 128 MB RAM | Cloudflare official docs (source index in `docs/discovery/RESEARCH_compute_infra.md`) | 2026-11-24 | compute-research | orchestrator (report read) |
| Cloudflare Containers/Sandboxes GA 2026-04-13 on Workers Paid ($5/mo) | Cloudflare changelog (source index in compute report) | 2026-11-24 | compute-research | orchestrator (report read) |
| Cloudflare Queues support HTTP pull consumers (128 KB messages, 12 h visibility) | Cloudflare official docs (source index in compute report) | 2026-11-24 | compute-research | orchestrator (report read) |
| Baseline: 130 pytest + 103 node tests pass in this tree | `docs/discovery/BASELINE_TESTS.md` (commands + output recorded) | 2026-11-24 | orchestrator | tester (pending independent re-run) |

