import test from "node:test";
import assert from "node:assert/strict";
import { handleCreateRun, handleListRuns } from "../functions/api/workspace/projects/[id]/runs.js";
import { handleGetRun, handlePatchRun } from "../functions/api/workspace/runs/[id]/index.js";
import { handleGetWorkspaceProvenance } from "../functions/api/workspace/runs/[id]/provenance.js";
import { handleGetWorkspaceReport } from "../functions/api/workspace/runs/[id]/report.js";
import { STATE_TRANSITIONS, WORKSPACE_STATES, isValidTransition } from "../functions/api/workspace/_lib.js";
import {
  makeRequest, TOKEN_A, TOKEN_B, ownerOf, newWorkspaceEnv, SHA256_A, SHA256_B, COMPLETE_PROVENANCE
} from "./helpers/workspace.mjs";

const PROJECT = "proj_1111111111111111";
const PROJECT_B = "proj_2222222222222222";
const DATASET = "ds_1111111111111111";
const RUN = "run_1111111111111111";

function idsFactory() {
  let counter = 0;
  return (prefix) => `${prefix}_${(++counter).toString(16).padStart(16, "0")}`;
}

async function baseSeed(ownerA, ownerB, runState = "draft") {
  return {
    projects: [
      { public_id: PROJECT, name: "Mine", owner: ownerA, status: "active", created_at: "2026-11-26T00:00:00.000Z" },
      { public_id: PROJECT_B, name: "Theirs", owner: ownerB, status: "active", created_at: "2026-11-26T00:00:00.000Z" }
    ],
    datasets: [
      { public_id: DATASET, project_id: PROJECT, owner: ownerA, filename: "input.fasta", sha256: SHA256_A, size_bytes: 100, created_at: "2026-11-26T00:00:01.000Z" }
    ],
    workspace_runs: [
      {
        public_id: RUN, project_id: PROJECT, owner: ownerA,
        workflow_id: "16s-rrna-identification", workflow_version: "1.0.0",
        objective: "Identify isolates", input_datasets_json: JSON.stringify([DATASET]),
        params_json: JSON.stringify({ database: "16S_ribosomal_RNA" }),
        execution_provider: null, execution_mode: "real", state: runState,
        created_at: "2026-11-26T00:00:02.000Z", completed_at: null,
        steps_json: null, artifact_refs_json: null, validation_json: null,
        provenance_json: null, error_json: null, is_demo: 0
      }
    ]
  };
}

function runPayload(extra = {}) {
  return {
    workflow_id: "16s-rrna-identification",
    dataset_ids: [DATASET],
    params: { database: "16S_ribosomal_RNA" },
    objective: "Identify the isolates",
    ...extra
  };
}

test("run creation produces a draft record linked to an approved owner project", async () => {
  const ownerA = await ownerOf(TOKEN_A);
  const { env, state } = newWorkspaceEnv(await baseSeed(ownerA, await ownerOf(TOKEN_B)));
  const response = await handleCreateRun(makeRequest("POST", `/api/workspace/projects/${PROJECT}/runs`, TOKEN_A, runPayload()), env, PROJECT, { idFactory: idsFactory() });
  assert.equal(response.status, 201);
  const body = await response.json();
  assert.equal(body.executed, false);
  assert.equal(body.run.state, "draft");
  assert.equal(body.run.workflow_id, "16s-rrna-identification");
  assert.deepEqual(body.run.input_datasets, [DATASET]);
  const stored = state.tables.workspace_runs.find((row) => row.public_id === body.run.id);
  assert.equal(stored.project_id, PROJECT);
  assert.equal(stored.owner, ownerA);
  assert.equal(stored.steps_json, null);
  assert.equal(stored.artifact_refs_json, null);
  assert.equal(state.tables.jobs?.length ?? 0, 0);
  assert.equal(state.tables.audit_events[0].detail_json.includes("executed\":false"), true);
});

