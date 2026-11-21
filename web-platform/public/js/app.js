import { validateFasta } from "./fasta.js";
import { calculateStatistics, toCsv } from "./statistics.js";

const MAX_FILE_BYTES = 5 * 1024 * 1024;
const elements = {
  toolButtons: [...document.querySelectorAll("[data-tool]")],
  title: document.querySelector("#workspace-title"),
  eyebrow: document.querySelector("#workspace-eyebrow"),
  description: document.querySelector("#workspace-description"),
  sequenceType: document.querySelector("#sequence-type"),
  file: document.querySelector("#fasta-file"),
  textarea: document.querySelector("#fasta-text"),
  loadExample: document.querySelector("#load-example"),
  charCount: document.querySelector("#character-count"),
  primary: document.querySelector("#run-primary"),
  secondary: document.querySelector("#run-secondary"),
  clear: document.querySelector("#clear-input"),
  error: document.querySelector("#input-error"),
  results: document.querySelector("#results"),
  resultsTitle: document.querySelector("#results-title"),
  status: document.querySelector("#result-status"),
  summary: document.querySelector("#summary-cards"),
  note: document.querySelector("#results-note"),
  table: document.querySelector("#results-table"),
  fileErrors: document.querySelector("#file-errors"),
  downloadJson: document.querySelector("#download-json"),
  downloadCsv: document.querySelector("#download-csv"),
  downloadFasta: document.querySelector("#download-valid-fasta")
};

let activeTool = "validator";
let lastValidation = null;
let lastStatistics = null;
let lastOperation = null;

const EXAMPLES = {
  dna: ">isolate_001 Example canonical DNA sequence\nATGCGTACGTAGCTAGCTAGCTAG\n>isolate_002 DNA with IUPAC ambiguity\nATGCRYSWKMBDHVNACGT\n>isolate_003 Another canonical sequence\nGGGGCCCCAAAATTTT",
  protein: ">protein_001 Standard amino acid sequence\nMKWVTFISLLFLFSSAYS\n>protein_002 Protein with accepted ambiguous symbols\nMABZJXUOEFG*"
};

function setTool(tool) {
  activeTool = tool;
  for (const button of elements.toolButtons) {
    const selected = button.dataset.tool === tool;
    button.classList.toggle("active", selected);
    button.setAttribute("aria-pressed", String(selected));
  }
  const isValidator = tool === "validator";
  elements.eyebrow.textContent = isValidator ? "TOOL 01" : "TOOL 02";
  elements.title.textContent = isValidator ? "FASTA Validator" : "Sequence Statistics";
  elements.description.textContent = isValidator
    ? "Check whether your FASTA records follow the selected DNA or protein alphabet."
    : "Calculate sequence length, GC percentage for DNA, base composition and N50 from valid records.";
  elements.primary.textContent = isValidator ? "Validate FASTA →" : "Validate and calculate →";
  elements.secondary.hidden = !isValidator;
  elements.primary.dataset.action = isValidator ? "validate" : "stats";
  clearResults();
  hideError();
}

function clearResults() {
  elements.results.hidden = true;
  elements.summary.replaceChildren();
  elements.table.tHead.replaceChildren();
  elements.table.tBodies[0].replaceChildren();
  elements.fileErrors.replaceChildren();
  elements.note.textContent = "";
  elements.downloadJson.hidden = false;
  elements.downloadCsv.hidden = true;
  elements.downloadFasta.hidden = true;
  lastValidation = null;
  lastStatistics = null;
  lastOperation = null;
}

function showError(message) {
  elements.error.textContent = message;
  elements.error.hidden = false;
}
function hideError() {
  elements.error.textContent = "";
  elements.error.hidden = true;
}

