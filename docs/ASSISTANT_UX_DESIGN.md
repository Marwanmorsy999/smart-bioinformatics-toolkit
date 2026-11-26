# S Bio Assistant — UX & Backend Design (read-only design proposal)

**Status:** DESIGN DOCUMENT ONLY. No assistant page, HTML, CSS, JS, config, route, credential or provider flag is created or changed by this document. This is a proposal for a future, separately authorized implementation.

**Scope of audit:** the actual files listed in §0 were read in worktree `D:\DevCache\Temp\uiux-polish` on branch `design/brand-assistant-polish`. Paths and symbols below are quoted from those files.

**Mission constraint observed:** disabled providers must not be activated and new credentials must not be requested or installed. This document requests no credentials and proposes no flag change.

---

## 0. Audit of existing AI/LLM infrastructure (verified facts)

### 0.1 The deployed Worker has no enabled, authorized, reachable server-side LLM

**Exact blocker — one paragraph.** There is no currently enabled, authorized, reachable server-side LLM provider available to the deployed Worker. The only chat-capable adapter in the Worker is 9Router (`web-platform/providers/ninerouter/index.js`): its `createAdapter()` reads `NINEROUTER_ENABLED === "true"` plus `NINEROUTER_BASE_URL` and `NINEROUTER_API_KEY` from the environment, `availability()` returns `AVAILABILITY.DISABLED` when the flag is not exactly `"true"` and `AVAILABILITY.UNAVAILABLE` when the URL/key are missing, and the adapter has no loopback or default endpoint. `web-platform/wrangler.toml` sets `NINEROUTER_ENABLED = "false"` in both the production `[vars]` (line 18) and `[env.staging.vars]` (line 43); `docs/M7_1_LIVE_ACTIVATION_REPORT.md` §1 and §6 record that the deployed staging Worker has *no* `NINEROUTER_ENABLED`, `NINEROUTER_BASE_URL` or `NINEROUTER_API_KEY` secret, that the documented endpoint is the machine-local `http://127.0.0.1:20128/v1` (unreachable from Cloudflare, no fallback in the adapter), and a live probe returned `POST /api/providers/chat → 403 Provider 'ninerouter' is disabled.` The `AI_LLM_PROVIDER` variable is a *Python-engine-only* opt-in read by `python-engine/src/smartbio/aiagent/llm.py::provider_from_env()` (line 105); the Worker never reads it, so setting it would not make Worker chat work. smarts.bio is separately and doubly blocked (`SMARTSBIO_ENABLED = "false"` in both environments plus the `SMARTSBIO_PUBLIC_AUTHORIZED` written-authorization gate in `web-platform/providers/smartsbio/index.js`, and an explicit 403 in `chat.js` for `provider === "smartsbio"`), and Galaxy is not an LLM and is itself blocked by account activation. The mission rule forbids flipping any of these flags or installing replacement credentials, so a browser-facing chat cannot receive a real model response at this time and must ship, if at all, in an explicitly unavailable state.

### 0.2 Route and adapter inventory

