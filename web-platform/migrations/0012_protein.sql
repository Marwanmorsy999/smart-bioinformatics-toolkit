-- M7.13 real protein functional annotation. ADDITIVE ONLY: one small index
-- table; no existing table, column or row is changed. The AI jobs/artifacts
-- tables remain the authoritative run record used by /api/ai/runs/:id and
-- /api/ai/runs/:id/recovery.

CREATE TABLE IF NOT EXISTS protein_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  public_id TEXT NOT NULL UNIQUE,
  -- EBI convention: UPPERCASE hex MD5. Multi-FASTA inputs store the
  -- comma-joined uppercase MD5 values in the same deterministic order.
  md5 TEXT NOT NULL,
  route TEXT NOT NULL,
  provider_job_id TEXT,
  state TEXT NOT NULL,
  result_json TEXT,
  created_at TEXT NOT NULL,
  completed_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_protein_runs_md5 ON protein_runs (md5);
CREATE INDEX IF NOT EXISTS idx_protein_runs_provider_job ON protein_runs (provider_job_id);
