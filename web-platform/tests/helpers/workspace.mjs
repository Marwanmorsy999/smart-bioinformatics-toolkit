// Shared helpers for the M7.4 batch-1 workspace tests.

import { createFakeD1AI, mockAIEnv } from "./fake-d1.mjs";

export const TOKEN_A = "workspace-agent-token-A";
export const TOKEN_B = "workspace-agent-token-B";

export function makeRequest(method, path, token = TOKEN_A, payload) {
  const headers = { "Content-Type": "application/json" };
  if (token !== null && token !== undefined) headers["X-Agent-Token"] = token;
  const options = { method, headers };
  if (payload !== undefined) options.body = JSON.stringify(payload);
  return new Request(`https://workspace.example.test${path}`, options);
}

export async function ownerOf(token = TOKEN_A) {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  const hex = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `owner_${hex.slice(0, 16)}`;
}

export function newWorkspaceEnv(seed = {}) {
  const { db, state } = createFakeD1AI(seed);
  return { env: mockAIEnv(db, TOKEN_A), state, db };
}

export const SHA256_A = "a".repeat(64);
export const SHA256_B = "b".repeat(64);
export const COMPLETE_PROVENANCE = Object.freeze({
  input_sha256: SHA256_A,
  workflow_id: "16s-rrna-identification",
  workflow_version: "1.0.0",
  tools: [{ name: "blastn", version: "2.17.0" }],
  params: { database: "16S_ribosomal_RNA" },
  timestamps: { started_at: "2026-11-26T00:00:00.000Z", completed_at: "2026-11-26T00:00:05.000Z" },
  provider_job_refs: [],
  output_hashes: [{ artifact_ref: "art_0123456789abcdef", sha256: SHA256_B }],
  artifact_retrieval_state: "retrieved",
  validation_outcomes: [{ rule: "taxa_set", status: "pass" }],
  report_generated_at: "2026-11-26T00:00:06.000Z"
});