| File | Symbol / fact | Relevance to assistant |
| --- | --- | --- |
| `web-platform/functions/api/providers/chat.js` | `onRequest` (POST only), `requireEnabled(registry, providerId, request, env)`, `governor.reserve({provider, unit:"requests", amount:1, category, operation: OPERATIONS.CHAT})`, `provider.submitJob(...)`, response `evidence_status: "unverified"`, `validated: false`, `notice`, `rateLimit(request, "chat", 60, 5*60*1000)`. Accepts `message` (`safeString(..., 4000)`), optional `system`, `conversation_id`, `model`, `category` from `ALLOWED_CATEGORIES`. | The only existing server-side chat call path. It is fail-closed on disabled provider and on governor unavailability (503), releases the reservation on failure, and reports usage only from `result.output.usage`. |
| `web-platform/functions/api/providers/index.js` | `onRequest` (GET), advertises `AVAILABILITY.DISABLED` when `isEnabled(env, id)` is false, uses `executableTools as filterExecutable`, never advertises an unavailable tool as executable. | Source of truth for an honest "assistant unavailable" status. |
| `web-platform/functions/api/providers/_lib.js` | `ENABLED_FLAG` (`galaxy`/`GALAXY_ENABLED`, `smartsbio`/`SMARTSBIO_ENABLED`, `ninerouter`/`NINEROUTER_ENABLED`), `isEnabled()` (literal `"true"` only), `requireEnabled()` (throws typed 403 `feature_flag_disabled`), `requireOwner()` → `agentTokenError`, `rateLimit()` (best-effort, per-IP, in-memory, explicitly *not* a durable quota), `getGovernor()` (needs D1), `providerPayload()` with `executionMode(env)`, `PROVIDER_SQL` including single-use `consumeConsent`. | Authorization, governor and honest capability surface all already exist and are authoritative. |
| `web-platform/functions/api/providers/consent.js` | POST, `MAX_CONSENT_TTL_MS = 30 * 60 * 1000`, requires `granted === true`, scoped to one `provider` + one `dataset_id`, notice: "Consent covers only … A switch to another destination requires new consent." | Consent is explicit, scoped, short-lived, single-use and revocable. |
| `web-platform/functions/api/providers/plan.js` | `PLAN_SCHEMA`, `requireEnabled("ninerouter")`, `registry.advertisedTools()` snapshot used for both prompt and gate, server-authored `system`, `rejected_steps` with `not_registered_or_unavailable`, `destination_disclosure`, `requires_approval: true`, `executable: false`, `validated: false`. | A plan is a proposal only; every proposed tool id must exist in the advertised registry. |
| `web-platform/functions/api/ai/plans/[id]/approve.js` | `handleApprove`, `validateApprovalsPayload`, `validatePlan`, one-way idempotent gate (`existing.length` returns existing jobs), `consent_granted`, `external_egress`, `issueBlastConsent`, audit actions `ai_step_not_approved`, `ai_step_declined`, `ai_consent_denied`, `ai_job_created`, `ai_plan_approved`, `ai_blast_consent_issued`. Nothing here runs a tool. | Hard gate between planning and execution. Approval is recorded with `actor: "browser"` but is a human/destination decision, not a chat message. |
| `web-platform/functions/api/ai/_lib.js` | `agentTokenError()` compares `X-Agent-Token` to `env.AI_AGENT_TOKEN` with `constantTimeEqual()`; `getDb()` returns `env.AI_DB ?? env.BLAST_DB`; `MAX_FASTA_BYTES = 64*1024`, `MAX_REQUEST_BODY_CHARS = 128*1024`; `PUBLIC_ID_PATTERN`; `preflightResponse()` allows `X-Agent-Token`; `SQL` holds metadata statements for datasets, plans, jobs, runs, approvals, audit and workspace rows — **no conversation table**; `computeExecutionMode()`/`envExecutionMode()` make operator mode authoritative. | There is one shared *operator* token, not per-human accounts, and no place to persist chats. |
| `web-platform/functions/api/workspace/_lib.js` | `deriveOwner()` calls `requireOwner()`, then SHA-256-hashes the token into a non-secret `owner_<hex16>` principal. | "Ownership" is derived from the same shared operator token; it is not a human identity and must not be presented as one. |
| `web-platform/worker.js` | `ROUTES`, `createFetch(handlerMap)`, `handlers.providerChat`, `handlers.providerPlan`, `handlers.aiPlanApprove`, `handlers.providers`; unknown `/api/**` fails closed with JSON 404 and never falls through to static HTML. | Any `/api/assistant/*` gateway must be added here as an explicit route; there is currently no such route. |
| `web-platform/wrangler.toml` | Production `[vars]`: `GALAXY_ENABLED`, `SMARTSBIO_ENABLED`, `NINEROUTER_ENABLED` all `"false"`; staging enables only Galaxy; D1 binding is `BLAST_DB`. | No LLM flag is on anywhere. |
| `web-platform/providers/registry.js` | `createRegistry`, `isEnabled`, `advertisedTools`, `resolveTool`; disabled providers return `AVAILABILITY.DISABLED` descriptors and are never contacted. | Tool list for plans must come from here. |
| `web-platform/providers/ninerouter/index.js` | `SYSTEM_GUARD` (forbids measurements/citations and requires values to come from validated tools/evidence records), `ROUTER_OPERATIONS` (includes `CHAT`, `CHAT_STREAM`, `PLAN`), `availability()`, `submitJob()`, `streamChat()` via `readSse`, `cancelJob()` → `ok:false, reason:"not_supported"`, `getJobStatus()` → `not_durable`, `timeoutMsFrom()` (default 20 s, ceiling 300 s). | The adapter that *would* serve chat IF authorized. Streaming is supported at the adapter layer but is **not** currently exposed by `chat.js` (which returns a single JSON response). Cancellation is not supported; stop must be client-side abort. |
| `web-platform/providers/smartsbio/index.js` | `GATE = "SMARTSBIO_PUBLIC_AUTHORIZED"`, `GATE_ERROR` (`public_authorization_required`, 403), `active = enabled && authorized && configured`. | Not an option; public access is unauthorized. |
| `python-engine/src/smartbio/aiagent/llm.py` | `provider_from_env()` requires `AI_LLM_PROVIDER == "ninerouter"` **and** a non-empty `NINEROUTER_API_KEY`; `OpenAICompatibleProvider.chat()`; prompts contain only already-validated finding text, never raw sequences. | This is the local Python engine's phrasing aid. It is not reachable from the browser and does not change the Worker blocker. |
| `python-engine/src/smartbio/aiagent/explanation.py` | `build_explanation()` copies numbers from validated artifacts with `{artifact, field_path}` citations; `check_explanation()` rejects unsupported numbers and unverified references; `REFERENCES` has exactly one `verified: true` entry (`smartbio_gc_definition`) and one `verified: false` entry (`kim2014_16s_species_threshold`); `_LLM_SYSTEM` permits only rephrasing with numbers/citations preserved; `apply_llm_phrasing()` appends `_LLM_LIMITATION` when an external model assisted. | Defines the scientific bar an assistant response must meet: no ungrounded numbers, no unverified citations. |
| `docs/M7_1_LIVE_ACTIVATION_REPORT.md` | Verdict `BLOCKED — NOT COMPLETE`; `/api/providers` live: all three providers `enabled:false`, `availability:"disabled"`, 0 advertised tools; typed 403 POST probes; "No real account limits were configured"; "no live 9Router chat completion was made"; "Independent browser verification … NOT RUN with live data". | Confirms the blocker from the deployed environment, not just config files. |
| `GALAXY_API_INTEGRATION.md` | Discovery/architecture only; `POST /api/tools` → 403 `Action requires account activation.`; account key must never be in browser code/URL/log; no "Galaxy credits" may be invented. | Galaxy is execution infrastructure, not a chat provider, and is blocked. |
| `PROVIDER_USAGE_POLICY.md` | "All provider flags remain OFF and no total is invented"; "An unavailable or exhausted provider must produce an actionable 'unavailable / quota exhausted / authorization required' result. It must not silently reroute …"; mock mode is never silently substituted; smarts.bio and 9Router stay disabled until their gates pass. | The assistant must report unavailable honestly, never fall back to mock or another provider. |
| `web-platform/providers/workspace/catalog.js` | Deprecated compatibility shim; authoritative catalog is `functions/api/workspace/catalog.js`. | Quoted exactly in §5.3. |
| `web-platform/functions/api/workspace/catalog.js` | `CATALOG_VERSION = "1.0.0-m7.4"`, two frozen workflows with explicit `execution_availability`. | The only real workflow catalog the assistant may name. |

