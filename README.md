# Smart Bioinformatics Toolkit

A modular bioinformatics workspace. The first milestone implements **FASTA validation** and **sequence statistics** in two matching interfaces:

- A browser application built with plain HTML, CSS and vanilla JavaScript.
- A Python command-line interface built with Biopython, Pandas and `argparse`.

The project is designed so that each tool can be used independently. The first milestone does not submit data to a remote service and does not upload sequences to a server: FASTA processing in the web app happens locally in the browser.

## Current status

### Implemented
- FASTA parsing and validation for DNA and protein sequences.
- Detection of missing headers, empty records, duplicate IDs and invalid symbols.
- Warnings for ambiguous-but-valid symbols.
- Per-record and file-level sequence statistics.
- DNA GC percentage calculated over canonical A/C/G/T bases only.
- N50/L50 for DNA sequence collections (not shown for proteins; these are collection/contig summary metrics, not identification evidence).
- Browser downloads: valid FASTA, validation JSON, statistics CSV and statistics JSON.
- Python CLI commands: `validate`, `stats`, `analyze`, `blast`, and `blast-run`.
- BLAST Results Analyzer (independent tool): import and analyze BLAST tabular files (standard 12-column outfmt 6, extended 11-column, and `blastn_local_v1`), with schema validation, filtering, ranking, tie preservation, no-hit query handling, and CSV/JSON export.
- Local BLAST+ adapter (`blast-run`) using `blastn` via subprocess, with executable/database validation, raw TSV output, analyzer integration, run metadata, and execution log.
- Taxonomy Analyzer (`python main.py taxonomy`): local consensus from BLAST TSV with an optional taxonomy mapping file, LCA resolution, support fractions, ambiguity reporting, and CSV/JSON exports.
- Browser BLAST Results Analyzer page (`blast.html`) and browser Taxonomy Analyzer page (`taxonomy.html`).
- Matching JavaScript and Python tests using shared test cases.

### Not implemented yet
- BLAST search or remote NCBI integration (local BLAST+ in CLI and NCBI remote BLAST in browser are later).
- Taxonomic interpretation or species identification.
- Sanger AB1 chromatogram quality assessment.
- User accounts or persistent cloud file storage.

These are intentionally later milestones. Do not describe this first milestone as a complete bacterial-identification platform.

## 1. Run the web app locally

No frontend framework, Node build step or package installation is required.

From the repository root, start a static server:

```bash
cd web-platform
python -m http.server 8000 --directory public
```

Open <http://localhost:8000>.

You can also open `web-platform/index.html` directly, but using a local server is recommended for ES modules.

## 2. Run the Python CLI

Python 3.10+ is recommended.

```bash
cd python-engine
python -m venv .venv
```

Activate it:

Windows PowerShell:

```powershell
.venv\Scripts\Activate.ps1
```

macOS/Linux:

```bash
source .venv/bin/activate
```

Install dependencies:

```bash
python -m pip install -r requirements.txt
```

Run validation:

```bash
python main.py validate --input ../shared/test-cases/dna_valid.fasta --type dna
```

Run statistics:

```bash
python main.py stats --input ../shared/test-cases/dna_valid.fasta --type dna --csv-out output/sequence_statistics.csv
```

Run both and save a complete first-milestone result folder:

```bash
python main.py analyze --input ../shared/test-cases/dna_valid.fasta --type dna --out-dir output/demo-run
```

For protein FASTA:

```bash
python main.py analyze --input ../shared/test-cases/protein_valid.fasta --type protein --out-dir output/protein-run
```

Analyze a BLAST tabular result (standard 12-column outfmt 6):

```bash
python main.py blast --input ../shared/test-cases/blast_sample.tsv --schema auto --min-query-coverage 80 --query-lengths ../shared/test-cases/ql.tsv --out-dir output/blast-run
```

Extended 11-column BLAST output with taxonomy fields and qlen:

```bash
python main.py blast --input results.tsv --schema extended --min-identity 97 --max-evalue 1e-5 --max-hits 10 --out-dir output/blast-run
```

Query lengths can also be derived from a query FASTA:

```bash
python main.py blast --input results.tsv --query-fasta queries.fasta --out-dir output/blast-run
```

## 3. Run tests

Python:

```bash
cd python-engine
python -m pytest
```

JavaScript (Node.js 18+):

```bash
cd web-platform
node --test tests/*.test.mjs
```

## 4. Validation rules and metric definitions

The accepted symbols are configured in `shared/sequence-rules.json`.

