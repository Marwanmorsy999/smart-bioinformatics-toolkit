// R2-free, Galaxy-history-backed artifact metadata store.
//
// Design rules (MVP):
//  * Galaxy Europe histories are the ONLY byte store. This module never writes
//    file bytes to D1; it records dataset references, hashes, provenance
//    pointers and a download audit trail.
//  * All provider traffic goes through the existing Galaxy adapter
//    (`providers/galaxy/index.js`) with a caller-injected fetch, so no secret
//    is read, logged or returned here.
//  * A hard 1 MiB cap bounds memory and matches Worker request limits. The cap
//    is enforced before any network call and again on every response body.
//  * R2 is deliberately not used, not required and not configured here.

import { createAdapter } from "../providers/galaxy/index.js";
import { OPERATIONS, normalizeProviderError } from "../providers/common/contract.js";
import { Sha256Stream } from "./sha256.js";

// 1 MiB MVP cap: documented because Workers limit request/response memory. A
// larger file must be split into multiple dataset references by the caller.
export const MAX_UPLOAD_BYTES = 1 * 1024 * 1024;

// `upload1` is Galaxy's generic platform upload primitive (an API primitive,
// not a scientific capability). It is the same id the adapter itself uses for
// inline uploads; no tool capability is discovered or advertised from it.
export const UPLOAD_TOOL_ID = "upload1";

export const DIRECTIONS = Object.freeze({ INPUT: "input", OUTPUT: "output" });

// Text biological formats only: Galaxy's file_content upload transport is a
// JSON string, so binary containers are excluded for this MVP.
export const ALLOWED_EXTENSIONS = Object.freeze(new Set([
  "fa", "fasta", "fna", "faa", "fastq", "fq", "tsv", "csv", "txt",
  "vcf", "bed", "gff", "gtf", "json", "sam"
]));

const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const SAFE_STATUSES = new Set([400, 401, 403, 404, 408, 409, 410, 413, 429, 500, 502, 503, 504]);

// Fixed outward messages. Provider bodies are never echoed (they can contain
// configuration details); only a whitelisted code and status are surfaced.
const PROVIDER_MESSAGES = Object.freeze({
  400: "Provider rejected the request.",
  401: "Provider authentication failed.",
  403: "Provider authorization denied.",
  404: "Provider resource not found.",
  408: "Provider request timed out.",
  409: "Provider rejected a duplicate resource.",
  410: "Provider resource is deleted, expired or no longer available.",
  413: "Provider payload is too large.",
  429: "Provider rate limit exceeded.",
  500: "Provider internal error.",
  502: "Provider gateway error.",
  503: "Provider unavailable.",
  504: "Provider gateway timeout."
});

export const GALAXY_ARTIFACT_SQL = Object.freeze({
  insertArtifact: "INSERT INTO galaxy_artifacts (public_id, dataset_id, galaxy_dataset_id, job_id, history_id, filename, ext, direction, sha256, bytes, project_id, created_at, deleted_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
  getArtifactById: "SELECT * FROM galaxy_artifacts WHERE public_id = ? AND deleted_at IS NULL",
  getArtifactByDataset: "SELECT * FROM galaxy_artifacts WHERE dataset_id = ? AND direction = ? AND deleted_at IS NULL",
  getArtifactByGalaxyDataset: "SELECT * FROM galaxy_artifacts WHERE galaxy_dataset_id = ? AND deleted_at IS NULL",
  listArtifacts: "SELECT * FROM galaxy_artifacts WHERE deleted_at IS NULL ORDER BY created_at DESC LIMIT ?",
  markArtifactDeleted: "UPDATE galaxy_artifacts SET deleted_at = ? WHERE public_id = ?",
  insertDownload: "INSERT INTO galaxy_artifact_downloads (public_id, artifact_id, dataset_id, actor, at, bytes, sha256, status, detail_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
  listDownloads: "SELECT * FROM galaxy_artifact_downloads WHERE dataset_id = ? ORDER BY at DESC LIMIT ?"
});

export const GALAXY_ARTIFACT_COLUMNS = Object.freeze([
  "public_id", "dataset_id", "galaxy_dataset_id", "job_id", "history_id",
  "filename", "ext", "direction", "sha256", "bytes", "project_id",
  "created_at", "deleted_at"
]);
export const GALAXY_DOWNLOAD_COLUMNS = Object.freeze([
  "public_id", "artifact_id", "dataset_id", "actor", "at", "bytes",
  "sha256", "status", "detail_json"
]);

