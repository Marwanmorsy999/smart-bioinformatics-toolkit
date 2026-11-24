CREATE TABLE IF NOT EXISTS blast_requests (
  rid TEXT PRIMARY KEY,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  last_checked_at TEXT,
  input_hash TEXT NOT NULL,
  result_tsv TEXT
);

CREATE INDEX IF NOT EXISTS idx_blast_requests_created_at ON blast_requests (created_at DESC);