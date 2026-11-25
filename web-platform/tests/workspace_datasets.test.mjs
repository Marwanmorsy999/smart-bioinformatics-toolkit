import test from "node:test";
import assert from "node:assert/strict";
import { handleCreateDataset, handleListDatasets } from "../functions/api/workspace/projects/[id]/datasets.js";
import { makeRequest, TOKEN_A, TOKEN_B, ownerOf, newWorkspaceEnv, SHA256_A, SHA256_B } from "./helpers/workspace.mjs";

const PROJECT_A = "proj_1111111111111111";
const PROJECT_B = "proj_2222222222222222";

function seed(ownerA, ownerB) {
  return {
    projects: [
      { public_id: PROJECT_A, name: "Mine", owner: ownerA, status: "active", created_at: "2026-11-26T00:00:00.000Z" },
      { public_id: PROJECT_B, name: "Theirs", owner: ownerB, status: "active", created_at: "2026-11-26T00:00:00.000Z" }
    ]
  };
}

function validPayload(extra = {}) {
  return {
    filename: "isolates.fasta",
    sha256: SHA256_A,
    size_bytes: 4096,
    file_format: "fasta",
    source: "field-survey",
    validation_state: "passed",
    ...extra
  };
}

function idsFactory() {
  let counter = 0;
  return (prefix) => `${prefix}_${(++counter).toString(16).padStart(16, "0")}`;
}

test("dataset registration stores metadata only and no FASTA bytes", async () => {
  const owner = await ownerOf(TOKEN_A);
  const { env, state } = newWorkspaceEnv(seed(owner, await ownerOf(TOKEN_B)));
  const response = await handleCreateDataset(makeRequest("POST", `/api/workspace/projects/${PROJECT_A}/datasets`, TOKEN_A, validPayload()), env, PROJECT_A, { idFactory: idsFactory() });
  assert.equal(response.status, 201);
  const body = await response.json();
  assert.equal(body.bytes_uploaded, false);
  assert.equal(body.storage_policy, "metadata-only");
  assert.equal(body.dataset.storage_ref, "metadata-only://none");
  assert.equal(body.dataset.fasta_text_present, false);
  assert.equal(Object.hasOwn(body.dataset, "fasta_text"), false);
  assert.equal(Object.hasOwn(body.dataset, "fasta_text_present"), true);
  const stored = state.tables.datasets[0];
  assert.equal(stored.fasta_text, null);
  assert.equal(stored.owner, owner);
  assert.equal(stored.sha256, SHA256_A);
  assert.equal(stored.file_format, "fasta");
  assert.equal(stored.validation_state, "passed");
  assert.equal(stored.is_demo, 0);
  assert.equal(state.tables.audit_events[0].detail_json.includes("bytes_uploaded\":false"), true);
});

test("provider history reference is stored as a reference with a metadata-only marker", async () => {
  const owner = await ownerOf(TOKEN_A);
  const { env, state } = newWorkspaceEnv(seed(owner, await ownerOf(TOKEN_B)));
  const response = await handleCreateDataset(
    makeRequest("POST", `/api/workspace/projects/${PROJECT_A}/datasets`, TOKEN_A, validPayload({ provider_history_ref: "history-abc-123" })),
    env, PROJECT_A, { idFactory: idsFactory() }
  );
  assert.equal(response.status, 201);
  assert.equal((await response.json()).dataset.storage_ref, "metadata-only://provider-history");
  assert.equal(state.tables.datasets[0].provider_history_ref, "history-abc-123");
  assert.equal(state.tables.datasets[0].fasta_text, null);
});

test("public URL fields and http history references are rejected", async () => {
  const owner = await ownerOf(TOKEN_A);
  const { env } = newWorkspaceEnv(seed(owner, await ownerOf(TOKEN_B)));
  for (const extra of [
    { url: "https://example.test/public" },
    { download_url: "https://example.test/file" },
    { public_url: "https://example.test/file" },
    { artifact_url: "https://example.test/file" },
    { provider_history_ref: "https://example.test/history" }
  ]) {
    const response = await handleCreateDataset(
      makeRequest("POST", `/api/workspace/projects/${PROJECT_A}/datasets`, TOKEN_A, validPayload(extra)),
      env, PROJECT_A, { idFactory: idsFactory() }
    );
    assert.equal(response.status, 400, JSON.stringify(extra));
  }
});

