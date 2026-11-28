// GET /api/providers/transfers — transfer ledger for external disclosure.
// Fields: source, destination, dataset id, input hash, byte count, consent,
// timestamp, expiry, deletion status.

import { jsonResponse, errorResponse, requireMethod, providerPayload, requireOwner } from "./_lib.js";
import { getDb, listRows } from "../ai/_lib.js";
import { PROVIDER_SQL } from "./_lib.js";

export async function onRequest(context) {
  const denied = requireMethod(context.request, "GET", "GET");
  if (denied) return denied;
  const { env, request } = context;
  const ownerError = requireOwner(request, env);
  if (ownerError) return ownerError;
  const db = getDb(env);
  if (!db) return errorResponse("D1 binding is unavailable.", 503, request);
  const rows = await listRows(db, PROVIDER_SQL.listTransfers, [100]);
  const transfers = rows.map((row) => ({
    id: row.public_id,
    dataset_id: row.dataset_id,
    source: row.source,
    destination: row.destination,
    input_hash: row.input_hash,
    byte_count: row.byte_count,
    consent_id: row.consent_id,
    operation: row.operation,
    status: row.status,
    created_at: row.created_at,
    expires_at: row.expires_at,
    deleted_at: row.deleted_at ?? null
  }));
  return jsonResponse(providerPayload(request, env, { transfers }), 200, request);
}
