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
  // A QIIME 2 artifact role is qza-first, but historical wrappers describe the
  // same data parameter with fastq/fasta/table extensions. It stays a generic
  // dataset role so verified live schemas keep working; hints below decide
  // which of several artifact datasets belongs in which field.
  const wanted = role === "table" ? TABLE_EXT : role === "fasta" ? FASTA_EXT
    : role === "classifier" ? QZA_EXT
      : role === "artifact" ? [...QZA_EXT, ...RAW_EXT, ...FASTA_EXT, ...TABLE_EXT] : RAW_EXT;
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
    .map((entry) => ({ id: String(entry.id), role: String(entry.role ?? "reads"),
      key: String(entry.key ?? entry.role ?? "reads"), name: String(entry.name ?? ""),
      hint: entry.hint ? String(entry.hint) : null, placed: false }));
  const hintMatches = (entry, text) => {
    if (!entry.hint) return false;
    try { return new RegExp(entry.hint, "i").test(text); } catch { return false; }
  };

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
        const text = `${full} ${item.help ?? ""} ${item.label ?? ""} ${item.description ?? ""}`.toLowerCase();
        // A hinted artifact (e.g. classifier vs representative sequences) is
        // preferred for its own field; fall back only to unhinted candidates
        // so two qza datasets cannot be silently swapped.
        const candidate = pending.find((entry) => !entry.placed && entry.hint
          && extensionMatch(item, entry.role) && hintMatches(entry, text))
          ?? pending.find((entry) => !entry.placed && !entry.hint && extensionMatch(item, entry.role))
          ?? pending.find((entry) => !entry.placed && extensionMatch(item, entry.role));
        if (candidate) {
          inputs[full] = { src: "hda", id: candidate.id };
          datasetFields[candidate.key] = full;
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
// `qiime2 tools import` exposes a top-level Conditional whose test is `type`.
// The documented raw EMP multiplexed path is the case labelled
// `EMPSingleEndSequences`, containing a nested `format` Conditional whose
// directory case is labelled `EMP Single End Directory Format`. That case has
// exactly two FASTQ inputs (sequences and barcodes). The alternative
// `SingleLanePerSampleSingleEndFastqDirFmt` case consumes a manifest + YAML and
// is NOT valid for raw multiplexed EMP reads; it is never selected here.
//
// Every selector value placed in a request is read verbatim from the LIVE
// schema. The target strings below are only used to RECOGNISE a case through
// its case value, name, label or option label; they are never sent to Galaxy.

const EMP_TYPE_TARGET = "EMPSingleEndSequences";
const EMP_FORMAT_TARGET = "EMP Single End Directory Format";
const EMP_FORMAT_CLASS = "EMPSingleEndDirFmt"; // QIIME 2 class behind that format label
const LEGACY_FORMAT_HINT = "SingleLanePerSampleSingleEndFastqDirFmt";
const MAX_IMPORT_DEPTH = 8;

function asObject(value) { return value && typeof value === "object" ? value : {}; }
function asInputs(value) { return Array.isArray(value) ? value : []; }
function isData(input) { return String(asObject(input).model_class ?? "").includes("DataToolParameter"); }
function isConditional(input) { return String(asObject(input).model_class ?? "") === "Conditional"; }
function isTypeTest(input) { return /^type$/i.test(String(asObject(input).test_param?.name ?? "").trim()); }

// Galaxy mangles brackets in selector values (`SampleData__ob__X__cb__`), so
// punctuation is dropped before comparing labels; case and separators do not
// change identity. The comparison is still against actual schema strings.
function normalizeIdentity(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/__ob__|__cb__|__op__|__cp__|__lb__|__rb__/g, " ")
    .replace(/[^a-z0-9]+/g, "");
}

function caseEvidence(caseEntry, conditional) {
  const value = String(caseEntry?.value ?? "");
  const test = asObject(conditional).test_param ?? {};
  const options = [...asInputs(test.options), ...asInputs(test.select_options)];
  const option = options.find((raw) => String(asObject(raw).value ?? asObject(raw).id ?? "") === value);
  const named = [
    ["case_value", caseEntry?.value], ["case_name", caseEntry?.name],
    ["case_label", caseEntry?.label], ["case_description", caseEntry?.description],
    ["option_value", option?.value], ["option_id", option?.id], ["option_name", option?.name],
    ["option_label", option?.label ?? option?.human_name], ["option_description", option?.description]
  ];
  return named
    .filter(([, raw]) => raw !== undefined && raw !== null && String(raw) !== "")
    .map(([source, raw]) => ({ source, raw: String(raw), identity: normalizeIdentity(raw) }));
}

