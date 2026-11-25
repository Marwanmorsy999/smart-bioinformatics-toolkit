// Shared helpers for the Galaxy artifact endpoints.
// Consent is verified before any provider transmission; errors are typed via a
// whitelisted code header and never carry provider bodies or credentials.

import {
  errorResponse, jsonResponse, requireMethod, getDb, getRow, runStatement,
  nowIso, safeString
} from "../../ai/_lib.js";
import { PROVIDER_SQL, isEnabled } from "../_lib.js";
import {
  artifactError, isArtifactError, MAX_UPLOAD_BYTES, isAllowedFilename,
  isSha256, publicArtifact, sanitizeFilename
} from "../../../../storage/galaxy-artifacts.js";

export {
  errorResponse, jsonResponse, requireMethod, getDb, safeString,
  artifactError, isArtifactError, MAX_UPLOAD_BYTES, isAllowedFilename,
  isSha256, publicArtifact, sanitizeFilename
};

export function typedError(message, status, request, code, detail = {}) {
  return errorResponse(message, status, request, {
    "X-Error-Detail": JSON.stringify({ code, ...detail })
  });
}

export function artifactFailure(error, request) {
  if (isArtifactError(error)) {
    return typedError(error.message, error.status, request, error.code, error.detail ?? {});
  }
  return typedError("Galaxy artifact request failed.", 500, request, "internal_error");
}

export function requireGalaxy(env, request) {
  if (!isEnabled(env, "galaxy")) {
    return typedError("Galaxy provider is disabled.", 403, request, "provider_disabled", { provider: "galaxy" });
  }
  return null;
}

export function headerString(request, name, max = 200) {
  return safeString(request?.headers?.get?.(name) ?? "", max);
}

export const DS_ID_PATTERN = /^ds_[0-9a-f]{16}$/;
export const CONSENT_ID_PATTERN = /^pcon_[0-9a-f]{16}$/;

// Verify the exact consent record the upload claims: granted, unexpired,
// unused, scoped to galaxy and to this very dataset. Throws a typed artifact
// error so the caller can answer before opening any connection to Galaxy.
export async function verifyConsent(db, { consentId, datasetId, now = Date.now() }) {
  if (!CONSENT_ID_PATTERN.test(consentId)) {
    throw artifactError("invalid_consent_id", "X-Consent-Id must be a pcon_ identifier.", 400);
  }
  if (!DS_ID_PATTERN.test(datasetId)) {
    throw artifactError("invalid_dataset_id", "X-Dataset-Id must be a ds_ identifier.", 400);
  }
  const row = await getRow(db, PROVIDER_SQL.getConsentRecord, [consentId]);
  if (!row) throw artifactError("consent_not_found", "Consent record not found.", 403);
  if (row.provider !== "galaxy") {
    throw artifactError("consent_provider_mismatch", "Consent was not granted for Galaxy.", 403);
  }
  if (row.dataset_id !== datasetId) {
    throw artifactError("consent_dataset_mismatch", "Consent does not cover this dataset.", 403);
  }
  if (Number(row.granted) !== 1) {
    throw artifactError("consent_denied", "Consent was denied or revoked.", 403);
  }
  if (row.used_at) {
    throw artifactError("consent_spent", "Consent has already been used.", 403);
  }
  if (!row.expires_at || !(Date.parse(row.expires_at) > now)) {
    throw artifactError("consent_expired", "Consent has expired.", 403);
  }
  return row;
}

// Single use: a spent consent cannot authorize a second external transfer.
export async function consumeConsent(db, consentId) {
  await runStatement(db, PROVIDER_SQL.consumeConsent, [nowIso(), consentId]);
}
