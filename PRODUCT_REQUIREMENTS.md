# Product Requirements — Smart Bioinformatics AI

**Version:** 1.0 (vision reset, 2026-11-24)
**Owner:** Platform team (orchestrated agents)
**Linked vision:** `PRODUCT_VISION.md`
**Conventions:** `MUST` / `SHOULD` / `MAY` are normative. `MVP` marks requirements in the first end-to-end release. Acceptance criteria are testable.

---

## 1. Scope

This document specifies the **platform** requirements, not the biological algorithms of a specific domain. Domain-specific algorithms live in plugin manifests (`shared/plugins/<domain>.json`) and the plugin's own documentation (`docs/plugins/<domain>/`, to be created with the first external domain plugin in M5).

## 2. Functional requirements

### 2.1 Request understanding (AI research assistant)

| ID | Requirement | Priority | Acceptance criteria |
|---|---|---|---|
| FR-1.1 | `MVP` Accept a natural-language research request together with an uploaded dataset. | Must | A user can submit free text plus one or more files; the request is persisted with an ID and timestamp. |
| FR-1.2 | `MVP` Validate uploaded files before planning: format, size, encoding, sequence alphabet. | Must | Invalid FASTA is rejected with a specific error derived from the existing `smartbio.fasta` validator; no plan is produced for invalid input. |
| FR-1.3 | Infer the scientific domain and intent (e.g. "identify taxa", "compute GC", "run BLAST") from the request; expose the inferred intent to the user for confirmation. | Must (MVP: 16S/sequence intents only) | The plan shows `domain`, `intent`, and `confidence`; low-confidence requests ask a clarifying question instead of guessing. |
| FR-1.4 | Ask clarifying questions when required parameters are missing (sequence type, database, threshold). | Should | If `--type` is ambiguous the system asks rather than defaulting silently. |
| FR-1.5 | Maintain a multi-turn conversation scoped to a project, with the analysis history as context. | Later | Prior runs are retrievable and referenced in follow-up requests. |

### 2.2 Planning and approval

| ID | Requirement | Priority | Acceptance criteria |
|---|---|---|---|
| FR-2.1 | `MVP` Produce a structured, machine-readable **execution plan** before any tool runs: steps, tool IDs, parameters, estimated data egress, and external services contacted. | Must | Plan validates against `shared/schemas/plan.schema.json`; UI renders every step before execution. |
| FR-2.2 | `MVP` Require explicit user approval before executing any step that (a) transmits data to a third party, (b) downloads a database, or (c) runs a long job. | Must | No job row is created and no network call is made until an approval record exists; tests assert this with a fake external API. |
| FR-2.3 | Show the plan in human-readable language alongside exact command/parameter values. | Must | Each step displays both a sentence and the concrete tool invocation. |
| FR-2.4 | Allow the user to edit parameters and re-plan. | Should | Changing a threshold regenerates the plan without re-uploading data. |
| FR-2.5 | Estimate cost/free-quota impact of each external step and display it. | Should | Plan lists which steps use free APIs and which would require credentials. |

### 2.3 Tool registry

| ID | Requirement | Priority | Acceptance criteria |
|---|---|---|---|
| FR-3.1 | `MVP` Provide a registry of tools with stable IDs, version, input/output JSON Schemas, capabilities, and execution backend. | Must | Registry loads from plugin manifests; `GET /api/tools` lists tools with schemas; unknown tools cannot be planned. |
| FR-3.2 | Validate every plan step against the tool's input schema before execution. | Must | A step with a missing/invalid parameter is rejected at plan-validation time. |
| FR-3.3 | Support multiple backends per tool (local Python, local binary, remote API, Galaxy) selected by capability and availability. | Should | A tool manifest can declare >1 backend with capability requirements; planner chooses an available one. |
| FR-3.4 | Report tool health/availability (e.g. is `blastn` installed?). | Should | `GET /api/tools` includes `available: true|false` and reason. |

### 2.4 External API agents

