// M7.11 OFFLINE RUN-ENDPOINT CONTRACT TESTS — fixture-based, labelled, no network.
// Every Galaxy call below is answered by an in-memory stub fetch. No live
// Galaxy job, upload, NCBI RID or CMD=Put request is ever issued.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import { handlePhyloRun } from "../functions/api/ai/workflows/phylo/run.js";
import { handleGetRun as handleAiRun } from "../functions/api/ai/runs/[id]/index.js";
import { handleGetRun as handleWorkspaceRun } from "../functions/api/workspace/runs/[id]/index.js";
import { createFakeD1AI, makeGetRequest, mockAIEnv } from "./helpers/fake-d1.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const fixture = (name) => readFileSync(resolve(HERE, "fixtures/m7_11_phylo", name), "utf8");
const NOW = Date.parse("2026-11-26T12:00:00.000Z");
const INPUT_FASTA = ">taxon_a\nACGTACGTACG\n>taxon_b\nACGTACGTTCG\n>taxon_c\nACGTTCGTACG\n";
const ALIGNMENT = fixture("mafft_output.fasta");
const TREE = "(taxon_a:0.1,(taxon_b:0.2,taxon_c:0.3)95/87:0.4);\n";
const TREE_WRONG_TIPS = "(taxon_a:0.1,taxon_x:0.2);\n";

