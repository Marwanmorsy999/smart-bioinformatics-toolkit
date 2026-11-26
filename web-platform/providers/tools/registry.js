// Single source of truth for the capabilities advertised by the public
// /api/tools/catalog endpoint and the assistant capability browser.
//
// Every entry below is DERIVED at module load from the authoritative sources:
//   - functions/api/workspace/catalog.js (versioned workflow catalog)
//   - functions/api/ai/registry.tools.generated.js (validated tool manifests)
// No capability is invented, and no execution claim is upgraded. In particular
// msa-phylogenetics stays partial/not-production-ready: a real MAFFT step ran
// once, but the full remote tree/retrieval/validation path is NOT verified.

import { TOOLS } from "../../functions/api/ai/registry.tools.generated.js";
import { WORKER_TOOLS } from "../../functions/api/ai/registry.js";
import { CATALOG_VERSION, WORKFLOWS } from "../../functions/api/workspace/catalog.js";

// Mirrors the authoritative workflow catalog version. Per-tool versions remain
// on their own entries; this module invents no new version number.
export const TOOL_CATALOG_VERSION = CATALOG_VERSION;

export const EXECUTION_LOCATIONS = Object.freeze(["browser", "worker", "python", "external"]);
export const AVAILABILITY_STATES = Object.freeze([
  "available", "browser-only", "local-only", "partial", "disabled", "blocked"
]);

// Links into pages that already ship in public/. No new UI surface is implied.
const WORKFLOW_ENTRY_POINTS = Object.freeze({
  "16s-rrna-identification": Object.freeze({ label: "Open BLAST analyzer", href: "blast.html" }),
  "msa-phylogenetics": Object.freeze({ label: "Open phylogenetics workflow", href: "phylo.html" })
});

const TOOL_ENTRY_POINTS = Object.freeze({
  "phylogenetics.validate": Object.freeze({ label: "Open phylogenetics workflow", href: "phylo.html" }),
  "phylogenetics.align": Object.freeze({ label: "Open phylogenetics workflow", href: "phylo.html" }),
  "phylogenetics.tree": Object.freeze({ label: "Open phylogenetics workflow", href: "phylo.html" }),
  "phylogenetics.report": Object.freeze({ label: "Open phylogenetics workflow", href: "phylo.html" }),
  "phylogenetics.workflow": Object.freeze({ label: "Open phylogenetics workflow", href: "phylo.html" }),
  "sequence-stats.validate": Object.freeze({ label: "Open FASTA validation", href: "index.html#tools" }),
  "sequence-stats.profile": Object.freeze({ label: "Open sequence statistics", href: "index.html#tools" }),
  "microbiome-16s.blast-parse": Object.freeze({ label: "Open BLAST analyzer", href: "blast.html" }),
  "microbiome-16s.taxonomy": Object.freeze({ label: "Open taxonomy analyzer", href: "taxonomy.html" }),
  "ncbi.blastn": Object.freeze({ label: "Open 16S NCBI BLAST workflow", href: "16s.html" })
});

// Paraphrases of the generated descriptions only. No scientific claim is added.
const TOOL_PURPOSES = Object.freeze({
  "phylogenetics.validate": "Validate DNA FASTA records before a phylogenetics analysis.",
  "phylogenetics.align": "Produce a deterministic multiple-sequence alignment of homologous sequences.",
  "phylogenetics.tree": "Infer a neighbor-joining tree from identity distances and emit Newick plus SVG.",
  "phylogenetics.report": "Bundle input hashes, tool versions, parameters and limitations into a reproducible report.",
  "phylogenetics.workflow": "Run the four local phylogenetics adapters as one deterministic job.",
  "sequence-stats.validate": "Check FASTA structure and the explicitly chosen IUPAC alphabet.",
  "sequence-stats.profile": "Summarize FASTA records with length, GC%, composition and N50.",
  "microbiome-16s.blast-parse": "Normalize an existing BLAST TSV into parsed hits.",
  "microbiome-16s.taxonomy": "Derive conservative per-query taxonomic verdicts from parsed BLAST hits.",
  "ncbi.blastn": "Retrieve real NCBI BLASTN evidence for 16S rRNA identification."
});

