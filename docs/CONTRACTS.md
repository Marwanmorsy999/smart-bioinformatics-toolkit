# Contracts (frozen at Gate G0, 2026-11-24)

These interfaces are binding for all agents. Changes require orchestrator approval and a new G0 tag. Schemas are additive/backward compatible. No secrets, no paid services, no R2.

## Data schemas

- `blastn_local_v1` TSV (12 columns, tab-separated, no header required): `qseqid sacc staxids sscinames pident length qstart qend qlen evalue bitscore qcovs`. `staxids`/`sscinames` may be `;`-separated; `N/A` allowed when no taxonomy.
- `taxonomy_map.tsv`: TSV with header `taxid	scientific_name	rank	parent_taxid	full_lineage`; integer taxids; `full_lineage` `;`-separated names; cycles rejected.
- `verdict` JSON: `{status, reported_rank, reported_taxon, reasons[], caution_flags[], difficult_groups[], evidence_summary, disclaimer}`. Statuses: `species_supported|group_level_only|genus_level_only|below_screening_threshold|insufficient_evidence`.
- `taxonomy_analysis.json`: `{per_query:{qid:{consensus,verdict}}, no_hit_queries:{...}, summary, verdict_counts, verdict_settings, thresholds, mapping_validation}`.
- `benchmark_report.json`: `{n_evaluated, species_screening_threshold, top_hit_method, top_hit_cutoff_method, verdict_method, rows[], notes}`. Each method block: `species_calls, species_call_rate, correct, wrong, wrong_rate_among_calls, wrong_rate_overall, wilson_95pct_ci_on_correct_rate` (+ verdict extras).
- report metadata (shared `shared/test-cases/report_metadata_keys.json`): `tool, tool_version, generated_at, input_file, input_file_hash_sha256, parameters, thresholds, disclaimer`.

## API interfaces

- NCBI BLAST URL API (verified: `docs/NCBI_API_NOTES.md`): `https://blast.ncbi.nlm.nih.gov/Blast.cgi`; `CMD=Put` (QUERY, DATABASE=`16S_ribosomal_RNA`, PROGRAM=`blastn`, MEGABLAST, EXPECT, HITLIST_SIZE, FILTER, FORMAT_TYPE) returns RID; `CMD=Get` (RID, FORMAT_TYPE=Text&ALIGNMENT_VIEW=Tabular) returns status/results. Limits: <=1 submit/10s, poll a RID <=1/min, identify with `tool` and `email` from env.
- Pages Functions (plain ES modules): `POST /api/blast/submit` -> `{rid,status}`; `GET /api/blast/status/:rid` -> `{status}` or `429`+`Retry-After`; `GET /api/blast/results/:rid` -> `text/plain` TSV or `409`; `GET /api/blast/history` -> `{submissions:[{rid,status,created_at}],count,mock}`. D1 binding `BLAST_DB`, table `blast_requests`. `MOCK_NCBI=1` is the only mode used in tests.

## Error formats

- JSON errors: `{error: <escaped message>, status: <http code>}`; never leak raw exceptions or FASTA. HTTP: 400 validation, 405 method, 409 not-ready, 429 rate-limited, 503 binding/upstream failure.
- CLI: errors to stderr with `error: <message>`, exit 2.

## File ownership map (wave 1)

- Orchestrator: `docs/CONTRACTS.md`, `docs/ORCHESTRATION_LOG.md`, `docs/EVIDENCE_LEDGER.md`, all merges/tags.
- Literature agent: `docs/RESEARCH_REVIEW.md` only.
- API Scout: `docs/API_CATALOG.md` only.
- Data/Benchmark agent: `scripts/run_benchmark.py`, `python-engine/src/smartbio/benchmark/queries.py`, `python-engine/tests/test_benchmark.py`, `benchmark_data/` (not tracked in git).
- Taxonomy agent: `scripts/build_taxonomy_map.py`, `docs/NAME_DRIFT_NOTES.md`.
- Algorithm agent: `shared/test-cases/risk_coverage_cases.json`, `python-engine/src/smartbio/benchmark/risk_coverage.py`, `web-platform/public/js/risk-coverage.js`, tests.
- Backend agent: `web-platform/functions/api/blast/**`, `web-platform/tests/blast_*.test.mjs`, `web-platform/wrangler.toml`, `web-platform/migrations/**`.
- Frontend agent: `web-platform/public/benchmark.html`, `web-platform/public/css/main.css`, `web-platform/public/js/app.js`.
- Security agent: `docs/THREAT_MODEL.md`, `THIRD_PARTY_NOTICES.md`, `web-platform/public/_headers`.
- Docs agent: `README.md`, `docs/DEMO_SCRIPT.md`, `docs/PROJECT_SUMMARY.md`, slides outline.
- Expert agent: `docs/EXPERT_REVIEW_REQUEST.md` only.
- Verification/red-team: read-only; findings to `docs/ORCHESTRATION_LOG.md` via orchestrator.

Agents must not commit; orchestrator commits after each gate.
