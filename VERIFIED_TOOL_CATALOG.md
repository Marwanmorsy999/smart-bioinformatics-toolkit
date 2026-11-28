# Verified tool catalog (M7 discovery)

**Access date for every live source: 2026-11-25.** Provider: **Galaxy Europe** (`https://usegalaxy.eu`),
instance `26.1.3.dev0` (`https://usegalaxy.eu/api/version`, access 2026-11-25). Raw evidence:
`docs/discovery/PROVIDER_DISCOVERY_2026-11-25.md` §1.

This catalog records **what was observed in the live public tool panel**. It is not an integration and
not a promise of availability, quota, or successful execution. No credentials were used.

**Note A — applies to every VERIFIED row:** the unauthenticated `GET /api/tools/{id}` and
`GET /api/tools/{id}/inputs` responses (access 2026-11-25) contain panel metadata only — they do **not**
contain `inputs`, `outputs` or a parameter schema. Therefore **input types, output types and parameter
names are NOT VERIFIED** for all rows. Verified metadata per row: exact `id`, `version`, `name`,
`description`, `panel_section`, EDAM operations/topics, `versions` history length, and the booleans
`has_parameters: true` and `is_workflow_compatible: true`. Actual I/O schemas must be read from an
authenticated tool config before an adapter can be built. Likely FASTA/FASTQ/BAM/VCF count-table formats
are domain expectations, **not** API-verified facts, and are not recorded as such here.

**Source URLs:** `PANEL` = `https://usegalaxy.eu/api/tools`; `DETAIL` =
`https://usegalaxy.eu/api/tools/<exact tool id from the row>` (both fetched 2026-11-25). OpenAPI:
`https://usegalaxy.eu/openapi.json` (2026-11-25).

---

## 1. VERIFIED — exact ids and versions observed live

