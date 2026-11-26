# M7.5-A Threat Model — Public Research Platform Foundation

**Status:** DESIGN ONLY — analysis and planning artifact. No code, migration, binding, secret, configuration, deployment, or live Galaxy call was changed or created for M7.5-A.
**Date:** 2026-11-26
**Repository state at audit time:** HEAD `e1a523a8`, branch `phase-1-robustness-safety`. UI edits were then present in `web-platform/public/` (`workspace.html`, `workspace.js`, `project-context.js` then untracked, plus `ai.html`, `blast.html`, `phylo.html`, `index.html`, `components.css`, and two test files). Those edits were **read only** and were **not** modified, staged, committed or reverted by this document. All statements below reflect the code as reviewed at audit time, derived from the checked-in source plus a read-only inspection of the UI files as then present. **Note:** the UI work was subsequently committed externally as `90df75e` and `fdc3f26` (HEAD `fdc3f26` at time of note); this document describes the audited version, not the current tree.

## Companion documents (M7.5-A design set)

This document is one of five M7.5-A design deliverables under `docs/`, all under the same DESIGN-ONLY status and the same decision gates:

| Document | Purpose |
|---|---|
| `M7_5_FOUNDATION_DESIGN.md` | Target platform foundation, trust model and capability boundaries |
| `M7_5_AUTH_PROVIDER_DECISION.md` | Human identity provider evaluation (Better Auth primary, Clerk alternative) |
| `M7_5_DATA_LIFECYCLE.md` | Storage abstraction, R2 decision gate, retention/deletion and consent lifecycle |
| **`M7_5_THREAT_MODEL.md` (this file)** | Threats, existing controls, proposed controls, residual risk, acceptance tests |
| `M7_5_IMPLEMENTATION_ROADMAP.md` | Ordered milestones, dependency graph, gates, migration/rollback |

Source of truth for the five-document set: `SYSTEM_ARCHITECTURE.md` §12.

## Fixed contract (non-negotiable for this design)

- **Human auth** = Better Auth on Workers + D1 (primary) / Clerk (alternative). No bespoke credential store.
- **Storage** = R2 is the *recommended* durable object store but is **not activated**; it sits behind an abstraction and is gated by an explicit owner decision. Today artifact endpoints fail closed.
- **Operator token** (`X-Agent-Token` / `env.AI_AGENT_TOKEN`) is kept **strictly separate** from any human identity and is never a fallback user credential.
- **D1 holds metadata only** for the target state; inline FASTA exists today only on the legacy path.
- **Legacy operator-owned rows are never auto-assigned to a new human user.** Ownership transfer is an explicit, audited, owner-approved procedure.
- **No compliance claims** are made (no HIPAA/GDPR/“secure by certification” assertions). Data-lifecycle and privacy wording is descriptive, not a legal guarantee.
- **No implementation now.** Everything in §7–§10 is a proposal for a future, separately-approved milestone.

---

## 1. Scope, methodology and current-state baseline

### 1.1 Scope

In scope: the Worker routing layer and all `/api/**` handlers in `web-platform/functions/api/**`, the private artifact store in `web-platform/storage/`, the D1 schema in `web-platform/migrations/`, runtime configuration in `wrangler.toml`, and the browser UI in `web-platform/public/` as reviewed at audit time that consumes these APIs.

Out of scope: the Python engine and its scientific correctness, third-party provider security posture (NCBI/Galaxy/SmartBio/NineRouter — treated as external trust boundaries), physical/infrastructure security of Cloudflare, and any legal/compliance attestation. No external documentation was needed to establish the current-state claims, which are all local-code facts; where a future-facing claim depends on an external product behavior it is marked **unverified / unknown** rather than asserted.

### 1.2 Methodology

STRIDE-per-element, adapted to a serverless Worker with a single shared operator principal today and a planned multi-user human identity later. Each identified threat is classified as:

- **REALISTIC CURRENT** — reachable and material at the audited HEAD (`e1a523a8`), given the code as written.
- **FUTURE** — introduced or materially changed by the M7.5 human-identity/multi-user design; not reachable today because the prerequisite (accounts, sessions, multiple principals) does not yet exist.

Likelihood is qualitative (Low / Medium / High) for the current deployment posture, not a numerical estimate. Numeric thresholds that are not actually enforced by code (for example a durable rate-limit quota) are labelled **unknown / not enforced** rather than guessed.

### 1.3 Trust boundaries

