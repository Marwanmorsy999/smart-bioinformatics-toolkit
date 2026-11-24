// M6.8 trust-boundary regressions: the Worker must derive citations, locality
// and education itself; a caller cannot certify its own claims.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { hashInput } from "../functions/api/blast/_lib.js";
import { SQL } from "../functions/api/ai/_lib.js";
import {
  VERIFIED_REFERENCE_KEYS,
  projectReference,
  verifiedReference
} from "../functions/api/ai/reference_ledger.js";
import { deriveLocalityReceipt } from "../functions/api/ai/worker_locality.js";
import { deriveEducationNotes } from "../functions/api/ai/worker_education.js";
import { handleCreateRequest } from "../functions/api/ai/requests/index.js";
import { handleApprove } from "../functions/api/ai/plans/[id]/approve.js";
import { handlePollJobs } from "../functions/api/ai/jobs/index.js";
import { handleSubmitResult } from "../functions/api/ai/jobs/[id]/result.js";
import { handleGetRun } from "../functions/api/ai/runs/[id]/index.js";
import { handleGetReport } from "../functions/api/ai/runs/[id]/report.js";
import { handleGetProvenance } from "../functions/api/ai/runs/[id]/provenance.js";
import { createFakeD1AI, makeGetRequest, makePostRequest, mockAIEnv } from "./helpers/fake-d1.mjs";

const NOW = Date.parse("2026-11-24T12:00:00.000Z");
const FASTA = ">seq1 example\nACGTACGTACGT\n>seq2\nTTTTGGGGCCCC\n";
const TOKEN = "consent_0123456789abcdef0123456789abcdef";

async function claimJob(fake) {
  const env = mockAIEnv(fake.db);
  const created = await handleCreateRequest(
    makePostRequest({ text: "profile my FASTA and show GC statistics", fasta: FASTA, filename: "sample.fasta" }, "/api/ai/requests"),
    env,
    { now: NOW }
  );
  assert.equal(created.status, 200);
  const createdBody = await created.json();
  const approved = await handleApprove(
    makePostRequest({ approvals: [{ step_id: "step_1", approved: true }], consents: [] }, "/api/ai/plans/x/approve"),
    env,
    createdBody.plan_id,
    { now: NOW }
  );
  assert.equal(approved.status, 200);
  const jobId = (await approved.json()).job_ids[0];
  const poll = await handlePollJobs(
    makeGetRequest("/api/ai/jobs", { "X-Agent-Token": "test-agent-token" }),
    env,
    { now: NOW }
  );
  assert.equal(poll.status, 200);
  assert.equal((await poll.json()).jobs[0].id, jobId);
  return { env, jobId, datasetId: createdBody.dataset_id, planId: createdBody.plan_id };
}

async function profileResult(jobId, datasetId, overrides = {}) {
  const artifacts = [
    { name: "validation.json", kind: "json", content: JSON.stringify({ total_records: 2, valid_records: 2, invalid_records: 0, records: [] }), sha256: "" },
    { name: "statistics.json", kind: "json", content: JSON.stringify({ summary: { total_records: 2, gc_percent_mean: 50 }, records: [] }), sha256: "" }
  ];
  for (const artifact of artifacts) artifact.sha256 = await hashInput(artifact.content);
  return {
    job_id: jobId,
    status: "succeeded",
    execution_mode: "real",
    artifacts,
    provenance: {
      run_id: jobId,
      step_id: "step_1",
      tool: { id: "sequence-stats.profile", version: "1.0.0", backend: "local-python" },
      input: { dataset_id: datasetId, sha256: null, filename: "sample.fasta" },
      parameters: { sequence_type: "dna" },
      database: { name: null, release: null, retrieved_at: null },
      output: { artifact_names: artifacts.map((item) => item.name), sha256: await hashInput("outputs") },
      timing: { started_at: new Date(NOW).toISOString(), finished_at: new Date(NOW + 1000).toISOString() },
      execution_mode: "real"
    },
    validation: { status: "pass", flags: [], checked_rules: ["schema"] },
    explanation: { summary: "Profile complete.", findings: [], limitations: [], references: [], uncertainty: "low" },
    ...overrides
  };
}

function submit(env, jobId, result, dbOverride = null) {
  const activeEnv = dbOverride ? { ...env, AI_DB: dbOverride } : env;
  return handleSubmitResult(
    makePostRequest(result, `/api/ai/jobs/${jobId}/result`, { "X-Agent-Token": "test-agent-token" }),
    activeEnv,
    jobId,
    { now: NOW }
  );
}

function jobRow(fake, jobId) {
  return fake.state.tables.jobs.find((row) => row.public_id === jobId);
}

