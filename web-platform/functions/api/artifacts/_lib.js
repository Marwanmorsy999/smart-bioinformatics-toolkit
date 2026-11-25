import { createArtifactStore } from "../../../storage/r2.js";

export {
  jsonResponse, errorResponse, requireMethod, readJsonBody,
  providerPayload, safeString, isPublicId, nowIso, requireOwner
} from "../providers/_lib.js";
export { PROVIDER_SQL } from "../providers/_lib.js";
export { getDb, insertRow, getRow, runStatement, makeId } from "../ai/_lib.js";

export function getStore(env) {
  try {
    return createArtifactStore(env);
  } catch (error) {
    return { error: String(error?.message ?? error) };
  }
}
