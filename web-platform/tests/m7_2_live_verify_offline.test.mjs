// M7.2 OFFLINE verification of live-driven fixes.
// Every provider fetch is injected; no network, no credentials, no live calls.
// This file only ADDS tests; it does not touch production code.

import test from "node:test";
import assert from "node:assert/strict";

import { createAdapter } from "../providers/galaxy/index.js";
import { OPERATIONS } from "../providers/common/contract.js";
import { createGovernor } from "../providers/common/governor.js";

const BASE = "https://galaxy.example.invalid";
const KEY = "MOCK-KEY-DO-NOT-USE"; // placeholder, never a real secret
const HISTORY = "verify-history-id";

function env() {
  return { GALAXY_ENABLED: "true", GALAXY_BASE_URL: BASE, GALAXY_API_KEY: KEY };
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status, headers: { "Content-Type": "application/json" }
  });
}

const sleep = async () => {};

// ---------------------------------------------------------------------------
// Fix 2: GET /api/tools returns panel sections; flatten elems and advertise
// only real Tool entries (sections and DataSourceTool rows are excluded).
// ---------------------------------------------------------------------------
test("M7.2 OFFLINE: tool panel sections are flattened and non-Tool rows excluded", async () => {
  const panel = [
    {
      model_class: "ToolSection", id: "section-outer", name: "Outer",
      elems: [
        { model_class: "Tool", id: "tool.in.section", name: "Nested Tool", version: "1.0" },
        {
          model_class: "ToolSection", id: "section-inner", name: "Inner",
          elems: [{ id: "tool.deep", name: "Deep Tool", version: "1.0" }]
        },
        { model_class: "DataSourceTool", id: "ds.in.section", name: "In-Section Data Source" }
      ]
    },
    { model_class: "Tool", id: "tool.top", name: "Top Tool", version: "2.0" },
    { model_class: "DataSourceTool", id: "ds.top", name: "Top Data Source" },
    { model_class: "ToolSection", id: "section.empty", name: "Empty Section" }
  ];
  const calls = [];
  const fetchImpl = async (input, init = {}) => {
    const url = String(input);
    calls.push({ url, method: init.method ?? "GET" });
    if (url.endsWith("/api/tools") && (init.method ?? "GET") === "GET") return json(panel);
    if (url.endsWith("/api/workflows")) return json([]);
    return json({ error: "not_found" }, 404);
  };

  const capabilities = await createAdapter(env()).getCapabilities({ fetch: fetchImpl, sleep });

  assert.deepEqual(
    capabilities.tools.map((tool) => tool.id),
    ["tool.in.section", "tool.deep", "tool.top"],
    "only real Tool entries from sections are advertised"
  );
  for (const excluded of ["section-outer", "section-inner", "section.empty", "ds.in.section", "ds.top"]) {
    assert.equal(
      capabilities.tools.some((tool) => tool.id === excluded), false,
      `${excluded} must not be advertised`
    );
  }
  assert.ok(calls.some((call) => call.url.endsWith("/api/tools")), "live /api/tools was queried");
});

// ---------------------------------------------------------------------------
// Fix 3: POST /api/tools/fetch returns outputs[0].{id,history_id} and
// jobs[0].id immediately; the dataset is registered without waiting for a
// completed-dataset listing.
// ---------------------------------------------------------------------------
test("M7.2 OFFLINE: /api/tools/fetch outputs/jobs are extracted directly", async () => {
  const fetchImpl = async (input, init = {}) => {
    const url = String(input);
    if (url.endsWith("/api/tools/fetch")) {
      return json({
        outputs: [{ id: "fetched-dataset-id", history_id: "fetched-history-id", name: "uploaded.fasta" }],
        jobs: [{ id: "fetch-job-id", state: "new" }]
      });
    }
    return json({ error: "not_found" }, 404);
  };

  const result = await createAdapter(env()).submitJob({
    operation: OPERATIONS.SUBMIT_JOB,
    tool_id: "upload1",
    history_id: HISTORY,
    inputs: { file1: { content: ">s\nACGT\n", filename: "uploaded.fasta" } }
  }, { fetch: fetchImpl, sleep, idFactory: () => "generated-should-not-win" });

  assert.equal(result.error, undefined);
  assert.equal(result.status, "queued");
  assert.equal(result.provider_job_id, "fetch-job-id", "job id comes from jobs[0].id");
  assert.equal(result.output.structured.job_id, "fetch-job-id");
  assert.equal(result.output.structured.dataset_id, "fetched-dataset-id", "dataset registered from outputs[0].id");
  assert.equal(result.output.structured.history_id, "fetched-history-id", "history from outputs[0].history_id");
});

