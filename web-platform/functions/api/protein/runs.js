// M7.13 persistence of genuine protein annotation runs in the existing AI D1
// tables. Every artifact below is produced from a real provider response; no
// placeholder file is written and no checksum is invented.

import {
  SQL, audit, envExecutionMode, getRow, hashInput, htmlEscape, insertRow, makeId, nowIso,
  parseJson, runStatement
} from "../ai/_lib.js";
import { summarizeAnnotation } from "./parser.js";

export const PROTEIN_STEPS = Object.freeze([
  ["protein_validate", "protein.validate"],
  ["protein_resolve", "protein.annotate"],
  ["protein_annotate", "protein.annotate"],
  ["protein_report", "protein.report"]
]);

function tsvCell(value) {
  return String(value ?? "").replace(/[\t\r\n]/g, " ").slice(0, 500);
}

export function buildTsv(result) {
  const lines = ["id\tsource\tsignature\tentry\tfeature_type\tstart\tend\tscore\tevalue\tdescription"];
  for (const protein of result?.proteins ?? []) {
    for (const feature of protein.annotation?.features ?? []) {
      for (const location of feature.locations) {
        lines.push([
          protein.id, feature.source, feature.signature.accession, feature.entry?.accession ?? "",
          feature.feature_type ?? feature.category, location.start ?? "", location.end ?? "",
          location.score ?? feature.score ?? "", location.evalue ?? feature.evalue ?? "",
          feature.signature.description ?? feature.entry?.description ?? ""
        ].map(tsvCell).join("\t"));
      }
    }
  }
  return `${lines.join("\n")}\n`;
}

// GFF3 is emitted only from genuine coordinates. Rows without both endpoints
// are skipped and counted in the summary; no interval is guessed.
export function buildGff3(result) {
  const lines = ["##gff-version 3"];
  let skipped = 0;
  for (const protein of result?.proteins ?? []) {
    const length = protein.annotation?.protein_length ?? protein.length;
    if (!Number.isInteger(length) || length <= 0) { skipped += 1; continue; }
    lines.push(`##sequence-region ${tsvCell(protein.id)} 1 ${length}`);
    for (const feature of protein.annotation?.features ?? []) {
      for (const location of feature.locations) {
        if (!Number.isInteger(location.start) || !Number.isInteger(location.end)) { skipped += 1; continue; }
        const attributes = [
          `ID=${encodeURIComponent(`${protein.id}:${feature.id}:${location.index}`)}`,
          `Name=${encodeURIComponent(feature.signature.accession ?? feature.category)}`,
          `Dbxref=${encodeURIComponent(`${feature.source ?? "unknown"}:${feature.signature.accession ?? ""}`)}`,
          `Note=${encodeURIComponent(feature.entry?.description ?? feature.signature.description ?? feature.category)}`
        ].join(";");
        lines.push([
          protein.id, feature.source ?? "InterPro", `protein_${feature.category}`,
          location.start, location.end, location.score ?? feature.score ?? ".", ".", ".", attributes
        ].map(tsvCell).join("\t"));
      }
    }
  }
  return { text: `${lines.join("\n")}\n`, skipped_locations: skipped };
}

const SECTION_TITLES = Object.freeze([
  "1. Executive summary",
  "2. Input and validation",
  "3. Route and release provenance",
  "4. Sequence properties",
  "5. Domain architecture and coordinates",
  "6. Families and superfamilies",
  "7. Sites, motifs and other reported features",
  "8. GO terms and pathways",
  "9. Deterministic interpretation and limitations",
  "10. Reproducibility and exports"
]);

