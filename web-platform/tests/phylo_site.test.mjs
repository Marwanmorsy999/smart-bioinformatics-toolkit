import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import { hashInput } from "../functions/api/blast/_lib.js";
import { classifyIntent, buildPlan } from "../functions/api/ai/planner.js";
import { TOOLS, getTool, validateParams } from "../functions/api/ai/registry.js";
import { validatePlan } from "../functions/api/ai/_lib.js";
import { handleCreateRequest } from "../functions/api/ai/requests/index.js";
import { handleApprove } from "../functions/api/ai/plans/[id]/approve.js";
import { handlePollJobs } from "../functions/api/ai/jobs/index.js";
import { handleSubmitResult } from "../functions/api/ai/jobs/[id]/result.js";
import { handleGetRun } from "../functions/api/ai/runs/[id]/index.js";
import { handleGetReport } from "../functions/api/ai/runs/[id]/report.js";
import { handleGetProvenance } from "../functions/api/ai/runs/[id]/provenance.js";
import { createFakeD1AI, makeGetRequest, makePostRequest, mockAIEnv } from "./helpers/fake-d1.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const NOW = Date.parse("2026-11-24T12:00:00.000Z");
const FASTA = ">seq1 example\nACGTACGTACGTACGTACGT\n>seq2\nTTTTGGGGCCCCAAAATTTT\n>seq3\nACGTACGTGGGGCCCCAAAA\n";
const PHYLO_TEXT = "build a phylogenetic tree from my FASTA";
const PRESET_TEXT = "Build a phylogenetic tree from my FASTA and show me the alignment and report";
const UNAVAILABLE = "Phylogenetic analysis is not available on this deployment.";

function phyloAvailable() {
  const tool = getTool("phylogenetics.workflow");
  return Boolean(tool && tool.available === true);
}

function envWithDb() {
  const fake = createFakeD1AI();
  return { fake, env: mockAIEnv(fake.db) };
}

async function createRequest(env, text = PHYLO_TEXT) {
  const response = await handleCreateRequest(
    makePostRequest({ text, fasta: FASTA, filename: "phylo.fasta" }, "/api/ai/requests"),
    env,
    { now: NOW }
  );
  return { response, body: await response.json() };
}

async function artifact(name, kind, content) {
  return { name, kind, content, sha256: await hashInput(content) };
}

async function phyloResult(jobId, datasetId) {
  const artifacts = [
    await artifact("alignment.fasta", "fasta", ">seq1\nACGTACGTACGT\n>seq2\nACGTTCGTACGT\n>seq3\nACGTACGTTCGT\n"),
    await artifact("tree.nwk", "newick", "(seq1:0.05,seq2:0.10,seq3:0.10);\n"),
    await artifact("tree.svg", "svg", '<svg xmlns="http://www.w3.org/2000/svg"><text>tree</text></svg>'),
    await artifact("phylo_report.html", "html", "<html><body>phylo report</body></html>")
  ];
  return {
    job_id: jobId,
    status: "succeeded",
    execution_mode: "real",
    artifacts,
    provenance: {
      run_id: jobId,
      step_id: "step_1",
      tool: { id: "phylogenetics.workflow", version: "1.0.0", backend: "local-python" },
      input: { dataset_id: datasetId, sha256: await hashInput(FASTA), filename: "phylo.fasta" },
      parameters: { sequence_type: "dna" },
      database: { name: null, release: null, retrieved_at: null },
      output: { artifact_names: artifacts.map((item) => item.name), sha256: await hashInput("outputs") },
      timing: { started_at: new Date(NOW).toISOString(), finished_at: new Date(NOW + 1000).toISOString() },
      execution_mode: "real"
    },
    validation: { status: "pass", flags: [], checked_rules: ["schema", "hash"] },
    explanation: {
      summary: "The phylogenetic workflow produced an alignment, a tree and a report.",
      findings: [{ text: "Three sequences were aligned.", artifact: "alignment.fasta", field_path: "alignment.records" }],
      limitations: ["Progressive alignment is a heuristic.", "Neighbor joining uses identity distances; research use only."],
      references: [],
      uncertainty: "low"
    },
    logs: ["tool finished"]
  };
}

test("phylogenetics keywords classify cleanly without changing legacy intents", () => {
  const request = classifyIntent(PHYLO_TEXT);
  assert.equal(request.intent, "phylogenetics");
  assert.ok(request.confidence >= 0.5);
  assert.equal(request.clarifyingQuestion, null);
  assert.equal(classifyIntent(PRESET_TEXT).intent, "phylogenetics");
  assert.equal(classifyIntent("show me the evolutionary tree and clades").intent, "phylogenetics");
  assert.equal(classifyIntent("profile my FASTA").intent, "validate_and_profile");
  assert.equal(classifyIntent("identify taxa from BLAST hits").intent, "identify_taxa");
  const unclear = classifyIntent("please help with this file");
  assert.equal(unclear.intent, null);
  assert.ok(unclear.confidence < 0.5);
  assert.match(unclear.clarifyingQuestion, /clarify/i);
});

