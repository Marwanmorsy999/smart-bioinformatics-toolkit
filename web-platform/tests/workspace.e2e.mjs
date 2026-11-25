// M7.4 real-Chromium E2E for the unified research workspace (plain Playwright).
//
// Demonstrates: local page load -> create local project -> open it -> register
// dataset metadata -> create a planned run from the catalog -> run history row
// -> run detail with distinct execution / artifact / validation statuses ->
// clearly labelled sample project -> screenshot. No scientific execution, no
// provider call and no operator token are used anywhere in this test.
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const HERE = dirname(fileURLToPath(import.meta.url));
const PAGE = "file://" + resolve(HERE, "../public/workspace.html").replace(/\\/g, "/");
const SHOT = resolve(HERE, "../test-results/m7_4_workspace.png");
mkdirSync(dirname(SHOT), { recursive: true });

// file:// module scripts and localStorage need this test-only Chromium flag;
// in production the Worker serves ordinary same-origin HTTP.
const browser = await chromium.launch({ headless: true, args: ["--allow-file-access-from-files"] });
try {
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(`console.error: ${message.text()}`);
  });

  await page.goto(PAGE);
  // Start from a known local session; Chromium allows file:// localStorage
  // with the launch flag above. If a profile blocks it, the app falls back to
  // in-memory state and this clear is harmless.
  await page.evaluate(() => { try { localStorage.clear(); } catch { /* ignored */ } });
  await page.reload();
  await page.waitForSelector("#ws-project-list li");
  assert.match(await page.locator("h1").innerText(), /Research workspace/);
  assert.match(await page.locator("#ws-mode-banner").innerText(),
    /Local browser session — not persisted to the server; no server-side ownership applies/);
  assert.match(await page.locator("#ws-mode-label").innerText(), /Current mode: local browser session/);
  assert.equal(await page.locator('#ws-operator[open]').count(), 0, "operator access must start collapsed");

  // 1. create a local project
  await page.fill("#ws-project-name", "E2E local project");
  await page.fill("#ws-project-description", "Metadata-only project for the workspace E2E");
  await page.fill("#ws-project-objective", "Show project -> workflow -> run history");
  await page.click("#ws-project-create");
  await page.waitForSelector("#ws-project-list button");
  assert.match(await page.locator("#ws-project-list").innerText(), /E2E local project/);

  // 2. open the project explicitly
  await page.locator("#ws-project-list button", { hasText: "E2E local project" }).click();
  await page.waitForSelector("#ws-detail:not([hidden])");
  assert.match(await page.locator("#ws-detail-title").innerText(), /E2E local project/);
  assert.match(await page.locator("#ws-detail-meta").innerText(), /Scientific objective/);
  assert.match(await page.locator("#ws-overview").innerText(), /Dataset metadata: 0/);
  assert.match(await page.locator("#ws-overview-workflows").innerText(), /Available workflows:/);

  // 3. register dataset metadata (no bytes)
  await page.fill("#ws-dataset-filename", "panel.fasta");
  await page.fill("#ws-dataset-size", "1234");
  await page.fill("#ws-dataset-sha256", "a".repeat(64));
  await page.fill("#ws-dataset-format", "fasta");
  await page.fill("#ws-dataset-source", "local-e2e-fixture");
  await page.selectOption("#ws-dataset-validation", "unvalidated");
  await page.click("#ws-dataset-register");
  await page.waitForFunction(() =>
    document.getElementById("ws-datasets").textContent.includes("panel.fasta"));
  assert.match(await page.locator("#ws-detail").innerText(), /no file bytes are stored/i);

  // 4. catalog is the reconciled two-entry catalog and is honest about phylo
  assert.equal(await page.locator("#ws-catalog > li").count(), 2);
  const catalogText = await page.locator("#ws-catalog").innerText();
  assert.match(catalogText, /16S rRNA identification/);
  assert.match(catalogText, /available-browser-and-local-agent/);
  assert.match(catalogText, /partial-not-production-ready/);
  assert.match(catalogText, /NOT verified/);

  // 5. launch a workflow -> a planned run row, never an execution
  await page.locator('#ws-catalog button[data-workflow="16s-rrna-identification"]').click();
  await page.waitForFunction(() => document.querySelectorAll("#ws-runs tr").length >= 1);
  assert.match(await page.locator("#ws-runs").innerText(), /16S rRNA identification/);
  assert.match(await page.locator("#ws-runs").innerText(), /planned/);
  assert.match(await page.locator("#ws-runs").innerText(), /local-browser-session/);

  // 6. run detail keeps execution, artifact retrieval and validation separate
  await page.locator("#ws-runs button").first().click();
  await page.waitForSelector("#ws-run-detail:not([hidden])");
  const pairs = await page.$$eval("#ws-run-fields dt", (labels) =>
    labels.map((label) => [label.textContent ?? "", label.nextElementSibling?.textContent ?? ""]));
  const detail = Object.fromEntries(pairs);
  assert.match(detail["Execution status"], /planned/);
  assert.match(detail["Execution status"], /full_workflow_completed/);
  assert.equal(detail["Artifact retrieval status"], "not available");
  assert.equal(detail["Validation status"], "unvalidated");
  assert.notEqual(detail["Execution status"], detail["Artifact retrieval status"]);
  assert.notEqual(detail["Artifact retrieval status"], detail["Validation status"]);
  assert.match(detail["Report access"], /not available/);
  assert.match(detail["Tool versions"], /not available/);

  // 7. local storage holds metadata only — never a token or file bytes
  const stored = await page.evaluate(() => localStorage.getItem("m74_workspace_local_v1"));
  assert.ok(stored, "local metadata key should be present in Chromium file:// storage");
  assert.doesNotMatch(stored, /X-Agent-Token|token/i);
  assert.doesNotMatch(stored, /ACGT|fasta-text/i);

  // 8. sample project is visibly precomputed, never a new analysis
  await page.click("#ws-demo-load");
  await page.waitForSelector("#ws-demo-view:not([hidden])");
  assert.match(await page.locator("#ws-demo-content").innerText(), /SAMPLE \/ PRECOMPUTED/);
  assert.match(await page.locator("#ws-demo-runs").innerText(), /SAMPLE \/ PRECOMPUTED/);
  assert.match(await page.locator("#ws-demo-disclaimer").innerText(), /NOT a newly executed analysis/);

  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: SHOT, fullPage: true });
  assert.deepEqual(errors, [], `unexpected browser errors: ${errors.join(" | ")}`);
  console.log(`M7.4 workspace E2E: PASS (local project -> dataset -> planned run -> distinct statuses -> labelled sample; screenshot: ${SHOT})`);
} finally {
  await browser.close();
}
