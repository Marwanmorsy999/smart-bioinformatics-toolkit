# M5 Independent Integration Test Report

**Role:** independent integration tester (did not implement the work).  
**Report date:** 2026-11-25 (test runs 2026-11-24 21:29–21:59 UTC).  
**Primary scope (per direction change received mid-run):** the **website** (`web-platform`) — phylogenetics intent, `phylogenetics.workflow` plan/approve/job/result/report path, real-vs-mock labelling, and preservation of the original plugins.  
**Explicitly OUT OF SCOPE (per direction change):** the offline `--job-file` agent CLI demo and the WSL/Linux terminal cross-platform verification. Exact results are retained below as **historical notes only** and are **not** used to support any pass claim. The 26-assertion independent audit verifier is retained as **supporting** evidence, not the main deliverable.

Scripts used for evidence collection were written only under `D:\DevCache\Temp\opencode\` (outside the repo). The only file written inside the repo is this report. No product code was modified by the tester.

---

## 1. Exact toolchain and environment

| Component | Exact version / value | How obtained |
|---|---|---|
| OS (primary) | Windows, `win32 AMD64` | `platform.system()`, `platform.machine()` |
| Python | **3.14.8** | `python --version` |
| Biopython | **1.88** | `Bio.__version__` |
| pytest | **8.4.2** | `pytest.__version__` |
| numpy | **2.3.4** | `numpy.__version__` |
| pandas | **2.3.3** | `pandas.__version__` |
| jsonschema | **4.25.1** | `jsonschema.__version__` (DeprecationWarning on attribute access is cosmetic) |
| Node | **v24.21.0** | `node --version` |
| npm | **12.2.0** | `npm --version` |
| WSL (out of scope) | Docker Desktop / Alpine, Python **3.12.16**, `apk-tools 3.0.3-r1`, gcc 15.2.0 built into D: sysroot | `wsl -e sh -c ...` |
| Repo root | `D:\smart-bioinformatics-toolkit-milestone-0_5_0\smart-bioinformatics-toolkit-milestone-0.5.0\smart-bioinformatics-toolkit` | — |

The dashboard command `D:\Apps\Star-Office-UI\office-status.cmd` **does not exist** (`Test-Path` returned `False`). Noted once, not retried, per instruction.

---

## 2. Git state — code changed during this run

| Capture point | Exact HEAD | Working tree |
|---|---|---|
| First capture, 2026-11-24 ~21:34 UTC | `ef7de3e9fac77f42d79c3d1453f6b0f9e8ffa272` | 1 modified file (`web-platform/functions/api/blast/_lib.js`) |
| Final capture, **2026-11-24T21:59:23.1539136Z** | `ef7de3e9fac77f42d79c3d1453f6b0f9e8ffa272` (**unchanged**) | **27 modified + 3 untracked files** |

**Yes — code changed substantially during the test run.** The working tree went from 1 modified file to 27 modified and 3 untracked files while testing (newest observed mtime `web-platform/tests/phylo_site.test.mjs` at `2026-11-24T21:57:02Z`). Notable changes included `web-platform/functions/api/ai/{planner.js,registry.js,registry.tools.generated.js,_lib.js}`, `web-platform/public/{ai.html,js/ai-workspace.js}`, `web-platform/tests/{ai_contract.test.mjs,phylo_site.test.mjs}`, `python-engine/src/smartbio/plugins/phylogenetics.py`, `python-engine/src/smartbio/aiagent/plugin_discovery.py`, and new files `python-engine/src/smartbio/aiagent/plugin_references.py`, `web-platform/migrations/0004_blast_consent_unique.sql`, `web-platform/tests/phylo_site.test.mjs`.

**Consequence:** HEAD never moved, but every **final** count in this report is against the **final uncommitted working tree**, not against committed HEAD. Initial counts are recorded alongside final counts to make the drift visible.

---

## 3. PASS/FAIL summary

| # | Check (primary = website) | Exact command | Result |
|---|---|---|---|
| W1 | Website suite, **final** (incl. phylogenetics site integration) | `npm test` (cwd `web-platform`) | **PASS — 144 tests, 144 pass, 0 fail, 0 skipped, 0 todo, exit 0** |
| W1a | Website suite, initial (before concurrent fixes) | `npm test` (cwd `web-platform`) | PASS — 136 pass, 0 fail |
| W2 | New phylogenetics website tests | exercised by W1 (6 named tests in `tests/phylo_site.test.mjs`) | **PASS — 6/6, none skipped** |
| W3 | Website pipeline request→plan→approve→job→result→run→report→provenance | `node D:\DevCache\Temp\opencode\site_pipeline_evidence.mjs` | **PASS — 3/3 pipelines (phylo real, legacy real, phylo mock)** |
| W4 | Real vs mock labelling on website | same as W3 | **PASS — real badge `class="badge"`/`Execution mode: real`; mock badge `class="badge mock"`/`Execution mode: mock`; mock validation `warn` + flag** |
| W5 | Original plugins still present/working alongside new one | W1 + W3 + registry dump | **PASS — original 4 tools present; `sequence-stats.profile` full pipeline pass** |
| S1 | Python suite, final | `python -m pytest -q` (cwd `python-engine`, `PYTHONPATH=.\src`) | PASS — **231 passed**, exit 0 |
| S1a | Python suite, initial | same | PASS — 220 passed |
| S2 | Plugin compliance gate, final | `python scripts/check_plugins.py` (repo root, `PYTHONPATH=python-engine\src`) | **PASS — "PLUGIN COMPLIANCE OK", exit 0** |
| S3 | Generated registry freshness, final | `python scripts/generate_plugin_registry.py --check` | PASS — "registry is current", exit 0 |
| S4 | Independent verifier | `python D:\DevCache\Temp\opencode\audit_verify.py <repo_root>` | **PASS — TOTAL 26/26, exit 0** (also 26/26 on the pre-fix tree) |
| X1 | Offline `--job-file` CLI demo | — | **OUT OF SCOPE** (historical note §7.1) |
| X2 | WSL/Linux cross-platform | — | **OUT OF SCOPE** (historical note §7.2) |

No blocking defect was found. No test failed in any final run.

---

## 4. Primary evidence — website

### 4.1 Final `npm test` (exact command and output)

```
cd ...\smart-bioinformatics-toolkit\web-platform
npm test
EXIT=0
...
✔ phylogenetics keywords classify cleanly without changing legacy intents (2.0814ms)
✔ a phylogenetics request produces one allowlisted, available, no-egress step (9.3294ms)
✔ unavailable phylogenetics tool returns a clarifying question and creates no plan or job (38.2308ms)
✔ website request → approve → real result → run/report/provenance returns phylo artifacts (28.8731ms)
✔ website exposes a phylogenetics preset and generic artifact rendering without inline scripts (0.8691ms)
...
ℹ tests 144
ℹ suites 0
ℹ pass 144
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 372.7816
```

The initial run earlier in the session, before the concurrent fixes landed, was **136 pass / 0 fail**. The +8 delta is accounted for by the new `phylo_site.test.mjs` (6 tests) plus added cases in `ai_contract.test.mjs` / `blast_lib.test.mjs` / `blast_submit.test.mjs`. **Critically, `skipped 0` proves the phylogenetics tests actually executed** — their `t.skip()` branches for an unregistered composite tool did not trigger.

### 4.2 Review of the resulting website tests

`web-platform/tests/phylo_site.test.mjs` (new, 282 lines, 6 tests) asserts:

1. `classifyIntent()` maps "build a phylogenetic tree…" / "evolutionary tree and clades" → `phylogenetics` with confidence ≥ 0.5, while `"profile my FASTA"` → `validate_and_profile`, `"identify taxa from BLAST hits"` → `identify_taxa`, and vague text → clarification. **Legacy intents are asserted unchanged.**
2. A phylo request yields exactly one plan step: `tool_id=phylogenetics.workflow`, `backend=local-python`, `params={sequence_type:"dna"}`, `external_egress=false`, `consent_required=false`, empty `external_services`/`consents_required`, and `validatePlan(plan).valid === true`. Plan limitations must mention research-use-only, heuristic, neighbor-joining and non-publication-grade.
3. The unavailable branch is exercised by temporarily removing the composite tool from `TOOLS`: `buildPlan` returns `null` plan plus `"Phylogenetic analysis is not available on this deployment."`, the request returns **422**, and **no plan or job rows** are created.
4. Full website flow: request → approve → authenticated poll → submit real result → `GET /api/ai/runs/:id` → `/report` → `/provenance`; asserts run `execution_mode="real"`, validation `pass`, the 4 phylo artifact names, report contains `Reproducibility`, `Limitations`, `phylogenetics.workflow`, and **no `<script>`**, provenance `tool.id=phylogenetics.workflow` and `execution_mode=real`.
5. Generic `validateParams` rejection of unknown params for every tool with `additionalProperties:false` (non-hardcoded schema-driven checks).
6. UI preset: `ai.html` contains `id="phylo-example"` and the preset text, no `onclick=`; `ai-workspace.js` uses generic `artifact.name`/`replaceChildren` rendering and branches on `plan.intent === "phylogenetics"`.

Changed existing tests (`ai_contract.test.mjs`, `blast_lib.test.mjs`, `blast_submit.test.mjs`, `helpers/fake-d1.mjs`) add migration `0004_blast_consent_unique.sql`, unique-index/concurrency assertions and result-shape checks; all pass.

Implementation review confirms the wiring is real, not test-only:
- `functions/api/ai/planner.js`: `KEYWORDS.phylogenetics`, `TOOL_BY_INTENT.phylogenetics = "phylogenetics.workflow"`, `DOMAIN_BY_INTENT.phylogenetics = "phylogenetics"`, a phylo-specific clarification message, four phylogenetics-specific plan limitations, and a guard that only selects a **registered, `available === true`** tool.
- `functions/api/ai/registry.tools.generated.js`: `phylogenetics.workflow` present, `available: true`, `external_egress: false`, `estimated_seconds: 22`, 8 declared required outputs, 3 verified references, 5 limitations. `registry.js` re-exports the generated list (no hand-maintained divergence).

### 4.3 Website pipeline evidence (handler-level, exact output)

Command: `node D:\DevCache\Temp\opencode\site_pipeline_evidence.mjs` — drives the **real production handlers** under `web-platform/functions/api/ai/` against the project's own fake-D1 helper. The submitted "agent result" payloads are **fixtures shaped like the agent contract** (this is the same technique the project's own tests use); they are not a live Biopython computation.

Registry dump: 9 tools advertised. `phylogenetics.{validate,align,tree,report,workflow}` all `available:true`, `egress:false`; `sequence-stats.{validate,profile}` `available:true`; `microbiome-16s.{blast-parse,taxonomy}` `available:false` **by design** (TSV/local-DB requirements — availability governs planner selection, not adapter executability, per orchestrator clarification).

```
===== PIPELINE: phylogenetics.workflow (real) =====
1) REQUEST  status=200 intent=phylogenetics domain=phylogenetics advertised_execution_mode=real plan_valid=true
   step={"id":"step_1","tool_id":"phylogenetics.workflow","backend":"local-python",
         "params":{"sequence_type":"dna"},"inputs":["dataset:ds_26e3e8aac0e1ce48"],
         "external_egress":false,"consent_required":false,"estimated_seconds":22}
