# M7.4 — Unified Research Workspace — final report

**Status: complete within the stated scope.** This report records verified commits, tests, staging deployment and limitations. It does **not** claim multi-user authentication, durable user-file storage, live Galaxy execution, or production deployment.

## 1. Commit range

Branch `phase-1-robustness-safety`, from the starting HEAD
`1b6f0ad1cfb97af43f98eab398c5b7c49cddcc13` to final HEAD
`83de048849b6b803002219c49f5297dea8afd935` (11 commits, small and reviewable):

| Commit | Subject |
|---|---|
| `8bc6b8ffdeaa447fdeae5d02f47e026043aba7de` | feat(m7.4): workspace design and additive schema |
| `877701b51b1b5b4152f953741f8b4a1c0a993c85` | M7.4 Phase 0-3: workspace design, migration, catalog and run states |
| `1f1f93b3c50862b8a3584e86e204d36a0c7dbca0` | feat(m7.4): owner-scoped workspace APIs and shared catalog |
| `53eeb55cfeb5da441df2da3fe3ec1e21268c2579` | M7.4: add final report (superseded by this report) |
| `17214a5936c63d9652b1dfe936f7c7631f799024` | fix(m7.4): enforce project field caps and stable audit actions |
| `af06f676b4fcfa0e6a76c70239848d02ee62a046` | test(m7.4): workspace API owner, lifecycle and demo tests |
| `e1a523a84d6a531e345ac7fa1853ad424c0d1562` | fix(m7.4): reconcile duplicate catalog and catch-all shim |
| `90df75ec987adbcbe5f76b17867d67c62004c545` | feat(m7.4): unified local-first research workspace UI |
| `fdc3f2656aff5bac90d2cd7a15402e9a613ff39d` | test(m7.4): workspace E2E and catalog drift tests |
| `a257eafe72fe58054b8b863ed6fadd9566e026f7` | fix(m7.4): align mutation DTOs, provenance write and public surfaces |
| `83de048849b6b803002219c49f5297dea8afd935` | test(m7.4): stronger drift, provenance and audit verifications |

Two independently-produced workspace implementations landed in the same branch. They were reconciled at `e1a523a`: one authoritative catalog (`functions/api/workspace/catalog.js`), one state machine (`functions/api/workspace/_lib.js`), and compatibility shims in `providers/workspace/**`. No files were deleted.

## 2. Deliverables

- **Design:** `docs/M7_4_WORKSPACE_DESIGN.md` — audit, reusable modules, missing capabilities, data model, API, authorization, implementation plan, scope exclusions and honesty rules. `docs/SOURCE_CODE_MAP.md` and `SYSTEM_ARCHITECTURE.md` were updated with M7.4 status notes.
- **Migration:** `web-platform/migrations/0011_workspace.sql` — additive only. Extends existing `projects` (description, scientific objective, status, updated timestamp; `owner` already existed in `0002`) and `datasets` (format, source, validation state, provider history reference, owner, upload timestamp, `is_demo`); creates `workspace_runs` and `provenance_records`; adds owner/project/state indexes. Reports reuse `report_runs`, authorized through the parent run. **No R2.**
- **APIs:** `web-platform/functions/api/workspace/**` — project create/list/open/edit/archive/activate; owner-scoped metadata-only dataset registration; unified workflow catalog; unified draft run creation and strict 11-state lifecycle; run history/detail; provenance; report read; labelled demo. All routes registered in `worker.js` with specific paths before the compatibility catch-all.
- **UI:** `web-platform/public/workspace.html`, `public/js/workspace.js`, `public/js/project-context.js`, with minimal nav additions to the existing pages. Local-first by default; optional in-memory operator mode. Project overview, metadata registry, catalog, run-history table, run detail with separate execution/artifact-retrieval/validation statuses, and a visibly labelled sample project.
- **Demo:** fixed `precomputed` payload from `GET /api/workspace/demo` (operator mode) and an equivalent clearly-labelled local sample (default mode). Every object carries `sample`/`is_demo` labels and a disclaimer.
- **Tests:** `web-platform/tests/workspace_*.test.mjs`, `workspace.test.mjs`, `workspace.e2e.mjs` plus unchanged existing Python/JS/E2E suites.

## 3. Authorization model (as actually implemented)

There is **no visitor login and no per-user accounts**. The only authenticated identity is the platform's existing single operator token (`X-Agent-Token`, checked by `agentTokenError`/`requireOwner`). Every workspace API call derives a non-secret owner principal (`owner_` + first 16 hex of the token's SHA-256), stores it on rows, and pins it in every SQL read/write. Raw tokens are never stored, logged, audited or returned; the derived digest is no longer exposed in public DTOs. Missing/wrong token → 401; another owner's row → 404 with no existence leak. The browser UI defaults to local browser-session metadata so no token is required or persisted for normal exploration; operator mode holds the token only in memory.

## 4. Workflow catalog (one authoritative source)

