# Orchestration log

## Wave 0 - Gate G0 (2026-11-24)
- Orchestrator wrote and froze `docs/CONTRACTS.md` (schemas, API interfaces, errors, file ownership).
- Baseline before G0: Python 126 passed / JS 102 passed, clean tree, branch `phase-1-robustness-safety` (integration branch).
- Prior independent reviewer: PASS WITH NOTES (all minor findings fixed: total_queries undercount, cutoff normalization, Wilson bounds, missing generator/tests). Prior independent tester: Python 123/JS 102 green, demo fixtures untouched, clean tree.
- Gate G0: FROZEN. Next: Wave 1 P0 agents (literature, API scout, data/benchmark, taxonomy, expert questions) in parallel.

## Wave 1 - Gate G1 (partial)
- Literature agent: docs/RESEARCH_REVIEW.md (109 lines). Sources opened listed; Kim et al. PMID corrected to 24505072; full text not opened (UNVERIFIED); source disagreements recorded.
- API Scout: docs/API_CATALOG.md (161 lines). 9 candidates: ADOPT BLAST URL API + RefSeq targeted loci; INVESTIGATE E-utilities/Datasets/LPSN/GTDB/BacDive/SILVA; REJECT RDP (unreachable, FREE ONLY). No live API calls/payments.
- Expert agent: docs/EXPERT_REVIEW_REQUEST.md (77 lines), all items PENDING HUMAN REVIEW.
- Data agent (orchestrator): indel option added to queries.py + CLI + runner with deterministic tests; expanded benchmark (5 seeds, lengths 300/500/1000, 0.5%/1%, indel 0.01) running in background.
- Gate G1: literature and API catalog ACCEPTED pending independent citation checker (verification wave). No fabricated data introduced; all ledger rows marked UNVERIFIED where appropriate.


## Wave 1 - Gate G3 (in progress)
- Expanded benchmark running: 5 conditions x 5 seeds x 200 queries (heldout L500/0.5%, L300/0.5%, L1000/0.5%, L500/1%, L500/0.5%+indel 0.01).
- First condition complete: heldout L500 0.5% -> top-hit wrong mean 145.4/200 (seeds 143/133/155/153/143), verdict wrong mean 12.0 (7/10/15/15/13). Saved in benchmark_data/benchmark_runs_expanded/heldout_L500_s0.5/benchmark_summary.json.
- Gate G3 not yet complete: remaining 4 conditions still running.

