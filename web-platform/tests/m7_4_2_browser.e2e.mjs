// M7.4.2 full browser validation — real Chromium (Playwright), offline only.
//
// Scope: the nine public pages, the five-item shell/nav contract, brand assets,
// the Level-A/B disclaimer hierarchy, phylo copy honesty, the assistant's
// fail-closed UI, 5-viewport overflow, keyboard access, reduced motion and
// text-contrast arithmetic on the design tokens.
//
// IMPORTANT: fetch() is replaced before any page script runs. The two
// /api/assistant/* stubs are built from the REAL handler payloads imported
// below, so the browser only ever sees an honest "unavailable" status and a
// typed 503. No model is contacted and no mocked reply is treated as AI output.
import assert from "node:assert/strict";
import { mkdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { after, before, test } from "node:test";
import { chromium } from "playwright";
import { onStatus, onChat, UNAVAILABLE_REASON, UNAVAILABLE_TYPE } from "../functions/api/assistant/index.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const PUBLIC = resolve(HERE, "../public");
const SHOTS = resolve(HERE, "../test-results/uiux/m742");
mkdirSync(SHOTS, { recursive: true });

const PAGES = [
  { key: "index", file: "index.html" },
  { key: "workspace", file: "workspace.html" },
  { key: "ai", file: "ai.html" },
  { key: "phylo", file: "phylo.html" },
  { key: "blast", file: "blast.html" },
  { key: "taxonomy", file: "taxonomy.html" },
  { key: "benchmark", file: "benchmark.html" },
  { key: "research-use", file: "research-use.html" },
  { key: "assistant", file: "assistant.html" }
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
const EXPECTED_NAV = ["Tools", "Research workspace", "Phylogenetics", "Assistant", "About"];
const SHORT_NOTICE = "Research and educational use only. Results require independent scientific interpretation.";
// Source of truth for the Level-A statement is the M7.4.2 mission brief, which
// supplies this exact sentence (also present verbatim at research-use.html:43).
// The differently worded sentence in docs/PRODUCT_COPY_AUDIT.md is NOT authoritative.
const LEVEL_A =
  "This platform is designed for research and educational use. " +
  "Its outputs are computational evidence and do not constitute clinical diagnosis. " +
  "Taxonomic assignments and other scientific interpretations depend on input quality, " +
  "reference databases, methods and validation. " +
  "Results do not independently confirm organism identity or pathogenicity " +
  "and are not validated for clinical, forensic or regulatory decision-making. " +
  "Users remain responsible for independent scientific assessment and interpretation.";

const browserErrors = [];
const allFetchAttempts = [];
let browser;
let context;

// Build the stubs from the real gateway handlers (not from invented strings).
const statusContext = { request: new Request("https://worker.example.test/api/assistant/status"), env: {}, params: {} };
const chatContext = {
  request: new Request("https://worker.example.test/api/assistant/chat", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message: "offline validation probe" })
  }),
  env: {}, params: {}
};

before(async () => {
  const statusBody = await (await onStatus(statusContext)).json();
  const chatBody = await (await onChat(chatContext)).json();
  assert.equal(statusBody.available, false);
  assert.equal(statusBody.reason, UNAVAILABLE_REASON);
  assert.equal(chatBody.type, UNAVAILABLE_TYPE);
  assert.equal(Object.hasOwn(chatBody, "reply"), false);

  browser = await chromium.launch({ headless: true, args: ["--allow-file-access-from-files"] });
  context = await browser.newContext({ viewport: DESKTOP });
  await context.addInitScript({
    content: `
      (() => {
        const statusBody = ${JSON.stringify(statusBody)};
        const chatBody = ${JSON.stringify(chatBody)};
        window.__M742_FETCHES__ = [];
        const make = (body, status) => ({
          ok: status >= 200 && status < 300,
          status,
          headers: { get: () => null },
          json: async () => body,
          text: async () => JSON.stringify(body)
        });
        window.fetch = (input, init = {}) => {
          const url = typeof input === "string" ? input : (input && input.url ? input.url : String(input));
          const method = String(init.method || (input && input.method) || "GET").toUpperCase();
          window.__M742_FETCHES__.push({ url, method });
          if (/api\\/assistant\\/status(?:\\?|$)/.test(url)) return Promise.resolve(make(statusBody, 200));
          if (/api\\/assistant\\/chat(?:\\?|$)/.test(url)) return Promise.resolve(make(chatBody, 503));
          return Promise.reject(new Error("M742_OFFLINE_STUB: network disabled (" + url + ")"));
        };
      })();
    `
  });
});