test("run creation rejects unknown workflow ids", async () => {
  const ownerA = await ownerOf(TOKEN_A);
  const { env } = newWorkspaceEnv(await baseSeed(ownerA, await ownerOf(TOKEN_B)));
  const response = await handleCreateRun(
    makeRequest("POST", `/api/workspace/projects/${PROJECT}/runs`, TOKEN_A, runPayload({ workflow_id: "galaxy-production" })),
    env, PROJECT, { idFactory: idsFactory() }
  );
  assert.equal(response.status, 400);
});

test("run creation rejects datasets outside the project or with bad ids", async () => {
  const ownerA = await ownerOf(TOKEN_A);
  const { env } = newWorkspaceEnv(await baseSeed(ownerA, await ownerOf(TOKEN_B)));
  for (const datasetIds of [["ds_9999999999999999"], ["not-an-id"], [], ["ds_1111111111111111", "ds_9999999999999999"]]) {
    const response = await handleCreateRun(
      makeRequest("POST", `/api/workspace/projects/${PROJECT}/runs`, TOKEN_A, runPayload({ dataset_ids: datasetIds })),
      env, PROJECT, { idFactory: idsFactory() }
    );
    assert.equal(response.status, 400, JSON.stringify(datasetIds));
  }
});

test("run creation caps params and rejects non-object params", async () => {
  const ownerA = await ownerOf(TOKEN_A);
  const { env } = newWorkspaceEnv(await baseSeed(ownerA, await ownerOf(TOKEN_B)));
  const tooLarge = await handleCreateRun(
    makeRequest("POST", `/api/workspace/projects/${PROJECT}/runs`, TOKEN_A, runPayload({ params: { blob: "x".repeat(17000) } })),
    env, PROJECT, { idFactory: idsFactory() }
  );
  assert.equal(tooLarge.status, 400);
  const notObject = await handleCreateRun(
    makeRequest("POST", `/api/workspace/projects/${PROJECT}/runs`, TOKEN_A, runPayload({ params: ["array"] })),
    env, PROJECT, { idFactory: idsFactory() }
  );
  assert.equal(notObject.status, 400);
});

test("run list is owner-scoped and includes workflow and validation summary", async () => {
  const ownerA = await ownerOf(TOKEN_A);
  const ownerB = await ownerOf(TOKEN_B);
  const seed = await baseSeed(ownerA, ownerB);
  seed.workspace_runs.push({
    ...seed.workspace_runs[0], public_id: "run_2222222222222222", owner: ownerB,
    workflow_id: "msa-phylogenetics", state: "succeeded", validation_json: JSON.stringify({ status: "pass" })
  });
  const { env } = newWorkspaceEnv(seed);
  const response = await handleListRuns(makeRequest("GET", `/api/workspace/projects/${PROJECT}/runs`), env, PROJECT);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.count, 1);
  assert.equal(body.runs[0].id, RUN);
  assert.equal(body.runs[0].workflow_name.length > 0, true);
  assert.equal(body.runs[0].validation_status, "pending");
  assert.ok(!JSON.stringify(body).includes("run_2222222222222222"));
});

test("run detail returns inputs, params and report availability", async () => {
  const ownerA = await ownerOf(TOKEN_A);
  const { env } = newWorkspaceEnv(await baseSeed(ownerA, await ownerOf(TOKEN_B)));
  const response = await handleGetRun(makeRequest("GET", `/api/workspace/runs/${RUN}`), env, RUN);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.deepEqual(body.run.input_datasets, [DATASET]);
  assert.deepEqual(body.run.params, { database: "16S_ribosomal_RNA" });
  assert.equal(body.run.report_available, false);
  assert.equal(body.run.report_access, null);
});

test("cross-owner run detail is a 404 and does not leak run metadata", async () => {
  const ownerA = await ownerOf(TOKEN_A);
  const ownerB = await ownerOf(TOKEN_B);
  const { env } = newWorkspaceEnv(await baseSeed(ownerA, ownerB));
  const crossEnv = { AI_DB: env.AI_DB, AI_AGENT_TOKEN: TOKEN_B };
  const response = await handleGetRun(makeRequest("GET", `/api/workspace/runs/${RUN}`, TOKEN_B), crossEnv, RUN);
  assert.equal(response.status, 404);
  assert.ok(!(await response.json()).error.includes("Identify isolates"));
});

