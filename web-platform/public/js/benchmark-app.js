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
  let svg = `<svg viewBox="0 0 ${w} ${h}" width="100%" height="auto" role="img" aria-label="Synthetic risk coverage bars">`;
  svg += `<line x1="${pad}" y1="${h - pad}" x2="${w - pad}" y2="${h - pad}" stroke="#333"/>`;
  rows.forEach((r, i) => {
    const x = pad + i * group + 8, bw = 36, avail = h - 2 * pad;
    const callH = (r.species_call_rate || 0) * avail;
    const wrongH = (r.wrong_rate_overall || 0) * avail;
    svg += `<rect x="${x}" y="${h - pad - callH}" width="${bw}" height="${callH}" fill="#2b6cb0"><title>Threshold ${esc(r.species_threshold)}%: call rate ${esc(r.species_call_rate)}</title></rect>`;
    svg += `<rect x="${x + bw + 4}" y="${h - pad - wrongH}" width="${bw}" height="${wrongH}" fill="#c53030"><title>Threshold ${esc(r.species_threshold)}%: overall wrong rate ${esc(r.wrong_rate_overall)}</title></rect>`;
    svg += `<text x="${x + bw}" y="${h - 10}" text-anchor="middle" font-size="11">${esc(r.species_threshold)}</text>`;
  });
  svg += `</svg><p><span class="legend-call">Blue</span> = species call rate; <span class="legend-wrong">red</span> = overall wrong rate. Synthetic data only.</p>`;
  host.innerHTML = svg;
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

if (typeof document !== "undefined") initBenchmarkPage();