- DNA accepts the IUPAC nucleotide alphabet `ACGTRYSWKMBDHVN`. `U` is not accepted in DNA mode; RNA support can be added as a separate explicit mode later.
- Protein accepts the standard amino acids plus `B`, `Z`, `J`, `X`, `U`, `O` and `*` (stop symbol).
- Lowercase sequence letters are normalized to uppercase.
- Spaces and tabs inside sequence lines are ignored.
- The FASTA identifier is the first whitespace-delimited token in the header.
- Duplicate identifiers are flagged; every record sharing a duplicated identifier is invalid.
- Ambiguous but valid IUPAC DNA symbols are warnings, not errors.
- For protein sequences, `B`, `Z`, `J`, `X`, `U` and `O` are reported as non-canonical symbols. `*` is counted separately as a stop symbol.
- DNA GC% is `(G + C) / (A + C + G + T) * 100`. Ambiguous bases are excluded from the denominator and counted separately. This definition is shown in the interface and output.
- Statistics are calculated only from valid, non-empty records. Invalid records remain visible in the validation report but do not distort aggregate statistics.
- N50 is the sequence length at which the cumulative length of sequences sorted longest-to-shortest reaches at least 50% of the total valid sequence length. L50 is the number of sequences needed to reach that point.

These are data-quality checks, not a full assessment of sequencing quality. FASTA does not contain per-base Phred scores. AB1/FASTQ quality assessment is a future feature.

## 5. BLAST Results Analyzer (independent tool)

The BLAST analyzer imports a tabular BLAST file produced elsewhere. It does not run BLAST.

Supported schemas:
- Standard 12-column outfmt 6: `qseqid sseqid pident length mismatch gapopen qstart qend sstart send evalue bitscore`.
- Extended 11-column: `qseqid sacc staxids sscinames pident length qstart qend qlen evalue bitscore`.

Schema selection:
- The user may select the schema explicitly.
- Auto-inference is used only when every data row has the same column count and that count is 12 (standard) or 11 (extended). Mixed or unrecognized counts require an explicit choice.

Validation:
- Wrong column counts, missing values, non-numeric fields, and out-of-range values are reported with row numbers.
- For standard input, `qlen` is absent and is never invented. Provide query lengths from FASTA or a length file, or coverage is reported as unavailable.

Metrics:
- Query coverage = (`|qend - qstart| + 1`) / `qlen` * 100, when `qlen` is available.
- Rows are ranked within each query by bitscore (descending), then E-value (ascending), then percent identity and aligned length. Ties are preserved and reported.

Filtering:
- Configurable minimum identity, minimum query coverage, maximum E-value and maximum displayed hits.
- Each row reports which filters it passed or failed and why.
- Queries with no returned hits are listed when a query list or query FASTA is provided.

Exports:
- JSON: full analysis including raw rows, parsed values, coverage, pass/fail reasons, ranks, groups, no-hit queries, thresholds and summary.
- CSV: filtered (displayed) rows.

Scientific safeguards:
- BLAST similarity is not proof of species identity or function.
- 98.65% 16S identity is a screening reference, not a universal hard species boundary.
- An insufficient-evidence outcome is acceptable.

## 6. Local BLAST+ execution (`blast-run`)

The `blast-run` command runs a locally installed NCBI BLAST+ `blastn` and feeds its tabular output into the existing BLAST Results Analyzer.

Install NCBI BLAST+ locally (see NCBI BLAST+ installation documentation). Verify:

```bash
blastn -version
blastdbcmd -version
```

Create a local nucleotide database with `makeblastdb`:

```bash
makeblastdb -in references.fasta -dbtype nucl -out 16S_ribosomal_RNA
```

Run:

```bash
python main.py blast-run \
  --input ../shared/test-cases/dna_valid.fasta \
  --database /path/to/16S_ribosomal_RNA \
  --task megablast \
  --evalue 1e-5 \
  --max-target-seqs 500 \
  --threads 1 \
  --out-dir output/local_blast
```

Outputs:
- `blast_results.tsv` — raw BLAST tabular output (`blastn_local_v1` schema).
- `filtered_results.csv` — filtered/ranked results from the analyzer.
- `analysis.json` — full analyzer report.
- `blast_run.json` — run metadata (parameters, version, hashes, timing, warnings).
- `execution.log` — command, stdout, stderr.

The raw TSV can also be imported into the browser BLAST Results Analyzer. BLAST similarity is evidence, not proof of species identity. `max_target_seqs` can truncate tied hits; the tool warns when a query reaches the configured limit. Database release/version is recorded only when `blastdbcmd` provides it.

