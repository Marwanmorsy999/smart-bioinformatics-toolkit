// M7.14 M7.12-history extension tests. Browser-local index only; the actual
// analysis is always re-fetched from the server-side AI run record.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  STORAGE_KEY, sanitizeEntry, captureMicrobiomeRun, listEntries,
  readIndex, upsertEntry
} from "../public/js/research-history.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const read = (relative) => readFileSync(resolve(HERE, "..", relative), "utf8");

function fakeStorage() {
  const map = new Map();
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => map.set(key, String(value)),
    removeItem: (key) => map.delete(key)
  };
}

test("ALLOW-LIST: microbiome is a recognised workflow type and unknown types stay unknown", () => {
  const clean = sanitizeEntry({ run_id: "job_1111111111111111", workflow_type: "microbiome", status: "completed" });
  assert.equal(clean.workflow_type, "microbiome");
  const unknown = sanitizeEntry({ run_id: "job_2222222222222222", workflow_type: "made-up", status: "completed" });
  assert.equal(unknown.workflow_type, "unknown");
  assert.equal(sanitizeEntry({ run_id: "not-a-run-id", workflow_type: "microbiome" }), null);
});

test("CAPTURE: nothing is written without a genuine job_ run id", () => {
  const storage = fakeStorage();
  assert.equal(captureMicrobiomeRun({ run_id: "job_fake", status: "succeeded" }, {}, storage), null);
  assert.equal(captureMicrobiomeRun({ run_id: "run_1111111111111111", status: "succeeded" }, {}, storage), null);
  assert.equal(storage.getItem(STORAGE_KEY), null);
});

test("CAPTURE: a genuine run id stores only metadata; filter returns it", () => {
  const storage = fakeStorage();
  const body = { run_id: "job_aaaaaaaaaaaaaaaa", plan_id: "plan_bbbbbbbbbbbbbbbb",
    history_id: "cccccccccccccccccccccccccccccccc", status: "running",
    job_ids: { demux: "job-1-1", dada2_denoise: "job-3-3" } };
  const entry = captureMicrobiomeRun(body, { objective: "Fixture cohort", sample_ids: ["sampleA", "sampleB"] }, storage);
  assert.ok(entry);
  assert.equal(entry.workflow_type, "microbiome");
  assert.equal(entry.status, "running");
  assert.deepEqual(entry.sequence_ids, ["sampleA", "sampleB"]);
  assert.deepEqual(entry.provider_job_ids, ["job-1-1", "job-3-3"]);
  assert.equal(listEntries(readIndex(storage).entries, "microbiome").length, 1);
  assert.equal(listEntries(readIndex(storage).entries, "phylo").length, 0);
  const stored = JSON.parse(storage.getItem(STORAGE_KEY));
  assert.equal(stored.length, 1);
  assert.ok(!JSON.stringify(stored).includes("metadata_text"));
  assert.ok(!JSON.stringify(stored).includes("operator job"));
  upsertEntry({ ...entry, status: "completed" }, storage);
  assert.equal(readIndex(storage).entries[0].status, "completed");
});

test("PAGE: history exposes a microbiome filter and server-side recovery fields", () => {
  const html = read("public/history.html");
  assert.match(html, /data-history-filter="microbiome"/);
  for (const id of ["history-microbiome-status", "history-microbiome-input", "history-microbiome-composition",
    "history-microbiome-alpha", "history-microbiome-pcoa", "history-microbiome-downloads"]) {
    assert.ok(html.includes(`id="${id}"`), `${id} is missing from history.html`);
  }
  const script = read("public/js/research-history.js");
  assert.match(script, /workflow_type === "microbiome"/);
  assert.match(script, /fetchJson\(runUrl\)/);
  assert.match(script, /recoveryUrl/);
  assert.match(script, /captureMicrobiomeRun/);
});
