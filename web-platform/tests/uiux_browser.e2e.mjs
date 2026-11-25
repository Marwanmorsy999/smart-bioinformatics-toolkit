// M7.4.1 UI/UX redesign validation — real Chromium Playwright, offline only.
//
// Scope: shell/navigation, keyboard access, responsive layout and the existing
// browser-local interactions. This test NEVER calls a live scientific provider:
// every fetch() is replaced by a rejecting stub before any page script runs.
// Example/Analyze results below are produced by the browser-local code paths
// already shipped in the pages; they are NOT a fresh scientific execution.
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { after, before, test } from "node:test";
import { chromium } from "playwright";

const HERE = dirname(fileURLToPath(import.meta.url));
const PUBLIC = resolve(HERE, "../public");
const SHOTS = resolve(HERE, "../test-results/uiux/after");
mkdirSync(SHOTS, { recursive: true });

const PAGES = [
  { key: "landing", file: "index.html", title: /Smart Bioinformatics Toolkit/ },
  { key: "ai", file: "ai.html", title: /AI Research Workspace/ },
  { key: "benchmark", file: "benchmark.html", title: /Risk-coverage analysis/ },
  { key: "blast", file: "blast.html", title: /BLAST Results Analyzer/ },
  { key: "taxonomy", file: "taxonomy.html", title: /Taxonomy Analyzer/ },
  { key: "workspace", file: "workspace.html", title: /Research workspace/ },
  { key: "phylo", file: "phylo.html", title: /Phylogenetics workflow/ }
];
const VIEWPORTS = [
  { width: 1440, height: 900 },
  { width: 1280, height: 800 },
  { width: 768, height: 1024 },
  { width: 390, height: 844 },
  { width: 360, height: 800 }
];
const DESKTOP = VIEWPORTS[0];
const MOBILE = VIEWPORTS[3];
const browserErrors = [];
const stubbedFetches = new Set();

let browser;
let context;

before(async () => {
  // The same test-only flag used by the repo's existing file:// E2E tests.
  browser = await chromium.launch({ headless: true, args: ["--allow-file-access-from-files"] });
  context = await browser.newContext({ viewport: DESKTOP });
  await context.addInitScript(() => {
    window.__offlineFetchAttempts = [];
    window.fetch = (input) => {
      const url = typeof input === "string" ? input : (input && input.url ? input.url : String(input));
      window.__offlineFetchAttempts.push(url);
      return Promise.reject(new Error("OFFLINE_E2E_STUB: network disabled (" + url + ")"));
    };
  });
});

after(async () => {
  await browser?.close();
});

function urlFor(file) {
  return "file://" + resolve(PUBLIC, file).replace(/\\/g, "/");
}