```
    Browser (untrusted)
      |  X-Agent-Token (operator) / future human session cookie
      |  HTTPS, same-origin CORS, CSP from _headers
      v
+---------------------------------------------------------------+
| Worker edge  (worker.js)  -- no authentication middleware today |
|   /api/** -> ROUTES table -> onRequest handler                  |
|   non-/api -> env.ASSETS.fetch (static pages, JS, CSS)          |
+---------------------------------------------------------------+
      |                    |                    |
      v                    v                    v
 +----------+        +-----------+        +----------------+
 | D1 (BLAST_DB)     | R2 (NOT    |        | External       |
 | metadata +        | activated;|        | providers      |
 | inline FASTA      | fail-closed)|       | NCBI / Galaxy  |
 | legacy ai_requests| signed HMAC|        | (consent gate) |
 +----------+        +-----------+        +----------------+
```

- **TB1 Browser → Worker**: all inputs untrusted; CORS is same-origin reflect only; CSP is set on every API response.
- **TB2 Worker → D1**: all SQL is parameterized via `SQL`/`SQL_META` with `?` binds; no string concatenation of user data into SQL was found.
- **TB3 Worker → R2**: only reachable when `ARTIFACTS` binding and `ARTIFACT_SIGNING_KEY` exist; otherwise `createArtifactStore` throws and endpoints return 503.
- **TB4 Worker → external provider**: gated by explicit per-dataset, per-provider consent tokens; provider is an external trust boundary, not trusted with other datasets.
- **TB5 Operator principal vs future human principals**: today there is exactly one class of principal (the holder of the shared operator token). The design introduces a second (human users) and must never conflate them.

### 1.4 Verified current-state baseline

| Area | Verified fact | Source symbol / file |
|---|---|---|
| Routing | Every `/api/**` path matches an explicit regex `ROUTES` table; unknown API paths return 404, never fall through to assets. `next()` fails closed. | `worker.js` — `ROUTES`, `createFetch`, `makeContext` |
| Routing auth | There is **no** authentication or authorization middleware in the router. Auth, where present, is per-handler. | `worker.js` — `createFetch` / `handlers` |
| Static assets | Non-API requests delegated to `env.ASSETS.fetch`; binding failure returns 503 with CSP/nosniff/no-referrer/no-store. | `worker.js` — `serveAsset`, `ASSET_UNAVAILABLE_HEADERS` |
| Static headers | `Content-Security-Policy: default-src 'self' blob:; script-src 'self' …; frame-ancestors 'none'` etc. | `web-platform/public/_headers` |
| API headers | Every JSON/HTML response sets `default-src 'none'`, `frame-ancestors 'none'`, `nosniff`, `no-referrer`, `no-store`; same-origin-only CORS reflect. | `functions/api/ai/_lib.js` — `baseHeaders`, `corsHeaders`, `jsonResponse`, `htmlResponse` |
| D1 binding | Only `BLAST_DB` is configured; `getDb()` prefers optional `AI_DB` but falls back to `BLAST_DB`. Staging has its own D1 id. | `wrangler.toml` `[[d1_databases]]`; `ai/_lib.js` — `getDb` |
| R2 | **No R2 binding in `wrangler.toml`** (commented-out example only); `ARTIFACT_SIGNING_KEY` documented as a `wrangler secret put`. Store fails closed without both. | `wrangler.toml` lines 20–23; `storage/r2.js` — `createArtifactStore` |
| Operator token | `AI_AGENT_TOKEN` is compared in constant time against `X-Agent-Token`; never stored, logged or returned. | `ai/_lib.js` — `agentTokenError`, `constantTimeEqual` |
| Owner derivation | `deriveOwner` hashes the operator token with SHA-256 and keeps only `owner_<hex16>`; the raw token is never persisted. | `workspace/_lib.js` — `deriveOwner` |
| Workspace authz | Every workspace SQL statement pins `owner` equality; cross-owner reads/writes match no rows. | `ai/_lib.js` — `SQL.getWorkspaceProject`, `getWorkspaceDataset`, `getWorkspaceRun`, `updateWorkspaceRun`, …; `workspace/_lib.js` — `getProject`, `getRun` |
| Workspace DTO | `toProjectDto` and `toDatasetDto` expose `owner` (a derived non-secret), never the token. | `workspace/_lib.js` — `toProjectDto`, `toDatasetDto` |
| Schema | `0011_workspace.sql` is additive only: no `DROP`, no column redefinition; `projects.owner` pre-exists from `0002_ai_platform.sql`. | `migrations/0011_workspace.sql` |
| Input validation | Body caps (`MAX_REQUEST_BODY_CHARS` 128 KiB, `MAX_FASTA_BYTES` 64 KiB, `MAX_RESULT_BODY_CHARS` 2 MiB), ID whitelist, safe string/filename helpers, state machine. | `ai/_lib.js` — constants, `readJsonBody`, `isPublicId`, `safeString`, `sanitizeFilename`, `validate*`; `workspace/_lib.js` — `STATE_TRANSITIONS` |
| Artifact tickets | HMAC-SHA-256 signed, constant-time verified, `exp`-bounded, operation-bound (`upload`/`download`/`delete`); TTL capped at 15 min default. | `storage/r2.js` — `sign`, `verify`, `createUploadTicket`, `createDownloadTicket`, `createDeleteTicket` |
| Upload integrity | Streaming hash + byte count; mismatch deletes the object; 64 MiB cap; extension allowlist. **No content/magic-byte inspection or malware scan** was found. | `storage/r2.js` — `storeStream`, `MAX_ARTIFACT_BYTES`, `ALLOWED_EXTENSIONS`, `isAllowedFilename` |
| Download authz | `download-url` requires owner token **or** a granted, dataset-scoped, unexpired `pcon_` consent. | `functions/api/artifacts/[id]/download-url.js` |
| Delete authz | `delete.js` requires owner token **or** a signed `delete` ticket; ticket's `object_key` must match the stored row. | `functions/api/artifacts/delete.js` |
| Rate limiting | `rateLimit()` is an **in-memory per-isolate** map keyed by `CF-Connecting-IP`/`X-Forwarded-For`; explicitly documented as not durable. Used on `consent` (20/5 min) but not on the legacy AI/BLAST submit paths. | `providers/_lib.js` — `rateLimit`; `providers/consent.js` |
| Consent gate | External egress requires explicit `granted=true`, dataset+provider scope, bounded TTL (≤30 min); BLAST submit requires a single-use, input-hash-bound consent token even in mock mode. | `providers/consent.js`; `blast/_lib.js` — `claimConsent`; `blast/submit.js` |

