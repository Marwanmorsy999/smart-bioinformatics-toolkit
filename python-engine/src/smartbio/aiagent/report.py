"""Self-contained HTML report for one local agent run.

Rendering is deterministic and every embedded value is HTML-escaped. The
styling follows ``smartbio.taxonomy.report`` so reports look consistent.
"""

from __future__ import annotations

import html
import json
from typing import Any


def _esc(value: Any) -> str:
    if value is None:
        return "—"
    return html.escape(str(value))


def _pre(value: Any) -> str:
    return f"<pre>{_esc(json.dumps(value, indent=2, sort_keys=True, ensure_ascii=False))}</pre>"


def _table(headers: list[str], rows: list[list[Any]]) -> str:
    parts = ["<table><thead><tr>"]
    parts.extend(f"<th>{_esc(header)}</th>" for header in headers)
    parts.append("</tr></thead><tbody>")
    for row in rows:
        parts.append("<tr>")
        parts.extend(f"<td>{_esc(cell)}</td>" for cell in row)
        parts.append("</tr>")
    parts.append("</tbody></table>")
    return "".join(parts)


def _list(items: Any) -> str:
    values = list(items or [])
    if not values:
        return "<p>None recorded.</p>"
    return "<ul>" + "".join(f"<li>{_esc(item)}</li>" for item in values) + "</ul>"


