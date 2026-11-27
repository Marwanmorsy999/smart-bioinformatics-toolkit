// M7.14.1 LABELLED STUBBED QZA-EXPORT TESTS — ZERO live calls.
//
// Every Galaxy route is answered by an in-memory stub. The export tool id is the
// one discovered from the live tool panel, never hardcoded in the engine. These
// tests prove that binary .qza outputs are exported by a genuine tool before any
// parse claim is made, and that export failures stay honest and non-fatal.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { handleRun, handleStatus, handleResult } from "../functions/api/ai/workflows/microbiome/engine.js";
import { createFakeD1AI, makePostRequest, makeGetRequest, mockAIEnv } from "./helpers/fake-d1.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const fixture = (name) => readFileSync(resolve(HERE, "fixtures/m7_14_microbiome", name), "utf8");
const PAYLOAD = {
  reads_text: fixture("sequences.fastq"), barcodes_text: fixture("barcodes.fastq"),
  metadata_text: fixture("sample-metadata.tsv"),
  reads_filename: "sequences.fastq", barcodes_filename: "barcodes.fastq",
  metadata_filename: "sample-metadata.tsv", objective: "qza export regression test"
};
const EXPORT_TOOL = "toolshed.g2.bx.psu.edu/repos/q2d2/qiime2_core__tools__export/qiime2_core__tools__export/2026.1.0+dist.h02a552c2";

