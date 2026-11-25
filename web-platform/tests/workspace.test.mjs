import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { publicCatalog, getWorkflow } from "../providers/workspace/catalog.js";
import { canTransition, runSummary } from "../providers/workspace/states.js";

const HERE = dirname(fileURLToPath(import.meta.url));

test("M7.4 catalog contains exactly the two existing scientific capabilities", () => {
  const catalog = publicCatalog();
  assert.equal(catalog.length, 2);
  assert.deepEqual(catalog.map((w) => w.id), ["16s-identification", "phylogenetics-msa-tree"]);
});
test("M7.4 phylogenetics catalog is honest about blocked remote execution", () => {
  const phylo = getWorkflow("phylogenetics-msa-tree");
  assert.equal(phylo.availability, "blocked");
  assert.ok(phylo.blocked_reason.includes("rotation"));
});
test("M7.4 16S catalog reports local availability and outputs", () => {
  const wf = getWorkflow("16s-identification");
  assert.equal(wf.availability, "available");
  assert.ok(wf.expected_outputs.includes("taxonomy.json"));
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
test("M7.4 demo UI labels sample data as precomputed", () => {
  const text = readFileSync(resolve(HERE, "../public/js/workspace.js"), "utf8");
  assert.ok(text.includes("/api/workspace/demo"));
  const html = readFileSync(resolve(HERE, "../public/workspace.html"), "utf8");
  assert.ok(html.includes("precomputed"));
});
