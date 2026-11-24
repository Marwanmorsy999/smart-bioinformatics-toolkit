> **Status: HISTORICAL — superseded by later verification; findings retained verbatim.**
> **Reconciliation (2026-11-24):** The M4 remediation changed Worker-side code and tests only; `python-engine/src/smartbio/aiagent/**` was not modified, and no pytest run was required for that task. This review's verdict and findings remain as evidence of the state at review time; re-run `python -m pytest -q` before relying on its test count.
>
> The original review below is unchanged.

---

# Review: Python AI Execution Agent (Milestone 0.5.0)

**Reviewer:** independent read-only reviewer
**Date:** 2026-11-24
**Scope:** `python-engine/src/smartbio/aiagent/**`, `python-engine/src/smartbio/plugins/**`, `python-engine/tests/test_ai_*.py`
**Cross-checks:** `shared/AI_PLATFORM_CONTRACT.md` §3, `AI_AGENT_ARCHITECTURE.md` §3.7/§3.8/§6/§8, `PRODUCT_REQUIREMENTS.md` FR-5.1/FR-7.1/NFR-1/NFR-9
**Test run:** `python -m pytest -q` → **156 passed** (baseline 130; no regressions).

## Verdict: FAIL

The deterministic builders are sound and no scientific value is fabricated by the shipped plugins, but the two independent deterministic *gates* that are supposed to guarantee evidence-bounded explanations (number checker, citation checker) are trivially bypassable, and the result/provenance layer can mislabel execution mode. These are release blockers under NFR-1 and FR-7.1.

---

## BLOCKING ISSUES

### B1 — HIGH — `check_explanation` does not tie numbers to the cited `field_path` (bypassable)
`python-engine/src/smartbio/aiagent/explanation.py:219-232` builds one global `allowed_numbers` set from **every** numeric value in **every** artifact. At `:252-256` `_resolve(documents[name], field_path)` is called only to confirm the path exists; **the resolved value is discarded**. `check_text()` at `:224-232` then accepts any number that appears anywhere in any artifact.

Reproduced against real plugin artifacts:
- Finding `{"text": "Mean GC content is 59 percent.", "artifact": "statistics.json", "field_path": "summary.gc_percent_mean"}` → `check_explanation` returns `{'ok': True, 'errors': []}` even though `summary.gc_percent_mean == 50.0` and `59` is `summary.total_length`.
- Finding `{"text": "There are 59 valid records.", "artifact": "validation.json", "field_path": "valid_records"}` → also accepted (`valid_records == 3`).
- `explanation["limitations"]` is never checked at all (`:234-256` covers only summary and findings), so plan-supplied limitations can carry arbitrary numbers.

Violates ARCH §3.8 ("every number must be copied from a validated artifact; a number checker verifies this", "every finding carries artifact + field_path"), §8 ("zero numbers absent from artifacts"), and FR-7.1/NFR-1. The negative tests (`tests/test_ai_explanation.py:49-61`, `tests/test_ai_agent.py:64-72`) only use out-of-artifact numbers (99.99 / 87.5), so they do not detect this class of misattribution.

Fix: extract numbers from the *resolved field value only* (plus the artifact named by the finding), compare those to the finding text, and check `limitations` too.

### B2 — HIGH — Citation checker accepts fabricated title/URL and a missing `verified` flag
`python-engine/src/smartbio/aiagent/explanation.py:262-269` validates only that `key` exists in `REFERENCES` and that neither the ledger entry nor the emitted copy says `verified is False`. It never compares `title`, `url` or `verified` against the ledger.

Reproduced: setting `explanation["references"][0]["title"] = "FABRICATED TITLE"` and `["url"] = "https://evil.example/fake"` while keeping the verified key `smartbio_gc_definition` → `check_explanation` returns `ok: True`. Omitting `verified` entirely also passes (`None is not False`).

This is not merely cosmetic: the Worker stores `reference.verified === true` as `verified_by = "agent"` and `is_verified = 1` (`web-platform/functions/api/ai/jobs/[id]/result.js:138-151`), so a fabricated title/url attached to a verified key is persisted as an agent-verified citation. Violates FR-7.1 ("rejects any DOI/PMID/title not in the evidence ledger"), ARCH §3.8 and NFR-1.

Fix: require `reference == {key,title,url,verified}` to match the ledger entry exactly, require `verified` to be a boolean, and reject any extra/mismatched field.