async function reportHtml(env, jobId) {
  return (await handleGetReport(makeGetRequest(`/api/ai/runs/${jobId}/report`), env, jobId)).text();
}

// ------------------------------------------------------------------ ledger

test("JS reference ledger matches the Python verified ledger (CI parity guard)", async () => {
  const source = await readFile(new URL("../../python-engine/src/smartbio/aiagent/explanation.py", import.meta.url), "utf8");
  const lines = source.split(/\r?\n/);
  const start = lines.findIndex((line) => /^REFERENCES\s*:/.test(line));
  assert.ok(start >= 0, "Python REFERENCES ledger not found");
  const entries = {};
  let key = null;
  for (const line of lines.slice(start + 1)) {
    if (/^}/.test(line)) break;
    const keyMatch = line.match(/^\s{4}"([^"]+)":\s*\{/);
    if (keyMatch) {
      key = keyMatch[1];
      entries[key] = { verified: false, title: null, url: null };
      continue;
    }
    if (!key) continue;
    const verified = line.match(/^\s+"verified":\s*(True|False)/);
    if (verified) entries[key].verified = verified[1] === "True";
    const field = line.match(/^\s+"(title|url)":\s*"([^"]*)"/);
    if (field) entries[key][field[1]] = field[2];
  }

  const pythonVerified = Object.keys(entries).filter((item) => entries[item].verified).sort();
  assert.deepEqual([...VERIFIED_REFERENCE_KEYS].sort(), pythonVerified);
  assert.ok(pythonVerified.includes("smartbio_gc_definition"));
  assert.ok(Object.keys(entries).some((item) => !entries[item].verified), "fixture must retain an unverified Python entry");
  for (const item of pythonVerified) {
    const projected = verifiedReference(item);
    assert.equal(projected.title, entries[item].title, item);
    assert.equal(projected.url, entries[item].url, item);
    assert.equal(projected.verified, true, item);
    assert.deepEqual(Object.keys(projectReference(projected)).sort(), ["key", "title", "url", "verified"]);
  }
  for (const item of Object.keys(entries).filter((name) => !entries[name].verified)) {
    assert.equal(verifiedReference(item), null, `${item} must not resolve in JS`);
  }
});

test("forged references are rejected; ledger references are stored as verified_by=ledger", async () => {
  const fake = createFakeD1AI();
  const { env, jobId, datasetId } = await claimJob(fake);
  const base = await profileResult(jobId, datasetId);

  const forged = structuredClone(base);
  forged.explanation.references = [{ key: "fake2026", title: "FABRICATED PAPER", url: "https://evil.test", verified: true }];
  const bad = await submit(env, jobId, forged);
  assert.equal(bad.status, 400);
  assert.match((await bad.json()).error, /fake2026|unverified_reference/);

  const unverified = structuredClone(base);
  unverified.explanation.references = [{
    key: "kim2014_16s_species_threshold",
    title: "16S rRNA gene sequence similarity and species demarcation",
    url: "https://pubmed.ncbi.nlm.nih.gov/24505072/",
    verified: true
  }];
  assert.equal((await submit(env, jobId, unverified)).status, 400, "unverified Python key must be rejected");

  const mismatched = structuredClone(base);
  mismatched.explanation.references = [{
    key: "smartbio_gc_definition",
    title: "Smart Bioinformatics Toolkit: DNA GC percentage definition",
    url: "python-engine/src/smartbio/statistics.py#calculate_statistics",
    verified: false
  }];
  assert.equal((await submit(env, jobId, mismatched)).status, 400, "field mismatch must be rejected");

  const forgedMetadata = structuredClone(base);
  forgedMetadata.explanation.references = [
    { key: "smartbio_gc_definition", title: "FABRICATED TITLE", url: "https://evil.test", verified: true }
  ];
  assert.equal((await submit(env, jobId, forgedMetadata)).status, 400, "forged title/url on a real key must be rejected");

  assert.equal(fake.state.tables.evidence_references?.length ?? 0, 0);

  // An exact ledger projection is accepted and re-stamped as ledger-verified.
  const legitimate = structuredClone(base);
  legitimate.explanation.references = [projectReference(verifiedReference("smartbio_gc_definition"))];
  const accepted = await submit(env, jobId, legitimate);
  assert.equal(accepted.status, 200);
  const stored = fake.state.tables.evidence_references;
  assert.equal(stored.length, 1);
  assert.equal(stored[0].verified, 1);
  assert.equal(stored[0].verified_by, "ledger");
  const expected = verifiedReference("smartbio_gc_definition");
  assert.equal(stored[0].title, expected.title);
  assert.equal(stored[0].url, expected.url);

  const run = await (await handleGetRun(makeGetRequest(`/api/ai/runs/${jobId}`), env, jobId)).json();
  assert.deepEqual(run.explanation.references, [projectReference(expected)]);
  const html = await reportHtml(env, jobId);
  assert.equal(html.includes("https://evil.test"), false);
  assert.equal(html.includes("FABRICATED TITLE"), false);
  assert.match(html, /Verified/);
});