const copy = (value) => JSON.parse(JSON.stringify(value ?? null));

function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const nested of Object.values(value)) deepFreeze(nested);
  }
  return value;
}

function formatsFromInputSchema(schema) {
  const formats = [];
  if (Object.hasOwn(schema?.properties ?? {}, "fasta_text")) formats.push("fasta");
  if (Object.hasOwn(schema?.properties ?? {}, "tsv_text")) formats.push("tsv");
  return formats;
}

function workflowEntries() {
  return WORKFLOWS.map((workflow) => {
    const availability = workflow.execution_availability ?? {};
    const productionReady = availability.production_ready === true;
    const entryPoint = WORKFLOW_ENTRY_POINTS[workflow.id];
    // Only the 16S path is documented as production ready and browser/local.
    // Phylogenetics stays partial and its remote path stays blocked/unverified.
    const phylogenetic = workflow.id === "msa-phylogenetics";
    const executionLocation = phylogenetic ? ["python", "external"] : ["browser", "python", "external"];
    const limitations = [availability.note ?? "No execution note was declared by the catalog."];
    if (phylogenetic) {
      limitations.push("No MAFFT→IQ-TREE completion is claimed; the full multi-step remote path is not verified.");
    }

    return {
      id: workflow.id,
      kind: "workflow",
      scientific_purpose: workflow.scientific_purpose,
      description: availability.note ?? workflow.scientific_purpose,
      input_schema: {
        type: "object",
        description: workflow.expected_input,
        required: copy(workflow.required_parameters),
        // The catalog declares names only; it declares no wire types here.
        properties: Object.fromEntries(
          [...workflow.required_parameters, ...workflow.optional_parameters].map((name) => [name, {}])
        )
      },
      output_schema: {
        type: "object",
        // Names come straight from expected_outputs; no types are invented.
        required: copy(workflow.expected_outputs),
        properties: Object.fromEntries(workflow.expected_outputs.map((name) => [name, {}]))
      },
      supported_formats: copy(workflow.supported_formats),
      validation_requirements: copy(workflow.validation_capabilities),
      execution_location: executionLocation,
      availability: phylogenetic ? "partial" : "available",
      available: true,
      production_ready: productionReady,
      availability_reason: availability.state ?? "unspecified",
      blocked_paths: phylogenetic ? ["remote tree/retrieval/validation path (unverified)"] : [],
      version: workflow.version,
      dependencies: phylogenetic
        ? ["local-python phylogenetics adapters", "remote tree/retrieval/validation path (unverified; not enabled here)"]
        : ["existing /api/ai/requests -> approve -> BLAST path", "single-use consent token for external egress"],
      external_destinations: phylogenetic
        ? ["remote Galaxy tree/retrieval path — unverified and blocked in this deployment"]
        : ["NCBI BLAST — existing consent-gated path only"],
      limitations,
      recommended_workflow: phylogenetic
        ? [
          "Open the phylogenetics workflow page and load homologous DNA FASTA.",
          "Review the proposed plan; the full remote tree/retrieval/validation path is unverified.",
          "Do not treat this capability as a completed MAFFT→IQ-TREE run.",
          "Any execution requires the existing approval and consent flow."
        ]
        : [
          "Open the BLAST analyzer with a 16S rRNA FASTA dataset.",
          "Use the existing request -> approval -> BLAST path with scoped consent for external egress.",
          "Review the taxonomy verdict and the report generated from persisted run records.",
          "Any execution requires the existing approval and consent flow."
        ],
      entry_point: { ...entryPoint },
      source: { catalog: "functions/api/workspace/catalog.js", version: CATALOG_VERSION }
    };
  });
}

