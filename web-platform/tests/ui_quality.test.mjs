import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const PUBLIC = resolve(HERE, "../public");
const read = (relative) => readFileSync(resolve(PUBLIC, relative), "utf8");
const count = (text, pattern) => (text.match(pattern) || []).length;

const indexHtml = read("index.html");
const aiHtml = read("ai.html");
const css = read("css/main.css") + read("css/components.css");

test("index has a restrained hero with a value proposition and multiple actions", () => {
  assert.match(indexHtml, /id="hero"/);
  assert.match(indexHtml, /class="hero-description"/);
  assert.match(indexHtml, /class="hero-actions"/);
  const hero = indexHtml.slice(indexHtml.indexOf('id="hero"'), indexHtml.indexOf("</section>", indexHtml.indexOf('id="hero"')));
  assert.ok(count(hero, /<a\s/g) >= 2, "hero must offer at least two primary actions");
  assert.match(hero, /href="ai\.html"/);
});

test("index exposes capability cards with inline SVG icons", () => {
  assert.ok(count(indexHtml, /class="capability-card"/g) >= 3);
  assert.match(indexHtml, /class="capability-icon"[^>]*><svg\b/);
  assert.doesNotMatch(indexHtml, /<img\b/i, "no external image resources");
});

test("both pages show a four-stage workflow strip with state styling", () => {
  for (const [name, html] of [["index", indexHtml], ["ai", aiHtml]]) {
    assert.match(html, /class="workflow-strip"/, `${name} needs the workflow strip`);
    assert.equal(count(html, /class="workflow-stage"/g), 4, `${name} needs four stages`);
    for (const stage of ["Plan", "Approve", "Execute", "Validate"]) {
      assert.match(html, new RegExp(`<h3>${stage}</h3>`), `${name} is missing stage ${stage}`);
    }
    assert.ok(count(html, /data-state="(current|gated|queued|verified)"/g) >= 4);
  }
  assert.match(css, /\.workflow-stage\[data-state="current"\]/);
  assert.match(css, /\.workflow-stage\[data-state="gated"\]/);
});

test("AI page keeps every id consumed by ai-workspace.js", () => {
  for (const id of ["question", "fasta-text", "build-plan", "execution-route", "backend-status", "phylo-example"]) {
    assert.match(aiHtml, new RegExp(`id="${id}"`), `missing #${id}`);
  }
  assert.match(aiHtml, /id="artifacts-box"/);
  assert.match(aiHtml, /id="consent-label-text"/);
  assert.match(aiHtml, /Browser \(local\)/);
});

test("static pages have no inline handlers or external resource loads", () => {
  for (const file of readdirSync(PUBLIC).filter((name) => name.endsWith(".html"))) {
    const html = read(file);
    assert.doesNotMatch(html, /onclick\s*=/i, `${file} contains onclick`);
    assert.doesNotMatch(html, /\b(?:src|href)\s*=\s*["']https?:\/\//i, `${file} loads an external resource`);
  }
});

test("CSS provides reduced-motion support and styled card/timeline blocks", () => {
  assert.match(css, /@media\s*\(prefers-reduced-motion:\s*reduce\)/);
  for (const selector of [".capability-card", ".workflow-stage", ".info-card", ".footer-disclaimer"]) {
    assert.match(css, new RegExp(`\\${selector}\\b`), `missing styles for ${selector}`);
  }
});

test("HTML keeps all element ids referenced by the page scripts", () => {
  for (const [script, page] of [["js/app.js", "index.html"], ["js/ai-workspace.js", "ai.html"]]) {
    const js = read(script);
    const html = read(page);
    const ids = new Set([...js.matchAll(/querySelector\(\s*["']#([\w-]+)["']\s*\)/g)].map((match) => match[1]));
    assert.ok(ids.size > 0, `${script} should query ids`);
    for (const id of ids) assert.match(html, new RegExp(`id="${id}"`), `${page} missing #${id}`);
  }
  assert.match(indexHtml, /data-tool="validator"/);
  assert.match(indexHtml, /data-tool="statistics"/);
});
