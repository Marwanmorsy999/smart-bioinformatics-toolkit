// M7 validation-only test: consent id prefix regression (no production code changed).
// The consent endpoint issues ids with makeId("pcon"), but the job submission
// endpoint validates consent_id with isPublicId(), whose prefix whitelist does
// not include "pcon_". This test asserts the intended behavior and therefore
// fails until the prefix mismatch is fixed.
import test from "node:test";
import assert from "node:assert/strict";

import { isPublicId } from "../functions/api/ai/_lib.js";
import { PROVIDER_SQL } from "../functions/api/providers/_lib.js";
import { onRequest as consentOnRequest } from "../functions/api/providers/consent.js";

const DATASET = "ds_0123456789abcdef";

function createDb() {
  const rows = [];
  return {
    rows,
    prepare(sql) {
      const stmt = {
        values: [],
        bind(...values) { stmt.values = values; return stmt; },
        async run() {
          if (sql === PROVIDER_SQL.insertConsentRecord) { rows.push([...stmt.values]); return { success: true, meta: { changes: 1 } }; }
          throw new Error(`Unexpected SQL: ${sql}`);
        },
        async all() { throw new Error(`Unexpected SQL: ${sql}`); }
      };
      return stmt;
    }
  };
}

function post(path, payload) {
  return new Request(`https://m7-validation.example.test${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
}

test("consent ids issued by /api/providers/consent are accepted by /api/providers/jobs validation", async () => {
  const db = createDb();
  const env = { AI_DB: db };
  const response = await consentOnRequest({
    request: post("/api/providers/consent", {
      provider: "galaxy", dataset_id: DATASET, granted: true, ttl_seconds: 60
    }),
    env
  });
  assert.equal(response.status, 201);
  const body = await response.json();
  const consentId = body.consent.id;
  assert.match(consentId, /^pcon_[0-9a-f]{16}$/);
  assert.equal(db.rows.length, 1, "consent record must be persisted");

  // jobs/index.js:47 rejects any consent_id that fails isPublicId().
  assert.equal(
    isPublicId(consentId),
    true,
    `consent id ${consentId} is issued by the consent endpoint but rejected as a consent_id by provider job submission (isPublicId whitelist: functions/api/ai/_lib.js:17)`
  );
});
