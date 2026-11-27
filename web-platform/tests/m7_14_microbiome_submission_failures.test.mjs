// M7.14.2 SUBMISSION-FAILURES DIAGNOSTIC — LABELLED STUBBED TESTS — ZERO live calls.
//
// The live run recorded bounded sanitized `state.submission_failures` entries
// but no endpoint surfaced them. These tests pin a GET-only view that reads the
// STORED array and returns ONLY allowlisted, re-scrubbed fields. No provider is
// contacted, nothing is submitted, no state is mutated and no run is created.
import test from "node:test";
import assert from "node:assert/strict";

import { handleSubmissionFailures } from "../functions/api/ai/workflows/microbiome/engine.js";
import { createFakeD1AI, makeGetRequest, mockAIEnv } from "./helpers/fake-d1.mjs";
import { createFetch, handlers } from "../worker.js";

const RUN_ID = "job_a8817e35d7534d98";
const DEMUX_TOOL = "toolshed.g2.bx.psu.edu/repos/iuc/qiime2_demux_emp_single/2026.1.0";
const SECRET = "stub-secret-key-xyz";
const PATH = `/api/ai/workflows/microbiome/submission-failures?run_id=${RUN_ID}`;

function storedFailure(overrides = {}) {
  return {
    step_id: "demux", at: "2026-11-27T00:00:00.000Z", tool_id: DEMUX_TOOL,
    tool_version: "2026.1.0", field_names: ["seqs", "barcodes|column"],
    http_status: 400, error_code: "bad_request", error_message: "upstream refused the request",
    basis: "sanitized_failed_submission_request_summary", ...overrides
  };
}

function stateWithFailures(failures) {
  return {
    workflow_type: "microbiome", run_id: RUN_ID, plan_id: `plan_${RUN_ID}`,
    status: "failed", current_step: "demux", created_at: "2026-11-27T00:00:00.000Z",
    input_sha256: "a".repeat(64), metadata_sha256: "b".repeat(64), params: {},
    history_id: "11ac94870d0bb33aff42f70766c41aa1", steps: {}, errors: [], poll_count: 0,
    submission_failures: failures
  };
}

function seededDb(state) {
  return createFakeD1AI({ microbiome_runs: [{
    public_id: RUN_ID, input_sha256: state.input_sha256, metadata_sha256: state.metadata_sha256,
    state: state.status, plan_id: state.plan_id, run_id: RUN_ID, state_json: JSON.stringify(state),
    result_json: null, created_at: state.created_at, completed_at: null
  }] });
}

// A fetch stub that records every attempted provider call; the diagnostic must
// never use it. Any call here is a regression to be caught by the zero-POST test.
function makeStub() {
  const calls = [];
  const fetchImpl = async (input, init = {}) => {
    calls.push({ url: String(input), method: String(init.method ?? "GET").toUpperCase() });
    return new Response(JSON.stringify({ error: "unexpected_provider_call" }), { status: 500 });
  };
  return { calls, fetchImpl };
}

function envFor(db, stub) {
  return { GALAXY_API_KEY: SECRET, ...mockAIEnv(db), FETCH_IMPL: stub.fetchImpl };
}

async function callDiagnostic(state, stub) {
  const { db, state: d1 } = seededDb(state);
  const before = d1.tables.microbiome_runs[0].state_json;
  const previousFetch = globalThis.fetch;
  globalThis.fetch = stub.fetchImpl;
  try {
    const response = await handleSubmissionFailures(makeGetRequest(PATH), envFor(db, stub), {});
    return { response, body: await response.json(), d1, before };
  } finally {
    globalThis.fetch = previousFetch;
  }
}

// ------------------------------------------------------ stored failures surfaced

test("LABELLED STUB / stored submission failures are returned with run_id and workflow_type", async () => {
  const stub = makeStub();
  const entry = storedFailure();
  const { response, body } = await callDiagnostic(stateWithFailures([entry]), stub);
  assert.equal(response.status, 200);
  assert.equal(body.available, true);
  assert.equal(body.run_id, RUN_ID);
  assert.equal(body.workflow_type, "microbiome");
  assert.equal(body.submission_failures.length, 1);
  assert.deepEqual(body.submission_failures[0], {
    step_id: "demux", at: "2026-11-27T00:00:00.000Z", tool_id: DEMUX_TOOL,
    tool_version: "2026.1.0", field_names: ["seqs", "barcodes|column"],
    http_status: 400, error_code: "bad_request", error_message: "upstream refused the request",
    basis: "sanitized_failed_submission_request_summary"
  });
});