def build_report_html(
    plan: dict[str, Any] | None,
    jobs: list[dict[str, Any]] | None,
    artifacts: list[dict[str, Any]] | None,
    validation: dict[str, Any] | None,
    explanation: dict[str, Any] | None,
    provenance: dict[str, Any] | None,
    education: dict[str, Any] | None = None,
) -> str:
    """Build an escaped, dependency-free HTML report for one job."""
    plan = plan or {}
    jobs = jobs or []
    artifacts = artifacts or []
    validation = validation or {}
    explanation = explanation or {}
    provenance = provenance or {}
    education = education or {}
    locality = provenance.get("locality_receipt") or {}

    parts: list[str] = []
    parts.append("<!DOCTYPE html>")
    parts.append("<html lang=\"en\"><head><meta charset=\"utf-8\">")
    parts.append("<title>Smart Bioinformatics Toolkit — AI run report</title>")
    parts.append("<style>")
    parts.append("body{font-family:Arial,Helvetica,sans-serif;margin:24px;color:#111}")
    parts.append("h1,h2,h3{margin:0.6em 0 0.3em}")
    parts.append("table{border-collapse:collapse;width:100%;margin:0.5em 0}")
    parts.append("th,td{border:1px solid #ccc;padding:6px;text-align:left;font-size:12px;vertical-align:top}")
    parts.append("th{background:#f2f2f2}")
    parts.append("pre{white-space:pre-wrap;word-break:break-word;background:#fafafa;border:1px solid #eee;padding:8px;font-size:11px}")
    parts.append(".status{padding:8px;margin:8px 0;border-left:4px solid #888;background:#fafafa}")
    parts.append(".disclaimer{font-size:12px;color:#555;margin-top:12px}")
    parts.append("@media print{body{margin:12px}}")
    parts.append("</style></head><body>")
    parts.append("<h1>AI run report</h1>")

    # Request
    parts.append("<h2>Request</h2>")
    parts.append(
        _table(
            ["Field", "Value"],
            [
                ["Request ID", plan.get("request_id")],
                ["Plan ID", plan.get("plan_id")],
                ["Domain", plan.get("domain")],
                ["Intent", plan.get("intent")],
                ["Confidence", plan.get("confidence")],
                ["Created at", plan.get("created_at")],
            ],
        )
    )
    if plan.get("request_text") or plan.get("user_text"):
        parts.append(f"<p><strong>Request text:</strong> {_esc(plan.get('request_text') or plan.get('user_text'))}</p>")

    # Plan & approvals
    parts.append("<h2>Plan &amp; approvals</h2>")
    step_rows: list[list[Any]] = []
    for step in plan.get("steps") or []:
        step = step or {}
        step_rows.append(
            [
                step.get("id"),
                step.get("tool_id"),
                step.get("backend"),
                json.dumps(step.get("params") or {}, sort_keys=True),
                step.get("external_egress"),
                step.get("consent_required"),
            ]
        )
    parts.append(
        _table(
            ["Step", "Tool ID", "Backend", "Parameters", "External egress", "Consent required"],
            step_rows,
        )
    )
    parts.append(f"<p><strong>External services:</strong> {_esc(', '.join(map(str, plan.get('external_services') or [])))}</p>")
    parts.append(f"<p><strong>Consents required:</strong> {_esc(', '.join(map(str, plan.get('consents_required') or [])))}</p>")
    parts.append(
        _table(
            ["Job ID", "Step ID", "Status", "Approved", "Consent granted"],
            [
                [
                    job.get("id"),
                    job.get("step_id"),
                    job.get("status"),
                    (job.get("approval") or {}).get("approved", job.get("approved")),
                    (job.get("consent") or {}).get("granted"),
                ]
                for job in jobs
            ],
        )
    )

    # Reproducibility
    parts.append("<h2>Reproducibility</h2>")
    tool = provenance.get("tool") or {}
    input_info = provenance.get("input") or {}
    database = provenance.get("database") or {}
    timing = provenance.get("timing") or {}
    parts.append(
        _table(
            ["Field", "Value"],
            [
                ["Tool ID", tool.get("id")],
                ["Tool version", tool.get("version")],
                ["Backend", tool.get("backend")],
                ["Parameters", json.dumps(provenance.get("parameters") or {}, sort_keys=True)],
                ["Input dataset ID", input_info.get("dataset_id")],
                ["Input filename", input_info.get("filename")],
                ["Input SHA-256", input_info.get("sha256")],
                ["Database name", database.get("name")],
                ["Database release", database.get("release")],
                ["Database retrieved at", database.get("retrieved_at")],
                ["Started at", timing.get("started_at")],
                ["Finished at", timing.get("finished_at")],
                ["Execution mode", provenance.get("execution_mode")],
            ],
        )
    )

    # Results
    parts.append("<h2>Results</h2>")
    parts.append(
        _table(
            ["Artifact", "Kind", "SHA-256", "Bytes"],
            [
                [
                    artifact.get("name"),
                    artifact.get("kind"),
                    artifact.get("sha256"),
                    len(str(artifact.get("content", "")).encode("utf-8")),
                ]
                for artifact in artifacts
            ],
        )
    )
    for artifact in artifacts:
        parts.append(f"<h3>{_esc(artifact.get('name'))}</h3>")
        parts.append(f"<pre>{_esc(artifact.get('content', ''))}</pre>")

    # Validation
    parts.append("<h2>Validation</h2>")
    parts.append(
        f"<div class=\"status\"><strong>Status:</strong> {_esc(validation.get('status'))}</div>"
    )
    parts.append("<p><strong>Flags:</strong></p>")
    parts.append(_list(validation.get("flags")))
    parts.append("<p><strong>Checked rules:</strong></p>")
    parts.append(_list(validation.get("checked_rules")))

    # Limitations
    parts.append("<h2>Limitations</h2>")
    parts.append(_list(explanation.get("limitations")))
    parts.append(_list(plan.get("limitations")))

    # Explanation
    parts.append("<h2>Explanation</h2>")
    parts.append(f"<p><strong>Summary:</strong> {_esc(explanation.get('summary'))}</p>")
    parts.append(f"<p><strong>Uncertainty:</strong> {_esc(explanation.get('uncertainty'))}</p>")
    parts.append(
        _table(
            ["Finding", "Artifact", "Field path"],
            [
                [finding.get("text"), finding.get("artifact"), finding.get("field_path")]
                for finding in explanation.get("findings") or []
            ],
        )
    )
    parts.append("<p><strong>References:</strong></p>")
    parts.append(
        _list(
            [
                f"{ref.get('key')} — {ref.get('title')} ({ref.get('url')}); verified: {ref.get('verified')}"
                for ref in explanation.get("references") or []
            ]
        )
    )

    # Locality receipt (FR-8.5)
    parts.append("<h2>Data locality</h2>")
    parts.append(
        _table(
            ["Field", "Value"],
            [
                ["Execution mode", locality.get("mode")],
                ["No external egress", locality.get("no_external_egress")],
            ],
        )
    )
    parts.append("<p><strong>Local operations:</strong></p>")
    parts.append(
        _list(
            [
                f"{item.get('name')} — {item.get('backend')}"
                for item in locality.get("local_operations") or []
            ]
        )
    )
    parts.append("<p><strong>External transmissions:</strong></p>")
    parts.append(
        _table(
            ["Step", "Destination", "Bytes sent", "Input SHA-256", "Consent ref", "Timestamp"],
            [
                [
                    item.get("step_id"),
                    item.get("destination"),
                    item.get("bytes_sent"),
                    item.get("input_sha256"),
                    item.get("consent"),
                    item.get("timestamp"),
                ]
                for item in locality.get("external_transmissions") or []
            ],
        )
    )
    parts.append("<p><strong>Consent records:</strong></p>")
    parts.append(_list(locality.get("consent_records")))

    # Education notes (FR-8.6)
    parts.append("<h2>Education notes</h2>")
    notes = education.get("notes") if isinstance(education, dict) else None
    if isinstance(education, list):
        notes = education
    parts.append(
        _table(
            ["Rule / threshold", "Why insufficient", "What would help", "Verified reference"],
            [
                [
                    note.get("rule_or_threshold"),
                    note.get("why_insufficient"),
                    note.get("what_would_help"),
                    note.get("verified_reference"),
                ]
                for note in notes or []
            ],
        )
    )

    # Provenance
    parts.append("<h2>Provenance</h2>")
    parts.append(_pre(provenance))

    parts.append(
        "<div class=\"disclaimer\">Research use only. Results are computed locally from "
        "the supplied data and are not clinical or experimental validation.</div>"
    )
    parts.append("</body></html>")
    return "\n".join(parts)


__all__ = ["build_report_html"]
