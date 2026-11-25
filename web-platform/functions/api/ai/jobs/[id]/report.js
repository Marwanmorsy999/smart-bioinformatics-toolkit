// GET /api/ai/jobs/[id]/report — M7.3 job-based report.
//
// The report is generated from persisted run records only. Caller-supplied
// results/explanations are never trusted: every field is read from D1.
import { SQL, errorResponse, getDb, jsonResponse, htmlResponse, listRows, requireMethod, safeString } from "../../_lib.js";

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

export async function onRequest(context) {
  const rejected = requireMethod(context.request, "GET", "GET, OPTIONS");
  if (rejected) return rejected;
  return handleJobReport(context.request, context.env);
}

export async function handleJobReport(request, env) {
  const db = getDb(env);
  if (!db) return errorResponse("AI database binding is unavailable.", 503, request);
  const url = new URL(request.url);
  const jobId = safeString(decodeURIComponent(url.pathname.split("/").filter(Boolean).pop()), 100);
  if (!jobId) return errorResponse("job id is required.", 400, request);
  let job;
  try { job = (await listRows(db, SQL.getJob, [jobId]))[0] ?? null; } catch { job = null; }
  if (!job) return errorResponse("Job not found.", 404, request);

  const planId = job.plan_id ?? "";
  let artifacts = [], auditEvents = [], references = [];
  try { artifacts = await listRows(db, SQL.listArtifactsForRun, [job.public_id]); } catch {}
  try { auditEvents = await listRows(db, SQL.listAuditEvents, []); } catch {}
  const related = auditEvents.filter((e) => String(e.target ?? "") === job.public_id || String(e.detail_json ?? "").includes(planId));
  try { references = await listRows(db, SQL.listReferences ?? "SELECT * FROM evidence_references", []); } catch {}

  const provenance = JSON.parse(job.provenance_json ?? "null");
  const validation = JSON.parse(job.validation_json ?? "null");
  const result = JSON.parse(job.result_json ?? "null");
  const report = {
    report_type: "M7.3 Phylogenetics Galaxy workflow (job-derived)",
    job: { job_id: job.public_id, step_id: job.step_id, status: job.status, tool_id: job.tool_id,
      backend: job.backend, execution_mode: job.execution_mode, started_at: job.started_at, finished_at: job.finished_at },
    params: JSON.parse(job.params_json ?? "{}"),
    provenance, validation,
    outputs: artifacts.map((a) => ({ name: a.name, kind: a.kind, sha256: a.sha256, bytes: a.bytes, storage_ref: a.storage_ref })),
    references: references.map((r) => ({ key: r.key, title: r.title, url: r.url, license: r.license, verified: r.verified })),
    audit: related.map((e) => ({ action: e.action, actor: e.actor, target: e.target, timestamp: e.timestamp })),
    limitations: [
      "This report is generated from persisted job records; it is not a caller-supplied narrative.",
      "Progressive alignment and distance/ML tree inference are hypotheses, not proof of ancestry.",
      "Research use only; not a clinical or diagnostic result."
    ],
    generated_at: new Date().toISOString()
  };
  if (url.searchParams.get("format") === "html" || String(request.headers.get("Accept") ?? "").includes("text/html")) {
    const html = `<!doctype html><html lang="en"><meta charset="utf-8"><title>M7.3 run report</title>
<style>body{font-family:system-ui,sans-serif;max-width:60rem;margin:2rem auto;padding:0 1rem;line-height:1.5}table{border-collapse:collapse}td,th{border:1px solid #ccc;padding:.35rem .6rem}</style>
<h1>Phylogenetics workflow report</h1><p>Generated from job <code>${esc(job.public_id)}</code>.</p>
<h2>Job</h2><table>${Object.entries(report.job).map(([k, v]) => `<tr><th>${esc(k)}</th><td>${esc(v)}</td></tr>`).join("")}</table>
<h2>Outputs</h2><table><tr><th>name</th><th>kind</th><th>SHA-256</th><th>bytes</th></tr>${report.outputs.map((a) => `<tr><td>${esc(a.name)}</td><td>${esc(a.kind)}</td><td><code>${esc(a.sha256)}</code></td><td>${esc(a.bytes)}</td></tr>`).join("")}</table>
<h2>Validation</h2><pre>${esc(JSON.stringify(validation, null, 2))}</pre>
<h2>Provenance</h2><pre>${esc(JSON.stringify(provenance, null, 2))}</pre>
<h2>Limitations</h2><ul>${report.limitations.map((l) => `<li>${esc(l)}</li>`).join("")}</ul>`;
    return htmlResponse(html, 200, request);
  }
  return jsonResponse(report, 200, request);
}
