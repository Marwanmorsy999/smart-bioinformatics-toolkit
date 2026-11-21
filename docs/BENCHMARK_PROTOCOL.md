# Benchmark protocol (draft)

Goal: measure how often the plain top-hit method names the wrong species compared with the verdict layer, and how often the verdict layer abstains.

## Two scenarios

1. **noisy** (`--mode noisy`): partial, noisy copies of records that remain in the database. The true record is present, so top hit is usually right. Use this only as a sanity check.
2. **heldout** (`--mode heldout`): the query source records are excluded from the search, so the true species is missing. This is the realistic hard case: a plain top hit confidently names a relative. This is the headline benchmark.

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