| ID | Requirement | Priority | Acceptance criteria |
|---|---|---|---|
| FR-4.1 | Wrap each external biological database behind an agent with a validated request/response contract. | Must | Each integration has a module, a schema for responses, and tests using recorded fixtures. |
| FR-4.2 | `MVP` NCBI BLAST integration must remain functional; new integrations must follow the same consent + rate-limit pattern. | Must | Existing submit/status/results endpoints pass their tests; consent flag required in the plan for `external` steps. |
| FR-4.3 | Never transmit uploaded data to a third party without explicit, per-step user consent. | Must | Automated test: plan containing an external step cannot be executed until `consent.granted === true` for that step. |
| FR-4.4 | Enforce provider rate limits and identify the platform with contact info where required. | Must | Configurable rate limiter and `email`/`tool` parameters where the API asks for them. |
| FR-4.5 | Record API response metadata (endpoint, version/date, retrieval timestamp) in provenance. | Must | Provenance record includes `source.url`, `source.retrieved_at`, `source.release` when known. |

### 2.5 Execution engine and jobs

| ID | Requirement | Priority | Acceptance criteria |
|---|---|---|---|
| FR-5.1 | `MVP` Execute approved steps on an execution backend appropriate to the workload: in-process for trivial JS, **local Python agent** for scientific tools. | Must | A FASTA analysis job is actually executed by `python-engine`, producing real numeric output; mocked execution is clearly labelled. |
| FR-5.2 | Persist job state transitions (`queued → running → succeeded|failed|cancelled`) with timestamps. | Must | D1 rows show the full transition history; UI shows current state. |
| FR-5.3 | Support cancellation and timeouts. | Should | A job exceeding its declared timeout is marked `failed` with a timeout reason. |
| FR-5.4 | Make steps idempotent (same input + parameters → same output hash). | Should | Re-running a step produces an identical output hash; nondeterministic steps declare it. |
| FR-5.5 | Stream human-readable progress logs to the UI. | Later | Job log endpoint returns ordered log lines. |

### 2.6 Analysis agents and validation

| ID | Requirement | Priority | Acceptance criteria |
|---|---|---|---|
| FR-6.1 | `MVP` Run a **validation agent** over every tool output before it is shown or explained. | Must | Validation checks schema conformance, internal consistency, empty/degenerate results, and threshold sanity; failures block the explanation. |
| FR-6.2 | Detect suspicious outputs (e.g. 100% identity across all queries, every query "no hit", impossible GC, verdict without supporting hits) and flag them. | Must | At least one fixture per suspicious-output class has a test. |
| FR-6.3 | Validation must never modify scientific values; it annotates and blocks. | Must | Tests assert output payload is byte-identical apart from validation metadata. |
| FR-6.4 | Domain-specific validation rules are supplied by plugins. | Must | Plugin manifest declares `validation_rules`; engine applies them generically. |

### 2.7 Explanation and reporting

| ID | Requirement | Priority | Acceptance criteria |
|---|---|---|---|
| FR-7.1 | `MVP` Generate an explanation that uses **only** values present in validated tool outputs and curated references. | Must | A citation checker rejects any DOI/PMID/title not in the evidence ledger; numbers are cross-checked against artifacts. |
| FR-7.2 | `MVP` Produce a reproducible HTML report containing: request, plan, approvals, tool versions, parameters, input hash, database/release info, results, validation flags, and references. | Must | Report matches `docs/CONTRACTS.md` metadata keys; existing `report.py` conventions reused where possible. |
| FR-7.3 | Report must state limitations and uncertainty, including 16S resolution limits where relevant. | Must | Template includes a mandatory `Limitations` section sourced from plugin manifest `limitations`. |
| FR-7.4 | Offer downloadable artifacts (JSON, CSV, HTML) and a machine-readable provenance bundle. | Must | Each completed run exposes 3 download links + `provenance.json`. |
| FR-7.5 | If an LLM provider is unavailable, fall back to a deterministic template explanation that is still evidence-bounded. | Must (MVP) | Demo works with no API key; explanation text derived from artifact fields. |

### 2.8 Project manager and provenance

