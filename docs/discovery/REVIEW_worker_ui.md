> **Status: HISTORICAL — superseded by later verification; findings retained verbatim.**
> **Reconciliation (2026-11-24):** The two blocking Worker findings are retained verbatim. Since that review, the legacy BLAST consent gate was added (`0003_blast_consent.sql`, `submit.js`, `approve.js`) and the JS suite passes 129/129 after the new tests; the consent flow must still be re-reviewed against current code before treating this document's FAIL verdict as current.
>
> The original review below is unchanged.

---

# Independent Code Review — Worker Control Plane & AI Workspace UI

**Scope:** `web-platform/functions/api/ai/**`, `functions/api/tools.js`, `migrations/0002_ai_platform.sql`, `public/ai.html`, `public/js/ai-workspace.js`, `public/css/main.css`, `public/index.html`, `tests/ai_contract.test.mjs`, `tests/helpers/fake-d1.mjs`, `shared/schemas/**`, `shared/plugins/**`.
**Cross-checks:** `shared/AI_PLATFORM_CONTRACT.md`, `PRODUCT_REQUIREMENTS.md`, `SYSTEM_ARCHITECTURE.md`, `python-engine/src/smartbio/aiagent/*`.
**Test run:** `cd web-platform; npm test` -> **113 tests, 113 pass, 0 fail** (confirmed).
**Office dashboard:** attempted `D:\Apps\Star-Office-UI\office-status.cmd` at start and finish; path does not exist on this machine, so status could not be updated.

## Verdict: FAIL

Two blocking defects. The first prevents the feature from being deployed at all; the second defeats a safety-relevant execution-mode control.

---

## BLOCKING ISSUES

### B1. Migration `0002_ai_platform.sql` is not valid SQLite — the whole AI platform cannot be created
`web-platform/migrations/0002_ai_platform.sql:113` declares `CREATE TABLE IF NOT EXISTS references (...)`. `REFERENCES` is a reserved SQLite keyword (used by `FOREIGN KEY ... REFERENCES`). Executing the migration in a real SQLite/D1 instance fails with:

```
sqlite3.OperationalError: near "references": syntax error
```

I verified this by running both migrations through Python `sqlite3`: 0001 succeeds, 0002 fails at the `references` statement; after quoting the name the rest of the file (including the unquoted `key` column and all 11 indexes) executes cleanly. Because D1 migrations are applied as a unit, **no AI table is created**, so every `/api/ai/*` endpoint returns "AI database binding is unavailable"/500 and the UI is dead on a fresh deployment.

Why the 113 tests miss it: the fake D1 (`tests/helpers/fake-d1.mjs:101-156`) is driven by the `SQL_META` string map in `functions/api/ai/_lib.js:43-64` and never executes SQL or applies the migration. There is no test that runs the `.sql` files. This is a correctness + test-coverage failure (contract §6; PRD FR-2.2/FR-5.1 depend on these tables existing).
**Fix:** quote/rename the table, e.g. `CREATE TABLE IF NOT EXISTS "references" (...)` (then update `SQL.insertReference` in `_lib.js:37` and the `SQL_META` key), or rename to `ai_references`. Add a migration-smoke test that executes `0001` + `0002` in an in-memory SQLite.

### B2. `execution_mode` is agent-controlled, so operator mock mode and mock-result labelling can be bypassed
`functions/api/ai/_lib.js:211-215` (`computeExecutionMode`) returns the agent's self-reported `result.execution_mode` verbatim whenever it is `"real"` or `"mock"`; the server-side `AI_EXECUTION_MODE` is only a fallback. The Python agent hardcodes `"real"` everywhere (`python-engine/src/smartbio/aiagent/agent.py:214`, `provenance.py:55`, `agent.py:120,136,147,170`), so setting `AI_EXECUTION_MODE=mock` never labels results as mock and never triggers the validation downgrade in `functions/api/ai/jobs/[id]/result.js:75-80`. A forged/fabricated submission carrying `"real"` is accepted as real and the report claims "Artifact hashes are verified before display" (`report.js:113`) even though only self-reported content hashes are checked.