| Target | Provider | Exact tool id | Version | I/O types | Parameters | Status | Source URL | Access date | Limitations |
|---|---|---|---|---|---|---|---|---|---|
| FastQC | Galaxy EU | `toolshed.g2.bx.psu.edu/repos/devteam/fastqc/fastqc/0.74+galaxy1` | `0.74+galaxy1` | NOT VERIFIED (A) | NOT VERIFIED (A) | VERIFIED (panel + detail HTTP 200) | `https://usegalaxy.eu/api/tools/toolshed.g2.bx.psu.edu/repos/devteam/fastqc/fastqc/0.74+galaxy1` | 2026-11-25 | Panel label `use Falco instead`; 13 published wrapper versions; QC only, not a scientific conclusion |
| MultiQC | Galaxy EU | `toolshed.g2.bx.psu.edu/repos/iuc/multiqc/multiqc/1.35+galaxy6` | `1.35+galaxy6` | NOT VERIFIED (A) | NOT VERIFIED (A) | VERIFIED | `https://usegalaxy.eu/api/tools/toolshed.g2.bx.psu.edu/repos/iuc/multiqc/multiqc/1.35+galaxy6` | 2026-11-25 | Aggregator; consumes outputs of other tools; 29 versions |
| MAFFT | Galaxy EU | `toolshed.g2.bx.psu.edu/repos/rnateam/mafft/rbc_mafft/7.526+galaxy2` | `7.526+galaxy2` | NOT VERIFIED (A) | NOT VERIFIED (A) | VERIFIED | `https://usegalaxy.eu/api/tools/toolshed.g2.bx.psu.edu/repos/rnateam/mafft/rbc_mafft/7.526+galaxy2` | 2026-11-25 | No EDAM terms published; no equivalence to the M6 heuristic claimed; 11 versions |
| MAFFT add | Galaxy EU | `toolshed.g2.bx.psu.edu/repos/rnateam/mafft/rbc_mafft_add/7.526+galaxy2` | `7.526+galaxy2` | NOT VERIFIED (A) | NOT VERIFIED (A) | VERIFIED | `https://usegalaxy.eu/api/tools/toolshed.g2.bx.psu.edu/repos/rnateam/mafft/rbc_mafft_add/7.526+galaxy2` | 2026-11-25 | Requires an existing alignment input (description only); not executed |
| MUSCLE | Galaxy EU | `toolshed.g2.bx.psu.edu/repos/crs4/muscle/muscle/0.0.11` | `0.0.11` | NOT VERIFIED (A) | NOT VERIFIED (A) | VERIFIED | `https://usegalaxy.eu/api/tools/toolshed.g2.bx.psu.edu/repos/crs4/muscle/muscle/0.0.11` | 2026-11-25 | `0.0.11` is the **Galaxy wrapper version**, not evidence of a MUSCLE 5 engine version; only 1 published version; do not claim MUSCLE 5 |
| FastTree | Galaxy EU | `toolshed.g2.bx.psu.edu/repos/iuc/fasttree/fasttree/2.1.10+galaxy1` | `2.1.10+galaxy1` | NOT VERIFIED (A) | NOT VERIFIED (A) | VERIFIED | `https://usegalaxy.eu/api/tools/toolshed.g2.bx.psu.edu/repos/iuc/fasttree/fasttree/2.1.10+galaxy1` | 2026-11-25 | 2 versions; panel section "Genome Diversity"; tree only, no model-selection claim |
| IQ-TREE | Galaxy EU | `toolshed.g2.bx.psu.edu/repos/iuc/iqtree/iqtree/3.1.4+galaxy1` | `3.1.4+galaxy1` | NOT VERIFIED (A) | NOT VERIFIED (A) | VERIFIED | `https://usegalaxy.eu/api/tools/toolshed.g2.bx.psu.edu/repos/iuc/iqtree/iqtree/3.1.4+galaxy1` | 2026-11-25 | 15 versions; ModelFinder/bootstrap parameters NOT VERIFIED; publication-grade use needs separate validation |
| PhyML (other tree tool) | Galaxy EU | `toolshed.g2.bx.psu.edu/repos/iuc/phyml/phyml/3.3.20220408+galaxy0` | `3.3.20220408+galaxy0` | NOT VERIFIED (A) | NOT VERIFIED (A) | VERIFIED | `https://usegalaxy.eu/api/tools/toolshed.g2.bx.psu.edu/repos/iuc/phyml/phyml/3.3.20220408+galaxy0` | 2026-11-25 | Maximum-likelihood per description; not executed |
| RAxML-NG (other tree tool) | Galaxy EU | `toolshed.g2.bx.psu.edu/repos/iuc/raxmlng/raxmlng/2.0.4+galaxy0` | `2.0.4+galaxy0` | NOT VERIFIED (A) | NOT VERIFIED (A) | VERIFIED | `https://usegalaxy.eu/api/tools/toolshed.g2.bx.psu.edu/repos/iuc/raxmlng/raxmlng/2.0.4+galaxy0` | 2026-11-25 | No EDAM terms published; not executed |
| BLAST (blastn) | Galaxy EU | `toolshed.g2.bx.psu.edu/repos/devteam/ncbi_blast_plus/ncbi_blastn_wrapper/2.16.0+galaxy1` | `2.16.0+galaxy1` | NOT VERIFIED (A) | NOT VERIFIED (A) | VERIFIED | `https://usegalaxy.eu/api/tools/toolshed.g2.bx.psu.edu/repos/devteam/ncbi_blast_plus/ncbi_blastn_wrapper/2.16.0+galaxy1` | 2026-11-25 | Database availability/entitlement NOT VERIFIED; 24 versions; reference data tables via `/api/tool_data` |
| BLAST (blastp) | Galaxy EU | `toolshed.g2.bx.psu.edu/repos/devteam/ncbi_blast_plus/ncbi_blastp_wrapper/2.16.0+galaxy1` | `2.16.0+galaxy1` | NOT VERIFIED (A) | NOT VERIFIED (A) | VERIFIED | `https://usegalaxy.eu/api/tools` (PANEL, row id above) | 2026-11-25 | Protein DB entitlement NOT VERIFIED |
| BWA | Galaxy EU | `toolshed.g2.bx.psu.edu/repos/devteam/bwa/bwa/0.7.19+galaxy2` | `0.7.19+galaxy2` | NOT VERIFIED (A) | NOT VERIFIED (A) | VERIFIED | `https://usegalaxy.eu/api/tools` (PANEL, row id above) | 2026-11-25 | Short reads (<100 bp) per description; needs indexed reference NOT VERIFIED |
| BWA-MEM | Galaxy EU | `toolshed.g2.bx.psu.edu/repos/devteam/bwa/bwa_mem/0.7.19+galaxy2` | `0.7.19+galaxy2` | NOT VERIFIED (A) | NOT VERIFIED (A) | VERIFIED | `https://usegalaxy.eu/api/tools/toolshed.g2.bx.psu.edu/repos/devteam/bwa/bwa_mem/0.7.19+galaxy2` | 2026-11-25 | Needs indexed reference NOT VERIFIED |
| Bowtie2 | Galaxy EU | `toolshed.g2.bx.psu.edu/repos/devteam/bowtie2/bowtie2/2.5.5+galaxy0` | `2.5.5+galaxy0` | NOT VERIFIED (A) | NOT VERIFIED (A) | VERIFIED | `https://usegalaxy.eu/api/tools/toolshed.g2.bx.psu.edu/repos/devteam/bowtie2/bowtie2/2.5.5+galaxy0` | 2026-11-25 | Needs index; 19 versions |
| HISAT2 | Galaxy EU | `toolshed.g2.bx.psu.edu/repos/iuc/hisat2/hisat2/2.2.3+galaxy1` | `2.2.3+galaxy1` | NOT VERIFIED (A) | NOT VERIFIED (A) | VERIFIED | `https://usegalaxy.eu/api/tools/toolshed.g2.bx.psu.edu/repos/iuc/hisat2/hisat2/2.2.3+galaxy1` | 2026-11-25 | Needs index/annotation NOT VERIFIED; 18 versions |
| STAR (RNA STAR) | Galaxy EU | `toolshed.g2.bx.psu.edu/repos/iuc/rgrnastar/rna_star/2.7.11b+galaxy1` | `2.7.11b+galaxy1` | NOT VERIFIED (A) | NOT VERIFIED (A) | VERIFIED | `https://usegalaxy.eu/api/tools/toolshed.g2.bx.psu.edu/repos/iuc/rgrnastar/rna_star/2.7.11b+galaxy1` | 2026-11-25 | Memory/reference requirements NOT VERIFIED; 23 versions |
| SAMtools (view) | Galaxy EU | `toolshed.g2.bx.psu.edu/repos/iuc/samtools_view/samtools_view/1.22+galaxy2` | `1.22+galaxy2` | NOT VERIFIED (A) | NOT VERIFIED (A) | VERIFIED | `https://usegalaxy.eu/api/tools/toolshed.g2.bx.psu.edu/repos/iuc/samtools_view/samtools_view/1.22+galaxy2` | 2026-11-25 | One of many SAMtools wrappers; other subtools have different versions (e.g. flagstat `2.0.8`) — pin each separately |
| BEDtools (intersect) | Galaxy EU | `toolshed.g2.bx.psu.edu/repos/iuc/bedtools/bedtools_intersectbed/2.31.1+galaxy1` | `2.31.1+galaxy1` | NOT VERIFIED (A) | NOT VERIFIED (A) | VERIFIED | `https://usegalaxy.eu/api/tools/toolshed.g2.bx.psu.edu/repos/iuc/bedtools/bedtools_intersectbed/2.31.1+galaxy1` | 2026-11-25 | One of ~35 BEDtools wrappers; versions vary; pin each separately |
| DESeq2 | Galaxy EU | `toolshed.g2.bx.psu.edu/repos/iuc/deseq2/deseq2/2.11.40.8+galaxy6` | `2.11.40.8+galaxy6` | NOT VERIFIED (A) | NOT VERIFIED (A) | VERIFIED | `https://usegalaxy.eu/api/tools/toolshed.g2.bx.psu.edu/repos/iuc/deseq2/deseq2/2.11.40.8+galaxy6` | 2026-11-25 | Requires count table + design; parameters NOT VERIFIED; 21 versions |
| Salmon (quant) | Galaxy EU | `toolshed.g2.bx.psu.edu/repos/bgruening/salmon/salmon/1.10.3+galaxy1` | `1.10.3+galaxy1` | NOT VERIFIED (A) | NOT VERIFIED (A) | VERIFIED | `https://usegalaxy.eu/api/tools/toolshed.g2.bx.psu.edu/repos/bgruening/salmon/salmon/1.10.3+galaxy1` | 2026-11-25 | Index/annotation NOT VERIFIED; 15 versions |
| kallisto (quant) | Galaxy EU | `toolshed.g2.bx.psu.edu/repos/iuc/kallisto_quant/kallisto_quant/0.48.0+galaxy1` | `0.48.0+galaxy1` | NOT VERIFIED (A) | NOT VERIFIED (A) | VERIFIED | `https://usegalaxy.eu/api/tools/toolshed.g2.bx.psu.edu/repos/iuc/kallisto_quant/kallisto_quant/0.48.0+galaxy1` | 2026-11-25 | Index NOT VERIFIED; 8 versions |
| InterProScan | Galaxy EU | `toolshed.g2.bx.psu.edu/repos/bgruening/interproscan/interproscan/5.59-91.0+galaxy3` | `5.59-91.0+galaxy3` | NOT VERIFIED (A) | NOT VERIFIED (A) | VERIFIED | `https://usegalaxy.eu/api/tools/toolshed.g2.bx.psu.edu/repos/bgruening/interproscan/interproscan/5.59-91.0+galaxy3` | 2026-11-25 | Protein FASTA assumed by name only; databases applied NOT VERIFIED; 6 versions |
| UniProt retrieval | Galaxy EU | `toolshed.g2.bx.psu.edu/repos/galaxyp/uniprotxml_downloader/uniprotxml_downloader/2.5.0` | `2.5.0` | NOT VERIFIED (A) | NOT VERIFIED (A) | VERIFIED | `https://usegalaxy.eu/api/tools/toolshed.g2.bx.psu.edu/repos/galaxyp/uniprotxml_downloader/uniprotxml_downloader/2.5.0` | 2026-11-25 | "download proteome as XML or fasta"; outbound database call, consent applies |
| UniProt ID mapping | Galaxy EU | `toolshed.g2.bx.psu.edu/repos/bgruening/uniprot_rest_interface/uniprot/0.8` | `0.8` | NOT VERIFIED (A) | NOT VERIFIED (A) | VERIFIED | `https://usegalaxy.eu/api/tools/toolshed.g2.bx.psu.edu/repos/bgruening/uniprot_rest_interface/uniprot/0.8` | 2026-11-25 | "ID mapping and retrieval"; outbound database call, consent applies |

