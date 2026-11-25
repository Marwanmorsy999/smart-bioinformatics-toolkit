# M7.2 — Galaxy-First Live Execution Report

**Date:** 2026-11-25
**Branch:** `phase-1-robustness-safety`
**Foundation commits:** `dcbb7cf`, `c81a1a5`, `514c274`
**M7.2 commits:** `3e9c6a9`, `85b8e07`, `96f6f7a`, `d6a2dde`, `62e3629`, `8939f7b`, `534a12c`, `8cc2d93`

**Verdict: PASS WITH NOTES.** One genuine Galaxy scientific workflow completed through the deployed
staging Worker: consent-gated upload → real Galaxy job → monitoring → output retrieval → SHA-256
verification → independent scientific check → evidence-bounded reproducible report. Notes: only one
tool type was executed (reverse complement, twice — the second run was the decisive validation);
the report is a generated static artifact rather than a provider-job report endpoint; smarts.bio and
9Router remain disabled; R2 remains disabled; production is untouched.

No success claim below rests on a file being created or a unit test alone. Live claims include exact
IDs/hashes and were independently reproduced by the reviewer where possible.

---

## 1. Prerequisites (all resolved)

| Prerequisite | Resolution |
|---|---|
| Replacement Galaxy key | On the owner's explicit instruction to reuse the supplied key, `GALAXY_API_KEY` and `GALAXY_BASE_URL` were installed as **staging-only** secrets with `wrangler secret put`. Values were never printed, written to a file or committed. Production has no provider secrets. |
| Account activation | Confirmed by two real uploads into dedicated histories (§3); no bypass attempted. `GET /api/configuration` reports `user_activation_on: true`. |
| R2 | **Deferred by owner decision.** R2 stays optional/disabled; Galaxy histories hold datasets, D1 holds metadata only. No bucket, binding or signing secret was created. |
| Database | Separate staging D1 (`72a07465-f0fe-4d32-93af-72bdc18b0cc0`) with migrations 0001–0004, 0006–0007, 0009 and 0010 applied remotely (22 tables). Production D1 untouched. |
| Flags | `GALAXY_ENABLED="true"` only in `[env.staging.vars]`; top-level/production, smarts.bio and 9Router remain `false`. |

---

## 2. Root cause of the `400 No data was entered in the upload form`

The adapter used `POST /api/tools` with `tool_id:"upload1"` and `inputs.file1`. The live specification
`https://usegalaxy.eu/openapi.json` (access 2026-11-25) shows uploads use:

- `POST /api/tools/fetch`, `multipart/form-data`
- required fields `history_id` and `targets` (JSON-encoded `DataElementsTarget[]`)
- optional `files` file parts
- `targets` item shape `{destination:{type:"hdas"}, elements:[...]}`
- pasted element `{src:"pasted", paste_content, name, ext}`; file element `{src:"files", name, ext}`

There is no `/api/upload` route (404), and `/api/tools/{id}/inputs` does not expose the form. The
adapter was corrected to this contract with OFFLINE/MOCK regression tests. `upload1` remains only the
platform's local upload primitive; capability discovery is fully dynamic.

Two independent live upload tests were run once with the supplied key via transient environment
variables (never persisted). Both passed fully after the content endpoint and polling fixes:

| Test | History | Dataset | Final state | SHA-256 |
|---|---|---|---|---|
| A — pasted text (`src=pasted`) | `11ac94870d0bb33a421fe648fe235638` | `40160950115d555e4a07f3ebf2c9631f` | `ok` | `e7d09d04a66bb582cc87f76bd8671bef87b7cbcc7df60f7a2dbe71fe5478867c` (matched input) |
| B — FASTA file (`src=files` + `files` part) | `11ac94870d0bb33aee565b9befc94a7d` | `40160950115d555e37e69b35a2a071e4` | `ok` | `9614b1b4e5192b84786c4e907f1426b66c9911c5c9d3baa687b23c40bc3fe950` (matched input) |

Content retrieval uses `GET /api/datasets/{id}/get_content_as_text` → `{item_data, truncated:false}`;
`GET /api/datasets/{id}/content` has no route. Datasets transition `queued → running → ok`, so the
smoke script uses bounded polling (2 s interval, max 30 checks).

---

## 3. First genuine website workflow — PASSED

Executed through the deployed Worker (`https://smart-bioinformatics-toolkit-staging.m-2396.workers.dev`),
not through a terminal or the local Python engine:

| Step | Evidence |
|---|---|
| Consent + upload | `pcon_4422d4e079e94e06`; HTTP 201; dataset `ds_0123456789abcdef`; `m7_2_website.fasta` (31 bytes) |
| Input artifact | Galaxy dataset `40160950115d555ea447415713109266`, history `11ac94870d0bb33a861e38c06d27e1f0`, upload job `4838ba20a6d867656832923f7209a55c`, SHA-256 `ed686969d3456c33e14211610285656dc332a34db533b9da31c486b07cdd4caf` |
| Consent + submit | `pcon_84e4fb1b83ef77c2`; HTTP 202; Worker job `pjob_7e61f800a30c000b`; **real Galaxy job `4838ba20a6d867653f8bc70493741d93`** |
| Tool | `toolshed.g2.bx.psu.edu/repos/devteam/fastx_reverse_complement/cshl_fastx_reverse_complement/1.0.2+galaxy2` (dynamically discovered; 4,462 executable tools advertised) |
| Monitor | `/api/providers/jobs/:id` → `succeeded` |
| Output | dataset `40160950115d555ed3a5385970017200`, history `11ac94870d0bb33ac229bd50275cc747`, `state=ok` |

That input (`ACGTACGTACGTACGT`) is a palindrome, so it was not a decisive scientific check. The
decisive repeat through the same website pipeline:

- input `>m7_2_decisive\nAACGTTCGGCTA\n`, SHA-256 `b947f1b587327eb5039a6bcd9a4d390257f07950618e5d7e81ada6727a7c584a`
- input dataset `40160950115d555e0582c0896a2ca22e`, history `11ac94870d0bb33a556a5c9e313fbf02`
- Worker job `pjob_681907a5b64630f4`, real Galaxy job `4838ba20a6d8676590784f09817802c1` → `succeeded`
- output dataset `40160950115d555e6ac4f26ae666a318`, history `11ac94870d0bb33a5083221d657ac404`
- output `>m7_2_decisive\nTAGCCGAACGTT\n`, SHA-256 `4a19e4efd7dd87c416de9cd3b664df3241e4dd30a018b34a30293343fe77168c`, `truncated:false`
- independently computed reverse complement of `AACGTTCGGCTA` is `TAGCCGAACGTT` — **exact match**
  (the reviewer independently recomputed both hashes and the complement)

---

## 4. Report and browser evidence

- Generated report: `docs/discovery/m7-2-screenshots/m7-2-galaxy-reverse-complement-report.html`
  (6,063 bytes) — public job id, both hashes, provenance, validation and evidence-bounded explanation.
  Its "Data locality"/"Consent records" lines are **template defaults** and do not describe this run;
  actual locality and consent are recorded in §3 and the D1 ledger.
- Real Chromium render: title `Analysis report - pjob_681907a5b64630f4`, `Execution mode: real`, zero
  page errors; screenshot `docs/discovery/m7-2-screenshots/m7-2-galaxy-report-render.png`.
- Real Playwright run against live staging: `galaxy — available · Enabled: yes · executable tools: 4462 ·
  discovery: live`; smarts.bio and 9Router disabled; no external hosts; one expected anonymous-ledger
  401; screenshot `docs/discovery/m7-2-screenshots/staging-provider-status.png`.

---

## 5. Live-driven code fixes

All were made because real staging behavior exposed them, each with an OFFLINE regression test:

1. Galaxy quota endpoint returns an **array** of sources → select primary `quota_bytes` (268.4 GB),
   keep scratch (2.2 TB) as secondary; jobs quota remains unknown (never invented).
2. `/api/tools` returns **panel sections** → flatten `elems` and advertise only `model_class:"Tool"`.
3. `/api/tools/fetch` returns `outputs[0].id` immediately → register the dataset directly instead of
   waiting for a completed-dataset listing.
4. `POST /api/tools` returns the real job in `jobs[0].id`, not at the top level.
5. `/api/version` returns `version_major`/`version_minor`, not `version`.
6. Governor must create per-provider containers for operator-seeded D1 state.
7. Migration `0010` adds `provider_jobs.detail_json` (applied to staging D1 remotely).

Budget note: staging governor totals are `galaxy.jobs = 10` (operator operational cap, not a provider
credit) and `galaxy.bytes = 268435456000` (actual quota from `GET /api/users/current/usage`).

---

## 6. Verification counts

| Check | Exact result |
|---|---|
| JavaScript (`npm test`, web-platform) | **398 tests, 398 pass, 0 fail, 0 skipped, 0 todo** |
| Python (`python -m pytest python-engine/tests -q`) | **240 passed** |
| `node --check` on changed JS | clean |
| Independent reviewer | PASS WITH NOTES; B1 documentation contradiction fixed by full rewrite |
| Independent tester | PASS on prior state; final verification run in progress |

---

## 7. Remaining risks / notes

- Only one scientific tool type was executed; a second, different workflow (e.g. MSA) was not run.
- The reproducible report is a generated static artifact, not served by a provider-job report endpoint.
- smarts.bio public access remains disabled pending written authorization; 9Router is local-only and disabled.
- R2 remains disabled; Galaxy history lifecycle governs retention, D1 holds metadata only.
- Production was not deployed or promoted; staging and production credentials/databases remain separate.
- The supplied key was reused on owner instruction; it was exposed in chat and should still be rotated
  for any future production use.

**Acceptance gate:** at least one genuine Galaxy workflow passed through the complete website pipeline
(§3). M7.2 is therefore complete for staging, with the notes above.
