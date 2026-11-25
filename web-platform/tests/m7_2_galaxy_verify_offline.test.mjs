// M7.2 INDEPENDENT OFFLINE VERIFICATION (tester agent).
// Re-verifies the required Galaxy-history artifact security behaviors against
// the real handlers/storage with injected D1 and fetch. No live network, no
// credentials, no provider execution. Everything here is canned fixtures only.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { createFetch } from "../worker.js";
import { PROVIDER_SQL } from "../functions/api/providers/_lib.js";
import {
  GALAXY_ARTIFACT_SQL, GALAXY_ARTIFACT_SQL_META, GALAXY_ARTIFACT_COLUMNS,
  GALAXY_DOWNLOAD_COLUMNS, MAX_UPLOAD_BYTES, createGalaxyArtifactStore
} from "../storage/galaxy-artifacts.js";
import { Sha256Stream } from "../storage/sha256.js";

const FIXTURES = new URL("./fixtures/providers/galaxy/", import.meta.url);
const datasets = JSON.parse(readFileSync(new URL("m7_2_galaxy_artifacts_datasets.json", FIXTURES), "utf8"));
const errors = JSON.parse(readFileSync(new URL("m7_2_galaxy_artifacts_errors.json", FIXTURES), "utf8"));

const ORIGIN = "https://worker.example.test";
const DATASET_ID = "ds_0123456789abcdef";
const CONSENT_ID = "pcon_0123456789abcdef";
const ARTIFACT_ID = "art_0123456789abcdef";
const TOKEN = "verify-agent-token";
const FAKE_KEY = "FAKE-KEY-DO-NOT-LEAK";
const encoder = new TextEncoder();
const CONTENT = datasets.content;                       // ">seq1\nACGTACGT\n"
const CONTENT_BYTES = encoder.encode(CONTENT).byteLength;
const CONTENT_SHA = new Sha256Stream().update(encoder.encode(CONTENT)).digestHex();
const HISTORY = datasets.history_id;                    // "m7-2-artifact-history"
const JOB = datasets.job_id;                            // "m7-2-artifact-job"
const GDS = datasets.input_dataset.id;                  // "m7-2-artifact-upload-ds"

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}
function codeOf(response) {
  const raw = response.headers.get("X-Error-Detail");
  return raw ? JSON.parse(raw).code : null;
}

// Purpose-built fake D1 keyed off the exported SQL metadata. Records every
// statement so tests can prove D1 holds metadata only (no file bytes).
const META = {
  ...GALAXY_ARTIFACT_SQL_META,
  [PROVIDER_SQL.getConsentRecord]: { op: "select", table: "provider_consents", where: ["public_id"] },
  [PROVIDER_SQL.consumeConsent]: { op: "update", table: "provider_consents", where: ["public_id"], assignments: { granted: 0, used_at: 0 } }
};
function fakeD1(initial = {}) {
  const state = { tables: {}, calls: [] };
  for (const [table, rows] of Object.entries(initial)) state.tables[table] = rows.map((row) => ({ ...row }));
  const ensure = (table) => (state.tables[table] ??= []);
  const matches = (row, where, values) => where.every((column, index) => row[column] === values[index]);
  const db = {
    prepare(sql) {
      const meta = META[sql];
      if (!meta) throw new Error(`Unexpected SQL: ${sql}`);
      const statement = {
        sql, values: [],
        bind(...values) { statement.values = values; return statement; },
        async run() {
          state.calls.push({ sql, kind: "run", values: [...statement.values] });
          if (sql === PROVIDER_SQL.consumeConsent) {
            const [usedAt, publicId] = statement.values;
            const row = ensure("provider_consents").find((item) => item.public_id === publicId && Number(item.granted) === 1);
            if (row) { row.granted = 0; row.used_at = usedAt; }
            return { success: true, meta: { changes: row ? 1 : 0 } };
          }
          const rows = ensure(meta.table);
          if (meta.op === "insert") {
            const row = {};
            meta.columns.forEach((column, index) => { row[column] = statement.values[index] ?? null; });
            rows.push(row);
            return { success: true, meta: { changes: 1 } };
          }
          if (meta.op === "update") {
            const whereValues = statement.values.slice(-meta.where.length);
            let changes = 0;
            for (const row of rows.filter((item) => matches(item, meta.where, whereValues))) {
              for (const [column, index] of Object.entries(meta.assignments)) row[column] = statement.values[index];
              changes += 1;
            }
            return { success: true, meta: { changes } };
          }
          throw new Error(`Unexpected run SQL: ${sql}`);
        },
        async all() {
          state.calls.push({ sql, kind: "all", values: [...statement.values] });
          if (meta.op !== "select") throw new Error(`Unexpected all SQL: ${sql}`);
          let rows = ensure(meta.table).filter((row) => matches(row, meta.where, statement.values));
          if (/deleted_at IS NULL/.test(sql)) rows = rows.filter((row) => !row.deleted_at);
          if (meta.orderBy) rows = [...rows].sort((a, b) => String(a[meta.orderBy]).localeCompare(String(b[meta.orderBy])));
          if (meta.limit) rows = rows.slice(0, statement.values[statement.values.length - 1]);
          return { success: true, results: rows.map((row) => ({ ...row })) };
        }
      };
      return statement;
    }
  };
  return { db, state };
}

