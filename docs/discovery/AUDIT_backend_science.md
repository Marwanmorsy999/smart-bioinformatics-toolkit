# Backend / scientific audit — Python engine

**Agent role:** read-only investigation (only this report file created).
**Repo root:** `D:\smart-bioinformatics-toolkit-milestone-0_5_0\smart-bioinformatics-toolkit-milestone-0.5.0\smart-bioinformatics-toolkit`
**Date:** 2026-11-24
**All citations below are `path:line` relative to repo root.**

---

## 0. Method and environment

Files read in full: every module under `python-engine/src/smartbio/**` (fasta, statistics, blast,
blast_runner, csv_safe, exports, taxonomy/{__init__,analyze,ambiguity,consensus,lineage,resolver,verdict,report},
benchmark/{__init__,queries,evaluate,risk_coverage}), `python-engine/main.py`, `python-engine/requirements.txt`,
all 18 files in `python-engine/tests/`, `shared/sequence-rules.json`, `shared/difficult-groups.json`, the
shared JSON/TSV fixtures, `scripts/{build_taxonomy_map,run_benchmark,generate_results}.py`, and
`docs/{SCIENTIFIC_RULES,RESEARCH_REVIEW,BENCHMARK_PROTOCOL,EVIDENCE_LEDGER}.md` plus `README.md`.

Commands actually run (results in §5):

- `cd python-engine; python -m pytest -q` → **130 passed in 5.96s**
- `python -m pytest --collect-only -q` → 130 tests collected (per-file counts in §5)
- `python -m pytest tests/test_blast_integration.py -v` → **1 passed in 4.14s**
- an inline Python snippet exercising `exports.write_csv` vs `blast_runner.write_csv` (§4).
- `Get-Command blastn, makeblastdb` → both installed: `C:\Program Files\NCBI\blast-2.17.0+\bin\blastn.exe`.

**Dashboard note:** the mandated status command `D:\Apps\Star-Office-UI\office-status.cmd` does not exist
in this environment (`D:\Apps` contains only `agy`, `aider-env`, `bun`). Dashboard updates were attempted
and skipped; this is an environment limitation, not a code finding.

---

## 1. What scientific capabilities are ACTUALLY implemented

Everything in this table is real executable code, not a stub. "Real" means the algorithm runs on user
input; it does **not** mean the biological interpretation is clinically or taxonomically validated.

