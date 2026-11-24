// Execution routing for the AI workspace. This module contains no network
// calls: the browser fast path is computed here from the FASTA the user gave
// us, while the agent path is a separate Worker-controlled route.
// Scientific numbers always come from the existing fasta.js/statistics.js
// modules; this file never invents or simulates a result.

import { validateFasta } from "./fasta.js";
import { calculateStatistics, toCsv } from "./statistics.js";

export const ROUTE_BROWSER = "browser-local";
export const ROUTE_AGENT = "local-agent";

export const ROUTE_LABELS = Object.freeze({
  [ROUTE_BROWSER]: "Browser (local)",
  [ROUTE_AGENT]: "Local agent"
});

// Input limits differ by route. The Worker's agent route reuses
// functions/api/blast/_lib.js validateFasta (MAX_FASTA_CHARS = 10000); the
// browser profile and Worker transport are capped at 64 KiB (65,536 bytes).
export const AGENT_FASTA_MAX_CHARS = 10000;
export const BROWSER_FASTA_MAX_BYTES = 64 * 1024;

export function fastaLimitError(fasta, route) {
  // Match the server's line-ending normalisation before measuring characters.
  const value = (typeof fasta === "string" ? fasta : "").replace(/\r\n?/g, "\n");
  if (route === ROUTE_AGENT) {
    if (value.length > AGENT_FASTA_MAX_CHARS) {
      return `The local-agent route accepts at most ${AGENT_FASTA_MAX_CHARS.toLocaleString("en-US")} characters of FASTA. Shorten the input or choose Browser (local).`;
    }
    return null;
  }
  const bytes = typeof TextEncoder === "function" ? new TextEncoder().encode(value).length : value.length;
  if (bytes > BROWSER_FASTA_MAX_BYTES) {
    return `The browser-local route accepts at most 64 KiB (${BROWSER_FASTA_MAX_BYTES} bytes) of FASTA. Shorten the input or split it into smaller files.`;
  }
  return null;
}

// Bounded status polling: a local agent must claim the job within 10 minutes.
// The clock is injected so the deadline is testable without real timers.
export const POLL_INTERVAL_MS = 3000;
export const POLL_DEADLINE_MS = 10 * 60 * 1000;
export const MAX_POLL_ATTEMPTS = Math.ceil(POLL_DEADLINE_MS / POLL_INTERVAL_MS) + 1;

export function createPollDeadline(now = 0) {
  return { startedAt: now, attempts: 0 };
}

export function pollExpired(deadline, now) {
  if (!deadline) return true;
  return (now - deadline.startedAt >= POLL_DEADLINE_MS) || deadline.attempts > MAX_POLL_ATTEMPTS;
}

// Keep in sync with functions/api/ai/backend.js. This is a statement about
// availability, never about a simulated result.
export const BACKEND_NOT_CONNECTED_MESSAGE =
  "Agent not connected — heavy analyses unavailable; browser-local tools still work.";
// Mock mode is a distinct, honest label. It is never reported as a real
// analysis, in the header badge, the execution chip or the blocked message.
export const MOCK_BACKEND_BADGE =
  "Backend: mock — simulated results not scientific evidence";
export const MOCK_BACKEND_MESSAGE =
  "Backend: mock — simulated results are not scientific evidence; browser-local tools still work.";
export const MOCK_EXECUTION_BADGE =
  "Execution: mock (not scientific evidence)";

const HEAVY_INTENT = /(identif|taxa|taxonom|classif|blast|tree|phylogen|align|evolution|neighbor)/i;
const LIGHT_INTENT = /(validat|check|profil|stat|gc|compos|length|n50|count|summar)/i;

export function classifyBrowserRequest(text) {
  const value = String(text ?? "");
  if (HEAVY_INTENT.test(value)) return "heavy";
  if (LIGHT_INTENT.test(value)) return "lightweight";
  return "unsupported";
}

export function describeBackendStatus(status) {
  const mock = status?.execution_mode === "mock";
  const connected = status?.agent_status === "connected"
    && status?.heavy_analyses_available === true
    && !mock;
  const mode = mock ? "mock" : "real";
  const detail = connected
    ? status?.last_agent_activity_at
      ? `Last observed agent activity: ${status.last_agent_activity_at}.`
      : "Local agent observed recently."
    : mock
      ? "Worker execution mode is mock; simulated output is not scientific evidence."
      : status?.agent_observation_basis
        ? `Backend check: ${status.agent_observation_basis}.`
        : "Backend check has not completed.";
  return {
    connected,
    mode,
    message: mock
      ? MOCK_BACKEND_MESSAGE
      : connected
        ? "Local agent observed recently; heavy analyses are available."
        : BACKEND_NOT_CONNECTED_MESSAGE,
    detail,
    // Consumed by renderBackendStatus for the header badge. The chip is
    // centralised in executionBadge so every call site stays consistent.
    badge: connected
      ? "Backend: local agent observed"
      : mock
        ? MOCK_BACKEND_BADGE
        : "Backend: no local agent observed"
  };
}

