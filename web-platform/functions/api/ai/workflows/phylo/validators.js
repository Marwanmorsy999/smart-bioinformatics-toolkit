// M7.11 scientific validators. Pure ES module — no network, no secrets.
//
// - validateInputFasta(fasta): INPUT gate for raw homologous sequences. Unequal
//   lengths are legitimate BEFORE MAFFT, so this gate deliberately does NOT
//   require equal lengths (only the retrieved alignment does).
// - validateAlignment(fasta): strict ALIGNED-output checks — equal lengths,
//   IUPAC/gap alphabet and deterministic column metrics. Gaps are legal in an
//   aligned FASTA, so the generic BLAST FASTA gate (which rejects '-') is
//   deliberately NOT reused here.
// - validateTree(newick, alignmentNames, options): parseable with an INDEPENDENT
//   parser below; taxa-set equality on first-token accession labels (raw names
//   retained), duplicate/unnamed tips, finite branch lengths (negative ML
//   lengths are retained verbatim and warned about, never clamped), parsed
//   support labels and an explicit rooting statement.
// Every number returned here is computed from the supplied text. No value is
// inferred from a fixture, a model or an illustrative example.

const DNA_ALPHABET = /^[ACGTURYSWKMBDHVN-]+$/i;
const PROTEIN_ALPHABET = /^[ACDEFGHIKLMNPQRSTVWY-]+$/i;
const MAX_NODES = 20_000;
const NUMBER = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/;

function parseFastaRecords(fasta) {
  const text = String(fasta ?? "").replace(/\r\n?/g, "\n");
  const records = [];
  let current = null;
  let lineNumber = 0;
  for (const rawLine of text.split("\n")) {
    lineNumber += 1;
    const line = rawLine.trim();
    if (!line) continue;
    if (line.startsWith(">")) {
      if (current) records.push(current);
      current = { name: line.slice(1).trim(), sequence: "", header_line: lineNumber };
    } else if (current) {
      current.sequence += line.replace(/\s+/g, "");
    }
  }
  if (current) records.push(current);
  return records;
}

// ---------------------------------------------------------------- Newick parse
//
// Grammar: node := label? (":" length)? | "(" node ("," node)* ")" label? (":" length)?
// Labels may be quoted. An unquoted label may itself contain ':' (IQ-TREE writes
// labels such as `UFboot:95`, `UFboot2:95` or `95/87`); the LAST colon followed
// by a number is the branch-length separator unless the label is a support
// label. A non-numeric tail is retained as raw_length and reported as an
// invalid branch length rather than silently dropped.

const SUPPORT_LABEL_PREFIX = /^(ufboot|sh-?alrt|bootstrap|support|sh|local bootstrap)$/i;

function splitLabelAndLength(raw, { internal = false } = {}) {
  const text = String(raw ?? "").trim();
  if (!text) return { name: null, rawLength: null };
  const colon = text.lastIndexOf(":");
  if (colon > 0) {
    const name = text.slice(0, colon).trim();
    const tail = text.slice(colon + 1).trim();
    const numericTail = NUMBER.test(tail) && Number(tail) <= 1000;
    // Known prefixes are always support labels. For unrecognized prefixes on
    // internal nodes, an integer-sized numeric tail (>= 1, e.g. `UFboot2:95`)
    // is support-only; sub-unit tails such as `Inner:0.2` stay branch lengths.
    const unrecognizedSupport = internal && /[A-Za-z]/.test(name)
      && numericTail && Number(tail) >= 1;
    if ((SUPPORT_LABEL_PREFIX.test(name) || unrecognizedSupport) && numericTail) {
      return { name: text, rawLength: null };
    }
    if (name && tail) return { name, rawLength: tail };
  }
  return { name: text, rawLength: null };
}

