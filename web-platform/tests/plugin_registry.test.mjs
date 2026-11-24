import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";

import {
  TOOLS,
  getTool,
  isKnownTool,
  toolIds,
  validateParams,
} from "../functions/api/ai/registry.js";
import { TOOLS as GENERATED_TOOLS } from "../functions/api/ai/registry.tools.generated.js";

test("registry re-exports the checked-in generated tools", () => {
  assert.deepEqual(TOOLS, GENERATED_TOOLS);
  assert.ok(TOOLS.length >= 4);
});

test("every registry entry carries the fields the Worker uses", () => {
  const fields = [
    "id", "name", "description", "version", "backend", "domain", "available",
    "external_egress", "requirements", "estimated_seconds", "params_schema",
    "input_schema", "output_schema", "references", "limitations",
  ];
  for (const tool of TOOLS) {
    for (const field of fields) assert.ok(Object.hasOwn(tool, field), `${tool.id}: ${field}`);
    assert.equal(typeof tool.available, "boolean");
    assert.ok(Array.isArray(tool.references) && tool.references.length > 0, tool.id);
    assert.ok(Array.isArray(tool.limitations) && tool.limitations.length > 0, tool.id);
    if (!tool.available) assert.ok(tool.unavailable_reason, `${tool.id}: unavailable_reason`);
  }
});

test("registry includes every tool declared by a shipped manifest", () => {
  const dir = new URL("../../shared/plugins/", import.meta.url);
  const ids = [];
  for (const name of readdirSync(dir).filter((name) => name.endsWith(".json")).sort()) {
    const manifest = JSON.parse(readFileSync(new URL(name, dir), "utf8"));
    ids.push(...manifest.tools.map((tool) => tool.id));
  }
  assert.deepEqual(new Set(toolIds()), new Set(ids));
  assert.ok(isKnownTool("sequence-stats.profile"));
  assert.equal(isKnownTool("not.a.tool"), false);
  assert.equal(getTool("sequence-stats.profile").available, true);
  assert.deepEqual(getTool("missing"), null);
});

test("params validation still rejects unknown and missing parameters", () => {
  assert.deepEqual(validateParams("sequence-stats.profile", { sequence_type: "dna" }), {
    valid: true,
    error: null,
  });
  assert.equal(validateParams("sequence-stats.profile", { sequence_type: "rna" }).valid, false);
  assert.equal(validateParams("sequence-stats.profile", {}).valid, false);
  assert.equal(validateParams("not.a.tool", {}).valid, false);
});