| Capability | Where | What it really does |
|---|---|---|
| FASTA parse | `python-engine/src/smartbio/fasta.py:47-110`, `:65` | Biopython `SeqIO.parse`; BOM stripping (`:52`), structural pre-flight for text before first header (`:20-44`), header/first-token ID and sequence normalization (`:66-68`). |
| Sequence validation | `fasta.py:113-194`; alphabets `:12-17` | IUPAC DNA/protein alphabets; explicit type required (`:119-122`); duplicate IDs invalidate **all** copies (`:126-145`); invalid symbols flagged (`:147-155`); ambiguous symbols warning-only (`:157-165`); `*` counted for protein (`:167-175`); canonical/ambiguous/stop counts (`:177-179`); `file_valid` (`:193`). Matches `shared/sequence-rules.json:1-22`. |
| Sequence statistics | `statistics.py:24-87` | GC% = (G+C)/(A+C+G+T)×100 on canonical bases only (`:42-43`, definition at `:78`); N50/L50 (`:11-21`, `:61-64`); min/max/mean/median length (`:72-75`); per-base counts (`:54`, `:84-86`); valid non-empty records only (`:31-34`); DataFrame export (`:90-92`). |
| BLAST tabular import | `blast.py:131-293` | Three declared schemas (`:14-33`); column-count inference for 12/11 columns (`:90-128`); typed parsing of ints/floats (`:54-83`, `:198-222`); range checks for pident, length, coords, evalue, bitscore, qcovs (`:224-255`). Explicitly documents "does not execute BLAST" (`:1-6`). |
| BLAST filter / rank / report | `blast.py:335-539` | Identity/coverage/E-value filters (`:398-425`); per-query ranking by bitscore → evalue → pident → aligned length (`:441-459`); exact-tie detection (`:460-468`); `max_hits` display cap preserving ties (`:470-489`); no-hit query list (`:492`); query coverage from `qlen` (`:323-332`); summary counters (`:527-538`). |
| **Local BLAST+ execution** | `blast_runner.py:122-310` | Real `subprocess.run` of installed `blastn` (`:203-210`), version probe (`:55-73`), `blastdbcmd -info` DB validation (`:76-103`), FASTA pre-validation (`:148-161`), fixed 12-field outfmt (`:188-199`), SHA-256 input hash (`:106-111`), run metadata (`:268-297`), candidate-limit warning (`:252-263`). |
| Taxonomy-map builder | `scripts/build_taxonomy_map.py:21-210` | Parses real NCBI taxdump `nodes.dmp`/`names.dmp`/`rankedlineage.dmp`, walks parent chain (`:134-145`), emits the 5-column map (`:200-204`); fails loudly without a name source (`:166-171`). |
| Taxonomy resolution | `resolver.py:204-527` | Load/validate local TSV (`:235-358`); **real NCBI E-utilities esummary** via `urllib.request.urlopen` (`:165-180`) with batching, dedup and in-memory cache (`:125-201`); semicolon-separated `staxids`/`sscinames` resolved independently (`:426-484`). |
| Lineage & LCA | `lineage.py:40-222` | 8 fixed ranks (`:15-24`); builds lineage from NCBI `LineageEx` (`:86-117`) or parent-taxid walking (`:130-179`, cycle guard `:149-154`); LCA over lineages (`:182-217`). No name-string inference (`:6`). |
| Consensus | `consensus.py:55-327` | Top-N with ties at cutoff (`:55-82`); support over **unique species** not raw accessions (`:114-172`); LCA + deepest qualifying rank (`:198-246`); statuses `species_agreement`/`ambiguous_species`/`higher_rank_only`/`conflicting_lineages`/`insufficient_evidence` (`:248-269`); evidence and support dicts (`:271-297`). Explicitly "evidence-support fraction, not calibrated probability" (`:4-11`). |
| Verdict | `verdict.py:86-361` | Full rule engine (details §3); research-use disclaimer (`:33-36`); difficult-group loading (`:43-49`). |
| Ambiguity report | `ambiguity.py:15-118` | Flags for multiple taxids, missing taxids, incomplete lineages, truncation, conflicting references (`:32-85`); defensibility helpers (`:98-118`). |
| Orchestration | `analyze.py:69-241` | Resolves lineages (`:26-66`), selects candidates (`:132-137`), computes consensus+ambiguity+verdict per query (`:146-193`), explicit no-hit entries (`:195-210`), verdict counts/flags (`:212-240`), conflicting-taxonomy detection (`:244-263`). |
| HTML report | `report.py:17-137` | Reproducibility metadata + self-contained HTML; all interpolated values passed through `html.escape` (`:11-14`, `:38-137`). |
| Benchmark query generation | `benchmark/queries.py:30-148` | Deterministic seeded RefSeq-header species parsing (`:30-66`), substitution/indel mutation (`:69-86`), noisy/heldout modes (`:89-148`). Explicitly flagged `simulated_errors_not_sequencing_errors: True` (`:147`). |
| Benchmark evaluation | `benchmark/evaluate.py:25-238` | Truth parsing (`:25-41`), top-hit vs 98.65%-cutoff vs verdict comparison (`:111-179`), Wilson 95% CI (`:72-83`), abstention/group-containment accounting (`:185-229`), limitations note (`:231-235`). |
| Risk–coverage sweep | `benchmark/risk_coverage.py:17-50` | Threshold sweep of call rate vs wrong rate from shared cases. |
| CLI | `python-engine/main.py:71-480` | 8 real subcommands: `validate`, `stats`, `analyze`, `blast`, `blast-run`, `taxonomy`, `benchmark-queries`, `benchmark-eval`; deterministic schema fallback from sidecar `blast_run.json` (`:39-68`). |

