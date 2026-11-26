// M7.11 OFFLINE BROWSER TESTS — fixture-based, labelled, no live provider.
// Every fetch() is stubbed before page scripts run. The run response below is a
// FIXTURE, never presented by the page as a fresh scientific result.
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import { chromium } from "playwright";

const HERE = dirname(fileURLToPath(import.meta.url));
const PAGE = "file://" + resolve(HERE, "../public/phylo.html").replace(/\\/g, "/");
const FASTA = ">taxon_a\nACGTACGTACG\n>taxon_b\nACGTACGTTCG\n>taxon_c\nACGTTCGTACG\n";
const ALIGNMENT = ">taxon_a\nACGT-ACGTACG\n>taxon_b\nACGTACGTTCGT\n>taxon_c\nACGTTCGTACGT\n";
const NEWICK = "(taxon_a:0.1,(taxon_b:0.2,taxon_c:0.3)95/87:0.4);";
const MAFFT_ID = "toolshed.g2.bx.psu.edu/repos/rnateam/mafft/rbc_mafft/7.526+galaxy2";
const IQTREE_ID = "toolshed.g2.bx.psu.edu/repos/iuc/iqtree/iqtree/3.1.4+galaxy1";
const RUN_RESPONSE = Object.freeze({
  run_id: "run_0000000000000001", plan_id: "plan_0000000000000001", input_sha256: "a".repeat(64),
  workflow_completed: true,
  validation: { status: "pass", retrieval_errors: [],
    alignment: { valid: true }, tree: { valid: true } },
  job_ids: { galaxy_iqtree: "job_0000000000000003" }, history_id: "11ac94870d0bb33adfdcc31d5164dd84",
  tool_versions: { mafft: "7.526+galaxy2", iqtree: "3.1.4+galaxy1" },
  provenance: [
    { step_id: "upload_input", status: "succeeded", tool_id: "upload1", finished_at: "2026-11-26T12:00:00.000Z" },
    { step_id: "galaxy_mafft", status: "succeeded", tool_id: MAFFT_ID, tool_version: "7.526+galaxy2" },
    { step_id: "galaxy_iqtree", status: "succeeded", tool_id: IQTREE_ID, tool_version: "3.1.4+galaxy1" }
  ],
  tree_newick: NEWICK, alignment_text: ALIGNMENT,
  metrics: {
    alignment: { sequence_count: 3, alignment_length: 12, gap_count: 1, conserved_columns: 4, variable_columns: 8 },
    tree: { tip_count: 3, internal_node_count: 2, support_value_count: 1,
      branch_length_valid: true, branch_lengths_complete: true,
      branch_lengths: { invalid_count: 0 },
      rooting: { status: "unknown", basis: "No outgroup was declared; biological rooting cannot be established from Newick text alone." } }
  },
  retrieval: { files: [], errors: [] },
  reopen: { ai_run_url: "/api/ai/runs/job_0000000000000003", workspace_run_url: "/api/workspace/runs/run_0000000000000001",
    ai_run_id: "job_0000000000000003", workspace_persisted: true, plan_id: "plan_0000000000000001" }
});

let browser;

before(async () => {
  browser = await chromium.launch({ headless: true, args: ["--allow-file-access-from-files"] });
});

after(async () => { await browser?.close(); });

