import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import {
  AGENT_FASTA_MAX_CHARS,
  BROWSER_FASTA_MAX_BYTES,
  MAX_POLL_ATTEMPTS,
  POLL_DEADLINE_MS,
  POLL_INTERVAL_MS,
  ROUTE_AGENT,
  ROUTE_BROWSER,
  createPollDeadline,
  fastaLimitError,
  pollExpired
} from "../public/js/ai-execution.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const read = (relative) => readFileSync(resolve(HERE, "..", relative), "utf8");

test("FASTA limits match the agent and browser route contracts", () => {
  assert.equal(AGENT_FASTA_MAX_CHARS, 10000);
  assert.equal(BROWSER_FASTA_MAX_BYTES, 64 * 1024);
  assert.equal(fastaLimitError("x".repeat(10000), ROUTE_AGENT), null);
  assert.match(fastaLimitError("x".repeat(10001), ROUTE_AGENT), /at most 10,000 characters/);
  // The same oversized-for-agent input is valid on the browser route.
  assert.equal(fastaLimitError("x".repeat(10001), ROUTE_BROWSER), null);
  assert.equal(fastaLimitError("x".repeat(64 * 1024), ROUTE_BROWSER), null);
  assert.match(fastaLimitError("x".repeat(64 * 1024 + 1), ROUTE_BROWSER), /64 KiB \(65536 bytes\)/);
});

test("FASTA length check normalises CRLF like the server validator", () => {
  const input = ">id\r\n" + "A".repeat(9994) + "\r\n";
  assert.ok(input.length > AGENT_FASTA_MAX_CHARS);
  assert.ok(input.replace(/\r\n?/g, "\n").length <= AGENT_FASTA_MAX_CHARS);
  assert.equal(fastaLimitError(input, ROUTE_AGENT), null);
});

test("polling deadline is bounded by time and attempts", () => {
  assert.equal(POLL_DEADLINE_MS, 10 * 60 * 1000);
  assert.equal(POLL_INTERVAL_MS, 3000);
  assert.ok(MAX_POLL_ATTEMPTS >= 200);
  const deadline = createPollDeadline(1000);
  assert.equal(pollExpired(deadline, 1000), false);
  assert.equal(pollExpired(deadline, 1000 + POLL_DEADLINE_MS - 1), false);
  assert.equal(pollExpired(deadline, 1000 + POLL_DEADLINE_MS), true);
  const tooMany = createPollDeadline(0);
  tooMany.attempts = MAX_POLL_ATTEMPTS + 1;
  assert.equal(pollExpired(tooMany, 1000), true);
  assert.equal(pollExpired(null, 0), true);
});

test("fake clock: a three-second poll stops after ten minutes", () => {
  let now = 500;
  const deadline = createPollDeadline(now);
  for (let tick = 1; tick < 200; tick += 1) {
    deadline.attempts += 1;
    now += POLL_INTERVAL_MS;
    assert.equal(pollExpired(deadline, now), false, `poll must continue at tick ${tick}`);
  }
  deadline.attempts += 1;
  now += POLL_INTERVAL_MS;
  assert.equal(pollExpired(deadline, now), true, "poll must stop at the ten-minute mark");
});

test("workspace controller applies both caps, bounded polling and route labels", () => {
  const ui = read("public/js/ai-workspace.js");
  assert.match(ui, /fastaLimitError\(fasta, route\)/);
  assert.match(ui, /pollExpired\(pollDeadline, Date\.now\(\)\)/);
  assert.match(ui, /createPollDeadline\(Date\.now\(\)\)/);
  assert.match(ui, /setTimeout\(pollRun, POLL_INTERVAL_MS\)/);
  assert.doesNotMatch(ui, /setTimeout\(pollRun, POLL_MS\)/);
  assert.match(ui, /Local agent did not claim this job within 10 minutes\. Check `scripts\/agent-setup\/health\.ps1` \(Windows\) or `health\.sh` \(Linux\/macOS\), then retry\./);
  assert.match(ui, /elements\.pollRetry\.addEventListener\("click", retryPolling\)/);
  assert.match(ui, /elements\.pollStop\.addEventListener\("click", cancelPolling\)/);
  assert.match(ui, /elements\.buildLabel\.textContent = currentRoute\(\) === ROUTE_AGENT \? "Build plan" : "Analyze locally"/);
});

test("AI page states both limits consistently and exposes retry controls", () => {
  const html = read("public/ai.html");
  assert.match(html, /id="build-plan-label"/);
  assert.match(html, /id="poll-controls"/);
  assert.match(html, /id="poll-retry"/);
  assert.match(html, /id="poll-stop"/);
  assert.match(html, /10,000 characters/);
  assert.match(html, /64 KiB \(65,536 bytes\)/);
  assert.doesNotMatch(html, /maximum 64 KiB sent to the Worker/);
});
