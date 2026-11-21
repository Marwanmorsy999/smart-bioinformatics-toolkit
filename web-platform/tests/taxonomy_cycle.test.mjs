import test from "node:test";
import assert from "node:assert/strict";
import { parseTaxonomyMap } from "../public/js/taxonomy.js";

test("parseTaxonomyMap rejects cyclic parent links", () => {
  const text = [
    "taxid\tscientific_name\trank\tparent_taxid\tfull_lineage",
    "1\tA\tspecies\t2\tA",
    "2\tB\tgenus\t1\tB",
  ].join("\n");
  const res = parseTaxonomyMap(text);
  assert.equal(res.valid, false);
  assert.ok(res.errors.some((e) => /cycle/i.test(e)));
});