export function parseNewick(text) {
  const s = String(text ?? "").trim();
  if (!s) throw new Error("newick: empty input");
  let pos = 0;
  let nodes = 0;
  const eat = () => { const c = s[pos]; pos += 1; return c; };
  const skipWs = () => { while (pos < s.length && /\s/.test(s[pos])) pos += 1; };
  const makeNode = () => {
    nodes += 1;
    if (nodes > MAX_NODES) throw new Error("newick: too many nodes");
    return { id: nodes - 1, name: null, length: null, raw_length: null,
      invalid_length: false, label_raw: null, children: [] };
  };
  const parseQuoted = (quote) => {
    let out = "";
    eat(); // opening quote
    while (pos < s.length) {
      const c = eat();
      if (c === "\\" && pos < s.length) { out += eat(); continue; }
      if (c === quote) return out;
      out += c;
    }
    throw new Error("newick: unclosed quoted label");
  };
  const parseLabelToken = ({ internal = false } = {}) => {
    skipWs();
    if (pos >= s.length) return { name: null, rawLength: null };
    if (s[pos] === "'" || s[pos] === '"') {
      const name = parseQuoted(s[pos]);
      skipWs();
      let rawLength = null;
      if (s[pos] === ":") {
        eat();
        const start = pos;
        while (pos < s.length && !/[\s(),;]/.test(s[pos])) pos += 1;
        rawLength = s.slice(start, pos).trim() || null;
      }
      return { name, rawLength };
    }
    if ("(),;".includes(s[pos]) || s[pos] === ":") return { name: null, rawLength: null };
    const start = pos;
    while (pos < s.length && !/[\s(),;]/.test(s[pos])) pos += 1;
    return splitLabelAndLength(s.slice(start, pos), { internal });
  };
  const parseLengthAfterLabel = () => {
    skipWs();
    if (pos >= s.length || s[pos] !== ":") return null;
    eat();
    const start = pos;
    while (pos < s.length && /[-+0-9.eE]/.test(s[pos])) pos += 1;
    const raw = s.slice(start, pos).trim();
    if (!raw) {
      // Consume a non-numeric tail so it can be reported, not misparsed.
      while (pos < s.length && !/[\s(),;]/.test(s[pos])) pos += 1;
      return s.slice(start, pos).trim() || null;
    }
    return raw;
  };
  const applyLabel = (node, parsed) => {
    node.label_raw = parsed.name ? String(parsed.name) : null;
    node.name = parsed.name;
    applyLength(node, parsed.rawLength);
  };
  const applyLength = (node, raw) => {
    if (raw === null || raw === undefined || raw === "") return;
    node.raw_length = String(raw);
    const value = NUMBER.test(String(raw)) ? Number(raw) : null;
    if (value === null || !Number.isFinite(value)) {
      node.invalid_length = true;
      node.length = null;
    } else {
      node.length = value;
    }
  };
  const parseNode = (depth) => {
    skipWs();
    if (pos >= s.length) throw new Error("newick: unexpected end of input");
    const node = makeNode();
    node.depth = depth;
    if (s[pos] === "(") {
      eat();
      while (true) {
        skipWs();
        if (pos >= s.length) throw new Error("newick: unclosed group");
        if (s[pos] === ")") { eat(); break; }
        node.children.push(parseNode(depth + 1));
        skipWs();
        if (s[pos] === ",") { eat(); continue; }
        if (s[pos] === ")") { eat(); break; }
        throw new Error("newick: expected ',' or ')'");
      }
      applyLabel(node, parseLabelToken({ internal: node.children.length > 0 }));
      const explicit = parseLengthAfterLabel();
      if (explicit !== null && node.raw_length === null) applyLength(node, explicit);
    } else {
      applyLabel(node, parseLabelToken({ internal: false }));
      const explicit = parseLengthAfterLabel();
      if (explicit !== null && node.raw_length === null) applyLength(node, explicit);
    }
    skipWs();
    if (s[pos] === ";") eat();
    return node;
  };
  const root = parseNode(0);
  skipWs();
  if (pos < s.length) throw new Error("newick: trailing content after root");
  const all = [];
  (function walk(node) {
    all.push(node);
    for (const child of node.children) { child.parent = node; walk(child); }
  })(root);
  for (const node of all) {
    node.is_tip = node.children.length === 0;
    if (!node.is_tip) node.support = parseSupportValues(node.label_raw);
  }
  return root;
}

export function collectTipNames(node, out = []) {
  if (!node || typeof node !== "object") return out;
  if (Array.isArray(node.children) && node.children.length > 0) {
    for (const child of node.children) collectTipNames(child, out);
  } else {
    const name = node.name ? String(node.name).trim() : "";
    if (name) out.push(name);
  }
  return out;
}

function allNodes(root) {
  const out = [];
  (function walk(node) {
    if (!node || typeof node !== "object") return;
    out.push(node);
    for (const child of node.children ?? []) walk(child);
  })(root);
  return out;
}

// ------------------------------------------------------------- support labels

