# Benchmark protocol (draft)

Goal: measure how often the plain top-hit method names the wrong species compared with the verdict layer, and how often the verdict layer abstains.

## Two scenarios

1. **noisy** (`--mode noisy`): partial, noisy copies of records that remain in the database. The true record is present, so top hit is usually right. Use this only as a sanity check.
2. **heldout** (`--mode heldout`): the query source records are excluded from the search, so the query source accessions are absent; the same species may still be present through other strains. This is the hard case: a plain top hit confidently names a relative. This is the headline benchmark.

## Steps with real data

1. Obtain NCBI's curated 16S reference (RefSeq targeted loci, type material). Record the download date and release. Check the current FTP path on https://www.ncbi.nlm.nih.gov/refseq/targetedloci/ before downloading.
2. Generate queries and truth:
   `python main.py benchmark-queries --reference ref16S.fasta --mode heldout --n 100 --length 500 --substitution-rate 0.005 --seed 1 --out-dir bench`
   This writes `queries.fasta`, `truth.tsv`, `heldout_seqids.txt` and `reference_without_queries.fasta`.
3. Search: either build a BLAST database from `reference_without_queries.fasta`, or use a prebuilt DB with `blastn -negative_seqidlist heldout_seqids.txt` (needs a binary seqid list: use `blastdb_aliastool -seqid_file_in heldout_seqids.txt -seqid_file_out heldout.bsl`). Output format must be the `blastn_local_v1` schema (see README).
4. Build a taxonomy mapping for the reference accessions (OPEN TASK: a script that converts NCBI taxdump `rankedlineage.dmp` plus accession-to-taxid into the mapping TSV).
   Download the NCBI taxonomy dump from https://ftp.ncbi.nlm.nih.gov/pub/taxonomy/taxdump.tar.gz
   (rankedlineage.dmp, nodes.dmp) and an accession-to-taxid file such as
   https://ftp.ncbi.nlm.nih.gov/pub/taxonomy/accession2taxid/nucl_gb.accession2taxid.gz.
   Then run:
   python scripts/build_taxonomy_map.py --rankedlineage rankedlineage.dmp --nodes nodes.dmp --accessions accessions.tsv --output taxonomy_map.tsv
5. `python main.py taxonomy --input hits.tsv --taxonomy-map map.tsv --schema blastn_local_v1 --query-fasta bench/queries.fasta --out-dir bench/tax`
6. `python main.py benchmark-eval --analysis bench/tax/taxonomy_analysis.json --truth bench/truth.tsv --out-dir bench/eval`

## Running the benchmark
Use `scripts/run_benchmark.py` to execute the full pipeline across seeds:
```
python scripts/run_benchmark.py --reference ref16S.fasta --taxonomy-map taxonomy_map.tsv --taxid-map taxid_map.tsv --out-dir bench --seeds 1,2,3 --n 100
```
The script fails loudly if BLAST+ or required inputs are missing. No real numbers are produced by the repository; run it with real NCBI data.

- Compare `wrong_rate_among_calls` and `wrong` for both methods, together with `species_call_rate`. Fewer wrong calls obtained by abstaining on everything is not an improvement.
- `group_level_containing_truth` checks that group verdicts actually contain the true species.
- Report the seed, query length, substitution rate, database release and settings. Repeat over several seeds and report the spread.

## Caveats to state in the report

- Simulated substitutions are not real sequencing error or real strain variation.
- Held-out species from one database release says nothing about other databases.
- Truth comes from FASTA headers, which can themselves be wrong.

## Verified real pipeline (executed 2026-11-24; see results in benchmark_data/RESULTS.md)

The draft steps above are superseded by the following verified chain. The 2026-11-24 NCBI taxdump contains `nodes.dmp` and `names.dmp` but **no** `rankedlineage.dmp`; the accession-to-taxid file was extracted from `bacteria.16SrRNA.gbff.gz` (`/db_xref="taxon:NNN"` fields).

```bash
# 1. taxonomy map (nodes + names, fail-loud if neither name source supplied)
python scripts/build_taxonomy_map.py --nodes benchmark_data/taxdump_extract/nodes.dmp --names benchmark_data/taxdump_extract/names.dmp --accessions benchmark_data/accession2taxid.tsv --output benchmark_data/taxonomy_map.tsv
# 2. taxid map for makeblastdb (requires makeblastdb -parse_seqids, handled by run_benchmark.py)
#    benchmark_data/taxid_map.tsv: accession<TAB>taxid, header removed
# 3. full pipeline (held-out headline; 5 seeds; several lengths/rates/indel)
python scripts/run_benchmark.py --reference benchmark_data/bacteria.16SrRNA.fna --taxonomy-map benchmark_data/taxonomy_map.tsv --taxid-map benchmark_data/taxid_map.tsv --out-dir benchmark_data/benchmark_runs_expanded/heldout_L500_s0.5 --mode heldout --seeds 1,2,3,4,5 --n 200 --length 500 --substitution-rate 0.005
# add --length 300 / 1000, --substitution-rate 0.01, --indel-rate 0.01 for other conditions
# 4. regenerate RESULTS.md from saved JSON (never hand-edit)
python scripts/generate_results.py
```

Saved raw outputs and exact commands (logs) are under `benchmark_data/`: `benchmark_runs_heldout4/`, `benchmark_runs_noisy2/`, `benchmark_runs_expanded/`, `run_*.log`. `RESULTS.md` is generated from these by `scripts/generate_results.py`.
