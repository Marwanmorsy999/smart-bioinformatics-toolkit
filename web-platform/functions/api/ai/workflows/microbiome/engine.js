// M7.14 first real multi-sample 16S microbiome workflow (server engine).
//
// Plan -> Run -> Status -> Result. The Worker NEVER submits a second workflow
// for the same input pair: an input/metadata hash index plus per-step provider
// job ids make every stage refresh-safe. Each status request performs at most
// one bounded provider poll and one stage transition; no request holds a long
// polling loop. All external calls go through the existing Galaxy adapter.
//
// Tool ids, versions, classifier options and parameter names are discovered
// from the LIVE instance and cached in the stored run state. No identifier,
// release or statistic is invented. No live job is submitted by this module's
// tests (all fetch calls are stubbed there).

import {
  SQL, audit, envExecutionMode, errorResponse, getDb, getRow, hashInput,
  insertRow, jsonResponse, listRows, makeId, nowIso, parseJson, readJsonBody,
  requireMethod, runStatement, safeString, sanitizeFilename
} from "../../_lib.js";
import { createAdapter } from "../../../../../providers/galaxy/index.js";
import {
  discoverClassifierOptions, findMicrobiomeTools
} from "../../../../../providers/galaxy/galaxy_microbiome.js";
import { fetchToolSchema } from "../../../../../providers/galaxy/galaxy_schema.js";
import { classifyJobState } from "../../../../../providers/galaxy/galaxy_ids.js";
import {
  buildMicrobiomePayload, describeLiveParameters
} from "./schema.js";
import {
  aggregateByRank, chooseTruncation, computeAlphaFromTable, computeBrayCurtis,
  computePcoa, ordinationEvidence, parseAlphaDiversity, parseDenoisingStats,
  parseDistanceMatrix, parseFastq, parseFeatureTable, parseMetadataTsv,
  parsePcoa, parseQcSummary, parseRepSeqsFasta, parseTaxonomyTsv, rawQcSummary,
  validateFeatureTableIntegrity, validateSampleCorrespondence
} from "./parsers.js";
import { PUBLIC_DATASETS } from "../../../../../public/js/microbiome-zip.js";
import { resolvePublicDataset } from "./public-data.js";

export const STEP_IDS = Object.freeze([
  "import_reads", "demux", "qc_summary", "dada2_denoise", "taxonomy",
  "composition", "alpha_diversity", "beta_diversity", "pcoa", "ordination", "report"
]);

const STEP_TOOL_IDS = Object.freeze({
  import_reads: "microbiome.import", demux: null, qc_summary: null,
  dada2_denoise: null, taxonomy: null, composition: "microbiome.composition",
  alpha_diversity: null, beta_diversity: null, pcoa: null,
  ordination: "microbiome.ordination", report: "microbiome.report"
});

export const LIMITS = Object.freeze({
  maxUploadChecks: 12, uploadCheckMs: 700, pollAfterMs: 1600, maxProviderPolls: 120,
  // Bounded plan-time observation. This is NOT a read count or a QC result.
  publicSampleBytes: 200 * 1024,
  // Full local FASTQ parsing is only safe for small user uploads; larger ones
  // defer all QC/count claims to genuine Galaxy artifacts.
  maxLocalReads: 100_000
});

function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
function ctxFor(env, options = {}) {
  return { fetch: options.fetchImpl ?? env?.FETCH_IMPL ?? globalThis.fetch };
}

// -------------------------------------------------------------- input bytes

async function resolveInputs(payload, ctx, { sampleBytes = 0 } = {}) {
  const key = safeString(payload?.public_dataset, 80);
  if (key) {
    const dataset = PUBLIC_DATASETS[key];
    if (!dataset) throw Object.assign(new Error(`unknown public_dataset: ${key}`), { code: "unknown_public_dataset", status: 400 });
    // Verify all three checksums; keep the original gzip bytes for upload;
    // optionally decode only a bounded prefix for the plan rationale.
    return resolvePublicDataset({ ...dataset, key }, ctx.fetch, { sampleBytes });
  }
  const readsText = String(payload?.reads_text ?? "");
  const barcodesText = String(payload?.barcodes_text ?? "");
  const metadataText = String(payload?.metadata_text ?? "");
  if (!readsText.trim() || !barcodesText.trim() || !metadataText.trim()) {
    throw Object.assign(new Error("Provide reads FASTQ, barcode FASTQ and sample metadata TSV, or select the documented public dataset."),
      { code: "missing_inputs", status: 400 });
  }
  return {
    mode: "upload", source: { urls: null, checksums: null, expected: null, rationale: null },
    reads_text: readsText, barcodes_text: barcodesText, metadata_text: metadataText,
    reads_filename: sanitizeFilename(payload?.reads_filename ?? "sequences.fastq") || "sequences.fastq",
    barcodes_filename: sanitizeFilename(payload?.barcodes_filename ?? "barcodes.fastq") || "barcodes.fastq",
    metadata_filename: sanitizeFilename(payload?.metadata_filename ?? "sample-metadata.tsv") || "sample-metadata.tsv"
  };
}

// Keep local parsing bounded. A prefix is cut at a complete 4-line FASTQ record
// so a cap never manufactures a malformed record.
function capLocalFastq(text, label) {
  if (typeof text !== "string" || !text) return { text: "", capped: false, label };
  const maxChars = LIMITS.maxLocalReads * 400;
  if (text.length <= maxChars) return { text, capped: false, label };
  const prefix = text.slice(0, maxChars);
  const lastNewline = prefix.lastIndexOf("\n");
  const lines = prefix.slice(0, lastNewline > 0 ? lastNewline : prefix.length).split("\n");
  const complete = lines.length - (lines.length % 4);
  return { text: lines.slice(0, complete).join("\n"), capped: true, label,
    reason: `${label} exceeds the ${LIMITS.maxLocalReads}-read local parse cap; QC and counts are deferred to Galaxy artifacts.` };
}

// Informational ONLY. Raw EMP barcode reads routinely carry sequencing errors
// that QIIME 2 demux emp-single corrects with Golay decoding, so an inexact
// match is never a hard validation failure. Final sample assignment comes from
// genuine Galaxy demultiplexing artifacts.
function sampledCorrespondence(metadata, reads, barcodes, sample) {
  const metadataBarcodes = new Set(metadata.samples
    .map((item) => item.barcode_sequence).filter(Boolean));
  const unknown = [...new Set(barcodes.records
    .map((record) => record.sequence).filter((value) => value && !metadataBarcodes.has(value)))];
  return {
    valid: metadata.valid && reads.valid && barcodes.valid,
    basis: "bounded_sample_barcodes_observation",
    sampled_reads: reads.record_count, sampled_barcodes: barcodes.record_count,
    sample_size_bytes: sample?.sample_size_bytes ?? null,
    unknown_sampled_barcodes: unknown, missing_samples: [],
    note: `${unknown.length} sampled raw barcode(s) have no exact metadata match; EMP Golay correction and ` +
      "demultiplexing in Galaxy determine final sample assignment. Full correspondence and read counts " +
      "are verified only from Galaxy demux/QC artifacts."
  };
}

// A bounded byte prefix can cut a FASTQ record in half; only parse complete
// four-line records so the sample never manufactures a validation error.
function completeFastqPrefix(text) {
  const lines = String(text ?? "").split("\n");
  const complete = lines.length - (lines.length % 4);
  return complete > 0 ? lines.slice(0, complete).join("\n") : "";
}

