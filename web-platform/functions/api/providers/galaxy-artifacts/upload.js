// POST /api/providers/galaxy/upload — browser-to-Galaxy upload via the Worker.
//
// The bytes are streamed and hashed in memory (bounded by the 1 MiB cap), then
// handed to the Galaxy adapter. Only metadata + provider dataset/history ids
// are persisted in D1; the bytes live in the Galaxy history. Consent is checked
// before any provider transmission.

import {
  jsonResponse, requireMethod, getDb, typedError, artifactFailure,
  requireGalaxy, headerString, verifyConsent, consumeConsent,
  MAX_UPLOAD_BYTES, isAllowedFilename, isSha256, publicArtifact,
  sanitizeFilename, artifactError, DS_ID_PATTERN
} from "./_lib.js";
import { createGalaxyArtifactStore, extensionOf } from "../../../../storage/galaxy-artifacts.js";
import { hashStream } from "../../../../storage/sha256.js";

function concatenate(chunks, total) {
  const joined = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    const bytes = chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk);
    joined.set(bytes, offset);
    offset += bytes.byteLength;
  }
  return joined;
}

export async function onRequest(context) {
  const denied = requireMethod(context.request, "POST", "POST");
  if (denied) return denied;
  const { request, env } = context;

  const disabled = requireGalaxy(env, request);
  if (disabled) return disabled;
  const db = getDb(env);
  if (!db) return typedError("D1 binding is unavailable.", 503, request, "no_d1");

  const datasetId = headerString(request, "X-Dataset-Id", 100);
  const consentId = headerString(request, "X-Consent-Id", 100);
  const filename = sanitizeFilename(headerString(request, "X-Filename", 200));
  const declaredHash = headerString(request, "X-Input-Hash", 64).toLowerCase();
  const declaredBytes = Number(headerString(request, "X-Size-Bytes", 20));
  const projectId = headerString(request, "X-Project-Id", 100) || null;

  // Validate everything that can be validated locally before consent or any
  // network call. Denials and oversize requests never reach Galaxy.
  if (!DS_ID_PATTERN.test(datasetId)) {
    return typedError("X-Dataset-Id must be a ds_ identifier.", 400, request, "invalid_dataset_id");
  }
  if (!isAllowedFilename(filename)) {
    return typedError("File type is not an allowed biological format.", 400, request, "invalid_filename");
  }
  if (!isSha256(declaredHash)) {
    return typedError("X-Input-Hash must be 64 lowercase hex characters.", 400, request, "invalid_hash");
  }
  if (!Number.isInteger(declaredBytes) || declaredBytes <= 0) {
    return typedError("X-Size-Bytes must be a positive integer.", 400, request, "invalid_size");
  }
  if (declaredBytes > MAX_UPLOAD_BYTES) {
    return typedError(`Upload exceeds the ${MAX_UPLOAD_BYTES} byte cap.`, 413, request, "oversize", {
      max_bytes: MAX_UPLOAD_BYTES
    });
  }

  // Consent gate: checked BEFORE any bytes are transmitted to the provider.
  try {
    await verifyConsent(db, { consentId, datasetId });
  } catch (error) {
    return artifactFailure(error, request);
  }

  const store = createGalaxyArtifactStore(db, env, { fetch: env.FETCH_IMPL });
  const duplicate = await store.getByDataset(datasetId, "input");
  if (duplicate) {
    return typedError("Dataset is already registered.", 409, request, "duplicate_artifact", {
      public_id: duplicate.public_id
    });
  }
  if (!request.body) {
    return typedError("A request body is required.", 400, request, "body_required");
  }

  const chunks = [];
  let counted = 0;
  let hashed;
  try {
    hashed = await hashStream(request.body, (chunk) => {
      const size = chunk?.byteLength ?? chunk?.length ?? 0;
      counted += size;
      if (counted > MAX_UPLOAD_BYTES) {
        throw artifactError("oversize", `Upload exceeds the ${MAX_UPLOAD_BYTES} byte cap.`, 413, {
          max_bytes: MAX_UPLOAD_BYTES
        });
      }
      chunks.push(chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk));
    });
  } catch (error) {
    return artifactFailure(error, request);
  }
  if (hashed.sha256 !== declaredHash) {
    return typedError("Upload SHA-256 does not match X-Input-Hash.", 400, request, "invalid_hash", {
      expected: declaredHash, actual: hashed.sha256
    });
  }
  if (hashed.bytes !== declaredBytes) {
    return typedError("Upload byte count does not match X-Size-Bytes.", 400, request, "size_mismatch", {
      expected: declaredBytes, actual: hashed.bytes
    });
  }

  let content;
  try {
    // Galaxy's file_content transport is textual; reject binary payloads
    // rather than silently corrupting them.
    content = new TextDecoder("utf-8", { fatal: true }).decode(concatenate(chunks, hashed.bytes));
  } catch {
    return typedError("Upload must be valid UTF-8 biological text.", 400, request, "invalid_encoding");
  }

  let artifact;
  try {
    artifact = await store.uploadDataset({
      dataset_id: datasetId, filename, ext: extensionOf(filename), content,
      sha256: hashed.sha256, bytes: hashed.bytes, project_id: projectId
    });
    await consumeConsent(db, consentId);
  } catch (error) {
    return artifactFailure(error, request);
  }

  return jsonResponse({
    artifact: publicArtifact(artifact),
    max_bytes: MAX_UPLOAD_BYTES,
    notice: "Bytes are stored only in the Galaxy history. D1 holds metadata, hashes and provenance."
  }, 201, request, { "X-Artifact-Id": artifact.public_id });
}
