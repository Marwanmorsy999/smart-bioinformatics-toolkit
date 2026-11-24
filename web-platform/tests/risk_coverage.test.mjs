import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { evaluateRiskCase, riskCoverageSweep } from "../public/js/risk-coverage.js";

const here = dirname(fileURLToPath(import.meta.url));
const CASES = JSON.parse(readFileSync(resolve(here, "../../shared/test-cases/risk_coverage_cases.json"), "utf8")).cases;

test("shared risk cases evaluate (Python parity)", () => {
  for (const c of CASES) {
    const out = evaluateRiskCase(c, 98.65);
    assert.equal(out.call, c.expected_call, c.name);
    assert.equal(out.correct, c.expected_correct, c.name);
  }
});

test("sweep call rate decreases as threshold rises", () => {
  const thresholds = [97.0, 98.0, 98.65, 99.0, 99.9];
  const rows = riskCoverageSweep(CASES, thresholds);
  assert.equal(rows.length, thresholds.length);
  assert.ok(rows[0].calls >= rows[rows.length - 1].calls);
  for (const r of rows) {
    assert.ok(r.species_call_rate >= 0 && r.species_call_rate <= 1);
  }
});