function matchTypeCase(caseEntry, conditional) {
  const target = normalizeIdentity(EMP_TYPE_TARGET);
  const hit = caseEvidence(caseEntry, conditional).find((entry) => entry.identity === target);
  return hit ? { target: EMP_TYPE_TARGET, value: String(caseEntry?.value ?? ""), ...hit,
    basis: "exact_type_selector" } : null;
}

function matchFormatCase(caseEntry, conditional) {
  const evidence = caseEvidence(caseEntry, conditional);
  const exact = normalizeIdentity(EMP_FORMAT_TARGET);
  const documentedClass = normalizeIdentity(EMP_FORMAT_CLASS);
  let hit = evidence.find((entry) => entry.identity === exact);
  let basis = "exact_format_label";
  if (!hit) {
    hit = evidence.find((entry) => entry.identity === documentedClass);
    basis = "documented_format_class";
  }
  if (!hit) {
    // Different wording in a live wrapper: require independent directory-format
    // evidence in the actual label/description and record which string matched.
    hit = evidence.find((entry) => entry.identity.startsWith("empsingleend")
      && entry.identity.includes("directory")
      && (entry.identity.includes("format") || entry.identity.includes("dirfmt")));
    basis = "descriptive_format_evidence";
  }
  return hit ? { target: EMP_FORMAT_TARGET, value: String(caseEntry?.value ?? ""), ...hit, basis } : null;
}

function caseExposesManifestYaml(caseEntry) {
  const text = asInputs(caseEntry?.inputs).map((raw) => {
    const item = asObject(raw);
    return `${item.name ?? ""} ${item.help ?? ""} ${item.label ?? ""} ${item.description ?? ""}`;
  }).join(" ").toLowerCase();
  return /manifest|ya?ml|yml/.test(text);
}

// Galaxy's `qiime2 tools import` wrapper declares a generic `data` extension
// for its per-file data inputs and puts the real format in the help text
// (`This data should be formatted as a FastqGzFormat...`). Accept EITHER a
// specific FASTQ extension OR an explicit FASTQ format statement in the live
// help/label/description. A generic `data`/`file`/`dataset` extension is not
// evidence either way; only absent or contradictory evidence fails closed.
function fastqEvidence(input) {
  const item = asObject(input);
  const exts = (Array.isArray(item.extensions) ? item.extensions : [])
    .map((ext) => String(ext ?? "").toLowerCase().replace(/^\./, ""));
  const text = `${item.help ?? ""} ${item.label ?? ""} ${item.description ?? ""}`.toLowerCase();
  const extFastq = exts.find((ext) => /fastq|fq|gz/.test(ext));
  const extSpecificOther = exts.find((ext) => ext && !/fastq|fq|gz|data|file|dataset|input|raw/.test(ext));
  const textFastq = /fastqgzformat|fastq[ _-]?format|\bfastq\b|\bfq\b/.test(text);
  const textSpecificOther = /\b(?:tsv|csv|biom|fasta|qza|qzv|txt)\b|tabular|manifest|ya?ml/.test(text);
  // When a specific FASTQ extension is present it is the primary evidence; the
  // help text is still recorded but does not replace the old extension basis.
  if (textFastq && !extSpecificOther && !extFastq) {
    return { compatible: true, basis: "fastq_format_help", extensions: exts,
      text_evidence: "FastqGzFormat/Fastq Format/FASTQ" };
  }
  if (extFastq && !textSpecificOther) {
    return { compatible: true, basis: "declared_fastq_extension", extensions: exts, text_evidence: null };
  }
  if ((textFastq && extSpecificOther) || (extFastq && textSpecificOther)) {
    return { compatible: false, basis: "contradictory_fastq_evidence", extensions: exts,
      text_evidence: textFastq ? "FastqGzFormat/Fastq Format/FASTQ" : "non-FASTQ format statement" };
  }
  return { compatible: false, basis: "no_fastq_evidence", extensions: exts, text_evidence: null };
}

function asNullableString(value) {
  return value === undefined || value === null ? null : String(value);
}

