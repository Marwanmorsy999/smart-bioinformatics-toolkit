# Demo script (Milestone 1.0.0)

All numbers below were inserted from `benchmark_data/RESULTS.md`, which is generated from saved benchmark output files by `scripts/generate_results.py`. Do not hand-edit.

## Quickstart (clean clone)

```bash
cd python-engine
python -m venv .venv && source .venv/bin/activate   # Windows: .venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
python -m pytest -q -rs
python main.py analyze --input ../shared/test-cases/dna_valid.fasta --type dna --out-dir output/demo-run
cd ../web-platform
python -m http.server 8000 --directory public
# open http://localhost:8000
node --test tests/*.test.mjs
```

## Real benchmark (requires NCBI BLAST+ and the downloaded 16S RefSeq data + taxdump)

```bash
python ../scripts/build_taxonomy_map.py --nodes benchmark_data/taxdump_extract/nodes.dmp --names benchmark_data/taxdump_extract/names.dmp --accessions benchmark_data/accession2taxid.tsv --output benchmark_data/taxonomy_map.tsv
python ../scripts/run_benchmark.py --reference benchmark_data/bacteria.16SrRNA.fna --taxonomy-map benchmark_data/taxonomy_map.tsv --taxid-map benchmark_data/taxid_map.tsv --out-dir benchmark_data/repro --mode heldout --seeds 1,2,3 --n 200 --length 500 --substitution-rate 0.005
```

## Verified live deployment (Cloudflare Pages Free, deploy stage success per Cloudflare API)

https://4e5048a8.smart-bioinformatics-toolkit.pages.dev

## Real results - held-out (headline)

| Method | Calls/200 (mean) | Wrong calls (mean) | Wrong rate among calls | Abstentions (mean) |
|---|---|---|---|---|
| Plain top hit | 200.0 | 143.3 | 0.717 | 0.0 |
| Top hit + 98.65% cutoff | 87.7 | 38.0 | 0.431 | 112.3 |
| Toolkit verdict | 49.7 | 12.7 | 0.257 | 150.3 |

Wilson 95% CI on correct-call rate (seed 1): top [0.2315, 0.3564], cutoff [0.4374, 0.6321], verdict [0.6113, 0.8445].

## Real results - noisy (sanity)

| Method | Calls/200 (mean) | Wrong calls (mean) | Wrong rate among calls | Abstentions (mean) |
|---|---|---|---|---|
| Plain top hit | 200.0 | 9.0 | 0.045 | 0.0 |
| Top hit + 98.65% cutoff | 196.7 | 9.0 | 0.046 | 3.3 |
| Toolkit verdict | 142.0 | 1.3 | 0.010 | 58.0 |

## Limitations

Truth from FASTA headers; one database release; simulated substitutions are not real sequencing error; query region is first 500 nt; group-level containment 0 in these runs. Full provenance, hashes, commands and per-seed Wilson intervals: `benchmark_data/RESULTS.md`.
