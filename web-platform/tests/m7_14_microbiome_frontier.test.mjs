// M7.14.1 LABELLED STUBBED FRONTIER TESTS — ZERO live calls.
//
// Every Galaxy route is answered by an in-memory stub. These tests drive a real
// run through dada2 denoising and assert that the retrieved feature-table dataset
// id reaches the alpha/beta/pcoa tool payloads under the SAME frontier key the
// writer stores. No live job is submitted and no result is fabricated.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { handleRun, handleStatus } from "../functions/api/ai/workflows/microbiome/engine.js";
import { createFakeD1AI, makePostRequest, makeGetRequest, mockAIEnv } from "./helpers/fake-d1.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const fixture = (name) => readFileSync(resolve(HERE, "fixtures/m7_14_microbiome", name), "utf8");
const PAYLOAD = {
  reads_text: fixture("sequences.fastq"), barcodes_text: fixture("barcodes.fastq"),
  metadata_text: fixture("sample-metadata.tsv"),
  reads_filename: "sequences.fastq", barcodes_filename: "barcodes.fastq",
  metadata_filename: "sample-metadata.tsv", objective: "Frontier-key regression test"
};

const IDS = Object.freeze({
  history: "11111111111111111111111111111111",
  reads: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  barcodes: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
  metadata: "cccccccccccccccccccccccccccccccc",
  demuxReads: "dddddddddddddddddddddddddddddddd",
  demuxQc: "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
  qc: "ffffffffffffffffffffffffffffffff",
  table: "12121212121212121212121212121212",
  repSeqs: "13131313131313131313131313131313",
  stats: "14141414141414141414141414141414",
  taxonomy: "15151515151515151515151515151515",
  alpha: "16161616161616161616161616161616",
  distance: "17171717171717171717171717171717",
  pcoa: "18181818181818181818181818181818",
  visualization: "19191919191919191919191919191919",
  demuxTool: "toolshed.g2.bx.psu.edu/repos/iuc/qiime2_demux_emp_single/7+galaxy1",
  qcTool: "toolshed.g2.bx.psu.edu/repos/iuc/qiime2_vsearch_fastq_stats/7+galaxy1",
  denoiseTool: "toolshed.g2.bx.psu.edu/repos/iuc/qiime2_dada2_denoise_single/7+galaxy1",
  classifyTool: "toolshed.g2.bx.psu.edu/repos/iuc/qiime2_feature_classifier_classify_sklearn/7+galaxy1",
  alphaTool: "toolshed.g2.bx.psu.edu/repos/iuc/qiime2_diversity_alpha/7+galaxy1",
  betaTool: "toolshed.g2.bx.psu.edu/repos/iuc/qiime2_diversity_beta/7+galaxy1",
  pcoaTool: "toolshed.g2.bx.psu.edu/repos/iuc/qiime2_emperor_plot/7+galaxy1"
});

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function toolEntry(id, name, description) {
  return { id, name, description, version: "2026.1.0", model_class: "Tool", available: true };
}

function schemaFor(toolId) {
  const data = (name, extensions) => ({ model_class: "DataToolParameter", name, optional: false, extensions });
  if (toolId === IDS.demuxTool) {
    return { tool_id: toolId, inputs: [data("sequences", ["fastq"]), data("barcodes", ["fastq"]), data("metadata", ["tsv"])] };
  }
  if (toolId === IDS.denoiseTool) {
    return { tool_id: toolId, inputs: [data("input", ["fastq"]), { name: "trim_left", value: 0 }, { name: "trunc_len", value: 150 }] };
  }
  if (toolId === IDS.qcTool) return { tool_id: toolId, inputs: [data("input", ["fastq"])] };
  if (toolId === IDS.classifyTool) {
    return { tool_id: toolId, inputs: [data("sequences", ["fasta"]), {
      model_class: "DataToolParameter", name: "classifier", optional: false, extensions: ["qza"],
      options: [{ value: "silva-138-99-515-806-nb-classifier.qza", label: "SILVA 138 99% 515-806 Naive Bayes classifier" }]
    }] };
  }
  // alpha, beta and pcoa all need a real table dataset in their live schema.
  return { tool_id: toolId, inputs: [data("table", ["tsv"])] };
}