test("a phylogenetics request produces one allowlisted, available, no-egress step", (t) => {
  const tool = getTool("phylogenetics.workflow");
  if (!tool || tool.available !== true) {
    t.skip("phylogenetics.workflow composite tool is not registered on this deployment");
    return;
  }
  const { plan, clarifyingQuestion } = buildPlan({
    text: PHYLO_TEXT,
    datasetId: "ds_0123456789abcdef",
    requestId: "req_0123456789abcdef",
    now: NOW
  });
  assert.equal(clarifyingQuestion, null);
  assert.ok(plan);
  assert.equal(plan.domain, "phylogenetics");
  assert.equal(plan.intent, "phylogenetics");
  assert.equal(plan.steps.length, 1);
  assert.equal(plan.steps[0].id, "step_1");
  assert.equal(plan.steps[0].tool_id, "phylogenetics.workflow");
  assert.equal(plan.steps[0].backend, "local-python");
  assert.deepEqual(plan.steps[0].params, { sequence_type: "dna" });
  assert.equal(validateParams(plan.steps[0].tool_id, plan.steps[0].params).valid, true);
  assert.deepEqual(plan.steps[0].inputs, ["dataset:ds_0123456789abcdef"]);
  assert.equal(plan.steps[0].external_egress, false);
  assert.equal(plan.steps[0].consent_required, false);
  assert.equal(plan.steps[0].estimated_seconds, tool.estimated_seconds);
  assert.deepEqual(plan.external_services, []);
  assert.deepEqual(plan.consents_required, []);
  assert.equal(validatePlan(plan).valid, true);
  const limitations = plan.limitations.join(" ");
  assert.match(limitations, /research use only/i);
  assert.match(limitations, /heuristic/i);
  assert.match(limitations, /neighbor-joining/i);
  assert.match(limitations, /publication-grade/i);
});

test("unavailable phylogenetics tool returns a clarifying question and creates no plan or job", async () => {
  // Exercise the unavailable branch whether or not the composite tool has
  // landed yet: temporarily drop it from the in-memory registry when present.
  const tool = getTool("phylogenetics.workflow");
  const index = tool ? TOOLS.indexOf(tool) : -1;
  if (index >= 0) TOOLS.splice(index, 1);
  try {
    const direct = buildPlan({
      text: PHYLO_TEXT,
      datasetId: "ds_0123456789abcdef",
      requestId: "req_0123456789abcdef",
      now: NOW
    });
    assert.equal(direct.plan, null);
    assert.equal(direct.clarifyingQuestion, UNAVAILABLE);

    const { fake, env } = envWithDb();
    const { response, body } = await createRequest(env);
    assert.equal(response.status, 422);
    assert.equal(body.clarifying_question, UNAVAILABLE);
    assert.equal(fake.state.tables.plans?.length ?? 0, 0);
    assert.equal(fake.state.tables.jobs?.length ?? 0, 0);
  } finally {
    if (index >= 0) TOOLS.splice(index, 0, tool);
  }
});

