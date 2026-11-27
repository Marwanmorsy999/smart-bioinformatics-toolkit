// M7.14 dynamic discovery for the 16S microbiome workflow.
//
// There are NO hardcoded tool ids here. Every role is matched against the LIVE
// tool panel supplied by the Galaxy adapter. When a role cannot be matched the
// role stays null and the workflow reports that stage as unavailable with an
// explicit reason — no plausible-looking id or SILVA release is invented.
import { asArray, asObject, safeString } from "../common/normalize.js";
import { findToolById } from "./galaxy_phylo.js";

// Full lowercased names from the VERIFIED live panel, in priority order. These
// are the ONLY names allowed to select a role. First-in-panel substring matching
// previously picked cutadapt demux-paired, fastplong, sidle, mothur classify_tree,
// alphagenome_variant_effect and vcfdistance; that ambiguity is eliminated here.
// No id is hardcoded here — the matched versioned id still comes from the panel.
const EXACT_NAMES = Object.freeze({
  demux: Object.freeze(["qiime2 demux emp-single"]),
  qc: Object.freeze(["qiime2 vsearch fastq-stats", "fastp"]),
  denoise: Object.freeze(["qiime2 dada2 denoise-single"]),
  classify: Object.freeze(["qiime2 feature-classifier classify-sklearn"]),
  alpha: Object.freeze(["qiime2 diversity alpha"]),
  beta: Object.freeze(["qiime2 diversity core-metrics-phylogenetic", "qiime2 diversity beta"]),
  pcoa: Object.freeze(["qiime2 emperor plot"]),
  exportTool: Object.freeze(["qiime2 tools export"]),
  tableSummary: Object.freeze(["qiime2 feature-table summarize"])
});

// Loose criteria are retained only as documentation of the evidence used to
// identify each role. They are NEVER used as a fallback (`strictExact: true`).
const CRITERIA = Object.freeze({
  demux: { nameIncludes: ["emp-single", "emp_single", "demux"], descriptionIncludes: ["demultiplex", "barcode"] },
  qc: { nameIncludes: ["fastq-stats", "evaluate-seqs", "fastp", "quality-control"], descriptionIncludes: ["quality", "fastq", "trim"] },
  denoise: { nameIncludes: ["denoise-single", "dada2"], descriptionIncludes: ["dada2", "denoise"] },
  classify: { nameIncludes: ["classify-sklearn", "classify"], descriptionIncludes: ["taxonomy", "classifier"] },
  alpha: { nameIncludes: ["alpha", "alpha-diversity"], descriptionIncludes: ["alpha", "diversity"] },
  beta: { nameIncludes: ["beta", "distance", "core-metrics"], descriptionIncludes: ["beta", "distance", "diversity"] },
  pcoa: { nameIncludes: ["emperor", "pcoa", "ordination"], descriptionIncludes: ["ordination", "pcoa", "emperor"] },
  exportTool: { nameIncludes: ["export"], descriptionIncludes: ["qiime", "qza", "artifact"] },
  tableSummary: { nameIncludes: ["feature-table summarize", "tabulate-seqs"], descriptionIncludes: ["feature", "table"] }
});

export function findMicrobiomeTools(tools) {
  const out = {};
  for (const [role, criteria] of Object.entries(CRITERIA)) {
    out[role] = findToolById(tools, { ...criteria, exactNames: EXACT_NAMES[role] ?? [], strictExact: true });
  }
  return out;
}

function walkInputs(inputs, depth = 0, visit = () => {}) {
  if (depth > 8) return;
  for (const raw of asArray(inputs)) {
    const item = asObject(raw);
    visit(item);
    if (Array.isArray(item.inputs)) walkInputs(item.inputs, depth + 1, visit);
    for (const entry of asArray(item.cases)) walkInputs(asObject(entry).inputs, depth + 1, visit);
    if (asObject(item.test_param) && Object.keys(asObject(item.test_param)).length) visit(asObject(item.test_param));
  }
}

// Discover a REAL classifier/reference selection from the LIVE tool schema.
// A select parameter's `options` or a data-table-driven parameter's `options`
// are the only legitimate sources. Missing data stays null with a reason.
export function discoverClassifierOptions(schema, { toolId = null, version = null } = {}) {
  // Refuse a schema that belongs to a different tool: no release/option may be
  // borrowed from an unrelated classifier. A schema without tool_id is accepted
  // only because the caller fetched it from the exact discovered tool id.
  if (toolId && safeString(schema?.tool_id, 300) && safeString(schema.tool_id, 300) !== safeString(toolId, 300)) {
    return {
      available: false,
      reason: "The classifier schema belongs to a different tool; no option or release was borrowed.",
      tool_id: toolId, version, candidates: []
    };
  }
  const candidates = [];
  walkInputs(schema?.inputs, 0, (input) => {
    const name = safeString(input.name, 200);
    const help = `${safeString(input.help, 500)} ${safeString(input.description, 500)} ${name}`.toLowerCase();
    if (!/classifier|reference|database|silva|greengenes|rrna|taxonomy/.test(help)) return;
    const options = [];
    for (const raw of asArray(input.options ?? input.select_options)) {
      const option = asObject(raw);
      const value = safeString(option.value ?? option.id, 300);
      const label = safeString(option.label ?? option.human_name ?? option.name, 300);
      if (value || label) options.push({ value: value || null, label: label || value || null });
    }
    if (options.length) {
      candidates.push({
        parameter_name: name || null,
        model_class: safeString(input.model_class, 100) || null,
        options,
        preferred: options.find((option) => /silva|greengenes|rrna|16s/i.test(`${option.label} ${option.value}`)) ?? null
      });
    }
  });
  const selected = candidates.find((candidate) => candidate.preferred) ?? candidates[0] ?? null;
  if (!selected) {
    return {
      available: false,
      reason: "No classifier/reference option was exposed by the live tool schema. No classifier release or identifier was invented.",
      tool_id: toolId, version, candidates: []
    };
  }
  const option = selected.preferred ?? selected.options[0];
  return {
    available: true,
    tool_id: toolId,
    version,
    parameter_name: selected.parameter_name,
    option_value: option.value,
    option_label: option.label,
    selection_basis: "live_tool_schema_options",
    // Provenance is the schema option itself; no release number is guessed.
    reference_identity: option.label,
    // Extracted verbatim from the exposed label, never inferred from a tool name.
    reference_release: (option.label.match(/(?:silva|greengenes|rrna)\s+([0-9][^\s,;]*)/i) ?? [null])[1] ?? null,
    reason: null,
    candidates: candidates.map((candidate) => ({ parameter_name: candidate.parameter_name,
      options: candidate.options.slice(0, 20) }))
  };
}

export const MICROBIOME_ROLE_IDS = Object.freeze(Object.keys(CRITERIA));