function makeStub({ betaOutputsDistance = true } = {}) {
  const calls = [];
  const submissions = [];
  const jobOutputs = new Map();
  let phase = 0;
  const roleByTool = {
    [IDS.demuxTool]: { order: 1, outputs: [IDS.demuxReads, IDS.demuxQc] },
    [IDS.qcTool]: { order: 2, outputs: [IDS.qc] },
    [IDS.denoiseTool]: { order: 3, outputs: [IDS.table, IDS.repSeqs, IDS.stats] },
    [IDS.classifyTool]: { order: 4, outputs: [IDS.taxonomy] },
    [IDS.alphaTool]: { order: 5, outputs: [IDS.alpha] },
    [IDS.betaTool]: { order: 6, outputs: betaOutputsDistance ? [IDS.distance] : [IDS.table] },
    [IDS.pcoaTool]: { order: 7, outputs: [IDS.pcoa, IDS.visualization] }
  };
  const contents = () => {
    const items = [
      { id: IDS.reads, name: "sequences.fastq", extension: "fastq", state: "ok", history_id: IDS.history },
      { id: IDS.barcodes, name: "barcodes.fastq", extension: "fastq", state: "ok", history_id: IDS.history },
      { id: IDS.metadata, name: "sample-metadata.tsv", extension: "tsv", state: "ok", history_id: IDS.history }
    ];
    if (phase >= 1) items.push(
      { id: IDS.demuxReads, name: "demultiplexed reads.fastq", extension: "fastq", state: "ok", history_id: IDS.history },
      { id: IDS.demuxQc, name: "demux summary stats.tsv", extension: "tsv", state: "ok", history_id: IDS.history });
    if (phase >= 2) items.push({ id: IDS.qc, name: "quality stats.tsv", extension: "tsv", state: "ok", history_id: IDS.history });
    if (phase >= 3) items.push(
      { id: IDS.table, name: "feature table.tsv", extension: "tsv", state: "ok", history_id: IDS.history },
      { id: IDS.repSeqs, name: "rep seqs.fasta", extension: "fasta", state: "ok", history_id: IDS.history },
      { id: IDS.stats, name: "denoising stats.tsv", extension: "tsv", state: "ok", history_id: IDS.history });
    if (phase >= 4) items.push({ id: IDS.taxonomy, name: "taxonomy.tsv", extension: "tsv", state: "ok", history_id: IDS.history });
    if (phase >= 5) items.push({ id: IDS.alpha, name: "alpha.tsv", extension: "tsv", state: "ok", history_id: IDS.history });
    if (phase >= 6 && betaOutputsDistance) items.push(
      { id: IDS.distance, name: "bray curtis distance matrix.tsv", extension: "tsv", state: "ok", history_id: IDS.history });
    if (phase >= 7) items.push(
      { id: IDS.pcoa, name: "pcoa coordinates.tsv", extension: "tsv", state: "ok", history_id: IDS.history },
      { id: IDS.visualization, name: "emperor visualization.qzv", extension: "qzv", state: "ok", history_id: IDS.history });
    return items;
  };
  const textById = new Map([
    [IDS.reads, fixture("sequences.fastq")], [IDS.barcodes, fixture("barcodes.fastq")],
    [IDS.metadata, fixture("sample-metadata.tsv")], [IDS.demuxReads, fixture("sequences.fastq")],
    [IDS.demuxQc, fixture("qc-stats.tsv")], [IDS.qc, fixture("qc-stats.tsv")],
    [IDS.table, fixture("feature-table.tsv")], [IDS.repSeqs, fixture("rep-seqs.fasta")],
    [IDS.stats, fixture("qc-stats.tsv")], [IDS.taxonomy, fixture("taxonomy.tsv")],
    [IDS.alpha, fixture("alpha.tsv")], [IDS.distance, fixture("distance.tsv")],
    [IDS.pcoa, fixture("pcoa.tsv")], [IDS.visualization, "binary visualization placeholder"]
  ]);
  const fetchImpl = async (input, init = {}) => {
    const url = String(input);
    const method = String(init.method ?? "GET").toUpperCase();
    let body = null;
    if (typeof init.body === "string") { try { body = JSON.parse(init.body); } catch { body = null; } }
    calls.push({ method, url });
    assert.doesNotMatch(url, /blast|iprscan|ncbi|CMD=Put|rid=/i, "no external analysis job may be touched by these tests");
    if (method === "GET" && (url.includes("/api/tools?") || url.endsWith("/api/tools"))) {
      return json([
        toolEntry(IDS.demuxTool, "qiime2 demux emp-single", "Demultiplex single-end EMP reads"),
        toolEntry(IDS.qcTool, "qiime2 vsearch fastq-stats", "Quality statistics for FASTQ data"),
        toolEntry(IDS.denoiseTool, "qiime2 dada2 denoise-single", "Denoise single-end reads with DADA2"),
        toolEntry(IDS.classifyTool, "qiime2 feature-classifier classify-sklearn", "Assign taxonomy with a trained classifier"),
        toolEntry(IDS.alphaTool, "qiime2 diversity alpha", "Compute alpha diversity"),
        toolEntry(IDS.betaTool, "qiime2 diversity beta", "Compute beta distance matrix"),
        toolEntry(IDS.pcoaTool, "qiime2 emperor plot", "Emperor ordination visualization")
      ]);
    }
    if (url.includes("/api/workflows")) return json([]);
    if (method === "POST" && url.includes("/api/histories")) return json({ id: IDS.history });
    if (url.includes("/api/tools/fetch")) return json({ outputs: [{ id: IDS.reads, history_id: IDS.history }], jobs: [{ id: "uploadjob00000001" }] });
    if (url.includes("io_details=true")) {
      const decoded = decodeURIComponent(url);
      const id = Object.keys(roleByTool).find((toolId) => decoded.includes(toolId)) ?? IDS.demuxTool;
      return json(schemaFor(id));
    }
    if (method === "POST" && url.endsWith("/api/tools")) {
      const toolId = String(body?.tool_id ?? "");
      const role = roleByTool[toolId];
      assert.ok(role, `unexpected tool submission ${toolId}`);
      submissions.push({ tool_id: toolId, inputs: body?.inputs ?? {} });
      phase = Math.max(phase, role.order);
      const jobId = `job-${role.order}-${phase}`;
      jobOutputs.set(jobId, role.outputs);
      return json({ outputs: role.outputs.map((id) => ({ id })), jobs: [{ id: jobId }] });
    }
    if (url.includes("/api/histories/") && url.includes("/contents")) return json(contents());
    if (url.includes("/api/jobs/") && url.includes("/outputs")) {
      const id = decodeURIComponent(url.slice(url.lastIndexOf("/jobs/") + 6).split("/")[0]);
      const outputs = jobOutputs.get(id) ?? [];
      return json(Object.fromEntries(outputs.map((datasetId) => [datasetId, { id: datasetId, state: "ok" }])));
    }
    if (url.includes("/api/jobs/")) return json({ id: url.slice(url.lastIndexOf("/") + 1), state: "ok", history_id: IDS.history });
    if (url.includes("/get_content_as_text")) {
      const id = decodeURIComponent(url.slice(url.lastIndexOf("/datasets/") + 10).split("/")[0]);
      const content = textById.get(id);
      return content === undefined ? json({ error: "not_found" }, 404) : json({ item_data: content, truncated: false });
    }
    return json({ error: "unexpected_stub_route", url }, 404);
  };
  return { fetchImpl, calls, submissions,
    submissionFor: (toolId) => submissions.find((entry) => entry.tool_id === toolId) ?? null };
}

