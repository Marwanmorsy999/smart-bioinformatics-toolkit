// GET /api/workspace/demo - fixed, clearly labelled sample payload.
// Static module data: no D1 writes, no provider calls, no execution.

import { jsonResponse } from "../ai/_lib.js";
import { deriveOwner, requireAnyMethod, requireDb } from "./_lib.js";

const DISCLAIMER = "Fixed sample data for interface development only. This is NOT a newly executed analysis, NOT a scientific result, and no bytes, jobs or provider references were created.";
const LABELS = Object.freeze({
  is_demo: true,
  sample: true,
  execution_mode: "precomputed",
  disclaimer: DISCLAIMER
});

const PROJECT_ID = "proj_0000000000000000";

// Static and immutable by convention; the handler returns a deep copy so a
// caller cannot mutate the shared payload.
const DEMO_PAYLOAD = Object.freeze({
  ...LABELS,
  generated_at: "2026-11-26T00:00:00.000Z",
  project: Object.freeze({
    ...LABELS,
    id: PROJECT_ID,
    name: "Sample: 16S isolate panel",
    description: "Illustrative project used only to demonstrate workspace layout.",
    scientific_objective: "Demonstrate how a 16S objective is displayed beside its runs.",
    status: "active",
    created_at: "2026-11-26T00:00:00.000Z",
    updated_at: "2026-11-26T00:00:00.000Z",
    dataset_count: 2,
    run_count: 2
  }),
  datasets: Object.freeze([
    Object.freeze({
      ...LABELS,
      id: "ds_0000000000000001",
      project_id: PROJECT_ID,
      filename: "sample_panel.fasta",
      sha256: "d34db33fd34db33fd34db33fd34db33fd34db33fd34db33fd34db33fd34db33f",
      size_bytes: 1234,
      mime: "text/plain",
      file_format: "fasta",
      source: "sample-fixture",
      validation_state: "passed",
      provider_history_ref: null,
      storage_ref: "metadata-only://none",
      uploaded_at: "2026-11-26T00:00:00.000Z",
      created_at: "2026-11-26T00:00:00.000Z",
      fasta_text_present: false
    }),
    Object.freeze({
      ...LABELS,
      id: "ds_0000000000000002",
      project_id: PROJECT_ID,
      filename: "sample_tree_reference.fasta",
      sha256: "a1b2c3d4a1b2c3d4a1b2c3d4a1b2c3d4a1b2c3d4a1b2c3d4a1b2c3d4a1b2c3d4",
      size_bytes: 512,
      mime: "text/plain",
      file_format: "fasta",
      source: "sample-fixture",
      validation_state: "passed",
      provider_history_ref: "sample-history-ref-only",
      storage_ref: "metadata-only://provider-history",
      uploaded_at: "2026-11-26T00:00:00.000Z",
      created_at: "2026-11-26T00:00:00.000Z",
      fasta_text_present: false
    })
  ]),
  runs: Object.freeze([
    Object.freeze({
      ...LABELS,
      id: "run_0000000000000001",
      project_id: PROJECT_ID,
      workflow_id: "16s-rrna-identification",
      workflow_version: "1.0.0",
      objective: "Sample objective: identify the isolate panel.",
      state: "succeeded",
      created_at: "2026-11-26T00:00:00.000Z",
      completed_at: "2026-11-26T00:00:01.000Z",
      input_datasets: ["ds_0000000000000001"],
      execution_provider: "sample-fixture",
      execution_mode: "precomputed",
      validation_status: "passed",
      is_demo: true,
      sample: true,
      disclaimer: DISCLAIMER
    }),
    Object.freeze({
      ...LABELS,
      id: "run_0000000000000002",
      project_id: PROJECT_ID,
      workflow_id: "msa-phylogenetics",
      workflow_version: "1.0.0",
      objective: "Sample objective: align and build a tree (NOT executed).",
      state: "planned",
      created_at: "2026-11-26T00:00:02.000Z",
      completed_at: null,
      input_datasets: ["ds_0000000000000002"],
      execution_provider: null,
      execution_mode: "precomputed",
      validation_status: "pending",
      is_demo: true,
      sample: true,
      disclaimer: DISCLAIMER
    })
  ])
});

export { DEMO_PAYLOAD };

export async function onRequest(context) {
  const rejected = requireAnyMethod(context.request, ["GET"]);
  if (rejected) return rejected;
  return handleDemo(context.request, context.env);
}

export async function handleDemo(request, env) {
  const { error: authError } = await deriveOwner(request, env);
  if (authError) return authError;
  const { error: dbError } = requireDb(env, request);
  if (dbError) return dbError;
  // payload.execution_mode stays "precomputed" on every object: this endpoint
  // must never be mistaken for a record of a fresh execution.
  const payload = JSON.parse(JSON.stringify(DEMO_PAYLOAD));
  return jsonResponse(payload, 200, request);
}