function compactEvidence(evidence) {
  if (!evidence || typeof evidence !== "object") return null;
  const one = (hit) => hit && typeof hit === "object" ? { target: hit.target, source: hit.source,
    raw: hit.raw, value: hit.value, basis: hit.basis } : null;
  return { type: one(evidence.type), format: one(evidence.format) };
}

/**
 * Walk the LIVE schema including nested Conditionals inside case inputs. The
 * `flags` output records whether the wrapper is a typed one (`import_root|type`)
 * so a typed schema can never silently fall back to the manifest/YAML branch.
 */
function collectImportCases(inputs, prefix, selectors, evidence, depth, out, flags) {
  if (depth > MAX_IMPORT_DEPTH) return;
  for (const raw of asInputs(inputs)) {
    const item = asObject(raw);
    const name = String(item.name ?? "");
    if (!name) continue;
    const full = `${prefix}${name}`;
    if (isConditional(item)) {
      if (isTypeTest(item)) flags.typeConditional = true;
      const testName = String(item.test_param?.name ?? "");
      const testKey = testName ? `${full}|${testName}` : null;
      const casePrefix = `${full}|`;
      for (const caseEntry of asInputs(item.cases)) {
        const value = String(caseEntry?.value ?? "");
        const nextSelectors = testKey ? [...selectors, { name: testKey, value }] : selectors;
        const typeMatch = matchTypeCase(caseEntry, item);
        const formatMatch = matchFormatCase(caseEntry, item);
        const nextEvidence = { ...evidence };
        if (typeMatch) { flags.typeSeen = true; nextEvidence.type = typeMatch; }
        if (formatMatch) nextEvidence.format = formatMatch;
        // The type selector can be on an ancestor conditional (the live wrapper
        // groups formats under `import_root|type` cases), so use the inherited
        // evidence when recording a fully identified EMP path.
        if (nextEvidence.type && nextEvidence.format) {
          out.push({ selectors: nextSelectors, conditional: item, caseEntry, prefix: casePrefix,
            formatValue: value, typeValue: nextEvidence.type.value, evidence: nextEvidence,
            manifestYamlCase: caseExposesManifestYaml(caseEntry) });
        }
        collectImportCases(asObject(caseEntry).inputs, casePrefix, nextSelectors, nextEvidence,
          depth + 1, out, flags);
      }
      continue;
    }
    if (String(item.model_class ?? "") === "Section") {
      collectImportCases(item.inputs, `${full}|`, selectors, evidence, depth + 1, out, flags);
    }
  }
}

function caseExposesFormat(caseEntry, conditional, needle) {
  const value = String(caseEntry?.value ?? "");
  if (value.toLowerCase() === needle) return true;
  const test = asObject(conditional).test_param ?? {};
  const options = [...asInputs(test.options), ...asInputs(test.select_options)];
  const option = options.find((raw) => String(raw?.value ?? raw?.id ?? "") === value);
  if (!option) return false;
  const label = String(option?.label ?? option?.human_name ?? option?.name ?? "");
  return label.toLowerCase() === needle;
}

// Pre-history stub schemas have no `type` selector at all. This bounded legacy
// path keeps those labelled tests intact. It is disabled for any schema with a
// `type` conditional, and it refuses manifest/YAML cases, so the live typed
// wrapper can only be satisfied by the EMP directory case below.
function collectLegacyPaths(inputs, prefix, selectors, depth, needle, out) {
  if (depth > MAX_IMPORT_DEPTH) return;
  for (const raw of asInputs(inputs)) {
    const item = asObject(raw);
    const name = String(item.name ?? "");
    if (!name) continue;
    const full = `${prefix}${name}`;
    if (isConditional(item)) {
      const testName = String(item.test_param?.name ?? "");
      const testKey = testName ? `${full}|${testName}` : null;
      const casePrefix = `${full}|`;
      for (const caseEntry of asInputs(item.cases)) {
        const nextSelectors = testKey ? [...selectors, { name: testKey, value: String(caseEntry?.value ?? "") }] : selectors;
        if (caseExposesFormat(caseEntry, item, needle)) {
          out.push({ selectors: nextSelectors, caseEntry, prefix: casePrefix,
            formatValue: String(caseEntry?.value ?? ""), evidence: { format: null },
            typeValue: null, manifestYamlCase: caseExposesManifestYaml(caseEntry) });
        }
        collectLegacyPaths(asObject(caseEntry).inputs, casePrefix, nextSelectors, depth + 1, needle, out);
      }
      continue;
    }
    if (String(item.model_class ?? "") === "Section") {
      collectLegacyPaths(item.inputs, `${full}|`, selectors, depth + 1, needle, out);
    }
  }
}

