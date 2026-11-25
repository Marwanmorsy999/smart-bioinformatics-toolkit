// M7.2 OFFLINE tests for the R2-free Galaxy artifact metadata store.
// All provider traffic is an injected mock fetch; no credential or live call.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  createGalaxyArtifactStore, GALAXY_ARTIFACT_SQL, GALAXY_ARTIFACT_SQL_META,
  GALAXY_ARTIFACT_COLUMNS, GALAXY_DOWNLOAD_COLUMNS, MAX_UPLOAD_BYTES,
  DIRECTIONS, isAllowedFilename, isSha256, sanitizeFilename, publicArtifact
} from "../storage/galaxy-artifacts.js";
import { Sha256Stream, hashStream } from "../storage/sha256.js";

const FIXTURES = new URL("./fixtures/providers/galaxy/", import.meta.url);
const datasets = JSON.parse(readFileSync(new URL("m7_2_galaxy_artifacts_datasets.json", FIXTURES), "utf8"));
const errors = JSON.parse(readFileSync(new URL("m7_2_galaxy_artifacts_errors.json", FIXTURES), "utf8"));

const encoder = new TextEncoder();
const CONTENT = datasets.content; // MOCK FASTA text, 15 bytes
const CONTENT_BYTES = encoder.encode(CONTENT).byteLength;
const CONTENT_SHA = new Sha256Stream().update(encoder.encode(CONTENT)).digestHex();
const TEST_KEY = "MOCK-KEY-DO-NOT-LEAK";

// MOCK fixture sanity: these files must remain labelled synthetic.
test("MOCK fixtures are labelled and carry no live credentials", () => {
  assert.equal(datasets.is_mock, true);
  assert.equal(errors.is_mock, true);
  assert.match(datasets.__fixture, /^MOCK/);
  assert.match(errors.__fixture, /^MOCK/);
  assert.equal(CONTENT_BYTES, 15);
});

