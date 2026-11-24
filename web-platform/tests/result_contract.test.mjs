import test from "node:test";
import assert from "node:assert/strict";

import { hashInput } from "../functions/api/blast/_lib.js";
import { validateResultShape } from "../functions/api/ai/_lib.js";
import { TOOLS, getTool } from "../functions/api/ai/registry.js";
import { handleCreateRequest } from "../functions/api/ai/requests/index.js";
import { handleApprove } from "../functions/api/ai/plans/[id]/approve.js";
import { handlePollJobs } from "../functions/api/ai/jobs/index.js";
import { handleSubmitResult } from "../functions/api/ai/jobs/[id]/result.js";
import { createFakeD1AI, makeGetRequest, makePostRequest, mockAIEnv } from "./helpers/fake-d1.mjs";

const NOW = Date.parse("2026-11-24T12:00:00.000Z");
const FASTA = ">seq1 example\nACGTACGTACGT\n>seq2\nTTTTGGGGCCCC\n";
const JOB = "job_0123456789abcdef";
const DATASET = "ds_0123456789abcdef";

async function artifact(name, kind, content) {
  return { name, kind, content, sha256: await hashInput(content) };
}

async function validResult(toolId, artifacts) {
  return {
    job_id: JOB,
    status: "succeeded",
    execution_mode: "real",
    artifacts,
    provenance: {
      run_id: JOB,
      step_id: "step_1",
      tool: { id: toolId, version: getTool(toolId)?.version ?? "1.0.0", backend: "local-python" },
      input: { dataset_id: DATASET, sha256: null, filename: "sample.fasta" },
      parameters: {},
      database: { name: null, release: null, retrieved_at: null },
      output: { artifact_names: artifacts.map((item) => item.name), sha256: await hashInput("outputs") },
      timing: { started_at: new Date(NOW).toISOString(), finished_at: new Date(NOW + 1000).toISOString() },
      execution_mode: "real"
    },
    validation: { status: "pass", flags: [], checked_rules: ["schema"] },
    explanation: {
      summary: "Contract check.",
      findings: [],
      limitations: [],
      references: [],
      uncertainty: "low"
    }
  };
}

async function profileResult() {
  return validResult("sequence-stats.validate", [
    await artifact("validation.json", "json", '{"total_records":2,"valid_records":2,"invalid_records":0,"records":[]}')
  ]);
}

test("missing required declared outputs are rejected (artifacts and provenance)", async () => {
  const check = await profileResult();
  assert.equal(validateResultShape(check, JOB).valid, true);

  check.artifacts = [];
  check.provenance.output.artifact_names = [];
  let invalid = validateResultShape(check, JOB);
  assert.equal(invalid.valid, false);
  assert.match(invalid.error, /Missing declared output: validation/);

  // Present as an artifact but omitted from provenance: still incomplete.
  const missingFromProvenance = await profileResult();
  missingFromProvenance.provenance.output.artifact_names = [];
  invalid = validateResultShape(missingFromProvenance, JOB);
  assert.equal(invalid.valid, false);
  assert.match(invalid.error, /provenance\.output\.artifact_names|Missing declared output/);

  // A partial set for a multi-output tool is rejected too.
  const partial = await validResult("phylogenetics.workflow", [
    await artifact("alignment.fasta", "fasta", ">seq1\nACGT\n")
  ]);
  invalid = validateResultShape(partial, JOB);
  assert.equal(invalid.valid, false);
  assert.match(invalid.error, /Missing declared output/);
});

test("declared object/array/number output types are enforced from the schema", async () => {
  const wrongObject = await profileResult();
  wrongObject.artifacts[0].content = "[1,2,3]";
  wrongObject.artifacts[0].sha256 = await hashInput(wrongObject.artifacts[0].content);
  let invalid = validateResultShape(wrongObject, JOB);
  assert.equal(invalid.valid, false);
  assert.match(invalid.error, /validation.*JSON object/);

  // Synthetic tool proves the check is schema-driven, not tool-name-driven.
  const synthetic = {
    id: "tests.schema-types",
    version: "1.0.0",
    output_schema: {
      type: "object",
      required: ["items.json", "count.json"],
      properties: { "items.json": { type: "array" }, "count.json": { type: "number" } }
    }
  };
  TOOLS.push(synthetic);
  try {
    const good = await validResult(synthetic.id, [
      await artifact("items.json", "json", "[1,2]"),
      await artifact("count.json", "json", "2")
    ]);
    assert.equal(validateResultShape(good, JOB).valid, true);

    const badArray = structuredClone(good);
    badArray.artifacts[0].content = '{"not":"an array"}';
    badArray.artifacts[0].sha256 = await hashInput(badArray.artifacts[0].content);
    invalid = validateResultShape(badArray, JOB);
    assert.equal(invalid.valid, false);
    assert.match(invalid.error, /items\.json.*JSON array/);

    const badNumber = structuredClone(good);
    badNumber.artifacts[1].content = '"2"';
    badNumber.artifacts[1].sha256 = await hashInput(badNumber.artifacts[1].content);
    invalid = validateResultShape(badNumber, JOB);
    assert.equal(invalid.valid, false);
    assert.match(invalid.error, /count\.json.*JSON number/);
  } finally {
    TOOLS.splice(TOOLS.indexOf(synthetic), 1);
  }
});

