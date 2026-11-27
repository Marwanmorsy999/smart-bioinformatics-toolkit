// M7.14.2 LABELLED STUBBED SCHEMA-CACHE / TRAVERSAL-BOUND TESTS — ZERO live calls.
// Large QIIME 2 io-details schemas must be fetched once per isolate and their
// traversal bounded; oversized schemas fail closed with an honest reason.
import test from "node:test";
import assert from "node:assert/strict";

import { fetchToolSchema } from "../providers/galaxy/galaxy_schema.js";
import {
  describeLiveParameters, buildMicrobiomePayload, findImportFormatCase
} from "../functions/api/ai/workflows/microbiome/schema.js";
import { handleStatus } from "../functions/api/ai/workflows/microbiome/engine.js";
import { createFakeD1AI, makeGetRequest, mockAIEnv } from "./helpers/fake-d1.mjs";

const RUN_ID = "job_a8817e35d7534d98";
const HISTORY = "11ac94870d0bb33aff42f70766c41aa1";
const DEMUX_QZA = "40160950115d555e26f11fc9fc50ace4";
const TOOL = "qiime2_dada2_denoise_single";

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}
function env() {
  return { GALAXY_BASE_URL: "https://galaxy.example.test", GALAXY_API_KEY: "stub-key" };
}

test("CACHE / identical tool id and version is fetched and parsed only once", async () => {
  let calls = 0;
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    calls += 1;
    return json({ tool_id: TOOL, inputs: [{ model_class: "DataToolParameter", name: "input",
      extensions: ["qza"] }] });
  };
  try {
    const first = await fetchToolSchema(env(), TOOL, "2026.1.0");
    const second = await fetchToolSchema(env(), TOOL, "2026.1.0");
    assert.equal(calls, 1);
    assert.equal(first, second, "the read-only schema object is reused");
    await fetchToolSchema(env(), TOOL, "2025.4.0");
    assert.equal(calls, 2, "a different version is a different cache key");
  } finally { globalThis.fetch = previousFetch; }
});

function hugeSchema() {
  const inputs = [];
  for (let index = 0; index < 6000; index += 1) {
    inputs.push({ model_class: "TextToolParameter", name: `param_${index}`, value: "" });
  }
  return { tool_id: TOOL, inputs };
}

test("BOUND / oversized schemas fail closed without guessing a payload", () => {
  const schema = hugeSchema();
  assert.throws(() => describeLiveParameters(schema),
    (error) => error?.code === "schema_traversal_node_limit");
  const payload = buildMicrobiomePayload(schema, [{ id: DEMUX_QZA, role: "artifact" }], {});
  assert.equal(payload.valid, false);
  assert.ok(payload.errors.includes("schema_traversal_node_limit"));
  assert.deepEqual(payload.inputs, {}, "no partial payload is submitted");
  assert.throws(() => findImportFormatCase(schema),
    (error) => error?.code === "schema_traversal_node_limit");
});

function state() {
  return {
    workflow_type: "microbiome", run_id: RUN_ID, plan_id: "plan_a8817e35d7534d98",
    status: "running", current_step: "dada2_denoise", created_at: "2026-11-27T00:00:00.000Z",
    input_sha256: "a".repeat(64), metadata_sha256: "b".repeat(64),
    input: { mode: "public", source: {}, sample_ids: ["sampleA"], sample_count: 1,
      metadata_text: "sample-id\tbarcode-sequence\nsampleA\tACCGCACTT\n" },
    params: { trim_left: 0, trunc_len: 120 },
    discovery: { tools: { demux: { id: "demux-tool", version: "2026.1.0" },
      denoise: { id: TOOL, version: "2026.1.0" },
      exportTool: { id: "export-tool", version: "2026.1.0" } },
    classifier: { available: false, reason: "none" }, discovery_mode: "live", discovered_at: null },
    dataset_ids: { metadata: "44444444444444444444444444444444" },
    filenames: { reads: "sequences.fastq.gz", barcodes: "barcodes.fastq.gz", metadata: "sample-metadata.tsv" },
    history_id: HISTORY, frontier: { importedSeqsId: DEMUX_QZA, demuxReadsId: DEMUX_QZA },
    results: {}, artifacts: [], errors: [], poll_count: 0, exports: {}, pending_exports: [],
    steps: { import_reads: { status: "succeeded" }, demux: { status: "succeeded", provider_job_id: "demux-job" } },
    import: { status: "succeeded", provider_job_id: "import-job", output_dataset_id: DEMUX_QZA,
      output_history_id: HISTORY, copy_dataset_id: DEMUX_QZA }
  };
}

