# S Bio Assistant - Implementation and Honest Acceptance - CORE PRODUCT COMPLETION

**Verification date:** 2026-11-26
**Branch:** `product/core-completion`
**Base commit:** `8105956c908ea6c0d5c053b5ed2c13b86516d2a2`
**Starting commit (M7.6 reconciliation):** `0303e615e4cdf71a9b97038773a537beab9acdb9`
**Final commit:** `543358f8aa466b78fa8fab8c78eb2392e40f5881` (M7.6 code fix + documentation reconciliation)
**Current staging deployment:** `c00c6245-c91e-4bc2-9b64-881677b97972`
**Status:** Implementation description + acceptance split. This document is documentation-only: this worker changed no HTML/CSS/JS/config/migration/secret, contacted no provider and made no deployment. A separate code-fix worker is adding the corrected NCBI database identifier and 16S readiness changes after the starting commit.
**CURRENT implementation snapshot:** branch `product/core-completion`, base `8105956â€¦`, starting commit `0303e615â€¦`, staging deployment `c00c6245-c91e-4bc2-9b64-881677b97972`, verification date 2026-11-26.

**History (preserved, superseded â€” not current):** earlier branch HEAD at the M7.5 documentation-pass task start was `32abf86e6ab8da6819454103286c06e0b62d1076`; earlier staging deployments were `892f4266-2afa-4a0f-aa3f-00585764faf5` (tool registry, assistant, 16S flow) then `ed08189a-5db2-41b1-98f3-732b5c97992f` (resume-by-RID). Production untouched. `MOCK_NCBI` on staging was set to `0` to permit live NCBI; no other secret or provider was activated. No new live NCBI call or provider activation occurred in this M7.6 documentation pass.

**Evidence discipline:** every statement below is traceable to a file in the worktree or to the verified program evidence listed in `docs/CORE_PRODUCT_TEST_REPORT.md`. Where a capability is not working, the word **UNAVAILABLE** or **BLOCKED** is used rather than an aspiration.

---

## 1. Assistant identity and role

**Identity:** "S Bio Assistant" - a guidance assistant for Smart Bioinformatics AI. The brand mark is `web-platform/public/brand/sbio-assistant.svg`; the page is `web-platform/public/assistant.html`; the UI controller is `web-platform/public/js/assistant.js`; the server-side gateway is `web-platform/functions/api/assistant/index.js`.

**Role (from the authoritative system instruction, `functions/api/assistant/index.js:14-89`):** help the user understand sequence formats, FASTA, 16S rRNA analysis, BLAST parsing, taxonomy, MSA, phylogenetics, tool parameters, workflow choices and analysis plans. The instruction explicitly says the assistant is **NOT** an autonomous scientist, **NOT** a source of scientific truth and **NOT** a validation engine.

**Division of labour (unchanged from `docs/PRODUCT_NORTH_STAR.md` آ§1):**

| Concern | Owner | Assistant may not |
|---|---|---|
| Conversation, clarifying questions, plan explanation, phrasing | Assistant UI / future model gateway | Produce scientific values, validate, approve, grant consent, execute |
| FASTA validation, statistics, BLAST TSV parsing, taxonomy verdicts | Browser utilities + registered engines | Claim a dataset was analysed because it was mentioned |
| Approval, consent, job records, provenance, reports | Worker control plane | Treat a chat message as approval or consent |

The assistant is therefore an **interface**, not an executor. Every assistant reply is phrasable only (`evidence_status:"unverified"`, `validated:false` in the design contract, `docs/ASSISTANT_UX_DESIGN.md`); no assistant surface creates a job.

---

## 2. What is actually implemented

The assistant page has three working surfaces. All of them are honest about what they are.

### 2.1 Chat UI - complete, deliberately disabled

`web-platform/public/js/assistant.js` implements:

