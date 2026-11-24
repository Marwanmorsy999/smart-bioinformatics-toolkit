-- Additive migration: make approval/job creation idempotent under concurrency.
-- Two approvals of the same plan step must not produce two jobs or two
-- single-use BLAST consent tokens. No existing table is altered.
CREATE UNIQUE INDEX IF NOT EXISTS idx_jobs_plan_step ON jobs (plan_id, step_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_approvals_plan_step ON approvals (plan_id, step_id);