**Not implemented anywhere in the Python engine:** real remote NCBI *BLAST* submission (that lives in
Cloudflare Pages Functions, outside this audit), phylogenetic/tree inference, ANI/dDDH, per-base quality
assessment, name-drift/nomenclatural-validity checks (admitted at `README.md:220-222`), or any ML model.

---

## 2. Is BLAST real or mocked?

**Both, depending on the path. The engine itself contains a genuine local BLAST+ adapter; most of its
tests mock it.**

- **Real execution path:** `blast_runner.py:122-310`. It validates FASTA, resolves `blastn` via
  `shutil.which` (`:45-52`, `:164-169`), checks `blastn -version` (`:55-73`, `:170`), validates the DB with
  `blastdbcmd -info` (`:76-103`, `:173-175`), then executes the binary with `shell=False` and a strict
  outfmt (`:188-210`). Output is parsed by the real analyzer (`:232-246`) and real files written
  (`:248-250`, `:298`). Metadata records version, command, hashes, timing and warnings (`:268-297`).
  There is no "fake hit generator" in production code.
- **Online NCBI BLAST:** not in the Python engine. README states explicitly that no live NCBI request
  was exercised and only MOCK mode / mocked tests were used (`README.md:183-186`). The *online taxonomy*
  client (`resolver.py:81-201`) makes real E-utilities calls in code, but only mocked in tests.
- **`test_blast_integration.py` (the one real integration test) verifies only a smoke path**, not
  biological correctness:
  - skipped unless both `blastn` and `makeblastdb` are on PATH (`:12-15`);
  - builds a real 32-nt DB with `makeblastdb` (`:19-24`);
  - invokes the real CLI `python main.py blast-run ...` as a subprocess (`:26-35`);
  - asserts **only** return code 0, existence of `blast_results.tsv` and `analysis.json`, and
    `analysis["summary"]["total_queries"] >= 1` (`:36-40`).
  - It never asserts that a hit was found, that identity/E-value are correct, that the schema/metadata
    are right, or that any taxonomic or verdict output is meaningful. In this environment blastn 2.17.0
  is installed, so it ran and **passed** (§5). It is a real execution test of plumbing only.
- **`test_blast_runner.py` (15 tests) is entirely mocked.** `FakeCompleted` (`:22-27`) and
  `make_subprocess_side_effect` (`:30-47`) monkeypatch `subprocess.run` at `:92, 128, 145, 169, 198, 216,
  232, 242, 263, 288`; `shutil.which` is patched throughout. These check command construction
  (`:183-211`), paths with spaces (`:154-181`), error/timeout handling (`:117-151`), metadata (`:239-257`)
  and schema mapping (`:260-271`) — valuable contract tests, but **zero real BLAST execution**.
- **`test_benchmark.py` substitutes a fake aligner.** `fake_search` (`:76-90`) computes simple
  positional identity, and the module docstring says it "stands in for BLAST" and says nothing about
  real-world accuracy (`:1-7`). The benchmark *scripts* (`scripts/run_benchmark.py:67-120`) do call real
  `makeblastdb`/`blastn`, but those scripts are not exercised by the test suite.

---

## 3. Taxonomy / verdict rules and scientific limitations

**Rules actually encoded**

- Canonical ranks: superkingdom→species (`lineage.py:15-24`). Lineage from NCBI `LineageEx` or parent
  walk, never from name strings (`lineage.py:86-117`, `:130-179`, docstring `:6`). Mapping cycles are
  detected at load (`resolver.py:308-351`) and the walk is depth/visited bounded (`lineage.py:149-154`);
  a cycle test passes (`tests/test_taxonomy_cycle.py:10-21`).
- LCA = deepest rank where all lineages share one non-None taxid (`lineage.py:182-217`).
- Consensus: top-N ties preserved (`consensus.py:55-82`); support = max taxon frequency / number of
  **unique species** (`consensus.py:136-172`); supported rank from LCA if it meets `--min-consensus`,
  else deepest qualifying rank (`:228-246`); statuses at `:248-269`.
