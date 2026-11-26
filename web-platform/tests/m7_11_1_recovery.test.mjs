// M7.11.1 OFFLINE RECOVERY TESTS — clearly labelled FIXTURES, no network.
// Every Galaxy call below is answered by an in-memory stub fetch. No live
// Galaxy/NCBI job, upload or MAFFT resubmission is ever made. All ids, states
// and output associations here are test fixtures, never presented as real
// scientific results.
import test from "node:test";
import assert from "node:assert/strict";

import { createAdapter } from "../providers/galaxy/index.js";
import { handlePhyloRun } from "../functions/api/ai/workflows/phylo/run.js";
import {
  validateInputFasta, validateAlignment
} from "../functions/api/ai/workflows/phylo/validators.js";
import { createFakeD1AI, mockAIEnv } from "./helpers/fake-d1.mjs";

const NOW = Date.parse("2026-11-27T12:00:00.000Z");
const INPUT_FASTA = ">taxon_a\nACGTACGTACG\n>taxon_b\nACGTACGTTCG\n>taxon_c\nACGTTCGTACG\n";
// FIXTURE: raw 16S homologues with legitimately UNEQUAL lengths BEFORE MAFFT.
const UNEQUAL_INPUT = ">taxon_a\nACGTACGTACG\n>taxon_b\nACGTACGTTCGAATC\n>taxon_c\nACGTTCGTACG\n";
// FIXTURE: the ALIGNED output (equal lengths) is what strict validation checks.
const ALIGNMENT = ">taxon_a\nACGT-ACGTACG\n>taxon_b\nACGTACGTTCGT\n>taxon_c\nACGTTCGTACGT\n";
const TREE = "(taxon_a:0.1,(taxon_b:0.2,taxon_c:0.3)95/87:0.4);\n";

const FIX = Object.freeze({
  historyId: "11ac94870d0bb33adfdcc31d5164dd84",
  otherHistoryId: "22ac94870d0bb33adfdcc31d5164dd85",
  inputHda: "aaaaaaaa1111bbbb2222cccc3333dddd",
  inputUuid: "a1b2c3d4-1111-4111-8111-a1b2c3d4e5f6",
  mafftHda: "bbbbbbbb1111cccc2222dddd3333eeee",
  mafftUuid: "cf2a6760-b219-4212-a609-aa37286628f5",
  treeHda: "cccccccc1111dddd2222eeee3333ffff",
  reportHda: "dddddddd1111eeee2222ffff3333aaaa",
  logHda: "eeeeeeee1111ffff2222aaaa3333bbbb",
  providerJobId: "4838ba20a6d8676526e1c47a033d95de",
  mafftId: "toolshed.g2.bx.psu.edu/repos/rnateam/mafft/rbc_mafft/7.526+galaxy2",
  iqtreeId: "toolshed.g2.bx.psu.edu/repos/iuc/iqtree/iqtree/3.1.4+galaxy1"
});

const DEFAULT_OUTPUTS = Object.freeze({
  // The uploaded INPUT is present in the history but must never be selected
  // as the recovered alignment.
  input: { id: FIX.inputHda, uuid: FIX.inputUuid, dataset_id: "101", name: "phylo.fasta",
    state: "ok", extension: "fasta", history_id: FIX.historyId },
  mafft: { id: FIX.mafftHda, uuid: FIX.mafftUuid, dataset_id: "102", name: "MAFFT on data 1",
    state: "ok", extension: "fasta", history_id: FIX.historyId },
  mafft_log: { id: FIX.logHda, dataset_id: "103", name: "MAFFT log on data 1",
    state: "ok", extension: "log", history_id: FIX.historyId }
});

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

