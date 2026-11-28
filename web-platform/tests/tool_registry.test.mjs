// Public capability catalog: honest projection tests. No tool is invented and
// no execution claim is upgraded. Everything here is offline.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  AVAILABILITY_STATES, EXECUTION_LOCATIONS, TOOL_CATALOG, TOOL_CATALOG_VERSION,
  catalogIds, getCatalogEntry, listCatalog
} from "../providers/tools/registry.js";
import { TOOLS, WORKER_TOOLS } from "../functions/api/ai/registry.js";
import { ALLOWED_DATABASE, ALLOWED_PROGRAM } from "../functions/api/blast/_lib.js";
import { classifyIntent, buildPlan } from "../functions/api/ai/planner.js";
import { validatePlan } from "../functions/api/ai/_lib.js";
import { CATALOG_VERSION, WORKFLOWS } from "../functions/api/workspace/catalog.js";
import { onRequest as onToolCatalog } from "../functions/api/tools/catalog/index.js";
import { createFetch } from "../worker.js";

const ORIGIN = "https://worker.example.test";

function context(path, init = {}) {
  return {
    request: new Request(ORIGIN + path, init),
    // Deliberately hostile secrets: none may appear in a public response.
    env: { NINEROUTER_API_KEY: "sk-tool-catalog-secret", AI_AGENT_TOKEN: "agent-token-secret" },
    params: {}
  };
}

test("the capability catalog is derived from the real sources and invents no tools", () => {
  const expected = new Set([
    ...WORKFLOWS.map((workflow) => workflow.id),
    ...TOOLS.map((tool) => tool.id),
    ...WORKER_TOOLS.map((tool) => tool.id)
  ]);
  assert.deepEqual(new Set(catalogIds()), expected);
  assert.equal(TOOL_CATALOG_VERSION, CATALOG_VERSION);

  const fields = [
    "id", "kind", "scientific_purpose", "description", "input_schema", "output_schema",
    "supported_formats", "validation_requirements", "execution_location", "availability",
    "version", "dependencies", "limitations", "entry_point"
  ];
  const entries = listCatalog();
  assert.equal(entries.length, TOOL_CATALOG.length);
  for (const entry of entries) {
    for (const field of fields) assert.ok(Object.hasOwn(entry, field), `${entry.id}: ${field}`);
    assert.ok(AVAILABILITY_STATES.includes(entry.availability), `${entry.id}: availability`);
    assert.ok(Array.isArray(entry.execution_location) && entry.execution_location.length > 0, entry.id);
    for (const location of entry.execution_location) {
      assert.ok(EXECUTION_LOCATIONS.includes(location), `${entry.id}: location ${location}`);
    }
    assert.ok(typeof entry.entry_point.href === "string" && entry.entry_point.href.length > 0, entry.id);
    assert.ok(Array.isArray(entry.limitations) && entry.limitations.length > 0, entry.id);
  }
  assert.equal(getCatalogEntry("not.a.tool"), null);
  // No caller may mutate the frozen single source of truth.
  entries[0].availability = "blocked";
  assert.notEqual(TOOL_CATALOG[0].availability, "blocked");
});

test("phylogenetics stays partial and no MAFFT to IQ-TREE completion is claimed", () => {
  const workflow = getCatalogEntry("msa-phylogenetics");
  assert.equal(workflow.availability, "partial");
  assert.equal(workflow.production_ready, false);
  assert.ok(workflow.blocked_paths.length > 0);
  assert.match(workflow.limitations.join(" "), /not verified/i);
  assert.doesNotMatch(JSON.stringify(workflow),
    /full workflow completed|MAFFT alignment → IQ-TREE tree, executed|executed remotely with full provenance/i);

  const tool = getCatalogEntry("phylogenetics.workflow");
  assert.equal(tool.availability, "local-only");
  // The generated tool registry declares availability, not production readiness.
  assert.equal(tool.production_ready, null);
  assert.equal(tool.workflow_context.production_ready, false);
  assert.equal(tool.workflow_context.availability, "partial");

  const sixteenS = getCatalogEntry("16s-rrna-identification");
  assert.equal(sixteenS.availability, "available");
  assert.equal(sixteenS.production_ready, true);

  for (const id of ["microbiome-16s.blast-parse", "microbiome-16s.taxonomy"]) {
    assert.equal(getCatalogEntry(id).availability, "disabled");
    assert.equal(getCatalogEntry(id).available, false);
  }
});

test("GET /api/tools/catalog has the public read-only shape and leaks no secret", async () => {
  const response = await onToolCatalog(context("/api/tools/catalog", {
    headers: { Origin: ORIGIN }
  }));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Content-Type"), "application/json; charset=utf-8");
  assert.equal(response.headers.get("X-Content-Type-Options"), "nosniff");
  assert.equal(response.headers.get("Access-Control-Allow-Origin"), ORIGIN);

  const body = await response.json();
  assert.deepEqual(Object.keys(body).sort(), ["catalog_version", "tools"]);
  assert.equal(body.catalog_version, CATALOG_VERSION);
  assert.equal(body.tools.length, TOOL_CATALOG.length);
  const wire = JSON.stringify(body) + JSON.stringify([...response.headers]);
  for (const secret of ["sk-tool-catalog-secret", "agent-token-secret"]) {
    assert.equal(wire.includes(secret), false, `leaked ${secret}`);
  }
});