function inspectSampledInputs(resolved) {
  const sample = resolved.observed_sample;
  if (!sample) throw Object.assign(new Error("No bounded FASTQ sample was available for plan review."),
    { code: "sample_unavailable", status: 502 });
  const reads = parseFastq(completeFastqPrefix(sample.reads.text), { label: "sequences.fastq (bounded sample)" });
  const barcodes = parseFastq(completeFastqPrefix(sample.barcodes.text), { label: "barcodes.fastq (bounded sample)" });
  const metadata = parseMetadataTsv(resolved.metadata_text);
  const correspondence = sampledCorrespondence(metadata, reads, barcodes, sample);
  const truncation = chooseTruncation(reads.quality_by_position, { maxLength: reads.max_length });
  return {
    sampled: true, reads, barcodes, metadata, correspondence, truncation, rawQc: null,
    sample: { reads: reads.record_count, barcodes: barcodes.record_count,
      bytes_reads: sample.reads.bytes, bytes_barcodes: sample.barcodes.bytes,
      sample_size_bytes: sample.sample_size_bytes, truncated: sample.reads.truncated,
      basis: sample.basis, note: sample.note }
  };
}

export function inspectInputs(resolved) {
  if (resolved.mode === "public") return inspectSampledInputs(resolved);
  const cappedReads = capLocalFastq(resolved.reads_text, "Reads FASTQ");
  const cappedBarcodes = capLocalFastq(resolved.barcodes_text, "Barcode FASTQ");
  const reads = parseFastq(cappedReads.text, { label: "sequences.fastq" });
  const barcodes = parseFastq(cappedBarcodes.text, { label: "barcodes.fastq" });
  const metadata = parseMetadataTsv(resolved.metadata_text);
  const sampled = cappedReads.capped || cappedBarcodes.capped;
  const correspondence = sampled
    ? sampledCorrespondence(metadata, reads, barcodes,
      { sample_size_bytes: Math.max(cappedReads.text.length, cappedBarcodes.text.length) })
    : validateSampleCorrespondence(metadata, reads, barcodes);
  const truncation = chooseTruncation(reads.quality_by_position, { maxLength: reads.max_length });
  return {
    sampled, reads, barcodes, metadata, correspondence, truncation,
    rawQc: sampled ? null : rawQcSummary(reads, barcodes),
    sample: sampled ? { reads: reads.record_count, barcodes: barcodes.record_count,
      basis: "bounded_local_upload_prefix", note: "Full QC and counts are deferred to Galaxy artifacts." } : null
  };
}

export function validationOf(inspection) {
  const sampled = Boolean(inspection.sample);
  // Sampled barcode mismatches are informational, never a pass/fail gate: raw
  // EMP barcodes may be error-bearing until Galaxy's Golay correction runs.
  const correspondenceErrors = sampled ? [] : (inspection.correspondence.valid
    ? [] : [inspection.correspondence.reason ?? "sample correspondence failed"]);
  const errors = [
    ...(!inspection.reads.valid ? inspection.reads.errors : []),
    ...(!inspection.barcodes.valid ? inspection.barcodes.errors : []),
    ...(inspection.metadata.errors ?? []),
    ...correspondenceErrors
  ].filter(Boolean);
  const warnings = [];
  if (sampled) {
    warnings.push("Plan-time values come from a bounded sample; full read counts, QC and diversity are reported only from retrieved Galaxy artifacts.");
    const unknown = inspection.correspondence?.unknown_sampled_barcodes ?? [];
    if (unknown.length) {
      warnings.push(`${unknown.length} sampled raw barcode(s) have no exact metadata match; ` +
        "EMP Golay correction and demultiplexing in Galaxy determine final sample assignment.");
    }
  } else if (inspection.correspondence.barcode_count_matches_reads === false) {
    warnings.push("Barcode and sequence FASTQ record counts differ; demultiplexing may fail.");
  }
  return {
    status: errors.length ? "fail" : "pass",
    checked_rules: sampled
      ? ["metadata_unique_samples", "barcode_column_present", "sampled_fastq_structure",
        "sampled_barcode_observation_informational"]
      : ["fastq_record_structure", "sequence_quality_length", "unique_sample_ids",
        "barcode_column_present", "metadata_to_reads_correspondence", "barcode_read_count"],
    reads: sampled ? null : inspection.reads.record_count,
    barcodes: sampled ? null : inspection.barcodes.record_count,
    sampled_reads: sampled ? inspection.reads.record_count : null,
    sample_size_bytes: sampled ? inspection.sample.sample_size_bytes ?? null : null,
    samples: inspection.metadata.samples.length,
    missing_samples: inspection.correspondence.missing_samples,
    duplicate_samples: inspection.correspondence.duplicate_metadata_samples,
    invalid_metadata_rows: inspection.correspondence.invalid_metadata_rows,
    errors, warnings
  };
}

// -------------------------------------------------------------- discovery

async function discover(env, ctx) {
  const capabilities = await createAdapter(env).getCapabilities(ctx);
  const tools = findMicrobiomeTools(capabilities.tools ?? []);
  const discoveredAt = capabilities.at ?? nowIso();
  const toolVersions = {};
  for (const [role, tool] of Object.entries(tools)) {
    toolVersions[role] = tool ? { id: tool.id, name: tool.name, version: tool.version ?? null } : null;
  }
  let classifier = { available: false,
    reason: "No taxonomy classifier tool is available on this Galaxy instance; no classifier was invented.",
    tool_id: null, version: null };
  if (tools.classify) {
    try {
      const schema = await fetchToolSchema(env, tools.classify.id, tools.classify.version);
      classifier = discoverClassifierOptions(schema, { toolId: tools.classify.id, version: tools.classify.version });
    } catch (error) {
      classifier = { available: false, tool_id: tools.classify.id, version: tools.classify.version,
        reason: `The live classifier tool schema could not be read: ${error?.message ?? error}` };
    }
  }
  return { tools, toolVersions, classifier, discoveryMode: capabilities.discovery_mode ?? "unavailable", discoveredAt };
}

function stepToolFor(stepId, discovery) {
  switch (stepId) {
    case "demux": return discovery.tools.demux;
    case "qc_summary": return discovery.tools.qc;
    case "dada2_denoise": return discovery.tools.denoise;
    case "taxonomy": return discovery.tools.classify;
    case "alpha_diversity": return discovery.tools.alpha;
    case "beta_diversity": return discovery.tools.beta;
    case "pcoa": return discovery.tools.pcoa;
    default: return null;
  }
}

function overridesFor(stepId, schema, state, discovery) {
  const overrides = {};
  if (!schema) return overrides;
  const names = describeLiveParameters(schema).map((entry) => entry.name);
  const find = (pattern) => names.find((name) => pattern.test(name)) ?? null;
  if (stepId === "dada2_denoise") {
    const trim = find(/(?:^|\|)trim[_-]?left$/i);
    const trunc = find(/(?:^|\|)trunc[_-]?len(?:gth)?$/i);
    if (trim) overrides[trim] = state.params.trim_left;
    if (trunc) overrides[trunc] = state.params.trunc_len;
  }
  if (stepId === "taxonomy" && discovery.classifier?.available && discovery.classifier.parameter_name
      && discovery.classifier.option_value) {
    overrides[discovery.classifier.parameter_name] = discovery.classifier.option_value;
  }
  if (stepId === "beta_diversity") {
    const metric = find(/(?:^|\|)(?:metric|distance_method|distance)$/i);
    if (metric) overrides[metric] = "bray_curtis";
  }
  return overrides;
}

function rolesFor(stepId, state) {
  switch (stepId) {
    case "demux": return [
      { id: state.dataset_ids.sequences, role: "reads", name: state.filenames.reads },
      { id: state.dataset_ids.barcodes, role: "barcodes", name: state.filenames.barcodes },
      { id: state.dataset_ids.metadata, role: "table", name: state.filenames.metadata }
    ];
    case "qc_summary": return [{ id: state.frontier?.demuxReadsId ?? state.dataset_ids.sequences, role: "reads", name: "demultiplexed reads" }];
    case "dada2_denoise": return [{ id: state.frontier?.demuxReadsId ?? state.dataset_ids.sequences, role: "reads", name: "demultiplexed reads" }];
    case "taxonomy": return [{ id: state.frontier?.repSeqsId, role: "fasta", name: "representative sequences" }];
    case "alpha_diversity": return [{ id: state.frontier?.featureTableId, role: "table", name: "feature table" }];
    case "beta_diversity": return [{ id: state.frontier?.featureTableId, role: "table", name: "feature table" }];
    case "pcoa": return [{ id: state.frontier?.distanceMatrixId ?? state.frontier?.featureTableId, role: "table", name: "distance matrix" }];
    default: return [];
  }
}