2) APPROVAL status=200 job_ids=["job_afee1949a58bd99b"]
3) JOB POLL status=200 job.tool_id=phylogenetics.workflow job.status=running egress=false
   inputs.fasta_text=true params={"sequence_type":"dna"}
4) RESULT SUBMIT status=200 reported_mode=real result_status=succeeded
   report_url=/api/ai/runs/job_afee1949a58bd99b/report
5) RUN mode=real validation=pass flags=[] artifacts=["alignment.fasta","phylo_report.html","tree.nwk","tree.svg"]
   explanation_summary="Real local pipeline output."
6) REPORT status=200 mentions_tool=true has_Reproducibility=true has_Limitations=true
   inline_script=false mode_badge="class=\"badge\">Execution mode: real"
7) PROVENANCE tool=phylogenetics.workflow mode=real
   artifact_names=["alignment.fasta","tree.nwk","tree.svg","phylo_report.html"]

===== PIPELINE: sequence-stats.profile (real, original plugin still works) =====
1) REQUEST  status=200 intent=validate_and_profile domain=sequence-analysis
   advertised_execution_mode=real plan_valid=true
2) APPROVAL status=200 job_ids=["job_aa9fcb779b06986e"]
3) JOB POLL status=200 job.tool_id=sequence-stats.profile ...
4) RESULT SUBMIT status=200 reported_mode=real result_status=succeeded
5) RUN mode=real validation=pass flags=[] artifacts=["analysis.json"]
6) REPORT mode_badge="class=\"badge\">Execution mode: real"
7) PROVENANCE tool=sequence-stats.profile mode=real

