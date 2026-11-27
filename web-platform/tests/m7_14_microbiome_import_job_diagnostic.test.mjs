// M7.14.2 IMPORT-JOB DIAGNOSTIC — LABELLED STUBBED TESTS — ZERO live calls.
//
// The real run recorded `qza_import_output_missing` but current endpoints do
// not expose state.import. These tests pin a GET-only view that reads the
// STORED import state and performs only genuine read-only provider GETs. All
// provider responses here are stubs; no job is submitted, no state is mutated,
// no run is created and no credential/URL/secret is returned.
import test from "node:test";
import assert from "node:assert/strict";
import { handleImportJob } from "../functions/api/ai/workflows/microbiome/engine.js";
import { createFakeD1AI, makeGetRequest, mockAIEnv } from "./helpers/fake-d1.mjs";
import { createFetch, handlers } from "../worker.js";

const RUN_ID = "job_a8817e35d7534d98";
const HISTORY = "11ac94870d0bb33aff42f70766c41aa1";
const IMPORT_JOB_ID = "b6a1c2d3e4f5a6b7";
const IMPORT_TOOL = "toolshed.g2.bx.psu.edu/repos/q2d2/qiime2_core__tools__import/2026.1.0+dist.h02a552c2";
const READS = "22222222222222222222222222222222";
const BARCODES = "33333333333333333333333333333333";
const QZA = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
// Numeric dataset ids as Galaxy job outputs expose them; the same datasets
// appear with 16-hex hda ids in history contents.
const NUMERIC_READS = "311309378";
const NUMERIC_BARCODES = "311309379";
const SECRET = "stub-secret-key-xyz";
const READS_FIELD = "import_root|__q2galaxy__GUI__cond__format__|import_sequences";
const BARCODES_FIELD = "import_root|__q2galaxy__GUI__cond__format__|import_barcodes";
const PATH = `/api/ai/workflows/microbiome/import-job?run_id=${RUN_ID}`;

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}
function withFetch(stub, fn) {
  const previous = globalThis.fetch;
  globalThis.fetch = stub;
  return Promise.resolve()
    .then(fn)
    .finally(() => { globalThis.fetch = previous; });
}

function importState(withImport = true) {
  return {
    workflow_type: "microbiome", run_id: RUN_ID, plan_id: "plan_a8817e35d7534d98",
    status: "running", current_step: "demux", created_at: "2026-11-27T00:00:00.000Z",
    input_sha256: "a".repeat(64), metadata_sha256: "b".repeat(64), params: {},
    dataset_ids: { sequences: READS, barcodes: BARCODES, metadata: "44444444444444444444444444444444" },
    filenames: { reads: "sequences.fastq.gz", barcodes: "barcodes.fastq.gz", metadata: "sample-metadata.tsv" },
    history_id: HISTORY, frontier: {}, steps: {}, results: {}, artifacts: [], errors: [], poll_count: 0,
    exports: {}, pending_exports: [],
    import: withImport ? {
      tool_id: IMPORT_TOOL, tool_version: "2026.1.0", tool_name: "qiime2 tools import",
      provider_job_id: IMPORT_JOB_ID,
      source_dataset_ids: { reads: READS, barcodes: BARCODES },
      source_filenames: { reads: "sequences.fastq.gz", barcodes: "barcodes.fastq.gz" },
      format_value: "EMPSingleEndDirFmt", type_value: "EMPSingleEndSequences",
      selector: "import_root|__q2galaxy__GUI__cond__format__|format",
      selectors: [
        { name: "import_root|type", value: "EMPSingleEndSequences" },
        { name: "import_root|__q2galaxy__GUI__cond__format__|format", value: "EMPSingleEndDirFmt" }
      ],
      selection_basis: "live_type_and_format_selectors", mapping_basis: "name_text_help",
      mapping: { reads: READS_FIELD, barcodes: BARCODES_FIELD },
      dataset_fields: { reads: READS_FIELD, barcodes: BARCODES_FIELD },
      submitted_at: "2026-11-27T00:00:00.000Z", status: "running",
      schema_source: "Galaxy io_details=true (full nested schema)"
    } : null
  };
}