### 0.3 Real tool catalog (advertised, not executable by the assistant)

`web-platform/functions/api/ai/registry.tools.generated.js` (generated from `shared/plugins/*.json`) advertises exactly nine tool ids: `phylogenetics.validate`, `phylogenetics.align`, `phylogenetics.tree`, `phylogenetics.report`, `phylogenetics.workflow`, `sequence-stats.validate`, `sequence-stats.profile`, `microbiome-16s.blast-parse`, `microbiome-16s.taxonomy`. `docs/M7_1_LIVE_ACTIVATION_REPORT.md` §3 confirms `GET /api/tools` → 200, 9 tools, `execution_mode: real`. An assistant must never name a tool outside this list unless the live `registry.advertisedTools()` snapshot contains it.

### 0.4 Existing authorization the browser must not bypass

- **Operator token, not a user account.** `X-Agent-Token` is compared against the single server secret `env.AI_AGENT_TOKEN` by `agentTokenError()` in `functions/api/ai/_lib.js`. `deriveOwner()` hashes that same token to a stable `owner_<hex16>` string. There is no login, no per-human identity, and no session concept for a visitor. A browser-facing chat must not embed, forward, or ask the visitor for this operator token; public, budget-consuming endpoints rely on best-effort rate limiting only, which `PROVIDER_USAGE_POLICY.md` identifies as a pre-public-release gap requiring durable per-user auth.
- **Consent ledger.** `functions/api/providers/consent.js` mints short-lived (≤30 min), scoped (one dataset + one destination) consent records; `PROVIDER_SQL.consumeConsent` makes them single-use; `ai/plans/[id]/approve.js` refuses any step with `external_egress === true || consent_required === true` unless `consent_granted === true`. Chat text is not consent for a biological data transfer.
- **Governor.** `getGovernor()` requires D1; `chat.js` and `plan.js` reserve before calling a provider and release/consume/record usage around the call. Missing governor → 503 fail-closed. The assistant gateway must keep this sequence; it must not batch, amortize or skip reservations.
- **Plan approval.** `POST /api/ai/plans/:id/approve` is a one-way, idempotent, audited gate. A chat message, a suggested prompt, or an assistant card is never an approval event and must never call this endpoint.
- **Evidence gate.** `chat.js` stamps `evidence_status: "unverified"`, `validated: false`; `explanation.py::check_explanation()` rejects ungrounded numbers and unverified citations. Assistant prose must not be relabelled as a finding, a validation result, or a report.

