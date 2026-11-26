// M7.11 Workstream A — researcher-facing copy for the ambiguous submission
// state. Static offline checks only; no browser or provider call is made.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const js = readFileSync(new URL("../public/js/16s-flow.js", import.meta.url), "utf8");
const html = readFileSync(new URL("../public/16s.html", import.meta.url), "utf8");

test("the UI handles the typed submission_unknown state explicitly", () => {
  assert.match(js, /data\?\.code === "submission_unknown"/);
  assert.match(js, /SUBMISSION_UNKNOWN_COPY/);
  assert.match(js, /SUBMISSION_UNKNOWN_NOTE/);
  assert.match(js, /setError\(SUBMISSION_UNKNOWN_COPY\)/);
});

test("the ambiguous message is honest, has no raw provider error and offers no blind retry", () => {
  const start = js.indexOf('if (data?.code === "submission_unknown")');
  assert.ok(start >= 0);
  const end = js.indexOf("const retry =", start);
  assert.ok(end > start, "the ambiguous branch must stop before the generic error path");
  const branch = js.slice(start, end);
  assert.match(branch, /setError\(SUBMISSION_UNKNOWN_COPY\)/);
  assert.match(branch, /return;/);
  assert.doesNotMatch(branch, /data\.error/);
  assert.doesNotMatch(branch, /error\.message/);
  assert.doesNotMatch(branch, /provider_error/);
  assert.doesNotMatch(branch, /sessionStorage\.setItem/);
  assert.doesNotMatch(branch, /fetch\(/);
  assert.doesNotMatch(branch, /setTimeout|setInterval|location\.reload|submit\.disabled = false/);

  assert.match(js, /NCBI did not return a request ID/);
  assert.match(js, /cannot confirm whether a job was created/);
  assert.match(js, /no automatic retry was made/);
  assert.match(js, /Diagnostic details were recorded for support/);
});

test("the ambiguous copy renders in the existing alert and status elements", () => {
  assert.match(html, /id="flow-error"/);
  assert.match(html, /id="submit-note"/);
  assert.equal(js.includes("ui.submit.disabled = true"), true);
  const start = js.indexOf('if (data?.code === "submission_unknown")');
  const branch = js.slice(start, js.indexOf("const retry =", start));
  assert.doesNotMatch(branch, /Retry-After|retry_after/i);
});

test("no RID or result is fabricated for an ambiguous submission", () => {
  const start = js.indexOf('if (data?.code === "submission_unknown")');
  const end = js.indexOf("const retry =", start);
  const branch = js.slice(start, end);
  assert.doesNotMatch(branch, /state\.rid\s*=/);
  assert.doesNotMatch(branch, /renderRid\(/);
  assert.doesNotMatch(branch, /schedulePoll\(/);
  assert.match(js, /state\.rid = data\.rid;/);
});

test("historical honesty copy is unchanged", () => {
  assert.match(js, /SYNTHETIC \/ MOCK DATA/);
  assert.match(js, /STATUS_CONFLICT_COPY/);
  assert.match(html, /not a result/i);
});
