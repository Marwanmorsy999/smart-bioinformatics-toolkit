// Deterministic, self-contained HTML report assembly. All interpolated values
// are escaped; no scripts, no external fonts/CDNs, no unvalidated numbers.

import { htmlEscape } from "./_lib.js";

const e = (value) => htmlEscape(value ?? "");
const list = (values, fallback = "None recorded.") => {
  const items = Array.isArray(values) ? values.filter((v) => typeof v === "string" && v.trim()) : [];
  if (!items.length) return `<p>${fallback}</p>`;
  return `<ul>${items.map((item) => `<li>${e(item)}</li>`).join("")}</ul>`;
};

export function buildReportHtml({ job, plan, artifacts, validation, explanation, provenance, mode, createdAt }) {
  const artifactRows = (Array.isArray(artifacts) ? artifacts : []).map((artifact) => `
    <tr>
      <td>${e(artifact.name)}</td>
      <td>${e(artifact.kind)}</td>
      <td><code>${e(artifact.sha256)}</code></td>
      <td>${e(artifact.bytes)}</td>
    </tr>`).join("");
  const findingRows = (Array.isArray(explanation?.findings) ? explanation.findings : []).map((finding) => `
    <tr>
      <td>${e(finding?.text)}</td>
      <td>${e(finding?.artifact)}</td>
      <td><code>${e(finding?.field_path)}</code></td>
    </tr>`).join("");
  const referenceRows = (Array.isArray(explanation?.references) ? explanation.references : []).map((reference) => `
    <tr>
      <td>${e(reference?.key)}</td>
      <td>${e(reference?.title)}</td>
      <td>${e(reference?.url)}</td>
      <td>${reference?.verified === true ? "Verified" : "Unverified"}</td>
    </tr>`).join("");
  const artifactContents = (Array.isArray(artifacts) ? artifacts : []).map((artifact) => `
    <section aria-labelledby="artifact-${e(artifact.name).replace(/[^a-zA-Z0-9_-]/g, "-")}">
      <h3 id="artifact-${e(artifact.name).replace(/[^a-zA-Z0-9_-]/g, "-")}">Artifact: ${e(artifact.name)}</h3>
      <pre>${e(artifact.content)}</pre>
    </section>`).join("");

  const parameters = JSON.stringify(plan?.steps?.[0]?.params ?? {}, null, 2);
  const limitations = [
    ...(Array.isArray(plan?.limitations) ? plan.limitations : []),
    ...(Array.isArray(explanation?.limitations) ? explanation.limitations : [])
  ];
  const tool = provenance?.tool ?? {};
  const input = provenance?.input ?? {};
  const timing = provenance?.timing ?? {};

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">
<meta name="referrer" content="no-referrer">
<title>Analysis report - ${e(job?.id)}</title>
<style>
  body{font:15px/1.6 system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif;color:#1b2d3d;background:#f4f8fa;margin:0;padding:24px}
  main{max-width:960px;margin:0 auto;background:#fff;border:1px solid #d8e3e8;border-radius:12px;padding:28px}
  h1,h2,h3{line-height:1.25}h1{font-size:1.7rem}h2{font-size:1.15rem;margin-top:32px;border-bottom:1px solid #e8eff2;padding-bottom:6px}
  table{border-collapse:collapse;width:100%;margin:12px 0}th,td{border:1px solid #d8e3e8;padding:8px;text-align:left;vertical-align:top;font-size:.875rem}
  th{background:#f8fbfc}code{font-family:ui-monospace,Consolas,monospace;word-break:break-all}pre{white-space:pre-wrap;word-break:break-word;background:#f8fbfc;border:1px solid #e8eff2;border-radius:8px;padding:12px;font-size:.8125rem}
  .badge{display:inline-block;border-radius:999px;padding:3px 10px;font-size:.75rem;font-weight:700;background:#e7f5ee;color:#136b54}
  .badge.mock{background:#fff4e2;color:#7d4e0b}.note{color:#4e6373;font-size:.875rem}ul{margin:8px 0 8px 20px;padding:0}
</style>
</head>
<body>
<main>
  <h1>Smart Bioinformatics Toolkit - Analysis Report</h1>
  <p class="note">Generated ${e(createdAt)} &middot; Job <code>${e(job?.id)}</code> &middot; Plan <code>${e(job?.plan_id)}</code></p>
  <p><span class="badge${mode === "mock" ? " mock" : ""}">Execution mode: ${e(mode)}</span></p>
  <p class="note">Research use only. Outputs are screening evidence, not proof of identity and not a clinical diagnosis. Interpretation remains the user's responsibility.</p>

  <h2>Summary</h2>
  <table>
    <tbody>
      <tr><th scope="row">Status</th><td>${e(job?.status)}</td></tr>
      <tr><th scope="row">Tool</th><td>${e(job?.tool_id)}</td></tr>
      <tr><th scope="row">Step</th><td>${e(job?.step_id)}</td></tr>
      <tr><th scope="row">Intent</th><td>${e(plan?.intent)}</td></tr>
      <tr><th scope="row">Validation</th><td>${e(validation?.status)}</td></tr>
      <tr><th scope="row">Uncertainty</th><td>${e(explanation?.uncertainty)}</td></tr>
    </tbody>
  </table>
  <p>${e(explanation?.summary)}</p>

  <h2>Findings</h2>
  ${findingRows ? `<table><thead><tr><th scope="col">Finding</th><th scope="col">Artifact</th><th scope="col">Field path</th></tr></thead><tbody>${findingRows}</tbody></table>` : "<p>No findings recorded.</p>"}

  <h2>Artifacts</h2>
  ${artifactRows ? `<table><thead><tr><th scope="col">Name</th><th scope="col">Kind</th><th scope="col">SHA-256</th><th scope="col">Bytes</th></tr></thead><tbody>${artifactRows}</tbody></table>` : "<p>No artifacts recorded.</p>"}
  ${artifactContents}

  <h2>Validation</h2>
  <p>Status: <strong>${e(validation?.status)}</strong></p>
  <p>Checked rules:</p>${list(validation?.checked_rules)}
  <p>Flags:</p>${list(validation?.flags)}

  <h2>Reproducibility</h2>
  <table>
    <tbody>
      <tr><th scope="row">Tool id / version</th><td>${e(tool.id)} / ${e(tool.version)}</td></tr>
      <tr><th scope="row">Backend</th><td>${e(tool.backend)}</td></tr>
      <tr><th scope="row">Dataset id</th><td><code>${e(input.dataset_id)}</code></td></tr>
      <tr><th scope="row">Input filename</th><td>${e(input.filename)}</td></tr>
      <tr><th scope="row">Input SHA-256</th><td><code>${e(input.sha256)}</code></td></tr>
      <tr><th scope="row">Parameters</th><td><pre>${e(parameters)}</pre></td></tr>
      <tr><th scope="row">Database</th><td>${e(provenance?.database?.name) || "None used"} ${e(provenance?.database?.release)}</td></tr>
      <tr><th scope="row">Started / finished</th><td>${e(timing.started_at)} / ${e(timing.finished_at)}</td></tr>
      <tr><th scope="row">Execution mode</th><td>${e(provenance?.execution_mode ?? mode)}</td></tr>
    </tbody>
  </table>
  <p class="note">To reproduce, run the registered tool with the exact parameters and dataset hash above through the local execution agent. Artifact hashes are verified before display.</p>

  <h2>Limitations</h2>
  ${list(limitations)}
  <p class="note">Taxonomic claims require verified BLAST evidence from a local database; this MVP does not produce them from FASTA alone.</p>

  <h2>References</h2>
  ${referenceRows ? `<table><thead><tr><th scope="col">Key</th><th scope="col">Title</th><th scope="col">URL</th><th scope="col">Status</th></tr></thead><tbody>${referenceRows}</tbody></table>` : "<p>No references recorded.</p>"}
</main>
</body>
</html>
`;
}