function getInputText() {
  const text = elements.textarea.value.trim();
  if (!text) throw new Error("Paste a FASTA sequence or choose a FASTA file first.");
  const bytes = new Blob([text]).size;
  if (bytes > MAX_FILE_BYTES) throw new Error("The pasted input exceeds the 5 MB browser limit for this MVP.");
  return text;
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

function renderValidation(report) {
  elements.results.hidden = false;
  elements.resultsTitle.textContent = "Validation results";
  elements.status.textContent = report.file_valid ? "All records valid" : "Review required";
  elements.status.classList.toggle("has-errors", !report.file_valid);
  elements.summary.replaceChildren(
    createSummaryCard("Total records", String(report.total_records)),
    createSummaryCard("Valid records", String(report.valid_records)),
    createSummaryCard("Invalid records", String(report.invalid_records)),
    createSummaryCard("File errors", String(report.file_errors.length))
  );
  elements.note.textContent = "Ambiguous IUPAC symbols are accepted but reported as warnings. Invalid records are excluded from sequence statistics.";
  renderTable(
    ["Sequence ID", "Length", "Status", "Warnings", "Errors"],
    report.records.map((record) => [
      record.id || "(empty ID)",
      String(record.length),
      record.valid ? "Valid" : "Invalid",
      record.warnings.map((warning) => warning.message).join("; ") || "—",
      record.errors.map((error) => error.message + (error.symbols ? ` (${error.symbols.join(" ")})` : "")).join("; ") || "—"
    ]),
    2
  );
  renderFileErrors(report.file_errors);
  elements.downloadJson.hidden = false;
  elements.downloadCsv.hidden = true;
  elements.downloadFasta.hidden = report.valid_records === 0;
  lastValidation = report;
  lastOperation = "validation";
}

function renderStatistics(validation, statistics) {
  elements.results.hidden = false;
  elements.resultsTitle.textContent = "Sequence statistics";
  const summary = statistics.summary;
  elements.status.textContent = statistics.records.length ? "Statistics calculated" : "No valid sequences";
  elements.status.classList.toggle("has-errors", statistics.records.length === 0);
  const cards = [
    createSummaryCard("Analyzed sequences", String(summary.analyzed_records)),
    createSummaryCard("Total length", `${summary.total_length.toLocaleString()} ${summary.sequence_type === "dna" ? "bp" : "aa"}`),
    createSummaryCard("Average length", String(summary.average_length)),
    createSummaryCard("N50 (DNA collection)", summary.n50 === null ? "N/A" : String(summary.n50))
  ];
  if (summary.sequence_type === "dna") cards.push(createSummaryCard("Mean per-sequence GC%", summary.gc_percent_mean === null ? "N/A" : `${summary.gc_percent_mean}%`));
  elements.summary.replaceChildren(...cards);
  elements.note.textContent = summary.sequence_type === "dna"
    ? `Statistics include valid, non-empty records only. GC% = (G + C) / (A + C + G + T) × 100; ambiguous bases are excluded from the denominator. N50 is a collection-level summary, not identification or sequencing-quality evidence. ${validation.invalid_records} invalid record(s) were excluded.`
    : `Statistics include valid, non-empty protein records only. GC% is not applicable to protein sequences. ${validation.invalid_records} invalid record(s) were excluded.`;
  const columns = summary.sequence_type === "dna"
    ? ["Sequence ID", "Length", "GC%", "Ambiguous bases", "A", "T", "G", "C"]
    : ["Sequence ID", "Length", "Non-canonical", "Stop symbols"];
  const rows = statistics.records.map((record) => summary.sequence_type === "dna"
    ? [record.id, String(record.length), record.gc_percent === null ? "N/A" : `${record.gc_percent}%`, String(record.ambiguous_count), String(record.count_A), String(record.count_T), String(record.count_G), String(record.count_C)]
    : [record.id, String(record.length), String(record.ambiguous_count), String(record.stop_count)]);
  renderTable(columns, rows, 0);
  renderFileErrors(validation.file_errors);
  elements.downloadJson.hidden = false;
  elements.downloadCsv.hidden = false;
  elements.downloadFasta.hidden = validation.valid_records === 0;
  lastValidation = validation;
  lastStatistics = statistics;
  lastOperation = "statistics";
}

function renderTable(columns, rows, statusColumnIndex) {
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
    row.forEach((value, index) => {
      const td = document.createElement("td");
      if (statusColumnIndex && index === statusColumnIndex) {
        const pill = document.createElement("span");
        pill.className = `pill ${value.toLowerCase()}`;
        pill.textContent = value;
        td.append(pill);
      } else {
        td.textContent = value;
      }
      tr.append(td);
    });
    body.append(tr);
  }
  elements.table.tBodies[0].replaceWith(body);
}

