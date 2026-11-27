// M7.14.2 LABELLED STUBBED REQUEST-CACHE TESTS — ZERO live calls.
// Read-only Galaxy GETs are memoized for ONE ctx (one status request); never
// submissions, never across ctx objects, and mutations invalidate history reads.
import test from "node:test";
import assert from "node:assert/strict";

import { createAdapter } from "../providers/galaxy/index.js";

const HISTORY = "11ac94870d0bb33aff42f70766c41aa1";
const OTHER_HISTORY = "11ac94870d0bb33aa1d667180c20abd0";
const JOB = "4838ba20a6d86765003a967a5114bbb1";

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}
function env() {
  return { GALAXY_ENABLED: "true", GALAXY_BASE_URL: "https://galaxy.example.test",
    GALAXY_API_KEY: "stub-key" };
}

test("CACHE / getJobStatus is fetched once per ctx, again for a different ctx", async () => {
  let gets = 0;
  const adapter = createAdapter(env());
  const fetchImpl = async () => {
    gets += 1;
    return json({ id: JOB, state: "ok", history_id: HISTORY, outputs: {} });
  };
  const ctx = { fetch: fetchImpl };
  const first = await adapter.getJobStatus({ job_id: JOB }, ctx);
  const second = await adapter.getJobStatus({ job_id: JOB }, ctx);
  assert.equal(gets, 1, "same ctx reuses the read");
  assert.deepEqual(second, first);
  await adapter.getJobStatus({ job_id: JOB }, { fetch: fetchImpl });
  assert.equal(gets, 2, "a new ctx performs its own read");
});

test("CACHE / getArtifacts is memoized per history and per ctx", async () => {
  let gets = 0;
  const adapter = createAdapter(env());
  const fetchImpl = async () => {
    gets += 1;
    return json([{ id: "a".repeat(32), name: "artifact.tsv", extension: "tsv", state: "ok",
      history_id: HISTORY }]);
  };
  const ctx = { fetch: fetchImpl };
  await adapter.getArtifacts({ history_id: HISTORY }, ctx);
  await adapter.getArtifacts({ history_id: HISTORY }, ctx);
  assert.equal(gets, 1, "same history in one ctx is cached");
  await adapter.getArtifacts({ history_id: OTHER_HISTORY }, ctx);
  assert.equal(gets, 2, "a different history is a different key");
  await adapter.getArtifacts({ history_id: HISTORY }, { fetch: fetchImpl });
  assert.equal(gets, 3, "a different ctx is a different scope");
});

test("CACHE / submissions are never cached and invalidate history reads", async () => {
  let posts = 0;
  let artifactGets = 0;
  const adapter = createAdapter(env());
  const fetchImpl = async (url, init = {}) => {
    const method = String(init.method ?? "GET").toUpperCase();
    if (url.includes("/api/histories/") && url.includes("/contents") && method === "GET") {
      artifactGets += 1;
      return json([]);
    }
    if (url.endsWith("/api/histories")) return json({ id: HISTORY });
    if (method === "POST" && url.endsWith("/api/tools")) {
      posts += 1;
      return json({ outputs: [], jobs: [{ id: `job-${posts}` }] });
    }
    return json({ outputs: [], jobs: [] });
  };
  const ctx = { fetch: fetchImpl };
  const request = { operation: "submit_job", tool_id: "qiime2_dada2_denoise_single",
    history_id: HISTORY, inputs: {} };
  await adapter.submitJob(request, ctx);
  await adapter.submitJob(request, ctx);
  assert.equal(posts, 2, "submissions are never memoized");
  await adapter.getArtifacts({ history_id: HISTORY }, ctx);
  await adapter.submitJob(request, ctx);
  await adapter.getArtifacts({ history_id: HISTORY }, ctx);
  assert.equal(artifactGets, 2, "a successful submission invalidates the cached history read");
});

test("CACHE / a failed read is not retained", async () => {
  let calls = 0;
  const adapter = createAdapter(env());
  const fetchImpl = async () => {
    calls += 1;
    return calls === 1 ? json({ error: "not_ready" }, 400) : json({ id: JOB, state: "new" });
  };
  const ctx = { fetch: fetchImpl };
  const first = await adapter.getJobStatus({ job_id: JOB }, ctx);
  assert.equal(first.status, "unknown", "a failed read fail-closes");
  const second = await adapter.getJobStatus({ job_id: JOB }, ctx);
  assert.equal(calls, 2, "failures are retried within the same request");
  assert.equal(second.status, "queued");
});
