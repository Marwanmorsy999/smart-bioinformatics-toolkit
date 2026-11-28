# Workflow catalog (M7 proposals)

**Status: proposed workflows only — none is implemented.** Tool facts come from
`VERIFIED_TOOL_CATALOG.md` (live Galaxy EU panel, access 2026-11-25). M6 architecture and its
deterministic plugins are unchanged. No workflow here may be advertised as runnable until its tools'
input/output schemas are verified from an authenticated config and the provider is enabled.

---

## 1. Readiness states

| State | Meaning |
|---|---|
| **ready-needs-credentials** | Tool ids/versions verified live; blocked only on an authenticated account, actual quota/concurrency and tool-schema verification. |
| **needs-authorization** | Requires written smarts.bio authorization plus `SMARTSBIO_ENABLED=true` and the authorization gate. Currently refused. |
| **not-verified** | No live evidence gathered for the required tool/endpoint, or the scientific step is not established. Must not be planned into execution. |

**Prioritization rule:** relevance × verified availability × free-tier feasibility × scientific value.
Verified availability and feasibility are hard gates: a scientifically attractive workflow with an
unverified tool drops below a simpler workflow whose tool id and version are confirmed. Free-tier
feasibility is **unknown until the connected account is queried** — no quota is assumed
(`GALAXY_API_INTEGRATION.md` §3).

---

## 2. Sequence analysis

| Workflow | Steps / verified tools | Provider | Readiness | Priority | Notes |
|---|---|---|---|---|---|
| Read QC + aggregate report | `fastqc/0.74+galaxy1` → `multiqc/1.35+galaxy6` | Galaxy EU | ready-needs-credentials | **P1** | Both ids verified; FastQC panel label says `use Falco instead`; schemas not verified. |
| Browser-local FASTA profile | existing `sequence-stats.validate` / `profile` plugins | browser-local | ready (already shipped) | **P1** | Zero egress; keep as default before any remote step. |
| Reference-free sequence statistics | local agent statistics plugin | local Python agent | ready (already shipped) | P2 | No remote quota consumed. |

## 3. Microbiome (16S / amplicon)

| Workflow | Steps / verified tools | Provider | Readiness | Priority | Notes |
|---|---|---|---|---|---|
| Amplicon QC → alignment → tree | `fastqc` → `qiime2__alignment__mafft/2026.1.0+q2galaxy.2026.1.0` → `qiime2__phylogeny__align_to_tree_mafft_fasttree/2026.1.0+q2galaxy.2026.1.0` | Galaxy EU | ready-needs-credentials | **P1** | QIIME 2 wrappers observed in panel; reference data availability NOT verified. |
| BLAST-based taxonomic screening | `ncbi_blastn_wrapper/2.16.0+galaxy1` → existing `microbiome-16s.*` parsers | Galaxy EU + local | ready-needs-credentials | P2 | DB entitlement and wrapper params NOT verified; existing consensus rules stay authoritative; near-threshold abstention preserved. |
| Denoising / ASV (DADA2 etc.) | required tool NOT queried | Galaxy EU | not-verified | P3 | Do not propose as executable until a live panel read confirms exact ids. |

## 4. Phylogenetics

| Workflow | Steps / verified tools | Provider | Readiness | Priority | Notes |
|---|---|---|---|---|---|
| MSA → ML tree with support | `rbc_mafft/7.526+galaxy2` → `iqtree/3.1.4+galaxy1` | Galaxy EU | ready-needs-credentials | **P1** | Highest scientific value among verified tools; ModelFinder/bootstrap parameters NOT VERIFIED; publication-grade use needs separate validation. |
| MSA → fast approximate tree | `rbc_mafft/7.526+galaxy2` → `fasttree/2.1.10+galaxy1` | Galaxy EU | ready-needs-credentials | **P1** | Lower compute; free-tier feasibility likely better; no branch-support claim. |
| Alternative ML tree | `raxmlng/2.0.4+galaxy0` or `phyml/3.3.20220408+galaxy0` | Galaxy EU | ready-needs-credentials | P2 | Independent method for validation, not a silent replacement. |
| MUSCLE alignment | `muscle/0.0.11` | Galaxy EU | ready-needs-credentials | P3 | Wrapper version only; no MUSCLE 5 claim; single published version. |
| Replace M6 deterministic heuristic | — | — | not-verified | **Do not do** | M6 §11 explicitly says publication-grade alignment is a new, separately validated capability; never silently swap the heuristic. |

