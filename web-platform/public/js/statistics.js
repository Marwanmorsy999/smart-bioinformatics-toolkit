export function calculateStatistics(validationReport) {
  const type = validationReport.sequence_type;
  const validRecords = validationReport.records.filter((record) => record.valid && record.sequence.length > 0);
  const rows = validRecords.map((record) => {
    const sequence = record.sequence;
    const counts = { A: 0, T: 0, G: 0, C: 0 };
    for (const symbol of sequence) {
      if (Object.hasOwn(counts, symbol)) counts[symbol] += 1;
    }
    const canonicalCount = record.canonical_count;
    const gcPercent = type === "dna" && canonicalCount > 0
      ? Number((((counts.G + counts.C) / canonicalCount) * 100).toFixed(4))
      : null;
    const row = {
      id: record.id,
      length: sequence.length,
      canonical_count: canonicalCount,
      ambiguous_count: record.ambiguous_count,
      gc_percent: gcPercent,
      valid: true
    };
    if (type === "dna") {
      row.count_A = counts.A;
      row.count_T = counts.T;
      row.count_G = counts.G;
      row.count_C = counts.C;
    } else {
      row.stop_count = record.stop_count;
    }
    return row;
  });

  const lengths = rows.map((row) => row.length).filter((length) => length > 0).sort((a, b) => b - a);
  const totalLength = lengths.reduce((sum, length) => sum + length, 0);
  let n50 = type === "dna" ? 0 : null;
  let l50 = type === "dna" ? 0 : null;
  if (type === "dna" && totalLength > 0) {
    let cumulative = 0;
    for (const length of lengths) {
      cumulative += length;
      l50 += 1;
      if (cumulative >= totalLength / 2) {
        n50 = length;
        break;
      }
    }
  }

  const gcValues = rows.map((row) => row.gc_percent).filter((value) => value !== null);
  const summary = {
    sequence_type: type,
    total_records: validationReport.total_records,
    valid_records: validationReport.valid_records,
    invalid_records: validationReport.invalid_records,
    analyzed_records: rows.length,
    total_length: totalLength,
    minimum_length: lengths.length ? lengths[lengths.length - 1] : 0,
    maximum_length: lengths.length ? lengths[0] : 0,
    average_length: lengths.length ? Number((totalLength / lengths.length).toFixed(4)) : 0,
    median_length: median(lengths),
    n50,
    l50,
    gc_definition: "(G + C) / (A + C + G + T) * 100; ambiguous symbols excluded",
    gc_percent_mean: gcValues.length
      ? Number((gcValues.reduce((sum, value) => sum + value, 0) / gcValues.length).toFixed(4))
      : null
  };
  if (type === "dna") {
    summary.nucleotide_counts = Object.fromEntries([..."ATGC"].map((base) => [
      base,
      rows.reduce((sum, row) => sum + row[`count_${base}`], 0)
    ]));
  }
  return { summary, records: rows };
}

function median(values) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]
    : Number(((sorted[middle - 1] + sorted[middle]) / 2).toFixed(4));
}

export function toCsv(rows) {
  if (!rows.length) return "";
  const columns = [...new Set(rows.flatMap((row) => Object.keys(row)))];
  const escape = (value) => {
    if (value === null || value === undefined) return "";
    const text = String(value);
    return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
  };
  return [columns.join(","), ...rows.map((row) => columns.map((column) => escape(row[column])).join(","))].join("\r\n");
}