- Verdict defaults: species screening identity **98.65%**, min coverage **80%**, min query length
  **500 nt**, near-threshold margin **0.35 pp** (`verdict.py:28-31`). Best hit by bitscore then pident
  (`:130-137`). Coverage below min → `insufficient_evidence` (`:147-157`); short query →
  `partial_sequence` caution (`:159-168`). Species keyed by normalized name; uninformative names
  (`sp.`, `uncultured`, `bacterium`, `Candidatus`) excluded (`:52-69`, `:179-188`). Top identity below
  threshold → `below_screening_threshold` + explicit "does not establish a novel species" reason
  (`:213-229`). Exactly one qualifying species → `species_supported` (`:271-278`); multiple species in
  one genus → `genus_level_only` (`:283-289`); several genera → abstain (`:290-312`). Difficult groups
  force `group_level_only` or cautions (`:337-359`).

**Scientific limitations (real, not claimed gaps)**

1. **16S resolution:** 98.65% is explicitly a screening reference, not a universal boundary
   (`verdict.py:16-20`, `docs/SCIENTIFIC_RULES.md:35`). The literature supporting it is marked
   **UNVERIFIED** in `docs/RESEARCH_REVIEW.md:82-109` and `docs/EVIDENCE_LEDGER.md:16`; no independent
   citation verification exists in this tree.
2. **Partial sequences** only get a caution (`:159-168`); no hard rejection. Literature says partial 16S
   has insufficient resolving power (`RESEARCH_REVIEW.md:37`, C4) but this is not enforced.
3. **Multiple taxids per hit:** flagged ambiguous (`resolver.py:478`) but consensus uses **only the first
   resolved lineage** (`analyze.py:42-57`). Remaining taxids are recorded, not evaluated.
4. **Name-level species counting in the verdict:** distinct species are counted by normalized *name*
   (`verdict.py:186-190`), not taxid, despite `SCIENTIFIC_RULES.md:55` claiming "unless they share a
   taxid". Consensus does use taxid keys (`consensus.py:114-124`), so the two layers can disagree.
5. **Top-N truncation:** default 10 candidates; truncation is flagged (`analyze.py:132-137`) but the
   verdict is computed only from the retained evidence (`analyze.py:189-192`). Extra species can be lost.
6. **Coverage unavailable for standard schema:** no `qlen` → coverage None (`blast.py:323-332`), and
   `coverage_pass` becomes True when no minimum is requested (`blast.py:406-409`); verdict then adds a
   caution (`verdict.py:147-151`). No coverage is ever invented (README:289-290).
7. **Schema auto-inference ambiguity:** `blastn_local_v1` also has 12 columns and infers as `standard`;
   recovery depends on a sibling `blast_run.json` (`blast.py:90-95`, `main.py:39-68`). Without it, all
   rows fail.
8. **No type-strain / database-release provenance** is checked; DB info is only what `blastdbcmd`
   returns (`blast_runner.py:173-175`, `:278-279`). `RESEARCH_REVIEW.md:56-69` documents why this matters.
9. **No phylogenetic method, no ANI/dDDH, no per-base quality**, and consensus support is not a
   probability (`consensus.py:4-11`, `README.md:220-234`).
10. **Difficult-group member lists are illustrative and `needs_curator_review: true`**
    (`shared/difficult-groups.json:20,35,50`; `README.md:213-219`). The engine only triggers cautions,
    never identifications (`:3`).

---

## 4. Statistics and report generation: computed vs fabricated

- **Nothing scientific is fabricated in the engine.** Validation counts, symbol counts, GC%, N50/L50,
  lengths, BLAST parsed/passing/displayed counts, consensus support, verdict counts, Wilson CIs and
  group containment are all derived from supplied input (`statistics.py:24-87`, `blast.py:516-539`,
  `consensus.py:289-297`, `evaluate.py:151-238`). No random values, no hard-coded accuracy numbers.
