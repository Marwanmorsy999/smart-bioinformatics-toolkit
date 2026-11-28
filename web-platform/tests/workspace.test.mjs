import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { publicCatalog, getWorkflow } from "../providers/workspace/catalog.js";
import { canTransition, runSummary, RUN_STATES } from "../providers/workspace/states.js";
import {
  CATALOG_VERSION,
  listWorkflows,
  WORKFLOWS,
  WORKFLOW_IDS
} from "../functions/api/workspace/catalog.js";
import {
  STATE_TRANSITIONS, WORKSPACE_STATES, toProjectDto, toDatasetDto, toRunSummary
} from "../functions/api/workspace/_lib.js";
import { SQL, SQL_META } from "../functions/api/ai/_lib.js";
import { onRequest as catchAll } from "../functions/api/workspace/index.js";
import { makeRequest, TOKEN_A } from "./helpers/workspace.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const AUTHORITATIVE_IDS = ["16s-rrna-identification", "msa-phylogenetics"];

test("M7.4 browser-facing catalog has exactly the two authoritative workflows", () => {
  const catalog = publicCatalog();
  assert.equal(catalog.length, 2);
  assert.deepEqual(catalog.map((workflow) => workflow.id), AUTHORITATIVE_IDS);
  assert.deepEqual(WORKFLOW_IDS, AUTHORITATIVE_IDS);
});

test("M7.4 shim and authoritative catalog never drift", () => {
  assert.deepEqual(publicCatalog(), listWorkflows());
  assert.deepEqual(publicCatalog().map((workflow) => workflow.id), listWorkflows().map((workflow) => workflow.id));
  for (const id of AUTHORITATIVE_IDS) {
    assert.deepEqual(getWorkflow(id), listWorkflows().find((workflow) => workflow.id === id));
  }
});

test("M7.4 catalog exposes authoritative availability states and scientific fields", () => {
  const identification = getWorkflow("16s-rrna-identification");
  const phylo = getWorkflow("msa-phylogenetics");
  assert.equal(identification.execution_availability.state, "available-browser-and-local-agent");
  assert.equal(identification.execution_availability.production_ready, true);
  assert.ok(identification.supported_formats.includes("fasta"));
  assert.ok(identification.scientific_purpose.length > 0);
  assert.ok(identification.expected_outputs.includes("taxonomy assignments"));

  assert.equal(phylo.execution_availability.state, "partial-not-production-ready");
  assert.equal(phylo.execution_availability.production_ready, false);
  assert.match(phylo.execution_availability.note, /M7_3_PHYLOGENETICS_WORKFLOW_REPORT\.md/);
  assert.match(phylo.execution_availability.note, /NOT verified|not verified/);
  assert.ok(phylo.required_parameters.includes("sequences"));
});

test("M7.4 state shim re-exports the one authoritative transition map", () => {
  assert.equal(RUN_STATES, WORKSPACE_STATES);
  assert.equal(Object.keys(STATE_TRANSITIONS).length, WORKSPACE_STATES.length);
  assert.deepEqual(RUN_STATES, [
    "draft", "planned", "awaiting_approval", "queued", "running",
    "execution_completed", "artifact_retrieval", "validation", "succeeded", "failed", "cancelled"
  ]);
});

test("M7.4 run lifecycle transitions are explicit", () => {
  assert.equal(canTransition("draft", "planned"), true);
  assert.equal(canTransition("planned", "queued"), false);
  assert.equal(canTransition("awaiting_approval", "queued"), true);
  assert.equal(canTransition("running", "execution_completed"), true);
  assert.equal(canTransition("execution_completed", "artifact_retrieval"), true);
  assert.equal(canTransition("artifact_retrieval", "validation"), true);
  assert.equal(canTransition("validation", "succeeded"), true);
  assert.equal(canTransition("succeeded", "running"), false);
});

test("M7.4 stage reporting never claims success from a partial stage", () => {
  const mid = runSummary({ state: "execution_completed" });
  assert.equal(mid.execution_completed, true);
  assert.equal(mid.artifact_retrieved, false);
  assert.equal(mid.validated, false);
  assert.equal(mid.full_workflow_completed, false);
  const done = runSummary({ state: "succeeded" });
  assert.equal(done.full_workflow_completed, true);
});

