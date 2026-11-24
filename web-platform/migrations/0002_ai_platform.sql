-- AI control-plane tables (additive). Existing blast_requests is untouched.
-- Every table has an internal AUTOINCREMENT key plus a text public id used by
-- the API wire format (req_, ds_, plan_, job_, art_, etc.).

CREATE TABLE IF NOT EXISTS projects (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  public_id TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  owner TEXT,
  settings_json TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS datasets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  public_id TEXT NOT NULL UNIQUE,
  project_id TEXT,
  filename TEXT NOT NULL,
  sha256 TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  mime TEXT,
  storage_ref TEXT,
  -- Inline FASTA for the MVP: the local agent polls over HTTP and has no
  -- shared filesystem. Capped at 64 KiB by the Worker.
  fasta_text TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS ai_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  public_id TEXT NOT NULL UNIQUE,
  project_id TEXT,
  dataset_id TEXT,
  raw_text TEXT NOT NULL,
  inferred_intent TEXT,
  confidence REAL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS plans (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  public_id TEXT NOT NULL UNIQUE,
  request_id TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  plan_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS approvals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  public_id TEXT NOT NULL UNIQUE,
  plan_id TEXT NOT NULL,
  step_id TEXT NOT NULL,
  approved_by TEXT,
  consents_json TEXT NOT NULL,
  approved_at TEXT NOT NULL,
  expires_at TEXT
);

CREATE TABLE IF NOT EXISTS jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  public_id TEXT NOT NULL UNIQUE,
  plan_id TEXT NOT NULL,
  step_id TEXT NOT NULL,
  status TEXT NOT NULL,
  tool_id TEXT NOT NULL,
  params_json TEXT NOT NULL,
  inputs_json TEXT NOT NULL,
  consent_json TEXT NOT NULL,
  backend TEXT NOT NULL,
  agent_id TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  timeout_s INTEGER,
  execution_mode TEXT NOT NULL DEFAULT 'real',
  created_at TEXT NOT NULL,
  started_at TEXT,
  finished_at TEXT,
  result_json TEXT,
  validation_json TEXT,
  explanation_json TEXT,
  provenance_json TEXT,
  report_json TEXT
);

CREATE TABLE IF NOT EXISTS tool_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  public_id TEXT NOT NULL UNIQUE,
  job_id TEXT NOT NULL,
  tool_id TEXT NOT NULL,
  tool_version TEXT,
  params_json TEXT NOT NULL,
  input_refs_json TEXT NOT NULL,
  output_refs_json TEXT NOT NULL,
  provenance_json TEXT,
  started_at TEXT,
  finished_at TEXT
);

CREATE TABLE IF NOT EXISTS artifacts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  public_id TEXT NOT NULL UNIQUE,
  run_id TEXT NOT NULL,
  name TEXT NOT NULL,
  kind TEXT NOT NULL,
  storage_ref TEXT,
  sha256 TEXT NOT NULL,
  bytes INTEGER NOT NULL,
  mime TEXT,
  content TEXT,
  created_at TEXT NOT NULL
);

-- "references" is a reserved SQLite keyword; use evidence_references.
CREATE TABLE IF NOT EXISTS evidence_references (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  public_id TEXT NOT NULL UNIQUE,
  key TEXT NOT NULL,
  title TEXT NOT NULL,
  url TEXT,
  doi TEXT,
  license TEXT,
  verified_by TEXT,
  verified_at TEXT,
  notes TEXT,
  verified INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS report_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  public_id TEXT NOT NULL UNIQUE,
  plan_id TEXT NOT NULL,
  job_id TEXT NOT NULL,
  report_ref TEXT,
  explanation_ref TEXT,
  validation_ref TEXT,
  report_html TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  public_id TEXT NOT NULL UNIQUE,
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  target TEXT NOT NULL,
  detail_json TEXT NOT NULL,
  timestamp TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_datasets_project ON datasets (project_id);
CREATE INDEX IF NOT EXISTS idx_datasets_sha256 ON datasets (sha256);
CREATE INDEX IF NOT EXISTS idx_ai_requests_created ON ai_requests (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_plans_request ON plans (request_id);
CREATE INDEX IF NOT EXISTS idx_approvals_plan ON approvals (plan_id);
CREATE INDEX IF NOT EXISTS idx_jobs_plan ON jobs (plan_id);
CREATE INDEX IF NOT EXISTS idx_jobs_status_created ON jobs (status, created_at ASC);
CREATE INDEX IF NOT EXISTS idx_tool_runs_job ON tool_runs (job_id);
CREATE INDEX IF NOT EXISTS idx_artifacts_run ON artifacts (run_id);
CREATE INDEX IF NOT EXISTS idx_report_runs_job ON report_runs (job_id);
CREATE INDEX IF NOT EXISTS idx_audit_events_timestamp ON audit_events (timestamp DESC);
