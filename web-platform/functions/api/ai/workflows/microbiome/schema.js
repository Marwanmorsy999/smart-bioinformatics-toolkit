// Schema-driven payload builder for the microbiome workflow. Parameter names,
// defaults and dataset fields all come from the LIVE tool's io_details schema.
// Only explicitly supplied, evidence-derived overrides are applied; nothing is
// guessed from a tool name.

const RAW_EXT = ["fastq", "fq", "fastq.gz", "fq.gz", "gz", "zip"];
const TABLE_EXT = ["tsv", "txt", "tabular", "biom"];
const FASTA_EXT = ["fasta", "fa", "fna", "fas", "dna"];
const QZA_EXT = ["qza", "qzv"];

function valueOf(raw) {
  return raw && typeof raw === "object" && "value" in raw ? raw.value : raw;
}

function extensionMatch(parameter, role) {
  const exts = (Array.isArray(parameter.extensions) ? parameter.extensions : [])
    .map((ext) => String(ext).toLowerCase().replace(/^\./, ""));
  if (!exts.length) return true; // an untyped data parameter is a candidate
  const wanted = role === "table" ? TABLE_EXT : role === "fasta" ? FASTA_EXT : role === "artifact" ? QZA_EXT : RAW_EXT;
  return exts.some((ext) => wanted.includes(ext) || wanted.some((wantedExt) => ext.includes(wantedExt)));
}

// Collect all form-style parameter names with their verified default value.
export function describeLiveParameters(schema) {
  const out = [];
  (function visit(inputs, prefix, depth) {
    if (depth > 8) return;
    for (const raw of inputs ?? []) {
      const item = raw && typeof raw === "object" ? raw : {};
      const name = String(item.name ?? "");
      if (!name) continue;
      const full = `${prefix}${name}`;
      const kind = String(item.model_class ?? "");
      const defaultValue = valueOf(item.value) ?? valueOf(item.default_value);
      out.push({ name: full, model_class: kind, default: defaultValue ?? null,
        optional: item.optional === true, extensions: Array.isArray(item.extensions) ? item.extensions : [] });
      if (kind === "Section") visit(item.inputs, `${full}|`, depth + 1);
      else if (kind === "Conditional") {
        const chosen = (item.cases ?? []).find((entry) => String(entry?.value) === String(valueOf(item.test_param?.value)));
        if (chosen) visit(chosen.inputs, `${full}|`, depth + 1);
      } else if (kind === "Repeat") visit(item.inputs, `${full}_0|`, depth + 1);
    }
  })(schema?.inputs, "", 0);
  return out;
}

/**
 * @param {object} schema live io_details schema
 * @param {Array<{id:string, role:string, name?:string}>} datasets one entry per dataset input
 * @param {object} overrides exact form-style parameter names -> evidence-derived values
 */