### 1.5 Credential and exposure checks (explicit)

These checks were performed directly against the tree at audit time, including the UI files as then present:

1. **The browser never receives `AI_AGENT_TOKEN`.** The only server-side reads are `request.headers.get("X-Agent-Token")` in `agentTokenError` (`ai/_lib.js:265`) and `deriveOwner` (`functions/api/workspace/_lib.js:74`). No response builder includes it; `providerPayload` returns only `execution_mode` and `generated_at` plus call-site fields. No code writes the secret into HTML, JSON, logs, or audit rows. `workspaceAudit`/`audit` persist `actor`/`action`/`target`/`detail` only, and `deriveOwner` persists a hash. **Verified.**
2. **No long-lived credentials in HTML/JS/localStorage/sessionStorage/public API responses.** A grep of `web-platform/public/` for token/secret/key patterns found only `workspace.html`'s explanatory label and `workspace.js`'s module variable. `api/.../providers/chat.js` contains `input_tokens`/`output_tokens`, which are usage metrics, not credentials. No secret literal was found in public assets at audit time. **Verified.**
3. **Workspace UI storage behavior at audit time (read-only confirmation).** `public/js/workspace.js`:
   - `let token = ""` — operator token is held **only in module memory**, set from the input, sent as `X-Agent-Token` only when non-empty (`api()` at line 192), and cleared on disable. No `sessionStorage` use.
   - `LOCAL_KEY = "m74_workspace_local_v1"`; `localStorage.setItem(...)` stores exactly `{ projects, datasets, runs }` metadata JSON (`saveLocalState`, lines 144–152). No file bytes, no tokens, no URLs are persisted. The storage-clear control only removes this key.
   - Every dynamic value is inserted via `node()`/`textContent` (line 161–165); there is no `innerHTML` assignment. This is a real XSS mitigation in the UI as reviewed at audit time.
   - `public/js/project-context.js` reads `?project=` and writes it with `textContent` after a `^[A-Za-z0-9_-]{1,100}$` check; no token or API call.
   **Verified.** Note: this finding reflects the *version audited at HEAD `e1a523a8`*, not a claim about the current tree; re-check it at implementation time.
