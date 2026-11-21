import {
  parseBlastTsv, analyzeBlast
} from "./blast.js";
import {
  parseTaxonomyMap, analyzeTaxonomy
} from "./taxonomy.js";
import { buildReportHtml } from "./report.js";

const MAX_FILE_BYTES = 5 * 1024 * 1024;
const elements = {
  schema: document.querySelector("#taxonomy-schema"),
  blastFile: document.querySelector("#taxonomy-blast-file"),
  mapFile: document.querySelector("#taxonomy-map-file"),
  text: document.querySelector("#taxonomy-blast-text"),
  charCount: document.querySelector("#taxonomy-char-count"),
  queryList: document.querySelector("#taxonomy-query-list"),
  topN: document.querySelector("#taxonomy-top-n"),
  minConsensus: document.querySelector("#taxonomy-min-consensus"),
  minIdentity: document.querySelector("#taxonomy-min-identity"),
  minCoverage: document.querySelector("#taxonomy-min-coverage"),
  maxEvalue: document.querySelector("#taxonomy-max-evalue"),
  speciesThreshold: document.querySelector("#taxonomy-species-threshold"),
  minQueryLength: document.querySelector("#taxonomy-min-query-length"),
  run: document.querySelector("#run-taxonomy"),
  clear: document.querySelector("#clear-taxonomy"),
  loadExample: document.querySelector("#load-taxonomy-example"),
  error: document.querySelector("#taxonomy-error"),
  results: document.querySelector("#taxonomy-results"),
  resultsTitle: document.querySelector("#taxonomy-results-title"),
  status: document.querySelector("#taxonomy-result-status"),
  summary: document.querySelector("#taxonomy-summary"),
  flags: document.querySelector("#taxonomy-flags"),
  note: document.querySelector("#taxonomy-note"),
  queryListView: document.querySelector("#taxonomy-query-view"),
  downloadJson: document.querySelector("#taxonomy-download-json"),
  downloadCsv: document.querySelector("#taxonomy-download-csv"),
  printReport: document.querySelector("#taxonomy-print-report"),
};

let lastAnalysis = null;
let taxonomyMap = null;

const EXAMPLE_TSV = [
  "q1\tacc1\t562\tEscherichia coli\t99.0\t100\t1\t100\t100\t1e-50\t200\t100",
  "q1\tacc2\t623\tEscherichia albertii\t98.0\t100\t1\t100\t100\t1e-40\t190\t100",
  "q1\tacc3\t380918\tShigella dysenteriae\t97.0\t100\t1\t100\t100\t1e-30\t180\t100",
  "q2\tacc4\t1234\tBacillus subtilis\t100.0\t50\t1\t50\t50\t1e-10\t90\t100"
].join("\n");

const EXAMPLE_QUERY_LIST = "q1\nq2\nq3\n";
const EXAMPLE_MAP = [
  "taxid\tscientific_name\trank\tparent_taxid\tfull_lineage",
  "2\tBacteria\tsuperkingdom\t\tBacteria",
  "1224\tProteobacteria\tphylum\t2\tBacteria;Proteobacteria",
  "91347\tEnterobacterales\torder\t1224\tBacteria;Proteobacteria;Enterobacterales",
  "543\tEnterobacteriaceae\tfamily\t91347\tBacteria;Proteobacteria;Enterobacterales;Enterobacteriaceae",
  "561\tEscherichia\tgenus\t543\tBacteria;Proteobacteria;Enterobacterales;Enterobacteriaceae;Escherichia",
  "562\tEscherichia coli\tspecies\t561\tBacteria;Proteobacteria;Enterobacterales;Enterobacteriaceae;Escherichia;Escherichia coli",
  "623\tEscherichia albertii\tspecies\t561\tBacteria;Proteobacteria;Enterobacterales;Enterobacteriaceae;Escherichia;Escherichia albertii",
  "380918\tShigella dysenteriae\tspecies\t561\tBacteria;Proteobacteria;Enterobacterales;Enterobacteriaceae;Escherichia;Shigella dysenteriae",
  "1234\tBacillus subtilis\tspecies\t1423\tBacteria;Firmicutes;Bacillales;Bacillaceae;Bacillus;Bacillus subtilis",
  "1423\tBacillus\tgenus\t1234\tBacteria;Firmicutes;Bacillales;Bacillaceae;Bacillus"
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
  const labelEl = document.createElement("span");
  labelEl.textContent = label;
  const valueEl = document.createElement("strong");
  valueEl.textContent = value;
  card.append(labelEl, valueEl);
  return card;
}

function escapeHtml(text) {
  if (text == null) return "";
  const div = document.createElement("div");
  div.textContent = String(text);
  return div.innerHTML;
}

