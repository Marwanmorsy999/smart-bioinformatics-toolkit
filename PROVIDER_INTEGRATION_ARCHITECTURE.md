# Provider integration architecture (M7 design)

**Status: design/contract document. No provider adapter, registry entry, Worker route or UI change was
implemented in this milestone.** M6 architecture is unchanged: the Worker remains the control plane,
the local Python agent remains the heavy-compute runner, and Plan/Job/Result wire formats remain those
in `shared/AI_PLATFORM_CONTRACT.md`. Live-source access dates: see each provider document (all
2026-11-25).

---

## 1. Common provider contract

Every provider implements the same nine operations and returns normalized values; provider-specific
status strings, error codes and artifact shapes are translated at the adapter boundary.

| Operation | Contract responsibility | Normalized result |
|---|---|---|
| `healthCheck()` | Authenticated, cheap liveness probe. Availability is **observed from the probe**, never inferred from configuration or a flag (M6 §2). | `{available, observed_at, latency_ms, detail}` |
| `getCapabilities()` | Which tools/workflows/models this provider can run, and in which modes (real/mock). | `{tool_ids[], workflow_ids[], modes[], features[]}` |
| `getLimits()` | Actual remaining quota/concurrency/file size from the provider, not invented credits. | `{remaining, unit, concurrency, max_bytes, observed_at}` |
| `validateRequest(step, inputs)` | Pre-submission schema, size/type, operation and consent checks. Rejects unknown tool ids and disallowed operations locally. | `{valid, errors[]}` |
| `submitJob(plan, step, consent)` | One real submission with a deterministic idempotency/run key. No silent fallback to another provider. | `{provider_job_id, status:"queued", submitted_at}` |
| `getJobStatus(provider_job_id)` | Poll terminal/non-terminal state; bounded backoff and hard timeout. | `{state: "queued|running|succeeded|failed|cancelled", raw_state, progress?, stdout?, stderr?}` |
| `cancelJob(provider_job_id)` | Provider-native cancellation (Galaxy `DELETE /api/jobs/{id}` or `DELETE /api/invocations/{id}`; smarts.bio `DELETE /v1/pipelines/{id}`). | `{cancelled, message}` |
| `getArtifacts(provider_job_id)` | Discover outputs, download bytes, compute SHA-256 locally, check size and names. | `[{name, kind, sha256, bytes, content}]` |
| `getUsage(provider_job_id)` | Actual consumption (bytes, seconds, calls, tokens where reported). | `{provider, units:{...}, measured_at}` |

Cross-cutting rules:

- All operations fail closed when unauthenticated, unhealthy, or missing consent. No fabricated result.
- `execution_mode` is `real | mock` on every job/run response (contract §5); mock mode is never
  presented as real and `simulated_results_available` stays `false`.
- Secrets never appear in a contract object, plan, log line or browser payload.
- Errors are normalized as
  `{provider, code, retryable, retry_after_seconds, message, provider_status, provider_job_id}` before
  the orchestrator sees them (`GALAXY_API_INTEGRATION.md` §7, `SMARTSBIO_API_INTEGRATION.md` §4.3).

## 2. Registry

- A **provider registry** maps `provider_id → adapter instance` and `tool_id → allowed provider(s)`.
  Only registered providers and tools are callable; there is **no arbitrary shell command, no dynamic
  `exec`, and no unregistered tool execution** at any layer. This closes the M6 residual concern about
  trusting unverified labels with an explicit allow-list.
- Registration requires: exact tool id and version (pinned), capability declaration, health probe,
  input/output schema source, data-destination classification, and a consent policy. A tool with an
  unverified schema is registered as `not-verified` and cannot be planned into an execution step.
- Availability is refreshed by `healthCheck()` and recorded with an observation timestamp. Registry
  freshness and plugin compliance are checked as in M6.
- Tool ids from Galaxy are the **exact versioned ids** observed in the live panel
  (`VERIFIED_TOOL_CATALOG.md`); smarts.bio tool ids are runtime-discovered via `GET /v1/tools`, never
  guessed; 9Router has no registered model until staging verification returns one.

## 3. Provider-specific formats are normalized before entering the platform

```
Galaxy tool state / invocation state ─┐
smarts.bio pipeline status ───────────┼─> adapter ─> contract DTO ─> M6 validation/evidence gate
9Router SSE chunk / completion ───────┘
```

- Galaxy HDA/HDCA ids, job states, invocation states and dataset extensions are translated into the
  contract's job/artifact vocabulary. The raw state string is preserved in `logs` for provenance.
- smarts.bio `queued → running → completed | failed | cancelled`, `output_paths` and `logs_path` are
  mapped to the same vocabulary; vendor claims are not adopted as our validation results.
- 9Router usage shapes are mapping targets only; no mapping is activated until staging verification.
- Nothing provider-specific crosses into the planner, the result validator or the report renderer.
  The contract's `Plan`, `Job`, result, provenance, validation, explanation and report objects remain
  exactly as specified in `shared/AI_PLATFORM_CONTRACT.md`.

## 4. Orchestration flow

