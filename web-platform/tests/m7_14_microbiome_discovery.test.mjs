// M7.14.1 LABELLED STUBBED DISCOVERY TESTS — ZERO live calls.
//
// A 4466-tool-like panel with the real wrong-match decoys placed FIRST proves
// exact-name discovery cannot select an unrelated tool. Refresh-discovery is
// exercised against a stubbed Galaxy that fails on any POST (no job, no upload).
import test from "node:test";
import assert from "node:assert/strict";
import { parseJson } from "../functions/api/ai/_lib.js";
import { findToolById, findPhyloTools } from "../providers/galaxy/galaxy_phylo.js";
import {
  findMicrobiomeTools, discoverClassifierOptions
} from "../providers/galaxy/galaxy_microbiome.js";
import { handleRefreshDiscovery } from "../functions/api/ai/workflows/microbiome/engine.js";
import { createFakeD1AI, makePostRequest, mockAIEnv } from "./helpers/fake-d1.mjs";

const RUN_ID = "job_a8817e35d7534d98";
const HISTORY = "11ac94870d0bb33aff42f70766c41aa1";
const REFRESH_PATH = "/api/ai/workflows/microbiome/refresh-discovery";

const CORRECT = Object.freeze({
  demux: { name: "qiime2 demux emp-single", id: "toolshed.g2.bx.psu.edu/repos/iuc/qiime2_demux_emp_single/2026.1.0" },
  qc: { name: "qiime2 vsearch fastq-stats", id: "toolshed.g2.bx.psu.edu/repos/iuc/qiime2_vsearch_fastq_stats/2026.1.0" },
  denoise: { name: "qiime2 dada2 denoise-single", id: "toolshed.g2.bx.psu.edu/repos/iuc/qiime2_dada2_denoise_single/2026.1.0" },
  classify: { name: "qiime2 feature-classifier classify-sklearn", id: "toolshed.g2.bx.psu.edu/repos/iuc/qiime2_feature_classifier_classify_sklearn/2026.1.0" },
  alpha: { name: "qiime2 diversity alpha", id: "toolshed.g2.bx.psu.edu/repos/iuc/qiime2_diversity_alpha/2026.1.0" },
  beta: { name: "qiime2 diversity core-metrics-phylogenetic", id: "toolshed.g2.bx.psu.edu/repos/iuc/qiime2_diversity_core_metrics_phylogenetic/2026.1.0" },
  pcoa: { name: "qiime2 emperor plot", id: "toolshed.g2.bx.psu.edu/repos/iuc/qiime2_emperor_plot/2026.1.0" },
  exportTool: { name: "qiime2 tools export", id: "toolshed.g2.bx.psu.edu/repos/q2d2/qiime2_core__tools__export/2026.1.0+dist.h02a552c2" },
  tableSummary: { name: "qiime2 feature-table summarize", id: "toolshed.g2.bx.psu.edu/repos/iuc/qiime2_feature_table_summarize/2026.1.0" }
});
// Exactly the tools loose substring matching wrongly selected in production.
const DECOYS = Object.freeze([
  { name: "qiime2 cutadapt demux-paired", id: "decoy.cutadapt.demux.paired" },
  { name: "fastplong", id: "decoy.fastplong" },
  { name: "qiime2 sidle trim-dada2-posthoc", id: "decoy.sidle" },
  { name: "mothur classify_tree", id: "decoy.mothur.classify_tree" },
  { name: "alphagenome_variant_effect", id: "decoy.alphagenome" },
  { name: "vcfdistance", id: "decoy.vcfdistance" },
  { name: "qiime_make_emperor", id: "decoy.qiime_make_emperor" }
]);

function tool(name, id, description = "Verified live Galaxy tool") {
  return { id, name, description, version: "2026.1.0", model_class: "Tool", available: true };
}

