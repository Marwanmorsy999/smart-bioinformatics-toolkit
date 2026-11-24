// GET /api/ai/jobs - authenticated agent polling. Claims queued jobs by
// marking them running; no computation happens in the Worker.

import {
  SQL,
  agentTokenError,
  audit,
  envExecutionMode,
  errorResponse,
  getDb,
  hashInput,
  jsonResponse,
  listRows,
  nowIso,
  requireMethod,
  runStatement,
  safeString,
  toJobDto
} from "../_lib.js";

const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 50;

// Additive migration 0006. An authenticated poll is evidence of a live agent
// even when the queue is empty (cold start). When the agent does not send an
// explicit id, derive one from a hash of the token; never persist the token.
export const SQL_UPSERT_HEARTBEAT =
  "INSERT INTO agent_heartbeats (agent_id, last_seen_at, last_job_count) VALUES (?, ?, ?) " +
  "ON CONFLICT(agent_id) DO UPDATE SET last_seen_at = excluded.last_seen_at, last_job_count = excluded.last_job_count";

export async function onRequest(context) {
  const { request, env } = context;
  const rejected = requireMethod(request, "GET", "GET, OPTIONS");
  if (rejected) return rejected;
  return handlePollJobs(request, env, context);
}

export async function handlePollJobs(request, env, { now = Date.now(), idFactory } = {}) {
  const unauthorized = agentTokenError(request, env);
  if (unauthorized) return unauthorized;

  const db = getDb(env);
  if (!db) return errorResponse("AI database binding is unavailable.", 503, request);

  const url = new URL(request.url);
  const explicitAgentId = safeString(url.searchParams.get("agentId"), 100);
  const agentId = explicitAgentId || "local-agent";
  const rawLimit = Number(url.searchParams.get("limit"));
  const limit = Number.isInteger(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, MAX_LIMIT) : DEFAULT_LIMIT;
  const startedAt = nowIso(now);

  let queued;
  try {
    queued = await listRows(db, SQL.listQueuedJobs, ["queued", limit]);
  } catch {
    return errorResponse("Could not list jobs.", 500, request);
  }

  const jobs = [];
  try {
    for (const row of queued) {
      const claim = await runStatement(db, SQL.claimJob, [
        "running",
        agentId,
        startedAt,
        row.public_id,
        "queued"
      ]);
      if (claim?.meta?.changes !== 1) continue; // claimed concurrently
      const claimed = { ...row, status: "running", agent_id: agentId, started_at: startedAt, attempts: (row.attempts ?? 0) + 1 };
      jobs.push(toJobDto(claimed));
      await audit(db, {
        actor: agentId,
        action: "ai_job_claimed",
        target: row.public_id,
        detail: { tool_id: row.tool_id },
        timestamp: startedAt,
        idFactory
      });
    }
  } catch {
    return errorResponse("Could not claim jobs.", 500, request);
  }

  // Every successful authenticated poll records an observation, even when no
  // job was claimed. Best-effort: the table comes from additive migration 0006
  // and may not exist on a deployment that has not applied it yet; a missing
  // heartbeat simply means "not observed", never "confirmed online".
  try {
    const heartbeatAgentId = explicitAgentId
      || `token-${(await hashInput(String(env.AI_AGENT_TOKEN))).slice(0, 16)}`;
    await runStatement(db, SQL_UPSERT_HEARTBEAT, [heartbeatAgentId, startedAt, jobs.length]);
  } catch {
    // Keep polling working; heartbeat absence fails closed in the status API.
  }

  return jsonResponse({ jobs, execution_mode: envExecutionMode(env) }, 200, request);
}
