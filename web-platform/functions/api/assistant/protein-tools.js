// M7.13 protein capabilities in the EXISTING assistant tool loop.
//
// These are Worker-side executors for the four registry tools. They are not a
// second chatbot and do not replace 9Router. Route B is never auto-submitted
// from chat: it requires the explicit protein page action and a configured
// server-side INTERPROSCAN_EMAIL.

import { getTool, validateParams } from "../ai/registry.js";
import { SQL, getDb, getRow, hashInput } from "../ai/_lib.js";
import {
  createProviderCache, normalizeAccession, parseProteinFasta, resolveAccession
} from "../protein/provider.js";
import { handleAnnotate, handleDomains } from "../protein/workflow.js";
import { readStoredResult } from "../protein/runs.js";

export const PROTEIN_ASSISTANT_TOOL_IDS = Object.freeze([
  "protein.validate", "protein.annotate", "protein.get_result", "protein.get_domain_details"
]);

const PROTEIN_TOOL_SOURCE = "registry:WORKER_TOOLS (implementation: functions/api/protein/*)";

function safeMessage(value, fallback) {
  return typeof value === "string" && value ? value.slice(0, 500) : fallback;
}

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

export function getProteinToolDefinitions() {
  const definitions = [];
  for (const id of PROTEIN_ASSISTANT_TOOL_IDS) {
    const tool = getTool(id);
    if (!tool) continue; // registry drift: never fabricate a definition
    definitions.push({
      type: "function",
      function: { name: tool.id, description: tool.description, parameters: mergedParameters(tool) }
    });
  }
  return definitions;
}