function realisticPanel() {
  const panel = [];
  // Decoys first: the old first-in-panel loose match would pick every one.
  for (const decoy of DECOYS) panel.push(tool(decoy.name, decoy.id, "Tool"));
  const correct = Object.values(CORRECT).map((entry) => tool(entry.name, entry.id));
  const fillerTarget = 4466 - panel.length - correct.length;
  for (let index = 0; index < fillerTarget; index += 1) {
    panel.push(tool(`unrelated galaxy tool ${index}`, `unrelated.${index}`, "Unrelated analysis tool"));
  }
  panel.push(...correct);
  return panel;
}

const CLASSIFIER_SCHEMA = {
  tool_id: CORRECT.classify.id,
  inputs: [{
    model_class: "DataToolParameter", name: "sequences", optional: false, extensions: ["fasta"]
  }, {
    model_class: "SelectToolParameter", name: "classifier", optional: false,
    help: "Classifier to use for taxonomic assignment",
    options: [{ value: "silva-138-99-515-806-nb-classifier.qza",
      label: "SILVA 138 99% 515-806 Naive Bayes classifier" }]
  }]
};

function resumedState(overrides = {}) {
  return {
    workflow_type: "microbiome", run_id: RUN_ID, plan_id: "plan_a8817e35d7534d98",
    status: "running", current_step: "import_reads", created_at: "2026-11-27T00:00:00.000Z",
    retry_count: 1, history_id: HISTORY,
    input: { mode: "public", source: { urls: {}, checksums: {} },
      filenames: { reads: "sequences.fastq.gz", barcodes: "barcodes.fastq.gz", metadata: "sample-metadata.tsv" } },
    input_sha256: "a".repeat(64), metadata_sha256: "b".repeat(64),
    discovery: { tools: { demux: null, qc: null, denoise: null, classify: null, alpha: null,
      beta: null, pcoa: null, exportTool: null, tableSummary: null },
    classifier: { available: false, reason: "Galaxy was unavailable during the original run." },
    discovery_mode: "unavailable", discovered_at: null },
    steps: { import_reads: { status: "running", provider_job_id: "uploadjob00000001", tool_id: "upload1" } },
    dataset_ids: { sequences: null, barcodes: null, metadata: null },
    artifacts: [], errors: [], poll_count: 0, ...overrides
  };
}

function seededDb(state) {
  return createFakeD1AI({ microbiome_runs: [{
    public_id: RUN_ID, input_sha256: state.input_sha256, metadata_sha256: state.metadata_sha256,
    state: state.status, plan_id: state.plan_id, run_id: RUN_ID, state_json: JSON.stringify(state),
    result_json: null, created_at: state.created_at, completed_at: null
  }] });
}

function refreshStub({ classifierSchema = CLASSIFIER_SCHEMA } = {}) {
  const calls = [];
  const fetchImpl = async (input, init = {}) => {
    const url = String(input);
    const method = String(init.method ?? "GET").toUpperCase();
    calls.push({ method, url });
    assert.notEqual(method, "POST", "refresh-discovery must never submit a job, upload or create a run");
    if (method === "GET" && (url.includes("/api/tools?") || url.endsWith("/api/tools"))) return json(realisticPanel());
    if (url.includes("io_details=true")) {
      const decoded = decodeURIComponent(url);
      if (decoded.includes(CORRECT.classify.id)) return json(classifierSchema);
      return json({ tool_id: "stub", inputs: [{ model_class: "DataToolParameter", name: "input", extensions: ["tsv"] }] });
    }
    if (url.includes("/api/workflows")) return json([]);
    return json({ error: "unexpected_stub_route", url }, 404);
  };
  return { fetchImpl, calls };
}
function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}
async function withStub(stub, fn) {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = stub.fetchImpl;
  try { return await fn(); } finally { globalThis.fetch = previousFetch; }
}
function refresh(db, stub) {
  return handleRefreshDiscovery(makePostRequest({ run_id: RUN_ID }, REFRESH_PATH),
    { ...mockAIEnv(db), GALAXY_ENABLED: "true", GALAXY_BASE_URL: "https://galaxy.example.test",
      GALAXY_API_KEY: "stub-secret", FETCH_IMPL: stub.fetchImpl },
    { fetchImpl: stub.fetchImpl });
}