function renderEvidenceTable(container, evidence) {
  const table = document.createElement("table");
  table.className = "compact";
  const thead = document.createElement("thead");
  const headRow = document.createElement("tr");
  ["Accession", "Species", "Genus", "Identity %", "Coverage %", "E-value", "Bitscore", "Rank"].forEach((h) => {
    const th = document.createElement("th"); th.scope = "col"; th.textContent = h; headRow.append(th);
  });
  thead.append(headRow);
  table.append(thead);
  const tbody = document.createElement("tbody");
  for (const e of evidence) {
    const tr = document.createElement("tr");
    const vals = [
      e.accession || "—",
      e.species || "—",
      e.genus || "—",
      e.pident == null ? "—" : String(e.pident),
      e.query_coverage == null ? "—" : String(e.query_coverage),
      e.evalue == null ? "—" : String(e.evalue),
      e.bitscore == null ? "—" : String(e.bitscore),
      e.rank == null ? "—" : String(e.rank),
    ];
    vals.forEach((v) => {
      const td = document.createElement("td"); td.textContent = v; tr.append(td);
    });
    tbody.append(tr);
  }
  table.append(tbody);
  container.append(table);
}

const VERDICT_LABELS = {
  species_supported: "Species supported",
  group_level_only: "Group level only",
  genus_level_only: "Genus level only",
  below_screening_threshold: "Below screening threshold",
  insufficient_evidence: "Insufficient evidence",
};

function renderVerdict(verdict) {
  const box = document.createElement("div");
  box.className = `verdict-box verdict-${verdict.status}`;
  const head = document.createElement("p");
  head.className = "verdict-head";
  const label = VERDICT_LABELS[verdict.status] || verdict.status;
  const taxon = verdict.reported_taxon
    ? ` &middot; ${escapeHtml(verdict.reported_rank || "")}: <em>${escapeHtml(verdict.reported_taxon)}</em>`
    : "";
  head.innerHTML = `<strong>Verdict: ${escapeHtml(label)}</strong>${taxon}`;
  box.append(head);
  const ev = verdict.evidence_summary || {};
  const meta = document.createElement("p");
  meta.className = "small";
  meta.textContent =
    `Top identity: ${ev.top_identity ?? "n/a"}% · top query coverage: ${ev.top_query_coverage ?? "n/a"}% · ` +
    `screening reference: ${ev.species_threshold}%`;
  box.append(meta);
  for (const reason of verdict.reasons || []) {
    const item = document.createElement("p");
    item.className = "small";
    item.textContent = reason;
    box.append(item);
  }
  for (const group of verdict.difficult_groups || []) {
    const note = document.createElement("p");
    note.className = "small verdict-group";
    const link = document.createElement("a");
    link.href = group.source_url;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.textContent = "evidence";
    note.append(document.createTextNode(`${group.display_name}: ${group.note} (`), link, document.createTextNode(")"));
    box.append(note);
  }
  const disc = document.createElement("p");
  disc.className = "small verdict-disclaimer";
  disc.textContent = verdict.disclaimer;
  box.append(disc);
  return box;
}

function renderQueryCard(queryId, entry) {
  const card = document.createElement("article");
  card.className = "result-card";
  const cons = entry.consensus;
  const amb = entry.ambiguity;

  const header = document.createElement("div");
  header.className = "card-header";
  const qTitle = document.createElement("h4");
  qTitle.textContent = `Query: ${escapeHtml(queryId)}`;
  const statusBadge = document.createElement("span");
  statusBadge.className = `pill ${cons.status}`;
  statusBadge.textContent = cons.status;
  header.append(qTitle, statusBadge);
  card.append(header);
  if (entry.verdict) card.append(renderVerdict(entry.verdict));

  const summary = document.createElement("div");
  summary.className = "consensus-summary";
  const rankLine = document.createElement("p");
  rankLine.innerHTML = `<strong>Supported rank:</strong> ${escapeHtml(cons.supported_rank || "—")}`;
  const taxonLine = document.createElement("p");
  taxonLine.innerHTML = `<strong>Consensus taxon:</strong> ${escapeHtml(cons.consensus_taxon || "—")}`;
  const sup = cons.support || {};
  const supportLine = document.createElement("p");
  supportLine.innerHTML = `<strong>Evidence support:</strong> genus ${sup.genus_support != null ? sup.genus_support : "—"}, species ${sup.species_support != null ? sup.species_support : "—"} &middot; unique species: ${sup.unique_species != null ? sup.unique_species : "—"} &middot; unique accessions: ${sup.unique_accessions != null ? sup.unique_accessions : "—"} &middot; reference hits: ${sup.reference_hits != null ? sup.reference_hits : "—"}`;
  summary.append(rankLine, taxonLine, supportLine);
  card.append(summary);

  if (cons.candidate_species && cons.candidate_species.length) {
    const sp = document.createElement("p");
    sp.innerHTML = `<strong>Candidate species:</strong> ${cons.candidate_species.map(escapeHtml).join(", ")}`;
    card.append(sp);
  }

  if (amb.messages && amb.messages.length) {
    const warn = document.createElement("div");
    warn.className = "message-list";
    const warnTitle = document.createElement("p");
    warnTitle.className = "small-title";
    warnTitle.textContent = "Why this rank / caveats";
    warn.append(warnTitle);
    for (const m of amb.messages) {
      const item = document.createElement("div");
      item.className = "message warning";
      item.textContent = m;
      warn.append(item);
    }
    card.append(warn);
  }

  if (cons.evidence && cons.evidence.length) {
    const evTitle = document.createElement("p");
    evTitle.className = "small-title";
    evTitle.textContent = "Supporting evidence (candidates)";
    card.append(evTitle);
    renderEvidenceTable(card, cons.evidence);
  }

  const meta = document.createElement("p");
  meta.className = "small";
  meta.innerHTML = `Candidates: ${entry.candidate_count} &middot; Passing hits: ${entry.passing_hit_count} &middot; ${entry.truncated ? "Candidate set truncated at top-N." : "Not truncated."}`;
  card.append(meta);

  return card;
}

