import test from "node:test";
import assert from "node:assert/strict";

import { createMemoryStorage } from "../providers/common/contract.js";
import { createGovernor, DEFAULT_ALLOCATION } from "../providers/common/governor.js";

const AT = "2026-01-01T00:00:00.000Z";
function governor(alerts = []) {
  return createGovernor({
    storage: createMemoryStorage(),
    now: () => AT,
    onAlert: (entry) => alerts.push(entry)
  });
}

test("governor splits a configured total by category and never exceeds a category share", async () => {
  const g = governor();
  await g.initialize();
  await g.configureTotals({ ninerouter: { requests: 100 } });
  assert.equal(g.categoryShare("ninerouter", "requests", "integration"), 10); // 0.10 of 100
  assert.equal(g.categoryShare("ninerouter", "requests", "workflow_planning"), 35);
  const first = await g.reserve({ provider: "ninerouter", unit: "requests", amount: 4, category: "integration" });
  assert.equal(first.ok, true);
  const tooMuch = await g.reserve({ provider: "ninerouter", unit: "requests", amount: 7, category: "integration" });
  assert.equal(tooMuch.ok, false);
  assert.equal(tooMuch.reason, "budget_exhausted");
  assert.equal(tooMuch.share, 10);
  const otherCategory = await g.reserve({ provider: "ninerouter", unit: "requests", amount: 30, category: "workflow_planning" });
  assert.equal(otherCategory.ok, true, "a different category shares the same total but a different allocation");
});

test("governor fails closed on unknown totals (missing or explicit null)", async () => {
  const missing = governor();
  await missing.initialize();
  const first = await missing.reserve({ provider: "smartsbio", unit: "api_calls", amount: 1, category: "discovery_chat" });
  assert.equal(first.ok, false);
  assert.equal(first.reason, "budget_unknown");

  await missing.configureTotals({ smartsbio: { api_calls: null } });
  const second = await missing.reserve({ provider: "smartsbio", unit: "api_calls", amount: 1, category: "discovery_chat" });
  assert.equal(second.ok, false);
  assert.equal(second.reason, "budget_unknown");
  const status = await missing.getStatus("smartsbio");
  assert.equal(status.smartsbio.units.api_calls.unknown, true);
  assert.equal(status.smartsbio.units.api_calls.remaining, null);
});

test("governor emergency stop blocks all reservations until cleared", async () => {
  const g = governor();
  await g.initialize();
  await g.configureTotals({ galaxy: { jobs: 5 } });
  const stopped = await g.setEmergencyStop("galaxy", true, "operator halt");
  assert.equal(stopped.ok, true);
  const denied = await g.reserve({ provider: "galaxy", unit: "jobs", amount: 1 });
  assert.equal(denied.ok, false);
  assert.equal(denied.reason, "emergency_stop");
  assert.equal(denied.reason_detail, "operator halt");
  await g.setEmergencyStop("galaxy", false, "");
  const allowed = await g.reserve({ provider: "galaxy", unit: "jobs", amount: 1 });
  assert.equal(allowed.ok, true);
  assert.equal(DEFAULT_ALLOCATION.galaxy.jobs.general, 1.0);
});

test("governor reserve/consume/release accounts for actual usage and returns unused budget", async () => {
  const g = governor();
  await g.initialize();
  await g.configureTotals({ ninerouter: { requests: 100 } });

  const consumed = await g.reserve({ provider: "ninerouter", unit: "requests", amount: 4, category: "integration", idFactory: () => "fixed" });
  assert.equal(consumed.ok, true);
  assert.equal(consumed.reservation_id, "rsv_fixed");
  const used = await g.consume("rsv_fixed", 3);
  assert.equal(used.ok, true);
  assert.equal(used.actual, 3);
  assert.equal(used.released, 1);
  const status = await g.getStatus("ninerouter");
  assert.equal(status.ninerouter.units.requests.used, 3);
  assert.equal(status.ninerouter.units.requests.reserved, 0);

  const released = await g.reserve({ provider: "ninerouter", unit: "requests", amount: 2, category: "integration", idFactory: () => "second" });
  const rollback = await g.release(released.reservation_id);
  assert.equal(rollback.ok, true);
  assert.equal(rollback.released, 2);
  assert.equal((await g.getStatus("ninerouter")).ninerouter.units.requests.reserved, 0);
  assert.equal((await g.consume("rsv_fixed", 1)).reason, "unknown_reservation");
});

test("governor alerts on threshold and records reported usage without inventing totals", async () => {
  const alerts = [];
  const g = governor(alerts);
  await g.initialize();
  await g.configureTotals({ ninerouter: { requests: 100 } });
  await g.reserve({ provider: "ninerouter", unit: "requests", amount: 9, category: "integration" });
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0].kind, "threshold_warning");
  assert.equal(alerts[0].ratio, 0.9);
  assert.equal(alerts[0].at, AT);
  const recorded = await g.recordUsage("ninerouter", { prompt_tokens: 12, completion_tokens: 4 });
  assert.equal(recorded.ok, true);
  assert.equal(recorded.usage.prompt_tokens, 12);
  assert.equal(recorded.usage.observed_at, AT);
  const status = await g.getStatus("ninerouter");
  assert.equal(status.ninerouter.units.requests.total, 100);
  assert.equal(status.ninerouter.units.tokens, undefined, "only configured units get totals");
});
