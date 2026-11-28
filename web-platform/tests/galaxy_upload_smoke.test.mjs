// OFFLINE / MOCK regression tests for the opt-in live script's dataset poll.
// Importing the script has no side effects: no credential, no network call and
// no file write. The mocks below only exercise resolveDataset's loop bounds.
import test from "node:test";
import assert from "node:assert/strict";

import {
  resolveDataset, POLL_INTERVAL_MS, POLL_MAX_ATTEMPTS, POLL_TIMEOUT_MS
} from "../../scripts/live-smoke/galaxy-upload-tests.mjs";

const NAME = "dataset.txt";
const HISTORY = "history_mock";
const BASE = "https://galaxy.example.invalid";
const HEADERS = { "X-API-Key": "mock-key-not-a-real-secret" };

function stateFetch(states) {
  let index = 0;
  const calls = [];
  const impl = async (base, path, options = {}) => {
    calls.push({ base, path, options });
    const state = states[Math.min(index, states.length - 1)];
    index += 1;
    const body = state === null
      ? []
      : [{ id: "ds_1", name: NAME, state, deleted: false, history_id: HISTORY }];
    return { ok: true, status: 200, body };
  };
  return { impl, calls };
}

function options(overrides = {}) {
  return {
    intervalMs: 0,
    maxAttempts: 5,
    timeoutMs: POLL_TIMEOUT_MS,
    sleepFn: async () => {},
    now: () => 0,
    log: () => {},
    ...overrides
  };
}

test("OFFLINE/MOCK: live poll is bounded by a fixed interval, attempt count and deadline", () => {
  assert.equal(POLL_INTERVAL_MS, 2_000);
  assert.equal(POLL_MAX_ATTEMPTS, 30);
  assert.equal(POLL_TIMEOUT_MS, 60_000);
  assert.ok(POLL_MAX_ATTEMPTS * POLL_INTERVAL_MS >= POLL_TIMEOUT_MS,
    "the attempt ceiling must cover the documented ~60s window");
});

test("OFFLINE/MOCK: poll returns as soon as the dataset reaches ok", async () => {
  const { impl, calls } = stateFetch(["queued", "running", "ok"]);
  const slept = [];
  const dataset = await resolveDataset(BASE, HEADERS, HISTORY, NAME, options({
    fetchImpl: impl,
    intervalMs: 250,
    sleepFn: async (ms) => { slept.push(ms); }
  }));

  assert.equal(dataset.id, "ds_1");
  assert.equal(dataset.state, "ok");
  assert.equal(calls.length, 3);
  assert.deepEqual(slept, [250, 250], "no sleep after the terminal ok state");
  assert.ok(calls.every((call) => call.path === `/api/histories/${HISTORY}/contents`));
});

test("OFFLINE/MOCK: poll stops at the attempt ceiling and reports the last state", async () => {
  const { impl, calls } = stateFetch(["queued"]);
  await assert.rejects(
    () => resolveDataset(BASE, HEADERS, HISTORY, NAME, options({ fetchImpl: impl })),
    (error) => /did not reach ok\/success within 60s/.test(error.message)
      && /5 attempts/.test(error.message) && /last state queued/.test(error.message)
  );
  assert.equal(calls.length, 5, "an unbounded loop must never exceed the attempt ceiling");
});

test("OFFLINE/MOCK: poll also stops when the wall-clock deadline passes", async () => {
  const { impl, calls } = stateFetch(["running"]);
  let tick = 0;
  const now = () => {
    tick += 1;
    return tick <= 2 ? 0 : POLL_TIMEOUT_MS + 1;
  };
  await assert.rejects(
    () => resolveDataset(BASE, HEADERS, HISTORY, NAME, options({ fetchImpl: impl, now })),
    (error) => /did not reach ok\/success/.test(error.message)
  );
  assert.equal(calls.length, 1, "the deadline must stop polling before the attempt ceiling");
});

test("OFFLINE/MOCK: poll fails fast on a terminal dataset state", async () => {
  const { impl, calls } = stateFetch(["error"]);
  await assert.rejects(
    () => resolveDataset(BASE, HEADERS, HISTORY, NAME, options({ fetchImpl: impl })),
    (error) => /entered terminal state error/.test(error.message)
  );
  assert.equal(calls.length, 1, "a failed dataset must not be polled further");
});