test("the catalog endpoint refuses mutations and offers an OPTIONS preflight", async () => {
  const post = await onToolCatalog(context("/api/tools/catalog", { method: "POST" }));
  assert.equal(post.status, 405);
  assert.equal(post.headers.get("Allow"), "GET, OPTIONS");
  const options = await onToolCatalog(context("/api/tools/catalog", { method: "OPTIONS" }));
  assert.equal(options.status, 204);
});

test("the Worker serves the new catalog route without changing GET /api/tools", async () => {
  const fetchWorker = createFetch();
  const env = { ASSETS: { fetch() { throw new Error("API paths must not reach assets"); } } };

  const catalogResponse = await fetchWorker(new Request(`${ORIGIN}/api/tools/catalog/`), env, {});
  assert.equal(catalogResponse.status, 200);
  const catalog = await catalogResponse.json();
  assert.equal(Array.isArray(catalog.tools), true);
  assert.equal(catalog.catalog_version, CATALOG_VERSION);

  const legacyResponse = await fetchWorker(new Request(`${ORIGIN}/api/tools`), env, {});
  assert.equal(legacyResponse.status, 200);
  const legacy = await legacyResponse.json();
  assert.equal(legacy.execution_mode, "real");
  assert.equal(Object.hasOwn(legacy, "catalog_version"), false);
  assert.deepEqual(legacy.tools, TOOLS);
});

test("the assistant page stays honest: read-only catalog, disabled composer, no fabricated success", () => {
  const html = readFileSync(new URL("../public/assistant.html", import.meta.url), "utf8");
  const js = readFileSync(new URL("../public/js/assistant.js", import.meta.url), "utf8");
  for (const fragment of [
    "Capability browser — real registered tools and workflows",
    "Deterministic plan draft — not AI-generated and not an approved execution.",
    "I understand execution requires the existing approval and consent flow",
    "/api/tools/catalog",
    "href=\"16s.html\""
  ]) {
    assert.equal(html.includes(fragment), true, fragment);
  }
  assert.match(html, /AI chat is unavailable: no authorized model provider is configured for this deployment\./);
  assert.match(html, /<textarea[^>]*\bdisabled/);
  for (const falseClaim of [
    /assistant (?:said|answered|responded) with a result/i,
    /chat is (?:working|available|connected)/i,
    /here is your (?:result|answer)/i,
    /analysis completed successfully/i,
    /AI-generated result/i
  ]) {
    assert.doesNotMatch(html, falseClaim);
  }
  // The browser never invents capabilities when served from an offline file.
  assert.match(js, /location\.protocol !== "http:" && location\.protocol !== "https:"/);
});

test("identify_taxa hands off to a real Worker BLAST step with egress and consent", () => {
  assert.equal(classifyIntent("identify taxa from these 16S sequences").intent, "identify_taxa");
  const { plan, clarifyingQuestion } = buildPlan({
    text: "Identify taxa from these 16S sequences",
    datasetId: "ds_0123456789abcdef",
    requestId: "req_0123456789abcdef",
    now: Date.parse("2026-11-24T12:00:00.000Z")
  });
  assert.equal(clarifyingQuestion, null);
  assert.ok(plan);
  assert.equal(validatePlan(plan).valid, true);
  assert.equal(plan.steps.length, 1);
  const step = plan.steps[0];
  assert.equal(step.tool_id, "ncbi.blastn");
  // Worker-side registration is additive: generated tool ids are untouched.
  assert.deepEqual(getCatalogEntry("ncbi.blastn").source.registry, "functions/api/ai/registry.js");
  assert.equal(getCatalogEntry("ncbi.blastn").entry_point.href, "16s.html");
  assert.deepEqual(step.params, { database: ALLOWED_DATABASE, program: ALLOWED_PROGRAM });
  assert.equal(step.external_egress, true);
  assert.equal(step.consent_required, true);
  assert.deepEqual(plan.consents_required, ["external-blast"]);
  assert.ok(plan.external_services.join(" ").includes("blast.ncbi.nlm.nih.gov"));
  const limitations = plan.limitations.join(" ");
  assert.match(limitations, /approval and consent/i);
  assert.match(limitations, /mock/i);
  assert.doesNotMatch(limitations, /no external service is contacted/i);
  // The profile intent is unchanged and still performs no egress.
  const profile = buildPlan({
    text: "profile my FASTA",
    datasetId: "ds_0123456789abcdef",
    requestId: "req_0123456789abcdef"
  }).plan;
  assert.equal(profile.steps[0].tool_id, "sequence-stats.profile");
  assert.equal(profile.steps[0].external_egress, false);
});