test("LABELLED STUB / 4466-tool panel: every role selects the exact scientific tool, never a decoy", () => {
  const panel = realisticPanel();
  assert.equal(panel.length, 4466);
  const found = findMicrobiomeTools(panel);
  for (const [role, expected] of Object.entries(CORRECT)) {
    assert.equal(found[role]?.id, expected.id, `${role} must not be a loose substring match`);
    assert.equal(found[role]?.name, expected.name);
  }
  const decoyIds = new Set(DECOYS.map((entry) => entry.id));
  assert.equal(Object.values(found).some((entry) => decoyIds.has(entry?.id)), false,
    "no cutadapt-paired, fastplong, sidle, mothur, alphagenome, vcfdistance or qiime_make_emperor");
  assert.equal(found.beta.name, "qiime2 diversity core-metrics-phylogenetic", "ordered exact fallback works");

  // strictExact returns null instead of falling back to loose criteria.
  assert.equal(findToolById(panel, { exactNames: ["qiime2 demux emp-single"], strictExact: true,
    nameIncludes: ["demux"], descriptionIncludes: ["demultiplex"] })?.id, CORRECT.demux.id);
  assert.equal(findToolById(panel, { exactNames: ["not in panel"], strictExact: true,
    nameIncludes: ["demux"] }), null);
  // Without strictExact the legacy loose path remains available for other callers.
  assert.equal(findToolById(panel, { exactNames: ["not in panel"], nameIncludes: ["demux"] })?.id,
    DECOYS[0].id, "loose fallback is opt-out only, not the microbiome default");
  // Phylo behaviour is untouched: loose criteria still work as before.
  const phyloPanel = [tool("MAFFT", "phylo.mafft", "alignment program"),
    tool("IQ-TREE", "phylo.iqtree", "evolutionary tree")];
  assert.equal(findPhyloTools(phyloPanel).mafft.id, "phylo.mafft");
  assert.equal(findPhyloTools(phyloPanel).iqtree.id, "phylo.iqtree");
});

test("LABELLED STUB / refresh-discovery updates a resumed run with no new job", async () => {
  const stub = refreshStub();
  const { db, state: d1 } = seededDb(resumedState());
  await withStub(stub, async () => {
    const response = await refresh(db, stub);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.refreshed, true);
    assert.equal(body.run_id, RUN_ID);
    assert.equal(body.discovery_mode, "live");
    assert.equal(body.tool_versions.demux.id, CORRECT.demux.id);
    assert.equal(body.tool_versions.beta.name, "qiime2 diversity core-metrics-phylogenetic");
    assert.equal(body.tool_versions.exportTool.id, CORRECT.exportTool.id);
    assert.equal(body.classifier.available, true);
    assert.equal(body.classifier.option_label, "SILVA 138 99% 515-806 Naive Bayes classifier");
    assert.equal(body.classifier.reference_release, "138");
    assert.ok(stub.calls.every((call) => call.method === "GET"));
    const stored = parseJson(d1.tables.microbiome_runs[0].state_json);
    assert.equal(stored.discovery.tools.demux.id, CORRECT.demux.id);
    assert.equal(stored.status, "running");
    assert.equal(stored.current_step, "import_reads");
    assert.equal(stored.retry_count, 1);
    assert.equal(stored.history_id, HISTORY);
    assert.deepEqual(stored.steps, resumedState().steps, "no scientific stage was created");
    assert.deepEqual(stored.artifacts, []);
  });
});

