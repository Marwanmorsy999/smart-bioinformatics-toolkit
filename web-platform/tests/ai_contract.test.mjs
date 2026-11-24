import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { hashInput, resolveBlastConsent } from "../functions/api/blast/_lib.js";
import { classifyIntent, buildPlan } from "../functions/api/ai/planner.js";
import { TOOLS, getTool } from "../functions/api/ai/registry.js";
import { errorResponse, validatePlan, validateResultShape } from "../functions/api/ai/_lib.js";
import { safeCsvCell } from "../public/js/csv-safe.js";
import { handleCreateRequest } from "../functions/api/ai/requests/index.js";
import { handleGetPlan } from "../functions/api/ai/plans/[id]/index.js";
import { handleApprove } from "../functions/api/ai/plans/[id]/approve.js";
import { handlePollJobs } from "../functions/api/ai/jobs/index.js";
import { handleSubmitResult } from "../functions/api/ai/jobs/[id]/result.js";
import { handleGetRun } from "../functions/api/ai/runs/[id]/index.js";
import { handleGetReport } from "../functions/api/ai/runs/[id]/report.js";
import { handleGetProvenance } from "../functions/api/ai/runs/[id]/provenance.js";
import { onRequest as toolsOnRequest } from "../functions/api/tools.js";
import { createFakeD1AI, makeGetRequest, makePostRequest, mockAIEnv } from "./helpers/fake-d1.mjs";

const NOW = Date.parse("2026-11-24T12:00:00.000Z");
const FASTA = ">seq1 example\nACGTACGTACGT\n>seq2\nTTTTGGGGCCCC\n";
const HERE = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS = resolve(HERE, "../migrations");

function envWithDb() {
  const fake = createFakeD1AI();
  return { fake, env: mockAIEnv(fake.db) };
}

async function createRequest(env, overrides = {}) {
  const payload = { text: "Profile my FASTA and show GC statistics", fasta: FASTA, filename: "sample.fasta", ...overrides };
  const response = await handleCreateRequest(makePostRequest(payload, "/api/ai/requests"), env, { now: NOW });
  return { response, body: await response.json() };
}

async function approve(env, planId, approvals, consents) {
  const response = await handleApprove(
    makePostRequest({ approvals, consents }, `/api/ai/plans/${planId}/approve`),
    env,
    planId,
    { now: NOW }
  );
  return { response, body: await response.json() };
}

function makeResult(jobId, datasetId, overrides = {}) {
  const content = JSON.stringify({ validation: { summary: { total_records: 2 } }, statistics: { summary: { gc_percent_mean: 50 } } });
  return {
    job_id: jobId,
    status: "succeeded",
    execution_mode: "real",
    artifacts: [{ name: "analysis.json", kind: "json", sha256: "", content }],
    provenance: {
      run_id: jobId,
      step_id: "step_1",
      tool: { id: "sequence-stats.profile", version: "1.0.0", backend: "local-python" },
      input: { dataset_id: datasetId, sha256: "abc123", filename: "sample.fasta" },
      parameters: { sequence_type: "dna" },
      database: { name: null, release: null, retrieved_at: null },
      output: { artifact_names: ["analysis.json"], sha256: "def456" },
      timing: { started_at: new Date(NOW).toISOString(), finished_at: new Date(NOW + 2000).toISOString() },
      execution_mode: "real"
    },
    validation: { status: "pass", flags: [], checked_rules: ["schema", "hash"] },
    explanation: {
      summary: "Two sequences were validated.",
      findings: [{ text: "Mean GC is 50%.", artifact: "analysis.json", field_path: "statistics.summary.gc_percent_mean" }],
      limitations: ["Descriptive statistics only."],
      references: [],
      uncertainty: "low"
    },
    logs: ["tool finished"],
    ...overrides
  };
}