function parseQueryIdList(text) {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
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
  if (parsed.schema === null) {
    showError(parsed.file_errors && parsed.file_errors[0] ? parsed.file_errors[0].message : "Could not resolve BLAST schema. Select it explicitly.");
    return;
  }

  const minIdentity = Number(elements.minIdentity.value) || 0;
  const minCoverage = Number(elements.minCoverage.value) || 0;
  const maxEvalueRaw = elements.maxEvalue.value.trim();
  const maxEvalue = maxEvalueRaw === "" ? null : Number(maxEvalueRaw);
  const topN = Number(elements.topN.value) || 10;
  const minConsensus = Number(elements.minConsensus.value) || 0.8;
  const queryIds = parseQueryIdList(elements.queryList.value);

  const report = analyzeBlast(parsed, {
    minIdentity,
    minQueryCoverage: minCoverage,
    maxEvalue,
    queryLengths: {},
    queryIds,
  });

  const speciesThreshold = Number(elements.speciesThreshold.value) || 98.65;
  const minQueryLengthRaw = elements.minQueryLength.value.trim();
  const minQueryLength = minQueryLengthRaw === "" ? null : Number(minQueryLengthRaw);

  const analysis = analyzeTaxonomy(report, taxonomyMap, {
    top_n: topN,
    min_consensus: minConsensus,
    species_threshold: speciesThreshold,
    min_query_length: minQueryLength,
  });
  lastAnalysis = analysis;
  render(analysis);
}

function render(analysis) {
  elements.results.hidden = false;
  elements.resultsTitle.textContent = "Taxonomic consensus results";
  const s = analysis.summary;
  elements.status.textContent = "Analysis complete";
  elements.status.classList.toggle("has-errors", false);
  elements.summary.replaceChildren(
    createSummaryCard("Total queries", String(s.total_queries)),
    createSummaryCard("With hits", String(s.queries_with_hits)),
    createSummaryCard("No-hit queries", String(s.queries_without_hits)),
    createSummaryCard("Total candidates", String(s.total_candidates)),
    createSummaryCard("Flags", String(analysis.flags.length))
  );

  elements.flags.replaceChildren();
  if (analysis.flags.length) {
    const banner = document.createElement("div");
    banner.className = "message warning";
    banner.textContent = analysis.flags.join("; ");
    elements.flags.append(banner);
  } else {
    const ok = document.createElement("div");
    ok.className = "message";
    ok.textContent = "No analysis flags.";
    elements.flags.append(ok);
  }

  const noteBits = [];
  if (analysis.flags.includes("no_hit_queries")) noteBits.push("Some queries returned no BLAST hits and are reported as insufficient evidence.");
  if (analysis.flags.includes("candidate_truncation")) noteBits.push("Some candidate sets were truncated at the configured top-N.");
  if (analysis.flags.includes("multiple_taxids_per_hit")) noteBits.push("Some hits carry multiple taxonomy identifiers.");
  if (analysis.flags.includes("missing_taxids")) noteBits.push("Some hits have no taxonomy identifiers.");
  elements.note.textContent = noteBits.join(" ") + " Consensus support is an evidence fraction, not a probability of correct identification. BLAST similarity is not proof of species identity.";

  elements.queryListView.replaceChildren();
  const allQueries = [...new Set([...Object.keys(analysis.per_query), ...Object.keys(analysis.no_hit_queries)])].sort();
  for (const qid of allQueries) {
    const entry = analysis.per_query[qid] || analysis.no_hit_queries[qid];
    elements.queryListView.append(renderQueryCard(qid, entry));
  }
}

