// M7.15 browser acceptance harness (read-only). No scientific submission.
const { chromium } = require(require("path").join(__dirname, "../../web-platform/node_modules/playwright"));
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const base = "http://127.0.0.1:8740";
const outDir = path.join(__dirname, "evidence");
fs.mkdirSync(outDir, { recursive: true });
const viewports = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "mobile", width: 390, height: 844 }
];
const pages = [
  { name: "homepage", url: "/" },
  { name: "microbiome-run", url: "/microbiome.html?run_id=job_a8817e35d7534d98" },
  { name: "assistant", url: "/assistant.html?run_id=job_a8817e35d7534d98" },
  { name: "workspace", url: "/workspace.html" },
  { name: "history", url: "/history.html" },
  { name: "phylo", url: "/phylo.html" },
  { name: "protein", url: "/protein.html" },
  { name: "16s", url: "/16s.html" }
];
(async () => {
  const browser = await chromium.launch({ headless: true });
  const results = [];
  for (const vp of viewports) {
    for (const pg of pages) {
      const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, acceptDownloads: true });
      const page = await ctx.newPage();
      const consoleErrors = []; const failedRequests = [];
      page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text().slice(0, 200)); });
      page.on("pageerror", (e) => consoleErrors.push("pageerror:" + e.message.slice(0, 200)));
      page.on("requestfailed", (r) => failedRequests.push(r.url().slice(0, 200) + " " + (r.failure()?.errorText ?? "")));
      const resp = await page.goto(base + pg.url, { waitUntil: "networkidle", timeout: 60000 }).catch(() => null);
      await page.waitForTimeout(1200);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
      const h1 = await page.locator("h1").first().innerText().catch(() => null);
      const screenshot = `${pg.name}-${vp.name}.png`;
      await page.screenshot({ path: path.join(outDir, screenshot), fullPage: true });
      results.push({ viewport: vp.name, page: pg.name, http: resp ? resp.status() : null, overflow, h1: h1 ? h1.slice(0, 120) : null, consoleErrors: consoleErrors.slice(0, 6), failedRequests: failedRequests.slice(0, 6), screenshot });
      await ctx.close();
    }
  }
  // Microbiome download checksum (desktop)
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
  const page = await ctx.newPage();
  await page.goto(base + "/microbiome.html?run_id=job_a8817e35d7534d98", { waitUntil: "networkidle", timeout: 60000 });
  await page.waitForTimeout(1500);
  const dl = await Promise.all([
    page.waitForEvent("download", { timeout: 15000 }).catch(() => null),
    page.locator("#mb-downloads button", { hasText: "feature-table.tsv" }).first().click().catch(() => null)
  ]);
  let download = null;
  if (dl[0]) {
    const p = await dl[0].path();
    const buf = fs.readFileSync(p);
    download = { filename: dl[0].suggestedFilename(), bytes: buf.length, sha256: crypto.createHash("sha256").update(buf).digest("hex") };
    await page.screenshot({ path: path.join(outDir, "microbiome-download.png"), fullPage: true });
  }
  await ctx.close();
  await browser.close();
  fs.writeFileSync(path.join(outDir, "results.json"), JSON.stringify({ results, download }, null, 2));
  console.log(JSON.stringify({ pages: results.length, download }, null, 1));
})();