| Workflow id | Availability | Production ready |
|---|---|---|
| `16s-rrna-identification` | `available-browser-and-local-agent` | yes (existing path; no new execution added) |
| `msa-phylogenetics` | `partial-not-production-ready` | no |

The phylo entry cites `docs/M7_3_PHYLOGENETICS_WORKFLOW_REPORT.md`: a real MAFFT step executed once, but full multi-step remote tree/retrieval/validation is unverified. No live Galaxy call and no new provider activation occurred in M7.4. Four surfaces (API handler, compatibility shim, provider shim, browser mirror) are drift-checked to expose identical ids and states.

## 5. Verified test results

| Check | Command | Result |
|---|---|---|
| JavaScript unit suite | `cd web-platform && npm test` | **505 passed, 0 failed** |
| Python suite | `cd python-engine && python -m pytest tests/ -q` | **244 passed** |
| Workspace browser E2E | `node tests/workspace.e2e.mjs` | **PASS** — local project → dataset metadata → workflow launch → planned run in history → run detail with distinct statuses → labelled sample; no console/page errors |
| Standalone phylo E2E (regression) | `node tests/phylo_page.e2e.mjs` | **PASS** |
| Migration chain in real SQLite | apply all `migrations/*.sql` to in-memory `sqlite3` | all applied; expected columns/tables present |
| Independent API behaviour checks | exported `handle*` + fake D1 | **26 passed** — 401 without/wrong token, cross-owner 404 (project/run/provenance/report), illegal transition 409, legal chain to `succeeded`, incomplete provenance 409, immutable `prov_*` record, demo labels |
| Catalog drift check | 4 surfaces compared per id | **PASS** |
| Review + independent testing | reviewer and tester subagents | no blocking issues; PASS with non-blocking notes, all addressed |

`npx wrangler d1 migrations apply --local` fails with a Wrangler 4.168.0 internal error on this Windows machine; the direct SQLite check above proves the SQL itself is valid. This is a tooling limitation, not a SQL failure.

## 6. Staging deployment

- Worker: `smart-bioinformatics-toolkit-staging`
- URL: `https://smart-bioinformatics-toolkit-staging.m-2396.workers.dev`
- **Version ID: `c7583812-c816-49a3-aeba-a08ccb871b7a`** (built from HEAD `83de0488…`)
- Migration `0011_workspace.sql` was applied to staging D1 directly with `wrangler d1 execute --remote` (earlier milestones applied migrations directly, so the D1 migration ledger is empty; replaying all migrations would fail on already-present columns). Staging columns verified: `projects.description`, `datasets.owner`, `workspace_runs.state`, `provenance_records.record_json` all present.

Live verification after deployment:

| Path | Result | Interpretation |
|---|---|---|
| `/` | 200 | static site served |
| `/workspace.html` | 307 → `/workspace` → 200 | standard Workers asset redirect; page renders |
| `/js/workspace.js` | 200 | `Content-Type: text/javascript`, `Cache-Control: no-store`, CSP present |
| `/phylo.html` | 307 → 200 | standalone workflow intact |
| `/api/tools`, `/api/ai/backend` | 200 | legacy API regression clean |
| `/api/workspace/workflows`, `/catalog`, `/demo` | 401 without token | owner authorization enforced |
| `/api/does-not-exist` | 404 JSON envelope | API fails closed; never serves HTML |

Production was not deployed. smarts.bio and 9Router remain disabled; Galaxy remains enabled in staging only, unchanged by this milestone. No secrets were changed.

## 7. Screenshots

- `web-platform/test-results/m7_4_workspace.png` — 132,233 bytes — workspace E2E (project, catalog, run history/detail, labelled sample).
- `web-platform/test-results/m7_3_phylo_page.png` — 35,141 bytes — standalone phylo regression.

## 8. Remaining limitations

1. **No multi-user authentication.** Owner scoping isolates token holders, not human users; the browser's default mode is local and not server-persisted. Per-user accounts remain a separate, explicitly excluded capability.
2. **No durable user-file storage.** D1 holds metadata only. Provider/history references are labels, not proof that bytes exist; no R2 was introduced; no public artifact URLs exist.
3. **Browser E2E covers local mode only.** Operator mode is verified at handler/unit and route level, but not through a live browser against a token-authenticated Worker. Staging verification above confirms 401 enforcement but does not exercise an authorized round trip (no token was available to the verification session).
4. **No scientific execution in M7.4.** "Workflow launch" records a planned/draft run marker. No 16S or Galaxy job was executed by this milestone; phylo remains `partial-not-production-ready`; no artifact recovery or cloud-run E2E was performed.
5. **Report generation for a unified run** is still read-only from existing `report_runs` rows; a missing report returns 404 rather than being fabricated.
6. **Tooling/environment notes:** the required `D:\Apps\Star-Office-UI\office-status.cmd` does not exist on this machine, so dashboard status updates could not be issued; Wrangler's local D1 migration command returns an internal error here (see §5). Unrelated concurrent M7.5 documentation files remain uncommitted and were deliberately left untouched.
