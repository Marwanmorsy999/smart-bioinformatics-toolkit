import {
  parseBlastTsv,
  analyzeBlast,
  queryLengthsFromFasta,
  parseQueryLengthsText,
  toBlastCsv
} from "./blast.js";

const MAX_FILE_BYTES = 5 * 1024 * 1024;
const elements = {
  schema: document.querySelector("#blast-schema"),
  file: document.querySelector("#blast-file"),
  text: document.querySelector("#blast-text"),
  charCount: document.querySelector("#blast-char-count"),
  loadExample: document.querySelector("#load-blast-example"),
  minIdentity: document.querySelector("#min-identity"),
  minCoverage: document.querySelector("#min-coverage"),
  maxEvalue: document.querySelector("#max-evalue"),
  maxHits: document.querySelector("#max-hits"),
  queryLengths: document.querySelector("#query-lengths"),
  queryFasta: document.querySelector("#query-fasta"),
  queryList: document.querySelector("#query-list"),
  run: document.querySelector("#run-blast"),
  clear: document.querySelector("#clear-blast"),
  error: document.querySelector("#blast-error"),
  results: document.querySelector("#blast-results"),
  resultsTitle: document.querySelector("#blast-results-title"),
  status: document.querySelector("#blast-result-status"),
  summary: document.querySelector("#blast-summary"),
  note: document.querySelector("#blast-note"),
  table: document.querySelector("#blast-table"),
  fileErrors: document.querySelector("#blast-file-errors"),
  downloadJson: document.querySelector("#blast-download-json"),
  downloadCsv: document.querySelector("#blast-download-csv")
};

let lastReport = null;

const EXAMPLE_TSV = [
  "q1\thitA\t99.0\t100\t1\t0\t1\t100\t1\t100\t1e-50\t200",
  "q1\thitB\t98.6\t95\t2\t0\t1\t95\t1\t95\t1e-40\t180",
  "q2\thitC\t90.0\t50\t5\t1\t1\t50\t1\t50\t1e-10\t90"
].join("\n");

function showError(message) {
  elements.error.textContent = message;
  elements.error.hidden = false;
}
function hideError() {
  elements.error.textContent = "";
  elements.error.hidden = true;
}

function createSummaryCard(label, value) {
  const card = document.createElement("div");
  card.className = "summary-card";
  const labelElement = document.createElement("span");
  labelElement.textContent = label;
  const valueElement = document.createElement("strong");
  valueElement.textContent = value;
  card.append(labelElement, valueElement);
  return card;
}

function renderTable(columns, rows) {
  const header = document.createElement("tr");
  for (const column of columns) {
    const th = document.createElement("th");
    th.scope = "col";
    th.textContent = column;
    header.append(th);
  }
  elements.table.tHead.replaceChildren(header);
  const body = document.createElement("tbody");
  for (const row of rows) {
    const tr = document.createElement("tr");
    for (const value of row) {
      const td = document.createElement("td");
      td.textContent = value;
      tr.append(td);
    }
    body.append(tr);
  }
  if (elements.table.tBodies[0]) elements.table.tBodies[0].replaceWith(body);
  else elements.table.append(body);
}

