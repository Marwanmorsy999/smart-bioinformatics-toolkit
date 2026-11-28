// M7.2-R2FREE OFFLINE / MOCK-only boundary verification for the R2-free Galaxy
// artifact architecture. NOT LIVE EXECUTION: every provider response is a canned
// MOCK value returned by an injected fetch; D1 is an injected in-memory fake;
// no credential, no real endpoint and no real job is involved.
import test from "node:test";
import assert from "node:assert/strict";

import {
  MAX_UPLOAD_BYTES, ALLOWED_EXTENSIONS, DIRECTIONS,
  GALAXY_ARTIFACT_SQL_META, artifactError, isArtifactError, isAllowedFilename,
  isSha256, sanitizeFilename, extensionOf, publicArtifact, createGalaxyArtifactStore
} from "../storage/galaxy-artifacts.js";
import { hashStream, Sha256Stream } from "../storage/sha256.js";
import {
  DS_ID_PATTERN, CONSENT_ID_PATTERN
} from "../functions/api/providers/galaxy-artifacts/_lib.js";
import { safeId } from "../providers/common/normalize.js";
import { createAdapter } from "../providers/galaxy/index.js";
import { readJsonBody, MAX_REQUEST_BODY_CHARS } from "../functions/api/ai/_lib.js";
import {
  createArtifactStore, sanitizeFilename as legacySanitize,
  isAllowedFilename as legacyAllowed, MAX_ARTIFACT_BYTES
} from "../storage/r2.js";

const DATASET = "ds_a111111111111111";
const GALAXY_DATASET = "m7-2-mock-dataset-output";
const HISTORY = "m7-2-mock-history";
const JOB = "m7-2-mock-job";
const CONTENT = "M7.2 MOCK OUTPUT BYTES - NOT A SCIENTIFIC RESULT\n";
const SECRET = "MOCK-KEY-DO-NOT-LEAK-77bd41c0";

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}
const sha256 = (text) => new Sha256Stream().update(new TextEncoder().encode(text)).digestHex();

// Minimal MOCK D1 driven by the production SQL metadata exported by the store.
function createGalaxyFakeD1(seed = {}) {
  const state = {
    tables: {
      galaxy_artifacts: (seed.artifacts ?? []).map((row) => ({ ...row })),
      galaxy_artifact_downloads: (seed.downloads ?? []).map((row) => ({ ...row }))
    },
    calls: []
  };
  const db = {
    prepare(sql) {
      const meta = GALAXY_ARTIFACT_SQL_META[sql];
      if (!meta) throw new Error(`Unexpected MOCK SQL: ${sql}`);
      const stmt = {
        values: [],
        bind(...values) { stmt.values = values; return stmt; },
        async run() {
          state.calls.push({ sql, values: [...stmt.values] });
          if (meta.op === "insert") {
            const row = {};
            meta.columns.forEach((column, index) => { row[column] = stmt.values[index] ?? null; });
            state.tables[meta.table].push(row);
            return { success: true, meta: { changes: 1 } };
          }
          if (meta.op === "update") {
            const whereValues = stmt.values.slice(-meta.where.length);
            let changes = 0;
            for (const row of state.tables[meta.table]) {
              if (meta.where.every((column, index) => row[column] === whereValues[index])) {
                for (const [column, index] of Object.entries(meta.assignments)) row[column] = stmt.values[index];
                changes += 1;
              }
            }
            return { success: true, meta: { changes } };
          }
          throw new Error(`Unexpected MOCK run op: ${meta.op}`);
        },
        async all() {
          state.calls.push({ sql, values: [...stmt.values] });
          if (meta.op !== "select") throw new Error(`Unexpected MOCK all op: ${meta.op}`);
          let rows = state.tables[meta.table].filter(
            (row) => meta.where.every((column, index) => row[column] === stmt.values[index])
          );
          if (meta.orderBy) rows = [...rows].sort((a, b) => String(a[meta.orderBy]).localeCompare(String(b[meta.orderBy])));
          if (meta.limit) rows = rows.slice(0, stmt.values[stmt.values.length - 1]);
          return { success: true, results: rows.map((row) => ({ ...row })) };
        }
      };
      return stmt;
    }
  };
  return { db, state };
}

function registered(overrides = {}) {
  return {
    public_id: "art_a111111111111111", dataset_id: DATASET,
    galaxy_dataset_id: GALAXY_DATASET, job_id: JOB, history_id: HISTORY,
    filename: "out.txt", ext: "txt", direction: DIRECTIONS.OUTPUT,
    sha256: sha256(CONTENT), bytes: new TextEncoder().encode(CONTENT).byteLength,
    project_id: null, created_at: new Date().toISOString(), deleted_at: null,
    ...overrides
  };
}