test("the transition map keeps execution, retrieval and validation distinct", () => {
  assert.deepEqual(WORKSPACE_STATES.length, 11);
  assert.equal(isValidTransition("draft", "planned"), true);
  assert.equal(isValidTransition("planned", "awaiting_approval"), true);
  assert.equal(isValidTransition("awaiting_approval", "queued"), true);
  assert.equal(isValidTransition("queued", "running"), true);
  assert.equal(isValidTransition("running", "execution_completed"), true);
  assert.equal(isValidTransition("execution_completed", "artifact_retrieval"), true);
  assert.equal(isValidTransition("artifact_retrieval", "validation"), true);
  assert.equal(isValidTransition("validation", "succeeded"), true);
  assert.equal(Object.keys(STATE_TRANSITIONS).length, WORKSPACE_STATES.length);
});

test("illegal transitions are rejected with 409", async () => {
  const ownerA = await ownerOf(TOKEN_A);
  const { env } = newWorkspaceEnv(await baseSeed(ownerA, await ownerOf(TOKEN_B)));
  for (const next of ["running", "succeeded", "queued", "draft"]) {
    const response = await handlePatchRun(makeRequest("PATCH", `/api/workspace/runs/${RUN}`, TOKEN_A, { state: next }), env, RUN);
    assert.equal(response.status, 409, next);
    assert.match((await response.json()).error, /Illegal transition/);
  }
});

test("terminal states accept no further transitions", async () => {
  const ownerA = await ownerOf(TOKEN_A);
  const seed = await baseSeed(ownerA, await ownerOf(TOKEN_B), "succeeded");
  const { env } = newWorkspaceEnv(seed);
  const response = await handlePatchRun(makeRequest("PATCH", `/api/workspace/runs/${RUN}`, TOKEN_A, { state: "running" }), env, RUN);
  assert.equal(response.status, 409);
});

test("a full legal lifecycle can reach succeeded with bookkeeping fields", async () => {
  const ownerA = await ownerOf(TOKEN_A);
  const { env, state } = newWorkspaceEnv(await baseSeed(ownerA, await ownerOf(TOKEN_B)));
  const sequence = ["planned", "awaiting_approval", "queued", "running", "execution_completed", "artifact_retrieval", "validation"];
  for (const next of sequence) {
    const payload = { state: next };
    if (next === "execution_completed") payload.steps = [{ step_id: "step_1", tool_id: "blastn" }];
    if (next === "artifact_retrieval") payload.artifact_refs = [{ name: "taxonomy.json", sha256: SHA256_B }];
    if (next === "validation") payload.validation = { status: "pass" };
    const response = await handlePatchRun(makeRequest("PATCH", `/api/workspace/runs/${RUN}`, TOKEN_A, payload), env, RUN);
    assert.equal(response.status, 200, next);
    assert.equal((await response.json()).run.state, next);
  }
  const stored = state.tables.workspace_runs[0];
  assert.equal(stored.state, "validation");
  assert.deepEqual(JSON.parse(stored.steps_json), [{ step_id: "step_1", tool_id: "blastn" }]);
  assert.deepEqual(JSON.parse(stored.artifact_refs_json), [{ name: "taxonomy.json", sha256: SHA256_B }]);
  assert.deepEqual(JSON.parse(stored.validation_json), { status: "pass" });
  assert.equal(stored.completed_at, null);
});