elements.run.addEventListener("click", runAnalysis);
elements.clear.addEventListener("click", () => {
  elements.text.value = "";
  elements.blastFile.value = "";
  elements.mapFile.value = "";
  elements.queryList.value = "";
  elements.charCount.textContent = "0 characters";
  elements.results.hidden = true;
  hideError();
  lastAnalysis = null;
  taxonomyMap = null;
});
elements.text.addEventListener("input", () => {
  elements.charCount.textContent = `${elements.text.value.length.toLocaleString()} characters`;
  if (elements.blastFile.files.length) elements.blastFile.value = "";
});
elements.blastFile.addEventListener("change", async () => {
  hideError();
  const file = elements.blastFile.files?.[0];
  if (!file) return;
  if (file.size > MAX_FILE_BYTES) {
    elements.blastFile.value = "";
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
if (elements.mapFile) {
  elements.mapFile.addEventListener("change", async () => {
    hideError();
    const file = elements.mapFile.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const parsed = parseTaxonomyMap(text);
      if (!parsed.valid) {
        showError("Invalid taxonomy mapping: " + parsed.errors.join("; "));
        taxonomyMap = null;
        return;
      }
      taxonomyMap = parsed.map;
      elements.results.hidden = true;
    } catch {
      showError("The taxonomy mapping file could not be read.");
    }
  });
}
if (elements.loadExample) {
  elements.loadExample.addEventListener("click", () => {
    elements.blastFile.value = "";
    elements.mapFile.value = "";
    elements.schema.value = "blastn_local_v1";
    elements.text.value = EXAMPLE_TSV;
    elements.queryList.value = EXAMPLE_QUERY_LIST;
    elements.charCount.textContent = `${elements.text.value.length.toLocaleString()} characters`;
    // Also install the bundled example mapping so the user can run immediately.
    const parsed = parseTaxonomyMap(EXAMPLE_MAP);
    if (parsed.valid) taxonomyMap = parsed.map;
    elements.results.hidden = true;
    hideError();
  });
}

elements.downloadJson.addEventListener("click", () => {
  if (!lastAnalysis) return;
  const blob = new Blob([JSON.stringify(lastAnalysis, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url; link.download = "taxonomy-analysis.json";
  document.body.append(link); link.click(); link.remove(); URL.revokeObjectURL(url);
});
elements.downloadCsv.addEventListener("click", () => {
  if (!lastAnalysis) return;
  const rows = [];
  for (const [qid, entry] of Object.entries(lastAnalysis.per_query)) {
    const c = entry.consensus;
    const sup = c.support || {};
    const v = entry.verdict || { evidence_summary: {}, caution_flags: [] };
    rows.push({
      query_id: qid,
      verdict: v.status, reported_rank: v.reported_rank, reported_taxon: v.reported_taxon,
      top_identity: v.evidence_summary.top_identity, verdict_cautions: v.caution_flags.join("; "),
      status: c.status, supported_rank: c.supported_rank,
      consensus_taxon: c.consensus_taxon, candidate_count: c.candidate_count,
      unique_species: sup.unique_species, genus_support: sup.genus_support,
      species_support: sup.species_support, reference_hits: sup.reference_hits,
      unique_accessions: sup.unique_accessions,
      candidate_species: c.candidate_species.join("; "),
      warnings: c.warnings.join("; "),
    });
  }
  for (const [qid, entry] of Object.entries(lastAnalysis.no_hit_queries)) {
    const c = entry.consensus;
    const nv = entry.verdict || { caution_flags: [] };
    rows.push({ query_id: qid, verdict: nv.status, reported_rank: nv.reported_rank, reported_taxon: nv.reported_taxon, top_identity: "", verdict_cautions: "", status: c.status, supported_rank: c.supported_rank, consensus_taxon: c.consensus_taxon, candidate_count: 0, unique_species: "", genus_support: "", species_support: "", candidate_species: "", warnings: c.warnings.join("; ") });
  }
  const columns = [...new Set(rows.flatMap((row) => Object.keys(row)))];
  const escape = (value) => {
    if (value == null) return "";
    const text = String(value);
    return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
  };
  const csv = [columns.join(","), ...rows.map((row) => columns.map((c) => escape(row[c])).join(","))].join("\r\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url; link.download = "taxonomy-summary.csv";
  document.body.append(link); link.click(); link.remove(); URL.revokeObjectURL(url);
});
if (elements.printReport) {
  elements.printReport.addEventListener("click", async () => {
    if (!lastAnalysis) return;
    const html = await buildReportHtml(lastAnalysis, {
      inputText: elements.text.value || "",
      inputFileName: elements.blastFile.files?.[0]?.name || null,
    });
    const blob = new Blob([html], { type: "text/html" });
    const url = URL.createObjectURL(blob);
    const win = window.open(url, "_blank");
    if (win) {
      win.onload = () => { win.focus(); win.print(); };
    }
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  });
}