// Canned MOCK Galaxy responses used only by the store's adapter seam.
function mockGalaxy(calls, {
  status = 200, errorBody = { error: "not_found" },
  dataset = {}, job = {}
} = {}) {
  return async (input, init = {}) => {
    const url = String(input);
    calls.push({ url, method: init.method ?? "GET" });
    if (url.endsWith("/get_content_as_text")) {
      if (status !== 200) return json(errorBody, status);
      return json({ item_data: CONTENT, truncated: false });
    }
    if (url.includes("/api/jobs/")) {
      return json({ id: JOB, state: "ok", history_id: HISTORY, ...job });
    }
    if (url.includes("/api/datasets/")) {
      if (status !== 200) return json(errorBody, status);
      return json({
        id: GALAXY_DATASET, name: "out.txt", state: "ok", deleted: false,
        history_id: HISTORY, file_size: new TextEncoder().encode(CONTENT).byteLength,
        ...dataset
      });
    }
    return json({}, 404);
  };
}

function makeStore(db, fetchImpl) {
  return createGalaxyArtifactStore(db, {
    GALAXY_ENABLED: "true",
    GALAXY_BASE_URL: "https://m7-2-boundaries.invalid",
    GALAXY_API_KEY: SECRET
  }, { fetch: fetchImpl, sleep: async () => {}, timeoutMs: 1000 });
}

test("OFFLINE/MOCK Worker request-size caps: 128 KiB JSON body and 1 MiB artifact body", async () => {
  assert.equal(MAX_UPLOAD_BYTES, 1024 * 1024);
  assert.equal(MAX_REQUEST_BODY_CHARS, 128 * 1024);
  assert.equal(MAX_ARTIFACT_BYTES, 64 * 1024 * 1024);

  const hugeBody = "x".repeat(MAX_REQUEST_BODY_CHARS + 1);
  const oversized = await readJsonBody(new Request("https://m7-2-boundaries.invalid/x", {
    method: "POST", body: hugeBody
  }));
  assert.equal(oversized.payload, null);
  assert.match(oversized.error, /Request body is too large/);

  const { db } = createGalaxyFakeD1();
  const store = makeStore(db, mockGalaxy([]));
  await assert.rejects(
    () => store.register({ dataset_id: DATASET, direction: DIRECTIONS.INPUT, bytes: MAX_UPLOAD_BYTES + 1 }),
    (error) => isArtifactError(error) && error.code === "oversize" && error.status === 413
  );
});

test("OFFLINE/MOCK allowed biological extensions are a strict allow-list", async () => {
  for (const ext of ["fa", "fasta", "fna", "faa", "fastq", "fq", "tsv", "csv", "txt", "vcf", "bed", "gff", "gtf", "json", "sam"]) {
    assert.equal(ALLOWED_EXTENSIONS.has(ext), true, `${ext} must be allowed`);
    assert.equal(isAllowedFilename(`sample.${ext}`), true);
  }
  for (const name of ["sample.exe", "sample.bam", "sample.cram", "sample.zip", "sample.gz", "sample", "sample.PDF"]) {
    assert.equal(isAllowedFilename(name), false, `${name} must be rejected`);
  }
  // The legacy R2 tier keeps its own (different) allow-list; it is not used here.
  assert.equal(legacyAllowed("sample.fq.gz"), true);
  assert.equal(legacyAllowed("sample.exe"), false);
});

test("OFFLINE/MOCK filenames are sanitized before registration and exposure", async () => {
  assert.equal(sanitizeFilename("../../etc/passwd"), "passwd");
  assert.equal(sanitizeFilename("C:\\tmp\\my sample.fasta"), "my_sample.fasta");
  assert.equal(sanitizeFilename("bad\r\nname.txt"), "bad__name.txt");
  assert.equal(sanitizeFilename(""), "upload.txt");
  assert.equal(sanitizeFilename("x".repeat(500)).length, 200);
  assert.equal(extensionOf("sample.FASTA"), "fasta");
  assert.equal(legacySanitize("../../etc/passwd"), "passwd");

  const { db } = createGalaxyFakeD1();
  const store = makeStore(db, mockGalaxy([]));
  const row = await store.register({
    dataset_id: DATASET, direction: DIRECTIONS.INPUT, filename: "C:\\tmp\\my sample.fasta",
    bytes: 4, sha256: sha256("ACGT")
  });
  assert.equal(row.filename, "my_sample.fasta");
  const dto = publicArtifact(db ? row : {});
  assert.equal(dto.filename, "my_sample.fasta");
  assert.equal(Object.values(dto).some((value) => typeof value === "string" && value.includes(SECRET)), false);
});