4. **Legacy public routes — classification.** (a) `/api/ai/requests` (`functions/api/ai/requests/index.js`) has **no auth check and no rate limit**; it accepts FASTA inline (≤64 KiB, body ≤128 KiB), persists `d1://datasets/<id>` rows in shared D1, and returns `request_id`/`plan_id`/`dataset_id`. This is a **REALISTIC CURRENT** abuse/exposure surface: anonymous callers can write rows and consume D1/CPU; data is not scoped to any caller. (b) `/api/blast/*`: `submit` is unauthenticated but **fails closed** without a valid single-use consent token before any NCBI egress (`blast/submit.js`, `blast/_lib.js` — `claimConsent`); `status/:rid` and `results/:rid` are **public-by-possession** — anyone with a valid `rid` can read status/results (`results/[rid].js` — `handleResults`, no owner check). RIDs are validated by pattern, not by ownership. This is a **REALISTIC CURRENT** cross-user read risk if an RID is guessed, leaked, or shared; RID entropy is **unknown / not specified by code**.
5. **Loading `workspace.html` does not prove visitor API access works.** In local mode the page reads `local.projects` and never calls the API; in operator mode every API call requires the operator token. Merely rendering the page therefore demonstrates **no** visitor-level authorization or data access. Any future acceptance test must distinguish "page loads" from "authenticated human API call succeeds".

---

## 2. Capability / asset inventory

| Asset | Classification today | Notes |
|---|---|---|
| `X-Agent-Token` secret | **Secret — highest value** | Single shared operator bearer credential; full API access. Rotation/clearance owner-controlled. |
| `AI_AGENT_TOKEN` env var | Secret | Server-side only; never in responses. |
| `ARTIFACT_SIGNING_KEY` | Secret | Signs R2 tickets; ticket URLs are capabilities but the key is never exposed. |
| Operator-derived `owner_<hex16>` | Non-secret pseudonymous principal | SHA-256 prefix of token; used as SQL filter; appears in DTOs. |
| D1 rows (`projects`, `datasets`, `workspace_runs`, `provenance_records`, `blast_requests`, `blast_consents`) | Sensitive metadata; legacy inline FASTA is sensitive content | Metadata-only in the target design; `fasta_text` currently populated on the legacy path. |
| Signed artifact URLs | Short-lived capabilities | 15-min default TTL; operation-bound; not long-lived credentials. |
| Consent tokens (`pcon_`) / BLAST consent tokens | Short-lived capabilities | Bounded TTL, single-use/scope-bound for BLAST; provider-scoped for R2/Galaxy. |
| Run reports / provenance | Sensitive research output | Currently gated via parent-run owner check and authenticated API only. |
| Human account/session data | **Does not exist today** | Future asset introduced by M7.5; becomes high value in the target state. |

---

## 3. Threat register

Legend: **C** = REALISTIC CURRENT, **F** = FUTURE (post-human-identity). Impact/Likelihood/Residual are qualitative for the current deployment posture.