/** Find the live EMP single-end DIRECTORY case and every selector leading to it. */
export function findImportFormatCase(schema, formatHint = LEGACY_FORMAT_HINT) {
  const flags = { typeSeen: false, typeConditional: false };
  const paths = [];
  collectImportCases(schema?.inputs, "", [], {}, 0, paths, flags);
  const emp = paths.filter((path) => path.evidence.type && path.evidence.format && !path.manifestYamlCase);
  if (emp.length) {
    const rank = (path) => path.evidence.format.basis === "exact_format_label" ? 3
      : path.evidence.format.basis === "documented_format_class" ? 2 : 1;
    emp.sort((left, right) => rank(right) - rank(left));
    const chosen = emp[0];
    return { ...chosen, type_value: chosen.typeValue, selection_basis: "live_type_and_format_selectors",
      legacy: false };
  }
  // A typed live wrapper without the EMP directory case must fail closed: no
  // manifest/YAML case and no placeholder value may be substituted.
  if (flags.typeConditional || flags.typeSeen) return null;
  const legacy = [];
  collectLegacyPaths(schema?.inputs, "", [], 0, String(formatHint).toLowerCase(), legacy);
  const safe = legacy.filter((path) => !path.manifestYamlCase);
  if (!safe.length) return null;
  return { ...safe[0], type_value: null, selection_basis: "legacy_format_hint", legacy: true };
}

function importRoleOf(input) {
  const text = `${input?.name ?? ""} ${input?.help ?? ""} ${input?.label ?? ""} ${input?.description ?? ""}`.toLowerCase();
  const barcode = /barcode|\bbc\b/.test(text);
  const sequence = /sequenc|\bseq\b/.test(text);
  // `fastq` alone names a FILE FORMAT, not a dataset role: the live wrapper
  // writes "formatted as a FastqGzFormat" on both inputs. Only `reads` is a
  // role signal here; format text is handled by fastqEvidence().
  const reads = /reads/.test(text);
  if (barcode && sequence) return "ambiguous";
  if (barcode) return "barcodes";
  if (sequence || reads) return "reads";
  return "unknown";
}