test("malformed JSON in a declared object artifact is rejected", async () => {
  const result = await profileResult();
  result.artifacts[0].content = "{not json";
  result.artifacts[0].sha256 = await hashInput(result.artifacts[0].content);
  const invalid = validateResultShape(result, JOB);
  assert.equal(invalid.valid, false);
  assert.match(invalid.error, /not valid JSON/);
});

test("incomplete provenance is rejected field by field", async () => {
  const base = await profileResult();
  const cases = [
    ["run_id", (result) => { delete result.provenance.run_id; }, /run_id/],
    ["step_id", (result) => { delete result.provenance.step_id; }, /step_id/],
    ["tool.version", (result) => { delete result.provenance.tool.version; }, /tool\.version/],
    ["tool.backend", (result) => { delete result.provenance.tool.backend; }, /tool\.backend/],
    ["input.sha256 key", (result) => { delete result.provenance.input.sha256; }, /input\.sha256/],
    ["output.sha256", (result) => { delete result.provenance.output.sha256; }, /output\.sha256/],
    ["timing.started_at", (result) => { delete result.provenance.timing.started_at; }, /started_at/],
    ["timing.finished_at", (result) => { delete result.provenance.timing.finished_at; }, /finished_at/],
    ["execution_mode", (result) => { delete result.provenance.execution_mode; }, /provenance\.execution_mode/]
  ];
  for (const [label, mutate, expected] of cases) {
    const result = structuredClone(base);
    mutate(result);
    const invalid = validateResultShape(result, JOB);
    assert.equal(invalid.valid, false, `${label} must be required`);
    assert.match(invalid.error, expected, label);
  }
  // input.sha256 may be null, but the key must exist (already true in base).
  assert.equal(validateResultShape(base, JOB).valid, true);
});

test("unexpected artifact names are rejected; agent report.html is allowed", async () => {
  const base = await profileResult();
  const withExtra = structuredClone(base);
  withExtra.artifacts.push({ name: "surprise.json", kind: "json", content: "{}", sha256: await hashInput("{}") });
  withExtra.provenance.output.artifact_names.push("surprise.json");
  let invalid = validateResultShape(withExtra, JOB);
  assert.equal(invalid.valid, false);
  assert.match(invalid.error, /Unexpected artifact name: surprise\.json/);

  const withReport = structuredClone(base);
  withReport.artifacts.push({ name: "report.html", kind: "html", content: "<html>ok</html>", sha256: await hashInput("<html>ok</html>") });
  withReport.provenance.output.artifact_names.push("report.html");
  assert.equal(validateResultShape(withReport, JOB).valid, true);

  // A failed step legitimately emits only the generic report.
  const failed = await validResult("sequence-stats.validate", []);
  failed.status = "failed";
  failed.artifacts.push({ name: "report.html", kind: "html", content: "<html>failed</html>", sha256: await hashInput("<html>failed</html>") });
  failed.provenance.output.artifact_names = ["report.html"];
  assert.equal(validateResultShape(failed, JOB).valid, true);
});

test("invalid or missing execution_mode labels are rejected", async () => {
  const base = await profileResult();
  const badTop = structuredClone(base);
  badTop.execution_mode = "simulated";
  let invalid = validateResultShape(badTop, JOB);
  assert.equal(invalid.valid, false);
  assert.match(invalid.error, /execution_mode/);

  const badProvenance = structuredClone(base);
  badProvenance.provenance.execution_mode = "simulated";
  invalid = validateResultShape(badProvenance, JOB);
  assert.equal(invalid.valid, false);
  assert.match(invalid.error, /provenance\.execution_mode/);

  const missing = structuredClone(base);
  delete missing.execution_mode;
  invalid = validateResultShape(missing, JOB);
  assert.equal(invalid.valid, false);
  assert.match(invalid.error, /execution_mode/);
});

test("artifact SHA-256 mismatch is rejected at submission", async () => {
  const fake = createFakeD1AI();
  const env = mockAIEnv(fake.db);
  const created = await handleCreateRequest(
    makePostRequest({ text: "validate my FASTA", fasta: FASTA, filename: "sample.fasta" }, "/api/ai/requests"),
    env,
    { now: NOW }
  );
  assert.equal(created.status, 200);
  const body = await created.json();
  const approved = await handleApprove(
    makePostRequest({ approvals: [{ step_id: "step_1", approved: true }], consents: [] }, "/api/ai/plans/x/approve"),
    env,
    body.plan_id,
    { now: NOW }
  );
  const jobId = (await approved.json()).job_ids[0];
  const polled = await handlePollJobs(
    makeGetRequest("/api/ai/jobs", { "X-Agent-Token": "test-agent-token" }),
    env,
    { now: NOW }
  );
  assert.equal((await polled.json()).jobs[0].id, jobId);

  const result = await validResult("sequence-stats.profile", [
    await artifact("validation.json", "json", '{"total_records":2,"valid_records":2,"invalid_records":0,"records":[]}'),
    await artifact("statistics.json", "json", '{"summary":{"total_records":2},"records":[]}')
  ]);
  result.job_id = jobId;
  result.provenance.run_id = jobId;
  result.provenance.input.dataset_id = body.dataset_id;
  result.artifacts[0].sha256 = "0".repeat(64);
  const response = await handleSubmitResult(
    makePostRequest(result, `/api/ai/jobs/${jobId}/result`, { "X-Agent-Token": "test-agent-token" }),
    env,
    jobId,
    { now: NOW }
  );
  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /hash mismatch/);
});
