import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { safeCsvCell } from "../public/js/csv-safe.js";

const here = dirname(fileURLToPath(import.meta.url));
const CASES = JSON.parse(readFileSync(resolve(here, "../../shared/test-cases/csv_injection_cases.json"), "utf8")).cases;

test("shared CSV injection cases (Python parity)", () => {
  for (const c of CASES) {
    assert.equal(safeCsvCell(c.input), c.expected, JSON.stringify(c));
  }
});
