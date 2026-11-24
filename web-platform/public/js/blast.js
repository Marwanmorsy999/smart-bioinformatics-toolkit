export const BLAST_SCHEMAS = {
  standard: [
    "qseqid", "sseqid", "pident", "length", "mismatch", "gapopen",
    "qstart", "qend", "sstart", "send", "evalue", "bitscore"
  ],
  extended: [
    "qseqid", "sacc", "staxids", "sscinames", "pident", "length",
    "qstart", "qend", "qlen", "evalue", "bitscore"
  ],
  blastn_local_v1: [
    "qseqid", "sacc", "staxids", "sscinames", "pident", "length",
    "qstart", "qend", "qlen", "evalue", "bitscore", "qcovs"
  ]
};

const INTEGER_COLUMNS = {
  standard: new Set(["length", "mismatch", "gapopen", "qstart", "qend", "sstart", "send"]),
  extended: new Set(["length", "qstart", "qend", "qlen"]),
  blastn_local_v1: new Set(["length", "qstart", "qend", "qlen"])
};

const FLOAT_COLUMNS = {
  standard: new Set(["pident", "evalue", "bitscore"]),
  extended: new Set(["pident", "evalue", "bitscore"]),
  blastn_local_v1: new Set(["pident", "evalue", "bitscore", "qcovs"])
};

const REQUIRED_STRINGS = {
  standard: new Set(["qseqid", "sseqid"]),
  extended: new Set(["qseqid", "sacc"]),
  blastn_local_v1: new Set(["qseqid", "sacc"])
};

function splitLines(text) {
  return String(text).replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
}

function isIntText(value) {
  const v = String(value).trim();
  if (!v) return false;
  const body = v[0] === "+" || v[0] === "-" ? v.slice(1) : v;
  return /^\d+$/.test(body);
}

function toInt(value) {
  const v = String(value).trim();
  if (!isIntText(v)) return null;
  const n = Number(v);
  if (!Number.isInteger(n)) return null;
  return n;
}

function toFloat(value) {
  const v = String(value).trim();
  if (!v) return null;
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return n;
}

export function inferBlastSchema(text) {
  const counts = new Set();
  let dataLines = 0;
  for (const rawLine of splitLines(text)) {
    const stripped = rawLine.trim();
    if (!stripped || stripped.startsWith("#")) continue;
    counts.add(rawLine.split("\t").length);
    dataLines += 1;
  }
  if (dataLines === 0) return { schema: null, error: "No BLAST data rows were found." };
  if (counts.size === 1 && counts.has(12)) return { schema: "standard", error: null };
  if (counts.size === 1 && counts.has(11)) return { schema: "extended", error: null };
  if (counts.size > 1) {
    return { schema: null, error: `Ambiguous column count: found rows with ${[...counts].sort().join(", ")} columns. Select a schema explicitly.` };
  }
  return { schema: null, error: `Unrecognized column count: ${[...counts].join(", ")}. Expected 12 (standard) or 11 (extended).` };
}