test("LABELLED STUB / refresh refused once a scientific stage, artifact or wrong state exists", async () => {
  const cases = [
    [resumedState({ steps: { ...resumedState().steps, demux: { status: "running", provider_job_id: "job-x" } } }),
      "scientific_stage_exists"],
    [resumedState({ steps: { ...resumedState().steps, demux: { status: "succeeded" } } }), "scientific_stage_exists"],
    [resumedState({ steps: { ...resumedState().steps, demux: { status: "unavailable", reason: "no tool" } } }),
      "scientific_stage_exists"],
    [resumedState({ steps: { ...resumedState().steps, demux: { provider_job_id: "job-x" } } }), "scientific_stage_exists"],
    [resumedState({ artifacts: [{ name: "feature-table.tsv", checksum: "a".repeat(64) }] }), "artifacts_present"],
    [resumedState({ retry_count: 0 }), "retry_count_not_one"],
    [resumedState({ status: "failed" }), "status_not_running"]
  ];
  for (const [state, reason] of cases) {
    const stub = refreshStub();
    const { db } = seededDb(state);
    await withStub(stub, async () => {
      const response = await refresh(db, stub);
      assert.equal(response.status, 409, reason);
      const body = await response.json();
      assert.equal(body.reason, reason, JSON.stringify(body));
      assert.equal(stub.calls.length, 0, `${reason} must be refused before any provider call`);
    });
  }
  const stub = refreshStub();
  const { db } = seededDb(resumedState());
  await withStub(stub, async () => {
    const missing = await handleRefreshDiscovery(makePostRequest({ run_id: "job_ffffffffffffffff" }, REFRESH_PATH),
      { ...mockAIEnv(db), GALAXY_ENABLED: "true", GALAXY_BASE_URL: "https://galaxy.example.test",
        GALAXY_API_KEY: "stub-secret", FETCH_IMPL: stub.fetchImpl }, { fetchImpl: stub.fetchImpl });
    assert.equal(missing.status, 409);
    assert.equal((await missing.json()).reason, "run_missing");
    assert.equal(stub.calls.length, 0);
  });
});

test("LABELLED STUB / classifier provenance is honest: real options, no options, wrong tool", () => {
  const real = discoverClassifierOptions(CLASSIFIER_SCHEMA,
    { toolId: CORRECT.classify.id, version: "2026.1.0" });
  assert.equal(real.available, true);
  assert.equal(real.option_value, "silva-138-99-515-806-nb-classifier.qza");
  assert.equal(real.option_label, "SILVA 138 99% 515-806 Naive Bayes classifier");
  assert.equal(real.reference_release, "138", "release comes only from the exposed label");
  assert.equal(real.selection_basis, "live_tool_schema_options");

  const noOptions = discoverClassifierOptions({ tool_id: CORRECT.classify.id,
    inputs: [{ model_class: "DataToolParameter", name: "classifier", extensions: ["qza"] }] },
  { toolId: CORRECT.classify.id });
  assert.equal(noOptions.available, false);
  assert.match(noOptions.reason, /No classifier\/reference option/);
  assert.equal("reference_release" in noOptions, false, "no release was guessed");

  const wrongTool = discoverClassifierOptions({ tool_id: "mothur.classify_tree",
    inputs: CLASSIFIER_SCHEMA.inputs }, { toolId: CORRECT.classify.id });
  assert.equal(wrongTool.available, false);
  assert.match(wrongTool.reason, /different tool/);
  assert.equal("option_label" in wrongTool, false);
});

test("LABELLED STUB / refresh with an option-less classify schema stays unavailable", async () => {
  const stub = refreshStub({ classifierSchema: { tool_id: CORRECT.classify.id,
    inputs: [{ model_class: "DataToolParameter", name: "classifier", extensions: ["qza"] }] } });
  const { db } = seededDb(resumedState());
  await withStub(stub, async () => {
    const response = await refresh(db, stub);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.classifier.available, false);
    assert.match(body.classifier.reason, /No classifier\/reference option/);
    assert.equal("option_label" in body.classifier, false, "no invented SILVA release or label");
    assert.equal(body.tool_versions.classify.id, CORRECT.classify.id);
  });
});
