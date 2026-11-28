// M7.3.1 â€” explicit Galaxy identifier handling.
// Galaxy instances expose several different identifiers for one output:
//   hda id       (`id` in history contents and job outputs) â€” used by /api/datasets/{id}
//   dataset id   (`dataset_id`) â€” underlying dataset association
//   dataset UUID (`uuid`) â€” persistent dataset identity, NOT an HDA id
// This module never guesses: it parses actual instance responses and validates
// that the chosen HDA belongs to the run's history before any download.
const HEX_ID = /^[0-9a-f]{8,64}(-[0-9a-f]{4,12}){0,4}$/i;

export function normalizeOutputAssociation(raw, { historyId = null } = {}) {
  const item = raw && typeof raw === "object" ? raw : {};
  const id = String(item.id ?? item.hda_id ?? "").trim();
  const datasetId = String(item.dataset_id ?? "").trim();
  const uuid = String(item.uuid ?? "").trim();
  const state = String(item.state ?? "").toLowerCase();
  if (!HEX_ID.test(id) && !/^\d+$/.test(id)) {
    return { valid: false, error: "missing_or_invalid_hda_id", galaxyHdaId: null,
      galaxyDatasetId: datasetId || null, galaxyDatasetUuid: uuid || null };
  }
  if (historyId && item.history_id && String(item.history_id) !== String(historyId)) {
    return { valid: false, error: "history_membership_mismatch", galaxyHdaId: id,
      galaxyDatasetId: datasetId || null, galaxyDatasetUuid: uuid || null };
  }
  if (["deleted", "purged", "discarded"].includes(state)) {
    return { valid: false, error: `dataset_${state}`, galaxyHdaId: id,
      galaxyDatasetId: datasetId || null, galaxyDatasetUuid: uuid || null };
  }
  return { valid: true, error: null, galaxyHdaId: id, galaxyDatasetId: datasetId || null,
    galaxyDatasetUuid: uuid || null, name: String(item.name ?? ""), state,
    extension: String(item.extension ?? item.file_ext ?? item.type ?? ""),
    historyId: String(item.history_id ?? historyId ?? "") };
}

export function parseJobOutputs(body, { historyId = null } = {}) {
  // Galaxy: GET /api/jobs/{id}/outputs -> output-name keyed objects with
  // {id, dataset_id, uuid, src, history_id, name, state, extension}.
  const root = body && typeof body === "object" ? body : {};
  const entries = Array.isArray(root) ? root : Object.values(root);
  return entries.map((entry) => normalizeOutputAssociation(entry, { historyId }));
}

export function parseHistoryContents(body, { historyId = null } = {}) {
  const entries = Array.isArray(body) ? body : [];
  return entries.map((entry) => normalizeOutputAssociation(entry, { historyId }));
}

export function resolveJobOutput(jobOutputs, historyContents) {
  const ok = (jobOutputs ?? []).filter((o) => o.valid);
  if (ok.length === 0) return { valid: false, error: "no_usable_job_output_association", hdaId: null };
  const preferred = ok.find((o) => o.state === "ok" || o.state === "success") ?? ok[0];
  const members = new Set((historyContents ?? []).filter((c) => c.valid).map((c) => c.galaxyHdaId));
  if (historyContents && historyContents.length > 0 && !members.has(preferred.galaxyHdaId)) {
    return { valid: false, error: "output_not_in_history_contents", hdaId: null,
      galaxyHdaId: preferred.galaxyHdaId, galaxyDatasetUuid: preferred.galaxyDatasetUuid };
  }
  return { valid: true, error: null, hdaId: preferred.galaxyHdaId,
    galaxyDatasetUuid: preferred.galaxyDatasetUuid, name: preferred.name,
    state: preferred.state, extension: preferred.extension };
}

// Explicit terminal state machine. `ok` is a successful terminal state on this
// instance; a missing output never turns a successful job into a timeout.
const SUCCESS = new Set(["ok", "success", "succeeded", "completed", "finished"]);
const FAILURE = new Set(["failed", "error", "deleted", "cancelled", "canceled", "discarded"]);
const ACTIVE = new Set(["new", "queued", "pending", "submitted", "running", "active", "in_progress", "uploading"]);

export function classifyJobState(rawState, { timedOut = false } = {}) {
  const state = String(rawState ?? "").trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (SUCCESS.has(state)) return "succeeded";
  if (FAILURE.has(state)) return "failed";
  if (ACTIVE.has(state)) return timedOut ? "timeout" : "running";
  return timedOut ? "timeout" : "unknown";
}

