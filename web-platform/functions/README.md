# Future Pages Functions

This milestone is static-only and does not need backend functions.

When adding remote BLAST, create Pages Functions under this project root (for example `functions/api/blast/submit.js`). Keep NCBI requests asynchronous, enforce the provider's submission and polling policy, validate inputs and avoid storing user FASTA files in cloud storage. Do not run the local BLAST+ executable inside Workers.