/** Ten-section scientific report built only from stored genuine evidence. */
export function buildProteinReport(result) {
  const sections = [];
  const push = (title, body) => sections.push({ title, body });
  const proteins = result?.proteins ?? [];
  const allFeatures = proteins.flatMap((protein) => protein.annotation?.features ?? []);
  const input = result?.input ?? {};
  const summaryText = proteins.map((protein) =>
    `${protein.id}: ${summarizeAnnotation(protein.annotation)}`).join("\n") || "No annotation evidence was returned.";
  push(SECTION_TITLES[0], summaryText);
  push(SECTION_TITLES[1], [
    `Input mode: ${input.mode ?? "not reported"}. Filename: ${input.filename ?? "not reported"}.`,
    `Sequence count: ${(input.sequences ?? []).length}. MD5 key: ${input.md5 ?? "not reported"}.`,
    `Validation: ${result?.validation?.status ?? "not reported"}. ${(result?.validation?.errors ?? []).join(" ")}`.trim()
  ].join("\n"));
  const member = result?.releases?.member_databases ?? {};
  push(SECTION_TITLES[2], [
    `Route requested: ${result?.requested_route ?? "not reported"}. Route label: ${result?.route_label ?? "not reported"}.`,
    `InterPro release: ${result?.releases?.interpro_release ?? "null"} - ${result?.releases?.interpro_release_reason ?? "no reason recorded"}.`,
    `Member database releases: ${Object.entries(member).map(([name, version]) => `${name} ${version}`).join(", ") || "none reported"}.`,
    `Tool version: ${result?.releases?.tool_version ?? "null"}. ${result?.releases?.tool_version_reason ?? ""}`.trim()
  ].join("\n"));
  push(SECTION_TITLES[3], proteins.map((protein) =>
    `${protein.id}: length ${protein.length ?? protein.annotation?.protein_length ?? "not reported"}; ` +
    `MD5 ${protein.md5 ?? "not reported"}; ambiguous residues ` +
    `${(protein.ambiguous ?? []).map((item) => `${item.residue} x${item.count}`).join(", ") || "none reported"}.`).join("\n"));
  push(SECTION_TITLES[4], allFeatures.length
    ? allFeatures.map((feature) => {
      const coords = feature.locations.map((location) => `${location.start ?? "?"}-${location.end ?? "?"}`).join(", ");
      return `${feature.source ?? "unknown source"} ${feature.signature.accession ?? "no accession"} ` +
        `(${feature.feature_type ?? feature.category})${feature.entry?.accession ? ` integrated in ${feature.entry.accession}` : ""}: ${coords}`;
    }).join("\n")
    : "No domain or family coordinates were reported by the source.");
  const families = allFeatures.filter((feature) => ["family", "superfamily"].includes(feature.category));
  push(SECTION_TITLES[5], families.map((feature) =>
    `${feature.signature.accession ?? "unknown"} (${feature.category}, ${feature.source ?? "unknown"}): ` +
    `${feature.signature.name ?? feature.signature.description ?? "no description provided"}; ` +
    `${feature.entry?.accession ? `entry ${feature.entry.accession} - ${feature.entry.description ?? ""}` : "not integrated"}`
  ).join("\n") || "No families or superfamilies were reported.");
  const sites = proteins.flatMap((protein) => protein.annotation?.sites ?? []);
  const special = proteins.flatMap((protein) => protein.annotation?.special_features ?? []);
  push(SECTION_TITLES[6], [
    `Residue-level sites reported: ${sites.length}. ${sites.slice(0, 30).map((site) =>
      `${site.signature_accession ?? ""} ${site.description ?? "no description"}: ` +
      `${site.residues.map((residue) => `${residue.residue ?? "?"}@${residue.start ?? "?"}`).join(", ")}`).join("; ")}`,
    `Other feature types reported in source text: ${special.map((item) => item.label).join(", ") || "none"}. ` +
    "No licensed predictor (SignalP, Phobius, DeepTMHMM) or HMMER step was run by this platform."
  ].join("\n"));
  const goTerms = proteins.flatMap((protein) => protein.annotation?.go?.terms ?? []);
  push(SECTION_TITLES[7], [
    `GO terms with identifiers: ${goTerms.filter((term) => term.identifier).length}; ` +
    `total terms reported: ${goTerms.length}.`,
    goTerms.map((term) => `${term.identifier ?? "no identifier"} ${term.name ?? ""} ` +
      `(${term.category?.code ?? "?"}: ${term.category?.name ?? "not classified"})`).join("\n") || "No GO terms were reported.",
    ...proteins.flatMap((protein) => protein.annotation?.go?.reasons ?? []),
    `Pathways: ${proteins.flatMap((protein) => protein.annotation?.pathways?.items ?? []).length} reported. ` +
    "No pathway was inferred."
  ].join("\n"));
  push(SECTION_TITLES[8], [
    summarizeAnnotation(proteins[0]?.annotation ?? null),
    "Evidence limits: signatures are database evidence, not proof of biochemical function. " +
    "Integrated entries and member signatures are distinct; overlapping matches are retained rather than merged.",
    ...(result?.validation?.warnings ?? [])
  ].join("\n"));
  push(SECTION_TITLES[9], [
    `Run id: ${result?.run_id ?? "not reported"}. Plan: ${result?.plan_id ?? "not reported"}.`,
    `Input checksum (SHA-256): ${result?.input_sha256 ?? "not reported"}.`,
    `Provider job id: ${result?.provider_job_id ?? "none for this route"}.`,
    "Downloads in the protein page: original FASTA, structured provider JSON, TSV, GFF3 (where coordinates are present), this report and a machine-readable summary."
  ].join("\n"));
  const text = sections.map((section) => `${section.title}\n${section.body}`).join("\n\n");
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Protein annotation report</title>` +
    `<style>body{font:16px/1.5 system-ui,sans-serif;max-width:820px;margin:2rem auto;padding:0 1rem;color:#16232a}` +
    `h1{font-size:1.6rem}h2{font-size:1.1rem;margin-top:2rem}pre{white-space:pre-wrap}</style></head><body>` +
    `<h1>Protein functional annotation report</h1>` +
    sections.map((section) => `<section><h2>${htmlEscape(section.title)}</h2><pre>${htmlEscape(section.body)}</pre></section>`).join("") +
    `</body></html>`;
  return { sections, text, html };
}

export function buildArtifacts(result) {
  const report = buildProteinReport(result);
  const gff = buildGff3(result);
  const providerJson = JSON.stringify({
    route_label: result?.route_label ?? null,
    requested_route: result?.requested_route ?? null,
    proteins: (result?.proteins ?? []).map((protein) => ({
      id: protein.id, md5: protein.md5, status: protein.status, reason: protein.reason ?? null,
      route_label: protein.route_label ?? null, raw_provider_response: protein.raw_provider_response ?? null
    })),
    releases: result?.releases ?? null
  }, null, 2);
  const summary = JSON.stringify({
    run_id: result?.run_id ?? null,
    workflow_type: "protein",
    evidence_only: true,
    input: result?.input ?? null,
    route_label: result?.route_label ?? null,
    releases: result?.releases ?? null,
    validation: result?.validation ?? null,
    proteins: (result?.proteins ?? []).map((protein) => ({
      id: protein.id, md5: protein.md5, length: protein.length,
      counts: protein.annotation?.counts ?? null,
      coverage: protein.annotation?.coverage ?? null,
      entries: protein.annotation?.entries?.map((entry) => entry.accession) ?? [],
      go: protein.annotation?.go?.terms ?? []
    })),
    gff3_skipped_locations: gff.skipped_locations
  }, null, 2);
  const annotationJson = JSON.stringify({
    run_id: result?.run_id ?? null,
    route_label: result?.route_label ?? null,
    proteins: (result?.proteins ?? []).map((protein) => ({ ...protein, raw_provider_response: undefined }))
  }, null, 2);
  // The original input text is the genuine FASTA/sequence the Worker received;
  // it is stored verbatim, never rebuilt from identifiers.
  const fasta = typeof result?.input?.fasta_text === "string" ? result.input.fasta_text : "";
  return [
    { name: "input.fasta", kind: "protein_input_fasta", mime: "text/plain;charset=utf-8", content: fasta },
    { name: "annotation.json", kind: "protein_annotation_json", mime: "application/json;charset=utf-8", content: annotationJson },
    { name: "provider.json", kind: "protein_provider_json", mime: "application/json;charset=utf-8", content: providerJson },
    { name: "annotations.tsv", kind: "protein_annotations_tsv", mime: "text/tab-separated-values;charset=utf-8", content: buildTsv(result) },
    { name: "annotations.gff3", kind: "protein_annotations_gff3", mime: "text/plain;charset=utf-8", content: gff.text },
    { name: "report.txt", kind: "protein_report", mime: "text/plain;charset=utf-8", content: report.text },
    { name: "summary.json", kind: "protein_summary", mime: "application/json;charset=utf-8", content: summary }
  ];
}

/**
 * Persist a completed or queued protein run. Returns the stored artifact
 * descriptors (with genuine SHA-256 checksums) and report.
 */
export async function persistProteinRun(db, {
  runId, planId, md5Key, route, providerJobId = null, result, now = Date.now(), idFactory
}) {
  const createdAt = nowIso(now);
  const pending = result?.status === "running";
  // A queued executed job has no result yet: write the job reference only.
  // No empty artifact or report file is created before real evidence exists.
  const artifacts = pending ? [] : buildArtifacts(result);
  const descriptors = [];
  for (const artifact of artifacts) {
    const checksum = await hashInput(artifact.content);
    const bytes = new TextEncoder().encode(artifact.content).length;
    await insertRow(db, SQL.insertArtifact, [makeId("art", idFactory), runId, artifact.name, artifact.kind,
      `protein:${runId}:${artifact.name}`, checksum, bytes, artifact.mime, artifact.content, createdAt]);
    descriptors.push({ name: artifact.name, kind: artifact.kind, mime: artifact.mime, sha256: checksum, bytes });
  }
  const report = pending ? null : buildProteinReport(result);
  if (report) {
    await insertRow(db, SQL.insertReportRun, [makeId("rpt", idFactory), planId, runId,
      `protein:report:${runId}`, null, null, report.html, createdAt]);
  }
  // The run itself is an AI job row keyed by its public id, so the existing
  // /api/ai/runs/:id, /recovery and /report endpoints work unchanged.
  await insertRow(db, SQL.insertJob, [runId, planId, "protein_run", result?.status ?? "unknown",
    "protein.run", JSON.stringify({ route: result?.requested_route ?? null, md5: md5Key }),
    JSON.stringify({ dataset_id: `ds:${runId}`, md5: md5Key }),
    JSON.stringify({ granted: false, scope: null }), "protein-worker", "protein-worker", 1, 120,
    envExecutionMode(result), createdAt, createdAt, pending ? null : createdAt]);
  for (const [index, [stepId, toolId]] of PROTEIN_STEPS.entries()) {
    const status = result?.status === "running" && stepId === "protein_annotate" ? "running"
      : stepId === "protein_validate" && result?.validation?.status === "fail" ? "failed" : "succeeded";
    const detail = stepId === "protein_annotate"
      ? { provider_job_id: providerJobId, route_label: result?.route_label ?? null,
        result_json: result?.status === "running" ? null : result }
      : stepId === "protein_report" ? { report_endpoint: `/api/ai/runs/${runId}/report` }
        : { step: stepId };
    await insertRow(db, SQL.insertJob, [makeId("job", idFactory), planId, stepId, status, toolId,
      JSON.stringify(detail), JSON.stringify({ dataset_id: `ds:${runId}`, md5: md5Key }),
      JSON.stringify({ granted: false, scope: null }), "protein-worker", "protein-worker", 1, 120,
      envExecutionMode(result), createdAt, createdAt, status === "running" ? null : createdAt]);
  }
  await insertRow(db, SQL.insertProteinRun, [runId, md5Key, route, providerJobId,
    result?.status ?? "unknown", result?.status === "running" ? null : JSON.stringify(result),
    createdAt, result?.status === "running" ? null : createdAt]);
  await audit(db, { actor: "protein-worker", action: "protein_workflow_persisted", target: runId,
    detail: { md5: md5Key, route, provider_job_id: providerJobId, status: result?.status ?? null },
    timestamp: createdAt, idFactory });
  return { artifacts: descriptors, report, created_at: createdAt };
}

export async function finalizeProteinRun(db, { runId, providerJobId, result, now = Date.now(), idFactory }) {
  const finishedAt = nowIso(now);
  const stored = JSON.stringify(result);
  // Derive the persisted state from the ACTUAL result, never from the fact
  // that the dispatcher reached a terminal state. An ERROR/FAILURE job or a
  // failed result stays failed in the AI job row and in the protein run row.
  const finalState = result?.status === "failed" ? "failed" : "succeeded";
  // Conditional update: only the still-running job row is finalised.
  await runStatement(db, SQL.saveJobResult, [finalState, finishedAt, stored, JSON.stringify(result?.validation ?? {}),
    null, JSON.stringify(result?.provenance ?? []), null, envExecutionMode(result), runId, "running"]);
  await runStatement(db, SQL.updateProteinRun, [finalState, providerJobId, stored, finishedAt, runId]);
  const runJob = await getRow(db, SQL.getJob, [runId]);
  if (runJob?.plan_id) {
    await runStatement(db, SQL.updateJobByPlanStep, [finalState, finishedAt, runJob.plan_id, "protein_annotate"]);
    await runStatement(db, SQL.updateJobByPlanStep, [
      finalState === "failed" ? "skipped_due_to_failure" : "succeeded",
      finishedAt, runJob.plan_id, "protein_report"
    ]);
  }
  // A failed job has no genuine result: record its honest state only. No
  // empty FASTA/annotation artifact or success report is fabricated.
  const artifacts = result?.status === "failed" ? [] : buildArtifacts(result);
  for (const artifact of artifacts) {
    const checksum = await hashInput(artifact.content);
    await insertRow(db, SQL.insertArtifact, [makeId("art", idFactory), runId,
      artifact.name, artifact.kind, `protein:${runId}:${artifact.name}`, checksum,
      new TextEncoder().encode(artifact.content).length, artifact.mime, artifact.content, finishedAt]);
  }
  const report = result?.status === "failed" ? null : buildProteinReport(result);
  if (report) {
    await insertRow(db, SQL.insertReportRun, [makeId("rpt", idFactory),
      result?.plan_id ?? null, runId, `protein:report:${runId}`, null, null, report.html, finishedAt]);
  }
  return { artifacts, report, finished_at: finishedAt };
}

export function readStoredResult(row) {
  const parsed = parseJson(row?.result_json);
  return parsed && typeof parsed === "object" ? parsed : null;
}
