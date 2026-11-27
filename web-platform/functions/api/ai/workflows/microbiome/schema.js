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
const MAX_IMPORT_DEPTH = 8;

function asInputs(value) {
  return Array.isArray(value) ? value : [];
}
function isData(input) {
  return String(input?.model_class ?? "").includes("DataToolParameter");
}
function isConditional(input) {
  return String(input?.model_class ?? "") === "Conditional";
}

function caseExposesFormat(caseEntry, conditional, needle) {
  const value = String(caseEntry?.value ?? "");
  if (value.toLowerCase() === needle) return true;
  const test = conditional?.test_param ?? {};
  const options = [...asInputs(test.options), ...asInputs(test.select_options)];
  const option = options.find((raw) => String(raw?.value ?? raw?.id ?? "") === value);
  if (!option) return false;
  const label = String(option?.label ?? option?.human_name ?? option?.name ?? "");
  return value.toLowerCase() === needle || label.toLowerCase() === needle;
}

/**
 * Recursively walk the LIVE schema, including nested Conditionals inside case
 * inputs (useGalaxy groups formats under `import_root` cases such as `None`).
 * Every selector value recorded here is read from an option/case in the schema;
 * nothing is inferred from a tool name or a known QIIME 2 convention.
 */
function collectFormatPaths(inputs, prefix, selectors, depth, needle, out) {
  if (depth > MAX_IMPORT_DEPTH) return;
  for (const raw of asInputs(inputs)) {
    const item = raw && typeof raw === "object" ? raw : {};
    const name = String(item.name ?? "");
    if (!name) continue;
    const full = `${prefix}${name}`;
    if (isConditional(item)) {
      const testName = String(item.test_param?.name ?? "");
      const testKey = testName ? `${full}|${testName}` : null;
      const casePrefix = `${full}|`;
      for (const caseEntry of asInputs(item.cases)) {
        const value = String(caseEntry?.value ?? "");
        const nextSelectors = testKey ? [...selectors, { name: testKey, value }] : selectors;
        if (caseExposesFormat(caseEntry, item, needle)) {
          out.push({ selectors: nextSelectors, conditional: item, caseEntry, prefix: casePrefix,
            formatValue: value });
        }
        collectFormatPaths(caseEntry.inputs, casePrefix, nextSelectors, depth + 1, needle, out);
      }
      continue;
    }
    if (String(item.model_class ?? "") === "Section") {
      collectFormatPaths(item.inputs, `${full}|`, selectors, depth + 1, needle, out);
    }
  }
}

