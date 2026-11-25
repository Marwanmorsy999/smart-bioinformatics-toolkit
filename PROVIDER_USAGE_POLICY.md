# Provider usage policy (M7 planning)

**Status: policy plus implemented governor.** The budget engine is in `web-platform/providers/common/governor.js`, persisted by migration `0007_provider_governor.sql`, and exposed through `/api/providers/usage`, `/api/providers/budget` and `/api/providers/emergency-stop`. All provider flags remain OFF and no total is invented: an unknown quota stays `null` and reservations fail closed. The in-memory rate limiter on public endpoints is best-effort only; durable per-user auth is a pre-public-release requirement.
The allocations below are **planning ratios, not guarantees** of availability, quota or spend. They do
not create entitlements and must never be presented to users as assured capacity.

---

## 1. Exact percentage allocations from M7 Part 8

Recorded verbatim from the owner-supplied M7 Part 8 allocation set. The five positions are the five
Part 8 allocation buckets; the bucket labels themselves are **not present in this repository**, so they
are named `B1–B5` rather than renamed with a guessed meaning. The orchestrator should map `B1–B5` to the
authoritative Part 8 labels before publication.

| Meter | B1 | B2 | B3 | B4 | B5 | Sum |
|---|---:|---:|---:|---:|---:|---:|
| **smarts.bio API calls** | 15 % | 30 % | 30 % | 15 % | 10 % | 100 % |
| **compute** | 10 % | 40 % | 30 % | 10 % | 10 % | 100 % |
| **9Router** | 10 % | 35 % | 30 % | 15 % | 10 % | 100 % |

**Interpretation limits:**

- These ratios describe *planned distribution*, not a right to consume 30 % of anything. Actual
  smarts.bio allowance comes from the connected account (Team Free is UNKNOWN — see
  `SMARTSBIO_API_INTEGRATION.md` §5); actual Galaxy capacity comes from live quota/usage endpoints
  (`GALAXY_API_INTEGRATION.md` §3); 9Router quota is UNKNOWN until staging verification.
- The ratios do **not** authorize spending. smarts.bio API-backed access remains blocked by
  `SMARTSBIO_ENABLED=false` + the authorization gate, and 9Router remains blocked by staging
  verification. A blocked provider's budget stays reserved but unspent — it is never silently
  redistributed to a paid provider.
- Galaxy is governed by **actual** storage, remaining quota and concurrency observed from the account.
  No Galaxy "credits" exist and none may be invented; published usegalaxy.org figures are context only.

## 2. Centralized governor — pre-job checks

Every submission passes one centralized governor before any byte leaves the platform. All checks must
pass; a failure is a typed, actionable error, never a silent fallback.

| Check | Requirement |
|---|---|
| Availability | Fresh `healthCheck()` observation (timestamped). Configuration/flags are not availability. |
| Remaining budget | Provider-specific remaining quota/allowance from `getLimits()` exceeds the estimated cost; never assume a plan ratio is available budget. |
| Reservation | Atomically reserve estimated cost/concurrency for this run; reservation is released on completion, cancellation or failure. |
| Concurrency | Provider and account concurrency ceilings respected (e.g. Galaxy live quota endpoints; smarts.bio documented 5 compute tasks per organization). |
| Consent | A current, scoped, revocable consent record exists for this provider, dataset, operation and destination. |
| File size | Input bytes within the provider's and the platform's declared limits; oversize rejected before transfer. |
| Operation | Tool/workflow/model id is registered and the operation is permitted for this account and plan; no arbitrary or unregistered operation. |

The governor derives estimates from observed limits, not from the percentage table above. The table is
used only for capacity *planning* and for alert thresholds.

## 3. Post-job accounting

After each terminal job, regardless of success:

1. **Actual consumption** — record bytes transferred, compute time, API calls and tokens (only when the
   provider reports them), plus the provider's raw usage fields where available.
2. **Release unused reservation** — reconcile estimate vs actual; return the difference to the
   available budget immediately. No reservation may leak across runs.
3. **Alerts** — warn when remaining allowance approaches the planning threshold, when usage deviates
   materially from the estimate, or when a provider's reported usage is missing. Missing usage is
   flagged as UNKNOWN, never estimated into a confident number.
4. **Per-provider emergency stop** — an operator can halt one provider independently (flag +
   governor deny) without affecting browser/local execution or the Python fallback. Stopping a provider
   cancels or refuses new submissions; in-flight jobs are reported honestly.

## 4. Never switch silently to a paid model, provider or plan

- An unavailable or exhausted provider must produce an actionable "unavailable / quota exhausted /
  authorization required" result. It must **not** silently reroute to another provider, a paid tier, a
  different model, or a paid plan.
- Any such switch requires a new plan, renewed consent (`PROVIDER_INTEGRATION_ARCHITECTURE.md` §6) and
  explicit user approval. Upgrading a plan is an owner decision made outside the platform.
- Mock mode is never silently substituted for real execution to make a budget problem disappear;
  `execution_mode` remains authoritative and `simulated_results_available` stays `false`.
- smarts.bio remains fully disabled until written authorization exists; 9Router remains disabled until
  staging verification succeeds. Neither budget ratio overrides those gates.

## 5. Limitations / unfinished edges

- No governor implementation, reservation ledger, alerting or emergency-stop control was added.
- Bucket labels B1–B5 must be mapped from the authoritative M7 Part 8 text before external publication.
- Actual provider costs/limits are provider- and account-specific; the ratios cannot substitute for
  live quota discovery.
