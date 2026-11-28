// 16S workflow browser E2E — OFFLINE FIXTURES ONLY.
//
// Every network response below is an explicitly labelled fixture. The RID uses
// the MOCK prefix and the TSV carries the MOCK DATA marker, so the UI must
// label the result synthetic. No NCBI call is made. A separate live path is
// skipped unless LIVE_NCBI=1 and STAGING_URL are explicitly supplied by the
// owner; mock and live statuses are never merged.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { mkdirSync } from "node:fs";
import { dirname, extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { after, before, test } from "node:test";
import { chromium } from "playwright";

import { buildPlan } from "../functions/api/ai/planner.js";
import { ALLOWED_DATABASE, ALLOWED_PROGRAM } from "../functions/api/blast/_lib.js";
import { listCatalog, TOOL_CATALOG_VERSION } from "../providers/tools/registry.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const PUBLIC = resolve(HERE, "../public");
const SHOTS = resolve(HERE, "../test-results/core");
mkdirSync(SHOTS, { recursive: true });

const DESKTOP = { width: 1440, height: 900 };
const MOBILE = { width: 390, height: 844 };
const MIME = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml"
};

// -------- explicitly labelled offline fixtures (never presented as real) ----
const OFFLINE_PLAN = buildPlan({
  text: "Identify taxa from these 16S sequences using BLASTN",
  datasetId: "ds_0123456789abcdef",
  requestId: "req_0123456789abcdef",
  now: Date.parse("2026-11-25T12:00:00.000Z")
}).plan;
OFFLINE_PLAN.plan_id = "plan_0123456789abcdef";

const REQUEST_FIXTURE = {
  request_id: "req_0123456789abcdef",
  plan_id: OFFLINE_PLAN.plan_id,
  plan: OFFLINE_PLAN,
  dataset_id: "ds_0123456789abcdef",
  preflight: { valid: true },
  execution_mode: "real",
  fixture: "OFFLINE_FIXTURE_NOT_A_REAL_API_RESPONSE"
};
const APPROVE_FIXTURE = {
  job_ids: ["job_0123456789abcdef"],
  skipped: [],
  execution_mode: "real",
  blast_consent: {
    token: "OFFLINE_FIXTURE_TOKEN", // deliberately not displayed by the UI
    input_hash: "a".repeat(64),
    database: ALLOWED_DATABASE,
    program: ALLOWED_PROGRAM,
    expires_at: "2026-11-25T12:15:00.000Z"
  },
  fixture: "OFFLINE_FIXTURE_NOT_A_REAL_API_RESPONSE"
};
const SUBMIT_FIXTURE = {
  rid: "MOCKOFFLINEFIXTURE", // MOCK prefix forces the synthetic label
  status: "queued",
  fixture: "OFFLINE_FIXTURE_NOT_A_REAL_API_RESPONSE"
};
const STATUS_FIXTURE = { status: "complete", fixture: "OFFLINE_FIXTURE_NOT_A_REAL_API_RESPONSE" };
const RESULTS_FIXTURE = [
  "# OFFLINE FIXTURE / MOCK DATA - synthetic, not from NCBI. Do not use for biological conclusions.",
  "qseqid\tsacc\tstaxids\tsscinames\tpident\tlength\tqstart\tqend\tqlen\tevalue\tbitscore\tqcovs",
  "example_input_1\tMOCK000001\t999999\tSynthetic mock organism\t100.0\t32\t1\t32\t32\t1e-50\t64\t100"
].join("\n") + "\n";
// The UI requests ?format=json to obtain provenance; plain requests still get
// the labelled raw TSV. Both fixtures are synthetic and never presented as real.
const RESULTS_ENVELOPE_FIXTURE = {
  status: "complete",
  state: "complete",
  outcome: "mock",
  terminal: true,
  mock: true,
  tsv: RESULTS_FIXTURE,
  table: null,
  message: "Synthetic mock data. This is not a real NCBI result.",
  provenance: {
    rid: SUBMIT_FIXTURE.rid,
    database: ALLOWED_DATABASE,
    program: ALLOWED_PROGRAM,
    retrieved_at: "2026-11-25T12:01:00.000Z",
    mock: true,
    parser_schema: "qblast-strict-1",
    rows_received: 3,
    rows_parsed: 1,
    rows_rejected: 0,
    sha256: createHash("sha256").update(RESULTS_FIXTURE).digest("hex"),
    warnings: ["SYNTHETIC MOCK DATA - not from NCBI and not usable for biological conclusions."]
  }
};
const CATALOG_FIXTURE = {
  tools: listCatalog(), // real registry data; read-only
  catalog_version: TOOL_CATALOG_VERSION,
  fixture: "OFFLINE_FIXTURE_READ_ONLY_CATALOG"
};

const fetchAttempts = [];
const browserErrors = [];
let server;
let browser;
let context;
let baseUrl;

