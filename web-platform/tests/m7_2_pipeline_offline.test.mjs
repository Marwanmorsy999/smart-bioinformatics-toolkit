// M7.2 OFFLINE / MOCK-only verification of the complete website control-plane chain.
//
// NOT LIVE EXECUTION. Every Galaxy response comes from a clearly labelled MOCK
// fixture returned by an injected fetch; all storage is an injected fake D1 and
// an in-memory R2 stand-in. No credential, no real endpoint and no real
// scientific result is involved. Assertions verify contract wiring only.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { createFetch, handlers } from "../worker.js";
import { SQL_META, hashInput, validatePlan } from "../functions/api/ai/_lib.js";
import { getTool } from "../functions/api/ai/registry.js";
import { validateExplanationReferences } from "../functions/api/ai/reference_ledger.js";
import { PROVIDER_SQL } from "../functions/api/providers/_lib.js";
import { SQL_UPSERT_HEARTBEAT } from "../functions/api/ai/jobs/index.js";
import { SQL_LIST_HEARTBEATS } from "../functions/api/ai/backend.js";
import { JOB_STATUS } from "../providers/common/contract.js";

const FIXTURES = new URL("./fixtures/providers/galaxy/", import.meta.url);
const fixture = (name) => JSON.parse(readFileSync(new URL(name, FIXTURES), "utf8"));
const discovery = fixture("m7_2_galaxy_discovery.json");
const jobs = fixture("m7_2_galaxy_jobs.json");
const errors = fixture("m7_2_galaxy_errors.json");

const TOOL_ID = discovery.tools.find((tool) => tool.disabled !== true).id;
const TOOL = getTool("sequence-stats.profile");
const FASTA = ">m7_2_seq1 OFFLINE MOCK\nACGTACGTACGT\n>m7_2_seq2\nTTTTGGGGCCCC\n";
const TEXT = "profile my FASTA statistics";
const ALERT_SQL =
  "INSERT INTO governor_alerts (public_id, provider, unit, category, ratio, kind, at) VALUES (?, ?, ?, ?, ?, ?, ?)";

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}
function ok(changes) {
  return { success: true, meta: { changes } };
}
function governorState(overrides = {}) {
  return {
    version: 1,
    totals: { galaxy: { jobs: 10, bytes: 4096 } },
    used: { galaxy: {} }, usedByCategory: { galaxy: {} }, reserved: { galaxy: {} },
    reservations: {}, emergency: {}, usage: {}, alerts: [],
    ...overrides
  };
}
function finalGovernor(state) {
  return JSON.parse(state.governor ?? "{}");
}

