# Expert review request — difficult-group membership and interpretation wording

**Status: PENDING HUMAN REVIEW.** Every scientific claim, member list, wording choice and threshold described below is unconfirmed by us. We will not decide any of it ourselves.
**Audience:** microbiologist / clinical microbiologist. **Project:** Smart Bioinformatics Toolkit, milestone 0.5.0. **Prepared:** 2026-11-24.

## Context
16S rRNA BLAST tool, research/education only. A conservative verdict layer emits species / group / genus / below-screening-threshold / insufficient-evidence calls. Three "difficult groups" trigger group-level calls or cautions; their member lists, notes and sources are flagged `needs_curator_review` and are still UNVERIFIED in the evidence ledger. We need your judgement before any of it changes.

## How to answer
For each item give **Yes / No / Unsure**, then free text. Add citations or URLs where you have them; "unsure" and "outside my expertise" are valid answers. Please do not ask us to pick an option — you decide.

## 0. What is currently PENDING HUMAN REVIEW
All of the following are unconfirmed and illustrative only; none is endorsed by us:
- `shared/difficult-groups.json` and its generated copy `web-platform/public/js/difficult-groups.js`: all three species lists, display names, notes, evidence statements and source URLs.
- `web-platform/public/js/verdict.js` and `python-engine/src/smartbio/taxonomy/verdict.py`: group matching, `group_level_only`, the 98.65% default and the 0.35 pp near-threshold margin.
- `web-platform/public/js/report.js` and `python-engine/src/smartbio/taxonomy/report.py`: disclaimers, report title and verdict wording.
- `web-platform/public/taxonomy.html`, `public/js/taxonomy-app.js`, `index.html`, `blast.html`, `benchmark.html`: UI labels, status names, threshold field.
- `docs/SCIENTIFIC_RULES.md`, `docs/EVIDENCE_LEDGER.md`, `docs/CONTRACTS.md`: the encoded rules and claims.

## 1. Species membership of the difficult groups, given 16S limits
Current lists (verbatim from `shared/difficult-groups.json`):
- Bacillus cereus group (7): B. cereus, B. thuringiensis, B. anthracis, B. mycoides, B. pseudomycoides, B. weihenstephanensis, B. toyonensis.
- Mitis group (viridans) streptococci (5): S. mitis, S. oralis, S. pneumoniae, S. pseudopneumoniae, S. infantis.
- Escherichia/Shigella complex (5): E. coli, S. dysenteriae, S. flexneri, S. boydii, S. sonnei.
Q1a. Bacillus cereus group — should this be the member list? Yes/No/Unsure. Free text: which species should be added, removed or renamed, and why?
Q1b. Mitis group — should this be the member list? Yes/No/Unsure. Free text: which species should be added, removed or renamed (e.g. other viridans members), and why?
Q1c. Escherichia/Shigella — should this be the member list? Yes/No/Unsure. Free text: which species should be added, removed or renamed, and why?
Q1d. Should membership be pinned to a named taxonomy resource and version? Yes/No/Unsure + free text. How should newly described species be handled?
Q1e. Are there other groupings where 16S cannot resolve species and for which we should add a group? Yes/No/Unsure + free text (we will add none without your answer and a source).

## 2. Genus/complex-level wording in a research-only tool
Q2a. Is it appropriate to report "at group level" / "at genus or complex level" for these organisms rather than a species name? Yes/No/Unsure + free text.
Q2b. Are the current group display names acceptable — "Bacillus cereus group", "Mitis group (viridans) streptococci", "Escherichia / Shigella complex"? Yes/No/Unsure + preferred names.
Q2c. Current caution notes: (a) "16S similarity cannot separate these species reliably; report at group level and confirm with other evidence (for example genome-level comparison)." (b) "Viridans streptococci frequently cannot be resolved to species by 16S sequencing alone; genus-level reporting is common practice." (c) "16S rRNA similarity alone cannot reliably separate Escherichia coli from Shigella spp.; report at genus/complex level and confirm with other evidence." Are these acceptable as-is? Yes/No/Unsure + your exact preferred wording for each.
Q2d. Should the tool ever display a species name for a member of a difficult group, even with a caution? Yes/No/Unsure + free text.
Q2e. Should "confirm with other evidence" appear at all in a research-only tool, or is it too close to advice? Yes/No/Unsure + free text.

