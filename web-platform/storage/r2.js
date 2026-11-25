// M7 private artifact store backed by Cloudflare R2.
// - Private bucket, no public URLs.
// - Short-lived HMAC-signed URLs issued by the Worker.
// - Streaming upload/download: large files are never buffered in Worker memory.
// - SHA-256 integrity, byte caps, sanitized filenames, allowed file types.

import { Sha256Stream } from "./sha256.js";

export const MAX_ARTIFACT_BYTES = 64 * 1024 * 1024;
export const DEFAULT_TICKET_TTL_SECONDS = 15 * 60;
const ALLOWED_EXTENSIONS = new Set([
  "fa", "fasta", "fna", "faa", "fastq", "fq", "tsv", "csv", "txt", "vcf",
  "bed", "gff", "gtf", "json", "sam", "bam", "cram", "gz", "zip"
]);
const SHA256_PATTERN = /^[0-9a-f]{64}$/;

export function sanitizeFilename(value) {
  const text = typeof value === "string" ? value.split(/[\\/]/).pop() ?? "" : "";
  return text.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 200) || "upload.bin";
}

export function isAllowedFilename(filename) {
  const clean = sanitizeFilename(filename);
  const dot = clean.lastIndexOf(".");
  return dot > 0 && ALLOWED_EXTENSIONS.has(clean.slice(dot + 1).toLowerCase());
}