// purpose-built fake D1: AI migration tables via SQL_META plus the migration-0007
// provider tables. No real D1, no real network, no production code changes.
function createM7FakeD1(seed = {}) {
  const state = {
    tables: {}, calls: [], governor: seed.governor ?? null,
    consents: new Map((seed.consents ?? []).map((row) => [row.public_id, { ...row }])),
    providerJobs: new Map((seed.providerJobs ?? []).map((row) => [row.public_id, { ...row }])),
    transfers: [...(seed.transfers ?? [])],
    artifacts: new Map((seed.artifacts ?? []).map((row) => [row.public_id, { ...row }])),
    alerts: [], heartbeats: new Map()
  };
  let nextId = 1;
  for (const [table, rows] of Object.entries(seed.tables ?? {})) {
    state.tables[table] = rows.map((row) => ({ ...row, id: row.id ?? nextId++ }));
  }
  const ensure = (table) => (state.tables[table] ??= []);
  const matchesWhere = (row, columns, values) => columns.every((column, index) => row[column] === values[index]);
  const uniquePairs = { jobs: ["plan_id", "step_id"], approvals: ["plan_id", "step_id"] };

  const db = {
    prepare(sql) {
      const stmt = {
        sql,
        values: [],
        bind(...values) { stmt.values = values; return stmt; },
        async run() {
          state.calls.push({ sql, values: [...stmt.values] });
          const v = stmt.values;
          if (sql === PROVIDER_SQL.putGovernorState) { state.governor = v[1]; return ok(1); }
          if (sql === PROVIDER_SQL.insertConsentRecord) {
            state.consents.set(v[0], {
              public_id: v[0], dataset_id: v[1], provider: v[2], destination: v[3],
              scope_json: v[4], granted: v[5], created_at: v[6], expires_at: v[7]
            });
            return ok(1);
          }
          if (sql === PROVIDER_SQL.consumeConsent) {
            const row = state.consents.get(v[1]);
            if (!row || row.granted !== 1 || row.used_at) return ok(0);
            row.granted = 0;
            row.used_at = v[0];
            return ok(1);
          }
          if (sql === PROVIDER_SQL.insertProviderJob) {
            state.providerJobs.set(v[0], {
              public_id: v[0], provider: v[1], tool_id: v[2], operation: v[3], status: v[4],
              provider_job_id: v[5], reservation_id: v[6], dataset_id: v[7], input_hash: v[8],
              byte_count: v[9], consent_id: v[10], transfer_id: v[11], params_json: v[12],
              created_at: v[13], finished_at: v[14], detail_json: null
            });
            return ok(1);
          }
          if (sql === PROVIDER_SQL.updateProviderJob) {
            const row = state.providerJobs.get(v[3]);
            if (!row) return ok(0);
            row.status = v[0];
            row.finished_at = v[1];
            row.detail_json = v[2];
            return ok(1);
          }
          if (sql === PROVIDER_SQL.insertTransfer) { state.transfers.push([...v]); return ok(1); }
          if (sql === PROVIDER_SQL.insertArtifactRecord) {
            state.artifacts.set(v[0], {
              public_id: v[0], dataset_id: v[1], object_key: v[2], filename: v[3], mime: v[4],
              sha256: v[5], bytes: v[6], status: v[7], created_at: v[8], deleted_at: v[9]
            });
            return ok(1);
          }
          if (sql === PROVIDER_SQL.markArtifactDeleted) {
            const row = state.artifacts.get(v[2]);
            if (!row) return ok(0);
            row.status = v[0];
            row.deleted_at = v[1];
            return ok(1);
          }
          if (sql === ALERT_SQL) { state.alerts.push([...v]); return ok(1); }
          if (sql === SQL_UPSERT_HEARTBEAT) {
            state.heartbeats.set(v[0], { agent_id: v[0], last_seen_at: v[1], last_job_count: v[2] });
            return ok(1);
          }
          const meta = SQL_META[sql];
          if (!meta) throw new Error(`Unexpected M7.2 run SQL: ${sql}`);
          const rows = ensure(meta.table);
          if (meta.op === "insert") {
            const uniqueColumns = uniquePairs[meta.table];
            if (uniqueColumns) {
              const values = uniqueColumns.map((column) => v[meta.columns.indexOf(column)]);
              if (rows.some((existing) => matchesWhere(existing, uniqueColumns, values))) {
                throw new Error(`UNIQUE constraint failed: ${meta.table}.${uniqueColumns.join(", ")}`);
              }
            }
            const row = { id: nextId++ };
            meta.columns.forEach((column, index) => { row[column] = v[index] ?? null; });
            rows.push(row);
            return ok(1);
          }
          if (meta.op === "update" || meta.op === "claim") {
            const whereValues = v.slice(-meta.where.length);
            const matched = rows.filter((row) => matchesWhere(row, meta.where, whereValues));
            for (const row of matched) {
              for (const [column, index] of Object.entries(meta.assignments)) row[column] = v[index];
              if (meta.increment) row[meta.increment] = (row[meta.increment] ?? 0) + 1;
            }
            return ok(matched.length);
          }
          throw new Error(`Unexpected M7.2 run op: ${meta.op}`);
        },
        async all() {
          state.calls.push({ sql, values: [...stmt.values] });
          if (sql === PROVIDER_SQL.getGovernorState) {
            return { success: true, results: state.governor ? [{ state_json: state.governor }] : [] };
          }
          if (sql === PROVIDER_SQL.getConsentRecord) {
            const row = state.consents.get(stmt.values[0]);
            return { success: true, results: row ? [{ ...row }] : [] };
          }
          if (sql === PROVIDER_SQL.getProviderJob) {
            const row = state.providerJobs.get(stmt.values[0]);
            return { success: true, results: row ? [{ ...row }] : [] };
          }
          if (sql === PROVIDER_SQL.getArtifactRecord) {
            const row = state.artifacts.get(stmt.values[0]);
            return { success: true, results: row ? [{ ...row }] : [] };
          }
          if (sql === PROVIDER_SQL.getTransfer) {
            return { success: true, results: state.transfers.filter((row) => row[0] === stmt.values[0]) };
          }
          if (sql === SQL_LIST_HEARTBEATS) {
            return { success: true, results: [...state.heartbeats.values()].map((row) => ({ ...row })) };
          }
          const meta = SQL_META[sql];
          if (!meta || meta.op !== "select") throw new Error(`Unexpected M7.2 all SQL: ${sql}`);
          let rows = ensure(meta.table).filter((row) => matchesWhere(row, meta.where, stmt.values));
          if (meta.orderBy) rows = [...rows].sort((a, b) => String(a[meta.orderBy]).localeCompare(String(b[meta.orderBy])));
          if (meta.limit) rows = rows.slice(0, stmt.values[stmt.values.length - 1]);
          return { success: true, results: rows.map((row) => ({ ...row })) };
        }
      };
      return stmt;
    }
  };
  return { db, state };
}

