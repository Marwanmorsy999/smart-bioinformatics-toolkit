"""Self-contained HTML report generation for taxonomy runs."""

from __future__ import annotations

import html
import json
from datetime import datetime, timezone
from typing import Any


def _esc(value: Any) -> str:
    if value is None:
        return "—"
    return html.escape(str(value))


def build_reproducibility_metadata(
    *,
    tool_version: str = "0.1.0",
    input_file: str | None = None,
    input_file_hash: str | None = None,
    parameters: dict[str, Any] | None = None,
    thresholds: dict[str, Any] | None = None,
    disclaimer: str = "Research use only. This verdict interprets BLAST similarity evidence; it is not proof of species identity and not a clinical diagnosis.",
) -> dict[str, Any]:
    return {
        "tool": "Smart Bioinformatics Toolkit",
        "tool_version": tool_version,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "input_file": input_file,
        "input_file_hash_sha256": input_file_hash,
        "parameters": parameters or {},
        "thresholds": thresholds or {},
        "disclaimer": disclaimer,
    }


def build_report_html(analysis: dict[str, Any], metadata: dict[str, Any]) -> str:
    DISCLAIMER = metadata.get("disclaimer") or ""
    parts: list[str] = []
    parts.append("<!DOCTYPE html>")
    parts.append("<html lang=\"en\"><head><meta charset=\"utf-8\">")
    parts.append("<title>Smart Bioinformatics Toolkit — Taxonomy report</title>")
    parts.append("<style>")
    parts.append("body{font-family:Arial,Helvetica,sans-serif;margin:24px;color:#111}")
    parts.append("h1,h2,h3{margin:0.6em 0 0.3em}")
    parts.append("table{border-collapse:collapse;width:100%;margin:0.5em 0}")
    parts.append("th,td{border:1px solid #ccc;padding:6px;text-align:left;font-size:12px}")
    parts.append("th{background:#f2f2f2}")
    parts.append(".verdict{padding:8px;margin:8px 0;border-left:4px solid #888;background:#fafafa}")
    parts.append(".caution{color:#8a6d00}")
    parts.append(".disclaimer{font-size:12px;color:#555;margin-top:12px}")
    parts.append("@media print{body{margin:12px}}")
    parts.append("</style></head><body>")
    parts.append("<h1>Taxonomy analysis report</h1>")
    parts.append(f"<p><strong>Tool:</strong> { _esc(metadata.get('tool')) } {_esc(metadata.get('tool_version'))}</p>")
    parts.append(f"<p><strong>Generated:</strong> {_esc(metadata.get('generated_at'))}</p>")
    parts.append(f"<p><strong>Input file:</strong> {_esc(metadata.get('input_file'))}</p>")
    parts.append(f"<p><strong>Input SHA-256:</strong> {_esc(metadata.get('input_file_hash_sha256'))}</p>")

    parts.append("<h2>Reproducibility metadata</h2>")
    parts.append(f"<pre>{_esc(json.dumps(metadata, indent=2, sort_keys=True))}</pre>")

    parts.append("<h2>Parameters and thresholds</h2>")
    vs = analysis.get("verdict_settings", {})
    parts.append("<table><thead><tr><th>Parameter</th><th>Value</th></tr></thead><tbody>")
    for k, v in (analysis.get("parameters", {}) or {}).items() if False else []:
        pass
    params = {
        "top_n": analysis.get("top_n"),
        "min_consensus": analysis.get("min_consensus"),
        **vs,
    }
    for k, v in params.items():
        parts.append(f"<tr><td>{_esc(k)}</td><td>{_esc(v)}</td></tr>")
    parts.append("</tbody></table>")

    parts.append("<h2>Summary</h2>")
    s = analysis.get("summary", {})
    parts.append("<table><thead><tr><th>Metric</th><th>Value</th></tr></thead><tbody>")
    for k, v in s.items():
        parts.append(f"<tr><td>{_esc(k)}</td><td>{_esc(v)}</td></tr>")
    parts.append("</tbody></table>")
    parts.append(f"<p>Verdict counts: {_esc(json.dumps(analysis.get('verdict_counts', {})))}</p>")
    parts.append(f"<p>Flags: {_esc(', '.join(analysis.get('flags', [])))}</p>")

    # Per query
    all_ids = sorted(set(list(analysis.get("per_query", {}).keys()) + list(analysis.get("no_hit_queries", {}).keys())))
    for qid in all_ids:
        entry = analysis.get("per_query", {}).get(qid) or analysis.get("no_hit_queries", {}).get(qid)
        if not entry:
            continue
        cons = entry.get("consensus", {})
        verdict = entry.get("verdict", {})
        parts.append(f"<h3>Query: {_esc(qid)}</h3>")
        parts.append(f"<div class=\"verdict\"><strong>{_esc(verdict.get('status'))}</strong>")
        if verdict.get("reported_taxon"):
            parts.append(f" — {_esc(verdict.get('reported_rank'))}: {_esc(verdict.get('reported_taxon'))}")
        parts.append("<br>")
        for r in verdict.get("reasons", []):
            parts.append(f"{_esc(r)}<br>")
        cautions = verdict.get("caution_flags", [])
        if cautions:
            parts.append(f"<span class=\"caution\">Cautions: {_esc(', '.join(cautions))}</span><br>")
        parts.append(f"<small>{_esc(verdict.get('disclaimer'))}</small></div>")

        parts.append("<p><strong>Consensus status:</strong> " + _esc(cons.get("status")) + " · <strong>supported rank:</strong> " + _esc(cons.get("supported_rank")) + " · <strong>consensus taxon:</strong> " + _esc(cons.get("consensus_taxon")) + "</p>")
        sup = cons.get("support", {}) or {}
        parts.append("<p><strong>Support:</strong> " + _esc(f"genus {sup.get('genus_support')}, species {sup.get('species_support')}, unique species {sup.get('unique_species')}, unique accessions {sup.get('unique_accessions')}, reference hits {sup.get('reference_hits')}") + "</p>")
        if cons.get("candidate_species"):
            parts.append("<p><strong>Candidate species:</strong> " + _esc(", ".join(cons.get("candidate_species", []))) + "</p>")
        if cons.get("warnings"):
            parts.append("<p><strong>Warnings:</strong> " + _esc("; ".join(cons.get("warnings", []))) + "</p>")
        ev = cons.get("evidence", [])
        if ev:
            parts.append("<table><thead><tr><th>Accession</th><th>Species</th><th>Genus</th><th>Identity %</th><th>Coverage %</th><th>E-value</th><th>Bitscore</th></tr></thead><tbody>")
            for e in ev:
                lineage = e.get("lineage") or {}
                ranks = lineage.get("ranks", {}) if isinstance(lineage, dict) else {}
                species = (ranks.get("species") or {}).get("name") if isinstance(ranks, dict) else None
                genus = (ranks.get("genus") or {}).get("name") if isinstance(ranks, dict) else None
                parts.append(
                    "<tr>"
                    f"<td>{_esc(e.get('accession'))}</td>"
                    f"<td>{_esc(species)}</td>"
                    f"<td>{_esc(genus)}</td>"
                    f"<td>{_esc(e.get('pident'))}</td>"
                    f"<td>{_esc(e.get('query_coverage'))}</td>"
                    f"<td>{_esc(e.get('evalue'))}</td>"
                    f"<td>{_esc(e.get('bitscore'))}</td>"
                    "</tr>"
                )
            parts.append("</tbody></table>")

    parts.append(f"<div class=\"disclaimer\">{_esc(DISCLAIMER)}</div>")
    parts.append("</body></html>")
    return "\n".join(parts)

