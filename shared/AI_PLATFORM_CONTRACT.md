# AI Platform MVP — machine contract (v1)

This is the single source of truth for the MVP wire format. Both the Worker (JS) and the local agent (Python) implement it exactly. Do not invent extra required fields.

## 1. Plan object (stored in `plans.plan_json`)

```json
{
  "plan_id": "plan_<hex>",
  "request_id": "req_<hex>",
  "domain": "sequence-analysis | microbiome-16s",
  "intent": "validate_and_profile | identify_taxa",
  "confidence": 0.8,
  "created_at": "ISO-8601",
  "steps": [
    {
      "id": "step_1",
      "tool_id": "sequence-stats.profile",
      "backend": "local-python",
      "params": { "sequence_type": "dna" },
      "inputs": ["dataset:<dataset_id>"],
      "external_egress": false,
      "consent_required": false,
      "estimated_seconds": 5
    }
  ],
  "external_services": [],
  "consents_required": [],
  "limitations": ["..."]
}
```

Rules: `tool_id` MUST exist in the tool registry; `external_egress: true` MUST imply `consent_required: true`.

## 2. Job object (D1 `jobs`)

```json
{
  "id": "job_<hex>",
  "plan_id": "plan_<hex>",
  "step_id": "step_1",
  "status": "queued",
  "tool_id": "sequence-stats.profile",
  "params": { "sequence_type": "dna" },
  "inputs": { "dataset_id": "ds_<hex>", "fasta_text": "...", "filename": "sample.fasta" },
  "consent": { "granted": false, "scope": null },
  "backend": "local-python",
  "created_at": "ISO-8601"
}
```

`fasta_text` is included for the MVP so the local agent can run without a shared filesystem. Size capped at 64 KiB by the Worker.

## 3. Result submission (agent → `POST /api/ai/jobs/:id/result`)

```json
{
  "job_id": "job_<hex>",
  "status": "succeeded | failed",
  "execution_mode": "real | mock",
  "artifacts": [
    { "name": "analysis.json", "kind": "json", "sha256": "...", "content": "<text>" }
  ],
  "provenance": {
    "run_id": "job_<hex>",
    "step_id": "step_1",
    "tool": { "id": "sequence-stats.profile", "version": "1.0.0", "backend": "local-python" },
    "input": { "dataset_id": "ds_...", "sha256": "...", "filename": "..." },
    "parameters": { "sequence_type": "dna" },
    "database": { "name": null, "release": null, "retrieved_at": null },
    "output": { "artifact_names": ["analysis.json"], "sha256": "..." },
    "timing": { "started_at": "...", "finished_at": "..." },
    "execution_mode": "real"
  },
  "validation": { "status": "pass | warn | fail", "flags": ["..."], "checked_rules": ["..."] },
  "explanation": {
    "summary": "...",
    "findings": [ { "text": "...", "artifact": "analysis.json", "field_path": "summary.total_records" } ],
    "limitations": ["..."],
    "references": [ { "key": "...", "title": "...", "url": "...", "verified": true } ],
    "uncertainty": "none | low | moderate | high"
  },
  "logs": ["..."]
}
```

## 4. Registry tool IDs (MVP)

| tool_id | Description | Params |
|---|---|---|
| `sequence-stats.validate` | FASTA validation | `sequence_type: dna|protein` |
| `sequence-stats.profile` | FASTA validation + statistics | `sequence_type: dna|protein` |
| `microbiome-16s.blast-parse` | Parse BLAST TSV (requires a TSV dataset) | `schema: auto|standard|extended|blastn_local_v1`, `min_identity`, `min_query_coverage` |
| `microbiome-16s.taxonomy` | Consensus/verdict from BLAST TSV | above + `top_n`, `min_consensus`, `species_threshold` |

MVP planner maps intents:
- "profile / stats / GC / validate / check my fasta" → `sequence-stats.profile`
- "identify / taxa / taxonomy / classify / blast" with DNA FASTA → `sequence-stats.profile` then `microbiome-16s` note (real BLAST needs a local DB; the plan declares `requires: local_database` and the UI tells the user; no mock data is presented as real).

## 5. API endpoints (Worker)

| Method | Path | Behaviour |
|---|---|---|
| POST | `/api/ai/requests` | body `{text, fasta, filename, project_id?}` → validates FASTA, infers intent, creates plan; returns `{request_id, plan_id, plan, dataset_id, preflight}` |
| GET | `/api/ai/plans/:id` | plan JSON |
| POST | `/api/ai/plans/:id/approve` | body `{approvals: [{step_id, consent_granted}], consents: [...]}` → creates jobs; returns `{job_ids}` |
| GET | `/api/ai/jobs?agentId=...` | queued jobs for agent (token header `X-Agent-Token`); marks them `running` |
| POST | `/api/ai/jobs/:id/result` | result object above → stores, validates gate, builds report |
| GET | `/api/ai/runs/:id` | `{plan, jobs, artifacts, validation, explanation, report_url}` |
| GET | `/api/ai/runs/:id/report` | HTML report |
| GET | `/api/ai/runs/:id/provenance` | provenance JSON |
| GET | `/api/tools` | registry tool list with availability |

`execution_mode` MUST be present on every job/run response.

## 6. D1 tables (`0002_ai_platform.sql`)

`projects`, `datasets`, `ai_requests`, `plans`, `approvals`, `jobs`, `tool_runs`, `artifacts`, `references`, `report_runs`, `audit_events` — see `SYSTEM_ARCHITECTURE.md` §5. For the MVP, artifact `content` is stored inline as TEXT in `artifacts`; R2 is optional.

## 7. File ownership

- **JS/Worker agent owns:** `web-platform/**`, `shared/schemas/**`, `shared/plugins/**`, `shared/AI_PLATFORM_CONTRACT.md` (do not edit contract without coordinating).
- **Python agent owns:** `python-engine/**` only.
- **Orchestrator owns:** root docs, `docs/**`, contract arbitration.