function validateArguments(tool, args) {
  const schema = mergedParameters(tool);
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

function refusal(name, code, message) {
  return {
    ok: false, tool_id: name, execution_state: "refused",
    error: { code, message }
  };
}

function requestFrom(payload, path) {
  return new Request(`https://worker.internal${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
}

async function envelope(tool, output, details = {}) {
  const serialized = JSON.stringify(output);
  return {
    ok: true,
    tool_id: tool.id,
    tool_version: tool.version,
    execution_location: "worker",
    execution_state: "completed",
    evidence: "actual tool output",
    limitations: [...(tool.limitations ?? [])],
    source: PROTEIN_TOOL_SOURCE,
    checksum: await hashInput(serialized),
    provenance: {
      tool_id: tool.id, tool_version: tool.version, backend: tool.backend ?? "worker",
      basis: details.basis ?? "stored_or_source_reported_evidence", route_label: details.route_label ?? null,
      evidence_only: true
    },
    output,
    result_card: {
      title: tool.name, tool_id: tool.id, status: details.status ?? "ok",
      summary: details.summary ?? "Worker-computed protein evidence; no value was inferred by chat.",
      evidence: "actual tool output", execution_location: "worker"
    }
  };
}

/**
 * Execute one allowlisted protein tool. `deps` is injectable for offline tests;
 * production supplies { env, fetch }.
 */
export async function executeProteinTool(name, args, deps = {}) {
  if (!PROTEIN_ASSISTANT_TOOL_IDS.includes(name)) {
    return refusal(name, "unknown_tool", "Unknown protein tool. No function was executed.");
  }
  const tool = getTool(name);
  if (!tool) return refusal(name, "tool_unavailable", "The tool manifest is unavailable; nothing was executed.");
  if (!args || typeof args !== "object" || Array.isArray(args)) {
    return refusal(name, "invalid_arguments", "Tool arguments must be an object.");
  }
  // validateParams checks params_schema only; input_schema fields (FASTA,
  // accession, objective) are checked by validateArguments below.
  const declaredParams = Object.fromEntries(Object.entries(args)
    .filter(([key]) => Object.hasOwn(tool.params_schema?.properties ?? {}, key)));
  const paramsCheck = validateParams(name, declaredParams);
  if (!paramsCheck.valid) return refusal(name, "invalid_arguments", paramsCheck.error);
  const argsCheck = validateArguments(tool, args);
  if (!argsCheck.valid) return refusal(name, "invalid_arguments", argsCheck.error);
  const env = deps.env ?? {};
  const ctx = { fetch: deps.fetch ?? env.FETCH_IMPL ?? globalThis.fetch };

  try {
    if (name === "protein.validate") {
      if (args.mode === "accession") {
        if (!normalizeAccession(args.accession)) return refusal(name, "invalid_arguments", "A valid accession is required.");
        const resolved = await resolveAccession(args.accession, { ctx, cache: createProviderCache() });
        return envelope(tool, { validation: { valid: true, mode: "accession", record: resolved.record,
          uniprot: resolved.uniprot, interpro_metadata_present: Boolean(resolved.interpro_metadata) } },
        { basis: "uniprot_rest_record", summary: `Validated ${resolved.accession}; length ${resolved.record.length}.` });
      }
      const parsed = parseProteinFasta(args.fasta_text);
      return envelope(tool, { validation: { valid: parsed.valid, mode: parsed.mode,
        records: parsed.records.map((record) => ({ id: record.id, length: record.length,
          md5: record.md5, ambiguous: record.ambiguous })), errors: parsed.errors } },
      { basis: "local_protein_validator", status: parsed.valid ? "ok" : "invalid",
        summary: `${parsed.records.length} record(s); ${parsed.errors.length} error(s).` });
    }

    if (name === "protein.annotate") {
      // Chat may request READ-ONLY precomputed evidence only; executed jobs
      // always require the explicit UI action and a configured contact email.
      if (args.route === "iprscan6") {
        return refusal(name, "route_b_requires_explicit_ui_action",
          "Executed InterProScan 6 jobs are never submitted from chat. Use the Protein annotation page.");
      }
      const response = await handleAnnotate(requestFrom({ ...args, route: "precomputed" },
        "/api/ai/workflows/protein/annotate"), env, { fetchImpl: ctx.fetch });
      const body = await response.json();
      return envelope(tool, { result: { status: response.status, body } }, {
        basis: "precomputed_matches_api", route_label: body?.route_label ?? null,
        status: response.ok ? "ok" : "error",
        summary: response.ok
          ? `Persisted a protein run record (write side-effect in AI D1): ${body?.run_id ?? "unknown"} ` +
            `with ${(body?.proteins ?? []).length} protein(s). No executed job was submitted.`
          : `Annotation unavailable: ${body?.error ?? `HTTP ${response.status}`}`
      });
    }

    const db = getDb(env);
    if (!db) return refusal(name, "database_unavailable", "No stored protein run can be read without the AI database binding.");
    const runId = String(args.run_id ?? "");
    if (!/^job_[0-9a-f]{16}$/.test(runId)) return refusal(name, "invalid_arguments", "run_id must be a genuine job_ id.");
    if (name === "protein.get_result") {
      const row = await getRow(db, SQL.getProteinRunByPublicId, [runId]);
      const result = readStoredResult(row);
      return envelope(tool, { result: result ?? null,
        reason: result ? null : "No stored result is present; no values were reconstructed." },
      { basis: "stored_protein_run", route_label: result?.route_label ?? null,
        status: result ? "ok" : "unavailable",
        summary: result ? `Stored ${result.route_label} result read from run ${runId}.` : "No stored result for this run." });
    }
    const response = await handleDomains(new Request(
      `https://worker.internal/api/ai/workflows/protein/domains?run_id=${encodeURIComponent(runId)}&accession=${encodeURIComponent(args.accession)}`,
      { method: "GET" }), env);
    const body = await response.json();
    return envelope(tool, { details: response.ok ? body : null,
      reason: response.ok ? null : (body?.error ?? `HTTP ${response.status}`) },
    { basis: "stored_protein_run", status: response.ok ? "ok" : "unavailable",
      summary: response.ok ? `Stored details for ${args.accession}.` : `No stored feature for ${args.accession}.` });
  } catch (error) {
    return {
      ok: false, tool_id: name, execution_state: "error",
      error: { code: "tool_execution_failed", message: safeMessage(error?.message, "The protein tool could not complete.") }
    };
  }
}

export { getTool, validateParams };
