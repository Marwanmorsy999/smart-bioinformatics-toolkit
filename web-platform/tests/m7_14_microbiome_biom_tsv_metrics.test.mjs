// M7.14.3 LABELLED STUBBED BIOM-TSV / DIVERSITY-METRIC TESTS — ZERO live calls.
//
// `biom convert` writes integer counts as ".0" floats after a provenance
// comment; and Galaxy diversity tools require a metric whose value must come
// from the LIVE schema, never from a guessed string.
import test from "node:test";
import assert from "node:assert/strict";

import {
  parseFeatureTable, validateFeatureTableIntegrity
} from "../functions/api/ai/workflows/microbiome/parsers.js";
import { handleAdvance } from "../functions/api/ai/workflows/microbiome/engine.js";
import { createFakeD1AI, makePostRequest, mockAIEnv } from "./helpers/fake-d1.mjs";

const RUN = "job_a8817e35d7534d98";
const HISTORY = "11ac94870d0bb33aff42f70766c41aa1";
const TABLE_QZA = "40160950115d555ed5330c1bedac2181";
const ALPHA_TOOL = "toolshed.g2.bx.psu.edu/repos/iuc/qiime2_diversity_alpha/7+galaxy1";
const BETA_TOOL = "toolshed.g2.bx.psu.edu/repos/iuc/qiime2_diversity_beta/7+galaxy1";
const TEST_KEY = "stub-key-not-a-real-secret";
const NONE = "__q2galaxy__::literal::None";

// Exact shape of the genuine /artifact output (first lines, integer-valued
// floats, provenance comment) — only the sample list is shortened here.
const REAL_BIOM_TSV = [
  "# Constructed from biom file",
  "#OTU ID\tL1S105\tL1S140",
  "24e2592358b93fc90c0509a4a7e9be95\t2068.0\t0.0",
  "c3f1a0b8d2e4f6a8b0c2d4e6f8a0b2c4\t12.0\t7.0"
].join("\n");

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

test("PARSER / genuine biom-convert TSV comment, .0 counts and exact ids are accepted", () => {
  const parsed = parseFeatureTable(REAL_BIOM_TSV);
  assert.equal(parsed.available, true, parsed.reason);
  assert.equal(parsed.format, "tsv");
  assert.deepEqual(parsed.sample_ids, ["L1S105", "L1S140"]);
  assert.deepEqual(parsed.feature_ids,
    ["24e2592358b93fc90c0509a4a7e9be95", "c3f1a0b8d2e4f6a8b0c2d4e6f8a0b2c4"]);
  assert.equal(parsed.counts["24e2592358b93fc90c0509a4a7e9be95"].L1S105, 2068);
  assert.equal(parsed.counts["24e2592358b93fc90c0509a4a7e9be95"].L1S140, 0);
  assert.equal(parsed.totals.L1S105, 2080);
  assert.equal(parsed.errors.length, 0);
});

test("PARSER / fractional or non-numeric cells fail closed; duplicate integrity stays strict", () => {
  const fractional = parseFeatureTable(REAL_BIOM_TSV.replace("2068.0", "2068.5"));
  assert.equal(fractional.available, false);
  assert.match(fractional.reason, /Invalid non-integer cell value/);
  assert.ok(fractional.errors.some((entry) => entry.startsWith("non_integer_count:")));
  const text = parseFeatureTable(REAL_BIOM_TSV.replace("0.0", "not-a-count"));
  assert.equal(text.available, false);
  const duplicate = parseFeatureTable(REAL_BIOM_TSV + "\n"
    + "24e2592358b93fc90c0509a4a7e9be95\t1.0\t2.0");
  assert.deepEqual(duplicate.duplicates, ["24e2592358b93fc90c0509a4a7e9be95"]);
  const integrity = validateFeatureTableIntegrity({ table: duplicate, repSeqs: null, taxonomy: null,
    metadata: { sample_ids: ["L1S105", "L1S140"] } });
  assert.equal(integrity.valid, false);
  assert.ok(integrity.errors.some((entry) => /duplicate feature ids/.test(entry)));
});

