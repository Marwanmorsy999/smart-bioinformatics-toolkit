// M7.14.2 LABELLED STUBBED UPSTREAM-EXCERPT TESTS — ZERO live calls.
// A bare "galaxy returned HTTP 400" is not enough to fix a live demux payload.
// These tests prove a bounded, redacted excerpt of Galaxy's OWN error text is
// surfaced by the adapter, stored allowlisted in state, and re-scrubbed by the
// read-only diagnostic endpoint. No credential or full response is exposed.
import test from "node:test";
import assert from "node:assert/strict";

import { createAdapter } from "../providers/galaxy/index.js";
import { handleStatus } from "../functions/api/ai/workflows/microbiome/engine.js";
import { createFakeD1AI, makeGetRequest, mockAIEnv } from "./helpers/fake-d1.mjs";

const RUN_ID = "job_a8817e35d7534d98";
const HISTORY = "11ac94870d0bb33aff42f70766c41aa1";
const QZA = "40160950115d555ee2c60c40e6fab7e5";
const META = "44444444444444444444444444444444";
const DEMUX_TOOL = "toolshed.g2.bx.psu.edu/repos/iuc/qiime2_demux_emp_single/2026.1.0";
const SECRET = "galaxy-secret-abcdef123456";
const BAD_TEXT = `barcodes|column is not a valid column; api_key=${SECRET}; `
  + `see https://galaxy.example.test/tools?run_id=7&token=${SECRET}`;

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function state() {
  return {
    workflow_type: "microbiome", run_id: RUN_ID, plan_id: "plan_a8817e35d7534d98",
    status: "running", current_step: "demux", created_at: "2026-11-27T00:00:00.000Z",
    input_sha256: "a".repeat(64), metadata_sha256: "b".repeat(64),
    input: { mode: "public", source: {}, sample_ids: ["sampleA"], sample_count: 1 },
    params: { trim_left: 0, trunc_len: 120 },
    discovery: { tools: { demux: { id: DEMUX_TOOL, name: "qiime2 demux emp-single", version: "2026.1.0" } },
      classifier: { available: false, reason: "none" }, discovery_mode: "live", discovered_at: null },
    dataset_ids: { metadata: META },
    filenames: { reads: "sequences.fastq.gz", barcodes: "barcodes.fastq.gz", metadata: "sample-metadata.tsv" },
    history_id: HISTORY, frontier: { importedSeqsId: QZA }, results: {}, artifacts: [], errors: [], poll_count: 0,
    steps: { import_reads: { status: "succeeded", provider_job_id: "uploadjob00000001" } },
    exports: {}, pending_exports: [],
    import: { status: "succeeded", provider_job_id: "import-job-0001", output_dataset_id: QZA,
      output_history_id: HISTORY, copy_dataset_id: QZA, copy: { verified: true, reused: true } }
  };
}

function seededDb(s) {
  return createFakeD1AI({ microbiome_runs: [{
    public_id: RUN_ID, input_sha256: s.input_sha256, metadata_sha256: s.metadata_sha256,
    state: s.status, plan_id: s.plan_id, run_id: RUN_ID, state_json: JSON.stringify(s),
    result_json: null, created_at: s.created_at, completed_at: null
  }] });
}

function makeEngineStub(body) {
  const fetchImpl = async (input, init = {}) => {
    const url = String(input);
    if (url.includes("io_details=true")) {
      return json({ tool_id: DEMUX_TOOL, inputs: [
        { model_class: "DataToolParameter", name: "seqs", extensions: ["qza"] },
        { model_class: "DataToolParameter", name: "metadata", extensions: ["tsv"] }
      ] });
    }
    if (methodOf(init) === "POST" && url.endsWith("/api/tools")) return json(body, 400);
    return json({ error: "unexpected_stub_route", url }, 404);
  };
  return fetchImpl;
}
function methodOf(init) { return String(init.method ?? "GET").toUpperCase(); }

