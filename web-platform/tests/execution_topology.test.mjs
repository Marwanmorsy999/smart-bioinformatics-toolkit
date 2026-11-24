import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import { BACKEND_NOT_CONNECTED_MESSAGE, handleBackendStatus, onRequest } from "../functions/api/ai/backend.js";
import {
  BACKEND_NOT_CONNECTED_MESSAGE as UI_NOT_CONNECTED_MESSAGE,
  ROUTE_AGENT,
  ROUTE_BROWSER,
  browserRecordsCsv,
  browserSummaryText,
  classifyBrowserRequest,
  decideExecution,
  describeBackendStatus,
  executionBadge,
  runBrowserProfile
} from "../public/js/ai-execution.js";
import { validateFasta } from "../public/js/fasta.js";
import { calculateStatistics } from "../public/js/statistics.js";
import { createFakeD1AI, makeGetRequest, mockAIEnv } from "./helpers/fake-d1.mjs";

const NOW = Date.parse("2026-11-25T12:00:00.000Z");
const FASTA = ">seq1 example\nACGTACGTACGT\n>seq2\nTTTTGGGGCCCC\n";
const HERE = dirname(fileURLToPath(import.meta.url));

function statusOverrides(overrides = {}) {
  return {
    execution_mode: "real",
    agent_status: "connected",
    heavy_analyses_available: true,
    last_agent_activity_at: "2026-11-25T11:59:00.000Z",
    agent_observation_basis: "recent job claim",
    ...overrides
  };
}

function envWithClaim({ ageMs = 60_000, status = "running", token = "agent-token" } = {}) {
  const fake = createFakeD1AI({
    jobs: [{
      public_id: "job_0123456789abcdef",
      status,
      agent_id: "local-agent",
      started_at: new Date(NOW - ageMs).toISOString()
    }]
  });
  return { fake, env: mockAIEnv(fake.db, token) };
}

async function getStatus(env, overrides = {}) {
  const response = await handleBackendStatus(makeGetRequest("/api/ai/backend"), env, { now: NOW, ...overrides });
  assert.equal(response.status, 200);
  return response.json();
}

test("backend endpoint reports no agent when no token is configured", async () => {
  const fake = createFakeD1AI();
  const body = await getStatus({ AI_DB: fake.db });
  assert.equal(body.agent_token_configured, false);
  assert.equal(body.agent_status, "not_connected");
  assert.equal(body.heavy_analyses_available, false);
  assert.equal(body.browser_local_available, true);
  assert.equal(body.simulated_results_available, false);
  assert.equal(body.message, BACKEND_NOT_CONNECTED_MESSAGE);
  assert.match(body.agent_observation_basis, /token not configured/);
});

test("backend endpoint requires a recent recorded claim before reporting connected", async () => {
  const connected = await getStatus(envWithClaim().env);
  assert.equal(connected.agent_status, "connected");
  assert.equal(connected.heavy_analyses_available, true);
  assert.equal(connected.last_agent_activity_at, new Date(NOW - 60_000).toISOString());

  const idle = await getStatus(mockAIEnv(createFakeD1AI().db));
  assert.equal(idle.agent_status, "not_connected");
  assert.match(idle.agent_observation_basis, /no agent activity recorded/);

  const stale = await getStatus(envWithClaim({ ageMs: 20 * 60_000 }).env);
  assert.equal(stale.agent_status, "not_connected");
  assert.equal(stale.heavy_analyses_available, false);
});

test("backend endpoint fails closed on missing database, query errors and mock mode", async () => {
  const noDb = await getStatus({ AI_AGENT_TOKEN: "agent-token" });
  assert.equal(noDb.agent_status, "not_connected");
  assert.match(noDb.agent_observation_basis, /configuration only/);

  const brokenDb = { prepare() { throw new Error("D1 unavailable"); } };
  const broken = await getStatus({ AI_DB: brokenDb, AI_AGENT_TOKEN: "agent-token" });
  assert.equal(broken.agent_status, "not_connected");
  assert.equal(broken.last_agent_activity_at, null);

  const mock = await getStatus({ ...envWithClaim().env, AI_EXECUTION_MODE: "mock" });
  assert.equal(mock.agent_status, "not_connected");
  assert.equal(mock.heavy_analyses_available, false);
  assert.match(mock.detail, /mock/);
});

test("backend endpoint only accepts GET and OPTIONS", async () => {
  const options = await onRequest({
    request: new Request("https://example.test/api/ai/backend", { method: "OPTIONS" }),
    env: {}
  });
  assert.equal(options.status, 204);
  const post = await onRequest({
    request: new Request("https://example.test/api/ai/backend", { method: "POST" }),
    env: {}
  });
  assert.equal(post.status, 405);
});

