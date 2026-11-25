# M7.3 — First multi-step cloud bioinformatics workflow (phylogenetics)

**Status: PARTIAL — implementation and offline validation complete; a real remote multi-step Galaxy run has NOT yet been demonstrated through the website.** This document does not claim publication-grade inference or a successful end-to-end remote execution.

## Phase 1 — Live Galaxy Europe discovery (evidence-backed)

- Instance: `GET https://usegalaxy.eu/api/version` → `{"version_major":"26.1","version_minor":"3.dev0"}` (OpenAPI version `26.1.3.dev0`).
- Tool panel: `GET /api/tools` → 103 sections, 4,605 flattened tools; raw JSON committed in `docs/discovery/m7_3/`.
- Workflows: `GET /api/workflows` → 2,544 published; 67 phylogeny/tree/alignment matches. Committed in `docs/discovery/m7_3/`.
- Verified exact tool IDs (from the live panel, not guessed; the Worker discovers them dynamically at run time):
  - MAFFT — `toolshed.g2.bx.psu.edu/repos/rnateam/mafft/rbc_mafft/7.526+galaxy2` (version 7.526+galaxy2, workflow-compatible)
  - IQ-TREE — `toolshed.g2.bx.psu.edu/repos/iuc/iqtree/iqtree/3.1.4+galaxy1` (version 3.1.4+galaxy1, workflow-compatible)
  - MUSCLE — `toolshed.g2.bx.psu.edu/repos/crs4/muscle/muscle/0.0.11`; ClustalW — `toolshed.g2.bx.psu.edu/repos/devteam/clustalw/clustalw/2.1+galaxy1`
  - FastTree — `toolshed.g2.bx.psu.edu/repos/iuc/fasttree/fasttree/2.1.10+galaxy1`
  - Newick Display — `toolshed.g2.bx.psu.edu/repos/iuc/newick_utils/newick_display/1.6+galaxy2`; ETE tree viewer — `toolshed.g2.bx.psu.edu/repos/iuc/ete_treeviewer/ete_treeviewer/3.1.3+galaxy0`
- Tool input schemas: `GET /api/tools/{id}/inputs` returns panel metadata only on this instance without an authenticated tool config; saved in `docs/discovery/m7_3/galaxy_tool_inputs_2026-11-25/`.
- No suitable accessible published workflow was selected; the milestone permits orchestrating validated individual tools in one Galaxy history. MAFFT + IQ-TREE are both workflow-compatible and are the two remote scientific operations.

## Phases 2/4 — Implemented workflow and website

Files added:
- `web-platform/providers/galaxy/galaxy_phylo.js` — live-panel discovery helper (MAFFT/IQ-TREE by name+description; no hardcoded IDs).
- `web-platform/functions/api/ai/workflows/phylo/run.js` — POST endpoint: FASTA validation → SHA-256 → plan + D1 job records → Galaxy upload (verified `/api/tools/fetch` contract) → MAFFT → IQ-TREE → bounded polling → dataset retrieval → alignment/tree validation → per-step provenance. Returns job IDs, dataset IDs, tool versions, validation, timing.
- `web-platform/functions/api/ai/workflows/phylo/status.js` — GET progress for the website.
- `web-platform/functions/api/ai/workflows/phylo/validators.js` — independent Newick parser + alignment/tree validators.
- `web-platform/functions/api/ai/jobs/[id]/report.js` — job-based report from D1 records (jobs, tool_runs, artifacts, evidence references, audit events); never trusts caller-supplied results.
- `web-platform/public/phylo.html`, `web-platform/public/js/phylo.js` — upload, objective, plan inspection, approval gate, live job progress, browser tree view, downloads.

## Phase 3 — Scientific validation

- Reference dataset: `shared/test-cases/phylo_reference/reference.fasta` — 5 taxa (Human/Chimp pair, Mouse/Rat pair, Fish outgroup), 60 bp each.
- `expected_topology.json` states the expected clades, taxa set and outgroup. These are known **by construction**, not from an external phylogenetic benchmark.
- Independent checks: record count, no silently dropped taxa, equal alignment lengths, DNA alphabet, parseable Newick, taxa-set equality, expected clades recovered. Tests: `python-engine/tests/test_galaxy_phylo_workflow.py`, `web-platform/tests/phylo_galaxy_e2e_contract.test.mjs`.
- Limitations: progressive alignment is heuristic; NJ/distance and ML inferences are hypotheses; no bootstrap values or substitution-model adequacy are asserted; synthetic reference is not publication-grade.

