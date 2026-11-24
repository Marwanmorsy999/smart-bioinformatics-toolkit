// Risk-coverage page logic (external module; CSP forbids inline scripts).
// Uses SYNTHETIC shared-fixture-shaped data; never presented as performance.
import { riskCoverageSweep } from "./risk-coverage.js";

const DATA = [
  { top_species: "Escherichia coli", top_identity: 99.8, true_species: "Escherichia coli", top_query_coverage: 100 },
  { top_species: "Escherichia albertii", top_identity: 99.2, true_species: "Escherichia coli", top_query_coverage: 100 },
  { top_species: "Escherichia coli", top_identity: 98.4, true_species: "Shigella dysenteriae", top_query_coverage: 100 },
  { top_species: "Escherichia coli", top_identity: 99.5, true_species: "Escherichia coli", top_query_coverage: 60 },
  { top_species: null, top_identity: 99.5, true_species: "Escherichia coli", top_query_coverage: 100 },
];
const THRESHOLDS = [97.0, 98.0, 98.65, 99.0, 99.9];

function esc(value) {
  return String(value).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

export function renderChart(rows, host) {
  const w = 620, h = 280, pad = 36, group = (w - 2 * pad) / rows.length;
  // The text alternative names the pattern without presenting the data as measured performance.
  const description = "Synthetic risk-coverage demonstration. For each screening threshold, a blue bar shows the species call rate and a red bar shows the overall wrong rate. These are example values, not measured performance; the table below gives exact numbers.";
  let svg = `<svg viewBox="0 0 ${w} ${h}" width="100%" role="img" aria-label="${esc(description)}">`;
  svg += `<desc>${esc(description)}</desc>`;
  svg += `<line class="axis-line" x1="${pad}" y1="${h - pad}" x2="${w - pad}" y2="${h - pad}"/>`;
  rows.forEach((r, i) => {
    const x = pad + i * group + 8, bw = 36, avail = h - 2 * pad;
    const callH = (r.species_call_rate || 0) * avail;
    const wrongH = (r.wrong_rate_overall || 0) * avail;
    svg += `<rect class="bar-call" x="${x}" y="${h - pad - callH}" width="${bw}" height="${callH}"><title>Threshold ${esc(r.species_threshold)}%: call rate ${esc(r.species_call_rate)}</title></rect>`;
    svg += `<rect class="bar-wrong" x="${x + bw + 4}" y="${h - pad - wrongH}" width="${bw}" height="${wrongH}"><title>Threshold ${esc(r.species_threshold)}%: overall wrong rate ${esc(r.wrong_rate_overall)}</title></rect>`;
    svg += `<text class="axis-label" x="${x + bw}" y="${h - 10}" text-anchor="middle">${esc(r.species_threshold)}</text>`;
  });
  svg += `</svg><p class="legend"><span class="legend-call">Blue</span> = species call rate; <span class="legend-wrong">red</span> = overall wrong rate. Synthetic demonstration data only - not performance measurement.</p>`;
  host.innerHTML = svg;
}

function ensureSkipLink() {
  if (document.querySelector(".skip-link")) return;
  const main = document.querySelector("main");
  if (main && !main.id) main.id = "main-content";
  const link = document.createElement("a");
  link.className = "skip-link";
  link.href = "#main-content";
  link.textContent = "Skip to main content";
  document.body.insertBefore(link, document.body.firstChild);
}

export function initBenchmarkPage() {
  const host = document.getElementById("chart");
  const tbody = document.querySelector("#rc-table tbody");
  if (!host || !tbody) return [];
  const rows = riskCoverageSweep(DATA, THRESHOLDS);
  for (const r of rows) {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td>${esc(r.species_threshold)}</td><td>${esc(r.species_call_rate)}</td><td>${esc(r.wrong_rate_among_calls ?? "n/a")}</td><td>${esc(r.wrong_rate_overall)}</td><td>${esc(r.calls)}</td><td>${esc(r.wrong)}</td>`;
    tbody.appendChild(tr);
  }
  renderChart(rows, host);
  return rows;
}

if (typeof document !== "undefined") {
  ensureSkipLink();
  initBenchmarkPage();
}
