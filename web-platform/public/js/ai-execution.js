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

// Keep in sync with functions/api/ai/backend.js. This is a statement about
// availability, never about a simulated result.
export const BACKEND_NOT_CONNECTED_MESSAGE =
  "Agent not connected — heavy analyses unavailable; browser-local tools still work.";

const HEAVY_INTENT = /(identif|taxa|taxonom|classif|blast|tree|phylogen|align|evolution|neighbor)/i;
const LIGHT_INTENT = /(validat|check|profil|stat|gc|compos|length|n50|count|summar)/i;

export function classifyBrowserRequest(text) {
  const value = String(text ?? "");
  if (HEAVY_INTENT.test(value)) return "heavy";
  if (LIGHT_INTENT.test(value)) return "lightweight";
  return "unsupported";
}

export function describeBackendStatus(status) {
  const connected = status?.agent_status === "connected"
    && status?.heavy_analyses_available === true
    && status?.execution_mode !== "mock";
  const mode = status?.execution_mode === "mock" ? "mock" : "real";
  const detail = connected
    ? status?.last_agent_activity_at
      ? `Last observed agent activity: ${status.last_agent_activity_at}.`
      : "Local agent observed recently."
    : status?.execution_mode === "mock"
      ? "Worker execution mode is mock; simulated output is not scientific evidence."
      : status?.agent_observation_basis
        ? `Backend check: ${status.agent_observation_basis}.`
        : "Backend check has not completed.";
  return {
    connected,
    mode,
    message: connected
      ? "Local agent observed recently; heavy analyses are available."
      : BACKEND_NOT_CONNECTED_MESSAGE,
    detail
  };
}

export function executionBadge(route, backendDescription) {
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
