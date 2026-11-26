// M7.14 UI contract tests: offline, static + pure viewer rendering shim.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { MICROBIOME_VIEWER_VERSION } from "../public/js/microbiome-viewer.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const read = (relative) => readFileSync(resolve(HERE, "..", relative), "utf8");
const html = read("public/microbiome.html");
const css = read("public/css/microbiome.css");
const js = read("public/js/microbiome.js");

test("PAGE: reviewed plan, approval gate and genuine progress are present", () => {
  assert.match(html, /<title>Microbiome 16S workflow — Smart Bioinformatics AI<\/title>/);
  assert.equal((html.match(/id="primary-nav"/g) ?? []).length, 1);
  assert.match(html, /<a href="microbiome.html" aria-current="location">Microbiome<\/a>/);
  for (const id of ["mb-reads", "mb-barcodes", "mb-metadata", "mb-public", "mb-objective",
    "mb-plan-button", "mb-approve-button", "mb-step-list", "mb-refresh-button", "mb-results",
    "mb-composition-chart", "mb-pcoa", "mb-downloads", "mb-assistant-button"]) {
    assert.ok(html.includes(`id="${id}"`), `${id} is missing`);
  }
  assert.match(html, /Reviewing a plan is read-only and submits no job/);
  assert.match(html, /Approval submits exactly one dependent workflow/);
  assert.match(html, /Each refresh performs one bounded provider poll/);
  assert.match(html, /class="footer-disclaimer">Research and educational use only\./);
});

test("PAGE: public dataset option uses the verified URLs and checksum provenance", () => {
  const zip = read("public/js/microbiome-zip.js");
  assert.match(zip, /moving-pictures-tutorial\.readthedocs\.io\/en\/2026\.10\/data\/moving-pictures\/sample-metadata\.tsv/);
  assert.match(zip, /emp-single-end-sequences\.zip/);
  assert.match(zip, /245f8e389ddf3dd05a95d870d214de918a06d03c5ce17750860446e09f9a7cc6/);
  assert.match(zip, /992740724f9a8000e5d81bc23a6c2bb74e4aed4cc3542768a220a36bae22d373/);
  assert.match(zip, /expected_samples: 34/);
  assert.match(zip, /expected_reads: 302581/);
  assert.match(zip, /trim-left 0 and trunc-len 120 follow the observed data/);
  assert.doesNotMatch(zip, /1103/);
});

test("CONTROLLER: server-only analysis, bounded polling and honest assistant context", () => {
  for (const route of ["/api/ai/workflows/microbiome/plan", "/api/ai/workflows/microbiome/run",
    "/api/ai/workflows/microbiome/status", "/api/ai/workflows/microbiome/result"]) {
    assert.ok(js.includes(route), `${route} is not called by the page`);
  }
  assert.match(js, /captureMicrobiomeRun/);
  assert.match(js, /MAX_POLLS = 120/);
  assert.match(js, /window\.history\.replaceState/);
  assert.match(js, /searchParams\.get\("run_id"\)/);
  assert.doesNotMatch(js, /Math\.random|synthetic|placeholder result/i);
  assert.match(js, /observed:/);
  assert.match(js, /no significance claim/i);
});

test("LAYOUT: grids collapse and wide tables scroll so 768px cannot overflow", () => {
  assert.match(css, /@media \(max-width: 860px\)/);
  assert.match(css, /grid-template-columns: minmax\(0, 1fr\)/);
  assert.match(css, /overflow-x: auto/);
  assert.match(css, /max-width: 100%/);
  assert.equal(MICROBIOME_VIEWER_VERSION, "1.0.0-m7.14");
});

test("NAV: every HTML page with a topbar nav links to the microbiome workflow", () => {
  const dir = resolve(HERE, "..", "public");
  const pages = readFileSync(resolve(dir, "index.html"), "utf8"); // presence check
  assert.ok(pages.includes("primary-nav"));
  const files = ["index.html", "workspace.html", "phylo.html", "protein.html", "16s.html",
    "assistant.html", "history.html", "blast.html", "taxonomy.html", "benchmark.html",
    "research-use.html", "ai.html", "microbiome.html"];
  for (const file of files) {
    const source = readFileSync(resolve(dir, file), "utf8");
    const navStart = source.indexOf('<nav id="primary-nav"');
    assert.ok(navStart >= 0, `${file} has no primary nav`);
    const nav = source.slice(navStart, source.indexOf("</nav>", navStart));
    assert.match(nav, /href="microbiome\.html"/, `${file} nav lacks the microbiome link`);
  }
});
