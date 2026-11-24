-- Additive migration: single-use consent grants for the legacy remote BLAST
-- endpoint. No existing table is modified. Apply after 0001/0002.
CREATE TABLE IF NOT EXISTS blast_consents (
  token TEXT PRIMARY KEY,
  input_hash TEXT NOT NULL,
  database TEXT NOT NULL,
  program TEXT NOT NULL,
  granted INTEGER NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  used_at TEXT
);
