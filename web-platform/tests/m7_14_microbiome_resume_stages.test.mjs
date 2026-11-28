// M7.14.1 LABELLED STUBBED STAGE-RESUME TESTS — ZERO live calls.
//
// Reproduces the live pre-submission failure: a successful upload retry, then
// demux unavailable because importTool had not been discovered, then a schema
// failure. The endpoint must refresh genuine discovery and replay no provider job.
import test from "node:test";
import assert from "node:assert/strict";
import { parseJson } from "../functions/api/ai/_lib.js";
import { handleResumeStages } from "../functions/api/ai/workflows/microbiome/engine.js";
import { createFakeD1AI, makePostRequest, mockAIEnv } from "./helpers/fake-d1.mjs";

const RUN_ID = "job_a8817e35d7534d98";
const PATH = "/api/ai/workflows/microbiome/resume-stages";
const UPLOAD_JOB = "4838ba20a6d86765c80a3b8648ead0bb";
const FORMAT = "SingleLanePerSampleSingleEndFastqDirFmt";
const TOOLS = Object.freeze({
  demux: "toolshed.g2.bx.psu.edu/repos/iuc/qiime2_demux_emp_single/2026.1.0",
  qc: "toolshed.g2.bx.psu.edu/repos/iuc/qiime2_vsearch_fastq_stats/2026.1.0",
  denoise: "toolshed.g2.bx.psu.edu/repos/iuc/qiime2_dada2_denoise_single/2026.1.0",
  classify: "toolshed.g2.bx.psu.edu/repos/iuc/qiime2_feature_classifier_classify_sklearn/2026.1.0",
  alpha: "toolshed.g2.bx.psu.edu/repos/iuc/qiime2_diversity_alpha/2026.1.0",
  beta: "toolshed.g2.bx.psu.edu/repos/iuc/qiime2_diversity_core_metrics_phylogenetic/2026.1.0",
  pcoa: "toolshed.g2.bx.psu.edu/repos/iuc/qiime2_emperor_plot/2026.1.0",
  importTool: "toolshed.g2.bx.psu.edu/repos/q2d2/qiime2_core__tools__import/2026.1.0+dist.h02a552c2",
  exportTool: "toolshed.g2.bx.psu.edu/repos/q2d2/qiime2_core__tools__export/2026.1.0+dist.h02a552c2"
});

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}
function toolEntry(id, name, description) {
  return { id, name, description, version: "2026.1.0", model_class: "Tool", available: true };
}

function liveFailedState(overrides = {}) {
  return {
    workflow_type: "microbiome", run_id: RUN_ID, plan_id: "plan_a8817e35d7534d98",
    status: "failed", created_at: "2026-11-27T00:00:00.000Z",
    retry_count: 1, history_id: "11ac94870d0bb33aff42f70766c41aa1",
    input: { mode: "public", source: {}, filenames: {
      reads: "sequences.fastq.gz", barcodes: "barcodes.fastq.gz", metadata: "sample-metadata.tsv" } },
    input_sha256: "a".repeat(64), metadata_sha256: "b".repeat(64),
    discovery: { tools: { demux: { id: TOOLS.demux, version: "2026.1.0" },
      qc: { id: TOOLS.qc, version: "2026.1.0" } },
    classifier: { available: false, reason: "Galaxy was unavailable during the original run." },
    discovery_mode: "unavailable", discovered_at: null },
    steps: {
      import_reads: { status: "succeeded", provider_job_id: UPLOAD_JOB, tool_id: "upload1" },
      demux: { status: "unavailable", reason: "qza_import_tool_unavailable" },
      qc_summary: { status: "failed", reason: "qc_summary schema failure: no_data_input_for_reads" }
    },
    dataset_ids: { sequences: "22222222222222222222222222222222",
      barcodes: "33333333333333333333333333333333", metadata: "44444444444444444444444444444444" },
    filenames: { reads: "sequences.fastq.gz", barcodes: "barcodes.fastq.gz", metadata: "sample-metadata.tsv" },
    frontier: {}, results: {}, artifacts: [],
    errors: [{ step: "demux", reason: "qza_import_tool_unavailable" },
      { step: "qc_summary", reason: "qc_summary schema failure: no_data_input_for_reads" }],
    poll_count: 2, import: { status: "unavailable", reason: "qza_import_tool_unavailable",
      tool_id: null, source_dataset_ids: {} },
    exports: {}, pending_exports: [],
    ...overrides
  };
}

function seededDb(state) {
  return createFakeD1AI({ microbiome_runs: [{
    public_id: RUN_ID, input_sha256: state.input_sha256, metadata_sha256: state.metadata_sha256,
    state: state.status, plan_id: state.plan_id, run_id: RUN_ID, state_json: JSON.stringify(state),
    result_json: null, created_at: state.created_at, completed_at: state.status === "failed" ? "2026-11-27T00:02:00.000Z" : null
  }] });
}