---

## 1. Product role and scope

**Name and one-line role:** **S Bio Assistant — Your bioinformatics research assistant.**

The assistant is a *guidance and navigation layer* over the existing toolkit. It helps a researcher:

- understand FASTA and other accepted sequence formats, record counts, alphabet and common validation failures;
- choose between the existing workflows (16S rRNA identification, MSA + phylogenetics) and the nine registered tools;
- explain what BLAST parsing, taxonomy consensus, MSA, tree inference and topology validation do, including their limitations;
- interpret tool parameters and the meaning of existing outputs (statistics, validation flags, consensus verdicts, Newick trees, evidence references);
- assemble an *analysis plan* (a proposal) that the researcher can review, then use the existing approval/consent path if they choose to run anything;
- navigate to the relevant existing page (`/blast.html`, `/taxonomy.html`, `/phylo.html`, `/workspace.html`, `/ai.html`, `/benchmark.html`).

**Explicit non-role.** The assistant is **not an autonomous scientist** and is **not a source of scientific truth validation**. It does not measure, compute, align, call BLAST, infer a tree, verify a claim, or decide that a result is correct. All scientific values come from executed tools and validated artifacts; all validation comes from the existing validator/evidence gate; all execution comes from the existing approval path. It does not diagnose, and it is not a clinical tool.

---

## 2. UX structure

The visual language must follow `docs/DESIGN_SYSTEM.md`: cool porcelain surfaces, deep ink text, restrained teal accent, amber for caution/gated states only, hairline borders, inline SVG icons with `aria-hidden="true"`, monospace only for sequences/IDs/parameters/numeric data, tabular numerals, visible `:focus-visible` ring, and `prefers-reduced-motion` collapse. No AI-SaaS tropes: no gradients, glow, decorative DNA art, fake metrics or invented counts.

### 2.1 Collapsible conversation sidebar

- Header with product name and a **New conversation** control (primary action).
- **Recent conversations** list: title, relative timestamp, active-state marker (`aria-current="page"`), and per-item **Search**, **Rename**, **Delete** actions. A single **Clear all** control with a confirmation step that names the consequence ("stored only in this browser; cannot be recovered").
- **Search** filters by message text client-side; empty state says there are no matching conversations, not that data was deleted from the server.
- **Project context** chip when the researcher has explicitly attached a workspace project/dataset: show the public id and a "remove context" action. Never imply the assistant has read the whole dataset.
- Collapse/expand control with a persistent collapsed preference in local storage; collapsed rail still exposes **New conversation** and the active conversation title.
- All conversations are **local/session-only** (§4.2). The sidebar label must say so.

### 2.2 Main conversation timeline

- Assistant avatar (inline SVG, not an emoji), assistant and user message bubbles with distinct alignment and an accessible name ("Assistant said…", "You said…").
- Timestamps on every message (local time, tabular numerals).
- **Readable Markdown**: headings, lists, emphasis, links; links open safely and are never auto-executed.
- **Code and sequence formatting**: FASTA/sequences, tool ids, parameters, hashes and IDs in the monospace token with horizontal scroll and a "Copy" control; long sequences are collapsible and truncated in the transcript.
- **Tables** for parameters and comparisons with header row and `scope="col"`.
- **Citations** rendered as labelled reference chips using only the in-tree verified reference ledger (currently one verified entry, `smartbio_gc_definition`); unverified references (`kim2014_16s_species_threshold`) must be shown as "unverified" or omitted, never presented as established literature.
- Per-message **Copy** and **Retry / Regenerate** controls. Regenerate re-issues the *same* request through the gateway; it does not reuse a cached fake answer and does not change the underlying scientific facts.

### 2.3 Composer

- Multiline textarea with a visible label ("Message S Bio Assistant"); placeholder gives an example question, not a promise.
- **Enter** sends; **Shift+Enter** inserts a newline. This is stated in the UI help text.
- **Stop** control during a request: aborts the in-flight `fetch` client-side and sets the state to "Stopped — no model response was completed." It cannot cancel a server job (9Router `cancelJob()` returns `reason: "not_supported"`).
- **Loading** and **error** states are distinct; errors show the typed server reason (disabled, budget exhausted, governor unavailable, rate limited, provider error) verbatim enough to act on.
- **Disabled when unavailable**: when `/api/assistant/status` reports no authorized provider, the composer is disabled, a banner explains why, and no input is accepted. The UI must never offer a "demo reply" to fill the gap.
- **Character limit**: 4 000 characters, matching `chat.js` `safeString(payload.message, 4000)`; live count with tabular numerals and a blocking validation message above the limit.
- **Clear** control for the current draft.
- **Attachments: not supported.** No file picker, no drag-and-drop, no whole-FASTA upload. If a future release adds attachments it must be a separately authorized feature with its own consent flow; this design does not include it.