after(async () => { await browser?.close(); });

function urlFor(file) {
  return "file://" + resolve(PUBLIC, file).replace(/\\/g, "/");
}

async function open(key, viewport = DESKTOP) {
  const def = PAGES.find((page) => page.key === key);
  assert.ok(def, `unknown page key ${key}`);
  const page = await context.newPage();
  await page.setViewportSize(viewport);
  page.on("pageerror", (error) => browserErrors.push(`${key}: pageerror: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error") browserErrors.push(`${key}: console.error: ${message.text()}`);
  });
  await page.goto(urlFor(def.file));
  await page.waitForLoadState("load");
  const attempts = await page.evaluate(() => window.__M742_FETCHES__ || []);
  allFetchAttempts.push(...attempts.map((a) => ({ page: key, ...a })));
  return page;
}

// ---------------------------------------------------------------- (1) shell
test("(1) nine pages load with five-item nav, wordmark, favicon, title and short footer notice", async () => {
  const problems = [];
  for (const def of PAGES) {
    const page = await open(def.key);
    const info = await page.evaluate(() => {
      const nav = document.querySelector("#primary-nav");
      const navLinks = nav ? [...nav.querySelectorAll("a")].map((a) => a.textContent.trim()) : [];
      const navHrefs = nav ? [...nav.querySelectorAll("a")].map((a) => a.getAttribute("href")) : [];
      const icon = document.querySelector('link[rel~="icon"]');
      return {
        title: document.title,
        navLinks, navHrefs,
        logoAlt: document.querySelector(".brand-logo")?.getAttribute("alt") || "",
        logoWidth: document.querySelector(".brand-logo")?.naturalWidth || 0,
        iconHref: icon?.getAttribute("href") || "",
        notice: document.querySelector(".footer-disclaimer")?.textContent.replace(/\s+/g, " ").trim() || "",
        policyLink: [...document.querySelectorAll(".footer-disclaimer a")]
          .find((a) => a.textContent.trim() === "Full research-use statement")?.getAttribute("href") || "",
        mainCount: document.querySelectorAll("main").length
      };
    });
    if (!info.title.includes("Smart Bioinformatics AI")) problems.push(`${def.key}: title lacks product name (${info.title})`);
    if (JSON.stringify(info.navLinks) !== JSON.stringify(EXPECTED_NAV)) problems.push(`${def.key}: nav = ${JSON.stringify(info.navLinks)}`);
    if (info.navLinks.length !== 5 || info.navHrefs.length !== 5) problems.push(`${def.key}: nav is not exactly five items`);
    if (info.logoAlt !== "Smart Bioinformatics AI" || info.logoWidth === 0) problems.push(`${def.key}: header wordmark missing/broken (alt=${info.logoAlt}, w=${info.logoWidth})`);
    if (!/favicon\.svg$/.test(info.iconHref)) problems.push(`${def.key}: favicon link missing (${info.iconHref})`);
    if (!info.notice.includes(SHORT_NOTICE)) problems.push(`${def.key}: short footer notice missing (${info.notice})`);
    if (info.policyLink !== "research-use.html") problems.push(`${def.key}: footer policy link = ${info.policyLink}`);
    if (info.mainCount !== 1) problems.push(`${def.key}: ${info.mainCount} main landmarks`);
    await page.close();
  }
  assert.deepEqual(problems, [], `shell contract failures:\n- ${problems.join("\n- ")}`);
});

// ------------------------------------------------------------- (2) Level A
test("(2) research-use page carries the exact mission-supplied Level-A statement", async () => {
  const page = await open("research-use");
  const text = (await page.locator(".policy-statement").innerText()).replace(/\s+/g, " ").trim();
  await page.close();
  assert.equal(text, LEVEL_A,
    "research-use.html:43 does not contain the exact Level-A statement supplied in the M7.4.2 mission brief");
});

// -------------------------------------------------------------- (3) phylo copy
test("(3) phylo page does not claim a completed MAFFT→IQ-TREE run or a 'full provenance' hero", async () => {
  const page = await open("phylo");
  const info = await page.evaluate(() => ({
    meta: document.querySelector('meta[name="description"]')?.content || "",
    head: document.querySelector(".view-head")?.innerText || "",
    status: document.querySelector("#phylo-status")?.textContent || "",
    resultsHidden: document.querySelector("#phylo-results")?.hidden === true
  }));
  await page.close();
  const falseClaim = /executed remotely with full provenance|MAFFT alignment\s*(?:→|->)\s*IQ-TREE tree, executed|full workflow completed/i;
  assert.doesNotMatch(info.meta, falseClaim, "meta description contains a completed-execution claim");
  assert.doesNotMatch(info.head, /full provenance/i, "hero/view-head contains a 'full provenance' claim");
  assert.doesNotMatch(info.head, /IQ-TREE[^.]{0,80}executed|execution completed/i, "hero claims completed tree execution");
  assert.match(info.meta, /full multi-step execution is unverified/i, "honest status sentence missing from meta");
  assert.match(info.head, /proposed cloud workflow/i, "hero does not label the workflow as proposed");
  assert.equal(info.status.trim(), "", "initial status line is not empty");
  assert.equal(info.resultsHidden, true, "conditional results section is visible without a job");
});

// --------------------------------------------------------- (4) assistant UI
test("(4) assistant is honestly unavailable: banner, disabled composer, zero messages, all stages not-started", async () => {
  const page = await open("assistant");
  await page.waitForFunction(() => document.querySelector("#assistant-banner-detail")?.textContent?.includes("no_enabled_llm_provider"));
  const before = await page.evaluate(() => ({
    bannerVisible: !document.querySelector("#assistant-banner")?.hidden,
    bannerText: document.querySelector("#assistant-banner")?.innerText || "",
    bannerRole: document.querySelector("#assistant-banner")?.getAttribute("role") || "",
    bannerLive: document.querySelector("#assistant-banner")?.getAttribute("aria-live") || "",
    composerDisabled: document.querySelector("#message-input")?.disabled === true,
    composerAriaDisabled: document.querySelector("#message-input")?.getAttribute("aria-disabled") || "",
    sendDisabled: document.querySelector("#send-message")?.disabled === true,
    stopDisabled: document.querySelector("#stop-generation")?.disabled === true,
    messageCount: document.querySelectorAll("#message-list li").length,
    stages: [...document.querySelectorAll("#activity-list .activity-stage")].map((s) => ({
      state: s.dataset.state, label: s.querySelector(".stage-state")?.textContent?.trim() || ""
    })),
    timelineLive: document.querySelector("#message-list")?.getAttribute("aria-live") || "",
    errorRole: document.querySelector("#assistant-error")?.getAttribute("role") || "",
    errorHidden: document.querySelector("#assistant-error")?.hidden === true,
    inputLabel: document.querySelector('label[for="message-input"]')?.textContent?.trim() || ""
  }));
  // A suggested prompt only fills the composer; it must never create a message
  // or trigger a chat request while unavailable.
  await page.click(".suggested-prompt");
  const after = await page.evaluate(() => ({
    messageCount: document.querySelectorAll("#message-list li").length,
    inputValue: document.querySelector("#message-input")?.value || "",
    composerDisabled: document.querySelector("#message-input")?.disabled === true,
    attempts: window.__M742_FETCHES__ || []
  }));
  await page.close();

  assert.equal(before.bannerVisible, true, "unavailable banner is hidden");
  assert.match(before.bannerText, /AI chat is unavailable: no authorized model provider is configured for this deployment\./);
  assert.match(before.bannerText, /no_enabled_llm_provider/);
  // Static markup says "Nothing is generated..."; JS replaces it with the
  // live status reason. Both are honest fail-closed messages.
  assert.match(before.bannerText, /Nothing is generated, sent to a model, or simulated\.|No input is accepted; no demo reply is offered\./);
  assert.equal(before.bannerRole, "status");
  assert.equal(before.bannerLive, "polite");
  assert.equal(before.composerDisabled, true);
  assert.equal(before.composerAriaDisabled, "true");
  assert.equal(before.sendDisabled, true);
  assert.equal(before.stopDisabled, true);
  assert.equal(before.messageCount, 0, "assistant rendered a fabricated message");
  assert.equal(before.stages.length, 8);
  assert.deepEqual(before.stages.map((s) => s.state), Array(8).fill("not-started"));
  assert.deepEqual(before.stages.map((s) => s.label), Array(8).fill("Not started"));
  assert.equal(before.timelineLive, "polite");
  assert.equal(before.errorRole, "alert");
  assert.equal(before.errorHidden, true);
  assert.equal(before.inputLabel, "Message S Bio Assistant");
  assert.equal(after.messageCount, 0, "suggested prompt created a fabricated message");
  assert.ok(after.inputValue.length > 0, "suggested prompt did not fill the composer");
  assert.equal(after.composerDisabled, true, "composer became enabled after a suggested prompt");
  assert.equal(after.attempts.filter((a) => /api\/assistant\/chat/.test(a.url)).length, 0,
    "browser called chat while unavailable");
  assert.equal(after.attempts.filter((a) => /api\/assistant\/status/.test(a.url)).length, 1,
    "browser did not consume the real-shaped status stub exactly once");
});

// ------------------------------------------------------------- (5) SVG assets
test("(5) all local SVG assets load (naturalWidth > 0) and every page links a favicon", async () => {
  const problems = [];
  for (const def of PAGES) {
    const page = await open(def.key);
    const assets = await page.evaluate(async () => {
      const imgs = [...document.querySelectorAll("img[src]")].map((img) => ({
        src: img.getAttribute("src"), complete: img.complete, width: img.naturalWidth
      }));
      const icon = document.querySelector('link[rel~="icon"]')?.getAttribute("href") || "";
      const favicon = await new Promise((done) => {
        const image = new Image();
        image.onload = () => done({ src: icon, width: image.naturalWidth });
        image.onerror = () => done({ src: icon, width: 0 });
        image.src = icon;
      });
      return { imgs, favicon };
    });
    if (assets.favicon.width === 0) problems.push(`${def.key}: favicon.svg failed to load`);
    for (const img of assets.imgs) {
      if (img.width === 0) problems.push(`${def.key}: SVG/image failed to load (${img.src}, complete=${img.complete})`);
    }
    await page.close();
  }
  assert.deepEqual(problems, [], `asset failures:\n- ${problems.join("\n- ")}`);
});

// -------------------------------------------- (6) viewport/screenshot evidence
test("(6) zero horizontal overflow on 9 pages x 5 viewports; after screenshots saved", async () => {
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
  // Dedicated footer evidence at the two boundary widths. The guard keeps a
  // missing footer from hanging here; test (1) reports that as a defect.
  for (const key of ["index", "research-use", "assistant"]) {
    for (const vp of [DESKTOP, MOBILE]) {
      const page = await open(key, vp);
      if (await page.locator(".site-footer").count()) {
        await page.locator(".site-footer").screenshot({
          path: resolve(SHOTS, `footer-${key}-${vp.width}x${vp.height}.png`),
          animations: "disabled"
        });
        shots += 1;
      }
      await page.close();
    }
  }
  assert.equal(shots, PAGES.length * VIEWPORTS.length + 6, "unexpected screenshot count");
  assert.deepEqual(problems, [], `horizontal overflow:\n- ${problems.join("\n- ")}`);
});

// ---------------------------------------------- (7) keyboard and reduced motion
test("(7) keyboard focus, mobile sidebar/composer keys and reduced motion", async () => {
  const problems = [];

  // Global keyboard order and visible focus ring.
  const landing = await open("index");
  const seen = [];
  for (let i = 0; i < 12; i += 1) {
    await landing.keyboard.press("Tab");
    seen.push(await landing.evaluate(() => {
      const el = document.activeElement;
      if (!el) return null;
      const style = getComputedStyle(el);
      return {
        tag: el.tagName,
        cls: typeof el.className === "string" ? el.className : "",
        inNav: Boolean(el.closest?.("#primary-nav")),
        inMain: Boolean(el.closest?.("main")),
        outline: style.outlineStyle,
        width: Number.parseFloat(style.outlineWidth) || 0
      };
    }));
  }
  const ringed = (info) => info && info.outline !== "none" && info.width >= 2;
  if (!/skip-link/.test(seen[0]?.cls || "")) problems.push("first Tab target is not the skip link");
  if (!ringed(seen[0])) problems.push("skip link lacks a visible focus ring");
  if (!seen.some((i) => i.inNav && ringed(i))) problems.push("no nav link with a visible focus ring");
  if (!seen.some((i) => i.inMain && ringed(i))) problems.push("no main control with a visible focus ring");

  const scrollNormal = await landing.evaluate(() => getComputedStyle(document.documentElement).scrollBehavior);
  await landing.emulateMedia({ reducedMotion: "reduce" });
  const scrollReduced = await landing.evaluate(() => getComputedStyle(document.documentElement).scrollBehavior);
  await landing.close();
  if (scrollNormal !== "smooth") problems.push(`baseline scroll-behavior = ${scrollNormal}, expected smooth`);
  if (scrollReduced !== "auto") problems.push(`reduced scroll-behavior = ${scrollReduced}, expected auto`);

  // Mobile assistant: sidebar toggle, Escape, and keyboard-driven new conversation.
  const assistant = await open("assistant", MOBILE);
  const toggled = await assistant.evaluate(() => {
    const button = document.querySelector("#sidebar-toggle");
    button.focus();
    return document.activeElement === button;
  });
  if (!toggled) problems.push("sidebar toggle cannot take keyboard focus at 390px");
  await assistant.keyboard.press("Enter");
  if ((await assistant.getAttribute("#sidebar-toggle", "aria-expanded")) !== "true") problems.push("Enter did not open the sidebar");
  if (!(await assistant.locator("#assistant-sidebar").isVisible())) problems.push("sidebar not visible after Enter");
  await assistant.keyboard.press("Escape");
  if ((await assistant.getAttribute("#sidebar-toggle", "aria-expanded")) !== "false") problems.push("Escape did not close the sidebar");
  const focusBack = await assistant.evaluate(() => document.activeElement?.id === "sidebar-toggle");
  if (!focusBack) problems.push("focus not returned to sidebar toggle after Escape");

  await assistant.focus("#new-conversation");
  await assistant.keyboard.press("Enter");
  const keyboardState = await assistant.evaluate(() => ({
    conversations: document.querySelectorAll("#conversation-list li").length,
    active: document.querySelector("#current-conversation")?.textContent || "",
    messages: document.querySelectorAll("#message-list li").length,
    textareaDisabled: document.querySelector("#message-input")?.disabled === true,
    sendDisabled: document.querySelector("#send-message")?.disabled === true
  }));
  if (keyboardState.conversations !== 1 || !/New conversation/.test(keyboardState.active)) {
    problems.push(`keyboard New conversation failed: ${JSON.stringify(keyboardState)}`);
  }
  if (keyboardState.messages !== 0) problems.push("New conversation fabricated a message");
  if (!keyboardState.textareaDisabled || !keyboardState.sendDisabled) problems.push("composer enabled at mobile after new conversation");

  await assistant.emulateMedia({ reducedMotion: "reduce" });
  const transition = await assistant.evaluate(() =>
    getComputedStyle(document.querySelector(".assistant-panel-head")).transitionDuration);
  if (!/(^|,\s*)0s/.test(transition)) problems.push(`assistant transition under reduced motion = ${transition}`);
  await assistant.close();

  assert.deepEqual(problems, [], `keyboard / reduced-motion failures:\n- ${problems.join("\n- ")}`);
});

// --------------------------------------------------------------- (8) contrast
test("(8) key token and assistant banner contrast ratios meet the documented thresholds", async () => {
  const css = readFileSync(resolve(PUBLIC, "css/tokens.css"), "utf8");
  const token = (name) => {
    const match = new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`).exec(css);
    assert.ok(match, `token --${name} not found in tokens.css`);
    return match[1];
  };
  const lum = (hex) => {
    const c = hex.replace("#", "").match(/../g).map((x) => parseInt(x, 16) / 255)
      .map((v) => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)));
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  };
  const ratio = (a, b) => {
    const x = lum(a), y = lum(b);
    return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
  };
  // [foreground token, background token, minimum, label]
  const pairs = [
    ["ink", "surface", 4.5, "body text / work surface"],
    ["muted", "doc-bg", 4.5, "supporting copy / page canvas"],
    ["faint", "surface-2", 4.5, "stage labels / inset surface"],
    ["accent", "surface", 4.5, "accent / surface"],
    ["caution", "caution-bg", 4.5, "unavailable banner title / caution bg"],
    ["ink-2", "caution-bg", 4.5, "unavailable banner detail / caution bg"],
    ["accent-strong", "caution-bg", 4.5, "unavailable banner link / caution bg"],
    ["danger", "danger-bg", 4.5, "error text / error bg"],
    ["focus", "surface", 3, "focus ring / light surface"]
  ];
  const report = pairs.map(([fg, bg, min, label]) => {
    const value = ratio(token(fg), token(bg));
    return { label, fg: token(fg), bg: token(bg), value: Number(value.toFixed(2)), min, pass: value >= min };
  });
  for (const entry of report) {
    assert.equal(entry.pass, true,
      `${entry.label}: ${entry.value}:1 < ${entry.min}:1 (${entry.fg} on ${entry.bg})`);
  }
  // Footer literals from components.css (dark surface).
  const footerPairs = [
    ["#dce8ee", "13.7", 4.5], ["#b9cbd6", "10.2", 4.5],
    ["#bfe6dd", "12.7", 4.5], ["#94acba", "7.2", 4.5]
  ];
  for (const [fg, , min] of footerPairs) {
    const value = ratio(fg, token("navy-deep"));
    assert.ok(value >= min, `footer ${fg} on navy-deep = ${value.toFixed(2)}:1 < ${min}:1`);
  }
});

// ------------------------------------------------- (9) offline-only guarantee
test("(9) no live provider call escaped the fetch stub and no browser errors occurred", () => {
  const live = allFetchAttempts.filter((a) => /galaxy|smartsbio|ncbi|ebi|uniprot|127\.0\.0\.1/i.test(a.url));
  assert.deepEqual(live, [], `unexpected live provider calls: ${JSON.stringify(live)}`);
  // The AI page may probe the platform's own /api/ai/backend; that request is
  // rejected by the offline stub and is not a live scientific provider call.
  const unexpected = allFetchAttempts.filter((a) =>
    !/api\/assistant\//.test(a.url) && a.url !== "/api/ai/backend");
  assert.deepEqual(unexpected, [], `unexpected network fetches: ${JSON.stringify(unexpected)}`);
  assert.deepEqual(browserErrors, [], `unexpected browser errors:\n- ${browserErrors.join("\n- ")}`);
});