function fakeD1(initial = {}) {
  const state = { tables: {}, calls: [] };
  for (const [table, rows] of Object.entries(initial)) {
    state.tables[table] = rows.map((row) => ({ ...row }));
  }
  const ensure = (table) => (state.tables[table] ??= []);
  const matches = (row, where, values) => where.every((column, index) => row[column] === values[index]);
  const db = {
    prepare(sql) {
      const meta = GALAXY_ARTIFACT_SQL_META[sql];
      if (!meta) throw new Error(`Unexpected galaxy artifact SQL: ${sql}`);
      const statement = {
        sql,
        values: [],
        bind(...values) { statement.values = values; return statement; },
        async run() {
          state.calls.push({ sql, kind: "run", values: [...statement.values] });
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
          throw new Error(`Unexpected galaxy artifact run SQL: ${sql}`);
        },
        async all() {
          state.calls.push({ sql, kind: "all", values: [...statement.values] });
          if (meta.op !== "select") throw new Error(`Unexpected galaxy artifact all SQL: ${sql}`);
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

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function mockFetch(overrides = {}) {
  const calls = [];
  const fetchImpl = async (input, init = {}) => {
    const url = String(input);
    const method = init.method ?? "GET";
    calls.push({ url, method, body: init.body, headers: init.headers });
    if (overrides.dataset !== undefined && url.includes("/api/datasets/") && !url.endsWith("/get_content_as_text")) return overrides.dataset;
    if (overrides.content !== undefined && url.includes("/api/datasets/") && url.endsWith("/get_content_as_text")) return overrides.content;
    if (overrides.tool !== undefined && method === "POST" && (url.endsWith("/api/tools") || url.endsWith("/api/tools/fetch"))) return overrides.tool;
    if (overrides.job !== undefined && url.includes("/api/jobs/")) return overrides.job;
    if (method === "POST" && url.endsWith("/api/histories")) return json(datasets.history);
    // Verified uploads use POST /api/tools/fetch (multipart), not /api/tools.
    if (method === "POST" && url.endsWith("/api/tools/fetch")) return json(datasets.upload_job);
    if (method === "POST" && url.endsWith("/api/tools")) {
      const body = JSON.parse(init.body ?? "{}");
      return json(body.tool_id === "upload1" ? datasets.upload_job : datasets.tool_job);
    }
    if (url.includes("/api/histories/") && url.endsWith("/contents")) return json(datasets.contents);
    if (url.includes("/api/datasets/") && url.endsWith("/get_content_as_text")) return json({ item_data: CONTENT, truncated: false });
    if (url.includes("/api/datasets/")) return json(datasets.input_dataset);
    if (url.includes("/api/jobs/")) return json(datasets.job);
    return json(errors.not_found_404, 404);
  };
  return { fetchImpl, calls };
}

function env(fetchImpl) {
  return {
    GALAXY_ENABLED: "true", // test-only mock env; wrangler.toml is untouched
    GALAXY_BASE_URL: "https://galaxy.example.invalid",
    GALAXY_API_KEY: TEST_KEY,
    FETCH_IMPL: fetchImpl
  };
}

function storeWith(db, fetchImpl) {
  return createGalaxyArtifactStore(db, env(fetchImpl), { fetch: fetchImpl });
}

function seedRef(overrides = {}) {
  return {
    dataset_id: "ds_0123456789abcdef",
    galaxy_dataset_id: datasets.input_dataset.id,
    job_id: datasets.job_id,
    history_id: datasets.history_id,
    filename: "artifact-input.fasta",
    ext: "fasta",
    direction: DIRECTIONS.INPUT,
    sha256: CONTENT_SHA,
    bytes: CONTENT_BYTES,
    ...overrides
  };
}

test("store requires a D1 binding and rejects it before any network call", () => {
  assert.throws(() => createGalaxyArtifactStore(null, env(async () => {})), (error) => (
    error.artifactError === true && error.code === "no_d1" && error.status === 503
  ));
});

test("register persists metadata columns only: no byte column and no file content in D1", async () => {
  const { db, state } = fakeD1();
  const store = storeWith(db, mockFetch().fetchImpl);
  const row = await store.register(seedRef());

  assert.equal(GALAXY_ARTIFACT_COLUMNS.some((column) => ["content", "body", "bytes_blob", "file"].includes(column)), false);
  assert.equal(GALAXY_DOWNLOAD_COLUMNS.some((column) => ["content", "body", "file"].includes(column)), false);
  assert.ok(!GALAXY_ARTIFACT_SQL.insertArtifact.includes("content"));

  const insert = state.calls.find((call) => call.sql === GALAXY_ARTIFACT_SQL.insertArtifact);
  assert.ok(insert);
  assert.equal(insert.values.length, GALAXY_ARTIFACT_COLUMNS.length);
  const serialized = JSON.stringify(state.calls);
  assert.doesNotMatch(serialized, /ACGTACGT/);
  assert.doesNotMatch(serialized, /MOCK-KEY-DO-NOT-LEAK/);
  assert.equal(row.sha256, CONTENT_SHA);
  assert.deepEqual(publicArtifact(row), {
    id: row.public_id, dataset_id: "ds_0123456789abcdef",
    galaxy_dataset_id: datasets.input_dataset.id, job_id: datasets.job_id,
    history_id: datasets.history_id, filename: "artifact-input.fasta", ext: "fasta",
    direction: "input", sha256: CONTENT_SHA, bytes: 15, project_id: null,
    created_at: row.created_at, deleted_at: null
  });
});

test("duplicate registration is rejected without a second insert", async () => {
  const { db, state } = fakeD1();
  const store = storeWith(db, mockFetch().fetchImpl);
  await store.register(seedRef());
  await assert.rejects(() => store.register(seedRef()), (error) => (
    error.artifactError === true && error.code === "duplicate_artifact" && error.status === 409
  ));
  const inserts = state.calls.filter((call) => call.sql === GALAXY_ARTIFACT_SQL.insertArtifact);
  assert.equal(inserts.length, 1);
});

test("streaming hash is chunk-boundary independent and enforced against the cap", async () => {
  const data = encoder.encode(datasets.content.repeat(3));
  const stream = new ReadableStream({
    start(controller) {
      for (let index = 0; index < data.length; index += 2) controller.enqueue(data.subarray(index, index + 2));
      controller.close();
    }
  });
  const hashed = await hashStream(stream);
  assert.equal(hashed.sha256, new Sha256Stream().update(data).digestHex());
  assert.equal(hashed.bytes, data.length);
  assert.ok(hashed.bytes < MAX_UPLOAD_BYTES);

  const oversized = new ReadableStream({
    start(controller) { controller.enqueue(new Uint8Array(MAX_UPLOAD_BYTES + 1)); controller.close(); }
  });
  let counted = 0;
  await assert.rejects(() => hashStream(oversized, (chunk) => {
    counted += chunk.byteLength;
    if (counted > MAX_UPLOAD_BYTES) throw new Error("oversize");
  }), /oversize/);
});

test("uploadDataset uses the adapter upload path, records ids and stores no bytes", async () => {
  const { db, state } = fakeD1();
  const { fetchImpl, calls } = mockFetch();
  const store = storeWith(db, fetchImpl);
  const row = await store.uploadDataset({
    dataset_id: "ds_0123456789abcdef", filename: "artifact-input.fasta", ext: "fasta",
    content: CONTENT, sha256: CONTENT_SHA, bytes: CONTENT_BYTES, project_id: "proj_0123456789abcdef"
  });

  assert.equal(row.galaxy_dataset_id, datasets.upload_job.outputs[0].id);
  assert.equal(row.history_id, datasets.history_id);
  // This `galaxy_` id regex intentionally replaces the old exact-value
  // assertion: /api/tools/fetch has no stable provider job id, so only the
  // adapter's generated local-id shape is assertable.
  assert.match(row.job_id, /^galaxy_[0-9a-f]+$/);
  assert.equal(row.direction, "input");
  assert.equal(row.project_id, "proj_0123456789abcdef");
  assert.ok(calls.some((call) => call.method === "POST" && call.url.endsWith("/api/tools/fetch")));
  assert.equal(calls.some((call) => call.url.endsWith("/api/upload")), false);
  const insert = state.calls.find((call) => call.sql === GALAXY_ARTIFACT_SQL.insertArtifact);
  assert.doesNotMatch(JSON.stringify(insert.values), /ACGTACGT/);
});

test("uploadDataset maps provider 403 to a typed error with a fixed message", async () => {
  const { db } = fakeD1();
  const { fetchImpl } = mockFetch({ tool: json(errors.account_activation_403, 403) });
  const store = storeWith(db, fetchImpl);
  await assert.rejects(() => store.uploadDataset({
    dataset_id: "ds_0123456789abcdef", filename: "artifact-input.fasta", ext: "fasta",
    content: CONTENT, sha256: CONTENT_SHA, bytes: CONTENT_BYTES
  }), (error) => (
    error.artifactError === true && error.status === 403
    && error.code === "action_requires_account_activation"
    && error.message === "Provider authorization denied."
    && !error.message.includes(TEST_KEY)
  ));
});

test("inspectDataset enforces history and job membership", async () => {
  const good = storeWith(fakeD1().db, mockFetch().fetchImpl);
  const goodRow = await good.register(seedRef());
  const live = await good.inspectDataset(goodRow);
  assert.equal(live.id, datasets.input_dataset.id);

  const { db } = fakeD1();
  const bad = storeWith(db, mockFetch().fetchImpl);
  const badRow = await bad.register(seedRef({ history_id: "wrong-history" }));
  await assert.rejects(() => bad.inspectDataset(badRow), (error) => (
    error.artifactError === true && error.code === "history_mismatch" && error.status === 409
  ));
});

test("inspectDataset fails closed when history is missing", async () => {
  const missing = { ...datasets.input_dataset };
  delete missing.history_id;
  const { db } = fakeD1();
  const store = storeWith(db, mockFetch({ dataset: json(missing) }).fetchImpl);
  const row = await store.register(seedRef());
  await assert.rejects(() => store.inspectDataset(row), (error) => (
    error.artifactError === true && error.code === "missing_history" && error.status === 502
  ));
});

test("downloadDataset verifies the recorded hash and caps the body", async () => {
  const { db } = fakeD1();
  const store = storeWith(db, mockFetch().fetchImpl);
  const row = await store.register(seedRef());
  const downloaded = await store.downloadDataset(row);
  assert.equal(downloaded.bytes, CONTENT_BYTES);
  assert.equal(downloaded.sha256, CONTENT_SHA);
  assert.equal(downloaded.content, CONTENT);

  const { db: otherDb } = fakeD1();
  const other = storeWith(otherDb, mockFetch().fetchImpl);
  const badRow = await other.register(seedRef({ sha256: "0".repeat(64) }));
  await assert.rejects(() => other.downloadDataset(badRow), (error) => (
    error.artifactError === true && error.code === "hash_mismatch" && error.status === 409
  ));
});

test("download audit records who, when, dataset, bytes, hash and status", async () => {
  const { db, state } = fakeD1();
  const store = storeWith(db, mockFetch().fetchImpl);
  const row = await store.register(seedRef());
  const ok = await store.recordDownload({
    artifact_id: row.public_id, dataset_id: row.dataset_id, actor: "owner",
    bytes: CONTENT_BYTES, sha256: CONTENT_SHA, status: "ok", detail: { code: "ok" }
  });
  const failed = await store.recordDownload({
    artifact_id: row.public_id, dataset_id: row.dataset_id, actor: "owner",
    status: "failed", detail: { code: "hash_mismatch" }
  });
  assert.equal(ok.status, "ok");
  assert.equal(failed.status, "failed");
  assert.ok(ok.at);
  const listed = await store.listDownloads(row.dataset_id);
  assert.equal(listed.length, 2);
  assert.equal(listed[0].bytes, CONTENT_BYTES);
  assert.equal(listed[0].sha256, CONTENT_SHA);
  assert.equal(listed[0].actor, "owner");
  assert.equal(GALAXY_DOWNLOAD_COLUMNS.includes("content"), false);
  assert.doesNotMatch(JSON.stringify(state.calls), /MOCK-KEY-DO-NOT-LEAK/);
});

test("register rejects sizes beyond the hard cap", async () => {
  const { db } = fakeD1();
  const store = storeWith(db, mockFetch().fetchImpl);
  await assert.rejects(() => store.register(seedRef({ bytes: MAX_UPLOAD_BYTES + 1 })), (error) => (
    error.artifactError === true && error.code === "oversize" && error.status === 413
  ));
});

test("filename helpers allow biological text and reject binaries", () => {
  assert.equal(sanitizeFilename("../../etc/passwd.fasta"), "passwd.fasta");
  assert.equal(isAllowedFilename("sample.fq.gz"), false, "binary containers are outside the text-only MVP");
  assert.equal(isAllowedFilename("sample.fasta"), true);
  assert.equal(isSha256(CONTENT_SHA), true);
  assert.equal(isSha256("nope"), false);
});
