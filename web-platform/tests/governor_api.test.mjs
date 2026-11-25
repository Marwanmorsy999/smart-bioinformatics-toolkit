import test from "node:test";
import assert from "node:assert/strict";
import { UsageGovernor, DEFAULT_ALLOCATION } from "../providers/common/governor.js";
import { createMemoryStorage } from "../providers/common/contract.js";

function makeGovernor(totals = {}) {
  const storage = createMemoryStorage();
  const governor = new UsageGovernor({ storage });
  return { governor, storage };
}

test("allocation percentages are the documented planning ratios", () => {
  assert.deepEqual({ ...DEFAULT_ALLOCATION.smartsbio.api_calls }, {
    discovery_chat: 0.15, core_integration: 0.30, additional_pipelines: 0.30, evaluation: 0.15, reserve: 0.10
  });
  assert.deepEqual({ ...DEFAULT_ALLOCATION.smartsbio.compute_hours }, {
    connection_smoke: 0.10, existing_workflows: 0.40, new_workflow_pilots: 0.30, validation: 0.10, reserve: 0.10
  });
  assert.deepEqual({ ...DEFAULT_ALLOCATION.ninerouter.requests }, {
    integration: 0.10, workflow_planning: 0.35, tool_selection: 0.30, explanation_evaluation: 0.15, reserve: 0.10
  });
});

test("reserve fails closed when the total is unknown (never invents a quota)", async () => {
  const { governor } = makeGovernor();
  await governor.initialize();
  const denied = await governor.reserve({ provider: "ninerouter", unit: "requests", amount: 1, category: "integration" });
  assert.equal(denied.ok, false);
  assert.equal(denied.reason, "budget_unknown");
});

test("category budgets are separate and cannot be borrowed across categories", async () => {
  const { governor } = makeGovernor();
  await governor.initialize();
  await governor.configureTotals({ ninerouter: { requests: 100 } });
  const first = await governor.reserve({ provider: "ninerouter", unit: "requests", amount: 20, category: "workflow_planning" });
  assert.equal(first.ok, true);
  const second = await governor.reserve({ provider: "ninerouter", unit: "requests", amount: 16, category: "workflow_planning" });
  assert.equal(second.ok, false, "35% of 100 is 35; 20+16 must exceed it");
  assert.equal(second.reason, "budget_exhausted");
  const other = await governor.reserve({ provider: "ninerouter", unit: "requests", amount: 9, category: "tool_selection" });
  assert.equal(other.ok, true, "a different category has its own allocation");
});

test("consumed usage stays inside its own category after consume", async () => {
  const { governor } = makeGovernor();
  await governor.initialize();
  await governor.configureTotals({ ninerouter: { requests: 100 } });
  const integration = await governor.reserve({ provider: "ninerouter", unit: "requests", amount: 4, category: "integration" });
  await governor.consume(integration.reservation_id, 4);
  // integration used 4 of its 10; tool_selection must still have its full 30.
  const selection = await governor.reserve({ provider: "ninerouter", unit: "requests", amount: 30, category: "tool_selection" });
  assert.equal(selection.ok, true, "one category must not borrow another category's budget");
  const status = await governor.getStatus("ninerouter");
  assert.deepEqual(status.ninerouter.units.requests.used_by_category, { integration: 4, tool_selection: 30 });
});

test("consent denial and emergency stop block reservations", async () => {
  const { governor } = makeGovernor();
  await governor.initialize();
  await governor.configureTotals({ galaxy: { jobs: 10 } });
  const deniedConsent = await governor.reserve({
    provider: "galaxy", unit: "jobs", amount: 1, category: "general", consentVerified: false
  });
  assert.equal(deniedConsent.reason, "consent_required");
  await governor.setEmergencyStop("galaxy", true, "operator stop");
  const stopped = await governor.reserve({ provider: "galaxy", unit: "jobs", amount: 1, category: "general" });
  assert.equal(stopped.reason, "emergency_stop");
  const status = await governor.getStatus("galaxy");
  assert.equal(status.galaxy.emergency.stopped, true);
});

test("consume records actual usage and releases the unused reservation", async () => {
  const { governor } = makeGovernor();
  await governor.initialize();
  await governor.configureTotals({ ninerouter: { requests: 10 } });
  const reservation = await governor.reserve({ provider: "ninerouter", unit: "requests", amount: 1, category: "integration" });
  const consumed = await governor.consume(reservation.reservation_id, 1);
  assert.equal(consumed.ok, true);
  const status = await governor.getStatus("ninerouter");
  assert.equal(status.ninerouter.units.requests.used, 1);
  assert.equal(status.ninerouter.units.requests.reserved, 0);
  assert.equal(status.ninerouter.units.requests.remaining, 9);
  assert.equal((await governor.consume(reservation.reservation_id, 1)).ok, false, "double consume is rejected");
});

test("release frees a reservation without recording usage", async () => {
  const { governor } = makeGovernor();
  await governor.initialize();
  await governor.configureTotals({ galaxy: { jobs: 5 } });
  const reservation = await governor.reserve({ provider: "galaxy", unit: "jobs", amount: 2, category: "general" });
  await governor.release(reservation.reservation_id);
  const status = await governor.getStatus("galaxy");
  assert.equal(status.galaxy.units.jobs.reserved, 0);
  assert.equal(status.galaxy.units.jobs.used, 0);
});

test("alert threshold fires and is visible in status", async () => {
  const alerts = [];
  const governor = new UsageGovernor({ storage: createMemoryStorage(), warnThreshold: 0.5, onAlert: (entry) => alerts.push(entry) });
  await governor.initialize();
  await governor.configureTotals({ ninerouter: { requests: 100 } });
  await governor.reserve({ provider: "ninerouter", unit: "requests", amount: 20, category: "workflow_planning" });
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0].kind, "threshold_warning");
});

test("state persists across governor instances sharing storage", async () => {
  const storage = createMemoryStorage();
  const first = new UsageGovernor({ storage });
  await first.initialize();
  await first.configureTotals({ smartsbio: { api_calls: 20 } });
  const reservation = await first.reserve({ provider: "smartsbio", unit: "api_calls", amount: 1, category: "evaluation" });
  const second = new UsageGovernor({ storage });
  await second.initialize();
  assert.equal((await second.getStatus("smartsbio")).smartsbio.units.api_calls.reserved, 1);
  await second.consume(reservation.reservation_id, 1);
  assert.equal((await second.getStatus("smartsbio")).smartsbio.units.api_calls.used, 1);
});
