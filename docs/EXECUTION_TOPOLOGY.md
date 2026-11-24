# Execution topology (M6.2)

Scope: decide where science runs, how the UI says so, and what happens when a
backend is missing. This document does **not** redesign the approved
architecture: the Worker is a control plane, heavy compute runs in the local
Python agent, and optional 9Router is unchanged.

## Hard rule

> **No backend ⇒ blocked with a clear message, never mock output presented as real.**

"Backend" here means an execution backend for the requested intent. The
browser-local route is itself a real execution environment for lightweight
operations: its numbers are computed in the page from the user's FASTA by the
existing `fasta.js` / `statistics.js` modules and are labelled
`Execution: browser-local`. Heavy intents have no browser implementation, so
an unavailable agent blocks them; no placeholder or simulated result is
generated. Mock-mode Worker output is explicitly labelled as mock and is not
scientific evidence.

## Decision table

| Option | Where it runs | Suitable work | Trust / data flow | M6 decision |
| --- | --- | --- | --- | --- |
| **A. Browser execution** | User's browser page, synchronous JS, no network call | FASTA parsing/validation and descriptive statistics (record counts, lengths, N50, GC%) on ≤64 KiB input | FASTA stays in the page; no Worker upload, no agent, no external egress. Input is untrusted text and is parsed by existing validators; output is rendered as text (never `innerHTML`). | **Chosen** for `validate_and_profile`. Reuses `fasta.js`, `statistics.js`, `csv-safe.js` — no reimplementation. |
| **B. Local execution agent** | Python process on the user's machine, polled over HTTPS from the Worker | Heavy/deterministic science: sequence profiling at scale, phylogenetics, taxonomy plugins, BLAST-backed workflows subject to consent | Worker validates input, builds a plan and gates approval; agent authenticates with `X-Agent-Token`, claims jobs, runs registry tools locally, returns validated evidence + provenance. Local databases and credentials never leave the machine. | **Chosen** for all non-lightweight intents and for users who want the plan/approve workflow even for profiling. |
| **C. Optional remote workflow execution on verified external infrastructure** | Third-party/remote compute after explicit verification | Only work that a verified external service is contractually allowed to run | Requires identity verification, data-egress consent, retention/licence checks, provenance continuity and an audited trust boundary. | **Architecture-only.** No remote deployment, provider, quota or cost model is invented for M6. No UI route is exposed. If added later, it must pass the same validation/consent gates and be labelled by name. |

Why not A alone: phylogenetics, taxonomy and BLAST-backed workflows need
larger datasets, local databases and reproducible provenance that a page
cannot honestly produce. Why not C in M6: no verified external infrastructure,
data-use agreement or cost model is part of this milestone; presenting one
would be an invented claim.

## Trust boundaries

1. **Browser → Worker (control plane only).** Structured JSON requests,
   length-capped FASTA, schema validation, plan approval, consent checks.
   The Worker stores datasets and jobs in D1 and computes no science. The
   backend-status endpoint is read-only and unauthenticated; it leaks no
   tokens and no FASTA.
2. **Worker → local agent.** Authenticated polling (`X-Agent-Token`), D1 job
   claims with `agent_id` + `started_at`, explicit approval and data-flow
   gates. The agent is trusted with local files and databases but its results
   are still schema-validated, hash-checked and provenance-bound by the
   Worker (existing `jobs/[id]/result.js` contract).
3. **Browser-local route.** There is no trust boundary crossing: the FASTA
   never leaves the tab. This route can only claim validation and descriptive
   statistics; it must never emit taxa calls, trees, BLAST hits or clinical
   statements.
4. **External services (optional 9Router / future C).** Outside the M6 trust
   boundary unless separately verified; no default egress and no implicit
   consent. Consent UI remains tied to plan steps with `external_egress`.

## Backend availability and what the UI says

`GET /api/ai/backend` reports: configured execution mode, whether an agent
token exists, whether a recent agent job claim was observed, the timestamp of
that claim, and an explicit `simulated_results_available: false`. It reads
existing `jobs` columns (`agent_id`, `started_at`); it adds no schema and no
new SQL. An agent that is idle with no queued jobs leaves no trace: the
endpoint says **not connected / not observed**, and `health` explains how to
produce an observation. A stale claim (default freshness window: 10 minutes)
is also not connected. If the D1 binding or query fails, the response is
configuration-only and never connected.

The workspace UI:

- shows a route selector with **Browser (local)** selected by default and
  **Local agent** clearly labelled as the heavy route;
- shows `Execution: browser-local` on browser results and
  `Execution: local agent` on agent results (mock output is labelled
  `Execution: local agent — mock (not scientific evidence)`);
- shows `Agent not connected — heavy analyses unavailable; browser-local tools
  still work.` from the status endpoint, and re-checks status before queueing
  an agent job so a stale page cannot claim a backend that has gone away;
- never presents a result object after a blocked decision.

## Fallback behaviour

| Condition | Behaviour |
| --- | --- |
| Lightweight request, browser route | Compute locally with existing modules; render validation, statistics and CSV; no Worker request. |
| Lightweight request, agent not connected | Browser route still works. Agent route is blocked with the honest message; no simulated result. |
| Heavy request, browser route | Blocked: browser route supports validation/statistics only. Suggest the local agent. |
| Heavy request, agent not connected or not observed | Blocked before any job is queued; clear message from the status endpoint. |
| Worker status endpoint unreachable | Fail closed: treat as no agent; browser-local tools remain available. |
| D1 unavailable | Configuration-only report; never connected. |
| Worker mode `mock` | Reported as mock; heavy results are marked not scientific evidence and cannot be reported as real. |
| Verified external backend (future C) | Out of scope for M6; would require its own labelled route and consent path. |

## Local agent installation

`scripts/agent-setup/` provides `install`, `start`, `health`, `update` and
`uninstall` for both PowerShell and bash. Installs are user-scoped, create a
venv, install `python-engine/requirements.txt`, generate a token with
OS-secure permissions and write a minimal config (worker URL + token path).
No token is printed or stored in config. See `scripts/agent-setup/README.md`
for exact commands and troubleshooting. Syntax checks were run for both
script families; Linux/macOS runtime installs were not performed here and are
not claimed.
