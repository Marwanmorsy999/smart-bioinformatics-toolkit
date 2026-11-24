# Plugin authoring guide (M5)

A plugin is a **manifest plus an adapter**. The control plane reads the
manifest; the local Python agent imports the adapter. Adding a scientific domain
requires only four artifacts:

1. a manifest in `shared/plugins/<domain>.json`,
2. an adapter under `python-engine/src/smartbio/plugins/`,
3. focused tests, and
4. documentation (including references and limitations).

These four artifacts are sufficient for **registration, availability reporting
and direct agent execution**. Discovery is automatic: any new valid
`shared/plugins/*.json` is picked up at import time and by the registry
generator; no registry module or validation rule needs to change.

**Explicit limitation:** exposing a new tool through the natural-language
request → plan → approve UI is separate product work. `planner.js` currently
hardcodes `sequence-stats.profile` for its intent mapping, so a newly
registered domain plugin will not be selected by the NL planner until a planner
change is made. Do not change the planner merely to register a plugin; use
direct job execution or the registry API until that product work is scheduled.

Copy `docs/plugins/template/` as a starting point. It is intentionally
unavailable and emits no artifacts.

## 1. Manifest fields

The manifest is validated against
`shared/schemas/plugin.schema.json` (JSON Schema 2020-12,
`additionalProperties: false`). Unknown fields are rejected.

| Field | Required | Meaning |
|---|---|---|
| `name` | no (recommended) | Human-readable plugin name |
| `domain` | no | Domain tag copied to each registry entry; defaults to `name` or filename |
| `version` | yes | Manifest/plugin version, e.g. `1.0.0` |
| `description` | yes | One-line description |
| `backend` | yes | Must be `local-python` |
| `entrypoint` | conditional | Default `module:Class` for all tools; **either** this or a per-tool `entrypoint` is required |
| `tools` | yes | Non-empty array of tool objects |

Each tool object:

| Field | Required | Meaning |
|---|---|---|
| `id` | yes | Stable contract id, e.g. `mydomain.align` |
| `name` | no | Human-readable tool name (defaults to `id`) |
| `description` | yes | What the tool does |
| `entrypoint` | conditional | `module:Class` specific to this tool |
| `params_schema` | yes | JSON Schema object for `step.params` |
| `input_schema` | yes | JSON Schema object for job inputs |
| `output_schema` | yes | JSON Schema object describing the artifact documents |
| `available` | yes | Advertisement flag; see §5 |
| `unavailable_reason` | when `available: false` | Honest, precise reason (non-empty) |
| `external_egress` | no | `true` only if the adapter really makes network calls |
| `requirements` | no | Array of statically checkable requirement strings (see §4) |
| `requires` | no | Alias for `requirements`; merged with it |
| `estimated_seconds` | no | Non-negative advisory duration |
| `references` | yes | Non-empty array of citation objects (see §3) |
| `limitations` | yes | Non-empty array of strings (see §3) |

A reference object has `key`, `title`, `url`, `verified` (all required), plus
optional `verified_by` (how the claim was checked) and `note` (**required when
`verified: false`**, explaining the unmet claim).

Schema skeleton:

```json
{
  "name": "mydomain",
  "domain": "mydomain",
  "version": "1.0.0",
  "description": "What this plugin does.",
  "backend": "local-python",
  "tools": [{
    "id": "mydomain.example",
    "name": "Example Tool",
    "description": "One line.",
    "entrypoint": "smartbio.plugins.mydomain:ExamplePlugin",
    "available": false,
    "unavailable_reason": "Skeleton until tests and references are complete.",
    "requirements": [],
    "params_schema": { "type": "object", "properties": {} },
    "input_schema": { "type": "object", "required": ["dataset_id", "fasta_text"], "properties": {} },
    "output_schema": { "type": "object", "required": ["example.json"], "properties": {} },
    "references": [{ "key": "...", "title": "...", "url": "...", "verified": true, "verified_by": "..." }],
    "limitations": ["..."]
  }]
}
```

## 2. Adapter contract

An adapter is importable as `module:Class` (a module-local `adapter.py` next to
the manifest is also supported, which is how the template is discovered). The
class (or module-level object) must expose:

- `TOOL_ID: str` — exactly the manifest tool `id`,
- `VERSION: str` — non-empty,
- `run(step, inputs, context) -> {"artifacts": [...], "tool_run_meta": {...}}`.

`artifacts` entries are `{"name", "kind", "content"}`; JSON artifacts should be
built with `smartbio.plugins.json_artifact`. `tool_run_meta` should include
`status`, `tool_id`, `version`, `limitations`, `logs` plus the generic seams in
§6. Adapters **call existing scientific functions**; they never reimplement or
replace them, and they never fabricate results on missing input — use
`smartbio.plugins.failure_result`.

