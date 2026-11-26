// Tool registry for the AI control plane. Mirrors shared/plugins/*.json.
// The Worker only advertises tools; it never executes them.
// TOOLS is generated from the validated manifests; do not edit it here.

import { TOOLS as GENERATED_TOOLS } from "./registry.tools.generated.js";
import { ALLOWED_DATABASE, ALLOWED_PROGRAM } from "../blast/_lib.js";

export const TOOLS = GENERATED_TOOLS;

// Worker-side NCBI BLAST capability. It is deliberately NOT written into the
// generated manifest file: egress happens through the existing consent-gated
// /api/blast/submit -> status -> results endpoints, not through the local agent.
// `backend` stays "local-python" because validatePlan's closed backend set is
// unchanged; the transport is the legacy Worker BLAST path described above.
export const WORKER_TOOLS = Object.freeze([
  Object.freeze({
    "id": "ncbi.blastn",
    "name": "NCBI BLASTN (16S rRNA)",
    "description": "Submit an approved FASTA to NCBI BLASTN against the 16S rRNA database through the existing single-use consent token, then poll and retrieve real tabular results. No local agent is involved; the Worker performs the audited GET requests.",
    "version": "1.0.0",
    "backend": "local-python",
    "domain": "microbiome-16s",
    "available": true,
    "unavailable_reason": null,
    "external_egress": true,
    "requirements": ["binding:BLAST_DB", "consent:blast", "env:ALLOWED_DATABASE/ALLOWED_PROGRAM"],
    "estimated_seconds": 60,
    "params_schema": {
      "type": "object",
      "additionalProperties": false,
      "required": ["database", "program"],
      "properties": {
        "database": { "type": "string", "enum": [ALLOWED_DATABASE] },
        "program": { "type": "string", "enum": [ALLOWED_PROGRAM] }
      }
    },
    "input_schema": {
      "type": "object",
      "required": ["dataset_id", "fasta_text", "filename"],
      "properties": {
        "dataset_id": { "type": "string" },
        "fasta_text": { "type": "string", "maxLength": 65536 },
        "filename": { "type": "string" }
      }
    },
    "output_schema": {
      "type": "object",
      "required": ["blast_tsv"],
      "properties": { "blast_tsv": { "type": "string" } }
    },
    "references": [],
    "limitations": [
      "External egress requires explicit browser approval and a single-use, short-lived consent token bound to the input hash, database and program.",
      "The transmitted value is the approved FASTA text; no file bytes are uploaded to a third-party object store by this capability.",
      "NCBI limits apply: at most one submission per 10 seconds and no more than one RID status check per minute.",
      "Parsed similarity is not proof of species identity and is not a clinical diagnosis.",
      "When MOCK_NCBI is enabled by the operator, results are synthetic and are labelled as such; they are never presented as real."
    ]
  })
]);

// Resolve dynamically so the existing tests that temporarily splice/push into
// the generated TOOLS array keep exercising their intended branches.
function allTools() {
  return [...TOOLS, ...WORKER_TOOLS];
}

export function getTool(toolId) {
  return allTools().find((tool) => tool.id === toolId) ?? null;
}

export function toolIds() {
  // Manifest parity only: worker-side capabilities are registered above and
  // reachable through getTool/isKnownTool, not through the manifest id list.
  return TOOLS.map((tool) => tool.id);
}

export function isKnownTool(toolId) {
  return Boolean(getTool(toolId));
}

// A small JSON-Schema-subset check driven by each tool's params_schema:
// required, additionalProperties:false, type, enum, minimum and maximum.
// Values are never interpreted as scientific values; they are passed to the
// local agent verbatim. Unknown schema keywords are deliberately ignored.
function matchesType(value, type) {
  switch (type) {
    case "string": return typeof value === "string";
    case "number": return typeof value === "number" && Number.isFinite(value);
    case "integer": return Number.isInteger(value);
    case "boolean": return typeof value === "boolean";
    case "object": return value !== null && typeof value === "object" && !Array.isArray(value);
    case "array": return Array.isArray(value);
    case "null": return value === null;
    default: return true; // unconstrained when the schema has no known type
  }
}

export function validateParams(toolId, params) {
  const tool = getTool(toolId);
  if (!tool) return { valid: false, error: `Unknown tool: ${toolId}` };
  if (!params || typeof params !== "object" || Array.isArray(params)) {
    return { valid: false, error: "params must be an object." };
  }
  const schema = tool.params_schema ?? {};
  const allowed = schema.properties ?? {};

  if (schema.additionalProperties === false) {
    for (const key of Object.keys(params)) {
      if (!Object.hasOwn(allowed, key)) return { valid: false, error: `Unsupported parameter: ${key}` };
    }
  }
  for (const key of schema.required ?? []) {
    if (!Object.hasOwn(params, key)) return { valid: false, error: `Missing required parameter: ${key}` };
  }
  for (const [key, value] of Object.entries(params)) {
    const rule = allowed[key];
    if (!rule) continue;
    if (!matchesType(value, rule.type)) {
      return { valid: false, error: `${key} must be ${rule.type ?? "a supported type"}.` };
    }
    if (Array.isArray(rule.enum) && !rule.enum.includes(value)) {
      return { valid: false, error: `${key} must be one of: ${rule.enum.join(", ")}.` };
    }
    if (typeof value === "number" && Number.isFinite(value)) {
      if (typeof rule.minimum === "number" && value < rule.minimum) {
        return { valid: false, error: `${key} must be >= ${rule.minimum}.` };
      }
      if (typeof rule.maximum === "number" && value > rule.maximum) {
        return { valid: false, error: `${key} must be <= ${rule.maximum}.` };
      }
    }
  }
  return { valid: true, error: null };
}