before(async () => {
  server = createServer(async (request, response) => {
    const pathname = decodeURIComponent(new URL(request.url, "http://127.0.0.1").pathname);
    const file = resolve(PUBLIC, pathname === "/" ? "index.html" : pathname.slice(1));
    if (!file.startsWith(PUBLIC)) { response.writeHead(403).end(); return; }
    try {
      const body = await readFile(file);
      response.writeHead(200, { "Content-Type": MIME[extname(file)] ?? "text/plain; charset=utf-8" });
      response.end(body);
    } catch {
      response.writeHead(404).end("not found");
    }
  });
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  baseUrl = `http://127.0.0.1:${server.address().port}`;

  browser = await chromium.launch({ headless: true });
  context = await browser.newContext({ viewport: DESKTOP });
  await context.route("**/api/ai/requests", async (route) => {
    fetchAttempts.push(route.request().url());
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(REQUEST_FIXTURE) });
  });
  await context.route("**/api/ai/plans/**/approve", async (route) => {
    fetchAttempts.push(route.request().url());
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(APPROVE_FIXTURE) });
  });
  await context.route("**/api/blast/submit", async (route) => {
    fetchAttempts.push(route.request().url());
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(SUBMIT_FIXTURE) });
  });
  await context.route("**/api/blast/status/**", async (route) => {
    fetchAttempts.push(route.request().url());
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(STATUS_FIXTURE) });
  });
  await context.route("**/api/blast/results/**", async (route) => {
    fetchAttempts.push(route.request().url());
    const wantsJson = new URL(route.request().url()).searchParams.get("format") === "json"
      || /application\/json/i.test(route.request().headers()["accept"] ?? "");
    if (wantsJson) {
      await route.fulfill({
        status: 200, contentType: "application/json", body: JSON.stringify(RESULTS_ENVELOPE_FIXTURE)
      });
    } else {
      await route.fulfill({ status: 200, contentType: "text/plain", body: RESULTS_FIXTURE });
    }
  });
  await context.route("**/api/tools/catalog", async (route) => {
    fetchAttempts.push(route.request().url());
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(CATALOG_FIXTURE) });
  });
  await context.route("**/api/assistant/status", async (route) => {
    fetchAttempts.push(route.request().url());
    // Honest unavailable status: chat stays disabled, nothing is generated.
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({
      available: false, reason: "no_enabled_llm_provider", type: "assistant_provider_unavailable",
      notice: "AI chat is unavailable: no authorized model provider is configured for this deployment.",
      stages: [], fixture: "OFFLINE_FIXTURE_NOT_A_REAL_API_RESPONSE"
    }) });
  });
  await context.route("**/api/assistant/chat", async (route) => {
    fetchAttempts.push(route.request().url());
    // OFFLINE FIXTURE, not a real model response: the optional plan explanation
    // degrades gracefully and never claims generated content. No live provider.
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({
      generated: false, available: false, reason: "offline_fixture",
      reply: "", notice: "Offline fixture: no assistant response was generated.",
      fixture: "OFFLINE_FIXTURE_NOT_A_REAL_API_RESPONSE"
    }) });
  });
});

after(async () => {
  await browser?.close();
  if (server) await new Promise((done) => server.close(done));
});

