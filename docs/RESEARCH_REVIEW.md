# Evidence review: limits of 16S rRNA species-level identification

Prepared by: LITERATURE agent. Review date: 2026-11-24.
Scope: every claim below is grounded ONLY in a source that was actually opened and read with webfetch during this task. Nothing is taken from memory or from a page that failed to open. Failed/partial accesses are listed explicitly and their content is marked UNVERIFIED. This document does not change any code or data file.

## 1. Sources actually opened and read (webfetch)

| # | Source | URL actually opened | Date opened | Notes |
|---|---|---|---|---|
| S1 | EzBioCloud KB, "Identification with 16S rRNA" | https://kb.ezbiocloud.net/kb/science-blogs/identify/identification-with-16s-rrna | 2026-11-24 | vendor knowledge base; markdown rendering served at the .md URL |
| S2 | Boudewijns et al. 2006, J Clin Microbiol letter (PMC1594676) | https://pmc.ncbi.nlm.nih.gov/articles/PMC1594676 | 2026-11-24 | full text read |
| S3 | Halimeh et al. 2021, Braz J Microbiol Shigella review (PMC8441030) | https://pmc.ncbi.nlm.nih.gov/articles/PMC8441030 | 2026-11-24 | full text read |
| S4 | Kim et al. 2014, Int J Syst Evol Microbiol, abstract via NCBI E-utilities | https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi?db=pubmed&id=24505072&retmode=text&rettype=abstract | 2026-11-24 | ABSTRACT ONLY; full text not opened |
| S5 | EzBioCloud KB, "16S rRNA Database" | https://kb.ezbiocloud.net/home/science-blogs/identify/16s-rrna-database.md | 2026-11-24 | full page read |
| S6 | EzBioCloud KB, "16S rRNA Resolution" | https://kb.ezbiocloud.net/home/science-blogs/identify/16s-rrna-resolution.md | 2026-11-24 | full page read |
| S7 | EzBioCloud KB, "16S vs Genome Identification" | https://kb.ezbiocloud.net/home/science-blogs/identify/16s-vs-genome-identification.md | 2026-11-24 | full page read |
| S8 | Clarridge 2004, Clin Microbiol Rev review (PMC523561) | https://pmc.ncbi.nlm.nih.gov/articles/PMC523561 | 2026-11-24 | full text read |
| S9 | EzBioCloud KB documentation index (navigation only) | https://kb.ezbiocloud.net/home/llms.txt | 2026-11-24 | used to locate S5-S7; no scientific claims taken |

## 2. Attempted but NOT usable -> UNVERIFIED

| Attempted source | Result | Consequence |
|---|---|---|
| https://pubmed.ncbi.nlm.nih.gov/24357014/ (both markdown and text) | Only cookies/footer/navigation returned; article body blocked | No claim taken from this page. |
| https://europepmc.org/article/MED/24357014 | HTTP 403 | No claim taken. |
| https://pmc.ncbi.nlm.nih.gov/articles/PMC4098036/ | Opened successfully but is a bone-biomechanics paper, NOT the 16S paper | Discarded; no claim taken. |
| Full text of Kim et al. 2014 (publisher / PMC) | Not opened; only the NCBI abstract (S4) was retrievable | Any Kim et al. detail beyond the abstract is UNVERIFIED. |
| Web search for additional sources | Tool failed with HTTP 402 | No additional sources discovered by search. |

Important correction: the candidate PMID 24357014 supplied in the task brief is NOT Kim et al. 2014. NCBI E-utilities esummary (https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?db=pubmed&id=24357014&retmode=json, opened 2026-11-24) identifies it as Lippmann et al., "Defined human pluripotent stem cell culture...", Stem Cells 2014. The correct PMID for Kim et al. 2014 is 24505072, confirmed by NCBI esearch (https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=pubmed&term=Towards+a+taxonomic+coherence+between+average+nucleotide+identity+and+16S+rRNA+gene+sequence+similarity+for+species+demarcation+of+prokaryotes&retmode=json, opened 2026-11-24) and by S4.

## 3. Species-level limits