## 7. Taxonomy Analyzer (independent tool)

The Taxonomy Analyzer builds a transparent taxonomic consensus from BLAST tabular
results. Users are not required to run BLAST through this platform: any compatible
BLAST TSV (standard outfmt 6, extended 11-column, or `blastn_local_v1` from the
local BLAST+ runner) can be imported.

The BLAST input must contain at minimum a query ID, an accession/subject ID,
percent identity, alignment length, query coordinates, an E-value, and a bit
score. `blastn_local_v1` additionally carries `sacc`, `staxids`, `sscinames`,
`qlen`, and `qcovs` (query coverage per subject). Standard 12-column outfmt 6
has no taxonomy columns; taxonomy analysis then works only if subject IDs are
independently resolvable (for example, as accessions present in a mapping).

Expected output (verified with `shared/test-cases/blast_taxonomy.tsv` and
`shared/test-cases/taxonomy_map.tsv`):

```json
{
  "query_id": "q1",
  "status": "ambiguous_species",
  "supported_rank": "genus",
  "consensus_taxon": "Escherichia",
  "candidate_species": ["Escherichia coli", "Escherichia albertii", "Shigella dysenteriae"],
  "support": { "unique_species": 3, "genus_support": 1.0, "species_support": 0.3333,
               "reference_hits": 3, "unique_accessions": 3 },
  "warnings": ["Multiple species share the supported genus; species-level identification is not supported."]
}
```

An optional local taxonomy mapping TSV supplies lineage information:

```
taxid	scientific_name	rank	parent_taxid	full_lineage
562	Escherichia coli	species	561	Bacteria;...;Escherichia coli
```

When a mapping file is provided, the tool walks each taxon's `parent_taxid` chain
so ancestors keep their real taxonomy IDs. Multiple semicolon-separated `staxids`
/ `sscinames` on one BLAST row are resolved independently and are never silently
collapsed to the first value.

Run:

```bash
python main.py taxonomy \
  --input output/local_blast/blast_results.tsv \
  --taxonomy-map taxonomy.tsv \
  --top-n 10 \
  --min-consensus 0.8 \
  --out-dir output/taxonomy
```

Schema selection: `--schema auto` infers by column count only (12 → standard,
11 → extended). `blastn_local_v1` files are also 12 columns, so if every row
fails to parse under `standard`, the CLI deterministically re-parses using the
`blast_run.json` written next to `blast_results.tsv` by `blast-run` (this is not
arbitrary guessing; it is an explicit, recorded fallback). You can always pass
`--schema blastn_local_v1` explicitly. The browser page cannot read sibling
files, so its example sets the schema explicitly.

Outputs:
- `taxonomy_analysis.json` — full per-query consensus report (status, supported
  rank, consensus taxon, candidate species, support fractions, evidence, warnings).
- `taxonomy_summary.csv` — flattened per-query summary for review.

For each query the tool:
1. Groups BLAST hits by query ID and keeps quality-filtered hits.
2. Ranks candidates by bitscore, then E-value, identity, and coverage.
3. Selects top-N candidates, preserving exact ties at the cutoff.
4. Computes the lowest common taxonomic ancestor (LCA) and support fractions at
   each rank over unique species-level taxonomic units (not raw hit counts, so a
   species with many reference records cannot dominate merely through accessions).
5. Reports queries with no hits explicitly as insufficient evidence.

Support fractions are evidence-support fractions: they express what fraction of
the unique species-level taxonomic units agree at a given rank. They are NOT
calibrated probabilities of correct identification. BLAST similarity is not
proof of species identity. A species-level identification is only reported when
the lineages support one; otherwise the tool reports genus-level agreement,
higher-rank-only agreement, or conflicting/insufficient evidence.

Browser: open `taxonomy.html` (linked from Tools). Upload or paste a BLAST TSV,
optionally upload a taxonomy mapping TSV, set top-N and consensus thresholds,
and inspect per-query results, evidence tables, candidate species, and caveats.
Download JSON or summary CSV. The "Load example" button loads a documented
`blastn_local_v1` sample and sets the schema explicitly.

Online NCBI resolution (`--online`) is implemented in the Python CLI via
E-utilities (batched, rate-limited, cached) but has only been exercised by
mocked tests, not by live network requests. The browser tool does not perform
live NCBI requests; it requires a local mapping file for lineage resolution.