test("planner classifies intents from keywords and asks for clarification when unsure", () => {
  assert.equal(classifyIntent("validate my FASTA and calculate GC statistics").intent, "validate_and_profile");
  assert.equal(classifyIntent("check sequence stats and composition").intent, "validate_and_profile");
  const taxa = classifyIntent("identify taxa: classify these BLAST hits");
  assert.equal(taxa.intent, "identify_taxa");
  assert.ok(taxa.confidence >= 0.5);
  const unclear = classifyIntent("please help with this file");
  assert.equal(unclear.intent, null);
  assert.ok(unclear.confidence < 0.5);
  assert.match(unclear.clarifyingQuestion, /clarify/i);
});

test("planner builds a registry-only plan with no external egress", () => {
  const built = buildPlan({
    text: "profile my FASTA",
    datasetId: "ds_0123456789abcdef",
    requestId: "req_0123456789abcdef",
    now: NOW
  });
  assert.ok(built.plan);
  const plan = built.plan;
  assert.deepEqual(Object.keys(plan).sort(), [
    "confidence", "consents_required", "created_at", "domain", "external_services", "intent", "limitations",
    "plan_id", "request_id", "steps"
  ].sort());
  assert.equal(plan.intent, "validate_and_profile");
  assert.equal(plan.domain, "sequence-analysis");
  assert.equal(plan.steps.length, 1);
  assert.equal(plan.steps[0].tool_id, "sequence-stats.profile");
  assert.equal(plan.steps[0].backend, "local-python");
  assert.deepEqual(plan.steps[0].params, { sequence_type: "dna" });
  assert.deepEqual(plan.steps[0].inputs, ["dataset:ds_0123456789abcdef"]);
  assert.equal(plan.steps[0].external_egress, false);
  assert.equal(plan.steps[0].consent_required, false);
  assert.deepEqual(plan.external_services, []);
  assert.deepEqual(plan.consents_required, []);
  assert.equal(validatePlan(plan).valid, true);
  // The registry is extensible; additional tools may be registered elsewhere.
  assert.ok(TOOLS.length >= 4 && getTool("sequence-stats.profile"));
  assert.equal(getTool("sequence-stats.profile").available, true);
});

test("plan validation rejects unknown tools and egress without consent", () => {
  const { plan } = buildPlan({
    text: "GC stats",
    datasetId: "ds_0123456789abcdef",
    requestId: "req_0123456789abcdef",
    now: NOW
  });
  const unknown = structuredClone(plan);
  unknown.steps[0].tool_id = "invented.tool";
  assert.match(validatePlan(unknown).error, /Unknown tool/);

  const egress = structuredClone(plan);
  egress.steps[0].external_egress = true;
  assert.match(validatePlan(egress).error, /consent_required/);
});

test("approval gate creates jobs only for approved steps", async () => {
  const { fake, env } = envWithDb();
  const { body } = await createRequest(env);
  const none = await approve(env, body.plan_id, [], []);
  assert.equal(none.response.status, 200);
  assert.deepEqual(none.body.job_ids, []);

  const declined = await approve(env, body.plan_id, [{ step_id: "step_1", approved: false }], []);
  assert.deepEqual(declined.body.job_ids, []);
  assert.equal(fake.state.tables.jobs?.length ?? 0, 0);

  const approved = await approve(env, body.plan_id, [{ step_id: "step_1", approved: true }], []);
  assert.equal(approved.response.status, 200);
  assert.equal(approved.body.job_ids.length, 1);
  assert.match(approved.body.job_ids[0], /^job_[0-9a-f]{16}$/);

  const second = await approve(env, body.plan_id, [{ step_id: "step_1", approved: true }], []);
  assert.deepEqual(second.body.job_ids, approved.body.job_ids, "repeat approval returns existing jobs instead of duplicating them");
  assert.equal(fake.state.tables.jobs.length, 1);
});

