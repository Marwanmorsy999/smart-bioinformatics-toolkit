// M7.1 artifact handler tests. Offline: injected fake bucket + fake D1, no R2
// binding and no network. Mirrors the fake pattern in r2_artifact_store.test.mjs
// and the migration-0007 fake in m7_validation_gaps.test.mjs.
import test from "node:test";
import assert from "node:assert/strict";

import { createArtifactStore, MAX_ARTIFACT_BYTES } from "../storage/r2.js";
import { PROVIDER_SQL } from "../functions/api/providers/_lib.js";
import { onRequest as downloadUrl } from "../functions/api/artifacts/[id]/download-url.js";
import { onRequest as content } from "../functions/api/artifacts/content.js";
import { onRequest as deleteArtifact } from "../functions/api/artifacts/delete.js";
import { onRequest as uploadUrl } from "../functions/api/artifacts/upload-url.js";

const ART = "art_0123456789abcdef";
const DATASET = "ds_0123456789abcdef";
const OTHER = "ds_ffffffffffffffff";
const CONSENT = "pcon_2222222222222222";
const OTHER_CONSENT = "pcon_3333333333333333";
const OLD_CONSENT = "pcon_4444444444444444";
const OBJECT_KEY = `datasets/${DATASET}/stored-hash/sample.fasta`;
const FUTURE = new Date(Date.now() + 3600_000).toISOString();
const PAST = new Date(Date.now() - 60_000).toISOString();

function fakeBucket() {
  const objects = new Map();
  return {
    objects,
    async put(key, body) {
      if (body && typeof body.getReader === "function") {
        const chunks = [];
        const reader = body.getReader();
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          chunks.push(value);
        }
        objects.set(key, Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))));
      } else {
        // Tests seed objects directly as bytes; R2 accepts streams in production.
        objects.set(key, Buffer.from(body));
      }
    },
    async get(key) {
      const value = objects.get(key);
      if (!value) return null;
      return {
        body: new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(value)); controller.close(); } }),
        size: value.length,
        httpMetadata: { contentType: "text/plain" },
        customMetadata: { sha256: "stored-hash" }
      };
    },
    async delete(key) { objects.delete(key); }
  };
}

function createDb(seed = {}) {
  const state = {
    artifacts: new Map([[ART, {
      public_id: ART, dataset_id: DATASET, object_key: OBJECT_KEY, filename: "sample.fasta",
      mime: "text/plain", sha256: "stored-hash", bytes: 8, status: "stored",
      created_at: new Date(Date.now() - 2000).toISOString(), deleted_at: null
    }]]),
    consents: new Map([
      [CONSENT, { public_id: CONSENT, dataset_id: DATASET, granted: 1, expires_at: FUTURE }],
      [OTHER_CONSENT, { public_id: OTHER_CONSENT, dataset_id: OTHER, granted: 1, expires_at: FUTURE }],
      [OLD_CONSENT, { public_id: OLD_CONSENT, dataset_id: DATASET, granted: 1, expires_at: PAST }]
    ])
  };
  const db = {
    prepare(sql) {
      const stmt = {
        values: [],
        bind(...values) { stmt.values = values; return stmt; },
        async run() {
          if (sql === PROVIDER_SQL.markArtifactDeleted) {
            const row = state.artifacts.get(stmt.values[2]);
            if (row) { row.status = stmt.values[0]; row.deleted_at = stmt.values[1]; }
            return { success: true, meta: { changes: row ? 1 : 0 } };
          }
          throw new Error(`Unexpected run SQL: ${sql}`);
        },
        async all() {
          if (sql === PROVIDER_SQL.getArtifactRecord) {
            const row = state.artifacts.get(stmt.values[0]);
            return { success: true, results: row ? [{ ...row }] : [] };
          }
          if (sql === PROVIDER_SQL.getConsentRecord) {
            const row = state.consents.get(stmt.values[0]);
            return { success: true, results: row ? [{ ...row }] : [] };
          }
          throw new Error(`Unexpected all SQL: ${sql}`);
        }
      };
      return stmt;
    }
  };
  return { db, state };
}

// Pages supplies route params; provide them explicitly in this offline harness.
function callDownloadUrl(context) {
  return downloadUrl({ ...context, params: { id: ART } });
}

function envFor(db, bucket) {
  return {
    AI_DB: db,
    AI_AGENT_TOKEN: "m7-1-test-token",
    ARTIFACTS: bucket,
    ARTIFACT_SIGNING_KEY: "m7-1-unit-test-signing-key-not-a-real-secret"
  };
}
function get(path, headers = {}) {
  return new Request(`https://m7-1.example.test${path}`, { method: "GET", headers });
}
function post(path, payload, headers = {}) {
  return new Request(`https://m7-1.example.test${path}`, {
    method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(payload)
  });
}
function ticketFrom(url) {
  return new URL(`https://m7-1.example.test${url}`).searchParams.get("ticket");
}

test("download-url allows an owner token or a valid unexpired consent for the same dataset", async () => {
  const bucket = fakeBucket();
  await bucket.put(OBJECT_KEY, new TextEncoder().encode("ACGTACGT"));
  const { db } = createDb();
  const env = envFor(db, bucket);

  const byOwner = await callDownloadUrl({ request: get(`/api/artifacts/${ART}/download-url`, { "X-Agent-Token": env.AI_AGENT_TOKEN }), env });
  assert.equal(byOwner.status, 200);
  const ownerBody = await byOwner.json();
  assert.ok(ownerBody.download_url.startsWith("/api/artifacts/content?ticket="));

  const byConsent = await callDownloadUrl({ request: get(`/api/artifacts/${ART}/download-url?consent_id=${CONSENT}`), env });
  assert.equal(byConsent.status, 200);
  const consentBody = await byConsent.json();
  assert.ok(consentBody.download_url.includes("ticket="));
});