export function buildMicrobiomePayload(schema, datasets = [], overrides = {}) {
  if (!schema || !Array.isArray(schema.inputs) || !schema.inputs.length) {
    return { valid: false, errors: ["schema_unavailable"], inputs: {}, dataset_fields: {}, applied_overrides: [] };
  }
  const inputs = {};
  const datasetFields = {};
  const appliedOverrides = [];
  const pending = datasets
    .filter((entry) => entry && /^[0-9a-f]+$/i.test(String(entry.id ?? "")))
    .map((entry) => ({ id: String(entry.id), role: String(entry.role ?? "reads"), name: String(entry.name ?? ""), placed: false }));

  (function walk(inputsList, prefix, depth) {
    if (depth > 8) return;
    for (const raw of inputsList ?? []) {
      const item = raw && typeof raw === "object" ? raw : {};
      const name = String(item.name ?? "");
      if (!name) continue;
      const full = `${prefix}${name}`;
      const kind = String(item.model_class ?? "");
      if (kind === "Section") { walk(item.inputs, `${full}|`, depth + 1); continue; }
      if (kind === "Conditional") {
        const test = item.test_param ?? {};
        const testName = String(test.name ?? "");
        const testValue = valueOf(test.value);
        if (testName && testValue !== undefined && testValue !== null) inputs[`${full}|${testName}`] = testValue;
        const chosen = (item.cases ?? []).find((entry) => String(entry?.value) === String(testValue));
        if (chosen) walk(chosen.inputs, `${full}|`, depth + 1);
        continue;
      }
      if (kind === "Repeat") { walk(item.inputs, `${full}_0|`, depth + 1); continue; }
      if (kind.includes("DataToolParameter")) {
        const candidate = pending.find((entry) => !entry.placed && extensionMatch(item, entry.role));
        if (candidate) {
          inputs[full] = { src: "hda", id: candidate.id };
          datasetFields[candidate.role] = full;
          candidate.placed = true;
        } else {
          // Only verified defaults may be applied to an unmatched data input.
          const fallback = valueOf(item.value) ?? valueOf(item.default_value);
          if (fallback !== undefined && fallback !== null) inputs[full] = fallback;
        }
        continue;
      }
      if (Object.hasOwn(overrides, full)) {
        inputs[full] = overrides[full];
        appliedOverrides.push({ name: full, value: overrides[full], basis: "observed_data_or_explicit_choice" });
        continue;
      }
      const value = valueOf(item.value) ?? valueOf(item.default_value);
      if (value !== undefined && value !== null && String(value) !== "") inputs[full] = value;
    }
  })(schema.inputs, "", 0);

  const errors = [];
  for (const entry of pending) if (!entry.placed) errors.push(`no_data_input_for_${entry.role}`);
  return { valid: errors.length === 0, errors, inputs, dataset_fields: datasetFields, applied_overrides: appliedOverrides };
}

// ------------------------------------------------- QIIME 2 EMP import case
//
// `qiime2 tools import` exposes a Conditional whose cases are keyed by the REAL
// QIIME 2 format names in the live schema. We never invent a format value, a
// parameter name or an input order: the case value is read from the live schema
// and reads/barcodes are mapped by the input's own name/help/label text.

const EMP_SINGLE_FORMAT = "SingleLanePerSampleSingleEndFastqDirFmt";

function asInputs(value) {
  return Array.isArray(value) ? value : [];
}
function isData(input) {
  return String(input?.model_class ?? "").includes("DataToolParameter");
}
function isConditional(input) {
  return String(input?.model_class ?? "") === "Conditional";
}
function collectConditionals(inputs, prefix, out, depth) {
  if (depth > 8) return;
  for (const raw of asInputs(inputs)) {
    const item = raw && typeof raw === "object" ? raw : {};
    const name = String(item.name ?? "");
    const full = name ? `${prefix}${name}` : prefix;
    if (isConditional(item) && name) {
      out.push({ conditional: item, prefix, full });
      // Cases are not walked here: each is examined only after its format is
      // selected from the live schema.
      continue;
    }
    if (String(item.model_class ?? "") === "Section" && name) {
      collectConditionals(item.inputs, `${full}|`, out, depth + 1);
    }
  }
}

/** Find the live format case for EMP single-end reads. Never invent a value. */
export function findImportFormatCase(schema, formatHint = EMP_SINGLE_FORMAT) {
  const conditionals = [];
  collectConditionals(schema?.inputs, "", conditionals, 0);
  const needle = String(formatHint).toLowerCase();
  for (const entry of conditionals) {
    const test = entry.conditional.test_param ?? {};
    const options = [...asInputs(test.options), ...asInputs(test.select_options)];
    for (const raw of options) {
      const value = String(raw?.value ?? raw?.id ?? "");
      const label = String(raw?.label ?? raw?.human_name ?? raw?.name ?? "");
      if (!`${value} ${label}`.toLowerCase().includes(needle)) continue;
      const caseEntry = asInputs(entry.conditional.cases).find((item) => String(item?.value) === value);
      if (caseEntry) return { formatValue: value, caseEntry, conditional: entry.conditional, prefix: entry.prefix };
    }
    // Some panels expose the format only as the case value itself.
    for (const caseEntry of asInputs(entry.conditional.cases)) {
      const value = String(caseEntry?.value ?? "");
      if (value.toLowerCase().includes(needle)) {
        return { formatValue: value, caseEntry, conditional: entry.conditional, prefix: entry.prefix };
      }
    }
  }
  return null;
}

