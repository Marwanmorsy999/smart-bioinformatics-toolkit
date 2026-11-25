# M7.2 — Galaxy dataset upload contract (verified)

**Status:** discovery/contract record. The request shape below was read from
the instance's own OpenAPI document and then confirmed by an opt-in live run on
**2026-11-25**; the evidence is recorded below. No credential is stored in this
document or anywhere in the repository.

## Source of truth

- URL: `https://usegalaxy.eu/openapi.json`
- Accessed: **2026-11-25**
- Endpoint: **`POST /api/tools/fetch`**
- Request content type: **`multipart/form-data`**
- Request schema name: `Body_fetch_form_api_tools_fetch_post`

### Verified request fields

| Part | Type | Required | Notes |
| --- | --- | --- | --- |
| `history_id` | string | yes | Destination Galaxy history id |
| `targets` | string | yes | JSON-encoded array of `DataElementsTarget` |
| `files` | array of file parts | no | Raw bytes, matched to `src:"files"` elements by order/name |
| `landing_uuid` | string | no | Optional UI landing reference |

`DataElementsTarget`:

```json
{ "destination": { "type": "hdas" }, "elements": [ /* elements */ ], "auto_decompress": false }
```

`auto_decompress` is optional (and, when present, must be `false`); the adapter
omits it. Element shapes:

```json
// text: bytes are inline in the target JSON
{ "src": "pasted", "paste_content": "<text>", "name": "input.txt", "ext": "txt" }

// file: bytes are supplied as a multipart `files` part
{ "src": "files", "name": "input.fasta", "ext": "fasta" }
```

The adapter's pasted element carries exactly `{src, paste_content, name, ext}`:
no `to_posix_lines` field is sent. The opt-in live script mirrors this exact
shape rather than building a different FormData.

The successful fetch response carries no stable provider job id. The adapter
therefore returns a generated `provider_job_id`, keeps `history_id` in
`output.structured`, and resolves the created dataset afterwards by **exact
filename** through `GET /api/histories/{history_id}/contents` (the same lookup
`storage/galaxy-artifacts.js` already performs). No dataset id is invented when
the lookup finds nothing.

## Verified content read and dataset-state polling

- **Content endpoint:** `GET /api/datasets/{id}/get_content_as_text` → 200 with
  JSON `{item_data:"<content>", truncated:false, item_url:"..."}`. Hashing
  `item_data` reproduces the uploaded bytes exactly. The adapter parses this
  JSON and returns `item_data` as its text content; `downloadArtifact`'s
  `{ok, provider, artifact_id, content}` contract is unchanged.
- `GET /api/datasets/{id}/content` is **not a route** on usegalaxy.eu (404) and
  must never be used.
- `truncated:true` means Galaxy did not return the whole dataset. The adapter
  rejects it as a typed `content_truncated` failure (status 413, non-retryable)
  instead of returning partial bytes; the artifact store still enforces its
  1 MiB cap and SHA-256 check independently.
- **Polling requirement:** after `/api/tools/fetch` returns, the dataset moves
  `queued → running → ok` over tens of seconds. Fetching its content immediately
  returns 404. Any verifier must poll `GET /api/histories/{history_id}/contents`
  for an exact filename match whose state is `ok`/`success` before reading the
  content. The live script uses a **bounded** poll: a fixed 2 s interval, at most
  30 checks and a 60 s wall-clock deadline. It fails fast on terminal
  `error`/`failed`/`cancelled`/`deleted`/`purged`/`expired` states and never
  loops without a ceiling.

## Old shape (broken) vs new shape (verified)

| | Old (removed from the direct upload path) | New (implemented) |
| --- | --- | --- |
| Endpoint | `POST /api/tools` | `POST /api/tools/fetch` |
| Content type | `application/json` | `multipart/form-data` (boundary from `fetch`) |
| Body | `{ tool_id:"upload1", history_id, inputs:{ file1:{ file_content, filename, ext } } }` | `history_id`, `targets` (JSON string), optional `files` parts |
| Bytes | JSON `file_content` string | `paste_content` string or a `files` Blob/File part |
| Observed result | `400 No data was entered in the upload form` for every tried shape | Contract from OpenAPI **and confirmed live**, 2026-11-25 (evidence below) |

Other routes were checked and are **not** usable on this instance:

- `POST /api/upload` — 404 (no such route).
- `POST /api/tools/upload1/inputs` — 400008.
- `GET /api/tools` does list `upload1`, but `upload1` is Galaxy's generic
  platform upload primitive, not a scientific capability. Capability discovery
  remains fully dynamic and never advertises a hardcoded tool id.

The adapter still contains a separate legacy inline-descriptor path used only
to turn `{src:"upload"}` inputs into `hda` references for *scientific tool*
invocations, because those calls need a dataset id up front. It is not the
direct upload primitive path and is not advertised. Removing it requires a
separate change to that tool-input resolution flow.

## Verification procedure (offline)

`web-platform/tests/galaxy_upload_fetch.test.mjs` injects a mock fetch and
asserts, without any network access:

