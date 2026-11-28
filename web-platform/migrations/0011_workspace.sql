-- M7.4 unified research workspace. ADDITIVE ONLY: no DROP, no column
-- redefinition, no rewrite of existing rows. Existing 16S and phylo paths keep
-- working exactly as before.

-- ---------------------------------------------------------------- projects
-- NOTE: projects.owner ALREADY EXISTS in 0002_ai_platform.sql. It is reused as
-- the derived non-secret owner principal; adding it again would fail.
ALTER TABLE projects ADD COLUMN description TEXT;
ALTER TABLE projects ADD COLUMN scientific_objective TEXT;
ALTER TABLE projects ADD COLUMN status TEXT NOT NULL DEFAULT 'active';
ALTER TABLE projects ADD COLUMN updated_at TEXT;

-- ---------------------------------------------------------------- datasets
-- fasta_text semantics are unchanged: only the legacy /api/ai/requests path
-- stores inline FASTA. Workspace registration is metadata-only (fasta_text
-- remains NULL); provider_history_ref is a reference, never a file location.
ALTER TABLE datasets ADD COLUMN file_format TEXT;
ALTER TABLE datasets ADD COLUMN source TEXT;
ALTER TABLE datasets ADD COLUMN validation_state TEXT;
ALTER TABLE datasets ADD COLUMN provider_history_ref TEXT;
ALTER TABLE datasets ADD COLUMN uploaded_at TEXT;
ALTER TABLE datasets ADD COLUMN owner TEXT;
ALTER TABLE datasets ADD COLUMN is_demo INTEGER NOT NULL DEFAULT 0;

-- ---------------------------------------------------------- workspace_runs
-- One unified run per workspace action. The existing jobs/tool_runs/artifacts
-- tables remain the source of truth for executed scientific steps; this table
-- is the owner-scoped project-level index over them and over planned work.
CREATE TABLE IF NOT EXISTS workspace_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  public_id TEXT NOT NULL UNIQUE,
  project_id TEXT NOT NULL,
  workflow_id TEXT NOT NULL,
  workflow_version TEXT NOT NULL,
  objective TEXT,
  input_datasets_json TEXT NOT NULL,
  params_json TEXT NOT NULL,
  execution_provider TEXT,
  execution_mode TEXT NOT NULL DEFAULT 'real',
  state TEXT NOT NULL DEFAULT 'draft',
  created_at TEXT NOT NULL,
  completed_at TEXT,
  steps_json TEXT,
  artifact_refs_json TEXT,
  validation_json TEXT,
  provenance_json TEXT,
  error_json TEXT,
  owner TEXT,
  is_demo INTEGER NOT NULL DEFAULT 0
);

-- -------------------------------------------------------- provenance_records
-- Immutable final record written when a unified run reaches 'succeeded'.
CREATE TABLE IF NOT EXISTS provenance_records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  public_id TEXT NOT NULL UNIQUE,
  run_id TEXT NOT NULL,
  record_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  owner TEXT
);

-- Reports: DECISION — reuse the existing report_runs table rather than adding
-- a new reports table. report_runs.job_id stores the workspace run public_id
-- (run_...). Authorization is enforced through the parent workspace_runs row
-- (public_id + owner), so a caller without ownership can never reach a report.
-- No owner column is needed on report_runs and no report row is fabricated.

-- ------------------------------------------------------------------ indexes
CREATE INDEX IF NOT EXISTS idx_projects_owner ON projects (owner);
CREATE INDEX IF NOT EXISTS idx_projects_owner_status ON projects (owner, status);
CREATE INDEX IF NOT EXISTS idx_datasets_owner_project ON datasets (owner, project_id);
CREATE INDEX IF NOT EXISTS idx_workspace_runs_owner_project ON workspace_runs (owner, project_id);
CREATE INDEX IF NOT EXISTS idx_workspace_runs_owner_state ON workspace_runs (owner, state);
CREATE INDEX IF NOT EXISTS idx_provenance_records_owner_run ON provenance_records (owner, run_id);