Additional verified tree workflows (QIIME 2 wrappers), all `2026.1.0+q2galaxy.2026.1.0`, all present in
`https://usegalaxy.eu/api/tools` (2026-11-25), I/O and parameters NOT VERIFIED (A):
`toolshed.g2.bx.psu.edu/repos/q2d2/qiime2__phylogeny__align_to_tree_mafft_fasttree/qiime2__phylogeny__align_to_tree_mafft_fasttree/2026.1.0+q2galaxy.2026.1.0`;
the `...align_to_tree_mafft_iqtree...`, `...align_to_tree_mafft_raxml...`, `...iqtree_ultrafast_bootstrap...`,
`...fasttree...` and `...raxml_rapid_bootstrap...` siblings follow the same naming pattern and were
observed in the panel. Pin the exact id from a fresh panel read; do not construct ids from memory.

## 2. NOT VERIFIED — explicitly not claimed

| Target | Status | Reason / what is unknown |
|---|---|---|
| Full input/output schemas for every tool above | NOT VERIFIED | Requires authenticated tool config; unauthenticated detail and `/inputs` endpoints returned only panel metadata (2026-11-25). |
| Parameter names/defaults for every tool above | NOT VERIFIED | Same reason. |
| Successful execution, runtime, memory or reference-data availability for any tool | NOT VERIFIED | No credentials, no job was submitted. |
| MUSCLE version 5 specifically | NOT VERIFIED | The live wrapper is `0.0.11` (Galaxy wrapper version); no engine-version claim supported. |
| Galaxy account quota, storage and concurrency on usegalaxy.eu | NOT VERIFIED / UNKNOWN | Not queried from a connected account; published usegalaxy.org figures are context only. |
| smarts.bio tool ids and capabilities | NOT VERIFIED / NOT ENABLED | No key and no authorization; ids must be discovered at runtime via `GET /v1/tools`. |
| 9Router model names, endpoint and quotas | NOT VERIFIED | No endpoint or credentials supplied for M7; see `NINEROUTER_INTEGRATION.md`. |
| Equivalence between any two aligners/tree tools (MAFFT vs MUSCLE, IQ-TREE vs FastTree, etc.) | NOT CLAIMED | No comparative validation was run; M6 §4 explicitly forbids silent replacement of the deterministic heuristic. |
| Tool availability on other UseGalaxy servers (.org, .fr, .org.au, .ca) | NOT VERIFIED | Only usegalaxy.eu was queried. |

## 3. How to refresh this catalog

1. `GET https://usegalaxy.eu/api/version` — confirm instance version; record access date.
2. `GET https://usegalaxy.eu/api/tools` — fetch once, cache with TTL, filter **client-side**
   (`?search=` returned the whole panel on 2026-11-25).
3. `GET https://usegalaxy.eu/api/tools/{exact id}` — confirm the exact current versioned id; do not
   guess a version suffix.
4. With an authorized account only, read authenticated tool configs to obtain input/output schemas and
   parameter definitions, then update Note A rows.
5. Re-run the catalog refresh before enabling any adapter: tool versions change (`versions` arrays show
   up to 29 published versions), and a stale pinned id will fail at submission time.