test("LABELLED STUB / only the allowlisted fields leave the boundary", async () => {
  const stub = makeStub();
  const entry = storedFailure({ injected: "must_not_leave", inputs: { seqs: { src: "hda", id: "secret-id" } } });
  const { body } = await callDiagnostic(stateWithFailures([entry]), stub);
  assert.deepEqual(Object.keys(body.submission_failures[0]).sort(), [
    "at", "basis", "error_code", "error_message", "field_names",
    "http_status", "step_id", "tool_id", "tool_version"
  ]);
  const raw = JSON.stringify(body);
  assert.equal(raw.includes("must_not_leave"), false, "unknown state fields are dropped");
  assert.equal(raw.includes("secret-id"), false, "no payload values are returned");
});

// ------------------------------------------------------------ honest unavailability

test("LABELLED STUB / no stored failures returns an honest 200 unavailable", async () => {
  const stub = makeStub();
  const { response, body } = await callDiagnostic(stateWithFailures([]), stub);
  assert.equal(response.status, 200);
  assert.equal(body.available, false);
  assert.equal(body.run_id, RUN_ID);
  assert.equal(body.workflow_type, "microbiome");
  assert.deepEqual(body.submission_failures, []);
  assert.match(body.reason, /No failed provider submissions were recorded/);
});

test("LABELLED STUB / a missing submission_failures array is honestly unavailable", async () => {
  const stub = makeStub();
  const { body } = await callDiagnostic(stateWithFailures(undefined), stub);
  assert.equal(body.available, false);
  assert.deepEqual(body.submission_failures, []);
});

// -------------------------------------------------------------- redaction safety

test("LABELLED STUB / secrets, key patterns and URLs are redacted at this boundary", async () => {
  const stub = makeStub();
  const entry = storedFailure({
    tool_id: `https://galaxy.example.test/api/tools?key=${SECRET}`,
    error_message: `X-API-Key: ${SECRET} ${"upstream refused ".repeat(40)}`
  });
  const { body } = await callDiagnostic(stateWithFailures([entry]), stub);
  const raw = JSON.stringify(body);
  assert.equal(raw.includes(SECRET), false, "configured secret never appears");
  assert.equal(raw.includes("https://"), false, "URLs never appear");
  assert.equal(/x-api-key\s*:/i.test(raw), false, "key headers never appear");
  assert.match(body.submission_failures[0].tool_id, /\[url\]/);
  assert.match(body.submission_failures[0].error_message, /\[redacted\]/);
  assert.ok(body.submission_failures[0].error_message.length <= 300, "error message stays bounded");
});

test("LABELLED STUB / stored upstream_excerpt appears, is redacted and capped at 600", async () => {
  const stub = makeStub();
  const entry = storedFailure({
    upstream_excerpt: `X-API-Key: ${SECRET} https://galaxy.example.test/api/tools?key=${SECRET} ` + "E".repeat(1200)
  });
  const { response, body } = await callDiagnostic(stateWithFailures([entry]), stub);
  assert.equal(response.status, 200);
  assert.equal(body.available, true, "the response contract is unchanged");
  const excerpt = body.submission_failures[0].upstream_excerpt;
  assert.ok(excerpt, "the stored excerpt is surfaced");
  assert.ok(excerpt.length <= 600, `excerpt stays bounded: ${excerpt.length}`);
  assert.match(excerpt, /\[redacted\]/, "secrets are redacted");
  assert.match(excerpt, /\[url\]/, "URLs are redacted");
  const raw = JSON.stringify(body);
  assert.equal(raw.includes(SECRET), false, "configured secret never appears");
  assert.equal(raw.includes("https://"), false, "no signed URL appears");
  assert.equal(stub.calls.some((call) => call.method === "POST"), false, "zero POSTs");

  // An entry without the newer field keeps the original response shape.
  const plain = await callDiagnostic(stateWithFailures([storedFailure()]), stub);
  assert.equal("upstream_excerpt" in plain.body.submission_failures[0], false);
});

// ------------------------------------------- zero provider POSTs / no mutation

test("LABELLED STUB / zero provider calls, no POST, no state mutation and no new run", async () => {
  const stub = makeStub();
  const { body, d1, before } = await callDiagnostic(stateWithFailures([storedFailure()]), stub);
  assert.equal(stub.calls.length, 0, "the stored-only view makes no provider call");
  assert.equal(stub.calls.some((call) => call.method === "POST"), false, "zero POSTs");
  assert.equal(d1.tables.microbiome_runs.length, 1, "no run was created");
  assert.equal(d1.tables.microbiome_runs[0].state_json, before, "stored state was not mutated");
  assert.equal(body.available, true);
});

// ---------------------------------------------------------------------- routing

test("LABELLED ROUTE / GET submission-failures reaches its stubbed worker handler", async () => {
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
  assert.deepEqual(await response.json(), { key: "microbiomeSubmissionFailures" });
  assert.equal(seen.length, 1);
  assert.equal(seen[0].context.request.url, `https://worker.example.test${PATH}`);
});
