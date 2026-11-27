// M7.14 OFFLINE WORKFLOW TESTS — fixture-based, labelled, ZERO live calls.
// Every Galaxy route is answered by an in-memory stub fetch. No job is ever
// submitted to a real provider, no IPS6 job is touched and no NCBI route is hit.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { handlePlan, handleRun, handleStatus, handleResult } from "../functions/api/ai/workflows/microbiome/engine.js";
import { handleGetRun } from "../functions/api/ai/runs/[id]/index.js";
import { handleGetRecovery } from "../functions/api/ai/runs/[id]/recovery.js";
import { createFakeD1AI, makeGetRequest, makePostRequest, mockAIEnv } from "./helpers/fake-d1.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const fixture = (name) => readFileSync(resolve(HERE, "fixtures/m7_14_microbiome", name), "utf8");
const PAYLOAD = {
  reads_text: fixture("sequences.fastq"),
  barcodes_text: fixture("barcodes.fastq"),
  metadata_text: fixture("sample-metadata.tsv"),
  reads_filename: "sequences.fastq",
  barcodes_filename: "barcodes.fastq",
  metadata_filename: "sample-metadata.tsv",
  objective: "Fixture-only 16S workflow test"
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
  return { id, name, description, version: "2026.1.0+q2galaxy.2026.1.0", model_class: "Tool", available: true };
}

function schemaFor(toolId) {
  const data = (name, extensions) => ({ model_class: "DataToolParameter", name, optional: false, extensions });
  if (toolId === IDS.demuxTool) {
    return { tool_id: toolId, inputs: [data("sequences", ["fastq"]), data("barcodes", ["fastq"]), data("metadata", ["tsv"])] };
  }
  if (toolId === IDS.denoiseTool) {
    return { tool_id: toolId, inputs: [data("input", ["fastq"]),
      { name: "trim_left", value: 0 }, { name: "trunc_len", value: 150 }] };
  }
  if (toolId === IDS.qcTool) {
    return { tool_id: toolId, inputs: [data("input", ["fastq"]), { name: "threads", value: 1 }] };
  }
  if (toolId === IDS.classifyTool) {
    return { tool_id: toolId, inputs: [data("sequences", ["fasta"]), {
      model_class: "DataToolParameter", name: "classifier", optional: false, extensions: ["qza"],
      options: [{ value: "silva-138-99-515-806-nb-classifier.qza", label: "SILVA 138 99% 515-806 Naive Bayes classifier" }]
    }] };
  }
  return { tool_id: toolId, inputs: [data("table", ["tsv"])] };
}

