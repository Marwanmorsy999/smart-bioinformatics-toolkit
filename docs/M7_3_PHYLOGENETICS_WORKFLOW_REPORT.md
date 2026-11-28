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



## Recovery addendum â€” schema discovery and first verified MAFFT execution (final)

**Schema discovery (authenticated, live, redacted):** the endpoint
`GET /api/tools/{tool_id}?io_details=true&tool_version={version}` returned HTTP 200 with the full, instance-specific tool definition. Routes tested: `?io_details=true` â†’ 200 with `inputs`; `/interop` â†’ 200 panel metadata only; `/build` (with a valid history) â†’ 200 with resolved HDA options and exact field names; `/parameter_request_schema` â†’ 200 panel metadata only. All responses sanitized (32+ char IDs redacted); no credentials or headers returned.

MAFFT `toolshed.g2.bx.psu.edu/repos/rnateam/mafft/rbc_mafft/7.526+galaxy2` real inputs: conditional `input` (test param `mapping`, verified default `implicit`), inside case `implicit` a repeat `batches` (default 1) containing required data parameter `inputs` (extensions `fasta`); conditional `datatype_selection` (test param `datatype`, default `""` = auto-detect); optional `seed`. Derived Galaxy form names: `input|mapping`, `input|batches_0|inputs`, `datatype_selection|datatype`. IQ-TREE `toolshed.g2.bx.psu.edu/repos/iuc/iqtree/iqtree/3.1.4+galaxy1`: section `general_options` containing data param `s` (FASTA/PHYLIP/etc.), plus verified defaults (`seqtype=DNA`, etc.); derived name `general_options|s`.

**Real MAFFT run:** after implementing the schema-driven payload (`web-platform/providers/galaxy/galaxy_schema.js`, tests in `tests/phylo_galaxy_schema.test.mjs`), a real MAFFT job was submitted through the deployed staging Worker and **completed**: Galaxy job `4838ba20a6d8676526e1c47a033d95de`, state `ok`, exit_code 0, tool version reported by the instance as `v7.526 (2024/Apr/26)`, create_time `2026-11-25T21:44:34`, update_time `2026-11-25T21:46:21`. Its real output dataset UUID is `cf2a6760-b219-4212-a609-aa37286628f5` (from the job's `outputs.outputAlignment` / command line). Input dataset `40160950115d555ef559061fbced7bce` in history `11ac94870d0bb33adfdcc31d5164dd84`, input SHA-256 `a0e181d42477ba4e466d678d647e3b8544b7c84af281734eb908d90c9a5782e4`.

**Known defect:** the run endpoint's bounded poll reported `timeout` although Galaxy shows the job `ok` â€” the poll window was consumed by upload-readiness waiting plus a 120s cap; this is a timing defect, not a Galaxy failure. A resume path was added to use the completed alignment dataset, but `getArtifacts({dataset_id})` did not resolve that dataset (`resume dataset unavailable`), so retrieval/tree inference/validation remain blocked.

**Verdict components:** schema discovery PASS; MAFFT submission + real completion PASS (job evidence above); tree schema discovery PASS; alignment artifact retrieval, tree job, independent remote artifact validation, run-derived report with remote artifacts, and full website E2E with a real completed workflow â€” NOT ACHIEVED. Key rotation not performed (no new credential supplied; no secret printed).

## M7.3.1 diagnosis and offline fixes (no further live execution; key not rotated)

**Cause of `resume dataset unavailable`:** the resume path used the dataset UUID `cf2a6760-b219-4212-a609-aa37286628f5` as though it were a Galaxy HDA id. The Galaxy job probe showed `outputs.outputAlignment` with both `id` (the HDA id used by `/api/datasets/{id}` and history contents) and a different `uuid`; `job.params.input` carried a numeric HDA id (`310912901`). Passing the UUID to `getArtifacts({dataset_id})` therefore resolved no history dataset. Fixed by explicit identifier types (`galaxyHdaId`, `galaxyDatasetId`, `galaxyDatasetUuid`) and membership validation in `providers/galaxy/galaxy_ids.js`; regression fixtures use an HDA id distinct from the UUID.

**Polling defect:** the old poll treated any non-terminal state after its window as `timeout` without reconciling Galaxy's `ok` state; the completed job (state `ok`, exit 0) was reported as timeout. Fixed with an explicit state machine (`classifyJobState`): `ok` â†’ succeeded; queued/running continue; failed/deleted â†’ failed; timeout only after the genuine deadline. A completed job is never reported as timeout; missing artifacts do not masquerade as a failed/timeout job.

**Live evidence already captured (not renewed):** MAFFT job `4838ba20a6d8676526e1c47a033d95de` state `ok`, exit 0, version `v7.526`, output association with HDA id `40160950115d555ef559061fbced7bce`, dataset UUID `cf2a6760-b219-4212-a609-aa37286628f5`, history `11ac94870d0bb33adfdcc31d5164dd84`, input SHA-256 `a0e181d42477ba4e466d678d647e3b8544b7c84af281734eb908d90c9a5782e4`.

**Security:** the exposed staging key has NOT been rotated (no replacement credential supplied; no credential printed). Per milestone rules, NO further live Galaxy calls were made in this continuation; recovery of the alignment through the live API, IQ-TREE execution, Newick retrieval, and the full website E2E with a real cloud workflow were therefore NOT performed or claimed. Overall verdict: BLOCKED pending rotation and verified live recovery.