function seededDb(s) {
  const { db, state: d1 } = createFakeD1AI({ microbiome_runs: [{
    public_id: RUN_ID, input_sha256: s.input_sha256, metadata_sha256: s.metadata_sha256,
    state: s.status, plan_id: s.plan_id, run_id: RUN_ID, state_json: JSON.stringify(s),
    result_json: null, created_at: s.created_at, completed_at: null
  }] });
  return { db, d1 };
}

test("EXPORT / submitted once across repeated polls and tracked in state", async () => {
  const QZA = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  const s = state();
  s.steps.dada2_denoise = { status: "running", provider_job_id: "dada2-job-0001", tool_id: TOOL,
    tool_version: "2026.1.0" };
  let schemaCalls = 0;
  let exportPosts = 0;
  const fetchImpl = async (input, init = {}) => {
    const url = String(input);
    if (url.includes("io_details=true")) {
      schemaCalls += 1;
      return json({ tool_id: "export-tool", inputs: [{ model_class: "DataToolParameter",
        name: "input", extensions: ["qza"] }] });
    }
    if (url.includes("/api/tools?")) {
      return json([{ id: TOOL, name: TOOL, version: "2026.1.0", model_class: "Tool", available: true },
        { id: "export-tool", name: "qiime2 tools export", version: "2026.1.0", model_class: "Tool", available: true }]);
    }
    if (url.includes("/api/workflows")) return json([]);
    if (url.includes("/api/jobs/") && url.includes("/outputs")) return json({ qza: { id: QZA, state: "ok" } });
    if (url.includes("/api/jobs/")) return json({ id: "dada2-job-0001", state: "ok", history_id: HISTORY });
    if (url.includes("/api/histories/") && url.includes("/contents")) {
      return json([{ id: QZA, name: "table.qza", extension: "qza", state: "ok", history_id: HISTORY }]);
    }
    if (String(init.method ?? "GET").toUpperCase() === "POST" && url.endsWith("/api/tools")) {
      exportPosts += 1;
      return json({ outputs: [], jobs: [{ id: `export-job-${exportPosts}` }] });
    }
    return json({ error: "unexpected_stub_route", url }, 404);
  };
  const { db, d1 } = seededDb(s);
  const previousFetch = globalThis.fetch;
  globalThis.fetch = fetchImpl;
  try {
    for (let index = 0; index < 6; index += 1) {
      await handleStatus(makeGetRequest(`/api/ai/workflows/microbiome/status?run_id=${RUN_ID}`),
        { ...mockAIEnv(db), GALAXY_ENABLED: "true", GALAXY_BASE_URL: "https://galaxy.example.test",
          GALAXY_API_KEY: "stub-key", FETCH_IMPL: fetchImpl }, { fetchImpl });
    }
    assert.equal(exportPosts, 1, "the export job is submitted exactly once");
    assert.ok(schemaCalls <= 1, "the export schema is fetched at most once per isolate");
    const stored = JSON.parse(d1.tables.microbiome_runs[0].state_json);
    assert.ok(stored.export_submissions?.dada2_denoise, "a durable submission marker exists");
  } finally { globalThis.fetch = previousFetch; }
});

test("ENGINE / oversized live schema marks the stage unavailable with no job", async () => {
  const s = state();
  let posts = 0;
  const fetchImpl = async (input, init = {}) => {
    const url = String(input);
    if (url.includes("io_details=true")) return json(hugeSchema());
    if (url.includes("/api/tools?")) {
      return json([{ id: TOOL, name: TOOL, version: "2026.1.0", model_class: "Tool", available: true }]);
    }
    if (url.includes("/api/workflows")) return json([]);
    if (String(init.method ?? "GET").toUpperCase() === "POST") { posts += 1; return json({ outputs: [], jobs: [] }); }
    return json({ error: "unexpected_stub_route", url }, 404);
  };
  const { db, d1 } = seededDb(s);
  const previousFetch = globalThis.fetch;
  globalThis.fetch = fetchImpl;
  try {
    await handleStatus(makeGetRequest(`/api/ai/workflows/microbiome/status?run_id=${RUN_ID}`),
      { ...mockAIEnv(db), GALAXY_ENABLED: "true", GALAXY_BASE_URL: "https://galaxy.example.test",
        GALAXY_API_KEY: "stub-key", FETCH_IMPL: fetchImpl }, { fetchImpl });
    const stored = JSON.parse(d1.tables.microbiome_runs[0].state_json);
    assert.equal(stored.steps.dada2_denoise.status, "unavailable");
    assert.match(stored.steps.dada2_denoise.reason, /schema_traversal_node_limit/);
    assert.equal(posts, 0, "no guessed payload was submitted");
  } finally { globalThis.fetch = previousFetch; }
});