/** Find the live EMP single-end format case and every selector leading to it. */
export function findImportFormatCase(schema, formatHint = EMP_SINGLE_FORMAT) {
  const needle = String(formatHint).toLowerCase();
  const paths = [];
  collectFormatPaths(schema?.inputs, "", [], 0, needle, paths);
  if (!paths.length) return null;
  // A generic group such as `None` is preferred over a format-specific group,
  // when the schema exposes both. The value still comes from the live schema.
  paths.sort((left, right) => {
    const generic = (entry) => /^none$/i.test(String(entry.selectors[0]?.value ?? "")) ? 0 : 1;
    return generic(left) - generic(right);
  });
  return paths[0];
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

// The live import case may describe its two files through a `name` text
// parameter's help/regex (e.g. `barcodes.fastq.gz` vs `sequences.fastq.gz`)
// rather than through the data input itself. Read that evidence verbatim.
function nameParamEvidence(entry) {
  const text = String(entry?.text ?? "");
  const barcode = /barcodes?\.fastq(?:\.gz)?|barcode/i.test(text);
  const sequence = /sequences?\.fastq(?:\.gz)?|sequenc/i.test(text);
  if (barcode && sequence) return "conflict";
  if (barcode) return "barcodes";
  if (sequence) return "reads";
  return null;
}

// Galaxy exposes the file-name text parameters in the same order as their data
// inputs. Pair by ordinal within the case (works both for [data,data,name,name]
// and the interleaved [data,name,data,name] layouts), never by text proximity.
function nearestNameParam(entries, index) {
  const dataIndices = entries.map((entry, position) => (isData(entry.input) ? position : -1))
    .filter((position) => position >= 0);
  const ordinal = dataIndices.indexOf(index);
  if (ordinal < 0) return null;
  const nameEntries = entries.filter((entry) => !isData(entry.input) && /name/.test(entry.text));
  return nameEntries[ordinal] ? { entry: nameEntries[ordinal], position: ordinal } : null;
}

function applySchemaValue(inputs, raw, full) {
  const item = raw && typeof raw === "object" ? raw : {};
  const name = String(item.name ?? "");
  if (!name) return;
  const value = valueOf(item.value) ?? valueOf(item.default_value);
  if (value !== undefined && value !== null && String(value) !== "") inputs[full] = value;
}

function collectCaseInputs(inputs, prefix, out, depth = 0) {
  if (depth > MAX_IMPORT_DEPTH) return;
  for (const raw of asInputs(inputs)) {
    const item = raw && typeof raw === "object" ? raw : {};
    const name = String(item.name ?? "");
    if (!name || isConditional(item)) continue;
    const full = `${prefix}${name}`;
    if (String(item.model_class ?? "") === "Section") {
      collectCaseInputs(item.inputs, `${full}|`, out, depth + 1);
      continue;
    }
    out.push({ input: item, field: full,
      text: `${name} ${item.help ?? ""} ${item.label ?? ""} ${item.description ?? ""}`.toLowerCase() });
  }
}

/**
 * Build the import payload from a located (possibly nested) format case. Every
 * conditional selector on the path is set to the exact live-schema case value;
 * reads/barcodes are attached to the inputs identified by their own text and
 * names come from the original filenames. Ambiguous mapping fails closed.
 */
export function buildImportPayload(schema, matched, { readsId, barcodesId, readsName, barcodesName } = {}) {
  const inputs = {};
  if (!matched?.caseEntry || !Array.isArray(matched.selectors) || !matched.selectors.length) {
    return { valid: false, errors: ["import_format_case_missing"], inputs };
  }
  for (const selector of matched.selectors) {
    if (!selector?.name) return { valid: false, errors: ["import_selector_name_missing"], inputs };
    inputs[selector.name] = selector.value;
  }
  for (const raw of asInputs(schema?.inputs)) {
    if (isConditional(raw)) continue;
    applySchemaValue(inputs, raw, String(raw?.name ?? ""));
  }
  const entries = [];
  collectCaseInputs(matched.caseEntry.inputs, matched.prefix, entries);
  const dataIndices = entries.map((entry, index) => (isData(entry.input) ? index : -1)).filter((index) => index >= 0);
  const failMapping = (detail) => ({ valid: false, errors: ["import_input_mapping_ambiguous"],
    inputs, detail: detail ?? null });
  if (dataIndices.length !== 2) {
    return failMapping(`The live case exposes ${dataIndices.length} data inputs; exactly two are required.`);
  }
  const mapped = dataIndices.map((index) => {
    const nameParam = nearestNameParam(entries, index);
    const fromName = nameParam ? nameParamEvidence(nameParam.entry) : null;
    const fromInput = importRoleOf(entries[index].input);
    const conflict = fromName === "conflict" || fromInput === "ambiguous";
    const role = conflict ? "conflict"
      : (fromName && fromName !== "conflict" ? fromName : (fromInput === "unknown" ? null : fromInput));
    return { entry: entries[index], nameParam, fromName, fromInput, role };
  });
  if (mapped.some((item) => item.role === "conflict")) return failMapping("Conflicting reads/barcodes evidence in the live schema.");

  const reads = mapped.filter((item) => item.role === "reads");
  const barcodes = mapped.filter((item) => item.role === "barcodes");
  let pairs;
  let mappingBasis;
  if (reads.length === 1 && barcodes.length === 1) {
    pairs = { reads: reads[0], barcodes: barcodes[0] };
    mappingBasis = mapped.some((item) => item.fromName && item.fromName !== "conflict")
      ? "name_text_help" : "input_text";
  } else if (mapped.every((item) => item.role === null)) {
    // Exactly two genuinely indistinguishable inputs: order is the only
    // schema-backed signal. It is recorded, never presented as a discovered name.
    pairs = { reads: mapped[0], barcodes: mapped[1] };
    mappingBasis = "schema_order_two_inputs";
  } else {
    return failMapping("The live data inputs could not be mapped unambiguously.");
  }

  const datasetFields = {};
  for (const [role, id] of [["reads", readsId], ["barcodes", barcodesId]]) {
    const field = pairs[role].entry.field;
    inputs[field] = { src: "hda", id: String(id ?? "") };
    datasetFields[role] = field;
  }
  for (const entry of entries) {
    if (isData(entry.input)) continue;
    let value = valueOf(entry.input.value) ?? valueOf(entry.input.default_value);
    if (/name/.test(entry.text)) {
      const paired = mapped.find((item) => item.nameParam?.entry === entry);
      if (paired && paired === pairs.barcodes) value = barcodesName;
      else if (paired && paired === pairs.reads) value = readsName;
      else if (/barcode/.test(entry.text)) value = barcodesName;
      else if (/sequenc|reads/.test(entry.text)) value = readsName;
    }
    if (value !== undefined && value !== null && String(value) !== "") inputs[entry.field] = value;
  }
  const formatSelector = matched.selectors[matched.selectors.length - 1];
  return { valid: true, errors: [], inputs, dataset_fields: datasetFields, selector: formatSelector.name,
    selectors: matched.selectors.map((entry) => ({ ...entry })),
    format_value: matched.formatValue,
    mapping_basis: mappingBasis,
    mapping: { reads: pairs.reads.entry.field, barcodes: pairs.barcodes.entry.field },
    mapping_evidence: mapped.map((item) => ({ field: item.entry.field, from_name_param: item.fromName,
      from_input: item.fromInput, resolved_role: item.role })),
    applied: matched.selectors.map((entry) => ({ name: entry.name, value: entry.value,
      basis: "live_schema_format_case" })) };
}

/**
 * Read-only provenance view of the chosen live import case. Returns metadata
 * ONLY: names, model classes, extensions and bounded help/label text. No
 * credentials, dataset content, history data or provider responses are exposed.
 */
export function describeImportCase(schema, matched) {
  if (!matched) {
    return { available: false,
      reason: `The live import schema does not expose the ${EMP_SINGLE_FORMAT} format case; no value was invented.`,
      tool_id: String(schema?.tool_id ?? null), version: null };
  }
  const entries = [];
  collectCaseInputs(matched.caseEntry.inputs, matched.prefix, entries);
  const preview = (value) => String(value ?? "").slice(0, 300);
  const inputs = entries.map((entry) => {
    const nameParam = nearestNameParam(entries, entries.indexOf(entry));
    return {
      name: String(entry.input.name ?? ""),
      model_class: String(entry.input.model_class ?? ""),
      extensions: (Array.isArray(entry.input.extensions) ? entry.input.extensions : []).slice(0, 20).map((ext) => String(ext)),
      help: preview(entry.input.help),
      label: preview(entry.input.label),
      name_param_evidence: isData(entry.input) && nameParam ? nameParamEvidence(nameParam.entry) : null
    };
  });
  return {
    available: true,
    tool_id: String(schema?.tool_id ?? matched.tool_id ?? null),
    discovered_format_value: matched.formatValue,
    selector_path: matched.selectors.map((entry) => ({ name: entry.name, value: entry.value })),
    inputs,
    basis: "live_io_details_schema"
  };
}

export { RAW_EXT, TABLE_EXT, FASTA_EXT, QZA_EXT, EMP_SINGLE_FORMAT };
