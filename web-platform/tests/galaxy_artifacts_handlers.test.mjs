// M7.2 OFFLINE tests for the Galaxy artifact HTTP endpoints.
// Routing, consent gating, ownership, caps, hash checks, audit and error typing
// are exercised with injected D1 and fetch. No live provider call is made.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { createFetch, handlers } from "../worker.js";
import { PROVIDER_SQL } from "../functions/api/providers/_lib.js";
import {
  GALAXY_ARTIFACT_SQL, GALAXY_ARTIFACT_SQL_META, GALAXY_ARTIFACT_COLUMNS,
  MAX_UPLOAD_BYTES
} from "../storage/galaxy-artifacts.js";
import { Sha256Stream } from "../storage/sha256.js";

const FIXTURES = new URL("./fixtures/providers/galaxy/", import.meta.url);
const datasets = JSON.parse(readFileSync(new URL("m7_2_galaxy_artifacts_datasets.json", FIXTURES), "utf8"));
const errors = JSON.parse(readFileSync(new URL("m7_2_galaxy_artifacts_errors.json", FIXTURES), "utf8"));

const ORIGIN = "https://worker.example.test";
const DATASET_ID = "ds_0123456789abcdef";
const CONSENT_ID = "pcon_0123456789abcdef";
const ARTIFACT_ID = "art_0123456789abcdef";
const TOKEN = "unit-test-agent-token";
const TEST_KEY = "MOCK-KEY-DO-NOT-LEAK";
const encoder = new TextEncoder();
const CONTENT = datasets.content;
const CONTENT_BYTES = encoder.encode(CONTENT).byteLength;
const CONTENT_SHA = new Sha256Stream().update(encoder.encode(CONTENT)).digestHex();

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

const META = {
  ...GALAXY_ARTIFACT_SQL_META,
  [PROVIDER_SQL.getConsentRecord]: { op: "select", table: "provider_consents", where: ["public_id"] },
  // The real UPDATE also checks granted = 1; the fake special-cases it in run().
  [PROVIDER_SQL.consumeConsent]: { op: "update", table: "provider_consents", where: ["public_id"], assignments: { granted: 0, used_at: 0 } }
};