// In-memory R2 stand-in. It never touches a bucket or the network.
function fakeBucket() {
  const objects = new Map();
  return {
    objects,
    async put(key, value, options = {}) {
      const bytes = new Uint8Array(await new Response(value).arrayBuffer());
      objects.set(key, {
        bytes,
        httpMetadata: options.httpMetadata ?? {},
        customMetadata: options.customMetadata ?? {},
        size: bytes.length
      });
    },
    async get(key) {
      const item = objects.get(key);
      if (!item) return null;
      return {
        body: new Response(item.bytes).body,
        httpMetadata: item.httpMetadata,
        customMetadata: item.customMetadata,
        size: item.size
      };
    },
    async delete(key) { objects.delete(key); return true; }
  };
}

let sequence = 0;
function makeEnv(db, bucket, fetchImpl) {
  sequence += 1;
  return {
    AI_DB: db,
    AI_AGENT_TOKEN: "m7-2-offline-agent-token",
    // OFFLINE/MOCK: synthetic results must be labelled mock end to end.
    AI_EXECUTION_MODE: "mock",
    FETCH_IMPL: fetchImpl,
    GALAXY_ENABLED: "true",
    GALAXY_BASE_URL: `https://m7-2-pipeline-${sequence}.invalid`,
    GALAXY_API_KEY: "MOCK-KEY-NOT-A-REAL-SECRET",
    ARTIFACTS: bucket,
    ARTIFACT_SIGNING_KEY: "m7-2-offline-hmac-key-not-a-real-secret"
  };
}

const workerFetch = createFetch(handlers);
async function call(env, method, path, body, headers = {}) {
  const init = {
    method,
    headers: {
      "CF-Connecting-IP": "m7-2-offline-pipeline",
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      ...headers
    }
  };
  if (body !== undefined) init.body = JSON.stringify(body);
  return workerFetch(new Request(`https://m7-2.example.test${path}`, init), env, {});
}
async function callRaw(env, method, pathWithQuery, body, headers = {}) {
  return workerFetch(new Request(`https://m7-2.example.test${pathWithQuery}`, {
    method,
    headers: { "CF-Connecting-IP": "m7-2-offline-pipeline", ...headers },
    ...(body !== undefined ? { body } : {})
  }), env, {});
}