- **Hardcoded metadata, not measurements:** `tool_version = "0.1.0"` in `main.py:32, 219, 452`,
  `report.py:19`, `python-engine/src/smartbio/__init__.py:3`, despite "milestone 0.5.0" docs;
  `generated_at` is wall-clock (`report.py:29`); the disclaimer string is duplicated
  (`verdict.py:33-36`, `report.py:24`). Reports therefore self-label 0.1.0 — a provenance inconsistency.
- **Benchmark numbers in README (`:239-260`) cannot be reproduced from this checkout.**
  `benchmark_data/` is absent (verified), no `RESULTS.md`, `benchmark_summary.json` or
  `benchmark_report.json` exists anywhere in the tree, and `scripts/generate_results.py:15-31, 62-121`
  only reformats saved JSON from that missing directory. The numbers are internally consistent with a
  real run per `docs/EVIDENCE_LEDGER.md:13`, but are **unverifiable here**.
- **HTML report** renders the analysis verbatim with escaping (`report.py:38-137`; `:11-14`);
  `:67-68` is dead code (a loop over an always-empty list). No XSS path found in the HTML generator.
- **CSV injection guard is NOT shared by all exports.** `csv_safe.py:1` claims it is, but
  `safe_csv_cell` (`:6-16`) is used **only by `tests/test_csv_safe.py:8,14`**. Production paths:
  - `exports.py:18-27` applies its own inline `'` prefix (works, but different implementation);
  - `blast_runner.py:317-319` writes `dataframe.to_csv(...)` raw;
  - `main.py:279` (benchmark CSV) and `main.py:400` (taxonomy summary CSV) also write raw.
  Verified experimentally: a cell `=HYPERLINK("http://x","click")` survives unneutralized in
  `blast_runner.write_csv` output but becomes `'=HYPERLINK(...)` in `exports.write_csv` output. Since
  `sscinames`/`consensus_taxon`/`candidate_species` come from external databases, this is a real gap.
- `report.py` metadata is embedded in a `<pre>` block (`:62`) and query evidence in a table (`:114-133`)
  from the same analysis, so report content is as trustworthy as the upstream mapping.

---

## 5. Test coverage and observed results

**Exact command (README:59-63):**

```
cd python-engine
python -m pip install -r requirements.txt
python -m pytest
```

**Observed here:** `python -m pytest -q` → `130 passed in 5.96s` (0 failed, 0 skipped).
`python -m pytest tests/test_blast_integration.py -v` → `1 passed in 4.14s`.
Interpreter `C:\Users\maram\AppData\Local\Programs\Python\Python314\python.exe` (3.14.8), pytest 8.4.2,
Biopython 1.88, pandas 2.3.3. NCBI blastn/makeblastdb 2.17.0 on PATH, so the integration test was **not**
skipped. **No failures observed.**

Collected tests per file (total 130):

| File | # | Main coverage |
|---|---:|---|
| `tests/test_verdict.py` | 33 | 30 shared verdict cases (parametrized `:19-27`), group citation, disclaimer, missing-file |
| `tests/test_taxonomy.py` | 25 | lineage, LCA, mapping load, resolver, consensus, top-N ties, end-to-end analysis |
| `tests/test_blast_runner.py` | 15 | **mocked** subprocess, metadata, timeouts, command args, errors |
| `tests/test_blast.py` | 14 | schema inference, malformed rows, ties/max-hits, coverage, no-hit, ranges |
| `tests/test_benchmark.py` | 13 | deterministic queries, heldout, truth parsing, **fake** search chain, Wilson, cutoff baseline |
| `tests/test_fasta.py` | 5 | valid/invalid DNA, sequence-before-header, ambiguity, protein stop |
| `tests/test_statistics.py` | 4 | GC definition, protein no-GC, N50/L50, invalid exclusion |
| `tests/test_taxonomy_online.py` | 4 | **mocked** E-utilities batching/cache/failure/lineage |
| `tests/test_risk_coverage.py` | 3 | shared sweep cases and monotonic call rate |
| `tests/test_build_taxonomy_map.py` | 2 | real builder script; fail-loud without name source |
| `tests/test_cli_fallback.py` | 2 | real CLI subprocess for schema fallback (blast + taxonomy) |
| `tests/test_taxonomy_consistency.py` | 2 | Python matches `taxonomy_expected.json`; flag order |
| `tests/test_verdict_pipeline.py` | 2 | Python verdicts match `verdict_pipeline_expected.json`; counts |
| `tests/test_report.py` | 2 | metadata key contract; HTML contains input/hash |
| `tests/test_blast_integration.py` | 1 | **real** blastn smoke path (see §2) |
| `tests/test_csv_safe.py` | 1 | shared CSV injection fixture — but guard unused in production |
| `tests/test_taxonomy_cycle.py` | 1 | cyclic parent links rejected |
| `tests/test_shared_vectors.py` | 1 | shared FASTA/statistics vectors |

