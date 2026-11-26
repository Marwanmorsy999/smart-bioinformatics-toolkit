// M7.14 dynamic discovery for the 16S microbiome workflow.
//
// There are NO hardcoded tool ids here. Every role is matched against the LIVE
// tool panel supplied by the Galaxy adapter. When a role cannot be matched the
// role stays null and the workflow reports that stage as unavailable with an
// explicit reason — no plausible-looking id or SILVA release is invented.
import { asArray, asObject, safeString } from "../common/normalize.js";
import { findToolById } from "./galaxy_phylo.js";

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
  for (const [role, criteria] of Object.entries(CRITERIA)) out[role] = findToolById(tools, criteria);
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
    reference_release: (option.label.match(/(?:silva|greengenes|rrna)[^\s]*/i) ?? [null])[0],
    reason: null,
    candidates: candidates.map((candidate) => ({ parameter_name: candidate.parameter_name,
      options: candidate.options.slice(0, 20) }))
  };
}

export const MICROBIOME_ROLE_IDS = Object.freeze(Object.keys(CRITERIA));