export function parseBlastTsv(text, schema = "auto") {
  if (typeof text !== "string") throw new TypeError("BLAST input must be text.");
  const requested = String(schema || "auto").toLowerCase();
  if (!["auto", "standard", "extended", "blastn_local_v1"].includes(requested)) {
    throw new Error("schema must be 'auto', 'standard', or 'extended'.");
  }

  let resolvedSchema = null;
  let schemaSource = "user";
  let inferError = null;
  if (requested === "auto") {
    const inferred = inferBlastSchema(text);
    resolvedSchema = inferred.schema;
    inferError = inferred.error;
    schemaSource = resolvedSchema ? "inferred" : "auto";
  } else {
    resolvedSchema = requested;
  }

  const columns = resolvedSchema ? BLAST_SCHEMAS[resolvedSchema] : [];
  const rows = [];
  const fileErrors = [];
  if (inferError) fileErrors.push({ code: "SCHEMA_INFERENCE_FAILED", message: inferError, line: null });

  let dataRowIndex = 0;
  for (let i = 0; i < splitLines(text).length; i += 1) {
    const rawLine = splitLines(text)[i];
    const stripped = rawLine.trim();
    if (!stripped || stripped.startsWith("#")) continue;
    dataRowIndex += 1;
    const fields = rawLine.split("\t").map((f) => f.trim());

    if (resolvedSchema && fields.join("\t") === columns.join("\t")) continue; // header

    const row = {
      row_number: i + 1,
      data_row: dataRowIndex,
      raw: rawLine.replace(/\r?\n$/, ""),
      fields,
      values: null,
      errors: [],
      valid: false,
      schema: resolvedSchema
    };

    if (!resolvedSchema) {
      row.errors.push({ code: "SCHEMA_UNRESOLVED", message: "Schema could not be resolved; cannot parse row." });
      rows.push(row);
      continue;
    }

    if (fields.length !== columns.length) {
      row.errors.push({ code: "COLUMN_COUNT", message: `Expected ${columns.length} columns, found ${fields.length}.` });
      rows.push(row);
      continue;
    }

    const values = {};
    columns.forEach((col, idx) => { values[col] = fields[idx]; });
    const errors = [];

    for (const col of REQUIRED_STRINGS[resolvedSchema]) {
      if (!values[col]) errors.push({ code: "MISSING_VALUE", message: `Missing required value for ${col}.`, column: col });
    }

    for (const col of INTEGER_COLUMNS[resolvedSchema]) {
      const n = toInt(values[col]);
      if (n === null) {
        errors.push({ code: "INVALID_INTEGER", message: `Column ${col} must be an integer.`, column: col });
        values[col] = null;
      } else {
        values[col] = n;
      }
    }

    for (const col of FLOAT_COLUMNS[resolvedSchema]) {
      const n = toFloat(values[col]);
      if (n === null) {
        errors.push({ code: "INVALID_NUMBER", message: `Column ${col} must be a finite number.`, column: col });
        values[col] = null;
      } else {
        values[col] = n;
      }
    }

    // range checks
    if (values.pident !== null && (values.pident < 0 || values.pident > 100)) {
      errors.push({ code: "RANGE_ERROR", message: "pident must be between 0 and 100.", column: "pident" });
    }
    if (values.length !== null && values.length < 1) {
      errors.push({ code: "RANGE_ERROR", message: "length must be >= 1.", column: "length" });
    }
    for (const col of ["mismatch", "gapopen"]) {
      if (values[col] !== null && values[col] < 0) {
        errors.push({ code: "RANGE_ERROR", message: `${col} must be >= 0.`, column: col });
      }
    }
    for (const col of ["qstart", "qend", "sstart", "send", "qlen"]) {
      if (values[col] !== undefined && values[col] !== null && values[col] < 1) {
        errors.push({ code: "RANGE_ERROR", message: `${col} must be >= 1.`, column: col });
      }
    }
    if (values.evalue !== null && values.evalue < 0) {
      errors.push({ code: "RANGE_ERROR", message: "evalue must be >= 0.", column: "evalue" });
    }
    if (values.bitscore !== null && values.bitscore < 0) {
      errors.push({ code: "RANGE_ERROR", message: "bitscore must be >= 0.", column: "bitscore" });
    }
    if ((resolvedSchema === "extended" || resolvedSchema === "blastn_local_v1") && values.qlen !== null) {
      for (const col of ["qstart", "qend"]) {
        if (values[col] !== null && values[col] > values.qlen) {
          errors.push({ code: "RANGE_ERROR", message: `${col} exceeds qlen.`, column: col });
        }
      }
    }
    if (resolvedSchema === "blastn_local_v1" && values.qcovs !== null && (values.qcovs < 0 || values.qcovs > 100)) {
      errors.push({ code: "RANGE_ERROR", message: "qcovs must be between 0 and 100.", column: "qcovs" });
    }

    row.errors = errors;
    row.values = values;
    row.valid = errors.length === 0;
    rows.push(row);
  }

  if (resolvedSchema && rows.length === 0) {
    fileErrors.push({ code: "NO_DATA_ROWS", message: "No BLAST data rows were found.", line: null });
  }

  return {
    schema: resolvedSchema,
    schema_requested: requested,
    schema_source: schemaSource,
    columns,
    rows,
    file_errors: fileErrors,
    total_lines: splitLines(text).length,
    data_rows: rows.length,
    parsed_rows: rows.filter((r) => r.valid).length,
    malformed_rows: rows.filter((r) => !r.valid).length
  };
}

export function parseBlast(text, schema = "auto") {
  return parseBlastTsv(text, schema);
}

export function parseQueryLengthsText(text) {
  const lengths = {};
  for (const rawLine of splitLines(text)) {
    const stripped = rawLine.trim();
    if (!stripped || stripped.startsWith("#")) continue;
    const parts = stripped.split(/\s+/);
    if (parts.length < 2) continue;
    const n = Number(parts[1]);
    if (!Number.isFinite(n)) continue;
    lengths[parts[0]] = n;
  }
  return lengths;
}

export function queryLengthsFromFasta(text) {
  // lightweight FASTA parser
  const lengths = {};
  let currentId = null;
  let seq = "";
  const finish = () => {
    if (currentId) lengths[currentId] = seq.replace(/\s+/g, "").length;
  };
  for (const rawLine of splitLines(text)) {
    const line = rawLine.trim();
    if (!line) continue;
    if (line.startsWith(">")) {
      finish();
      currentId = line.slice(1).trim().split(/\s+/)[0];
      seq = "";
    } else if (currentId) {
      seq += line.replace(/\s+/g, "");
    }
  }
  finish();
  return lengths;
}