export function parseSupportValues(label) {
  const raw = String(label ?? "").trim();
  const base = { raw, format: "none", values: [], primary: null };
  if (!raw) return base;
  const numbers = (text) => (String(text).match(/\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/g) ?? [])
    .map((value) => Number(value)).filter((value) => Number.isFinite(value));
  const named = raw.split(":")[0];
  const afterColon = raw.includes(":") ? raw.slice(raw.indexOf(":") + 1) : raw;
  const namedKinds = named.includes("/") ? named.split("/").map((s) => s.trim()).filter(Boolean) : [named.trim()].filter(Boolean);
  const looksNamed = namedKinds.some((kind) => /[A-Za-z]/.test(kind));
  if (looksNamed) {
    const values = numbers(afterColon);
    return {
      raw,
      format: values.length ? "named-numeric" : "named-only",
      values: values.map((value, index) => ({ kind: namedKinds[index] ?? namedKinds[namedKinds.length - 1], value })),
      primary: values.length ? values[0] : null
    };
  }
  const values = numbers(raw);
  if (!values.length) return { ...base, format: "text-only" };
  const format = values.length > 1 && /[\/,]/.test(raw) ? "slash-separated" : "plain-number";
  return {
    raw,
    format,
    values: values.map((value) => ({ kind: "unspecified", value })),
    primary: values[0]
  };
}

// --------------------------------------------------------- taxon label mapping
//
// IQ-TREE frequently writes accession-only tip labels while the aligned FASTA
// keeps the full header ("NR_115348.1 Francisella ..."). Correspondence is
// checked on the FIRST whitespace-delimited token on BOTH sides; the raw tree
// labels and raw alignment names are always retained in the report.
export function normalizeTaxonLabel(label) {
  const text = String(label ?? "").trim();
  return text ? text.split(/\s+/)[0] : "";
}

// ------------------------------------------------------------------- metrics

export function computeAlignmentMetrics(fastaText) {
  const records = parseFastaRecords(fastaText);
  const lengths = records.map((record) => record.sequence.length);
  const sameLength = lengths.length > 0 && lengths.every((length) => length === lengths[0]);
  const alignmentLength = sameLength ? lengths[0] : null;
  let gapCount = 0;
  let conservedColumns = 0;
  if (alignmentLength !== null) {
    for (let column = 0; column < alignmentLength; column += 1) {
      const chars = records.map((record) => record.sequence[column]);
      if (chars.every((char) => char === "-" || char === ".")) continue;
      if (chars.every((char) => char === chars[0])) conservedColumns += 1;
    }
    for (const record of records) {
      for (const char of record.sequence) if (char === "-" || char === ".") gapCount += 1;
    }
  }
  return {
    sequence_count: records.length,
    alignment_length: alignmentLength,
    column_count: alignmentLength,
    gap_count: gapCount,
    conserved_columns: conservedColumns,
    variable_columns: alignmentLength === null ? null : alignmentLength - conservedColumns,
    lengths: [...new Set(lengths)].sort((a, b) => a - b),
    min_length: lengths.length ? Math.min(...lengths) : null,
    max_length: lengths.length ? Math.max(...lengths) : null
  };
}