test("website request → approve → real result → run/report/provenance returns phylo artifacts", async (t) => {
  if (!phyloAvailable()) {
    t.skip("phylogenetics.workflow composite tool is not registered on this deployment");
    return;
  }
  const { fake, env } = envWithDb();

  const created = await createRequest(env);
  assert.equal(created.response.status, 200);
  assert.equal(created.body.plan.intent, "phylogenetics");
  assert.equal(created.body.plan.domain, "phylogenetics");
  assert.equal(created.body.plan.steps.length, 1);
  assert.equal(created.body.plan.steps[0].tool_id, "phylogenetics.workflow");
  assert.equal(created.body.plan.steps[0].external_egress, false);
  assert.equal(getTool(created.body.plan.steps[0].tool_id).available, true);

  const approvalResponse = await handleApprove(
    makePostRequest(
      { approvals: [{ step_id: "step_1", approved: true }], consents: [] },
      `/api/ai/plans/${created.body.plan_id}/approve`
    ),
    env,
    created.body.plan_id,
    { now: NOW }
  );
  assert.equal(approvalResponse.status, 200);
  const jobId = (await approvalResponse.json()).job_ids[0];
  assert.ok(jobId);
  assert.equal(fake.state.tables.jobs.find((row) => row.public_id === jobId).tool_id, "phylogenetics.workflow");

  const poll = await handlePollJobs(
    makeGetRequest("/api/ai/jobs", { "X-Agent-Token": "test-agent-token" }),
    env,
    { now: NOW }
  );
  assert.equal(poll.status, 200);
  const jobs = (await poll.json()).jobs;
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].tool_id, "phylogenetics.workflow");
  assert.equal(jobs[0].external_egress, false);
  assert.equal(jobs[0].consent_required, false);

  const result = await phyloResult(jobId, created.body.dataset_id);
  const submitted = await handleSubmitResult(
    makePostRequest(result, `/api/ai/jobs/${jobId}/result`, { "X-Agent-Token": "test-agent-token" }),
    env,
    jobId,
    { now: NOW }
  );
  assert.equal(submitted.status, 200);
  const submittedBody = await submitted.json();
  assert.equal(submittedBody.execution_mode, "real");
  assert.equal(submittedBody.status, "succeeded");

  const runResponse = await handleGetRun(makeGetRequest(`/api/ai/runs/${jobId}`), env, jobId);
  assert.equal(runResponse.status, 200);
  const run = await runResponse.json();
  assert.equal(run.execution_mode, "real");
  assert.equal(run.plan.domain, "phylogenetics");
  assert.equal(run.jobs[0].status, "succeeded");
  assert.deepEqual(
    new Set(run.artifacts.map((item) => item.name)),
    new Set(["alignment.fasta", "tree.nwk", "tree.svg", "phylo_report.html"])
  );
  assert.ok(run.artifacts.every((item) => typeof item.content === "string" && item.content.length > 0));
  assert.equal(run.validation.status, "pass");

  const reportResponse = await handleGetReport(makeGetRequest(`/api/ai/runs/${jobId}/report`), env, jobId);
  assert.equal(reportResponse.status, 200);
  const html = await reportResponse.text();
  for (const name of ["alignment.fasta", "tree.nwk", "tree.svg", "phylo_report.html"]) {
    assert.ok(html.includes(name), `report omits artifact ${name}`);
  }
  assert.match(html, /Reproducibility/);
  assert.match(html, /Limitations/);
  assert.match(html, /phylogenetics\.workflow/);
  assert.equal(html.includes("<script>"), false);

  const provenanceResponse = await handleGetProvenance(makeGetRequest(`/api/ai/runs/${jobId}/provenance`), env, jobId);
  assert.equal(provenanceResponse.status, 200);
  const provenance = await provenanceResponse.json();
  assert.equal(provenance.tool.id, "phylogenetics.workflow");
  assert.equal(provenance.execution_mode, "real");
  assert.deepEqual(
    new Set(provenance.output.artifact_names),
    new Set(["alignment.fasta", "tree.nwk", "tree.svg", "phylo_report.html"])
  );
});

test("params validation generically rejects unknown parameters for any tool", () => {
  const strictTools = TOOLS.filter((tool) => tool.params_schema?.additionalProperties === false);
  assert.ok(strictTools.length > 0);
  for (const tool of strictTools) {
    assert.equal(
      validateParams(tool.id, { definitely_not_a_param: 1 }).valid,
      false,
      `${tool.id} should reject an unknown parameter`
    );
  }
  // Non-hardcoded checks: enums, types and numeric bounds come from schemas.
  assert.equal(validateParams("sequence-stats.profile", { sequence_type: "dna" }).valid, true);
  assert.equal(validateParams("sequence-stats.profile", { sequence_type: "rna" }).valid, false);
  assert.equal(validateParams("sequence-stats.profile", { sequence_type: 123 }).valid, false);
  assert.equal(validateParams("microbiome-16s.taxonomy", { min_identity: 50 }).valid, true);
  assert.equal(validateParams("microbiome-16s.taxonomy", { min_identity: 101 }).valid, false);
  assert.equal(validateParams("microbiome-16s.taxonomy", { top_n: 0 }).valid, false);
  assert.equal(validateParams("microbiome-16s.taxonomy", { schema: "bogus" }).valid, false);
});

test("website exposes a phylogenetics preset and generic artifact rendering without inline scripts", () => {
  const html = readFileSync(resolve(HERE, "../public/ai.html"), "utf8");
  const ui = readFileSync(resolve(HERE, "../public/js/ai-workspace.js"), "utf8");
  assert.match(html, /id="phylo-example"/);
  assert.match(html, /Build a phylogenetic tree from my FASTA and show me the alignment and report/);
  assert.match(html, /id="artifacts-box"/);
  assert.doesNotMatch(html, /onclick\s*=/i);
  assert.match(ui, /elements\.phyloExample\.dataset\.question/);
  assert.match(ui, /elements\.artifactsBox\.replaceChildren/);
  assert.match(ui, /artifact\.name/);
  assert.match(ui, /plan\.intent === "phylogenetics"/);
});
