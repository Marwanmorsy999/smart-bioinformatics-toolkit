# Template plugin

This directory is a copyable skeleton, not a shipped scientific domain.

- `manifest.json` — schema-valid manifest with honest `available: false` and an
  `unavailable_reason`; declares real references, limitations and three
  contracts (`params_schema`, `input_schema`, `output_schema`).
- `adapter.py` — importable `module:Class` entrypoint exposing `TOOL_ID`,
  `VERSION` and `run(step, inputs, context)`. It emits no artifacts and returns
  a structured failure, so nothing can be mistaken for a scientific result.
- `tests/test_template_plugin.py` — checks the skeleton against
  `shared/schemas/plugin.schema.json` and the discovery/availability rules.

To start a new domain: copy this directory, rename the tool id in both the
manifest and adapter, keep the manifest in `shared/plugins/<domain>.json`,
put the adapter under `python-engine/src/smartbio/plugins/`, add tests and docs,
and run `python scripts/check_plugins.py`. No control-plane changes are needed.
See `docs/plugins/PLUGIN_AUTHORING.md` for the full contract.
