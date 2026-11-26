# M7.13 protein fixture provenance

These four files are **offline fixtures** for unit/E2E tests only. They are a
saved copy of genuine, read-only responses captured during the M7.13 contract
verification (2026-11-26):

- `P04637.fasta` — genuine UniProt FASTA for human TP53 (`sp|P04637|P53_HUMAN`).
- `uniprot-P04637.json` — genuine UniProt REST JSON (`fields=accession,protein_name,sequence,length`).
- `interpro-protein-P04637.json` — genuine InterPro protein metadata JSON (with `extra_fields=sequence`).
- `matches-P04637.json` — genuine InterPro Matches JSON for MD5 `C133DFCE69F606F20865E9008199F852` (32 matches).

The content is verbatim saved evidence, but **every test that uses it is
offline**: provider calls are stubbed in memory and no test makes a live EBI or
UniProt request. Any other fixture inside the test files (short synthetic
FASTA, malformed JSON, fake job ids, etc.) is explicitly labelled `FIXTURE`
and is not a scientific result. No test output is presented as a fresh
scientific annotation.
