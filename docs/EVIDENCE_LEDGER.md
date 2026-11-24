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

