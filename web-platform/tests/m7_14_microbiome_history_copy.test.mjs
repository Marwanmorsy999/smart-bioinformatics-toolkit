// M7.14.2 LABELLED STUBBED CROSS-HISTORY COPY TESTS — ZERO live calls.
// Galaxy rejected demux because the recovered qza HDA lives in another history.
// These tests prove an authenticated HDA copy into the run's EXISTING history,
// used exactly once, with honest failure handling and a fifth bounded resume.
import test from "node:test";
import assert from "node:assert/strict";

import { createAdapter } from "../providers/galaxy/index.js";
import { handleStatus, handleResumeStages } from "../functions/api/ai/workflows/microbiome/engine.js";
import { createFakeD1AI, makeGetRequest, makePostRequest, mockAIEnv } from "./helpers/fake-d1.mjs";

const RUN_ID = "job_a8817e35d7534d98";
const RUN_HISTORY = "11ac94870d0bb33aff42f70766c41aa1";
const OUTPUT_HISTORY = "11ac94870d0bb33aa1d667180c20abd0";
const IMPORT_JOB = "4838ba20a6d8676539a8440d60cb5a98";
const ORIGINAL_QZA = "40160950115d555e26f11fc9fc50ace4";
const COPIED_QZA = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const UUID = "6ffd23da-534e-4574-b11f-2172f639a1aa";
const META = "44444444444444444444444444444444";
const DEMUX_TOOL = "toolshed.g2.bx.psu.edu/repos/iuc/qiime2_demux_emp_single/2026.1.0";
const SECRET = "mock-key-do-not-log";

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function state(overrides = {}) {
  return {
    workflow_type: "microbiome", run_id: RUN_ID, plan_id: "plan_a8817e35d7534d98",
    status: "running", current_step: "demux", created_at: "2026-11-27T00:00:00.000Z",
    input_sha256: "a".repeat(64), metadata_sha256: "b".repeat(64),
    input: { mode: "public", source: {}, sample_ids: ["sampleA"], sample_count: 1 },
    params: { trim_left: 0, trunc_len: 120, rarefaction_depth: null },
    discovery: { tools: { demux: { id: DEMUX_TOOL, name: "qiime2 demux emp-single", version: "2026.1.0" } },
      classifier: { available: false, reason: "no select option" }, discovery_mode: "live", discovered_at: null },
    dataset_ids: { sequences: "11111111111111111111111111111111",
      barcodes: "22222222222222222222222222222222", metadata: META },
    filenames: { reads: "sequences.fastq.gz", barcodes: "barcodes.fastq.gz", metadata: "sample-metadata.tsv" },
    history_id: RUN_HISTORY, frontier: {}, results: {}, artifacts: [], errors: [], poll_count: 0,
    steps: { import_reads: { status: "succeeded", provider_job_id: "uploadjob00000001" } },
    exports: {}, pending_exports: [],
    import: { status: "unavailable", reason: "qza_import_output_missing", provider_job_id: IMPORT_JOB },
    ...overrides
  };
}

function seededDb(s) {
  return createFakeD1AI({ microbiome_runs: [{
    public_id: RUN_ID, input_sha256: s.input_sha256, metadata_sha256: s.metadata_sha256,
    state: s.status, plan_id: s.plan_id, run_id: RUN_ID, state_json: JSON.stringify(s),
    result_json: null, created_at: s.created_at, completed_at: null
  }] });
}

