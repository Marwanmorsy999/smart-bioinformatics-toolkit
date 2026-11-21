// Generated from shared/difficult-groups.json. Do not edit by hand:
// tests/verdict.test.mjs fails if this file drifts from the shared JSON.
export const DIFFICULT_GROUPS = [
  {
    "id": "bacillus_cereus_group",
    "display_name": "Bacillus cereus group",
    "species": [
      "Bacillus cereus",
      "Bacillus thuringiensis",
      "Bacillus anthracis",
      "Bacillus mycoides",
      "Bacillus pseudomycoides",
      "Bacillus weihenstephanensis",
      "Bacillus toyonensis"
    ],
    "note": "16S similarity cannot separate these species reliably; report at group level and confirm with other evidence (for example genome-level comparison).",
    "evidence": "EzBioCloud knowledge base: B. cereus shows >99.8% 16S similarity to about ten species, so a very high 16S match does not prove the hit species.",
    "source_url": "https://kb.ezbiocloud.net/kb/science-blogs/identify/identification-with-16s-rrna",
    "needs_curator_review": true
  },
  {
    "id": "mitis_group_streptococci",
    "display_name": "Mitis group (viridans) streptococci",
    "species": [
      "Streptococcus mitis",
      "Streptococcus oralis",
      "Streptococcus pneumoniae",
      "Streptococcus pseudopneumoniae",
      "Streptococcus infantis"
    ],
    "note": "Viridans streptococci frequently cannot be resolved to species by 16S sequencing alone; genus-level reporting is common practice.",
    "evidence": "A clinical laboratory 16S study reported genus-level-only identification in 14% of isolates, of which viridans streptococci made up 61%.",
      "source_url": "https://pmc.ncbi.nlm.nih.gov/articles/PMC1594676",
      "needs_curator_review": true
    },
    {
      "id": "escherichia_shigella_complex",
      "display_name": "Escherichia / Shigella complex",
      "species": [
        "Escherichia coli",
        "Shigella dysenteriae",
        "Shigella flexneri",
        "Shigella boydii",
        "Shigella sonnei"
      ],
      "note": "16S rRNA similarity alone cannot reliably separate Escherichia coli from Shigella spp.; report at genus/complex level and confirm with other evidence.",
      "evidence": "16S rRNA gene sequence similarities between E. coli and Shigella spp. exceed 99%, so 16S rRNA is not a reliable tool for differentiating them.",
      "source_url": "https://pmc.ncbi.nlm.nih.gov/articles/PMC8441030",
      "needs_curator_review": true
    }
  ];