This violates PRD FR-5.1 ("mocked execution is clearly labelled") and NFR-9 ("Mock/real execution is always distinguishable"), and contract §5 (`execution_mode` on every response must be truthful). The existing test only exercises the agent-reported path (`tests/ai_contract.test.mjs:282-307`); there is no test for the env override.
**Fix:** treat `env.AI_EXECUTION_MODE === "mock"` as authoritative (force `mode = "mock"`), and/or reject mismatches between reported mode and configured mode.

---

## NON-BLOCKING ISSUES / QUALITY CONCERNS

1. **Consent gate checks only `consent_required`, not `external_egress`** — `plans/[id]/approve.js:107`. Contract §1 requires `external_egress ⇒ consent_required`, and `validatePlan` enforces it at creation (`_lib.js:285-287`), so there is no live bypass; still, re-validate the stored plan and gate on `external_egress || consent_required` for defense in depth. PRD FR-4.3.
2. **UI/gate consent fields are inconsistent** — the consent checkbox is shown from `plan.consents_required.length` (`public/js/ai-workspace.js:186-191`) but the gate checks each `step.consent_required` (`approve.js:107`). A plan with a consent-required step and an empty `consents_required` list would have no UI affordance to grant consent and could never be approved (the client sends `consent_granted:false` at `ai-workspace.js:211`). Both are empty in the MVP planner, so no current impact.
3. **Result validation is shape-only, not schema validation** — `_lib.js:334-391` does not validate nested result items (`explanation.findings[]`, `explanation.references[]` items, `provenance.tool.version/backend`, `provenance.input.sha256/filename`, `provenance.output.sha256`, `timing` fields) against `shared/schemas/provenance.schema.json`, and `result.js:126-137` never cross-checks `provenance.run_id`/`tool.id` against the job row (cf. SYSTEM_ARCHITECTURE.md:219 "schema-checked"). Malformed or inconsistent provenance is stored and shown.
4. **Double-escaped JSON errors** — `errorResponse` HTML-escapes `message` before putting it in JSON (`_lib.js:105-107`), so API clients/UI see `&lt;` etc. instead of `<`.
5. **One-way approval is coarse** — `approve.js:64-71` returns existing jobs on any repeat call, so a partially approved multi-step plan can never approve its remaining steps. Fine for the single-step MVP.
6. **CSV formula guard gap** — `public/js/csv-safe.js:9` only neutralises leading `= + - @` (not leading whitespace before a formula). `shared/test-cases/csv_injection_cases.json` has no whitespace-payload case. The new `runToCsv` (`ai-workspace.js:321-338`) inherits this.
7. **XSS surface looks clean** — report assembly escapes every interpolation (`report.js:6,14-38,49-124`) and the response carries CSP (`_lib.js:109-117`, report `<meta>` at line 54); the UI uses `textContent`/`el()` exclusively (`ai-workspace.js:43-48`). The e2e test explicitly verifies `<script>`/`onerror` escaping (`ai_contract.test.mjs:224-267`). No XSS found.
8. **No heavy compute in Workers** — planner is deterministic keyword matching (`planner.js:31-53`); tool execution is delegated to the local agent. Request limits are sane (`_lib.js:11-13,179-191,305,340-354`). All SQL is parameterised via `.bind()` (`_lib.js:229-245`) — no SQL injection. Migration is otherwise additive: `blast_requests` is untouched and the indexes reference valid columns.
9. **Test gaps** — no test asserts 401 on `POST /jobs/:id/result` (only on poll, `ai_contract.test.mjs:205-208`), no migration-SQL test, no UI rendering test (B2's env path untested).
10. **Python/job DTO integration drift** (Python-owned, but affects this contract): `toJobDto` (`_lib.js:395-413`) omits `external_egress`, and `agent.py:53` derives `consent_required` from `consent.granted is False` (inverted). Harmless for the local-only MVP but will mislabel future external steps. `SYSTEM_ARCHITECTURE.md:179` also uses `artifact_ids` where the contract/Python use `artifact_names`.