async function openPage(runResponse = RUN_RESPONSE) {
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript((fixtureRun) => {
    window.__calls = [];
    window.__downloads = [];
    window.__fixtureRun = fixtureRun;
    window.fetch = async (input, init = {}) => {
      const url = String(input);
      const body = typeof init.body === "string" ? init.body : null;
      window.__calls.push({ url, method: String(init.method ?? "GET"), body });
      const json = (value, status = 200) => new Response(JSON.stringify(value), {
        status, headers: { "Content-Type": "application/json" }
      });
      if (url.includes("/api/providers/galaxy/capabilities")) {
        return json({ capabilities: { discovery_mode: "live", tools: [
          { id: "toolshed.g2.bx.psu.edu/repos/rnateam/mafft/rbc_mafft/7.526+galaxy2", name: "MAFFT",
            description: "Multiple alignment program for amino acid or nucleotide sequences", version: "7.526+galaxy2" },
          { id: "toolshed.g2.bx.psu.edu/repos/iuc/iqtree/iqtree/3.1.4+galaxy1", name: "IQ-TREE",
            description: "Phylogenomic / evolutionary tree construction from multiple sequences", version: "3.1.4+galaxy1" }
        ] } });
      }
      if (url.includes("/api/ai/workflows/phylo/run")) return json(window.__fixtureRun);
      if (url.includes("/api/providers/chat")) {
        return json({ reply: "Fixture-only phrasing: three taxa, one support label.", evidence_status: "unverified" });
      }
      if (url.includes("/api/ai/runs/")) return json({ run_id: "job_0000000000000003",
        validation: { status: "pass" }, artifacts: [{ name: "tree.nwk" }, { name: "alignment.fasta" }] });
      if (url.includes("/api/workspace/runs/")) return json({ run: { id: "run_0000000000000001", state: "succeeded",
        validation: { status: "pass" } } });
      return json({ error: "stub_not_found" }, 404);
    };
    URL.createObjectURL = (blob) => { window.__downloads.push(blob); return `blob:stub-${window.__downloads.length}`; };
    URL.revokeObjectURL = () => {};
  }, runResponse);
  await page.goto(PAGE);
  return { page, errors };
}

async function loadFasta(page, text) {
  await page.fill("#phylo-fasta-text", text);
}

test("FIXTURE UI: multi-FASTA validation, single-sequence routing and approval gate", async () => {
  const { page, errors } = await openPage();
  await loadFasta(page, ">a\nACGT\n>a\nACGT\n>b\nACGT\n");
  assert.match(await page.locator("#phylo-fasta-stats").innerText(), /Duplicate identifiers/);
  assert.equal(await page.locator("#phylo-plan").isDisabled(), true);
  await loadFasta(page, ">a\nACGTZZ\n>b\nACGT\n>c\nACGT\n");
  assert.match(await page.locator("#phylo-fasta-stats").innerText(), /non-nucleotide characters/);
  await loadFasta(page, ">a\nACGT\n>b\nACGTA\n>c\nACGT\n");
  assert.match(await page.locator("#phylo-fasta-stats").innerText(), /Unequal sequence lengths/);
  await loadFasta(page, ">a\nACGT\n");
  assert.equal(await page.locator("#phylo-identify-link").isVisible(), true);
  assert.match(await page.locator("#phylo-fasta-stats").innerText(), /use 16S identification/i);
  assert.equal(await page.locator("#phylo-plan").isDisabled(), true);
  await loadFasta(page, FASTA);
  assert.match(await page.locator("#phylo-fasta-stats").innerText(), /Records: 3; unique IDs: 3/);
  assert.equal(await page.locator("#phylo-plan").isEnabled(), true);
  await page.click("#phylo-plan");
  await page.waitForFunction(() => document.querySelectorAll("#phylo-plan-steps li").length === 7);
  assert.equal(await page.locator("#phylo-plan-steps li").count(), 7);
  const planText = await page.locator("#phylo-plan-steps").innerText();
  assert.ok(planText.includes(MAFFT_ID) && planText.includes("7.526+galaxy2"), planText);
  assert.ok(planText.includes(IQTREE_ID) && planText.includes("3.1.4+galaxy1"), planText);
  assert.equal(await page.locator("#phylo-run").isDisabled(), true);
  const callsBeforeApproval = await page.evaluate(() => window.__calls.map((item) => item.url));
  assert.equal(callsBeforeApproval.some((url) => url.includes("/api/ai/workflows/phylo/run")), false);
  await page.check("#phylo-approve-check");
  assert.equal(await page.locator("#phylo-run").isEnabled(), true);
  assert.deepEqual(errors, []);
  await page.close();
});