const IDS = Object.freeze({
  history: "11111111111111111111111111111111",
  reads: "22222222222222222222222222222222",
  barcodes: "33333333333333333333333333333333",
  metadata: "44444444444444444444444444444444",
  demuxReads: "55555555555555555555555555555555",
  demuxQc: "66666666666666666666666666666666",
  qc: "77777777777777777777777777777777",
  tableText: "12121212121212121212121212121212",
  repText: "13131313131313131313131313131313",
  statsText: "14141414141414141414141414141414",
  taxonomy: "15151515151515151515151515151515",
  alpha: "16161616161616161616161616161616",
  distance: "17171717171717171717171717171717",
  pcoa: "18181818181818181818181818181818",
  visualization: "19191919191919191919191919191919",
  tableQza: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  repQza: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
  statsQza: "cccccccccccccccccccccccccccccccc",
  baseQza: "dddddddddddddddddddddddddddddddd",
  exportedTable: "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
  exportedRep: "ffffffffffffffffffffffffffffffff",
  exportedQc: "00000000000000000000000000000000",
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
  if (toolId === EXPORT_TOOL) return { tool_id: toolId, inputs: [data("input", ["qza"])] };
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
  return { tool_id: toolId, inputs: [data("table", ["tsv"])] };
}

function makeStub({ denoiseMode = "one-qza", exportAvailable = true, exportFails = false,
  exportDelayPolls = 0 } = {}) {
  const exportSubmissions = [];
  const jobOutputs = new Map();
  const jobStates = new Map();
  const exportPolls = new Map();
  const dynamicDatasets = [];
  let phase = 0;
  let exportCount = 0;
  const roleByTool = {
    [IDS.demuxTool]: { order: 1, outputs: [IDS.demuxReads, IDS.demuxQc] },
    [IDS.qcTool]: { order: 2, outputs: [IDS.qc] },
    [IDS.denoiseTool]: { order: 3, outputs: denoiseMode === "all-qza"
      ? [IDS.tableQza, IDS.repQza, IDS.statsQza, IDS.baseQza]
      : denoiseMode === "text" ? [IDS.tableText, IDS.repText, IDS.statsText]
        : [IDS.tableQza, IDS.repText] },
    [IDS.classifyTool]: { order: 4, outputs: [IDS.taxonomy] },
    [IDS.alphaTool]: { order: 5, outputs: [IDS.alpha] },
    [IDS.betaTool]: { order: 6, outputs: [IDS.distance] },
    [IDS.pcoaTool]: { order: 7, outputs: [IDS.pcoa, IDS.visualization] }
  };
  const textById = new Map([
    [IDS.reads, fixture("sequences.fastq")], [IDS.barcodes, fixture("barcodes.fastq")],
    [IDS.metadata, fixture("sample-metadata.tsv")], [IDS.demuxReads, fixture("sequences.fastq")],
    [IDS.demuxQc, fixture("qc-stats.tsv")], [IDS.qc, fixture("qc-stats.tsv")],
    [IDS.tableText, fixture("feature-table.tsv")], [IDS.repText, fixture("rep-seqs.fasta")],
    [IDS.statsText, fixture("qc-stats.tsv")], [IDS.taxonomy, fixture("taxonomy.tsv")],
    [IDS.alpha, fixture("alpha.tsv")], [IDS.distance, fixture("distance.tsv")],
    [IDS.pcoa, fixture("pcoa.tsv")], [IDS.visualization, "binary visualization placeholder"],
    [IDS.exportedTable, fixture("feature-table.tsv")], [IDS.exportedRep, fixture("rep-seqs.fasta")],
    [IDS.exportedQc, fixture("qc-stats.tsv")]
  ]);
  const exportTargets = {
    [IDS.tableQza]: { id: IDS.exportedTable, name: "exported-feature-table.tsv", extension: "tsv" },
    [IDS.repQza]: { id: IDS.exportedRep, name: "exported-rep-seqs.fasta", extension: "fasta" },
    [IDS.statsQza]: { id: IDS.exportedQc, name: "exported-qc.tsv", extension: "tsv" },
    [IDS.baseQza]: { id: IDS.exportedQc, name: "exported-qc.tsv", extension: "tsv" }
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
    if (phase >= 3) {
      const qzaNames = {
        [IDS.tableQza]: "table.qza", [IDS.repQza]: "representative_sequences.qza",
        [IDS.statsQza]: "denoising_stats.qza", [IDS.baseQza]: "base_transition_stats.qza"
      };
      const textNames = {
        [IDS.tableText]: "feature table.tsv", [IDS.repText]: "representative_sequences.fasta",
        [IDS.statsText]: "denoising stats.tsv"
      };
      for (const id of roleByTool[IDS.denoiseTool].outputs) {
        const qza = Object.hasOwn(qzaNames, id);
        items.push({ id, name: qzaNames[id] ?? textNames[id] ?? "output.tsv",
          extension: qza ? "qza" : id === IDS.repText ? "fasta" : "tsv",
          state: "ok", history_id: IDS.history });
      }
    }
    if (phase >= 4) items.push({ id: IDS.taxonomy, name: "taxonomy.tsv", extension: "tsv", state: "ok", history_id: IDS.history });
    if (phase >= 5) items.push({ id: IDS.alpha, name: "alpha.tsv", extension: "tsv", state: "ok", history_id: IDS.history });
    if (phase >= 6) items.push({ id: IDS.distance, name: "bray curtis distance matrix.tsv", extension: "tsv", state: "ok", history_id: IDS.history });
    if (phase >= 7) items.push(
      { id: IDS.pcoa, name: "pcoa coordinates.tsv", extension: "tsv", state: "ok", history_id: IDS.history },
      { id: IDS.visualization, name: "emperor visualization.qzv", extension: "qzv", state: "ok", history_id: IDS.history });
    return [...items, ...dynamicDatasets];
  };
  const fetchImpl = async (input, init = {}) => {
    const url = String(input);
    const method = String(init.method ?? "GET").toUpperCase();
    let body = null;
    if (typeof init.body === "string") { try { body = JSON.parse(init.body); } catch { body = null; } }
    assert.doesNotMatch(url, /blast|iprscan|ncbi|CMD=Put|rid=/i, "no external analysis job may be touched by these tests");
    if (method === "GET" && (url.includes("/api/tools?") || url.endsWith("/api/tools"))) {
      const tools = [
        toolEntry(IDS.demuxTool, "qiime2 demux emp-single", "Demultiplex single-end EMP reads"),
        toolEntry(IDS.qcTool, "qiime2 vsearch fastq-stats", "Quality statistics for FASTQ data"),
        toolEntry(IDS.denoiseTool, "qiime2 dada2 denoise-single", "Denoise single-end reads with DADA2"),
        toolEntry(IDS.classifyTool, "qiime2 feature-classifier classify-sklearn", "Assign taxonomy with a trained classifier"),
        toolEntry(IDS.alphaTool, "qiime2 diversity alpha", "Compute alpha diversity"),
        toolEntry(IDS.betaTool, "qiime2 diversity beta", "Compute beta distance matrix"),
        toolEntry(IDS.pcoaTool, "qiime2 emperor plot", "Emperor ordination visualization")
      ];
      if (exportAvailable) tools.push(toolEntry(EXPORT_TOOL, "qiime2 tools export", "Export QIIME 2 qza artifacts to text"));
      return json(tools);
    }
    if (url.includes("/api/workflows")) return json([]);
    if (method === "POST" && url.includes("/api/histories")) return json({ id: IDS.history });
    if (url.includes("/api/tools/fetch")) return json({ outputs: [{ id: IDS.reads, history_id: IDS.history }], jobs: [{ id: "uploadjob00000001" }] });
    if (url.includes("io_details=true")) {
      const decoded = decodeURIComponent(url);
      if (decoded.includes(EXPORT_TOOL)) return json(schemaFor(EXPORT_TOOL));
      const id = Object.keys(roleByTool).find((toolId) => decoded.includes(toolId)) ?? IDS.demuxTool;
      return json(schemaFor(id));
    }
    if (method === "POST" && url.endsWith("/api/tools")) {
      const toolId = String(body?.tool_id ?? "");
      if (toolId === EXPORT_TOOL) {
        const sourceId = Object.values(body?.inputs ?? {}).find((value) => value?.src === "hda")?.id ?? null;
        const target = exportTargets[sourceId];
        assert.ok(target, `unexpected export source ${sourceId}`);
        exportSubmissions.push({ tool_id: toolId, source_dataset_id: sourceId, inputs: body.inputs });
        const jobId = `export-job-${++exportCount}`;
        jobOutputs.set(jobId, [target.id]);
        jobStates.set(jobId, exportFails ? "error" : exportDelayPolls > 0 ? "running" : "ok");
        dynamicDatasets.push({ id: target.id, name: target.name, extension: target.extension,
          state: "ok", history_id: IDS.history });
        return json({ outputs: [{ id: target.id }], jobs: [{ id: jobId }] });
      }
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
    if (url.includes("/api/jobs/")) {
      const id = decodeURIComponent(url.slice(url.lastIndexOf("/jobs/") + 6).split("/")[0]);
      let state = jobStates.get(id) ?? "ok";
      if (state === "running" && exportDelayPolls > 0) {
        const seen = (exportPolls.get(id) ?? 0) + 1;
        exportPolls.set(id, seen);
        if (seen > exportDelayPolls) { state = "ok"; jobStates.set(id, state); }
      }
      return json({ id, state, history_id: IDS.history });
    }
    if (url.includes("/get_content_as_text")) {
      const id = decodeURIComponent(url.slice(url.lastIndexOf("/datasets/") + 10).split("/")[0]);
      const content = textById.get(id);
      return content === undefined ? json({ error: "not_found" }, 404) : json({ item_data: content, truncated: false });
    }
    return json({ error: "unexpected_stub_route", url }, 404);
  };
  return { fetchImpl, exportSubmissions, exportCount: () => exportCount };
}

function envFor(db, stub) {
  return { ...mockAIEnv(db), GALAXY_ENABLED: "true", GALAXY_BASE_URL: "https://galaxy.example.test",
    GALAXY_API_KEY: "stub-secret", FETCH_IMPL: stub.fetchImpl };
}

async function withStub(stub, fn) {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = stub.fetchImpl;
  try { return await fn(); } finally { globalThis.fetch = previousFetch; }
}

async function startAndDrive(stub, { polls = 40 } = {}) {
  const { db, state: d1 } = createFakeD1AI();
  const env = envFor(db, stub);
  const started = await handleRun(makePostRequest(PAYLOAD, "/api/ai/workflows/microbiome/run"), env,
    { fetchImpl: stub.fetchImpl });
  assert.equal(started.status, 202);
  const runId = (await started.json()).run_id;
  let last = null;
  let pollCount = 0;
  for (let index = 0; index < polls; index += 1) {
    last = await handleStatus(makeGetRequest(`/api/ai/workflows/microbiome/status?run_id=${runId}`), env,
      { fetchImpl: stub.fetchImpl });
    pollCount += 1;
    if ((await last.clone().json()).terminal) break;
  }
  const terminal = await last.json();
  const stored = JSON.parse(d1.tables.microbiome_runs[0].state_json);
  const resultResponse = await handleResult(makeGetRequest(`/api/ai/workflows/microbiome/result?run_id=${runId}`), env);
  const result = await resultResponse.json();
  return { terminal, stored, result, env, db, d1, runId, pollCount };
}

test("LABELLED STUB / qza DADA2 output triggers one discovered export and real ASV + rep-seq parse", async () => {
  const stub = makeStub({ denoiseMode: "one-qza" });
  await withStub(stub, async () => {
    const { terminal, stored, result } = await startAndDrive(stub);
    assert.equal(terminal.status, "succeeded", JSON.stringify(terminal.errors));
    assert.equal(stub.exportCount(), 1, "exactly one qza export job");
    assert.equal(stub.exportSubmissions[0].tool_id, EXPORT_TOOL, "the discovered export tool is used");
    assert.equal(stub.exportSubmissions[0].source_dataset_id, IDS.tableQza);
    assert.equal(result.asv.available, true, JSON.stringify(result.asv));
    assert.equal(result.asv.feature_count, 3);
    assert.equal(result.asv.rep_seq_count, 3);
    assert.equal(stored.steps.dada2_denoise.exports.length, 1);
    assert.equal(stored.steps.dada2_denoise.exports[0].source_dataset_id, IDS.tableQza);
    assert.equal(stored.steps.dada2_denoise.exports[0].exported_dataset_id, IDS.exportedTable);
    assert.equal(stored.steps.dada2_denoise.exports[0].tool_id, EXPORT_TOOL);
    assert.equal(stored.steps.dada2_denoise.exports[0].basis, "derived_from_executed_tool_output");
    assert.equal(stored.exports[IDS.tableQza].status, "succeeded");
    assert.deepEqual(stored.pending_exports, [], "the export job is no longer pending");
    assert.ok(result.artifacts.some((artifact) => artifact.dataset_id === IDS.exportedTable));
  });
});

test("LABELLED STUB / repeated polls never submit a duplicate export job", async () => {
  const stub = makeStub({ denoiseMode: "one-qza", exportDelayPolls: 2 });
  await withStub(stub, async () => {
    const { terminal, stored } = await startAndDrive(stub);
    assert.equal(terminal.status, "succeeded", JSON.stringify(terminal.errors));
    assert.equal(stub.exportCount(), 1, "only one export was submitted across all polls");
    assert.deepEqual(stored.pending_exports, []);
    assert.equal(Object.keys(stored.exports).length, 1);
  });
});

test("LABELLED STUB / undiscovered export tool: honest reason, stage still finalizes", async () => {
  const stub = makeStub({ denoiseMode: "one-qza", exportAvailable: false });
  await withStub(stub, async () => {
    const { terminal, stored, result } = await startAndDrive(stub);
    assert.equal(terminal.status, "succeeded", JSON.stringify(terminal.errors));
    assert.equal(stub.exportCount(), 0, "no tool id was invented");
    assert.equal(result.asv.available, false);
    assert.match(result.asv.reason, /No parseable feature table/);
    assert.ok(stored.errors.some((error) => String(error.reason ?? error).includes("qza_export_unavailable")));
    assert.equal(stored.steps.dada2_denoise.status, "succeeded", "the stage finalized without a fatal failure");
  });
});

test("LABELLED STUB / failed export job: real failure recorded, no fabricated ASV", async () => {
  const stub = makeStub({ denoiseMode: "one-qza", exportFails: true });
  await withStub(stub, async () => {
    const { terminal, stored, result } = await startAndDrive(stub);
    assert.equal(terminal.status, "succeeded", JSON.stringify(terminal.errors));
    assert.equal(stub.exportCount(), 1);
    assert.equal(result.asv.available, false);
    assert.ok(stored.errors.some((error) => String(error.reason ?? error).includes("qza_export_job_failed")));
    assert.equal(stored.exports[IDS.tableQza].status, "failed");
    assert.equal(stored.steps.dada2_denoise.exports, undefined, "no export artifacts were claimed");
  });
});

test("LABELLED STUB / genuine text outputs are not exported unnecessarily", async () => {
  const stub = makeStub({ denoiseMode: "text" });
  await withStub(stub, async () => {
    const { terminal, stored, result } = await startAndDrive(stub);
    assert.equal(terminal.status, "succeeded", JSON.stringify(terminal.errors));
    assert.equal(stub.exportCount(), 0);
    assert.deepEqual(stored.pending_exports, []);
    assert.equal(result.asv.available, true);
    assert.equal(result.asv.feature_count, 3);
  });
});

test("LABELLED STUB / four qza outputs are capped at three exports, one per needed kind", async () => {
  const stub = makeStub({ denoiseMode: "all-qza" });
  await withStub(stub, async () => {
    const { terminal, stored, result } = await startAndDrive(stub);
    assert.equal(terminal.status, "succeeded", JSON.stringify(terminal.errors));
    assert.equal(stub.exportCount(), 3, "at most three export jobs, one per needed kind");
    assert.deepEqual(stub.exportSubmissions.map((entry) => entry.source_dataset_id),
      [IDS.tableQza, IDS.repQza, IDS.statsQza]);
    assert.equal(Object.keys(stored.exports).length, 3);
    assert.equal(result.asv.available, true);
    assert.equal(result.asv.feature_count, 3);
    assert.equal(result.asv.rep_seq_count, 3);
  });
});