const FIX = Object.freeze({
  historyId: "11ac94870d0bb33adfdcc31d5164dd84",
  inputHda: "aaaaaaaa1111bbbb2222cccc3333dddd",
  mafftHda: "bbbbbbbb1111cccc2222dddd3333eeee",
  treeHda: "cccccccc1111dddd2222eeee3333ffff",
  reportHda: "dddddddd1111eeee2222ffff3333aaaa",
  logHda: "eeeeeeee1111ffff2222aaaa3333bbbb",
  decoyFastaHda: "ffffffff0000aaaa1111bbbb2222cccc",
  mafftId: "toolshed.g2.bx.psu.edu/repos/rnateam/mafft/rbc_mafft/7.526+galaxy2",
  iqtreeId: "toolshed.g2.bx.psu.edu/repos/iuc/iqtree/iqtree/3.1.4+galaxy1",
  mafftVersion: "7.526+galaxy2",
  iqtreeVersion: "3.1.4+galaxy1",
  datasetUuid: "cf2a6760-b219-4212-a609-aa37286628f5"
});

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function makeStub({ alignmentContent = ALIGNMENT, treeContent = TREE, includeAlignment = true,
  includeTree = true, initialPhase = 0, extraFastas = [],
  logContent = "IQ-TREE log µ\n" } = {}) {
  const calls = [];
  let phase = initialPhase;
  const contents = () => {
    const items = [{ id: FIX.inputHda, name: "phylo.fasta", extension: "fasta", state: "ok",
      history_id: FIX.historyId, deleted: false, size: INPUT_FASTA.length }];
    // Decoy FASTA datasets can appear earlier in the history and outrank the
    // real MAFFT output by name; resume must still key off the resolved HDA.
    for (const extra of extraFastas) items.push({ id: extra.id, name: extra.name, extension: "fasta",
      state: "ok", history_id: FIX.historyId, deleted: false, size: extra.content.length });
    if (phase >= 1 && includeAlignment) items.push({ id: FIX.mafftHda, name: "MAFFT on data 1",
      uuid: FIX.datasetUuid, extension: "fasta", state: "ok", history_id: FIX.historyId,
      deleted: false, size: alignmentContent.length });
    if (phase >= 2 && includeTree) {
      items.push({ id: FIX.treeHda, name: "IQ-TREE treefile on data 2", extension: "nwk", state: "ok",
        history_id: FIX.historyId, deleted: false, size: treeContent.length });
      items.push({ id: FIX.reportHda, name: "IQ-TREE on data 2", extension: "iqtree", state: "ok",
        history_id: FIX.historyId, deleted: false, size: 64 });
      items.push({ id: FIX.logHda, name: "IQ-TREE log on data 2", extension: "log", state: "ok",
        history_id: FIX.historyId, deleted: false, size: 32 });
    }
    return items;
  };
  const textById = new Map([
    [FIX.inputHda, INPUT_FASTA], [FIX.mafftHda, alignmentContent], [FIX.treeHda, treeContent],
    [FIX.reportHda, "IQ-TREE summary\n"], [FIX.logHda, logContent],
    ...extraFastas.map((extra) => [extra.id, extra.content])
  ]);
  const schemaFor = (id) => ({
    inputs: [{ model_class: "Section", name: "general_options", inputs: [
      { model_class: "DataToolParameter", name: "s", optional: false, extensions: ["fasta"] }
    ] }],
    tool_id: id
  });
  const fetchImpl = async (input, init = {}) => {
    const url = String(input);
    const method = String(init.method ?? "GET").toUpperCase();
    let body = null;
    if (typeof init.body === "string") { try { body = JSON.parse(init.body); } catch { body = null; } }
    calls.push({ method, url, body });
    assert.doesNotMatch(url, /CMD=Put|cmd=put/i, "legacy NCBI CMD=Put endpoint must never be called");
    assert.doesNotMatch(url, /rid=/i, "no new NCBI RID may be requested");
    if (method === "GET" && (url.includes("/api/tools?") || url.endsWith("/api/tools"))) {
      return json([
        { id: FIX.mafftId, name: "MAFFT", description: "Multiple alignment program for amino acid or nucleotide sequences",
          version: FIX.mafftVersion, model_class: "Tool", available: true },
        { id: FIX.iqtreeId, name: "IQ-TREE", description: "Phylogenomic / evolutionary tree construction from multiple sequences",
          version: FIX.iqtreeVersion, model_class: "Tool", available: true }
      ]);
    }
    if (url.includes("/api/workflows")) return json([]);
    if (url.includes("/api/histories") && method === "POST") return json({ id: FIX.historyId });
    if (url.includes("/api/tools/fetch")) {
      return json({ outputs: [{ id: FIX.inputHda, history_id: FIX.historyId }], jobs: [{ id: "1111111111111111" }] });
    }
    if (url.includes("io_details=true")) {
      const decoded = decodeURIComponent(url);
      const id = decoded.includes("iqtree") ? FIX.iqtreeId : FIX.mafftId;
      return json(schemaFor(id));
    }
    if (url.includes("/api/tools") && method === "POST") {
      const toolId = String(body?.tool_id ?? "");
      if (toolId.includes("mafft")) phase = Math.max(phase, 1);
      if (toolId.includes("iqtree")) phase = Math.max(phase, 2);
      const outputs = toolId.includes("iqtree")
        ? [{ id: FIX.treeHda }, { id: FIX.reportHda }, { id: FIX.logHda }]
        : [{ id: FIX.mafftHda }];
      return json({ outputs, jobs: [{ id: toolId.includes("iqtree") ? "2222222222222222" : "3333333333333333" }] });
    }
    if (url.includes("/api/histories/") && url.includes("/contents")) return json(contents());
    if (url.includes("/api/jobs/")) {
      return json({ id: url.slice(url.lastIndexOf("/") + 1), state: "ok", history_id: FIX.historyId });
    }
    if (url.includes("/get_content_as_text")) {
      const id = decodeURIComponent(url.slice(url.lastIndexOf("/datasets/") + 10).split("/")[0]);
      const content = textById.get(id);
      return content === undefined ? json({ error: "not_found" }, 404) : json({ item_data: content, truncated: false });
    }
    return json({ error: "unexpected_stub_route", url }, 404);
  };
  return { fetchImpl, calls, state: { get phase() { return phase; } } };
}

function makeEnv(db) {
  return {
    ...mockAIEnv(db),
    GALAXY_ENABLED: "true",
    GALAXY_BASE_URL: "https://galaxy.example.test",
    GALAXY_API_KEY: "stub-secret",
    AI_AGENT_TOKEN: "test-agent-token"
  };
}

function makeIdFactory() {
  const counters = new Map();
  return (prefix) => {
    const next = (counters.get(prefix) ?? 0) + 1;
    counters.set(prefix, next);
    return `${prefix}_${String(next).padStart(16, "0")}`;
  };
}

async function runWorkflow(t, { payload = {}, stubOptions = {} } = {}) {
  const fake = createFakeD1AI();
  const stub = makeStub(stubOptions);
  const originalFetch = globalThis.fetch;
  globalThis.fetch = stub.fetchImpl;
  t.after(() => { globalThis.fetch = originalFetch; });
  const request = new Request("https://app.example.test/api/ai/workflows/phylo/run", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Agent-Token": "test-agent-token" },
    body: JSON.stringify({ fasta_text: INPUT_FASTA, filename: "phylo.fasta", objective: "test objective", ...payload })
  });
  const response = await handlePhyloRun(request, makeEnv(fake.db), {
    now: NOW, idFactory: makeIdFactory(), fetchImpl: stub.fetchImpl
  });
  return { response, body: await response.json(), fake, stub };
}