function makeStub({ copyStatus = 200, copyFails = false, outputHistory = OUTPUT_HISTORY,
  copyReady = true, copyReturnsId = true } = {}) {
  const calls = [];
  const copies = [];
  const submissions = [];
  let copied = false;
  const fetchImpl = async (input, init = {}) => {
    const url = String(input);
    const method = String(init.method ?? "GET").toUpperCase();
    let body = null;
    if (typeof init.body === "string") { try { body = JSON.parse(init.body); } catch { body = null; } }
    calls.push({ method, url, body, init });
    if (url.includes("io_details=true")) {
      return json({ tool_id: DEMUX_TOOL, inputs: [
        { model_class: "DataToolParameter", name: "seqs", extensions: ["qza"] },
        { model_class: "DataToolParameter", name: "metadata", extensions: ["tsv"] }
      ] });
    }
    if (method === "GET" && (url.includes("/api/tools?") || url.endsWith("/api/tools"))) {
      return json([{ id: DEMUX_TOOL, name: "qiime2 demux emp-single", version: "2026.1.0",
        model_class: "Tool", available: true }]);
    }
    if (url.includes("/api/workflows")) return json([]);
    if (method === "GET" && /\/api\/histories\?/.test(url)) return json([{ id: RUN_HISTORY }]);
    if (method === "GET" && /\/api\/histories\/[^/]+\/contents/.test(url)) {
      const historyId = decodeURIComponent(url.slice(url.lastIndexOf("/histories/") + 11).split("/")[0]);
      if (historyId === outputHistory) {
        return json([{ id: ORIGINAL_QZA, uuid: UUID, name: "imported-sequences.qza",
          extension: "qza", state: "ok", history_id: historyId }]);
      }
      const items = [{ id: META, name: "sample-metadata.tsv", extension: "tsv", state: "ok", history_id: RUN_HISTORY }];
      if (copied && copyReady) items.push({ id: COPIED_QZA, name: "imported-sequences.qza",
        extension: "qza", state: "ok", history_id: RUN_HISTORY });
      return json(items);
    }
    if (method === "POST" && /\/api\/histories\/[^/]+\/contents/.test(url)) {
      copies.push({ url, body });
      if (copyFails) return json({ error: "copy_refused" }, copyStatus);
      copied = true;
      const target = decodeURIComponent(url.slice(url.lastIndexOf("/histories/") + 11).split("/")[0]);
      return json({ id: copyReturnsId ? COPIED_QZA : null, history_id: target });
    }
    if (method === "GET" && /\/api\/jobs\/[^/]+\/outputs/.test(url)) {
      return json({ output: { id: ORIGINAL_QZA, uuid: UUID, history_id: outputHistory,
        name: "imported-sequences.qza", extension: "qza", state: "ok" } });
    }
    if (method === "GET" && /\/api\/jobs\//.test(url)) {
      return json({ id: IMPORT_JOB, state: "ok", history_id: RUN_HISTORY });
    }
    if (method === "POST" && url.endsWith("/api/tools")) {
      submissions.push(body);
      return json({ outputs: [{ id: "ffffffffffffffffffffffffffffffff" }], jobs: [{ id: "demux-job-0001" }] });
    }
    return json({ error: "unexpected_stub_route", url }, 404);
  };
  return { calls, copies, submissions, fetchImpl };
}

function envFor(db, stub) {
  return { ...mockAIEnv(db), GALAXY_ENABLED: "true", GALAXY_BASE_URL: "https://galaxy.example.test",
    GALAXY_API_KEY: SECRET, FETCH_IMPL: stub.fetchImpl };
}
async function withStub(stub, fn) {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = stub.fetchImpl;
  try { return await fn(); } finally { globalThis.fetch = previousFetch; }
}
async function status(db, stub) {
  await handleStatus(makeGetRequest(`/api/ai/workflows/microbiome/status?run_id=${RUN_ID}`),
    envFor(db, stub), { fetchImpl: stub.fetchImpl });
}
function stored(d1) { return JSON.parse(d1.tables.microbiome_runs[0].state_json); }

test("ADAPTER / copy posts source hda into the EXISTING history and returns the new hda", async () => {
  const calls = [];
  const fetchImpl = async (input, init = {}) => {
    calls.push({ url: String(input), init });
    return json({ id: COPIED_QZA, history_id: RUN_HISTORY });
  };
  const adapter = createAdapter({ GALAXY_ENABLED: "true", GALAXY_BASE_URL: "https://galaxy.example.test",
    GALAXY_API_KEY: SECRET });
  const result = await adapter.copyDatasetToHistory({ dataset_id: ORIGINAL_QZA, history_id: RUN_HISTORY },
    { fetch: fetchImpl });
  assert.equal(result.ok, true);
  assert.equal(result.dataset_id, COPIED_QZA);
  assert.equal(result.history_id, RUN_HISTORY);
  assert.equal(result.source_dataset_id, ORIGINAL_QZA);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, `https://galaxy.example.test/api/histories/${RUN_HISTORY}/contents`);
  assert.equal(calls[0].init.method, "POST");
  assert.deepEqual(JSON.parse(calls[0].init.body), { source: "hda", id: ORIGINAL_QZA });
  assert.doesNotMatch(JSON.stringify(result), new RegExp(SECRET));
  const missing = await adapter.copyDatasetToHistory({ history_id: RUN_HISTORY }, { fetch: fetchImpl });
  assert.equal(missing.ok, false);
  assert.equal(missing.error.code, "dataset_id_required");
  assert.equal(calls.length, 1, "invalid input fails before any request");
});