// ---------------------------------------------------------------- locality

test("deriveLocalityReceipt reports no egress only when none is declared or audited", () => {
  const row = {
    plan_id: "plan_0123456789abcdef", step_id: "step_1", tool_id: "sequence-stats.profile",
    backend: "local-python", started_at: new Date(NOW).toISOString(),
    inputs_json: JSON.stringify({ external_egress: false }),
    consent_json: JSON.stringify({ granted: false })
  };
  const local = deriveLocalityReceipt({ jobRow: row, auditRows: [], mode: "real" });
  assert.equal(local.no_external_egress, true);
  assert.deepEqual(local.external_transmissions, []);
  assert.equal(local.mode, "real");
  assert.equal(local.local_operations[0].name, "sequence-stats.profile");

  const egress = deriveLocalityReceipt({
    jobRow: { ...row, inputs_json: JSON.stringify({ external_egress: true }) },
    auditRows: [],
    mode: "mock"
  });
  assert.equal(egress.no_external_egress, false);
  assert.equal(egress.mode, "mock");
  assert.equal(egress.external_transmissions.length, 1);
  assert.match(egress.external_transmissions[0].destination, /external service/);
});

test("forged no-egress receipt is replaced by an audited transmission; forged tokens never appear", async () => {
  const fake = createFakeD1AI();
  const { env, jobId, datasetId } = await claimJob(fake);
  const job = jobRow(fake, jobId);
  const fastaHash = await hashInput(FASTA);
  job.inputs_json = JSON.stringify({ ...JSON.parse(job.inputs_json), external_egress: true, consent_required: true });
  job.consent_json = JSON.stringify({ granted: true, scope: ["external-blast"] });
  fake.state.tables.audit_events.push({
    id: 9001,
    public_id: "aud_egress0000000001",
    actor: "browser",
    action: "blast_egress",
    target: "https://blast.ncbi.nlm.nih.gov/Blast.cgi",
    detail_json: JSON.stringify({ input_hash: fastaHash, payload_bytes: 2048, database: "16S_ribosomal_RNA", program: "blastn" }),
    timestamp: new Date(NOW).toISOString()
  });

  const FORGED_MARKER = "FORGED_NO_EGRESS_MARKER";
  const result = await profileResult(jobId, datasetId);
  result.provenance.locality_receipt = {
    mode: "real",
    no_external_egress: true,
    local_operations: [],
    external_transmissions: [],
    consent_records: [TOKEN],
    marker: FORGED_MARKER
  };
  assert.equal((await submit(env, jobId, result)).status, 200);

  const provenance = JSON.parse(jobRow(fake, jobId).provenance_json);
  const receipt = provenance.locality_receipt;
  assert.equal(receipt.no_external_egress, false);
  assert.equal(receipt.marker, undefined);
  assert.equal(receipt.external_transmissions.length, 1);
  assert.equal(receipt.external_transmissions[0].bytes_sent, 2048);
  assert.equal(receipt.external_transmissions[0].input_sha256, fastaHash);
  assert.match(receipt.external_transmissions[0].destination, /blast\.ncbi/);
  assert.match(receipt.external_transmissions[0].consent, /^apr_/);
  assert.equal(receipt.consent_records.includes(TOKEN), false);

  const served = await (await handleGetProvenance(makeGetRequest(`/api/ai/runs/${jobId}/provenance`), env, jobId)).json();
  assert.deepEqual(served.locality_receipt, receipt);
  const html = await reportHtml(env, jobId);
  assert.match(html, /External transmissions/);
  assert.match(html, /2048/);
  assert.match(html, /blast\.ncbi/);
  assert.equal(html.includes(TOKEN), false);
  assert.equal(html.includes(FORGED_MARKER), false);
  assert.equal(html.includes("No external transmissions (no data left the machine)."), false);
});

// --------------------------------------------------------------- education

test("deriveEducationNotes never turns an abstention into a positive conclusion", () => {
  const { notes } = deriveEducationNotes({ flags: ["insufficient_evidence", "below_screening_threshold"] });
  assert.equal(notes.length, 2);
  for (const note of notes) {
    assert.equal(note.verified_reference, null, "unverified 16S key must stay null");
    assert.match(note.why_insufficient, /abstain|not supported|not converted/i);
    assert.doesNotMatch(note.what_would_help, /establish(es)? a novel species|confirms a species/i);
    assert.deepEqual(Object.keys(note).sort(), ["rule_or_threshold", "verified_reference", "what_would_help", "why_insufficient"]);
  }
});