function seededDb(state) {
  return createFakeD1AI({ microbiome_runs: [{
    public_id: state.run_id, input_sha256: state.input_sha256, metadata_sha256: state.metadata_sha256,
    state: state.status, plan_id: state.plan_id, run_id: state.run_id, state_json: JSON.stringify(state),
    result_json: null, created_at: state.created_at, completed_at: null
  }] });
}

function envFor(db) {
  return { GALAXY_ENABLED: "true", GALAXY_BASE_URL: "https://galaxy.example.test",
    GALAXY_API_KEY: SECRET, ...mockAIEnv(db) };
}

function jobDetailBody() {
  return {
    id: IMPORT_JOB_ID, state: "error", tool_id: IMPORT_TOOL, exit_code: 1,
    stderr: `${SECRET} boom at https://galaxy.example.test/api/jobs/${IMPORT_JOB_ID}?key=${SECRET}\n` + "E".repeat(5000),
    stdout: `X-API-Key: ${SECRET}\n` + "O".repeat(4500),
    params: {
      "import_root|type": "EMPSingleEndSequences",
      token: SECRET,
      callback: "https://galaxy.example.test/hooks?token=abc123",
      long_note: "P".repeat(5000)
    },
    inputs: { import_sequences: { src: "hda", id: READS }, api_key: SECRET },
    outputs: {
      output: { id: QZA, uuid: "uuid-1", name: `${SECRET} imported.qza`, state: "error",
        extension: "qza", history_id: HISTORY }
    },
    history_id: HISTORY
  };
}

function jobOutputsBody() {
  // GET /api/jobs/:id/outputs — NUMERIC ids, unlike history contents below.
  return {
    output_sequences: { id: NUMERIC_READS, dataset_id: NUMERIC_READS, uuid: "uuid-reads",
      name: `${SECRET} sequences.fastq.gz`, state: "ok", extension: "fastq.gz", history_id: HISTORY },
    output_barcodes: { id: NUMERIC_BARCODES, dataset_id: NUMERIC_BARCODES, uuid: "uuid-barcodes",
      name: "barcodes.fastq.gz", state: "ok", extension: "fastq.gz", history_id: HISTORY,
      tools_url: `https://galaxy.example.test/api/datasets/${NUMERIC_BARCODES}?key=${SECRET}` }
  };
}

function historyContentsBody() {
  // GET /api/histories/:id/contents — 16-HEX hda ids with the SAME numeric
  // dataset_id values as the job outputs above.
  return [
    { id: READS, dataset_id: NUMERIC_READS, uuid: "uuid-reads", name: "sequences.fastq.gz",
      state: "ok", extension: "fastq.gz", history_id: HISTORY, checksum: SECRET, content: `${SECRET} fastq content` },
    { id: BARCODES, dataset_id: NUMERIC_BARCODES, uuid: "uuid-barcodes", name: `${SECRET} barcodes.fastq.gz`,
      state: "ok", extension: "fastq.gz", history_id: HISTORY, file_size: 9876 }
  ];
}

function detailStub() {
  const calls = [];
  const fetchImpl = async (input, init = {}) => {
    const url = String(input);
    const method = String(init.method ?? "GET").toUpperCase();
    calls.push({ method, url });
    if (method !== "GET") return json({ error: "unexpected_non_get" }, 405);
    if (url.endsWith(`/api/jobs/${IMPORT_JOB_ID}/outputs`)) return json(jobOutputsBody());
    if (url.includes(`/api/histories/${HISTORY}/contents`)) return json(historyContentsBody());
    if (url.includes(`/api/jobs/${IMPORT_JOB_ID}`)) return json(jobDetailBody());
    return json({ error: "unexpected_stub_route", url }, 404);
  };
  return { fetchImpl, calls };
}

