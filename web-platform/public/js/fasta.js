export const ALPHABETS = {
  dna: {
    accepted: new Set("ACGTRYSWKMBDHVN"),
    canonical: new Set("ACGT"),
    ambiguous: new Set("RYSWKMBDHVN")
  },
  protein: {
    accepted: new Set("ACDEFGHIKLMNPQRSTVWYBZJXUO*"),
    canonical: new Set("ACDEFGHIKLMNPQRSTVWY"),
    ambiguous: new Set("BZJXUO")
  }
};

export function parseFasta(text) {
  if (typeof text !== "string") throw new TypeError("FASTA input must be text.");
  const cleaned = text.replace(/^\uFEFF/, "");
  const lines = cleaned.split(/\r?\n/);
  const fileErrors = [];
  const records = [];
  let currentHeader = null;
  let currentHeaderLine = null;
  let sequenceParts = [];
  let sawHeader = false;

  const pushRecord = () => {
    if (currentHeader === null) return;
    const header = currentHeader.trim();
    const id = header ? header.split(/\s+/)[0] : "";
    const sequence = sequenceParts.join("").replace(/\s+/g, "").toUpperCase();
    records.push({
      record_number: records.length + 1,
      id,
      description: header,
      header_line: currentHeaderLine,
      sequence,
      length: sequence.length,
      errors: [],
      warnings: [],
      valid: true
    });
  };

  for (let index = 0; index < lines.length; index += 1) {
    const raw = lines[index];
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith(">")) {
      pushRecord();
      sawHeader = true;
      currentHeader = line.slice(1).trim();
      currentHeaderLine = index + 1;
      sequenceParts = [];
    } else if (!sawHeader) {
      if (!fileErrors.some((error) => error.code === "SEQUENCE_BEFORE_HEADER")) {
        fileErrors.push({
          code: "SEQUENCE_BEFORE_HEADER",
          message: "Sequence data appears before the first FASTA header.",
          line: index + 1
        });
      }
      // Keep scanning so valid records after the bad preamble are still reported.
      continue;
    } else {
      sequenceParts.push(line.replace(/\s+/g, ""));
    }
  }
  pushRecord();

  if (records.length === 0 && fileErrors.length === 0) {
    fileErrors.push({
      code: "NO_FASTA_RECORDS",
      message: "No FASTA records were found. Check that the file contains headers beginning with '>'.",
      line: null
    });
  }
  return { records, file_errors: fileErrors };
}

export function validateFasta(text, sequenceType) {
  const type = String(sequenceType || "").toLowerCase();
  if (!(type in ALPHABETS)) throw new Error("Choose either DNA or protein sequence type.");
  const parsed = parseFasta(text);
  const alphabet = ALPHABETS[type];
  const idCounts = new Map();
  for (const record of parsed.records) {
    if (record.id) idCounts.set(record.id, (idCounts.get(record.id) || 0) + 1);
  }

  const records = parsed.records.map((source) => {
    const record = { ...source, errors: [], warnings: [] };
    if (!record.id) record.errors.push({ code: "EMPTY_HEADER", message: "FASTA header is empty." });
    if (!record.sequence) record.errors.push({ code: "EMPTY_SEQUENCE", message: "Sequence is empty." });

    if (record.id && idCounts.get(record.id) > 1) {
      record.errors.push({ code: "DUPLICATE_ID", message: `Sequence identifier is not unique: ${record.id}. All records with this ID are invalid.` });
    }

    const invalidSymbols = [...new Set([...record.sequence].filter((symbol) => !alphabet.accepted.has(symbol)))].sort();
    if (invalidSymbols.length) {
      record.errors.push({
        code: "INVALID_SYMBOLS",
        message: "Sequence contains symbols not accepted for the selected sequence type.",
        symbols: invalidSymbols
      });
    }

    const ambiguousCount = [...record.sequence].filter((symbol) => alphabet.ambiguous.has(symbol)).length;
    if (ambiguousCount) {
      record.warnings.push({
        code: "AMBIGUOUS_SYMBOLS",
        message: `Sequence contains ${ambiguousCount} accepted ambiguous/non-canonical symbol(s).`,
        count: ambiguousCount
      });
    }

    const stopCount = type === "protein" ? [...record.sequence].filter((symbol) => symbol === "*").length : 0;
    if (stopCount) {
      record.warnings.push({
        code: "STOP_SYMBOLS",
        message: `Protein sequence contains ${stopCount} stop symbol(s) (*).`,
        count: stopCount
      });
    }

    record.ambiguous_count = ambiguousCount;
    record.stop_count = stopCount;
    record.canonical_count = [...record.sequence].filter((symbol) => alphabet.canonical.has(symbol)).length;
    record.valid = record.errors.length === 0;
    return record;
  });

  const validRecords = records.filter((record) => record.valid).length;
  return {
    sequence_type: type,
    records,
    file_errors: parsed.file_errors,
    total_records: records.length,
    valid_records: validRecords,
    invalid_records: records.length - validRecords,
    file_valid: parsed.file_errors.length === 0 && records.length > 0 && validRecords === records.length
  };
}
