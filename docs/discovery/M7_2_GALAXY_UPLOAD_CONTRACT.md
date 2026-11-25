# M7.2 — Galaxy dataset upload contract (verified)

**Status:** discovery/contract record. **No live upload success is claimed here.**
The request shape below was read from the instance's own OpenAPI document; it
was not inferred from a successful execution.

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
{ "src": "pasted", "paste_content": "<text>", "name": "input.txt", "ext": "txt", "to_posix_lines": false }

// file: bytes are supplied as a multipart `files` part
{ "src": "files", "name": "input.fasta", "ext": "fasta" }
```

The successful fetch response carries no stable provider job id. The adapter
therefore returns a generated `provider_job_id`, keeps `history_id` in
`output.structured`, and resolves the created dataset afterwards by **exact
filename** through `GET /api/histories/{history_id}/contents` (the same lookup
`storage/galaxy-artifacts.js` already performs). No dataset id is invented when
the lookup finds nothing.

## Old shape (broken) vs new shape (verified)

| | Old (removed from the direct upload path) | New (implemented) |
| --- | --- | --- |
| Endpoint | `POST /api/tools` | `POST /api/tools/fetch` |
| Content type | `application/json` | `multipart/form-data` (boundary from `fetch`) |
| Body | `{ tool_id:"upload1", history_id, inputs:{ file1:{ file_content, filename, ext } } }` | `history_id`, `targets` (JSON string), optional `files` parts |
| Bytes | JSON `file_content` string | `paste_content` string or a `files` Blob/File part |
| Observed result | `400 No data was entered in the upload form` for every tried shape | Contract verified from OpenAPI; **live execution still unverified** |

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

## Verification procedure (live, opt-in, NOT run for this record)

`scripts/live-smoke/galaxy-upload-tests.mjs` is never executed by `npm test`.
It makes no network call unless `GALAXY_BASE_URL`, `GALAXY_API_KEY` and
`GALAXY_UPLOAD_TESTS=1` are all set. Optional `GALAXY_WORKSPACE` labels history
names; optional `GALAXY_HISTORY`/`GALAXY_HISTORY_ID` is read-only preflight only.
It writes no files and never prints the key. Per test it:

- **Test A** — creates a dedicated history, uploads a tiny pasted-text dataset
  (`src:"pasted"`).
- **Test B** — creates a dedicated history, uploads a small FASTA as a `files`
  multipart part (`src:"files"`).

For each test it records the HTTP status and a sanitized error, resolves the
dataset by exact filename, verifies `dataset.history_id` equals the freshly
created history, downloads the bytes and compares their SHA-256 to the original
input. Output is labelled `[LIVE]` or `[SKIPPED]`.

## Known OFFLINE/MOCK fixture drift (full-suite result)

After the adapter change, `npm test` reports 383 tests / 378 pass / 5 fail.
The five failures are legacy mocks that only stub `POST /api/tools` for
`tool_id:"upload1"` and therefore answer `404` to the now-correct
`POST /api/tools/fetch`:

- `tests/galaxy_artifacts_handlers.test.mjs` — happy upload + provider 403 cases
- `tests/galaxy_artifacts_store.test.mjs` — `uploadDataset` success + 403 cases
- `tests/m7_2_galaxy_verify_offline.test.mjs` — metadata-only D1 row case

These fixtures need a `/api/tools/fetch` branch (and a fetch response without a
job id) to reflect the verified contract. They were **not** edited here: the
task's file ownership is limited to the adapter, the new regression test, the
live script and this document, and no test assertion was weakened.

## Current blocker

No credential is installed in this environment and there is **no confirmation
that the Galaxy account has been activated**. Consequently:

- The live script was **not run**; no live upload, dataset or history was
  created for this change.
- The previously reported 403 `Action requires account activation` is treated
  as an unresolved account/permission condition, not as evidence that this
  request shape works.
- The contract itself is verified from the live OpenAPI document only. Live
  confirmation of a completed upload and byte-for-byte hash match is still
  pending an activated account with an installed key.

The architecture remains R2-free: Galaxy histories are the only byte store; no
file bytes are written to D1, disk or this repository.
