import test from "node:test";
import assert from "node:assert/strict";
import { buildSchemaPayload, describeSchema } from "../providers/galaxy/galaxy_schema.js";

const MAFFT = {
  inputs: [
    { model_class: "Conditional", name: "input", test_param: { name: "mapping", value: "implicit" },
      cases: [{ value: "implicit", inputs: [{ model_class: "Repeat", name: "batches", default: 1,
        inputs: [{ model_class: "DataToolParameter", name: "inputs", optional: false, extensions: ["fasta"] }] }] }] },
    { model_class: "Conditional", name: "datatype_selection", test_param: { name: "datatype", value: "" },
      cases: [{ value: "", inputs: [] }] }
  ]
};
const IQTREE = { inputs: [
  { model_class: "Section", name: "general_options", inputs: [
    { model_class: "DataToolParameter", name: "s", optional: true, extensions: ["fasta", "phylip"] },
    { model_class: "SelectToolParameter", name: "seqtype", value: "DNA" }
  ] }
] };

test("M7.3 MAFFT schema payload uses real conditional/repeat field names", () => {
  const result = buildSchemaPayload(MAFFT, "abc123");
  assert.equal(result.valid, true, JSON.stringify(result));
  assert.equal(result.inputs["input|mapping"], "implicit");
  assert.deepEqual(result.inputs["batches_0|inputs"], { src: "hda", id: "abc123" });
  assert.equal(result.inputs["datatype_selection|datatype"], "");
});
test("M7.3 IQ-TREE schema payload maps section data input", () => {
  const result = buildSchemaPayload(IQTREE, "def456");
  assert.equal(result.valid, true);
  assert.deepEqual(result.inputs["general_options|s"], { src: "hda", id: "def456" });
  assert.equal(result.inputs["general_options|seqtype"], "DNA");
});
test("M7.3 fail-closed on incomplete schema", () => {
  assert.equal(buildSchemaPayload({ inputs: [] }, "abc").valid, false);
});
test("M7.3 rejects malformed dataset ids", () => {
  assert.equal(buildSchemaPayload(MAFFT, "../bad").valid, false);
});
test("M7.3 schema description lists verified input names only", () => {
  assert.deepEqual(describeSchema(IQTREE).map((i) => i.name),
    ["general_options", "general_options|s", "general_options|seqtype"]);
});