export function executionBadge(route, backendDescription) {
  // A mock Worker never produces an honest chip on any route: the label must
  // be visible even before the user changes route or submits a request.
  if (backendDescription?.mode === "mock") return MOCK_EXECUTION_BADGE;
  if (route === ROUTE_BROWSER) return "Execution: browser-local";
  if (route === ROUTE_AGENT) {
    return backendDescription?.connected ? "Execution: local agent" : "Execution: local agent (unavailable)";
  }
  return "Execution: unknown";
}

// Pure routing decision used by the UI before any work is done. A blocked
// decision always carries result: null: no backend means no result, never a
// mock result presented as real analysis.
export function decideExecution({ requestText, route, backend } = {}) {
  const described = describeBackendStatus(backend);
  const kind = classifyBrowserRequest(requestText);
  if (route === ROUTE_BROWSER) {
    if (kind !== "lightweight") {
      return {
        action: "blocked",
        message: "Browser (local) can validate FASTA and compute statistics only. This request needs the local agent; no simulated result will be produced.",
        result: null
      };
    }
    return { action: "browser-profile", message: "", result: null };
  }
  if (route === ROUTE_AGENT) {
    if (!described.connected) {
      return { action: "blocked", message: `${described.message} ${described.detail}`.trim(), result: null };
    }
    return { action: "agent-plan", message: "", result: null };
  }
  return { action: "blocked", message: "Choose an execution route.", result: null };
}

// The one lightweight intent that runs entirely in this page. No fetch, no
// Worker call, no agent: only the existing browser validation/statistics code.
export function runBrowserProfile(fasta, sequenceType = "dna") {
  const validation = validateFasta(fasta, sequenceType);
  const statistics = calculateStatistics(validation);
  return {
    execution: ROUTE_BROWSER,
    complete: validation.file_valid,
    validation,
    stats: statistics.summary,
    records: statistics.records,
    limitations: [
      "Computed in your browser from the FASTA on this page; nothing was uploaded and no Worker or agent was used.",
      `Sequence type: ${validation.sequence_type}. Ambiguous symbols are excluded from GC percentages.`,
      "Descriptive screening statistics only; not a taxonomic identification or a clinical result."
    ]
  };
}

export function browserSummaryText(report) {
  const stats = report?.stats ?? {};
  const gc = typeof stats.gc_percent_mean === "number" ? `${stats.gc_percent_mean}%` : "n/a";
  return `FASTA validation: ${stats.valid_records ?? 0}/${stats.total_records ?? 0} record(s) valid. `
    + `Analysed ${stats.analyzed_records ?? 0}; total length ${stats.total_length ?? 0}; `
    + `N50 ${stats.n50 ?? "n/a"}; mean GC ${gc}.`;
}

export function browserRecordsCsv(report) {
  return toCsv(report?.records ?? []);
}

// Per-run transparency data. These helpers return plain data only; every
// string is rendered with textContent by the workspace, never as markup.
export function educationNotesFromRun(run) {
  const notes = run?.explanation?.education?.notes ?? run?.education?.notes;
  return Array.isArray(notes) ? notes.filter((note) => note && typeof note === "object") : [];
}

export function localityReceiptFromRun(run) {
  const receipt = run?.provenance?.locality_receipt ?? run?.locality_receipt;
  if (!receipt || typeof receipt !== "object") return null;
  const list = (value) => Array.isArray(value) ? value.filter((item) => item !== null && item !== undefined) : [];
  return {
    mode: receipt.mode,
    no_external_egress: receipt.no_external_egress,
    local_operations: list(receipt.local_operations),
    external_transmissions: list(receipt.external_transmissions),
    consent_records: list(receipt.consent_records)
  };
}

// Mirrors functions/api/ai/report.js safeRef: a consent reference is a
// record identifier, never a bearer token. Redact anything that looks like
// one before it reaches the result view.
export function redactConsentRef(value) {
  const text = String(value ?? "");
  if (/^(consent_|tk_|sk_|bearer\s)/i.test(text) || /^[a-f0-9]{32,}$/i.test(text)) return "[redacted]";
  return text;
}
