// M7.14 microbiome capabilities in the EXISTING assistant tool loop.
// No second chatbot and no replacement of 9Router. Chat may validate inputs,
// review the live-discovered plan and read stored results; an executed Galaxy
// workflow is submitted only from the Microbiome page approval gate.

import { getTool, validateParams } from "../ai/registry.js";
import { SQL, getDb, getRow, hashInput, parseJson } from "../ai/_lib.js";
import { handlePlan } from "../ai/workflows/microbiome/engine.js";

export const MICROBIOME_ASSISTANT_TOOL_IDS = Object.freeze([
  "microbiome.validate", "microbiome.annotate", "microbiome.run", "microbiome.get_result"
]);

const SOURCE = "registry:WORKER_TOOLS (implementation: functions/api/ai/workflows/microbiome/*)";

function message(value, fallback) {
  return typeof value === "string" && value ? value.slice(0, 500) : fallback;
}

function parameters(tool) {
  return {
    type: "object", additionalProperties: false,
    required: [...new Set([...(tool.params_schema?.required ?? []), ...(tool.input_schema?.required ?? [])])],
    properties: { ...(tool.params_schema?.properties ?? {}), ...(tool.input_schema?.properties ?? {}) }
  };
}

export function getMicrobiomeToolDefinitions() {
  const definitions = [];
  for (const id of MICROBIOME_ASSISTANT_TOOL_IDS) {
    const tool = getTool(id);
    if (!tool) continue;
    definitions.push({ type: "function", function: { name: tool.id,
      description: tool.description, parameters: parameters(tool) } });
  }
  return definitions;
}

function refusal(name, code, text) {
  return { ok: false, tool_id: name, execution_state: "refused", error: { code, message: text } };
}

function validateArgs(tool, args) {
  const schema = parameters(tool);
  for (const key of Object.keys(args)) {
    if (!Object.hasOwn(schema.properties, key)) return { valid: false, error: `Unsupported argument: ${key}` };
  }
  for (const key of schema.required) {
    if (!Object.hasOwn(args, key)) return { valid: false, error: `Missing required argument: ${key}` };
  }
  for (const [key, value] of Object.entries(args)) {
    const rule = schema.properties[key] ?? {};
    if (rule.type === "string" && typeof value !== "string") return { valid: false, error: `${key} must be a string.` };
    if (typeof rule.maxLength === "number" && typeof value === "string" && value.length > rule.maxLength) {
      return { valid: false, error: `${key} exceeds the declared ${rule.maxLength} character limit.` };
    }
  }
  return { valid: true, error: null };
}

async function envelope(tool, output, details = {}) {
  return {
    ok: true, tool_id: tool.id, tool_version: tool.version,
    execution_location: "worker", execution_state: "completed",
    evidence: "actual tool output", limitations: [...(tool.limitations ?? [])],
    source: SOURCE, checksum: await hashInput(JSON.stringify(output)),
    provenance: { tool_id: tool.id, tool_version: tool.version, backend: tool.backend ?? "worker",
      basis: details.basis ?? "stored_or_reviewed_evidence", evidence_only: true },
    output,
    result_card: { title: tool.name, tool_id: tool.id, status: details.status ?? "ok",
      summary: details.summary ?? "Worker-reviewed microbiome evidence; no value was inferred by chat.",
      evidence: "actual tool output", execution_location: "worker" }
  };
}

export async function executeMicrobiomeTool(name, args, deps = {}) {
  if (!MICROBIOME_ASSISTANT_TOOL_IDS.includes(name)) {
    return refusal(name, "unknown_tool", "Unknown microbiome tool. No function was executed.");
  }
  const tool = getTool(name);
  if (!tool) return refusal(name, "tool_unavailable", "The tool manifest is unavailable; nothing was executed.");
  if (!args || typeof args !== "object" || Array.isArray(args)) {
    return refusal(name, "invalid_arguments", "Tool arguments must be an object.");
  }
  const declared = Object.fromEntries(Object.entries(args)
    .filter(([key]) => Object.hasOwn(tool.params_schema?.properties ?? {}, key)));
  const paramsCheck = validateParams(name, declared);
  if (!paramsCheck.valid) return refusal(name, "invalid_arguments", paramsCheck.error);
  const argsCheck = validateArgs(tool, args);
  if (!argsCheck.valid) return refusal(name, "invalid_arguments", argsCheck.error);
  const env = deps.env ?? {};
  const ctx = { fetch: deps.fetch ?? env.FETCH_IMPL ?? globalThis.fetch };
  try {
    if (name === "microbiome.get_result") {
      const db = getDb(env);
      if (!db) return refusal(name, "database_unavailable", "No stored result can be read without the AI database binding.");
      if (!/^job_[0-9a-f]{16}$/.test(String(args.run_id ?? ""))) {
        return refusal(name, "invalid_arguments", "run_id must be a genuine job_ id.");
      }
      const row = await getRow(db, SQL.getMicrobiomeRunByPublicId, [args.run_id]);
      const result = parseJson(row?.result_json);
      const body = result ? { ...result, state: row.state ?? null } : { result: null,
        reason: row ? "This run has no stored result yet; no values were reconstructed." : "No such microbiome run is stored." };
      return envelope(tool, { result: result ?? null, reason: body.reason ?? null },
        { basis: "stored_microbiome_run", status: result ? "ok" : "unavailable",
          summary: result ? `Stored microbiome result ${args.run_id} read from AI D1.` : (body.reason ?? "No stored result.") });
    }
    if ((name === "microbiome.annotate" || name === "microbiome.run") && args.action === "run") {
      return refusal(name, "submission_requires_approval_gate",
        "Chat never submits a Galaxy workflow. Review the plan here, then open the Microbiome page and approve it explicitly.");
    }
    const request = new Request("https://worker.internal/api/ai/workflows/microbiome/plan", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(args)
    });
    const response = await handlePlan(request, env, { fetchImpl: ctx.fetch });
    const body = await response.json();
    const output = name === "microbiome.validate"
      ? { validation: body.validation ?? null, input: body.input ?? null, qc: body.qc ?? null,
        params: body.params ?? null, error: body.error ?? null }
      : { result: { status: response.status, body } };
    return envelope(tool, output, {
      basis: name === "microbiome.validate" ? "local_and_live_schema_validator" : "live_discovered_workflow_plan",
      status: response.ok ? "ok" : "unavailable",
      summary: response.ok
        ? `Reviewed ${body.input?.sample_count ?? 0} sample(s); trim-left ${body.params?.trim_left ?? "?"}, ` +
          `trunc-len ${body.params?.trunc_len ?? "?"}. No workflow was submitted.`
        : `Plan unavailable: ${body?.error ?? `HTTP ${response.status}`}`
    });
  } catch (error) {
    return { ok: false, tool_id: name, execution_state: "error",
      error: { code: "tool_execution_failed", message: message(error?.message, "The microbiome tool could not complete.") } };
  }
}

export { getTool, validateParams };