## Phase 6 — Test results

Existing suites were verified green by the independent tester: Python `pytest tests/` → **240 passed**, JS `npm test` → **403 passed**. New tests are included and executed below at handover.

## Phase 7 — Security

- GALAXY_API_KEY / GALAXY_BASE_URL are Worker secrets; the adapter reads them from env only and uses them solely as `X-API-Key` request headers. No credential is returned to the browser, placed in a URL, or written to a browser response. `safeString` normalizes all returned IDs.
- The previously exposed key must be rotated at the provider first, then installed via `scripts/secrets/set-provider-secrets.ps1 -Provider galaxy -Environment staging` (interactive secure input). **Rotation was not performed in this milestone** — no new key was supplied.

## Real Galaxy execution evidence

**Not obtained in this session.** The two implementation workers hit the free usage limit before running the deployed endpoint against `usegalaxy.eu`; earlier discovery recorded a 403 "Action requires account activation" for tool submission with the then-current key. Consequently:
- Galaxy job IDs: not obtained (no fabrication).
- Dataset IDs: not obtained.
- Output SHA-256 hashes: reference-dataset hash computed locally; no remote artifact hashes.
- Execution times: not measured remotely.
- Screenshots: Playwright browser E2E of the website is included; no screenshot of a real remote job was captured.

**Acceptance gates not yet satisfiable:** "one actual multi-step workflow succeeds through the website", "≥2 scientific operations execute remotely", "intermediate outputs retrieved", "final artifacts pass independent scientific checks (remote)", "report generated from real run records". These require a Galaxy account with execution enabled and a live run of `POST /api/ai/workflows/phylo/run` from the deployed staging Worker.


## Live execution addendum (2026-11-25, final session)

A real request was sent from the deployed staging Worker (`Version ID dcc827cf-6d8c-4cfe-86d0-d7ea874ff740`, later `b796c8e6-be2b-4e04-a9e1-c81916d538b7`) to `POST /api/ai/workflows/phylo/run`:

| Item | Actual value |
|---|---|
| Plan / run | `plan_59990e4f3a49b979` / `run_44e468ac4a02e518` (earlier attempts: `run_367cd6cf07852a11`, `run_342282b4dd91c304`) |
| Input SHA-256 | `a0e181d42477ba4e466d678d647e3b8544b7c84af281734eb908d90c9a5782e4` |
| Galaxy history | `11ac94870d0bb33ac5c9276670d578ce` (earlier: `...b609b70c3a73f318`, `...b577b7bbcd24b42d1`) |
| Real upload job ID | `4838ba20a6d8676567e0ae253b3aeadd` (earlier: `...6657ccaedad9a0c3418`, `...6657e0ae253b3aeadd`) |
| Real uploaded dataset ID | `40160950115d555ed9d9d8838b0d49a1` (earlier: `...db2`, `...ec3`) |
| Tool discovery | LIVE: MAFFT 7.526+galaxy2 and IQ-TREE 3.1.4+galaxy1 found in the live panel |
| Upload result | SUCCESS â€” real Galaxy history and dataset IDs above |

**MAFFT submission returned HTTP 400** on every attempt (both HDA-reference and pasted-content input forms). Authenticated `GET /api/tools/{id}` and `GET /api/tools/{id}/inputs` on usegalaxy.eu return only panel metadata â€” no input/output schema is exposed, so the exact MAFFT parameter name could not be verified live; no guessed schema is claimed. Consequently NO remote alignment/tree datasets were retrieved, NO remote hashes/execution times exist, and the acceptance gates requiring remote multi-step execution remain unmet.

**Security note**: the debug schema endpoint (`/api/ai/workflows/phylo/tool`) returns only tool metadata; `X-API-Key` is used server-side and never returned.