export function computeTreeMetrics(root, { outgroup = null } = {}) {
  const nodes = allNodes(root);
  const tips = nodes.filter((node) => node.is_tip);
  const internal = nodes.filter((node) => !node.is_tip);
  const nonRoot = nodes.filter((node) => node !== root && !node.is_root);
  const branchLengths = nonRoot.map((node) => ({
    node_id: node.id,
    value: node.length,
    raw: node.raw_length,
    invalid: node.invalid_length || (node.raw_length !== null && !Number.isFinite(node.length))
  })).filter((entry) => entry.raw !== null);
  // Finite/parseable validity and non-negativity are DISTINCT properties.
  // A tiny negative ML branch length is real evidence, never clamped or dropped.
  const invalid = branchLengths.filter((entry) => entry.invalid);
  const negative = branchLengths.filter((entry) => Number.isFinite(entry.value) && entry.value < 0);
  const missingCount = nonRoot.filter((node) => node.raw_length === null).length;
  const supportValues = internal.map((node) => ({
    node_id: node.id,
    label: node.label_raw,
    ...parseSupportValues(node.label_raw)
  })).filter((entry) => entry.values.length > 0);
  const tipNames = tips.map((node) => String(node.name ?? "").trim()).filter(Boolean);
  const normalizedTipNames = tipNames.map(normalizeTaxonLabel).filter(Boolean);
  const declaredOutgroup = outgroup ? String(outgroup).trim() : null;
  const outgroupPresent = Boolean(declaredOutgroup && (
    tipNames.includes(declaredOutgroup)
    || normalizedTipNames.includes(normalizeTaxonLabel(declaredOutgroup))
  ));
  let rootingStatus = "unknown";
  let rootingBasis = "No outgroup was declared; biological rooting cannot be established from Newick text alone.";
  if (outgroupPresent) {
    rootingStatus = "rooted-by-declared-outgroup";
    rootingBasis = `Outgroup '${declaredOutgroup}' was supplied by the caller and is present among the tips.`;
  } else if (declaredOutgroup) {
    rootingStatus = "outgroup-not-found";
    rootingBasis = `The declared outgroup '${declaredOutgroup}' is not among the tree tips.`;
  } else if (Array.isArray(root?.children) && root.children.length > 2) {
    rootingStatus = "unrooted-representation";
    rootingBasis = "The Newick root has more than two children (unrooted convention); no outgroup was declared.";
  }
  return {
    tip_count: tips.length,
    internal_node_count: internal.length,
    node_count: nodes.length,
    support_values: supportValues,
    support_value_count: supportValues.length,
    branch_lengths: {
      present: branchLengths.length,
      missing: missingCount,
      invalid_count: invalid.length,
      invalid: invalid.map((entry) => ({ node_id: entry.node_id, raw: entry.raw })),
      negative_count: negative.length,
      negative: negative.map((entry) => ({ node_id: entry.node_id, value: entry.value, raw: entry.raw })),
      min: branchLengths.some((e) => Number.isFinite(e.value))
        ? Math.min(...branchLengths.filter((e) => Number.isFinite(e.value)).map((e) => e.value)) : null,
      max: branchLengths.some((e) => Number.isFinite(e.value))
        ? Math.max(...branchLengths.filter((e) => Number.isFinite(e.value)).map((e) => e.value)) : null
    },
    // `branch_length_valid` = all present lengths are finite/parseable.
    branch_length_valid: invalid.length === 0,
    branch_length_nonnegative: negative.length === 0,
    branch_lengths_complete: invalid.length === 0 && missingCount === 0,
    // Negative lengths are retained verbatim but must not drive layout.
    usable_for_length_layout: invalid.length === 0 && negative.length === 0 && missingCount === 0,
    rooting: {
      status: rootingStatus,
      basis: rootingBasis,
      declared_outgroup: declaredOutgroup,
      outgroup_verified: outgroupPresent,
      invented_outgroup: false
    }
  };
}

// ----------------------------------------------------------------- validators

export function validateAlignment(fastaText) {
  const records = parseFastaRecords(fastaText);
  const errors = [];
  if (!String(fastaText ?? "").trim().startsWith(">")) {
    return { valid: false, error: "FASTA input must start with a '>' header line.", code: "alignment_invalid",
      records: 0, lengths: [], sequence_count: 0, names: [], errors: ["alignment_has_no_header"] };
  }
  if (records.length === 0) errors.push("alignment_has_no_records");
  const badHeaders = records.map((record, index) => ({ record, index })).filter(({ record }) => !record.name);
  if (badHeaders.length) errors.push(`alignment_empty_header_at_record_${badHeaders[0].index + 1}`);
  const emptyRecords = records.filter((record) => !record.sequence);
  if (emptyRecords.length) errors.push("alignment_has_empty_sequences");

  const dna = records.filter((record) => DNA_ALPHABET.test(record.sequence));
  const protein = records.filter((record) => PROTEIN_ALPHABET.test(record.sequence));
  const alphabet = dna.length === records.length && records.length > 0 ? "dna"
    : (protein.length === records.length && records.length > 0 ? "protein" : "mixed");
  if (alphabet === "mixed") errors.push("alignment_alphabet_mixed");

  const lengths = records.map((record) => record.sequence.length);
  const uniqLengths = [...new Set(lengths)].sort((a, b) => a - b);
  if (uniqLengths.length > 1) errors.push(`alignment_sequences_unequal_length (${uniqLengths.join(",")})`);
  const names = records.map((record) => record.name);
  const duplicates = names.filter((name, index) => name && names.indexOf(name) !== index);
  if (duplicates.length) errors.push("alignment_duplicate_names");

  const metrics = computeAlignmentMetrics(fastaText);
  return {
    valid: errors.length === 0,
    error: errors.length ? errors.join("; ") : null,
    code: errors.length ? "alignment_invalid" : null,
    records: names.length,
    sequence_count: names.length,
    lengths: uniqLengths,
    alphabet,
    names,
    duplicates,
    errors,
    metrics
  };
}