| ID | Threat | Class | Impact | Likelihood | Existing controls (verified) | Proposed controls (design only) | Residual risk | Verification test (future) |
|---|---|---|---|---|---|---|---|---|
| T-01 | Account takeover | F | High — full user data | Unknown (no accounts today) | None applicable; no user accounts exist. | Better Auth email+password with verified email, breached-password check, MFA option, secure reset flow; Clerk alternative with equivalent. No bespoke credential store. | Medium until MFA/adaptive controls; owner decision gate on provider. | `AT-01` reset-flow, `AT-02` password-reuse/MFA enforcement. |
| T-02 | Session theft | F | High — impersonation | Unknown (no sessions today) | None applicable; no cookie sessions today. | HttpOnly+Secure+SameSite=Lax cookies, short TTL + server-side revocation, session rotation on privilege change, CSRF token binding. | Low–Medium (browser malware out of scope). | `ST-01` revoked-session, `ST-02` cookie-flag assertion. |
| T-03 | Cross-user project access | C (limited) / F | High — data disclosure | Medium today (single shared principal); High after multi-user | Workspace SQL pins `owner` equality (`SQL.getWorkspaceProject` et al.); cross-owner rows return 404; `deriveOwner` hash. | Replace derived operator owner with authenticated `user_id`; enforce `owner = session.user_id` in every statement; add ownership to reports/artifacts; explicit ownership transfer only. | Medium today (shared token = one principal); Low after per-user scoping if enforced. | `CROSS-01` cross-user 404, `CROSS-02` list isolation. |
| T-04 | IDOR | C (legacy) / F | Medium–High | Medium today on legacy RIDs; High later | ID whitelist `isPublicId`/`PUBLIC_ID_PATTERN`; workspace owner predicates; `results/:rid` has **no** owner check. | Opaque IDs + server-side object-level authorization on every `:id`; centralize an `authorize(resource,user,action)` guard; deny by default. | Medium until legacy routes migrated. | `IDOR-01` foreign-run 404, `IDOR-02` foreign-artifact 403. |
| T-05 | Dataset URL leakage | C | Medium — link-based disclosure | Low–Medium | `FORBIDDEN_URL_KEYS` rejects `url`/`download_url`/`href`/`link`/`uri` in dataset create; `provider_history_ref` rejects `http(s)://`; signed URLs TTL-bound; no public bucket. | Keep metadata-only DTOs; issue download URLs only via authenticated endpoint; short TTL + audit; no URLs in list responses. | Low if kept metadata-only. | `URL-01` no URL fields in dataset DTO, `URL-02` expired signed URL. |
| T-06 | Unauthorized downloads | C (partial) / F | Medium–High — data exfil | Medium | `download-url.js` requires owner token or granted dataset-scoped unexpired `pcon_`; `content.js` verifies ticket; no public bucket. | Bind download tickets to `user_id` + dataset ownership in addition to token; revoke on ownership change; log every issuance. | Low–Medium (consent-to-different-dataset is already checked). | `DL-01` no-token 403, `DL-02` wrong-dataset consent 403. |
| T-07 | Upload abuse | C | Medium — storage/CPU cost | Medium–High (no durable rate limit) | `MAX_ARTIFACT_BYTES` 64 MiB; byte/sha verification; extension allowlist; `rateLimit` only on consent; **`upload-url` has no auth**. | Per-user upload quota + durable rate limit (D1/KV), auth required to mint ticket, asynchronous AV/content scan, quarantine before "stored" status. | Medium today; Low after quota+auth. | `UP-01` oversize 400, `UP-02` anonymous ticket denied, `UP-03` quota exceeded. |
| T-08 | Malicious files | C | Medium–High if downstream executed | Medium | Sanitized filenames, allowlisted extensions, hash verification, CSP/`nosniff`/`Content-Disposition: attachment` on download. **No magic-byte/AV scan found.** | Magic-byte validation against declared type, AV/CDR scan, quarantine, no server-side execution of uploads, strict MIME allowlist. | Medium (no scanning today). | `MF-01` disguised executable rejected, `MF-02` magic-byte mismatch rejected. |
| T-09 | DoS | C | Medium — availability/cost | Medium–High on public legacy routes | Body caps; in-memory `rateLimit` (ephemeral, documented not durable); state machine prevents skip; no durable quota. | Cloudflare WAF/rate-limit rules, durable per-user/per-IP quotas, D1 query budgets, job concurrency limits, feature flags isolate providers. | Medium until durable controls. | `DOS-01` burst throttled, `DOS-02` body cap 413. |
| T-10 | Token leakage | C | High — full operator compromise | Medium (shared token pasted into a UI field) | Constant-time comparison; token never stored/logged/returned; UI keeps it in memory only; hash-only owner derivation. | Rotate token on exposure; scope tokens per environment; move to human sessions so the shared token is never needed by browsers; secret scanning in CI. | High today by design (single shared bearer); Low after humans replace it for normal use. | `TL-01` static scan finds no secret in assets/responses, `TL-02` rotation invalidates old token. |
| T-11 | CSRF | F (C on legacy public writes) | Medium–High — state change as victim | Low today (cookie auth absent); High after sessions | CORS same-origin reflect; no cookie auth today; `requireMethod` method checks. **No CSRF token today** (no session to protect). | `SameSite=Lax/Strict`, CSRF token on all state-changing requests, `Origin`/`Sec-Fetch-Site` checks, re-auth for sensitive actions. | Low after CSRF token + SameSite. | `CSRF-01` cross-origin POST rejected, `CSRF-02` missing token 403. |
| T-12 | XSS | C (mitigated in current UI) | High — session/token theft after auth | Low–Medium today | `textContent`-only rendering in `workspace.js`/`project-context.js`; strict CSP `default-src 'self'`, `script-src 'self'`; API responses `default-src 'none'`. **No `innerHTML` sink found in reviewed UI.** | Keep no-`innerHTML` rule; Trusted Types; CSP without `unsafe-inline`; automated lint for dangerous sinks; sanitize any future rich text. | Low if sink-free discipline holds. | `XSS-01` payload rendered as text, `XSS-02` CSP report-only violation alert. |
| T-13 | SQL injection | C (low likelihood) | High — data breach | Low | All SQL centralized in `SQL`/`SQL_META`/`BLAST_SQL`/`PROVIDER_SQL` with `?` binds; no user string concatenated into SQL found; ID whitelists. | Keep parameterized-only policy; code-review gate on raw SQL; least-privilege D1 binding. | Low. | `SQLI-01` injection payload in name/id stored literally, no extra rows. |
| T-14 | Unauthorized external-provider transfer | C (strongly gated) / F | High — data sent to third party | Low–Medium | `providers/consent.js` explicit `granted=true`, dataset+provider scope, ≤30 min TTL, rate limited; `blast/_lib.js` `claimConsent` single-use + input-hash bound; emergency-stop/budget routes; provider feature flags. | Bind consent to authenticated `user_id`, add per-user egress budget, audit every transfer, revoke-on-delete, owner gate on external OAuth providers. | Low–Medium (credential of consent endpoint is public mint; see T-07). | `EGRESS-01` consent bypass denied, `EGRESS-02` wrong-provider denied, `EGRESS-03` expired consent denied. |
| T-15 | Retention/deletion failures | C (partial) / F | Medium–High — stale sensitive data | Medium today | `delete.js` removes R2 object + marks row deleted in transfer ledger; `markArtifactDeleted`; no destructive schema deletes in migrations; demo/sample clearly labelled. | Define owner-approved retention policy; scheduled deletion jobs; verify R2 object + D1 row + provenance consistent; soft-delete then hard-delete with audit; backup before migration. | Medium until policy defined (retention period **unknown / not set**). | `RET-01` delete removes object and row, `RET-02` retention job respects policy. |
| T-16 | Researcher → operator privilege escalation | C (structural) / F | High — cross-tenant admin access | High today by design: any browser user can paste the operator token into `workspace.js`; no human roles exist. | Operator token is a single shared secret; UI has no user role separation; `deriveOwner` treats any token holder as the same owner. | Keep operator token server-side/admin-only; never derive a human identity from it; role checks (`researcher` ≠ `operator`); admin actions require separate authenticated role + audit; no token field in researcher UI in target state. | High today until human auth lands and the token field is removed from normal UX. | `PRIV-01` researcher cannot reach operator/admin route, `PRIV-02` role change audited. |

