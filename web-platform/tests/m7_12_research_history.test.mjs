// M7.12 OFFLINE TESTS — labelled FIXTURES only.
// Server rows below are genuine-SHAPED test fixtures derived from an observed
// M7.11 run structure, never presented as a fresh scientific result. No test
// submits to NCBI, Galaxy or IQ-TREE; every fetch is stubbed in memory.
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

import { handleGetRecovery } from "../functions/api/ai/runs/[id]/recovery.js";
import { createFakeD1AI, mockAIEnv } from "./helpers/fake-d1.mjs";
import { createFetch, handlers } from "../worker.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const HISTORY_PAGE = "file://" + resolve(HERE, "../public/history.html").replace(/\\/g, "/");
const PHYLO_PAGE = "file://" + resolve(HERE, "../public/phylo.html").replace(/\\/g, "/");
const SIXTEEN_PAGE = "file://" + resolve(HERE, "../public/16s.html").replace(/\\/g, "/");
const STORAGE_KEY = "sbio.research-history.v1";

const RUN_ID = "job_492333f6d7ef364e";
const PLAN_ID = "plan_c46f4b3598b7142d";
const WORKSPACE_RUN_ID = "run_c528c8dae9e955f3";
const HISTORY_ID = "11ac94870d0bb33adfdcc31d5164dd84";
const PROVIDER_JOB_ID = "4838ba20a6d8676526e1c47a033d95de";
const MAFFT_ID = "toolshed.g2.bx.psu.edu/repos/rnateam/mafft/rbc_mafft/7.526+galaxy2";
const IQTREE_ID = "toolshed.g2.bx.psu.edu/repos/iuc/iqtree/iqtree/3.1.4+galaxy1";
const CREATED_AT = "2026-11-26T12:00:00.000Z";
const FINISHED_AT = "2026-11-26T12:05:00.000Z";

// FIXTURE alignment: five Francisella NR_ accession headers (first token is
// the identifier). Sequence bodies are short test strings, not real data.
const ALIGNMENT = [
  ">NR_115348.1 Francisella tularensis subsp. holarctica OSU18", "ACGTACGTAC",
  ">NR_074666.1 Francisella tularensis subsp. tularensis SCHU S4", "ACGTACGTTC",
  ">NR_074665.1 Francisella novicida U112", "ACGTTCGTAC",
  ">NR_043278.1 Francisella philomiragia noatunensis", "ACGTTCGTTC",
  ">NR_029362.1 Francisella tularensis subsp. holarctica LVS", "ACGTAAGTAC"
].join("\n");
// FIXTURE final ML Newick, byte-identical to the report's "Tree in newick
// format:" line and to the MaxLikelihood artifact content.
const FINAL_TREE = "((NR_115348.1:0.0000010000,((NR_074665.1:0.0000010000,NR_043278.1:0.0027516787):0.0006632395,NR_029362.1:0.0059322341):0.0006735191,NR_074666.1:0.0000010000));";
// FIXTURE BIONJ starting tree — must be labelled, never displayed as final.
const STARTING_TREE = "((NR_115348.1:0.0000010000,NR_074666.1:0.0000010000),(NR_074665.1:0.0000010000,NR_043278.1:0.0000010000),NR_029362.1:0.0000010000);";
const REPORT = [
  "Model selection done by AIC.",
  "Best-fit model according to AIC: TPM3u+F+I",
  "",
  "Model             LogL         AIC          BIC",
  "TPM3u+F+I      -2197.6120     4411.224     4430.118",
  "",
  "Tree in newick format:",
  "",
  FINAL_TREE,
  "NOTE: Tree is UNROOTED although outgroup taxon 'NR_115348.1' is drawn at root",
  "UFboot: 1000 replicates; SH-aLRT: 1000 replicates"
].join("\n");

function sha256(text) {
  return createHash("sha256").update(text, "utf8").digest("hex");
}
function bytes(text) {
  return Buffer.byteLength(text, "utf8");
}

function artifactRows() {
  return [
    { public_id: "art_0000000000000001", run_id: RUN_ID, name: "mafft_alignment.fasta", kind: "alignment",
      storage_ref: null, sha256: sha256(ALIGNMENT), bytes: bytes(ALIGNMENT), mime: "text/plain", content: ALIGNMENT, created_at: CREATED_AT },
    { public_id: "art_0000000000000002", run_id: RUN_ID, name: "iqtree_report.iqtree", kind: "report",
      storage_ref: null, sha256: sha256(REPORT), bytes: bytes(REPORT), mime: "text/plain", content: REPORT, created_at: CREATED_AT },
    { public_id: "art_0000000000000003", run_id: RUN_ID, name: "MaxLikelihood.treefile", kind: "tree",
      storage_ref: null, sha256: sha256(FINAL_TREE), bytes: bytes(FINAL_TREE), mime: "text/plain", content: FINAL_TREE, created_at: CREATED_AT },
    { public_id: "art_0000000000000004", run_id: RUN_ID, name: "BIONJ starting tree.nhx", kind: "tree",
      storage_ref: null, sha256: sha256(STARTING_TREE), bytes: bytes(STARTING_TREE), mime: "text/plain", content: STARTING_TREE, created_at: CREATED_AT }
  ];
}