**Not covered:** (a)biological correctness of any real BLAST hit (integration test asserts none);
(b) any *live* NCBI E-utilities request or live NCBI BLAST submission; (c) `exports.write_csv` /
`blast_runner.write_csv` / CLI CSV injection behaviour; (d) HTML escaping with malicious input;
(e) `validate`/`stats`/`analyze` CLI output correctness beyond unit-level modules;
(f) `benchmark-queries`/`benchmark-eval` CLI paths; (g) `near_threshold_margin` configurability
(it cannot be configured); (h) large-input/performance and Unicode/BOM edge cases beyond tiny strings;
(i) `max_hits` interplay with E-value filtering beyond one ties test; (j) `qcovs` range validation
(`:253-255`) has no dedicated test; (k) consensus `consensus_taxid` fallback branch
(`consensus.py:240-246`). Note also that "Python suite covers ... benchmark evaluator" (README:70-73)
is true only at unit level — no real benchmark run is in the suite.

---

## 6. Dependencies and Python version requirements

`python-engine/requirements.txt:1-3` (only three lines):

```
biopython>=1.83,<2.0
pandas>=2.0,<4.0
pytest>=8.0,<9.0
```

- No `pyproject.toml`/`setup.py`/`python_requires`, no lockfile, no upper Python bound.
- README claims **Python 3.10+** (`README.md:49`). Code relies on `from __future__ import annotations`
  plus PEP-604 unions (`str | Path`, `int | str | None`) and built-in generics; 3.10 is the minimum
  that parses these. Actually executed on **3.14.8**; `py --version` also reports 3.15.0.
- External binaries: NCBI BLAST+ `blastn`, `makeblastdb`, `blastdbcmd` needed **only** for `blast-run`
  and the benchmark scripts (`README.md:51-52`; `scripts/run_benchmark.py:25-29, 67-68`). Installed here
  as 2.17.0. A 139 MB `ncbi-blast-2.17.0+-win64.exe` is present in the working-tree root but is
  gitignored (`.gitignore` last lines).
- pytest plugins present in the environment (anyio, playwright, respx, langsmith, asyncio) are
  installed extras, not declared requirements and not used by these tests.

---

## 7. Documentation vs actual code behaviour