For a multi-tool manifest with a single module-level `entrypoint`, discovery
also accepts any class in that module whose `TOOL_ID` matches the tool id. A
mismatched id is always rejected. Per-tool entrypoints are preferred because
they are explicit.

## 3. Scientific references and limitations (mandatory)

Every tool must declare at least one `references` entry and at least one
`limitations` entry. Both are checked in CI.

- Use real, checkable citations: DOI/CrossRef or PubMed records, or an in-tree
  source file with `verified_by` pointing at that source.
- `verified: true` is only acceptable for keys in the shared curated ledger
  `python-engine/src/smartbio/aiagent/plugin_references.py` (used by both
  discovery at runtime and `scripts/check_plugins.py` in CI). To add a new
  verified citation, check its bibliographic metadata and add its exact
  `title`/`url` to that ledger, or mark the claim `verified: false` with an
  explanatory `note`. A fabricated verified claim makes the tool unavailable
  with a precise `reference_verification_unknown` reason at runtime.
- A method paper does **not** verify every derived claim. For example the 16S
  species-threshold paper exists, but its numeric cutoff is a screening
  proposal, not a universal boundary; that claim stays `verified: false`.
- Limitations must be domain-specific and honest: heuristic nature, excluded
  records, missing quality scores, what the verdict does *not* prove, etc.

Examples already in the repository: IUPAC ambiguity recommendations
(`10.1093/nar/13.9.3021`), BLAST (`10.1016/S0022-2836(05)80360-2`).

## 4. Contracts and runtime requirements

`params_schema`, `input_schema` and `output_schema` must each be a **valid JSON
Schema object of `type: "object"`**. They are validated with
`Draft202012Validator.check_schema` before the tool is registered. The Worker
uses `params_schema` for `validateParams`; the Python agent uses `input_schema`
and `output_schema` as the documented data contract. Values are never
interpreted as scientific facts by the control plane.

`requirements` (and its alias `requires`) are strings checked before a tool can
be advertised as available:

| Form | Check |
|---|---|
| `python-package:NAME` | `importlib.util.find_spec` (use the import name; `biopython` maps to `Bio`) |
| `executable:NAME` | `shutil.which` |
| anything else | **Unverifiable** — the tool is marked unavailable with a precise reason |

A runtime dataset or local database cannot be verified statically; declare it
in `unavailable_reason` (as the 16S tools do) rather than claiming availability.

The two failure classes are deliberately different:

- **Hard requirement missing** (`python-package:` / `executable:`): the plugin
  is invalid. Discovery does not import its entrypoint and the adapter is not
  registered, so no job can execute it.
- **Runtime dependency unverifiable** (e.g. `tsv_dataset`, `local_database`):
  the plugin is still valid and its adapter remains registered for explicit
  jobs with caller-supplied data, but it is `available: false` for planning with
  an explicit reason.

## 5. Discovery and availability rules

`smartbio.aiagent.plugin_discovery.discover()` scans the manifests directory:

- Path resolution: `SMARTBIO_PLUGIN_DIR` environment variable, else
  `shared/plugins/` relative to the package (also overridable with
  `SMARTBIO_PLUGIN_SCHEMA`). The directory must be repo-controlled and
  non-user-writable: importing an adapter executes code, so startup discovery
  rejects temp/world-writable directories and out-of-repo overrides unless
  `SMARTBIO_PLUGIN_DIR_TRUSTED=1` explicitly acknowledges the risk. Passing an
  explicit directory to `discover()` is for tests/tooling and skips this guard.
- Every manifest is schema-validated; invalid JSON/schema is reported and the
  manifest contributes no tools. No module is imported until schema, reference,
  contract and hard-requirement checks pass.
- Every `entrypoint` is then imported, instantiated and checked for `TOOL_ID`,
  `VERSION` and callable `run`; `TOOL_ID` must match the tool id.
- All three contracts are validated as JSON Schemas, and references are checked
  against the shared ledger before import.
- Requirements are checked as in §4. Duplicate tool ids are rejected: neither
  copy is registered.
- **Registered** means the manifest, references, contracts and entrypoint are
  valid; such an adapter resolves through `get_plugin()` even if the tool is
  `available: false`. **Available** is stricter: the manifest says
  `available: true` and every requirement is satisfied. Availability governs
  planner-facing lists and user-facing reports, not explicit job execution.
  An invalid tool (bad schema/contract/reference, unimportable entrypoint or
  missing hard requirement) is reported unavailable with a precise error and
  cannot execute.

Public helpers:

- `plugin_capabilities()` — structured tool projections (the registry fields).
- `availability_report()` — per-tool availability, registration state, declared
  flag, requirement checks and discovery errors.
- `is_available(tool_id)` in `smartbio.aiagent.plugins` — the gate for
  planner-facing lists; do not use it to block explicit job execution.