---

## 4. Detailed analysis — REALISTIC CURRENT risks

**T-03/T-04/T-16 — one principal, shared bearer secret.** Today every caller who knows `X-Agent-Token` is the *same* owner, so "cross-user" access is not meaningful between human users (there are none) — but the token is effectively a shared administrator credential. The workspace UI deliberately exposes a token input (`workspace.html` lines 43, `workspace.js` operator-enable handler), so any researcher who obtains or is given the token gains full owner-scoped access. This is a structural escalation risk (T-16), not a bug. Proposed control: keep the token strictly out of the researcher-facing product once human auth exists, and never map it to a human identity.

**T-07/T-09 — public write endpoints without durable abuse control.** `/api/ai/requests` and `/api/blast/submit` are unauthenticated with only body-size caps; `rateLimit` is explicitly in-memory and non-durable (`providers/_lib.js` comment), and is applied to `consent` but not to these submit paths. Worker isolates are ephemeral, so an attacker can distribute requests across isolates. This makes upload/submit abuse and DoS realistic today. Proposed: durable rate limiting plus eventual authentication on these endpoints.

**T-04/T-06 — legacy RID as bearer capability.** `/api/blast/results/:rid` and `/api/blast/status/:rid` check only RID format and existence, not ownership. Possession of an RID is sufficient to read another caller's results. RID entropy is not defined in code (**unknown**), so guessing feasibility cannot be quantified here. Proposed: migrate legacy rows to an owner principal and add object-level authorization, or at minimum make RIDs unguessable and short-lived.

**T-08 — file type validation is extension-based.** `storage/r2.js` allowlists extensions and verifies SHA-256/byte count, but does not inspect magic bytes or scan content. A file named `.fasta` containing an executable is accepted if its hash matches the declared value. Risk is limited today because uploads are stored privately and served with `Content-Disposition: attachment` and `nosniff`, and no server-side execution occurs — but it is a real gap for a future platform that previews content.

**T-10 — token hygiene is good, exposure model is not.** Secret handling in code is careful (constant-time compare, hash-only derivation, no response leakage, memory-only UI), but the design's reliance on a manually-pasted shared token makes leakage/mishandling likely in practice. This is the strongest argument for the M7.5 human-identity migration.

**T-05/T-13/T-12 — effectively controlled today.** URL fields are explicitly rejected in dataset metadata; all SQL is parameterized; the reviewed UI uses `textContent` exclusively and strong CSP. These are recorded as "existing controls" that must be preserved, not reimplemented.

---

## 5. Detailed analysis — FUTURE risks (introduced by the M7.5 design)