function consentRow(overrides = {}) {
  return {
    public_id: CONSENT_ID, dataset_id: DATASET_ID, provider: "galaxy",
    destination: "https://galaxy.example.invalid", scope_json: "{}", granted: 1,
    created_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
    used_at: null, ...overrides
  };
}
function artifactRow(overrides = {}) {
  return {
    public_id: ARTIFACT_ID, dataset_id: DATASET_ID, galaxy_dataset_id: GDS,
    job_id: JOB, history_id: HISTORY, filename: "artifact-input.fasta",
    ext: "fasta", direction: "input", sha256: CONTENT_SHA, bytes: CONTENT_BYTES,
    project_id: null, created_at: "2026-11-25T00:00:00.000Z", deleted_at: null,
    ...overrides
  };
}

// Canned Galaxy transport. `calls` must stay empty on every pre-flight denial.
function mockFetch(overrides = {}) {
  const calls = [];
  const fetchImpl = async (input, init = {}) => {
    const url = String(input);
    const method = init.method ?? "GET";
    calls.push({ url, method, headers: init.headers });
    if (overrides.dataset !== undefined && url.includes("/api/datasets/") && !url.endsWith("/content")) return overrides.dataset;
    if (overrides.content !== undefined && url.includes("/api/datasets/") && url.endsWith("/content")) return overrides.content;
    if (overrides.job !== undefined && url.includes("/api/jobs/")) return overrides.job;
    if (overrides.tool !== undefined && method === "POST" && (url.endsWith("/api/tools") || url.endsWith("/api/tools/fetch"))) return overrides.tool;
    if (method === "POST" && url.endsWith("/api/histories")) return json(datasets.history);
    // Verified uploads use POST /api/tools/fetch (multipart), not /api/tools.
    if (method === "POST" && url.endsWith("/api/tools/fetch")) return json(datasets.upload_job);
    if (method === "POST" && url.endsWith("/api/tools")) {
      const body = JSON.parse(init.body ?? "{}");
      return json(body.tool_id === "upload1" ? datasets.upload_job : datasets.tool_job);
    }
    if (url.includes("/api/histories/") && url.endsWith("/contents")) return json(datasets.contents);
    if (url.includes("/api/datasets/") && url.endsWith("/content")) return new Response(CONTENT);
    if (url.includes("/api/datasets/")) return json(datasets.input_dataset);
    if (url.includes("/api/jobs/")) return json(datasets.job);
    return json(errors.not_found_404, 404);
  };
  return { fetchImpl, calls };
}
function envFor(db, fetchImpl, extra = {}) {
  return {
    AI_DB: db, AI_AGENT_TOKEN: TOKEN,
    GALAXY_ENABLED: "true", // test-only mock flag; wrangler.toml stays false
    GALAXY_BASE_URL: "https://galaxy.example.invalid",
    GALAXY_API_KEY: FAKE_KEY, FETCH_IMPL: fetchImpl, ...extra
  };
}
function getRequest(path, withToken = true) {
  return new Request(`${ORIGIN}${path}`, {
    method: "GET", headers: withToken ? { "X-Agent-Token": TOKEN } : {}
  });
}
function uploadRequest(headerOverrides = {}, body = CONTENT) {
  return new Request(`${ORIGIN}/api/providers/galaxy/upload`, {
    method: "POST",
    headers: {
      "X-Dataset-Id": DATASET_ID, "X-Consent-Id": CONSENT_ID,
      "X-Filename": "artifact-input.fasta", "X-Input-Hash": CONTENT_SHA,
      "X-Size-Bytes": String(CONTENT_BYTES), ...headerOverrides
    },
    body
  });
}
const dispatch = (request, env) => createFetch()(request, env, {});