test("dataset registration validates filename, hash, size and validation state", async () => {
  const owner = await ownerOf(TOKEN_A);
  const { env } = newWorkspaceEnv(seed(owner, await ownerOf(TOKEN_B)));
  const invalid = [
    { ...validPayload(), filename: "" },
    { ...validPayload(), filename: "../escape.fasta" },
    { ...validPayload(), sha256: "not-hex" },
    { ...validPayload(), sha256: SHA256_B.toUpperCase() },
    { ...validPayload(), size_bytes: -1 },
    { ...validPayload(), size_bytes: 1.5 },
    { ...validPayload(), validation_state: "unknown" }
  ];
  for (const payload of invalid) {
    const response = await handleCreateDataset(
      makeRequest("POST", `/api/workspace/projects/${PROJECT_A}/datasets`, TOKEN_A, payload),
      env, PROJECT_A, { idFactory: idsFactory() }
    );
    assert.equal(response.status, 400, JSON.stringify(payload).slice(0, 80));
  }
});

test("dataset parent project must be owned by the caller", async () => {
  const ownerA = await ownerOf(TOKEN_A);
  const ownerB = await ownerOf(TOKEN_B);
  const { env, state } = newWorkspaceEnv(seed(ownerA, ownerB));
  const response = await handleCreateDataset(
    makeRequest("POST", `/api/workspace/projects/${PROJECT_B}/datasets`, TOKEN_A, validPayload()),
    env, PROJECT_B, { idFactory: idsFactory() }
  );
  assert.equal(response.status, 404);
  assert.equal((state.tables.datasets ?? []).length, 0);
});

test("dataset registration requires the operator token", async () => {
  const owner = await ownerOf(TOKEN_A);
  const { env } = newWorkspaceEnv(seed(owner, await ownerOf(TOKEN_B)));
  const response = await handleCreateDataset(
    makeRequest("POST", `/api/workspace/projects/${PROJECT_A}/datasets`, null, validPayload()),
    env, PROJECT_A, { idFactory: idsFactory() }
  );
  assert.equal(response.status, 401);
});

test("dataset list is scoped to project and owner", async () => {
  const ownerA = await ownerOf(TOKEN_A);
  const ownerB = await ownerOf(TOKEN_B);
  const { env } = newWorkspaceEnv({
    ...seed(ownerA, ownerB),
    datasets: [
      { public_id: "ds_aaaaaaaaaaaaaaaa", project_id: PROJECT_A, owner: ownerA, filename: "mine.fasta", sha256: SHA256_A, created_at: "2026-11-26T00:00:01.000Z" },
      { public_id: "ds_bbbbbbbbbbbbbbbb", project_id: PROJECT_A, owner: ownerB, filename: "foreign.fasta", sha256: SHA256_B, created_at: "2026-11-26T00:00:02.000Z" },
      { public_id: "ds_cccccccccccccccc", project_id: PROJECT_B, owner: ownerA, filename: "other-project.fasta", sha256: SHA256_A, created_at: "2026-11-26T00:00:03.000Z" }
    ]
  });
  const response = await handleListDatasets(makeRequest("GET", `/api/workspace/projects/${PROJECT_A}/datasets`), env, PROJECT_A);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.count, 1);
  assert.equal(body.datasets[0].filename, "mine.fasta");
  assert.ok(!JSON.stringify(body).includes("foreign.fasta"));
  assert.ok(!JSON.stringify(body).includes("other-project.fasta"));
});

test("dataset list rejects cross-owner parent access", async () => {
  const ownerA = await ownerOf(TOKEN_A);
  const ownerB = await ownerOf(TOKEN_B);
  const { env } = newWorkspaceEnv(seed(ownerA, ownerB));
  const response = await handleListDatasets(makeRequest("GET", `/api/workspace/projects/${PROJECT_B}/datasets`), env, PROJECT_B);
  assert.equal(response.status, 404);
});

test("dataset list rejects malformed project ids", async () => {
  const { env } = newWorkspaceEnv();
  const response = await handleListDatasets(makeRequest("GET", "/api/workspace/projects/not-an-id/datasets"), env, "not-an-id");
  assert.equal(response.status, 400);
});