function renderFileErrors(errors) {
  elements.fileErrors.replaceChildren();
  for (const error of errors) {
    const item = document.createElement("div");
    item.className = "message error";
    item.textContent = `${error.code}: ${error.message}${error.line ? ` (line ${error.line})` : ""}`;
    elements.fileErrors.append(item);
  }
}

function downloadFile(filename, content, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function handlePrimaryAction() {
  hideError();
  try {
    const validation = validateFasta(getInputText(), elements.sequenceType.value);
    if (elements.primary.dataset.action === "stats") {
      const statistics = calculateStatistics(validation);
      renderStatistics(validation, statistics);
    } else {
      renderValidation(validation);
    }
  } catch (error) {
    showError(error.message || "Unable to process this input.");
  }
}

function handleStatisticsAction() {
  hideError();
  try {
    const validation = validateFasta(getInputText(), elements.sequenceType.value);
    renderStatistics(validation, calculateStatistics(validation));
  } catch (error) {
    showError(error.message || "Unable to calculate statistics.");
  }
}

elements.toolButtons.forEach((button) => button.addEventListener("click", () => setTool(button.dataset.tool)));
elements.primary.addEventListener("click", handlePrimaryAction);
elements.secondary.addEventListener("click", handleStatisticsAction);
elements.clear.addEventListener("click", () => {
  elements.textarea.value = "";
  elements.file.value = "";
  elements.charCount.textContent = "0 characters";
  clearResults();
  hideError();
});
elements.textarea.addEventListener("input", () => {
  elements.charCount.textContent = `${elements.textarea.value.length.toLocaleString()} characters`;
  if (elements.file.files.length) elements.file.value = "";
});
elements.file.addEventListener("change", async () => {
  hideError();
  const file = elements.file.files?.[0];
  if (!file) return;
  if (file.size > MAX_FILE_BYTES) {
    elements.file.value = "";
    showError("This file exceeds the 5 MB limit for the browser MVP.");
    return;
  }
  try {
    elements.textarea.value = await file.text();
    elements.charCount.textContent = `${elements.textarea.value.length.toLocaleString()} characters`;
    clearResults();
  } catch {
    showError("The selected file could not be read. Try a UTF-8 encoded FASTA file.");
  }
});
elements.loadExample.addEventListener("click", () => {
  elements.file.value = "";
  elements.textarea.value = EXAMPLES[elements.sequenceType.value];
  elements.charCount.textContent = `${elements.textarea.value.length.toLocaleString()} characters`;
  clearResults();
  hideError();
});
elements.sequenceType.addEventListener("change", () => {
  clearResults();
  hideError();
});
elements.downloadJson.addEventListener("click", () => {
  if (!lastValidation) return;
  const payload = lastOperation === "statistics"
    ? { validation: lastValidation, statistics: lastStatistics }
    : { validation: lastValidation };
  downloadFile("smartbio-results.json", JSON.stringify(payload, null, 2), "application/json");
});
elements.downloadCsv.addEventListener("click", () => {
  if (!lastStatistics) return;
  downloadFile("sequence-statistics.csv", toCsv(lastStatistics.records), "text/csv;charset=utf-8");
});
elements.downloadFasta.addEventListener("click", () => {
  if (!lastValidation) return;
  const validRecords = lastValidation.records.filter((record) => record.valid);
  const fasta = validRecords.map((record) => `>${record.description}\n${record.sequence}`).join("\n");
  downloadFile("validated-sequences.fasta", `${fasta}\n`, "text/plain;charset=utf-8");
});

setTool("validator");