// The ONLY Galaxy "server" in this file: canned MOCK fixtures selected by URL.
function mockGalaxyFetch(calls, flags = {}) {
  return async (input, init = {}) => {
    const url = String(input);
    const method = init.method ?? "GET";
    const body = init.body ? JSON.parse(init.body) : {};
    calls.push({ url, method, body });
    if (url.endsWith("/api/tools") && method === "GET") return json(discovery.tools);
    if (url.endsWith("/api/workflows")) return json(discovery.workflows);
    if (url.endsWith("/api/version")) return json(discovery.version);
    if (url.endsWith("/api/users/current/usage")) return json(discovery.usage);
    if (url.endsWith("/api/users/current")) return json(discovery.user);
    if (url.endsWith("/api/histories") && method === "POST") return json(jobs.history);
    if (url.endsWith("/api/tools") && method === "POST") {
      if (body.tool_id === "upload1") return json(jobs.upload);
      return json({ ...jobs.queued_job, state: flags.jobState ?? "queued" });
    }
    if (url.includes("/api/invocations") && method === "POST") return json(flags.invocation ?? jobs.invocation);
    if (url.includes("/api/jobs/")) return json({ ...jobs.running_job, state: flags.jobState ?? "queued" });
    if (url.includes("/api/invocations/")) return json({ ...jobs.invocation, state: flags.jobState ?? "queued" });
    if (url.includes("/api/histories/") && url.endsWith("/contents")) return json(jobs.contents);
    if (url.includes("/api/datasets/") && url.endsWith("/content")) return new Response(jobs.dataset_content);
    if (url.includes("/api/datasets/")) return json(jobs.dataset);
    return json(errors.not_found_404, 404);
  };
}

async function mockArtifact(name, kind, content) {
  return { name, kind, content, sha256: await hashInput(content) };
}