// Fixture Galaxy server: status, read-only job outputs, IQ-TREE submission,
// history contents and dataset text. A MAFFT POST is deliberately NOT routed:
// if any test triggers one, the assertion on toolPosts below fails loudly.
function makeRecoveryStub({ jobState = "ok", outputs = DEFAULT_OUTPUTS, jobOutputs = null,
  alignmentContent = ALIGNMENT, treeContent = TREE } = {}) {
  const calls = [];
  const schemaFor = (id) => ({
    inputs: [{ model_class: "Section", name: "general_options", inputs: [
      { model_class: "DataToolParameter", name: "s", optional: false, extensions: ["fasta"] }
    ] }],
    tool_id: id
  });
  const contents = () => [
    { id: FIX.inputHda, uuid: FIX.inputUuid, name: "phylo.fasta", extension: "fasta",
      state: "ok", history_id: FIX.historyId, deleted: false },
    { id: FIX.mafftHda, uuid: FIX.mafftUuid, name: "MAFFT on data 1", extension: "fasta",
      state: "ok", history_id: FIX.historyId, deleted: false },
    { id: FIX.treeHda, name: "IQ-TREE treefile on data 2", extension: "nwk",
      state: "ok", history_id: FIX.historyId, deleted: false },
    { id: FIX.reportHda, name: "IQ-TREE on data 2", extension: "iqtree",
      state: "ok", history_id: FIX.historyId, deleted: false },
    { id: FIX.logHda, name: "IQ-TREE log on data 2", extension: "log",
      state: "ok", history_id: FIX.historyId, deleted: false }
  ];
  const textById = new Map([
    [FIX.inputHda, INPUT_FASTA], [FIX.mafftHda, alignmentContent], [FIX.treeHda, treeContent],
    [FIX.reportHda, "IQ-TREE summary\n"], [FIX.logHda, "IQ-TREE log\n"]
  ]);
  const fetchImpl = async (input, init = {}) => {
    const url = String(input);
    const method = String(init.method ?? "GET").toUpperCase();
    let body = null;
    if (typeof init.body === "string") { try { body = JSON.parse(init.body); } catch { body = null; } }
    // Headers are deliberately NOT recorded: the API key must never surface.
    calls.push({ method, url, body });
    if (method === "GET" && (url.includes("/api/tools?") || url.endsWith("/api/tools"))) {
      return json([
        { id: FIX.mafftId, name: "MAFFT", description: "Multiple alignment program for amino acid or nucleotide sequences",
          version: "7.526+galaxy2", model_class: "Tool", available: true },
        { id: FIX.iqtreeId, name: "IQ-TREE", description: "Phylogenomic / evolutionary tree construction from multiple sequences",
          version: "3.1.4+galaxy1", model_class: "Tool", available: true }
      ]);
    }
    if (url.includes("/api/workflows")) return json([]);
    if (url.includes("/api/histories") && method === "POST") return json({ id: FIX.historyId });
    if (url.includes("/api/tools/fetch")) {
      return json({ outputs: [{ id: FIX.inputHda, history_id: FIX.historyId }],
        jobs: [{ id: "1111111111111111" }] });
    }
    if (url.includes(`/api/jobs/${FIX.providerJobId}/outputs`)) return json(outputs);
    if (url.includes("/api/jobs/")) {
      const id = url.slice(url.lastIndexOf("/") + 1);
      return json({ id, state: jobState, history_id: FIX.historyId,
        ...(jobOutputs ? { outputs: jobOutputs } : {}) });
    }
    if (url.includes("io_details=true")) {
      const decoded = decodeURIComponent(url);
      return json(schemaFor(decoded.includes("iqtree") ? FIX.iqtreeId : FIX.mafftId));
    }
    if (url.includes("/api/tools") && method === "POST") {
      const toolId = String(body?.tool_id ?? "");
      // A MAFFT POST is routable so a resubmission would be OBSERVABLE and the
      // "no MAFFT submission" assertion below would fail loudly.
      if (toolId.includes("mafft")) {
        return json({ outputs: [{ id: FIX.mafftHda }], jobs: [{ id: "3333333333333333" }] });
      }
      if (toolId.includes("iqtree")) {
        return json({ outputs: [{ id: FIX.treeHda }, { id: FIX.reportHda }, { id: FIX.logHda }],
          jobs: [{ id: "2222222222222222" }] });
      }
      return json({ error: "unexpected_tool", toolId }, 404);
    }
    if (url.includes("/api/histories/") && url.includes("/contents")) return json(contents());
    if (url.includes("/get_content_as_text")) {
      const id = decodeURIComponent(url.slice(url.lastIndexOf("/datasets/") + 10).split("/")[0]);
      const content = textById.get(id);
      return content === undefined ? json({ error: "not_found" }, 404) : json({ item_data: content, truncated: false });
    }
    return json({ error: "unexpected_stub_route", url }, 404);
  };
  return { fetchImpl, calls };
}

function makeEnv(db) {
  return { ...mockAIEnv(db), GALAXY_ENABLED: "true",
    GALAXY_BASE_URL: "https://galaxy.example.test", GALAXY_API_KEY: "stub-secret" };
}