### 2.4 Real activity states — hard rule

The assistant may display only these states, and only when backed by an observed lifecycle event from the gateway or the existing control plane:

| State | Only when |
| --- | --- |
| Understanding | Request has been accepted by `/api/assistant/message` (server response pending). |
| Preparing | Provider reservation has succeeded and the provider call has started. |
| Reviewing evidence | A validated artifact/reference set is actually returned by an existing tool run. |
| Preparing plan | `/api/assistant/plan` returned a `proposal` object. |
| Awaiting approval | A real `plan_` row exists and has not been approved. |
| Executing approved | A real `job_` row is `queued`/`running` from the existing approval path. |
| Retrieving | An artifact/run result is actually being fetched. |
| Validating | The existing validation step has actually run and returned a status. |

**Hard rule: never simulate activity.** No timers that advance a fake progress bar, no staged "thinking…" messages with no backend event, no invented token/byte counters, no placeholder results to make the UI look alive. If nothing real is happening, show nothing. If the provider is unavailable, show the unavailable state. A mocked test response must be labelled as mocked in that test only and must never be presented as product behaviour.

### 2.5 Scientific result cards

When the assistant summarizes real work, it renders a structured card (not free prose masquerading as a result) with these sections:

1. **Explanation** — phrasing only, marked unverified.
2. **Workflow** — workflow id from the authoritative catalog (§5.3), with its real availability state.
3. **Inputs** — dataset public id, filename, format and byte count; never raw sequence content pasted into the chat.
4. **Parameters** — actual values from the plan/job, monospace.
5. **Evidence** — artifact names + field paths and verified reference keys only.
6. **Limitations** — limitations copied from the tool/catalog plus "AI-generated phrasing only."
7. **Next step** — links to the existing tool pages and the real approval/consent UI, with the verb "Review", "Approve" or "Open" — never "Run now" from the chat itself.

### 2.6 Suggested prompts

Suggested prompts are **suggestions only**. They are labelled "Example questions — clicking fills the composer; nothing is executed." They cover scope topics (FASTA, formats, 16S, BLAST, taxonomy, MSA, phylogenetics, workflows, limitations, tool parameters, analysis plans). They must not claim that a dataset was analysed or that a result will be produced.

---

## 3. Backend architecture (proposed, not implemented)

### 3.1 Gateway shape

All assistant traffic goes through new, explicit Worker routes under `/api/assistant/*`, registered in `web-platform/worker.js` `ROUTES` and `handlers`. Keys never reach the browser. The gateway reuses the existing server-side call path rather than inventing a provider:

- chat → `functions/api/providers/chat.js` semantics → `providers/ninerouter/index.js::submitJob({operation: OPERATIONS.CHAT, ...})` (the adapter prepends `SYSTEM_GUARD`);
- plan → `functions/api/providers/plan.js` semantics → `OPERATIONS.PLAN`;
- status → `functions/api/providers/index.js` / `isEnabled()` / `getCachedHealth()` semantics;
- approval, consent, execution, validation remain the **existing** `/api/ai/plans/:id/approve`, `/api/providers/consent`, `/api/ai/jobs/*` and validator endpoints. The assistant does not get its own execution path.

**The 9Router adapter is the only candidate mapping and is NOT enabled now** (§0.1). No new provider, endpoint or credential is introduced by this design. `AI_LLM_PROVIDER` is Python-engine-only and is not part of the Worker gateway.

### 3.2 Routes

