// M7.4 unified workflow catalog. Availability reflects ACTUAL platform state:
// the Galaxy phylogenetics remote chain remains blocked (no rotated key), so it
// is advertised as interface-only, never as production-ready execution.
export const WORKFLOWS = Object.freeze([
  {
    id: "16s-identification",
    version: "1.0.0",
    name: "16S rRNA identification",
    purpose: "Parse BLAST evidence and derive a conservative taxonomic verdict per query.",
    expected_input: "BLAST TSV (standard, extended or blastn_local_v1)",
    formats: ["tsv", "txt"],
    parameters: [{ name: "min_identity", required: false }, { name: "top_n", required: false }],
    expected_outputs: ["parse.json", "taxonomy.json", "report.html"],
    validation: "Schema, hit parsing and conservative consensus checks (offline, deterministic).",
    availability: "available",
    provider: "local",
    entry_point: "blast.html"
  },
  {
    id: "phylogenetics-msa-tree",
    version: "1.0.0",
    name: "Multiple-sequence alignment and phylogenetics",
    purpose: "Align a multi-FASTA dataset and infer a phylogenetic tree via Galaxy MAFFT/IQ-TREE.",
    expected_input: "Multi-FASTA with unique identifiers and homologous DNA sequences",
    formats: ["fasta", "fa", "fna", "fas"],
    parameters: [{ name: "sequence_type", required: true, value: "dna" }],
    expected_outputs: ["alignment.fasta", "tree.nwk", "phylo_report.html"],
    validation: "Independent alignment and Newick parsers, record/taxa checks (offline).",
    availability: "blocked",
    blocked_reason: "Remote Galaxy execution is blocked pending rotation of the exposed API key and live artifact recovery.",
    provider: "galaxy",
    entry_point: "phylo.html"
  }
]);
export function getWorkflow(id) {
  return WORKFLOWS.find((w) => w.id === String(id ?? "")) ?? null;
}
export function publicCatalog() {
  return WORKFLOWS.map((w) => ({ ...w }));
}