===== PIPELINE: phylogenetics.workflow (operator mock mode) =====
1) REQUEST  status=200 intent=phylogenetics ... advertised_execution_mode=mock plan_valid=true
4) RESULT SUBMIT status=200 reported_mode=mock result_status=succeeded
5) RUN mode=mock validation=warn
   flags=["Results were produced in mock mode; not valid for scientific conclusions."]
6) REPORT mode_badge="class=\"badge mock\">Execution mode: mock"
7) PROVENANCE tool=phylogenetics.workflow mode=mock
```

This is direct evidence for every requested website stage: request→plan (validated plan, correct allowlisted step), approval (one job), job poll (FASTA carried verbatim, no egress/consent), result (hash-verified, `execution_mode` accepted), explanation (returned in run), report (HTML with reproducibility/limitations, no inline scripts), provenance (tool id and mode cross-checked).

### 4.4 Real vs mock — exact discriminator

| Scenario | `execution_mode` on request/run/provenance | Validation | Report badge |
|---|---|---|---|
| Phylogenetics, real | `real` / `real` / `real` | `pass`, `flags=[]` | `class="badge"` → `Execution mode: real` |
| Original `sequence-stats.profile`, real | `real` / `real` / `real` | `pass`, `flags=[]` | `class="badge"` → `Execution mode: real` |
| Phylogenetics, operator `AI_EXECUTION_MODE=mock` | `mock` / `mock` / `mock` | `warn` + `"Results were produced in mock mode; not valid for scientific conclusions."` | `class="badge mock"` → `Execution mode: mock` |

Note: a naive `/mock/i` search over the report HTML is a **false positive**, because the stylesheet contains `.badge.mock`. The correct discriminator is the mode badge shown above; this was verified by reading `functions/api/ai/runs/[id]/report.js` lines 64 and 71. This was a bug in my evidence script, not in the product, and was corrected before collecting the final evidence.

---

## 5. Supporting evidence (Python-side / audit) — not the main deliverable

### 5.1 Exact commands and results

```
cd ...\python-engine
$env:PYTHONPATH = '.\src'
python -m pytest -q
# initial: 220 passed in 11.29s
# final:   231 passed in 11.17s   (exit 0)

