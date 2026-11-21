$ErrorActionPreference = "Stop"
python -m pip install -r requirements.txt
python main.py analyze `
  --input ..\shared\test-cases\dna_valid.fasta `
  --type dna `
  --out-dir output\demo-run
Write-Host "Demo complete. See python-engine\output\demo-run"