function importRoleOf(input) {
  const text = `${input?.name ?? ""} ${input?.help ?? ""} ${input?.label ?? ""} ${input?.description ?? ""}`.toLowerCase();
  const barcode = /barcode|\bbc\b/.test(text);
  const sequence = /sequenc|\bseq\b/.test(text);
  const reads = /reads|fastq/.test(text);
  if (barcode && sequence) return "ambiguous";
  if (barcode) return "barcodes";
  if (sequence || reads) return "reads";
  return "unknown";
}

function applySchemaValue(inputs, raw, full) {
  const item = raw && typeof raw === "object" ? raw : {};
  const name = String(item.name ?? "");
  if (!name) return;
  const value = valueOf(item.value) ?? valueOf(item.default_value);
  if (value !== undefined && value !== null && String(value) !== "") inputs[full] = value;
}

/**
 * Build the import payload from a located format case. Reads/barcodes are
 * attached to the data inputs identified by their own text; names come from the
 * original filenames. Ambiguous mapping fails closed (no payload is submitted).
 */
export function buildImportPayload(schema, matched, { readsId, barcodesId, readsName, barcodesName } = {}) {
  const inputs = {};
  const errors = [];
  if (!matched?.caseEntry || !matched?.conditional) {
    return { valid: false, errors: ["import_format_case_missing"], inputs };
  }
  const conditional = matched.conditional;
  const conditionalName = String(conditional.name ?? "");
  if (!conditionalName) return { valid: false, errors: ["import_conditional_name_missing"], inputs };
  const selectorName = `${matched.prefix}${conditionalName}|${String(conditional.test_param?.name ?? "")}`;
  if (!String(conditional.test_param?.name ?? "")) {
    return { valid: false, errors: ["import_selector_name_missing"], inputs };
  }
  inputs[selectorName] = matched.formatValue;
  for (const raw of asInputs(schema?.inputs)) {
    if (isConditional(raw)) continue;
    applySchemaValue(inputs, raw, String(raw?.name ?? ""));
  }
  const casePrefix = `${matched.prefix}${conditionalName}|`;
  const caseInputs = asInputs(matched.caseEntry.inputs);
  const dataInputs = caseInputs.filter(isData).map((input) => ({ input, role: importRoleOf(input) }));
  const reads = dataInputs.filter((entry) => entry.role === "reads");
  const barcodes = dataInputs.filter((entry) => entry.role === "barcodes");
  if (reads.length !== 1 || barcodes.length !== 1
      || dataInputs.some((entry) => entry.role === "ambiguous" || entry.role === "unknown")) {
    return { valid: false, errors: ["import_input_mapping_ambiguous"], inputs };
  }
  const datasetFields = {};
  for (const [role, entry, id] of [["reads", reads[0], readsId], ["barcodes", barcodes[0], barcodesId]]) {
    const field = `${casePrefix}${String(entry.input.name)}`;
    inputs[field] = { src: "hda", id: String(id ?? "") };
    datasetFields[role] = field;
  }
  for (const raw of caseInputs) {
    if (isData(raw) || isConditional(raw)) continue;
    const text = `${raw?.name ?? ""} ${raw?.help ?? ""} ${raw?.label ?? ""} ${raw?.description ?? ""}`.toLowerCase();
    const full = `${casePrefix}${String(raw?.name ?? "")}`;
    let value = valueOf(raw?.value) ?? valueOf(raw?.default_value);
    if (/name/.test(text)) {
      if (/barcode/.test(text)) value = barcodesName;
      else if (/sequenc|reads/.test(text)) value = readsName;
    }
    if (value !== undefined && value !== null && String(value) !== "") inputs[full] = value;
  }
  return { valid: true, errors: [], inputs, dataset_fields: datasetFields, selector: selectorName,
    format_value: matched.formatValue,
    applied: [{ name: selectorName, value: matched.formatValue, basis: "live_schema_format_case" }] };
}

export { RAW_EXT, TABLE_EXT, FASTA_EXT, QZA_EXT, EMP_SINGLE_FORMAT };
