// M7.3 scientific validators. Pure ES module — no network, no secrets.
//
// - validateAlignment(fasta): records count, all sequences equal length, alphabet.
// - validateTree(newick): parseable with an INDEPENDENT parser below; taxa set
//   must match the alignment names (missing/unknown reported).

import { validateFasta } from "../../../blast/_lib.js";

const AA_ALPHABET = /^[ACDEFGHIKLMNPQRSTVWY]*$/i;
const DNA_ALPHABET = /^[ACGT]+$/i;

function parseFastsaRecords(fasta) {
  const text = String(fasta ?? "").replace(/\r\n?/g, "\n");
  const records = [];
  let current = null;
  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim();
    if (!line) continue;
    if (line.startsWith(">")) {
      if (current) records.push(current);
      current = { name: line.slice(1).trim(), sequence: "" };
    } else if (current) {
      current.sequence += line.replace(/[\s]/g, "");
    }
  }
  if (current) records.push(current);
  return records;
}

// Independent Newick parser (recursive descent over ( ) , : ; symbols).
// Grammar: node := label? (":" length)? | "(" node ("," node)* ")" label? (":" length)?
export function parseNewick(text) {
  const s = String(text ?? "").trim();
  if (!s) throw new Error("newick: empty input");
  let pos = 0;
  const peek = () => s[pos];
  const eat = () => { const c = s[pos]; pos += 1; return c; };
  const skipWs = () => { while (pos < s.length && /\s/.test(s[pos])) pos += 1; };
  const parseNumber = () => {
    const start = pos;
    while (pos < s.length && /[-+0-9.eE]/.test(s[pos])) pos += 1;
    const raw = s.slice(start, pos).trim();
    const value = Number(raw);
    return Number.isFinite(value) ? value : null;
  };
  const parseLabel = () => {
    skipWs();
    if (pos >= s.length || "(),".includes(s[pos]) || s[pos] === ":") return null;
    const start = pos;
    while (pos < s.length && !/[\s(),:;]/.test(s[pos])) pos += 1;
    const label = s.slice(start, pos).trim();
    return label || null;
  };
  const parseLength = () => {
    skipWs();
    if (pos >= s.length || s[pos] !== ":") return null;
    eat();
    return parseNumber();
  };
  function parseNode() {
    skipWs();
    if (pos >= s.length) throw new Error("newick: unexpected end of input");
    const node = { name: null, length: null, children: [] };
    if (s[pos] === "(") {
      eat();
      while (true) {
        skipWs();
        if (pos >= s.length) throw new Error("newick: unclosed group");
        if (s[pos] === ")") { eat(); break; }
        node.children.push(parseNode());
        skipWs();
        if (s[pos] === ",") { eat(); continue; }
        if (s[pos] === ")") { eat(); break; }
        throw new Error("newick: expected ',' or ')'");
      }
      node.name = parseLabel();
      node.length = parseLength();
      skipWs();
      if (s[pos] === ";") eat();
    } else {
      node.name = parseLabel();
      node.length = parseLength();
      skipWs();
      if (s[pos] === ";") eat();
    }
    return node;
  }
  const root = parseNode();
  skipWs();
  if (pos < s.length) throw new Error("newick: trailing content after root");
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

export function validateAlignment(fastaText) {
  const check = validateFasta(fastaText);
  if (!check.valid) {
    return { valid: false, error: check.error, code: "alignment_invalid", records: 0, lengths: [] };
  }
  const records = parseFastsaRecords(fastaText);
  const lengths = records.map((r) => r.sequence.length);
  const uniqLengths = new Set(lengths);
  const names = records.map((r) => r.name);
  const dupes = names.filter((n, i) => names.indexOf(n) !== i);
  const mixedAlphabets = records.filter((r) => !(DNA_ALPHABET.test(r.sequence) || AA_ALPHABET.test(r.sequence)));
  const isDna = records.every((r) => DNA_ALPHABET.test(r.sequence));
  const errors = [];
  if (uniqLengths.size > 1) errors.push(`alignment_sequences_unequal_length (${[...uniqLengths].join(",")})`);
  if (dupes.length) errors.push("alignment_duplicate_names");
  if (mixedAlphabets.length) errors.push("alignment_alphabet_mixed");
  if (!lengths.length || lengths.some((l) => l === 0)) errors.push("alignment_has_empty_sequences");
  return {
    valid: errors.length === 0,
    error: errors.length ? errors.join("; ") : null,
    code: errors.length ? "alignment_invalid" : null,
    records: names.length,
    sequence_count: names.length,
    lengths: [...uniqLengths],
    alphabet: isDna ? "dna" : "protein",
    names,
    errors
  };
}

export function validateTree(newickText, alignmentNames) {
  const expected = new Set((alignmentNames ?? []).map((n) => String(n).trim()).filter(Boolean));
  let tree = null;
  let parseError = null;
  try {
    tree = parseNewick(newickText);
  } catch (error) {
    parseError = String(error?.message ?? error);
  }
  if (!tree) {
    return { valid: false, error: parseError ?? "newick: parse failed", code: "tree_parse_failed", taxa: [] };
  }
  const taxa = collectTipNames(tree);
  const taxaSet = new Set(taxa);
  const missing = [...expected].filter((n) => !taxaSet.has(n));
  const unknown = [...taxaSet].filter((n) => !expected.has(n));
  const rootHasTips = Array.isArray(tree.children) && tree.children.length > 0;
  const errors = [];
  if (!rootHasTips && !(tree.name && tree.name !== "")) errors.push("tree_root_has_no_tips");
  if (missing.length) errors.push("tree_missing_taxa");
  if (unknown.length) errors.push("tree_unknown_taxa");
  return {
    valid: errors.length === 0,
    error: errors.length ? errors.join("; ") : null,
    code: errors.length ? "tree_invalid" : null,
    taxa,
    missing,
    unknown,
    root_children: Array.isArray(tree.children) ? tree.children.length : 0
  };
}
