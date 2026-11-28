// M7.2 VERIFICATION — OFFLINE / MOCK only.
// No live Galaxy job, no credentials, no network: the report is built from
// synthetic in-memory values and served from an injected fake D1.
//
// Behavior under test: the deterministic HTML report renders the PUBLIC D1 job
// id (job_<hex>), not the internal integer row id. This is the gap called out
// in the pre-existing m7_2_pipeline_offline.test.mjs comment.
import test from "node:test";
import assert from "node:assert/strict";

import { buildReportHtml } from "../functions/api/ai/report.js";
import { handleGetReport } from "../functions/api/ai/runs/[id]/report.js";

const PUBLIC_JOB_ID = "job_1111111111111111";
const PLAN_ID = "plan_2222222222222222";
const INTERNAL_ROW_ID = 7; // synthetic integer D1 row id; must NOT be shown as the job id

function reportArgs() {
  return {
    job: {
      id: INTERNAL_ROW_ID, public_id: PUBLIC_JOB_ID, plan_id: PLAN_ID,
      status: "succeeded", tool_id: "sequence-stats.profile", step_id: "step_1"
    },
    plan: { intent: "validate_and_profile", steps: [{ params: {} }] },
    artifacts: [],
    validation: { status: "pass", checked_rules: [], flags: [] },
    explanation: {
      summary: "OFFLINE/MOCK synthetic profile; no scientific conclusion.",
      findings: [], limitations: [], references: [], uncertainty: "low"
    },
    provenance: { tool: {}, input: {}, timing: {} },
    mode: "mock",
    createdAt: new Date().toISOString(),
    localityReceipt: null,
    education: { notes: [] }
  };
}

test("OFFLINE/MOCK report builder renders public job id, not the internal numeric row id", () => {
  const html = buildReportHtml(reportArgs());
  assert.equal(html.includes(PUBLIC_JOB_ID), true, "public job id must appear in the report HTML");
  assert.equal(html.includes(`Analysis report - ${PUBLIC_JOB_ID}`), true);
  assert.equal(html.includes(`Job <code>${PUBLIC_JOB_ID}</code>`), true);
  assert.equal(html.includes(PLAN_ID), true);
  assert.equal(html.includes(`Job <code>${INTERNAL_ROW_ID}</code>`), false, "numeric D1 row id must not be rendered as the job id");
  assert.equal(html.includes(`Analysis report - ${INTERNAL_ROW_ID}`), false);
  assert.match(html, /Execution mode: mock/);
  assert.equal(html.includes("<script"), false);
});

test("OFFLINE/MOCK served report preserves the public job id from the stored HTML", async () => {
  const html = buildReportHtml(reportArgs());
  // Injected fake D1: SELECT * FROM report_runs WHERE job_id = ? returns one row.
  const db = {
    prepare() {
      return {
        bind() { return this; },
        async all() { return { success: true, results: [{ report_html: html }] }; }
      };
    }
  };
  const request = new Request(`https://m7-2-verify.example.test/api/ai/runs/${PUBLIC_JOB_ID}/report`);
  const response = await handleGetReport(request, { AI_DB: db }, PUBLIC_JOB_ID);
  assert.equal(response.status, 200);
  assert.equal((await response.text()).includes(PUBLIC_JOB_ID), true);
});
