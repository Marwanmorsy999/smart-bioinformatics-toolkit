// GET /api/ai/backend - honest, read-only backend availability report.
// This endpoint never executes science and never claims a backend is present
// without evidence. It reports configuration plus the most recent observation:
// a fresh heartbeat from an authenticated poll (migration 0006) or an agent
// claim recorded in the existing jobs table (agent_id + started_at).

import {
  SQL,
  envExecutionMode,
  getDb,
  jsonResponse,
  listRows,
  requireMethod
} from "./_lib.js";

// Keep in sync with public/js/ai-execution.js.
export const BACKEND_NOT_CONNECTED_MESSAGE =
  "Agent not connected — heavy analyses unavailable; browser-local tools still work.";

// Observations are point-in-time evidence, so we say "observed recently",
// never "confirmed online". False negatives are intentional: it is safer to
// block than to claim an unavailable backend.
export const AGENT_FRESH_WINDOW_MS = 10 * 60 * 1000;

// Every authenticated agent poll upserts a heartbeat row, so an idle agent on
// a fresh deployment is observable even before it claims its first job.
export const SQL_LIST_HEARTBEATS =
  "SELECT agent_id, last_seen_at, last_job_count FROM agent_heartbeats";

const OBSERVED_STATUSES = ["running", "succeeded", "failed"];
const OBSERVED_LIMIT = 50;

// Distinct, human-readable observation bases (the UI displays this field as
// text). Both are evidence of an agent, never of a configured token alone.
const HEARTBEAT_BASIS = "agent heartbeat recorded by authenticated agent poll";
const JOB_CLAIM_BASIS = "agent job claim recorded in jobs (agent_id + started_at)";

export async function onRequest(context) {
  const { request, env } = context;
  const rejected = requireMethod(request, "GET", "GET, OPTIONS");
  if (rejected) return rejected;
  return handleBackendStatus(request, env);
}

export async function handleBackendStatus(request, env, {
  now = Date.now(),
  freshMs = AGENT_FRESH_WINDOW_MS
} = {}) {
  const executionMode = envExecutionMode(env);
  const tokenConfigured = Boolean(env?.AI_AGENT_TOKEN && String(env.AI_AGENT_TOKEN).trim());
  const db = getDb(env);

  let lastActivityAt = null;
  let basis = tokenConfigured
    ? "no agent activity recorded"
    : "agent token not configured";

  // Keep the most recent observation and the evidence that produced it.
  // Heartbeats are considered first, so they win exact-timestamp ties.
  const consider = (timestamp, label) => {
    if (!Number.isFinite(timestamp)) return;
    if (lastActivityAt === null || timestamp > lastActivityAt) {
      lastActivityAt = timestamp;
      basis = label;
    }
  };

  if (!db) {
    basis = "D1 binding unavailable; configuration only";
  } else if (tokenConfigured) {
    // Heartbeats are additive evidence. If migration 0006 has not been
    // applied, fall back to the pre-existing job-claim signal instead of
    // treating the missing table as a fatal error.
    try {
      const rows = await listRows(db, SQL_LIST_HEARTBEATS, []);
      for (const row of rows) consider(Date.parse(row.last_seen_at), HEARTBEAT_BASIS);
    } catch {
      // No heartbeat evidence available; job claims below still apply.
    }

    try {
      // Reuse the existing indexed query. Only rows with a claimed agent
      // count as evidence.
      for (const status of OBSERVED_STATUSES) {
        const rows = await listRows(db, SQL.listQueuedJobs, [status, OBSERVED_LIMIT]);
        for (const row of rows) {
          if (!row.agent_id || !row.started_at) continue;
          consider(Date.parse(row.started_at), JOB_CLAIM_BASIS);
        }
      }
    } catch {
      basis = "D1 query failed; configuration only";
      lastActivityAt = null;
    }
  }

  const ageMs = lastActivityAt === null ? null : now - lastActivityAt;
  const observedRecently = lastActivityAt !== null
    && ageMs >= 0
    && ageMs <= freshMs;
  const connected = tokenConfigured && observedRecently && executionMode === "real";
  const detail = executionMode === "mock"
    ? "Worker execution mode is mock; simulated output is not scientific evidence."
    : `${basis}${lastActivityAt === null ? "" : `; last observed activity ${new Date(lastActivityAt).toISOString()}`}`;

  return jsonResponse({
    execution_mode: executionMode,
    agent_token_configured: tokenConfigured,
    agent_status: connected ? "connected" : "not_connected",
    agent_observation_basis: basis,
    last_agent_activity_at: lastActivityAt === null ? null : new Date(lastActivityAt).toISOString(),
    last_agent_activity_age_seconds: ageMs === null ? null : Math.max(0, Math.floor(ageMs / 1000)),
    freshness_window_seconds: Math.floor(freshMs / 1000),
    heavy_analyses_available: connected,
    browser_local_available: true,
    simulated_results_available: false,
    message: connected
      ? "Local agent observed recently; heavy analyses are available."
      : BACKEND_NOT_CONNECTED_MESSAGE,
    detail,
    execution_route_labels: { "browser-local": "Browser (local)", "local-agent": "Local agent" }
  }, 200, request);
}
