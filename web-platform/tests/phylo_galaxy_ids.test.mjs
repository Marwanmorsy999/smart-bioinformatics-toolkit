// M7.3.2 closure audit: this fixture is ILLUSTRATIVE and was authored from
// the M7.3.1 report's claims. The original sanitized Galaxy job probe (cached
// outside the repo) had the HDA ids redacted as [ID:32] and did NOT establish
// that the input and output HDAs are the same. These fixtures therefore test
// normalization behaviour only; they are NOT evidence of the real id mapping.

import test from "node:test";
import assert from "node:assert/strict";
import { normalizeOutputAssociation, parseJobOutputs, parseHistoryContents, resolveJobOutput, classifyJobState } from "../providers/galaxy/galaxy_ids.js";

const HISTORY = "11ac94870d0bb33adfdcc31d5164dd84";
const JOB_OUTPUTS = {
  outputAlignment: { id: "40160950115d555ef559061fbced7bce", dataset_id: "310912901", uuid: "cf2a6760-b219-4212-a609-aa37286628f5", src: "hda", name: "MAFFT on data 1", state: "ok", history_id: HISTORY, extension: "fasta" }
};
const CONTENTS = [{
  id: "40160950115d555ef559061fbced7bce", dataset_id: "310912901", uuid: "cf2a6760-b219-4212-a609-aa37286628f5",
  name: "MAFFT on data 1", state: "ok", extension: "fasta", history_id: HISTORY, deleted: false
}];

test("realistic Galaxy output association keeps HDA id and UUID distinct", () => {
  const n = normalizeOutputAssociation(JOB_OUTPUTS.outputAlignment, { historyId: HISTORY });
  assert.equal(n.valid, true);
  assert.equal(n.galaxyHdaId, "40160950115d555ef559061fbced7bce");
  assert.equal(n.galaxyDatasetUuid, "cf2a6760-b219-4212-a609-aa37286628f5");
  assert.notEqual(n.galaxyHdaId, n.galaxyDatasetUuid);
});

test("job output resolves against history contents using HDA id", () => {
  const result = resolveJobOutput(parseJobOutputs(JOB_OUTPUTS, { historyId: HISTORY }), parseHistoryContents(CONTENTS, { historyId: HISTORY }));
  assert.equal(result.valid, true);
  assert.equal(result.hdaId, "40160950115d555ef559061fbced7bce");
});

test("UUID must not be used as an HDA id", () => {
  const bad = resolveJobOutput(parseJobOutputs({ o: { id: "cf2a6760-b219-4212-a609-aa37286628f5", uuid: "cf2a6760-b219-4212-a609-aa37286628f5", state: "ok" } }), parseHistoryContents(CONTENTS));
  assert.equal(bad.valid, false);
  assert.equal(bad.error, "output_not_in_history_contents");
});

test("deleted and wrong-history outputs fail closed with specific errors", () => {
  assert.equal(normalizeOutputAssociation({ id: "abc123de", state: "deleted" }).error, "dataset_deleted");
  assert.equal(normalizeOutputAssociation({ id: "abc123de", history_id: "other", state: "ok" }, { historyId: HISTORY }).error, "history_membership_mismatch");
});

test("polling state machine: ok succeeds, running continues, timeout is genuine", () => {
  assert.equal(classifyJobState("ok"), "succeeded");
  assert.equal(classifyJobState("running"), "running");
  assert.equal(classifyJobState("queued"), "running");
  assert.equal(classifyJobState("failed"), "failed");
  assert.equal(classifyJobState("deleted"), "failed");
  assert.equal(classifyJobState("running", { timedOut: true }), "timeout");
  // A completed job is never reported as timeout, even after the deadline.
  assert.equal(classifyJobState("ok", { timedOut: true }), "succeeded");
});

