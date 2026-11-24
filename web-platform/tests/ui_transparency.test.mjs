import test from "node:test";
import assert from "node:assert/strict";

import {
  MOCK_BACKEND_BADGE,
  MOCK_BACKEND_MESSAGE,
  MOCK_EXECUTION_BADGE,
  ROUTE_AGENT,
  ROUTE_BROWSER,
  decideExecution,
  describeBackendStatus,
  educationNotesFromRun,
  executionBadge,
  localityReceiptFromRun,
  redactConsentRef
} from "../public/js/ai-execution.js";

const MOCK_STATUS = {
  execution_mode: "mock",
  agent_status: "not_connected",
  heavy_analyses_available: false,
  agent_observation_basis: "operator mock mode",
  // Even a recently observed agent must not be reported as connected in mock
  // mode: the Worker overrides the agent's own status.
  last_agent_activity_at: "2026-11-25T11:59:00.000Z"
};

test("mock backend is labelled in the header badge and execution chip", () => {
  assert.equal(MOCK_BACKEND_BADGE, "Backend: mock — simulated results not scientific evidence");
  assert.equal(MOCK_EXECUTION_BADGE, "Execution: mock (not scientific evidence)");
  assert.match(MOCK_BACKEND_MESSAGE, /not scientific evidence/);

  const described = describeBackendStatus(MOCK_STATUS);
  assert.equal(described.mode, "mock");
  assert.equal(described.connected, false, "mock mode can never report a connected agent");
  assert.equal(described.badge, "Backend: mock — simulated results not scientific evidence");
  assert.equal(executionBadge(ROUTE_AGENT, described), "Execution: mock (not scientific evidence)");
  assert.equal(executionBadge(ROUTE_BROWSER, described), "Execution: mock (not scientific evidence)");
  assert.equal(described.message, MOCK_BACKEND_MESSAGE);
  assert.match(described.detail, /mock/);
});

test("mock mode keeps the local-agent route blocked and produces no result", () => {
  const agent = decideExecution({
    requestText: "validate and profile my FASTA and calculate GC content",
    route: ROUTE_AGENT,
    backend: MOCK_STATUS
  });
  assert.equal(agent.action, "blocked");
  assert.equal(agent.result, null, "no result object may exist in mock mode");
  assert.match(agent.message, /not scientific evidence/);
  assert.doesNotMatch(agent.message, /result was produced/);

  const heavyBrowser = decideExecution({
    requestText: "build a phylogenetic tree from my FASTA",
    route: ROUTE_BROWSER,
    backend: MOCK_STATUS
  });
  assert.equal(heavyBrowser.action, "blocked");
  assert.equal(heavyBrowser.result, null);

  // Real browser-local computation remains available: it is not simulated.
  const lightBrowser = decideExecution({
    requestText: "validate and profile my FASTA and calculate GC content",
    route: ROUTE_BROWSER,
    backend: MOCK_STATUS
  });
  assert.equal(lightBrowser.action, "browser-profile");
  assert.equal(lightBrowser.result, null);
});

test("education notes are extracted as plain data and tolerate missing fields", () => {
  const note = {
    rule_or_threshold: "identity < 97%",
    why_insufficient: "below the genus-level threshold",
    what_would_help: "one verified BLAST hit from a local database",
    verified_reference: "<img src=x onerror=alert(1)>"
  };
  const fromExplanation = educationNotesFromRun({ explanation: { education: { notes: [note, null] } } });
  assert.deepEqual(fromExplanation, [note]);
  assert.equal(fromExplanation[0].verified_reference, "<img src=x onerror=alert(1)>",
    "the value is kept as data; the view attaches it with textContent");
  assert.deepEqual(educationNotesFromRun({ education: { notes: [note] } }), [note]);
  assert.deepEqual(educationNotesFromRun({}), []);
  assert.deepEqual(educationNotesFromRun({ explanation: { education: { notes: "not an array" } } }), []);
});

test("locality receipt exposes operations, transmissions, bytes and consent refs", () => {
  const run = {
    provenance: {
      locality_receipt: {
        mode: "no-egress",
        no_external_egress: true,
        local_operations: [{ name: "phylo.workflow", step_id: "step_1", backend: "local-python" }],
        external_transmissions: [{
          step_id: "step_2",
          destination: "https://blast.example",
          bytes_sent: 4096,
          input_sha256: "deadbeef",
          consent: "tk_abc123",
          timestamp: "2026-11-25T12:00:00.000Z"
        }],
        consent_records: ["consent_abc123", "plain-reference"]
      }
    }
  };
  const receipt = localityReceiptFromRun(run);
  assert.equal(receipt.mode, "no-egress");
  assert.equal(receipt.no_external_egress, true);
  assert.equal(receipt.local_operations.length, 1);
  assert.equal(receipt.local_operations[0].backend, "local-python");
  assert.equal(receipt.external_transmissions.length, 1);
  assert.equal(receipt.external_transmissions[0].destination, "https://blast.example");
  assert.equal(receipt.external_transmissions[0].bytes_sent, 4096);
  assert.deepEqual(receipt.consent_records, ["consent_abc123", "plain-reference"]);
  assert.equal(redactConsentRef(receipt.external_transmissions[0].consent), "[redacted]");
  assert.equal(redactConsentRef(receipt.consent_records[0]), "[redacted]");
  assert.equal(redactConsentRef("plain-reference"), "plain-reference");
  assert.equal(redactConsentRef("a".repeat(32)), "[redacted]");
});

test("locality receipt tolerates missing or top-level placement", () => {
  assert.equal(localityReceiptFromRun({}), null);
  assert.equal(localityReceiptFromRun({ provenance: { locality_receipt: "bad" } }), null);
  const topLevel = localityReceiptFromRun({ locality_receipt: { mode: "browser-local", no_external_egress: true } });
  assert.equal(topLevel.mode, "browser-local");
  assert.deepEqual(topLevel.local_operations, []);
  assert.deepEqual(topLevel.external_transmissions, []);
  assert.deepEqual(topLevel.consent_records, []);
});
