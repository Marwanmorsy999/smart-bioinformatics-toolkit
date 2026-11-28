# M7.3 — Phase 1: Live Galaxy Europe capability discovery

Captured live against https://usegalaxy.eu/api (2026-11-25) with a local harness
scripting the verified public REST contract. Expected values were checked.

## Environment

- `GET /api/version` -> `{"version_major":"26.1","version_minor":"3.dev0"}`
  → full version `26.1.3.dev0` (expected 26.1.3.dev0: match).

## Captured artifacts (all saved under `docs/discovery/m7_3/`)

| File | Bytes | Source |
| --- | --- | --- |
| `galaxy_eu_api_tools_2026-11-25.json` | 4,389,711 | `GET /api/tools` (full panel) |
| `galaxy_eu_api_workflows_2026-11-25.json` | 1,681,776 | `GET /api/workflows` |
| `galaxy_eu_api_version_2026-11-25.json` | 104 | `GET /api/version` |
| `galaxy_tool_inputs_2026-11-25/*.json` | ~6–2,600 B each | `GET /api/tools/{id}/inputs` |

Tool input captures (5 tools of interest):

| Tool id (from live panel) | `name` | `version` | `description` | Inputs file |
| --- | --- | --- | --- | --- |
| `toolshed.g2.bx.psu.edu/repos/rnateam/mafft/rbc_mafft/7.526+galaxy2` | MAFFT | 7.526+galaxy2 | Multiple alignment program for amino acid or nucleotide sequences | `toolshed_g2_bx_psu_edu_repos_rnateam_mafft_rbc_mafft_7_526_galaxy2_inputs.json` |
| `toolshed.g2.bx.psu.edu/repos/iuc/iqtree/iqtree/3.1.4+galaxy1` | IQ-TREE | 3.1.4+galaxy1 | Phylogenomic / evolutionary tree construction from multiple sequences | `toolshed_g2_bx_psu_edu_repos_iuc_iqtree_iqtree_3_1_4_galaxy1_inputs.json` |
| `toolshed.g2.bx.psu.edu/repos/crs4/muscle/muscle/0.0.11` | MUSCLE | 0.0.11 | Multiple sequence alignment tool (alternative to MAFFT) | `toolshed_g2_bx_psu_edu_repos_crs4_muscle_muscle_0_0_11.json` |
| `toolshed.g2.bx.psu.edu/repos/iuc/fasttree/fasttree/2.1.10+galaxy1` | FastTree | 2.1.10+galaxy1 | Approximate maximum likelihood phylogeny inference tool (alternative to IQ-TREE) | `toolshed_g2_bx_psu_edu_repos_iuc_fasttree_fasttree_2_1_10_galaxy1_inputs.json` |
| `toolshed.g2.bx.psu.edu/repos/iuc/newick_utils/newick_display/1.6+galaxy2` | NewickUtils | 1.6+galaxy2 | A suite of utilities for manipulating newick format files (tree viewing) | `toolshed_g2_bx_psu_edu_repos_iuc_newick_utils_newick_display_1_6_galaxy2_inputs.json` |

Note: `GET /api/tools/toolshed.g2.bx.psu.edu/repos/iuc/muscle/muscle/0.0.11/inputs`
returned **404** on this instance (the panel does not advertise a muscle/muscle/0.0.11
id; the toolshed listing below carries the alternate muscle 0.0.11 path used in the
panel). The panel file above is the authoritative catalog evidence.

All five of the above tools appear in the live `/api/tools` panel (`PANEL_HIT`
verified for each id). The adapter uses live discovery (no hardcoded ids).

## Notes for implementation (Phase 2)

- `MAFFT` id: `toolshed.g2.bx.psu.edu/repos/rnateam/mafft/rbc_mafft/7.526+galaxy2`
  (owner `rnateam`, toolshed `toolshed.g2.bx.psu.edu`).
- `IQ-TREE` id: `toolshed.g2.bx.psu.edu/repos/iuc/iqtree/iqtree/3.1.4+galaxy1`.
- Execution-critical: verified `POST /api/tools` + `POST /api/tools/fetch`
  multipart upload contract is already implemented and tested (M7.2) —
  `web-platform/providers/galaxy/index.js` uses it via `uploadDataset`.

## Commit history note

This doc is written during M7.3 Phase 1 re-capture; an earlier M7.3 Phase 1
commit (529a95e) captured the same endpoints; this update re-queries live data
and adds the DiscoveryNotes.md save.
