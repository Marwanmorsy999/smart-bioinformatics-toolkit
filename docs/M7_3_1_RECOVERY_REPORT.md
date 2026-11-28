# M7.3.1 recovery report

The full M7.3.1 diagnosis, identifier mapping, polling fix and live MAFFT evidence are recorded in `docs/M7_3_PHYLOGENETICS_WORKFLOW_REPORT.md` (sections: "Recovery addendum" and "M7.3.1 diagnosis and offline fixes").

- MAFFT job `4838ba20a6d8676526e1c47a033d95de`: `ok`, exit 0, `v7.526`.
- Retrieval failure cause: dataset UUID was used as an HDA id; fixed with explicit `galaxyHdaId`/`galaxyDatasetUuid` handling and history-membership validation.
- Polling defect: `ok` misclassified as timeout; fixed with explicit terminal-state machine.
- Overall M7.3.1 verdict: BLOCKED pending credential rotation and live artifact recovery.