test("COPY / cross-history qza is copied once and demux uses the copied id", async () => {
  const stub = makeStub();
  const { db, state: d1 } = seededDb(state());
  await withStub(stub, async () => {
    await status(db, stub); // recover + copy + verify
    await status(db, stub); // demux submission
    assert.equal(stub.copies.length, 1);
    assert.deepEqual(stub.copies[0].body, { source: "hda", id: ORIGINAL_QZA });
    const s = stored(d1);
    assert.equal(s.frontier.importedSeqsId, COPIED_QZA);
    assert.equal(s.import.copy_dataset_id, COPIED_QZA);
    assert.equal(s.import.copy.copied_from_history, OUTPUT_HISTORY);
    assert.equal(s.import.copy.original_dataset_id, ORIGINAL_QZA);
    assert.equal(stub.submissions.length, 1);
    assert.deepEqual(stub.submissions[0].inputs.seqs, { src: "hda", id: COPIED_QZA });
  });
});

test("COPY / same-history qza needs no copy and keeps the original id", async () => {
  const stub = makeStub({ outputHistory: RUN_HISTORY });
  const { db, state: d1 } = seededDb(state());
  await withStub(stub, async () => {
    await status(db, stub);
    await status(db, stub);
    assert.equal(stub.copies.length, 0);
    assert.equal(stored(d1).frontier.importedSeqsId, ORIGINAL_QZA);
  });
});

test("COPY / failed or unverifiable copy records the exact reason and never submits demux", async () => {
  for (const options of [{ copyFails: true, copyStatus: 403 }, { copyReady: false },
    { copyReturnsId: false }]) {
    const stub = makeStub(options);
    const { db, state: d1 } = seededDb(state());
    await withStub(stub, async () => {
      await status(db, stub);
      await status(db, stub);
      const s = stored(d1);
      assert.equal(s.frontier.importedSeqsId, undefined, "no unverified id was used");
      assert.equal(s.import.status, "unavailable");
      assert.match(s.import.reason, /^qza_history_copy_failed_or_unverified: /);
      assert.equal(stub.submissions.length, 0, "no demux job was submitted");
      assert.equal(stub.copies.length, 1, "a failed copy is never retried in the same state");
    });
  }
});

test("COPY / repeated polls never issue a second copy", async () => {
  const stub = makeStub();
  const { db, state: d1 } = seededDb(state());
  await withStub(stub, async () => {
    for (let index = 0; index < 6; index += 1) await status(db, stub);
    assert.equal(stub.copies.length, 1);
    assert.equal(stored(d1).import.copy.verified, true);
  });
});

test("RESUME / sixth pre-job resume succeeds on a live-shaped cross-history state", async () => {
  const liveState = state({
    status: "failed", stage_resume_count: 5, retry_count: 1, current_step: "demux",
    steps: { import_reads: { status: "succeeded", provider_job_id: "uploadjob00000001" },
      demux: { status: "failed", reason: "demux submission failed: HTTP 400", provider_job_id: null } },
    errors: [{ step: "demux", reason: "demux submission failed: HTTP 400" }]
  });
  const stub = makeStub();
  const { db, state: d1 } = seededDb(liveState);
  await withStub(stub, async () => {
    const response = await handleResumeStages(makePostRequest({ run_id: RUN_ID },
      "/api/ai/workflows/microbiome/resume-stages"), envFor(db, stub), { fetchImpl: stub.fetchImpl });
    assert.equal(response.status, 202, JSON.stringify(await response.clone().json()));
    assert.equal((await response.json()).stage_resume_count, 6);
    assert.equal(stored(d1).import.provider_job_id, IMPORT_JOB, "preparation job preserved");
    await status(db, stub);
    await status(db, stub);
    assert.equal(stub.copies.length, 1);
    assert.equal(stored(d1).frontier.importedSeqsId, COPIED_QZA);
    assert.deepEqual(stub.submissions[0].inputs.seqs, { src: "hda", id: COPIED_QZA });
  });
});

// The exact live shape from the final finding: a PRIOR recovery already stored
// output_dataset_id (the foreign HDA) and frontier, so the old copy path was
// skipped and demux referenced a cross-history id.
function staleResolvedState(overrides = {}) {
  return state({
    import: { status: "succeeded", provider_job_id: IMPORT_JOB,
      output_dataset_id: ORIGINAL_QZA, output_history_id: OUTPUT_HISTORY, history_mismatch: true },
    frontier: { importedSeqsId: ORIGINAL_QZA },
    errors: [], ...overrides
  });
}

