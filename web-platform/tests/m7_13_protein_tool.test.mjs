// M7.13 OFFLINE TOOL TESTS. The four protein tools are real executors on the
// existing assistant/catalog path, with versioned output, checksum, provenance
// and fail-closed errors. Provider calls are stubbed; no live EBI call is made.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { executeTool, getAssistantToolDefinitions } from "../functions/api/assistant/tools.js";
import {
  PROTEIN_ASSISTANT_TOOL_IDS, executeProteinTool, getProteinToolDefinitions
} from "../functions/api/assistant/protein-tools.js";
import { getTool, validateParams } from "../functions/api/ai/registry.js";
import { listCatalog } from "../providers/tools/registry.js";
import { createFakeD1AI, mockAIEnv } from "./helpers/fake-d1.mjs";
import { handleAnnotate } from "../functions/api/protein/workflow.js";

const fasta = readFileSync(new URL("./fixtures/m7_13_protein/P04637.fasta", import.meta.url), "utf8");
const matches = JSON.parse(readFileSync(new URL("./fixtures/m7_13_protein/matches-P04637.json", import.meta.url), "utf8"));
const uniprot = JSON.parse(readFileSync(new URL("./fixtures/m7_13_protein/uniprot-P04637.json", import.meta.url), "utf8"));
const interproProtein = JSON.parse(readFileSync(new URL("./fixtures/m7_13_protein/interpro-protein-P04637.json", import.meta.url), "utf8"));

function ids() {
  let counter = 1;
  return (kind) => `${kind}_${(counter++).toString(16).padStart(16, "0")}`;
}

function stub(handler) {
  return async (url, init) => handler(String(url), init ?? {});
}

function genuineFetch(url) {
  if (url.includes("rest.uniprot.org")) return new Response(JSON.stringify(uniprot));
  if (url.includes("interpro/api/protein")) return new Response(JSON.stringify(interproProtein));
  if (url.includes("/matches/api/matches/")) return new Response(JSON.stringify(matches));
  if (url.includes("/entry/interpro/IPR")) return new Response(JSON.stringify({ metadata: { go_terms: [] } }));
  return new Response("{}", { status: 404 });
}

test("REGISTRY: all four protein tools are versioned, schema-validated and in the catalog", () => {
  for (const id of PROTEIN_ASSISTANT_TOOL_IDS) {
    const tool = getTool(id);
    assert.ok(tool, id);
    assert.match(tool.version, /m7\.13/);
    assert.equal(tool.params_schema.additionalProperties, false);
    assert.equal(validateParams(id, {}).valid, false, `${id} rejects empty params`);
  }
  assert.equal(validateParams("protein.validate", { mode: "accession" }).valid, true);
  assert.equal(validateParams("protein.validate", { mode: "dna" }).valid, false);
  assert.equal(validateParams("protein.get_domain_details", { run_id: "job_1", accession: "IPR011615", extra: 1 }).valid, false);
  const catalog = listCatalog();
  for (const id of PROTEIN_ASSISTANT_TOOL_IDS) {
    const entry = catalog.find((item) => item.id === id);
    assert.ok(entry, `catalog contains ${id}`);
    assert.equal(entry.kind, "tool");
    assert.ok(entry.entry_point.href.endsWith(".html"));
  }
  const definitions = getAssistantToolDefinitions();
  assert.deepEqual(definitions.filter((item) => PROTEIN_ASSISTANT_TOOL_IDS.includes(item.function.name))
    .map((item) => item.function.name), [...PROTEIN_ASSISTANT_TOOL_IDS]);
  assert.deepEqual(getProteinToolDefinitions().map((item) => item.function.name), [...PROTEIN_ASSISTANT_TOOL_IDS]);
  for (const definition of definitions) {
    assert.equal(definition.function.parameters.additionalProperties, false);
  }
});

