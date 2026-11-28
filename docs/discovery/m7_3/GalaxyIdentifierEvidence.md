# M7.3.2 â€” offline identifier evidence audit

The committed repository contains NO raw Galaxy job-output or history-contents response for MAFFT job `4838ba20a6d8676526e1c47a033d95de`. The only files containing `40160950115d555ef559061fbced7bce` and `cf2a6760-b219-4212-a609-aa37286628f5` are the M7.3.x reports and `web-platform/tests/phylo_galaxy_ids.test.mjs` (a hand-authored, illustrative fixture). The cached live probe captured during the earlier session sanitized all 32-character ids to `[ID:32]`; it showed a numeric input HDA id (`310912901`) in `job.params.input`, an output association `outputAlignment` with a redacted `id`, and a distinct UUID (`cf2a6760-...`) in the command line.

Consequently the historical claim that `40160950115d555ef559061fbced7bce` is BOTH the input HDA id and the MAFFT output HDA id is NOT established by committed evidence. It was transcribed into the report and then copied into a test fixture â€” the test reproduces an assumption rather than verifying Galaxy response behaviour. The fixture is now explicitly marked ILLUSTRATIVE.

**Status: UNRESOLVED pending live verification** of `GET /api/jobs/{id}/outputs` and `GET /api/histories/{history_id}/contents` with the rotated credential. No missing identifier has been inferred or manufactured.