cd ..   # repo root
$env:PYTHONPATH = 'python-engine\src'
python scripts/check_plugins.py
# PLUGIN COMPLIANCE OK ... exit 0
python scripts/generate_plugin_registry.py --check
# registry is current: ...\web-platform\functions\api\ai\registry.tools.generated.js  (exit 0)

python D:\DevCache\Temp\opencode\audit_verify.py <repo_root>
# TOTAL 26/26 passed (exit 0) — before and after the concurrent fixes
```

Compliance detail (final): manifests schema-valid; adapters/entrypoints/contracts valid; references/limitations present with claims supported; requirements satisfiable for every available tool; **available adapters declare `required_artifacts`**; generated registry current; template compliant skeleton.

### 5.2 Independent verifier — 26/26 assertion names

`L1` provider None when unset · `L2` provider None when key missing · `A1` status succeeded · `A2` execution_mode real · `A3` validation pass · `A4` required artifacts · `A5` findings ≥ 3 · `A6` grounded findings ≥ 3 · `H1` every artifact sha256 recomputes · `H2` provenance output hash reconstructs · `H3` provenance input hash matches FASTA · `H4` provenance tool id/backend · `H5` provenance artifact list complete · `N1` fabricated number rejected · `N2` wrong-field number rejected · `P1` outage still succeeds · `P2` outage still real · `P3` outage flagged · `P4` no `llm_used` metadata · `P5` outage findings identical to offline · `P6` outage scientific artifact hashes identical · `P7` outage report differs only by flag banner · `M1` mock mode labelled · `M2` mock validation downgraded · `M3` mock flag surfaced · `M4` mock report labelled.

### 5.3 Scientific validation of the real composite tool

Command: `python D:\DevCache\Temp\opencode\check_workflow_outputs.py` (uses `process_job` with `shared/test-cases/phylo_reference.fasta`):

```
plugin discovered: True version: 1.0.0
status: succeeded execution_mode: real validation: pass
artifact count: 9
artifacts: ["phylo_validation.json", "alignment.fasta", "alignment_summary.json",
            "tree.nwk", "tree.svg", "tree_stats.json", "phylo_report.json",
            "phylo_report.html", "report.html"]