function makeStub() {
  const calls = [];
  const jobOutputs = new Map();
  let phase = 0;
  const roleByTool = {
    [IDS.demuxTool]: { order: 1, outputs: [IDS.demuxReads, IDS.demuxQc] },
    [IDS.qcTool]: { order: 2, outputs: [IDS.qc] },
    [IDS.denoiseTool]: { order: 3, outputs: [IDS.table, IDS.repSeqs, IDS.stats] },
    [IDS.classifyTool]: { order: 4, outputs: [IDS.taxonomy] },
    [IDS.alphaTool]: { order: 5, outputs: [IDS.alpha] },
    [IDS.betaTool]: { order: 6, outputs: [IDS.distance] },
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
    if (phase >= 6) items.push({ id: IDS.distance, name: "bray curtis distance matrix.tsv", extension: "tsv", state: "ok", history_id: IDS.history });
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
    calls.push({ method, url, body });
    assert.doesNotMatch(url, /iprscan|blast|CMD=Put|rid=/i, "no external analysis job may be touched by M7.14 tests");
    if (method === "GET" && (url.includes("/api/tools?") || url.endsWith("/api/tools"))) {
      return json([
        toolEntry(IDS.demuxTool, "qiime2 demux emp-single", "Demultiplex paired-end or single-end EMP sequencing reads"),
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
    if (method === "POST" && url.includes("/api/tools")) {
      const toolId = String(body?.tool_id ?? "");
      const role = roleByTool[toolId];
      assert.ok(role, `unexpected tool submission ${toolId}`);
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
  return {
    fetchImpl, calls,
    submissionCount: () => calls.filter((call) => call.method === "POST" && /\/api\/tools$/.test(call.url)).length,
    uploadCount: () => calls.filter((call) => call.url.includes("/api/tools/fetch")).length
  };
}

function envFor(db, stub) {
  return { ...mockAIEnv(db), GALAXY_ENABLED: "true", GALAXY_BASE_URL: "https://galaxy.example.test",
    GALAXY_API_KEY: "stub-secret", FETCH_IMPL: stub.fetchImpl };
}

async function driveToCompletion(handler, env, stub, runId, limit = 60) {
  let last = null;
  for (let index = 0; index < limit; index += 1) {
    last = await handleStatus(makeGetRequest(`/api/ai/workflows/microbiome/status?run_id=${runId}`), env, { fetchImpl: stub.fetchImpl });
    const body = await last.json();
    if (body.terminal) return body;
  }
  throw new Error(`run did not reach a terminal state after ${limit} status requests`);
}

test("PLAN: exact discovered tools, observed truncation and classifier provenance; no submission", async () => {
  const stub = makeStub();
  const previousFetch = globalThis.fetch;
  globalThis.fetch = stub.fetchImpl;
  try {
    const db = createFakeD1AI().db;
    const env = envFor(db, stub);
    const response = await handlePlan(makePostRequest(PAYLOAD, "/api/ai/workflows/microbiome/plan"), env, { fetchImpl: stub.fetchImpl });
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.workflow_type, "microbiome");
    assert.equal(body.input.sample_count, 3);
    assert.equal(body.input.correspondence.valid, true);
    assert.equal(body.params.trim_left, 0);
    assert.ok(body.params.trunc_len >= 12);
    assert.match(body.params.trunc_rationale, /Observed mean quality/);
    assert.doesNotMatch(body.params.trunc_rationale, /1103/);
    assert.equal(body.classifier.available, true);
    assert.match(body.classifier.option_label, /SILVA 138 99%/);
    assert.equal(body.classifier.option_value, "silva-138-99-515-806-nb-classifier.qza");
    assert.equal(body.plan.steps.find((step) => step.id === "dada2_denoise").tool_id, IDS.denoiseTool);
    assert.equal(stub.submissionCount(), 0);
    assert.equal(stub.uploadCount(), 0);
    const duplicate = await handlePlan(makePostRequest({ ...PAYLOAD,
      metadata_text: PAYLOAD.metadata_text + "sampleA\tACCGCACTT\tgut\t2026\t10\t1\tsubject-01\tno\t0\n" },
    "/api/ai/workflows/microbiome/plan"), env, { fetchImpl: stub.fetchImpl });
    assert.equal(duplicate.status, 400);
    assert.equal((await duplicate.json()).validation.status, "fail");
  } finally { globalThis.fetch = previousFetch; }
});

test("RUN+STATUS+RESULT: one dependent workflow, real parsed artifacts, no duplicate stages", async () => {
  const stub = makeStub();
  const previousFetch = globalThis.fetch;
  globalThis.fetch = stub.fetchImpl;
  try {
    const { db, state: d1 } = createFakeD1AI();
    const env = envFor(db, stub);
    const started = await handleRun(makePostRequest(PAYLOAD, "/api/ai/workflows/microbiome/run"), env,
      { fetchImpl: stub.fetchImpl, idFactory: ((map) => (prefix) => {
        map.set(prefix, (map.get(prefix) ?? 0) + 1);
        return `${prefix}_${String(map.get(prefix)).padStart(16, "0")}`;
      })(new Map()) });
    assert.equal(started.status, 202);
    const run = await started.json();
    assert.match(run.run_id, /^job_/);
    assert.equal(run.deduped, false);
    assert.equal(stub.uploadCount(), 1);
    const beforeDuplicate = stub.uploadCount();
    const again = await handleRun(makePostRequest(PAYLOAD, "/api/ai/workflows/microbiome/run"), env,
      { fetchImpl: stub.fetchImpl });
    const repeated = await again.json();
    assert.equal(repeated.run_id, run.run_id);
    assert.equal(repeated.deduped, true);
    assert.equal(stub.uploadCount(), beforeDuplicate, "a refresh must never create a second upload");

    const terminal = await driveToCompletion(null, env, stub, run.run_id);
    assert.equal(terminal.status, "succeeded", JSON.stringify(terminal.errors));
    assert.equal(stub.submissionCount(), 7, "each tool stage is submitted exactly once");
    const afterCompletion = stub.submissionCount();
    const refresh = await handleStatus(makeGetRequest(`/api/ai/workflows/microbiome/status?run_id=${run.run_id}`), env,
      { fetchImpl: stub.fetchImpl });
    assert.equal((await refresh.json()).status, "succeeded");
    assert.equal(stub.submissionCount(), afterCompletion, "completed stages must never be resubmitted");

    const resultResponse = await handleResult(makeGetRequest(`/api/ai/workflows/microbiome/result?run_id=${run.run_id}`), env);
    const result = await resultResponse.json();
    assert.equal(result.workflow_type, "microbiome");
    assert.equal(result.asv.available, true, JSON.stringify(result.asv));
    assert.equal(result.asv.feature_count, 3);
    assert.equal(result.composition.samples.length, 3);
    const sampleA = result.composition.samples.find((entry) => entry.sample_id === "sampleA");
    assert.equal(sampleA.totals ?? sampleA.total, 12);
    assert.ok(sampleA.taxa.some((entry) => entry.taxon === "Firmicutes" && entry.count === 10));
    assert.equal(result.taxonomy.available, true);
    assert.equal(result.alpha.samples[0].observed_features, 3);
    assert.equal(result.beta.matrix[0][1], 0.42);
    assert.equal(result.pcoa.coordinates[0].values.PC1, -0.42);
    assert.equal(result.faith_pd ?? result.alpha.samples[0].faith_pd, null);
    assert.equal(result.integrity.valid, true, JSON.stringify(result.integrity));
    assert.equal(result.ordination.visualization_artifacts.length, 1);
    assert.doesNotMatch(JSON.stringify(result), /statistically significant|significantly (?:higher|lower|different)|\bp\s*[<>=]\s*0?\.\d/i);
    assert.ok(result.artifacts.length >= 8);
    assert.ok(result.artifacts.every((artifact) => /^[0-9a-f]{64}$/.test(artifact.checksum)));
    const exportNames = (result.exports ?? []).map((entry) => entry.name);
    for (const name of ["feature-table.tsv", "rep-seqs.fasta", "taxonomy.tsv", "alpha-diversity.tsv",
      "distance-matrix.tsv", "pcoa-coordinates.tsv", "report.txt", "manifest.json"]) {
      assert.ok(exportNames.includes(name), `missing export ${name}`);
    }
    assert.ok(result.exports.every((entry) => /^[0-9a-f]{64}$/.test(entry.checksum)));
    assert.match(result.exports.find((entry) => entry.name === "report.txt").content, /16S microbiome run/);
    assert.equal(d1.tables.microbiome_runs.length, 1);
    assert.equal(d1.tables.artifacts.length, result.artifacts.length);

    const runRecord = await handleGetRun(makeGetRequest(`/api/ai/runs/${run.run_id}`), env, run.run_id);
    const runBody = await runRecord.json();
    assert.equal(runBody.plan.workflow_type, "microbiome");
    assert.ok(runBody.jobs.length >= 11);
    assert.ok(runBody.artifacts.length >= 8);

    const recovery = await handleGetRecovery(makeGetRequest(`/api/ai/runs/${run.run_id}/recovery`), env, run.run_id);
    const recovered = await recovery.json();
    assert.equal(recovered.workflow_type, "microbiome");
    assert.equal(recovered.microbiome.input.sample_count, 3);
    assert.match(recovered.microbiome.input.metadata_text, /sampleA/);
    assert.equal(recovered.microbiome.asv.feature_count, 3);
    assert.equal(recovered.microbiome.composition.samples.length, 3);
    assert.equal(recovered.microbiome.beta.samples.length, 3);
    assert.equal(recovered.microbiome.pcoa.coordinates.length, 3);
    assert.ok(recovered.microbiome.original_execution_state.provider_job_ids.length > 0);
    assert.ok(recovered.artifacts.every((artifact) => artifact.checksum_match === true));
    assert.equal(recovered.microbiome.report_reason, null);
  } finally { globalThis.fetch = previousFetch; }
});

test("FAIL CLOSED: missing samples produce no plan and no workflow", async () => {
  const stub = makeStub();
  const previousFetch = globalThis.fetch;
  globalThis.fetch = stub.fetchImpl;
  try {
    const env = envFor(createFakeD1AI().db, stub);
    const broken = { ...PAYLOAD, metadata_text: PAYLOAD.metadata_text
      .replace("sampleB\tGGACGGACG", "sampleB\tWRONGBARCODE") };
    const response = await handleRun(makePostRequest(broken, "/api/ai/workflows/microbiome/run"), env,
      { fetchImpl: stub.fetchImpl });
    assert.equal(response.status, 400);
    assert.equal((await response.json()).validation.status, "fail");
    assert.equal(stub.uploadCount(), 0);
    assert.equal(stub.submissionCount(), 0);
  } finally { globalThis.fetch = previousFetch; }
});
