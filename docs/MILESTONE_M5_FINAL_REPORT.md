# Final Report — M4 Closeout and M5 Expansion

**Date:** 2026-11-25
**Scope:** M4 acceptance audit, architectural gap closure, M5 plugin framework, second domain plugin (phylogenetics), website integration, independent verification, GitHub publication.
**Verdict:** M4 audit **reconciled**; M5 **complete and independently verified**. No blocking defects remain.

> This report does **not** claim success from file creation or passing unit tests alone. Every claim below is tied to an executed command, an independent review, or a code path inspected by a separate agent.

---

## 1. M4 acceptance audit and reconciliations

### 1.1 Re-run of the reported evidence
- Historical suites re-run: `python -m pytest -q` → **173 passed**; `npm test` → **121 passed**, matching the FINAL section of `docs/discovery/TEST_REPORT.md`.
- The **41/41 independent assertions** in that report were inspected. They cover status/mode, five required artifacts, four field-grounded findings, hash recomputation, provenance input/output hashes, negative fabrication gates, 9Router opt-in with zero network calls, and report hygiene.
- An independent verifier (`audit_verify.py`, temp-only) re-executed 26 checks against the final tree: **26/26 PASS** — real execution, artifact SHA-256 recomputation, provenance reconstruction, cited-field number grounding, fabricated/wrong-field number rejection, provider-outage determinism, and mock/real labelling.

### 1.2 End-to-end pipeline
Verified by code inspection and by the independent tester's website-pipeline harness: request → preflight → plan → approval → job → agent result → validation → evidence-bounded explanation → HTML/JSON report → provenance. The legacy 41-assertion run and the new website harness both produced real artifacts with a `real` execution label.

### 1.3 Findings that required remediation
| Finding | Evidence | Resolution |
|---|---|---|
| Legacy `/api/blast/submit` transmitted FASTA with no consent gate (`submit.js:63-64`) | Code read; `API_INTEGRATION_ROADMAP.md:29` | Fail-closed, hash/db/program-bound, single-use `consent_token`; typed 403 classes; token claimed atomically *before* egress and burned on failure |
| Concurrent approvals could mint two tokens for one plan | Independent security review | Unique indexes on `(plan_id, step_id)` (migration `0004`); job claimed before token issuance; concurrent loser gets existing jobs and no token |
| Egress was not audited although docs claimed it was | Independent security review | `auditBlastEgress` writes actor/hash/db/program/byte counts before NCBI call and finalises success/failure; never logs sequence |
| Token generation fell back to `Math.random()` | Independent security review | Web Crypto required; typed 503 `crypto_unavailable` otherwise |
| Plugin adapters marked `available:false` were still executable while docs claimed otherwise | Independent security + contract review | Formal distinction: **registered** (valid adapter, directly executable) vs **available** (planner-selectable, requirements satisfied); documented explicitly and reported by `is_available()` |

### 1.4 Documentation reconciliation
- `API_INTEGRATION_ROADMAP.md` now separates IMPLEMENTED / PARTIAL / GAP and no longer marks CATALOG-ONLY services as available. Open gaps remain: RID TTL, global submit rate limit, `tool`/`email` identification, and the evidence-ledger disagreement.
- Outdated audit/review reports were **retained verbatim** with a `HISTORICAL — superseded` header and a dated reconciliation note. No findings were deleted.
- `SYSTEM_ARCHITECTURE.md` corrected to D1-only storage (no R2 binding), Worker→NCBI egress, and the LLM adapter's actual usage.

---

## 2. Dataset transport and data-flow controls

Documented in `docs/DATA_TRANSPORT.md`. Four distinct paths:

| Path | What moves | Consent | Validation | Provenance | Storage |
|---|---|---|---|---|---|
| Browser-local | File → in-memory text | None; nothing leaves the browser | Client/server FASTA preflight | Dataset SHA-256 | Browser memory |
| Cloud-stored artifacts | Inline artifacts + report HTML | No egress consent needed | SHA-256 recheck at result submission | `tool_runs`/`artifacts` rows | **D1** (`d1://…`), no R2 today |
| Local execution | Job inputs inline (≤64 KiB) → agent temp workspace | Approval required to create a job | Schema checks + agent token | Provenance record per job | D1 job row + temp dir |
| External scientific API | Validated FASTA to NCBI `CMD=Put` only | **Required**, single-use token | Hash/db/program binding + atomic claim | `blast_consents` + egress audit | RID/cached TSV in D1 |