function resumeStub({ classifierOptions = true } = {}) {
  const calls = [];
  const fetchImpl = async (input, init = {}) => {
    const url = String(input);
    const method = String(init.method ?? "GET").toUpperCase();
    calls.push({ method, url });
    assert.notEqual(method, "POST", "stage resume must never upload or submit a job");
    if (method === "GET" && (url.includes("/api/tools?") || url.endsWith("/api/tools"))) {
      return json([
        toolEntry(TOOLS.demux, "qiime2 demux emp-single", "Demultiplex EMP reads"),
        toolEntry(TOOLS.qc, "qiime2 vsearch fastq-stats", "Quality statistics"),
        toolEntry(TOOLS.denoise, "qiime2 dada2 denoise-single", "Denoise reads"),
        toolEntry(TOOLS.classify, "qiime2 feature-classifier classify-sklearn", "Assign taxonomy"),
        toolEntry(TOOLS.alpha, "qiime2 diversity alpha", "Alpha diversity"),
        toolEntry(TOOLS.beta, "qiime2 diversity core-metrics-phylogenetic", "Core metrics"),
        toolEntry(TOOLS.pcoa, "qiime2 emperor plot", "Emperor plot"),
        toolEntry(TOOLS.importTool, "qiime2 tools import", "Import QIIME 2 artifacts"),
        toolEntry(TOOLS.exportTool, "qiime2 tools export", "Export QIIME 2 artifacts")
      ]);
    }
    if (url.includes("io_details=true") && decodeURIComponent(url).includes(TOOLS.classify)) {
      return json({ tool_id: TOOLS.classify, inputs: [
        { model_class: "DataToolParameter", name: "sequences", extensions: ["fasta"] },
        { model_class: "SelectToolParameter", name: "classifier",
          options: classifierOptions ? [{ value: "silva-138-99-515-806-nb-classifier.qza",
            label: "SILVA 138 99% 515-806 Naive Bayes classifier" }] : [] }
      ] });
    }
    if (url.includes("/api/workflows")) return json([]);
    return json({ error: "unexpected_stub_route", url }, 404);
  };
  return { fetchImpl, calls };
}

async function withStub(stub, fn) {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = stub.fetchImpl;
  try { return await fn(); } finally { globalThis.fetch = previousFetch; }
}
function resume(db, stub) {
  return handleResumeStages(makePostRequest({ run_id: RUN_ID }, PATH),
    { ...mockAIEnv(db), GALAXY_ENABLED: "true", GALAXY_BASE_URL: "https://galaxy.example.test",
      GALAXY_API_KEY: "stub-secret", FETCH_IMPL: stub.fetchImpl },
    { fetchImpl: stub.fetchImpl });
}

test("LABELLED STUB / live-shaped failure resumes once: fresh discovery, stages reset, no POST", async () => {
  const stub = resumeStub();
  const { db, state: d1 } = seededDb(liveFailedState());
  await withStub(stub, async () => {
    const response = await resume(db, stub);
    assert.equal(response.status, 202);
    const body = await response.json();
    assert.equal(body.resumed, true);
    assert.equal(body.run_id, RUN_ID);
    assert.equal(body.current_step, "demux");
    assert.equal(body.stage_resume_count, 1);
    assert.equal(body.discovery_mode, "live");
    assert.equal(body.tool_versions.importTool.id, TOOLS.importTool);
    assert.equal(body.tool_versions.demux.name, "qiime2 demux emp-single");
    assert.equal(body.classifier.available, true);
    assert.equal(body.classifier.option_label, "SILVA 138 99% 515-806 Naive Bayes classifier");
    assert.equal(body.status_url, `/api/ai/workflows/microbiome/status?run_id=${RUN_ID}`);
    assert.equal(body.result_url, `/api/ai/workflows/microbiome/result?run_id=${RUN_ID}`);
    assert.equal(body.recovery_url, `/api/ai/runs/${RUN_ID}/recovery`);
    assert.ok(stub.calls.every((call) => call.method === "GET"));

    const stored = parseJson(d1.tables.microbiome_runs[0].state_json);
    assert.equal(stored.status, "running");
    assert.equal(stored.current_step, "demux");
    assert.equal(stored.retry_count, 1);
    assert.equal(stored.stage_resume_count, 1);
    assert.deepEqual(stored.steps.import_reads,
      { status: "succeeded", provider_job_id: UPLOAD_JOB, tool_id: "upload1" }, "upload job untouched");
    for (const stage of ["demux", "qc_summary", "dada2_denoise", "taxonomy", "composition",
      "alpha_diversity", "beta_diversity", "pcoa", "ordination", "report"]) {
      assert.equal(stored.steps[stage], undefined, `${stage} is not_started again`);
    }
    assert.deepEqual(stored.errors, [], "pre-submission reasons were cleared");
    assert.equal(stored.import, null, "failed import preparation can retry with the fresh import tool");
  });
});