function makeIdFactory() {
  const counters = new Map();
  return (prefix) => {
    const next = (counters.get(prefix) ?? 0) + 1;
    counters.set(prefix, next);
    return `${prefix}_${String(next).padStart(16, "0")}`;
  };
}

async function runWorkflow(t, { payload = {}, stubOptions = {} } = {}) {
  const fake = createFakeD1AI();
  const stub = makeRecoveryStub(stubOptions);
  const originalFetch = globalThis.fetch;
  globalThis.fetch = stub.fetchImpl;
  t.after(() => { globalThis.fetch = originalFetch; });
  const request = new Request("https://app.example.test/api/ai/workflows/phylo/run", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ fasta_text: INPUT_FASTA, filename: "phylo.fasta",
      objective: "recovery fixture", ...payload })
  });
  const response = await handlePhyloRun(request, makeEnv(fake.db), {
    now: NOW, idFactory: makeIdFactory(), fetchImpl: stub.fetchImpl
  });
  return { response, body: await response.json(), fake, stub };
}

// ---------------------------------------------------------------- validator

test("FIXTURE validateInputFasta: unequal-length raw homologues are ACCEPTED", () => {
  const result = validateInputFasta(UNEQUAL_INPUT);
  assert.equal(result.valid, true, JSON.stringify(result));
  assert.deepEqual(result.lengths, [11, 15, 11]);
  assert.deepEqual(result.unique_lengths, [11, 15]);
  assert.equal(result.records, 3);
  assert.deepEqual(result.errors, []);
});

test("FIXTURE validateInputFasta: duplicates, invalid alphabet, empty sequences and <3 records are REJECTED", () => {
  const duplicate = validateInputFasta(">a\nACGT\n>a\nACGT\n>b\nACGT\n");
  assert.equal(duplicate.valid, false);
  assert.ok(duplicate.errors.includes("input_duplicate_identifiers"));
  const invalid = validateInputFasta(">a\nACGZZ\n>b\nACGT\n>c\nACGT\n");
  assert.equal(invalid.valid, false);
  assert.ok(invalid.errors.includes("input_alphabet_not_dna_iupac"));
  const empty = validateInputFasta(">a\n\n>b\nACGT\n>c\nACGT\n");
  assert.equal(empty.valid, false);
  assert.ok(empty.errors.includes("input_has_empty_sequences"));
  const few = validateInputFasta(">a\nACGT\n>b\nACGT\n");
  assert.equal(few.valid, false);
  assert.ok(few.errors.includes("input_requires_at_least_three_records"));
});

test("FIXTURE: strict validateAlignment STILL rejects unequal lengths (aligned output only)", () => {
  const result = validateAlignment(UNEQUAL_INPUT);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => error.startsWith("alignment_sequences_unequal_length")));
  assert.equal(validateAlignment(ALIGNMENT).valid, true);
});

// ------------------------------------------------------------------ adapter

test("FIXTURE Galaxy adapter getJobOutputs: normalized, read-only, no secret exposure", async () => {
  const stub = makeRecoveryStub();
  const adapter = createAdapter({ GALAXY_ENABLED: "true",
    GALAXY_BASE_URL: "https://galaxy.example.test", GALAXY_API_KEY: "stub-secret" },
  { fetch: stub.fetchImpl });
  const result = await adapter.getJobOutputs({ job_id: FIX.providerJobId });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.provider_job_id, FIX.providerJobId);
  const mafft = result.outputs.find((item) => item.id === FIX.mafftHda);
  assert.ok(mafft, JSON.stringify(result.outputs));
  assert.equal(mafft.hda_id, FIX.mafftHda);
  assert.equal(mafft.uuid, FIX.mafftUuid);
  assert.equal(mafft.dataset_id, "102");
  assert.equal(mafft.name, "MAFFT on data 1");
  assert.equal(mafft.state, "ok");
  assert.equal(mafft.extension, "fasta");
  assert.equal(mafft.history_id, FIX.historyId);
  assert.equal(mafft.galaxyHdaId, FIX.mafftHda);
  assert.equal(mafft.galaxyDatasetId, "102");
  assert.equal(mafft.galaxyDatasetUuid, FIX.mafftUuid);
  assert.doesNotMatch(JSON.stringify(result), /stub-secret/);
  assert.equal(stub.calls.filter((call) => call.method !== "GET").length, 0, "must be read-only");
  assert.equal(stub.calls.length, 1, "only GET /api/jobs/{id}/outputs is called");
  assert.match(stub.calls[0].url, /\/api\/jobs\/.*\/outputs$/);
});

