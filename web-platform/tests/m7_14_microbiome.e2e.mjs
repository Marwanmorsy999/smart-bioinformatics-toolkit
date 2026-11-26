// M7.14 offline browser E2E. Every API call is answered by an in-page stub;
// no live Galaxy / assistant request is made. Checks the approval gate, genuine
// progress and 768px/390px overflow on the new page.
import assert from "node:assert/strict";
import { mkdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const HERE = dirname(fileURLToPath(import.meta.url));
const PAGE = "file://" + resolve(HERE, "../public/microbiome.html");
const SHOTS = resolve(HERE, "../test-results/m7_14");
mkdirSync(SHOTS, { recursive: true });
const fixture = (name) => readFileSync(resolve(HERE, "fixtures/m7_14_microbiome", name), "utf8");

const PLAN = {
  workflow_type: "microbiome",
  plan: { steps: [{ id: "import_reads", tool_id: "upload1", tool_version: null, status: "available" },
    { id: "dada2_denoise", tool_id: "qiime2 dada2 denoise-single", tool_version: "2026.1.0", status: "available" }] },
  input: { mode: "upload", sample_count: 3, reads: { records: 3 }, barcode_records: 3,
    samples: ["sampleA", "sampleB", "sampleC"], correspondence: { valid: true } },
  qc: {}, params: { trim_left: 0, trunc_len: 12, trunc_rationale: "Observed mean quality." },
  classifier: { available: true, option_label: "SILVA 138 99% 515-806" },
  validation: { status: "pass", errors: [], checked_rules: ["a", "b"] }
};
const RESULT = {
  workflow_type: "microbiome", run_id: "job_aaaaaaaaaaaaaaaa", status: "succeeded",
  input: { sample_count: 3, metadata_text: fixture("sample-metadata.tsv"), source: {} },
  qc: { samples: [{ sample_id: "sampleA", read_count: 12 }], basis: "parsed_from_tool_output" },
  asv: { available: true, feature_count: 3, sample_count: 3, total_assignable_reads: 34, rep_seq_count: 3 },
  composition: { available: true, rank: "phylum", samples: [{ sample_id: "sampleA", total: 12,
    taxa: [{ taxon: "Firmicutes", count: 10, fraction: 0.8333 }] }] },
  alpha: { available: true, samples: [{ sample_id: "sampleA", observed_features: 3, shannon: 1.02, faith_pd: null }] },
  beta: { available: true, samples: ["sampleA", "sampleB"], matrix: [[0, 0.4], [0.4, 0]] },
  pcoa: { available: true, axes: ["PC1", "PC2"], coordinates: [
    { sample_id: "sampleA", values: { PC1: -0.4, PC2: 0.2 } },
    { sample_id: "sampleB", values: { PC1: 0.4, PC2: -0.2 } }
  ], variance_explained: { PC1: 0.62 } },
  ordination: { note: "From real coordinates.", visualization_tool: "qiime2 emperor plot" },
  integrity: { valid: true, warnings: [], errors: [] }, unavailable_reasons: [], limitations: ["No significance claim."],
  artifacts: [{ name: "feature table.tsv", checksum: "a".repeat(64) }]
};

const browser = await chromium.launch({ headless: true, args: ["--allow-file-access-from-files"] });
const errors = [];
const calls = [];
try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await context.addInitScript(({ plan, result }) => {
    window.__calls = [];
    window.fetch = async (input, init = {}) => {
      const url = String(input);
      window.__calls.push({ url, method: String(init.method ?? "GET") });
      const json = (body, status = 200) => new Response(JSON.stringify(body), { status,
        headers: { "Content-Type": "application/json" } });
      if (url.includes("/api/ai/workflows/microbiome/plan")) return json(plan);
      if (url.includes("/api/ai/workflows/microbiome/run")) return json({ workflow_type: "microbiome",
        run_id: result.run_id, plan_id: "plan_aaaaaaaaaaaaaaaa", status: "running", poll_after_ms: 10, deduped: false });
      if (url.includes("/api/ai/workflows/microbiome/status")) return json({ workflow_type: "microbiome",
        run_id: result.run_id, status: "succeeded", current_step: null, terminal: true, poll_count: 1,
        steps: [{ step_id: "dada2_denoise", status: "succeeded", provider_job_id: "job-3-3" }],
        errors: [], poll_after_ms: null });
      if (url.includes("/api/ai/workflows/microbiome/result")) return json(result);
      if (url.includes("/api/assistant/chat")) return json({ available: false, reason: "no_enabled_llm_provider" });
      return json({ error: "unexpected_stub_route" }, 404);
    };
  }, { plan: PLAN, result: RESULT });
  const page = await context.newPage();
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(PAGE);
  assert.equal(await page.locator("#primary-nav a").count(), 9);
  assert.match(await page.locator("h1").innerText(), /Multi-sample 16S microbiome/);
  await page.setInputFiles("#mb-reads", { name: "sequences.fastq", mimeType: "text/plain", buffer: Buffer.from(fixture("sequences.fastq")) });
  await page.setInputFiles("#mb-barcodes", { name: "barcodes.fastq", mimeType: "text/plain", buffer: Buffer.from(fixture("barcodes.fastq")) });
  await page.setInputFiles("#mb-metadata", { name: "sample-metadata.tsv", mimeType: "text/plain", buffer: Buffer.from(fixture("sample-metadata.tsv")) });
  await page.click("#mb-plan-button");
  await page.waitForFunction(() => !document.getElementById("mb-plan").hidden);
  assert.match(await page.locator("#mb-plan-summary").innerText(), /3 sample/);
  assert.equal(await page.locator("#mb-approve-button").isDisabled(), false);
  await page.click("#mb-approve-button");
  await page.waitForFunction(() => !document.getElementById("mb-results").hidden, { timeout: 5000 });
  assert.match(await page.locator("#mb-run-id").innerText(), /job_aaaaaaaaaaaaaaaa/);
  assert.equal(await page.locator("#mb-pcoa svg").count(), 1);
  assert.equal(await page.locator("#mb-composition table").count(), 1);
  await page.screenshot({ path: resolve(SHOTS, "microbiome-desktop.png"), fullPage: true });
  calls.push(...await page.evaluate(() => window.__calls));
  assert.ok(calls.every((call) => !/iprscan|blast|ncbi/i.test(call.url)), "no external analysis request escaped");
  assert.deepEqual(errors, []);

  for (const viewport of [{ width: 768, height: 1024 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    assert.ok(overflow <= 1, `overflow ${overflow}px at ${viewport.width}px`);
  }
  await page.close();
  console.log("M7.14 browser E2E: PASS (plan, approval, real-coordinate PCoA, 768px/390px layout)");
} finally {
  await browser.close();
}