**T-01/T-02 (account takeover / session theft)** appear only once human accounts and cookie sessions exist. Controls must be chosen with the owner decision gate (Better Auth primary / Clerk alternative). The threat model does **not** assume any particular provider's security claims; those are to be verified against official documentation at implementation time with a "date checked" note.

**T-11 (CSRF)** becomes live once auth is cookie-based. Same-origin CORS reflect and `requireMethod` are not CSRF defenses; a CSRF token and `Origin`/`Sec-Fetch-Site` validation must be added with the session layer.

**T-03/T-04 (cross-user/IDOR)** become high-likelihood once multiple users share the platform. Every handler must move from `owner = derived_hash` to `owner = authenticated user_id`, and object-level authorization must be centralized so new routes cannot accidentally omit it. Legacy operator-owned rows must be isolated per the fixed contract — **never auto-assigned** to the first signing-in user.

**T-14/T-16** expand because consent minting and provider configuration endpoints will be reachable by human researchers. Role checks and per-user egress budgets must be explicit; the operator token must not become a "superuser" fallback inside the human auth flow.

**T-15 (retention)** requires an owner-approved policy. No retention period is configured today (**unknown / not set**); the design must not invent one.

---

## 6. Security acceptance test catalogue (FUTURE implementation)

These tests are a specification for the future milestone, not tests being added now. Each maps to a threat ID from §3. "Negative" tests are marked **(neg)** and are mandatory gates.

| Test name | Threat | Preconditions | Expected result |
|---|---|---|---|
| `AT-01` password reset single-use | T-01 | Two accounts; request reset twice | Only the latest token works; old token rejected; session invalidated after reset |
| `AT-02` MFA/password policy | T-01 | Policy enabled by owner | Weak/reused password rejected; MFA challenge enforced when configured |
| `ST-01` revoked session **(neg)** | T-02 | User logged in, then admin revokes session | Subsequent authenticated API call returns 401; no data returned |
| `ST-02` cookie flags | T-02 | Login response captured | Cookie is `HttpOnly; Secure`, short Max-Age, no token in body; `SameSite=Lax` or `Strict` per the G4/DG-4 policy (Lax for OAuth/top-level navigation, Strict otherwise) |
| `CROSS-01` foreign project read **(neg)** | T-03 | User A and user B each own a project | A requesting B's `/api/workspace/projects/:id` gets 404; no owner fields leaked |
| `CROSS-02` list isolation | T-03 | Two users, mixed rows | Each list endpoint returns only the caller's rows |
| `IDOR-01` foreign run/artifact **(neg)** | T-04 | Run/artifact owned by B | A's detail/report/download request returns 404/403; audit logs deny |
| `IDOR-02` legacy RID isolation **(neg)** | T-04 | BLAST result RID from B | A cannot read B's result once legacy rows are migrated |
| `URL-01` no URL fields | T-05 | Dataset created via API | Response contains no `url`/`download_url`/`href`; `provider_history_ref` non-URL |
| `URL-02` expired signed URL **(neg)** | T-05 | Download ticket with `exp` in past | Content endpoint returns 403; object bytes not returned |
| `DL-01` no-token download **(neg)** | T-06 | Stored artifact, no session/consent | `download-url` returns 403 |
| `DL-02` wrong-dataset consent **(neg)** | T-06 | Consent for dataset X, artifact in Y | 403 "invalid or expired for this dataset" |
| `UP-01` oversize upload **(neg)** | T-07 | Ticket for 1 byte, body > declared / >64 MiB | 400 and no stored row; object removed on mismatch |
| `UP-02` anonymous ticket **(neg)** | T-07 | No human session | `upload-url` returns 401/403 |
| `UP-03` quota exceeded | T-07 | User at upload quota | Ticket mint denied with 429 |
| `MF-01` disguised file **(neg)** | T-08 | `.fasta` containing ELF magic | Rejected by magic-byte validation; quarantined |
| `MF-02` hash mismatch **(neg)** | T-08 | Body hash ≠ declared sha256 | Object deleted; no `stored` row |
| `DOS-01` burst throttled | T-09 | High request rate from one user/IP | 429 with `Retry-After`; D1 row count bounded |
| `DOS-02` body cap | T-09 | Body > `MAX_REQUEST_BODY_CHARS` | 413/400 before parsing |
| `TL-01` static secret scan | T-10 | CI scans built assets + API responses | No `AI_AGENT_TOKEN`/signing key literal; no token in JSON |
| `TL-02` token rotation **(neg)** | T-10 | Rotate operator secret | Old token returns 401; new token works; no human session affected |
| `CSRF-01` cross-origin POST **(neg)** | T-11 | Foreign `Origin`, valid victim cookie | 403; no state change |
| `CSRF-02` missing CSRF token **(neg)** | T-11 | Same-origin POST without CSRF token | 403; audit denies |
| `XSS-01` payload as text | T-12 | `<script>` in project name | Rendered as text; no execution; stored literally |
| `XSS-02` CSP compliance | T-12 | Attempt inline script | Blocked by CSP; no `unsafe-inline` in script-src |
| `SQLI-01` injection payload | T-13 | `'` / `OR 1=1` in name and id | Stored as literal; no extra rows; id rejected by whitelist |
| `EGRESS-01` consent bypass **(neg)** | T-14 | Transfer/submit without consent | Denied before any provider call; audit records denial |
| `EGRESS-02` provider mismatch **(neg)** | T-14 | Consent for provider A used for B | 403 |
| `EGRESS-03` expired consent **(neg)** | T-14 | Consent `expires_at` in past | 403 |
| `RET-01` deletion consistency | T-15 | Delete an artifact | R2 object gone; row marked deleted; ledger updated; audit entry |
| `RET-02` retention policy | T-15 | Owner-configured retention applied | Expired rows/objects removed per policy; none removed early |
| `PRIV-01` researcher→operator **(neg)** | T-16 | Human researcher session | Operator/admin route denied; no token exposed to researcher UI |
| `PRIV-02` role change audited | T-16 | Admin changes a role | Change recorded; old permissions immediately revoked |

