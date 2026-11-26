-- M7.14 first real multi-sample 16S microbiome workflow. ADDITIVE ONLY: one
-- small index table so an identical input/metadata pair is never submitted
-- twice after a browser refresh. The AI plans/jobs/artifacts tables remain the
-- authoritative run record used by /api/ai/runs/:id and /recovery.

CREATE TABLE IF NOT EXISTS microbiome_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  public_id TEXT NOT NULL UNIQUE,
  input_sha256 TEXT NOT NULL,
  metadata_sha256 TEXT NOT NULL,
  state TEXT NOT NULL,
  plan_id TEXT,
  run_id TEXT,
  state_json TEXT,
  result_json TEXT,
  created_at TEXT NOT NULL,
  completed_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_microbiome_runs_input
  ON microbiome_runs (input_sha256, metadata_sha256);
CREATE INDEX IF NOT EXISTS idx_microbiome_runs_provider
  ON microbiome_runs (state);