function watch(page, label) {
  page.on("pageerror", (error) => browserErrors.push(`${label}: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error") browserErrors.push(`${label}: ${message.text()}`);
  });
}

test("(offline fixture) capability browser lists real tools and drafts a deterministic plan", async () => {
  const page = await context.newPage();
  watch(page, "assistant");
  await page.goto(`${baseUrl}/assistant.html`);
  await page.waitForSelector("#tool-catalog-list .tool-card");
  const cards = await page.locator("#tool-catalog-list .tool-card").count();
  assert.equal(cards, CATALOG_FIXTURE.tools.length);
  const text = await page.locator("#capability-browser").innerText();
  assert.match(text, /Capability browser — real registered tools and workflows/);
  assert.match(text, /ncbi\.blastn/);
  assert.match(text, /16S/);
  assert.match(text, /partial/); // phylogenetics is not upgraded
  await page.locator("#capability-browser").scrollIntoViewIfNeeded();
  await page.screenshot({ path: resolve(SHOTS, "assistant-capability-1440x900.png"), animations: "disabled" });

  await page.selectOption("#plan-tool-select", "ncbi.blastn");
  const plan = await page.locator("#plan-output").innerText();
  assert.match(plan, /Deterministic draft for ncbi\.blastn/);
  assert.match(plan, /NCBI BLAST/);
  assert.match(plan, /approval requirement/i);
  assert.equal(await page.locator("#plan-ack").isChecked(), false);
  assert.match(await page.locator("#composer-help").innerText(), /Chat is disabled/);
  await page.locator("#plan-output").scrollIntoViewIfNeeded();
  await page.screenshot({ path: resolve(SHOTS, "assistant-plan-draft-1440x900.png"), animations: "disabled" });

  await page.setViewportSize(MOBILE);
  await page.locator("#capability-browser").scrollIntoViewIfNeeded();
  await page.screenshot({ path: resolve(SHOTS, "assistant-capability-390x844.png"), animations: "disabled" });
  await page.close();
});

test("(offline fixture) full 16S chain ends in a clearly labelled synthetic result", async () => {
  const page = await context.newPage();
  watch(page, "sixteen");
  await page.clock.install();
  await page.goto(`${baseUrl}/16s.html`);
  assert.equal(await page.locator("#create-request").isDisabled(), true);

  await page.click("#load-example");
  await page.click("#validate-fasta");
  const input = await page.locator("#input-info").innerText();
  assert.match(input, /FASTA/);
  assert.match(input, /Records\s*2/);
  assert.match(input, /Sequence lengths/);
  assert.match(input, /SHA-256/);
  assert.match(input, /bytes/);
  assert.equal(await page.locator("#create-request").isEnabled(), true);
  await page.screenshot({ path: resolve(SHOTS, "sixteen-input-1440x900.png"), animations: "disabled" });

  await page.click("#create-request");
  await page.waitForSelector("#plan-view:not([hidden])");
  const plan = await page.locator("#plan-view").innerText();
  assert.match(plan, /ncbi\.blastn/);
  assert.match(plan, /16S_ribosomal_RNA|blastn/);
  assert.match(plan, /External egress\s*yes/);
  assert.match(plan, /not an approval/);
  assert.equal(await page.locator("#approve-plan").isDisabled(), true);
  await page.check("#approve-check");
  assert.equal(await page.locator("#approve-plan").isEnabled(), true);

  await page.click("#approve-plan");
  await page.waitForSelector("#consent-view:not([hidden])");
  const consent = await page.locator("#consent-view").innerText();
  assert.match(consent, /token value intentionally not displayed/i);
  assert.match(consent, /16S_ribosomal_RNA/);
  assert.equal(consent.includes("OFFLINE_FIXTURE_TOKEN"), false, "consent token must not be shown");

  await page.click("#submit-blast");
  await page.waitForSelector("#rid-view:not([hidden])");
  const ridView = await page.locator("#rid-view").innerText();
  assert.match(ridView, /MOCKOFFLINEFIXTURE/);
  assert.match(ridView, /mock prefix/);
  assert.equal(await page.locator("#check-status").isDisabled(), true, "RID poll is gated for 60s");
  assert.match(await page.locator("#status-countdown").innerText(), /Next status check allowed in \d+ s/);

  // Advance the browser clock past the single permitted poll interval. The
  // scheduled poll runs automatically; no tight loop or manual bypass exists.
  await page.clock.fastForward(61 * 1000);
  await page.waitForSelector("#results:not([hidden])");
  const banner = await page.locator("#results-banner").innerText();
  assert.match(banner, /SYNTHETIC \/ MOCK DATA/);
  assert.match(banner, /NOT a real NCBI result/);
  assert.doesNotMatch(banner, /Real tabular result retrieved from NCBI/);
  assert.equal(await page.locator("#check-status").isDisabled(), true, "a completed job must not be polled again");

  assert.equal(await page.locator("#hits-body tr").count(), 1);
  const cells = await page.locator("#hits-body tr td").allInnerTexts();
  assert.ok(cells.includes("MOCK000001"));
  assert.ok(cells.includes("example_input_1"));
  assert.ok(cells.includes("Synthetic mock organism"));
  const taxonomy = await page.locator("#taxonomy-view").innerText();
  assert.match(taxonomy, /Taxonomy consensus and verdict/);
  const provenance = await page.locator("#provenance-view").innerText();
  assert.match(provenance, /MOCKOFFLINEFIXTURE/);
  assert.match(provenance, /SYNTHETIC/);
  assert.equal(await page.locator("#download-tsv").isEnabled(), true);
  assert.equal(await page.locator("#download-json").isEnabled(), true);

  await page.locator("#results-banner").scrollIntoViewIfNeeded();
  await page.screenshot({ path: resolve(SHOTS, "sixteen-results-1440x900.png"), animations: "disabled" });
  await page.setViewportSize(MOBILE);
  await page.locator("#results-banner").scrollIntoViewIfNeeded();
  await page.screenshot({ path: resolve(SHOTS, "sixteen-results-390x844.png"), animations: "disabled" });

  const overflow = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth, innerWidth: window.innerWidth
  }));
  assert.ok(overflow.scrollWidth <= overflow.innerWidth, `mobile overflow ${JSON.stringify(overflow)}`);
  await page.close();
});

test("(offline fixture) no live NCBI endpoint was contacted and no browser error occurred", () => {
  const live = fetchAttempts.filter((url) => !/\/api\//.test(url));
  assert.deepEqual(live, [], `unexpected non-API fetch: ${JSON.stringify(live)}`);
  assert.deepEqual(browserErrors, [], `browser errors: ${JSON.stringify(browserErrors)}`);
});

test("(live path) real NCBI submission is opt-in and was not exercised here", (t) => {
  if (process.env.LIVE_NCBI !== "1" || !process.env.STAGING_URL) {
    t.skip("owner must set LIVE_NCBI=1 and STAGING_URL to authorise a real submission");
    return;
  }
  // This path is intentionally not implemented as part of the offline suite.
  // The owner reviews MOCK_NCBI on staging before allowing a live RID.
  assert.fail("Configure the live path only after the owner authorises real NCBI egress.");
});
