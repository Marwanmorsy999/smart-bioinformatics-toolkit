# 9Router integration — requirements and verification gate (M7)

**Status: NOT VERIFIED for M7. No endpoint URL, no credentials and no deployment were supplied.**
**No model name, quota, token price or endpoint is asserted as current.** Record every live observation
with its access date; none exists for 9Router in this milestone.

---

## 1. What was and was not supplied

- Supplied to this work: **nothing** — no base URL, no API key, no staging deployment, no model id.
- Prior-milestone repository evidence (not re-verified this session; access date recorded there
  **2026-11-24**): `AI_AGENT_ARCHITECTURE.md:223` and `COMPUTE_INFRASTRUCTURE.md:93-105` describe a
  **local** OpenAI-compatible proxy at `http://127.0.0.1:20128/v1`, a `NINEROUTER_API_KEY`, 555 models
  including `auto`, used only as an opt-in phrasing aid in the local Python agent. That is historical
  context only: it is a localhost address, it is not a deployable endpoint for a Cloudflare Worker, it
  was not supplied for M7, and it is **not** treated as the staging endpoint. No model name from it is
  carried forward as current.
- Therefore, for M7 the endpoint, key, model set, quotas, latency and availability are all **UNKNOWN**.

## 2. Requirements that any 9Router deployment must satisfy before use

| # | Requirement | Why / acceptance check |
|---|---|---|
| 1 | **HTTPS endpoint with valid TLS** | A Worker cannot reach `127.0.0.1`; plaintext HTTP is unacceptable for a credential and for prompt text. Verify the certificate chain from the deployed Worker. |
| 2 | **Authentication** | API key sent from the server side only; never from the browser, never in code or a repository file. Key stored as a Cloudflare secret. |
| 3 | **Health check** | A cheap authenticated read (e.g. a models listing or provider-equivalent health route) that returns a deterministic status. Health must be *observed*, not inferred from configuration — M6 §2 honesty rule. |
| 4 | **Model discovery** | Endpoint that enumerates available model ids. The platform records the exact id returned by the server; it does not hard-code a guessed name. |
| 5 | **Chat completion** | A standard chat-completion request/response shape, normalized into the platform's provider contract. |
| 6 | **Structured JSON** | Ability to request and receive parseable JSON output, with strict schema validation before any result is accepted. |
| 7 | **Streaming** | Server-Sent Events or equivalent token streaming, with a terminating event, so long explanations do not block on one response. |
| 8 | **Explicit timeout** | Connect and total-request timeouts, plus bounded retries with backoff; a dead provider must fail closed to the deterministic explanation path (M5 provider-outage behaviour). |
| 9 | **Token usage reported** | Response must expose token/prompt/completion counts so usage can be accounted for; if absent, accounting is UNKNOWN and usage must be flagged, not estimated. |
| 10 | **Model tracking in provenance** | Exact model id, request timestamp and latency recorded in provenance/`logs`, never a friendly alias invented by us. |

**Scope constraint (unchanged from M5/M6):** 9Router is an **opt-in phrasing aid only**. Only
already-validated finding text and numbers may be sent — **never raw uploaded sequences**. Every
LLM-produced string must still pass the deterministic number/citation gate; failure falls back to the
deterministic explanation. The base model remains functional with no key.

## 3. Verification gate — must be performed from deployed staging

Nothing may be enabled until an operator performs these checks **from the deployed staging Worker**,
records the outputs and access date, and confirms:

1. `NINEROUTER_BASE_URL` is HTTPS, resolves from the Worker, and presents a valid TLS chain.
2. `NINEROUTER_API_KEY` authenticates; the health/model-discovery call succeeds.
3. Model discovery returns a concrete list; copy the **exact** server-provided model id into the
   operator record (not into source code as a claimed default).
4. One chat-completion call returns a valid structured-JSON response; one streaming call emits a
   terminating event.
5. Token usage fields are present and readable; confirm how they map to our usage ledger.
6. Timeouts behave: an unreachable endpoint fails closed to deterministic explanation with an
   `llm_phrase_rejected`-style flag, and does not change scientific artifact hashes.
7. Record the access date, model id, endpoint host (no secret), and observed latency in
   `docs/discovery/`.

Only after all seven checks pass may the provider be described as staging-verified. Production requires
a separate check against production secrets and URLs.

## 4. What the owner must supply via `wrangler secret put`

Distinct values for **staging** (`--env staging`) and **production** (default environment). Each command
is run interactively by the owner; the secret value is never printed, logged, pasted into a file or
committed. Placeholders below are names, not values.

```
# staging
wrangler secret put NINEROUTER_API_KEY --env staging
wrangler secret put NINEROUTER_BASE_URL --env staging        # owner-supplied HTTPS base URL
wrangler secret put NINEROUTER_MODEL --env staging           # optional; owner-supplied exact discovered id

# production
wrangler secret put NINEROUTER_API_KEY
wrangler secret put NINEROUTER_BASE_URL
wrangler secret put NINEROUTER_MODEL                         # optional; owner-supplied exact discovered id
```

- `NINEROUTER_ENABLED` (if used) is a boolean switch; it must default to **off** and is not a secret.
- The model id must come from the owner's server-side discovery result (§3 step 3); if omitted, the
  adapter must discover it at runtime rather than guess.
- Never put a key in `wrangler.toml`, `.dev.vars` committed to the repo, browser bundles, plan/job JSON,
  or any documentation file.

## 5. Limitations / unfinished edges

- Endpoint, key, model list and quotas are UNKNOWN; no staging or production verification was performed.
- No 9Router code was added or changed in this milestone; the existing opt-in phrasing aid described in
  M5/M6 is left exactly as it is.
- No model name, quota or endpoint has been invented, including in examples above (placeholders only).