- Conversation list with new/rename/delete/search, all **tab-local** (`local-${Date.now()}-...` ids, in-memory `state.conversations`; the UI repeatedly states "Nothing has been stored on a server" and "this tab only").
- Message timeline with avatar, role labels, timestamps, copy/retry, and a small safe Markdown renderer (paragraphs, headings, lists, tables, code blocks, inline emphasis, links). All untrusted text is written with `textContent`/DOM nodes, never `innerHTML` (`assistant.js:1-4,66-71,248-415`).
- Composer with a 4000-character cap (`MAX_CHARS`), live count, Enter-to-send / Shift+Enter newline, abort via `AbortController`, and typed error display.
- Sidebar toggle with `aria-expanded`, search, Escape-to-close and focus return; confirmation `<dialog>` flows with focus return.
- Activity stage strip (8 stages from `functions/api/assistant/index.js:101-104`) whose stages stay `not-started` because no gateway event exists.
- `loadStatus()` calls `GET /api/assistant/status` and **fails closed for every outcome**, including a status-check failure or an unexpected `"available"` claim from a proxy (`assistant.js:718-736`). `setUnavailable()` disables input, send and stop and shows the exact banner: "AI chat is unavailable: no authorized model provider is configured for this deployment." (`assistant.js:9,702-716`).
- `sendMessage()` refuses when `state.available` is false; when it is called it posts to `api/assistant/chat` and only renders a real `data.reply` from the gateway. A non-OK response adds a system message "No response was generated. No model provider was contacted." (`assistant.js:738-813`).

### 2.2 Capability browser - real registry read

`renderCatalog()` calls `GET /api/tools/catalog`, requires both a `tools` array and a string `catalog_version`, and otherwise shows "Registry unavailable - no capabilities are fabricated." (`assistant.js:657-689`). It renders one card per entry with id, availability chip, production-readiness chip, scientific purpose, description, inputs, outputs, formats, validation requirements, execution location, dependencies, limitations and a working entry-point link to an existing page. Under `file://` it says the catalog is only available when served by the platform and lists nothing (`assistant.js:660-667`).

Verified live result on the deployed staging build: **12 real entries** from `providers/tools/registry.js`, catalog version `1.0.0-m7.4` (ids confirmed by importing the registry module: 2 workflows + 9 generated tools + 1 Worker tool). The browser never mutates the catalog and cannot start a job from a card (`assistant.js:529-531`).

### 2.3 Deterministic plan draft - not AI-generated, no execution

Selecting a capability and pressing "Draft plan" renders `renderPlanDraft()` (`assistant.js:620-655`). Its sections are Objective, Input requirements, Recommended workflow, Expected outputs, Validation, Limitations, External destination (if any), Approval requirement, and - for phylogenetics - Workflow readiness. The heading is literally "Deterministic draft for <id>". The approval row states: "This draft grants nothing. Execution requires the existing approval and consent flow through the tool's own page."

These drafts are assembled from registry fields (`scientific_purpose`, `validation_requirements`, `recommended_workflow`, output schema, `limitations`, `external_destinations`). **No model is called and no plan is executed.** The real, executable plan is a different artifact: the deterministic server planner (`web-platform/functions/api/ai/planner.js`) plus `/api/ai/requests` and `/api/ai/plans/[id]/approve`, used by the 16S flow. The two must not be conflated.

---

## 3. Context rules

- A project/dataset id may be typed into the sidebar. The browser accepts only `^(proj|ds)_[0-9a-f]{16}$` and marks other text `aria-invalid` (`assistant.js:10,846-852`). The active-context line says ids only: "no dataset bytes are fetched or sent" (`assistant.js:547-554`).
- The same public-id pattern is re-validated server-side in `POST /api/assistant/chat`; a bad id is a 400 typed error (`functions/api/assistant/index.js:173-176`).
- The browser cannot supply a system prompt or choose a provider: `system`, `model`, `provider`, `messages` and `content` are rejected as unsupported fields rather than merged (`assistant/index.js:152-158`).
- No provider credentials, URLs, keys or system prompts are read or echoed by the gateway (`assistant/index.js:137`); no credential is present in HTML/JS.
- Body is capped at 16 KiB and a message at 4000 characters (`assistant/index.js:93-94,162-164`).
- Conversations are not persisted on the server; the workspace is metadata-only and has no user accounts. There is no auth launch in this program.