test("download-url denies a consent for another dataset, an expired consent and anonymous callers", async () => {
  const bucket = fakeBucket();
  const { db } = createDb();
  const env = envFor(db, bucket);
  for (const query of [`?consent_id=${OTHER_CONSENT}`, `?consent_id=${OLD_CONSENT}`, ""]) {
    const response = await callDownloadUrl({ request: get(`/api/artifacts/${ART}/download-url${query}`), env });
    assert.equal(response.status, 403, `expected denial for ${query || "anonymous"}`);
  }
  // A syntactically invalid id is refused even if a token is present but wrong.
  const wrongToken = await callDownloadUrl({
    request: get(`/api/artifacts/${ART}/download-url`, { "X-Agent-Token": "not-the-token" }), env
  });
  assert.equal(wrongToken.status, 403);
});

test("content rejects expired, tampered and wrong-operation tickets", async () => {
  const bucket = fakeBucket();
  await bucket.put(OBJECT_KEY, new TextEncoder().encode("ACGTACGT"));
  const { db } = createDb();
  const env = envFor(db, bucket);
  const store = createArtifactStore(env);

  const issued = await store.createDownloadTicket({
    dataset_id: DATASET, object_key: OBJECT_KEY, filename: "sample.fasta", mime: "text/plain", bytes: 8, ttl_seconds: 300
  });
  const token = ticketFrom(issued.download_url);
  const good = await content({ request: get(`/api/artifacts/content?ticket=${encodeURIComponent(token)}`), env });
  assert.equal(good.status, 200);
  assert.equal(await good.text(), "ACGTACGT");
  assert.equal(good.headers.get("X-Artifact-SHA256"), "stored-hash");

  const tampered = await content({ request: get(`/api/artifacts/content?ticket=${encodeURIComponent(token.slice(0, -2) + "xx")}`), env });
  assert.equal(tampered.status, 403);

  const expiredToken = await store.sign({ op: "download", object_key: OBJECT_KEY, mime: "text/plain", filename: "sample.fasta", exp: Date.now() - 1000 });
  const expired = await content({ request: get(`/api/artifacts/content?ticket=${encodeURIComponent(expiredToken)}`), env });
  assert.equal(expired.status, 403);

  const upload = await store.createUploadTicket({
    dataset_id: DATASET, filename: "sample.fasta", size_bytes: 8, sha256: "a".repeat(64)
  });
  const wrongOpToken = ticketFrom(upload.upload_url);
  const wrongOp = await content({ request: get(`/api/artifacts/content?ticket=${encodeURIComponent(wrongOpToken)}`), env });
  assert.equal(wrongOp.status, 403, "an upload ticket must not authorize a download");
});

test("deletion marks the artifact deleted and blocks further downloads", async () => {
  const bucket = fakeBucket();
  await bucket.put(OBJECT_KEY, new TextEncoder().encode("ACGTACGT"));
  const { db, state } = createDb();
  const env = envFor(db, bucket);
  const store = createArtifactStore(env);
  const ticket = await store.createDeleteTicket({ artifact_id: ART, object_key: OBJECT_KEY });
  const deleted = await deleteArtifact({
    request: post(`/api/artifacts/delete?ticket=${encodeURIComponent(ticketFrom(ticket.delete_url))}`, {}, {
      "X-Agent-Token": env.AI_AGENT_TOKEN
    }),
    env
  });
  assert.equal(deleted.status, 200);
  const row = state.artifacts.get(ART);
  assert.equal(row.status, "deleted");
  assert.ok(row.deleted_at);
  assert.equal(bucket.objects.has(OBJECT_KEY), false, "the private object must be removed");

  const after = await callDownloadUrl({
    request: get(`/api/artifacts/${ART}/download-url`, { "X-Agent-Token": env.AI_AGENT_TOKEN }), env
  });
  assert.equal(after.status, 404, "a deleted artifact must not yield a download ticket");
});

test("upload-url rejects invalid filenames and oversized uploads", async () => {
  const bucket = fakeBucket();
  const { db } = createDb();
  const env = envFor(db, bucket);
  const valid = { dataset_id: DATASET, filename: "sample.fasta", size_bytes: 8, sha256: "a".repeat(64) };

  const badName = await uploadUrl({ request: post("/api/artifacts/upload-url", { ...valid, filename: "payload.exe" }), env });
  assert.equal(badName.status, 400);
  const oversized = await uploadUrl({
    request: post("/api/artifacts/upload-url", { ...valid, size_bytes: MAX_ARTIFACT_BYTES + 1 }), env
  });
  assert.equal(oversized.status, 400);
  const invalidDataset = await uploadUrl({
    request: post("/api/artifacts/upload-url", { ...valid, dataset_id: "not-a-public-id" }), env
  });
  assert.equal(invalidDataset.status, 400);

  const accepted = await uploadUrl({ request: post("/api/artifacts/upload-url", valid), env });
  assert.equal(accepted.status, 201);
});