async function callDiagnostic(state, stub) {
  const { db, state: d1 } = seededDb(state);
  const before = d1.tables.microbiome_runs[0].state_json;
  const response = await withFetch(stub.fetchImpl, () =>
    handleImportJob(makeGetRequest(PATH), envFor(db), { fetchImpl: stub.fetchImpl }));
  return { response, d1, before, body: await response.json() };
}

// --------------------------------------------------------------- guards

test("LABELLED GUARD / missing run, non-microbiome run and missing run_id fail honestly", async () => {
  const stub = detailStub();
  const missing = await withFetch(stub.fetchImpl, () => handleImportJob(
    makeGetRequest(PATH), envFor(createFakeD1AI().db), { fetchImpl: stub.fetchImpl }));
  assert.equal(missing.status, 404);
  assert.match((await missing.json()).error, /No stored microbiome run matches/);

  const other = importState();
  other.workflow_type = "phylo";
  const notMicrobiome = await callDiagnostic(other, stub);
  assert.equal(notMicrobiome.response.status, 400);
  assert.match(notMicrobiome.body.error, /not a microbiome workflow/);

  const noId = await withFetch(stub.fetchImpl, () => handleImportJob(
    makeGetRequest("/api/ai/workflows/microbiome/import-job"),
    envFor(createFakeD1AI().db), { fetchImpl: stub.fetchImpl }));
  assert.equal(noId.status, 400);
  const noIdBody = await noId.json();
  assert.equal(noIdBody.available, false);
  assert.match(noIdBody.reason, /run_id was not supplied/);
  assert.equal(stub.calls.length, 0, "guard failures never contact the provider");
});

// ------------------------------------------------- existing import state

test("LABELLED STUB / existing import state returns the real job id, state and bounded stderr/params", async () => {
  const stub = detailStub();
  const { response, body } = await callDiagnostic(importState(), stub);
  assert.equal(response.status, 200);
  assert.equal(body.available, true);
  assert.equal(body.run_id, RUN_ID);

  assert.equal(body.import.provider_job_id, IMPORT_JOB_ID);
  assert.equal(body.import.tool_id, IMPORT_TOOL);
  assert.equal(body.import.tool_version, "2026.1.0");
  assert.equal(body.import.format_value, "EMPSingleEndDirFmt");
  assert.equal(body.import.status, "running");
  assert.equal(body.import.source_dataset_ids.reads, READS);
  assert.equal(body.import.source_dataset_ids.barcodes, BARCODES);
  assert.equal(body.import.mapped_fields.mapping.reads, READS_FIELD);
  assert.equal(body.import.mapped_fields.dataset_fields.barcodes, BARCODES_FIELD);
  assert.equal(body.import.mapped_fields.selectors.length, 2);
  assert.equal(body.import.output_dataset_id, null, "no qza dataset was stored for this run");

  assert.equal(body.provider.provider_job_id, IMPORT_JOB_ID);
  assert.equal(body.provider.state, "error", "state comes from adapter.getJobStatus");
  assert.equal(body.provider.output_associations.length, 1);
  assert.equal(body.provider.output_associations[0].id, QZA);

  assert.equal(body.job.provider_job_id, IMPORT_JOB_ID);
  assert.equal(body.job.state, "error", "state comes from the genuine GET /api/jobs/:id");
  assert.equal(body.job.tool_id, IMPORT_TOOL);
  assert.equal(body.job.exit_code, "1");
  assert.equal(body.job.stderr.length, 4000, "stderr is capped at 4000 chars");
  assert.equal(body.job.stdout.length, 4000, "stdout is capped at 4000 chars");
  assert.equal(body.job.params.length, 4000, "params are capped at 4000 chars");
  assert.equal(body.job.inputs.includes(READS), true, "inputs carry the genuine source dataset id");
});