test("caller-supplied education notes are replaced by flags-derived Worker notes", async () => {
  const fake = createFakeD1AI();
  const { env, jobId, datasetId } = await claimJob(fake);
  const result = await profileResult(jobId, datasetId, {
    validation: {
      status: "warn",
      flags: ["gc_percent_out_of_range", "near_threshold", "insufficient_evidence", "invented_flag"],
      checked_rules: ["schema"]
    }
  });
  const FORGED_KEY = "FORGED_REFERENCE_KEY";
  result.explanation.education = {
    notes: [{
      rule_or_threshold: "FORGED RULE",
      why_insufficient: "nothing",
      what_would_help: "nothing",
      verified_reference: FORGED_KEY
    }]
  };
  assert.equal((await submit(env, jobId, result)).status, 200);

  const stored = JSON.parse(jobRow(fake, jobId).explanation_json);
  const notes = stored.education.notes;
  assert.equal(notes.some((note) => note.rule_or_threshold === "FORGED RULE"), false);
  assert.deepEqual(notes.map((note) => note.verified_reference), ["smartbio_gc_definition", null, null, null]);
  const abstention = notes.find((note) => /taxonomy evidence rule/.test(note.rule_or_threshold));
  assert.match(abstention.why_insufficient, /abstain/i);
  assert.match(abstention.why_insufficient, /not converted/i);

  const html = await reportHtml(env, jobId);
  assert.equal(html.includes(FORGED_KEY), false);
  assert.equal(html.includes("FORGED RULE"), false);
  assert.match(html, /smartbio_gc_definition/);
  assert.match(html, /None \(no verified reference\)/);
});

// ----------------------------------------------------------- claim & TOCTOU

test("result submission requires a claimed running job", async () => {
  const fake = createFakeD1AI();
  const { env, jobId, datasetId } = await claimJob(fake);
  const job = jobRow(fake, jobId);
  const result = await profileResult(jobId, datasetId);

  job.status = "queued";
  job.agent_id = null;
  const queued = await submit(env, jobId, result);
  assert.equal(queued.status, 409, "queued jobs cannot submit results without polling");

  job.status = "running";
  job.agent_id = null;
  const unclaimed = await submit(env, jobId, result);
  assert.equal(unclaimed.status, 409);
  assert.match((await unclaimed.json()).error, /claimed/);
  assert.equal(fake.state.tables.artifacts?.length ?? 0, 0);
  assert.equal(fake.state.tables.report_runs?.length ?? 0, 0);

  job.agent_id = "worker-1";
  assert.equal((await submit(env, jobId, result)).status, 200);
});

test("concurrent result submission loser gets 409 and writes nothing", async () => {
  const fake = createFakeD1AI();
  const { env, jobId, datasetId } = await claimJob(fake);
  const result = await profileResult(jobId, datasetId);

  // Simulate the interleaving: our read sees `running`, then a competing
  // submission commits before our conditional UPDATE. The fake D1 honours the
  // status predicate (SQL_META.where = ['public_id', 'status']), so the guard
  // reports changes=0 exactly as real D1 would.
  let flipped = false;
  const racingDb = {
    prepare(sql) {
      const statement = fake.db.prepare(sql);
      return {
        sql,
        values: [],
        bind(...values) {
          statement.bind(...values);
          this.values = values;
          return this;
        },
        async run() {
          return statement.run();
        },
        async all() {
          const outcome = await statement.all();
          if (sql === SQL.getJob && !flipped) {
            flipped = true;
            jobRow(fake, jobId).status = "succeeded"; // competing winner
          }
          return outcome;
        }
      };
    }
  };

  const response = await submit(env, jobId, result, racingDb);
  assert.equal(response.status, 409);
  assert.match((await response.json()).error, /concurrently/);
  assert.match(SQL.saveJobResult, /status IN \('queued','running'\)/);
  assert.ok(fake.state.calls.some((call) => call.sql === SQL.saveJobResult), "conditional UPDATE must run");
  assert.equal(jobRow(fake, jobId).status, "succeeded", "the winner's status must not be overwritten");
  assert.equal(fake.state.tables.artifacts?.length ?? 0, 0);
  assert.equal(fake.state.tables.tool_runs?.length ?? 0, 0);
  assert.equal(fake.state.tables.report_runs?.length ?? 0, 0);
  assert.equal(fake.state.tables.evidence_references?.length ?? 0, 0);
  assert.equal(fake.state.tables.audit_events.filter((event) => event.action.startsWith("ai_result_")).length, 0);
});