```

This confirms the real `phylogenetics.workflow` adapter emits **all 8 manifest-declared outputs** plus the agent's own `report.html` (9 total). The website tests use a deliberately reduced 4-artifact fixture; that is a test simplification, not a product gap.

Explicit env-var scenario runs (`scenario_compare.py`, offline real FASTA job) also confirmed: provider outage with `AI_LLM_PROVIDER=ninerouter`, `NINEROUTER_API_KEY=fake`, `NINEROUTER_BASE_URL=http://127.0.0.1:9/v1` → `status=succeeded`, `mode=real`, validation `warn` with `llm_phrase_rejected`, grounded findings byte-identical to offline, the four scientific artifact hashes unchanged (`analysis.json 05bd5328…`, `statistics.csv a76c949c…`, `statistics.json 367001d1…`, `validation.json 94f4b0d4…`), and no `llm_used` metadata. Mock mode produced `mock` + `warn` + `mock_execution_mode` flag + "mock" in the report. (Retained as supporting context only.)

---

## 6. Scientific validation results (supporting)

- Offline real FASTA `sequence-stats.profile` job (historical, §7.1): `status=succeeded`, `execution_mode=real`, `validation=pass` with 7 checked rules and no flags, exactly 5 artifacts, **12/12 independent assertions passed** including all artifact SHA-256 recomputations, provenance output-hash reconstruction, input-hash equality with the FASTA, and **4 evidence-grounded findings** (2 valid records / 50.0% mean GC over canonical bases / 43 nucleotides total / 2 analyzed records).
- Fabrication resistance: the independent verifier's `N1`/`N2` prove a fabricated `999.9` value and a wrong-field `43` value are both rejected by `check_explanation`.
- Phylogenetics reproducibility: `python scripts/run_phylogenetics_demo.py` twice (two separate output dirs) → both exit 0, `deterministic: true` in both, and `artifact_hashes.json` **byte-identical** across invocations; input FASTA SHA-256 `7066b1f805ba2c94184c17a2d30ecdf8a5caf7082ca16e653063ed9cd350c2a1`; 120 alignment columns, 92 conserved sites, 0 gaps, 6 tree tips. (Historical, §7.1.)

---

## 7. Historical notes — explicitly OUT OF SCOPE

### 7.1 Offline `--job-file` CLI demo and terminal scripts — OUT OF SCOPE

Run before the direction change and retained only for completeness:

- `python -m smartbio.aiagent.agent --job-file ... --out-file ...` (`PYTHONPATH=.\src`): `{"job_id": "job_m5_profile", "status": "succeeded", ...}`, exit 0; `verify_result.py` → 12/12 PASS. Artifact hashes: `validation.json 94f4b0d4…`, `statistics.json 367001d1…`, `analysis.json 05bd5328…`, `statistics.csv a76c949c…`, `report.html 0c3122e5…`. Provenance timestamps lived in `provenance.timing`, which would legitimately differ across runs.
- All-plugins-together `process_job` run: 7/7 tools `succeeded` / `real` / validation `pass` / matching provenance tool id, backend and input hash — `sequence-stats.validate`, `sequence-stats.profile`, `microbiome-16s.taxonomy` (with `shared/test-cases/blast_sample.tsv`), and all four phylogenetics tools (with `shared/test-cases/phylo_reference.fasta`). Per semantics clarification, the `available:false` status of the two microbiome tools governs planner selection only; their direct execution with a supplied TSV is expected to succeed.
- Phylogenetics demo determinism: see §6.