The defaults (`--top-n 10`, `--min-consensus 0.8`) are experimental settings,
not universal biological standards.

## 8. Deploy the static MVP to Cloudflare Pages (free plan)

This milestone is static-only; it does not need Workers, D1, R2, a server, or paid infrastructure.

Cloudflare Pages configuration is provided in `web-platform/wrangler.toml` and `web-platform/public/_headers` (CSP without inline scripts).

Deploy with Wrangler (optional):
```bash
cd web-platform
npx wrangler pages deploy public
```

Or connect the GitHub repository in the Cloudflare dashboard:
1. Push the repository to GitHub.
2. In Cloudflare, create a Pages project and connect the GitHub repository.
3. Set the project root directory to `web-platform`.
4. Select no framework / static HTML.
5. Leave the build command empty.
6. Set the build output directory to `public`.
7. Deploy and use the free `*.pages.dev` address.

The current milestone has no Pages Functions. When BLAST integration is added, a `functions/` directory will be introduced at the Pages project root and the deployment configuration will be updated accordingly. Use the Cloudflare Free plan and monitor its current quotas. A custom domain is optional and domain registration may cost money.

## 9. Project architecture

```text
smart-bioinformatics-toolkit/
├── shared/
│   ├── sequence-rules.json
│   └── test-cases/
├── python-engine/
│   ├── main.py
│   ├── requirements.txt
│   ├── src/smartbio/
│   └── tests/
├── web-platform/
│   ├── public/
│   │   ├── index.html
│   │   ├── css/
│   │   └── js/
│   ├── functions/
│   ├── tests/
│   └── package.json
└── docs/
```

The Python CLI and browser app use the same documented validation rules and test fixtures. The browser app processes files locally. The Python CLI is the local/research pipeline foundation.

## 10. Development rules for future contributors

- Keep the frontend framework-free: HTML, CSS and vanilla JavaScript ES modules only. Do not introduce React, Vue, Angular or a frontend build framework.
- Keep quick tools independently usable. Do not force users through a single full pipeline.
- Do not upload user sequences unless a feature explicitly requires a remote service and the user has initiated that action.
- Do not store FASTA files in Cloudflare R2; R2 is intentionally excluded.
- Do not run BLAST+ inside Cloudflare Workers. The later web BLAST feature should use NCBI remote BLAST within its usage rules; local BLAST+ belongs in the Python CLI.
- Keep scientific interpretations evidence-based. BLAST similarity is not proof of organism identity or gene function.
- Add tests for both Python and JavaScript whenever validation or metric behavior changes.
- Preserve compatibility between Python and JavaScript output schemas.
- Record third-party dependencies and their licences before copying or adapting source code.

## 11. Milestone 0.5.0: identification verdicts and benchmark

New in this milestone:

- **Verdict layer** (Python and JavaScript, shared fixtures): species / group / genus / below-threshold / insufficient-evidence verdicts with reasons, cautions and a disclaimer. See `docs/SCIENTIFIC_RULES.md`.
- **Difficult-group warnings** from `shared/difficult-groups.json` (Bacillus cereus group, mitis group streptococci), each with a cited source.
- **Taxonomy page** shows the verdict per query; JSON and CSV exports include verdict columns.
- **CLI:** `taxonomy` gains `--species-threshold`, `--verdict-min-coverage`, `--min-query-length`, `--difficult-groups`. New `benchmark-queries` and `benchmark-eval` commands compare the plain top-hit method with verdicts against a truth table. See `docs/BENCHMARK_PROTOCOL.md`.

```bash
cd python-engine
python main.py taxonomy --input ../shared/test-cases/verdict_pipeline.tsv \
  --taxonomy-map ../shared/test-cases/verdict_pipeline_map.tsv --schema blastn_local_v1 --out-dir output/verdict-demo
python main.py benchmark-queries --reference reference_16S.fasta --mode heldout --n 50 --out-dir output/bench
python main.py benchmark-eval --analysis output/verdict-demo/taxonomy_analysis.json --truth output/bench/truth.tsv --out-dir output/bench-eval
python -m pytest -q
cd ../web-platform && node --test tests/*.test.mjs
```

## 12. Next milestone

See `docs/MILESTONE_0.5.0.md` (limitations) and `docs/OPENCODE_HANDOFF_PROMPT_0.5.0.md` (next tasks). Highlights: run the benchmark on real NCBI 16S data, build a taxonomy map from NCBI taxdump, add a near-threshold caution, then NCBI remote BLAST through a Pages Function and Cloudflare deployment.
