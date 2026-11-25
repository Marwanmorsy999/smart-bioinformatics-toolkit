# M7.3.2 — Live Artifact Recovery and Full Phylogenetics Workflow

**Starting commit:** `7fe5a1c` (branch `phase-1-robustness-safety`).
**Exact prior report filename:** `docs/M7_3_PHYLOGENETICS_WORKFLOW_REPORT.md` — the referenced `docs/M7_3_1_RECOVERY_REPORT.md` does not exist in this repository.

## Deployment (verified)
- Commit deployed: `7fe5a1c572bf9746660667a884bf9021bba20e6c`
- Staging Worker: `smart-bioinformatics-toolkit-staging`
- Deployment URL: `https://smart-bioinformatics-toolkit-staging.m-2396.workers.dev`
- New Version ID: `6ffa0032-b7d6-44a7-9e52-3ec195f09b0b`
- Production: no Worker named `smart-bioinformatics-toolkit` (deployment error "Worker not found") — production untouched.
- smarts.bio / 9Router: remain disabled in `[env.staging.vars]`; R2: no binding.

## Security precondition
- Staging secret bindings confirmed present by name only: `GALAXY_API_KEY`, `GALAXY_BASE_URL`, `AI_AGENT_TOKEN`, `MOCK_NCBI`. No value was displayed, exported, logged or committed.
- The milestone requires the previously exposed Galaxy key to be revoked and replaced **before live calls**. No owner confirmation of the rotation, and no verifiable rotation marker, is available in this environment. The secret binding's existence alone does not prove it holds a replacement credential.
- Therefore **no further live Galaxy calls were made** in this continuation. The following live acceptance items remain unexecuted/unverified: identifier reconciliation against the live provider, alignment recovery/hash, IQ-TREE job, Newick recovery/hash, deployed browser E2E with a real cloud workflow.

## Offline verification (all green)
- JavaScript suites: 418 tests, 0 failures (`npm test`).
- Python suites: 244 tests, 0 failures (`python -m pytest tests/`).
- Chromium E2E: PASS (`npm run test:e2e`) — static page flow and tree SVG only, not a real cloud run.
- New M7.3.1 tests cover: HDA id vs dataset UUID normalization, wrong-history rejection, deleted/purged handling, successful terminal polling, genuine timeout, and success-with-artifact-failure distinction.

## Previously captured live evidence (not renewed here)
- MAFFT job `4838ba20a6d8676526e1c47a033d95de`: state `ok`, exit 0, `v7.526`.
- History `11ac94870d0bb33adfdcc31d5164dd84`; input HDA `40160950115d555ef559061fbced7bce`; output UUID `cf2a6760-b219-4212-a609-aa37286628f5`.
- Input SHA-256 `a0e181d42477ba4e466d678d647e3b8544b7c84af281734eb908d90c9a5782e4`.
- No alignment or Newick hashes exist: neither artifact was recovered.

## Verdict
**BLOCKED.** Deployment and offline verification are complete, but live acceptance criteria 2–10 cannot be satisfied without confirmed credential rotation. No downgrade of criteria is claimed.