// ------------------------------------------------------------- artifacts

export function classifyMicrobiomeArtifact(artifact = {}) {
  const name = String(artifact.name ?? "");
  const declared = String(artifact.type ?? artifact.extension ?? artifact.file_ext ?? "").replace(/^\./, "").toLowerCase();
  const fromName = name.includes(".") ? name.slice(name.lastIndexOf(".") + 1).toLowerCase() : "";
  const ext = declared || fromName;
  const lowered = name.toLowerCase();
  if (["qzv", "html"].includes(ext)) return { kind: "visualization", reason: `extension:${ext}` };
  if (["fastq", "fq"].includes(ext) || /\.fastq\.gz$/i.test(lowered)) return { kind: "reads", reason: `extension:${ext}` };
  if (ext === "qza") return { kind: "qza_artifact", reason: "extension:qza (binary; text export required)" };
  if (["fasta", "fa", "fna", "fas", "dna"].includes(ext)) return { kind: "rep_seqs", reason: `extension:${ext}` };
  if (/\.nwk$|newick|treefile/.test(lowered)) return { kind: "tree", reason: "name:newick" };
  if (/(distance|bray|jaccard|unifrac)/i.test(name)) return { kind: "distance_matrix", reason: "name:distance" };
  if (/(ordination|pcoa|emperor|coordinates)/i.test(name)) return { kind: "pcoa", reason: "name:ordination" };
  if (/(alpha|shannon|observed|richness|faith)/i.test(name)) return { kind: "alpha", reason: "name:alpha" };
  if (/(taxonomy|classif|silva|greengenes)/i.test(name)) return { kind: "taxonomy", reason: "name:taxonomy" };
  if (/(stats|summary|quality|fastp|fastq)/i.test(name)) return { kind: "qc", reason: "name:qc" };
  if (/(feature.?table|biom|table)/i.test(name) || ["biom", "tsv", "txt", "tabular"].includes(ext)) {
    return { kind: "feature_table", reason: "name_or_extension:table" };
  }
  if (ext === "log") return { kind: "log", reason: "extension:log" };
  return { kind: "other", reason: "unclassified" };
}

async function collectOutputs(adapter, jobId, historyId, ctx) {
  const status = await adapter.getJobStatus({ job_id: jobId }, ctx);
  const outputs = await adapter.getJobOutputs({ job_id: jobId }, ctx);
  const associations = [...(outputs.outputs ?? []), ...(status.output?.structured?.output_associations ?? [])];
  const contents = await adapter.getArtifacts({ history_id: historyId }, ctx);
  const byId = new Map((contents.artifacts ?? []).map((artifact) => [String(artifact.id), artifact]));
  const byUuid = new Map((contents.artifacts ?? []).filter((artifact) => artifact.uuid)
    .map((artifact) => [String(artifact.uuid), artifact]));
  const selected = [];
  const seen = new Set();
  for (const association of associations) {
    const id = String(association.galaxyHdaId ?? association.id ?? "");
    const uuid = String(association.galaxyDatasetUuid ?? association.uuid ?? "");
    const match = (id && byId.get(id)) || (uuid && byUuid.get(uuid)) || null;
    if (!match || seen.has(String(match.id)) || match.deleted === true) continue;
    if (!["ok", "success"].includes(String(match.state ?? "").toLowerCase())) continue;
    if (association.history_id && match.history_id && String(association.history_id) !== String(match.history_id)) continue;
    seen.add(String(match.id));
    selected.push({ ...match, ...classifyMicrobiomeArtifact(match),
      source_step: null, source_job_id: jobId });
  }
  return { selected, associations, historyContents: contents.artifacts ?? [], status, outputs };
}

async function downloadSelected(adapter, artifacts, stepId, ctx, { toolVersion = null } = {}) {
  const out = [];
  const errors = [];
  for (const artifact of artifacts) {
    const downloaded = await adapter.downloadArtifact({ dataset_id: artifact.id }, ctx);
    if (!downloaded.ok || typeof downloaded.content !== "string") {
      errors.push({ dataset_id: artifact.id, name: artifact.name, reason: "content_unavailable" });
      continue;
    }
    const checksum = await hashInput(downloaded.content);
    out.push({ ...artifact, source_step: stepId, tool_version: toolVersion, text: downloaded.content,
      checksum, bytes: new TextEncoder().encode(downloaded.content).length });
  }
  return { artifacts: out, errors };
}

function parseForKind(kind, text, options = {}) {
  switch (kind) {
    case "qc": return parseQcSummary(text);
    case "rep_seqs": return parseRepSeqsFasta(text);
    case "feature_table": return parseFeatureTable(text);
    case "taxonomy": return parseTaxonomyTsv(text);
    case "alpha": return parseAlphaDiversity(text, options);
    case "distance_matrix": return parseDistanceMatrix(text);
    case "pcoa": return parsePcoa(text);
    default: return { available: false, reason: `Artifact kind ${kind} has no text parser in this workflow.` };
  }
}

function bestParsed(artifacts, kind, options) {
  for (const artifact of artifacts) {
    if (artifact.kind !== kind || typeof artifact.text !== "string") continue;
    const parsed = parseForKind(kind, artifact.text, options);
    if (parsed.available) return { parsed, artifact };
  }
  return {
    parsed: { available: false, reason: `No parseable ${kind} artifact was retrieved from the tool output.` },
    artifact: null
  };
}

// When no tool QC artifact was retrieved, a SMALL user upload may still expose
// genuine per-read statistics computed locally. A public dataset (or a large
// upload) never does: its plan-time prefix is not a QC result and all counts
// must come from Galaxy/QIIME 2 artifacts.
export function observedQc(state) {
  if (state.input?.mode === "public" || state.qc?.basis === "bounded_first_bytes_sample") {
    return { available: false, samples: [],
      reason: "No tool QC artifact was retrieved. Bounded plan-time sample values are not QC results; counts and quality come only from Galaxy artifacts." };
  }
  const raw = state.qc?.raw;
  if (!raw?.reads) {
    return { available: false, samples: [],
      reason: "No tool QC artifact and no complete local FASTQ parse were available; no QC is claimed." };
  }
  return {
    ...raw, available: true, samples: [], basis: "worker_computed_from_uploaded_fastq",
    reason: "No tool QC artifact was retrieved; only raw uploaded-read QC from a small upload is reported."
  };
}

// --------------------------------------------------------------- D1 state

async function getRunByReference(db, request) {
  const url = new URL(request.url);
  const runId = safeString(url.searchParams.get("run_id"), 100);
  const jobId = safeString(url.searchParams.get("job_id"), 100);
  if (runId) return getRow(db, SQL.getMicrobiomeRunByPublicId, [runId]);
  if (jobId) return getRow(db, SQL.getMicrobiomeRunByPublicId, [jobId]);
  return null;
}

function errorBody(error, request, fallback = 502) {
  const status = error?.status && error.status >= 400 && error.status < 600 ? error.status : fallback;
  return errorResponse(error?.message ?? String(error), status, request);
}

async function persistState(db, row, state, result = null) {
  // Parsed tables are rebuildable from the original stored artifacts; keeping
  // them out of state_json avoids a oversized D1 row on large feature tables.
  const persisted = { ...state };
  delete persisted._parsed;
  await runStatement(db, SQL.updateMicrobiomeRun, [
    state.status, JSON.stringify(persisted), result ? JSON.stringify(result) : null,
    state.status === "succeeded" || state.status === "failed" ? nowIso() : null, row.public_id
  ]);
}

