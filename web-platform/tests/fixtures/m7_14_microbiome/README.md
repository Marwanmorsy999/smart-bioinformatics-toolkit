# Labelled M7.14 fixtures

All files in this directory are **tiny labelled subsets** created only to test
parsers. They reproduce the SHAPE of official Moving Pictures 2026.10 outputs;
they are NOT the real tutorial result and must never be presented as a real
analysis. The live demonstration uses the verified official files:

- `sample-metadata.tsv` (34 samples, 2,096 B, SHA-256 `245f8e389ddf3dd05a95d870d214de918a06d03c5ce17750860446e09f9a7cc6`)
- `emp-single-end-sequences.zip` (29,096,655 B, SHA-256 `992740724f9a8000e5d81bc23a6c2bb74e4aed4cc3542768a220a36bae22d373`)

Observed quality from the real FASTQ (independent support for trim-left 0,
trunc-len 120): Q1=36.66, Q10=37.70, Q30=38.53, Q60=36.59, Q90=30.80,
Q100=28.37, Q110=22.65, Q115=21.70, Q120=19.56, Q125=16.66, Q130=13.52,
Q140=5.41, Q150=3.79. The tutorial rarefaction depth (1103) is NOT copied as a
result; a depth is derived from real counts or left null.