test("ADAPTER / 400 JSON err_msg is surfaced as a bounded sanitized upstream_excerpt", async () => {
  const adapter = createAdapter({ GALAXY_ENABLED: "true", GALAXY_BASE_URL: "https://galaxy.example.test",
    GALAXY_API_KEY: SECRET });
  const fetchImpl = async () => json({ err_msg: BAD_TEXT + " ".repeat(2000), error: "bad_request" }, 400);
  const result = await adapter.submitJob({ operation: "submit_job", tool_id: DEMUX_TOOL,
    inputs: { seqs: { src: "hda", id: QZA } } }, { fetch: fetchImpl });
  assert.equal(result.error.status, 400);
  assert.equal(result.error.message, "galaxy returned HTTP 400");
  const excerpt = result.error.upstream_excerpt;
  assert.ok(excerpt && excerpt.length <= 600);
  assert.match(excerpt, /barcodes\|column is not a valid column/);
  assert.doesNotMatch(excerpt, new RegExp(SECRET));
  assert.doesNotMatch(excerpt, /https?:\/\//);
  assert.doesNotMatch(excerpt, /run_id=/);
  assert.equal(result.error.code, "bad_request");
});

test("ADAPTER / non-JSON 400 body also yields a redacted bounded excerpt", async () => {
  const adapter = createAdapter({ GALAXY_ENABLED: "true", GALAXY_BASE_URL: "https://galaxy.example.test",
    GALAXY_API_KEY: SECRET });
  const fetchImpl = async () => new Response(BAD_TEXT, { status: 400,
    headers: { "Content-Type": "text/plain" } });
  const result = await adapter.submitJob({ operation: "submit_job", tool_id: DEMUX_TOOL,
    inputs: {} }, { fetch: fetchImpl });
  assert.equal(result.error.status, 400);
  assert.match(result.error.upstream_excerpt, /barcodes\|column/);
  assert.doesNotMatch(result.error.upstream_excerpt, new RegExp(SECRET));
});

test("PERSISTED / excerpt is stored allowlisted and redacted in run state", async () => {
  const fetchImpl = makeEngineStub({ err_msg: BAD_TEXT, error: "bad_request" });
  const { db, state: d1 } = seededDb(state());
  const env = { ...mockAIEnv(db), GALAXY_ENABLED: "true", GALAXY_BASE_URL: "https://galaxy.example.test",
    GALAXY_API_KEY: SECRET, FETCH_IMPL: fetchImpl };
  const previousFetch = globalThis.fetch;
  globalThis.fetch = fetchImpl;
  try {
    await handleStatus(makeGetRequest(`/api/ai/workflows/microbiome/status?run_id=${RUN_ID}`), env,
      { fetchImpl });
    const stored = JSON.parse(d1.tables.microbiome_runs[0].state_json);
    const entry = stored.submission_failures?.[0];
    assert.ok(entry, "a failure summary was stored");
    assert.match(entry.upstream_excerpt, /barcodes\|column/);
    assert.ok(entry.upstream_excerpt.length <= 600);
    assert.doesNotMatch(entry.upstream_excerpt, new RegExp(SECRET));
    assert.doesNotMatch(JSON.stringify(entry), new RegExp(QZA));
    assert.doesNotMatch(JSON.stringify(entry), new RegExp(META));
    assert.doesNotMatch(JSON.stringify(entry), /"src":"hda"/, "field names only, no payload values");
    const allowed = new Set(["step_id", "at", "tool_id", "tool_version", "field_names",
      "http_status", "error_code", "error_message", "upstream_excerpt", "basis"]);
    assert.ok(Object.keys(entry).every((key) => allowed.has(key)),
      `non-allowlisted persisted field: ${Object.keys(entry).join(", ")}`);
    assert.doesNotMatch(JSON.stringify(entry), /https?:\/\//);
  } finally { globalThis.fetch = previousFetch; }
});
