// Worker-side data-locality receipt derivation.
//
// The receipt is a control-plane claim about whether data left the machine, so
// it must never be copied from the result payload. It is derived only from
// authoritative rows: the approved job (inputs/consent/step flags), approvals
// and append-only audit_events (including blast_egress hash/byte records).

const TOKEN_PREFIX = /^(consent_|tk_|sk_|bearer\s)/i;
const HEX_TOKEN = /^[a-f0-9]{32,}$/i;
const SHA256 = /^[0-9a-f]{64}$/;
const APPROVAL_ID = /^apr_[0-9a-f]{16}$/;

const isObject = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);

function text(value, maxLength = 500) {
  if (typeof value !== "string") return "";
  return value.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, maxLength);
}

function parseObject(json) {
  if (typeof json !== "string" || !json) return {};
  try {
    const parsed = JSON.parse(json);
    return isObject(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

// Bearer tokens and hex blobs are never persisted as consent references; the
// reader additionally redacts token-like values at render time.
function isSafeRef(value) {
  return typeof value === "string" && Boolean(value.trim())
    && !TOKEN_PREFIX.test(value) && !HEX_TOKEN.test(value);
}

function bytesOrNull(value) {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) return value;
  if (typeof value === "string" && /^\d+$/.test(value)) return Number(value);
  return null;
}

/**
 * Pure derivation of the locality receipt. `inputHash` is computed by the
 * caller (hashInput is async) from the approved FASTA in inputs_json.
 * `approvalRows` are the approval rows for the job's plan.
 */
export function deriveLocalityReceipt({ jobRow, auditRows, mode, inputHash = null, approvalRows = [] } = {}) {
  const row = isObject(jobRow) ? jobRow : {};
  const inputs = parseObject(row.inputs_json);
  const consent = parseObject(row.consent_json);
  const planId = text(row.plan_id, 100);
  const stepId = text(row.step_id, 100);
  const externalEgress = inputs.external_egress === true;

  const localOperations = [{
    name: text(row.tool_id, 200) || "unknown tool",
    step_id: stepId,
    backend: text(row.backend, 100) || "local-python"
  }];

  const events = Array.isArray(auditRows) ? auditRows.filter(isObject) : [];
  const approvals = Array.isArray(approvalRows) ? approvalRows.filter(isObject) : [];
  const approvalRefs = approvals
    .filter((item) => item.plan_id === planId && item.step_id === stepId && APPROVAL_ID.test(String(item.public_id ?? "")))
    .map((item) => item.public_id);
  const fallbackRef = `approval:${planId}:${stepId}`;
  const consentRef = approvalRefs[0] || fallbackRef;

  // Consent grants are bound to the approved input hash. An egress audit for
  // that hash (or for a grant issued for this plan step) belongs to this job.
  const grantedHashes = new Set();
  for (const event of events) {
    if (event.action !== "ai_blast_consent_issued" || event.target !== planId) continue;
    const detail = parseObject(event.detail_json);
    if (detail.step_id !== stepId) continue;
    const hash = text(detail.input_hash, 64);
    if (SHA256.test(hash)) grantedHashes.add(hash);
  }

  const transmissions = [];
  const seen = new Set();
  for (const event of events) {
    if (event.action !== "blast_egress") continue;
    const detail = parseObject(event.detail_json);
    const hash = text(detail.input_hash, 64);
    const belongsToJob = (typeof inputHash === "string" && hash === inputHash) || grantedHashes.has(hash);
    if (!belongsToJob) continue;
    const destination = text(event.target, 500) || "external service";
    const key = `${hash}|${destination}`;
    if (seen.has(key)) continue;
    seen.add(key);
    transmissions.push({
      step_id: stepId,
      destination,
      bytes_sent: bytesOrNull(detail.payload_bytes),
      input_sha256: SHA256.test(hash) ? hash : null,
      consent: consentRef,
      timestamp: text(event.timestamp, 40)
    });
  }

  // An approved egress step is itself evidence that data may have left: never
  // report "no external transmissions" for it, even when the audit is absent.
  if (externalEgress && transmissions.length === 0) {
    const declared = Array.isArray(inputs.external_services) ? inputs.external_services : [];
    const fromPlan = Array.isArray(row.external_services) ? row.external_services : [];
    const destination = text(declared.find(isSafeRef), 500)
      || text(fromPlan.find(isSafeRef), 500)
      || "external service (declared by approved step)";
    transmissions.push({
      step_id: stepId,
      destination,
      bytes_sent: null,
      input_sha256: SHA256.test(String(inputHash ?? "")) ? inputHash : null,
      consent: consentRef,
      timestamp: text(row.started_at, 40)
    });
  }

  // Only non-sensitive references are persisted: approval ids and approved
  // scope labels. Token-like caller values are dropped, never echoed.
  const consentRecords = [];
  for (const ref of [...approvalRefs, fallbackRef]) {
    if (!consentRecords.includes(ref)) consentRecords.push(ref);
  }
  const scope = Array.isArray(consent.scope) ? consent.scope : [];
  for (const item of scope) {
    const label = text(item, 120);
    if (!isSafeRef(label)) continue;
    const record = `scope:${label}`;
    if (!consentRecords.includes(record)) consentRecords.push(record);
  }
  if (consent.granted !== true && approvalRefs.length === 0) {
    consentRecords.push(`no_grant:${planId}:${stepId}`);
  }

  return {
    local_operations: localOperations,
    external_transmissions: transmissions,
    consent_records: consentRecords,
    mode: mode === "mock" ? "mock" : "real",
    no_external_egress: transmissions.length === 0
  };
}