---

## 4. Model-provider audit - exact blocker

**Result: no authorized, reachable remote model provider exists for the Worker. AI chat is UNAVAILABLE.**

| Probe | Verified behaviour | Evidence |
|---|---|---|
| `GET /api/assistant/status` | `200`, `{available:false, type:"assistant_provider_unavailable", reason:"no_enabled_llm_provider", candidate_provider:"ninerouter", execution_mode:"real"}`, 8 stages `not_started` | `functions/api/assistant/index.js:91-104,106-139`; `docs/M7_4_2_ACCESSIBILITY.md:64` |
| `POST /api/assistant/chat` | `503`, `{available:false, generated:false, type:"assistant_provider_unavailable", reason:"no_enabled_llm_provider"}` and detail "No response was generated. No model provider was contacted."; header `X-Assistant-Error: assistant_provider_unavailable` | `assistant/index.js:119-131,141-180` |
| 9Router (the only chat-capable adapter) | Disabled in both environments; no base URL/key; `AI_LLM_PROVIDER` is Python-only and never read by the Worker | `providers/ninerouter/index.js`; `docs/CORE_CAPABILITY_MATRIX.md` آ§4 (`EX-NINEROUTER-*`) |
| smarts.bio | Disabled in both environments and requires written owner authorization; no call made | `providers/smartsbio/index.js`; `docs/CORE_CAPABILITY_MATRIX.md` آ§4 |
| Provider probe (historical) | `403 feature_flag_disabled`; no fallback, no mock | `docs/M7_1_LIVE_ACTIVATION_REPORT.md` |

The gateway is intentionally fail-closed: even with a flag and secret injected in an offline test, `fetch` was asserted never to be called and no secret name/value appeared in bodies or headers (`docs/M7_4_2_ACCESSIBILITY.md:60-68`). **This is evidence of honest unavailability, not evidence that chat works with a real model.**

No provider was activated in this program, no key was installed, and no live provider call was made. The assistant therefore remains unavailable (`/api/assistant/status` â†’ `available:false`, `reason:"no_enabled_llm_provider"`; `/api/assistant/chat` â†’ 503 `generated:false`) and **no AI prose is fabricated**: no canned reply, no invented number, citation or scientific conclusion is presented as a model response.

---

## 5. System-instruction plan (held, not active)

`ASSISTANT_SYSTEM_INSTRUCTION` lives server-side at `functions/api/assistant/index.js:14-89`. It is deliberately **unused** while no provider exists; it is a plan for a future, separately authorized integration, not a live behaviour claim. Its rules:

1. State uncertainty; distinguish established method facts from hypotheses; never upgrade a hypothesis into a conclusion.
2. Never invent or compute results, statistics, p-values, accessions, sequences, dates or citations; if a value did not come from a validated tool or evidence record, do not state it.
3. Never claim that a mentioned dataset was uploaded, analysed, aligned, searched or validated; call it "the dataset you described" until a real tool result exists.
4. Ask clarifying questions when evidence is insufficient; separate validation (format/alphabet/parseability) from biological interpretation.
5. Treat taxonomy assignments as interpretations of BLAST evidence and trees as hypotheses; report disagreement, ties, abstention and validation status as the tool reported them.
6. Cite only reference keys in the in-tree verified ledger; name only tool ids from the real catalog; never claim a tool supports an undeclared input/output/parameter/backend.
7. Never claim independent validation or reproduction; that belongs to the platform validator and evidence gate.
8. Keep consent and approval out of conversation: a chat message never grants consent, approves a step or submits a job; external transfer requires explicit scoped short-lived consent.
9. Output phrasing is unverified by design; say "AI-generated phrasing only. No scientific measurement or citation is asserted."