```
upload
  → natural-language objective
  → intent interpretation
  → discovery (registry + provider capabilities; actual limits)
  → structured plan (tool_id, params, inputs, egress/consent flags, limitations)
  → user review (explicit approval of plan)
  → per-provider consent (scoped, revocable, recorded)
  → real submission (one provider, one idempotency key)
  → monitoring (bounded poll, cancel on request/timeout)
  → artifact download (SHA-256, size/type/name checks)
  → M6 validation / evidence gate (declared artifacts, provenance, real|mock, citation gate)
  → BioTutor explanation (field-grounded, abstains when evidence insufficient)
  → reproducible report (provenance, locality receipt, limitations, education notes)
```

Honesty controls carried forward from M6:

- The Worker derives its own locality receipt and education notes from job/audit rows; caller-supplied
  receipts/notes are ignored (M6 §7/§8).
- A single conditional status claim prevents two concurrent result submissions from both committing
  (409 for losers).
- A queued, unclaimed job cannot accept a result; the agent must claim it (`running` + `agent_id`).
- Unavailable backend blocks the heavy route with an actionable message; no silent simulation.

## 5. Provider selection priority

1. **Browser / local execution** — preferred; zero external transmission for lightweight validation
   and statistics (M6 topology A).
2. **Galaxy** — primary scientific execution provider for real tools, once credentials, account
   entitlement and tool schemas are verified; public-server rate limits and consent apply.
3. **Approved smarts.bio** — only with written authorization, `SMARTSBIO_ENABLED=true` **and** an
   explicit authorization-gate record. Today this step is always refused.
4. **Python agent fallback** — local heavy-tools runner (M6 topology B), subject to its own install/
   health/update lifecycle.

Selection is a function of *observed availability × verified capability × consent × actual limits*,
not a fixed preference that silently downgrades to whatever is cheapest or paid. No step may switch
provider mid-flight.

## 6. Consent and switch rules

- `external_egress: true` implies `consent_required: true` (contract §1). Consent is scoped to provider,
  data set, destination, operation and byte count, and is revocable.
- **A provider switch after approval requires renewed consent.** Changing provider changes the data
  destination and the account that executes the work; the original approval is void for the new
  provider. The plan must be re-discovered, re-presented for user review, re-approved, and a new consent
  record written before any submission. Never reuse an approval or silently reroute a job.
- No silent third-party transmission, no silent switch to a paid model/provider/plan
  (`PROVIDER_USAGE_POLICY.md`), and no silent switch between real and mock.

## 7. Implementation status (updated by orchestrator, 2026-11-25)

The design above is now backed by code in `web-platform/providers/`, the provider API handlers in
`web-platform/functions/api/providers/`, the private artifact store in `web-platform/storage/`, and
migration `0007_provider_governor.sql`. The Worker routes are wired in `web-platform/worker.js`.

**Implemented endpoints**

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/providers` | Availability + capability summary; unavailable tools never advertised |
| GET | `/api/providers/:id` | Health and executable-tool summary |
| GET | `/api/providers/:id/capabilities` | Metadata-only dynamic discovery; no upload |
| GET | `/api/providers/:id/limits` | Actual provider-reported limits only; unknown stays null |
| GET | `/api/providers/usage` | Governor status and alerts |
| POST | `/api/providers/chat` | 9Router orchestration chat; output marked unverified |
| POST | `/api/providers/plan` | Structured plan proposal only; no execution, per-provider consent disclosed |
| POST | `/api/providers/consent` | Dataset- and provider-scoped, short-lived consent |
| POST | `/api/providers/jobs` | Governed, consent-gated real job submission |
| GET/POST | `/api/providers/jobs/:id`, `/cancel`, `/artifacts` | Job monitoring, cancellation, output discovery |
| GET | `/api/providers/transfers` | Transfer ledger (source, destination, hash, bytes, consent, expiry, deletion) |
| POST | `/api/providers/budget` | Owner-only: set governor totals from *actual* observed quota; null stays fail-closed |
| POST | `/api/providers/emergency-stop` | Owner-only per-provider circuit breaker |
| POST/PUT/GET/POST | `/api/artifacts/upload-url`, `/upload`, `/:id/download-url`, `/content`, `/delete` | Private, HMAC-signed, streaming artifact lifecycle |

**Still blocked / not production-enabled**

- All three feature flags default to `false`. No integration is advertised as production-enabled.
- smarts.bio public API access remains disabled until written provider authorization is documented;
  possession of an API key does not change this.
- Tool input/output schemas and parameters are NOT VERIFIED until queried from an authenticated
  Galaxy tool config; see `VERIFIED_TOOL_CATALOG.md` Note A.
- No authenticated quota data has been configured, so the governor is fail-closed for Galaxy jobs
  until an owner supplies real totals through `/api/providers/budget`.
- No live job, upload, cancellation or download has been executed in this milestone; contract tests
  and mock fixtures only. See `M7_FINAL_REPORT.md`.
- The M6 residual LOW around `execution_mode` labelling is unchanged; making `jobs.execution_mode`
  authoritative at result submission remains a recommendation.
- Platform-owned vs per-user provider account ownership remains an unresolved operator decision
  (`GALAXY_API_INTEGRATION.md` §2, `DATA_TRANSFER_AND_PRIVACY.md` §7).