---

## 7. Residual-risk summary

| Risk | Today | After proposed design (expected) | Owner decision required? |
|---|---|---|---|
| Shared operator token compromise (T-10/T-16) | **High** | Low — token removed from normal UX, rotated, admin-only | Yes — token rotation/clearance |
| Cross-user / IDOR on legacy RIDs and public routes (T-03/T-04) | Medium | Low after human ownership + legacy isolation | Yes — legacy ownership transfer |
| Upload abuse / DoS (T-07/T-09) | Medium–High | Medium until durable quotas/WAF configured | Yes — budget for R2 + rate limiting |
| Malicious file content (T-08) | Medium | Low–Medium pending AV/magic-byte scanning | Yes — scanning choice |
| External egress (T-14) | Low–Medium | Low with per-user consent + budgets | Yes — external OAuth providers |
| Retention/deletion (T-15) | Medium (policy unset) | Low once owner-approved policy implemented | Yes — retention policy |
| Session/account/CSRF (T-01/T-02/T-11) | N/A today | Low–Medium | Yes — auth provider choice |
| SQLi / XSS / URL leakage (T-05/T-12/T-13) | Low (controls present) | Low (preserve controls) | No |

**Overall:** the dominant current risk is the single shared operator token and unauthenticated legacy write/read surfaces. The M7.5 design materially reduces these only if the decision gates below are honored and the acceptance tests in §6 pass.

## 8. Owner sign-off requirements

Implementation of any §7 control requires explicit owner approval of:

1. **Auth provider** — Better Auth primary vs Clerk alternative (T-01/T-02/T-11).
2. **Email provider** for verification/reset mail (T-01) — provider and credentials are owner-supplied; none configured today.
3. **R2 activation and budget** — binding, bucket privacy, signing key, size/quota limits (T-07/T-09/T-15). R2 remains inactive until approved.
4. **Legacy ownership transfer** — confirm that pre-existing operator-owned rows stay isolated and are never auto-assigned (T-03/T-16).
5. **External OAuth providers** — approval before any external identity/transfer integration (T-14).
6. **Retention policy** — retention period, deletion SLA, and backup policy (T-15); currently **unknown / not set**.
7. **Operator token rotation** — rotate before/with rollout; no live Galaxy calls until the owner confirms rotation (per contract).

## 9. Verification notes and limits

- All current-state claims are sourced from local files at audit time (HEAD `e1a523a8`) plus a read-only read of the UI files as then present. No live endpoints were called; no credentials were used.
- The storage/token behavior in §1.5(3) reflects the version audited at HEAD `e1a523a8`; re-check it at implementation time.
- Numeric abuse thresholds that are not enforced by durable code are reported as **unknown / not enforced**; in-memory `rateLimit` values are noted but explicitly non-durable.
- RID entropy and any external provider security properties are **unknown** and intentionally not asserted.
- No compliance standard is claimed or implied by this document.
- External Cloudflare/Better Auth/Clerk documentation was not required to establish current-state facts; where future design assumes provider behavior, it must be re-checked against official docs with a "date checked" annotation at implementation time.
