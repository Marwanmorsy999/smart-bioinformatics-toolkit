import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import { computeVerdict, DISCLAIMER } from "../public/js/verdict.js";
import { DIFFICULT_GROUPS } from "../public/js/difficult-groups.js";

const here = dirname(fileURLToPath(import.meta.url));
const shared = (p) => JSON.parse(readFileSync(resolve(here, "../../shared", p), "utf8"));
const CASES = shared("test-cases/verdict_cases.json").cases;

for (const c of CASES) {
  test(`shared verdict case: ${c.name}`, () => {
    const out = computeVerdict(c.consensus, { ...c.options, groups: DIFFICULT_GROUPS });
    assert.equal(out.status, c.expected.status);
    assert.equal(out.reported_rank, c.expected.reported_rank);
    assert.equal(out.reported_taxon, c.expected.reported_taxon);
    assert.deepEqual(out.caution_flags, [...c.expected.caution_flags].sort());
    assert.deepEqual(
      new Set(out.evidence_summary.qualifying_species.map((r) => r.species)),
      new Set(c.expected.qualifying_species)
    );
  });
}

test("embedded difficult groups match shared JSON", () => {
  assert.deepEqual(DIFFICULT_GROUPS, shared("difficult-groups.json").groups);
});

test("verdict always carries the research-use disclaimer", () => {
  const out = computeVerdict({ candidate_count: 0, evidence: [] });
  assert.equal(out.disclaimer, DISCLAIMER);
  assert.match(out.disclaimer, /not proof/);
});
