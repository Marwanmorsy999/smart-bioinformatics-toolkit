# Phylogenetics tooling evaluation (domain 3)

Status: evaluated 2026-11-24 for the M2 plugin adapter pattern in
`IMPLEMENTATION_ROADMAP.md`. Source of truth for the domain is
`PRODUCT_VISION.md` ("Phylogenetics — multiple sequence alignment, tree
inference, tree visualization. *Requires new local executables.*"). This
document records why the implemented plugin uses **Biopython 1.88 as a local
Python library** instead of adding a new external executable, and states
honestly which license claims are verified.

Nothing here changes the control plane. The plugin is discovered from
`shared/plugins/phylogenetics.json`; adapters live in
`python-engine/src/smartbio/plugins/phylogenetics.py`.

## Candidate evaluation

| Tool | Role | Licensing (verification status) | Installation / platforms | Scientific fit and why not selected |
|---|---|---|---|---|
| **MAFFT 7** | Multiple sequence alignment | Source without extensions: **BSD**; Windows ZIP: **GPL**. **VERIFIED** on the official site (https://mafft.cbrc.jp/alignment/software/, "License" section, fetched 2026-11-24). Bundled packages include ViennaRNA/MXSCARNA/ProbConsRNA code with their own notices. | Downloadable binaries/source; Unix-like systems first, Windows and macOS packages exist. | FFT-based progressive MSA with accurate L-INS-i and fast FFT-NS-2 modes. Would require shipping/provisioning a new external executable and accepting GPL terms for the Windows binary. Not selected; Biopython gives a real deterministic MSA in-process. |
| **Clustal Omega** | Multiple sequence alignment | **GPL-2.0**. **VERIFIED** via the GSLBiotech/clustal-omega source-mirror repository metadata (https://github.com/GSLBiotech/clustal-omega, API metadata fetched 2026-11-24). The official clustal.org page returned HTTP 403 from this environment, so its own license wording is **UNVERIFIED** here. | Binaries/source build; Linux, macOS, Windows builds exist. | Accurate MSA for large sequence sets using HMM profile progressive alignment. External executable + GPL-2.0 distribution obligations; not selected. |
| **FastTree / FastTree 2** | Tree inference (approximate ML) | **GPL-3.0**. **VERIFIED** via the author-maintained GitHub mirror `morgannprice/fasttree` (https://github.com/morgannprice/fasttree, API metadata fetched 2026-11-24). The official microbesonline.org site was behind a bot challenge, so its original license text is **UNVERIFIED** here. | C source; typically compiled locally; Unix-like focus, community Windows builds. | Fast approximate maximum-likelihood trees for large alignments. Needs an external executable and cannot be reused through `Bio.Phylo` directly; not selected. |
| **IQ-TREE** | Tree inference (ML, model selection) | **GPL-2.0** (`LICENSE` file states "GNU GENERAL PUBLIC LICENSE Version 2"). **VERIFIED** from https://raw.githubusercontent.com/Cibiv/IQ-TREE/master/LICENSE (fetched 2026-11-24). | Prebuilt binaries and source; Linux, macOS, Windows. | Strong ML model selection and branch support; much heavier compute and an external executable. Not selected. |
| **PhyML** | Tree inference (ML) | **GPL-3.0**. **VERIFIED** via the author's repository `stephaneguindon/phyml` metadata (https://github.com/stephaneguindon/phyml, API metadata fetched 2026-11-24). | Source build / binaries; Unix-like, with community Windows builds. | Classical ML phylogenetics; external executable and GPL-3.0 obligations. Not selected. |
| **Biopython 1.88** | MSA + tree + I/O library | **VERIFIED** nuance: installed metadata declares `License-Expression: LicenseRef-Biopython-License-Agreement`; upstream `LICENSE.rst` states the *Biopython License Agreement*, with **some files dual-licensed BSD-3-Clause** (https://raw.githubusercontent.com/biopython/biopython/master/LICENSE.rst, fetched 2026-11-24). The shorthand "Biopython is BSD-3-Clause" is therefore **only partly accurate** and is marked as such rather than repeated unchecked. Citation: Cock et al. 2009, https://doi.org/10.1093/bioinformatics/btp163 (**VERIFIED** in Biopython's own README). | `pip install biopython`; cross-platform wheels (Linux/macOS/Windows); already pinned in `python-engine/requirements.txt` and importable in this environment. | Provides real `Bio.Align.PairwiseAligner` (affine-gap global/local alignment), `Bio.Phylo.TreeConstruction` (`DistanceCalculator`, `DistanceTreeConstructor` UPGMA/NJ) and `Bio.AlignIO`/`Bio.Phylo` I/O. **Selected.** |

## Why Biopython 1.88 is sufficient and honest here

1. **No synthetic results.** The adapter computes every reported value from the
   input FASTA: pairwise identity distances from `PairwiseAligner`, consensus
   profiles from the aligned residues, an identity distance matrix from
   `DistanceCalculator`, and an NJ tree from `DistanceTreeConstructor`.
2. **Existing scientific code is reused, not replaced.** FASTA staging and
   validation call the existing `smartbio.fasta.parse_fasta_file` and
   `validate_records`. Aligned FASTA is serialized with `Bio.AlignIO`; trees
   with `Bio.Phylo.write` and round-tripped with `Bio.Phylo.read`.
3. **Determinism.** Fixed scoring (match +2, mismatch -1, gap open -5, gap
   extend -2, including terminal gaps), no RNG, and explicit alphabetical
   tie-breaks in consensus columns. Two independent runs produce byte-identical
   artifacts (see `docs/plugins/PHYLOGENETICS_DEMO.md`).
4. **Operational fit.** No new executable, no egress, no GPL distribution
   question for our own artifacts, and a single statically verifiable
   requirement: `python-package:biopython` (checked by auto-discovery via
   `importlib.util.find_spec("Bio")`).

## Method actually implemented

- **Guide tree:** global pairwise alignments give p-distances
  (`1 - identities / comparable_columns`, rounded to 10 decimals); UPGMA over
  those distances gives the guide tree.
- **Progressive MSA:** each internal guide node merges two child profiles by
  globally aligning the two child consensus strings with `PairwiseAligner`,
  then projecting the consensus gaps back onto every row of the profile.
- **Tree:** `DistanceCalculator("identity").get_distance(msa)` (Biopython 1.88
  API; `compute_distances` fallback for older supported releases) followed by
  `DistanceTreeConstructor().nj(dm)`.
- **Validation of outputs:** tip names must exactly equal input IDs, tip count
  must equal sequence count, no negative branch lengths, bifurcating internal
  nodes (the unrooted NJ root may be trifurcating), and the Newick must survive
  a `Bio.Phylo.read` round-trip. Failures return `failure_result` with no
  artifacts.

## References used (honest verification)

- Cock P.J.A. et al. (2009) *Biopython: freely available Python tools for
  computational molecular biology and bioinformatics*, Bioinformatics 25:1422–3,
  https://doi.org/10.1093/bioinformatics/btp163 — **VERIFIED**.
- Saitou N. & Nei M. (1987) *The neighbor-joining method: a new method for
  reconstructing phylogenetic trees*, Mol Biol Evol 4:406–425,
  https://doi.org/10.1093/oxfordjournals.molbev.a040454 — **VERIFIED** via
  Crossref metadata (fetched 2026-11-24).
- Thompson J.D., Higgins D.G. & Gibson T.J. (1994) *CLUSTAL W: improving the
  sensitivity of progressive multiple sequence alignment*, Nucleic Acids Res
  22:4673–4680, https://doi.org/10.1093/nar/22.22.4673 — **VERIFIED** via
  Crossref metadata (fetched 2026-11-24). Cited for the progressive alignment
  concept only; ClustalW is **not** executed by this plugin.

## Unverified items

- The exact license wording on the official FastTree and Clustal Omega web
  sites could not be fetched from this environment (bot challenge / HTTP 403).
  Repository metadata is recorded above instead and explicitly labeled.
- The statement "Biopython is BSD-3-Clause" is not fully accurate for the
  installed 1.88 distribution; the verified facts are recorded above.
- No performance claim is made against MAFFT/IQ-TREE/PhyML; no benchmark was
  run for those external executables in this task.