// The live wrapper names the data input simply `data` inside per-file groups
// such as `import_sequences` / `import_barcodes`. The full field path carries
// that role evidence even when the leaf input's own help only names the format.
function roleFromFieldPath(field) {
  const text = String(field ?? "").toLowerCase();
  const barcode = /barcode|\bbc\b/.test(text);
  const sequence = /sequenc|\bseq\b/.test(text);
  if (barcode && sequence) return "ambiguous";
  if (barcode) return "barcodes";
  if (sequence) return "reads";
  return null;
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
    const item = asObject(raw);
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
 * Resolve the two data inputs of a selected case. `allowOrderFallback` is true
 * ONLY for the pre-history legacy schemas: for the real EMP case the order of
 * two unlabelled inputs is never used as a mapping guess.
 */
function resolveCaseRoles(entries, { allowOrderFallback = false } = {}) {
  const fail = (detail) => ({ valid: false, errors: ["import_input_mapping_ambiguous"], detail });
  const dataIndices = entries.map((entry, index) => (isData(entry.input) ? index : -1)).filter((index) => index >= 0);
  if (dataIndices.length !== 2) return fail("The live case exposes "
    + `${dataIndices.length} data inputs; exactly two are required.`);
  const mapped = dataIndices.map((index) => {
    const nameParam = nearestNameParam(entries, index);
    const fromName = nameParam ? nameParamEvidence(nameParam.entry) : null;
    const fromField = roleFromFieldPath(entries[index].field);
    const fromInput = importRoleOf(entries[index].input);
    const rolesSeen = [fromName, fromField, fromInput]
      .filter((value) => value && value !== "unknown" && value !== "conflict");
    const conflict = fromName === "conflict" || fromField === "ambiguous"
      || fromInput === "ambiguous" || new Set(rolesSeen).size > 1;
    const role = conflict ? "conflict" : (rolesSeen[0] ?? null);
    return { entry: entries[index], nameParam, fromName, fromField, fromInput, role,
      fastq: fastqEvidence(entries[index].input) };
  });
  if (mapped.some((item) => !item.fastq.compatible)) return fail("A live data input is not FASTQ-compatible.");
  if (mapped.some((item) => item.role === "conflict")) return fail("Conflicting reads/barcodes evidence in the live schema.");

  const reads = mapped.filter((item) => item.role === "reads");
  const barcodes = mapped.filter((item) => item.role === "barcodes");
  let pairs;
  let mappingBasis;
  if (reads.length === 1 && barcodes.length === 1) {
    pairs = { reads: reads[0], barcodes: barcodes[0] };
    mappingBasis = mapped.some((item) => item.fromField)
      && mapped.some((item) => item.fastq.basis === "fastq_format_help")
      ? "field_name_and_fastq_format_help"
      : (mapped.some((item) => item.fromName && item.fromName !== "conflict")
        ? "name_text_help" : "input_text");
  } else if (allowOrderFallback && mapped.every((item) => item.role === null)) {
    // Legacy-only: order is the sole schema-backed signal and is recorded as
    // such. The live EMP path never reaches this branch.
    pairs = { reads: mapped[0], barcodes: mapped[1] };
    mappingBasis = "schema_order_two_inputs";
  } else {
    return fail("The live data inputs could not be mapped unambiguously.");
  }
  return { valid: true, errors: [], pairs, mapped, mappingBasis,
    mapping: { reads: pairs.reads.entry.field, barcodes: pairs.barcodes.entry.field } };
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
  const roles = resolveCaseRoles(entries, { allowOrderFallback: matched.legacy === true });
  if (!roles.valid) return { valid: false, errors: roles.errors, inputs, detail: roles.detail };
  const { pairs, mapped, mappingBasis } = roles;

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
    type_value: matched.type_value ?? null,
    selection_basis: matched.selection_basis ?? null,
    case_evidence: compactEvidence(matched.evidence),
    mapping_basis: mappingBasis,
    mapping: roles.mapping,
    mapping_evidence: mapped.map((item) => ({ field: item.entry.field, from_name_param: item.fromName,
      from_field_name: item.fromField, from_input: item.fromInput, resolved_role: item.role,
      fastq: item.fastq })),
    applied: matched.selectors.map((entry) => ({ name: entry.name, value: entry.value,
      basis: "live_schema_format_case" })) };
}

/**
 * Read-only provenance view of the chosen live import case. Returns metadata
 * ONLY: names, model classes, extensions and bounded help/label text. No
 * credentials, dataset content, history data or provider responses are exposed.
 */