// 1. Owner-token denial on metadata, download and list.
test("verify: metadata, download and list deny requests without the owner token", async () => {
  const { db } = fakeD1({ galaxy_artifacts: [artifactRow()] });
  const { fetchImpl, calls } = mockFetch();
  const env = envFor(db, fetchImpl);
  for (const path of [
    `/api/providers/galaxy/datasets/${ARTIFACT_ID}/metadata`,
    `/api/providers/galaxy/datasets/${ARTIFACT_ID}/download`,
    "/api/providers/galaxy/artifacts"
  ]) {
    const denied = await dispatch(getRequest(path, false), env);
    assert.equal(denied.status, 401, `${path} must require owner token`);
    assert.match(JSON.parse(await denied.text()).error, /Unauthorized/, path);
  }
  assert.equal(calls.length, 0, "owner denial must not contact the provider");
});

// 2. Dataset/history mismatch rejection (dataset-level and job-level).
test("verify: dataset-history and job-history mismatches are rejected with typed 409", async () => {
  const liveOtherHistory = json({ ...datasets.input_dataset, history_id: "history-B" });
  const { db: db1 } = fakeD1({ galaxy_artifacts: [artifactRow({ history_id: "history-A" })] });
  const mismatchDataset = await dispatch(
    getRequest(`/api/providers/galaxy/datasets/${ARTIFACT_ID}/metadata`),
    envFor(db1, mockFetch({ dataset: liveOtherHistory }).fetchImpl)
  );
  assert.equal(mismatchDataset.status, 409);
  assert.equal(codeOf(mismatchDataset), "history_mismatch");

  const otherJob = json({ ...datasets.job, history_id: "history-B" });
  const { db: db2 } = fakeD1({ galaxy_artifacts: [artifactRow()] });
  const mismatchJob = await dispatch(
    getRequest(`/api/providers/galaxy/datasets/${ARTIFACT_ID}/metadata`),
    envFor(db2, mockFetch({ job: otherJob }).fetchImpl)
  );
  assert.equal(mismatchJob.status, 409);
  assert.equal(codeOf(mismatchJob), "history_mismatch");
});

// 3. Deleted / expired dataset typed errors (never a raw provider body).
test("verify: expired and purged datasets surface typed 410, missing stays 404", async () => {
  const cases = [
    [json(errors.dataset_expired_410, 410), 410, "dataset_expired"],
    [json(errors.dataset_deleted_404, 404), 410, "dataset_deleted"],
    [json(errors.not_found_404, 404), 404, "not_found"]
  ];
  for (const [datasetResponse, expectedStatus, expectedCode] of cases) {
    const { db } = fakeD1({ galaxy_artifacts: [artifactRow()] });
    const response = await dispatch(
      getRequest(`/api/providers/galaxy/datasets/${ARTIFACT_ID}/metadata`),
      envFor(db, mockFetch({ dataset: datasetResponse }).fetchImpl)
    );
    assert.equal(response.status, expectedStatus, expectedCode);
    assert.equal(codeOf(response), expectedCode);
    assert.doesNotMatch(await response.text(), /FAKE-KEY-DO-NOT-LEAK/);
  }
});

// 4. Download audit row (success) with no key/file bytes persisted.
test("verify: a successful download appends one owner audit row", async () => {
  const { db, state } = fakeD1({ galaxy_artifacts: [artifactRow()] });
  const response = await dispatch(
    getRequest(`/api/providers/galaxy/datasets/${ARTIFACT_ID}/download`),
    envFor(db, mockFetch().fetchImpl)
  );
  assert.equal(response.status, 200);
  assert.equal(await response.text(), CONTENT);
  assert.equal(response.headers.get("X-Dataset-Sha256"), CONTENT_SHA);
  const audits = state.tables.galaxy_artifact_downloads ?? [];
  assert.equal(audits.length, 1);
  assert.equal(audits[0].status, "ok");
  assert.equal(audits[0].actor, "owner");
  assert.equal(audits[0].bytes, CONTENT_BYTES);
  assert.equal(audits[0].sha256, CONTENT_SHA);
  assert.deepEqual(Object.keys(audits[0]).sort(), [...GALAXY_DOWNLOAD_COLUMNS].sort());
  assert.doesNotMatch(JSON.stringify(state.calls), /FAKE-KEY-DO-NOT-LEAK/);
});