// --------------------------------------------------------------- input gate
//
// Pure, network-free gate for RAW (pre-alignment) homologous sequences.
// Unequal lengths are expected here: MAFFT is precisely the step that makes
// them equal. This helper never accepts fewer than three distinct records and
// never silently drops a malformed record. `validateAlignment` remains strict
// for the retrieved MAFFT output and is the ONLY place equal length is required.
export function validateInputFasta(fastaText) {
  const records = parseFastaRecords(fastaText);
  const errors = [];
  if (!String(fastaText ?? "").trim().startsWith(">")) {
    return { valid: false, error: "FASTA input must start with a '>' header line.",
      records: 0, lengths: [], names: [], errors: ["input_has_no_header"] };
  }
  if (records.length < 3) errors.push("input_requires_at_least_three_records");
  const badHeaders = records.map((record, index) => ({ record, index })).filter(({ record }) => !record.name);
  if (badHeaders.length) errors.push(`input_empty_identifier_at_record_${badHeaders[0].index + 1}`);
  const emptyRecords = records.filter((record) => !record.sequence);
  if (emptyRecords.length) errors.push("input_has_empty_sequences");
  const invalidRecords = records.filter((record) => record.sequence && !DNA_ALPHABET.test(record.sequence));
  if (invalidRecords.length) errors.push("input_alphabet_not_dna_iupac");
  const names = records.map((record) => record.name);
  const duplicates = names.filter((name, index) => name && names.indexOf(name) !== index);
  if (duplicates.length) errors.push("input_duplicate_identifiers");
  const lengths = records.map((record) => record.sequence.length);
  return {
    valid: errors.length === 0,
    error: errors.length ? errors.join("; ") : null,
    records: records.length,
    names,
    lengths,
    duplicates,
    unique_lengths: [...new Set(lengths)].sort((a, b) => a - b),
    errors
  };
}

export function validateTree(newickText, alignmentNames, options = {}) {
  const expectedRaw = (alignmentNames ?? []).map((name) => String(name).trim()).filter(Boolean);
  const expected = new Set(expectedRaw.map(normalizeTaxonLabel).filter(Boolean));
  let tree = null;
  let parseError = null;
  try {
    tree = parseNewick(newickText);
  } catch (error) {
    parseError = String(error?.message ?? error);
  }
  if (!tree) {
    return { valid: false, error: parseError ?? "newick: parse failed", code: "tree_parse_failed",
      taxa: [], taxa_normalized: [], alignment_names: expectedRaw, label_normalization: "first_token_accession",
      missing: [], unknown: [], duplicates: [], warnings: [], errors: [parseError ?? "tree_parse_failed"],
      rooting: { status: "unknown", basis: "No parseable tree was available; rooting cannot be assessed.",
        declared_outgroup: null, outgroup_verified: false, invented_outgroup: false },
      metrics: computeTreeMetrics(null) };
  }

  // RAW labels stay in `taxa`; correspondence uses the first-token accession
  // on both the Newick tips and the alignment headers.
  const taxa = collectTipNames(tree);
  const taxaNormalized = taxa.map(normalizeTaxonLabel).filter(Boolean);
  const taxaSet = new Set(taxaNormalized);
  const missing = [...expected].filter((name) => !taxaSet.has(name));
  const unknown = expected.size ? [...taxaSet].filter((name) => !expected.has(name)) : [];
  const duplicates = taxaNormalized.filter((name, index) => taxaNormalized.indexOf(name) !== index);
  const unnamedTips = allNodes(tree).filter((node) => node.is_tip && !node.name).length;
  const rootHasTips = Array.isArray(tree.children) && tree.children.length > 0;
  const metrics = computeTreeMetrics(tree, { outgroup: options?.outgroup ?? null });
  const errors = [];
  if (!rootHasTips) errors.push("tree_root_has_no_tips");
  if (missing.length) errors.push("tree_missing_taxa");
  if (unknown.length) errors.push("tree_unknown_taxa");
  if (duplicates.length) errors.push("tree_duplicate_taxa");
  if (unnamedTips) errors.push("tree_unnamed_tips");
  if (!metrics.branch_length_valid) errors.push("tree_invalid_branch_length");
  // Finite negative ML lengths are evidence, not errors: warn without clamping.
  const warnings = [];
  if (metrics.branch_lengths.negative_count > 0) warnings.push("tree_negative_branch_lengths");

  return {
    valid: errors.length === 0,
    error: errors.length ? errors.join("; ") : null,
    code: errors.length ? "tree_invalid" : null,
    taxa,
    taxa_normalized: taxaNormalized,
    alignment_names: expectedRaw,
    label_normalization: "first_token_accession",
    missing,
    unknown,
    duplicates,
    warnings,
    unnamed_tip_count: unnamedTips,
    root_children: Array.isArray(tree.children) ? tree.children.length : 0,
    rooting: metrics.rooting,
    support_values: metrics.support_values,
    branch_lengths: metrics.branch_lengths,
    metrics,
    errors
  };
}