The instruction historically embedded the workflow catalog states as declared at base: `16s-rrna-identification` was labelled `available-browser-and-local-agent` / `production_ready:true` via the consent-gated request path; `msa-phylogenetics` is `partial-not-production-ready` / `production_ready:false`, with a real MAFFT step historically but no verified full remote tree/retrieval/validation path. **M7.6 reconciliation:** the overall 16S end-to-end workflow is **PARTIAL / `production_ready:false`** until genuine NCBI results are retrieved, validated, displayed and exported. Browser-only statistics and the genuine consent-governed submission are individually verified, but the real job `GF4KCK07016` FAILED at NCBI because our code used the invalid bare database `16S_ribosomal_RNA`; no real TSV was retrieved (`docs/evidence/M7_6_NCBI_DIAGNOSIS.md`). The instruction must describe neither phylo nor the overall 16S workflow as production ready, and must never promise execution from chat.

**Known limitation to reconcile before activation:** the instruction's literal registered-tool-id list mirrors the nine generated manifest ids and does not include the Worker-side `ncbi.blastn` capability, which is registered through `WORKER_TOOLS` in `functions/api/ai/registry.js:15-60`. This has no runtime effect today because the instruction is inactive; it should be updated when a provider is authorized.

---

## 6. Why there are no canned answers

- The gateway returns a typed 503 with `generated:false` and no reply field; it does not substitute a demo string (`assistant/index.js:106-131,178-180`).
- The browser adds a system message "No response was generated. No model provider was contacted." and never synthesizes an assistant message (`assistant.js:776-782`).
- A result card is rendered only from a real gateway `result_card` object and is headed "Scientific result - unverified phrasing", with the note that no measurement or citation is asserted and no approval/consent/execution occurred (`assistant.js:417-452`).
- Suggested prompts only fill the composer; they do not send or generate (`assistant.js:877-884`); the 9/9 M7.4.2 browser checks confirm zero fabricated messages and eight `not-started` stages (`docs/M7_4_2_ACCESSIBILITY.md:26`).
- Offline `file://` previews show no tools rather than a fixture list (`assistant.js:660-667`).

The product rule is that an honest unavailability is a successful product response; a plausible-sounding answer would be a defect.

---

## 7. Tool-calling orchestration boundaries

The future assistant may explain a plan; it may never bypass the following gates. These gates are implemented independently of chat and are exercised by the 16S flow.

| Boundary | Implementation | Effect |
|---|---|---|
| **Registered** | `functions/api/ai/registry.js` exposes `getTool`, `isKnownTool`, `toolIds`; `planner.js` uses a closed `TOOL_BY_INTENT` map (`validate_and_profile â†’ sequence-stats.profile`, `identify_taxa â†’ ncbi.blastn`, `phylogenetics â†’ phylogenetics.workflow`). An intent can never select a tool from free text. | Unknown or unavailable tool ids produce no plan step; a clarifying question or typed unavailability is returned instead (`planner.js:85-127`). |
| **Schema-validated** | `validateParams()` checks `required`, `additionalProperties:false`, `type`, `enum`, `minimum`, `maximum` for each tool's `params_schema` (`registry.js:82-135`); `shared/schemas/plan.schema.json` validates plans. | Database/program are the exact constants the consent token is bound to (`ALLOWED_DATABASE`, `ALLOWED_PROGRAM`); no free-text parameter reaches egress. |
| **Consent-gated** | Explicit checkbox and `POST /api/ai/plans/:id/approve` issue a single-use token bound to input hash, database and program with an expiry; `/api/blast/submit` resolves then atomically burns the token **before** any NCBI call (`blast/submit.js:69-96`); migrations `0003_blast_consent.sql` and `0004_blast_consent_unique.sql`. | No job without approval; a direct POST without a valid unused token cannot reach egress; mock mode is gated too. The browser deliberately does not display the token value (`16s-flow.js:267-272`). |
| **Recorded** | A pending egress audit row (hash, target, byte counts, mock flag) is written before the call and finalized with success/status/error/RID (`blast/submit.js:98-152`); status polling is capped at one per 60 s with `429` + `Retry-After` (`blast/status/[rid].js:53-62`); provenance and result records are written by the Worker. | Every external action is auditable; a completed or failed RID is never polled again; no silent fallback. |
| **No self-approval** | Plans are immutable, approvals are one-way, and the assistant has no route to either. | A plan proposal, capability card or chat message is never an approval. |