test("FIXTURE run contract: stubbed MAFFT→IQ-TREE succeeds with real metrics and provenance", async (t) => {
  const { response, body, fake, stub } = await runWorkflow(t);
  assert.equal(response.status, 200, JSON.stringify(body));
  assert.equal(body.workflow_completed, true);
  assert.equal(body.validation.status, "pass");
  assert.equal(body.tree_newick, TREE);
  assert.equal(body.alignment_text, ALIGNMENT);
  assert.equal(body.tool_versions.mafft_tool_id, FIX.mafftId);
  assert.equal(body.tool_versions.iqtree_tool_id, FIX.iqtreeId);
  assert.equal(body.tool_versions.mafft, FIX.mafftVersion);
  assert.equal(body.tool_versions.iqtree, FIX.iqtreeVersion);
  assert.equal(body.tool_versions.discovery_mode, "live");
  assert.equal(body.metrics.alignment.alignment_length, 12);
  assert.equal(body.metrics.alignment.gap_count, 1);
  assert.equal(body.metrics.tree.tip_count, 3);
  assert.equal(body.metrics.tree.support_value_count, 1);
  assert.equal(body.metrics.tree.branch_lengths_complete, true);
  assert.match(body.metrics.tree.rooting.status, /^(unknown|rooted-by-declared-outgroup|unrooted-representation)$/);
  const mafftStep = body.provenance.find((step) => step.step_id === "galaxy_mafft");
  const retrieval = body.provenance.find((step) => step.step_id === "retrieve_outputs");
  assert.equal(mafftStep.tool_version, FIX.mafftVersion);
  assert.equal(retrieval.tool_versions.iqtree, FIX.iqtreeVersion);
  assert.equal(retrieval.files.length, 4);
  // One honest batch timestamp; order is explicit instead of invented times.
  assert.equal(new Set(retrieval.files.map((file) => file.retrieved_at)).size, 1);
  assert.equal(retrieval.files[0].retrieved_at, body.retrieval.started_at);
  assert.deepEqual(retrieval.files.map((file) => file.retrieval_order), [1, 2, 3, 4]);
  assert.ok(retrieval.files.some((file) => file.kind === "report" && file.tool_version === FIX.iqtreeVersion));
  const logFile = retrieval.files.find((file) => file.kind === "log");
  assert.equal(logFile.bytes, Buffer.byteLength("IQ-TREE log µ\n"), "bytes must be UTF-8 byte length");
  assert.equal(fake.state.tables.artifacts.find((row) => row.name === "IQ-TREE log on data 2").bytes,
    Buffer.byteLength("IQ-TREE log µ\n"));
  assert.equal(fake.state.tables.artifacts.length, 4);
  assert.equal(body.reopen.workspace_persisted, true);
  assert.equal(body.reopen.ai_run_id, body.job_ids.galaxy_iqtree);
  const serialized = JSON.stringify(body) + JSON.stringify(stub.calls);
  assert.doesNotMatch(serialized, /CMD=Put/i);
  assert.doesNotMatch(serialized, /RID=/i);
});

test("FIXTURE: a missing MAFFT alignment is never turned into a fabricated tree", async (t) => {
  const { response, body } = await runWorkflow(t, { stubOptions: { includeAlignment: false } });
  assert.equal(response.status, 502);
  assert.equal(body.tree_newick, null);
  assert.equal(body.alignment_text, null);
  assert.equal(body.validation.alignment.valid, false);
  assert.equal(body.validation.status !== "pass", true);
  assert.match(body.error, /no retrieved alignment dataset/);
  assert.equal(body.provenance.find((step) => step.step_id === "generate_report").status,
    "skipped_due_to_failure");
});

test("FIXTURE: MAFFT output with too few records fails validation and is not presented", async (t) => {
  const { response, body } = await runWorkflow(t, { stubOptions: { alignmentContent: ">only_one\nACGTACGT\n" } });
  assert.equal(response.status, 502);
  assert.equal(body.alignment_text, null);
  assert.equal(body.tree_newick, null);
  assert.equal(body.validation.alignment.valid, false);
  assert.ok((body.validation.retrieval_errors ?? []).some((error) => /fewer_than_two_records/.test(error.reason ?? "")));
});