function envFor(db, stub) {
  return { ...mockAIEnv(db), GALAXY_ENABLED: "true", GALAXY_BASE_URL: "https://galaxy.example.test",
    GALAXY_API_KEY: "stub-secret", FETCH_IMPL: stub.fetchImpl };
}

function datasetIdsIn(entry) {
  return Object.values(entry?.inputs ?? {})
    .filter((value) => value && typeof value === "object" && value.src === "hda")
    .map((value) => String(value.id));
}

async function driveToCompletion(stub, env, runId, limit = 30) {
  let last = null;
  for (let index = 0; index < limit; index += 1) {
    last = await handleStatus(makeGetRequest(`/api/ai/workflows/microbiome/status?run_id=${runId}`), env,
      { fetchImpl: stub.fetchImpl });
    if ((await last.clone().json()).terminal) return last.json();
  }
  throw new Error("run did not reach a terminal state");
}

async function runWith(stub, fn) {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = stub.fetchImpl;
  try { return await fn(); } finally { globalThis.fetch = previousFetch; }
}

test("LABELLED STUB / one frontier key: alpha and beta receive the retrieved feature-table id", async () => {
  const stub = makeStub();
  await runWith(stub, async () => {
    const { db, state: d1 } = createFakeD1AI();
    const env = envFor(db, stub);
    const started = await handleRun(makePostRequest(PAYLOAD, "/api/ai/workflows/microbiome/run"), env,
      { fetchImpl: stub.fetchImpl });
    assert.equal(started.status, 202);
    const runId = (await started.json()).run_id;
    const terminal = await driveToCompletion(stub, env, runId);
    assert.equal(terminal.status, "succeeded", JSON.stringify(terminal.errors));

    const stored = JSON.parse(d1.tables.microbiome_runs[0].state_json);
    assert.equal(stored.frontier.featureTableId, IDS.table, "the writer and readers use one canonical key");
    assert.equal("featureTable" in stored.frontier, false, "no legacy divergent key remains");
    assert.equal(stored.frontier.repSeqsId, IDS.repSeqs);
    assert.equal(stored.frontier.demuxReadsId, IDS.demuxReads);
    assert.equal(stored.frontier.distanceMatrixId, IDS.distance);

    const alpha = stub.submissionFor(IDS.alphaTool);
    const beta = stub.submissionFor(IDS.betaTool);
    assert.ok(alpha && beta, "alpha and beta stages were submitted");
    assert.deepEqual(datasetIdsIn(alpha), [IDS.table]);
    assert.deepEqual(datasetIdsIn(beta), [IDS.table]);
    assert.equal(JSON.stringify(terminal.errors).includes("no_data_input_for_table"), false);
    assert.ok(terminal.steps.find((step) => step.step_id === "alpha_diversity").status === "succeeded");
    assert.ok(terminal.steps.find((step) => step.step_id === "beta_diversity").status === "succeeded");
  });
});