| Doc claim | Reality | Evidence |
|---|---|---|
| `SCIENTIFIC_RULES.md:56` — near-threshold margin "is configurable" | **False via CLI.** No `--near-threshold-margin` parser option; `run_taxonomy_analysis` call omits it; report metadata uses `getattr(..., 0.35)`. Always 0.35. | `main.py:139-162`, `:336-345`, `:418` |
| `SCIENTIFIC_RULES.md:55` — subspecies/strain names count distinct "unless they share a taxid" | **False in verdict layer:** keys by normalized *name* only. Consensus does use taxid, so layers can disagree. | `verdict.py:180-190` vs `consensus.py:114-124` |
| `csv_safe.py:1` — "CSV injection guard shared by all exports" | **False:** used only by its test; three export paths write raw. | `csv_safe.py:6-16`; `tests/test_csv_safe.py:8,14`; `blast_runner.py:317-319`; `main.py:279,400` |
| `README.md:51-52` — "no installer is bundled in this repository" | True for tracked files, false in this working tree: 139 MB installer at root (gitignored). | root `ncbi-blast-2.17.0+-win64.exe`, `.gitignore` |
| `README.md:116-146,239-260` — published real benchmark numbers | Unverifiable here: `benchmark_data/` and all saved JSON/RESULTS.md absent. `BENCHMARK_PROTOCOL.md:31` still says "No real numbers are produced by the repository". | `scripts/generate_results.py:15-31,62-121` |
| `BENCHMARK_PROTOCOL.md:17` — taxonomy-map script is an "OPEN TASK" | Stale draft; script is implemented and a "verified chain" is documented at `:45-56`. | `scripts/build_taxonomy_map.py:21-210` |
| `docs/RESEARCH_REVIEW.md:82-109` — every scientific claim UNVERIFIED | README acknowledges this (`README.md:223-225`), yet 98.65% is a live default threshold. Literature basis is not independently verified in-tree. | `verdict.py:28`, `RESEARCH_REVIEW.md:40-46,82-109`, `EVIDENCE_LEDGER.md:16` |
| `EVIDENCE_LEDGER.md:3` — "UNVERIFIED claims may not appear in README, UI or slides" | README lists UNVERIFIED rows (labelled as such) at `:34-38`. | `README.md:34-38` |
| Docs call the deliverable milestone **0.5.0** | All reports/metadata self-identify as tool version **0.1.0**. | `main.py:32,219,452`; `report.py:19`; `src/smartbio/__init__.py:3`; `docs/MILESTONE_0.5.0.md:1` |
| `SCIENTIFIC_RULES.md:43` — verdict.py and verdict.js "implemented identically", tested on shared fixture | JS file and JS shared-fixture test exist, so the claim is plausible, but line-by-line parity was **not** audited here (frontend scope). | `web-platform/public/js/verdict.js`; `web-platform/tests/verdict.test.mjs:12` |
| `README.md:286-294` — BLAST analyzer "does not run BLAST" | Accurate for `blast.py`; `blast-run` is a separate real adapter (`blast_runner.py`). | `blast.py:1-6`, `blast_runner.py:122-310` |
| `README.md:183-186` — no live NCBI request exercised | Consistent with code/tests: online client real but only mocked in tests. | `resolver.py:167`; `tests/test_taxonomy_online.py:61-147` |

---

## 8. Bottom line (brutally honest)

- The Python engine is **substantively implemented**: FASTA validation, statistics, BLAST parsing/ranking,
  real local `blastn` execution, taxonomy mapping/LCA/consensus, a conservative verdict engine, an HTML
  report, and a benchmark harness all run real algorithms on real input.
- **BLAST is genuinely executed** by `blast-run` against a local binary; but 15 of 16 runner tests mock
  the subprocess, and the single real integration test is a file-existence smoke test with no
  biological assertion. Online NCBI taxonomy code is real but only mock-tested; remote NCBI BLAST is
  outside this engine and explicitly never live-tested.
- **Scientific interpretation is deliberately conservative and mostly honest**: no fabricated metrics in
  the engine, explicit abstention, disclaimers, uncertainty flags, and repeated "screening reference,
  not species boundary" language. But its key literature justification (98.65%) is unverified in-tree,
  difficult groups need curation, several safeguards are name-based rather than taxid-based, and the
  near-threshold margin advertised as configurable is hard-coded.
- **Tests are numerous (130, all passing here) but shallow on biology and security**: no real-hit
  accuracy check, no CSV-injection regression on actual export paths, no live-network tests, and no
  reproducible real benchmark data in this checkout.
- **Provenance weaknesses:** tool version mislabelled 0.1.0, benchmark headline numbers unreproducible
  here, stale "OPEN TASK" protocol text, and an installed-but-gitignored BLAST installer in the tree.