async function recordStep(db, state, stepId, status, { providerJobId = null, details = {} } = {}) {
  const existing = (await listRows(db, SQL.listJobsForPlan, [state.plan_id]))
    .find((job) => job.step_id === stepId);
  const jobId = existing?.public_id ?? makeId("job");
  if (!existing) {
    await insertRow(db, SQL.insertJob, [jobId, state.plan_id, stepId, status,
      STEP_TOOL_IDS[stepId] ?? "galaxy:tool", JSON.stringify({ ...details, provider_job_id: providerJobId }),
      JSON.stringify({ dataset_id: state.dataset_id }), JSON.stringify({}), "galaxy", "microbiome-worker", 1, 120,
      envExecutionMode(state.env ?? {}), state.created_at, nowIso(), null]);
  } else if ((status === "succeeded" || status === "failed") && stepId !== "report") {
    // Finalise through saveJobResult so the genuine provider job id is stored
    // in result_json and is therefore visible to /api/ai/runs/:id/recovery.
    await runStatement(db, SQL.saveJobResult, [status, nowIso(),
      JSON.stringify({ provider_job_id: providerJobId, step_id: stepId, ...details }),
      JSON.stringify({ status, step_id: stepId }), null, null, null,
      envExecutionMode({}), jobId, "running"]);
  }
  state.steps[stepId] = { ...(state.steps[stepId] ?? {}), status, provider_job_id: providerJobId ?? state.steps[stepId]?.provider_job_id ?? null,
    ...details };
  return jobId;
}

// ------------------------------------------------------------------- /plan

export async function handlePlan(request, env, options = {}) {
  const rejected = requireMethod(request, "POST", "POST, OPTIONS");
  if (rejected) return rejected;
  const { payload, error } = await readJsonBody(request);
  if (error) return errorResponse(error, 400, request);
  const ctx = ctxFor(env, options);
  let resolved;
  let inspection;
  try {
    resolved = await resolveInputs(payload, ctx, { sampleBytes: LIMITS.publicSampleBytes });
    inspection = inspectInputs(resolved);
  } catch (caught) {
    return errorBody(caught, request);
  }
  const validation = validationOf(inspection);
  if (validation.status !== "pass") {
    return jsonResponse({ workflow_type: "microbiome", validation, execution_mode: envExecutionMode(env),
      error: "Input validation failed; no plan was proposed.", source: resolved.source }, 400, request);
  }
  let discovery;
  try {
    discovery = await discover(env, ctx);
  } catch (caught) {
    return errorBody(caught, request);
  }
  const steps = STEP_IDS.map((id, index) => ({
    id, order: index + 1,
    tool_id: stepToolFor(id, discovery)?.id ?? STEP_TOOL_IDS[id],
    tool_version: stepToolFor(id, discovery)?.version ?? null,
    status: stepToolFor(id, discovery) || id === "import_reads" ? "available" : "worker_derived"
  }));
  return jsonResponse({
    workflow_type: "microbiome",
    plan: { steps, discovery_mode: discovery.discoveryMode, discovered_at: discovery.discoveredAt,
      tool_versions: discovery.toolVersions,
      submission_policy: "One dependent workflow per input pair; every stage is keyed by a stored provider job id and is never resubmitted on refresh." },
    input: { mode: resolved.mode, source: resolved.source, reads_filename: resolved.reads_filename,
      barcodes_filename: resolved.barcodes_filename, metadata_filename: resolved.metadata_filename,
      reads: inspection.sampled
        ? { records: null, sampled_reads: inspection.reads.record_count,
          sample_size_bytes: inspection.sample.sample_size_bytes,
          max_length: inspection.reads.max_length, basis: "bounded_first_bytes_sample",
          published_expectation: resolved.source?.expected ?? null,
          expectation_basis: resolved.source?.expectation_basis ?? null }
        : { records: inspection.reads.record_count, total_bases: inspection.reads.total_bases,
          min_length: inspection.reads.min_length, max_length: inspection.reads.max_length },
      barcode_records: inspection.sampled ? null : inspection.barcodes.record_count,
      sampled_barcodes: inspection.sampled ? inspection.barcodes.record_count : null,
      samples: inspection.metadata.sample_ids, sample_count: inspection.metadata.samples.length,
      correspondence: inspection.correspondence },
    qc: inspection.sampled
      ? { sample: inspection.sample, quality_by_position: inspection.truncation.observed,
        basis: "bounded_first_bytes_sample",
        note: "Full read counts, lengths, quality distributions and per-sample QC come only from retrieved Galaxy artifacts." }
      : { raw: inspection.rawQc, quality_by_position: inspection.truncation.observed },
    params: { trim_left: inspection.truncation.trim_left, trunc_len: inspection.truncation.trunc_len,
      trunc_rationale: inspection.truncation.reason, rarefaction_depth: null,
      rarefaction_reason: "No rarefaction depth is asserted before a real feature table is available; it will be derived from the retrieved counts or left null." },
    classifier: discovery.classifier,
    validation,
    limitations: [
      "Plan-time quality values come from a bounded prefix and are labelled as a sample; no full read count is claimed before Galaxy reports it.",
      "Absolute read counts and relative abundances come only from retrieved tool artifacts or real feature-table counts; no synthetic values are generated.",
      "Faith's PD is withheld unless a valid rooted tree artifact is retrieved.",
      "A qza artifact is binary: it must be exported by a genuinely discovered tool before its text can be parsed; otherwise the stage reports an honest reason.",
      "Taxonomy is reported exactly as the discovered classifier option is labelled; no release is guessed."
    ],
    execution_mode: envExecutionMode(env)
  }, 200, request);
}

// ------------------------------------------------------------------- /run

