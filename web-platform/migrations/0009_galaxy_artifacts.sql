-- M7.2: R2-free, Galaxy-history-backed artifact references.
-- Additive only: no existing table is altered. R2 stays optional and disabled;
-- file bytes live exclusively in the Galaxy Europe history. D1 holds metadata,
-- hashes, provenance pointers and ownership-relevant identifiers. No byte blob
-- is ever written to D1.
--
-- `dataset_id` is the platform dataset public id (ds_..., the same id carried
-- by provider consent). `galaxy_dataset_id` is the provider-issued dataset id
-- used for live Galaxy lookups. `job_id`/`history_id` record provenance.

CREATE TABLE IF NOT EXISTS galaxy_artifacts (
  public_id TEXT PRIMARY KEY,
  dataset_id TEXT NOT NULL,
  galaxy_dataset_id TEXT,
  job_id TEXT,
  history_id TEXT,
  filename TEXT NOT NULL,
  ext TEXT,
  direction TEXT NOT NULL,
  sha256 TEXT,
  bytes INTEGER NOT NULL DEFAULT 0,
  project_id TEXT,
  created_at TEXT NOT NULL,
  deleted_at TEXT
);

-- One registration per platform dataset and direction. Soft deletes keep the
-- history of a reference without allowing a silent second registration.
CREATE UNIQUE INDEX IF NOT EXISTS idx_galaxy_artifacts_dataset
  ON galaxy_artifacts(dataset_id, direction);
CREATE INDEX IF NOT EXISTS idx_galaxy_artifacts_history
  ON galaxy_artifacts(history_id);
CREATE INDEX IF NOT EXISTS idx_galaxy_artifacts_galaxy_dataset
  ON galaxy_artifacts(galaxy_dataset_id);

-- Download audit: who / when / which dataset / how many bytes / which hash /
-- what status. The actor is a non-secret label for the verified owner token,
-- never the token itself and never a Galaxy API key.
CREATE TABLE IF NOT EXISTS galaxy_artifact_downloads (
  public_id TEXT PRIMARY KEY,
  artifact_id TEXT NOT NULL,
  dataset_id TEXT NOT NULL,
  actor TEXT NOT NULL,
  at TEXT NOT NULL,
  bytes INTEGER,
  sha256 TEXT,
  status TEXT NOT NULL,
  detail_json TEXT
);

CREATE INDEX IF NOT EXISTS idx_galaxy_artifact_downloads_dataset
  ON galaxy_artifact_downloads(dataset_id, at);