function jobRows() {
  const stepIds = ["upload_input", "galaxy_mafft", "galaxy_iqtree", "retrieve_outputs",
    "validate_alignment", "validate_tree", "generate_report"];
  return stepIds.map((stepId, index) => ({
    public_id: `job_${(index + 1).toString(16).padStart(16, "0")}`,
    plan_id: PLAN_ID, step_id: stepId, status: "succeeded",
    tool_id: index === 1 ? MAFFT_ID : index === 2 ? IQTREE_ID : "phylogenetics.internal",
    params_json: JSON.stringify({ step: stepId }), inputs_json: JSON.stringify({ dataset_id: "ds_0000000000000001" }),
    consent_json: JSON.stringify({ granted: true, scope: "galaxy" }), backend: "galaxy",
    agent_id: "agent-fixture", attempts: 1, timeout_s: 300, execution_mode: "real",
    created_at: CREATED_AT, started_at: CREATED_AT, finished_at: FINISHED_AT,
    // FIXTURE provider ids, not live Galaxy identifiers.
    result_json: JSON.stringify({ provider_job_id: index === 0 ? PROVIDER_JOB_ID
      : `4838ba20a6d86765${(index + 26).toString(16).padStart(16, "0")}`, history_id: HISTORY_ID }),
    validation_json: null, explanation_json: null, provenance_json: null, report_json: null
  })).map((row, index) => index === 0 ? { ...row, public_id: RUN_ID } : row);
}

function storedRunFixture({ withArtifacts = true, plan = true } = {}) {
  const initial = {
    plans: plan ? [{ public_id: PLAN_ID, request_id: "req_0000000000000001", version: 1,
      plan_json: JSON.stringify({ goal: "Infer relationships among five Francisella 16S sequences", steps: [
        { id: "step_1", tool_id: MAFFT_ID, order: 1 }, { id: "step_2", tool_id: IQTREE_ID, order: 2 }
      ] }), created_at: CREATED_AT }] : [],
    jobs: jobRows(),
    artifacts: withArtifacts ? artifactRows() : []
  };
  const { db, state } = createFakeD1AI(initial);
  return { db, state, env: mockAIEnv(db) };
}

function recoveryFixture({ checksum = null, status = "succeeded" } = {}) {
  const artifacts = [
    { name: "mafft_alignment.fasta", kind: "alignment", sha256: checksum ?? sha256(ALIGNMENT),
      bytes: bytes(ALIGNMENT), mime: "text/plain", content: ALIGNMENT, storage_ref: null, derived_kind: "alignment",
      checksum_match: checksum === null },
    { name: "iqtree_report.iqtree", kind: "report", sha256: sha256(REPORT), bytes: bytes(REPORT),
      mime: "text/plain", content: REPORT, storage_ref: null, derived_kind: "report", checksum_match: true },
    { name: "MaxLikelihood.treefile", kind: "tree", sha256: sha256(FINAL_TREE), bytes: bytes(FINAL_TREE),
      mime: "text/plain", content: FINAL_TREE, storage_ref: null, derived_kind: "tree", checksum_match: true },
    { name: "BIONJ starting tree.nhx", kind: "tree", sha256: sha256(STARTING_TREE), bytes: bytes(STARTING_TREE),
      mime: "text/plain", content: STARTING_TREE, storage_ref: null, derived_kind: "tree", checksum_match: true }
  ];
  return {
    run_id: RUN_ID, workflow_type: "phylo", status, created_at: CREATED_AT, finished_at: FINISHED_AT,
    execution_mode: "real", validation: null,
    validation_reason: "No stored validation is claimed; metrics were recomputed from original stored artifacts.",
    provenance: [{ step_id: "galaxy_iqtree", status: "succeeded", tool_id: IQTREE_ID }],
    jobs: jobRows().map((row) => ({ id: row.public_id, step_id: row.step_id, status: row.status,
      tool_id: row.tool_id, provider_job_id: JSON.parse(row.result_json).provider_job_id,
      history_id: HISTORY_ID, finished_at: row.finished_at })),
    artifacts,
    phylo: {
      alignment_text: ALIGNMENT, alignment_artifact: { name: artifacts[0].name, sha256: artifacts[0].sha256, bytes: bytes(ALIGNMENT) },
      tree_newick: FINAL_TREE, tree_source: "iqtree_report_final_tree_byte_identical_to_stored_artifact",
      tree_artifact: { name: "MaxLikelihood.treefile", sha256: sha256(FINAL_TREE), bytes: bytes(FINAL_TREE) },
      starting_trees: [{ name: "BIONJ starting tree.nhx", source_role: "starting_tree_not_displayed",
        reason: "BIONJ/starting tree, not the final tree." }],
      iqtree_report: REPORT, iqtree_report_excerpt: REPORT.slice(0, 200),
      report_fields: { model: "TPM3u+F+I", log_likelihood: -2197.612, support: "UFboot: 1000 replicates", support_settings: [], rooting_note: null },
      metrics: { basis: "recomputed_from_original_stored_artifacts",
        alignment: { sequence_count: 5, alignment_length: 10, gap_count: 0, conserved_columns: 1 },
        tree: { tip_count: 5, internal_node_count: 4, rooting: { status: "unrooted-representation", basis: "fixture" } } },
      sequence_identifiers: ["NR_115348.1", "NR_074666.1", "NR_074665.1", "NR_043278.1", "NR_029362.1"],
      sequence_identifier_basis: "first_token_of_stored_alignment_headers"
    }
  };
}