test("M7.4 catch-all catalog alias matches the authoritative workflow endpoint shape", async () => {
  const response = await catchAll({ request: makeRequest("GET", "/api/workspace/catalog"), env: { AI_AGENT_TOKEN: TOKEN_A, BLAST_DB: {} } });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("X-Content-Type-Options"), "nosniff");
  assert.match(response.headers.get("Content-Security-Policy"), /default-src 'none'/);
  const body = await response.json();
  assert.equal(body.catalog_version, CATALOG_VERSION);
  assert.equal(body.count, 2);
  assert.deepEqual(body.workflows.map((workflow) => workflow.id), AUTHORITATIVE_IDS);
  assert.equal(typeof body.execution_mode, "string");
});

test("M7.4 catch-all requires the operator token and 404s all other paths", async () => {
  const env = { AI_AGENT_TOKEN: TOKEN_A, BLAST_DB: {} };
  const denied = await catchAll({ request: makeRequest("GET", "/api/workspace/catalog", null), env });
  assert.equal(denied.status, 401);
  for (const path of ["/api/workspace/projects", "/api/workspace/runs/run_1", "/api/workspace/anything-else"]) {
    const response = await catchAll({ request: makeRequest("GET", path), env });
    assert.equal(response.status, 404, path);
    assert.match(response.headers.get("Content-Type"), /application\/json/);
    assert.equal(response.headers.get("X-Content-Type-Options"), "nosniff");
    assert.equal((await response.json()).error, "Workspace route not found.");
  }
});

test("M7.4 catch-all shim contains no SQL for nonexistent tables", () => {
  const source = readFileSync(resolve(HERE, "../functions/api/workspace/index.js"), "utf8");
  assert.doesNotMatch(source, /workspace_projects|workspace_datasets/);
  assert.match(source, /handleDemo/);
});

test("M7.4 demo UI labels sample data as precomputed", () => {
  const text = readFileSync(resolve(HERE, "../public/js/workspace.js"), "utf8");
  assert.ok(text.includes("/api/workspace/demo"));
  const html = readFileSync(resolve(HERE, "../public/workspace.html"), "utf8");
  assert.ok(html.includes("precomputed"));
});

test("M7.4 catch-all demo delegates to the authoritative labelled payload", async () => {
  const env = { AI_AGENT_TOKEN: TOKEN_A, BLAST_DB: {} };
  const throughShim = await catchAll({ request: makeRequest("GET", "/api/workspace/demo"), env });
  assert.equal(throughShim.status, 200);
  const body = await throughShim.json();
  assert.equal(body.sample, true);
  assert.equal(body.execution_mode, "precomputed");
  assert.match(body.disclaimer, /NOT a newly executed analysis/);
  assert.equal(body.project.id, "proj_0000000000000000");
});

test("M7.4 browser catalog mirror matches authoritative id -> availability pairs", () => {
  const source = readFileSync(resolve(HERE, "../public/js/workspace.js"), "utf8");
  const start = source.indexOf("const LOCAL_CATALOG");
  const end = source.indexOf("// Display legend");
  assert.ok(start > -1 && end > start);
  const block = source.slice(start, end);
  const ids = [...block.matchAll(/id: "([^"]+)"/g)].map((match) => match[1]);
  assert.deepEqual(ids, WORKFLOW_IDS);
  // Pair each id with the availability it actually advertises, rather than
  // merely checking that the two state strings occur somewhere in the file.
  const pairs = [...block.matchAll(
    /id: "([^"]+)"[\s\S]*?execution_availability: Object\.freeze\(\{\s*state: "([^"]+)",\s*production_ready: (true|false)/g
  )].map((match) => [match[1], match[2], match[3] === "true"]);
  const expected = WORKFLOWS.map((workflow) => [
    workflow.id,
    workflow.execution_availability.state,
    workflow.execution_availability.production_ready
  ]);
  assert.deepEqual(pairs, expected);
  assert.doesNotMatch(block, /16s-identification|phylogenetics-msa-tree/);
});