function runAnalysis() {
  hideError();
  const text = elements.text.value.trim();
  if (!text) {
    showError("Paste a BLAST TSV or choose a file first.");
    return;
  }
  if (new Blob([text]).size > MAX_FILE_BYTES) {
    showError("Input exceeds the 5 MB browser limit.");
    return;
  }
  const schema = elements.schema.value;
  const parsed = parseBlastTsv(text, schema);
  if (parsed.schema === null || parsed.file_errors.length) {
    // still allow if rows parsed? show errors
  }

  const minIdentity = Number(elements.minIdentity.value) || 0;
  const minCoverage = Number(elements.minCoverage.value) || 0;
  const maxEvalueRaw = elements.maxEvalue.value.trim();
  const maxEvalue = maxEvalueRaw === "" ? null : Number(maxEvalueRaw);
  const maxHits = Number(elements.maxHits.value) || 0;

  // query lengths
  const qlFromText = parseQueryLengthsText(elements.queryLengths.value);
  const qlFromFasta = elements.queryFasta.value.trim() ? queryLengthsFromFasta(elements.queryFasta.value) : {};
  const queryLengths = { ...qlFromFasta, ...qlFromText };

  // query ids
  const queryIds = elements.queryList.value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (elements.queryFasta.value.trim()) {
    // derive ids from fasta headers
    const ids = elements.queryFasta.value
      .split(/\r?\n/)
      .filter((l) => l.trim().startsWith(">"))
      .map((l) => l.trim().slice(1).split(/\s+/)[0]);
    for (const id of ids) if (!queryIds.includes(id)) queryIds.push(id);
  }

  const report = analyzeBlast(parsed, {
    minIdentity,
    minQueryCoverage: minCoverage,
    maxEvalue,
    maxHits,
    queryLengths,
    queryIds
  });

  lastReport = report;

  // render
  elements.results.hidden = false;
  elements.resultsTitle.textContent = "BLAST analysis results";
  const s = report.summary;
  elements.status.textContent = s.malformed_rows ? "Review required" : "Analysis complete";
  elements.status.classList.toggle("has-errors", !!s.malformed_rows);
  elements.summary.replaceChildren(
    createSummaryCard("Schema", String(report.schema || "unresolved")),
    createSummaryCard("Total rows", String(s.total_rows)),
    createSummaryCard("Valid rows", String(s.valid_rows)),
    createSummaryCard("Malformed rows", String(s.malformed_rows)),
    createSummaryCard("Queries", String(s.unique_queries)),
    createSummaryCard("No-hit queries", String(s.queries_with_no_hits)),
    createSummaryCard("Passing", String(s.passing_rows)),
    createSummaryCard("Displayed", String(s.displayed_rows))
  );

  if (report.schema === "standard" && !Object.keys(queryLengths).length) {
    elements.note.textContent = "Standard 12-column input has no qlen column. Query coverage is unavailable unless query lengths are provided; rows fail the coverage filter only when a minimum coverage threshold is set. BLAST similarity is evidence, not proof of species identity.";
  } else {
    elements.note.textContent = "Query coverage calculated from aligned query coordinates and qlen. BLAST similarity is evidence, not proof of species identity.";
  }

  // file errors
  elements.fileErrors.replaceChildren();
  for (const fe of (parsed.file_errors || [])) {
    const item = document.createElement("div");
    item.className = "message error";
    item.textContent = `${fe.code}: ${fe.message}`;
    elements.fileErrors.append(item);
  }
  for (const row of report.rows) {
    if (!row.valid) {
      const item = document.createElement("div");
      item.className = "message error";
      item.textContent = `Row ${row.row_number}: ${row.errors.map((e) => e.message).join("; ")}`;
      elements.fileErrors.append(item);
    }
  }

  const columns = report.schema === "extended"
    ? ["Row", "Query", "Subject", "Identity %", "Coverage %", "E-value", "Bitscore", "Rank", "Pass", "Fail reasons"]
    : ["Row", "Query", "Subject", "Identity %", "Coverage %", "E-value", "Bitscore", "Rank", "Pass", "Fail reasons"];
  const rows = report.rows.map((r) => [
    String(r.row_number),
    r.qseqid || "",
    (r.sseqid || r.sacc || ""),
    r.pident === null ? "" : String(r.pident),
    r.query_coverage === null ? "unavailable" : String(r.query_coverage),
    r.evalue === null ? "" : String(r.evalue),
    r.bitscore === null ? "" : String(r.bitscore),
    r.rank === null ? "" : String(r.rank),
    r.pass_all ? "PASS" : "FAIL",
    (r.fail_reasons || []).join("; ")
  ]);
  renderTable(columns, rows);
}

elements.run.addEventListener("click", runAnalysis);
elements.clear.addEventListener("click", () => {
  elements.text.value = "";
  elements.file.value = "";
  elements.charCount.textContent = "0 characters";
  elements.results.hidden = true;
  hideError();
  lastReport = null;
});
elements.text.addEventListener("input", () => {
  elements.charCount.textContent = `${elements.text.value.length.toLocaleString()} characters`;
  if (elements.file.files.length) elements.file.value = "";
});
elements.file.addEventListener("change", async () => {
  hideError();
  const file = elements.file.files?.[0];
  if (!file) return;
  if (file.size > MAX_FILE_BYTES) {
    elements.file.value = "";
    showError("This file exceeds the 5 MB limit.");
    return;
  }
  try {
    elements.text.value = await file.text();
    elements.charCount.textContent = `${elements.text.value.length.toLocaleString()} characters`;
    elements.results.hidden = true;
  } catch {
    showError("The selected file could not be read.");
  }
});
elements.loadExample.addEventListener("click", () => {
  elements.file.value = "";
  elements.text.value = EXAMPLE_TSV;
  elements.charCount.textContent = `${elements.text.value.length.toLocaleString()} characters`;
  elements.results.hidden = true;
  hideError();
});

elements.downloadJson.addEventListener("click", () => {
  if (!lastReport) return;
  const blob = new Blob([JSON.stringify(lastReport, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "blast-analysis.json";
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
});
elements.downloadCsv.addEventListener("click", () => {
  if (!lastReport) return;
  const csv = toBlastCsv(lastReport.filtered_rows);
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "blast-filtered.csv";
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
});