// Mirrors the SQL_META pattern used by the existing fake D1 so tests can
// assert exactly which statements run and that no byte column exists.
export const GALAXY_ARTIFACT_SQL_META = Object.freeze({
  [GALAXY_ARTIFACT_SQL.insertArtifact]: { op: "insert", table: "galaxy_artifacts", columns: GALAXY_ARTIFACT_COLUMNS },
  [GALAXY_ARTIFACT_SQL.getArtifactById]: { op: "select", table: "galaxy_artifacts", where: ["public_id"] },
  [GALAXY_ARTIFACT_SQL.getArtifactByDataset]: { op: "select", table: "galaxy_artifacts", where: ["dataset_id", "direction"] },
  [GALAXY_ARTIFACT_SQL.getArtifactByGalaxyDataset]: { op: "select", table: "galaxy_artifacts", where: ["galaxy_dataset_id"] },
  [GALAXY_ARTIFACT_SQL.listArtifacts]: { op: "select", table: "galaxy_artifacts", where: [], orderBy: "created_at", limit: true },
  [GALAXY_ARTIFACT_SQL.markArtifactDeleted]: { op: "update", table: "galaxy_artifacts", where: ["public_id"], assignments: { deleted_at: 0 } },
  [GALAXY_ARTIFACT_SQL.insertDownload]: { op: "insert", table: "galaxy_artifact_downloads", columns: GALAXY_DOWNLOAD_COLUMNS },
  [GALAXY_ARTIFACT_SQL.listDownloads]: { op: "select", table: "galaxy_artifact_downloads", where: ["dataset_id"], orderBy: "at", limit: true }
});

export function artifactError(code, message, status = 400, detail = {}) {
  return Object.assign(new Error(String(message)), {
    artifactError: true, code: String(code), status: Number(status) || 400, detail
  });
}

export function isArtifactError(value) {
  return Boolean(value && value.artifactError === true);
}

function fromProviderError(error) {
  const normalized = normalizeProviderError("galaxy", error);
  let status = SAFE_STATUSES.has(Number(normalized.status)) ? Number(normalized.status) : 502;
  let code = String(normalized.code ?? "provider_error").replace(/[^A-Za-z0-9_.:-]/g, "").slice(0, 80) || "provider_error";
  // Galaxy reports some purges as a 404 with a deleted/expired code. Surface
  // those as the contract's explicit "gone" signal instead of a plain miss.
  if (status === 404 && /deleted|expired|purged/i.test(code)) status = 410;
  return artifactError(code, PROVIDER_MESSAGES[status] ?? "Provider request failed.", status, {
    provider: "galaxy", retryable: Boolean(normalized.retryable)
  });
}

export function sanitizeFilename(value) {
  const text = typeof value === "string" ? value.split(/[\\/]/).pop() ?? "" : "";
  return text.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 200) || "upload.txt";
}

export function extensionOf(filename) {
  const clean = sanitizeFilename(filename);
  const dot = clean.lastIndexOf(".");
  return dot > 0 ? clean.slice(dot + 1).toLowerCase() : "";
}

export function isAllowedFilename(filename) {
  return ALLOWED_EXTENSIONS.has(extensionOf(filename));
}

export function isSha256(value) {
  return SHA256_PATTERN.test(String(value ?? "").toLowerCase());
}

export function makeArtifactId(prefix, idFactory) {
  if (typeof idFactory === "function") {
    const value = idFactory(prefix);
    if (typeof value === "string" && value) return value;
  }
  let hex = "";
  if (globalThis.crypto?.getRandomValues) {
    const bytes = new Uint8Array(8);
    globalThis.crypto.getRandomValues(bytes);
    hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  } else {
    for (let index = 0; index < 16; index += 1) hex += Math.floor(Math.random() * 16).toString(16);
  }
  return `${prefix}_${hex}`;
}