| Route | Method / auth | Request | Response | Errors |
| --- | --- | --- | --- | --- |
| `GET /api/assistant/status` | GET, public (no operator token in browser) | — | `{ available: false, provider: "ninerouter", reason: "feature_flag_disabled", execution_mode: "real", generated_at, notice }`; when authorized, `available: true` and health-derived status. Never claims availability from a flag alone. | `405` with `Allow: GET` |
| `POST /api/assistant/message` | POST, public + best-effort `rateLimit("chat", 60, 5min)`; governor reserve required | `{ message (≤4000 chars, non-empty), conversation_id?, category? ∈ ALLOWED_CATEGORIES, project_context? (public ids only) }`. **Ignore any client-supplied `system`, `model` or provider id.** | `{ reply, conversation_id, provider:"ninerouter", evidence_status:"unverified", validated:false, usage, execution_mode, generated_at, notice }` | `400` invalid body; `403` `feature_flag_disabled` with `X-Provider`/`X-Error-Detail: {"reason":"feature_flag_disabled"}`; `429` budget/rate limit; `503` governor/D1 unavailable; `502` normalized provider error. No fallback provider or mock reply. |
| `POST /api/assistant/plan` | POST, public + `rateLimit("plan", 30, 5min)` + governor | `{ objective (≤4000 chars), project_context? }` | Existing `proposal` shape: `intent`, `confidence`, `steps`, `rejected_steps`, `clarifying_questions`, `limitations`, `destination_disclosure`, `requires_approval:true`, `executable:false`, `validated:false`. | Same as message; steps with unregistered tool ids are rejected, not silently kept. |
| `POST /api/assistant/stop` | POST, public | `{ conversation_id }` | `{ ok: true, note: "Client-side abort only; server jobs are unchanged." }` | `400` invalid id. There is no server-side cancellation for 9Router. |

Conversations are **not** a server resource, so there are no `/api/assistant/conversations/*` routes in this design.

### 3.3 Request handling rules

- **Server-side keys only** — `NINEROUTER_API_KEY`, `AI_AGENT_TOKEN` and any future secret stay in Worker env; never in HTML, JS, URLs, logs or responses.
- **Validation** — reuse `safeString`, `readJsonBody`, `requireMethod`, `PUBLIC_ID_PATTERN`, `MAX_REQUEST_BODY_CHARS`; reject unknown categories and non-string fields; cap output text as the adapter does (`safeString(..., 20_000)`).
- **Limits and timeouts** — inherit `NINEROUTER_TIMEOUT` default 20 s / ceiling 300 s and the existing 4 000-char input cap; no unbounded waits.
- **Streaming** — the adapter implements `CHAT_STREAM` via `readSse`, but `chat.js` does not expose it. Use non-streaming `OPERATIONS.CHAT` initially. Add a streaming route only if separately authorized, with real usage chunks only (never synthesized) and a typed error if the stream drops.
- **Cancellation and duplicate submit** — disable the send control on submit, key requests by `{conversation_id, client_request_id}` and ignore repeat responses for the same id; Stop aborts the `fetch` locally and is explicitly labelled as local-only.
- **Provider unavailability** — status and message endpoints return the honest typed 403/503; the UI shows unavailable and disables the composer. No silent reroute, no paid-tier substitution, no mock substitution (`PROVIDER_USAGE_POLICY.md` §4).

---

## 4. Storage, identity and conversation model

### 4.1 What exists

`getDb(env)` points at D1 (`BLAST_DB`/`AI_DB`) and `SQL` stores metadata for datasets, requests, plans, jobs, approvals, runs, artifacts, consents, transfers and audit events — **there is no conversation or message table**. The only authorization principal is the shared operator token; `deriveOwner()` turns it into a non-secret `owner_<hex16>` string. That is not a human account: every visitor using the same token maps to the same principal, and no browser visitor authenticates at all. The M7.1 report confirms no per-user auth exists and the rate limiter is not a durable quota.

### 4.2 Honest recommendation: local / session-only conversations

For this milestone, conversations live **only in the browser** (in-memory, optionally mirrored to `localStorage` with an explicit user-visible setting), scoped to the current tab/session. The UI must state plainly, near the sidebar and in the new-conversation dialog:

> "Conversations are stored only in this browser and are not saved to your account. They will be lost if you clear browser data or change devices. The assistant does not analyse your datasets unless you explicitly start an approved workflow."

Consequences: no cross-device sync, no "your conversations" account view, no durable ownership claim, no invented user ids, and no server-side message retention. Any future durable conversation feature requires real per-user authentication and a new migration plus a separate design decision; it is out of scope here. Project context can be attached only by naming an existing public project/dataset id that the operator already exposed through the existing workspace API, and attaching it must not upload file contents to the LLM.

---

## 5. Scientific system instruction (full draft)

The gateway builds this instruction **server-side**; the browser cannot supply or override it. It is sent ahead of the user message and is additional to the adapter's fixed `SYSTEM_GUARD`. When `chat.js` currently accepts a client `system` string, the assistant gateway must ignore it.