- C1 (S1): Pairwise sequence similarity is the critical measurement in 16S identification, but different alignment algorithms produce different similarity values; a taxonomically valid algorithm is therefore required. EzBioCloud uses a robust pairwise alignment and states that BLASTn identity values are not used for taxonomic purposes.
- C2 (S8): 16S comparison generally differentiates organisms at genus level across major phyla, but its usefulness is impaired for closely related bacteria; occasional exceptions occur where more than one well-known species has the same or very similar 16S sequence. Clarridge also states there is no consensus quantitative definition of genus or species based on 16S data (as of 2004) and that microheterogeneity within a species is common.
- C3 (S7): 16S sequencing gives identification at genus and sometimes species level; whole-genome sequencing gives the highest resolution and can distinguish species and strains. 16S is limited to the information in the 16S gene.
- C4 (S1, S6): Taxonomically meaningful 16S similarity was proposed on full-length sequences; partial/low-completeness sequences have insufficient resolving power and can yield erroneous identification. S6 gives a suggested minimum of 95% completeness.
- C5 (S3): 16S rRNA gene sequencing has low discriminatory power and poor resolution for closely related bacteria; in the Shigella review this is stated directly and illustrated with identification rates below 50% for some species.

## 4. The 98.65% screening reference: is it a universal boundary?

- C6 (S4): Kim et al. compared 6787 prokaryotic genomes from 22 phyla and found an apparent distinction between intra- and interspecies ANI values at about 95-96%; using over one million 16S comparisons and a twofold cross-validation test, they reported that 98.65% 16S similarity can be used as the threshold for differentiating two species, consistent with earlier DDH-based suggestions of 98.2-99.0%.
- C7 (S4): The earlier 95-96% ANI range had been suggested from rather limited datasets and its generality "was not tested on all lineages of prokaryotes" (abstract wording). This is a caveat on universality, not a claim of a universal constant.
- C8 (S1, S6): EzBioCloud rounds the same 16S species cutoff to 98.7% and attributes it to Kim et al. 2014. S6 states the cutoff was defined on the 27F-1492R (Bacteria) / A25F-U1492R (Archaea) full-length region.
- C9 (S1): Even a very high 16S similarity does not prove species identity (see C10), so for this toolkit 98.65% is a screening reference rather than a universal hard boundary. A value below it does not establish a novel species (project rule in docs/SCIENTIFIC_RULES.md; that internal rule is not itself a literature claim and is not in the claim table).
- Disagreement to flag: sources disagree on presentation only: Kim et al. abstract reports 98.65%, EzBioCloud reports 98.7% (rounding). Sources also differ in posture over time: Clarridge (2004, C2) and Boudewijns (2006, C13) describe no accepted criteria / no universally accepted criteria, while Kim et al. (2014, C6) proposes a cross-validated threshold. No source examined declares 98.65% universally valid for every lineage.

## 5. Difficult groups

- C10 (S1): Bacillus cereus shows >99.8% 16S similarity to about ten species; a very high 16S match does not imply the isolate belongs to the top-hit species.
- C11 (S2): In 285 isolates from 226 patients, genus-level-only identification was given in 14% of cases and viridans streptococci made up 61% of those; differentiation of Streptococcus mitis, S. oralis and S. pneumoniae was mainly problematic. One case produced S. pneumoniae at 99% similarity in GenBank BLAST while phenotype and clinical context argued against it.
- C12 (S3): Reported 16S similarities between E. coli and Shigella spp. exceed 99% (up to 99.8% with S. flexneri, 99.9% with S. sonnei, 99.7% with S. boydii); 16S is not considered reliable for differentiating them and the organisms are intermingled in the 16S tree.
- C13 (S3): In one Sanger 16S evaluation only 26.7% of E. coli strains were correctly identified (33.3% were called S. sonnei, 40% S. dysenteriae) with the CGE SpeciesFinder tool.
- C14 (S3): Taxonomy is itself unsettled: the review reports a consensus that Shigella spp. belong to the E. coli species with nomenclature kept for historical and medical reasons, while also reporting researchers who argue the four Shigella species are members of Escherichia on the same footing as E. coli. Sources therefore disagree on Shigella rank, not on the 16S limitation.

## 6. Type-strain provenance

- C15 (S5): EzBioCloud's 16S-ID database represents each reference taxon by a single non-redundant 16S sequence spanning the standard 27F-1492R primers; reference taxa include validly published names, some likely-distinct invalid names, Candidatus taxa and unnamed phylotypes, with a full taxonomic hierarchy from species to phylum.
- C16 (S5): Sequences are sourced from NCBI 16S amplicons, NCBI and JGI genome assemblies, PacBio full-length CCS reads and genomospecies; genome-derived 16S is often more accurate (50x or higher depth versus 1-5x for PCR plus Sanger) and is manually checked using secondary structure. Not all database data are available in NCBI.
- C17 (S8): Accurate sequence identification depends on accurate sequences, correct names attached to them, and correct phylogenetic placement; type strains in certified collections can be incorrectly named or classified. Examples given: "Corynebacterium aquaticum" is genetically distant from Corynebacterium and closer to Microbacterium, and ATCC strains deposited as Corynebacterium xerosis were found to be diverse and incorrectly identified.