function coverageFor(values, qlenOverride) {
  let qlen = values.qlen;
  if (qlen === null || qlen === undefined) qlen = qlenOverride;
  if (!qlen) return null;
  const aligned = Math.abs(values.qend - values.qstart) + 1;
  if (qlen <= 0) return null;
  return Number(((aligned / qlen) * 100).toFixed(4));
}

export function analyzeBlast(parsed, options = {}) {
  const opts = options || {};
  const t = opts.thresholds || {};
  const minIdentity = Number.isFinite(opts.minIdentity) ? opts.minIdentity
    : (Number.isFinite(opts.min_identity) ? opts.min_identity
      : (Number.isFinite(t.minIdentity) ? t.minIdentity : (Number.isFinite(t.min_identity) ? t.min_identity : 0)));
  const minQueryCoverage = Number.isFinite(opts.minQueryCoverage) ? opts.minQueryCoverage
    : (Number.isFinite(opts.min_query_coverage) ? opts.min_query_coverage
      : (Number.isFinite(t.minQueryCoverage) ? t.minQueryCoverage : (Number.isFinite(t.min_query_coverage) ? t.min_query_coverage : 0)));
  const maxEvalue = (opts.maxEvalue !== undefined ? opts.maxEvalue
    : (opts.max_evalue !== undefined ? opts.max_evalue
      : (t.maxEvalue !== undefined ? t.maxEvalue : t.max_evalue)));
  const maxHits = opts.maxHits !== undefined ? opts.maxHits
    : (opts.max_hits !== undefined ? opts.max_hits
      : (t.maxHits !== undefined ? t.maxHits : (t.max_hits !== undefined ? t.max_hits : 0)));
  const queryLengths = opts.queryLengths || opts.query_lengths || {};
  const queryIds = opts.queryIds || opts.query_ids || [];

  const schema = parsed.schema;
  const columns = parsed.columns || (schema ? BLAST_SCHEMAS[schema] : []);

  const allQueryIds = [...queryIds];
  for (const qid of Object.keys(queryLengths)) {
    if (!allQueryIds.includes(qid)) allQueryIds.push(qid);
  }

  const rows = (parsed.rows || []).map((row) => {
    const base = {
      row_number: row.row_number,
      data_row: row.data_row,
      raw: row.raw,
      valid: row.valid,
      errors: row.errors || [],
      schema
    };
    const values = row.values || {};
    for (const col of columns) base[col] = values[col] !== undefined ? values[col] : null;
    if (!row.valid || !values || Object.keys(values).length === 0) {
      return Object.assign(base, {
        query_coverage: null,
        identity_pass: false,
        coverage_pass: false,
        evalue_pass: false,
        pass_all: false,
        fail_reasons: ["invalid or unparseable row"],
        rank: null,
        tied: false,
        displayed: false
      });
    }
    const qlenOverride = queryLengths[values.qseqid];
    const coverage = coverageFor(values, qlenOverride);
    const failReasons = [];
    const identityPass = values.pident >= minIdentity;
    if (!identityPass) failReasons.push(`identity ${values.pident}% is below minimum ${minIdentity}%`);
    let coveragePass;
    if (coverage === null) {
      coveragePass = !(minQueryCoverage > 0);
      if (minQueryCoverage > 0) failReasons.push("query coverage unavailable");
    } else {
      coveragePass = coverage >= minQueryCoverage;
      if (!coveragePass) failReasons.push(`query coverage ${coverage}% is below minimum ${minQueryCoverage}%`);
    }
    let evaluePass = true;
    if (maxEvalue !== null && maxEvalue !== undefined) {
      evaluePass = values.evalue <= maxEvalue;
      if (!evaluePass) failReasons.push(`E-value ${values.evalue} exceeds maximum ${maxEvalue}`);
    }
    const passAll = identityPass && coveragePass && evaluePass;
    return Object.assign(base, {
      query_coverage: coverage,
      identity_pass: identityPass,
      coverage_pass: coveragePass,
      evalue_pass: evaluePass,
      pass_all: passAll,
      fail_reasons: failReasons,
      rank: null,
      tied: false,
      displayed: false,
      _values: values
    });
  });

  // ranking per query
  const byQuery = {};
  for (const r of rows) {
    if (r.valid && r._values) {
      const q = r._values.qseqid;
      if (!byQuery[q]) byQuery[q] = [];
      byQuery[q].push(r);
    }
  }
  for (const q of Object.keys(byQuery)) {
    const grp = byQuery[q];
    grp.sort((a, b) => {
      const va = a._values, vb = b._values;
      if (vb.bitscore !== va.bitscore) return vb.bitscore - va.bitscore;
      if (va.evalue !== vb.evalue) return va.evalue - vb.evalue;
      if (vb.pident !== va.pident) return vb.pident - va.pident;
      const aa = Math.abs(va.qend - va.qstart) + 1;
      const ab = Math.abs(vb.qend - vb.qstart) + 1;
      if (ab !== aa) return ab - aa;
      const sa = va.sseqid || va.sacc || "";
      const sb = vb.sseqid || vb.sacc || "";
      return String(sa).localeCompare(String(sb));
    });
    let rank = 0;
    let prevBitscore = null;
    for (const r of grp) {
      if (prevBitscore === null || r._values.bitscore !== prevBitscore) {
        rank += 1;
        prevBitscore = r._values.bitscore;
      }
      r.rank = rank;
      r.tied = grp.filter((o) => o._values.bitscore === r._values.bitscore).length > 1;
    }
  }

  // displayed limit among passing rows per query
  for (const q of Object.keys(byQuery)) {
    const grp = byQuery[q];
    const passing = grp.filter((r) => r.pass_all);
    if (maxHits && maxHits > 0 && passing.length > maxHits) {
      const cutoffRank = passing[maxHits - 1].rank;
      for (const r of passing) r.displayed = r.rank <= cutoffRank;
    } else {
      for (const r of passing) r.displayed = true;
    }
    for (const r of grp) if (!r.pass_all) r.displayed = false;
  }

  const filteredRows = [];
  for (const q of Object.keys(byQuery).sort()) {
    for (const r of byQuery[q]) {
      if (r.pass_all && r.displayed) filteredRows.push(r);
    }
  }

  const noHitQueries = allQueryIds.filter((q) => !Object.prototype.hasOwnProperty.call(byQuery, q));

  // clean internal _values
  const clean = (r) => {
    const out = {};
    for (const k of Object.keys(r)) if (k !== "_values") out[k] = r[k];
    return out;
  };

  const cleanedRows = rows.map(clean);
  const cleanedFiltered = filteredRows.map(clean);
  const grouped = {};
  for (const q of Object.keys(byQuery)) grouped[q] = byQuery[q].map(clean);
  const passingCount = rows.filter((r) => r.pass_all).length;

  return {
    schema,
    columns,
    thresholds: {
      min_identity: minIdentity,
      min_query_coverage: minQueryCoverage,
      max_evalue: maxEvalue === undefined ? null : maxEvalue,
      max_hits: maxHits || 0
    },
    rows: cleanedRows,
    filtered_rows: cleanedFiltered,
    passing_rows: rows.filter((r) => r.pass_all).map(clean),
    grouped,
    queries: Object.keys(byQuery).sort(),
    no_hit_queries: noHitQueries,
    query_lengths: queryLengths,
    summary: {
      schema,
      total_rows: parsed.data_rows || 0,
      valid_rows: parsed.parsed_rows || 0,
      malformed_rows: parsed.malformed_rows || 0,
      unique_queries: Object.keys(byQuery).length,
      total_queries: Object.keys(byQuery).length,
      queries_with_no_hits: noHitQueries.length,
      passing_rows: passingCount,
      displayed_rows: filteredRows.length,
      thresholds: {
        min_identity: minIdentity,
        min_query_coverage: minQueryCoverage,
        max_evalue: maxEvalue === undefined ? null : maxEvalue,
        max_hits: maxHits || 0
      }
    }
  };
}

export function analyzeBlastResults(parsed, options) {
  return analyzeBlast(parsed, options);
}

export function toBlastCsv(rows) {
  if (!rows || !rows.length) return "";
  // flatten fail_reasons
  const flatRows = rows.map((row) => {
    const out = { ...row };
    if (Array.isArray(out.fail_reasons)) out.fail_reasons = out.fail_reasons.join("; ");
    if (Array.isArray(out.errors)) out.errors = out.errors.map((e) => (e && e.message) ? e.message : String(e)).join("; ");
    return out;
  });
  // import toCsv from statistics? reimplement simple
  const columns = [...new Set(flatRows.flatMap((row) => Object.keys(row)))];
  const escape = (value) => {
    if (value === null || value === undefined) return "";
    const text = String(value);
    return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
  };
  return [columns.join(","), ...flatRows.map((row) => columns.map((col) => escape(row[col])).join(","))].join("\r\n");
}

// aliases
export const parseBlastText = parseBlastTsv;
export const analyze = analyzeBlast;
export const toCsv = toBlastCsv;