- `load_plugins()`, `get_plugin()`, `require_plugin()` resolve every *valid*
  adapter; `list_tools()` now includes accurate `available` and
  `unavailable_reason` fields alongside `id`/`version`/`backend`.

The Worker registry is generated by
`python scripts/generate_plugin_registry.py` into
`web-platform/functions/api/ai/registry.tools.generated.js`; `registry.js`
re-exports `TOOLS` and keeps `getTool`/`toolIds`/`isKnownTool`/`validateParams`
unchanged. The generated file is checked in, so no build step is needed.

## 6. Generic extension seams (no control-plane edits)

Adapters can drive validation and explanations for *any* domain through
`tool_run_meta`; neither mechanism knows a tool id.

### `required_artifacts`

Add a list of artifact filenames that must be present and non-empty:

```python
"tool_run_meta": {..., "required_artifacts": ["alignment.fasta", "tree.nwk"]}
```

`smartbio.aiagent.validation.validate()` unions this list with the legacy
`REQUIRED_ARTIFACTS` entry for the tool (if any), de-duplicates names and emits
`missing_artifact:<name>` / `empty_artifact:<name>` for each absent file. An
adapter that declares artifacts but omits them can no longer report success.
CI rejects an *available* adapter that does not declare this seam.

### `evidence_hints`

Supply findings that the explanation builder resolves from cited artifact
fields:

```python
"tool_run_meta": {
    ...,
    "required_artifacts": ["tree_summary.json"],
    "evidence_hints": [
        {
            "text_template": "The tree contains {value} taxa.",
            "artifact": "tree_summary.json",
            "field_path": "summary.taxa_count"
        },
        {
            "label": "Conserved columns",
            "artifact": "tree_summary.json",
            "field_path": "summary.conserved_columns"
        }
    ]
}
```

`build_explanation(..., evidence_hints=tool_run_meta.get("evidence_hints"))`
runs after the legacy tool branches. `text_template` may interpolate only
`{value}` (the resolved field value); `label` renders `label: value.`. The hint
must cite an existing JSON artifact and a resolvable `field_path`. Every number
in the resulting text comes from the cited value, so
`check_explanation()` continues to reject fabricated numbers, unknown paths and
unverified citations. Unresolvable hints are skipped rather than emitted as
free-standing claims. The `evidence_hints` parameter defaults to `None`, so all
existing tools behave exactly as before. The generic branch emits **no
references**: the manifest's `references` are for reporting and CI, while a
plugin's scientific citations belong in its JSON artifacts/report. Agent
explanations only carry references that are in the curated ledger in
`plugin_references.py`; adding one there is a separate, verified decision.

Together these seams mean a new domain never needs a branch in
`validation.py`, `explanation.py`, `agent.py` or the Worker.

## 7. Testing and CI

Focused tests must cover:

- manifest schema validity and references/limitations presence,
- adapter importability and `TOOL_ID` match,
- real artifact production (or a structured failure on missing input),
- discovery/availability behaviour,
- any scientific rules that cannot be expressed as a JSON Schema.

Template tests live in `docs/plugins/template/tests/`. Run:

```powershell
python -m pytest -q python-engine/tests
python -m pytest -q docs/plugins/template/tests
python scripts/check_plugins.py
python scripts/generate_plugin_registry.py --check
cd web-platform; npm test
```

`scripts/check_plugins.py` is the CI gate: it fails on schema-invalid manifests,
unimportable entrypoints, `TOOL_ID` mismatches, invalid contracts, empty or
falsely verified references, empty limitations, unsatisfied requirements on an
available tool, an available adapter missing `required_artifacts`, a stale
generated registry, or a non-compliant template. The GitHub Actions
`plugin-compliance` job runs the checker and the plugin tests.

## 8. Compliance checklist

- [ ] Manifest in `shared/plugins/` passes `plugin.schema.json` (no extra fields).
- [ ] Every tool has a unique `id`, a resolvable `entrypoint`, and matching `TOOL_ID`.
- [ ] `params_schema`, `input_schema`, `output_schema` are valid object JSON Schemas.
- [ ] `references` is non-empty; verified claims are in the curated ledger; unverified claims have a `note`.
- [ ] `limitations` is non-empty, specific and honest.
- [ ] `requirements` use only verified forms, or the tool is honestly unavailable.
- [ ] `available: false` always has an `unavailable_reason`.
- [ ] Adapter calls existing scientific functions and fails closed on missing input.
- [ ] Adapter declares `required_artifacts` and, where useful, `evidence_hints`.
- [ ] Tests and docs added; `scripts/check_plugins.py` passes; generated registry regenerated and checked in.
- [ ] Accepted limitation: NL planner/UI exposure is separate product work and is not part of plugin registration.