test("consent gate blocks steps that require consent when consent is denied", async () => {
  const planId = "plan_1111111111111111";
  const consentPlan = {
    plan_id: planId,
    request_id: "req_1111111111111111",
    domain: "microbiome-16s",
    intent: "identify_taxa",
    confidence: 0.8,
    created_at: new Date(NOW).toISOString(),
    steps: [{
      id: "step_1",
      tool_id: "sequence-stats.profile",
      backend: "local-python",
      params: { sequence_type: "dna" },
      inputs: ["dataset:ds_1111111111111111"],
      external_egress: false,
      consent_required: true,
      estimated_seconds: 5
    }],
    external_services: [],
    consents_required: ["external-blast"],
    limitations: []
  };
  const fake = createFakeD1AI({ plans: [{ public_id: planId, plan_json: JSON.stringify(consentPlan) }] });
  const env = mockAIEnv(fake.db);

  const denied = await approve(env, planId, [{ step_id: "step_1", approved: true, consent_granted: false }], []);
  assert.deepEqual(denied.body.job_ids, []);
  assert.equal(denied.body.skipped[0].reason, "consent_denied");
  assert.equal(fake.state.tables.jobs?.length ?? 0, 0);

  const granted = await approve(env, planId, [{ step_id: "step_1", approved: true, consent_granted: true }], ["external-blast"]);
  assert.equal(granted.body.job_ids.length, 1);
  assert.equal(fake.state.tables.jobs.length, 1);
});

test("end-to-end API: request, plan, approval, authenticated jobs, result, run, report, provenance", async () => {
  const { fake, env } = envWithDb();

  const created = await createRequest(env);
  assert.equal(created.response.status, 200);
  assert.match(created.body.request_id, /^req_[0-9a-f]{16}$/);
  assert.match(created.body.dataset_id, /^ds_[0-9a-f]{16}$/);
  assert.match(created.body.plan_id, /^plan_[0-9a-f]{16}$/);
  assert.equal(created.body.preflight.valid, true);
  assert.equal(created.body.plan.plan_id, created.body.plan_id);
  assert.equal(created.body.execution_mode, "real");

  const planResponse = await handleGetPlan(makeGetRequest(`/api/ai/plans/${created.body.plan_id}`), env, created.body.plan_id);
  assert.equal((await planResponse.json()).plan_id, created.body.plan_id);

  const approved = await approve(env, created.body.plan_id, [{ step_id: "step_1", approved: true }], []);
  const jobId = approved.body.job_ids[0];

  const noToken = await handlePollJobs(makeGetRequest("/api/ai/jobs"), env, {});
  assert.equal(noToken.status, 401);
  const wrongToken = await handlePollJobs(makeGetRequest("/api/ai/jobs", { "X-Agent-Token": "nope" }), env, {});
  assert.equal(wrongToken.status, 401);

  const poll = await handlePollJobs(makeGetRequest("/api/ai/jobs?agentId=worker-1", { "X-Agent-Token": "test-agent-token" }), env, { now: NOW });
  assert.equal(poll.status, 200);
  const pollBody = await poll.json();
  assert.equal(pollBody.jobs.length, 1);
  assert.equal(pollBody.jobs[0].id, jobId);
  assert.equal(pollBody.jobs[0].status, "running");
  assert.equal(pollBody.jobs[0].inputs.fasta_text, FASTA);
  assert.deepEqual(pollBody.jobs[0].params, { sequence_type: "dna" });
  assert.equal(pollBody.execution_mode, "real");

  const pollAgain = await handlePollJobs(makeGetRequest("/api/ai/jobs", { "X-Agent-Token": "test-agent-token" }), env, { now: NOW });
  assert.equal((await pollAgain.json()).jobs.length, 0);

  const result = makeResult(jobId, created.body.dataset_id);
  result.artifacts[0].content = "<script>alert(1)</script>";
  result.artifacts[0].sha256 = await hashInput(result.artifacts[0].content);
  result.explanation.summary = "<img src=x onerror=alert(1)> unsafe summary";
  const badHash = await handleSubmitResult(
    makePostRequest({ ...result, artifacts: [{ ...result.artifacts[0], sha256: "0".repeat(64) }] }, `/api/ai/jobs/${jobId}/result`, { "X-Agent-Token": "test-agent-token" }),
    env,
    jobId,
    { now: NOW }
  );
  assert.equal(badHash.status, 400);

  const submitted = await handleSubmitResult(
    makePostRequest(result, `/api/ai/jobs/${jobId}/result`, { "X-Agent-Token": "test-agent-token" }),
    env,
    jobId,
    { now: NOW }
  );
  assert.equal(submitted.status, 200);
  const submittedBody = await submitted.json();
  assert.equal(submittedBody.job_id, jobId);
  assert.equal(submittedBody.status, "succeeded");
  assert.equal(submittedBody.execution_mode, "real");
  assert.equal(submittedBody.report_url, `/api/ai/runs/${jobId}/report`);

  const runResponse = await handleGetRun(makeGetRequest(`/api/ai/runs/${jobId}`), env, jobId);
  assert.equal(runResponse.status, 200);
  const runBody = await runResponse.json();
  assert.equal(runBody.execution_mode, "real");
  assert.equal(runBody.plan.plan_id, created.body.plan_id);
  assert.equal(runBody.jobs[0].status, "succeeded");
  assert.equal(runBody.artifacts[0].name, "analysis.json");
  assert.equal(runBody.validation.status, "pass");
  assert.equal(runBody.explanation.uncertainty, "low");
  assert.equal(runBody.report_url, `/api/ai/runs/${jobId}/report`);

  const reportResponse = await handleGetReport(makeGetRequest(`/api/ai/runs/${jobId}/report`), env, jobId);
  assert.equal(reportResponse.status, 200);
  const html = await reportResponse.text();
  assert.match(html, /Reproducibility/);
  assert.match(html, /Limitations/);
  assert.match(reportResponse.headers.get("Content-Type"), /text\/html/);
  assert.equal(html.includes("<script>"), false);
  assert.equal(html.includes("<img src=x"), false);
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt; unsafe summary/);

  const provenanceResponse = await handleGetProvenance(makeGetRequest(`/api/ai/runs/${jobId}/provenance`), env, jobId);
  assert.equal(provenanceResponse.status, 200);
  const provenance = await provenanceResponse.json();
  assert.equal(provenance.run_id, jobId);
  assert.equal(provenance.tool.id, "sequence-stats.profile");
  assert.equal(provenance.execution_mode, "real");

  assert.equal(fake.state.tables.artifacts.length, 1);
  assert.equal(fake.state.tables.tool_runs.length, 1);
  assert.equal(fake.state.tables.report_runs.length, 1);
  assert.ok(fake.state.tables.audit_events.length >= 5);
});