test("succeeded requires complete provenance and writes an immutable record", async () => {
  const ownerA = await ownerOf(TOKEN_A);
  const { env, state } = newWorkspaceEnv(await baseSeed(ownerA, await ownerOf(TOKEN_B), "validation"));
  const rejected = await handlePatchRun(
    makeRequest("PATCH", `/api/workspace/runs/${RUN}`, TOKEN_A, { state: "succeeded", provenance: { workflow_id: "16s-rrna-identification" } }),
    env, RUN, { idFactory: idsFactory() }
  );
  assert.equal(rejected.status, 409);
  assert.match((await rejected.json()).error, /Incomplete provenance/);
  const accepted = await handlePatchRun(
    makeRequest("PATCH", `/api/workspace/runs/${RUN}`, TOKEN_A, { state: "succeeded", provenance: COMPLETE_PROVENANCE }),
    env, RUN, { idFactory: idsFactory() }
  );
  assert.equal(accepted.status, 200);
  const body = await accepted.json();
  assert.equal(body.run.state, "succeeded");
  assert.equal(body.run.completed_at !== null, true);
  assert.equal(body.run.provenance.workflow_id, "16s-rrna-identification");
  assert.equal(state.tables.provenance_records.length, 1);
  assert.equal(state.tables.provenance_records[0].run_id, RUN);
  assert.equal(state.tables.provenance_records[0].owner, ownerA);
  assert.match(state.tables.provenance_records[0].public_id, /^prov_/);
});

test("PATCH rejects an invalid state and cross-owner writes", async () => {
  const ownerA = await ownerOf(TOKEN_A);
  const ownerB = await ownerOf(TOKEN_B);
  const { env, state } = newWorkspaceEnv(await baseSeed(ownerA, ownerB));
  const invalid = await handlePatchRun(makeRequest("PATCH", `/api/workspace/runs/${RUN}`, TOKEN_A, { state: "teleported" }), env, RUN);
  assert.equal(invalid.status, 400);
  const before = JSON.stringify(state.tables.workspace_runs[0]);
  const cross = await handlePatchRun(makeRequest("PATCH", `/api/workspace/runs/${RUN}`, TOKEN_B, { state: "planned" }), { AI_DB: env.AI_DB, AI_AGENT_TOKEN: TOKEN_B }, RUN);
  assert.equal(cross.status, 404);
  assert.equal(JSON.stringify(state.tables.workspace_runs[0]), before);
});

test("PATCH rejects oversized and non-object bookkeeping fields", async () => {
  const ownerA = await ownerOf(TOKEN_A);
  const { env } = newWorkspaceEnv(await baseSeed(ownerA, await ownerOf(TOKEN_B)));
  const oversized = await handlePatchRun(
    makeRequest("PATCH", `/api/workspace/runs/${RUN}`, TOKEN_A, { state: "planned", steps: "x".repeat(70000) }),
    env, RUN
  );
  assert.equal(oversized.status, 400);
  const wrongType = await handlePatchRun(
    makeRequest("PATCH", `/api/workspace/runs/${RUN}`, TOKEN_A, { state: "planned", artifact_refs: "string" }),
    env, RUN
  );
  assert.equal(wrongType.status, 400);
});

test("provenance endpoint returns the complete record for succeeded runs", async () => {
  const ownerA = await ownerOf(TOKEN_A);
  const { env } = newWorkspaceEnv({
    ...(await baseSeed(ownerA, await ownerOf(TOKEN_B), "succeeded")),
    provenance_records: [
      { public_id: "prov_1111111111111111", run_id: RUN, owner: ownerA, record_json: JSON.stringify(COMPLETE_PROVENANCE), created_at: "2026-11-26T00:00:03.000Z" }
    ]
  });
  const response = await handleGetWorkspaceProvenance(makeRequest("GET", `/api/workspace/runs/${RUN}/provenance`), env, RUN);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.complete, true);
  assert.equal(body.provenance.input_sha256, SHA256_A);
  assert.equal(body.provenance.tools[0].version, "2.17.0");
  assert.equal(body.provenance.artifact_retrieval_state, "retrieved");
  assert.equal(body.provenance.report_generated_at.length > 0, true);
});

test("provenance endpoint fails closed for missing records and cross-owner reads", async () => {
  const ownerA = await ownerOf(TOKEN_A);
  const ownerB = await ownerOf(TOKEN_B);
  const { env } = newWorkspaceEnv(await baseSeed(ownerA, ownerB, "succeeded"));
  const missing = await handleGetWorkspaceProvenance(makeRequest("GET", `/api/workspace/runs/${RUN}/provenance`), env, RUN);
  assert.equal(missing.status, 404);
  const cross = await handleGetWorkspaceProvenance(
    makeRequest("GET", `/api/workspace/runs/${RUN}/provenance`, TOKEN_B),
    { AI_DB: env.AI_DB, AI_AGENT_TOKEN: TOKEN_B }, RUN
  );
  assert.equal(cross.status, 404);
});

