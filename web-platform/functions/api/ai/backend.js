// GET /api/ai/backend - honest, read-only backend availability report.
// This endpoint never executes science and never claims a backend is present
// without evidence. It reports configuration plus the most recent agent claim
// recorded in the existing jobs table (agent_id + started_at).

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

// An agent that is idle (no queued jobs) leaves no trace in D1. We therefore
// say "observed recently", never "confirmed online". False negatives are
// intentional: it is safer to block than to claim an unavailable backend.
export const AGENT_FRESH_WINDOW_MS = 10 * 60 * 1000;
const OBSERVED_STATUSES = ["running", "succeeded", "failed"];
const OBSERVED_LIMIT = 50;

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
  let observation = tokenConfigured
    ? "no agent activity recorded"
    : "agent token not configured";

  if (!db) {
    observation = "D1 binding unavailable; configuration only";
  } else if (tokenConfigured) {
    try {
      // Reuse the existing indexed query; no schema change or new SQL is
      // needed. Only rows with a claimed agent count as evidence.
      for (const status of OBSERVED_STATUSES) {
        const rows = await listRows(db, SQL.listQueuedJobs, [status, OBSERVED_LIMIT]);
        for (const row of rows) {
          if (!row.agent_id || !row.started_at) continue;
          const timestamp = Date.parse(row.started_at);
          if (!Number.isFinite(timestamp)) continue;
          if (lastActivityAt === null || timestamp > lastActivityAt) lastActivityAt = timestamp;
        }
      }
    } catch {
      observation = "D1 query failed; configuration only";
      lastActivityAt = null;
    }
    if (lastActivityAt !== null) {
      observation = "agent job claim recorded in jobs (agent_id + started_at)";
    }
  }

  const ageMs = lastActivityAt === null ? null : now - lastActivityAt;
  const observedRecently = lastActivityAt !== null
    && ageMs >= 0
    && ageMs <= freshMs;
  const connected = tokenConfigured && observedRecently && executionMode === "real";
  const detail = executionMode === "mock"
    ? "Worker execution mode is mock; simulated output is not scientific evidence."
    : `${observation}${lastActivityAt === null ? "" : `; last job claim ${new Date(lastActivityAt).toISOString()}`}`;

  return jsonResponse({
    execution_mode: executionMode,
    agent_token_configured: tokenConfigured,
    agent_status: connected ? "connected" : "not_connected",
    agent_observation_basis: observation,
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