test("mock execution mode is reported and downgrades validation", async () => {
  const { env } = envWithDb();
  const created = await createRequest(env);
  await approve(env, created.body.plan_id, [{ step_id: "step_1", approved: true }], []);
  const poll = await handlePollJobs(makeGetRequest("/api/ai/jobs", { "X-Agent-Token": "test-agent-token" }), env, {});
  const jobId = (await poll.json()).jobs[0].id;

  const result = makeResult(jobId, created.body.dataset_id, {
    execution_mode: "mock",
    validation: { status: "pass", flags: [], checked_rules: ["schema"] }
  });
  result.artifacts[0].sha256 = await hashInput(result.artifacts[0].content);
  const response = await handleSubmitResult(
    makePostRequest(result, `/api/ai/jobs/${jobId}/result`, { "X-Agent-Token": "test-agent-token" }),
    env,
    jobId,
    { now: NOW }
  );
  assert.equal(response.status, 200);
  assert.equal((await response.json()).execution_mode, "mock");
  const run = await handleGetRun(makeGetRequest(`/api/ai/runs/${jobId}`), env, jobId);
  const body = await run.json();
  assert.equal(body.execution_mode, "mock");
  assert.equal(body.validation.status, "warn");
  assert.match(body.validation.flags.join(" "), /mock mode/i);
});

