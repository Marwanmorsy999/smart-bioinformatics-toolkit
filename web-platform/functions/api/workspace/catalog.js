// M7.4 versioned workflow catalog. STATIC CODE DATA, not D1. It describes what
// each workflow is for and, separately and honestly, what can actually execute
// in this milestone. No entry implies production readiness it does not have.

export const CATALOG_VERSION = "1.0.0-m7.4";

export const WORKFLOWS = Object.freeze([
  Object.freeze({
    id: "16s-rrna-identification",
    version: "1.0.0",
    scientific_purpose: "Profile and identify 16S rRNA sequences using the existing local BLAST + consensus/verdict pipeline.",
    expected_input: "One or more 16S rRNA sequences as FASTA text (legacy inline path capped at 64 KiB).",
    supported_formats: Object.freeze(["fasta"]),
    required_parameters: Object.freeze([]),
    optional_parameters: Object.freeze(["database", "program"]),
    expected_outputs: Object.freeze(["taxonomy assignments", "consensus verdict", "explanation", "report"]),
    validation_capabilities: Object.freeze([
      "FASTA syntax and sequence metrics",
      "taxonomy consensus with explicit ties/abstention",
      "evidence-ledger reference checking",
      "report generated from persisted run records"
    ]),
    execution_availability: Object.freeze({
      state: "available-browser-and-local-agent",
      production_ready: true,
      note: "Uses the existing public /api/ai/requests -> approve -> BLAST path with a single-use consent token for external egress. No new execution was added in M7.4."
    })
  }),
  Object.freeze({
    id: "msa-phylogenetics",
    version: "1.0.0",
    scientific_purpose: "Multiple-sequence alignment followed by phylogenetic tree inference and independent topology validation.",
    expected_input: "A set of homologous nucleotide sequences as FASTA text (aligned or unaligned).",
    supported_formats: Object.freeze(["fasta"]),
    required_parameters: Object.freeze(["sequences"]),
    optional_parameters: Object.freeze(["alignment_tool", "tree_tool"]),
    expected_outputs: Object.freeze(["multiple-sequence alignment", "Newick tree", "validation results"]),
    validation_capabilities: Object.freeze([
      "record count and no silently dropped taxa",
      "equal alignment lengths and DNA alphabet",
      "parseable Newick and taxa-set equality",
      "expected clades on the synthetic reference (known by construction, not a publication-grade benchmark)"
    ]),
    execution_availability: Object.freeze({
      state: "partial-not-production-ready",
      production_ready: false,
      note: "Evidence: docs/M7_3_PHYLOGENETICS_WORKFLOW_REPORT.md. A real MAFFT job executed once historically; an existing succeeded Galaxy MAFFT job can now be resumed by provider job id through the approval-gated /api/ai/workflows/phylo/run flow (read-only resolution, no second submission). Fresh MAFFT → IQ-TREE runs discover tool ids and versions live from the Galaxy instance at run time (never hardcoded as the source of truth). This workspace catalog API itself makes no live Galaxy call and activates no new provider. The full multi-step end-to-end execution on staging is NOT verified in this milestone; the workflow is not production-ready."
    })
  })
]);

export const WORKFLOW_IDS = Object.freeze(WORKFLOWS.map((workflow) => workflow.id));

export function listWorkflows() {
  // Deep copy: callers may not mutate the frozen catalog's nested metadata.
  return JSON.parse(JSON.stringify(WORKFLOWS));
}

export function getWorkflow(id) {
  if (typeof id !== "string") return null;
  return WORKFLOWS.find((workflow) => workflow.id === id) ?? null;
}

export function isKnownWorkflow(id) {
  return getWorkflow(id) !== null;
}
