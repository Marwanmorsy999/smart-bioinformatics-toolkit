// M7.14.2 LABELLED STUBBED BOUNDED-FINALIZATION TESTS — ZERO live calls.
// A succeeded provider job with many outputs must finalize over several polls,
// downloading at most two artifacts / 200 KiB per request, never parse an
// oversized artifact, and retain real qza dataset ids from associations.
import test from "node:test";
import assert from "node:assert/strict";

import { handleStatus } from "../functions/api/ai/workflows/microbiome/engine.js";
import { createFakeD1AI, makeGetRequest, mockAIEnv } from "./helpers/fake-d1.mjs";

const RUN_ID = "job_a8817e35d7534d98";
const HISTORY = "11ac94870d0bb33aff42f70766c41aa1";
const DADA2_JOB = "4838ba20a6d86765003a967a5114bbb1";
const IMPORTED_QZA = "40160950115d555e26f11fc9fc50ace4";
const DADA2_TOOL = "toolshed.g2.bx.psu.edu/repos/iuc/qiime2_dada2_denoise_single/2026.1.0";

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function makeId(n) { return n.toString(16).padStart(32, "a"); }

function state() {
  return {
    workflow_type: "microbiome", run_id: RUN_ID, plan_id: "plan_a8817e35d7534d98",
    status: "running", current_step: "dada2_denoise", created_at: "2026-11-27T00:00:00.000Z",
    input_sha256: "a".repeat(64), metadata_sha256: "b".repeat(64),
    input: { mode: "public", source: {}, sample_ids: ["sampleA"], sample_count: 1,
      metadata_text: "sample-id\tbarcode-sequence\nsampleA\tACCGCACTT\n" },
    params: { trim_left: 0, trunc_len: 120, rarefaction_depth: null },
    discovery: { tools: { demux: { id: "demux-tool", version: "2026.1.0" },
      denoise: { id: DADA2_TOOL, version: "2026.1.0" }, exportTool: { id: "export-tool", version: "2026.1.0" } },
    classifier: { available: false, reason: "none" }, discovery_mode: "live", discovered_at: null },
    dataset_ids: { metadata: "44444444444444444444444444444444" },
    filenames: { reads: "sequences.fastq.gz", barcodes: "barcodes.fastq.gz", metadata: "sample-metadata.tsv" },
    history_id: HISTORY, frontier: { importedSeqsId: IMPORTED_QZA, demuxReadsId: IMPORTED_QZA },
    results: {}, artifacts: [], errors: [], poll_count: 0, exports: {}, pending_exports: [],
    steps: {
      import_reads: { status: "succeeded", provider_job_id: "uploadjob00000001" },
      demux: { status: "succeeded", provider_job_id: "demux-job-0001", demuxReadsId: IMPORTED_QZA },
      dada2_denoise: { status: "running", provider_job_id: DADA2_JOB, tool_id: DADA2_TOOL,
        tool_version: "2026.1.0" }
    },
    import: { status: "succeeded", provider_job_id: "import-job-0001", output_dataset_id: IMPORTED_QZA,
      output_history_id: HISTORY, copy_dataset_id: IMPORTED_QZA }
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

function makeStub({ count = 7, oversized = false, includeQza = true } = {}) {
  const outputs = [];
  const texts = new Map();
  for (let index = 0; index < count; index += 1) {
    const id = makeId(index + 10);
    const name = index === 0 && oversized ? `huge feature table ${index}.tsv`
      : `artifact ${index}.tsv`;
    outputs.push({ id, state: "ok", history_id: HISTORY });
    texts.set(id, index === 0 && oversized
      ? "#OTU ID\tsampleA\n" + "asv1\t1\n".repeat(40_000)
      : "#OTU ID\tsampleA\nasv1\t10\n");
  }
  if (includeQza) outputs.push({ id: makeId(99), state: "ok", history_id: HISTORY });
  let contentCalls = 0;
  let exportCalls = 0;
  const fetchImpl = async (input, init = {}) => {
    const url = String(input);
    if (url.includes("io_details=true")) {
      return json({ tool_id: "export-tool", inputs: [{ model_class: "DataToolParameter",
        name: "input", extensions: ["qza"] }] });
    }
    if (url.includes("/api/tools?")) {
      return json([{ id: DADA2_TOOL, name: "qiime2 dada2 denoise-single", version: "2026.1.0",
        model_class: "Tool", available: true },
      { id: "export-tool", name: "qiime2 tools export", version: "2026.1.0",
        model_class: "Tool", available: true }]);
    }
    if (url.includes("/api/workflows")) return json([]);
    if (url.includes("/api/jobs/") && url.includes("/outputs")) {
      return json(Object.fromEntries(outputs.map((out) => [out.id, out])));
    }
    if (url.includes("/api/jobs/")) return json({ id: DADA2_JOB, state: "ok", history_id: HISTORY });
    if (url.includes("/api/histories/") && url.includes("/contents")) {
      return json(outputs.map((out, index) => ({ id: out.id, name: index === count ? "representative_sequences.qza"
        : (index === 0 && oversized ? "huge feature table 0.tsv" : `artifact ${index}.tsv`),
      extension: index === count ? "qza" : "tsv", state: "ok", history_id: HISTORY })));
    }
    if (url.includes("/get_content_as_text")) {
      contentCalls += 1;
      const id = url.slice(url.lastIndexOf("/datasets/") + 10).split("/")[0];
      return texts.has(id) ? json({ item_data: texts.get(id), truncated: false })
        : json({ error: "binary qza" }, 404);
    }
    if (String(init.method ?? "GET").toUpperCase() === "POST" && url.endsWith("/api/tools")) {
      exportCalls += 1;
      return json({ outputs: [], jobs: [{ id: `export-job-${exportCalls}` }] });
    }
    return json({ error: "unexpected_stub_route", url }, 404);
  };
  return { fetchImpl, outputs, resetContentCalls: () => { contentCalls = 0; },
    contentCalls: () => contentCalls, exportCalls: () => exportCalls };
}

async function status(db, stub) {
  return handleStatus(makeGetRequest(`/api/ai/workflows/microbiome/status?run_id=${RUN_ID}`),
    { ...mockAIEnv(db), GALAXY_ENABLED: "true", GALAXY_BASE_URL: "https://galaxy.example.test",
      GALAXY_API_KEY: "stub-key", FETCH_IMPL: stub.fetchImpl }, { fetchImpl: stub.fetchImpl });
}
function stored(d1) { return JSON.parse(d1.tables.microbiome_runs[0].state_json); }

test("BOUNDED / a large artifact set finalizes over several polls, at most two downloads each", async () => {
  const stub = makeStub({ count: 7 });
  const { db, d1 } = seededDb(state());
  const previousFetch = globalThis.fetch;
  globalThis.fetch = stub.fetchImpl;
  try {
    let polls = 0;
    let terminal = null;
    for (; polls < 12; polls += 1) {
      stub.resetContentCalls();
      const response = await status(db, stub);
      terminal = await response.json();
      assert.ok(stub.contentCalls() <= 2, `poll ${polls} fetched ${stub.contentCalls()} artifacts`);
      if (stored(d1).steps.dada2_denoise.status === "succeeded") break;
    }
    assert.equal(stored(d1).steps.dada2_denoise.status, "succeeded");
    assert.ok(polls >= 3, "the queue must span more than one poll");
    assert.equal(stub.contentCalls() <= 2, true);
    assert.equal(stored(d1).finalize_queue, undefined);
    assert.equal(terminal.status, "running");
  } finally { globalThis.fetch = previousFetch; }
});

test("BOUNDED / oversized artifact text is recorded honestly and never parsed in one request", async () => {
  const stub = makeStub({ count: 2, oversized: true });
  const { db, d1 } = seededDb(state());
  const previousFetch = globalThis.fetch;
  globalThis.fetch = stub.fetchImpl;
  try {
    for (let index = 0; index < 4; index += 1) {
      stub.resetContentCalls();
      await status(db, stub);
      assert.ok(stub.contentCalls() <= 2);
      if (stored(d1).steps.dada2_denoise.status === "succeeded") break;
    }
    const s = stored(d1);
    assert.ok(s.errors.some((error) => /artifact_exceeds_poll_byte_bound/.test(String(error.reason))));
    assert.equal(s.steps.dada2_denoise.status, "succeeded", "oversized text must not block later stages");
    assert.ok(!s.artifacts.some((artifact) => /huge feature table/.test(String(artifact.name))),
      "the oversized artifact was not fabricated into a result");
  } finally { globalThis.fetch = previousFetch; }
});

test("BOUNDED / real qza ids from associations are retained; exports are not duplicated", async () => {
  const stub = makeStub({ count: 3, includeQza: true });
  const { db, d1 } = seededDb(state());
  const previousFetch = globalThis.fetch;
  globalThis.fetch = stub.fetchImpl;
  try {
    for (let index = 0; index < 8; index += 1) {
      stub.resetContentCalls();
      await status(db, stub);
      assert.ok(stub.contentCalls() <= 2);
      if (stored(d1).steps.dada2_denoise.status === "succeeded") break;
    }
    const s = stored(d1);
    assert.ok(s.steps.dada2_denoise.qza_dataset_ids.some((item) => /\.qza$/i.test(item.name)));
    assert.equal(stub.exportCalls(), 1, "one bounded export submission for the qza");
    await status(db, stub);
    await status(db, stub);
    assert.equal(stub.exportCalls(), 1, "no duplicate export across later polls");
  } finally { globalThis.fetch = previousFetch; }
});