// 5. Upload consent denial with zero provider fetches.
test("verify: denied/expired consent blocks upload before any provider fetch", async () => {
  const cases = [
    [consentRow({ granted: 0 }), "consent_denied"],
    [consentRow({ expires_at: new Date(Date.now() - 1000).toISOString() }), "consent_expired"],
    [consentRow({ dataset_id: "ds_ffffffffffffffff" }), "consent_dataset_mismatch"]
  ];
  for (const [row, expectedCode] of cases) {
    const { db } = fakeD1({ provider_consents: [row] });
    const { fetchImpl, calls } = mockFetch();
    const response = await dispatch(uploadRequest(), envFor(db, fetchImpl));
    assert.equal(response.status, 403, expectedCode);
    assert.equal(codeOf(response), expectedCode);
    assert.equal(calls.length, 0, `${expectedCode} must transmit zero bytes`);
  }
});

// 6. Oversized / hash-mismatch rejection before transmission.
test("verify: oversized and hash-mismatched uploads are rejected with zero provider fetch", async () => {
  const { db } = fakeD1({ provider_consents: [consentRow()] });
  const { fetchImpl, calls } = mockFetch();
  const env = envFor(db, fetchImpl);

  const oversize = await dispatch(uploadRequest({ "X-Size-Bytes": String(MAX_UPLOAD_BYTES + 1) }), env);
  assert.equal(oversize.status, 413);
  assert.equal(codeOf(oversize), "oversize");

  const badDeclaredHash = await dispatch(uploadRequest({ "X-Input-Hash": "0".repeat(64) }), env);
  assert.equal(badDeclaredHash.status, 400);
  assert.equal(codeOf(badDeclaredHash), "invalid_hash");

  // Declared hash is well-formed but does not match the actual streamed body.
  const bodyMismatch = await dispatch(uploadRequest({}, ">seq1\nTTTTTTTT\n"), env);
  assert.equal(bodyMismatch.status, 400);
  assert.equal(codeOf(bodyMismatch), "invalid_hash");
  assert.equal(calls.length, 0, "all rejections must precede provider transmission");
});

// 7. D1 rows contain no file bytes.
test("verify: D1 artifact rows are metadata-only (no byte/blob columns or content)", async () => {
  const { db, state } = fakeD1({ provider_consents: [consentRow()] });
  const response = await dispatch(uploadRequest(), envFor(db, mockFetch().fetchImpl));
  assert.equal(response.status, 201);
  const row = state.tables.galaxy_artifacts[0];
  assert.deepEqual(Object.keys(row).sort(), [...GALAXY_ARTIFACT_COLUMNS].sort());
  assert.doesNotMatch(JSON.stringify(row), /ACGTACGT/);
  assert.doesNotMatch(JSON.stringify(state.calls), /ACGTACGT/);
  assert.equal(Object.hasOwn(row, "content"), false);
  assert.equal(Object.hasOwn(row, "file_bytes"), false);
  const body = await response.json();
  assert.equal(Object.hasOwn(body.artifact, "content"), false);
  assert.equal(Object.hasOwn(body.artifact, "api_key"), false);
  assert.doesNotMatch(JSON.stringify(state.calls), /FAKE-KEY-DO-NOT-LEAK/);
});

// 8. R2 absence does not break module import or store construction.
test("verify: absent R2 binding does not break import or Galaxy store construction", async () => {
  const r2 = await import("../storage/r2.js");
  assert.equal(typeof r2.createArtifactStore, "function");
  // No ARTIFACTS binding and no signing key: importing is still safe.
  assert.throws(() => r2.createArtifactStore({}), /R2 binding missing/);

  const { db } = fakeD1({ galaxy_artifacts: [artifactRow()] });
  const envWithoutR2 = { GALAXY_ENABLED: "false", GALAXY_BASE_URL: "" }; // no ARTIFACTS, no key
  const store = createGalaxyArtifactStore(db, envWithoutR2, { fetch: () => { throw new Error("no network"); } });
  assert.equal(typeof store.downloadDataset, "function");
  const rows = await store.list(5);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].public_id, ARTIFACT_ID);
  assert.equal(Object.hasOwn(rows[0], "content"), false);
});