## 5. Genomics (DNA mapping / variant prep)

| Workflow | Steps / verified tools | Provider | Readiness | Priority | Notes |
|---|---|---|---|---|---|
| Short-read alignment → BAM stats | `bwa/0.7.19+galaxy2` or `bowtie2/2.5.5+galaxy0` → `samtools_view/1.22+galaxy2` + `samtools_flagstat/2.0.8` | Galaxy EU | ready-needs-credentials | **P1** | Reference indexes and memory needs NOT verified; check account quota first. |
| Interval operations | `bedtools_intersectbed/2.31.1+galaxy1` (+ other BEDtools wrappers) | Galaxy EU | ready-needs-credentials | P2 | Pin each subtool version; many differ. |
| Bismark / methylation | `bismark_bowtie2/0.22.1+galaxy4` | Galaxy EU | ready-needs-credentials | P3 | Observed in panel but outside current scope. |

## 6. Transcriptomics (RNA-seq)

| Workflow | Steps / verified tools | Provider | Readiness | Priority | Notes |
|---|---|---|---|---|---|
| Align → quantify → differential expression | `rna_star/2.7.11b+galaxy1` (or `hisat2/2.2.3+galaxy1`) → `salmon/1.10.3+galaxy1` → `deseq2/2.11.40.8+galaxy6` | Galaxy EU | ready-needs-credentials | **P1** | Strong scientific value; memory/index/design parameters NOT VERIFIED; free-tier feasibility must be measured. |
| Alignment-free quantification | `kallisto_quant/0.48.0+galaxy1` | Galaxy EU | ready-needs-credentials | P2 | Cheaper than genome alignment; index NOT VERIFIED. |
| smarts.bio predefined RNA-seq pipeline | `rna-seq-analysis` (vendor-documented id) | smarts.bio | needs-authorization | P3 | Documented, not executed; blocked by Terms hazard and absent authorization. |

## 7. Proteomics / protein analysis

| Workflow | Steps / verified tools | Provider | Readiness | Priority | Notes |
|---|---|---|---|---|---|
| Protein FASTA → functional annotation | `interproscan/5.59-91.0+galaxy3` | Galaxy EU | ready-needs-credentials | **P1** | Annotation is computational estimate; requires experimental validation (Terms §9A principle applies generally). |
| Sequence retrieval / ID mapping | `uniprotxml_downloader/2.5.0` or `uniprot_rest_interface/0.8` | Galaxy EU | ready-needs-credentials | **P1** | Outbound DB call; consent applies; record release/accession/date in provenance. |
| Protein BLAST | `ncbi_blastp_wrapper/2.16.0+galaxy1` | Galaxy EU | ready-needs-credentials | P2 | DB entitlement NOT VERIFIED. |

## 8. Structural biology

| Workflow | Steps / verified tools | Provider | Readiness | Priority | Notes |
|---|---|---|---|---|---|
| Structure retrieval / analysis | none verified in our Galaxy panel query | Galaxy EU | not-verified | P3 | Our discovery targeted the task's tool list only; no structural tool id was captured — do not invent one. |
| Structure-based design / AlphaFold/PDB lookup | vendor-documented databases and pipelines (`pdb`, `structure-based-drug-discovery`) | smarts.bio | needs-authorization | P3 | From official docs only; no authorization, no key, no run; do not claim capability. |

---

## 9. Recommended first cycle — deliberately small

Implement **at most one** remote workflow in the next cycle, chosen for verified ids × low compute ×
scientific value:

1. **Read QC + aggregate report** (`fastqc → multiqc`) — smallest, fully verified ids, low cost,
   clear provenance. This is the first candidate for an authenticated schema check.
2. Then **MSA → ML tree** (`mafft → iqtree`) — highest scientific value, but requires parameter/schema
   verification and a published validation before any equivalence claim.
3. Then **align → quantify → DESeq2** — highest resource demand; do not start until account quota and
   concurrency are measured from the connected account.

Do **not** implement all departments in one cycle. The remaining rows stay as proposals until their
readiness state changes through live evidence, not through planning optimism.

## 10. Limitations

- No workflow has been executed; no input/output schema or parameter default is verified.
- All readiness states are gated by credentials/authorization that were not supplied.
- Free-tier feasibility is unknown; the priority ranking assumes, but does not assert, that QC and
  single-tree jobs fit typical free allowances.
- smarts.bio and 9Router rows are blocked independently of technical readiness.
