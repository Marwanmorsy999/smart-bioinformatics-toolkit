import test from "node:test";
import assert from "node:assert/strict";
import { Sha256Stream } from "../storage/sha256.js";
import {
  createArtifactStore, sanitizeFilename, isAllowedFilename, MAX_ARTIFACT_BYTES
} from "../storage/r2.js";

function fakeBucket() {
  const objects = new Map();
  let deleted = 0;
  return {
    objects,
    get deleted() { return deleted; },
    async put(key, body) {
      const chunks = [];
      const reader = body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
      }
      objects.set(key, Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))));
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
    async delete(key) { objects.delete(key); deleted += 1; }
  };
}

function envWith(bucket) {
  return { ARTIFACTS: bucket, ARTIFACT_SIGNING_KEY: "unit-test-signing-key-not-a-real-secret" };
}

const sha256 = (text) => new Sha256Stream().update(new TextEncoder().encode(text)).digestHex();

test("streaming SHA-256 matches known vectors", () => {
  assert.equal(sha256(""), "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
  assert.equal(sha256("abc"), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
});

test("streaming SHA-256 is chunk-boundary independent", () => {
  const data = new TextEncoder().encode("ACGT".repeat(1000) + "NRYSWKMBDHV");
  const whole = new Sha256Stream();
  whole.update(data);
  const chunked = new Sha256Stream();
  for (let i = 0; i < data.length; i += 7) chunked.update(data.subarray(i, i + 7));
  assert.equal(chunked.digestHex(), whole.digestHex());
});

test("filenames are sanitized and only allowed biological types pass", () => {
  assert.equal(sanitizeFilename("../../etc/passwd"), "passwd");
  assert.equal(sanitizeFilename("my sample.fasta"), "my_sample.fasta");
  assert.equal(isAllowedFilename("sample.fasta"), true);
  assert.equal(isAllowedFilename("sample.fq.gz"), true);
  assert.equal(isAllowedFilename("sample.exe"), false);
});

test("store fails closed when the private bucket or signing key is missing", () => {
  assert.throws(() => createArtifactStore({}), /Private artifact storage is unavailable/);
  assert.throws(() => createArtifactStore({ ARTIFACTS: fakeBucket() }), /signing key is unavailable/);
});

test("upload ticket validates size, type and hash", async () => {
  const store = createArtifactStore(envWith(fakeBucket()));
  const base = { dataset_id: "ds_0123456789abcdef", filename: "sample.fasta", size_bytes: 4, sha256: sha256("ACGT") };
  await assert.rejects(() => store.createUploadTicket({ ...base, filename: "bad.exe" }), /not allowed/);
  await assert.rejects(() => store.createUploadTicket({ ...base, sha256: "nope" }), /sha256/);
  await assert.rejects(() => store.createUploadTicket({ ...base, size_bytes: MAX_ARTIFACT_BYTES + 1 }), /File size/);
  const ticket = await store.createUploadTicket(base);
  assert.match(ticket.upload_url, /^\/api\/artifacts\/upload\?ticket=/);
});

test("streamed upload verifies byte count and SHA-256 and stores the object", async () => {
  const bucket = fakeBucket();
  const store = createArtifactStore(envWith(bucket));
  const payload = new TextEncoder().encode("ACGTACGT");
  const ticket = await store.createUploadTicket({
    dataset_id: "ds_0123456789abcdef", filename: "sample.fasta",
    size_bytes: payload.length, sha256: sha256("ACGTACGT")
  });
  const body = new ReadableStream({
    start(controller) {
      controller.enqueue(payload.subarray(0, 3));
      controller.enqueue(payload.subarray(3));
      controller.close();
    }
  });
  const stored = await store.storeStream(ticket, body);
  assert.equal(stored.bytes, 8);
  assert.equal(stored.sha256, sha256("ACGTACGT"));
  assert.equal(bucket.objects.size, 1);
});

test("hash mismatch deletes the written object and fails the upload", async () => {
  const bucket = fakeBucket();
  const store = createArtifactStore(envWith(bucket));
  const payload = new TextEncoder().encode("ACGT");
  const ticket = await store.createUploadTicket({
    dataset_id: "ds_0123456789abcdef", filename: "sample.fasta",
    size_bytes: 4, sha256: sha256("TTTT")
  });
  const body = new ReadableStream({ start(controller) { controller.enqueue(payload); controller.close(); } });
  await assert.rejects(() => store.storeStream(ticket, body), /integrity verification/);
  assert.equal(bucket.objects.size, 0, "mismatched object must not remain in the private bucket");
  assert.equal(bucket.deleted, 1);
});

test("tickets are HMAC-signed, operation-scoped and expiring", async () => {
  const bucket = fakeBucket();
  const store = createArtifactStore(envWith(bucket));
  const upload = await store.createUploadTicket({
    dataset_id: "ds_0123456789abcdef", filename: "sample.fasta",
    size_bytes: 4, sha256: sha256("ACGT")
  });
  const token = new URL(`https://x${upload.upload_url}`).searchParams.get("ticket");
  assert.ok(await store.verify(token, "upload"));
  assert.equal(await store.verify(token, "download"), null, "ticket must be operation-scoped");
  assert.equal(await store.verify(token.slice(0, -2) + "xx", "upload"), null, "tampering is rejected");
  const expired = await store.sign({ op: "download", object_key: "k", exp: Date.now() - 1000 });
  assert.equal(await store.verify(expired, "download"), null);

  const download = await store.createDownloadTicket({
    dataset_id: "ds_0123456789abcdef", object_key: upload.object_key ?? "datasets/x/y/sample.fasta",
    filename: "sample.fasta", mime: "text/plain", bytes: 4
  });
  const downloadToken = new URL(`https://x${download.download_url}`).searchParams.get("ticket");
  assert.ok(await store.verify(downloadToken, "download"));
});

test("delete tickets are op-scoped", async () => {
  const store = createArtifactStore(envWith(fakeBucket()));
  const ticket = await store.createDeleteTicket({ artifact_id: "art_0123456789abcdef", object_key: "k" });
  const token = new URL(`https://x${ticket.delete_url}`).searchParams.get("ticket");
  assert.equal((await store.verify(token, "delete")).artifact_id, "art_0123456789abcdef");
  assert.equal(await store.verify(token, "upload"), null);
});