test("FIXTURE Galaxy adapter getJobOutputs: disabled/unconfigured fails typed with zero fetches", async () => {
  const stub = makeRecoveryStub();
  const neverFetch = () => { throw new Error("no fetch may occur when the provider is unavailable"); };
  for (const env of [
    { GALAXY_ENABLED: "false", GALAXY_BASE_URL: "https://galaxy.example.test", GALAXY_API_KEY: "stub-secret" },
    { GALAXY_ENABLED: "true", GALAXY_BASE_URL: "https://galaxy.example.test", GALAXY_API_KEY: "" }
  ]) {
    const adapter = createAdapter(env, { fetch: neverFetch });
    const result = await adapter.getJobOutputs({ job_id: FIX.providerJobId });
    assert.equal(result.ok, false);
    assert.equal(result.error?.code, "provider_unavailable");
    assert.equal(result.reason, env.GALAXY_ENABLED === "false" ? "disabled" : "unavailable");
    assert.deepEqual(result.outputs, []);
    assert.equal(stub.calls.length, 0, "fixture fetch stub must remain untouched");
  }
});

// ------------------------------------------------------------- run endpoint

test("FIXTURE: unequal-length raw input is accepted end-to-end (no pre-MAFFT equal-length gate)", async (t) => {
  const { response, body } = await runWorkflow(t, { payload: { fasta_text: UNEQUAL_INPUT } });
  assert.equal(response.status, 200, JSON.stringify(body));
  assert.equal(body.workflow_completed, true);
  assert.equal(body.validation.alignment.valid, true);
  assert.equal(body.resume, null);
});

test("FIXTURE resume by provider job id: succeeded job's FASTA output resolved; MAFFT never resubmitted", async (t) => {
  const { response, body, stub } = await runWorkflow(t, {
    payload: { resume_provider_job_id: FIX.providerJobId, history_id: FIX.historyId }
  });
  assert.equal(response.status, 200, JSON.stringify(body));
  assert.equal(body.workflow_completed, true);
  assert.equal(body.resume.resumed_from_provider_job, true);
  assert.equal(body.resume.provider_job_id, FIX.providerJobId);
  assert.equal(body.resume.provider_job_state, "ok");
  assert.equal(body.resume.alignment_hda_id, FIX.mafftHda);
  assert.equal(body.resume.output_uuid, FIX.mafftUuid);
  assert.match(body.resume.alignment_checksum, /^[0-9a-f]{64}$/);
  const mafftStep = body.provenance.find((step) => step.step_id === "galaxy_mafft");
  assert.equal(mafftStep.resumed, true);
  assert.equal(mafftStep.provider_job_id, FIX.providerJobId, "real provider job id, not null");
  assert.equal(mafftStep.dataset_id, FIX.mafftHda);
  assert.equal(mafftStep.output_uuid, FIX.mafftUuid);
  assert.equal(mafftStep.alignment_checksum, body.resume.alignment_checksum);
  assert.equal(mafftStep.resumed_from_provider_job, true);
  const iqtreeStep = body.provenance.find((step) => step.step_id === "galaxy_iqtree");
  assert.equal(iqtreeStep.input_dataset_id, FIX.mafftHda, "IQ-TREE uses the resolved HDA");
  assert.equal(body.alignment_text, ALIGNMENT);
  // ZERO MAFFT submissions: exactly one tool POST, for IQ-TREE.
  const toolPosts = stub.calls.filter((call) => call.method === "POST"
    && call.url.includes("/api/tools") && !call.url.includes("/fetch"));
  assert.equal(toolPosts.length, 1, JSON.stringify(toolPosts));
  assert.match(toolPosts[0].body.tool_id, /iqtree/i);
  assert.doesNotMatch(JSON.stringify(toolPosts), /mafft/i);
  assert.equal(stub.calls.some((call) => call.url.includes(`/api/jobs/${FIX.providerJobId}/outputs`)), true);
  assert.equal(body.reopen.ai_run_id, body.job_ids.galaxy_iqtree);
});

