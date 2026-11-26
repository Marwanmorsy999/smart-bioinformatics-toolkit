// S Bio Assistant executable tool surface.
//
// Only the two local, read-only sequence-statistics tools may be executed from
// chat. Definitions and limits come from the authoritative registry; the
// computations are the exact browser-side pure functions, reused verbatim in
// the Worker. External/approval-gated capabilities (notably ncbi.blastn) are
// never executable here and are never called by this module.

import { getTool, validateParams } from "../ai/registry.js";
import { validateFasta } from "../../../public/js/fasta.js";
import { calculateStatistics } from "../../../public/js/statistics.js";

export const ASSISTANT_TOOL_IDS = Object.freeze([
  "sequence-stats.validate",
  "sequence-stats.profile"
]);

export const ASSISTANT_TOOL_SOURCE =
  "registry:sequence-stats (implementation: public/js/fasta.js, public/js/statistics.js)";

const MAX_FASTA_CHARS = 65536;

function safeMessage(value, fallback) {
  return typeof value === "string" && value ? value.slice(0, 500) : fallback;
}

// Merge the declared params_schema (tool parameters) and input_schema (tool
// inputs) into one OpenAI function schema. No field or limit is invented.
function mergedParameters(tool) {
  const params = tool.params_schema ?? {};
  const inputs = tool.input_schema ?? {};
  return {
    type: "object",
    additionalProperties: false,
    required: [...new Set([...(params.required ?? []), ...(inputs.required ?? [])])],
    properties: { ...(params.properties ?? {}), ...(inputs.properties ?? {}) }
  };
}

export function getAssistantToolDefinitions() {
  const definitions = [];
  for (const id of ASSISTANT_TOOL_IDS) {
    const tool = getTool(id);
    if (!tool) continue; // registry drift: never fabricate a definition
    definitions.push({
      type: "function",
      function: {
        name: tool.id,
        description: tool.description,
        parameters: mergedParameters(tool)
      }
    });
  }
  return definitions;
}

// validateParams() covers params_schema only; input_schema is checked here
// with the same strict, JSON-Schema-subset semantics.
function validateToolInput(tool, args) {
  const schema = tool.input_schema ?? {};
  // sequence_type lives in params_schema; both schemas form one function call.
  const allowed = { ...(tool.params_schema?.properties ?? {}), ...(schema.properties ?? {}) };
  for (const key of Object.keys(args)) {
    if (!Object.hasOwn(allowed, key)) return { valid: false, error: `Unsupported input: ${key}` };
  }
  for (const key of schema.required ?? []) {
    if (!Object.hasOwn(args, key)) return { valid: false, error: `Missing required input: ${key}` };
  }
  for (const [key, value] of Object.entries(args)) {
    const rule = allowed[key] ?? {};
    if (rule.type === "string" && typeof value !== "string") {
      return { valid: false, error: `${key} must be a string.` };
    }
    if (typeof rule.maxLength === "number" && typeof value === "string" && value.length > rule.maxLength) {
      return { valid: false, error: `${key} exceeds the declared ${rule.maxLength} character limit.` };
    }
  }
  return { valid: true, error: null };
}

function refusal(toolId) {
  const known = typeof toolId === "string" && Boolean(getTool(toolId));
  return {
    ok: false,
    tool_id: typeof toolId === "string" ? toolId.slice(0, 120) : null,
    error: {
      code: known ? "tool_not_executable_from_chat" : "unknown_tool",
      message: known
        ? "This capability is not executable from chat. External operations such as NCBI BLASTN require the existing plan approval and single-use consent flow; this gateway never auto-executes them."
        : "Unknown tool. No function was executed."
    }
  };
}

function resultCard(tool, validation, statistics) {
  const card = {
    title: tool.name,
    tool_id: tool.id,
    status: validation.file_valid ? "valid" : "invalid",
    summary: `${validation.valid_records} of ${validation.total_records} record(s) valid; ${validation.invalid_records} invalid.`,
    counts: {
      total_records: validation.total_records,
      valid_records: validation.valid_records,
      invalid_records: validation.invalid_records,
      file_valid: validation.file_valid
    },
    limitations: [...(tool.limitations ?? [])],
    evidence: "actual tool output",
    execution_location: "worker"
  };
  if (statistics) {
    card.statistics = statistics.summary;
    card.records = statistics.records;
  }
  return card;
}

/**
 * Execute one allowlisted tool with real, already-validated inputs.
 * `deps` is injectable only for offline tests; production uses the shipped
 * pure functions. No arbitrary function name can reach this code path.
 */
export function executeTool(name, args, deps = {}) {
  if (!ASSISTANT_TOOL_IDS.includes(name)) return refusal(name);
  const tool = getTool(name);
  if (!tool) return refusal(name);
  if (!args || typeof args !== "object" || Array.isArray(args)) {
    return { ok: false, tool_id: name, error: { code: "invalid_arguments", message: "Tool arguments must be an object." } };
  }

  const paramsCheck = validateParams(name, { sequence_type: args.sequence_type });
  if (!paramsCheck.valid) {
    return { ok: false, tool_id: name, error: { code: "invalid_arguments", message: paramsCheck.error } };
  }
  const inputCheck = validateToolInput(tool, args);
  if (!inputCheck.valid) {
    return { ok: false, tool_id: name, error: { code: "invalid_arguments", message: inputCheck.error } };
  }
  // Defense in depth: never process an inline FASTA larger than the transport
  // limit declared by the registry even if a caller bypassed the schema.
  if (args.fasta_text.length > MAX_FASTA_CHARS) {
    return { ok: false, tool_id: name, error: { code: "invalid_arguments", message: `fasta_text exceeds the declared ${MAX_FASTA_CHARS} character limit.` } };
  }

  const validate = typeof deps.validateFasta === "function" ? deps.validateFasta : validateFasta;
  const calculate = typeof deps.calculateStatistics === "function" ? deps.calculateStatistics : calculateStatistics;
  let validation;
  let statistics;
  try {
    validation = validate(args.fasta_text, args.sequence_type);
    if (name === "sequence-stats.profile") statistics = calculate(validation);
  } catch (error) {
    return {
      ok: false,
      tool_id: name,
      error: { code: "tool_execution_failed", message: safeMessage(error?.message, "The tool could not complete.") }
    };
  }
  if (!validation || typeof validation !== "object") {
    return { ok: false, tool_id: name, error: { code: "tool_execution_failed", message: "The tool returned no validation report." } };
  }

  const output = { validation };
  if (name === "sequence-stats.profile") output.statistics = statistics;
  return {
    ok: true,
    tool_id: name,
    execution_location: "worker",
    backend_declared: tool.backend ?? "local-python",
    evidence: "actual tool output",
    limitations: [...(tool.limitations ?? [])],
    source: ASSISTANT_TOOL_SOURCE,
    output,
    result_card: resultCard(tool, validation, statistics)
  };
}

export { validateFasta, calculateStatistics };
