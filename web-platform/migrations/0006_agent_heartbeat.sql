-- Additive: observation evidence for authenticated polling agents. A fresh
-- deployment has no claimed jobs, so an idle agent would otherwise be invisible
-- to GET /api/ai/backend. Existing tables are untouched.
--
-- The raw agent token is never stored. The key is either the explicit agentId
-- supplied by the agent or an id derived from a hash of the token.
CREATE TABLE IF NOT EXISTS agent_heartbeats (
  agent_id TEXT PRIMARY KEY,
  last_seen_at TEXT NOT NULL,
  last_job_count INTEGER DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_agent_heartbeats_last_seen
  ON agent_heartbeats (last_seen_at DESC);
