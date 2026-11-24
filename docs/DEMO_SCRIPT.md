# Demo script — Smart Bioinformatics AI

**Updated:** 2026-11-24 after the vision reset.
**Evidence status:** every number shown is produced by a command below; no figure is copied from a missing file.

---

## A. Baseline (preserved milestone-0.5 functionality)

```bash
cd python-engine
python -m pytest -q                      # 156 passed (130 original + 26 AI-agent tests)
python main.py analyze --input ../shared/test-cases/dna_valid.fasta --type dna --out-dir output/demo-run
cd ../web-platform
npm test                                 # 113 passed (103 original + 10 AI-contract tests)
```

The original four pages (validate/stats, BLAST TSV, taxonomy, benchmark) are unchanged and still work locally.

## B. AI MVP — real end-to-end execution (no LLM key, no network)

This is the honest, reproducible core demo. It runs the **real** existing `smartbio` statistics code through the AI agent pipeline and produces validated artifacts, an evidence-bounded explanation, and a reproducible report.

**1. Create a job file** (or use the one already at `D:\DevCache\Temp\opencode\mvp_demo_job.json`):

```json
{
  "id": "job_demo1",
  "plan_id": "plan_demo1",
  "step_id": "step_1",
  "tool_id": "sequence-stats.profile",
  "params": { "sequence_type": "dna" },
  "inputs": {
    "dataset_id": "ds_demo1",
    "fasta_text": ">dna_001 Example canonical DNA sequence\nATGCGTACGTAGCTAGCTAGCTAG\n>dna_002 DNA with valid IUPAC ambiguity\nATGCRYSWKMBDHVNACGT\n>dna_003 Another canonical sequence\nGGGGCCCCAAAATTTT\n",
    "filename": "dna_valid.fasta"
  },
  "status": "queued",
  "backend": "local-python",
  "created_at": "2026-11-24T00:00:00Z"
}
```

**2. Execute:**

```bash
cd python-engine
set PYTHONPATH=src          # Windows PowerShell: $env:PYTHONPATH = ".\src"
python -m smartbio.aiagent.agent --job-file <job.json> --out-file <result.json>
```

**3. Observed result (verified 2026-11-24, see `docs/discovery/TEST_REPORT.md`):**

- `status: succeeded`, `execution_mode: real`, `validation.status: pass`
- Artifacts: `validation.json`, `statistics.json`, `analysis.json`, `statistics.csv`, `report.html`
- Real values: 3 valid records, 59 nt total, mean GC 50.0% — each explanation finding carries an `artifact` + `field_path` pointing at the value.
- Report HTML includes Reproducibility, Limitations, Validation and Provenance sections.

**4. Other agent modes:**

```bash
# Poll a deployed Worker control plane (requires X-Agent-Token / AI_AGENT_TOKEN)
python -m smartbio.aiagent.agent --loop --url http://localhost:8787 --token <agent-token>
```

## C. Browser AI workspace (requires Worker + D1)

```bash
cd web-platform
wrangler d1 migrations apply <your-d1-db> --local     # apply 0001 + 0002
wrangler dev --local
# open http://localhost:8787/ai.html
```

Flow in the UI: paste/upload FASTA → type a question → review the generated plan → Approve or Decline → poll status → read results, validation flags, limitations and explanation → download JSON/CSV/HTML/provenance. The UI always displays an `execution_mode` badge; a queued job without a connected agent stays visibly "queued" rather than showing invented results.

## C2. Phylogenetics on the website (browser only)

Start the Worker and D1 as in section C, then open `http://localhost:8787/ai.html`.

1. Upload or paste a DNA FASTA with at least three unique sequences of 50+ bp.
2. Click the **Phylogenetics · build a tree** example prompt — it fills the question box with "Build a phylogenetic tree from my FASTA and show me the alignment and report" — or type your own request using words such as *tree*, *phylogenetic*, *alignment* or *evolutionary*.
3. Click **Build plan** and review it. The plan has exactly one local step, `phylogenetics.workflow`, with `sequence_type: dna`, no external egress and no consent requirement. If that composite tool is not registered on this deployment, the workspace shows "Phylogenetic analysis is not available on this deployment." and creates no plan or job.
4. Click **Approve and queue jobs**. A connected local execution agent claims the job; the page polls until a validated result arrives.
5. In the result panel, read the explanation, validation and limitations. The Artifacts list shows `alignment.fasta`, `tree.nwk`, `tree.svg` and `phylo_report.html` with individual download links, alongside the overall JSON, CSV, HTML report and provenance links.

This is a browser-only flow against the deployed Worker — no `--job-file` CLI step is needed. The alignment is a progressive heuristic and the tree is neighbor-joining from identity distances: research use only, not a clinical result and not a publication-grade tree.

## D. Historical benchmark — DO NOT QUOTE UNTIL REGENERATED

Earlier docs in this repository quoted held-out results (top-hit 143.3 wrong/200; 98.65% cutoff 38.0 wrong/87.7 calls; toolkit verdict 12.7 wrong/49.7 calls, 150.3 abstentions) and referred to `benchmark_data/RESULTS.md`.

**That file is absent and was never tracked** (`docs/discovery/AUDIT_docs_consistency.md`). Those figures are **UNVERIFIED in this tree** and must not be presented in slides, README, or external communication. To regenerate, follow `docs/BENCHMARK_PROTOCOL.md`, commit the inputs and outputs, then update `docs/EVIDENCE_LEDGER.md`.

## D2. Optional 9Router LLM phrasing (opt-in, not required)

A local OpenAI-compatible proxy is available at `http://127.0.0.1:20128/v1` with the
`NINEROUTER_API_KEY` environment variable. It is **disabled by default**; the demo in
section B makes no network calls. To enable model-assisted *phrasing* of the already
validated explanation:

```bash
set AI_LLM_PROVIDER=ninerouter
# key is read from NINEROUTER_API_KEY in the environment; never stored in code or logs
# optional overrides: NINEROUTER_BASE_URL, NINEROUTER_MODEL (default: auto), AI_LLM_TIMEOUT_SECONDS
```

Only validated finding text is sent (never raw sequences). Every model-produced string
must still pass the deterministic number/citation gate; on failure the platform silently
uses the deterministic explanation and records `llm_phrase_rejected`. When accepted, the
report records the model name and notes that an external model assisted with phrasing.

## E. Known limits of the MVP demo

- The `identify_taxa` intent profiles the FASTA and declares a local-database requirement; it does **not** produce taxonomic calls from a FASTA alone. Real taxonomy needs a BLAST TSV (upload one or run `main.py blast-run` with a local `blastn` + database).
- The deterministic planner/explainer is used by default. An LLM provider is optional and not required for any step above.
- No uploaded data is sent to a third party in this demo. NCBI BLAST remains available through the original opt-in endpoints, now behind the plan/consent gate in the AI workspace.
