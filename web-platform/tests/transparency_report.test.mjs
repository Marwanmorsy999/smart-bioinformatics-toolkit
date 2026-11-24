import test from "node:test";
import assert from "node:assert/strict";
import { buildReportHtml } from "../functions/api/ai/report.js";

const RECEIPT = {
  mode: "real",
  no_external_egress: false,
  local_operations: [
    { name: "sequence-stats.profile", step_id: "step_1", backend: "local-python" }
  ],
  external_transmissions: [{
    step_id: "step_egress",
    destination: "https://blast.ncbi.nlm.nih.gov/Blast.cgi",
    bytes_sent: 2048,
    input_sha256: "a".repeat(64),
    consent: "token-ref:abcdef012345",
    timestamp: "2026-11-25T10:00:00+00:00"
  }],
  consent_records: ["appr_abc123", "external-blast"]
};

const EDUCATION = {
  notes: [{
    rule_or_threshold: "species screening identity 98.65% with near-threshold margin 0.35",
    why_insufficient: "evidence <img src=x onerror=alert(1)> was insufficient",
    what_would_help: "Provide full-length, high-coverage hits",
    verified_reference: "smartbio_gc_definition"
  }]
};

function render(overrides = {}) {
  return buildReportHtml({
    job: { id: "job_transparency" },
    plan: {},
    artifacts: [],
    validation: { status: "warn", flags: ["near_threshold"], checked_rules: [] },
    explanation: { summary: "Test", findings: [], references: [] },
    provenance: {},
    mode: "real",
    createdAt: "2026-11-25T10:00:00Z",
    ...overrides
  });
}

test("report renders locality receipt: local vs remote, destination, bytes, consent", () => {
  const html = render({ localityReceipt: RECEIPT });
  assert.match(html, /Data locality/);
  assert.match(html, /sequence-stats\.profile/);
  assert.match(html, /local-python/);
  assert.match(html, /External transmissions/);
  assert.match(html, /https:\/\/blast\.ncbi\.nlm\.nih\.gov\/Blast\.cgi/);
  assert.match(html, /2048/);
  assert.match(html, /token-ref:abcdef012345/);
  assert.match(html, /appr_abc123/);
  assert.match(html, /Consent records/);
  assert.equal(html.includes("<script"), false);
});

test("report redacts raw consent tokens and never emits scripts", () => {
  const html = render({
    localityReceipt: {
      ...RECEIPT,
      external_transmissions: [{
        ...RECEIPT.external_transmissions[0],
        consent: "consent_0123456789abcdef0123456789abcdef"
      }],
      consent_records: ["consent_0123456789abcdef0123456789abcdef"]
    }
  });
  assert.equal(html.includes("consent_0123456789abcdef0123456789abcdef"), false);
  assert.match(html, /\[redacted\]/);
  assert.equal(html.includes("<script"), false);
});

test("report renders education notes with HTML escaped and a null reference", () => {
  const html = render({
    education: {
      notes: [{
        ...EDUCATION.notes[0],
        why_insufficient: "<script>alert(1)</script>",
        verified_reference: null
      }]
    }
  });
  assert.match(html, /Education notes/);
  assert.match(html, /Rule \/ threshold/);
  assert.match(html, /98\.65%/);
  assert.match(html, /None \(no verified reference\)/);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.equal(html.includes("<script>"), false);
  assert.equal(html.includes("<img src=x"), false);
});

test("report renders verified reference keys and escapes note HTML", () => {
  const html = render({ education: EDUCATION });
  assert.match(html, /smartbio_gc_definition/);
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.equal(html.includes("<img src=x"), false);
});

test("no-egress receipt reports an empty external transmission list", () => {
  const html = render({
    localityReceipt: {
      mode: "mock",
      no_external_egress: true,
      local_operations: RECEIPT.local_operations,
      external_transmissions: [],
      consent_records: []
    }
  });
  assert.match(html, /No external transmissions \(no data left the machine\)\./);
  assert.match(html, /mock/);
});

test("caller-supplied receipt/education are ignored: only Worker-derived values render", () => {
  // The result endpoint must derive these from the job row and validation
  // flags, so a caller copying a receipt into provenance or forged notes into
  // explanation cannot make them appear in the report.
  const html = render({
    provenance: { locality_receipt: RECEIPT },
    explanation: {
      summary: "Test",
      findings: [],
      references: [],
      education: EDUCATION
    }
  });
  assert.equal(html.includes("https://blast.ncbi.nlm.nih.gov/Blast.cgi"), false);
  assert.equal(html.includes("98.65%"), false);
  assert.equal(html.includes("smartbio_gc_definition"), false);
  assert.match(html, /No external transmissions \(no data left the machine\)\./);
  assert.match(html, /No education notes recorded\./);
});