```
You are S Bio Assistant, a guidance assistant for the Smart Bioinformatics
Toolkit. You help users understand sequence formats, FASTA, 16S rRNA analysis,
BLAST parsing, taxonomy, multiple-sequence alignment, phylogenetics, tool
parameters, workflow choices and analysis plans. You are NOT an autonomous
scientist, NOT a source of scientific truth, and NOT a validation engine.

UNCERTAINTY AND EPISTEMIC STATUS
- State uncertainty explicitly. Distinguish established method facts from
  hypotheses, suggestions and interpretation. Use "may", "suggests" or
  "consistent with" when evidence is incomplete; never upgrade a hypothesis
  into a conclusion.
- Never invent, estimate or compute results, measurements, statistics,
  p-values, accession numbers, sequences, dates or citations. If a value was
  not supplied to you by a validated tool or evidence record, do not state it.
- Never claim that a dataset, file or FASTA sequence was analysed, uploaded,
  aligned, searched or validated merely because the user mentioned it. Refer
  to it only as "the dataset you described" until a real tool result exists.
- When evidence is insufficient, say so and ask a clarifying question. Do not
  fill gaps with plausible-sounding biology. Prefer "I cannot determine that
  from the information provided" over a guess.
- Separate validation from biological interpretation: a validator can confirm
  format, alphabet, record counts and parseability; it does not confirm that
  an organism is present or that a result is biologically correct.
- Taxonomy assignments are interpretations of BLAST evidence, not definitive
  species identification. State consensus disagreement, ties and abstention
  when those are present in the underlying result.
- A phylogenetic tree is a hypothesis about relationships, not an established
  conclusion. Topology support and validation status must be described as
  reported by the tool, not as proof.
- Respect reference and tool limits. Cite only reference keys present in the
  in-tree verified reference ledger; mark any unverified reference as
  unverified. Use only tool ids from the real advertised tool catalog. Do not
  claim a tool supports an input, output, parameter or backend that its
  manifest does not declare.
- Never claim that you independently validated or reproduced a result.
  Validation belongs to the platform's validator and evidence gate.
- Keep consent and approval separate from conversation. You may explain a
  plan and its destinations, but you never grant consent, approve a step,
  submit a job, or imply that a chat message constitutes approval. Approval
  happens only through the existing plan approval UI; external data transfer
  requires explicit, scoped, short-lived consent.
- Output phrasing is unverified by design. Say "AI-generated phrasing only.
  No scientific measurement or citation is asserted." when summarizing work.

WORKFLOW CATALOG (authoritative: providers/workspace/catalog.js, a deprecated
compatibility shim that re-exports functions/api/workspace/catalog.js;
CATALOG_VERSION = "1.0.0-m7.4")

1. id: "16s-rrna-identification"
   execution_availability.state: "available-browser-and-local-agent"
   execution_availability.production_ready: true
   note: "Uses the existing public /api/ai/requests -> approve -> BLAST path with
   a single-use consent token for external egress. No new execution was added
   in M7.4."

2. id: "msa-phylogenetics"
   execution_availability.state: "partial-not-production-ready"
   execution_availability.production_ready: false
   note: "Evidence: docs/M7_3_PHYLOGENETICS_WORKFLOW_REPORT.md. A real MAFFT
   step executed once, but the full multi-step remote tree/retrieval/validation
   path is NOT verified. No live Galaxy call is made by this workspace API and
   no provider is newly activated in this milestone."

Never describe "msa-phylogenetics" as production ready. Never promise that
either workflow will run from this conversation.

REGISTERED TOOL IDS (from functions/api/ai/registry.tools.generated.js):
phylogenetics.validate, phylogenetics.align, phylogenetics.tree,
phylogenetics.report, phylogenetics.workflow, sequence-stats.validate,
sequence-stats.profile, microbiome-16s.blast-parse,
microbiome-16s.taxonomy.
Use no other tool id. If a needed capability is absent, say it is unavailable
rather than naming a plausible-sounding nonexistent tool.

When data is insufficient, output a plan proposal with clarifying questions
and limitations. The proposal is never executable on its own.
```

---

## 6. Workflow planning flow and minimal context rules

1. A user asks for an analysis plan.
2. The assistant may **recommend or prepare** a structured proposal using `POST /api/assistant/plan`, which mirrors `plan.js`: a JSON-schema-constrained proposal whose `steps` are filtered against `registry.advertisedTools()`; unregistered tools appear only in `rejected_steps`.
3. The response is explicitly `requires_approval: true`, `executable: false`, `validated: false`, and includes `destination_disclosure`. The UI renders it as a reviewable card with limitations and clarifying questions.
4. **The assistant never executes.** No call to `/api/ai/plans/:id/approve`, `/api/providers/consent`, or any submit endpoint is made from chat code. The researcher uses the existing approval and consent UI; the governor, consent ledger, approval gate, provenance, validator and evidence ledger remain authoritative.
5. If the researcher runs an approved job elsewhere and asks about it, the assistant may describe the real artifact/reference fields returned by the existing endpoints, but still may not assert new scientific values or validation.

**Minimal context rules**