export async function handleRun(request, env, options = {}) {
  const rejected = requireMethod(request, "POST", "POST, OPTIONS");
  if (rejected) return rejected;
  const { payload, error } = await readJsonBody(request);
  if (error) return errorResponse(error, 400, request);
  const db = getDb(env);
  if (!db) return errorResponse("AI database binding is unavailable.", 503, request);
  const ctx = ctxFor(env, options);
  let resolved;
  let inspection;
  try {
    // Only a bounded prefix is decoded; the original gzip bytes are kept for
    // Galaxy upload and no full local FASTQ parse runs in the request path.
    resolved = await resolveInputs(payload, ctx, { sampleBytes: LIMITS.publicSampleBytes });
    inspection = inspectInputs(resolved);
  } catch (caught) {
    return errorBody(caught, request);
  }
  const validation = validationOf(inspection);
  if (validation.status !== "pass") {
    return jsonResponse({ error: "Input validation failed; no workflow was submitted.", validation,
      workflow_type: "microbiome", execution_mode: envExecutionMode(env) }, 400, request);
  }
  // For public sources the verified checksums ARE the input identity; no full
  // FASTQ text exists locally to hash. Small uploads keep the previous hashing.
  const inputSha = resolved.mode === "public"
    ? await hashInput(`${resolved.source.checksums.reads_sha256}:${resolved.source.checksums.barcodes_sha256}`)
    : await hashInput(resolved.reads_text + "\n" + resolved.barcodes_text);
  const metadataSha = resolved.mode === "public"
    ? resolved.source.checksums.metadata_sha256
    : await hashInput(resolved.metadata_text);
  const existing = (await listRows(db, SQL.getMicrobiomeRunsByInput, [inputSha, metadataSha])).at(-1) ?? null;
  if (existing) {
    const storedState = parseJson(existing.state_json) ?? {};
    if (existing.state === "succeeded" || existing.state === "failed") {
      return jsonResponse({ ...(parseJson(existing.result_json) ?? {}), deduped: true,
        dedupe_basis: "stored_microbiome_run_by_input_hash", run_id: existing.public_id,
        status: existing.state, execution_mode: envExecutionMode(env) }, 200, request);
    }
    return jsonResponse({ workflow_type: "microbiome", run_id: existing.public_id, deduped: true,
      dedupe_basis: "stored_microbiome_run_by_input_hash", status: existing.state ?? "running",
      status_url: `/api/ai/workflows/microbiome/status?run_id=${encodeURIComponent(existing.public_id)}`,
      result_url: `/api/ai/workflows/microbiome/result?run_id=${encodeURIComponent(existing.public_id)}`,
      poll_after_ms: LIMITS.pollAfterMs, execution_mode: envExecutionMode(env) }, 202, request);
  }

  let discovery;
  try {
    discovery = await discover(env, ctx);
  } catch (caught) {
    return errorBody(caught, request);
  }
  const now = options.now ?? Date.now();
  const runId = makeId("job", options.idFactory);
  const planId = makeId("plan", options.idFactory);
  const datasetId = makeId("ds", options.idFactory);
  const createdAt = nowIso(now);
  const state = {
    workflow_type: "microbiome", run_id: runId, plan_id: planId, dataset_id: datasetId,
    status: "running", created_at: createdAt, current_step: "import_reads",
    input_sha256: inputSha, metadata_sha256: metadataSha,
    input: { mode: resolved.mode, source: resolved.source, objective: safeString(payload?.objective, 1000) || null,
      filenames: { reads: resolved.reads_filename, barcodes: resolved.barcodes_filename, metadata: resolved.metadata_filename },
      metadata_text: resolved.metadata_text, sample_ids: inspection.metadata.sample_ids,
      sample_count: inspection.metadata.samples.length,
      barcode_column: inspection.metadata.columns.includes("barcode-sequence"),
      observed_sample: inspection.sample, published_expectation: resolved.source?.expected ?? null,
      expectation_basis: resolved.source?.expectation_basis ?? null },
    params: { trim_left: inspection.truncation.trim_left, trunc_len: inspection.truncation.trunc_len,
      trunc_rationale: inspection.truncation.reason, rarefaction_depth: null },
    discovery: { tools: discovery.toolVersions, classifier: discovery.classifier,
      discovery_mode: discovery.discoveryMode, discovered_at: discovery.discoveredAt },
    validation,
    qc: inspection.sampled
      ? { raw: null, observed_quality: inspection.truncation.observed, sample: inspection.sample,
        basis: "bounded_first_bytes_sample" }
      : { raw: inspection.rawQc, observed_quality: inspection.truncation.observed },
    dataset_ids: { sequences: null, barcodes: null, metadata: null },
    filenames: { reads: resolved.reads_filename, barcodes: resolved.barcodes_filename, metadata: resolved.metadata_filename },
    frontier: {}, steps: {}, results: {}, artifacts: [], errors: [], poll_count: 0
  };

  try {
    const readsBytesSize = resolved.mode === "public"
      ? resolved.reads_bytes.length
      : new TextEncoder().encode(resolved.reads_text).length;
    await insertRow(db, SQL.insertDataset, [datasetId, null, resolved.reads_filename, inputSha,
      readsBytesSize, "text/plain", "pending", null, createdAt]);
    await insertRow(db, SQL.insertPlan, [planId, `req:${runId}`, 1, JSON.stringify({
      goal: state.input.objective || "16S amplicon microbiome workflow", workflow_type: "microbiome",
      input: state.input, params: state.params, steps: STEP_IDS.map((id, index) => ({
        id, order: index + 1, tool_id: stepToolFor(id, discovery)?.id ?? STEP_TOOL_IDS[id] ?? null
      }))
    }), createdAt]);
    // The single report job is the AI run id used by /api/ai/runs/:id.
    await insertRow(db, SQL.insertJob, [runId, planId, "report", "running", "microbiome.report",
      JSON.stringify({ provider_job_id: null }), JSON.stringify({ dataset_id: datasetId }),
      JSON.stringify({}), "galaxy", "microbiome-worker", 1, 120, envExecutionMode(env), createdAt, createdAt, null]);
    await insertRow(db, SQL.insertMicrobiomeRun, [runId, inputSha, metadataSha, "running", planId, runId,
      JSON.stringify(state), null, createdAt, null]);
  } catch (caught) {
    return errorResponse(`Could not persist the microbiome workflow plan: ${caught?.message ?? caught}`, 500, request);
  }

  // Upload is the only immediate provider action. It is one dependent workflow
  // input operation, not a submitted analysis job, and is keyed by provider job
  // id so a refresh cannot create a second upload.
  const adapter = createAdapter(env);
  try {
    const readsUpload = resolved.mode === "public"
      ? { filename: resolved.reads_filename, extension: "fastq.gz",
        content: new Blob([resolved.reads_bytes], { type: "application/gzip" }) }
      : { filename: resolved.reads_filename, extension: "fastq", content: resolved.reads_text };
    const barcodesUpload = resolved.mode === "public"
      ? { filename: resolved.barcodes_filename, extension: "fastq.gz",
        content: new Blob([resolved.barcodes_bytes], { type: "application/gzip" }) }
      : { filename: resolved.barcodes_filename, extension: "fastq", content: resolved.barcodes_text };
    const upload = await adapter.submitJob({
      operation: "submit_job", tool_id: "upload1",
      inputs: {
        [resolved.reads_filename]: readsUpload,
        [resolved.barcodes_filename]: barcodesUpload,
        [resolved.metadata_filename]: { filename: resolved.metadata_filename, extension: "tsv", content: resolved.metadata_text }
      }
    }, ctx);
    if (upload.error) throw new Error(`Galaxy upload failed: ${upload.error.message ?? upload.error.code}`);
    state.history_id = upload.output?.structured?.history_id ?? null;
    state.steps.import_reads = { status: "running", provider_job_id: upload.provider_job_id ?? null,
      output_ids: upload.output?.structured?.outputs ?? [], tool_id: "upload1" };
    await recordStep(db, state, "import_reads", "running", { providerJobId: upload.provider_job_id ?? null,
      details: { tool_id: "upload1", history_id: state.history_id } });
  } catch (caught) {
    state.status = "failed";
    state.errors.push(`upload_failed: ${caught?.message ?? caught}`);
    await persistState(db, { public_id: runId }, state);
    await runStatement(db, SQL.saveJobResult, ["failed", nowIso(), JSON.stringify({ error: caught?.message ?? String(caught) }),
      JSON.stringify(validation), null, null, null, envExecutionMode(env), runId, "running"]);
  }
  await persistState(db, { public_id: runId }, state);
  await audit(db, { actor: "microbiome-worker", action: "microbiome_workflow_started", target: runId,
    detail: { plan_id: planId, dataset_id: datasetId, input_sha256: inputSha, samples: state.input.sample_count },
    timestamp: createdAt });

  return jsonResponse({ workflow_type: "microbiome", run_id: runId, plan_id: planId, dataset_id: datasetId,
    status: state.status, history_id: state.history_id,
    validation, source: state.input.source,
    tool_versions: state.discovery.tools, classifier: state.discovery.classifier,
    status_url: `/api/ai/workflows/microbiome/status?run_id=${encodeURIComponent(runId)}`,
    result_url: `/api/ai/workflows/microbiome/result?run_id=${encodeURIComponent(runId)}`,
    recovery_url: `/api/ai/runs/${runId}/recovery`,
    poll_after_ms: LIMITS.pollAfterMs, error: state.errors.at(-1) ?? null,
    deduped: false, execution_mode: envExecutionMode(env) }, state.status === "failed" ? 502 : 202, request);
}

// ----------------------------------------------------------------- /status

async function finalizeImport(adapter, state, ctx) {
  const contents = await adapter.getArtifacts({ history_id: state.history_id }, ctx);
  const wanted = [
    ["sequences", state.filenames.reads], ["barcodes", state.filenames.barcodes], ["metadata", state.filenames.metadata]
  ];
  const resolved = {};
  const stripGz = (value) => String(value ?? "").replace(/\.gz$/i, "");
  for (const [key, filename] of wanted) {
    const artifact = (contents.artifacts ?? []).find((item) => {
      const name = String(item.name ?? "");
      return name === String(filename) || stripGz(name) === stripGz(filename);
    });
    if (artifact?.id) resolved[key] = artifact.id;
  }
  state.dataset_ids = { ...state.dataset_ids, ...resolved };
  return Object.keys(resolved).length === 3;
}

