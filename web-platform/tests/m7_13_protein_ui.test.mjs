// M7.13 OFFLINE BROWSER TESTS. Real Chromium renders protein.html and
// history.html with fetch() fully stubbed. The evidence payload comes from the
// SERVER handlers with provider calls stubbed from saved GENUINE fixtures; no
// browser page talks to EBI/UniProt and no live provider call is made.
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

import { handleAnnotate } from "../functions/api/protein/workflow.js";
import { handleGetRecovery } from "../functions/api/ai/runs/[id]/recovery.js";
import { createFetch } from "../worker.js";
import { createFakeD1AI, mockAIEnv } from "./helpers/fake-d1.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const PROTEIN_PAGE = "file://" + resolve(HERE, "../public/protein.html").replace(/\\/g, "/");
const HISTORY_PAGE = "file://" + resolve(HERE, "../public/history.html").replace(/\\/g, "/");
const FIX = new URL("./fixtures/m7_13_protein/", import.meta.url);
const fasta = readFileSync(new URL("P04637.fasta", FIX), "utf8");
const matches = JSON.parse(readFileSync(new URL("matches-P04637.json", FIX), "utf8"));
const proteinMeta = JSON.parse(readFileSync(new URL("interpro-protein-P04637.json", FIX), "utf8"));

let browser;
let context;
const errors = [];

function ids() {
  let counter = 1;
  return (kind) => `${kind}_${(counter++).toString(16).padStart(16, "0")}`;
}

async function genuineServerRun() {
  const { db } = createFakeD1AI();
  const env = mockAIEnv(db);
  const fetchImpl = async (url) => {
    const value = String(url);
    if (value.includes("/matches/api/matches/")) return new Response(JSON.stringify(matches));
    if (value.includes("/entry/interpro/IPR")) {
      return new Response(JSON.stringify({ metadata: { go_terms: proteinMeta.metadata.go_terms } }));
    }
    return new Response("{}", { status: 404 });
  };
  const request = new Request("https://worker.example.test/api/ai/workflows/protein/annotate", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mode: "fasta", fasta_text: fasta })
  });
  const body = await (await handleAnnotate(request, env, { fetchImpl, idFactory: ids() })).json();
  const runRow = await (await createFetch()(new Request(`https://worker.example.test/api/ai/runs/${body.run_id}`),
    { AI_DB: db, BLAST_DB: db }, null)).json();
  const recovery = await (await handleGetRecovery(
    new Request(`https://worker.example.test/api/ai/runs/${body.run_id}/recovery`), env, body.run_id)).json();
  return { body, runRow, recovery };
}

async function installStubs(server) {
  await context.addInitScript(({ payload, run, recovered, runId }) => {
    window.__calls = [];
    window.fetch = async (input, init = {}) => {
      const url = typeof input === "string" ? input : (input?.url ?? String(input));
      window.__calls.push({ url, method: init.method ?? "GET", body: init.body ?? null });
      let data = null;
      if (url.includes("/api/ai/workflows/protein/plan")) {
        data = { workflow_type: "protein", input: { mode: "fasta", md5: payload.input.md5,
          sequences: payload.input.sequences }, plan: { route_availability: {
            precomputed: { available: true, label: "precomputed_reference_annotation" },
            iprscan6: { available: false, reason: "route_b_unavailable_no_contact_email: no contact email configured." }
          } } };
      } else if (url.includes("/api/ai/workflows/protein/annotate")) data = payload;
      else if (url.includes(`/api/ai/runs/${runId}/recovery`)) data = recovered;
      else if (url.includes(`/api/ai/runs/${runId}`)) data = run;
      else if (url.includes("/api/assistant/chat")) data = { reply: "Plain-language phrasing, unverified." };
      else throw new Error(`OFFLINE E2E STUB: unexpected request ${url}`);
      return new Response(JSON.stringify(data), { status: 200,
        headers: { "Content-Type": "application/json" } });
    };
  }, { payload: server.body, run: server.runRow, recovered: server.recovery, runId: server.body.run_id });
}

before(async () => {
  browser = await chromium.launch({ headless: true, args: ["--allow-file-access-from-files"] });
});

after(async () => {
  await browser?.close();
});

test("PAGE: nav, fail-closed input validation and no external call on load", async () => {
  const contextLocal = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await contextLocal.addInitScript(() => {
    window.__calls = [];
    window.fetch = async (input) => {
      const url = typeof input === "string" ? input : (input?.url ?? String(input));
      window.__calls.push(url);
      throw new Error(`OFFLINE_E2E_STUB: ${url}`);
    };
  });
  const page = await contextLocal.newPage();
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(PROTEIN_PAGE);
  assert.equal(await page.locator("#primary-nav a[href='protein.html']").count(), 1);
  assert.equal(await page.locator("#protein-viewer svg").count(), 0);
  assert.equal(await page.locator("#protein-annotate").isDisabled(), true);
  await page.fill("#protein-fasta-text", ">16s\nACGTACGTACGTACGTACGTACGTACGTACGTACGTACGT");
  assert.match(await page.locator("#protein-validation").innerText(), /nucleotide/i);
  await page.fill("#protein-fasta-text", ">a\nACDEFGHIKLMNPQRSTVWYACDEFGHIKLMNPQRSTVWY\n>a\nMEEPQSDPSVEPPLSQETFSDLWKLLPENNVL");
  assert.match(await page.locator("#protein-validation").innerText(), /Duplicate FASTA identifier/);
  const calls = await page.evaluate(() => window.__calls);
  assert.deepEqual(calls, [], "no provider or API call on load or during validation");
  await contextLocal.close();
});