## 3. Additional evidence to suggest as next steps (questions only — you decide)
We will not prescribe any of these; please tell us which, if any, should be mentioned.
Q3a. Whole-genome sequencing with ANI (and/or dDDH) as a next step? Yes/No/Unsure + free text.
Q3b. MALDI-TOF mass spectrometry? Yes/No/Unsure + free text.
Q3c. Phenotypic / biochemical tests (e.g. catalase, coagulase, haemolysis, optochin, bile solubility, serotyping)? Yes/No/Unsure + free text.
Q3d. Additional loci or targeted tests (e.g. rpoB / gyrB / sodA, toxin-gene PCR, full-length 16S)? Yes/No/Unsure + free text.
Q3e. If any are suggested, where and how strongly — report text, UI note, or not at all; as a suggestion or a requirement? Yes/No/Unsure + free text.
Q3f. Anything else you would want a user to do before treating a result as meaningful? Free text.

## 4. Does current wording imply clinical validity?
Please review these examples (file:line, quoted verbatim):
- `web-platform/public/js/report.js:33` and `python-engine/src/smartbio/taxonomy/report.py:24`: "Research use only. This verdict interprets BLAST similarity evidence; it is not proof of species identity and not a clinical diagnosis."
- `web-platform/public/js/verdict.js:13-15`: the same DISCLAIMER string; `:201` "Only {species} has hits at or above {n}% identity."; `:268` "report at group level".
- `web-platform/public/taxonomy.html:94` heading "Taxonomic consensus"; `:88` button "Analyze taxonomy"; `:82` "Species screening identity (%)" / "Screening reference, not a universal species boundary."; `:109` footer "Research use · Not for clinical diagnosis".
- `web-platform/public/js/taxonomy-app.js:328`: "Consensus support is an evidence fraction, not a probability of correct identification. BLAST similarity is not proof of species identity."
- `web-platform/public/js/difficult-groups.js:32`: "A clinical laboratory 16S study reported genus-level-only identification in 14% of isolates...".
- `python-engine/src/smartbio/taxonomy/report.py:55`: report title "Taxonomy analysis report"; `:96-98` displays status and "rank: taxon".
- `docs/CONTRACTS.md:9`: status names `species_supported`, `group_level_only`, `genus_level_only`.
Q4a. Does anything above read as a clinical identification or diagnosis to a non-specialist? Yes/No + which items.
Q4b. Are status labels such as "species_supported" / "group_level_only" too assertive? Yes/No + preferred alternatives.
Q4c. Is "identification" / "consensus" terminology acceptable in a research-only UI and report? Yes/No + alternatives.
Q4d. Is the disclaimer prominent and strong enough, and where else should it appear? Yes/No + free text.
Q4e. Any other wording in those files that implies clinical validity or overstates certainty? Free text.

## 5. The 98.65% screening reference
Q5a. Should 98.65% remain the default identity threshold? Yes/No/Unsure + free text.
Q5b. Should the tool treat it as a band rather than a single cutoff (current near-threshold margin is 0.35 percentage points)? Yes/No/Unsure + free text.
Q5c. Should the UI label "Species screening identity (%)" and small text "Screening reference, not a universal species boundary." be changed? Yes/No + exact preferred wording.
Q5d. Should the report explain the threshold and its limits more prominently? Yes/No + free text.
Q5e. Should the threshold differ by group or organism, or should no default be offered? Yes/No/Unsure + free text.
Q5f. Below the threshold, should the tool report at genus level (current behaviour) or always abstain? Yes/No/Unsure + free text.

## How your answers will be incorporated
- The orchestrator logs the answers in `docs/ORCHESTRATION_LOG.md` and, if any schema/status label changes, updates `docs/CONTRACTS.md`; no code change is made before your sign-off.
- Each answer becomes a row in `docs/EVIDENCE_LEDGER.md` (`claim | source URL actually opened | date | expert | verified-by`). Your answers resolve the difficult-group claims currently marked UNVERIFIED / `needs_curator_review`.
- `shared/difficult-groups.json` stays the single source of truth; its generated JS copy is regenerated, and both verdict implementations plus tests are kept in sync. Accepted wording changes are applied to both JS and Python reports and the UI text, then the test suite is re-run.
- Until answers arrive, every item above remains PENDING HUMAN REVIEW and no taxonomy or safety wording is treated as settled.

## Reminder
We will not choose species lists, caution wording or thresholds without your answers. "Unsure" is useful; a citation is welcome but not required.