export function describeImportCase(schema, matched) {
  const unavailable = (reason) => ({ available: false, reason,
    tool_id: asNullableString(schema?.tool_id), version: null });
  if (!matched) {
    return unavailable(`The live import schema does not expose the ${LEGACY_FORMAT_HINT} format case, `
      + `nor the ${EMP_TYPE_TARGET} + ${EMP_FORMAT_TARGET} EMP directory case; no value was invented.`);
  }
  // A live-schema shape must never turn a read-only diagnostic into a throw.
  // Require the minimum metadata this function actually reads; anything less
  // is reported honestly instead of producing an empty platform error.
  const caseEntry = asObject(matched.caseEntry);
  const selectors = Array.isArray(matched.selectors) ? matched.selectors : null;
  const usableSelectors = selectors && selectors.length > 0
    && selectors.every((entry) => entry && typeof entry === "object"
      && typeof entry.name === "string" && entry.name !== "" && entry.value !== undefined);
  if (!matched.caseEntry || typeof matched.caseEntry !== "object" || !usableSelectors) {
    return unavailable("The live import case metadata is incomplete (missing case entry or selector path); no case was selected.");
  }
  try {
    const entries = [];
    collectCaseInputs(Array.isArray(caseEntry.inputs) ? caseEntry.inputs : [],
      typeof matched.prefix === "string" ? matched.prefix : "", entries);
    const preview = (value) => String(value ?? "").slice(0, 300);
    const roles = resolveCaseRoles(entries, { allowOrderFallback: matched.legacy === true });
    const inputs = entries.map((entry) => {
      const nameParam = nearestNameParam(entries, entries.indexOf(entry));
      // resolveCaseRoles() returns no `mapped` on failure; a non-mappable live
      // case must be reported with a null mapping, not throw a TypeError here.
      const mappedRole = roles.mapped?.find((item) => item.entry === entry) ?? null;
      return {
        name: String(entry.input.name ?? ""),
        field: entry.field,
        model_class: String(entry.input.model_class ?? ""),
        extensions: (Array.isArray(entry.input.extensions) ? entry.input.extensions : [])
          .slice(0, 20).map((ext) => String(ext ?? "").slice(0, 100)),
        help: preview(entry.input.help),
        label: preview(entry.input.label),
        resolved_role: mappedRole ? mappedRole.role : null,
        field_name_evidence: mappedRole ? mappedRole.fromField : null,
        name_param_evidence: isData(entry.input) && nameParam ? nameParamEvidence(nameParam.entry) : null,
        fastq_compatible: isData(entry.input) ? fastqEvidence(entry.input).compatible : null,
        fastq_basis: isData(entry.input) ? fastqEvidence(entry.input).basis : null
      };
    });
    return {
      available: true,
      selected_case: matched.legacy ? "legacy_format_hint" : "emp_single_end_directory",
      selection_basis: matched.selection_basis ?? "live_io_details_schema",
      tool_id: asNullableString(schema?.tool_id ?? matched.tool_id),
      tool_version: asNullableString(schema?.tool_version ?? matched.tool_version),
      discovered_format_value: matched.formatValue ?? null,
      type_value: matched.type_value ?? null,
      selector_path: selectors.map((entry) => ({ name: entry.name, value: entry.value })),
      case_evidence: compactEvidence(matched.evidence),
      manifest_yaml_branch_excluded: matched.manifestYamlCase === false,
      inputs,
      chosen_mapping: roles.valid ? roles.mapping : null,
      mapping_basis: roles.valid ? roles.mappingBasis : null,
      chosen_dataset_mapping: roles.valid ? {
        uploaded_sequences_fastaq: roles.mapping.reads, uploaded_barcodes_fastq: roles.mapping.barcodes
      } : null,
      basis: "live_io_details_schema"
    };
  } catch (caught) {
    const reason = String(caught?.message ?? caught ?? "")
      .replace(/\b(api[-_]?key|token|secret|password|credential)\b\s*[:=]\s*\S+/gi, "$1=[redacted]")
      .slice(0, 200);
    return unavailable(`The live import case metadata could not be described safely: `
      + `${String(caught?.name ?? "Error")}: ${reason}`);
  }
}

/** Optional `?format=all` view: every candidate case, metadata only. */
export function describeAllImportCases(schema) {
  const candidates = [];
  (function visit(inputs, prefix, selectors, depth) {
    if (depth > MAX_IMPORT_DEPTH || candidates.length >= 50) return;
    for (const raw of asInputs(inputs)) {
      const item = asObject(raw);
      const name = String(item.name ?? "");
      if (!name) continue;
      const full = `${prefix}${name}`;
      if (!isConditional(item)) {
        if (String(item.model_class ?? "") === "Section") visit(item.inputs, `${full}|`, selectors, depth + 1);
        continue;
      }
      const testName = String(item.test_param?.name ?? "");
      const testKey = testName ? `${full}|${testName}` : null;
      for (const caseEntry of asInputs(item.cases)) {
        const value = String(caseEntry?.value ?? "");
        const path = testKey ? [...selectors, { name: testKey, value }] : selectors;
        const nested = [];
        collectCaseInputs(asObject(caseEntry).inputs, `${full}|`, nested);
        const typeHit = matchTypeCase(caseEntry, item);
        const formatHit = matchFormatCase(caseEntry, item);
        candidates.push({
          selector_path: path, case_value: value,
          type_evidence: typeHit ? compactEvidence({ type: typeHit }).type : null,
          format_evidence: formatHit ? compactEvidence({ format: formatHit }).format : null,
          manifest_yaml_case: caseExposesManifestYaml(caseEntry),
          inputs: nested.slice(0, 20).map((entry) => ({ name: String(entry.input.name ?? ""),
            model_class: String(entry.input.model_class ?? ""),
            extensions: (Array.isArray(entry.input.extensions) ? entry.input.extensions : []).slice(0, 20).map((ext) => String(ext)) }))
        });
        visit(asObject(caseEntry).inputs, `${full}|`, path, depth + 1);
      }
    }
  })(schema?.inputs, "", [], 0);
  return candidates;
}

export { RAW_EXT, TABLE_EXT, FASTA_EXT, QZA_EXT, EMP_TYPE_TARGET, EMP_FORMAT_TARGET,
  EMP_FORMAT_CLASS, LEGACY_FORMAT_HINT, compactEvidence };