test("FIXTURE resume by provider job id: a MAFFT-named .log artifact cannot outrank the FASTA output", async (t) => {
  // FIXTURE: the non-FASTA log appears FIRST and its name contains "MAFFT";
  // only the real FASTA association is an eligible alignment candidate.
  const outputs = {
    mafft_log: { id: FIX.logHda, dataset_id: "103", name: "MAFFT log on data 1",
      state: "ok", extension: "log", history_id: FIX.historyId },
    input: { id: FIX.inputHda, uuid: FIX.inputUuid, dataset_id: "101", name: "phylo.fasta",
      state: "ok", extension: "fasta", history_id: FIX.historyId },
    mafft: { id: FIX.mafftHda, uuid: FIX.mafftUuid, dataset_id: "102", name: "MAFFT on data 1",
      state: "ok", extension: "fasta", history_id: FIX.historyId }
  };
  const { response, body, stub } = await runWorkflow(t, {
    payload: { resume_provider_job_id: FIX.providerJobId, history_id: FIX.historyId },
    stubOptions: { outputs }
  });
  assert.equal(response.status, 200, JSON.stringify(body));
  assert.equal(body.resume.alignment_hda_id, FIX.mafftHda, "the FASTA output must be selected");
  assert.notEqual(body.resume.alignment_hda_id, FIX.logHda);
  assert.equal(body.provenance.find((step) => step.step_id === "galaxy_mafft").dataset_id, FIX.mafftHda);
  assert.equal(body.alignment_text, ALIGNMENT);
  assert.equal(stub.calls.filter((call) => call.method === "POST"
    && String(call.body?.tool_id ?? "").includes("mafft")).length, 0, "no MAFFT resubmission");
});

test("FIXTURE resume by provider job id: non-succeeded state returns an honest typed error, no submission", async (t) => {
  const { response, body, stub } = await runWorkflow(t, {
    payload: { resume_provider_job_id: FIX.providerJobId, history_id: FIX.historyId },
    stubOptions: { jobState: "running" }
  });
  assert.equal(response.status, 409);
  assert.equal(body.error_code, "provider_job_not_succeeded");
  assert.equal(body.provider_job_id, FIX.providerJobId);
  assert.equal(body.provider_job_state, "running");
  assert.equal(body.provider_job_state_class, "running");
  assert.equal(body.resumed_from_provider_job, false);
  assert.match(body.error, /running/);
  assert.match(body.error, /No job was submitted and no result was created/);
  assert.equal(body.tree_newick, undefined);
  assert.equal(body.provenance, undefined);
  const posts = stub.calls.filter((call) => call.method === "POST");
  assert.equal(posts.length, 0, "no job submission of any kind");
  assert.equal(stub.calls.length, 1, "only the read-only status lookup was made");
});

test("FIXTURE resume by provider job id: uploaded input dataset is rejected as an alignment output", async (t) => {
  const outputs = {
    input: { id: FIX.inputHda, uuid: FIX.inputUuid, dataset_id: "101", name: "phylo.fasta",
      state: "ok", extension: "fasta", history_id: FIX.historyId },
    queued_alignment: { id: FIX.mafftHda, name: "MAFFT on data 1",
      state: "queued", extension: "fasta", history_id: FIX.historyId }
  };
  const { response, body, stub } = await runWorkflow(t, {
    payload: { resume_provider_job_id: FIX.providerJobId, history_id: FIX.historyId },
    stubOptions: { outputs }
  });
  assert.equal(response.status, 409);
  assert.equal(body.error_code, "no_usable_alignment_output");
  assert.match(body.error, /not the uploaded input/);
  assert.equal(stub.calls.filter((call) => call.method === "POST").length, 0, "no submission");
  assert.equal(body.resumed_from_provider_job, false);
});