1. `POST /api/tools/fetch`, multipart/form-data with a real boundary,
   `history_id` present, `targets` parsing to the exact `hdas` + `pasted`
   structure, and text preserved verbatim.
2. The file variant produces a `files` element plus one `files` part whose
   bytes match the input FASTA.
3. Galaxy 400, 403 (account activation) and 401 (expired key) become typed
   failures with no fabricated success and no retry.
4. A missing/malformed history fails before any network call; a supplied
   history is never recreated.
5. After a successful upload, `getArtifacts({history_id})` finds the dataset by
   exact filename.
6. `downloadArtifact` reads `item_data` from `/get_content_as_text` and never
   calls the old `/content` route; `truncated:true` is a typed, non-retryable
   failure that returns no partial content.
7. Non-string, non-blob upload content is a typed `invalid_upload_content`
   error before any network call, and an extension-less filename such as
   `README` falls back to `ext:"txt"`.

`web-platform/tests/galaxy_upload_smoke.test.mjs` imports the opt-in script
without side effects and asserts the poll is bounded by its interval, attempt
ceiling and deadline, fails fast on a terminal state, and stops as soon as the
dataset reaches `ok`.

## Verification procedure (live, opt-in — evidence recorded below)

`scripts/live-smoke/galaxy-upload-tests.mjs` is never executed by `npm test`.
It makes no network call unless `GALAXY_BASE_URL`, `GALAXY_API_KEY` and
`GALAXY_UPLOAD_TESTS=1` are all set. Optional `GALAXY_WORKSPACE` labels history
names; optional `GALAXY_HISTORY`/`GALAXY_HISTORY_ID` is read-only preflight only.
It writes no files, never prints the key, and every message passes through a
scrubber. Per test it:

- **Test A** — creates a dedicated history, uploads a tiny pasted-text dataset
  (`src:"pasted"`, exact adapter element shape).
- **Test B** — creates a dedicated history, uploads a small FASTA as a `files`
  multipart part (`src:"files"`).

For each test it records the HTTP status and a sanitized error, polls the
history contents for an exact filename match in state `ok`/`success` (bounded to
~60 s), verifies `dataset.history_id` equals the freshly created history,
downloads text from `GET /api/datasets/{id}/get_content_as_text`, rejects
`truncated:true`, and compares the SHA-256 of `item_data` to the original input.
Output is labelled `[LIVE]` or `[SKIPPED]`; a failed check sets exit code 1.

## Live evidence (2026-11-25, transient key — identifiers only)

Both uploads returned HTTP 200 from `POST /api/tools/fetch`, both datasets
transitioned `queued → running → ok`, and final-state `item_data` hashes matched
the input bytes exactly. The history/dataset ids below are public object
identifiers, **not credentials**; the API key used was transient and is not
recorded here or in the repository.

| Test | Upload source | Dedicated history id | Dataset id | SHA-256 of `item_data` |
| --- | --- | --- | --- | --- |
| A | `src=pasted` | `11ac94870d0bb33a421fe648fe235638` | `40160950115d555e4a07f3ebf2c9631f` | `e7d09d04a66bb582cc87f76bd8671bef87b7cbcc7df60f7a2dbe71fe5478867c` |
| B | `src=files` + multipart `files` part | `11ac94870d0bb33aee565b9befc94a7d` | `40160950115d555e37e69b35a2a071e4` | `9614b1b4e5192b84786c4e907f1426b66c9911c5c9d3baa687b23c40bc3fe950` |

This is why content must only be read after the state poll: an immediate fetch
of `get_content_as_text` (or the non-existent `/content`) returned 404 while the
datasets were still `queued`/`running`.

## Resolved: earlier OFFLINE/MOCK fixture drift (historical)

An earlier snapshot of this record reported `npm test` at 383 tests / 378 pass /
5 fail because five legacy mocks still answered only `POST /api/tools` for
`tool_id:"upload1"` and returned 404 to the now-correct `POST /api/tools/fetch`.
**That drift was resolved**: the five mocks were updated to the verified
`/api/tools/fetch` branch (with a fetch response carrying no job id) and the
suite reached **383/383**, with no assertion weakened. The affected fixtures
were `tests/galaxy_artifacts_handlers.test.mjs` (happy upload + provider 403),
`tests/galaxy_artifacts_store.test.mjs` (`uploadDataset` success + 403) and
`tests/m7_2_galaxy_verify_offline.test.mjs` (metadata-only D1 row). Later changes
added further offline tests, so the live suite count is verified separately at
the end of each change rather than frozen in this record.

## Current limits

- The transient key used for the 2026-11-25 live run is no longer installed;
  re-running the opt-in script needs a freshly supplied key and explicit
  `GALAXY_UPLOAD_TESTS=1` consent.
- The earlier `403 Action requires account activation` is an account/permission
  condition. It did not recur in the successful run and is still propagated as a
  typed failure if it appears again.
- Content larger than 1 MiB is out of this MVP: the store rejects it before
  reading and `truncated:true` is treated as a typed failure.
- The architecture remains R2-free: Galaxy histories are the only byte store;
  no file bytes are written to D1, disk or this repository.