test("OFFLINE/MOCK full chain: request/plan -> validation -> approval+consent -> governed submit -> status -> artifacts -> M6 gate -> report -> download", async () => {
  const { db, state } = createM7FakeD1({ governor: JSON.stringify(governorState()) });
  const calls = [];
  const flags = { jobState: "queued" };
  const bucket = fakeBucket();
  const env = makeEnv(db, bucket, mockGalaxyFetch(calls, flags));

  // 1. OFFLINE/MOCK request + deterministic plan creation through the real worker router.
  const createdRes = await call(env, "POST", "/api/ai/requests", {
    text: TEXT, fasta: FASTA, filename: "m7-2-mock.fasta"
  });
  assert.equal(createdRes.status, 200, `OFFLINE request failed: ${await createdRes.clone().text()}`);
  const created = await createdRes.json();
  assert.equal(created.execution_mode, "mock", "OFFLINE/MOCK: response must be labelled mock");
  assert.match(created.request_id, /^req_[0-9a-f]{16}$/);
  assert.match(created.dataset_id, /^ds_[0-9a-f]{16}$/);
  assert.match(created.plan_id, /^plan_[0-9a-f]{16}$/);
  assert.equal(created.plan.intent, "validate_and_profile");
  assert.equal(created.plan.steps.length, 1);
  assert.equal(created.plan.steps[0].tool_id, "sequence-stats.profile");
  assert.equal(created.plan.steps[0].backend, "local-python");
  assert.equal(created.plan.steps[0].external_egress, false);
  assert.equal(created.plan.steps[0].consent_required, false);

  // 2. OFFLINE/MOCK structured plan validation: the generated plan satisfies the same gate the approval handler uses.
  assert.deepEqual(validatePlan(created.plan), { valid: true, error: null });

  // 3a. OFFLINE/MOCK approval gate: only the explicitly approved step becomes an AI job.
  const approveRes = await call(env, "POST", `/api/ai/plans/${created.plan_id}/approve`, {
    approvals: [{ step_id: "step_1", approved: true }], consents: []
  });
  assert.equal(approveRes.status, 200, `OFFLINE approval failed: ${await approveRes.clone().text()}`);
  const approved = await approveRes.json();
  assert.equal(approved.skipped.length, 0);
  assert.equal(approved.job_ids.length, 1);
  const aiJobId = approved.job_ids[0];
  assert.match(aiJobId, /^job_[0-9a-f]{16}$/);

  // 3b. OFFLINE/MOCK per-provider consent for Galaxy and the approved dataset.
  const consentRes = await call(env, "POST", "/api/providers/consent", {
    provider: "galaxy", dataset_id: created.dataset_id, granted: true,
    scope: { operation: "submit_job", destination: "galaxy" }
  });
  assert.equal(consentRes.status, 201, `OFFLINE consent failed: ${await consentRes.clone().text()}`);
  const consent = (await consentRes.json()).consent;
  assert.match(consent.id, /^pcon_[0-9a-f]{16}$/);
  assert.equal(consent.granted, true);
  assert.equal(consent.dataset_id, created.dataset_id);

  // 4. OFFLINE/MOCK governed job submit: real handler, fake D1 + fake Galaxy fetch.
  const byteCount = new TextEncoder().encode(FASTA).length;
  const submitRes = await call(env, "POST", "/api/providers/jobs", {
    provider: "galaxy", tool_id: TOOL_ID, dataset_id: created.dataset_id,
    consent_id: consent.id, size_bytes: byteCount,
    input_hash: await hashInput(FASTA), params: { mode: "offline-mock" }
  });
  assert.equal(submitRes.status, 202, `OFFLINE governed submit failed: ${await submitRes.clone().text()}`);
  const submitBody = await submitRes.json();
  const submitted = submitBody.job;
  assert.equal(submitBody.execution_mode, "mock", "OFFLINE/MOCK: governed response must be labelled mock");
  assert.match(submitted.id, /^pjob_[0-9a-f]{16}$/);
  assert.match(submitted.transfer_id, /^xfer_[0-9a-f]{16}$/);
  assert.equal(submitted.consent_id, null, "OFFLINE/MOCK: consent id must not be echoed back");
  assert.equal(submitted.external_egress, true);
  assert.equal(submitted.destination, "galaxy");
  assert.ok(calls.some((entry) => entry.method === "POST" && entry.url.endsWith("/api/tools") && entry.body.tool_id === TOOL_ID),
    "OFFLINE/MOCK: submission must use the dynamically discovered MOCK tool id");
  const governorAfterSubmit = finalGovernor(state);
  assert.deepEqual(governorAfterSubmit.reservations, {}, "OFFLINE/MOCK: no reservation may leak after a successful submit");
  assert.equal(governorAfterSubmit.reserved.galaxy.jobs, 0);
  assert.equal(governorAfterSubmit.reserved.galaxy.bytes, 0);
  assert.equal(governorAfterSubmit.used.galaxy.jobs, 1);
  assert.equal(governorAfterSubmit.used.galaxy.bytes, byteCount);

  // 5. OFFLINE/MOCK job status monitoring against canned Galaxy states.
  flags.jobState = "running";
  const runningRes = await call(env, "GET", `/api/providers/jobs/${submitted.id}`);
  assert.equal(runningRes.status, 200);
  assert.equal((await runningRes.json()).job.status, JOB_STATUS.RUNNING);
  flags.jobState = "ok";
  const doneRes = await call(env, "GET", `/api/providers/jobs/${submitted.id}`);
  assert.equal(doneRes.status, 200);
  assert.equal((await doneRes.json()).job.status, JOB_STATUS.SUCCEEDED);
  assert.equal(state.providerJobs.get(submitted.id).status, JOB_STATUS.SUCCEEDED);

  // 6. OFFLINE/MOCK artifact discovery: only completed MOCK datasets are artifacts, still unvalidated.
  const artifactsRes = await call(env, "GET", `/api/providers/jobs/${submitted.id}/artifacts`);
  assert.equal(artifactsRes.status, 200);
  const discovered = await artifactsRes.json();
  assert.equal(discovered.evidence_status, "unvalidated");
  assert.deepEqual(discovered.artifacts.map((item) => item.id), [jobs.contents[0].id],
    "OFFLINE/MOCK: queued MOCK dataset must not be exposed as an artifact");
  assert.match(discovered.notice, /validation and evidence gate/);

  // 7. OFFLINE/MOCK agent claim: the M6 gate only accepts results from a claimed job.
  const pollRes = await call(env, "GET", "/api/ai/jobs?agentId=m7-2-offline-agent", undefined, {
    "X-Agent-Token": "m7-2-offline-agent-token"
  });
  assert.equal(pollRes.status, 200);
  const polled = await pollRes.json();
  assert.equal(polled.execution_mode, "mock");
  assert.equal(polled.jobs.some((item) => item.id === aiJobId), true);

  // 8. OFFLINE/MOCK result submission through the real M6 validation gate.
  const validationJson = JSON.stringify({ total_records: 2, valid_records: 2, invalid_records: 0 });
  const statisticsJson = JSON.stringify({ summary: { gc_percent: 50 }, per_record: [] });
  const resultArtifacts = [
    await mockArtifact("validation.json", "json", validationJson),
    await mockArtifact("statistics.json", "json", statisticsJson)
  ];
  const ledgerReference = {
    key: "smartbio_gc_definition",
    title: "Smart Bioinformatics Toolkit: DNA GC percentage definition",
    url: "python-engine/src/smartbio/statistics.py#calculate_statistics",
    verified: true
  };
  // OFFLINE/MOCK evidence bound: forged citation metadata is rejected by the ledger.
  assert.equal(validateExplanationReferences([{ ...ledgerReference, title: "FORGED", extra: "x" }]).valid, false);
  assert.equal(validateExplanationReferences([ledgerReference]).valid, true);

  const submittedAt = new Date().toISOString();
  const result = {
    job_id: aiJobId,
    status: "succeeded",
    execution_mode: "mock",
    artifacts: resultArtifacts,
    provenance: {
      run_id: aiJobId,
      step_id: "step_1",
      tool: { id: TOOL.id, version: TOOL.version, backend: "local-python" },
      input: { dataset_id: created.dataset_id, sha256: await hashInput(FASTA), filename: "m7-2-mock.fasta" },
      parameters: { sequence_type: "dna" },
      database: { name: null, release: null, retrieved_at: null },
      output: { artifact_names: resultArtifacts.map((item) => item.name), sha256: await hashInput("m7-2-mock-output") },
      timing: { started_at: submittedAt, finished_at: submittedAt },
      execution_mode: "mock"
    },
    validation: { status: "pass", flags: ["gc_percent_out_of_range"], checked_rules: ["schema", "gc_percent"] },
    explanation: {
      summary: "OFFLINE/MOCK synthetic profile; no scientific conclusion.",
      findings: [{ text: "OFFLINE/MOCK GC statistic from a synthetic artifact", artifact: "statistics.json", field_path: "summary.gc_percent" }],
      limitations: ["OFFLINE/MOCK: synthetic data, not a scientific result."],
      references: [ledgerReference],
      uncertainty: "moderate"
    },
    logs: ["OFFLINE/MOCK: no tool executed."]
  };
  const resultRes = await call(env, "POST", `/api/ai/jobs/${aiJobId}/result`, result, {
    "X-Agent-Token": "m7-2-offline-agent-token"
  });
  assert.equal(resultRes.status, 200, `OFFLINE M6 gate failed: ${await resultRes.clone().text()}`);
  const resultBody = await resultRes.json();
  assert.equal(resultBody.status, "succeeded");
  assert.equal(resultBody.execution_mode, "mock");

  // 9. OFFLINE/MOCK run DTO: provenance, locality receipt and evidence-bounded explanation.
  const runRes = await call(env, "GET", `/api/ai/runs/${aiJobId}`);
  assert.equal(runRes.status, 200);
  const run = await runRes.json();
  assert.equal(run.execution_mode, "mock");
  assert.equal(run.validation.status, "warn", "OFFLINE/MOCK: mock mode downgrades pass to warn");
  assert.equal(run.validation.flags.some((flag) => /mock mode/i.test(flag)), true);
  assert.deepEqual(run.artifacts.map((item) => item.name).sort(), ["statistics.json", "validation.json"]);
  assert.equal(run.locality_receipt.mode, "mock");
  assert.equal(run.locality_receipt.no_external_egress, true);
  assert.deepEqual(run.locality_receipt.external_transmissions, []);
  assert.equal(run.locality_receipt.local_operations[0].name, "sequence-stats.profile");
  assert.equal(run.locality_receipt.local_operations[0].backend, "local-python");
  assert.equal(run.locality_receipt.consent_records.some((ref) => ref.startsWith("apr_")), true);
  assert.equal(run.education.notes.length >= 1, true);
  assert.equal(run.education.notes.some((note) => note.verified_reference === "smartbio_gc_definition"), true);
  assert.deepEqual(run.explanation.references[0], ledgerReference,
    "OFFLINE/MOCK: citation must be the exact ledger projection, not a caller copy");

  const provenanceRes = await call(env, "GET", `/api/ai/runs/${aiJobId}/provenance`);
  assert.equal(provenanceRes.status, 200);
  const provenance = await provenanceRes.json();
  assert.equal(provenance.execution_mode, "mock");
  assert.equal(provenance.tool.id, "sequence-stats.profile");
  assert.equal(provenance.input.dataset_id, created.dataset_id);
  assert.equal(provenance.locality_receipt.no_external_egress, true,
    "OFFLINE/MOCK: Worker-derived receipt, never copied from the submitted payload");

  // 10. OFFLINE/MOCK report content: honest labels, bounded claims, no scripts.
  const reportRes = await call(env, "GET", `/api/ai/runs/${aiJobId}/report`);
  assert.equal(reportRes.status, 200);
  const html = await reportRes.text();
  assert.match(html, /Execution mode: mock/);
  // NOTE (reported separately): report.js renders `job.id` (the integer D1 row
  // id) rather than `public_id`, so the public job id is absent from the HTML.
  // This OFFLINE check asserts the plan id, which is rendered correctly.
  assert.equal(html.includes(created.plan_id), true);
  assert.match(html, /Data locality/);
  assert.match(html, /No external transmissions/);
  assert.match(html, /OFFLINE\/MOCK GC statistic/);
  assert.match(html, /smartbio_gc_definition/);
  assert.match(html, /Verified/);
  assert.match(html, /Research use only/);
  assert.equal(html.includes("<script"), false);
  assert.match(reportRes.headers.get("Content-Security-Policy"), /default-src 'none'/);

  // 11. OFFLINE/MOCK private upload -> signed download ticket -> streamed download.
  const reportBytes = "M7.2 OFFLINE/MOCK REPORT BYTES - not a scientific result\n";
  const sha256 = await hashInput(reportBytes);
  const uploadTicketRes = await call(env, "POST", "/api/artifacts/upload-url", {
    dataset_id: created.dataset_id, filename: "m7-2-mock-report.txt",
    size_bytes: new TextEncoder().encode(reportBytes).length, sha256, mime: "text/plain"
  });
  assert.equal(uploadTicketRes.status, 201, `OFFLINE upload ticket failed: ${await uploadTicketRes.clone().text()}`);
  const uploadTicket = await uploadTicketRes.json();
  assert.equal(uploadTicket.execution_mode, "mock");
  assert.match(uploadTicket.upload_url, /^\/api\/artifacts\/upload\?ticket=/);

  const uploadRes = await callRaw(env, "PUT", uploadTicket.upload_url, reportBytes, { "Content-Type": "text/plain" });
  assert.equal(uploadRes.status, 201, `OFFLINE upload failed: ${await uploadRes.clone().text()}`);
  const stored = (await uploadRes.json()).artifact;
  assert.equal(stored.sha256, sha256);
  assert.equal(stored.status, "stored");

  const downloadRes = await call(env, "GET", `/api/artifacts/${stored.id}/download-url`, undefined, {
    "X-Agent-Token": "m7-2-offline-agent-token"
  });
  assert.equal(downloadRes.status, 200, `OFFLINE download ticket failed: ${await downloadRes.clone().text()}`);
  const download = await downloadRes.json();
  assert.match(download.download_url, /^\/api\/artifacts\/content\?ticket=/);
  const contentRes = await callRaw(env, "GET", download.download_url);
  assert.equal(contentRes.status, 200);
  assert.equal(await contentRes.text(), reportBytes);
  assert.equal(contentRes.headers.get("X-Artifact-SHA256"), sha256);

  // OFFLINE/MOCK isolation: every provider call went to the injected .invalid URL.
  assert.equal(calls.length > 0, true);
  assert.equal(calls.every((entry) => entry.url.startsWith(env.GALAXY_BASE_URL)), true,
    "OFFLINE/MOCK: no call may leave the injected fake Galaxy URL");
});
