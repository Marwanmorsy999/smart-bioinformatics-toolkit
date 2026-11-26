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

export { RAW_EXT, TABLE_EXT, FASTA_EXT, QZA_EXT };