test("LABELLED STUB / no import was ever submitted returns an honest 200 unavailable", async () => {
  const stub = detailStub();
  const { response, body } = await callDiagnostic(importState(false), stub);
  assert.equal(response.status, 200);
  assert.equal(body.available, false);
  assert.equal(body.run_id, RUN_ID);
  assert.match(body.reason, /No qza import was ever submitted/);
  assert.equal(body.import, undefined, "no import summary is invented");
  assert.equal(body.provider, undefined, "no provider details are fabricated");
  assert.equal(body.job, undefined, "no job details are fabricated");
  assert.equal(stub.calls.length, 0, "no import means no provider call");
});

test("LABELLED STUB / a stored import with no provider job id is honestly unavailable", async () => {
  const stub = detailStub();
  const state = importState();
  state.import.provider_job_id = null;
  state.import.status = "unavailable";
  state.import.reason = "qza_import_tool_unavailable";
  const { response, body } = await callDiagnostic(state, stub);
  assert.equal(response.status, 200);
  assert.equal(body.available, false);
  assert.equal(body.status, "unavailable");
  assert.equal(body.reason, "qza_import_tool_unavailable");
  assert.equal(stub.calls.length, 0, "no provider job id means no provider call");
});

// ------------------------------------------------------- redaction safety

test("LABELLED STUB / secrets, key patterns and URLs are redacted everywhere", async () => {
  const stub = detailStub();
  const { body } = await callDiagnostic(importState(), stub);
  const raw = JSON.stringify(body);
  assert.equal(raw.includes(SECRET), false, "configured secret never appears");
  assert.equal(raw.includes("https://"), false, "URLs never appear");
  assert.equal(/x-api-key\s*:/i.test(raw), false, "key headers never appear");
  assert.match(body.job.stderr, /\[redacted\]/);
  assert.match(body.job.stderr, /\[url\]/);
  assert.match(body.job.params, /\[redacted\]/);
  assert.match(body.job.inputs, /\[redacted\]/);
  assert.match(body.provider.output_associations[0].name, /\[redacted\]/);
  assert.equal(body.job.params.includes("token="), false, "query strings are redacted");
});

test("LABELLED STUB / no POST, no provider submission and no state mutation", async () => {
  const stub = detailStub();
  const { d1, before, body } = await callDiagnostic(importState(), stub);
  assert.equal(stub.calls.some((call) => call.method === "POST"), false, "zero POSTs");
  assert.equal(stub.calls.filter((call) =>
    call.url.endsWith(`/api/jobs/${IMPORT_JOB_ID}`)).length, 2,
  "exactly two read-only GETs: getJobStatus + GET /api/jobs/:id");
  assert.equal(stub.calls.filter((call) =>
    call.url.endsWith(`/api/jobs/${IMPORT_JOB_ID}/outputs`)).length, 1,
  "one read-only GET /api/jobs/:id/outputs");
  assert.equal(stub.calls.filter((call) =>
    call.url.includes(`/api/histories/${HISTORY}/contents`)).length, 1,
  "one read-only GET history contents");
  assert.equal(d1.tables.microbiome_runs.length, 1, "no run was created");
  assert.equal(d1.tables.microbiome_runs[0].state_json, before, "stored state was not mutated");
  assert.equal(body.available, true);
});

// ------------------------------------------- numeric-to-hex output evidence