async function submitStage(adapter, env, state, stepId, ctx) {
  // The cached discovery stores metadata, not the full tool object; no new
  // discovery call is made here.
  const cached = state.discovery.tools;
  const roleFor = { demux: "demux", qc_summary: "qc", dada2_denoise: "denoise", taxonomy: "classify",
    alpha_diversity: "alpha", beta_diversity: "beta", pcoa: "pcoa" }[stepId];
  const toolMeta = roleFor ? cached[roleFor] : null;
  if (!toolMeta?.id) {
    state.steps[stepId] = { status: "unavailable", reason: `No discovered tool for ${stepId}; no tool id was invented.` };
    return { skipped: true, reason: state.steps[stepId].reason };
  }
  if (stepId === "taxonomy" && !state.discovery.classifier?.available) {
    state.steps[stepId] = { status: "unavailable", reason: state.discovery.classifier?.reason ?? "No classifier option was available." };
    return { skipped: true, reason: state.steps[stepId].reason };
  }
  const schema = await fetchToolSchema(env, toolMeta.id, toolMeta.version);
  const payload = buildMicrobiomePayload(schema, rolesFor(stepId, state), overridesFor(stepId, schema, state, { classifier: state.discovery.classifier }));
  if (!payload.valid) throw new Error(`${stepId} schema failure: ${payload.errors.join(", ")}`);
  const submission = await adapter.submitJob({ operation: "submit_job", tool_id: toolMeta.id, inputs: payload.inputs }, ctx);
  if (submission.error) throw new Error(`${stepId} submission failed: ${submission.error.message ?? submission.error.code}`);
  state.steps[stepId] = { status: "running", provider_job_id: submission.provider_job_id ?? null,
    tool_id: toolMeta.id, tool_version: toolMeta.version ?? null,
    applied_overrides: payload.applied_overrides, dataset_fields: payload.dataset_fields,
    started_at: nowIso() };
  return { skipped: false, provider_job_id: submission.provider_job_id };
}

async function collectDenoise(state, collected, downloaded) {
  const { parsed: table } = bestParsed(downloaded.artifacts, "feature_table");
  const { parsed: repSeqs } = bestParsed(downloaded.artifacts, "rep_seqs");
  const denoiseStats = bestParsed(downloaded.artifacts, "qc");
  state.frontier.featureTable = table.available ? downloaded.artifacts.find((artifact) => artifact.kind === "feature_table")?.id ?? null : null;
  state.frontier.repSeqsId = repSeqs.available ? downloaded.artifacts.find((artifact) => artifact.kind === "rep_seqs")?.id ?? null : null;
  state.results.asv = {
    available: table.available,
    reason: table.available ? null : "No parseable feature table was retrieved from the denoising job.",
    feature_count: table.available ? table.feature_ids.length : null,
    sample_count: table.available ? table.sample_ids.length : null,
    total_assignable_reads: table.available ? Object.values(table.totals).reduce((sum, value) => sum + value, 0) : null,
    rep_seq_count: repSeqs.available ? repSeqs.records.length : null,
    denoising_stats: denoiseStats.parsed.available ? denoiseStats.parsed : { available: false,
      reason: "No denoising statistics table was retrieved." },
    parameter_rationale: state.params.trunc_rationale
  };
  state._parsed = { ...(state._parsed ?? {}), table, repSeqs };
  return { table, repSeqs };
}

async function finalizeStage(adapter, env, db, row, state, stepId, jobId, ctx) {
  const toolMeta = state.steps[stepId]?.tool_id ? { id: state.steps[stepId].tool_id, version: state.steps[stepId].tool_version } : null;
  let collected = { selected: [], errors: [] };
  let downloaded = { artifacts: [], errors: [] };
  if (jobId) {
    collected = await collectOutputs(adapter, jobId, state.history_id, ctx);
    downloaded = await downloadSelected(adapter, collected.selected, stepId, ctx, { toolVersion: toolMeta?.version ?? null });
  }
  for (const artifact of downloaded.artifacts) {
    await insertRow(db, SQL.insertArtifact, [makeId("art"), runIdOf(state), artifact.name, artifact.kind,
      `galaxy:${artifact.id}`, artifact.checksum, artifact.bytes, "text/plain", artifact.text, nowIso()]);
  }
  state.artifacts.push(...downloaded.artifacts.map((artifact) => ({
    name: artifact.name, kind: artifact.kind, dataset_id: artifact.id, checksum: artifact.checksum,
    bytes: artifact.bytes, source_step: stepId, tool_version: toolMeta?.version ?? null,
    extension: artifact.type ?? null
  })));
  state.errors.push(...downloaded.errors.map((error) => ({ step: stepId, ...error })));
  if (stepId === "demux") {
    const fastq = downloaded.artifacts.find((artifact) => ["reads", "rep_seqs", "feature_table"].includes(artifact.kind));
    state.frontier.demuxReadsId = fastq?.id ?? null;
    const stats = bestParsed(downloaded.artifacts, "qc");
    state.results.qc = stats.parsed.available ? stats.parsed : observedQc(state);
  } else if (stepId === "qc_summary") {
    const stats = bestParsed(downloaded.artifacts, "qc");
    state.results.qc = stats.parsed.available ? stats.parsed : observedQc(state);
  } else if (stepId === "dada2_denoise") {
    await collectDenoise(state, collected, downloaded);
  } else if (stepId === "taxonomy") {
    const taxonomy = bestParsed(downloaded.artifacts, "taxonomy");
    state.results.taxonomy = taxonomy.parsed;
    state._parsed = { ...(state._parsed ?? {}), taxonomy: taxonomy.parsed };
  } else if (stepId === "alpha_diversity") {
    const alpha = bestParsed(downloaded.artifacts, "alpha");
    state.results.alpha = alpha.parsed.available ? alpha.parsed : computeAlphaFromTable(state._parsed?.table);
  } else if (stepId === "beta_diversity") {
    const distance = bestParsed(downloaded.artifacts, "distance_matrix");
    state.results.beta = distance.parsed.available ? distance.parsed : computeBrayCurtis(state._parsed?.table);
    if (distance.artifact) state.frontier.distanceMatrixId = distance.artifact.id;
  } else if (stepId === "pcoa") {
    const pcoa = bestParsed(downloaded.artifacts, "pcoa");
    state.results.pcoa = pcoa.parsed.available ? pcoa.parsed : computePcoa(state.results.beta);
    if (pcoa.artifact) state.frontier.pcoaId = pcoa.artifact.id;
  }
  state.steps[stepId] = { ...(state.steps[stepId] ?? {}), status: "succeeded", finished_at: nowIso(),
    output_artifacts: downloaded.artifacts.map((artifact) => ({ name: artifact.name, kind: artifact.kind,
      dataset_id: artifact.id, checksum: artifact.checksum })) };
  await recordStep(db, state, stepId, "succeeded", { details: state.steps[stepId] });
}

function runIdOf(state) {
  return String(state.run_id ?? "");
}

// Rebuild parseable tables from ORIGINAL stored artifact content on every new
// status request. No table is carried over in browser memory or invented.
async function rehydrateParsed(db, state) {
  if (state._parsed) return;
  const rows = await listRows(db, SQL.listArtifactsForRun, [state.run_id]);
  const parsed = {};
  for (const row of rows) {
    const kind = String(row.kind ?? "");
    const text = String(row.content ?? "");
    if (!text) continue;
    if (kind === "feature_table" && !parsed.table) {
      const value = parseFeatureTable(text);
      if (value.available) parsed.table = value;
    } else if (kind === "rep_seqs" && !parsed.repSeqs) {
      const value = parseRepSeqsFasta(text);
      if (value.available) parsed.repSeqs = value;
    } else if (kind === "taxonomy" && !parsed.taxonomy) {
      const value = parseTaxonomyTsv(text);
      if (value.available) parsed.taxonomy = value;
    }
  }
  state._parsed = parsed;
}