**No local dataset is silently uploaded to Cloudflare R2** — no R2 binding is referenced anywhere in the submission or result path.

---

## 3. M5 deliverables

- `docs/plugins/PLUGIN_AUTHORING.md` — manifest fields, contracts, references/limitations, availability semantics, discovery, trusted-directory rule, compliance checklist, and the planner-exposure limitation.
- `docs/plugins/template/` — valid, importable skeleton manifest + adapter + README + test; intentionally `available:false`.
- Strict v2 manifest schema (`shared/schemas/plugin.schema.json`) with per-tool `references`, `limitations`, `requirements`, input/output/params contracts.
- Fail-closed auto-discovery (`aiagent/plugin_discovery.py`, `plugin_references.py`): schema → reference ledger → requirement check → import → TOOL_ID/contract validation; duplicates rejected; untrusted manifest directories rejected.
- Shared, generic control-plane seams: `required_artifacts` (validation fails closed) and `evidence_hints` (field-grounded findings). Neither is plugin-specific.
- Worker registry generated from manifests (`scripts/generate_plugin_registry.py`, `registry.tools.generated.js`), checked by `--check`.
- CI gate `scripts/check_plugins.py` wired into `.github/workflows/tests.yml`.
- Website integration: generic schema-driven `validateParams`, a `phylogenetics` planner intent that selects `phylogenetics.workflow` from the allowlist, a visible Phylogenetics preset, and generic artifact listing/downloads.

---

## 4. Second domain plugin — phylogenetics

- **Real libraries, no synthetic results:** `Bio.Align.PairwiseAligner` for progressive MSA with a real guide tree, `Bio.Phylo.TreeConstruction.DistanceCalculator("identity")` + `DistanceTreeConstructor.nj()` for the tree, `Bio.Phylo`/`AlignIO` for I/O. Licensing/cross-platform evaluation in `docs/plugins/PHYLOGENETICS_TOOLING.md`.
- **Five tool IDs:** `phylogenetics.validate`, `.align`, `.tree`, `.report`, and composite `.workflow` (runs all four in one job so the website needs no step chaining).
- **Known answers independently recomputed by the scientific reviewer:** 6 × 120 bp reference alignment, **92 conserved sites**, 0 gaps, NJ split `{A1,A2,A3} | {B1,B2,B3}`, six exact tip names, non-negative branch lengths. Eight byte-stable artifact hashes documented in `docs/plugins/PHYLOGENETICS_DEMO.md`.
- **Citations** (Cock 2009 Biopython, Saitou & Nei 1987 NJ, Thompson 1994 CLUSTAL W) were checked against Crossref by the independent reviewer.
- **Registered without control-plane changes:** the commit that added the plugin touched only plugin/manifest/fixture/test/doc files; generic seams were already present in the framework commit. Website exposure was then added separately by the site-integration work.

---

## 5. Actual test counts and execution modes

| Check | Count / result |
|---|---|
| Python `pytest -q` (final tree) | **231 passed** |
| JavaScript `npm test` (final tree) | **144 passed, 0 failed, 0 skipped** |
| Plugin compliance `check_plugins.py` | **OK** (7 checks) |
| Generated registry `--check` | **current** |
| Independent audit verifier | **26/26 PASS** |
| Independent website pipelines | **3/3 PASS** (phylo real, legacy real, phylo mock) |
| Historical M4 baseline (re-run before new work) | 173 Python + 121 JS |

**Real vs mocked execution is distinguishable** at six layers: Python validation rule, Worker result-shape check, operator override, persisted job/report metadata, HTML badge (`badge` vs `badge mock`), and report limitation text. Mock mode never downgrades to a clean `pass`.

