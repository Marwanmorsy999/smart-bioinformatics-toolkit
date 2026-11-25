// M7.4 browser E2E â€” workspace UI flow with a stubbed workspace API.
// This verifies navigation/project-to-run-history UX only; it is NOT a
// scientific execution test and uses no Galaxy provider response.
import assert from "node:assert/strict";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
const HERE = dirname(fileURLToPath(import.meta.url));
const repo = resolve(HERE, "..");
const { chromium } = await import("file://" + (repo + "/node_modules/playwright/index.mjs").replace(/\\/g, "/"));
const PAGE = "file://" + (repo + "/public/workspace.html").replace(/\\/g, "/");

const stub = (body) => ({
  status: 200, contentType: "application/json",
  body: JSON.stringify(body)
});
const browser = await chromium.launch({ headless: true, args: ["--allow-file-access-from-files"] });
try {
  const page = await browser.newPage();
  const combined = {
    sample: true, label: "SAMPLE / PRECOMPUTED â€” not a newly executed analysis",
    projects: [{ public_id: "proj_e2e", name: "E2E Project", status: "active" }],
    project: { public_id: "proj_e2e", name: "E2E Project", objective: "test", status: "active" },
    datasets: [],
    workflows: [{ id: "16s-identification", name: "16S rRNA identification", availability: "available", entry_point: "blast.html" }],
    runs: [{ public_id: "run_e2e", workflow_id: "16s-identification", state: "execution_completed" }]
  };
  await page.route("**/api/workspace/**", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(combined) }));  await page.goto(PAGE);
  assert.match(await page.locator("h1").innerText(), /Research workspace/);
  await page.fill("#ws-agent", "test-agent-token");
  await page.click("#ws-load");
  await page.waitForSelector("#ws-project-list button");
  assert.match(await page.locator("#ws-project-list").innerText(), /E2E Project/);
  await page.click("#ws-project-list button");
  await page.click("#ws-project-list button");
  await page.waitForTimeout(500);
  console.log("DEBUG_DETAIL=" + (await page.locator("#ws-detail").innerText()).slice(0, 300));
  await page.waitForSelector("#ws-catalog li");
  assert.match(await page.locator("#ws-catalog").innerText(), /16S rRNA identification/);
  assert.match(await page.locator("#ws-detail").innerText(), /Run history/);
  await page.click("#ws-demo-load");
  await page.waitForFunction(() => (document.getElementById("ws-demo-json")?.textContent ?? "").includes("SAMPLE"), { timeout: 5000 });
  assert.match(await page.locator("#ws-demo-json").innerText(), /SAMPLE/);
  await page.screenshot({ path: resolve(HERE, "../test-results/m7_4_workspace.png"), fullPage: true });
  console.log("M7.4 workspace E2E: PASS (project â†’ catalog â†’ run history â†’ labelled demo)");
} finally { await browser.close(); }