test("FIXTURE resume by provider job id: no_usable_alignment_output returns a sanitized association diagnostic", async (t) => {
  // FIXTURE: all three associations are unusable for different reasons, so
  // the 409 must expose exactly why without leaking secrets or FASTA content.
  const outputs = {
    input: { id: FIX.inputHda, uuid: FIX.inputUuid, dataset_id: "101", name: "phylo.fasta",
      state: "ok", extension: "fasta", history_id: FIX.historyId },
    mafft_log: { id: FIX.logHda, dataset_id: "103", name: "MAFFT log on data 1",
      state: "ok", extension: "log", history_id: FIX.historyId },
    queued: { id: FIX.mafftHda, dataset_id: "999", name: "MAFFT on data 1",
      state: "queued", extension: "fasta", history_id: FIX.historyId }
  };
  const { response, body, stub } = await runWorkflow(t, {
    payload: { resume_provider_job_id: FIX.providerJobId, history_id: FIX.historyId },
    stubOptions: { outputs }
  });
  assert.equal(response.status, 409);
  assert.equal(body.error_code, "no_usable_alignment_output");
  assert.equal(body.provider_job_id, FIX.providerJobId);
  assert.equal(body.provider_job_state, "ok");
  assert.equal(Array.isArray(body.output_associations), true);
  assert.equal(body.output_associations.length, 3);
  const expectedKeys = ["dataset_id", "error", "extension", "galaxy_dataset_id", "galaxy_dataset_uuid",
    "galaxy_hda_id", "history_id", "id", "name", "state", "usable", "uuid"];
  for (const entry of body.output_associations) {
    assert.deepEqual(Object.keys(entry).sort(), expectedKeys, JSON.stringify(entry));
    assert.equal(typeof entry.usable, "boolean");
  }
  const byId = new Map(body.output_associations.map((entry) => [entry.id, entry]));
  assert.equal(byId.get(FIX.inputHda).usable, false, "uploaded input is never usable");
  assert.equal(byId.get(FIX.inputHda).extension, "fasta");
  assert.equal(byId.get(FIX.logHda).usable, false, "non-FASTA log is not usable");
  assert.equal(byId.get(FIX.logHda).extension, "log");
  assert.equal(byId.get(FIX.mafftHda).usable, false, "queued FASTA is not usable");
  assert.equal(byId.get(FIX.mafftHda).state, "queued");
  assert.equal(body.history_contents_count, 5, "verified history contents count is reported");
  const serialized = JSON.stringify(body) + JSON.stringify(stub.calls);
  assert.doesNotMatch(serialized, /stub-secret|X-API-Key/i);
  assert.doesNotMatch(serialized, /ACGTACGTACG|CMD=Put|rid=/i);
  assert.doesNotMatch(JSON.stringify(body), /"error":\{/, "no raw error object is exposed");
  assert.equal(stub.calls.filter((call) => call.method === "POST").length, 0, "no submission");
});

test("FIXTURE resume by provider job id: invalid HDA association exposes safe persistent identity", async (t) => {
  // FIXTURE: no HDA `id`, and the persistent identity does NOT match any
  // verified history artifact, so resolution must fail closed with a typed
  // diagnostic that still exposes the UUID/dataset_id and the reason.
  const orphanUuid = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
  const outputs = {
    broken: { uuid: orphanUuid, dataset_id: "999", name: "MAFFT on data 1",
      state: "ok", extension: "fasta", history_id: FIX.historyId }
  };
  const { response, body, stub } = await runWorkflow(t, {
    payload: { resume_provider_job_id: FIX.providerJobId, history_id: FIX.historyId },
    stubOptions: { outputs }
  });
  assert.equal(response.status, 409);
  assert.equal(body.error_code, "no_usable_alignment_output");
  assert.equal(body.output_associations.length, 1);
  const entry = body.output_associations[0];
  assert.equal(entry.error, "missing_or_invalid_hda_id");
  assert.equal(entry.uuid, orphanUuid, "normalized UUID fallback is exposed");
  assert.equal(entry.galaxy_dataset_uuid, orphanUuid);
  assert.equal(entry.dataset_id, "999", "normalized dataset id fallback is exposed");
  assert.equal(entry.galaxy_dataset_id, "999");
  assert.equal(entry.galaxy_hda_id, null);
  assert.equal(entry.usable, false);
  assert.equal(body.history_contents_count, 5);
  const serialized = JSON.stringify(body) + JSON.stringify(stub.calls);
  assert.doesNotMatch(serialized, /stub-secret|X-API-Key|ACGTACGTACG|CMD=Put|rid=/i);
  assert.doesNotMatch(JSON.stringify(body), /"error":\{/, "no raw error object is exposed");
  assert.equal(stub.calls.filter((call) => call.method === "POST").length, 0, "no submission");
});

test("FIXTURE resume by provider job id: UUID-only output resolves to the verified history HDA", async (t) => {
  // FIXTURE: the job output carries ONLY a persistent UUID/dataset id (no HDA
  // id, no name/state/extension), so normalization marks it invalid. The real
  // MAFFT HDA is recovered from verified history contents, never resubmitted.
  const outputs = { mafft_uuid_only: { uuid: FIX.mafftUuid, dataset_id: "102" } };
  const { response, body, stub } = await runWorkflow(t, {
    payload: { resume_provider_job_id: FIX.providerJobId, history_id: FIX.historyId },
    stubOptions: { outputs }
  });
  assert.equal(response.status, 200, JSON.stringify(body));
  assert.equal(body.workflow_completed, true);
  assert.equal(body.resume.resumed_from_provider_job, true);
  assert.equal(body.resume.alignment_hda_id, FIX.mafftHda, "resolved HDA, not the UUID");
  assert.equal(body.resume.output_uuid, FIX.mafftUuid, "original job-output UUID is preserved");
  const mafftStep = body.provenance.find((step) => step.step_id === "galaxy_mafft");
  assert.equal(mafftStep.provider_job_id, FIX.providerJobId);
  assert.equal(mafftStep.dataset_id, FIX.mafftHda);
  assert.equal(mafftStep.output_uuid, FIX.mafftUuid);
  const iqtreeStep = body.provenance.find((step) => step.step_id === "galaxy_iqtree");
  assert.equal(iqtreeStep.input_dataset_id, FIX.mafftHda, "IQ-TREE uses the resolved HDA");
  assert.equal(body.alignment_text, ALIGNMENT);
  const toolPosts = stub.calls.filter((call) => call.method === "POST"
    && call.url.includes("/api/tools") && !call.url.includes("/fetch"));
  assert.equal(toolPosts.length, 1, JSON.stringify(toolPosts));
  assert.match(toolPosts[0].body.tool_id, /iqtree/i);
  assert.doesNotMatch(JSON.stringify(toolPosts), /mafft/i, "no MAFFT submission");
});

test("FIXTURE resume by provider job id: job-detail outputAlignment recovers the real FASTA HDA", async (t) => {
  // FIXTURE: /api/jobs/{id}/outputs has only an identity-less association, but
  // GET /api/jobs/{id} exposes outputs.outputAlignment with a real HDA id.
  const outputs = { unknown: { name: "unrecognized", state: "ok" } };
  const jobOutputs = { outputAlignment: { id: FIX.mafftHda, uuid: FIX.mafftUuid,
    dataset_id: "102", name: "MAFFT on data 1", state: "ok",
    extension: "fasta", history_id: FIX.historyId } };
  const { response, body, stub } = await runWorkflow(t, {
    payload: { resume_provider_job_id: FIX.providerJobId, history_id: FIX.historyId },
    stubOptions: { outputs, jobOutputs }
  });
  assert.equal(response.status, 200, JSON.stringify(body));
  assert.equal(body.workflow_completed, true);
  assert.equal(body.resume.resumed_from_provider_job, true);
  assert.equal(body.resume.alignment_hda_id, FIX.mafftHda);
  assert.equal(body.resume.output_uuid, FIX.mafftUuid);
  const mafftStep = body.provenance.find((step) => step.step_id === "galaxy_mafft");
  assert.equal(mafftStep.provider_job_id, FIX.providerJobId);
  assert.equal(mafftStep.dataset_id, FIX.mafftHda);
  const iqtreeStep = body.provenance.find((step) => step.step_id === "galaxy_iqtree");
  assert.equal(iqtreeStep.input_dataset_id, FIX.mafftHda, "IQ-TREE gets the HDA from job details");
  const toolPosts = stub.calls.filter((call) => call.method === "POST"
    && call.url.includes("/api/tools") && !call.url.includes("/fetch"));
  assert.equal(toolPosts.length, 1, JSON.stringify(toolPosts));
  assert.match(toolPosts[0].body.tool_id, /iqtree/i);
  assert.doesNotMatch(JSON.stringify(toolPosts), /mafft/i, "no MAFFT POST");
  assert.equal(stub.calls.some((call) => call.url.includes(`/api/jobs/${FIX.providerJobId}/outputs`)), true);
});

test("FIXTURE no_usable_alignment_output diagnostic exposes bounded output-name keys", async (t) => {
  const outputs = { orphan: { name: "unrecognized", state: "ok" } };
  const jobOutputs = { outputAlignment: { name: "still unrecognized", state: "ok" } };
  const { response, body, stub } = await runWorkflow(t, {
    payload: { resume_provider_job_id: FIX.providerJobId, history_id: FIX.historyId },
    stubOptions: { outputs, jobOutputs }
  });
  assert.equal(response.status, 409);
  assert.equal(body.error_code, "no_usable_alignment_output");
  assert.deepEqual(body.job_output_keys, ["orphan"]);
  assert.deepEqual(body.job_detail_output_keys, ["outputAlignment"]);
  assert.equal(body.recovery_version, "m7111-uuid-resolution");
  assert.ok(Array.isArray(body.history_artifacts) && body.history_artifacts.length > 0);
  assert.ok(Array.isArray(body.output_associations));
  const serialized = JSON.stringify(body) + JSON.stringify(stub.calls);
  assert.doesNotMatch(serialized, /stub-secret|X-API-Key|ACGTACGTACG|CMD=Put|rid=/i);
  assert.equal(stub.calls.filter((call) => call.method === "POST").length, 0, "no submission");
});

test("FIXTURE no_usable_alignment_output diagnostic exposes verified artifacts and recovery marker", async (t) => {
  const orphanUuid = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
  const outputs = { orphan: { uuid: orphanUuid, dataset_id: "999", state: "ok", extension: "fasta" } };
  const { response, body, stub } = await runWorkflow(t, {
    payload: { resume_provider_job_id: FIX.providerJobId, history_id: FIX.historyId },
    stubOptions: { outputs }
  });
  assert.equal(response.status, 409);
  assert.equal(body.error_code, "no_usable_alignment_output");
  assert.equal(body.recovery_version, "m7111-uuid-resolution");
  assert.equal(body.history_contents_count, 5);
  assert.equal(Array.isArray(body.history_artifacts), true);
  assert.equal(body.history_artifacts.length, 5);
  const expectedKeys = ["extension", "id", "name", "state", "uuid"];
  for (const artifact of body.history_artifacts) {
    assert.deepEqual(Object.keys(artifact).sort(), expectedKeys, JSON.stringify(artifact));
  }
  const aligned = body.history_artifacts.find((artifact) => artifact.id === FIX.mafftHda);
  assert.equal(aligned.uuid, FIX.mafftUuid);
  assert.equal(aligned.extension, "fasta");
  assert.equal(aligned.state, "ok");
  assert.ok(Array.isArray(body.output_associations), "existing diagnostic keys remain");
  const serialized = JSON.stringify(body) + JSON.stringify(stub.calls);
  assert.doesNotMatch(serialized, /stub-secret|X-API-Key|ACGTACGTACG|CMD=Put|rid=/i);
  assert.equal(stub.calls.filter((call) => call.method === "POST").length, 0, "no submission");
});

test("FIXTURE resume by provider job id: an output from a different history is rejected", async (t) => {
  const outputs = {
    mafft: { id: FIX.mafftHda, uuid: FIX.mafftUuid, name: "MAFFT on data 1",
      state: "ok", extension: "fasta", history_id: FIX.otherHistoryId }
  };
  const { response, body, stub } = await runWorkflow(t, {
    payload: { resume_provider_job_id: FIX.providerJobId, history_id: FIX.historyId },
    stubOptions: { outputs }
  });
  assert.equal(response.status, 409);
  assert.equal(body.error_code, "resume_history_membership_mismatch");
  assert.equal(body.provider_job_id, FIX.providerJobId);
  assert.equal(body.provider_job_state, "ok");
  assert.equal(stub.calls.filter((call) => call.method === "POST").length, 0, "no submission");
});

test("FIXTURE: generate_report points at the REAL IQ-TREE job, never /jobs/undefined/report", async (t) => {
  const { body } = await runWorkflow(t);
  const report = body.provenance.find((step) => step.step_id === "generate_report");
  assert.equal(report.report_endpoint, `/api/ai/jobs/${body.job_ids.galaxy_iqtree}/report`);
  assert.doesNotMatch(JSON.stringify(body.provenance), /\/jobs\/undefined\//);
});

test("FIXTURE: a run that failed before any provider job reports a null report endpoint", async (t) => {
  const { response, body } = await runWorkflow(t, {
    payload: { resume_alignment_dataset_id: "ffffffffffffffffffffffffffffffff", history_id: FIX.historyId }
  });
  assert.equal(response.status, 502);
  const report = body.provenance.find((step) => step.step_id === "generate_report");
  assert.ok(report, JSON.stringify(body.provenance));
  assert.equal(report.report_endpoint, null);
  assert.doesNotMatch(JSON.stringify(body.provenance), /\/jobs\/undefined\//);
});