test("M7.4 browser UI keeps tokens out of storage and URLs", () => {
  const source = readFileSync(resolve(HERE, "../public/js/workspace.js"), "utf8");
  assert.ok(source.includes("m74_workspace_local_v1"));
  assert.doesNotMatch(source, /localStorage\.(?:setItem|getItem)\([^)]*token/i);
  assert.doesNotMatch(source, /[?&]token=/i);
  assert.doesNotMatch(source, /innerHTML/);
  assert.match(source, /X-Agent-Token/);
});

test("M7.4 workspace HTML is local-first, labelled and accessible", () => {
  const html = readFileSync(resolve(HERE, "../public/workspace.html"), "utf8");
  assert.ok(html.includes(
    "Local browser session — not persisted to the server; no server-side ownership applies. " +
    "For durable owner-scoped projects, operators can use the authenticated API."));
  assert.match(html, /id="ws-status" role="status" aria-live="polite"/);
  assert.match(html, /<details id="ws-operator">/);
  assert.match(html, /not a visitor login/);
  assert.match(html, /Metadata only — no file bytes are stored; provider references are not proof of durable storage\./);
  assert.match(html, /SAMPLE \/ PRECOMPUTED/);
  for (const href of ["index.html", "ai.html", "blast.html", "phylo.html"]) {
    assert.ok(html.includes(`href="${href}"`), `workspace nav is missing ${href}`);
  }
  assert.match(html, /class="active" href="workspace\.html" aria-current="location"/);
  assert.doesNotMatch(html, /onclick\s*=/i);
  assert.doesNotMatch(html, /\b(?:src|href)\s*=\s*["']https?:\/\//i);
});

test("M7.4 every entry page links back to the research workspace", () => {
  for (const page of ["index.html", "ai.html", "blast.html", "phylo.html"]) {
    const html = readFileSync(resolve(HERE, `../public/${page}`), "utf8");
    assert.ok(html.includes('href="workspace.html"'), `${page} nav is missing Research workspace`);
  }
  // Only the workflow destinations need the small project-context note.
  for (const page of ["ai.html", "blast.html", "phylo.html"]) {
    const html = readFileSync(resolve(HERE, `../public/${page}`), "utf8");
    assert.ok(html.includes('id="project-context"'), `${page} is missing the project context note`);
  }
  const context = readFileSync(resolve(HERE, "../public/js/project-context.js"), "utf8");
  assert.match(context, /URLSearchParams/);
  assert.match(context, /textContent/);
});

test("M7.4 public DTOs never expose the derived owner digest", () => {
  const row = {
    public_id: "proj_1111111111111111", name: "P", owner: "owner_deadbeefdeadbeef",
    description: null, scientific_objective: null, status: "active", created_at: "2026-11-26T00:00:00.000Z"
  };
  const project = toProjectDto(row, { dataset_count: 1, run_count: 2 });
  const dataset = toDatasetDto({ ...row, public_id: "ds_1111111111111111", project_id: row.public_id, filename: "x.fasta", sha256: "a".repeat(64), size_bytes: 1 });
  const run = toRunSummary({ ...row, public_id: "run_1111111111111111", workflow_id: "16s-rrna-identification" });
  for (const dto of [project, dataset, run]) {
    assert.equal(Object.hasOwn(dto, "owner"), false);
    assert.equal(JSON.stringify(dto).includes("owner_deadbeefdeadbeef"), false);
  }
  assert.equal(project.dataset_count, 1);
  assert.equal(project.run_count, 2);
});

test("M7.4 dead workspace dataset SQL is removed from SQL and SQL_META", () => {
  assert.equal(Object.hasOwn(SQL, "getWorkspaceDataset"), false);
  assert.equal(Object.values(SQL_META).some((meta) => meta?.table === "datasets" && meta.where?.includes("project_id") && meta.where?.includes("public_id")), false);
  // The owner-scoped list statement must remain for the live endpoints.
  assert.equal(typeof SQL.listDatasetsForProject, "string");
});

test("M7.4 workspace page and controller opt out of caching only", () => {
  const headers = readFileSync(resolve(HERE, "../public/_headers"), "utf8");
  assert.match(headers, /^\/workspace\.html\r?\n\s+Cache-Control: no-store\r?\n/m);
  assert.match(headers, /^\/js\/workspace\.js\r?\n\s+Cache-Control: no-store/m);
  // No broad no-store override for other assets was introduced.
  assert.equal((headers.match(/Cache-Control:/g) ?? []).length, 2);
});