test("PAGE: genuine evidence renders viewer, table, report, exports and detail on selection", async () => {
  const server = await genuineServerRun();
  context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await installStubs(server);
  const page = await context.newPage();
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(PROTEIN_PAGE);
  await page.fill("#protein-fasta-text", fasta);
  await page.click("#protein-plan");
  await page.waitForFunction(() => !document.getElementById("protein-annotate").disabled);
  assert.match(await page.locator("#protein-route-note").innerText(), /route_b_unavailable_no_contact_email/);
  assert.equal(await page.locator('input[name="protein-route"][value="iprscan6"]').isDisabled(), true);
  await page.click("#protein-annotate");
  await page.waitForSelector("#protein-evidence:not([hidden])");
  assert.equal(await page.locator("#protein-viewer svg rect.pv-block").count() > 20, true);
  assert.ok(await page.locator("#protein-annotations tbody tr").count() >= 32,
    "one row per genuine location (32 matches can carry more than 32 locations)");
  assert.equal(await page.locator("#protein-report section").count(), 10);
  assert.match(await page.locator("#protein-interpretation").innerText(), /precomputed_reference_annotation/);
  assert.match(await page.locator("#protein-interpretation").innerText(), /not proof of function/);
  assert.equal(await page.locator("#protein-downloads button").count(), 7);
  // Select the Pfam DNA-binding domain from the table and verify real details.
  const pfamRow = page.locator("#protein-annotations tbody tr", { hasText: "PF00870" }).first();
  await pfamRow.click();
  assert.match(await page.locator("#protein-detail").innerText(), /100–288/);
  assert.match(await page.locator("#protein-detail").innerText(), /Pfam 39\.0/);
  assert.match(await page.locator("#protein-detail").innerText(), /IPR011615/);
  // Downloads compute a checksum against the stored artifact and report errors.
  await page.locator("#protein-downloads button").first().click();
  assert.match(await page.locator("#protein-checksums").innerText(), /SHA-256 MATCHES/);
  // Optional AI phrasing is opt-in and carries only deterministic context.
  await page.click("#protein-ai-optin");
  await page.waitForFunction(() => document.getElementById("protein-ai-phrasing").hidden === false);
  const chatCall = (await page.evaluate(() => window.__calls)).filter((call) => call.url.includes("/api/assistant/chat"));
  assert.equal(chatCall.length, 1);
  assert.equal(chatCall[0].body.includes(fasta), false, "no FASTA in the assistant message");
  assert.equal(chatCall[0].body.includes("protein"), true);
  assert.match(await page.locator("#protein-ai-status").innerText(), /unverified/);
  const external = (await page.evaluate(() => window.__calls))
    .filter((call) => /ebi\.ac\.uk|uniprot\.org/.test(call.url));
  assert.deepEqual(external, [], "zero browser-side external calls");
  await page.close();
  await context.close();
});

test("HISTORY: protein filter and reopen render from server recovery, not browser memory", async () => {
  const server = await genuineServerRun();
  context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await installStubs(server);
  const page = await context.newPage();
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(HISTORY_PAGE);
  await page.evaluate(({ runId, md5 }) => {
    localStorage.setItem("sbio.research-history.v1", JSON.stringify([{
      run_id: runId, workflow_type: "protein", status: "completed",
      title: "Protein annotation — P04637", sequence_ids: ["sp|P04637|P53_HUMAN"],
      protein_md5: md5, created_at: new Date().toISOString(), completed_at: new Date().toISOString(),
      history_id: null, plan_id: null, workspace_run_id: null, provider_job_ids: [],
      resume: { provider_job_id: null, iqtree_provider_job_id: null, history_id: null }
    }]));
  }, { runId: server.body.run_id, md5: server.body.input.md5 });
  await page.reload();
  await page.click('[data-history-filter="protein"]');
  assert.equal(await page.locator("#history-list .history-entry").count(), 1);
  await page.locator("#history-list .history-entry").first().click();
  await page.waitForSelector("#history-detail:not([hidden])");
  assert.equal(await page.locator("#history-protein-viewer svg rect.pv-block").count() > 20, true);
  assert.match(await page.locator("#history-protein-input").innerText(), />sp\|P04637/);
  assert.match(await page.locator("#history-protein-go").innerText(), /GO:0003677/);
  assert.match(await page.locator("#history-protein-go").innerText(), /not reported by the source/);
  assert.equal(await page.locator("#history-protein-features li").count() > 20, true);
  const recoveryCalls = (await page.evaluate(() => window.__calls)).filter((call) => call.url.includes("/recovery"));
  assert.equal(recoveryCalls.length, 1);
  await page.close();
  await context.close();
});

test("LAYOUT: protein and history pages do not overflow at 768px", async () => {
  for (const url of [PROTEIN_PAGE, HISTORY_PAGE]) {
    const local = await browser.newContext({ viewport: { width: 768, height: 1024 } });
    const page = await local.newPage();
    await page.goto(url);
    const overflow = await page.evaluate(() =>
      document.documentElement.scrollWidth - document.documentElement.clientWidth);
    assert.ok(overflow <= 1, `${url} overflow ${overflow}px`);
    assert.equal(await page.locator("#primary-nav a").count(), 9);
    await page.close();
    await local.close();
  }
});

test("ALL BROWSER PAGES: no uncaught errors from the new modules", () => {
  assert.deepEqual(errors, []);
});