**These are not part of the primary validation and are not used to claim website success.**

### 7.2 WSL/Linux cross-platform verification — OUT OF SCOPE, with precise blocker evidence

Attempted and stopped; **no product defect implied**. Evidence:

1. WSL works: `CANARY_WSL_OK`, Python `3.12.16` at `/usr/bin/python3`, D: mounted with 529.8G free at `/mnt/host/d`.
2. `pip install --target .../wslsite biopython==1.88 pytest jsonschema numpy pandas` initially failed with `[Errno 28] No space left on device: '/root/.cache/pip/wheels'`. Redirecting `TMPDIR`/`TEMP`/`TMP`/`PIP_CACHE_DIR` to `/mnt/host/d/...` fixed the space issue but exposed `[Errno 2] No such file or directory: 'cc'` — Biopython 1.88 declares PEP-517 `ext-modules` and requires a C compiler.
3. `apk add --no-cache build-base` in the WSL root failed: `ERROR: make-4.4.1-r3: failed to extract usr/bin/make: No space left on device` and `System state may be inconsistent: failed to write database: No space left on device`.
4. Workaround: installed `build-base` and `python3-dev` into a D: sysroot via `apk --root /mnt/host/d/DevCache/Temp/opencode/wslapkroot …` (gcc 15.2.0, Python.h 3.12.16) and successfully built `biopython-1.88-cp312-cp312-linux_x86_64.whl`, installing it into `wslsite`.
5. Final blocker before the direction change: importing `Bio.Align` failed with `Bio.MissingPythonDependencyError: Please install NumPy if you want to use Bio.Align` — the earlier failed bulk install had left `wslsite` without numpy. The remaining step was to install numpy into `wslsite` and re-run, but the direction change explicitly instructed stopping this line of work.

Therefore **no Linux result, no cross-platform hash comparison and no Linux phylogenetics test result is claimed in this report.**

---

## 8. Outstanding limitations and risks

1. **Website tests use fixture agent results, not a live agent round-trip.** The website is a control plane and does not execute tools; `phylo_site.test.mjs` and my evidence script submit hand-crafted contract-shaped results. The real scientific computation is covered by the Python-side suites and the composite-plugin check (§5.3), not by an end-to-end browser→agent→worker→D1 run.
2. **Reduced artifact set in the website phylo fixture.** Tests submit 4 artifacts while `phylogenetics.workflow` declares 8 required outputs. `validateResultShape()` checks shape, hash consistency, `run_id` and `provenance.tool.id` against the job, but it does **not** cross-check submitted artifacts against `output_schema.required`. The real adapter does emit all 8 (§5.3), so this is a test-coverage gap rather than a demonstrated product defect; consider adding a contract test that submits an incomplete phylo result and asserts rejection.
3. **No live browser automation.** UI evidence is static assertions on `ai.html` / `ai-workspace.js` plus handler-level tests; no real DOM interaction was performed.
4. **Concurrent uncommitted changes.** All final results apply to the uncommitted working tree at 2026-11-24T21:59:23Z with HEAD `ef7de3e9…`. A subsequent commit/rebase or further edits require re-running `npm test` (and ideally `pytest`, `check_plugins.py` and the audit verifier) to keep this report valid.
5. **Cross-platform evidence absent by instruction** (§7.2); determinism was verified on Windows only.
6. **Dashboard command absent** (`D:\Apps\Star-Office-UI\office-status.cmd`); status updates could not be posted.

---

## 9. Bottom line

The **website phylogenetics integration passes**: final `npm test` is **144/144 with zero skips**, the six new `phylo_site.test.mjs` tests execute and pass, the handler-level evidence demonstrates the full request→plan→approval→job→result→explanation→report→provenance chain with correct real/mock labelling, and the original `sequence-stats.profile` flow still passes alongside the new composite tool. Supporting Python checks are green (231 pytest, plugin compliance OK, registry current, independent audit **26/26**). No blocking defect was found. The main residual risk is coverage depth (fixture-based website results and a 4-of-8 artifact phylo fixture), documented in §8.
