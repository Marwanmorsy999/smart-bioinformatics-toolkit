# Phylogenetics demo and known-answer evidence

The plugin runs entirely locally through the M2 adapter pattern. Tool IDs:

| Tool ID | Adapter class | Emitted artifacts |
|---|---|---|
| `phylogenetics.validate` | `PhylogeneticsValidatePlugin` | `phylo_validation.json` |
| `phylogenetics.align` | `PhylogeneticsAlignPlugin` | `alignment.fasta`, `alignment_summary.json` |
| `phylogenetics.tree` | `PhylogeneticsTreePlugin` | `tree.nwk`, `tree.svg`, `tree_stats.json` |
| `phylogenetics.report` | `PhylogeneticsReportPlugin` | `phylo_report.json`, `phylo_report.html` |
| `phylogenetics.workflow` | `PhylogeneticsWorkflowPlugin` | all eight artifacts above, in pipeline order |

The browser executes one tool per job and does not chain step outputs, so
`phylogenetics.workflow` runs the four adapters in order in the **same**
workspace and returns their combined artifacts, `required_artifacts` and
`evidence_hints`. Its eight artifact hashes are byte-identical to the four
individual tools (see below).

All five are declared in `shared/plugins/phylogenetics.json` with
`backend: local-python`, `external_egress: false`,
`requirements: ["python-package:biopython"]`, references, limitations, and
honest `estimated_seconds`. Auto-discovery registers all four when Biopython is
importable.

## Exact commands

From the repository root (PowerShell wrapper scripts are used because the
shell strips inline `$`):

```powershell
# 1. Known-answer tests (PYTHONPATH must point at python-engine/src)
Set-Content -Path $env:TEMP\phylo_tests.ps1 -Value '$env:PYTHONPATH=".\src"; Set-Location "python-engine"; python -m pytest tests/test_phylogenetics_plugin.py -v'
PowerShell -File $env:TEMP\phylo_tests.ps1

# 2. Demo run: writes artifacts + artifact_hashes.json, verifies determinism
python scripts/run_phylogenetics_demo.py
python scripts/run_phylogenetics_demo.py --out python-engine/output/phylo-demo
```

On Linux/macOS the equivalent test command is:

```bash
cd python-engine && PYTHONPATH=./src python -m pytest tests/test_phylogenetics_plugin.py -v
```

Latest run: **38 passed** for this file (Python 3.14.8, pytest 8.4.2,
Biopython 1.88); full Python suite **231 passed**, Worker suite **138 passed**.
`python scripts/generate_plugin_registry.py` and `python scripts/check_plugins.py`
both succeed with the composite tool included.

## Reference data design (`shared/test-cases/phylo_reference.fasta`)

Six 120 bp DNA sequences derived from this fixed ancestor:

```
CAACTTCTTCAAACTGAGGAAGCTGCGGGGCGAGACAGTTTTTCGCCACTTCATCTTTATATTAATCGTCCTGAGTTGGAAACGCTACATAAGTGTTCTCCTGCGGGAGATGTACCCCTC
```

- Clade A founder mutations (zero-based positions, each changed to the next
  base in the A→C→G→T→A cycle): `3, 11, 19, 27, 35, 43, 55, 67`.
- Clade B founder mutations: `7, 15, 23, 31, 39, 47, 59, 71`.
- Private mutations (two per tip): A1 `5,13`; A2 `37,63`; A3 `45,75`;
  B1 `9,41`; B2 `51,81`; B3 `21,85`.

The mutation sets are disjoint, so 28 of 120 columns vary and the remaining
92 are conserved. The intended split is `A1,A2,A3 | B1,B2,B3`.

## Known-answer results (Biopython 1.88)

| Quantity | Expected value |
|---|---|
| Aligned sequences | 6, all exactly 120 columns |
| Conserved columns | 92 |
| Gap characters | 0 (the reference contains substitutions only) |
| NJ tip names | exactly `A1 A2 A3 B1 B2 B3` |
| Branch lengths | all >= 0 |
| Recovered bipartition | `{A1,A2,A3}` vs `{B1,B2,B3}` |
| Input SHA-256 | computed from the FASTA at runtime; asserted in the tests |

Newick emitted by `Bio.Phylo` for `phylogenetics.tree` (deterministic for 1.88):

```
((((A1:0.016666667,A2:0.016666667)Inner1:0,A3:0.016666667)Inner2:0.13333333,B1:0.016666667)Inner3:0,B2:0.016666667,B3:0.016666667)Inner4:0;
```

The `Inner3` clade is `A1,A2,A3`; its complement is `B1,B2,B3`, so NJ recovers
the designed split. The unrooted NJ representation has a trifurcating root
(`Inner4`), which the adapter validates explicitly.

## Byte hashes / determinism proof

The demo runs the complete pipeline twice in **fresh temporary workspaces** and
compares `{tool_id: {artifact_name: sha256}}` maps. It writes
`python-engine/output/phylo-demo/artifact_hashes.json` containing
`"deterministic": true` and exits 0 only when the maps are identical. The test
suite independently asserts `first == second` and compares the following
recorded hashes when `Bio.__version__ == "1.88"`:

| Artifact | SHA-256 |
|---|---|
| `phylo_validation.json` | `56860869a380bb23b7108ec29eea3adfdc17c82a3c9284bad0670fe51f46045c` |
| `alignment.fasta` | `831d8b5b0c80d0569bdd312891149cd417336257244ba365462b0ca1a9322bf5` |
| `alignment_summary.json` | `b668601b52ffaf07583aea35ace1b3580f215893bdf2f644ea241f678b2bd7b7` |
| `tree.nwk` | `5e9d782db4876bbfceb898cd1e85a50279022b1d643a0dadffb74ed6cec1fadf` |
| `tree.svg` | `add6de6280262906497cf433f52d2b90e187fa3710f0a13a5e70dd1b03abcc21` |
| `tree_stats.json` | `135e0e8a9d4e46634ddf4b9d04feb236d4ba47d39ea2e652978338ebd379496a` |
| `phylo_report.json` | `555d7dee01f455bdada8a2126e8cc45d9a3df060384814cda017559b343cffbe` |
| `phylo_report.html` | `f6e089399ea58eb4be0dfce2f91e50c7ac4e073962bdf9740add08fd98f78249` |

If a different Biopython version is installed, only the exact-hash assertion is
skipped; repeat-run byte equality is still required.

## Framework seams exercised end to end

- `evidence_hints` in `tool_run_meta` cite real JSON fields. The control plane
  resolves the `{value}` placeholder and runs `check_explanation`. Live run
  produced, for example, "The multiple sequence alignment spans **120**
  columns." and "The alignment contains **92** conserved sites." with
  `ok=True`, **3 grounded findings** per tool (>= 2 required).
- `required_artifacts` in `tool_run_meta` lists exactly the artifacts each
  adapter emits. `validate()` fails closed with `missing_artifact:<name>` when
  one is removed and with `sha256_mismatch:<name>` when its content is changed.
- Auto-discovery reports all four tools available with zero errors because
  `python-package:biopython` resolves to importable `Bio`.

## Limitations

Progressive MSA is a heuristic; the fixed scoring scheme can change the guide
tree and alignment. The identity distance model ignores saturation and rate
variation; NJ is not maximum likelihood. Branch lengths and bipartitions are
hypotheses, not proof of ancestry. Ambiguous IUPAC bases are accepted but not
resolved. Research use only; not a clinical diagnostic. See
`PHYLOGENETICS_TOOLING.md` for licensing and tool-selection details.