async function open(key, viewport = DESKTOP) {
  const def = PAGES.find((page) => page.key === key);
  assert.ok(def, `unknown page key ${key}`);
  const page = await context.newPage();
  await page.setViewportSize(viewport);
  page.on("pageerror", (error) => browserErrors.push(`${def.key}: pageerror: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error") browserErrors.push(`${def.key}: console.error: ${message.text()}`);
  });
  await page.goto(urlFor(def.file));
  await page.waitForLoadState("load");
  const attempts = await page.evaluate(() => window.__offlineFetchAttempts || []);
  for (const attempt of attempts) stubbedFetches.add(attempt);
  return page;
}

// --------------------------------------------------------------- (a) + (b)
test("(a,b) all seven pages load from file:// and the skip link targets main", async () => {
  const problems = [];
  for (const def of PAGES) {
    const page = await open(def.key);
    const info = await page.evaluate(() => {
      const skip = document.querySelector("a.skip-link");
      const href = skip?.getAttribute("href") ?? "";
      const target = href.startsWith("#") ? document.getElementById(href.slice(1)) : null;
      return {
        title: document.title,
        skipText: skip?.textContent?.trim() ?? "",
        href,
        targetTag: target?.tagName ?? "",
        mainCount: document.querySelectorAll("main").length
      };
    });
    if (!def.title.test(info.title)) problems.push(`${def.key}: unexpected title ${info.title}`);
    if (!/skip/i.test(info.skipText)) problems.push(`${def.key}: missing/invalid skip link text`);
    if (!info.href.startsWith("#")) problems.push(`${def.key}: skip link href is not a fragment (${info.href})`);
    if (info.targetTag !== "MAIN") problems.push(`${def.key}: skip target is <${info.targetTag}>, expected <main>`);
    if (info.mainCount !== 1) problems.push(`${def.key}: found ${info.mainCount} main landmarks`);
    await page.close();
  }
  assert.deepEqual(problems, [], `page load / skip-link failures:\n- ${problems.join("\n- ")}`);
});

// ------------------------------------------------------------------- (c)
test("(c) global nav links are identical and the 390px toggle opens/closes", async () => {
  const navSets = [];
  const problems = [];
  for (const def of PAGES) {
    const page = await open(def.key, MOBILE);
    const navLinks = await page.$$eval("#primary-nav a", (items) =>
      items.map((a) => ({ text: a.textContent.trim(), href: a.getAttribute("href") })));
    navSets.push({ key: def.key, links: navLinks });

    const toggle = page.locator(".nav-toggle");
    const nav = page.locator("#primary-nav");
    if (!(await toggle.isVisible())) problems.push(`${def.key}: nav toggle not visible at 390px`);
    if ((await toggle.getAttribute("aria-expanded")) !== "false") problems.push(`${def.key}: toggle not initially collapsed`);
    if (await nav.isVisible()) problems.push(`${def.key}: nav visible while collapsed`);

    await toggle.click();
    if ((await toggle.getAttribute("aria-expanded")) !== "true") problems.push(`${def.key}: aria-expanded did not flip to true`);
    if (!(await nav.isVisible())) problems.push(`${def.key}: nav not visible after toggle`);

    await page.keyboard.press("Escape");
    if ((await toggle.getAttribute("aria-expanded")) !== "false") problems.push(`${def.key}: Escape did not collapse`);
    if (await nav.isVisible()) problems.push(`${def.key}: nav still visible after Escape`);
    const focusReturned = await page.evaluate(() => document.activeElement?.classList.contains("nav-toggle"));
    if (!focusReturned) problems.push(`${def.key}: focus not returned to toggle after Escape`);
    await page.close();
  }
  const baseline = JSON.stringify(navSets[0].links);
  for (const entry of navSets) {
    if (JSON.stringify(entry.links) !== baseline) {
      problems.push(`${entry.key}: nav links differ from landing (${JSON.stringify(entry.links)})`);
    }
  }
  assert.deepEqual(problems, [], `navigation failures:\n- ${problems.join("\n- ")}`);
});

// ------------------------------------------------------------------- (d)
test("(d) landing validator then statistics show visible results", async () => {
  const page = await open("landing");
  await page.click("#load-example");
  assert.match(await page.inputValue("#fasta-text"), /^>isolate_001/, "example FASTA not loaded");

  await page.click("#run-primary");
  await page.waitForSelector("#results:not([hidden])");
  assert.equal(await page.locator("#results-title").innerText(), "Validation results");
  assert.ok((await page.locator("#result-status").innerText()).trim().length > 0, "empty validation status");
  assert.ok((await page.locator("#results-table tbody tr").count()) >= 1, "no validation rows rendered");

  await page.click("#run-secondary");
  await page.waitForFunction(() =>
    document.querySelector("#results-title")?.textContent === "Sequence statistics");
  assert.equal(await page.locator("#result-status").innerText(), "Statistics calculated");
  assert.ok((await page.locator("#results-table tbody tr").count()) >= 1, "no statistics rows rendered");
  await page.close();
});

// ------------------------------------------------------------------- (e)
test("(e) BLAST and taxonomy example -> Analyze flows work offline", async () => {
  const problems = [];

  const blast = await open("blast");
  await blast.click("#load-blast-example");
  assert.ok((await blast.inputValue("#blast-text")).trim().length > 0, "BLAST example not loaded");
  await blast.click("#run-blast");
  try {
    await blast.waitForSelector("#blast-results:not([hidden])", { timeout: 5000 });
    assert.ok((await blast.locator("#blast-summary").innerText()).trim().length > 0, "empty BLAST summary");
    assert.ok((await blast.locator("#blast-table tbody tr").count()) >= 1, "no BLAST hit rows");
  } catch (error) {
    problems.push(`blast: ${error.message}`);
  }
  await blast.close();

  const taxonomy = await open("taxonomy");
  await taxonomy.click("#load-taxonomy-example");
  assert.ok((await taxonomy.inputValue("#taxonomy-blast-text")).trim().length > 0, "taxonomy example not loaded");
  await taxonomy.click("#run-taxonomy");
  try {
    await taxonomy.waitForSelector("#taxonomy-results:not([hidden])", { timeout: 5000 });
    assert.ok((await taxonomy.locator("#taxonomy-summary").innerText()).trim().length > 0, "empty taxonomy summary");
    assert.ok((await taxonomy.locator("#taxonomy-query-view").innerText()).trim().length > 0, "no taxonomy query detail");
  } catch (error) {
    problems.push(`taxonomy: ${error.message}`);
  }
  await taxonomy.close();

  assert.deepEqual(problems, [], `example -> Analyze failures:\n- ${problems.join("\n- ")}`);
});

// ------------------------------------------------------------------- (f)
test("(f) workspace sample load shows SAMPLE label and project detail", async () => {
  const page = await open("workspace");
  await page.click("#ws-demo-load");
  await page.waitForSelector("#ws-demo-view:not([hidden])");
  assert.equal(await page.locator("#ws-demo-view-title").innerText(), "Sample project detail");
  assert.match(await page.locator("#ws-demo-content").innerText(), /SAMPLE \/ PRECOMPUTED/);
  assert.match(await page.locator("#ws-demo-content").innerText(), /Scientific objective:/);
  assert.match(await page.locator("#ws-demo-runs").innerText(), /SAMPLE \/ PRECOMPUTED/);
  assert.match(await page.locator("#ws-demo-disclaimer").innerText(), /NOT a newly executed analysis/);
  await page.close();
});

// ------------------------------------------------------------------- (g)
test("(g) phylo plan shows seven steps and approval stays disabled until checked", async () => {
  const page = await open("phylo");
  const FASTA = ">A\nACGTACGTACGT\n>B\nACGTACGTTCGT\n>C\nACGTTCGTACGT\n";
  await page.setInputFiles("#phylo-file", {
    name: "phylo.fasta", mimeType: "text/plain", buffer: Buffer.from(FASTA)
  });
  await page.fill("#phylo-objective", "Infer relationships among these sequences");
  await page.click("#phylo-plan");
  await page.waitForFunction(() => document.querySelectorAll("#phylo-plan-steps li").length === 7);
  assert.equal(await page.locator("#phylo-plan-steps li").count(), 7);
  assert.equal(await page.locator("#phylo-run").isDisabled(), true, "Approve & run enabled before consent");
  await page.check("#phylo-approve-check");
  assert.equal(await page.locator("#phylo-run").isEnabled(), true, "Approve & run stayed disabled after consent");
  // Deliberately do NOT click #phylo-run: that would submit to Galaxy.
  await page.close();
});

// --------------------------------------------------------- (h) + screenshots
test("(h) no horizontal overflow at five viewports; responsive screenshots saved", async () => {
  const problems = [];
  let shots = 0;
  for (const vp of VIEWPORTS) {
    for (const def of PAGES) {
      const page = await open(def.key, vp);
      const metric = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        innerWidth: window.innerWidth
      }));
      if (metric.scrollWidth > metric.innerWidth) {
        problems.push(`${def.key} @ ${vp.width}x${vp.height}: scrollWidth ${metric.scrollWidth} > innerWidth ${metric.innerWidth}`);
      }
      await page.screenshot({
        path: resolve(SHOTS, `${def.key}-${vp.width}x${vp.height}.png`),
        animations: "disabled"
      });
      shots += 1;
      await page.close();
    }
  }
  assert.equal(shots, PAGES.length * VIEWPORTS.length, "unexpected screenshot count");
  assert.deepEqual(problems, [], `horizontal overflow:\n- ${problems.join("\n- ")}`);
});

// ------------------------------------------------------------------- (i)
test("(i) keyboard Tab reaches nav and main controls with a visible outline", async () => {
  const page = await open("landing");
  const seen = [];
  for (let i = 0; i < 12; i += 1) {
    await page.keyboard.press("Tab");
    const info = await page.evaluate(() => {
      const el = document.activeElement;
      if (!el) return null;
      const style = getComputedStyle(el);
      return {
        tag: el.tagName,
        id: el.id || "",
        cls: typeof el.className === "string" ? el.className : "",
        inNav: Boolean(el.closest?.("#primary-nav")),
        inMain: Boolean(el.closest?.("main")),
        outlineStyle: style.outlineStyle,
        outlineWidth: Number.parseFloat(style.outlineWidth) || 0
      };
    });
    if (info) seen.push(info);
  }
  const hasOutline = (info) => info.outlineStyle !== "none" && info.outlineWidth >= 2;
  assert.ok(seen[0]?.cls.includes("skip-link"), `first Tab target should be skip link, got ${JSON.stringify(seen[0])}`);
  assert.ok(hasOutline(seen[0]), `skip link lacks visible focus outline: ${JSON.stringify(seen[0])}`);
  const navHit = seen.find((info) => info.inNav && hasOutline(info));
  assert.ok(navHit, `no nav link with visible focus outline: ${JSON.stringify(seen)}`);
  const mainHit = seen.find((info) => info.inMain && hasOutline(info));
  assert.ok(mainHit, `no main control with visible focus outline: ${JSON.stringify(seen)}`);
  await page.close();
});

// ------------------------------------------------------------------- (j)
test("(j) prefers-reduced-motion is recognized (CSS rule and computed style)", async () => {
  const page = await open("landing");
  const rulePresent = await page.evaluate(() => {
    for (const sheet of document.styleSheets) {
      let rules;
      try { rules = sheet.cssRules; } catch { continue; }
      if (!rules) continue;
      for (const rule of rules) {
        if ((rule.cssText || "").includes("prefers-reduced-motion")) return true;
      }
    }
    return false;
  });
  assert.equal(rulePresent, true, "no prefers-reduced-motion rule in any loaded stylesheet");

  const normal = await page.evaluate(() => getComputedStyle(document.documentElement).scrollBehavior);
  await page.emulateMedia({ reducedMotion: "reduce" });
  const reduced = await page.evaluate(() => getComputedStyle(document.documentElement).scrollBehavior);
  await page.emulateMedia({ reducedMotion: "no-preference" });
  assert.equal(normal, "smooth", "baseline scroll-behavior should be smooth");
  assert.equal(reduced, "auto", "reduced-motion media query did not override scroll-behavior");
  await page.close();
});

test("(z) no live provider call escaped the offline fetch stub", () => {
  for (const error of browserErrors) {
    assert.doesNotMatch(error, /galaxy|smartsbio|ncbi|ebi|uniprot/i, `unexpected live provider reference: ${error}`);
  }
  assert.deepEqual(browserErrors, [], `unexpected browser errors:\n- ${browserErrors.join("\n- ")}`);
});