### B3 — MEDIUM/HIGH — `execution_mode` is hardcoded to `"real"` and ignores the plugin's label
`agent.py:170` deliberately preserves a plugin-provided `tool_run_meta["execution_mode"]` (and `validation.py:113-114` warns on `"mock"`), but the emitted result at `agent.py:214` and the provenance at `provenance.py:55` both hardcode `"real"`. The Worker trusts the payload verbatim (`web-platform/functions/api/ai/_lib.js:211-215`, `result.js:75`), so any adapter that reports mock execution would be stored and displayed as real. This directly contradicts ARCH §3.5/§6, FR-5.1 and NFR-9 ("mocks are never presented as real science"). Currently latent (all four shipped plugins hardcode `"real"`), but it is a one-line path to violating the core policy.

Fix: derive both fields from `tool_run_meta.get("execution_mode", "real")`.

### B4 — MEDIUM — Report artifact is excluded from provenance integrity record
`agent.py:195-204` builds provenance, then `agent.py:205-207` appends `report.html` to `artifacts`. Consequently `provenance.output.artifact_names` and `provenance.output.sha256` (`provenance.py:50-53`) do not describe the final submitted artifact set. The Worker stores `payload.artifacts` names in `tool_runs` and the (stale) provenance separately (`result.js:133-134`), so the audit trail is internally inconsistent. Build provenance after the report is appended, or regenerate `output` before submission.

---

## NON-BLOCKING OBSERVATIONS

- **N1 (Medium, robustness):** `validation.py:54` raises `TypeError` when `valid_records`/`invalid_records` are absent while `total_records == len(records)` (confirmed by direct call). `validate()` is invoked outside `process_job`'s try/except (`agent.py:173`), so a malformed artifact would kill the poll loop instead of producing a `failed` result. Not reachable from current plugins, which always emit both keys.
- **N2 (Medium, test quality):** No end-to-end test for a failed BLAST/DB-unavailable job (plugin-level tests at `test_ai_plugins.py:87-101` cover it; agent-level propagation is only reasoned). Add one asserting `status == "failed"`, empty non-report artifacts, and no verdict text. Also add negative tests for B1 and B2.
- **N3 (Low):** `agent.py:53` computes `consent_required` from `consent.granted is False` rather than from the plan's egress policy; the report's "Consent required" column is therefore misleading.
- **N4 (Low):** Hardcoded `"tool_version": "0.1.0"` in `sequence_stats.py:119` and `microbiome_16s.py:160` disagrees with the plugins' `VERSION = "1.0.0"` (`sequence_stats.py:21`, `microbiome_16s.py:18`), weakening reproducibility sections.
- **N5 (Low):** `build_explanation` for taxonomy/blast-parse (`explanation.py:130-168`) cites only summary counts, never per-query verdict/evidence fields; conservative but weak. `__init__.py` exports nothing; callers must import submodules directly.
- **N6 (Low):** Subprocess use in `smartbio/blast_runner.py:55-103` is safe (`shell=False`, list args, timeouts) and `safe_filename`/`write_input` (`plugins/__init__.py:18-43`) correctly reject traversal and cap input at 64 KiB; no path-traversal or code-execution issue found. Poll mode sends the agent token over whatever scheme `--url` supplies (no TLS enforcement) — operator-supplied, documented risk only.
- **N7 (Low):** `report.py:176-178` embeds every artifact verbatim; with a 64 KiB input this should stay under the Worker's 2 MiB body cap, but there is no explicit bound/test.

## POSITIVE FINDINGS

- All reported scientific numbers originate in real `smartbio` functions (`fasta.parse_fasta_file`, `validate_records`, `calculate_statistics`, `statistics_dataframe`, `blast.parse_blast_file`, `analyze_blast`, `taxonomy.run_taxonomy_analysis`); no invented values found.
- Kim et al. 2014 is correctly recorded as `verified: False` with `verified_by: None` (`explanation.py:25-32`), is never emitted by `build_explanation`, and is rejected by the checker (`test_ai_explanation.py:64-70`).
- Missing TSV / unavailable DB produces a structured `status: "failed"` result with zero fabricated artifacts and an explicit "no hits were fabricated" reason (`microbiome_16s.py:58-71`, `plugins/__init__.py:76-96`); end-to-end propagation verified manually.
- Result JSON keys/types match contract §3 exactly (verified against `web-platform/functions/api/ai/_lib.js:334-389`).
- No regressions: 156/156 tests pass.

## ENVIRONMENT NOTE

The mandated dashboard update could not be executed: `D:\Apps\Star-Office-UI\office-status.cmd` does not exist on this host (`Test-Path` = False; a recursive search under `D:\Apps` returned no match). No files were modified by this review.