**Provider outage:** with a configured-but-unreachable 9Router endpoint, `process_job` still succeeds in `real` mode, scientific artifact hashes are byte-identical to the offline run, no `llm_used` metadata appears, and a `llm_phrase_rejected` flag is raised. Only the report banner changes.

---

## 6. Independent verification (Part 5)

Five roles were used; implementers did not approve their own work:
1. **Implementation agents** (three, plus one website agent) — implementation only.
2. **Scientific reviewer** — recomputed scientific claims; **PASS WITH NOTES**, no blockers.
3. **Security reviewer** — adversarial trace of consent, egress, plugin loading, LLM; **PASS WITH NOTES**, no blockers; MEDIUM findings fixed.
4. **Plugin contract reviewer** — proactive fail-closed probes; **PASS WITH NOTES**, no blockers; HIGH doc accuracy and MEDIUM CI findings fixed/documented.
5. **Independent integration tester** — **PASS**, report in `docs/discovery/TEST_REPORT_M5.md`.

Original plugins and the new plugin were exercised together; all original four registry entries remain and `sequence-stats.profile` still completes a full website pipeline.

---

## 7. Outstanding limitations

- **Live execution requires a running local agent.** Plan and approval are fully browser-driven, but job execution is performed by the local execution agent polling the Worker. Per the user's direction, offline CLI demos and terminal/Linux cross-platform verification were removed from scope; no live-browser (Playwright) run against a deployed Worker was performed — UI evidence is static Node contract assertions plus the website-pipeline harness.
- **Live deployment is not configured.** `web-platform/wrangler.toml` still has `database_id = "REPLACE_WITH_D1_DATABASE_ID"`; no project D1 database exists in the authenticated Cloudflare account. Deployment prerequisites: create D1, apply migrations 0001–0004, set the binding ID, configure secrets, and run an execution agent.
- **Planner exposure.** The generic plugin framework registers and executes new domains without control-plane edits; exposing a new domain in the NL planner/UI required the planner change delivered in this milestone and is documented as separate work for future domains.
- **Result-shape enforcement.** `validateResultShape()` verifies artifact hashes, `run_id` and `tool.id` but does not cross-check `output_schema.required` against submitted artifact names. Real adapters emit all declared artifacts; test fixtures intentionally submit minimal sets. Enforcing this would require updating those fixtures and is deferred.
- **Other known gaps:** RID TTL and global submit rate limit; `tool`/`email` identification for NCBI; evidence-ledger disagreement on BLAST verification; reference claims verified by a curated CI ledger rather than a live metadata lookup; `bipartitions` field includes the all-tips clade (cladogram-style SVG, not to scale); MSA is heuristic with identity-distance NJ.
- `D:\Apps\Star-Office-UI\office-status.cmd` is absent on this host, so mandated dashboard updates could not be applied (environmental only).

---

## 8. Documentation updated

`IMPLEMENTATION_ROADMAP.md` (M4 audit + M5 completion), `docs/IMPLEMENTATION_LOG.md`, `README.md`, `SYSTEM_ARCHITECTURE.md`, `API_INTEGRATION_ROADMAP.md`, `docs/DATA_TRANSPORT.md`, `docs/DEMO_SCRIPT.md` (browser-only phylogenetics section), `docs/plugins/**`, `docs/discovery/TEST_REPORT_M5.md`, and this report. Historical audit findings were preserved with status headers.

---

## 9. Recommended next milestone (M6)

1. **Make the website self-contained for real execution** — decide and document the supported execution topology (local agent service installer, or an approved remote compute adapter). This is the single largest blocker to a no-terminal website experience.
2. **Provision Cloudflare D1 and deploy** — create the database, apply migrations 0001–0004, fill `wrangler.toml`, deploy, and record the live URL in the evidence ledger.
3. **Enforce `output_schema.required` at result submission** with updated fixtures, so an incomplete result cannot be marked succeeded.
4. **Add live browser E2E (Playwright)** against the deployed site, including the phylogenetics preset and tree rendering.
5. Complete the two M6 differentiators already specified but unimplemented: locality receipt in provenance (FR-8.5) and education mode (FR-8.6).