test("LABELLED STUB / numeric job-output ids and hex history ids are both visible", async () => {
  const stub = detailStub();
  const { body } = await callDiagnostic(importState(), stub);
  assert.equal(body.job_outputs.ok, true);
  assert.equal(body.job_outputs.outputs.length, 2);
  const readsOutput = body.job_outputs.outputs.find((item) => item.uuid === "uuid-reads");
  const barcodesOutput = body.job_outputs.outputs.find((item) => item.uuid === "uuid-barcodes");
  assert.ok(readsOutput, "numeric reads output is present");
  assert.equal(readsOutput.galaxyHdaId, NUMERIC_READS);
  assert.equal(readsOutput.id, NUMERIC_READS);
  assert.equal(readsOutput.galaxyDatasetUuid, "uuid-reads");
  assert.equal(readsOutput.state, "ok");
  assert.equal(barcodesOutput.id, NUMERIC_BARCODES);

  assert.equal(body.artifacts.ok, true);
  assert.equal(body.artifacts.artifacts.length, 2);
  const readsArtifact = body.artifacts.artifacts.find((item) => item.uuid === "uuid-reads");
  assert.ok(readsArtifact, "hex history dataset is present");
  assert.equal(readsArtifact.id, READS, "16-hex hda id from history contents");
  assert.equal(readsArtifact.dataset_id, NUMERIC_READS, "numeric dataset id is exposed too");
  assert.equal(readsArtifact.extension, "fastq.gz");
  assert.equal(readsArtifact.state, "ok");

  // The mismatch is now observable: one numeric id in job outputs, one hex id
  // in history contents, with the numeric dataset id correlating them.
  assert.equal(readsOutput.id, readsArtifact.dataset_id);
  assert.notEqual(readsOutput.id, readsArtifact.id);
});

test("LABELLED STUB / output and artifact views allowlist fields and redact secrets", async () => {
  const stub = detailStub();
  const { body } = await callDiagnostic(importState(), stub);
  const raw = JSON.stringify({ job_outputs: body.job_outputs, artifacts: body.artifacts });
  assert.equal(raw.includes(SECRET), false, "configured secret never appears");
  assert.equal(raw.includes("https://"), false, "URLs never appear");
  assert.equal(raw.includes("fastq content"), false, "no dataset content is returned");
  assert.equal(raw.includes("checksum"), false, "no checksum is returned");
  assert.equal(raw.includes("file_size"), false, "no size is returned");
  assert.match(body.job_outputs.outputs[0].name, /\[redacted\]/);
  assert.match(body.artifacts.artifacts[1].name, /\[redacted\]/);
  assert.deepEqual(Object.keys(body.job_outputs.outputs[0]).sort(), [
    "galaxyDatasetUuid", "galaxyHdaId", "history_id", "id", "name", "state", "uuid"
  ]);
  assert.deepEqual(Object.keys(body.artifacts.artifacts[0]).sort(), [
    "dataset_id", "extension", "history_id", "id", "name", "state", "type", "uuid"
  ]);
  assert.equal(stub.calls.some((call) => call.method === "POST"), false, "zero POSTs");
});

test("LABELLED STUB / a stored import without a history id reports honest artifact unavailability", async () => {
  const stub = detailStub();
  const state = importState();
  delete state.history_id;
  const { body } = await callDiagnostic(state, stub);
  assert.equal(body.available, true);
  assert.equal(body.artifacts.ok, false);
  assert.equal(body.artifacts.reason, "no_history_id_stored");
  assert.deepEqual(body.artifacts.artifacts, []);
  assert.equal(stub.calls.some((call) => call.url.includes("/contents")), false,
    "no history id means no artifact GET");
  assert.equal(stub.calls.some((call) => call.method === "POST"), false, "zero POSTs");
});

// ------------------------------------------------------------ routing

test("LABELLED ROUTE / GET import-job reaches its stubbed worker handler", async () => {
  const seen = [];
  const map = {};
  for (const key of Object.keys(handlers)) {
    map[key] = async (context) => {
      seen.push({ key, context });
      return new Response(JSON.stringify({ key }), { status: 200,
        headers: { "Content-Type": "application/json" } });
    };
  }
  const env = { ASSETS: { fetch: () => new Response("unused") } };
  const response = await createFetch(map)(new Request(`https://worker.example.test${PATH}`), env, {});
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { key: "microbiomeImportJob" });
  assert.equal(seen.length, 1);
  assert.equal(seen[0].context.request.url, `https://worker.example.test${PATH}`);
});