function diversityState(stepId, toolId) {
  return {
    workflow_type: "microbiome", run_id: RUN, plan_id: "plan_a8817e35d7534d98",
    status: "running", current_step: stepId, created_at: "2026-11-27T00:00:00.000Z",
    input_sha256: "a".repeat(64), metadata_sha256: "b".repeat(64),
    input: { mode: "public", source: {}, sample_ids: ["L1S105", "L1S140"], sample_count: 2,
      metadata_text: "sample-id\tbarcode-sequence\nL1S105\tA\nL1S140\tC\n" },
    params: { trim_left: 0, trunc_len: 120, rarefaction_depth: 1 },
    discovery: { tools: { [stepId === "alpha_diversity" ? "alpha" : "beta"]:
      { id: toolId, version: "7+galaxy1" } }, classifier: { available: false }, discovery_mode: "live" },
    history_id: HISTORY, frontier: { featureTableId: TABLE_QZA },
    steps: { import_reads: { status: "succeeded" }, demux: { status: "succeeded" },
      qc_summary: { status: "unavailable" }, dada2_denoise: { status: "succeeded" },
      [stepId]: {} },
    results: { asv: { available: true, feature_count: 2, sample_count: 2 } },
    artifacts: [], errors: [], poll_count: 0, exports: {}, pending_exports: [],
    advance_op: "submit_stage"
  };
}

function diversitySchema(toolId, options) {
  return { tool_id: toolId, inputs: [
    { model_class: "DataToolParameter", name: "table", optional: false, extensions: ["qza"] },
    { model_class: "Select", name: "metric", optional: false, value: NONE,
      options: options.map((value) => ({ value,
        label: value === NONE ? "Selection required"
          : value.replace(/[^a-z0-9]+/gi, "") === "braycurtis" ? "Bray-Curtis" : value })) }
  ] };
}

async function submit(stepId, toolId, options, schemaOverride = null) {
  const s = diversityState(stepId, toolId);
  const { db, state: d1 } = createFakeD1AI({ microbiome_runs: [{
    public_id: RUN, input_sha256: s.input_sha256, metadata_sha256: s.metadata_sha256,
    state: "running", plan_id: s.plan_id, run_id: RUN, state_json: JSON.stringify(s),
    result_json: null, created_at: s.created_at, completed_at: null
  }] });
  const submissions = [];
  const fetchImpl = async (input, init = {}) => {
    const url = String(input);
    if (url.includes("io_details=true")) {
      return json(schemaOverride ?? diversitySchema(toolId, options));
    }
    if (String(init.method).toUpperCase() === "POST" && url.endsWith("/api/tools")) {
      submissions.push(JSON.parse(String(init.body)));
      return json({ outputs: [{ id: "dddddddddddddddddddddddddddddddd" }],
        jobs: [{ id: "metric-job-0001" }] });
    }
    return json({ error: "unexpected_stub_route", url }, 404);
  };
  const env = { ...mockAIEnv(db), MICROBIOME_TEST_ADVANCE: false, GALAXY_ENABLED: "true",
    GALAXY_BASE_URL: "https://galaxy.example.test", GALAXY_API_KEY: TEST_KEY, FETCH_IMPL: fetchImpl };
  const previous = globalThis.fetch;
  globalThis.fetch = fetchImpl;
  try {
    const response = await handleAdvance(makePostRequest({ run_id: RUN },
      "/api/ai/workflows/microbiome/advance"), env, { fetchImpl });
    return { response, body: await response.json(), submissions,
      stored: JSON.parse(d1.tables.microbiome_runs[0].state_json) };
  } finally { globalThis.fetch = previous; }
}

test("ALPHA METRIC / shannon is taken verbatim from LIVE options, never the None default", async () => {
  const { submissions, stored } = await submit("alpha_diversity", ALPHA_TOOL,
    [NONE, "observed_features", "shannon"]);
  assert.equal(submissions.length, 1);
  assert.equal(submissions[0].inputs.metric, "shannon");
  assert.notEqual(submissions[0].inputs.metric, NONE);
  assert.equal(stored.steps.alpha_diversity.metric.value, "shannon");
  assert.equal(stored.steps.alpha_diversity.metric.field, "metric");
  assert.equal(stored.steps.alpha_diversity.metric.basis, "live_schema_option");
  assert.equal(stored.steps.alpha_diversity.status, "running");
  assert.ok(stored.steps.alpha_diversity.metric.candidates.some((entry) => entry.value === "observed_features"));
});