The assistant capability browser is read-only: `state.catalog` comes from `GET /api/tools/catalog`; nothing in it can start a job, grant consent or turn a draft into an approval (`assistant.js:529-531,606-617`).

---

## 8. Acceptance split - UI-complete vs chat-operational

| Track | Verdict | Evidence | What it means |
|---|---|---|---|
| **Assistant UI complete** | **PASS** | `assistant.js` surfaces; `assistant.test.mjs` **10/10**; UI E2E **10/10**; M7.4.2 E2E **9/9**; 12 real catalog entries served by `/api/tools/catalog` | Conversations, honest banner, disabled composer, capability browser, deterministic drafts, accessibility/keyboard behaviour and fail-closed API are complete. |
| **Assistant chat operational** | **BLOCKED / NOT ACHIEVED** | `reason:"no_enabled_llm_provider"`; `/api/assistant/chat` 503 `generated:false`; no authorized provider | No real model response has been generated by any provider in any environment. Passing UI/mock tests do not count as chat success. |
| **Deterministic planning** | **PASS (non-AI)** | `planner.js`; 16S plan shown in live evidence with `step_1 آ· ncbi.blastn` and explicit egress/consent declarations | The plan is rule-based and registry-validated. It is not AI-generated. |
| **Execution from assistant** | **OUT OF SCOPE / NOT SUPPORTED** | `assistant.js` cannot create a job; `docs/PRODUCT_NORTH_STAR.md` آ§1 | The draft grants nothing; real execution happens only through the 16S page's approval/consent chain. |
| **Overall 16S workflow readiness (cross-reference)** | **PARTIAL / `production_ready:false`** | Real consent-governed submission produced RID `GF4KCK07016`, but NCBI reported `Status=FAILED` (`invalid database [16S_ribosomal_RNA]`); no real TSV retrieved; `docs/evidence/M7_6_NCBI_DIAGNOSIS.md` | Browser-only statistics and the submission are individually verified; browser BLAST parser/taxonomy are exercised with labelled synthetic TSV only. Corrected live submission needs explicit owner authorization and has not happened. |

**Definition of done for this document:** a reader can distinguish the UI shell, the deterministic plan draft and the real 16S handoff from the unavailable AI chat, and will not read a mocked or disabled state as model intelligence.

---

## 9. Evidence and file references

- `web-platform/public/assistant.html`, `web-platform/public/js/assistant.js`, `web-platform/public/css/assistant.css`
- `web-platform/functions/api/assistant/index.js` (system instruction, status/chat handlers)
- `web-platform/functions/api/tools/catalog/index.js`, `web-platform/providers/tools/registry.js`
- `web-platform/functions/api/ai/planner.js`, `functions/api/ai/registry.js`, `functions/api/ai/registry.tools.generated.js`
- `web-platform/providers/ninerouter/index.js`, `web-platform/providers/smartsbio/index.js`
- `web-platform/tests/assistant.test.mjs`, `web-platform/tests/m7_4_2_browser.e2e.mjs`
- `docs/ASSISTANT_UX_DESIGN.md`, `docs/M7_4_2_ACCESSIBILITY.md`, `docs/CORE_CAPABILITY_MATRIX.md`, `docs/PRODUCT_NORTH_STAR.md`
- Screenshots: `web-platform/test-results/core/assistant-capability-1440x900.png`, `assistant-plan-draft-1440x900.png`, `assistant-capability-390x844.png`; `web-platform/test-results/uiux/m742/assistant-*.png`

---

## 10. Constraints preserved

No auth B2, no R2, no new provider, no migration, no scientific algorithm change, no production deploy and no live Galaxy call. No secret was activated or disclosed; `MOCK_NCBI=0` on staging only permitted the already-implemented NCBI path. The existing design system and naming ("S Bio Assistant", "Precision Instrument Bench") are unchanged.