function toolEntries(source = TOOLS) {
  return source.map((tool) => {
    const inputSchema = copy(tool.input_schema ?? {});
    const outputSchema = copy(tool.output_schema ?? {});
    const inputProperties = inputSchema.properties ?? {};
    const requiredInputs = Array.isArray(inputSchema.required) ? inputSchema.required : [];
    const requiredOutputs = Array.isArray(outputSchema.required) ? outputSchema.required : [];
    const paramsSchema = tool.params_schema ?? {};
    const requiredParams = Array.isArray(paramsSchema.required) ? paramsSchema.required : [];
    const available = tool.available === true;

    const validationRequirements = [];
    for (const name of requiredInputs) {
      const rule = inputProperties[name] ?? {};
      const constraints = [
        rule.type ? `type ${rule.type}` : null,
        rule.maxLength ? `maxLength ${rule.maxLength}` : null
      ].filter(Boolean).join(", ");
      validationRequirements.push(`${name} is required${constraints ? ` (${constraints})` : ""}.`);
    }
    for (const name of requiredParams) {
      const rule = paramsSchema.properties?.[name] ?? {};
      const enumValues = Array.isArray(rule.enum) ? ` one of: ${rule.enum.join(", ")}` : "";
      validationRequirements.push(`${name} parameter is required${enumValues}.`);
    }
    if (validationRequirements.length === 0) {
      validationRequirements.push("No required fields are declared by the source schemas.");
    }

    const limitations = copy(tool.limitations ?? []);
    if (tool.unavailable_reason) limitations.push(tool.unavailable_reason);

    const phylogenetic = tool.domain === "phylogenetics";
    const entryPoint = TOOL_ENTRY_POINTS[tool.id];
    const phyloWorkflow = WORKFLOWS.find((workflow) => workflow.id === "msa-phylogenetics");

    return {
      id: tool.id,
      kind: "tool",
      scientific_purpose: TOOL_PURPOSES[tool.id] ?? tool.description,
      description: tool.description,
      input_schema: inputSchema,
      output_schema: outputSchema,
      supported_formats: formatsFromInputSchema(inputSchema),
      validation_requirements: validationRequirements,
      execution_location: tool.external_egress === true ? ["worker", "external"] : ["python"],
      // `available` is the declared flag; local-python tools run in the local
      // agent, never in this browser. The Worker BLAST capability is available
      // only through approval and consent. Disabled tools stay disabled.
      availability: available ? (tool.external_egress === true ? "available" : "local-only") : "disabled",
      available,
      // The generated registry declares availability, not production readiness.
      production_ready: null,
      availability_reason: available ? "local-python adapter declared available" : tool.unavailable_reason,
      // Link the adapter to the honest workflow-level status without upgrading it.
      ...(phylogenetic && phyloWorkflow ? {
        workflow_context: {
          workflow_id: phyloWorkflow.id,
          availability: "partial",
          production_ready: phyloWorkflow.execution_availability.production_ready === true,
          note: phyloWorkflow.execution_availability.note
        }
      } : {}),
      version: tool.version ?? null,
      dependencies: copy(tool.requirements ?? []),
      external_destinations: tool.external_egress === true
        ? ["external egress declared by the manifest; consent required"]
        : [],
      limitations,
      recommended_workflow: [
        `Open ${entryPoint.label}.`,
        `Provide ${requiredInputs.length ? requiredInputs.join(", ") : "the documented inputs"}.`,
        "Review the declared outputs, validation requirements and limitations before accepting any result.",
        "Any execution requires the existing approval and consent flow."
      ],
      entry_point: { ...entryPoint },
      source: {
        registry: tool.external_egress === true
          ? "functions/api/ai/registry.js"
          : "functions/api/ai/registry.tools.generated.js",
        tool_id: tool.id
      }
    };
  });
}

export const TOOL_CATALOG = deepFreeze([
  ...workflowEntries(),
  ...toolEntries(),
  ...toolEntries(WORKER_TOOLS)
]);

export function listCatalog() {
  // Defensive copy: callers may not mutate the frozen single source of truth.
  return copy(TOOL_CATALOG);
}

export function getCatalogEntry(id) {
  if (typeof id !== "string") return null;
  return TOOL_CATALOG.find((entry) => entry.id === id) ?? null;
}

export function catalogIds() {
  return TOOL_CATALOG.map((entry) => entry.id);
}