test("FIXTURE UI: real tree rendering, metrics, highlights, exports and honest AI label", async () => {
  const { page, errors } = await openPage();
  await loadFasta(page, FASTA);
  await page.fill("#phylo-query-taxon", "taxon_a");
  await page.check("#phylo-reference-select input[value='taxon_b']");
  await page.click("#phylo-plan");
  await page.waitForFunction(() => document.querySelectorAll("#phylo-plan-steps li").length === 7);
  await page.check("#phylo-approve-check");
  await page.click("#phylo-run");
  await page.waitForSelector("#phylo-results:not([hidden])");
  await page.waitForSelector("#phylo-tree svg");
  assert.equal(await page.locator("#phylo-tree svg .phylo-tip").count(), 3);
  assert.equal(await page.locator("#phylo-tree svg text", { hasText: "95/87" }).count(), 1);
  assert.match(await page.locator(".phylo-rooting").innerText(), /Rooting status: unknown/);
  assert.match(await page.locator("#phylo-metrics").innerText(), /Conserved columns[\s\S]*4/);
  assert.match(await page.locator("#phylo-metrics").innerText(), /Branch lengths valid[\s\S]*yes/);
  assert.equal(await page.locator("#phylo-tree .phylo-tip.is-query").count(), 1);
  assert.equal(await page.locator("#phylo-tree .phylo-tip.is-reference").count(), 1);
  await page.click("#phylo-tree .phylo-tip-group");
  assert.match(await page.locator(".phylo-inspector").innerText(), /taxon/);
  await page.click("button[data-action='zoom-in']");
  assert.match(await page.locator(".phylo-viewport").getAttribute("transform"), /scale\(1\.25\)/);
  assert.equal(await page.locator("#phylo-downloads button").count(), 4);
  const buttons = page.locator("#phylo-downloads button");
  for (let index = 0; index < 4; index += 1) await buttons.nth(index).click();
  const downloads = await page.evaluate(async () => Promise.all(window.__downloads.map((blob) => blob.text())));
  assert.equal(downloads.length, 4);
  assert.ok(downloads[0].includes("taxon_a:0.1"));
  assert.ok(downloads[1].includes("<svg"));
  assert.ok(downloads[2].includes(">taxon_a"));
  assert.ok(downloads[3].includes('"conserved_columns": 4'));
  await page.waitForFunction(() => !document.getElementById("phylo-ai-phrasing").hidden);
  assert.match(await page.locator("#phylo-ai-status").innerText(), /AI-generated phrasing .*unverified/i);
  const chatCall = await page.evaluate(() => window.__calls.find((item) => item.url.includes("/api/providers/chat")));
  const chatBody = JSON.parse(chatCall.body);
  assert.equal(chatBody.category, "explanation_evaluation");
  assert.match(chatBody.message, /conserved_columns/);
  assert.doesNotMatch(chatBody.message, new RegExp(NEWICK.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.doesNotMatch(chatBody.message, /ACGT-ACGTACG/);
  await page.click("#phylo-reopen-ai");
  await page.waitForFunction(() => document.getElementById("phylo-reopen-detail").textContent.includes("artifacts:"));
  assert.match(await page.locator("#phylo-reopen-detail").innerText(), /artifacts: tree\.nwk/);
  await page.click("#phylo-reopen-workspace");
  await page.waitForFunction(() => document.getElementById("phylo-reopen-detail").textContent.includes("state succeeded"));
  assert.match(await page.locator("#phylo-reopen-detail").innerText(), /state succeeded/);
  assert.deepEqual(errors, []);
  await page.close();
});

test("FIXTURE UI: a run without a tree fails honestly and offers no tree export", async () => {
  const noTree = { ...RUN_RESPONSE, tree_newick: null, alignment_text: null,
    workflow_completed: false, validation: { status: "fail", retrieval_errors: [{ reason: "no_valid_newick_tree_retrieved" }],
      alignment: { valid: false }, tree: { valid: false } } };
  const { page, errors } = await openPage(noTree);
  await loadFasta(page, FASTA);
  await page.click("#phylo-plan");
  await page.waitForFunction(() => document.querySelectorAll("#phylo-plan-steps li").length === 7);
  await page.check("#phylo-approve-check");
  await page.click("#phylo-run");
  await page.waitForSelector("#phylo-results:not([hidden])");
  assert.equal(await page.locator("#phylo-tree svg").count(), 0);
  assert.match(await page.locator("#phylo-tree").innerText(), /No tree is available/);
  const buttons = page.locator("#phylo-downloads button");
  assert.equal(await buttons.nth(0).isDisabled(), true);
  assert.equal(await buttons.nth(1).isDisabled(), true);
  assert.match(await page.locator("#phylo-status").innerText(), /No outputs are claimed|could not produce verified results/);
  assert.deepEqual(errors, []);
  await page.close();
});