function localStage(state, stepId) {
  if (stepId === "composition") {
    const composition = aggregateByRank(state._parsed?.table, state._parsed?.taxonomy, { rank: "phylum" });
    state.results.composition = composition;
    return composition;
  }
  if (stepId === "alpha_diversity") {
    if (!state.results.alpha?.available) state.results.alpha = computeAlphaFromTable(state._parsed?.table);
    return state.results.alpha;
  }
  if (stepId === "ordination") {
    state.results.ordination = ordinationEvidence(state.artifacts, state.results.pcoa,
      { visualizationTool: state.discovery.tools.pcoa?.id ?? null });
    return state.results.ordination;
  }
  return { available: false, reason: `No local computation is defined for ${stepId}.` };
}

// Deterministic text exports rebuilt ONLY from parsed real values. These are
// labelled as derived-from-artifact exports; the untouched original downloads
// remain in /api/ai/runs/:id/recovery.
export async function buildExports(state, report) {
  const items = [];
  const add = (name, content, source, toolVersion = null) => {
    if (typeof content !== "string" || !content.trim()) return;
    items.push({ name, content, source, tool_version: toolVersion });
  };
  const table = state._parsed?.table;
  const denoiseVersion = state.steps.dada2_denoise?.tool_version ?? null;
  if (table?.available) {
    add("feature-table.tsv", [
      `#OTU ID\t${table.sample_ids.join("\t")}`,
      ...table.feature_ids.map((id) => [id, ...table.sample_ids.map((sample) => table.counts[id]?.[sample] ?? 0)].join("\t"))
    ].join("\n"), "derived_from_retrieved_feature_table", denoiseVersion);
  }
  const repSeqs = state._parsed?.repSeqs;
  if (repSeqs?.available) {
    add("rep-seqs.fasta", repSeqs.records.map((record) => `>${record.header}\n${record.sequence}`).join("\n"),
      "derived_from_retrieved_rep_seqs", denoiseVersion);
  }
  const taxonomy = state._parsed?.taxonomy;
  if (taxonomy?.available) {
    add("taxonomy.tsv", ["Feature ID\tTaxon\tConfidence", ...taxonomy.assignments.map((entry) =>
      [entry.feature_id, entry.taxon ?? "Unassigned", entry.confidence ?? ""].join("\t"))].join("\n"),
    "derived_from_retrieved_taxonomy", state.steps.taxonomy?.tool_version ?? null);
  }
  const alpha = state.results.alpha;
  if (alpha?.available) {
    add("alpha-diversity.tsv", ["#SampleID\tobserved_features\tshannon\tfaith_pd", ...alpha.samples.map((entry) =>
      [entry.sample_id, entry.observed_features ?? "", entry.shannon ?? "", entry.faith_pd ?? ""].join("\t"))].join("\n"),
    alpha.basis ?? "derived_from_alpha_artifact", state.steps.alpha_diversity?.tool_version ?? null);
  }
  const beta = state.results.beta;
  if (beta?.available) {
    add("distance-matrix.tsv", [`\t${beta.samples.join("\t")}`, ...beta.samples.map((sample, index) =>
      [sample, ...beta.matrix[index].map((value) => String(value))].join("\t"))].join("\n"),
    beta.basis ?? "derived_from_distance_artifact", state.steps.beta_diversity?.tool_version ?? null);
  }
  const pcoa = state.results.pcoa;
  if (pcoa?.available) {
    const lines = [`#SampleID\t${pcoa.axes.join("\t")}`, ...pcoa.coordinates.map((entry) =>
      [entry.sample_id, ...pcoa.axes.map((axis) => entry.values?.[axis] ?? "")].join("\t"))];
    if (pcoa.variance_explained) {
      // variance_explained is a fraction (0-1) for both parsed and computed
      // PCoA; convert exactly once to a labelled percentage here.
      for (const [axis, value] of Object.entries(pcoa.variance_explained)) {
        const percent = Math.round(value * 10_000) / 100;
        lines.push(`# ${axis} explains ${percent}% of variance`);
      }
    }
    add("pcoa-coordinates.tsv", lines.join("\n"), pcoa.basis ?? "derived_from_pcoa_artifact",
      state.steps.pcoa?.tool_version ?? null);
  }
  add("report.txt", report, "stored_workflow_report", null);
  const manifest = {
    workflow_type: "microbiome", run_id: state.run_id,
    source: state.input.source, tools: state.discovery.tools, classifier: state.discovery.classifier,
    artifacts: state.artifacts.map((artifact) => ({ name: artifact.name, source_step: artifact.source_step,
      dataset_id: artifact.dataset_id, checksum: artifact.checksum, tool_version: artifact.tool_version })),
    exports: items.map((item) => ({ name: item.name, source: item.source, tool_version: item.tool_version })),
    basis: "derived_from_original_stored_artifacts"
  };
  add("manifest.json", JSON.stringify(manifest, null, 2), "stored_provenance", null);
  const tagged = [];
  for (const item of items) tagged.push({ ...item, checksum: await hashInput(item.content),
    bytes: new TextEncoder().encode(item.content).length });
  return tagged;
}

async function buildResult(state) {
  const integrity = validateFeatureTableIntegrity({
    table: state._parsed?.table, repSeqs: state._parsed?.repSeqs,
    taxonomy: state._parsed?.taxonomy, metadata: { sample_ids: state.input.sample_ids }
  });
  const qc = state.results.qc?.available ? state.results.qc : observedQc(state);
  const unavailable = [];
  const optional = ["qc", "asv", "taxonomy", "composition", "alpha", "beta", "pcoa", "ordination"];
  for (const key of optional) {
    const value = key === "qc" ? qc : state.results[key];
    if (!value?.available) unavailable.push(`${key}: ${value?.reason ?? "no reason recorded"}`);
  }
  const result = {
    workflow_type: "microbiome", run_id: state.run_id, plan_id: state.plan_id,
    status: state.status, input: state.input, input_sha256: state.input_sha256,
    metadata_sha256: state.metadata_sha256,
    params: state.params, tools: state.discovery.tools, classifier: state.discovery.classifier,
    qc,
    asv: state.results.asv ?? null,
    taxonomy: state.results.taxonomy ?? null, composition: state.results.composition ?? null,
    alpha: state.results.alpha ?? null, beta: state.results.beta ?? null,
    pcoa: state.results.pcoa ?? null, ordination: state.results.ordination ?? null,
    integrity, artifacts: state.artifacts,
    unavailable_reasons: unavailable, errors: state.errors,
    validation: { ...state.validation, integrity },
    provenance: STEP_IDS.map((stepId) => ({ step_id: stepId, status: state.steps[stepId]?.status ?? "not_run",
      provider_job_id: state.steps[stepId]?.provider_job_id ?? null,
      tool_id: state.steps[stepId]?.tool_id ?? STEP_TOOL_IDS[stepId] ?? null,
      tool_version: state.steps[stepId]?.tool_version ?? null })),
    report: [
      `16S microbiome run ${state.run_id}`,
      `Samples: ${state.input.sample_count}; reads: ${state.results.asv?.total_assignable_reads ?? "unavailable"}; ASVs: ${state.results.asv?.feature_count ?? "unavailable"}.`,
      `Truncation: trim-left ${state.params.trim_left}, trunc-len ${state.params.trunc_len}. ${state.params.trunc_rationale}`,
      `Classifier: ${state.discovery.classifier?.available ? state.discovery.classifier.option_label : state.discovery.classifier?.reason}`,
      `Integrity: ${validateFeatureTableIntegrity({ table: state._parsed?.table, repSeqs: state._parsed?.repSeqs,
        taxonomy: state._parsed?.taxonomy, metadata: { sample_ids: state.input.sample_ids } }).valid ? "passed" : "failed"}.`,
      "No statistical significance or differential-abundance claim is made by this workflow."
    ].join("\n"),
    limitations: [
      "No statistical significance or differential-abundance claim is made by this workflow.",
      "Relative abundance is computed from actual feature-table counts; unclassified reads are retained.",
      "Faith's PD is null unless a valid rooted tree was retrieved.",
      "qza artifacts are binary; only exported text was parsed, with failures recorded above.",
      "Taxonomy identity and release are exactly the discovered live option label; no release was guessed."
    ],
    execution_mode: state.execution_mode ?? "real",
    reopen: { ai_run_id: state.run_id, ai_run_url: `/api/ai/runs/${state.run_id}`,
      recovery_url: `/api/ai/runs/${state.run_id}/recovery`, plan_id: state.plan_id }
  };
  result.exports = await buildExports(state, result.report);
  return result;
}