function b64url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function unb64url(text) {
  const padded = String(text).replace(/-/g, "+").replace(/_/g, "/") + "===".slice((String(text).length + 3) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function equalConstantTime(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let difference = 0;
  for (let i = 0; i < a.length; i += 1) difference |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return difference === 0;
}

export function createArtifactStore(env) {
  const bucket = env?.ARTIFACTS;
  const signingKey = env?.ARTIFACT_SIGNING_KEY;
  if (!bucket || typeof bucket.put !== "function" || typeof bucket.get !== "function") {
    throw new Error("Private artifact storage is unavailable (R2 binding missing).");
  }
  if (!signingKey) throw new Error("Artifact signing key is unavailable.");

  const encoder = new TextEncoder();
  let cryptoKeyPromise = null;
  function getKey() {
    if (!cryptoKeyPromise) {
      cryptoKeyPromise = crypto.subtle.importKey(
        "raw", encoder.encode(signingKey), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]
      );
    }
    return cryptoKeyPromise;
  }

  async function sign(payload, ttlSeconds = DEFAULT_TICKET_TTL_SECONDS) {
    const body = {
      ...payload,
      // An explicit exp is used only by tests and internal callers; public
      // ticket helpers always use the bounded TTL below.
      exp: Number.isFinite(payload.exp)
        ? payload.exp
        : Date.now() + Math.max(30, Math.min(ttlSeconds, DEFAULT_TICKET_TTL_SECONDS)) * 1000
    };
    const encoded = b64url(encoder.encode(JSON.stringify(body)));
    const key = await getKey();
    const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(encoded));
    return `${encoded}.${b64url(new Uint8Array(signature))}`;
  }

  async function verify(token, expectedOperation) {
    try {
      const parts = String(token ?? "").split(".");
      if (parts.length !== 2) return null;
      const [encoded, signature] = parts;
      const key = await getKey();
      const expected = b64url(new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(encoded))));
      if (!equalConstantTime(signature, expected)) return null;
      const payload = JSON.parse(new TextDecoder().decode(unb64url(encoded)));
      if (!payload || typeof payload !== "object") return null;
      if (typeof payload.exp !== "number" || payload.exp <= Date.now()) return null;
      if (expectedOperation && payload.op !== expectedOperation) return null;
      return payload;
    } catch {
      return null;
    }
  }

  function objectKey(payload) {
    return `datasets/${payload.dataset_id}/${payload.sha256}/${sanitizeFilename(payload.filename)}`;
  }

  async function createUploadTicket({ dataset_id, filename, size_bytes, sha256, mime = "application/octet-stream", ttl_seconds, artifact_id }) {
    const cleanName = sanitizeFilename(filename);
    if (!isAllowedFilename(cleanName)) throw new Error("File type is not allowed.");
    const bytes = Number(size_bytes);
    if (!Number.isInteger(bytes) || bytes <= 0 || bytes > MAX_ARTIFACT_BYTES) {
      throw new Error(`File size must be between 1 and ${MAX_ARTIFACT_BYTES} bytes.`);
    }
    if (!SHA256_PATTERN.test(String(sha256 ?? "").toLowerCase())) {
      throw new Error("sha256 must be 64 lowercase hex characters.");
    }
    const payload = {
      op: "upload", dataset_id: String(dataset_id), filename: cleanName,
      size_bytes: bytes, sha256: String(sha256).toLowerCase(), mime: String(mime).slice(0, 120),
      artifact_id: String(artifact_id ?? "")
    };
    payload.object_key = objectKey(payload);
    const token = await sign(payload, ttl_seconds);
    return {
      upload_url: `/api/artifacts/upload?ticket=${encodeURIComponent(token)}`,
      method: "PUT",
      expires_in_seconds: Number(ttl_seconds) || DEFAULT_TICKET_TTL_SECONDS,
      max_bytes: bytes,
      filename: cleanName,
      artifact_id: String(artifact_id ?? ""),
      // The verified ticket payload is carried back so storeStream can rely
      // on the signed values rather than caller-supplied data.
      dataset_id: payload.dataset_id,
      size_bytes: payload.size_bytes,
      sha256: payload.sha256,
      mime: payload.mime,
      object_key: payload.object_key
    };
  }

  // Streams the request body to R2 while hashing and counting bytes. On a
  // mismatch the newly written object is deleted; mismatches never succeed.
  async function storeStream(ticket, body, metadata = {}) {
    if (!body || typeof body.getReader !== "function") throw new Error("A request body stream is required.");
    if (!Number.isInteger(ticket.size_bytes) || ticket.size_bytes > MAX_ARTIFACT_BYTES) throw new Error("Invalid declared byte count.");
    const hasher = new Sha256Stream();
    let counted = 0;
    const checker = new TransformStream({
      transform(chunk, controller) {
        hasher.update(chunk);
        counted += chunk.length;
        if (counted > ticket.size_bytes) throw new Error("Upload exceeds the declared byte count.");
        controller.enqueue(chunk);
      }
    });
    await bucket.put(ticket.object_key, body.pipeThrough(checker), {
      httpMetadata: { contentType: ticket.mime || "application/octet-stream" },
      customMetadata: {
        dataset_id: ticket.dataset_id,
        sha256: ticket.sha256,
        bytes: String(ticket.size_bytes),
        ...metadata
      }
    });
    const actualHash = hasher.digestHex();
    if (counted !== ticket.size_bytes || actualHash !== ticket.sha256) {
      await bucket.delete(ticket.object_key);
      throw new Error("Upload failed integrity verification (byte count or SHA-256 mismatch).");
    }
    return { object_key: ticket.object_key, bytes: counted, sha256: actualHash };
  }

  async function createDownloadTicket({ dataset_id, object_key, filename, mime, bytes, ttl_seconds }) {
    const token = await sign({
      op: "download", dataset_id: String(dataset_id), object_key: String(object_key),
      filename: sanitizeFilename(filename), mime: String(mime ?? "application/octet-stream").slice(0, 120),
      bytes: Number(bytes)
    }, ttl_seconds);
    return {
      download_url: `/api/artifacts/content?ticket=${encodeURIComponent(token)}`,
      expires_in_seconds: Number(ttl_seconds) || DEFAULT_TICKET_TTL_SECONDS
    };
  }

  async function createDeleteTicket({ artifact_id, object_key, ttl_seconds = 300 }) {
    const token = await sign({ op: "delete", artifact_id: String(artifact_id), object_key: String(object_key) }, ttl_seconds);
    return { delete_url: `/api/artifacts/delete?ticket=${encodeURIComponent(token)}`, expires_in_seconds: ttl_seconds };
  }

  async function getObject(objectKey) {
    const object = await bucket.get(objectKey);
    if (!object) return null;
    return object;
  }

  async function deleteObject(objectKey) {
    await bucket.delete(objectKey);
    return true;
  }

  return {
    sign, verify, objectKey, createUploadTicket, storeStream,
    createDownloadTicket, createDeleteTicket, getObject, deleteObject
  };
}