test("low-confidence requests are not persisted and return a clarifying question", async () => {
  const { fake, env } = envWithDb();
  const response = await handleCreateRequest(
    makePostRequest({ text: "hello there", fasta: FASTA, filename: "sample.fasta" }, "/api/ai/requests"),
    env,
    { now: NOW }
  );
  assert.equal(response.status, 422);
  const body = await response.json();
  assert.match(body.clarifying_question, /clarify/i);
  assert.equal(fake.state.tables.plans?.length ?? 0, 0);
});

test("GET /api/tools lists the core tools with availability flags", async () => {
  const response = await toolsOnRequest({ request: makeGetRequest("/api/tools"), env: mockAIEnv(createFakeD1AI().db) });
  assert.equal(response.status, 200);
  const body = await response.json();
  const ids = body.tools.map((tool) => tool.id);
  // Additional tools may be registered by other workstreams; the four
  // original MVP tools must always remain present and typed.
  assert.ok(body.tools.length >= 4);
  for (const id of [
    "sequence-stats.validate",
    "sequence-stats.profile",
    "microbiome-16s.blast-parse",
    "microbiome-16s.taxonomy"
  ]) assert.ok(ids.includes(id), `missing registered tool: ${id}`);
  assert.ok(body.tools.every((tool) => typeof tool.available === "boolean" && tool.params_schema));
  assert.equal(body.execution_mode, "real");
});

test("result shape validation rejects missing fields", () => {
  assert.equal(validateResultShape({}, "job_0123456789abcdef").valid, false);
  assert.equal(validateResultShape(makeResult("job_0123456789abcdef", "ds_0123456789abcdef"), "job_other").valid, false);
});

test("migration SQL runs in real SQLite: 11 AI tables + blast_consents, blast_requests untouched", () => {
  const db = new DatabaseSync(":memory:");
  try {
    db.exec(readFileSync(resolve(MIGRATIONS, "0001_create_blast_requests.sql"), "utf8"));
    db.exec("INSERT INTO blast_requests (rid, status, created_at, last_checked_at, input_hash, result_tsv) VALUES ('RID1', 'queued', '2026-01-01T00:00:00.000Z', NULL, 'hash', NULL)");
    db.exec(readFileSync(resolve(MIGRATIONS, "0002_ai_platform.sql"), "utf8"));
    db.exec(readFileSync(resolve(MIGRATIONS, "0003_blast_consent.sql"), "utf8"));

    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all()
      .map((row) => row.name)
      .filter((name) => !name.startsWith("sqlite_"));
    const expected = [
      "projects", "datasets", "ai_requests", "plans", "approvals", "jobs", "tool_runs",
      "artifacts", "evidence_references", "report_runs", "audit_events", "blast_requests", "blast_consents"
    ];
    for (const table of expected) assert.ok(tables.includes(table), `missing table: ${table}`);
    assert.equal(tables.includes("references"), false);

    const blast = db.prepare("SELECT rid, status, created_at, input_hash FROM blast_requests WHERE rid = 'RID1'").get();
    assert.deepEqual({ ...blast }, { rid: "RID1", status: "queued", created_at: "2026-01-01T00:00:00.000Z", input_hash: "hash" });
    const consentColumns = db.prepare("PRAGMA table_info(blast_consents)").all().map((row) => row.name);
    assert.deepEqual(consentColumns, [
      "token", "input_hash", "database", "program", "granted", "expires_at", "created_at", "used_at"
    ]);
    const indexes = db.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name LIKE 'idx_%'").all();
    assert.ok(indexes.length >= 11, `expected at least 11 indexes, got ${indexes.length}`);
  } finally {
    db.close();
  }
});