async function advanceOneStage(db, row, state, env, ctx) {
  const stepId = state.current_step;
  if (!stepId) return;
  const step = state.steps[stepId] ?? {};
  if (step.status === "succeeded" || step.status === "unavailable") {
    const index = STEP_IDS.indexOf(stepId);
    state.current_step = STEP_IDS[index + 1] ?? null;
    return;
  }
  if (step.status === "failed") return;
  const adapter = createAdapter(env);

  if (stepId === "import_reads") {
    if (!step.provider_job_id) {
      state.status = "failed";
      state.errors.push({ step: stepId, reason: "import_provider_job_missing" });
      return;
    }
    const status = await adapter.getJobStatus({ job_id: step.provider_job_id }, ctx);
    const classified = classifyJobState(status.output?.structured?.state ?? status.status);
    if (classified === "running" || classified === "unknown") return;
    if (classified === "failed") {
      state.status = "failed";
      state.errors.push({ step: stepId, reason: `upload job ended in state ${status.output?.structured?.state ?? status.status}` });
      return;
    }
    const ready = await finalizeImport(adapter, state, ctx);
    if (!ready) return; // bounded: next status request retries resolution
    state.steps.import_reads = { ...step, status: "succeeded", finished_at: nowIso(),
      dataset_ids: state.dataset_ids };
    await recordStep(db, state, stepId, "succeeded", { details: state.steps.import_reads });
    return;
  }

  if (step.status === "running" && step.provider_job_id) {
    const status = await adapter.getJobStatus({ job_id: step.provider_job_id }, ctx);
    const classified = classifyJobState(status.output?.structured?.state ?? status.status);
    if (classified === "running" || classified === "unknown") return;
    if (classified === "failed") {
      state.status = "failed";
      state.errors.push({ step: stepId, reason: `provider job ${step.provider_job_id} ended in state ${status.output?.structured?.state ?? status.status}` });
      await recordStep(db, state, stepId, "failed", { details: { reason: state.errors.at(-1).reason } });
      return;
    }
    await finalizeStage(adapter, env, db, row, state, stepId, step.provider_job_id, ctx);
    return;
  }

  if (!step.status) {
    if (stepId === "report") {
      state.steps.report = { status: "succeeded", finished_at: nowIso() };
      await recordStep(db, state, stepId, "succeeded", { details: { source: "stored_tool_artifacts" } });
      return;
    }
    const roleFor = { demux: "demux", qc_summary: "qc", dada2_denoise: "denoise", taxonomy: "classify",
      alpha_diversity: "alpha", beta_diversity: "beta", pcoa: "pcoa" }[stepId];
    if (roleFor && state.discovery.tools[roleFor]?.id) {
      try {
        await submitStage(adapter, env, state, stepId, ctx);
        await recordStep(db, state, stepId, "running", {
          providerJobId: state.steps[stepId]?.provider_job_id ?? null,
          details: { tool_id: state.steps[stepId]?.tool_id ?? null, tool_version: state.steps[stepId]?.tool_version ?? null }
        });
      } catch (caught) {
        state.status = "failed";
        state.errors.push({ step: stepId, reason: caught?.message ?? String(caught) });
        await recordStep(db, state, stepId, "failed", { details: { reason: state.errors.at(-1).reason } });
      }
      return;
    }
    const local = localStage(state, stepId);
    state.steps[stepId] = { status: local.available ? "succeeded" : "unavailable",
      reason: local.reason ?? null, finished_at: nowIso() };
    await recordStep(db, state, stepId, state.steps[stepId].status, { details: { reason: local.reason ?? null } });
  }
}

export async function handleStatus(request, env, options = {}) {
  const rejected = requireMethod(request, "GET", "GET, OPTIONS");
  if (rejected) return rejected;
  const db = getDb(env);
  if (!db) return errorResponse("AI database binding is unavailable.", 503, request);
  const row = await getRunByReference(db, request);
  if (!row) return errorResponse("No stored microbiome run matches this reference.", 404, request);
  let state = parseJson(row.state_json);
  if (!state) return errorResponse("The stored run has no state record; nothing was reconstructed.", 409, request);
  const ctx = ctxFor(env, options);
  await rehydrateParsed(db, state);
  if (state.status === "running" && state.current_step) {
    state.poll_count = Math.min((state.poll_count ?? 0) + 1, LIMITS.maxProviderPolls);
    try {
      await advanceOneStage(db, row, state, env, ctx);
      if (!state.current_step && state.status === "running") {
        state.status = "succeeded";
        const result = await buildResult(state);
        await runStatement(db, SQL.saveJobResult, ["succeeded", nowIso(), JSON.stringify(result),
          JSON.stringify(state.validation), null, JSON.stringify(result.provenance),
          JSON.stringify({ report_url: `/api/ai/runs/${state.run_id}/report` }), envExecutionMode(env),
          state.run_id, "running"]);
        await persistState(db, row, state, result);
      } else {
        await persistState(db, row, state);
      }
    } catch (caught) {
      state.status = "failed";
      state.errors.push({ step: state.current_step, reason: caught?.message ?? String(caught) });
      await persistState(db, row, state);
    }
  }
  const stepSummary = STEP_IDS.map((id) => ({ step_id: id, status: state.steps[id]?.status ?? "not_started",
    provider_job_id: state.steps[id]?.provider_job_id ?? null,
    tool_id: state.steps[id]?.tool_id ?? STEP_TOOL_IDS[id] ?? null,
    reason: state.steps[id]?.reason ?? null }));
  return jsonResponse({ workflow_type: "microbiome", run_id: state.run_id, status: state.status,
    current_step: state.current_step, steps: stepSummary,
    terminal: state.status === "succeeded" || state.status === "failed",
    poll_after_ms: state.status === "running" ? LIMITS.pollAfterMs : null,
    poll_count: state.poll_count,
    result_url: `/api/ai/workflows/microbiome/result?run_id=${encodeURIComponent(state.run_id)}`,
    recovery_url: `/api/ai/runs/${state.run_id}/recovery`,
    errors: state.errors, execution_mode: envExecutionMode(env) }, 200, request);
}

export async function handleResult(request, env) {
  const rejected = requireMethod(request, "GET", "GET, OPTIONS");
  if (rejected) return rejected;
  const db = getDb(env);
  if (!db) return errorResponse("AI database binding is unavailable.", 503, request);
  const row = await getRunByReference(db, request);
  if (!row) return errorResponse("No stored microbiome run matches this reference.", 404, request);
  const result = parseJson(row.result_json);
  if (!result) {
    return jsonResponse({ workflow_type: "microbiome", run_id: row.public_id, status: row.state ?? "running",
      error: null, reason: "No result has been stored for this run yet; no result was reconstructed.",
      status_url: `/api/ai/workflows/microbiome/status?run_id=${encodeURIComponent(row.public_id)}` }, 409, request);
  }
  return jsonResponse({ ...result, status: result.status ?? row.state,
    status_url: `/api/ai/workflows/microbiome/status?run_id=${encodeURIComponent(row.public_id)}`,
    recovery_url: `/api/ai/runs/${row.public_id}/recovery` }, 200, request);
}

export function microbiomeHandlers() {
  return {
    microbiomePlan: (context) => handlePlan(context.request, context.env, {}),
    microbiomeRun: (context) => handleRun(context.request, context.env, {}),
    microbiomeStatus: (context) => handleStatus(context.request, context.env, {}),
    microbiomeResult: (context) => handleResult(context.request, context.env)
  };
}