| ID | Requirement | Priority | Acceptance criteria |
|---|---|---|---|
| FR-8.1 | `MVP` Maintain projects containing datasets, analyses, workflow versions, and history. | Must | D1 schema with foreign keys; project page lists runs. |
| FR-8.2 | `MVP` Record a provenance entry for **every** tool/API invocation: actor (user or agent), input refs + hashes, tool id + version, parameters, database/release, output refs + hashes, start/end time. | Must | `provenance.json` reconstructs the full DAG of a run; a test asserts no step is missing. |
| FR-8.3 | Keep an append-only audit log of approvals, external transmissions, and failures. | Must | Audit log cannot be edited through the API. |
| FR-8.4 | Allow export/import of a project bundle for reproducibility. | Later | Bundle re-runs produce the same hashes. |
| FR-8.5 | Emit a **locality receipt** in the provenance bundle: for each step, state whether it executed locally or transmitted bytes to a named third party, with byte counts and destination. | Should (post-MVP) | A run with no external steps shows `external_transmissions: []`; a run with a consented NCBI step shows destination, byte count and consent ID. |
| FR-8.6 | **Education mode**: for each caution flag or `insufficient_evidence` outcome, explain which threshold was not met and link the curated reference for that rule. | Should (post-MVP) | Test: a near-threshold verdict produces an explanation naming the threshold and a verified reference key; no reference → abstention. |

### 2.9 Plugin architecture (expansion)

| ID | Requirement | Priority | Acceptance criteria |
|---|---|---|---|
| FR-9.1 | `MVP` Define a plugin manifest with: id, version, domain, capabilities, input/output schemas, tools, validation rules, scientific references, limitations, tests, docs, and a demo command. | Must | Manifest validates against `shared/schemas/plugin.schema.json`. |
| FR-9.2 | `MVP` Ship the existing 16S/sequence engine as plugin `sequence-stats@1` and `microbiome-16s@1` adapters. | Must | Plugins call existing Python functions; all existing tests still pass. |
| FR-9.3 | Add a domain without editing control-plane code. | Must | A template plugin registers at startup and appears in `/api/tools` and the UI domain list. |
| FR-9.4 | Each plugin has at least one demonstrable end-to-end test and documentation. | Must | CI fails if a registered plugin lacks tests/docs. |

## 3. Non-functional requirements

| ID | Requirement | Acceptance criteria |
|---|---|---|
| NFR-1 **Scientific integrity** | No fabricated numbers, citations, statistics or findings. | Automated citation/number checks; violation blocks release. |
| NFR-2 **Traceability** | 100% of tool invocations carry provenance. | Test over a completed run's DAG. |
| NFR-3 **Privacy** | Uploaded data stays local by default; third-party transmission only after per-step consent. | Consent gate test + network egress assertion in tests. |
| NFR-4 **No mandatory paid dependency** | Default configuration costs $0 and works offline (except existing optional NCBI feature). | Run MVP with no secrets; document any optional paid providers. |
| NFR-5 **Preservation** | Existing Python/pytest and JS/node test suites remain green. | CI runs both suites; 0 regressions. |
| NFR-6 **Compute suitability** | Heavy algorithms never run in Cloudflare Workers. | Architecture review + documented limits in `COMPUTE_INFRASTRUCTURE.md`. |
| NFR-7 **Accessibility** | UI follows WCAG 2.1 AA basics: labels, keyboard navigation, status announcements. | Manual checklist + automated a11y check where available. |
| NFR-8 **Auditability** | Plan, approval and provenance are immutable records. | API rejects modification; audit log append-only. |
| NFR-9 **Operational clarity** | Mock/real execution is always distinguishable. | All responses carry `execution_mode: "real" | "mock"`. |

## 4. Constraints and assumptions

- **Constraint:** Cloudflare Workers are the control plane only (CPU/memory/request limits documented in `COMPUTE_INFRASTRUCTURE.md`).
- **Constraint:** A local execution agent must be installed to run scientific tools; the browser cannot execute BLAST.
- **Assumption:** Users running the MVP are comfortable starting a local Python process (documented one-command setup).
- **Assumption:** NCBI BLAST URL API remains available under its current terms; new integrations are gated by `API_INTEGRATION_ROADMAP.md`.
- **Constraint:** No external biological database client is added unless its terms, rate limits and licensing are recorded first.

## 5. Out of scope for the first release

- Clinical/diagnostic interpretation.
- Differential expression, proteomics, structural biology modules (architecture only).
- Training/fine-tuning biological language models.
- Guaranteed availability of public Galaxy servers.
- Automatic execution of AI-generated shell code without sandboxing.