test("M7.2 OFFLINE: missing fetch outputs never fabricate a dataset id", async () => {
  const fetchImpl = async (input) => {
    if (String(input).endsWith("/api/tools/fetch")) return json({ outputs: [], jobs: [] });
    return json({ error: "not_found" }, 404);
  };
  const result = await createAdapter(env()).submitJob({
    operation: OPERATIONS.SUBMIT_JOB, tool_id: "upload1", history_id: HISTORY,
    inputs: { file1: { content: ">s\nACGT\n", filename: "uploaded.fasta" } }
  }, { fetch: fetchImpl, sleep, idFactory: () => "generated-job" });

  assert.equal(result.output.structured.dataset_id, null, "no invented dataset id");
  assert.equal(result.provider_job_id, "generated-job", "generated id is the documented fallback");
});

// ---------------------------------------------------------------------------
// Fix 4: POST /api/tools returns the real job in jobs[0].id, not top-level id.
// ---------------------------------------------------------------------------
test("M7.2 OFFLINE: jobs[0].id wins over any top-level id", async () => {
  const fetchImpl = async (input, init = {}) => {
    const url = String(input);
    const method = String(init.method ?? "GET").toUpperCase();
    if (url.endsWith("/api/tools") && method === "POST") {
      return json({
        id: "top-level-id-must-not-win",
        state: "new",
        outputs: [{ id: "out-dataset-id" }],
        jobs: [{ id: "real-job-from-jobs0", state: "queued" }]
      });
    }
    if (url.endsWith("/api/histories") && method === "POST") return json({ id: HISTORY });
    return json({ error: "not_found" }, 404);
  };

  const result = await createAdapter(env()).submitJob({
    operation: OPERATIONS.SUBMIT_JOB, tool_id: "mock.tool.alpha",
    history_id: HISTORY, inputs: {}, params: {}
  }, { fetch: fetchImpl, sleep, idFactory: () => "generated-should-not-win" });

  assert.equal(result.provider_job_id, "real-job-from-jobs0");
  assert.equal(result.output.structured.job_id, "real-job-from-jobs0");
  assert.notEqual(result.provider_job_id, "top-level-id-must-not-win");
  assert.deepEqual(result.output.structured.outputs, ["out-dataset-id"]);
});

// ---------------------------------------------------------------------------
// Fix 6: governor reserve tolerates operator-seeded D1 state that has totals
// but is missing per-provider containers (used/usedByCategory/reserved/emergency).
// ---------------------------------------------------------------------------
test("M7.2 OFFLINE: governor reserve creates containers for operator-seeded state", async () => {
  const seeded = { version: 1, totals: { galaxy: { jobs: 10, bytes: 1024 } }, reservations: {} };
  let saved = null;
  const storage = {
    async load() { return JSON.parse(JSON.stringify(seeded)); },
    async save(state) { saved = JSON.parse(JSON.stringify(state)); return state; }
  };
  const governor = createGovernor({ storage, now: () => "2026-11-25T00:00:00.000Z" });
  await governor.initialize();

  const reservation = await governor.reserve({
    provider: "galaxy", unit: "jobs", amount: 1, category: "general"
  });

  assert.equal(reservation.ok, true, "reserve must not throw on seeded state");
  assert.equal(reservation.reason, undefined);
  assert.ok(saved, "state must be persisted");
  assert.deepEqual(saved.totals.galaxy, { jobs: 10, bytes: 1024 }, "operator totals preserved");
  assert.equal(saved.reserved.galaxy.jobs, 1, "reservation recorded in created container");
  assert.ok(saved.used.galaxy, "used.galaxy container created");
  assert.ok(saved.usedByCategory.galaxy, "usedByCategory.galaxy container created");
  assert.ok(saved.emergency.galaxy, "emergency.galaxy container created");

  const consumed = await governor.consume(reservation.reservation_id, 1);
  assert.equal(consumed.ok, true, "consume also works on seeded state");
  assert.equal(saved.used.galaxy.jobs, 1);
  assert.equal(saved.reserved.galaxy.jobs, 0);
});