test("LABELLED STUB / pcoa receives the distance id, then the same feature-table fallback", async () => {
  const withDistance = makeStub();
  await runWith(withDistance, async () => {
    const { db, state: d1 } = createFakeD1AI();
    const env = envFor(db, withDistance);
    const started = await handleRun(makePostRequest(PAYLOAD, "/api/ai/workflows/microbiome/run"), env,
      { fetchImpl: withDistance.fetchImpl });
    const runId = (await started.json()).run_id;
    const terminal = await driveToCompletion(withDistance, env, runId);
    assert.equal(terminal.status, "succeeded", JSON.stringify(terminal.errors));
    const pcoa = withDistance.submissionFor(IDS.pcoaTool);
    assert.ok(pcoa, "pcoa stage was submitted");
    assert.deepEqual(datasetIdsIn(pcoa), [IDS.distance], "distanceMatrixId is preferred when a real distance artifact exists");
    assert.equal(JSON.stringify(terminal.errors).includes("no_data_input_for_table"), false);
  });

  const fallback = makeStub({ betaOutputsDistance: false });
  await runWith(fallback, async () => {
    const { db, state: d1 } = createFakeD1AI();
    const env = envFor(db, fallback);
    const started = await handleRun(makePostRequest(PAYLOAD, "/api/ai/workflows/microbiome/run"), env,
      { fetchImpl: fallback.fetchImpl });
    const runId = (await started.json()).run_id;
    const terminal = await driveToCompletion(fallback, env, runId);
    assert.equal(terminal.status, "succeeded", JSON.stringify(terminal.errors));
    const stored = JSON.parse(d1.tables.microbiome_runs[0].state_json);
    assert.equal(stored.frontier.distanceMatrixId, undefined, "no distance artifact was retrieved");
    assert.equal(stored.frontier.featureTableId, IDS.table);
    const pcoa = fallback.submissionFor(IDS.pcoaTool);
    assert.ok(pcoa, "pcoa stage was submitted even without a distance artifact");
    assert.deepEqual(datasetIdsIn(pcoa), [IDS.table], "pcoa falls back to the canonical featureTableId");
    assert.equal(JSON.stringify(terminal.errors).includes("no_data_input_for_table"), false);
  });
});