test("STALE OUTPUT / a recorded foreign id still triggers exactly one copy; demux uses the copy", async () => {
  const stub = makeStub();
  const { db, state: d1 } = seededDb(staleResolvedState());
  await withStub(stub, async () => {
    await status(db, stub); // unconditional in-run-history proof + copy
    await status(db, stub); // demux submission
    for (let index = 0; index < 4; index += 1) await status(db, stub);
    assert.equal(stub.copies.length, 1, "never copy twice across polls");
    assert.deepEqual(stub.copies[0].body, { source: "hda", id: ORIGINAL_QZA });
    const s = stored(d1);
    assert.equal(s.frontier.importedSeqsId, COPIED_QZA);
    assert.equal(s.import.output_dataset_id, ORIGINAL_QZA, "original id retained as provenance");
    assert.equal(s.import.copy_dataset_id, COPIED_QZA);
    assert.equal(s.import.copy.copied_from_history, OUTPUT_HISTORY);
    assert.equal(s.import.copy.copy_basis, "authenticated_hda_copy_into_run_history");
    assert.equal(stub.submissions.length, 1);
    assert.deepEqual(stub.submissions[0].inputs.seqs, { src: "hda", id: COPIED_QZA });
  });
});

test("STALE OUTPUT / missing history evidence is re-resolved from the GET job output", async () => {
  const stub = makeStub();
  const live = staleResolvedState();
  delete live.import.output_history_id;
  delete live.import.history_mismatch;
  const { db, state: d1 } = seededDb(live);
  await withStub(stub, async () => {
    await status(db, stub);
    await status(db, stub);
    assert.equal(stub.copies.length, 1);
    assert.equal(stored(d1).import.copy.copied_from_history, OUTPUT_HISTORY);
    assert.deepEqual(stub.submissions[0].inputs.seqs, { src: "hda", id: COPIED_QZA });
  });
});

test("STALE OUTPUT / same-history resolved id skips the copy entirely", async () => {
  const stub = makeStub({ outputHistory: RUN_HISTORY });
  const live = staleResolvedState();
  live.import.output_history_id = RUN_HISTORY;
  const { db, state: d1 } = seededDb(live);
  await withStub(stub, async () => {
    await status(db, stub);
    await status(db, stub);
    assert.equal(stub.copies.length, 0);
    assert.equal(stored(d1).frontier.importedSeqsId, ORIGINAL_QZA);
    assert.deepEqual(stub.submissions[0].inputs.seqs, { src: "hda", id: ORIGINAL_QZA });
  });
});

test("STALE OUTPUT / unavailable history evidence records an exact reason, no copy and no job", async () => {
  const stub = makeStub();
  const live = staleResolvedState();
  delete live.import.output_history_id;
  delete live.import.history_mismatch;
  const { db, state: d1 } = seededDb(live);
  const originalFetch = stub.fetchImpl;
  stub.fetchImpl = async (input, init = {}) => {
    if (String(input).includes("/outputs")) return json({ error: "outputs_unavailable" }, 404);
    return originalFetch(input, init);
  };
  await withStub(stub, async () => {
    await status(db, stub);
    const s = stored(d1);
    assert.equal(s.import.status, "unavailable");
    assert.match(s.import.reason, /history_evidence_unavailable: job_outputs_unavailable/);
    assert.equal(stub.copies.length, 0);
    assert.equal(stub.submissions.length, 0);
    assert.equal(s.frontier.importedSeqsId, ORIGINAL_QZA, "the unresolved id is not replaced by a guess");
  });
});

test("RESUME / seventh pre-job attempt is capped after the sixth", async () => {
  const live = state({
    status: "failed", stage_resume_count: 6, retry_count: 1, current_step: "demux",
    import: { status: "succeeded", provider_job_id: IMPORT_JOB, output_dataset_id: ORIGINAL_QZA },
    steps: { import_reads: { status: "succeeded", provider_job_id: "uploadjob00000001" },
      demux: { status: "failed", reason: "demux submission failed: HTTP 400", provider_job_id: null } }
  });
  const stub = makeStub();
  const { db } = seededDb(live);
  await withStub(stub, async () => {
    const response = await handleResumeStages(makePostRequest({ run_id: RUN_ID },
      "/api/ai/workflows/microbiome/resume-stages"), envFor(db, stub), { fetchImpl: stub.fetchImpl });
    assert.equal(response.status, 409);
    assert.equal((await response.json()).reason, "stage_resume_limit_reached");
  });
});
