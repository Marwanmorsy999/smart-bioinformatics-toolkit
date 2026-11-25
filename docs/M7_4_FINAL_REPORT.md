# M7.4 — Unified Research Workspace final report

**Commit range:** `1b6f0ad1cfb97af43f98eab398c5b7c49cddcc13` → `1f1f93b3c50862b8a3584e86e204d36a0c7dbca0` (branch `phase-1-robustness-safety`). Work committed incrementally (design/migration/catalog/states, then APIs/UI/demo/tests).

**Design:** `docs/M7_4_WORKSPACE_DESIGN.md` — audit of current architecture, reusable modules, missing capabilities, proposed data model, API, authorization, plan.

**Implemented:**
- D1 migration `0011_workspace.sql`: `workspace_projects` (owner, name, description, objective, status, timestamps), `workspace_datasets` (project, filename, format, size, SHA-256, source, validation_state, provider_ref — metadata only), `workspace_runs` (project, workflow/version, objective, inputs, params, provider, mode, state, stages/artifacts/validation/provenance/error JSON, timestamps).
- Worker API `functions/api/workspace/index.js` routed as `/api/workspace/*`: projects list/create/detail/update/archive, dataset registry, run history, run detail, unified workflow catalog and clearly labelled demo. Project-scoped calls require the existing `X-Agent-Token` identity; `owner_id` is a token hash and cross-owner rows return 404.
- Unified catalog (`providers/workspace/catalog.js`): 16S identification (available, local) and phylogenetics MSA/tree (**blocked** — remote Galaxy execution pending credential rotation; not advertised as production-ready).
- Run state machine (`providers/workspace/states.js`): draft → planned → awaiting_approval → queued → running → execution_completed → artifact_retrieval → validation → succeeded, with failed/cancelled; stage summary never claims success from a partial stage.
- UI `public/workspace.html` + `js/workspace.js`: project list/detail, dataset metadata, catalog links into existing `blast.html`/`phylo.html`, run history/detail, labelled sample project; navigation added to index/blast/phylo pages. Scientific engines untouched.
- Demo endpoint/UI is explicitly labelled `SAMPLE / PRECOMPUTED — not a newly executed analysis`.

**Tests:** JS **424/424** (including 6 new workspace tests), Python **244/244**, Chromium workspace E2E **PASS** (stubbed workspace API — UI flow only, not a scientific execution), prior phylo browser E2E **PASS**. Screenshots: `web-platform/test-results/m7_4_workspace.png` and `m7_3_phylo_page.png`.

**Staging:** Worker `smart-bioinformatics-toolkit-staging`, `https://smart-bioinformatics-toolkit-staging.m-2396.workers.dev`; Version ID **`5c7ca78e-5b59-4722-b0b6-9c789c63311c`** built from HEAD `1f1f93b3c…`; `/workspace.html` verified loaded. Production untouched; smarts.bio/9Router disabled; no R2.

**Limitations:** no visitor account system exists (documented, not invented); D1 holds metadata only — no durable user-file storage; project APIs require the existing agent token; the deployed workspace catalog honestly marks phylogenetics remote execution blocked; live Galaxy execution, artifact recovery and browser E2E against a real cloud run remain out of scope for M7.4.