function fakeD1(initial = {}) {
  const state = { tables: {}, calls: [] };
  for (const [table, rows] of Object.entries(initial)) {
    state.tables[table] = rows.map((row) => ({ ...row }));
  }
  const ensure = (table) => (state.tables[table] ??= []);
  const matches = (row, where, values) => where.every((column, index) => row[column] === values[index]);
  const db = {
    prepare(sql) {
      const meta = META[sql];
      if (!meta) throw new Error(`Unexpected SQL: ${sql}`);
      const statement = {
        sql,
        values: [],
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
    public_id: CONSENT_ID,
    dataset_id: DATASET_ID,
    provider: "galaxy",
    destination: "https://galaxy.example.invalid",
    scope_json: "{}",
    granted: 1,
    created_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
    used_at: null,
    ...overrides
  };
}

function artifactRow(overrides = {}) {
  return {
    public_id: ARTIFACT_ID,
    dataset_id: DATASET_ID,
    galaxy_dataset_id: datasets.input_dataset.id,
    job_id: datasets.job_id,
    history_id: datasets.history_id,
    filename: "artifact-input.fasta",
    ext: "fasta",
    direction: "input",
    sha256: CONTENT_SHA,
    bytes: CONTENT_BYTES,
    project_id: null,
    created_at: "2026-11-25T00:00:00.000Z",
    deleted_at: null,
    ...overrides
  };
}

function mockFetch(overrides = {}) {
  const calls = [];
  const fetchImpl = async (input, init = {}) => {
    const url = String(input);
    const method = init.method ?? "GET";
    calls.push({ url, method, body: init.body, headers: init.headers });
    if (overrides.dataset !== undefined && url.includes("/api/datasets/") && !url.endsWith("/content")) return overrides.dataset;
    if (overrides.content !== undefined && url.includes("/api/datasets/") && url.endsWith("/content")) return overrides.content;
    if (overrides.tool !== undefined && method === "POST" && url.endsWith("/api/tools")) return overrides.tool;
    if (method === "POST" && url.endsWith("/api/histories")) return json(datasets.history);
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
    AI_DB: db,
    AI_AGENT_TOKEN: TOKEN,
    GALAXY_ENABLED: "true", // test-only mock env; wrangler.toml is untouched
    GALAXY_BASE_URL: "https://galaxy.example.invalid",
    GALAXY_API_KEY: TEST_KEY,
    FETCH_IMPL: fetchImpl,
    ...extra
  };
}

function uploadRequest(headerOverrides = {}, body = CONTENT) {
  const headers = {
    "X-Dataset-Id": DATASET_ID,
    "X-Consent-Id": CONSENT_ID,
    "X-Filename": "artifact-input.fasta",
    "X-Input-Hash": CONTENT_SHA,
    "X-Size-Bytes": String(CONTENT_BYTES),
    ...headerOverrides
  };
  return new Request(`${ORIGIN}/api/providers/galaxy/upload`, {
    method: "POST", headers, body
  });
}

function getRequest(path, withToken = true) {
  const headers = withToken ? { "X-Agent-Token": TOKEN } : {};
  return new Request(`${ORIGIN}${path}`, { method: "GET", headers });
}

async function dispatch(request, env) {
  return createFetch()(request, env, {});
}

test("static Galaxy artifact routes reach their handlers before dynamic provider routes", async () => {
  const seen = [];
  const stubMap = {};
  for (const key of Object.keys(handlers)) {
    stubMap[key] = async (context) => {
      seen.push({ key, params: context.params });
      return new Response(JSON.stringify({ key, params: context.params }), {
        status: 200, headers: { "Content-Type": "application/json" }
      });
    };
  }
  const workerFetch = createFetch(stubMap);
  const samples = [
    ["/api/providers/galaxy/upload", "galaxyUpload", {}],
    ["/api/providers/galaxy/artifacts", "galaxyArtifacts", {}],
    [`/api/providers/galaxy/datasets/${ARTIFACT_ID}/metadata`, "galaxyDatasetMetadata", { id: ARTIFACT_ID }],
    [` /api/providers/galaxy/datasets/${DATASET_ID}/download`.trim(), "galaxyDatasetDownload", { id: DATASET_ID }]
  ];
  for (const [path, key, params] of samples) {
    const response = await workerFetch(new Request(`${ORIGIN}${path}`), {}, {});
    assert.equal(response.status, 200, path);
    assert.deepEqual(await response.json(), { key, params }, path);
  }
  assert.deepEqual(seen.map((entry) => entry.key), samples.map((sample) => sample[1]));
});

test("consent denial, expiry, provider/dataset mismatch and missing record block transmission", async () => {
  const cases = [
    [consentRow({ granted: 0 }), "consent_denied"],
    [consentRow({ expires_at: new Date(Date.now() - 1000).toISOString() }), "consent_expired"],
    [consentRow({ provider: "smartsbio" }), "consent_provider_mismatch"],
    [consentRow({ dataset_id: "ds_ffffffffffffffff" }), "consent_dataset_mismatch"],
    [consentRow({ used_at: "2026-11-25T00:00:00.000Z" }), "consent_spent"]
  ];
  for (const [row, expectedCode] of cases) {
    const { db, state } = fakeD1({ provider_consents: [row] });
    const { fetchImpl, calls } = mockFetch();
    const response = await dispatch(uploadRequest(), envFor(db, fetchImpl));
    assert.equal(response.status, 403, expectedCode);
    assert.equal(JSON.parse(await response.text()).error.length > 0, true);
    assert.equal(JSON.parse(response.headers.get("X-Error-Detail")).code, expectedCode);
    assert.equal(calls.length, 0, `${expectedCode} must not transmit bytes`);
    assert.equal(state.calls.some((call) => call.sql === PROVIDER_SQL.getConsentRecord), true);
  }

  const { db } = fakeD1();
  const { fetchImpl, calls } = mockFetch();
  const missing = await dispatch(uploadRequest(), envFor(db, fetchImpl));
  assert.equal(missing.status, 403);
  assert.equal(JSON.parse(missing.headers.get("X-Error-Detail")).code, "consent_not_found");
  assert.equal(calls.length, 0);
});

test("missing D1 and oversize requests fail before any provider call", async () => {
  const { fetchImpl, calls } = mockFetch();
  const noDb = await dispatch(uploadRequest(), envFor(undefined, fetchImpl));
  assert.equal(noDb.status, 503);
  assert.equal(JSON.parse(noDb.headers.get("X-Error-Detail")).code, "no_d1");
  assert.equal(calls.length, 0);

  const { db } = fakeD1({ provider_consents: [consentRow()] });
  const oversize = await dispatch(uploadRequest({
    "X-Size-Bytes": String(MAX_UPLOAD_BYTES + 1)
  }), envFor(db, fetchImpl));
  assert.equal(oversize.status, 413);
  assert.equal(JSON.parse(oversize.headers.get("X-Error-Detail")).code, "oversize");
  assert.equal(calls.length, 0);

  const badType = await dispatch(uploadRequest({ "X-Filename": "payload.exe" }), envFor(db, fetchImpl));
  assert.equal(badType.status, 400);
  assert.equal(JSON.parse(badType.headers.get("X-Error-Detail")).code, "invalid_filename");
});

test("declared hash mismatch is rejected before transmission", async () => {
  const { db } = fakeD1({ provider_consents: [consentRow()] });
  const { fetchImpl, calls } = mockFetch();
  const response = await dispatch(uploadRequest({ "X-Input-Hash": "0".repeat(64) }), envFor(db, fetchImpl));
  assert.equal(response.status, 400);
  assert.equal(JSON.parse(response.headers.get("X-Error-Detail")).code, "invalid_hash");
  assert.equal(calls.length, 0);
});

test("happy upload streams, hashes, persists metadata only and consumes consent", async () => {
  const { db, state } = fakeD1({ provider_consents: [consentRow()] });
  const { fetchImpl, calls } = mockFetch();
  const response = await dispatch(uploadRequest(), envFor(db, fetchImpl));

  assert.equal(response.status, 201);
  const serialized = await response.text();
  const body = JSON.parse(serialized);
  assert.equal(body.artifact.dataset_id, DATASET_ID);
  assert.equal(body.artifact.galaxy_dataset_id, datasets.upload_job.outputs[0].id);
  assert.equal(body.artifact.sha256, CONTENT_SHA);
  assert.equal(body.artifact.bytes, CONTENT_BYTES);
  assert.equal(response.headers.get("X-Artifact-Id"), body.artifact.id);

  const insert = state.calls.find((call) => call.sql === GALAXY_ARTIFACT_SQL.insertArtifact);
  assert.ok(insert);
  assert.equal(insert.values.length, GALAXY_ARTIFACT_COLUMNS.length);
  assert.doesNotMatch(JSON.stringify(state.calls), /ACGTACGT/);
  assert.doesNotMatch(serialized, /MOCK-KEY-DO-NOT-LEAK/);
  assert.doesNotMatch(serialized, /https:\/\/galaxy/);
  assert.equal(state.tables.provider_consents[0].granted, 0);
  assert.ok(state.tables.provider_consents[0].used_at);
  assert.ok(calls.some((call) => call.method === "POST" && call.url.endsWith("/api/tools")));
});

test("duplicate upload is rejected without a second transmission", async () => {
  const { db, state } = fakeD1({
    provider_consents: [consentRow(), consentRow({ public_id: "pcon_ffffffffffffffff" })],
    galaxy_artifacts: [artifactRow()]
  });
  const { fetchImpl, calls } = mockFetch();
  const response = await dispatch(uploadRequest({ "X-Consent-Id": "pcon_ffffffffffffffff" }), envFor(db, fetchImpl));
  assert.equal(response.status, 409);
  assert.equal(JSON.parse(response.headers.get("X-Error-Detail")).code, "duplicate_artifact");
  assert.equal(calls.length, 0);
  assert.equal(state.calls.filter((call) => call.sql === GALAXY_ARTIFACT_SQL.insertArtifact).length, 0);
});

test("provider 403 during upload is typed and never exposes the key", async () => {
  const { db } = fakeD1({ provider_consents: [consentRow()] });
  const { fetchImpl } = mockFetch({ tool: json(errors.account_activation_403, 403) });
  const response = await dispatch(uploadRequest(), envFor(db, fetchImpl));
  assert.equal(response.status, 403);
  assert.equal(JSON.parse(response.headers.get("X-Error-Detail")).code, "action_requires_account_activation");
  const text = await response.text();
  assert.doesNotMatch(text, /MOCK-KEY-DO-NOT-LEAK/);
  assert.doesNotMatch(text, /Action requires account activation/);
});

test("metadata endpoint requires the owner token and confirms live history", async () => {
  const { db } = fakeD1({ galaxy_artifacts: [artifactRow()] });
  const { fetchImpl } = mockFetch();
  const denied = await dispatch(getRequest(`/api/providers/galaxy/datasets/${ARTIFACT_ID}/metadata`, false), envFor(db, fetchImpl));
  assert.equal(denied.status, 401);

  const response = await dispatch(getRequest(`/api/providers/galaxy/datasets/${ARTIFACT_ID}/metadata`), envFor(db, fetchImpl));
  assert.equal(response.status, 200);
  const text = await response.text();
  const body = JSON.parse(text);
  assert.equal(body.artifact.id, ARTIFACT_ID);
  assert.equal(body.live.dataset_id, datasets.input_dataset.id);
  assert.equal(body.live.history_id, datasets.history_id);
  assert.doesNotMatch(text, /MOCK-KEY-DO-NOT-LEAK/);
});

test("metadata endpoint rejects history mismatch and missing records", async () => {
  const { db } = fakeD1({ galaxy_artifacts: [artifactRow({ history_id: "wrong-history" })] });
  const { fetchImpl } = mockFetch();
  const mismatch = await dispatch(getRequest(`/api/providers/galaxy/datasets/${ARTIFACT_ID}/metadata`), envFor(db, fetchImpl));
  assert.equal(mismatch.status, 409);
  assert.equal(JSON.parse(mismatch.headers.get("X-Error-Detail")).code, "history_mismatch");

  const empty = fakeD1();
  const missing = await dispatch(getRequest(`/api/providers/galaxy/datasets/${ARTIFACT_ID}/metadata`), envFor(empty.db, fetchImpl));
  assert.equal(missing.status, 404);
  assert.equal(JSON.parse(missing.headers.get("X-Error-Detail")).code, "artifact_not_found");
});

test("download streams the dataset body, records an audit row and leaks no key", async () => {
  const { db, state } = fakeD1({ galaxy_artifacts: [artifactRow()] });
  const { fetchImpl } = mockFetch();
  const response = await dispatch(getRequest(`/api/providers/galaxy/datasets/${ARTIFACT_ID}/download`), envFor(db, fetchImpl));
  assert.equal(response.status, 200);
  assert.equal(await response.text(), CONTENT);
  assert.equal(response.headers.get("X-Dataset-Sha256"), CONTENT_SHA);
  assert.equal(response.headers.get("X-Content-Type-Options"), "nosniff");
  assert.match(response.headers.get("Content-Disposition"), /attachment/);
  assert.equal(response.headers.has("X-API-Key"), false);

  const audits = state.tables.galaxy_artifact_downloads ?? [];
  assert.equal(audits.length, 1);
  assert.equal(audits[0].status, "ok");
  assert.equal(audits[0].actor, "owner");
  assert.equal(audits[0].bytes, CONTENT_BYTES);
  assert.equal(audits[0].sha256, CONTENT_SHA);
  assert.ok(audits[0].at);
  assert.doesNotMatch(JSON.stringify(state.calls), /MOCK-KEY-DO-NOT-LEAK/);
});

test("download requires ownership, verifies the hash and audits failures", async () => {
  const { db, state } = fakeD1({ galaxy_artifacts: [artifactRow({ sha256: "0".repeat(64) })] });
  const { fetchImpl } = mockFetch();
  const denied = await dispatch(getRequest(`/api/providers/galaxy/datasets/${ARTIFACT_ID}/download`, false), envFor(db, fetchImpl));
  assert.equal(denied.status, 401);

  const response = await dispatch(getRequest(`/api/providers/galaxy/datasets/${ARTIFACT_ID}/download`), envFor(db, fetchImpl));
  assert.equal(response.status, 409);
  assert.equal(JSON.parse(response.headers.get("X-Error-Detail")).code, "hash_mismatch");
  const audits = state.tables.galaxy_artifact_downloads ?? [];
  assert.equal(audits.length, 1);
  assert.equal(audits[0].status, "failed");
  assert.equal(JSON.parse(audits[0].detail_json).code, "hash_mismatch");
});

test("deleted/expired datasets propagate as typed 404/410 from the provider", async () => {
  const { db } = fakeD1({ galaxy_artifacts: [artifactRow()] });
  const gone = await dispatch(
    getRequest(`/api/providers/galaxy/datasets/${ARTIFACT_ID}/download`),
    envFor(db, mockFetch({ dataset: json(errors.dataset_expired_410, 410) }).fetchImpl)
  );
  assert.equal(gone.status, 410);
  assert.equal(JSON.parse(gone.headers.get("X-Error-Detail")).code, "dataset_expired");

  const purged = await dispatch(
    getRequest(`/api/providers/galaxy/datasets/${ARTIFACT_ID}/download`),
    envFor(db, mockFetch({ dataset: json(errors.dataset_deleted_404, 404) }).fetchImpl)
  );
  assert.equal(purged.status, 410);

  const missing = await dispatch(
    getRequest(`/api/providers/galaxy/datasets/${ARTIFACT_ID}/download`),
    envFor(db, mockFetch({ dataset: json(errors.not_found_404, 404) }).fetchImpl)
  );
  assert.equal(missing.status, 404);
});

test("artifact list is owner-only and metadata-only", async () => {
  const { db } = fakeD1({ galaxy_artifacts: [artifactRow()] });
  const { fetchImpl } = mockFetch();
  const denied = await dispatch(getRequest("/api/providers/galaxy/artifacts", false), envFor(db, fetchImpl));
  assert.equal(denied.status, 401);

  const response = await dispatch(getRequest("/api/providers/galaxy/artifacts"), envFor(db, fetchImpl));
  assert.equal(response.status, 200);
  const text = await response.text();
  const body = JSON.parse(text);
  assert.equal(body.count, 1);
  assert.equal(body.artifacts[0].id, ARTIFACT_ID);
  assert.equal(Object.hasOwn(body.artifacts[0], "content"), false);
  assert.equal(Object.hasOwn(body.artifacts[0], "api_key"), false);
  assert.doesNotMatch(text, /MOCK-KEY-DO-NOT-LEAK/);
  assert.doesNotMatch(text, /ACGTACGT/);
});