- No automatic whole-FASTA upload to the LLM. Ever. Raw biological content is only sent if a future, separately authorized feature explicitly does so under per-step consent — not in this design.
- Biological or project content goes to the model **only after explicit user action and an explicit consent/scope statement in the UI**; the default is to send only the user's typed question and the catalog/tool metadata the server already holds.
- General questions ("What is FASTA?", "How does 16S identification work here?", "Which tool validates a tree?") work with no data and no consent.
- Project context is a public id plus a short user-written description; no file bytes, no inferred ownership.

---

## 7. Interaction test plan, accessibility, responsiveness, limitations

### 7.1 Test plan

Offline/mocked tests may verify routing, state labels, disabled composer, keyboard behaviour, char limits, duplicate-submit prevention, and error rendering **only**. They are **not proof of production AI**: a passing mock suite does not establish that any model answered, that a provider is reachable, or that a scientific claim is valid.

Required checks once (and only once) an authorized provider exists, performed from the deployed Worker:

- `GET /api/assistant/status` reflects real health and honest unavailability today (`available:false`, `feature_flag_disabled`).
- `POST /api/assistant/message` with a real request returns a real `reply` with `evidence_status:"unverified"`, `validated:false`, real `usage` (or honest absent usage), and the exact typed 403 today.
- Plan proposal rejects an unregistered tool id into `rejected_steps`.
- A prompt designed to elicit a fabricated number or citation is refused by the system instruction and the evidence gate.
- Stop aborts the client request and leaves no server-side job; rapid double-submit yields one request.
- Approval/consent endpoints are never called by assistant code (asserted by network inspection).

### 7.2 Accessibility

- Composer has a programmatic label and described-by help for Enter/Shift+Enter and the character limit.
- New messages and state changes are announced through `aria-live="polite"`; errors use `role="alert"`.
- All controls are keyboard reachable with visible `:focus-visible` ring (`docs/DESIGN_SYSTEM.md`); sidebar collapse, rename, delete and regenerate have accessible names.
- No colour-only status: every state has text/icon; contrast follows the design token pairs.
- `prefers-reduced-motion: reduce` disables typing/streaming animations and smooth scroll.
- Markdown tables have header cells; copied sequences keep their monospace semantics.
- Modal confirmations (Clear all, Delete) trap focus and return focus to the invoking control.

### 7.3 Responsive

- Desktop: sidebar + timeline + composer three-column shell.
- Tablet/mobile (≤ 900 px): sidebar collapses into a drawer; the composer stays sticky above the virtual keyboard; long sequences and tables scroll horizontally within their container rather than breaking layout.

### 7.4 Honest limitations

- No authorized model is available; chat cannot work today (§0.1).
- Conversations are local only; no durable ownership, no account, no sync.
- No attachments, no file upload to the model, no autonomous execution.
- Streaming, cancellation and per-user quotas are not implemented in the current gateway; stop is client-side only.
- The single shared operator token is not a user identity; public exposure requires a separate durable-auth decision.
- Mocked tests and this document do not constitute evidence of a working AI feature.

---

## 8. Acceptance criteria — UI-complete vs chat-operational

**UI-complete (all must hold, and must be reported as UI-only):**

1. Sidebar (new, recent, search, rename, delete, clear, project context, active state, collapse) renders and is keyboard accessible.
2. Timeline, Markdown/code/table/citation rendering, copy and regenerate render correctly with real activity states only — no simulated activity anywhere.
3. Composer implements multiline, Enter/Shift+Enter, stop, loading/error, disabled-when-unavailable, 4 000-char cap, clear, and no attachments.
4. `/api/assistant/status` reports `available:false` with the typed `feature_flag_disabled` reason, and the composer is disabled with an explanatory banner.
5. Scientific result cards, suggested prompts and the system instruction text match §2.5, §2.6 and §5 exactly; no unregistered tool id or unverified citation is presented as valid.
6. Local/session-only storage is labelled honestly; no ownership or durability claim is made.
7. Accessibility and responsive checks in §7.2–7.3 pass; reduced motion is honoured.

**Chat-operational (additional, cannot be claimed today):**

8. An authorized, reachable server-side LLM is enabled for the deployed Worker through the existing secret workflow and the owner's explicit decision — **not** by this document.
9. A **real authorized model response** has been received from the deployed Worker for `POST /api/assistant/message`, with exact request/response evidence, timestamp and environment recorded.
10. Plan proposals, governor accounting, evidence gating and approval separation have been exercised with that live response.

**Final rule:** chat cannot be marked complete, operational, verified or "AI-powered" unless criterion 9 is satisfied by a real authorized model response. Until then the only truthful label is **"UI prepared — assistant unavailable (no authorized model provider)."** Mocked tests, created files, or this design document never satisfy criterion 9.