test("OFFLINE/MOCK dataset id / history id format validation rejects traversal and whitespace", async () => {
  assert.equal(DS_ID_PATTERN.test(DATASET), true);
  assert.equal(DS_ID_PATTERN.test("ds_../etc"), false);
  assert.equal(DS_ID_PATTERN.test("ds_ABCDEF0123456789"), false, "ids are lowercase hex");
  assert.equal(CONSENT_ID_PATTERN.test("pcon_a111111111111111"), true);
  assert.equal(CONSENT_ID_PATTERN.test("req_a111111111111111"), false, "Galaxy artifact upload needs pcon_");

  assert.equal(safeId("../../etc"), "");
  assert.equal(safeId("abc def"), "");
  assert.equal(safeId("abc/def"), "");
  assert.equal(safeId("abc/def", { allowSlash: true }), "abc/def", "ToolShed ids may contain '/' in a body");

  const adapter = createAdapter({
    GALAXY_ENABLED: "true", GALAXY_BASE_URL: "https://m7-2-boundaries.invalid", GALAXY_API_KEY: SECRET
  });
  assert.equal(adapter.validateRequest("get_artifacts", { history_id: "bad id" }).error, "malformed_history_id");
  assert.equal(adapter.validateRequest("download_artifact", { dataset_id: "../etc" }).error, "malformed_dataset_id");
  assert.equal(adapter.validateRequest("get_artifacts", { history_id: HISTORY }).valid, true);
  assert.equal(adapter.validateRequest("get_artifacts", { dataset_id: GALAXY_DATASET }).valid, true);
});

test("OFFLINE/MOCK download audit rows are created with a non-secret actor and verified hash", async () => {
  const { db, state } = createGalaxyFakeD1({ artifacts: [registered()] });
  const store = makeStore(db, mockGalaxy([]));
  const entry = await store.recordDownload({
    artifact_id: "art_a111111111111111", dataset_id: DATASET, actor: "owner",
    bytes: new TextEncoder().encode(CONTENT).byteLength, sha256: sha256(CONTENT),
    status: "ok", detail: { code: "ok", status: 200 }
  });
  assert.equal(entry.public_id.startsWith("gad_"), true);
  assert.equal(state.tables.galaxy_artifact_downloads.length, 1);
  const [row] = state.tables.galaxy_artifact_downloads;
  assert.equal(row.actor, "owner");
  assert.equal(row.status, "ok");
  assert.equal(row.sha256, sha256(CONTENT));
  assert.equal(JSON.stringify(row).includes(SECRET), false);
  const listed = await store.listDownloads(DATASET);
  assert.equal(listed.length, 1);
  assert.equal(listed[0].artifact_id, "art_a111111111111111");
  // No byte column exists in the registration table: D1 is metadata-only.
  assert.equal(Object.keys(state.tables.galaxy_artifacts[0]).some((key) => /content|bytes?_data|blob/i.test(key)), false);
});

test("OFFLINE/MOCK SHA-256 verification of streamed Galaxy output bytes", async () => {
  const bytes = new TextEncoder().encode("ACGT".repeat(1000));
  const stream = new ReadableStream({
    start(controller) {
      for (let offset = 0; offset < bytes.byteLength; offset += 7) {
        controller.enqueue(bytes.subarray(offset, offset + 7));
      }
      controller.close();
    }
  });
  const hashed = await hashStream(stream);
  assert.equal(hashed.sha256, sha256("ACGT".repeat(1000)));
  assert.equal(hashed.bytes, bytes.byteLength);

  const { db } = createGalaxyFakeD1({ artifacts: [registered()] });
  const calls = [];
  const ok = await makeStore(db, mockGalaxy(calls)).downloadDataset(registered());
  assert.equal(ok.content, CONTENT);
  assert.equal(ok.sha256, sha256(CONTENT));
  assert.equal(calls.filter((entry) => entry.url.endsWith("/get_content_as_text")).length, 1);

  const { db: badDb } = createGalaxyFakeD1({
    artifacts: [registered({ sha256: "0".repeat(64) })]
  });
  await assert.rejects(
    () => makeStore(badDb, mockGalaxy([])).downloadDataset(registered({ sha256: "0".repeat(64) })),
    (error) => isArtifactError(error) && error.code === "hash_mismatch" && error.status === 409
  );
});

test("OFFLINE/MOCK deleted/expired provider response maps to typed 410, oversize map to 413", async () => {
  const { db } = createGalaxyFakeD1({ artifacts: [registered()] });
  await assert.rejects(
    () => makeStore(db, mockGalaxy([], { status: 404, errorBody: { error: "deleted" } }))
      .downloadDataset(registered()),
    (error) => isArtifactError(error) && error.status === 410
  );

  const oversized = registered({
    sha256: sha256(CONTENT), bytes: MAX_UPLOAD_BYTES + 1
  });
  const { db: bigDb } = createGalaxyFakeD1({ artifacts: [oversized] });
  await assert.rejects(
    () => makeStore(bigDb, mockGalaxy([], {
      dataset: { file_size: MAX_UPLOAD_BYTES + 1 }
    })).downloadDataset(oversized),
    (error) => isArtifactError(error) && error.code === "oversize" && error.status === 413
  );
});