function detailFixture() {
  return {
    run_id: RUN_ID, plan: { goal: "fixture", steps: [] }, jobs: jobRows().map((row) => ({
      id: row.public_id, step_id: row.step_id, status: row.status, tool_id: row.tool_id
    })), artifacts: artifactRows().map((row) => ({ name: row.name, kind: row.kind, sha256: row.sha256, bytes: row.bytes })),
    validation: null, explanation: null, provenance: recoveryFixture().provenance, execution_mode: "real"
  };
}

function historyEntry(overrides = {}) {
  return {
    run_id: RUN_ID, workflow_type: "phylo", status: "completed",
    title: "Phylogenetics — five Francisella accessions",
    sequence_ids: ["NR_115348.1", "NR_074666.1"], created_at: CREATED_AT, completed_at: FINISHED_AT,
    history_id: HISTORY_ID, plan_id: PLAN_ID, workspace_run_id: WORKSPACE_RUN_ID,
    provider_job_ids: [PROVIDER_JOB_ID],
    resume: { provider_job_id: null, iqtree_provider_job_id: null, history_id: HISTORY_ID },
    ...overrides
  };
}

// ------------------------------------------------------------ server tests

test("SERVER: genuine-shaped stored run is recovered as evidence, with recomputed metrics and no stored validation", async () => {
  const { env, state } = storedRunFixture();
  const originalFetch = globalThis.fetch;
  let fetchCalls = 0;
  globalThis.fetch = async () => { fetchCalls += 1; throw new Error("recovery must not call any tool or provider"); };
  try {
    const response = await handleGetRecovery(new Request(`https://test.example/api/ai/runs/${RUN_ID}/recovery`), env, RUN_ID);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.run_id, RUN_ID);
    assert.equal(body.workflow_type, "phylo");
    assert.equal(body.status, "succeeded");
    assert.equal(body.execution_mode, "real");
    assert.equal(body.created_at, CREATED_AT);
    assert.equal(body.finished_at, FINISHED_AT);
    assert.equal(body.jobs.length, 7);
    assert.ok(body.jobs.every((job) => typeof job.status === "string"));
    assert.equal(body.jobs[0].provider_job_id, PROVIDER_JOB_ID);
    assert.equal(body.jobs[0].history_id, HISTORY_ID);
    assert.equal(body.input.objective, "Infer relationships among five Francisella 16S sequences");
    assert.deepEqual(body.input.sequence_identifiers, ["NR_115348.1", "NR_074666.1", "NR_074665.1", "NR_043278.1", "NR_029362.1"]);
    assert.equal(body.params.plan_steps.length, 2);
    assert.equal(body.phylo.alignment_text, ALIGNMENT);
    assert.equal(body.phylo.tree_newick, FINAL_TREE);
    assert.match(body.phylo.tree_source, /byte_identical/);
    assert.equal(body.phylo.iqtree_report, REPORT);
    assert.equal(body.phylo.report_fields.model, "TPM3u+F+I");
    assert.equal(body.phylo.report_fields.log_likelihood, -2197.612);
    assert.equal(body.phylo.metrics.alignment.sequence_count, 5);
    assert.equal(body.phylo.metrics.tree.tip_count, 5);
    assert.equal(body.phylo.metrics.basis, "recomputed_from_original_stored_artifacts");
    assert.equal(body.phylo.starting_trees[0].source_role, "starting_tree_not_displayed");
    assert.notEqual(body.phylo.tree_newick, STARTING_TREE);
    assert.equal(body.validation, null);
    assert.match(body.validation_reason, /no stored validation is claimed/i);
    assert.equal(body.evidence_only, true);
    assert.ok(body.artifacts.every((artifact) => artifact.checksum_match === true));
    assert.equal(fetchCalls, 0, "no external submission or read from the recovery handler");
    assert.ok(state.calls.every((call) => call.kind === "all"), "recovery is read-only");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("SERVER: checksum mismatches, invalid/missing runs and absent fields are reported honestly", async () => {
  const { env, state } = storedRunFixture();
  // FIXTURE tampering only in the in-memory fake; the stored row in production
  // is never modified by this read-only endpoint.
  state.tables.artifacts.find((row) => row.name === "mafft_alignment.fasta").sha256 = "0".repeat(64);
  const response = await handleGetRecovery(new Request(`https://test.example/api/ai/runs/${RUN_ID}/recovery`), env, RUN_ID);
  const body = await response.json();
  assert.equal(body.artifacts.find((artifact) => artifact.name === "mafft_alignment.fasta").checksum_match, false);
  assert.ok(body.unavailable_reasons.some((reason) => /does_not_match/.test(reason)));

  const missing = await handleGetRecovery(new Request("https://test.example/api/ai/runs/job_0123456789abcdef/recovery"), env, "job_0123456789abcdef");
  assert.equal(missing.status, 404);
  const invalid = await handleGetRecovery(new Request("https://test.example/api/ai/runs/nope/recovery"), env, "nope");
  assert.equal(invalid.status, 400);

  const empty = storedRunFixture({ withArtifacts: false, plan: false });
  const emptyResponse = await handleGetRecovery(new Request(`https://test.example/api/ai/runs/${RUN_ID}/recovery`), empty.env, RUN_ID);
  const emptyBody = await emptyResponse.json();
  // Tool ids in the genuine-shaped jobs still identify the workflow honestly.
  assert.equal(emptyBody.workflow_type, "phylo");
  assert.equal(emptyBody.phylo.alignment_text, null);
  assert.equal(emptyBody.phylo.tree_newick, null);
  assert.deepEqual(emptyBody.phylo.sequence_identifiers, []);
  assert.equal(emptyBody.validation, null);
  assert.ok(emptyBody.unavailable_reasons.some((reason) => /No stored artifact could be classified as an alignment/.test(reason)));
  assert.ok(emptyBody.unavailable_reasons.some((reason) => /No stored plan row/.test(reason)));

  // With no plan and no recognisable tool ids, the type is honestly "unknown".
  empty.state.tables.jobs.forEach((row) => { row.tool_id = "platform.generic"; });
  const unknownResponse = await handleGetRecovery(new Request(`https://test.example/api/ai/runs/${RUN_ID}/recovery`), empty.env, RUN_ID);
  assert.equal((await unknownResponse.json()).workflow_type, "unknown");
});

test("SERVER: worker routes /recovery before the generic run route", async () => {
  const seen = [];
  const stubbed = {};
  for (const key of Object.keys(handlers)) {
    stubbed[key] = async (context) => {
      seen.push({ key, params: context.params });
      return new Response("{}", { status: 200, headers: { "Content-Type": "application/json" } });
    };
  }
  const workerFetch = createFetch(stubbed);
  const response = await workerFetch(
    new Request("https://worker.example.test/api/ai/runs/job_0123456789abcdef/recovery"),
    { ASSETS: { fetch: () => { throw new Error("API path must not fall through"); } } }, {});
  assert.equal(response.status, 200);
  assert.equal(seen.length, 1);
  assert.equal(seen[0].key, "aiRunRecovery");
  assert.deepEqual(seen[0].params, { id: "job_0123456789abcdef" });
});

// ------------------------------------------------------------ browser tests

let browser;
before(async () => {
  browser = await chromium.launch({ headless: true, args: ["--allow-file-access-from-files"] });
});
after(async () => { await browser?.close(); });

async function openHistory({ seed = [], rawIndex = null, fixtures = {}, viewport = { width: 1280, height: 900 } } = {}) {
  const page = await browser.newPage({ viewport });
  const errors = [];
  page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
  page.on("console", (message) => { if (message.type() === "error") errors.push(`console.error: ${message.text()}`); });
  await page.addInitScript(({ seed, rawIndex, fixtures }) => {
    try {
      if (!sessionStorage.getItem("m712_seeded")) {
        sessionStorage.setItem("m712_seeded", "1");
        if (rawIndex !== null) localStorage.setItem("sbio.research-history.v1", rawIndex);
        else if (seed.length) localStorage.setItem("sbio.research-history.v1", JSON.stringify(seed));
      }
    } catch { /* ignored */ }
    window.__calls = [];
    window.__downloads = [];
    window.__fixtures = fixtures;
    window.confirm = () => true;
    window.fetch = async (input, init = {}) => {
      const url = String(input);
      window.__calls.push({ url, method: String(init.method ?? "GET"), body: typeof init.body === "string" ? init.body : null });
      const fixture = window.__fixtures[url];
      if (!fixture) return new Response(JSON.stringify({ error: "stub_not_found" }), {
        status: 404, headers: { "Content-Type": "application/json" }
      });
      return new Response(JSON.stringify(fixture.body ?? fixture), {
        status: fixture.__httpStatus ?? 200, headers: { "Content-Type": "application/json" }
      });
    };
    URL.createObjectURL = () => "blob:fixture-url";
    URL.revokeObjectURL = () => {};
    HTMLAnchorElement.prototype.click = function () { window.__downloads.push({ download: this.download, href: this.href }); };
  }, { seed, rawIndex, fixtures });
  await page.goto(HISTORY_PAGE);
  return { page, errors };
}

function fixturesFor(run = {}) {
  return {
    detail: { ...detailFixture(), ...run },
    recovery: { ...recoveryFixture(), ...run }
  };
}

async function stubEntryFixtures(entry, fixtures) {
  const map = {};
  const id = encodeURIComponent(entry.run_id);
  map[`/api/ai/runs/${id}`] = fixtures.detail;
  map[`/api/ai/runs/${id}/recovery`] = fixtures.recovery;
  return map;
}

test("BROWSER: index persistence, allow-listed fields, filters and remove with confirmation", async () => {
  const seed = [
    historyEntry(),
    historyEntry({ run_id: "job_0000000000000011", workflow_type: "phylo", status: "running", title: "Phylo running" }),
    historyEntry({ run_id: "job_0000000000000012", workflow_type: "16s", status: "failed", title: "16S failed" }),
    historyEntry({ run_id: "job_0000000000000013", workflow_type: "phylo", status: "awaiting_user_action", title: "Phylo awaiting" })
  ];
  const { page, errors } = await openHistory({ seed });
  assert.match(await page.locator("#history-honest-label").innerText(), /not cross-device owner-account sync/i);
  assert.equal(await page.locator("#history-list .history-entry").count(), 4);
  for (const [filter, expected] of [["all", 4], ["16s", 1], ["phylo", 3], ["running", 1], ["failed", 1], ["completed", 1]]) {
    await page.click(`[data-history-filter="${filter}"]`);
    assert.equal(await page.locator("#history-list .history-entry").count(), expected, filter);
    assert.equal(await page.getAttribute(`[data-history-filter="${filter}"]`, "aria-pressed"), "true");
  }
  // Only allow-listed metadata is persisted; no sequence, key or token is stored.
  const stored = await page.evaluate(() => localStorage.getItem("sbio.research-history.v1"));
  assert.doesNotMatch(stored, /api_key|token|ACGT|maxlength|NR_\d+\.\d+:/);
  assert.match(stored, /sequence_ids/);
  const skipped = await page.evaluate(() => window.__researchHistory.capture16sRun({ job_ids: ["not-a-run-id"] }, {}));
  assert.equal(skipped, null);
  const captured = await page.evaluate(() => window.__researchHistory.capturePhyloRun({
    run_id: "job_00000000000000ff", reopen: { ai_run_id: "job_00000000000000ff" },
    workflow_completed: true, validation: { status: "pass" }, job_ids: { galaxy_iqtree: "abc123" }
  }, { objective: "fixture objective", sequence_ids: ["NR_999999.1 some description"] }));
  assert.equal(captured.status, "completed");
  assert.deepEqual(captured.sequence_ids, ["NR_999999.1"]);
  assert.equal(captured.title.includes("fixture objective"), true);
  await page.reload(); // re-read the browser-local index after the capture
  await page.waitForSelector("#history-list .history-entry");
  await page.click('[data-history-filter="all"]');
  assert.equal(await page.locator("#history-list .history-entry").count(), 5);
  await page.click('[data-action="remove"][data-run-id="job_00000000000000ff"]');
  assert.equal(await page.locator("#history-list .history-entry").count(), 4);
  await page.reload();
  await page.waitForSelector("#history-list .history-entry");
  assert.equal(await page.locator("#history-list .history-entry").count(), 4, "removal persists in localStorage");
  assert.deepEqual(errors, []);
  await page.close();
});

test("BROWSER: completed-run recovery renders genuine jobs, artifacts, alignment, tree and downloads with checksum", async () => {
  const entry = historyEntry();
  const fixtures = fixturesFor();
  const { page, errors } = await openHistory({ seed: [entry], fixtures: await stubEntryFixtures(entry, fixtures) });
  await page.locator("#history-list .history-entry").first().click();
  await page.waitForFunction(() => document.getElementById("history-recovery-status").textContent.includes("recorded status succeeded"));
  assert.match(await page.locator("#history-recovery-status").innerText(), /workflow phylo/);
  assert.equal(await page.locator("#history-jobs li").count(), 7);
  assert.match(await page.locator("#history-artifacts").innerText(), /MaxLikelihood\.treefile/);
  assert.match(await page.locator("#history-artifacts").innerText(), /checksum matches/);
  assert.match(await page.locator("#history-validation").innerText(), /No stored validation is claimed/);
  assert.match(await page.locator("#history-validation").innerText(), /recomputed_from_original_stored_artifacts/);
  assert.match(await page.locator("#history-alignment pre").innerText(), /NR_115348\.1/);
  await page.waitForSelector("#history-tree svg .phylo-tip");
  assert.equal(await page.locator("#history-tree svg .phylo-tip").count(), 5);
  assert.match(await page.locator("#history-tree-note").innerText(), /byte_identical/);
  assert.match(await page.locator("#history-starting-trees").innerText(), /starting_tree_not_displayed/);
  assert.equal(await page.locator("#history-report-link").isVisible(), true);
  assert.match(await page.locator("#history-report-excerpt").innerText(), /Tree in newick format/);
  assert.equal(await page.locator("#history-downloads button").count(), 4);
  await page.locator("#history-downloads button").first().click();
  await page.waitForFunction(() => document.getElementById("history-checksums").textContent.includes("MATCHES"));
  assert.match(await page.locator("#history-checksums").innerText(), /MATCHES the stored artifact checksum/);
  const methods = await page.evaluate(() => window.__calls.map((call) => call.method));
  assert.ok(methods.every((method) => method === "GET"), "recovery is read-only; no POST or job submission");
  assert.equal(await page.evaluate(() => window.__calls.some((call) => /phylo\/run|providers\/.*\/jobs/.test(call.url) && call.method !== "GET")), false);
  assert.equal(await page.locator("#history-continuation a").count(), 0, "completed runs get no resume control");
  assert.deepEqual(errors, []);
  await page.close();
});

test("BROWSER: checksum mismatch is shown, and failed downloads report the actual error", async () => {
  const entry = historyEntry();
  const mismatched = fixturesFor();
  // FIXTURE: tamper the tree artifact checksum used by the first download.
  mismatched.recovery.artifacts[2].checksum_match = false;
  mismatched.recovery.artifacts[2].sha256 = "0".repeat(64);
  const { page } = await openHistory({ seed: [entry], fixtures: await stubEntryFixtures(entry, mismatched) });
  await page.locator("#history-list .history-entry").first().click();
  await page.waitForFunction(() => document.getElementById("history-recovery-status").textContent.includes("recorded status"));
  await page.locator("#history-downloads button").first().click();
  await page.waitForFunction(() => document.getElementById("history-checksums").textContent.includes("DOES NOT MATCH"));
  assert.match(await page.locator("#history-checksums").innerText(), /DOES NOT MATCH the stored artifact checksum/);
  await page.close();

  const failing = await openHistory({ seed: [entry], fixtures: await stubEntryFixtures(entry, fixturesFor()) });
  await failing.page.addInitScript(() => { URL.createObjectURL = () => { throw new Error("blob_unavailable_fixture"); }; });
  await failing.page.reload();
  await failing.page.locator("#history-list .history-entry").first().click();
  await failing.page.waitForFunction(() => document.getElementById("history-recovery-status").textContent.includes("recorded status"));
  await failing.page.locator("#history-downloads button").first().click();
  await failing.page.waitForFunction(() => document.getElementById("history-error").textContent.includes("blob_unavailable_fixture"));
  assert.match(await failing.page.locator("#history-error").innerText(), /Download failed.*blob_unavailable_fixture/);
  await failing.page.close();
});

test("BROWSER: missing/deleted run and malformed index entries fail with honest messages", async () => {
  const entry = historyEntry();
  const { page } = await openHistory({ seed: [entry], fixtures: {} }); // every fetch answers 404
  await page.locator("#history-list .history-entry").first().click();
  await page.waitForFunction(() => document.getElementById("history-recovery-status").textContent.includes("unavailable from the server"));
  assert.match(await page.locator("#history-recovery-status").innerText(), /may have been deleted/);
  assert.match(await page.locator("#history-error").innerText(), /http_404/);
  assert.equal(await page.locator("#history-tree svg").count(), 0);
  assert.equal(await page.locator("#history-alignment pre").count(), 0);
  await page.close();

  const malformed = await openHistory({ rawIndex: "not-json" });
  assert.match(await malformed.page.locator("#history-error").innerText(), /could not be read/);
  assert.equal(await malformed.page.locator("#history-list .history-entry").count(), 0);
  await malformed.page.close();

  const junk = await openHistory({ rawIndex: JSON.stringify([{ run_id: "nope", title: "bad" }]) });
  assert.match(await junk.page.locator("#history-error").innerText(), /malformed and were ignored/);
  assert.equal(await junk.page.locator("#history-list .history-entry").count(), 0);
  await junk.page.close();
});

test("BROWSER: incomplete run shows recorded provider job ids, read-only state and existing resume path", async () => {
  const entry = historyEntry({ status: "running", completed_at: null,
    resume: { provider_job_id: PROVIDER_JOB_ID, iqtree_provider_job_id: null, history_id: HISTORY_ID } });
  const fixtures = fixturesFor({ status: "running" });
  const map = await stubEntryFixtures(entry, fixtures);
  map[`/api/providers/jobs/${PROVIDER_JOB_ID}`] = { status: "queued" };
  const { page, errors } = await openHistory({ seed: [entry], fixtures: map });
  await page.locator("#history-list .history-entry").first().click();
  await page.waitForFunction(() => document.getElementById("history-recovery-status").textContent.includes("recorded status running"));
  assert.match(await page.locator("#history-provider").innerText(), /Recorded provider job ids/);
  assert.match(await page.locator("#history-provider").innerText(), new RegExp(PROVIDER_JOB_ID));
  await page.click("#history-provider button");
  await page.waitForFunction(() => document.getElementById("history-provider").textContent.includes("Running"));
  assert.match(await page.locator("#history-provider").innerText(), /reported state queued — Running/);
  const continuation = await page.getAttribute("#history-continuation a", "href");
  assert.match(continuation, /^phylo\.html\?/);
  assert.match(continuation, new RegExp(`resume_provider_job_id=${PROVIDER_JOB_ID}`));
  assert.match(continuation, /history_id=/);
  assert.match(await page.locator("#history-continuation").innerText(), /no stage is resubmitted automatically/);
  const calls = await page.evaluate(() => window.__calls);
  assert.ok(calls.every((call) => call.method === "GET"), "status refresh is read-only");
  assert.deepEqual(errors, []);
  await page.close();
});

test("BROWSER: mobile layout stays usable and accessible", async () => {
  const { page, errors } = await openHistory({ seed: [historyEntry()], viewport: { width: 390, height: 844 } });
  assert.equal(await page.locator(".nav-toggle").isVisible(), true);
  await page.click(".nav-toggle");
  assert.equal(await page.getAttribute(".nav-toggle", "aria-expanded"), "true");
  assert.equal(await page.locator("#primary-nav a[href='history.html']").isVisible(), true);
  const layout = await page.evaluate(() => {
    const shell = document.querySelector(".history-shell");
    return {
      columns: getComputedStyle(shell).gridTemplateColumns.split(" ").filter(Boolean).length,
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth
    };
  });
  assert.equal(layout.columns, 1, "single-column layout on mobile");
  assert.ok(layout.overflow <= 1, `no horizontal overflow (got ${layout.overflow}px)`);
  assert.equal(await page.locator("#history-filters button").count(), 6);
  assert.deepEqual(errors, []);
  await page.close();
});

test("BROWSER: phylo results never auto-request chat; opt-in uses the assistant endpoint", async () => {
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(() => {
    window.__calls = [];
    window.fetch = async (input, init = {}) => {
      const url = String(input);
      window.__calls.push({ url, method: String(init.method ?? "GET"), body: typeof init.body === "string" ? init.body : null });
      const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
      if (url.includes("/api/assistant/chat")) return json({ reply: "FIXTURE phrasing only." });
      if (url.includes("/api/ai/workflows/phylo/run")) return json({
        run_id: "job_00000000000000aa", plan_id: "plan_0000000000000001",
        reopen: { ai_run_id: "job_00000000000000aa", ai_run_url: "/api/ai/runs/job_00000000000000aa" },
        workflow_completed: true, validation: { status: "pass" }, job_ids: {},
        metrics: { alignment: { sequence_count: 3, conserved_columns: 4 }, tree: { tip_count: 3 } },
        provenance: [], tree_newick: null, alignment_text: null
      });
      return json({ capabilities: { tools: [] } });
    };
  });
  await page.goto(PHYLO_PAGE);
  await page.fill("#phylo-fasta-text", ">a\nACGT\n>b\nACGTA\n>c\nACGT\n");
  await page.click("#phylo-plan");
  await page.waitForFunction(() => document.querySelectorAll("#phylo-plan-steps li").length === 7);
  await page.check("#phylo-approve-check");
  await page.click("#phylo-run");
  await page.waitForSelector("#phylo-results:not([hidden])");
  assert.equal(await page.evaluate(() => window.__calls.some((call) => call.url.includes("/api/providers/chat"))), false);
  assert.equal(await page.evaluate(() => window.__calls.some((call) => call.url.includes("/api/assistant/chat"))), false);
  assert.match(await page.locator("#phylo-interpretation").innerText(), /retrieved alignment|descriptive checks/i);
  await page.click("#phylo-ai-optin");
  await page.waitForFunction(() => !document.getElementById("phylo-ai-phrasing").hidden);
  assert.equal(await page.evaluate(() => window.__calls.filter((call) => call.url.includes("/api/assistant/chat")).length), 1);
  assert.deepEqual(errors, []);
  await page.close();
});

// Integration coverage of the real 16S approval handler. Unit-testing the
// exported capture helper alone cannot catch a stale variable in the handler.
async function open16sWithApproval(jobIds) {
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
  page.on("console", (message) => { if (message.type() === "error") errors.push(`console.error: ${message.text()}`); });
  await page.addInitScript(({ jobIds }) => {
    window.__calls = [];
    try { localStorage.removeItem("sbio.research-history.v1"); } catch { /* ignored */ }
    window.fetch = async (input, init = {}) => {
      const url = String(input);
      window.__calls.push({ url, method: String(init.method ?? "GET") });
      const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
      if (url.includes("/api/assistant/chat")) return json({ reply: "FIXTURE only." });
      if (url.includes("/api/ai/requests")) return json({
        plan_id: "plan_0000000000000002", request_id: "req_0000000000000002", dataset_id: "ds_0000000000000002",
        plan: { intent: "identify_taxa", domain: "microbiome-16s", steps: [
          { id: "step_1", tool_id: "ncbi.blastn", external_egress: true, consent_required: true, params: {}, inputs: [], backend: "remote-python" }
        ] }
      });
      if (url.includes("/api/ai/plans/") && url.includes("/approve")) return json({
        blast_consent: { token: "fixture-consent-token", database: "fixture-db", program: "blastn",
          input_hash: "fixture-hash", expires_at: "2026-11-27T00:00:00.000Z" },
        job_ids: jobIds, execution_mode: "real"
      });
      return json({ error: "stub_not_found" }, 404);
    };
  }, { jobIds });
  await page.goto(SIXTEEN_PAGE);
  return { page, errors };
}

test("BROWSER: the real 16S approval handler stores the genuine job id, and invents none when absent", async () => {
  const runId = "job_00000000000000b1";
  const { page, errors } = await open16sWithApproval([runId]);
  await page.fill("#fasta-text", ">NR_111111.1 first fixture taxon\nACGTACGTAC\n>NR_222222.1 second fixture taxon\nACGTTCGTAC\n");
  await page.click("#create-request");
  await page.waitForSelector("#approval-box:not([hidden])");
  await page.check("#approve-check");
  await page.click("#approve-plan");
  await page.waitForFunction((id) => String(localStorage.getItem("sbio.research-history.v1") ?? "").includes(id), runId);
  const entries = JSON.parse(await page.evaluate(() => localStorage.getItem("sbio.research-history.v1")));
  assert.equal(entries.length, 1);
  assert.equal(entries[0].run_id, runId);
  assert.equal(entries[0].workflow_type, "16s");
  assert.equal(entries[0].status, "awaiting_user_action");
  assert.deepEqual(entries[0].sequence_ids, ["NR_111111.1", "NR_222222.1"]);
  const raw = await page.evaluate(() => localStorage.getItem("sbio.research-history.v1"));
  assert.doesNotMatch(raw, /fixture-consent-token|ACGTACGTAC|ncbi\.blastn/);
  assert.deepEqual(errors, []);
  await page.close();

  const noId = await open16sWithApproval([]);
  await noId.page.fill("#fasta-text", ">NR_333333.1 third fixture taxon\nACGTACGTAC\n");
  await noId.page.click("#create-request");
  await noId.page.waitForSelector("#approval-box:not([hidden])");
  await noId.page.check("#approve-check");
  await noId.page.click("#approve-plan");
  await noId.page.waitForSelector("#consent-view:not([hidden])");
  assert.equal(await noId.page.evaluate(() => localStorage.getItem("sbio.research-history.v1")), null,
    "no run id in the approval response means no index entry is invented");
  assert.deepEqual(noId.errors, []);
  await noId.page.close();
});