function storedPlan(planId, stepOverrides = {}) {
  return {
    plan_id: planId,
    request_id: `req_${planId.slice(5)}`,
    domain: "microbiome-16s",
    intent: "identify_taxa",
    confidence: 0.8,
    created_at: new Date(NOW).toISOString(),
    steps: [{
      id: "step_1",
      tool_id: "sequence-stats.profile",
      backend: "local-python",
      params: { sequence_type: "dna" },
      inputs: ["dataset:ds_1111111111111111"],
      external_egress: false,
      consent_required: false,
      estimated_seconds: 5,
      ...stepOverrides
    }],
    external_services: [],
    consents_required: [],
    limitations: []
  };
}

test("external_egress steps require consent and invalid stored plans are rejected", async () => {
  const invalidId = "plan_2222222222222222";
  const invalid = storedPlan(invalidId, { external_egress: true }); // egress without consent violates the contract
  const invalidFake = createFakeD1AI({ plans: [{ public_id: invalidId, plan_json: JSON.stringify(invalid) }] });
  const invalidApproval = await approve(mockAIEnv(invalidFake.db), invalidId, [{ step_id: "step_1", approved: true, consent_granted: false }], []);
  assert.equal(invalidApproval.response.status, 500);
  assert.equal(invalidFake.state.tables.jobs?.length ?? 0, 0);

  const validId = "plan_3333333333333333";
  const valid = storedPlan(validId, { external_egress: true, consent_required: true });
  const fake = createFakeD1AI({ plans: [{ public_id: validId, plan_json: JSON.stringify(valid) }] });
  const denied = await approve(mockAIEnv(fake.db), validId, [{ step_id: "step_1", approved: true, consent_granted: false }], []);
  assert.equal(denied.response.status, 200);
  assert.deepEqual(denied.body.job_ids, []);
  assert.equal(denied.body.skipped[0].reason, "consent_denied");
  assert.equal(fake.state.tables.jobs?.length ?? 0, 0);
  assert.equal(denied.body.blast_consent, undefined, "denied consent never issues a token");
});

test("approval with external egress and consent issues a usable BLAST token", async () => {
  const planId = "plan_4444444444444444";
  const datasetId = "ds_4444444444444444";
  const plan = storedPlan(planId, {
    external_egress: true,
    consent_required: true,
    inputs: [`dataset:${datasetId}`],
    params: { sequence_type: "dna" }
  });
  const fake = createFakeD1AI({
    plans: [{ public_id: planId, plan_json: JSON.stringify(plan) }],
    datasets: [{ public_id: datasetId, fasta_text: FASTA, filename: "sample.fasta" }]
  });
  const env = mockAIEnv(fake.db);
  const approved = await approve(env, planId, [{ step_id: "step_1", approved: true, consent_granted: true }], ["external-blast"]);
  assert.equal(approved.response.status, 200);
  assert.equal(approved.body.job_ids.length, 1);
  assert.ok(approved.body.blast_consent, "approval response returns the token to the browser");
  const grant = approved.body.blast_consent;
  assert.match(grant.token, /^consent_[0-9a-f]{32}$/);
  assert.equal(grant.input_hash, await hashInput(FASTA));
  assert.equal(grant.database, "16S_ribosomal_RNA");
  assert.equal(grant.program, "blastn");
  assert.equal(Date.parse(grant.expires_at) > NOW, true);

  const resolved = await resolveBlastConsent(fake.db, grant.token, {
    inputHash: grant.input_hash,
    database: grant.database,
    program: grant.program,
    now: NOW
  });
  assert.equal(resolved.valid, true);
  assert.equal(fake.state.tables.blast_consents.length, 1);
  assert.equal(fake.state.tables.blast_consents[0].granted, 1);
  assert.ok(fake.state.tables.audit_events.some((event) => event.action === "ai_blast_consent_issued"));
});

async function queuedJobId(env) {
  const created = await createRequest(env);
  const approved = await approve(env, created.body.plan_id, [{ step_id: "step_1", approved: true }], []);
  return { datasetId: created.body.dataset_id, jobId: approved.body.job_ids[0] };
}

async function submit(jobId, datasetId, result, env) {
  return handleSubmitResult(
    makePostRequest(result, `/api/ai/jobs/${jobId}/result`, { "X-Agent-Token": "test-agent-token" }),
    env,
    jobId,
    { now: NOW }
  );
}