test("FIXTURE: tree with wrong tips fails taxa checks while preserving real text", async (t) => {
  const { response, body } = await runWorkflow(t, { stubOptions: { treeContent: TREE_WRONG_TIPS } });
  assert.equal(response.status, 502);
  assert.deepEqual(body.validation.tree.missing, ["taxon_b", "taxon_c"]);
  assert.deepEqual(body.validation.tree.unknown, ["taxon_x"]);
  assert.equal(body.validation.tree.valid, false);
  assert.equal(body.metrics.tree.tip_count, 2);
});

test("FIXTURE resume: UUID resolves to an HDA through the run's history_id (no undefined prior)", async (t) => {
  const decoy = { id: FIX.decoyFastaHda, name: "MAFFT alignment on data 0", content: ">taxon_a\nAAAAAAAAAAA\n>taxon_b\nAAAAAAAAAAA\n>taxon_c\nAAAAAAAAAAA\n" };
  const { response, body } = await runWorkflow(t, {
    payload: { history_id: FIX.historyId, resume_alignment_dataset_id: FIX.datasetUuid },
    stubOptions: { initialPhase: 2, extraFastas: [decoy] }
  });
  assert.equal(response.status, 200, JSON.stringify(body));
  assert.equal(body.provenance.find((step) => step.step_id === "upload_input").resumed, true);
  const mafftStep = body.provenance.find((step) => step.step_id === "galaxy_mafft");
  assert.equal(mafftStep.resumed, true);
  assert.equal(mafftStep.dataset_id, FIX.mafftHda);
  assert.equal(mafftStep.history_id, FIX.historyId);
  assert.notEqual(mafftStep.dataset_id, FIX.datasetUuid);
  // A decoy FASTA appears first in the history and matches the MAFFT name
  // pattern; the resumed run must still use the resolved HDA for IQ-TREE.
  const iqtreeStep = body.provenance.find((step) => step.step_id === "galaxy_iqtree");
  assert.equal(iqtreeStep.input_dataset_id, FIX.mafftHda);
  assert.equal(body.alignment_text, ALIGNMENT);
  assert.equal(body.retrieval.files.some((file) => file.dataset_id === FIX.decoyFastaHda), false);
  assert.equal(body.validation.status, "pass");
});

test("FIXTURE resume without history_id fails closed with a readable message", async (t) => {
  const { response, body } = await runWorkflow(t, {
    payload: { resume_alignment_dataset_id: FIX.datasetUuid }, stubOptions: { initialPhase: 2 }
  });
  assert.equal(response.status, 502);
  assert.match(body.error, /history_id/);
  assert.doesNotMatch(body.error, /prior/);
});

test("FIXTURE: fewer than three distinct input records is rejected before any Galaxy call", async (t) => {
  const fake = createFakeD1AI();
  const stub = makeStub();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = stub.fetchImpl;
  t.after(() => { globalThis.fetch = originalFetch; });
  const request = new Request("https://app.example.test/api/ai/workflows/phylo/run", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ fasta_text: fixture("single_sequence.fasta") })
  });
  const response = await handlePhyloRun(request, makeEnv(fake.db), {
    now: NOW, idFactory: makeIdFactory(), fetchImpl: stub.fetchImpl
  });
  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /three distinct/i);
  assert.equal(stub.calls.length, 0);
});

test("FIXTURE: results reopen through the existing AI run and workspace run endpoints", async (t) => {
  const { body, fake, response } = await runWorkflow(t);
  assert.equal(response.status, 200);
  const env = makeEnv(fake.db);
  const aiResponse = await handleAiRun(
    makeGetRequest(`/api/ai/runs/${body.job_ids.galaxy_iqtree}`), env, body.job_ids.galaxy_iqtree);
  assert.equal(aiResponse.status, 200);
  const aiRun = await aiResponse.json();
  assert.equal(aiRun.plan.plan_json === undefined && aiRun.plan !== null, true);
  assert.ok(Array.isArray(aiRun.artifacts) && aiRun.artifacts.length >= 3);
  const workspaceResponse = await handleWorkspaceRun(
    makeGetRequest(`/api/workspace/runs/${body.run_id}`, { "X-Agent-Token": "test-agent-token" }),
    env, body.run_id);
  assert.equal(workspaceResponse.status, 200);
  const workspaceRun = await workspaceResponse.json();
  assert.equal(workspaceRun.run.id, body.run_id);
  assert.equal(workspaceRun.run.state, "succeeded");
  assert.equal(workspaceRun.run.workflow_id, "msa-phylogenetics");
});