## 7. Known database errors and misidentification

- C18 (S2): Deposited sequences in public databases are not peer reviewed; anyone can deposit and name sequence data, so quality is compromised by sequencing errors, ambiguities, incomplete sequences and insufficient strain characterization. Commercial databases are also imperfect, mainly through a limited number of strains.
- C19 (S2): There are no universally accepted criteria for 16S-based species designation; the similarity level required for genus/species calls is debated, adding subjectivity and potential inaccuracy in routine laboratories.
- C20 (S8): A 1995 investigation of GenBank found that almost 20% of sequences presumed to be the same species differed by more than 2%, indicating many genetically different strains deposited under one species name.
- C21 (S8): Example defects: the GenBank type strain of Actinomyces gravaenitzii contained 25 Ns in 500 bp (5%) and the GenBank Mycobacterium szulgai sequence had an unacceptable number of undetermined bases while a commercial database and an in-house sequence agreed.
- C22 (S8): In a test of 79 mycobacterial type-strain sequences, RIDOM gave an identical match for all, versus 23% perfect matches in GenBank by BLAST and 25% in RDP-II.
- C23 (S2): A case study found at least 100 GenBank matches for a Bacteroides fragilis-group isolate with uncultured, partially sequenced organisms as best matches, while pairwise alignment to the B. fragilis reference strain was perfect and other group members gave much lower identity. The authors also report that problematic identifications increased as more ill-characterized organisms were deposited.

## 8. Source agreement summary

- Agree: 16S is strong at genus level but limited at species level for close relatives (S1, S2, S3, S7, S8).
- Agree: reference databases contain errors and are not uniformly curated (S1, S2, S5, S8).
- Minor numerical disagreement: 98.65% (S4) versus 98.7% (S1, S6) - rounding.
- Temporal disagreement: 2004/2006 sources report no accepted quantitative criterion; 2014 source proposes a cross-validated threshold; no opened source calls it universal.
- Taxonomic disagreement: Shigella species status is contested within S3 itself.
- UNVERIFIED by design: anything depending on the blocked PubMed page, Europe PMC, the wrong PMC article, or the unopened Kim et al. full text.

## 9. Claim register (claim | source URL actually opened | date | agent | verified-by)

All rows below are UNVERIFIED pending the citation checker. Date format YYYY-MM-DD.

