-- M7: provider governor, consent, transfer ledger, governed jobs and artifacts.
-- Additive. Does not alter any M6 table.

CREATE TABLE IF NOT EXISTS provider_governor_state (
  singleton TEXT PRIMARY KEY,
  state_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS governor_alerts (
  public_id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  unit TEXT,
  category TEXT,
  ratio REAL,
  kind TEXT NOT NULL,
  at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS provider_jobs (
  public_id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  tool_id TEXT NOT NULL,
  operation TEXT NOT NULL,
  status TEXT NOT NULL,
  provider_job_id TEXT,
  reservation_id TEXT,
  dataset_id TEXT NOT NULL,
  input_hash TEXT,
  byte_count INTEGER NOT NULL DEFAULT 0,
  consent_id TEXT NOT NULL,
  transfer_id TEXT NOT NULL,
  params_json TEXT,
  created_at TEXT NOT NULL,
  finished_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_provider_jobs_provider ON provider_jobs(provider, created_at);

CREATE TABLE IF NOT EXISTS provider_transfers (
  public_id TEXT PRIMARY KEY,
  dataset_id TEXT NOT NULL,
  source TEXT NOT NULL,
  destination TEXT NOT NULL,
  input_hash TEXT,
  byte_count INTEGER NOT NULL DEFAULT 0,
  consent_id TEXT,
  operation TEXT,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT,
  deleted_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_provider_transfers_dataset ON provider_transfers(dataset_id, created_at);

CREATE TABLE IF NOT EXISTS provider_consents (
  public_id TEXT PRIMARY KEY,
  dataset_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  destination TEXT NOT NULL,
  scope_json TEXT,
  granted INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_provider_consents_dataset ON provider_consents(dataset_id, provider);

CREATE TABLE IF NOT EXISTS provider_artifacts (
  public_id TEXT PRIMARY KEY,
  dataset_id TEXT NOT NULL,
  object_key TEXT NOT NULL,
  filename TEXT NOT NULL,
  mime TEXT,
  sha256 TEXT NOT NULL,
  bytes INTEGER NOT NULL,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  deleted_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_provider_artifacts_dataset ON provider_artifacts(dataset_id, created_at);
