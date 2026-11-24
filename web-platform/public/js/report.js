export async function sha256Text(text) {
  if (!crypto || !crypto.subtle) return null;
  const data = new TextEncoder().encode(text);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function esc(value) {
  if (value == null) return "—";
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export async function buildReportHtml(analysis, options = {}) {
  const generatedAt = new Date().toISOString();
  const inputHash = await sha256Text(options.inputText || "");
  const metadata = {
    tool: "Smart Bioinformatics Toolkit",
    tool_version: "0.1.0",
    generated_at: generatedAt,
    input_file: options.inputFileName || null,
    input_file_hash_sha256: inputHash,
    parameters: {
      top_n: analysis.top_n,
      min_consensus: analysis.min_consensus,
      ...(analysis.verdict_settings || {}),
    },
    thresholds: analysis.thresholds || {},
    disclaimer:
      "Research use only. This verdict interprets BLAST similarity evidence; it is not proof of species identity and not a clinical diagnosis.",
  };

  const parts = [];
  parts.push("<!DOCTYPE html><html lang=\"en\"><head><meta charset=\"utf-8\">");
  parts.push("<title>Smart Bioinformatics Toolkit — Taxonomy report</title>");
  parts.push("<style>body{font-family:Arial,Helvetica,sans-serif;margin:24px;color:#111}h1,h2,h3{margin:.6em 0 .3em}table{border-collapse:collapse;width:100%;margin:.5em 0}th,td{border:1px solid #ccc;padding:6px;text-align:left;font-size:12px}th{background:#f2f2f2}.verdict{padding:8px;margin:8px 0;border-left:4px solid #888;background:#fafafa}.caution{color:#8a6d00}.disclaimer{font-size:12px;color:#555;margin-top:12px}@media print{body{margin:12px}}</style>");
  parts.push("</head><body>");
  parts.push("<h1>Taxonomy analysis report</h1>");
  parts.push(`<p><strong>Tool:</strong> ${esc(metadata.tool)} ${esc(metadata.tool_version)}</p>`);
  parts.push(`<p><strong>Generated:</strong> ${esc(metadata.generated_at)}</p>`);
  parts.push(`<p><strong>Input file:</strong> ${esc(metadata.input_file)}</p>`);
  parts.push(`<p><strong>Input SHA-256:</strong> ${esc(metadata.input_file_hash_sha256)}</p>`);
  parts.push("<h2>Reproducibility metadata</h2>");
  parts.push(`<pre>${esc(JSON.stringify(metadata, null, 2))}</pre>`);
  parts.push("<h2>Parameters and thresholds</h2>");
  parts.push("<table><thead><tr><th>Parameter</th><th>Value</th></tr></thead><tbody>");
  const params = { top_n: analysis.top_n, min_consensus: analysis.min_consensus, ...(analysis.verdict_settings || {}) };
  for (const [k, v] of Object.entries(params)) parts.push(`<tr><td>${esc(k)}</td><td>${esc(v)}</td></tr>`);
  parts.push("</tbody></table>");
  const s = analysis.summary || {};
  parts.push("<h2>Summary</h2><table><thead><tr><th>Metric</th><th>Value</th></tr></thead><tbody>");
  for (const [k, v] of Object.entries(s)) parts.push(`<tr><td>${esc(k)}</td><td>${esc(v)}</td></tr>`);
  parts.push("</tbody></table>");
  parts.push(`<p>Verdict counts: ${esc(JSON.stringify(analysis.verdict_counts || {}))}</p>`);
  parts.push(`<p>Flags: ${esc((analysis.flags || []).join(", "))}</p>`);

  const allIds = [...new Set([...Object.keys(analysis.per_query || {}), ...Object.keys(analysis.no_hit_queries || {})])].sort();
  for (const qid of allIds) {
    const entry = (analysis.per_query || {})[qid] || (analysis.no_hit_queries || {})[qid];
    if (!entry) continue;
    const cons = entry.consensus || {};
    const verdict = entry.verdict || {};
    parts.push(`<h3>Query: ${esc(qid)}</h3>`);
    parts.push(`<div class="verdict"><strong>${esc(verdict.status)}</strong>`);
    if (verdict.reported_taxon) parts.push(` — ${esc(verdict.reported_rank)}: ${esc(verdict.reported_taxon)}`);
    parts.push("<br>");
    for (const r of verdict.reasons || []) parts.push(`${esc(r)}<br>`);
    const cautions = verdict.caution_flags || [];
    if (cautions.length) parts.push(`<span class="caution">Cautions: ${esc(cautions.join(", "))}</span><br>`);
    parts.push(`<small>${esc(verdict.disclaimer)}</small></div>`);
    parts.push(`<p><strong>Consensus status:</strong> ${esc(cons.status)} · <strong>supported rank:</strong> ${esc(cons.supported_rank)} · <strong>consensus taxon:</strong> ${esc(cons.consensus_taxon)}</p>`);
    const sup = cons.support || {};
    parts.push(`<p><strong>Support:</strong> genus ${esc(sup.genus_support)}, species ${esc(sup.species_support)}, unique species ${esc(sup.unique_species)}, unique accessions ${esc(sup.unique_accessions)}, reference hits ${esc(sup.reference_hits)}</p>`);
    if (cons.candidate_species && cons.candidate_species.length) parts.push(`<p><strong>Candidate species:</strong> ${esc(cons.candidate_species.join(", "))}</p>`);
    if (cons.warnings && cons.warnings.length) parts.push(`<p><strong>Warnings:</strong> ${esc(cons.warnings.join("; "))}</p>`);
    const ev = cons.evidence || [];
    if (ev.length) {
      parts.push("<table><thead><tr><th>Accession</th><th>Species</th><th>Genus</th><th>Identity %</th><th>Coverage %</th><th>E-value</th><th>Bitscore</th></tr></thead><tbody>");
      for (const e of ev) {
        const lineage = e.lineage || {};
        const ranks = lineage.ranks || {};
        const species = ranks.species ? ranks.species.name : null;
        const genus = ranks.genus ? ranks.genus.name : null;
        parts.push(`<tr><td>${esc(e.accession)}</td><td>${esc(species)}</td><td>${esc(genus)}</td><td>${esc(e.pident)}</td><td>${esc(e.query_coverage)}</td><td>${esc(e.evalue)}</td><td>${esc(e.bitscore)}</td></tr>`);
      }
      parts.push("</tbody></table>");
    }
  }
  parts.push(`<div class="disclaimer">${esc(metadata.disclaimer)}</div>`);
  parts.push("</body></html>");
  return parts.join("\n");
}
