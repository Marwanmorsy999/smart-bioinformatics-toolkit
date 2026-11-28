// M7.3 real Chromium Playwright E2E (plain node script; uses the `playwright`
// devDependency already present in this project).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { chromium } from "playwright";

const HERE = dirname(fileURLToPath(import.meta.url));
const PAGE = "file://" + resolve(HERE, "../public/phylo.html");
const FASTA = ">A\nACGTACGTACGT\n>B\nACGTACGTTCGT\n>C\nACGTTCGTACGT\n";
const NEWICK = "((A:0.1,B:0.1):0.2,C:0.3);";

// file:// module scripts need this test-only flag; in production the page is
// served by the Worker, where module loading is ordinary same-origin HTTP.
const browser = await chromium.launch({ headless: true, args: ["--allow-file-access-from-files"] });
try {
  const page = await browser.newPage();
  await page.goto(PAGE);
  assert.match(await page.locator("h1").innerText(), /Multi-step phylogenetics/);

  await page.setInputFiles("#phylo-file", { name: "phylo.fasta", mimeType: "text/plain", buffer: Buffer.from(FASTA) });
  await page.fill("#phylo-objective", "Infer relationships among these sequences");
  await page.click("#phylo-plan");
  await page.waitForFunction(() => document.querySelectorAll("#phylo-plan-steps li").length === 7, { timeout: 5000 });

  assert.equal(await page.locator("#phylo-plan-steps li").count(), 7);
  assert.equal(await page.locator("#phylo-run").isDisabled(), true);
  await page.check("#phylo-approve-check");
  assert.equal(await page.locator("#phylo-run").isEnabled(), true);

  // Browser tree rendering of real Newick text.
  await page.evaluate((nwk) => window.__phylo.renderTree(nwk, document.getElementById("phylo-tree")), NEWICK);
  assert.equal(await page.locator("#phylo-tree svg").count(), 1);
  for (const tip of ["A", "B", "C"]) {
    assert.equal(await page.locator("#phylo-tree svg text", { hasText: tip }).count(), 1);
  }
  await page.screenshot({ path: resolve(HERE, "../test-results/m7_3_phylo_page.png"), fullPage: true });
  console.log("M7.3 browser E2E: PASS (upload, plan, approval, tree SVG, screenshot)");
} finally {
  await browser.close();
}