test("succeeded run with stored but incomplete provenance returns 409", async () => {
  const ownerA = await ownerOf(TOKEN_A);
  const { env } = newWorkspaceEnv({
    ...(await baseSeed(ownerA, await ownerOf(TOKEN_B), "succeeded")),
    provenance_records: [
      { public_id: "prov_2222222222222222", run_id: RUN, owner: ownerA, record_json: JSON.stringify({ workflow_id: "16s-rrna-identification" }), created_at: "2026-11-26T00:00:03.000Z" }
    ]
  });
  const response = await handleGetWorkspaceProvenance(makeRequest("GET", `/api/workspace/runs/${RUN}/provenance`), env, RUN);
  assert.equal(response.status, 409);
});

test("report endpoint returns 404 when no report exists", async () => {
  const ownerA = await ownerOf(TOKEN_A);
  const { env } = newWorkspaceEnv(await baseSeed(ownerA, await ownerOf(TOKEN_B), "succeeded"));
  const response = await handleGetWorkspaceReport(makeRequest("GET", `/api/workspace/runs/${RUN}/report`), env, RUN);
  assert.equal(response.status, 404);
  assert.match((await response.json()).error, /not available/);
});

test("report endpoint reads persisted report HTML from report_runs", async () => {
  const ownerA = await ownerOf(TOKEN_A);
  const { env } = newWorkspaceEnv({
    ...(await baseSeed(ownerA, await ownerOf(TOKEN_B), "succeeded")),
    report_runs: [
      { public_id: "rpt_1111111111111111", plan_id: "plan_1111111111111111", job_id: RUN, report_html: "<p>real report</p>", created_at: "2026-11-26T00:00:04.000Z" }
    ]
  });
  const response = await handleGetWorkspaceReport(makeRequest("GET", `/api/workspace/runs/${RUN}/report`), env, RUN);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.report_html, "<p>real report</p>");
  assert.equal(body.public_url, undefined);
  assert.equal(body.execution_mode, "real");
});

test("report endpoint authorizes through the parent run", async () => {
  const ownerA = await ownerOf(TOKEN_A);
  const ownerB = await ownerOf(TOKEN_B);
  const { env } = newWorkspaceEnv({
    ...(await baseSeed(ownerA, ownerB, "succeeded")),
    report_runs: [
      { public_id: "rpt_1111111111111111", plan_id: "plan_1111111111111111", job_id: RUN, report_html: "<p>private</p>", created_at: "2026-11-26T00:00:04.000Z" }
    ]
  });
  const cross = await handleGetWorkspaceReport(
    makeRequest("GET", `/api/workspace/runs/${RUN}/report`, TOKEN_B),
    { AI_DB: env.AI_DB, AI_AGENT_TOKEN: TOKEN_B }, RUN
  );
  assert.equal(cross.status, 404);
  assert.ok(!(await cross.json()).error.includes("private"));
});

test("run detail surfaces an existing report as available", async () => {
  const ownerA = await ownerOf(TOKEN_A);
  const { env } = newWorkspaceEnv({
    ...(await baseSeed(ownerA, await ownerOf(TOKEN_B), "succeeded")),
    report_runs: [
      { public_id: "rpt_1111111111111111", plan_id: "plan_1111111111111111", job_id: RUN, report_html: "<p>report</p>", created_at: "2026-11-26T00:00:04.000Z" }
    ]
  });
  const response = await handleGetRun(makeRequest("GET", `/api/workspace/runs/${RUN}`), env, RUN);
  const body = await response.json();
  assert.equal(body.run.report_available, true);
  assert.equal(body.run.report_access, `/api/workspace/runs/${RUN}/report`);
});