test("operator mock mode overrides an agent-reported real result everywhere", async () => {
  const { fake, env } = envWithDb();
  env.AI_EXECUTION_MODE = "mock";
  const { datasetId, jobId } = await queuedJobId(env);
  const result = makeResult(jobId, datasetId); // self-reported "real"
  result.artifacts[0].sha256 = await hashInput(result.artifacts[0].content);

  const submitted = await submit(jobId, datasetId, result, env);
  assert.equal(submitted.status, 200);
  assert.equal((await submitted.json()).execution_mode, "mock");

  const runBody = await (await handleGetRun(makeGetRequest(`/api/ai/runs/${jobId}`), env, jobId)).json();
  assert.equal(runBody.execution_mode, "mock");
  assert.equal(runBody.validation.status, "warn");
  assert.match(runBody.validation.flags.join(" "), /mock mode/i);
  const provenance = await (await handleGetProvenance(makeGetRequest(`/api/ai/runs/${jobId}/provenance`), env, jobId)).json();
  assert.equal(provenance.execution_mode, "mock");

  const jobRow = fake.state.tables.jobs.find((row) => row.public_id === jobId);
  assert.equal(jobRow.execution_mode, "mock");
  assert.equal(JSON.parse(jobRow.provenance_json).execution_mode, "mock");
  assert.equal(JSON.parse(jobRow.result_json).execution_mode, "mock");
});

test("result submissions without execution_mode are rejected", async () => {
  const { env } = envWithDb();
  const { datasetId, jobId } = await queuedJobId(env);
  const result = makeResult(jobId, datasetId);
  delete result.execution_mode;
  const response = await submit(jobId, datasetId, result, env);
  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /execution_mode/);
});

test("provenance run_id and tool.id are cross-checked against the job", async () => {
  const { env } = envWithDb();
  const { datasetId, jobId } = await queuedJobId(env);
  const base = makeResult(jobId, datasetId);
  base.artifacts[0].sha256 = await hashInput(base.artifacts[0].content);

  const badRun = structuredClone(base);
  badRun.provenance.run_id = "job_9999999999999999";
  const runResponse = await submit(jobId, datasetId, badRun, env);
  assert.equal(runResponse.status, 400);
  assert.match((await runResponse.json()).error, /run_id/);

  const badTool = structuredClone(base);
  badTool.provenance.tool.id = "invented.tool";
  const toolResponse = await submit(jobId, datasetId, badTool, env);
  assert.equal(toolResponse.status, 400);
  assert.match((await toolResponse.json()).error, /tool\.id/);

  assert.equal((await submit(jobId, datasetId, base, env)).status, 200);
});

test("JSON errors are raw text; UI escapes at render time", async () => {
  const response = errorResponse("<b>bad</b> input");
  assert.equal((await response.json()).error, "<b>bad</b> input");
  const ui = readFileSync(resolve(HERE, "../public/js/ai-workspace.js"), "utf8");
  assert.match(ui, /elements\.error\.textContent = message/);
});

test("CSV guard neutralises whitespace-prefixed formulas", () => {
  assert.equal(safeCsvCell("  =1+1"), "  '=1+1");
  assert.equal(safeCsvCell("\t@SUM(A1)"), "\t'@SUM(A1)");
  assert.equal(safeCsvCell("normal text"), "normal text");
  assert.equal(safeCsvCell("=1+1"), "'=1+1");
});

test("consent UI follows step egress/consent flags, not only plan.consents_required", () => {
  const ui = readFileSync(resolve(HERE, "../public/js/ai-workspace.js"), "utf8");
  const html = readFileSync(resolve(HERE, "../public/ai.html"), "utf8");
  assert.match(ui, /step\.external_egress === true \|\| step\.consent_required === true/);
  assert.match(ui, /needsConsent \? elements\.consentCheck\.checked/);
  assert.match(html, /id="consent-label-text"/);
});
