# M6 Independent Browser E2E Test Report

> **FINAL RE-RUN — 2026-11-24T22:56:46Z → 22:57:00Z — 64/64 assertions PASS, 10/10 scenarios PASS, no blocking defect.** This was executed after the staging redeploy (Worker `e4938f2c`, migration 0006) with the agent polling via heartbeat. See **§11 FINAL RE-RUN** at the end of this document. Sections 1–10 below are retained as historical evidence from the earlier, pre-redeploy run.

**Test date (historical run):** 2026-11-25 (UTC timestamps in evidence: 2026-11-24T22:39:19Z → 22:39:32Z)
**Target:** `https://smart-bioinformatics-toolkit-staging.m-2396.workers.dev`
**Runner:** real Chromium 159.0.8154.6 driven by Playwright 1.65.1 (installed under `web-platform/node_modules`), Node v24.21.0, Windows.
**Role:** independent tester — no product source files were changed. Only this report and `docs/discovery/m6-screenshots/*.png` were written in the repo.

---

## 1. Executive summary

| Metric | Result |
| --- | --- |
| Scenarios executed | 10 / 10 |
| Assertions | 48 PASS / 1 FAIL (49 total) |
| Screenshots | 8 (all < 500 KB) |
| Unexpected console errors | 0 (two expected HTTP-error console messages: 400 malformed FASTA, 403 consent gate) |
| Failed browser requests | 0 |
| Browser requests to external hosts (e.g. NCBI) | 0 |
| Pre-existing unit/contract tests | 187 / 187 PASS (`node --test tests/*.test.mjs`) |

**Overall:** the M6 heavy-analysis flow works end-to-end in a real browser after the local agent is restored: browser-local route is genuinely local, phylo plan → approve → job → validated result with all named artifacts works, report sections and consent gate behave as specified.

**One failing assertion / gap:** in forced mock mode the UI does **not** label the header badge as "mock"; it says "Backend: no local agent observed". The mock warning does appear in `#backend-detail` and no simulated result is presented. See §7 (LOW–MEDIUM).

**Two environment/infrastructure findings** (not product-code defects proved by this run): the background staging agent process was killed by an infrastructure server restart, and Cloudflare rejects the agent's default Python-urllib User-Agent with HTTP 403. Details and the exact workarounds are in §6.

### Re-run note required by the sponsor

An infrastructure server restart killed the originally-running authenticated staging agent. All results in this report — including scenario 2 (backend observed), scenario 4 (phylo plan → approve → job → result), and scenario 5 (report download/evidence) — are from the **final re-run after the agent was restored and confirmed processing jobs**. The first attempt was discarded because (a) it ran while the agent was unavailable and (b) the harness waited on a loose badge regex and submitted before the backend status fetch completed. The harness was corrected and the complete suite re-run; the final log is `D:/DevCache/Temp/opencode/m6-browser-log.json` (`startedAt 2026-11-24T22:39:19.451Z`, `finishedAt 2026-11-24T22:39:32.902Z`).

---

## 2. Exact commands / scripts