test("LABELLED STUB / cap of nine resumes: first eight allowed, tenth refused", async () => {
  const stub = resumeStub();
  const { db, state: d1 } = seededDb(liveFailedState());
  const refail = () => {
    const row = d1.tables.microbiome_runs[0];
    const state = parseJson(row.state_json);
    state.status = "failed";
    state.steps.demux = { status: "unavailable", reason: "qza_import_tool_unavailable" };
    state.steps.qc_summary = { status: "failed", reason: "qc_summary schema failure: no_data_input_for_reads" };
    state.import = { status: "unavailable", reason: "qza_import_tool_unavailable" };
    state.errors = [{ step: "demux", reason: "qza_import_tool_unavailable" },
      { step: "qc_summary", reason: "qc_summary schema failure: no_data_input_for_reads" }];
    row.state_json = JSON.stringify(state);
    row.state = "failed";
  };
  await withStub(stub, async () => {
    for (let expected = 1; expected <= 8; expected += 1) {
      const response = await resume(db, stub);
      assert.equal(response.status, 202);
      const body = await response.json();
      assert.equal(body.stage_resume_count, expected);
      assert.equal(stub.calls.some((call) => call.method === "POST"), false, "no job was submitted");
      refail();
    }
    const ninth = await resume(db, stub);
    assert.equal(ninth.status, 202);
    assert.equal((await ninth.json()).stage_resume_count, 9);
    refail();
    const capped = await resume(db, stub);
    assert.equal(capped.status, 409);
    assert.equal((await capped.json()).reason, "stage_resume_limit_reached");
  });
});

test("LABELLED STUB / strict guards: provider job, succeeded stage, artifacts, status, retry, reason", async () => {
  const cases = [
    [liveFailedState({ steps: { ...liveFailedState().steps,
      demux: { status: "running", provider_job_id: "job-real" } } }), "scientific_stage_exists"],
    [liveFailedState({ steps: { ...liveFailedState().steps,
      demux: { status: "succeeded", provider_job_id: "job-real" } } }), "scientific_stage_exists"],
    [liveFailedState({ artifacts: [{ name: "feature-table.tsv", source_step: "dada2_denoise", checksum: "a".repeat(64) }] }),
      "scientific_artifacts_present"],
    [liveFailedState({ status: "running" }), "status_not_failed"],
    [liveFailedState({ retry_count: 0 }), "retry_count_not_one"],
    [liveFailedState({ retry_count: 2 }), "retry_count_not_one"],
    [liveFailedState({ steps: { ...liveFailedState().steps,
      qc_summary: { status: "failed", reason: "provider job job-real ended in state error" } } }),
    "provider_failure_not_resumable"],
    // Still under the cap: a real provider-job failure must never be replayed.
    [liveFailedState({ stage_resume_count: 1, steps: { ...liveFailedState().steps,
      dada2_denoise: { status: "failed", reason: "provider job job-real ended in state error" } } }),
    "provider_failure_not_resumable"]
  ];
  for (const [state, reason] of cases) {
    const stub = resumeStub();
    const { db } = seededDb(state);
    await withStub(stub, async () => {
      const response = await resume(db, stub);
      assert.equal(response.status, 409, reason);
      const body = await response.json();
      assert.equal(body.reason, reason, JSON.stringify(body));
      assert.equal(stub.calls.length, 0, `${reason} must refuse before any provider call`);
    });
  }
  const stub = resumeStub();
  const { db } = seededDb(liveFailedState());
  await withStub(stub, async () => {
    const missing = await handleResumeStages(makePostRequest({ run_id: "job_ffffffffffffffff" }, PATH),
      { ...mockAIEnv(db), GALAXY_ENABLED: "true", GALAXY_BASE_URL: "https://galaxy.example.test",
        GALAXY_API_KEY: "stub-secret", FETCH_IMPL: stub.fetchImpl }, { fetchImpl: stub.fetchImpl });
    assert.equal(missing.status, 409);
    assert.equal((await missing.json()).reason, "run_missing");
    assert.equal(stub.calls.length, 0);
  });
});

test("LABELLED STUB / refreshed classifier provenance stays honest on stage resume", async () => {
  const stub = resumeStub({ classifierOptions: false });
  const { db, state: d1 } = seededDb(liveFailedState());
  await withStub(stub, async () => {
    const response = await resume(db, stub);
    assert.equal(response.status, 202);
    const body = await response.json();
    assert.equal(body.classifier.available, false);
    assert.match(body.classifier.reason, /No classifier\/reference option/);
    assert.equal("option_label" in body.classifier, false, "no invented SILVA release");
    assert.equal(body.tool_versions.classify.id, TOOLS.classify);
    await assert.equal(parseJson(d1.tables.microbiome_runs[0].state_json).status, "running");
  });
});