test("protein.validate returns genuine validation, checksum and provenance; invalid args fail closed", async () => {
  const result = await executeProteinTool("protein.validate", { mode: "fasta", fasta_text: fasta });
  assert.equal(result.ok, true);
  assert.equal(result.execution_state, "completed");
  assert.match(result.tool_version, /m7\.13/);
  assert.equal(result.output.validation.records[0].md5, "c133dfce69f606f20865e9008199f852");
  assert.match(result.checksum, /^[0-9a-f]{64}$/);
  assert.equal(result.provenance.basis, "local_protein_validator");
  const accession = await executeProteinTool("protein.validate", { mode: "accession", accession: "P04637" },
    { fetch: stub(genuineFetch) });
  assert.equal(accession.ok, true);
  assert.equal(accession.output.validation.uniprot.reviewed, true);
  const invalid = await executeProteinTool("protein.validate", { mode: "fasta", fasta_text: "ACGTACGTACGTACGTACGTACGTACGTACGTACGTACGT" });
  assert.equal(invalid.output.validation.valid, false);
  assert.match(invalid.result_card.summary, /error/);
  const bad = await executeProteinTool("protein.validate", { mode: "accession", accession: "???" });
  assert.equal(bad.ok, false);
  assert.equal(bad.error.code, "invalid_arguments");
  const unknown = await executeProteinTool("protein.fabricate", {});
  assert.equal(unknown.error.code, "unknown_tool");
});

test("protein.annotate is a real executor for Route A and refuses auto-submitted Route B", async () => {
  const { db } = createFakeD1AI();
  const env = mockAIEnv(db);
  const result = await executeTool("protein.annotate", { route: "precomputed", mode: "fasta", fasta_text: fasta },
    { env, fetch: stub(genuineFetch) });
  assert.equal(result.ok, true);
  assert.equal(result.provenance.route_label, "precomputed_reference_annotation");
  assert.equal(result.output.result.body.proteins[0].annotation.features.length, 32);
  assert.match(result.result_card.summary, /write side-effect in AI D1/);
  const refused = await executeProteinTool("protein.annotate", { route: "iprscan6", mode: "fasta", fasta_text: fasta },
    { env, fetch: stub(genuineFetch) });
  assert.equal(refused.execution_state, "refused");
  assert.equal(refused.error.code, "route_b_requires_explicit_ui_action");
});

test("protein.get_result and protein.get_domain_details read only stored evidence", async () => {
  const { db } = createFakeD1AI();
  const env = mockAIEnv(db);
  const idFactory = ids();
  const body = await (await handleAnnotate(new Request("https://worker.internal/api/ai/workflows/protein/annotate", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mode: "fasta", fasta_text: fasta })
  }), env, { fetchImpl: stub(genuineFetch), idFactory })).json();
  const result = await executeProteinTool("protein.get_result", { run_id: body.run_id }, { env });
  assert.equal(result.ok, true);
  assert.equal(result.provenance.basis, "stored_protein_run");
  assert.equal(result.output.result.route_label, "precomputed_reference_annotation");
  const details = await executeProteinTool("protein.get_domain_details",
    { run_id: body.run_id, accession: "IPR011615" }, { env });
  assert.equal(details.ok, true);
  assert.equal(details.output.details.entry.accession, "IPR011615");
  const absent = await executeProteinTool("protein.get_result", { run_id: "job_0000000000000000" }, { env });
  assert.equal(absent.ok, true);
  assert.equal(absent.output.result, null);
  assert.match(absent.output.reason, /No stored result/);
  const missingDetails = await executeProteinTool("protein.get_domain_details",
    { run_id: body.run_id, accession: "IPR999999" }, { env });
  assert.equal(missingDetails.ok, true);
  assert.equal(missingDetails.output.details, null);
  const invalidRun = await executeProteinTool("protein.get_result", { run_id: "not-a-run" }, { env });
  assert.equal(invalidRun.error.code, "invalid_arguments");
  const noDb = await executeProteinTool("protein.get_result", { run_id: body.run_id }, { env: {} });
  assert.equal(noDb.error.code, "database_unavailable");
});
