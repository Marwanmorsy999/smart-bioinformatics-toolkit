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
  // Local brand SVGs are allowed; remote/data-URI images are not.
  assert.doesNotMatch(indexHtml, /<img\b[^>]*\bsrc\s*=\s*["'](?:(?:https?:)?\/\/|data:)/i, "no external image resources");
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

test("keyboard focus stays contrast-safe on light surfaces", () => {
  const mainCss = read("css/main.css");
  const componentsCss = read("css/components.css");
  assert.match(mainCss, /:where\([^)]*\):focus-visible \{\s*outline: 3px solid var\(--focus\);/);
  // The old override set --focus-on-dark on navy buttons/links and the skip
  // link, giving ~1.25-1.33:1 on a light page (WCAG 1.4.11 / 2.4.7 failure).
  assert.doesNotMatch(mainCss, /\.primary-button,\s*\.primary-link,\s*\.skip-link/);
  assert.doesNotMatch(mainCss, /var\(--focus-on-dark\)/);
  // --focus-on-dark is reserved for links on the dark footer only.
  assert.match(componentsCss, /\.site-footer a, \.footer-links a\):focus-visible \{ outline-color: var\(--focus-on-dark\);/);
  assert.equal(count(css, /var\(--focus-on-dark\)/g), 1, "only the dark footer may use --focus-on-dark");
});

test("artifact download links look and behave like links", () => {
  assert.match(css, /\.artifact-link\s*\{[^}]*color:\s*var\(--teal-deep\)/);
  assert.match(css, /\.artifact-link\s*\{[^}]*text-decoration:\s*underline/);
  assert.match(css, /\.artifact-link:hover\s*\{/);
  assert.match(css, /\.artifact-link:focus-visible\s*\{/);
});

test("AI page has ordered headings, described help text and one backend live region", () => {
  assert.ok(aiHtml.indexOf("<h2") > 0 && aiHtml.indexOf("<h2") < aiHtml.indexOf("<h3"),
    "an h2 must precede the first h3 on the AI page");
  assert.match(aiHtml, /<select id="sequence-type" aria-describedby="sequence-type-help">/);
  assert.match(aiHtml, /<small id="sequence-type-help">/);
  const liveRegionIds = ["backend-badge", "backend-status"].filter((id) => {
    const tag = aiHtml.match(new RegExp(`<[^>]*id="${id}"[^>]*>`))?.[0] || "";
    return /aria-live|role="status"/.test(tag);
  });
  assert.deepEqual(liveRegionIds, ["backend-status"], "backend status must announce once, not twice");
});

test("AI examples offer a working browser-local prompt and route-aware presets", () => {
  const workspaceJs = read("js/ai-workspace.js");
  assert.match(aiHtml, /id="fasta-example"/);
  assert.match(aiHtml, /data-question="Validate and profile my FASTA/);
  assert.match(aiHtml, /id="phylo-example"/);
  assert.match(workspaceJs, /elements\.fastaExample\.addEventListener/);
  assert.match(workspaceJs, /applyExampleRoute\(ROUTE_AGENT/);
  assert.match(workspaceJs, /agentOption\.disabled = !backendDescription\.connected/);
});

test("AI result view surfaces per-run education and locality data without markup injection", () => {
  const workspaceJs = read("js/ai-workspace.js");
  assert.match(aiHtml, /id="education-box"/);
  assert.match(aiHtml, /id="locality-box"/);
  assert.doesNotMatch(workspaceJs, /innerHTML/, "untrusted run data must never be parsed as HTML");
  assert.match(workspaceJs, /renderTransparencySections\(run\)/);
  assert.match(workspaceJs, /renderTransparencySections\(null\)/);
  assert.match(workspaceJs, /educationBox\.replaceChildren/);
  assert.match(workspaceJs, /localityBox\.replaceChildren/);
  for (const field of [
    "rule_or_threshold", "why_insufficient", "what_would_help", "verified_reference",
    "local_operations", "external_transmissions", "consent_records", "receipt.mode"
  ]) {
    assert.ok(workspaceJs.includes(field), `result view is missing ${field}`);
  }
  assert.equal(count(workspaceJs, /setTimeout\(\(\) => URL\.revokeObjectURL\(url\), 0\)/g), 2,
    "both download helpers must defer object URL revocation until after the click");
});

test("mock Worker mode is labelled in the badge and chip and styled as a warning", () => {
  const workspaceJs = read("js/ai-workspace.js");
  assert.match(workspaceJs, /backendBadge\.textContent = backendDescription\.badge/);
  assert.match(workspaceJs, /elements\.mode\.textContent = executionBadge\(currentRoute\(\), backendDescription\)/);
  assert.match(workspaceJs, /classList\.toggle\("mock", backendDescription\.mode === "mock"\)/);
  assert.match(css, /\.badge-mode\.mock/);
  assert.match(css, /\.local-badge\.mock/);
});