test("BETA METRIC / the live 'braycurtis' option value is used, not a guessed bray_curtis", async () => {
  const { submissions, stored } = await submit("beta_diversity", BETA_TOOL,
    [NONE, "braycurtis", "jaccard"]);
  assert.equal(submissions.length, 1);
  assert.equal(submissions[0].inputs.metric, "braycurtis");
  assert.equal(stored.steps.beta_diversity.metric.value, "braycurtis");
  assert.equal(stored.steps.beta_diversity.metric.label, "Bray-Curtis");
});

test("DIVERSITY METRIC / a select with only the None option fails closed with no submission", async () => {
  const { submissions, stored, body } = await submit("alpha_diversity", ALPHA_TOOL, [NONE]);
  assert.equal(submissions.length, 0);
  assert.equal(stored.status, "running");
  assert.equal(stored.steps.alpha_diversity.status, "unavailable");
  assert.match(stored.steps.alpha_diversity.reason, /^alpha_diversity metric unavailable: no_matching_live_metric_option/);
  assert.equal(body.operation, "submit_stage");
});

// Real Galaxy io_details tuples are [label, value, selected], not objects.
const ALPHA_TUPLE_SCHEMA = { tool_id: ALPHA_TOOL, inputs: [
  { model_class: "DataToolParameter", name: "table", optional: false, extensions: ["qza"] },
  { model_class: "Select", name: "metric", optional: false, value: NONE,
    options: [
      ["Selection required", NONE, false],
      ["shannon", "shannon", false],
      ["observed_features", "observed_features", false]
    ] }
] };

test("ALPHA METRIC / real Galaxy option tuples apply shannon, never the None sentinel", async () => {
  const { submissions, stored } = await submit("alpha_diversity", ALPHA_TOOL, [], ALPHA_TUPLE_SCHEMA);
  assert.equal(submissions.length, 1);
  assert.equal(submissions[0].inputs.metric, "shannon");
  assert.notEqual(submissions[0].inputs.metric, NONE);
  assert.equal(stored.steps.alpha_diversity.metric.value, "shannon");
  assert.equal(stored.steps.alpha_diversity.metric.field, "metric");
  assert.equal(stored.steps.alpha_diversity.metric.basis, "live_schema_option");
  assert.ok(stored.steps.alpha_diversity.metric.candidates.some((entry) => entry.value === "observed_features"));
});

test("BETA METRIC / a real Galaxy [label, value] tuple resolves to braycurtis", async () => {
  const schema = { tool_id: BETA_TOOL, inputs: [
    { model_class: "DataToolParameter", name: "table", optional: false, extensions: ["qza"] },
    { model_class: "Select", name: "metric", optional: false, value: NONE,
      options: [["Selection required", NONE, false], ["Bray-Curtis", "braycurtis", false]] }
  ] };
  const { submissions, stored } = await submit("beta_diversity", BETA_TOOL, [], schema);
  assert.equal(submissions.length, 1);
  assert.equal(submissions[0].inputs.metric, "braycurtis");
  assert.equal(stored.steps.beta_diversity.metric.value, "braycurtis");
  assert.equal(stored.steps.beta_diversity.metric.label, "Bray-Curtis");
});

test("DIVERSITY METRIC / a metric select with zero parseable option values fails closed", async () => {
  const schema = { tool_id: ALPHA_TOOL, inputs: [
    { model_class: "DataToolParameter", name: "table", optional: false, extensions: ["qza"] },
    { model_class: "Select", name: "metric", optional: false, value: NONE,
      options: [[], ["", "", false]] }
  ] };
  const { submissions, stored } = await submit("alpha_diversity", ALPHA_TOOL, [], schema);
  assert.equal(submissions.length, 0);
  assert.equal(stored.steps.alpha_diversity.status, "unavailable");
  assert.match(stored.steps.alpha_diversity.reason,
    /^alpha_diversity metric unavailable: live_schema_option_unavailable: no parseable option values/);
  assert.equal(stored.steps.alpha_diversity.metric.basis, "live_schema_option_unavailable");
});