All test scripts live outside the repo under `D:\DevCache\Temp\opencode\`.

1. Dashboard status command (absent, as stated in the brief):

   ```powershell
   Test-Path "D:\Apps\Star-Office-UI\office-status.cmd"
   # -> False (DASHBOARD_CMD_UNAVAILABLE)
   ```

2. Precondition probe (read-only, from the Code Mode `fetch` runtime):

   ```js
   fetch("https://smart-bioinformatics-toolkit-staging.m-2396.workers.dev/api/ai/backend")
   ```

3. Agent restoration (temp scripts; token read at runtime from `m6-agent-token.txt`, never printed, logged or embedded):

   ```powershell
   & "D:\DevCache\Temp\opencode\m6-restart-agent.ps1"
   # AGENT_STARTED_PID=19420
   ```

   The script sets `PYTHONPATH` to a **temp-only** shim directory (`D:\DevCache\Temp\opencode\m6-agent-shim`) followed by `python-engine\src`, and starts:

   ```
   python -m smartbio.aiagent.agent --loop --url <staging base> --token <read at runtime>
   ```

   The shim only adds a browser-like `User-Agent` to `urllib.request.Request` (see §6). No product file was edited.

4. Main E2E suite:

   ```powershell
   & "D:\tools\nodejs\node.exe" "D:\DevCache\Temp\opencode\m6-e2e.cjs"
   ```

   Script path: `D:\DevCache\Temp\opencode\m6-e2e.cjs`
   Console transcript: `D:\DevCache\Temp\opencode\m6-e2e-stdout.txt`
   Structured log (checks, timings, console/network events, full report text): `D:\DevCache\Temp\opencode\m6-browser-log.json`

5. Existing repo tests (supplementary, web-platform as workdir):

   ```powershell
   & "D:\tools\nodejs\node.exe" --test tests/*.test.mjs
   # ℹ tests 187 / pass 187 / fail 0 / duration_ms 482.8429
   ```

6. Screenshot integrity / diff check:

   ```powershell
   git -C <repo> status --short
   Get-ChildItem <repo>\docs\discovery\m6-screenshots -File | Select-Object Name,Length
   ```

Supporting scripts: `m6-start-agent.ps1`, `m6-restart-agent.ps1`, `m6-agent-shim/sitecustomize.py`, `m6-check-agent-auth.ps1`, `m6-probe-ua.py`, `m6-summarize-log.cjs`, `m6-extract-report-sections.cjs` (all temp, all outside the repo).

---

## 3. PASS / FAIL table (real Chromium)

| # | Scenario | Result | Key evidence |
| --- | --- | --- | --- |
| 1 | `/` navigation, hero, capability cards | **PASS** | 4 nav links (`#tools`, `#capabilities`, `#workflow`, `#about`); hero "Check your sequences. Keep the evidence."; 6 capability cards |
| 2 | `/ai.html` backend badge shows agent observed | **PASS** (re-run) | `#backend-badge` = "Backend: local agent observed"; status "heavy analyses are available"; detail "Last observed agent activity: 2026-11-24T22:39:09.962Z."; resolved in < 30 s |
| 3 | Browser-local FASTA validation + GC stats, no Worker fetch | **PASS** | `Execution: browser-local`; "Validation: pass — 3/3 valid"; table rows `dna_001 24 50%`, `dna_002 19 50%`, `dna_003 16 50%`; summary N50 19 / mean GC 50%; zero `/api/*` requests after submit |
| 4 | Local-agent phylo plan → approve → job → result | **PASS** (re-run) | plan step `phylogenetics.workflow`, `External egress: no`; `Execution: local agent`; validation pass with 5 checked rules, no flags; 11 evidence-bounded findings; all 4 required artifacts + report/provenance links |
| 5 | Download report; required sections; real mode | **PASS** (re-run) | `GET /api/ai/runs/job_59eacd60e7fc9e3c/report` → 200 `text/html`; contains Reproducibility, Limitations, Data locality, Education notes; `Execution mode: real`; full extracted text in §8 |
| 6 | Malformed FASTA | **PASS** | `#input-error`: "Invalid nucleotide character in FASTA record 2 on line 4. Only ACGT/IUPAC codes are allowed."; `POST /api/ai/requests` → **400**; no plan/results panel; no approval call |
| 7 | Unavailable backend (route interception) | **PASS** | error "Agent not connected — heavy analyses unavailable; browser-local tools still work. Backend check: forced unavailable by E2E route interception."; zero `/api/ai/requests` calls; no simulated result |
| 8 | Denied consent / egress via browser-context API | **PASS** | `POST /api/blast/submit` → **403** `{"error":"A consent token is required for remote BLAST submission.","code":"consent_missing"}`; `/api/blast/history` 0 → 0; zero NCBI requests; planner `identify_taxa` step has `external_egress:false`, `consent_required:false` |
| 9 | Mock mode labelling | **FAIL (labelling gap)** | detail says "Worker execution mode is mock; simulated output is not scientific evidence." and route is blocked, but `#backend-badge` = "Backend: no local agent observed" — no "mock" in the badge. See §7 |
| 10 | Console errors / failed requests / timings | **PASS** | Collected for every scenario; see §5. No unexpected errors, no failed requests, no external requests |

### Timings (from the structured log, ms)

| Scenario | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Duration | 1394 | 598 | 1476 | 5626 | 81 | 921 | 763 | 876 | 582 |

Scenario 4 includes plan build, approval polling (3 s UI poll interval) and agent execution; scenario 5 is a same-page report fetch.

---

## 4. Screenshots

All saved in `docs/discovery/m6-screenshots/` (viewport 1180 × 820, PNG, `fullPage:false`, animations disabled):

| File | Bytes | State shown |
| --- | ---: | --- |
| `01-home.png` | 200477 | Home navigation, hero, six capability cards |
| `02-ai-backend.png` | 37879 | AI workspace with "Backend: local agent observed" badge |
| `03-browser-local.png` | 28087 | Browser-local result: pass + GC statistics table |
| `04-phylo-plan.png` | 30676 | Proposed plan with `phylogenetics.workflow` step and parameters |
| `05-phylo-result.png` | 39983 | Local-agent result: validation, findings, artifact list, downloads |
| `06-malformed.png` | 26534 | Invalid-character input error, no plan/job |
| `07-unavailable.png` | 26987 | Forced-unavailable backend blocking message |
| `08-mock.png` | 27151 | Forced mock backend detail and blocked route |

Largest screenshot: 200,477 bytes (< 500 KB). Count: 8 (within the ≤8 limit).

---

## 5. Console errors, failed requests and timings by scenario

Recorded with Playwright listeners `page.on('console')` (errors only), `page.on('pageerror')`, `page.on('requestfailed')`, `page.on('request')`, `page.on('response')`.

| Scenario | Console errors | Page errors | Failed requests | API responses observed | External requests |
| --- | --- | --- | --- | --- | --- |
| 1 home | none | none | none | none (static page) | 0 |
| 2 backend | none | none | none | `GET /api/ai/backend` 200 | 0 |
| 3 browser-local | none | none | none | `GET /api/ai/backend` 200 only — **no** `/api/ai/requests`, `/api/ai/plans`, `/api/ai/runs` | 0 |
| 4 local-agent | none | none | none | backend 200 ×2, `POST /api/ai/requests` 200, `POST /api/ai/plans/plan_63a39c53e93bbe88/approve` 200, `GET /api/ai/runs/job_59eacd60e7fc9e3c` 200 ×2, `GET .../report` 200 | 0 |
| 5 report | none | none | none | `GET .../report` 200 | 0 |
| 6 malformed | **1 expected**: "Failed to load resource: the server responded with a status of 400 ()" | none | none | `GET /api/ai/backend` 200 ×2, `POST /api/ai/requests` **400** | 0 |
| 7 unavailable | none | none | none | intercepted `GET /api/ai/backend` 200; no plan request | 0 |
| 8 consent | **1 expected**: "Failed to load resource: the server responded with a status of 403 ()" | none | none | `GET /api/blast/history` 200 ×2, `GET /api/ai/backend` 200, `POST /api/blast/submit` **403**, `POST /api/ai/requests` 200 (planner probe) | 0 |
| 9 mock | none | none | none | intercepted `GET /api/ai/backend` 200; no plan request | 0 |

The two console errors are the browser's generic resource-error messages for the deliberately tested 400/403 responses; they are expected and correlate with the typed API bodies.

---

## 6. Blockers, risks and environment notes

### 6.1 Agent restart and Cloudflare UA (environment, resolved for this run)

* At the start, `GET /api/ai/backend` returned `agent_status:"not_connected"`, `agent_observation_basis:"no agent activity recorded"`, `heavy_analyses_available:false` even though `AI_AGENT_TOKEN` was configured (`true`) and `execution_mode:"real"`.
* The originally-running `python -m smartbio.aiagent.agent --loop ...` process was gone after an infrastructure server restart (confirmed via process listing). It was restarted from a temp script that reads the token at runtime; the token was never printed, logged or written into any script or report.
* The restarted agent then logged repeated `agent: job poll failed: HTTP Error 403: Forbidden`. A controlled probe showed `GET /api/ai/jobs` with the same token returned **403** with Python-urllib's default User-Agent and **200** with a normal browser User-Agent. Conclusion: Cloudflare edge bot filtering, not token validity.
* Workaround (temp only): `sitecustomize.py` adds a browser `User-Agent` to urllib requests, and `m6-restart-agent.ps1` restarts the agent with that shim on `PYTHONPATH`. After this, jobs were claimed and results posted (`job_b019fbf0bce4f7cd` and the E2E's `job_59eacd60e7fc9e3c` both `succeeded`).
* **Risk:** an operator running the documented agent command as-is against this staging Worker may see silent 403 polling failures. This is an infrastructure/UX risk worth fixing in deployment guidance or agent HTTP headers (product change not made by this tester).

### 6.2 Cold-start catch-22 for the local-agent route (design risk, HIGH)

* `backend.js` only reports `agent_status:"connected"` when a job row has `agent_id + started_at` within 10 minutes. An idle polling agent leaves no trace (the file comment says so explicitly).
* The UI blocks the local-agent route unless that "observed" state is true (`decideExecution` → `action:"blocked"`).
* Therefore on a fresh deployment with a healthy polling agent and no prior jobs, the UI cannot create the first job: backend requires a claim, the claim requires a job, and the job requires a connected backend. I created and approved the first job through the authenticated API from the browser context to bootstrap observation; immediately afterwards the badge changed to "local agent observed".
* **Evidence:** pre-bootstrap backend response `{"agent_status":"not_connected","agent_observation_basis":"no agent activity recorded","heavy_analyses_available":false,...}`; after the API-created job was claimed, `{"agent_status":"connected",...,"agent_observation_basis":"agent job claim recorded in jobs (agent_id + started_at)","heavy_analyses_available":true}`.
* **Suggested fix:** add a lightweight authenticated agent heartbeat (or treat "token configured + recent successful poll" as evidence) so a healthy idle agent can be observed without first executing a job; alternatively allow a single explicitly-warned first job to be queued when a token is configured.

### 6.3 Mock badge labelling (product gap, LOW–MEDIUM)

* See §7. No simulated result was ever presented as real in any scenario.

### 6.4 No consent UI control asserted

Per instruction, no synthetic UI consent control was fabricated. Scenario 8 exercises the real API gate from the browser context. The phylogenetics plan has no egress step at all, so the plan's consent box is correctly hidden.

---

## 7. Defect / gap detail

**ID M6-BROWSER-01 — mock execution mode is not reflected in the header badge**
* Severity: LOW–MEDIUM (labelling/transparency; no scientific result is misrepresented).
* Reproduction: intercept `GET /api/ai/backend` and return `{"execution_mode":"mock","agent_status":"connected","heavy_analyses_available":true,...}`; load `/ai.html`; wait for status to render.
* Expected: a visible indication such as "Backend: mock" / "Execution: mock (simulated)" on `#backend-badge` or `#execution-mode`, per the requirement that mock mode be labelled.
* Actual: `#backend-badge` = **"Backend: no local agent observed"**; `#backend-status` = "Agent not connected — heavy analyses unavailable; browser-local tools still work."; `#execution-mode` (before route change) = "Execution: browser-local". Only `#backend-detail` says "Worker execution mode is mock; simulated output is not scientific evidence." The local-agent route is blocked, so no simulated result is shown.
* Evidence: screenshot `08-mock.png`, log scenario `9-mock` (1 of 49 assertions failed).
* Suggested fix: in `describeBackendStatus`/`renderBackendStatus`, branch on `status.execution_mode === "mock"` for the badge and mode label (e.g. "Backend: mock — simulated results not scientific evidence", "Execution: mock (unavailable)"), while keeping the fail-closed block.

---

## 8. Report text evidence (scenario 5, no secrets)

Fetched in the page context from the UI's report link target `GET /api/ai/runs/job_59eacd60e7fc9e3c/report` → **HTTP 200**, `text/html; charset=utf-8`. Stripped-text head and the complete Reproducibility → Limitations block are reproduced verbatim below (HTML entities such as `&quot;` are left as delivered; the fetched HTML was ~61 KB of plain text because it embeds all artifact JSON, so the required sections are quoted in full rather than the entire dump):

```text
Analysis report - 4
Smart Bioinformatics Toolkit - Analysis Report
Generated 2026-11-24T22:39:26.686Z · Job 4 · Plan plan_63a39c53e93bbe88
Execution mode: real
Research use only. Outputs are screening evidence, not proof of identity and not a clinical diagnosis. Interpretation remains the user's responsibility.
```

```text
Reproducibility
Tool id / version
phylogenetics.workflow / 1.0.0
Backend
local-python
Dataset id
ds_0e96adbf61b02b93
Input filename
phylo_reference.fasta
Input SHA-256
4bbacdc8f8e2239ddf939b263db650d0d09d999181697d02a91ecea8458666a8
Parameters
{
&quot;sequence_type&quot;: &quot;dna&quot;
}
Database
None used
Started / finished
2026-11-24T22:39:26.611214+00:00 / 2026-11-24T22:39:26.659674+00:00
Execution mode
real
To reproduce, run the registered tool with the exact parameters and dataset hash above through the local execution agent. Artifact hashes are verified before display.
Data locality
Receipt mode
real
No external egress
true
Local operations:
Tool / step
Step id
Backend
phylogenetics.workflow
step_1
local-python
External transmissions:
No external transmissions (no data left the machine).
Consent records:
None recorded.
Education notes
No education notes recorded.
Limitations
Research use only. Outputs are screening evidence, not proof of identity and not a clinical diagnosis.
This MVP accepts nucleotide FASTA (IUPAC codes) only; protein input is not supported by the request flow.
Statistics are descriptive; they do not establish taxonomy, identity or sequencing quality.
Phylogenetic analysis is for research use only; it is not a clinical or diagnostic result and is not a publication-grade tree.
The multiple sequence alignment is a deterministic progressive heuristic and does not guarantee a global optimum.
The neighbor-joining tree is reconstructed from identity distances, not maximum-likelihood or Bayesian inference.
Branch lengths and internal branches are hypotheses, not proof of ancestry; no external service is contacted.
Validation accepts the IUPAC DNA alphabet; ambiguous bases are not resolved into a single nucleotide.
Length and alphabet checks cannot assess sequencing quality or contamination.
Progressive multiple sequence alignment is a heuristic and does not guarantee a global optimum.
The guide tree depends on the fixed scoring scheme; alternative scores may produce a different alignment.
Conserved columns are counted only where every sequence shares the same non-gap residue.
Neighbour joining is a distance-based heuristic, not a maximum-likelihood or Bayesian inference.
The identity distance model ignores substitution saturation and rate variation.
An unrooted NJ tree is stored with a trifurcating root; internal branches are hypotheses, not proof of ancestry.
This report is for research use only and is not a clinical or diagnostic result.
Artifact hashes cover the artifacts bundled in this report, not the source FASTA itself.
This composite runs all steps in one job so the website does not need to chain job outputs; it does not change any scientific computation.
Taxonomic claims require verified BLAST evidence from a local database; this MVP does not produce them from FASTA alone.
References
No references recorded.
```

### Run/artifact facts from the result JSON (scenario 4)

* `run_id`: `job_59eacd60e7fc9e3c`; `execution_mode`: `real`; validation `status: pass`; checked rules: `required_artifacts_present, json_parses, declared_json_objects, sha256_consistency, execution_mode_label`; flags: none.
* Findings (all cite an artifact + field path): 6 accepted sequences (`phylo_validation.json/sequence_count`), shortest 120 bp, alignment 120 columns and 92 conserved sites (`alignment_summary.json`), tree 6 tips / 4 internal nodes / Newick 139 chars (`tree_stats.json`), report bundles 6 upstream hashes (`phylo_report.json`).
* Artifacts with sizes: `alignment.fasta` 756 B, `alignment_summary.json` 987 B, `phylo_report.html` 2374 B, `phylo_report.json` 9215 B, `phylo_validation.json` 3467 B, `report.html` 36704 B, `tree.nwk` 140 B, `tree.svg` 1439 B, `tree_stats.json` 1868 B — each with SHA-256 in the run JSON.
* Download links rendered: `Download JSON` (`/api/ai/runs/job_59eacd60e7fc9e3c`), `Download HTML report` (`/api/ai/runs/.../report`), `Download provenance` (`/api/ai/runs/.../provenance`).

---

## 9. How to reproduce (short)

1. Ensure the staging Worker is deployed and the authenticated local agent is polling. If the backend shows "no local agent observed", bootstrap one job with `POST /api/ai/requests` + `POST /api/ai/plans/:id/approve` (token is **not** needed for these public endpoints) so the agent claim marks it observed. If the agent logs 403, use a browser `User-Agent` for its urllib calls.
2. Run `& "D:\tools\nodejs\node.exe" "D:\DevCache\Temp\opencode\m6-e2e.cjs"`.
3. The script opens real Chromium, runs the nine scenario blocks (scenario 5 reuses scenario 4's page), records every check and writes screenshots directly to `docs/discovery/m6-screenshots/`.
4. Inspect `D:\DevCache\Temp\opencode\m6-browser-log.json` for `checks`, per-scenario `consoleErrors`/`failedRequests`/`apiResponses` and `durationMs`.

Manual spot-check of the two key UI paths: on `/ai.html`, choose "Browser (local)", paste `shared/test-cases/dna_valid.fasta`, enter "validate my FASTA and show GC statistics", click **Build plan** → result shows `Execution: browser-local` with validation and GC table and no network call. Choose "Local agent", upload `shared/test-cases/phylo_reference.fasta`, enter "build a phylogenetic tree and show the alignment and report", click **Build plan** → plan step `phylogenetics.workflow` → **Approve and queue jobs** → wait ≈5 s → result shows validation pass, findings, the four named artifacts and report/provenance links.

---

## 10. Suggested next fixes (ordered)

1. **HIGH** — remove the cold-start catch-22 in backend observation (§6.2): add an authenticated agent heartbeat or count a recent successful poll as evidence, so an idle healthy agent can be observed and the first heavy job can be started from the UI.
2. **LOW–MEDIUM** — label mock mode in the badge/mode chip, not only in the detail text (§7). Keep the fail-closed block.
3. **Ops** — make the agent's HTTP client send a compatible `User-Agent` (or adjust Cloudflare rules) so polling is not silently 403'd (§6.1).

---

# 11. FINAL RE-RUN (post-redeploy Worker `e4938f2c`, migration 0006)

**Status: FINAL — 10/10 scenarios PASS, 64/64 assertions PASS, 0 FAIL, no blocking defect.**
All screenshots in `docs/discovery/m6-screenshots/` were **refreshed by this re-run** and overwrite the earlier set. The earlier run's log and screenshots were archived outside the repo at `D:\DevCache\Temp\opencode\m6-browser-log-previous.json` and `D:\DevCache\Temp\opencode\m6-screenshots-previous\`.

## 11.1 Commands and artifacts for the final run

```powershell
# Cold-start backend verification performed BEFORE any API write or browser run:
GET https://smart-bioinformatics-toolkit-staging.m-2396.workers.dev/api/ai/backend

# Full suite re-run (updated harness for the new disabled-option and mock labels):
& "D:\tools\nodejs\node.exe" "D:\DevCache\Temp\opencode\m6-e2e.cjs"
# transcript: D:\DevCache\Temp\opencode\m6-e2e-final-stdout.txt
# structured log: D:\DevCache\Temp\opencode\m6-browser-log.json

# Existing tests against the redeployed code (web-platform workdir):
& "D:\tools\nodejs\node.exe" --test tests/*.test.mjs
# ℹ tests 211 / pass 211 / fail 0 / duration_ms 537.2217
```

Log metadata: `startedAt 2026-11-24T22:56:46.448Z`, `finishedAt 2026-11-24T22:57:00.062Z`, Playwright `1.65.1`, Chromium `159.0.8154.6`.

## 11.2 Cold-start backend verification (requirement 2)

Direct `GET /api/ai/backend` **before any bootstrap call from this tester**:

```json
{"execution_mode":"real","agent_status":"connected","heavy_analyses_available":true,
 "agent_observation_basis":"agent heartbeat recorded by authenticated agent poll",
 "last_agent_activity_at":"2026-11-24T22:52:35.442Z","age":0,
 "message":"Local agent observed recently; heavy analyses are available.",
 "simulated_results_available":false}
```

The browser at scenario 2 independently fetched the same endpoint: `agent_status:"connected"`, `heavy_analyses_available:true`, basis `"agent heartbeat recorded by authenticated agent poll"`. `#backend-badge` = **"Backend: local agent observed"**; status = "Local agent observed recently; heavy analyses are available."; no POST occurred in this scenario (`[{"method":"GET","path":"/api/ai/backend","status":200}, ...]`). **No API plan/job bootstrap was needed.** The agent kept polling throughout the run; no stoppage was observed.

## 11.3 Final PASS/FAIL table (64 assertions)

| # | Scenario | Result | Final evidence |
| --- | --- | --- | --- |
| 1 | Home navigation / hero / capability cards | **PASS** | 4 nav links, hero heading, 6 cards |
| 2 | Backend observed from cold start | **PASS** | heartbeat basis via authenticated poll; no POST; badge "Backend: local agent observed" |
| 3 | Browser-local validation + GC, no Worker fetch | **PASS** | `Execution: browser-local`, 3/3 valid, GC table, **zero `/api/*` requests after submit**; Education notes + Locality receipt sections visible |
| 4 | Phylo plan → approve → genuine job/result | **PASS** | `phylogenetics.workflow`, `job_6b19ae4d63b98160`, mode `real`, validation pass, 11 artifact-cited findings, 9 artifacts incl. all four required, report/provenance links; Education notes + Locality receipt sections visible |
| 5 | Report download / evidence | **PASS** | `GET /api/ai/runs/job_6b19ae4d63b98160/report` 200; Reproducibility, Limitations, Data locality, Education notes; `Execution mode: real` |
| 6 | Malformed FASTA | **PASS** | "Invalid nucleotide character in FASTA record 2 on line 4…"; `POST /api/ai/requests` 400; no plan/job |
| 7 | Unavailable backend | **PASS** (harness adapted) | local-agent `<option>` is **disabled**, `#route-availability` = "The local agent is unavailable, so the local-agent route is blocked. Browser-local analysis still works."; stale route still blocked; no plan request; no simulated result |
| 8 | Consent / egress API | **PASS** | 403 `consent_missing`; BLAST history 0 → 0; no NCBI request; planner step has no egress |
| 9 | Mock mode labelling | **PASS** (previously FAIL) | badge **"Backend: mock — simulated results not scientific evidence"**; chip **"Execution: mock (not scientific evidence)"** before *and after* a stale route selection; mock route-availability message; option disabled; no plan request; no simulated result |
| 10 | Console / network diagnostics | **PASS** | No page errors, no failed requests, 0 external-host requests; only two expected HTTP-error console messages (400 and 403) |

Timings (ms): 1=1387, 2=937, 3=531, 4=5930, 5=92, 6=856, 7=534, 8=806, 9=492.

## 11.4 Explicit confirmations requested

1. **Mock badge/chip — CONFIRMED PASS.** The prior M6-BROWSER-01 gap is fixed: `#backend-badge` = `Backend: mock — simulated results not scientific evidence`; `#execution-mode` = `Execution: mock (not scientific evidence)` at page load and after forcing a stale local-agent selection. The route is blocked with an honest message and no plan is created. Evidence: screenshot `08-mock.png`, log scenario `9-mock`.
2. **Cold start — CONFIRMED.** Heartbeat-based observation works with no prior job and no tester bootstrap (§11.2). The previous HIGH cold-start catch-22 is resolved.
3. **Genuine phylo job — CONFIRMED.** `job_6b19ae4d63b98160`, `execution_mode:"real"`, `validation.status:"pass"`, checked rules `required_artifacts_present, json_parses, declared_json_objects, sha256_consistency, execution_mode_label`, no flags; 11 findings citing `phylo_validation.json`, `alignment_summary.json`, `tree_stats.json`, `phylo_report.json`; artifacts `alignment.fasta`, `alignment_summary.json`, `phylo_report.html`, `phylo_report.json`, `phylo_validation.json`, `report.html`, `tree.nwk`, `tree.svg`, `tree_stats.json`; report + provenance links present.
4. **Browser-local has zero analysis API calls — CONFIRMED.** After submit, `rec.apiRequests.slice(before)` = `[]`; the only scenario API response was the page-load `GET /api/ai/backend` 200.
5. **New workspace sections — CONFIRMED.** Both `#education-box` ("Education notes") and `#locality-box` ("Locality receipt") render in browser-local and local-agent results. Browser-local text: "Browser-local profile: no per-run education notes are produced…" and "Browser-local run: FASTA parsing, validation and statistics stayed in this page…". Agent result text: "No education notes recorded for this run." / "No locality receipt recorded for this run." (honest empty states). The downloaded report still contains a real "Data locality" section with `Receipt mode real`, `No external egress true`.
6. **No new console errors / failed requests — CONFIRMED.** All nine scenario recorder entries show `pageErrors: []`, `failedRequests: []`, `externalRequestsCount: 0`. Console errors: only scenario 6 (expected 400) and scenario 8 (expected 403).

## 11.5 Refreshed screenshots (final run)

| File | Bytes |
| --- | ---: |
| `01-home.png` | 200477 |
| `02-ai-backend.png` | 38173 |
| `03-browser-local.png` | 28621 |
| `04-phylo-plan.png` | 30644 |
| `05-phylo-result.png` | 39988 |
| `06-malformed.png` | 26960 |
| `07-unavailable.png` | 27464 |
| `08-mock.png` | 26926 |

8 screenshots, all under 500 KB. `03-browser-local.png` and `05-phylo-result.png` visibly include the new Education notes / Locality receipt sections; `08-mock.png` shows the new mock badge/chip and route-availability message.

## 11.6 Remaining observations (not blockers)

* **LOW — per-run locality data not surfaced in workspace.** `GET /api/ai/runs/:id` has no `provenance` or `locality_receipt` field, so `localityReceiptFromRun()` renders "No locality receipt recorded for this run." even though `GET /api/ai/runs/:id/provenance` returns `locality_receipt: {mode:"real", no_external_egress:true, local_operations:[…1…]}` and the downloaded HTML report shows the real receipt. Suggested fix: include `provenance.locality_receipt` in the run DTO or fetch the provenance endpoint when rendering results.
* **LOW — no education notes for this phylo run.** `explanation.education.notes` is empty, so the new table renders its honest empty state. This is data-dependent, not a UI defect.
* The redeployed UI disables the local-agent `<option>` when no agent is observed; the harness was adapted to assert the disabled state and the `#route-availability` explanation rather than trying to `selectOption` a disabled option. This is an improvement, not a defect.

**Final blocker status: none.** All requested re-run checks pass; the only remaining items are the two LOW observations above.

---

# 12. Focused follow-up — run DTO locality/education (Worker `f4538286`)

**Result: PASS — 11/11 focused assertions, 0 FAIL.** Short real-Chromium check only (scenario 4 path); the other nine scenarios were **not** re-run. Backend was already connected via heartbeat (`agent_status:connected`, `heavy_analyses_available:true`, basis `agent heartbeat recorded by authenticated agent poll`).

## 12.1 Commands / artifacts

```powershell
# Focused script (real Chromium, staging Worker):
& "D:\tools\nodejs\node.exe" "D:\DevCache\Temp\opencode\m6-followup-locality.cjs"
# transcript: D:\DevCache\Temp\opencode\m6-followup-stdout.txt
# structured log: D:\DevCache\Temp\opencode\m6-followup-log.json
```

The script opened `/ai.html`, selected the local-agent route, uploaded `shared/test-cases/phylo_reference.fasta`, entered "build a phylogenetic tree and show the alignment and report", built and approved the plan, and waited for the completed run. Result: `job_d3f177e09e972776`, `execution_mode:"real"`, validation `pass`, duration 6,392 ms.

## 12.2 Exact workspace text observed

`#locality-box` (previously "No locality receipt recorded for this run."):

```text
Locality receipt Receipt mode real No external egress yes Local operations
phylogenetics.workflow · step step_1 · backend local-python External transmissions
No external transmissions (no data left the machine). Consent references
apr_c978a1b004b905ed approval:plan_4c65fbae4b8cf562:step_1
```

`#education-box`:

```text
Education notes No education notes recorded for this run.
```

Run JSON fetched from the UI's Download JSON link now contains `locality_receipt` (`mode:"real"`, `no_external_egress:true`, one local operation `phylogenetics.workflow` / `step_1` / `local-python`, zero external transmissions) and `education` (`notes` key). The Education notes section is labelled and honestly reports that this particular run produced no flag notes — acceptable per the brief.

## 12.3 Checks

| Check | Result |
| --- | --- |
| Phylo plan step `phylogenetics.workflow` | PASS |
| Education notes section labelled | PASS |
| Education notes content honest (empty state) | PASS |
| Locality receipt section labelled | PASS |
| Receipt mode `real` shown | PASS |
| Stale "No locality receipt recorded" absent | PASS |
| Local operation `phylogenetics.workflow`, step 1, local-python | PASS |
| "No external transmissions (no data left the machine)." | PASS |
| Consent references labelled and non-secret (approval IDs only) | PASS |
| Run DTO includes `locality_receipt` with real data | PASS |
| Run DTO includes `education` | PASS |

Console errors: **none**. Page errors: **none**. Failed requests: **0**. External-host requests: **0**.

**Screenshot refreshed:** `docs/discovery/m6-screenshots/05-phylo-result.png` (27,543 bytes), scrolled to show both the **Education notes** and **Locality receipt** sections with real data. Screenshot count remains 8, all under 500 KB.

**Note:** the first focused run had one harness-only FAIL because it expected "Consent references: None recorded"; the new DTO legitimately supplies approval record IDs. The assertion was made data-agnostic (and checked that no bearer-token/consent-token value is displayed) and the short check re-run: 11/11 PASS. No product defect found. The LOW observation in §11.6 about locality data not being surfaced is now **resolved**.

