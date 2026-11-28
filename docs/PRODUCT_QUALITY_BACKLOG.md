# Product Quality Backlog (M7.15)

Canonical source of truth for the product/UX rebuild. Keep this file concise; update it at the end of each implementation session.

## Principles
- Learnability > task completion > scientific trust > AI usefulness > visual quality > advanced features.
- Every displayed number comes from retrieved tool artifacts or real feature-table counts; never fabricate.
- Unavailable stages remain honestly unavailable.
- No significance/causation claims without statistical evidence.
- Existing backend contracts preserved.

## Baseline
- Product HEAD: `9e7e195c8c9b0ed19cb9f76720c2b6266118c125` (includes M7.14.3).
- Verified run: `job_a8817e35d7534d98` (34 samples, 702 ASVs, 134,820 reads).
- Staging deployment at last verified: `a6315f49-f1d6-41c3-8f4a-2bf8b92e80ba`.
- M7.15.1 is actively deploying to shared staging; coordinate before any deploy.

## Milestone 1 (this session) — ported redesign onto M7.14.3 baseline
- Imported the redesigned application shell, navigation, homepage, assistant, and workbench frontend from the prior M7.15 redesign branch onto the current baseline.
- Preserved all backend/scientific logic and M7.14.3 endpoints.
- Tests: 1041/1041 pass; E2E PASS.
- No deploy (staging conflict with active M7.15.1).

## Route inventory (primary)
- `/` homepage — Start an Analysis entry, workflow choices, assistant entry, recent research (when records exist).
- `/microbiome.html` — flagship workbench (overview, data quality, ASVs, taxonomy, alpha, beta, PCoA, report).
- `/assistant.html` — dedicated contextual assistant.
- `/phylo.html`, `/protein.html`, `/16s.html`, `/taxonomy.html`, `/blast.html` — domain workflows.
- `/history.html`, `/workspace.html` — research workspace and history.
- `/research-use.html`, `/benchmark.html` — supporting.

## Acceptance criteria (M7.15 first delivery)
1. Coherent new visual system.
2. Simplified navigation.
3. Redesigned homepage.
4. Clear Start an Analysis experience.
5. Complete microbiome workbench using genuine existing results.
6. Integrated assistant entry point.
7. Usable results experience.
8. Responsive layouts.
9. Working primary interactions.
10. Automated and browser-based test evidence.
11. At least three documented design-review cycles.
12. Updated persistent quality backlog (this file).

## Design-review cycles (Milestone 1)
- Cycle 1 — Structure: ported shell/nav/homepage/workbench onto M7.14.3 baseline; preserved all backend contracts; verified 1041/1041 tests + E2E.
- Cycle 2 — Visual critique: captured overflow metrics at 1440/1280/1024/768/390/360 on the microbiome shell: zero horizontal overflow at every breakpoint; 20 headings / 6 primary buttons in the results shell. Remaining: screenshot-level hierarchy/spacing review against live data requires deploying this branch to staging (blocked by active M7.15.1).
- Cycle 3 — Usability critique: pending (task completion walkthrough of reopened run against live data; blocked on staging coordination).

## Known UX defects / next improvements
- Capture and inspect screenshots at all breakpoints; fix overflow/hierarchy issues.
- Verify keyboard focus, reduced motion, chart accessibility.
- Align assistant context to current project/run/dataset.
- Ensure mobile navigation is intentional, not compressed desktop.
- Update old M7.15-redesign branch or retire it to avoid conflicting deploys.
- Coordinate staging deployment with M7.15.1 owner before deploying.
- Score routes against the quality scorecard after visual inspection.

## Latest evidence
- Tests: 1041/1041 pass, E2E PASS.
- Real run reopen: `?run_id=job_a8817e35d7534d98` loads succeeded result with 702 ASVs, 34 samples, PCoA variance PC1 0.506.
- Screenshots: pending capture.