| Claim | Source URL opened | Date | Agent | Verified-by |
|---|---|---|---|---|
| C1 Pairwise 16S similarity needs a taxonomically valid aligner; BLASTn identity is not used taxonomically | https://kb.ezbiocloud.net/kb/science-blogs/identify/identification-with-16s-rrna | 2026-11-24 | LITERATURE | UNVERIFIED |
| C2 16S resolves genus broadly but not close relatives; no consensus criterion as of 2004; intraspecies microheterogeneity common | https://pmc.ncbi.nlm.nih.gov/articles/PMC523561 | 2026-11-24 | LITERATURE | UNVERIFIED |
| C3 16S gives genus and sometimes species; genome sequencing gives highest resolution | https://kb.ezbiocloud.net/home/science-blogs/identify/16s-vs-genome-identification.md | 2026-11-24 | LITERATURE | UNVERIFIED |
| C4 Partial or incomplete 16S has insufficient resolving power; suggested minimum 95% completeness | https://kb.ezbiocloud.net/kb/science-blogs/identify/identification-with-16s-rrna | 2026-11-24 | LITERATURE | UNVERIFIED |
| C4b Full-length definition is 27F-1492R (Bacteria) and A25F-U1492R (Archaea); cutoff defined on that region | https://kb.ezbiocloud.net/home/science-blogs/identify/16s-rrna-resolution.md | 2026-11-24 | LITERATURE | UNVERIFIED |
| C5 16S has low discriminatory power and poor resolution for close relatives; Shigella example identification rates below 50% | https://pmc.ncbi.nlm.nih.gov/articles/PMC8441030 | 2026-11-24 | LITERATURE | UNVERIFIED |
| C6 Kim et al: 6787 genomes/22 phyla; ANI split near 95-96%; 98.65% 16S by twofold cross-validation over 1M comparisons | https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi?db=pubmed&id=24505072&retmode=text&rettype=abstract | 2026-11-24 | LITERATURE | UNVERIFIED |
| C7 The 95-96% ANI range came from limited datasets and was not tested on all lineages | https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi?db=pubmed&id=24505072&retmode=text&rettype=abstract | 2026-11-24 | LITERATURE | UNVERIFIED |
| C8 EzBioCloud rounds the 16S species cutoff to 98.7% and attributes it to Kim et al 2014 | https://kb.ezbiocloud.net/home/science-blogs/identify/16s-rrna-resolution.md | 2026-11-24 | LITERATURE | UNVERIFIED |
| C10 Bacillus cereus shows >99.8% 16S similarity to about ten species | https://kb.ezbiocloud.net/kb/science-blogs/identify/identification-with-16s-rrna | 2026-11-24 | LITERATURE | UNVERIFIED |
| C11 14% genus-only IDs; viridans streptococci 61% of those; S. mitis/oralis/pneumoniae hard; 99% BLAST call questioned | https://pmc.ncbi.nlm.nih.gov/articles/PMC1594676 | 2026-11-24 | LITERATURE | UNVERIFIED |
| C12 E. coli vs Shigella 16S similarity above 99% (99.8/99.9/99.7%); 16S unreliable; intermingled tree | https://pmc.ncbi.nlm.nih.gov/articles/PMC8441030 | 2026-11-24 | LITERATURE | UNVERIFIED |
| C13 Sanger 16S correctly identified 26.7% of E. coli strains with CGE SpeciesFinder | https://pmc.ncbi.nlm.nih.gov/articles/PMC8441030 | 2026-11-24 | LITERATURE | UNVERIFIED |
| C14 Shigella taxonomic rank is contested (members of E. coli species vs genus Escherichia members) | https://pmc.ncbi.nlm.nih.gov/articles/PMC8441030 | 2026-11-24 | LITERATURE | UNVERIFIED |
| C15 EzBioCloud 16S-ID: one non-redundant representative per taxon, 27F-1492R, hierarchy species to phylum | https://kb.ezbiocloud.net/home/science-blogs/identify/16s-rrna-database.md | 2026-11-24 | LITERATURE | UNVERIFIED |
| C16 EzBioCloud sources 16S from NCBI/JGI/PacBio/genomospecies; genome-derived 16S often more accurate | https://kb.ezbiocloud.net/home/science-blogs/identify/16s-rrna-database.md | 2026-11-24 | LITERATURE | UNVERIFIED |
| C17 Type strains in certified collections can be misnamed or misclassified; C. aquaticum and C. xerosis examples | https://pmc.ncbi.nlm.nih.gov/articles/PMC523561 | 2026-11-24 | LITERATURE | UNVERIFIED |
| C18 Public sequence databases are not peer reviewed; errors, ambiguities, incomplete sequences, poor strain characterization | https://pmc.ncbi.nlm.nih.gov/articles/PMC1594676 | 2026-11-24 | LITERATURE | UNVERIFIED |
| C19 No universally accepted criteria for 16S species designation; similarity threshold debated | https://pmc.ncbi.nlm.nih.gov/articles/PMC1594676 | 2026-11-24 | LITERATURE | UNVERIFIED |
| C20 Almost 20% of presumed same-species GenBank sequences differed by more than 2% in a 1995 study | https://pmc.ncbi.nlm.nih.gov/articles/PMC523561 | 2026-11-24 | LITERATURE | UNVERIFIED |
| C21 A. gravaenitzii type strain with 25 Ns in 500 bp; M. szulgai GenBank sequence with many undetermined bases | https://pmc.ncbi.nlm.nih.gov/articles/PMC523561 | 2026-11-24 | LITERATURE | UNVERIFIED |
| C22 79 mycobacterial type strains: RIDOM all perfect, GenBank 23%, RDP-II 25% | https://pmc.ncbi.nlm.nih.gov/articles/PMC523561 | 2026-11-24 | LITERATURE | UNVERIFIED |
| C23 Bacteroides fragilis group case: uncultured best hits in GenBank vs perfect match to reference strain | https://pmc.ncbi.nlm.nih.gov/articles/PMC1594676 | 2026-11-24 | LITERATURE | UNVERIFIED |
| CORRECTION PMID 24357014 is Lippmann et al. (stem cells), not Kim et al.; correct PMID 24505072 | https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?db=pubmed&id=24357014&retmode=json | 2026-11-24 | LITERATURE | UNVERIFIED |