// Public DTO: metadata only. No file bytes, no API key, no history token.
export function publicArtifact(row) {
  return {
    id: row.public_id,
    dataset_id: row.dataset_id,
    galaxy_dataset_id: row.galaxy_dataset_id ?? null,
    job_id: row.job_id ?? null,
    history_id: row.history_id ?? null,
    filename: row.filename,
    ext: row.ext ?? null,
    direction: row.direction,
    sha256: row.sha256 ?? null,
    bytes: Number(row.bytes ?? 0),
    project_id: row.project_id ?? null,
    created_at: row.created_at,
    deleted_at: row.deleted_at ?? null
  };
}

/**
 * D1 metadata store plus the Galaxy-adapter operations that keep it honest.
 * `db` is the D1 binding; `deps.fetch` is the injected transport (tests inject
 * a mock; production uses env.FETCH_IMPL). No credential is ever read here.
 */
export function createGalaxyArtifactStore(db, env = {}, deps = {}) {
  if (!db || typeof db.prepare !== "function") {
    throw artifactError("no_d1", "D1 binding is unavailable.", 503);
  }
  const adapter = deps.adapter ?? createAdapter(env);
  const idFactory = deps.idFactory ?? null;
  const timestamp = typeof deps.now === "function" ? deps.now : () => new Date().toISOString();
  const ctx = () => ({
    fetch: deps.fetch ?? env?.FETCH_IMPL ?? globalThis.fetch,
    timeoutMs: deps.timeoutMs,
    signal: deps.signal ?? null,
    sleep: deps.sleep ?? null,
    now: timestamp,
    idFactory
  });

  async function insertRow(sql, values) {
    await db.prepare(sql).bind(...values).run();
  }

  async function selectRows(sql, values) {
    const result = await db.prepare(sql).bind(...values).all();
    return result?.results ?? [];
  }

  async function getById(publicId) {
    const rows = await selectRows(GALAXY_ARTIFACT_SQL.getArtifactById, [String(publicId ?? "")]);
    return rows[0] ?? null;
  }

  async function getByDataset(datasetId, direction = DIRECTIONS.INPUT) {
    const rows = await selectRows(GALAXY_ARTIFACT_SQL.getArtifactByDataset, [
      String(datasetId ?? ""), String(direction)
    ]);
    return rows[0] ?? null;
  }

  async function getByGalaxyDataset(galaxyDatasetId) {
    const rows = await selectRows(GALAXY_ARTIFACT_SQL.getArtifactByGalaxyDataset, [String(galaxyDatasetId ?? "")]);
    return rows[0] ?? null;
  }

  // The URL id may be the artifact public id, the platform dataset id or the
  // provider dataset id; all three resolve to the same metadata-only record.
  async function resolve(id) {
    const key = String(id ?? "");
    if (!key) return null;
    const byId = await getById(key);
    if (byId) return byId;
    if (key.startsWith("ds_")) {
      const asInput = await getByDataset(key, DIRECTIONS.INPUT);
      if (asInput) return asInput;
      const asOutput = await getByDataset(key, DIRECTIONS.OUTPUT);
      if (asOutput) return asOutput;
    }
    return getByGalaxyDataset(key);
  }

  async function list(limit = 50) {
    const bounded = Math.max(1, Math.min(Number(limit) || 50, 100));
    return selectRows(GALAXY_ARTIFACT_SQL.listArtifacts, [bounded]);
  }

  async function markDeleted(publicId) {
    await insertRow(GALAXY_ARTIFACT_SQL.markArtifactDeleted, [timestamp(), String(publicId)]);
    return true;
  }

  async function register(ref = {}) {
    const datasetId = String(ref.dataset_id ?? "");
    const direction = String(ref.direction ?? "");
    if (!datasetId) throw artifactError("dataset_id_required", "dataset_id is required.", 400);
    if (!Object.values(DIRECTIONS).includes(direction)) {
      throw artifactError("invalid_direction", "direction must be input or output.", 400);
    }
    const bytes = Number(ref.bytes);
    if (!Number.isInteger(bytes) || bytes < 0 || bytes > MAX_UPLOAD_BYTES) {
      throw artifactError("oversize", `Artifact size must be between 0 and ${MAX_UPLOAD_BYTES} bytes.`, 413);
    }
    const duplicate = await getByDataset(datasetId, direction);
    if (duplicate) {
      throw artifactError("duplicate_artifact", "Dataset reference is already registered.", 409, {
        public_id: duplicate.public_id
      });
    }
    const row = {
      public_id: String(ref.public_id ?? makeArtifactId("art", idFactory)),
      dataset_id: datasetId,
      galaxy_dataset_id: String(ref.galaxy_dataset_id ?? "") || null,
      job_id: String(ref.job_id ?? "") || null,
      history_id: String(ref.history_id ?? "") || null,
      filename: sanitizeFilename(ref.filename),
      ext: String(ref.ext ?? "").replace(/^\./, "").slice(0, 40) || null,
      direction,
      sha256: isSha256(ref.sha256) ? String(ref.sha256).toLowerCase() : null,
      bytes,
      project_id: String(ref.project_id ?? "") || null,
      created_at: String(ref.created_at ?? timestamp()),
      deleted_at: null
    };
    await insertRow(GALAXY_ARTIFACT_SQL.insertArtifact, GALAXY_ARTIFACT_COLUMNS.map((column) => row[column]));
    return row;
  }

  async function recordDownload(entry = {}) {
    const row = {
      public_id: String(entry.public_id ?? makeArtifactId("gad", idFactory)),
      artifact_id: String(entry.artifact_id ?? ""),
      dataset_id: String(entry.dataset_id ?? ""),
      // Non-secret label for the verified owner, never the token or API key.
      actor: String(entry.actor ?? "owner").replace(/[\u0000-\u001f\u007f]/g, "").slice(0, 80) || "owner",
      at: String(entry.at ?? timestamp()),
      bytes: Number.isFinite(Number(entry.bytes)) ? Number(entry.bytes) : null,
      sha256: isSha256(entry.sha256) ? String(entry.sha256).toLowerCase() : null,
      status: String(entry.status ?? "unknown").slice(0, 40),
      detail_json: JSON.stringify(entry.detail ?? {})
    };
    await insertRow(GALAXY_ARTIFACT_SQL.insertDownload, GALAXY_DOWNLOAD_COLUMNS.map((column) => row[column]));
    return row;
  }

  async function listDownloads(datasetId, limit = 50) {
    const bounded = Math.max(1, Math.min(Number(limit) || 50, 100));
    return selectRows(GALAXY_ARTIFACT_SQL.listDownloads, [String(datasetId ?? ""), bounded]);
  }

  // Confirm the recorded dataset still exists in Galaxy and belongs to the
  // recorded history AND job. The dataset id is passed WITHOUT a history_id so
  // the adapter reports the provider's own history (never our recorded value).
  async function inspectDataset(row, { verifyJob = true } = {}) {
    const datasetId = String(row?.galaxy_dataset_id ?? "");
    if (!datasetId) throw artifactError("missing_dataset_id", "No Galaxy dataset is recorded for this artifact.", 404);
    const listed = await adapter.getArtifacts({ dataset_id: datasetId }, ctx());
    if (listed?.error) throw fromProviderError(listed.error);
    const live = (Array.isArray(listed?.artifacts) ? listed.artifacts : [])
      .find((item) => item?.id === datasetId) ?? null;
    if (!live) throw artifactError("dataset_not_found", "Galaxy dataset not found.", 404, { dataset_id: datasetId });
    if (live.deleted === true || ["deleted", "purged", "expired"].includes(String(live.state ?? "").toLowerCase())) {
      throw artifactError("dataset_deleted", "Galaxy dataset is deleted or expired.", 410, { dataset_id: datasetId });
    }
    const liveHistory = String(live.history_id ?? "");
    if (!liveHistory) throw artifactError("missing_history", "Galaxy did not report a history for the dataset.", 502);
    if (row.history_id && liveHistory !== row.history_id) {
      throw artifactError("history_mismatch", "Dataset does not belong to the recorded history.", 409, {
        expected: row.history_id, actual: liveHistory
      });
    }
    if (verifyJob && row.job_id) {
      const job = await adapter.getJobStatus({ job_id: row.job_id }, ctx());
      if (job?.error) throw fromProviderError(job.error);
      const jobHistory = String(job?.output?.structured?.history_id ?? "");
      if (!jobHistory) throw artifactError("missing_history", "Galaxy did not report a history for the job.", 502);
      if (jobHistory !== liveHistory) {
        throw artifactError("history_mismatch", "Recorded job does not belong to the dataset history.", 409, {
          expected: liveHistory, actual: jobHistory
        });
      }
    }
    return live;
  }

  // Upload through the adapter's own submitJob/upload path, then resolve the
  // provider dataset id from the resulting history. No bytes touch D1.
  async function uploadDataset({ dataset_id, filename, ext, content, sha256, bytes, project_id = null } = {}) {
    const submitted = await adapter.submitJob({
      operation: OPERATIONS.SUBMIT_JOB,
      tool_id: UPLOAD_TOOL_ID,
      inputs: { file1: { src: "upload", content, filename, extension: ext } }
    }, ctx());
    if (submitted?.error) throw fromProviderError(submitted.error);
    const historyId = String(submitted?.output?.structured?.history_id ?? "");
    if (!historyId) throw artifactError("missing_history", "Galaxy did not return a history for the upload.", 502);
    // /api/tools/fetch returns the new dataset id immediately. Use it directly;
    // getArtifacts() only lists completed datasets and would race the upload job.
    const returned = String(submitted?.output?.structured?.dataset_id ?? "");
    const returnedDatasetId = /^[0-9a-f]{16,64}$/.test(returned) ? returned : null;
    if (returnedDatasetId) {
      return register({
        dataset_id, galaxy_dataset_id: returnedDatasetId,
        job_id: submitted.provider_job_id ?? null, history_id: historyId,
        filename, ext, direction: DIRECTIONS.INPUT, sha256, bytes, project_id
      });
    }
    const listed = await adapter.getArtifacts({ history_id: historyId }, ctx());
    if (listed?.error) throw fromProviderError(listed.error);
    const artifacts = Array.isArray(listed?.artifacts) ? listed.artifacts : [];
    // Bind only an exact filename match. Falling back to artifacts[0] could
    // register an unrelated historical dataset in this history.
    const live = artifacts.find((item) => item?.name === filename) ?? null;
    if (!live?.id) {
      // A freshly uploaded dataset may still be queued, and the adapter's
      // artifact list only includes completed datasets. Fail clearly rather
      // than binding the wrong dataset; the upload must be retried later.
      throw artifactError("missing_output_dataset", "Galaxy did not return a completed dataset with the uploaded filename.", 502, { history_id: historyId });
    }
    return register({
      dataset_id, galaxy_dataset_id: live.id,
      job_id: submitted.provider_job_id ?? null, history_id: historyId,
      filename: live.name || filename, ext: live.type || ext,
      direction: DIRECTIONS.INPUT, sha256, bytes, project_id
    });
  }

  // The adapter exposes downloadArtifact as a text-returning method, so the
  // provider body is bounded by our hard cap before it is returned to the
  // caller as a chunked stream. It reads the verified
  // GET /api/datasets/:id/get_content_as_text route and rejects truncated:true;
  // this store never calls a content endpoint directly. The 1 MiB cap and the
  // SHA-256 check below remain authoritative. If the adapter later exposes a
  // raw stream, this is the single place to switch to end-to-end streaming.
  async function downloadDataset(row, { verifyJob = true } = {}) {
    const live = await inspectDataset(row, { verifyJob });
    const reported = Number(live.size ?? row.bytes ?? 0);
    if (Number.isFinite(reported) && reported > MAX_UPLOAD_BYTES) {
      throw artifactError("oversize", "Galaxy dataset exceeds the artifact cap.", 413);
    }
    const result = await adapter.downloadArtifact({ artifact_id: row.galaxy_dataset_id }, ctx());
    if (result?.ok === false) throw fromProviderError(result.error);
    const content = typeof result?.content === "string" ? result.content : "";
    const encoded = new TextEncoder().encode(content);
    if (encoded.byteLength > MAX_UPLOAD_BYTES) {
      throw artifactError("oversize", "Galaxy dataset exceeds the artifact cap.", 413);
    }
    const hasher = new Sha256Stream();
    hasher.update(encoded);
    const sha256 = hasher.digestHex();
    if (row.sha256 && sha256 !== row.sha256) {
      throw artifactError("hash_mismatch", "Downloaded dataset hash does not match the registered hash.", 409, {
        expected: row.sha256, actual: sha256
      });
    }
    return { content, bytes: encoded.byteLength, sha256, artifact: live };
  }

  return {
    adapter, getById, getByDataset, getByGalaxyDataset, resolve, list,
    markDeleted, register, recordDownload, listDownloads,
    inspectDataset, uploadDataset, downloadDataset
  };
}
