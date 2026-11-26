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
  }),
  // M7.13 protein annotation. Worker-side, versioned capabilities derived from
  // the real /api/ai/workflows/protein/** handlers. No new chat provider is
  // introduced; these manifests feed the existing /api/tools/catalog and the
  // allowlisted assistant tool loop.
  Object.freeze({
    "id": "protein.validate",
    "name": "Protein input validation (UniProt/FASTA)",
    "description": "Validate a protein FASTA, raw protein sequence or UniProt accession server-side: documented amino-acid alphabet, duplicate ids, length, ambiguous residues and the uppercase-ASCII MD5 used by the InterPro Matches API.",
    "version": "1.0.0-m7.13",
    "backend": "worker",
    "domain": "protein-annotation",
    "available": true,
    "unavailable_reason": null,
    "external_egress": false,
    "requirements": ["worker:protein/provider.js"],
    "estimated_seconds": 2,
    "params_schema": {
      "type": "object", "additionalProperties": false,
      "required": ["mode"],
      "properties": { "mode": { "type": "string", "enum": ["accession", "fasta"] } }
    },
    "input_schema": {
      "type": "object", "required": [],
      "properties": {
        "fasta_text": { "type": "string", "maxLength": 200000 },
        "accession": { "type": "string", "maxLength": 40 },
        "filename": { "type": "string", "maxLength": 200 }
      }
    },
    "output_schema": {
      "type": "object", "required": ["validation"],
      "properties": { "validation": { "type": "object" } }
    },
    "references": [],
    "limitations": [
      "Ambiguous residues B/J/Z/X/U/O are retained verbatim and never resolved.",
      "Nucleotide sequences are rejected; this is not a six-frame translation tool.",
      "No result is claimed from validation alone."
    ]
  }),
  Object.freeze({
    "id": "protein.annotate",
    "name": "Protein functional annotation (InterPro evidence)",
    "description": "Annotate a validated protein from genuine UniProt/InterPro evidence. Route A reads precomputed InterPro Matches; Route B submits an executed InterProScan 6 job only when a server-side contact email is configured. Route labels are never conflated.",
    "version": "1.0.0-m7.13",
    "backend": "worker",
    "domain": "protein-annotation",
    "available": true,
    "unavailable_reason": null,
    "external_egress": true,
    "requirements": ["binding:AI_DB", "env:INTERPROSCAN_EMAIL (Route B only)"],
    "estimated_seconds": 30,
    "params_schema": {
      "type": "object", "additionalProperties": false,
      "required": ["route"],
      "properties": { "route": { "type": "string", "enum": ["precomputed", "iprscan6"] } }
    },
    "input_schema": {
      "type": "object", "required": [],
      "properties": {
        "mode": { "type": "string", "enum": ["accession", "fasta"] },
        "fasta_text": { "type": "string", "maxLength": 200000 },
        "accession": { "type": "string", "maxLength": 40 },
        "filename": { "type": "string", "maxLength": 200 },
        "objective": { "type": "string", "maxLength": 1000 }
      }
    },
    "output_schema": {
      "type": "object", "required": ["result"],
      "properties": { "result": { "type": "object" } }
    },
    "references": [],
    "limitations": [
      "Route B requires INTERPROSCAN_EMAIL; when it is absent the tool fails closed without submitting a job.",
      "Only one protein per Route B job; small multi-FASTA inputs use Route A.",
      "Member-database releases come from the response; no InterPro release version is guessed."
    ]
  }),
  Object.freeze({
    "id": "protein.get_result",
    "name": "Stored protein annotation result",
    "description": "Read back a genuine stored protein annotation run by its run id from the AI D1 record. Read-only; never re-submits and never reconstructs missing values.",
    "version": "1.0.0-m7.13",
    "backend": "worker",
    "domain": "protein-annotation",
    "available": true,
    "unavailable_reason": null,
    "external_egress": false,
    "requirements": ["binding:AI_DB"],
    "estimated_seconds": 1,
    "params_schema": {
      "type": "object", "additionalProperties": false,
      "required": ["run_id"],
      "properties": { "run_id": { "type": "string" } }
    },
    "input_schema": { "type": "object", "required": [], "properties": {} },
    "output_schema": {
      "type": "object", "required": ["result"],
      "properties": { "result": { "type": "object" } }
    },
    "references": [],
    "limitations": ["A run without a stored result returns a null result with an honest reason."]
  }),
  Object.freeze({
    "id": "protein.get_domain_details",
    "name": "Stored protein domain details",
    "description": "Read one stored protein domain/family/site feature by accession from a genuine annotation run, including coordinates, signature source, integrated entry, GO terms and evidence links. Read-only.",
    "version": "1.0.0-m7.13",
    "backend": "worker",
    "domain": "protein-annotation",
    "available": true,
    "unavailable_reason": null,
    "external_egress": false,
    "requirements": ["binding:AI_DB"],
    "estimated_seconds": 1,
    "params_schema": {
      "type": "object", "additionalProperties": false,
      "required": ["run_id", "accession"],
      "properties": {
        "run_id": { "type": "string" },
        "accession": { "type": "string", "maxLength": 120 }
      }
    },
    "input_schema": { "type": "object", "required": [], "properties": {} },
    "output_schema": {
      "type": "object", "required": ["details"],
      "properties": { "details": { "type": "object" } }
    },
    "references": [],
    "limitations": ["No feature is synthesised when the accession is absent from the stored run."]
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