test("browser fast path reuses the existing FASTA and statistics modules", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = () => { throw new Error("browser-local route must not call the network"); };
  let report;
  try {
    report = runBrowserProfile(FASTA, "dna");
  } finally {
    globalThis.fetch = originalFetch;
  }
  const expectedValidation = validateFasta(FASTA, "dna");
  const expectedStats = calculateStatistics(expectedValidation);
  assert.equal(report.execution, ROUTE_BROWSER);
  assert.equal(report.complete, true);
  assert.deepEqual(report.validation, expectedValidation);
  assert.deepEqual(report.stats, expectedStats.summary);
  assert.deepEqual(report.records, expectedStats.records);
  assert.equal(report.stats.total_records, 2);
  assert.equal(report.stats.gc_percent_mean, expectedStats.summary.gc_percent_mean);
  assert.match(browserSummaryText(report), /2\/2 record\(s\) valid/);
  assert.match(browserSummaryText(report), new RegExp(`mean GC ${report.stats.gc_percent_mean}%`));
  assert.match(browserRecordsCsv(report), /id,length,canonical_count/);
});

test("browser route only accepts lightweight intents", () => {
  assert.equal(classifyBrowserRequest("Validate my FASTA and calculate GC content"), "lightweight");
  assert.equal(classifyBrowserRequest("check sequence stats and composition"), "lightweight");
  assert.equal(classifyBrowserRequest("identify taxa from these sequences"), "heavy");
  assert.equal(classifyBrowserRequest("build a phylogenetic tree"), "heavy");
  assert.equal(classifyBrowserRequest("please help with this file"), "unsupported");

  const offline = statusOverrides({ agent_status: "not_connected", heavy_analyses_available: false });
  const browser = decideExecution({ requestText: "profile my FASTA", route: ROUTE_BROWSER, backend: offline });
  assert.equal(browser.action, "browser-profile");
  assert.equal(browser.result, null);
  const heavy = decideExecution({ requestText: "build a tree", route: ROUTE_BROWSER, backend: offline });
  assert.equal(heavy.action, "blocked");
  assert.equal(heavy.result, null);
  assert.match(heavy.message, /local agent/);
});

test("unavailable backend blocks the agent route and never creates a fake result", () => {
  const offline = statusOverrides({ agent_status: "not_connected", heavy_analyses_available: false });
  const decision = decideExecution({ requestText: "validate and profile my FASTA", route: ROUTE_AGENT, backend: offline });
  assert.equal(decision.action, "blocked");
  assert.equal(decision.result, null, "no result object may exist when no backend is available");
  assert.match(decision.message, /Agent not connected/);
  assert.doesNotMatch(decision.message, /simulated result was produced/);

  const described = describeBackendStatus(offline);
  assert.equal(described.connected, false);
  assert.equal(described.message, UI_NOT_CONNECTED_MESSAGE);
  assert.equal(executionBadge(ROUTE_AGENT, described), "Execution: local agent (unavailable)");
  assert.equal(executionBadge(ROUTE_BROWSER, described), "Execution: browser-local");

  const online = describeBackendStatus(statusOverrides());
  assert.equal(online.connected, true);
  assert.equal(executionBadge(ROUTE_AGENT, online), "Execution: local agent");
  assert.equal(decideExecution({ requestText: "phylogenetics", route: ROUTE_AGENT, backend: statusOverrides() }).action, "agent-plan");
  assert.equal(describeBackendStatus(statusOverrides({ execution_mode: "mock" })).connected, false);
});

test("workspace markup exposes route selection, backend status and honest badges", () => {
  const html = readFileSync(resolve(HERE, "../public/ai.html"), "utf8");
  assert.match(html, /id="execution-route"/);
  assert.match(html, /Browser \(local\)/);
  assert.match(html, /id="backend-status"/);
  assert.match(html, /id="backend-detail"/);
  assert.match(html, /id="backend-badge"/);
  assert.match(html, /id="execution-mode"/);
  assert.match(html, /id="sequence-type"/);

  const source = readFileSync(resolve(HERE, "../public/js/ai-workspace.js"), "utf8");
  const branchStart = source.indexOf('if (decision.action === "browser-profile")');
  const branchEnd = source.indexOf("// Agent route:", branchStart);
  assert.ok(branchStart > 0 && branchEnd > branchStart, "browser branch must exist before the agent branch");
  const browserBranch = source.slice(branchStart, branchEnd);
  assert.doesNotMatch(browserBranch, /\/api\/ai\/requests/, "browser route must not call the Worker plan endpoint");
  assert.doesNotMatch(browserBranch, /\bfetch\(/, "browser route must not call any network endpoint");
});
