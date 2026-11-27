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
  buildImportPayload, buildMicrobiomePayload, describeAllImportCases, describeImportCase,
  describeLiveParameters, findImportFormatCase
} from "./schema.js";
import {
  aggregateByRank, chooseRarefactionDepth, chooseTruncation, computeAlphaFromTable,
  computeBrayCurtis, computePcoa, ordinationEvidence, parseAlphaDiversity,
  parseDenoisingStats, parseDistanceMatrix, parseFastq, parseFeatureTable,
  parseMetadataTsv, parsePcoa, parseQcSummary, parseRepSeqsFasta, parseTaxonomyTsv,
  rawQcSummary, validateFeatureTableIntegrity, validateSampleCorrespondence
} from "./parsers.js";
import { PUBLIC_DATASETS } from "../../../../../public/js/microbiome-zip.js";
import { resolvePublicDataset } from "./public-data.js";
import { verifyRemoteSha256 } from "./sha256-stream.js";
import {
  QIIME_CLASSIFIER, classifierProvenance, inspectClassifierInventory
} from "./classifier-prep.js";

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

// TEMP diagnostics: labels, elapsed ms and counts only. Never log state, ids,
// credentials, payloads or provider response bodies.
const STATUS_DIAG = true;
function diag(label, started, count = null) {
  if (!STATUS_DIAG) return;
  const ms = Math.round((Date.now() - started) * 10) / 10;
  console.log("[status-diag]", label, `${ms}ms`, count === null ? "" : `count=${count}`);
}
async function timed(label, fn) {
  const started = Date.now();
  try { return await fn(); } finally { diag(label, started); }
}

function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
function ctxFor(env, options = {}) {
  return { fetch: options.fetchImpl ?? env?.FETCH_IMPL ?? globalThis.fetch,
    // Injectable so offline retries never wait on real provider backoff.
    sleep: options.sleep ?? null };
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
  const capabilities = await timed("discover.getCapabilities", async () => createAdapter(env).getCapabilities(ctx));
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
      const schema = await timed("discover.fetchToolSchema", async () => fetchToolSchema(env, tools.classify.id, tools.classify.version));
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

// The live demux `barcodes|column` is a ColumnListParameter: Galaxy rejects a
// column NAME and accepts a 1-BASED numeric column position. The position must
// come from the ACTUAL stored metadata header (indexOf + 1). No index is
// invented when the header is absent.
const DEMUX_COLUMN_PROVENANCE_KEY = "__demux_barcode_column_provenance";
const DEMUX_COLUMN_EVIDENCE = "Live Galaxy HTTP 400: invalid option 'barcode-sequence' for ColumnListParameter "
  + "'column'; nine numeric options were offered for the nine-column metadata header, so the value is a 1-based position.";

function barcodeColumnPosition(metadataText) {
  const columns = parseMetadataTsv(metadataText).columns ?? [];
  let index = columns.findIndex((name) => String(name).trim().toLowerCase() === "barcode-sequence");
  if (index < 0) index = columns.findIndex((name) => /barcode/i.test(String(name)));
  if (index < 0) {
    return { found: false, header: null, columns, position: null,
      reason: "No barcode-named column exists in the stored metadata header; no column index was invented." };
  }
  return { found: true, header: columns[index], columns, position: index + 1, reason: null };
}

function overridesFor(stepId, schema, state, discovery) {
  const overrides = {};
  if (!schema) return overrides;
  const names = describeLiveParameters(schema).map((entry) => entry.name);
  const find = (pattern) => names.find((name) => pattern.test(name)) ?? null;
  if (stepId === "demux") {
    // Only set a field the LIVE schema actually exposes, preferring the
    // barcode conditional's own `column` parameter. `type` and Golay defaults
    // are left to the schema-driven payload builder.
    const columnField = names.find((name) => /(?:^|\|)column$/i.test(name) && /barcode/i.test(name))
      ?? find(/(?:^|\|)column$/i);
    const column = barcodeColumnPosition(state.input?.metadata_text);
    const value = column.found && columnField ? String(column.position) : null;
    if (value) overrides[columnField] = value;
    // Reserved diagnostic key: buildMicrobiomePayload only reads real schema
    // field names, so this is never sent to Galaxy.
    overrides[DEMUX_COLUMN_PROVENANCE_KEY] = {
      header: column.header, columns: column.columns, position: column.position,
      parameter_field: columnField ?? null, parameter_type: "ColumnListParameter",
      value_rule: "numeric_1_based_column_position", value_sent: value,
      basis: "actual_stored_metadata_header_index", evidence: DEMUX_COLUMN_EVIDENCE,
      reason: column.reason
    };
  }
  if (stepId === "dada2_denoise") {
    const trim = find(/(?:^|\|)trim[_-]?left$/i);
    const trunc = find(/(?:^|\|)trunc[_-]?len(?:gth)?$/i);
    if (trim) overrides[trim] = state.params.trim_left;
    if (trunc) overrides[trunc] = state.params.trunc_len;
  }
  // A verified history qza wins over a live select option. The option is kept
  // only as an honest fallback when preparation could not be verified.
  if (stepId === "taxonomy" && !state.classifier_prep?.dataset_id
      && discovery.classifier?.available && discovery.classifier.parameter_name
      && discovery.classifier.option_value) {
    overrides[discovery.classifier.parameter_name] = discovery.classifier.option_value;
  }
  if (stepId === "beta_diversity") {
    const metric = find(/(?:^|\|)(?:metric|distance_method|distance)$/i);
    if (metric) overrides[metric] = "bray_curtis";
  }
  return overrides;
}

// Resolve a succeeded demux job's REAL qza outputs with GET-only provider
// calls. No job is submitted and no id is guessed: each HDA/uuid association
// is matched against the artifact inventory of its own history (falling back
// to the run history) and must be ready with a qza extension.
async function recoverDemuxOutputsFromJob(adapter, state, ctx, jobId) {
  const outputs = await adapter.getJobOutputs({ job_id: jobId }, ctx);
  if (!outputs?.ok) {
    return { ok: false, reason: `job_outputs_unavailable: ${outputs?.error?.message ?? outputs?.error?.code ?? "unreadable"}` };
  }
  const candidates = [];
  for (const association of outputs.outputs ?? []) {
    const id = safeString(association?.galaxyHdaId ?? association?.id, 200);
    const uuid = safeString(association?.galaxyDatasetUuid ?? association?.uuid, 200);
    const historyId = safeString(association?.history_id, 200) || safeString(state.history_id, 200);
    if (!id && !uuid) { candidates.push({ reason: "no_dataset_identity" }); continue; }
    let contents;
    try {
      contents = await adapter.getArtifacts({ history_id: historyId }, ctx);
    } catch (caught) {
      candidates.push({ reason: `history_inventory_threw: ${safeString(caught?.message ?? caught, 200)}` });
      continue;
    }
    if (!contents?.ok) {
      candidates.push({ reason: `history_inventory_unavailable: ${contents?.error?.message ?? contents?.error?.code ?? "unreadable"}` });
      continue;
    }
    const match = (contents.artifacts ?? []).find((item) =>
      (id && String(item.id) === id) || (uuid && String(item.uuid) === uuid)) ?? null;
    if (!match) { candidates.push({ reason: "output_dataset_not_found_or_not_ready" }); continue; }
    if (!["ok", "success"].includes(String(match.state ?? "").toLowerCase())) {
      candidates.push({ reason: `output_dataset_not_ready: ${match.state ?? "unknown"}` });
      continue;
    }
    const name = String(match.name ?? "");
    const ext = String(match.type ?? match.extension ?? "").replace(/^\./, "").toLowerCase();
    if (ext !== "qza" && !/\.qza$/i.test(name)) {
      candidates.push({ reason: "output_not_qza_artifact", name });
      continue;
    }
    candidates.push({ dataset_id: String(match.id), uuid: uuid || String(match.uuid ?? "") || null,
      history_id: safeString(match.history_id, 200) || historyId, name, state: String(match.state),
      per_sample: /per_sample_sequences\.qza$/i.test(name) || /(?:^|[_\s])sequences?\.qza$/i.test(name),
      error_details: /error_correction_details\.qza$/i.test(name) });
  }
  const perSample = candidates.find((entry) => entry.per_sample) ?? null;
  if (!perSample) {
    return { ok: false, reason: candidates.length
      ? `no_ready_per_sample_sequences_qza: ${candidates.map((entry) => entry.reason ?? "non_matching_qza").join("; ")}`
      : "no_job_output_associations", candidates };
  }
  return { ok: true, per_sample: perSample,
    error_details: candidates.find((entry) => entry.error_details) ?? null, candidates };
}

// Repair a stale succeeded-demux state finalized before the qza frontier fix.
// Stored artifacts are the cheap first source; the existing provider job's
// READ-ONLY outputs are the fallback. The id is NEVER invented and the demux
// job is never replayed.
async function repairDemuxFrontier(adapter, state, ctx) {
  const result = { attempted: false, repaired: false, dataset_id: null,
    error_correction_dataset_id: null, reason: null, basis: "stored_demux_output_artifacts" };
  if ((state.steps?.demux?.status ?? null) !== "succeeded") {
    return { ...result, reason: "demux_not_succeeded" };
  }
  const current = safeString(state.frontier?.demuxReadsId, 200);
  if (/^[0-9a-f]{8,64}$/i.test(current)) {
    return { ...result, dataset_id: current, reason: "frontier_already_set" };
  }
  result.attempted = true;
  const stored = [
    ...(Array.isArray(state.steps.demux.output_artifacts) ? state.steps.demux.output_artifacts : []),
    ...((state.artifacts ?? []).filter((artifact) => String(artifact?.source_step ?? "") === "demux"))
  ];
  const realId = (artifact) => safeString(artifact?.dataset_id ?? artifact?.id, 200);
  const isQza = (artifact) => /\.qza$/i.test(String(artifact?.name ?? ""))
    || /^qza$/i.test(String(artifact?.extension ?? ""));
  const named = (artifact, name) => name.test(String(artifact?.name ?? ""));
  const perSample = stored.find((artifact) => isQza(artifact)
    && named(artifact, /per_sample_sequences\.qza$/i) && /^[0-9a-f]{8,64}$/i.test(realId(artifact)))
    ?? stored.find((artifact) => isQza(artifact) && named(artifact, /(?:^|[_\s])sequences?\.qza$/i)
      && /^[0-9a-f]{8,64}$/i.test(realId(artifact))) ?? null;
  const errorDetails = stored.find((artifact) => isQza(artifact)
    && named(artifact, /error_correction_details\.qza$/i)
    && /^[0-9a-f]{8,64}$/i.test(realId(artifact))) ?? null;
  if (!perSample) {
    const jobId = safeString(state.steps.demux.provider_job_id, 200);
    if (!jobId) {
      result.reason = "no_stored_per_sample_sequences_qza_artifact_and_no_demux_provider_job_id";
      state.steps.demux.demux_frontier_repair = { ...result, status: "unavailable" };
      return result;
    }
    let recovered;
    try {
      recovered = await recoverDemuxOutputsFromJob(adapter, state, ctx, jobId);
    } catch (caught) {
      result.reason = `demux_output_recovery_threw: ${safeString(caught?.message ?? caught, 300)}`;
      state.steps.demux.demux_frontier_repair = { ...result, status: "unavailable" };
      return result;
    }
    if (!recovered.ok) {
      result.reason = `no_stored_per_sample_sequences_qza_artifact; provider_job_output_resolution_failed: ${recovered.reason}`;
      result.recovery = recovered;
      state.steps.demux.demux_frontier_repair = { ...result, status: "unavailable" };
      return result;
    }
    result.basis = "recovered_from_demux_provider_job_outputs";
    result.recovery = { ok: true, provider_job_id: jobId, candidates: recovered.candidates };
    state.frontier = { ...(state.frontier ?? {}),
      demuxReadsId: recovered.per_sample.dataset_id,
      demuxReadsHistoryId: recovered.per_sample.history_id,
      demuxReadsUuid: recovered.per_sample.uuid };
    if (recovered.error_details) {
      state.frontier.demuxErrorCorrectionDetailsId = recovered.error_details.dataset_id;
    }
    state.steps.demux.demux_output_provenance = {
      per_sample_sequences_dataset_id: recovered.per_sample.dataset_id,
      per_sample_sequences_name: recovered.per_sample.name,
      per_sample_sequences_history_id: recovered.per_sample.history_id,
      per_sample_sequences_uuid: recovered.per_sample.uuid,
      error_correction_details_dataset_id: recovered.error_details?.dataset_id ?? null,
      error_correction_details_name: recovered.error_details?.name ?? null,
      provider_job_id: jobId,
      basis: "recovered_from_demux_provider_job_outputs",
      note: "Succeeded demux job was not replayed and binary qza was not parsed as text."
    };
    state.steps.demux.demux_frontier_repair = { ...result, status: "succeeded" };
    return { ...result, repaired: true, dataset_id: recovered.per_sample.dataset_id,
      error_correction_dataset_id: recovered.error_details?.dataset_id ?? null };
  }
  const datasetId = realId(perSample);
  state.frontier = { ...(state.frontier ?? {}), demuxReadsId: datasetId };
  if (errorDetails) {
    state.frontier.demuxErrorCorrectionDetailsId = realId(errorDetails);
  }
  state.steps.demux.demux_output_provenance = {
    per_sample_sequences_dataset_id: datasetId,
    per_sample_sequences_name: String(perSample.name ?? ""),
    error_correction_details_dataset_id: errorDetails ? realId(errorDetails) : null,
    error_correction_details_name: errorDetails ? String(errorDetails.name ?? "") : null,
    basis: "repaired_from_stored_demux_output_artifacts",
    note: "Succeeded demux job was not replayed and binary qza was not parsed as text."
  };
  state.steps.demux.demux_frontier_repair = { ...result, status: "succeeded" };
  return { ...result, repaired: true, dataset_id: datasetId,
    error_correction_dataset_id: errorDetails ? realId(errorDetails) : null };
}

function rolesFor(stepId, state) {
  switch (stepId) {
    case "demux": {
      const imported = state.frontier?.importedSeqsId ?? null;
      return [
        { id: imported ?? state.dataset_ids.sequences, role: imported ? "artifact" : "reads",
          name: imported ? "imported EMP single-end reads (qza)" : state.filenames.reads },
        // Raw barcodes were consumed by the import preparation step; the live
        // demux tool takes one qza reads input plus the metadata TSV.
        ...(imported ? [] : [{ id: state.dataset_ids.barcodes, role: "barcodes", name: state.filenames.barcodes }]),
        { id: state.dataset_ids.metadata, role: "table", name: state.filenames.metadata }
      ];
    }
    // Every downstream QIIME 2 input is a qza artifact, not raw reads/table.
    case "qc_summary": return [{ id: state.frontier?.demuxReadsId ?? state.dataset_ids.sequences,
      role: "artifact", name: "demultiplexed reads qza" }];
    case "dada2_denoise": return [{ id: state.frontier?.demuxReadsId ?? state.dataset_ids.sequences,
      role: "artifact", name: "demultiplexed reads qza" }];
    case "taxonomy": return [
      { id: state.frontier?.repSeqsId, role: "artifact", key: "reads",
        name: "representative sequences qza", hint: "reads|sequences|rep|feature" },
      // The classifier is a REAL history qza prepared from the official URL.
      // Hints keep it out of the representative-sequences field.
      ...(state.classifier_prep?.dataset_id ? [{ id: state.classifier_prep.dataset_id,
        role: "artifact", key: "classifier", name: state.classifier_prep.filename ?? QIIME_CLASSIFIER.filename,
        hint: "classifier|referen|database|rrna|silva|taxonomy" }] : [])
    ];
    case "alpha_diversity": return [{ id: state.frontier?.featureTableId,
      role: "artifact", name: "feature table qza" }];
    case "beta_diversity": return [{ id: state.frontier?.featureTableId,
      role: "artifact", name: "feature table qza" }];
    case "pcoa": return [{ id: state.frontier?.distanceMatrixId ?? state.frontier?.featureTableId,
      role: "artifact", name: "distance matrix qza" }];
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
  const started = Date.now();
  const status = await timed("getJobStatus", async () => adapter.getJobStatus({ job_id: jobId }, ctx));
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
  diag("collectOutputs", started, selected.length);
  return { selected, associations, historyContents: contents.artifacts ?? [], status, outputs };
}

const FINALIZE_MAX_ARTIFACTS_PER_POLL = 2;
const FINALIZE_MAX_BYTES_PER_POLL = 200 * 1024;

async function downloadSelected(adapter, artifacts, stepId, ctx, { toolVersion = null,
  maxArtifacts = Infinity, maxBytes = Infinity } = {}) {
  const started = Date.now();
  const out = [];
  const errors = [];
  let bytes = 0;
  let reachedLimit = false;
  for (const artifact of artifacts) {
    if (out.length >= maxArtifacts || bytes >= maxBytes) { reachedLimit = true; break; }
    const downloaded = await adapter.downloadArtifact({ dataset_id: artifact.id }, ctx);
    if (!downloaded.ok || typeof downloaded.content !== "string") {
      errors.push({ dataset_id: artifact.id, name: artifact.name, reason: "content_unavailable" });
      continue;
    }
    const size = new TextEncoder().encode(downloaded.content).length;
    // A single oversized artifact is reported honestly; it never enters a poll.
    if (size > maxBytes) {
      errors.push({ dataset_id: artifact.id, name: artifact.name, bytes: size,
        reason: "artifact_exceeds_poll_byte_bound" });
      reachedLimit = true;
      break;
    }
    bytes += size;
    const checksum = await hashInput(downloaded.content);
    out.push({ ...artifact, source_step: stepId, tool_version: toolVersion, text: downloaded.content,
      checksum, bytes: size });
  }
  diag("downloadSelected", started, out.length);
  return { artifacts: out, errors, bytes, reachedLimit };
}

function parseForKind(kind, text, options = {}) {
  if (typeof text !== "string" || !text) {
    return { available: false, reason: `No text was available for a ${kind} artifact.` };
  }
  if (text.length > MAX_PARSE_CHARS) {
    return { available: false, reason: `artifact_exceeds_${MAX_PARSE_CHARS}_character_local_parse_bound` };
  }
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
  const limits = [];
  for (const artifact of artifacts) {
    if (artifact.kind !== kind || typeof artifact.text !== "string") continue;
    if (artifact.text.length > MAX_PARSE_CHARS) {
      limits.push({ kind, dataset_id: artifact.id, name: artifact.name, chars: artifact.text.length,
        reason: `artifact_exceeds_${MAX_PARSE_CHARS}_character_local_parse_bound` });
      continue;
    }
    const parsed = parseForKind(kind, artifact.text, options);
    if (parsed.available) return { parsed, artifact, limits };
  }
  return {
    parsed: { available: false, reason: `No parseable ${kind} artifact was retrieved from the tool output.` },
    artifact: null, limits
  };
}

function recordParseLimits(state, limits) {
  if (Array.isArray(limits) && limits.length) {
    state.parse_limits = [...(state.parse_limits ?? []), ...limits].slice(-12);
  }
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
    frontier: {}, steps: {}, results: {}, artifacts: [], errors: [], poll_count: 0,
    // Bounded qza text-export phase: provenance per source dataset and in-flight jobs.
    exports: {}, pending_exports: [],
    // At-most-one pre-demux EMP import preparation (never a scientific analysis).
    import: null
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

// ------------------------------------------------------------------ /retry
//
// One bounded recovery for a run that failed ONLY during the initial upload.
// It never creates a new run, never submits an analysis job, and never uploads
// twice. A read-only Galaxy inventory runs first so an upload that actually
// landed can be reused instead of duplicated.

const RETRY_SOURCE_KEY = "moving-pictures-2026.10";
const RETRY_FILENAMES = Object.freeze({
  reads: "sequences.fastq.gz", barcodes: "barcodes.fastq.gz", metadata: "sample-metadata.tsv"
});
const RETRY_ROLE_BY_FILENAME = Object.freeze({
  [RETRY_FILENAMES.reads]: "sequences", [RETRY_FILENAMES.barcodes]: "barcodes",
  [RETRY_FILENAMES.metadata]: "metadata"
});
const REQUEST_ID_HEADERS = Object.freeze(["x-request-id", "x-amzn-requestid", "cf-ray"]);

function errorText(error) {
  if (typeof error === "string") return error;
  try { return JSON.stringify(error) ?? ""; } catch { return String(error); }
}

function headerRequestId(headers) {
  for (const name of REQUEST_ID_HEADERS) {
    const value = headers?.get?.(name) ?? null;
    if (value) return safeString(value, 200);
  }
  return "";
}

function requestIdOf(error, captured = {}) {
  const direct = error?.request_id ?? error?.requestId ?? null;
  const fromHeaders = headerRequestId(error?.headers) || headerRequestId(error?.response?.headers);
  return safeString(direct || fromHeaders || captured.request_id || "", 200) || null;
}

function normalizeChecksum(value) {
  return safeString(value, 200).replace(/^sha256\$/i, "").trim().toLowerCase() || null;
}

// Capture the real upstream HTTP status / request id from the exact fetch the
// adapter performs. No key, URL or body is captured or logged.
function captureFetch(baseFetch, captured) {
  return async (...args) => {
    const response = await baseFetch(...args);
    if (response && response.ok === false) {
      captured.status = Number(response.status) || captured.status;
      captured.request_id = headerRequestId(response.headers) || captured.request_id;
    }
    return response;
  };
}

export async function handleRetry(request, env, options = {}) {
  const rejected = requireMethod(request, "POST", "POST, OPTIONS");
  if (rejected) return rejected;
  const { payload, error } = await readJsonBody(request);
  if (error) return errorResponse(error, 400, request);
  const db = getDb(env);
  if (!db) return errorResponse("AI database binding is unavailable.", 503, request);

  const runId = safeString(payload?.run_id, 100);
  let currentRetryCount = null;
  const refuse = (reason, detail, extra = {}) => jsonResponse({
    workflow_type: "microbiome", run_id: runId || null, retried: false,
    reason, error: `retry_refused: ${reason}`, detail,
    retry_count: currentRetryCount, execution_mode: envExecutionMode(env), ...extra
  }, 409, request);

  if (!runId) return refuse("run_missing", "run_id was not supplied.");
  const row = await getRow(db, SQL.getMicrobiomeRunByPublicId, [runId]);
  if (!row) return refuse("run_missing", "No stored run matches this run_id.");
  const state = parseJson(row.state_json);
  if (!state) return refuse("state_missing", "The stored run has no state record.");
  if (state.workflow_type !== "microbiome") return refuse("not_microbiome_run", "The referenced run is not a microbiome workflow.");
  // Single-use is checked first: even a recovered (running) run must report the
  // exhausted retry rather than a merely unexpected status.
  const retryCount = Number(state.retry_count ?? 0) || 0;
  currentRetryCount = retryCount;
  if (retryCount >= 1) return refuse("retry_limit_reached", "This run has already used its single bounded retry.", { retry_count: retryCount });
  if (state.status !== "failed") return refuse("status_not_failed", `The stored run status is ${state.status}, not failed.`);
  if (!(state.errors ?? []).some((entry) => errorText(entry).includes("upload_failed"))) {
    return refuse("not_upload_failure", "The recorded failure is not an upload failure (no upload_failed error was stored).");
  }
  const jobSteps = Object.entries(state.steps ?? {})
    .filter(([, step]) => Boolean(safeString(step?.provider_job_id, 200)))
    .map(([stepId]) => stepId);
  if (jobSteps.length) return refuse("provider_job_exists", `Steps already hold provider job ids: ${jobSteps.join(", ")}.`);
  if (safeString(state.history_id, 200)) return refuse("history_id_present", "The failed run already has a Galaxy history id; its state is not upload-only.");
  if ((state.artifacts ?? []).length) return refuse("artifacts_present", "The failed run already has retrieved artifacts.");

  // The only resumable input is the original verified public dataset. Identity
  // is proven by the exact three URLs, three SHA-256 checksums, three filenames
  // and the stored hashes. `input.public_dataset` is OPTIONAL context: handleRun
  // never stores it, so its absence must not block a genuine run, while a key
  // that IS present must name the same original dataset.
  const descriptor = PUBLIC_DATASETS[RETRY_SOURCE_KEY];
  const input = state.input ?? {};
  const source = input.source ?? {};
  const checksums = source.checksums ?? {};
  const urls = source.urls ?? {};
  const filenames = state.filenames ?? input.filenames ?? {};
  const declaredKey = safeString(input.public_dataset, 80);
  const sourceMatches = Boolean(descriptor) && input.mode === "public"
    && (!declaredKey || declaredKey === RETRY_SOURCE_KEY)
    && urls.metadata === descriptor.metadata_url && urls.reads === descriptor.reads_url
    && urls.barcodes === descriptor.barcodes_url
    && checksums.metadata_sha256 === descriptor.expected_metadata_sha256
    && checksums.reads_sha256 === descriptor.expected_reads_sha256
    && checksums.barcodes_sha256 === descriptor.expected_barcodes_sha256
    && filenames.reads === RETRY_FILENAMES.reads && filenames.barcodes === RETRY_FILENAMES.barcodes
    && filenames.metadata === RETRY_FILENAMES.metadata;
  if (!sourceMatches) return refuse("not_original_public_source",
    "The stored input is not the verified public Moving Pictures source with its original filenames and checksums.");
  const expectedInputSha = await hashInput(`${descriptor.expected_reads_sha256}:${descriptor.expected_barcodes_sha256}`);
  if (state.input_sha256 !== expectedInputSha || state.metadata_sha256 !== descriptor.expected_metadata_sha256) {
    return refuse("input_hash_mismatch", "The stored input/metadata hashes do not match the verified public source checksums.");
  }

  // READ-ONLY inventory before ANY upload. Without a readable inventory we
  // cannot prove an upload did not already land, so we refuse instead of
  // creating a duplicate.
  const ctx = ctxFor(env, options);
  const adapter = createAdapter(env);
  const inventory = await adapter.inventoryDatasets({}, ctx);
  state.inventory_scan = {
    at: nowIso(), ok: Boolean(inventory.ok), histories: inventory.histories ?? [],
    datasets_found: (inventory.datasets ?? []).length,
    reason: inventory.reason ?? null, error: inventory.error ?? null
  };
  if (!inventory.ok) {
    state.upload_retry = { at: nowIso(), outcome: "inventory_unavailable",
      http_status_or_error: errorText(inventory.error) || "galaxy_inventory_unavailable",
      request_id_if_supplied: requestIdOf(inventory.error) };
    state.errors.push("upload_retry_blocked: Galaxy inventory was unreadable; no upload was attempted.");
    await persistState(db, row, state);
    return jsonResponse({ workflow_type: "microbiome", run_id: row.public_id, retried: false,
      reason: "inventory_unavailable",
      error: "Galaxy dataset inventory could not be read; no upload was attempted.",
      detail: inventory.error ?? null, upload_retry: state.upload_retry,
      execution_mode: envExecutionMode(env) }, 409, request);
  }

  const expectedByRole = { sequences: checksums.reads_sha256, barcodes: checksums.barcodes_sha256,
    metadata: checksums.metadata_sha256 };
  const roles = Object.keys(expectedByRole);
  const matchedByHistory = new Map();
  const issues = [];
  for (const dataset of inventory.datasets ?? []) {
    const role = RETRY_ROLE_BY_FILENAME[dataset.name];
    if (!role) continue;
    const historyId = safeString(dataset.history_id, 200) || null;
    const exposed = normalizeChecksum(dataset.checksum);
    const checksumStatus = exposed === null ? "not_exposed" : exposed === expectedByRole[role] ? "verified" : "mismatch";
    const common = { name: dataset.name, dataset_id: dataset.id, history_id: historyId,
      state: dataset.state, checksum_status: checksumStatus };
    if (!["ok", "success"].includes(String(dataset.state ?? "").toLowerCase())) {
      issues.push({ ...common, reason: "dataset_not_ready" });
      continue;
    }
    if (checksumStatus === "mismatch") {
      issues.push({ ...common, reason: "checksum_mismatch" });
      continue;
    }
    const found = matchedByHistory.get(historyId) ?? {};
    if (found[role] && found[role].dataset_id !== dataset.id) {
      issues.push({ ...common, reason: "ambiguous_duplicate" });
      continue;
    }
    found[role] = { dataset_id: dataset.id, history_id: historyId, name: dataset.name,
      checksum_status: checksumStatus, checksum_exposed: exposed };
    matchedByHistory.set(historyId, found);
  }
  const complete = [...matchedByHistory.entries()].filter(([, found]) => roles.every((role) => Boolean(found[role])));

  const finish = async (provenance, note) => {
    let discoveryError = null;
    try {
      const discovery = await discover(env, ctx);
      state.discovery = { tools: discovery.toolVersions, classifier: discovery.classifier,
        discovery_mode: discovery.discoveryMode, discovered_at: discovery.discoveredAt };
    } catch (caught) {
      discoveryError = safeString(caught?.message ?? caught, 500) || String(caught);
      state.errors.push(`discovery_refresh_failed: ${discoveryError}`);
    }
    // Remove ONLY the original upload failure; every other recorded error stays.
    state.errors = (state.errors ?? []).filter((entry) => !errorText(entry).includes("upload_failed"));
    const importStatus = provenance === "reuse_existing_upload" ? "succeeded" : "running";
    state.steps.import_reads = { ...(state.steps.import_reads ?? {}), status: importStatus,
      provenance, note, upload_retry_at: nowIso(),
      finished_at: importStatus === "succeeded" ? nowIso() : null,
      dataset_ids: importStatus === "succeeded" ? { ...state.dataset_ids } : null };
    state.status = "running";
    state.current_step = "import_reads";
    state.retry_count = retryCount + 1;
    try {
      await recordStep(db, state, "import_reads", importStatus, {
        providerJobId: state.steps.import_reads.provider_job_id ?? null,
        details: { provenance, note, tool_id: state.steps.import_reads.tool_id ?? null }
      });
    } catch (caught) {
      state.errors.push(`import_read_job_record_failed: ${safeString(caught?.message ?? caught, 300)}`);
    }
    await persistState(db, row, state);
    await audit(db, { actor: "microbiome-worker", action: "microbiome_upload_retry", target: row.public_id,
      detail: { provenance, retry_count: state.retry_count, history_id: state.history_id }, timestamp: nowIso() });
    return jsonResponse({
      workflow_type: "microbiome", run_id: row.public_id, status: state.status,
      current_step: state.current_step, retried: true, retry_count: state.retry_count,
      recovery_path: provenance, history_id: state.history_id, dataset_ids: state.dataset_ids,
      upload_retry: state.upload_retry, tool_versions: state.discovery.tools,
      classifier: state.discovery.classifier, discovery_mode: state.discovery.discovery_mode,
      discovered_at: state.discovery.discovered_at, discovery_error: discoveryError,
      status_url: `/api/ai/workflows/microbiome/status?run_id=${encodeURIComponent(row.public_id)}`,
      result_url: `/api/ai/workflows/microbiome/result?run_id=${encodeURIComponent(row.public_id)}`,
      recovery_url: `/api/ai/runs/${encodeURIComponent(row.public_id)}/recovery`,
      poll_after_ms: LIMITS.pollAfterMs, execution_mode: envExecutionMode(env)
    }, 202, request);
  };

  if (complete.length === 1) {
    const reused = complete[0][1];
    state.dataset_ids = Object.fromEntries(roles.map((role) => [role, reused[role]?.dataset_id ?? null]));
    state.history_id = reused.sequences?.history_id ?? reused.barcodes?.history_id ?? reused.metadata?.history_id ?? null;
    const note = "reuse_existing_upload: all three original input datasets were already present in Galaxy with matching source checksums; no upload was attempted.";
    state.upload_retry = { at: nowIso(), outcome: "reuse_existing_upload", http_status_or_error: null,
      request_id_if_supplied: null, reused_datasets: state.dataset_ids, history_id: state.history_id };
    return finish("reuse_existing_upload", note);
  }

  if (complete.length > 1 || matchedByHistory.size || issues.length) {
    const visible = [...matchedByHistory.entries()].map(([historyId, found]) => ({ history_id: historyId,
      matched_roles: Object.keys(found), missing_roles: roles.filter((role) => !found[role]) }));
    const outcome = complete.length > 1 ? "ambiguous_existing_upload" : "partial_existing_upload";
    state.upload_retry = { at: nowIso(), outcome, http_status_or_error: outcome,
      request_id_if_supplied: null, matched: visible, issues,
      note: "Partial or ambiguous Galaxy inventory; no upload was attempted and no dataset was guessed." };
    state.errors.push(`upload_retry_blocked: ${outcome}; no upload was attempted.`);
    await persistState(db, row, state);
    return jsonResponse({ workflow_type: "microbiome", run_id: row.public_id, retried: false,
      reason: outcome, error: `retry_refused: ${outcome}`,
      detail: state.upload_retry, upload_retry: state.upload_retry,
      execution_mode: envExecutionMode(env) }, 409, request);
  }

  // No datasets exist: re-fetch the SAME verified bytes and perform exactly ONE
  // upload with the same three-file payload as the original run.
  // Production always uses the verified public resolver. The optional seam lets
  // offline tests inject the same three-file payload without touching the network.
  const resolveRetriedInputs = options.resolvePublicImpl
    ?? ((source, fetchImpl) => resolvePublicDataset({ ...source, key: RETRY_SOURCE_KEY }, fetchImpl, { sampleBytes: 0 }));
  let resolved;
  try {
    resolved = await resolveRetriedInputs(descriptor, ctx.fetch);
  } catch (caught) {
    const message = safeString(caught?.message ?? caught, 500) || String(caught);
    state.upload_retry = { at: nowIso(), outcome: "input_refetch_failed", http_status_or_error: message,
      request_id_if_supplied: null };
    state.errors.push(`upload_retry_failed: ${message}`);
    state.retry_count = retryCount + 1;
    await persistState(db, row, state);
    return jsonResponse({ workflow_type: "microbiome", run_id: row.public_id, retried: false,
      reason: "input_refetch_failed", error: message, upload_retry: state.upload_retry,
      retry_count: state.retry_count, execution_mode: envExecutionMode(env) }, 502, request);
  }

  const captured = { status: null, request_id: null };
  const uploadCtx = { ...ctx, fetch: captureFetch(ctx.fetch, captured) };
  let upload;
  try {
    upload = await adapter.submitJob({
      operation: "submit_job", tool_id: "upload1",
      inputs: {
        [resolved.reads_filename]: { filename: resolved.reads_filename, extension: "fastq.gz",
          content: new Blob([resolved.reads_bytes], { type: "application/gzip" }) },
        [resolved.barcodes_filename]: { filename: resolved.barcodes_filename, extension: "fastq.gz",
          content: new Blob([resolved.barcodes_bytes], { type: "application/gzip" }) },
        [resolved.metadata_filename]: { filename: resolved.metadata_filename, extension: "tsv",
          content: resolved.metadata_text }
      }
    }, uploadCtx);
  } catch (caught) {
    upload = { error: { status: caught?.status ?? captured.status, code: caught?.code ?? null,
      message: safeString(caught?.message ?? caught, 500) || String(caught) } };
  }

  if (upload.error) {
    const upstream = upload.error;
    const status = Number(upstream.status ?? captured.status ?? 0) || 0;
    const code = safeString(upstream.code, 120);
    const message = safeString(upstream.message, 500) || code || "Galaxy upload failed";
    const codeDetail = code && code !== `http_${status}` ? ` (${code})` : "";
    const reported = status ? `HTTP ${status}: ${message}${codeDetail}` : `${message}${codeDetail}`;
    state.upload_retry = { at: nowIso(), outcome: "upload_failed", http_status_or_error: reported,
      request_id_if_supplied: requestIdOf(upstream, captured), error_status: status || null,
      error_code: code || null, error_message: message };
    state.errors.push(`upload_retry_failed: ${reported}`);
    state.retry_count = retryCount + 1;
    state.status = "failed";
    await persistState(db, row, state);
    return jsonResponse({ workflow_type: "microbiome", run_id: row.public_id, retried: false,
      reason: "upload_failed", error: reported, upload_retry: state.upload_retry,
      retry_count: state.retry_count, execution_mode: envExecutionMode(env) }, 502, request);
  }

  state.history_id = upload.output?.structured?.history_id ?? null;
  state.steps.import_reads = { status: "running", provider_job_id: upload.provider_job_id ?? null,
    output_ids: upload.output?.structured?.outputs ?? [], tool_id: "upload1",
    retried_at: nowIso() };
  state.upload_retry = { at: nowIso(), outcome: "upload_succeeded", http_status_or_error: null,
    request_id_if_supplied: captured.request_id ?? null };
  return finish("upload_retry", "upload_retry: the single bounded re-upload succeeded; no analysis stage has run yet.");
}

// ---------------------------------------------------- /import-schema (GET)

// Error text in this diagnostic is scrubbed before it is returned: a provider
// exception can contain an API key, a signed URL or a full response body. The
// scrub removes configured secret values verbatim and masks key/token patterns
// and URLs, leaving only the exception name and a bounded message/stack.
function scrubDiagnosticText(value, env) {
  let text = String(value ?? "");
  for (const secret of [env?.GALAXY_API_KEY, env?.AI_API_KEY, env?.NINEROUTER_API_KEY,
    env?.SMARTSBIO_API_KEY, env?.X_AGENT_TOKEN, env?.API_KEY]) {
    if (typeof secret === "string" && secret.length >= 4) text = text.split(secret).join("[redacted]");
  }
  return text
    .replace(/\b(api[-_]?key|x-api-key|authorization|token|secret|password|passwd|credential)\b\s*[:=]\s*["']?[^\s,;"']+/gi, "$1=[redacted]")
    .replace(/https?:\/\/[^\s"'<>]+/gi, "[url]")
    .replace(/[?&][^=\s]+=[^\s&]+/g, "[query]");
}

function sanitizedErrorDetail(caught, env) {
  const scrub = (value, cap) => scrubDiagnosticText(value, env).slice(0, cap);
  return {
    name: scrub(caught?.name ?? "Error", 100),
    message: scrub(caught?.message ?? caught ?? "", 300),
    stack: scrub(caught?.stack ?? "", 500)
  };
}

// Read-only provenance diagnostic: inspect the LIVE `qiime2 tools import`
// schema using the exact same discovery/format-case path as the import phase.
// It returns metadata only — no credentials, dataset content or history data.
// The whole body is guarded: an unexpected live-schema shape must produce a
// JSON 500 with a bounded, sanitized error detail, never an empty platform 500.
export async function handleImportSchema(request, env, options = {}) {
  try {
    const rejected = requireMethod(request, "GET", "GET, OPTIONS");
    if (rejected) return rejected;
    const ctx = ctxFor(env, options);
    let discovery;
    try {
      discovery = await discover(env, ctx);
    } catch (caught) {
      return errorResponse(`Live discovery could not be read: ${scrubDiagnosticText(caught?.message ?? caught, env)}`, 502, request);
    }
    const tool = discovery.tools?.importTool;
    if (!tool?.id) {
      return jsonResponse({ available: false,
        reason: "No genuine `qiime2 tools import` tool was discovered; no tool id was invented.",
        tool_id: null, version: null }, 200, request);
    }
    let schema;
    try {
      schema = await fetchToolSchema(env, tool.id, tool.version);
    } catch (caught) {
      return jsonResponse({ available: false,
        reason: `The live import schema could not be read: ${scrubDiagnosticText(caught?.message ?? caught, env)}`,
        tool_id: tool.id, version: tool.version ?? null }, 200, request);
    }
    const detail = describeImportCase(schema, findImportFormatCase(schema));
    const body = { ...detail, version: tool.version ?? null,
      discovery_mode: discovery.discoveryMode, discovered_at: discovery.discoveredAt,
      execution_mode: envExecutionMode(env) };
    // Optional candidate list for independent review. The default response stays
    // the single selected EMP directory case; this view is still GET-only and
    // contains metadata only (no dataset ids, credentials or provider responses).
    if (String(new URL(request.url).searchParams.get("format") ?? "").toLowerCase() === "all") {
      body.candidates = describeAllImportCases(schema);
    }
    return jsonResponse(body, 200, request);
  } catch (caught) {
    return jsonResponse({ available: false, error: "import_schema_handler_failed",
      detail: sanitizedErrorDetail(caught, env) }, 500, request);
  }
}

// ------------------------------------------------------- /resume-stages

// A pre-submission failure reason may be retried after genuine discovery is
// refreshed. A failure that followed a real provider job may not be replayed
// through this endpoint: there is no evidence the job would be safe to repeat.
// Output-resolution failures are READ-ONLY failures: an existing provider job
// can still be recovered in its own history, so they may be resumed.
const PRE_SUBMISSION_REASON = /submission|unavailable|schema|no_data_input|no discovered tool|qza_import_(tool|format|schema|source|input_mapping|output_missing|output_resolution_failed|outputs_unavailable|output_unverified)|qza_export_(unavailable|payload_invalid)/i;

export async function handleResumeStages(request, env, options = {}) {
  const rejected = requireMethod(request, "POST", "POST, OPTIONS");
  if (rejected) return rejected;
  const { payload, error } = await readJsonBody(request);
  if (error) return errorResponse(error, 400, request);
  const db = getDb(env);
  if (!db) return errorResponse("AI database binding is unavailable.", 503, request);

  const runId = safeString(payload?.run_id, 100);
  const refuse = (reason, detail) => jsonResponse({
    workflow_type: "microbiome", run_id: runId || null, resumed: false,
    reason, error: `stage_resume_refused: ${reason}`, detail,
    execution_mode: envExecutionMode(env)
  }, 409, request);
  if (!runId) return refuse("run_missing", "run_id was not supplied.");
  const row = await getRow(db, SQL.getMicrobiomeRunByPublicId, [runId]);
  if (!row) return refuse("run_missing", "No stored run matches this run_id.");
  const state = parseJson(row.state_json);
  if (!state) return refuse("state_missing", "The stored run has no state record.");
  if (state.workflow_type !== "microbiome") return refuse("not_microbiome_run", "The referenced run is not a microbiome workflow.");
  if (state.status !== "failed") return refuse("status_not_failed", `The stored run status is ${state.status}, not failed.`);
  if (Number(state.retry_count ?? -1) !== 1) return refuse("retry_count_not_one",
    "Only a run resumed by exactly one bounded upload retry may resume stages.");
  if (Number(state.stage_resume_count ?? 0) >= 9) return refuse("stage_resume_limit_reached",
    "This run has reached the cap of nine bounded stage resumes.");
  if ((state.steps?.import_reads?.status ?? null) !== "succeeded") {
    return refuse("import_reads_not_succeeded", "The original upload import is not recorded as succeeded.");
  }

  const scientific = STEP_IDS.filter((id) => id !== "import_reads");
  // The qza import is PREPARATION of already-stored inputs, not an analysis
  // stage. Its provider job id must never make this a "scientific stage
  // already started" refusal; the recovery path resolves it read-only.
  const preparationJobId = safeString(state.import?.provider_job_id, 200);
  const started = scientific.filter((id) => {
    const step = state.steps?.[id] ?? {};
    const jobId = safeString(step.provider_job_id, 200);
    if (jobId && preparationJobId && jobId === preparationJobId) return false;
    return Boolean(jobId) || ["running", "succeeded"].includes(String(step.status ?? ""));
  });
  if (started.length) return refuse("scientific_stage_exists",
    `Scientific stages already started: ${started.join(", ")}.`);
  const scientificArtifacts = (state.artifacts ?? []).filter((artifact) =>
    scientific.includes(String(artifact.source_step ?? "")));
  if (scientificArtifacts.length) return refuse("scientific_artifacts_present",
    "Scientific artifacts already exist for this run.");
  const badReason = scientific.find((id) => {
    const step = state.steps?.[id] ?? {};
    if (step.status === "succeeded" || step.status === "unavailable") return false;
    if (step.status !== "failed" && !step.reason) return false;
    const text = errorText(step.reason ?? step);
    return !PRE_SUBMISSION_REASON.test(text);
  });
  if (badReason) return refuse("provider_failure_not_resumable",
    `${badReason} failed after a provider job or for an unknown reason; no stage was replayed.`);
  // A fourth resume is only safe when the run stopped BEFORE any provider job
  // existed for the failed scientific stage. An empty provider_job_id and a
  // submission/schema/unavailable reason prove this; a real job id may never
  // be replayed. No completed stage and no scientific job may exist either.
  const failedStages = scientific.filter((id) => (state.steps?.[id]?.status ?? null) === "failed");
  if (!failedStages.length) return refuse("no_pre_job_failure",
    "No failed scientific stage with a pre-job submission failure was recorded; no stage was replayed.");
  const postJobStage = failedStages.find((id) => {
    const step = state.steps[id] ?? {};
    const jobId = safeString(step.provider_job_id, 200);
    if (jobId && jobId !== preparationJobId) return true;
    return !PRE_SUBMISSION_REASON.test(errorText(step.reason ?? step));
  });
  if (postJobStage) return refuse("provider_failure_not_resumable",
    `${postJobStage} failed after a provider job or for an unknown reason; no stage was replayed.`);
  const completedOrStarted = scientific.filter((id) => {
    const step = state.steps?.[id] ?? {};
    const jobId = safeString(step.provider_job_id, 200);
    return step.status === "succeeded" || (jobId && jobId !== preparationJobId);
  });
  if (completedOrStarted.length) return refuse("scientific_stage_exists",
    `A scientific stage already succeeded or holds a provider job: ${completedOrStarted.join(", ")}.`);

  const firstIndex = scientific.findIndex((id) => (state.steps?.[id]?.status ?? "not_started") !== "succeeded");
  if (firstIndex < 0) return refuse("no_stage_to_resume", "Every scientific stage is already succeeded.");
  const resetStages = scientific.slice(firstIndex);

  const ctx = ctxFor(env, options);
  let discovery;
  try {
    discovery = await discover(env, ctx);
  } catch (caught) {
    return errorResponse(`Live discovery could not be refreshed: ${caught?.message ?? caught}`, 502, request);
  }
  // Only discovery is refreshed from the provider. A FAILED import preparation
  // with NO provider job is cleared so it can retry with fresh discovery. An
  // import that already has a real provider job is PRESERVED (with its job id)
  // so /status can recover its existing output read-only; it is never replayed.
  state.discovery = { tools: discovery.toolVersions, classifier: discovery.classifier,
    discovery_mode: discovery.discoveryMode, discovered_at: discovery.discoveredAt };
  for (const stage of resetStages) delete state.steps[stage];
  state.errors = (state.errors ?? []).filter((entry) => {
    const text = errorText(entry);
    return !resetStages.some((stage) => text.includes(stage));
  });
  if (state.import && state.import.status !== "succeeded"
      && !safeString(state.import.provider_job_id, 200)) {
    state.import = null;
    if (state.frontier) delete state.frontier.importedSeqsId;
  }
  state.status = "running";
  state.current_step = scientific[firstIndex];
  state.stage_resume_count = Number(state.stage_resume_count ?? 0) + 1;
  await persistState(db, row, state);
  return jsonResponse({
    workflow_type: "microbiome", run_id: row.public_id, resumed: true,
    retry_count: state.retry_count, stage_resume_count: state.stage_resume_count,
    current_step: state.current_step, discovery_mode: state.discovery.discovery_mode,
    discovered_at: state.discovery.discovered_at, tool_versions: state.discovery.tools,
    classifier: state.discovery.classifier,
    status_url: `/api/ai/workflows/microbiome/status?run_id=${encodeURIComponent(row.public_id)}`,
    result_url: `/api/ai/workflows/microbiome/result?run_id=${encodeURIComponent(row.public_id)}`,
    recovery_url: `/api/ai/runs/${encodeURIComponent(row.public_id)}/recovery`,
    execution_mode: envExecutionMode(env)
  }, 202, request);
}

// ------------------------------------------------------- /continue-stages

// Single-use continuation for a run that failed at a PRE-JOB stage after real
// scientific stages succeeded. It only resets stored step bookkeeping: no run,
// upload, provider job or live request is created here.
export async function handleContinueStages(request, env, options = {}) {
  const rejected = requireMethod(request, "POST", "POST, OPTIONS");
  if (rejected) return rejected;
  const { payload, error } = await readJsonBody(request);
  if (error) return errorResponse(error, 400, request);
  const db = getDb(env);
  if (!db) return errorResponse("AI database binding is unavailable.", 503, request);
  const runId = safeString(payload?.run_id, 100);
  const refuse = (reason, detail) => jsonResponse({
    workflow_type: "microbiome", run_id: runId || null, continued: false,
    reason, error: `stage_continue_refused: ${reason}`, detail,
    execution_mode: envExecutionMode(env)
  }, 409, request);
  if (!runId) return refuse("run_missing", "run_id was not supplied.");
  const row = await getRow(db, SQL.getMicrobiomeRunByPublicId, [runId]);
  if (!row) return refuse("run_missing", "No stored run matches this run_id.");
  const state = parseJson(row.state_json);
  if (!state) return refuse("state_missing", "The stored run has no state record.");
  if (state.workflow_type !== "microbiome") return refuse("not_microbiome_run", "The referenced run is not a microbiome workflow.");
  // The cap is checked first: even a resumed (running) run must report the
  // exhausted continuation rather than a merely unexpected status.
  if (Number(state.continue_count ?? 0) >= 4) return refuse("continue_limit_reached", "This run has reached the cap of four bounded stage continuations.");
  if (state.status !== "failed") return refuse("status_not_failed", `The stored run status is ${state.status}, not failed.`);
  if ((state.steps?.import_reads?.status ?? null) !== "succeeded") {
    return refuse("import_reads_not_succeeded", "The original upload import is not recorded as succeeded.");
  }
  const scientific = STEP_IDS.filter((id) => id !== "import_reads");
  const succeeded = scientific.filter((id) => (state.steps?.[id]?.status ?? null) === "succeeded");
  if (!succeeded.length) return refuse("no_succeeded_scientific_stage",
    "No scientific stage succeeded; there is no completed work to preserve.");
  const failedStages = scientific.filter((id) => (state.steps?.[id]?.status ?? null) === "failed");
  if (!failedStages.length) return refuse("no_failed_stage", "No scientific stage is recorded as failed.");
  const postJob = failedStages.find((id) => Boolean(safeString(state.steps[id]?.provider_job_id, 200)));
  if (postJob) return refuse("provider_job_failure_not_continuable",
    `${postJob} holds a real provider job id; replaying it is not safe.`);
  const firstIndex = scientific.findIndex((id) => (state.steps?.[id]?.status ?? null) !== "succeeded");
  if (firstIndex < 0) return refuse("no_stage_to_continue", "Every scientific stage is already succeeded.");
  const resetStages = scientific.slice(firstIndex);
  for (const stage of resetStages) delete state.steps[stage];
  // `content_unavailable` errors from the ALREADY-SUCCEEDED demux stage are
  // obsolete: those binary qza downloads are no longer attempted. Genuine
  // failures for other stages are untouched.
  const demuxSucceeded = (state.steps?.demux?.status ?? null) === "succeeded";
  state.errors = (state.errors ?? []).filter((entry) => {
    if (resetStages.some((stage) => errorText(entry).includes(stage))) return false;
    if (demuxSucceeded && /content_unavailable/.test(errorText(entry))
        && (String(entry?.step ?? "") === "demux" || /\bdemux\b/i.test(errorText(entry)))) return false;
    return true;
  });
  const frontierRepair = await repairDemuxFrontier(createAdapter(env), state, ctxFor(env, options));
  state.status = "running";
  state.current_step = scientific[firstIndex];
  state.continue_count = Number(state.continue_count ?? 0) + 1;
  await persistState(db, row, state);
  return jsonResponse({
    workflow_type: "microbiome", run_id: row.public_id, continued: true,
    continue_count: state.continue_count, current_step: state.current_step,
    preserved_succeeded_stages: succeeded,
    reset_stages: resetStages,
    frontier_repair: frontierRepair,
    status_url: `/api/ai/workflows/microbiome/status?run_id=${encodeURIComponent(row.public_id)}`,
    result_url: `/api/ai/workflows/microbiome/result?run_id=${encodeURIComponent(row.public_id)}`,
    recovery_url: `/api/ai/runs/${encodeURIComponent(row.public_id)}/recovery`,
    execution_mode: envExecutionMode(env)
  }, 202, request);
}

// ------------------------------------------------------- /refresh-discovery

// Re-run genuine discovery for a resumed, upload-only run. This performs GETs
// only (capabilities + live tool schemas); it never uploads, submits a job or
// creates a run. It updates state.discovery and nothing else.
export async function handleRefreshDiscovery(request, env, options = {}) {
  const rejected = requireMethod(request, "POST", "POST, OPTIONS");
  if (rejected) return rejected;
  const { payload, error } = await readJsonBody(request);
  if (error) return errorResponse(error, 400, request);
  const db = getDb(env);
  if (!db) return errorResponse("AI database binding is unavailable.", 503, request);

  const runId = safeString(payload?.run_id, 100);
  const refuse = (reason, detail) => jsonResponse({
    workflow_type: "microbiome", run_id: runId || null, refreshed: false,
    reason, error: `refresh_discovery_refused: ${reason}`, detail,
    execution_mode: envExecutionMode(env)
  }, 409, request);
  if (!runId) return refuse("run_missing", "run_id was not supplied.");
  const row = await getRow(db, SQL.getMicrobiomeRunByPublicId, [runId]);
  if (!row) return refuse("run_missing", "No stored run matches this run_id.");
  const state = parseJson(row.state_json);
  if (!state) return refuse("state_missing", "The stored run has no state record.");
  if (state.workflow_type !== "microbiome") return refuse("not_microbiome_run", "The referenced run is not a microbiome workflow.");
  if (state.status !== "running") return refuse("status_not_running", `The stored run status is ${state.status}, not running.`);
  const scientificSteps = STEP_IDS.filter((id) => id !== "import_reads")
    .filter((id) => {
      const step = state.steps?.[id] ?? {};
      return Boolean(safeString(step.provider_job_id, 200))
        || ["running", "succeeded", "unavailable", "failed"].includes(String(step.status ?? ""));
    });
  if (scientificSteps.length) return refuse("scientific_stage_exists",
    `Scientific stages already exist for: ${scientificSteps.join(", ")}.`);
  if ((state.artifacts ?? []).length) return refuse("artifacts_present", "The run already has retrieved artifacts.");
  if (Number(state.retry_count ?? -1) !== 1) return refuse("retry_count_not_one",
    "Only a run resumed by exactly one bounded upload retry may refresh discovery.");

  const ctx = ctxFor(env, options);
  let discovery;
  try {
    discovery = await discover(env, ctx);
  } catch (caught) {
    return errorResponse(`Live discovery could not be refreshed: ${caught?.message ?? caught}`, 502, request);
  }
  state.discovery = { tools: discovery.toolVersions, classifier: discovery.classifier,
    discovery_mode: discovery.discoveryMode, discovered_at: discovery.discoveredAt };
  await persistState(db, row, state);
  return jsonResponse({
    workflow_type: "microbiome", run_id: row.public_id, refreshed: true,
    discovery_mode: state.discovery.discovery_mode, discovered_at: state.discovery.discovered_at,
    tool_versions: state.discovery.tools, classifier: state.discovery.classifier,
    execution_mode: envExecutionMode(env)
  }, 200, request);
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

// ------------------------------------------------------ pre-demux qza import
//
// The live demux `seqs` input requires a .qza QIIME 2 artifact, while our
// original inputs are gzip FASTQs. `qiime2 tools import` converts them using a
// FORMAT case read from its live schema. This is preparation of already-stored
// inputs, not a new scientific analysis, and it is submitted at most once.

function dataInputsOf(inputs, depth = 0) {
  if (depth > 8) return [];
  const out = [];
  for (const raw of inputs ?? []) {
    const item = raw ?? {};
    if (String(item.model_class ?? "").includes("DataToolParameter")) out.push(item);
    else if (Array.isArray(item.inputs)) out.push(...dataInputsOf(item.inputs, depth + 1));
  }
  return out;
}

function demuxRequiresQza(schema) {
  return dataInputsOf(schema?.inputs).some((input) =>
    (Array.isArray(input.extensions) ? input.extensions : [])
      .map((ext) => String(ext).toLowerCase().replace(/^\./, "")).includes("qza"));
}

// Recover an ALREADY-COMPLETED import job's output without any resubmission.
// Galaxy can place a tool output in a different history from the run's stored
// history; collectOutputs() correctly rejects cross-history associations, so
// resolution here is done against the association's OWN history (read-only).
// Nothing is guessed: the output id must be found, ready and a qza artifact.
async function recoverImportedQza(adapter, prior, state, ctx) {
  const jobId = safeString(prior.provider_job_id, 200);
  if (!jobId) return { ok: false, reason: "qza_import_job_id_missing" };
  const outputs = await adapter.getJobOutputs({ job_id: jobId }, ctx);
  if (!outputs?.ok) {
    return { ok: false, reason: `qza_import_outputs_unavailable: ${outputs?.error?.message ?? outputs?.error?.code ?? "no output associations"}` };
  }
  const candidates = [];
  for (const association of outputs.outputs ?? []) {
    const id = safeString(association?.galaxyHdaId ?? association?.id, 200);
    const uuid = safeString(association?.galaxyDatasetUuid ?? association?.uuid, 200);
    const ownHistoryId = safeString(association?.history_id, 200) || null;
    if (!id && !uuid) { candidates.push({ reason: "no_dataset_identity" }); continue; }
    // The association's OWN history is authoritative. Associations that do
    // not expose a history id fall back to the run history and then to a
    // direct dataset lookup; every candidate is still verified by real id/uuid.
    const lookups = [];
    const seenLookups = new Set();
    for (const candidate of [ownHistoryId ? { history_id: ownHistoryId } : null,
      safeString(state.history_id, 200) ? { history_id: safeString(state.history_id, 200) } : null,
      { dataset_id: id || uuid }]) {
      if (!candidate) continue;
      const key = JSON.stringify(candidate);
      if (seenLookups.has(key)) continue;
      seenLookups.add(key);
      lookups.push(candidate);
    }
    for (const lookup of lookups) {
      let contents;
      try {
        contents = await adapter.getArtifacts(lookup, ctx);
      } catch (caught) {
        candidates.push({ dataset_id: id || null, uuid: uuid || null, history_id: ownHistoryId, lookup,
          reason: `output_history_inventory_threw: ${safeString(caught?.message ?? caught, 300)}` });
        continue;
      }
      if (!contents?.ok) {
        candidates.push({ dataset_id: id || null, uuid: uuid || null, history_id: ownHistoryId, lookup,
          reason: `output_history_inventory_unavailable: ${contents?.error?.message ?? contents?.error?.code ?? "unreadable"}` });
        continue;
      }
      const match = (contents.artifacts ?? []).find((item) =>
        (id && String(item.id) === id) || (uuid && String(item.uuid) === uuid)) ?? null;
      if (!match) {
        candidates.push({ dataset_id: id || null, uuid: uuid || null, history_id: ownHistoryId, lookup,
          reason: "output_dataset_not_found_in_its_history_or_not_ready" });
        continue;
      }
      if (!["ok", "success"].includes(String(match.state ?? "").toLowerCase())) {
        candidates.push({ dataset_id: id || null, uuid: uuid || null, history_id: ownHistoryId, lookup,
          reason: `output_dataset_not_ready: ${match.state ?? "unknown"}` });
        continue;
      }
      const ext = String(match.type ?? match.extension ?? "").replace(/^\./, "").toLowerCase();
      const name = String(match.name ?? "");
      if (ext !== "qza" && !/\.qza$/i.test(name) && !/\bqza\b/i.test(ext)) {
        candidates.push({ dataset_id: id || null, uuid: uuid || null, history_id: ownHistoryId, lookup,
          name, extension: ext, reason: "output_not_qza_artifact" });
        continue;
      }
      const outputHistoryId = safeString(match.history_id, 200) || ownHistoryId
        || safeString(lookup.history_id, 200) || null;
      return {
        ok: true, dataset_id: String(match.id), uuid: uuid || String(match.uuid ?? "") || null,
        name: name || null, extension: ext || null, state: String(match.state),
        output_history_id: outputHistoryId, run_history_id: safeString(state.history_id, 200) || null,
        history_mismatch: Boolean(safeString(state.history_id, 200) && outputHistoryId
          && String(outputHistoryId) !== String(state.history_id)),
        candidates, basis: "read_only_job_output_resolution_in_output_own_history", at: nowIso()
      };
    }
  }
  return { ok: false, reason: candidates.length
    ? `qza_import_output_unverified: ${candidates.map((entry) => entry.reason).join("; ")}`
    : "qza_import_output_unverified: no output associations were returned", candidates };
}

// A dataset in another history cannot be referenced by a tool job in the run's
// history. Verify a candidate HDA is ready and a qza artifact in a given history.
async function verifyQzaInHistory(adapter, datasetId, historyId, ctx, label) {
  if (!datasetId || !historyId) return { ok: false, reason: `${label}_reference_missing` };
  let contents;
  try {
    contents = await adapter.getArtifacts({ history_id: historyId }, ctx);
  } catch (caught) {
    return { ok: false, reason: `${label}_inventory_threw: ${safeString(caught?.message ?? caught, 300)}` };
  }
  if (!contents?.ok) {
    return { ok: false, reason: `${label}_inventory_unavailable: ${contents?.error?.message ?? contents?.error?.code ?? "unreadable"}` };
  }
  const match = (contents.artifacts ?? []).find((item) => String(item.id) === String(datasetId)) ?? null;
  if (!match) return { ok: false, reason: `${label}_not_found_in_history` };
  if (!["ok", "success"].includes(String(match.state ?? "").toLowerCase())) {
    return { ok: false, reason: `${label}_not_ready: ${match.state ?? "unknown"}` };
  }
  const ext = String(match.type ?? match.extension ?? "").replace(/^\./, "").toLowerCase();
  if (ext !== "qza" && !/\.qza$/i.test(String(match.name ?? ""))) {
    return { ok: false, reason: `${label}_not_qza_artifact` };
  }
  return { ok: true, name: match.name ?? null, extension: ext || null, state: String(match.state) };
}

// Re-read the REAL job output association (GET only) to recover the source
// history when stored provenance does not record it. Nothing is assumed.
async function resolveImportedQzaHistory(adapter, prior, state, ctx, datasetId) {
  const jobId = safeString(prior?.provider_job_id, 200);
  if (!jobId) return { ok: false, reason: "provider_job_id_missing_for_history_resolution" };
  const outputs = await adapter.getJobOutputs({ job_id: jobId }, ctx);
  if (!outputs?.ok) {
    return { ok: false, reason: `job_outputs_unavailable: ${outputs?.error?.message ?? outputs?.error?.code ?? "unreadable"}` };
  }
  for (const association of outputs.outputs ?? []) {
    const id = safeString(association?.galaxyHdaId ?? association?.id, 200);
    const uuid = safeString(association?.galaxyDatasetUuid ?? association?.uuid, 200);
    const matchesId = Boolean(id && String(id) === String(datasetId));
    const matchesUuid = Boolean(uuid && String(uuid) === String(datasetId));
    if (!matchesId && !matchesUuid) continue;
    const historyId = safeString(association?.history_id, 200);
    if (!historyId) continue;
    const verified = await verifyQzaInHistory(adapter, id || datasetId, historyId, ctx, "resolved_job_output");
    if (verified.ok) return { ok: true, history_id: historyId, dataset_id: id || datasetId };
  }
  return { ok: false, reason: "no_ready_job_output_association_with_history" };
}

// Copy a verified cross-history qza into the run history with AT MOST TWO
// bounded attempts. One retry is allowed so a state that failed with the old
// request body can succeed with the verified contract. Called UNCONDITIONALLY
// for any resolved qza id: membership is proven by a real getArtifacts lookup,
// never by a recorded flag. `copy_dataset_id` stops any further copy once a
// copy id exists; `copy_attempt_count` caps attempts at two.
async function ensureQzaInRunHistory(adapter, state, ctx, prior, recovered) {
  const runHistory = safeString(state.history_id, 200);
  const originalId = safeString(recovered?.dataset_id ?? prior?.output_dataset_id
    ?? state.frontier?.importedSeqsId, 200);
  if (!originalId) return { ok: false, reason: "imported_qza_id_missing" };
  if (!runHistory) return { ok: false, reason: "copy_target_history_missing" };
  const existing = safeString(prior?.copy_dataset_id, 200);
  if (existing) {
    const verified = await verifyQzaInHistory(adapter, existing, runHistory, ctx, "copied_dataset");
    return verified.ok
      ? { ok: true, dataset_id: existing, copied: true, reused: true, verified }
      : { ok: false, reason: verified.reason, copy_dataset_id: existing };
  }
  // Prove membership in the RUN history before deciding anything.
  const inRun = await verifyQzaInHistory(adapter, originalId, runHistory, ctx, "imported_qza_in_run_history");
  if (inRun.ok) return { ok: true, dataset_id: originalId, copied: false, verified: inRun };
  if (/inventory_unavailable|inventory_threw|not_ready|not_qza_artifact/.test(inRun.reason)) {
    return { ok: false, reason: inRun.reason };
  }
  // Not found in the run history: the qza is foreign. Prefer recorded evidence,
  // otherwise re-query the real job output with GET only.
  let originalHistory = safeString(recovered?.output_history_id ?? prior?.output_history_id, 200);
  let sourceId = originalId;
  if (!originalHistory) {
    const resolved = await resolveImportedQzaHistory(adapter, prior, state, ctx, originalId);
    if (!resolved.ok) return { ok: false, reason: `history_evidence_unavailable: ${resolved.reason}` };
    originalHistory = resolved.history_id;
    sourceId = resolved.dataset_id;
  }
  if (String(originalHistory) === String(runHistory)) {
    return { ok: false, reason: `imported_qza_not_in_run_history: ${inRun.reason}` };
  }
  // Migrate the legacy boolean guard so a single prior failed attempt may be
  // retried exactly once with the corrected request body.
  const attempts = Number(prior?.copy_attempt_count ?? (prior?.copy_attempted ? 1 : 0)) || 0;
  if (attempts >= 2) {
    return { ok: false, reason: "qza_history_copy_attempt_limit_reached", copy_attempt_count: attempts };
  }
  const attemptCount = attempts + 1;
  let result;
  try {
    result = await adapter.copyDatasetToHistory({ dataset_id: sourceId, history_id: runHistory }, ctx);
  } catch (caught) {
    return { ok: false, reason: `qza_history_copy_threw: ${safeString(caught?.message ?? caught, 300)}`,
      copy_attempt_count: attemptCount };
  }
  const copiedId = safeString(result?.dataset_id, 200);
  const provenance = {
    copied_from_history: originalHistory || null,
    original_dataset_id: sourceId,
    copied_dataset_id: copiedId || null,
    target_history_id: safeString(result?.history_id, 200) || runHistory,
    copy_basis: "authenticated_hda_copy_into_run_history",
    at: nowIso()
  };
  if (!result?.ok || !copiedId) {
    return { ok: false, reason: `qza_history_copy_failed: ${result?.error?.message ?? result?.error?.code ?? "no_dataset_id_returned"}`,
      copy_attempt_count: attemptCount, copy_provenance: provenance };
  }
  const verified = await verifyQzaInHistory(adapter, copiedId, runHistory, ctx, "copied_dataset");
  return verified.ok
    ? { ok: true, dataset_id: copiedId, copied: true, verified, copy_dataset_id: copiedId,
      copy_attempt_count: attemptCount, copy_provenance: provenance }
    : { ok: false, reason: verified.reason, copy_dataset_id: copiedId,
      copy_attempt_count: attemptCount, copy_provenance: provenance };
}

async function prepareDemuxImport(adapter, env, db, row, state, ctx) {
  const markUnavailable = async (reason, detail = null) => {
    state.import = { ...(state.import ?? {}), status: "unavailable", reason, detail };
    state.errors.push({ step: "demux", reason, ...(detail ? { detail } : {}) });
    state.steps.demux = { status: "unavailable", reason: detail ?? reason };
    await recordStep(db, state, "demux", "unavailable", { details: { reason: detail ?? reason } });
  };

  const prior = state.import;
  const frontierId = safeString(state.frontier?.importedSeqsId, 200);
  const verifiedCopyId = safeString(prior?.copy_dataset_id, 200);
  const verifiedRunId = safeString(prior?.in_run_history_dataset_id, 200);
  // Only a copy already proven in the run history (or a legacy qza with no
  // import state) may skip the membership check. A previously recorded
  // output_dataset_id is NOT proof of run-history membership.
  if (frontierId && (!prior || frontierId === verifiedCopyId || frontierId === verifiedRunId)) {
    return { handled: false };
  }

  const applyEnsured = async (ensured) => {
    // Migrate the legacy boolean to a counter so a prior single failure still
    // counts as one of the two allowed attempts across polls.
    if (prior.copy_attempted && !Number.isFinite(prior.copy_attempt_count)) prior.copy_attempt_count = 1;
    delete prior.copy_attempted;
    if (Number.isFinite(ensured.copy_attempt_count)) {
      prior.copy_attempt_count = ensured.copy_attempt_count;
    }
    if (ensured.copy_dataset_id) prior.copy_dataset_id = ensured.copy_dataset_id;
    if (ensured.copy_provenance) {
      prior.copy = { ...ensured.copy_provenance, verified: Boolean(ensured.verified),
        reused: Boolean(ensured.reused) };
    } else if (prior.copy && ensured.verified) {
      prior.copy = { ...prior.copy, verified: true, reused: true };
    }
    if (ensured.ok) {
      state.frontier.importedSeqsId = ensured.dataset_id;
      if (!ensured.copied) {
        prior.in_run_history_verified = true;
        prior.in_run_history_dataset_id = ensured.dataset_id;
      }
      prior.status = "succeeded";
    } else {
      prior.status = "unavailable";
      prior.reason = `qza_history_copy_failed_or_unverified: ${ensured.reason}`;
      state.errors.push({ step: "demux", reason: prior.reason });
      // A failed copy with a retry still available must leave demux unstarted,
      // so the NEXT bounded status request can perform the single retry.
      const retryAvailable = /qza_history_copy_failed|qza_history_copy_threw/.test(ensured.reason)
        && Number(prior.copy_attempt_count ?? 0) < 2;
      if (!retryAvailable) {
        state.steps.demux = { status: "unavailable", reason: prior.reason };
        await recordStep(db, state, "demux", "unavailable", { details: { reason: prior.reason } });
      }
    }
    await persistState(db, row, state);
    return { handled: true };
  };
  // Finish a freshly recovered import: record provenance, then prove/copy into
  // the run history before exposing an id demux may reference.
  const finishRecovered = async (recovered) => {
    prior.status = "succeeded";
    prior.reason = null;
    prior.detail = null;
    prior.output_dataset_id = recovered.dataset_id;
    prior.output_history_id = recovered.output_history_id ?? null;
    prior.history_mismatch = recovered.history_mismatch;
    prior.recovery = recovered;
    prior.resolved_at = nowIso();
    const ensured = await ensureQzaInRunHistory(adapter, state, ctx, prior, recovered);
    return applyEnsured(ensured);
  };
  if (prior) {
    const resolvedId = safeString(prior.output_dataset_id ?? state.frontier?.importedSeqsId, 200);
    if (resolvedId) {
      // UNCONDITIONAL: even a previously resolved output_dataset_id must be
      // proven present in the run history before demux references it.
      const ensured = await ensureQzaInRunHistory(adapter, state, ctx, prior,
        { dataset_id: resolvedId, output_history_id: prior.output_history_id ?? null });
      return applyEnsured(ensured);
    }
    const jobId = safeString(prior.provider_job_id, 200);
    if (jobId) {
      // A REAL job already exists: resolve its output read-only, never submit
      // another import. This also covers a prior `unavailable` status whose
      // only failure was cross-history output resolution.
      const status = await adapter.getJobStatus({ job_id: jobId }, ctx);
      const observed = status.output?.structured?.state ?? status.status;
      const classified = classifyJobState(observed);
      if (classified === "running" || classified === "unknown") return { handled: true };
      if (classified === "failed") {
        prior.status = "failed";
        prior.reason = `qza import job ${jobId} ended in state ${observed}`;
        await markUnavailable(prior.reason);
        await persistState(db, row, state);
        return { handled: true };
      }
      const recovered = await recoverImportedQza(adapter, prior, state, ctx);
      if (recovered.ok) return finishRecovered(recovered);
      prior.status = "unavailable";
      prior.reason = `qza_import_output_resolution_failed: ${recovered.reason}`;
      prior.recovery = { ...recovered, ok: false };
      state.errors.push({ step: "demux", reason: prior.reason,
        ...(recovered.candidates?.length ? { detail: recovered.candidates } : {}) });
      state.steps.demux = { status: "unavailable", reason: prior.reason };
      await recordStep(db, state, "demux", "unavailable", { details: { reason: prior.reason } });
      await persistState(db, row, state);
      return { handled: true };
    }
    // No provider job and no output: a genuine failed preparation. It may be
    // retried after discovery; no provider job exists to recover here.
    if (prior.status === "unavailable" || prior.status === "failed") {
      state.steps.demux = { status: "unavailable", reason: prior.reason ?? prior.detail ?? "qza_import_unavailable" };
      await recordStep(db, state, "demux", "unavailable", { details: { reason: state.steps.demux.reason } });
      return { handled: true };
    }
    if (prior.status === "succeeded") {
      await markUnavailable("qza_import_output_missing", "The completed import job stored no qza dataset id.");
      return { handled: true };
    }
    await markUnavailable("qza_import_job_id_missing", "The import submission carried no provider job id.");
    return { handled: true };
  }

  const demuxTool = state.discovery?.tools?.demux;
  if (!demuxTool?.id) return { handled: false }; // existing unavailable path reports this
  let demuxSchema;
  try {
    demuxSchema = await fetchToolSchema(env, demuxTool.id, demuxTool.version);
  } catch { return { handled: false }; }
  if (!demuxRequiresQza(demuxSchema)) return { handled: false };

  const readsId = state.dataset_ids?.sequences;
  const barcodesId = state.dataset_ids?.barcodes;
  const readsName = state.filenames?.reads ?? null;
  const barcodesName = state.filenames?.barcodes ?? null;
  if (!readsId || !barcodesId) {
    await markUnavailable("qza_import_source_missing", "No uploaded reads/barcodes datasets are available for EMP import.");
    return { handled: true };
  }
  const importTool = state.discovery?.tools?.importTool;
  if (!importTool?.id) {
    await markUnavailable("qza_import_tool_unavailable", "No genuine QIIME 2 import tool was discovered; no tool id was invented.");
    return { handled: true };
  }
  let importSchema;
  try {
    importSchema = await fetchToolSchema(env, importTool.id, importTool.version);
  } catch (caught) {
    await markUnavailable("qza_import_schema_unavailable",
      `The live import schema could not be read: ${caught?.message ?? caught}`);
    return { handled: true };
  }
  let matched;
  try {
    matched = findImportFormatCase(importSchema);
  } catch (caught) {
    await markUnavailable("qza_import_schema_traversal_limit",
      `The live import schema exceeded the bounded traversal cap; no format case was guessed: ${safeString(caught?.message ?? caught, 300)}`);
    return { handled: true };
  }
  if (!matched) {
    await markUnavailable("qza_import_format_case_missing",
      "The live import schema does not expose the EMPSingleEndSequences + EMP Single End Directory Format EMP case; no value was invented.");
    return { handled: true };
  }
  const payload = buildImportPayload(importSchema, matched, { readsId, barcodesId, readsName, barcodesName });
  if (!payload.valid) {
    await markUnavailable(`qza_import_${payload.errors[0]}`,
      `The live import case could not be mapped unambiguously: ${payload.errors.join(", ")}.`);
    return { handled: true };
  }
  let submission;
  try {
    submission = await adapter.submitJob({ operation: "submit_job", tool_id: importTool.id,
      history_id: state.history_id ?? null, inputs: payload.inputs }, ctx);
  } catch (caught) {
    recordSubmissionFailure(state, env, "demux", importTool, payload, null, caught);
    await markUnavailable("qza_import_submission_failed", `Import submission failed: ${caught?.message ?? caught}`);
    return { handled: true };
  }
  if (submission.error) {
    recordSubmissionFailure(state, env, "demux", importTool, payload, submission);
    await markUnavailable("qza_import_submission_failed",
      `Import submission failed: ${submission.error.message ?? submission.error.code}`);
    return { handled: true };
  }
  state.import = {
    tool_id: importTool.id, tool_version: importTool.version ?? null,
    tool_name: importTool.name ?? null,
    provider_job_id: submission.provider_job_id ?? null,
    source_dataset_ids: { reads: readsId, barcodes: barcodesId },
    source_filenames: { reads: readsName, barcodes: barcodesName },
    format_value: matched.formatValue, type_value: payload.type_value ?? null,
    selector: payload.selector, selectors: payload.selectors ?? [],
    selection_basis: payload.selection_basis ?? null,
    case_evidence: payload.case_evidence ?? null,
    manifest_yaml_branch_excluded: matched.manifestYamlCase === false,
    mapping_basis: payload.mapping_basis ?? null, mapping: payload.mapping ?? null,
    mapping_evidence: payload.mapping_evidence ?? null,
    dataset_fields: payload.dataset_fields, submitted_at: nowIso(), status: "running",
    schema_source: "Galaxy io_details=true (full nested schema)",
    basis: "preparation_of_stored_inputs"
  };
  state.errors.push({ step: "demux", reason: "qza_import_submitted",
    detail: { tool_id: importTool.id, format_value: matched.formatValue, source_dataset_ids: state.import.source_dataset_ids } });
  await persistState(db, row, state);
  return { handled: true };
}

// ------------------------------------------------------ classifier qza prep
//
// Before taxonomy, prepare the OFFICIAL classifier as a real Galaxy history
// qza. A READ-ONLY inventory is checked first: a dataset with the official
// filename and matching checksum is reused with NO upload. Otherwise exactly
// one verified streamed download is imported by URL into the EXISTING history.
// state.classifier_prep is written before any await and persisted, so a second
// preparation can never run. `options.classifierDescriptor` is an OFFLINE TEST
// SEAM only (production handlers call this without it).

async function prepareClassifier(adapter, env, db, row, state, ctx, options = {}) {
  if (state.classifier_prep) return { handled: true, skipped: true };
  const descriptor = options.classifierDescriptor ?? QIIME_CLASSIFIER;
  const prep = { ...classifierProvenance(descriptor), status: "running",
    started_at: nowIso(), attempts: 1, dataset_id: null, history_id: null, job_id: null,
    computed_sha256: null };
  state.classifier_prep = prep; // guard set BEFORE any await
  const finish = async () => {
    prep.finished_at = nowIso();
    await persistState(db, row, state);
    return { handled: true, status: prep.status };
  };
  const inventory = await adapter.inventoryDatasets({}, ctx);
  prep.inventory = { ok: Boolean(inventory.ok), at: inventory.at ?? nowIso(),
    histories: inventory.histories ?? [], datasets_found: (inventory.datasets ?? []).length,
    reason: inventory.reason ?? null, error: inventory.error ?? null };
  const matched = inspectClassifierInventory(inventory, state.history_id, descriptor);
  prep.inventory_match = { verified: Boolean(matched.verified), candidates: matched.candidates,
    basis: matched.basis, reason: matched.reason };
  if (!inventory.ok) {
    prep.status = "unavailable";
    prep.reason = "inventory_unavailable: Galaxy inventory was unreadable; no classifier upload was attempted.";
    return finish();
  }
  if (matched.verified) {
    prep.status = "reused";
    prep.source = "read_only_inventory_reuse";
    prep.dataset_id = matched.verified.dataset_id;
    prep.history_id = matched.verified.history_id;
    prep.job_id = null;
    prep.computed_sha256 = matched.verified.checksum_exposed;
    prep.reason = null;
    return finish();
  }
  if (!state.history_id) {
    prep.status = "unavailable";
    prep.reason = "history_unavailable: the run has no existing Galaxy history; no classifier upload was attempted.";
    return finish();
  }
  const verification = await verifyRemoteSha256(ctx.fetch, descriptor.url, {
    expected_sha256: descriptor.expected_sha256, expected_bytes: descriptor.expected_bytes,
    chunkBytes: options.classifierChunkBytes ?? 1024 * 1024
  });
  prep.download = { ok: verification.ok, verified: verification.verified,
    computed_sha256: verification.computed_sha256, actual_bytes: verification.actual_bytes,
    expected_bytes: verification.expected_bytes, chunks: verification.chunks,
    source_url: verification.source_url, basis: verification.basis, reason: verification.reason };
  prep.computed_sha256 = verification.computed_sha256;
  if (!verification.ok) {
    prep.status = "unavailable";
    prep.reason = `classifier_verification_failed: ${verification.reason}`;
    return finish();
  }
  let upload;
  try {
    upload = await adapter.importUrlIntoHistory({
      url: descriptor.url, name: descriptor.filename, ext: "qza", history_id: state.history_id
    }, ctx);
  } catch (caught) {
    upload = { ok: false, error: { code: "url_import_threw", message: safeString(caught?.message ?? caught, 500) } };
  }
  prep.upload = { attempted: true, ok: Boolean(upload?.ok), error: upload?.error ?? null,
    provider: upload?.provider ?? null, status: upload?.status ?? null, at: nowIso() };
  if (!upload?.ok || !upload.dataset_id) {
    prep.status = "failed";
    prep.reason = `classifier_url_upload_failed: ${upload?.error?.message ?? upload?.error?.code ?? "no_dataset_id_returned"}`;
    return finish();
  }
  prep.status = "uploaded";
  prep.source = "verified_url_import_into_existing_history";
  prep.dataset_id = upload.dataset_id;
  prep.history_id = upload.history_id ?? state.history_id;
  prep.job_id = upload.job_id ?? null;
  prep.provider_job_id = upload.provider_job_id ?? null;
  prep.reason = null;
  return finish();
}

// Bounded, sanitized diagnostic for a failed provider submission. It records
// tool identity and FIELD NAMES ONLY: no payload values, no raw provider body,
// no URL with credentials, and each string is capped. Kept in state for the
// status/result diagnostics; never logged to the console.
const MAX_SUBMISSION_FAILURES = 12;
function recordSubmissionFailure(state, env, stepId, tool, payload, result, thrown = null) {
  const error = result?.error ?? (thrown
    ? { code: "submission_threw", message: safeString(thrown?.message ?? thrown, 300) } : {});
  const entry = {
    step_id: safeString(stepId, 80) || null,
    at: nowIso(),
    tool_id: safeString(tool?.id, 300) || null,
    tool_version: safeString(tool?.version, 100) || null,
    field_names: Object.keys(payload?.inputs ?? {}).slice(0, 50).map((name) => safeString(name, 200)),
    http_status: Number(error?.status) || null,
    error_code: safeString(error?.code, 80) || null,
    error_message: scrubDiagnosticText(error?.message ?? "", env).slice(0, 300),
    // Allowlisted only: a bounded, redacted excerpt of the provider's own
    // error text. Never the full response body, payload values or credentials.
    upstream_excerpt: error?.upstream_excerpt
      ? scrubDiagnosticText(error.upstream_excerpt, env).slice(0, 600) : null,
    basis: "sanitized_failed_submission_request_summary"
  };
  state.submission_failures = [...(state.submission_failures ?? []), entry].slice(-MAX_SUBMISSION_FAILURES);
  return entry;
}

async function submitStageInner(adapter, env, state, stepId, ctx) {
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
  // A prepared history qza satisfies the classifier input even when the live
  // schema exposes no select option; taxonomy is NOT skipped in that case.
  if (stepId === "taxonomy" && !state.classifier_prep?.dataset_id && !state.discovery.classifier?.available) {
    state.steps[stepId] = { status: "unavailable", reason: state.discovery.classifier?.reason
      ?? "No verified classifier dataset and no live classifier option were available." };
    return { skipped: true, reason: state.steps[stepId].reason };
  }
  const schema = await fetchToolSchema(env, toolMeta.id, toolMeta.version);
  const overrides = overridesFor(stepId, schema, state, { classifier: state.discovery.classifier });
  const payload = buildMicrobiomePayload(schema, rolesFor(stepId, state), overrides);
  if (!payload.valid) {
    recordSubmissionFailure(state, env, stepId, toolMeta, payload,
      { error: { code: "schema_failure", status: null, message: payload.errors.join(", ") } });
    throw new Error(`${stepId} schema failure: ${payload.errors.join(", ")}`);
  }
  // Persist demux column provenance even when the submission is rejected: the
  // live Galaxy error is the evidence for the 1-based numeric value.
  if (stepId === "demux" && overrides[DEMUX_COLUMN_PROVENANCE_KEY]) {
    state.steps[stepId] = { ...(state.steps[stepId] ?? {}),
      barcode_column: overrides[DEMUX_COLUMN_PROVENANCE_KEY] };
  }
  // The classifier dataset must land in a classifier/reference data field of
  // the LIVE schema. A bare qza field with no such evidence fails closed.
  if (stepId === "taxonomy" && state.classifier_prep?.dataset_id) {
    const classifierField = String(payload.dataset_fields?.classifier ?? "");
    if (!/classif|referen|database|rrna|silva|taxonomy/i.test(classifierField)) {
      throw new Error(`taxonomy schema failure: classifier data field was not identified (${classifierField || "none"})`);
    }
  }
  const submission = await adapter.submitJob({ operation: "submit_job", tool_id: toolMeta.id,
    history_id: state.history_id ?? null, inputs: payload.inputs }, ctx);
  if (submission.error) {
    recordSubmissionFailure(state, env, stepId, toolMeta, payload, submission);
    throw new Error(`${stepId} submission failed: ${submission.error.message ?? submission.error.code}`);
  }
  state.steps[stepId] = { status: "running", provider_job_id: submission.provider_job_id ?? null,
    tool_id: toolMeta.id, tool_version: toolMeta.version ?? null,
    applied_overrides: payload.applied_overrides, dataset_fields: payload.dataset_fields,
    started_at: nowIso(),
    ...(stepId === "demux" && overrides[DEMUX_COLUMN_PROVENANCE_KEY]
      ? { barcode_column: overrides[DEMUX_COLUMN_PROVENANCE_KEY] } : {}),
    ...(stepId === "taxonomy" && state.classifier_prep ? {
      classifier_dataset_id: state.classifier_prep.dataset_id ?? null,
      classifier_source: state.classifier_prep.source ?? null,
      classifier_digest: state.classifier_prep.computed_sha256 ?? null,
      classifier_provenance: {
        official_url: state.classifier_prep.official_url ?? QIIME_CLASSIFIER.url,
        filename: state.classifier_prep.filename ?? QIIME_CLASSIFIER.filename,
        expected_sha256: state.classifier_prep.expected_sha256 ?? QIIME_CLASSIFIER.expected_sha256,
        computed_sha256: state.classifier_prep.computed_sha256 ?? null,
        identity: state.classifier_prep.identity ?? QIIME_CLASSIFIER.identity,
        classifier_kind: state.classifier_prep.classifier_kind ?? QIIME_CLASSIFIER.classifier_kind,
        compatible_qiime2: state.classifier_prep.compatible_qiime2 ?? QIIME_CLASSIFIER.compatible_qiime2,
        limitations: [...(state.classifier_prep.limitations ?? QIIME_CLASSIFIER.limitations)]
      }
    } : {}) };
  return { skipped: false, provider_job_id: submission.provider_job_id };
}

async function submitStage(adapter, env, state, stepId, ctx) {
  return timed("submitStage", () => submitStageInner(adapter, env, state, stepId, ctx));
}

async function collectDenoise(state, collected, downloaded) {
  const freshTable = bestParsed(downloaded.artifacts, "feature_table");
  const freshRepSeqs = bestParsed(downloaded.artifacts, "rep_seqs");
  // An incremental slice may contain only one of several exported artifacts;
  // reuse tables parsed earlier in this run instead of resetting them.
  const table = freshTable.parsed.available ? freshTable.parsed
    : (state._parsed?.table?.available ? state._parsed.table : freshTable.parsed);
  const repSeqs = freshRepSeqs.parsed.available ? freshRepSeqs.parsed
    : (state._parsed?.repSeqs?.available ? state._parsed.repSeqs : freshRepSeqs.parsed);
  const denoiseStats = bestParsed(downloaded.artifacts, "qc");
  // Single canonical key: rolesFor() reads featureTableId for alpha/beta/pcoa.
  state.frontier.featureTableId = table.available
    ? downloaded.artifacts.find((artifact) => artifact.kind === "feature_table")?.id ?? state.frontier.featureTableId ?? null
    : state.frontier.featureTableId ?? null;
  state.frontier.repSeqsId = repSeqs.available
    ? downloaded.artifacts.find((artifact) => artifact.kind === "rep_seqs")?.id ?? state.frontier.repSeqsId ?? null
    : state.frontier.repSeqsId ?? null;
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
  const rarefaction = chooseRarefactionDepth(table, { metadata: { sample_ids: state.input?.sample_ids ?? [] } });
  state.params.rarefaction_depth = rarefaction.depth;
  state.results.rarefaction = rarefaction;
  state._parsed = { ...(state._parsed ?? {}), table, repSeqs };
  return { table, repSeqs };
}

// ---------------------------------------------------------- qza text export
//
// Several real QIIME 2 2026.1 tools return .qza (binary) datasets. They cannot
// be parsed by /get_content_as_text, so a genuinely DISCOVERED export tool must
// derive text first. This is a derivation of an already-executed tool output,
// never a new scientific analysis. No tool id, parameter or release is invented.

const EXPORTABLE_KINDS = Object.freeze([
  "feature_table", "rep_seqs", "taxonomy", "alpha", "distance_matrix", "pcoa", "qc"
]);
const EXPORT_KINDS_BY_STEP = Object.freeze({
  demux: ["qc"], qc_summary: ["qc"], dada2_denoise: ["feature_table", "rep_seqs", "qc"],
  taxonomy: ["taxonomy"], alpha_diversity: ["alpha"], beta_diversity: ["distance_matrix"], pcoa: ["pcoa"]
});
const MAX_EXPORTS_PER_STAGE = 3;

// Infer the intended artifact kind from the provider's own output name. This is
// a routing hint for the export only; the parsed result still comes from real
// exported text, never from the name itself.
function intendedExportKind(name) {
  const text = String(name ?? "").toLowerCase().replace(/\.qza$/, "");
  if (/feature.?table|(?:^|_)table$|^table$/.test(text)) return "feature_table";
  if (/rep(?:resentative)?[_-]?seq|repseq/.test(text)) return "rep_seqs";
  if (/taxonomy|classif/.test(text)) return "taxonomy";
  if (/(?:^|_)alpha|alpha[_-]/.test(text)) return "alpha";
  if (/distance|bray|jaccard|unifrac/.test(text)) return "distance_matrix";
  if (/pcoa|ordination|emperor|coordinates/.test(text)) return "pcoa";
  if (/stats|summary|quality|(?:^|_)qc(?:_|$)/.test(text)) return "qc";
  return null;
}

function exportFailure(state, stepId, reason, datasetId = null) {
  state.errors.push({ step: stepId, reason, ...(datasetId ? { dataset_id: datasetId } : {}) });
}

async function submitNeededExportsInner(adapter, env, state, stepId, jobId, collected, ctx) {
  // Exactly ONE bounded submission pass per stage. Later polls only inspect
  // jobs already tracked in state.exports/pending_exports.
  state.export_submissions = state.export_submissions ?? {};
  if (state.export_submissions[stepId]) return [];
  const needed = EXPORT_KINDS_BY_STEP[stepId] ?? [];
  if (!needed.length) return [];
  const present = new Set(collected.selected.map((artifact) => artifact.kind));
  const exportedKinds = new Set(Object.values(state.exports ?? {})
    .map((entry) => entry?.expected_kind).filter(Boolean));
  const missing = needed.filter((kind) => !present.has(kind) && !exportedKinds.has(kind)
    && EXPORTABLE_KINDS.includes(kind));
  const marker = { at: nowIso(), requested_kinds: [...missing], job_ids: [], status: "pending" };
  state.export_submissions[stepId] = marker;
  if (!missing.length) { marker.status = "not_needed"; return []; }
  const alreadyExported = new Set(Object.keys(state.exports ?? {}));
  const candidates = [];
  for (const artifact of collected.selected) {
    if (artifact.kind !== "qza_artifact" || alreadyExported.has(String(artifact.id))) continue;
    const kind = intendedExportKind(artifact.name);
    if (!kind || !missing.includes(kind)) continue;
    if (candidates.some((candidate) => candidate.kind === kind)) continue;
    candidates.push({ kind, artifact });
    if (candidates.length >= MAX_EXPORTS_PER_STAGE) break;
  }
  if (!candidates.length) { marker.status = "no_candidates"; return []; }

  const tool = state.discovery?.tools?.exportTool;
  if (!tool?.id) {
    exportFailure(state, stepId, "qza_export_unavailable: no genuine export tool was discovered; no tool id was invented.");
    marker.status = "unavailable";
    return [];
  }
  const submitted = [];
  for (const { kind, artifact } of candidates) {
    try {
      const schema = await fetchToolSchema(env, tool.id, tool.version);
      const payload = buildMicrobiomePayload(schema, [{ id: artifact.id, role: "artifact" }], {});
      if (!payload.valid) {
        exportFailure(state, stepId, `qza_export_payload_invalid: ${payload.errors.join(", ")}`, artifact.id);
        continue;
      }
      const result = await adapter.submitJob({ operation: "submit_job", tool_id: tool.id,
        history_id: state.history_id ?? null, inputs: payload.inputs }, ctx);
      if (result.error) {
        recordSubmissionFailure(state, env, stepId, tool, payload, result);
        exportFailure(state, stepId, `qza_export_submission_failed: ${result.error.message ?? result.error.code}`, artifact.id);
        continue;
      }
      const entry = {
        step_id: stepId, source_job_id: jobId, source_dataset_id: artifact.id, expected_kind: kind,
        provider_job_id: result.provider_job_id ?? null, tool_id: tool.id, tool_version: tool.version ?? null,
        submitted_at: nowIso()
      };
      submitted.push(entry);
      marker.job_ids.push(result.provider_job_id ?? null);
      state.exports = { ...(state.exports ?? {}), [String(artifact.id)]: { ...entry, status: "running" } };
    } catch (caught) {
      exportFailure(state, stepId, `qza_export_failed: ${caught?.message ?? caught}`, artifact.id);
    }
  }
  marker.status = submitted.length ? "submitted" : "failed";
  return submitted;
}

async function submitNeededExports(adapter, env, state, stepId, jobId, collected, ctx) {
  return timed("submitNeededExports", () => submitNeededExportsInner(adapter, env, state, stepId, jobId, collected, ctx));
}

async function pollPendingExports(adapter, state, stepId, ctx) {
  const allEntries = (state.pending_exports ?? []).filter((entry) => entry.step_id === stepId);
  if (!allEntries.length) return { done: true, artifacts: [], errors: [] };
  // Each export job is downloaded with the same bounded slice; polling all
  // finished jobs in one request avoids losing text from earlier exports.
  const entries = allEntries;
  const artifacts = [];
  const errors = [];
  for (const entry of entries) {
    const datasetKey = String(entry.source_dataset_id);
    if (!entry.provider_job_id) {
      exportFailure(state, stepId, "qza_export_job_id_missing", entry.source_dataset_id);
      if (state.exports?.[datasetKey]) state.exports[datasetKey].status = "failed";
      continue;
    }
    const status = await adapter.getJobStatus({ job_id: entry.provider_job_id }, ctx);
    const observed = status.output?.structured?.state ?? status.status;
    const classified = classifyJobState(observed);
    if (classified === "running" || classified === "unknown") return { done: false, artifacts: [], errors: [] };
    if (classified === "failed") {
      exportFailure(state, stepId, `qza_export_job_failed: provider job ${entry.provider_job_id} ended in state ${observed}`, entry.source_dataset_id);
      if (state.exports?.[datasetKey]) state.exports[datasetKey].status = "failed";
      continue;
    }
    const collected = await collectOutputs(adapter, entry.provider_job_id, state.history_id, ctx);
    const downloaded = await downloadSelected(adapter, collected.selected, stepId, ctx,
      { toolVersion: entry.tool_version, maxArtifacts: FINALIZE_MAX_ARTIFACTS_PER_POLL,
        maxBytes: FINALIZE_MAX_BYTES_PER_POLL });
    for (const artifact of downloaded.artifacts) {
      artifacts.push({ ...artifact, kind: entry.expected_kind, export_of: entry.source_dataset_id,
        export_tool_id: entry.tool_id, export_tool_version: entry.tool_version });
    }
    for (const error of downloaded.errors) errors.push({ step: stepId, ...error, export_of: entry.source_dataset_id });
    if (state.exports?.[datasetKey]) {
      state.exports[datasetKey] = { ...state.exports[datasetKey], status: "succeeded",
        exported_dataset_ids: downloaded.artifacts.map((artifact) => artifact.id) };
    }
  }
  state.pending_exports = (state.pending_exports ?? []).filter((entry) => entry.step_id !== stepId);
  return { done: true, artifacts, errors };
}

// Diversity values are either parsed from retrieved Galaxy/QIIME 2 artifacts
// or deterministically computed from the REAL retrieved feature table. Both
// paths are labelled here; no value comes from a fixture or a model guess.
function labelDiversity(result, state, sourceKind) {
  if (!result?.available) return result;
  const table = state._parsed?.table;
  return {
    ...result,
    source_kind: sourceKind,
    derived_from_retrieved_feature_table: Boolean(table?.available),
    feature_table_dataset_id: table?.available ? (state.frontier?.featureTableId ?? null) : null,
    basis_detail: "derived_from_retrieved_artifacts_or_real_feature_table_counts"
  };
}

// Apply retrieved artifact text to stage results. Split out so an incremental
// finalization can process one bounded slice at a time without redoing the
// provider calls, and so no value is ever invented when text is unavailable.
function applyStageArtifacts(state, stepId, downloaded, collected) {
  if (stepId === "demux") {
    const qzaOutputs = (collected?.selected ?? []).filter((artifact) =>
      artifact.kind === "qza_artifact" || /\.qza$/i.test(String(artifact.name ?? ""))
        || /\bqza\b/i.test(String(artifact.extension ?? "")));
    const perSample = qzaOutputs.find((artifact) => /per_sample_sequences/i.test(String(artifact.name ?? "")))
      ?? qzaOutputs.find((artifact) => /\bsequences?\b/i.test(String(artifact.name ?? "")))
      ?? qzaOutputs[0] ?? null;
    const errorDetails = qzaOutputs.find((artifact) => /error_correction_details/i.test(String(artifact.name ?? "")))
      ?? null;
    const fastq = downloaded.artifacts.find((artifact) => ["reads", "rep_seqs", "feature_table"].includes(artifact.kind));
    state.frontier.demuxReadsId = perSample?.id ?? fastq?.id ?? state.frontier.demuxReadsId ?? null;
    state.frontier.demuxErrorCorrectionDetailsId = errorDetails?.id
      ?? state.frontier.demuxErrorCorrectionDetailsId ?? null;
    state.steps[stepId] = { ...(state.steps[stepId] ?? {}),
      demux_output_provenance: {
        per_sample_sequences_dataset_id: perSample?.id ?? null,
        per_sample_sequences_name: perSample?.name ?? null,
        error_correction_details_dataset_id: errorDetails?.id ?? null,
        error_correction_details_name: errorDetails?.name ?? null,
        basis: "real_demux_job_output_qza",
        note: "The qza is consumed by QIIME 2 dada2 denoise-single; it is binary and is not parsed as text."
      } };
    const stats = bestParsed(downloaded.artifacts, "qc");
    recordParseLimits(state, stats.limits);
    state.results.qc = stats.parsed.available ? stats.parsed
      : (state.results.qc?.available ? state.results.qc : observedQc(state));
  } else if (stepId === "qc_summary") {
    const stats = bestParsed(downloaded.artifacts, "qc");
    recordParseLimits(state, stats.limits);
    state.results.qc = stats.parsed.available ? stats.parsed
      : (state.results.qc?.available ? state.results.qc : observedQc(state));
  } else if (stepId === "dada2_denoise") {
    collectDenoise(state, collected, downloaded);
  } else if (stepId === "taxonomy") {
    const taxonomy = bestParsed(downloaded.artifacts, "taxonomy");
    recordParseLimits(state, taxonomy.limits);
    state.results.taxonomy = taxonomy.parsed;
    state._parsed = { ...(state._parsed ?? {}), taxonomy: taxonomy.parsed };
  } else if (stepId === "alpha_diversity") {
    const alpha = bestParsed(downloaded.artifacts, "alpha");
    recordParseLimits(state, alpha.limits);
    if (!state.results.alpha?.available || alpha.parsed.available) {
      state.results.alpha = labelDiversity(
        alpha.parsed.available ? alpha.parsed : computeAlphaFromTable(state._parsed?.table), state, "alpha");
    }
  } else if (stepId === "beta_diversity") {
    const distance = bestParsed(downloaded.artifacts, "distance_matrix");
    recordParseLimits(state, distance.limits);
    if (!state.results.beta?.available || distance.parsed.available) {
      state.results.beta = labelDiversity(
        distance.parsed.available ? distance.parsed : computeBrayCurtis(state._parsed?.table), state, "beta");
    }
    if (distance.artifact) state.frontier.distanceMatrixId = distance.artifact.id;
  } else if (stepId === "pcoa") {
    const pcoa = bestParsed(downloaded.artifacts, "pcoa");
    recordParseLimits(state, pcoa.limits);
    if (!state.results.pcoa?.available || pcoa.parsed.available) {
      state.results.pcoa = labelDiversity(
        pcoa.parsed.available ? pcoa.parsed : computePcoa(state.results.beta), state, "pcoa");
    }
    if (pcoa.artifact) state.frontier.pcoaId = pcoa.artifact.id;
  }
}

function makeFinalizeQueue(stepId, jobId, collected) {
  const items = (collected.selected ?? []).map((artifact) => ({
    id: String(artifact.id), name: String(artifact.name ?? ""), kind: String(artifact.kind ?? ""),
    extension: String(artifact.extension ?? artifact.type ?? ""),
    state: String(artifact.state ?? ""), history_id: artifact.history_id ?? null,
    uuid: artifact.uuid ?? null
  }));
  const qzaIds = items.filter((item) => item.kind === "qza_artifact"
    || /\.qza$/i.test(item.name) || /\bqza\b/i.test(item.extension))
    .map((item) => ({ name: item.name, dataset_id: item.id, history_id: item.history_id, uuid: item.uuid }));
  return { step_id: stepId, job_id: jobId, items, qza_ids: qzaIds, cursor: 0,
    downloaded: [], errors: [], created_at: nowIso() };
}

// Process a small slice of a durable finalization queue. Text is never stored
// in state (only checksums/metadata); each slice is downloaded, inserted and
// applied inside one bounded request. Stage success is recorded only once the
// cursor has passed every selected artifact.
async function processFinalizeQueue(adapter, db, row, state, stepId, ctx, extraArtifacts = []) {
  const queue = state.finalize_queue;
  if (!queue || queue.step_id !== stepId) return false;
  const sliceArtifacts = [];
  let pollArtifacts = 0;
  let pollBytes = 0;
  while (queue.cursor < queue.items.length
      && pollArtifacts < FINALIZE_MAX_ARTIFACTS_PER_POLL
      && pollBytes < FINALIZE_MAX_BYTES_PER_POLL) {
    const slice = queue.items.slice(queue.cursor,
      queue.cursor + (FINALIZE_MAX_ARTIFACTS_PER_POLL - pollArtifacts));
    const eligible = slice.filter((item) => !(item.kind === "qza_artifact"
      || /\.qza$/i.test(item.name) || /\bqza\b/i.test(item.extension)));
    const downloaded = await downloadSelected(adapter, eligible, stepId, ctx, {
      maxArtifacts: FINALIZE_MAX_ARTIFACTS_PER_POLL, maxBytes: FINALIZE_MAX_BYTES_PER_POLL
    });
    for (const artifact of downloaded.artifacts) {
      await insertRow(db, SQL.insertArtifact, [makeId("art"), runIdOf(state), artifact.name, artifact.kind,
        `galaxy:${artifact.id}`, artifact.checksum, artifact.bytes, "text/plain", artifact.text, nowIso()]);
      queue.downloaded.push({ id: artifact.id, name: artifact.name, kind: artifact.kind,
        checksum: artifact.checksum, bytes: artifact.bytes });
      state.artifacts.push({ name: artifact.name, kind: artifact.kind, dataset_id: artifact.id,
        checksum: artifact.checksum, bytes: artifact.bytes, source_step: stepId,
        tool_version: state.steps[stepId]?.tool_version ?? null, extension: artifact.type ?? null });
      sliceArtifacts.push(artifact);
      pollArtifacts += 1;
      pollBytes += artifact.bytes;
    }
    for (const error of downloaded.errors) {
      queue.errors.push(error);
      state.errors.push({ step: stepId, ...error });
    }
    queue.cursor += slice.length;
    if (downloaded.reachedLimit) break;
  }
  if (["alpha_diversity", "beta_diversity", "pcoa"].includes(stepId)) {
    await rehydrateParsed(db, state, { force: Boolean(state.parsed_rehydrated && !state._parsed) });
  }
  const allArtifacts = [...sliceArtifacts, ...extraArtifacts];
  applyStageArtifacts(state, stepId, { artifacts: allArtifacts, errors: [] }, { selected: queue.items });
  const pendingRemaining = (state.pending_exports ?? []).filter((entry) => entry.step_id === stepId).length;
  // Exported qza text is stored in D1 as it arrives; rebuild the bounded parsed
  // view once the export set is drained so denoise results include every table.
  if (stepId === "dada2_denoise" && pendingRemaining === 0) {
    await rehydrateParsed(db, state, { force: true });
    applyStageArtifacts(state, stepId, { artifacts: allArtifacts, errors: [] }, { selected: queue.items });
  }
  if (queue.cursor >= queue.items.length && pendingRemaining > 0) {
    // Export text for this stage is still in flight; keep the stage open and
    // apply each finished export on a later bounded poll.
    await persistState(db, row, state);
    return false;
  }
  if (queue.cursor >= queue.items.length) {
    state.steps[stepId] = { ...(state.steps[stepId] ?? {}), status: "succeeded", finished_at: nowIso(),
      output_artifacts: [
        ...queue.downloaded.map((item) => ({ name: item.name, kind: item.kind,
          dataset_id: item.id, checksum: item.checksum })),
        ...queue.qza_ids.map((item) => ({ name: item.name, kind: "qza_artifact",
          dataset_id: item.dataset_id, checksum: null }))
      ],
      qza_dataset_ids: queue.qza_ids,
      ...(queue.downloaded.some((item) => item.export_of) ? { exports: queue.downloaded
        .filter((item) => item.export_of).map((item) => ({ source_dataset_id: item.export_of,
          exported_dataset_id: item.id, kind: item.kind, tool_id: item.export_tool_id ?? null,
          tool_version: item.export_tool_version ?? null, basis: "derived_from_executed_tool_output" })) } : {}),
      basis: "retrieved_provider_outputs_incremental_finalization"
    };
    state.pending_exports = (state.pending_exports ?? []).filter((entry) => entry.step_id !== stepId);
    await recordStep(db, state, stepId, "succeeded", { details: state.steps[stepId] });
    delete state.finalize_queue;
    return true;
  }
  await persistState(db, row, state);
  return false;
}

async function finalizeStageInner(adapter, env, db, row, state, stepId, jobId, ctx, options = {}) {
  const toolMeta = state.steps[stepId]?.tool_id ? { id: state.steps[stepId].tool_id, version: state.steps[stepId].tool_version } : null;
  // Diversity fallbacks compute from the REAL retrieved feature table. Reuse
  // the once-per-state parsed view rather than parsing on every poll.
  if (["dada2_denoise", "alpha_diversity", "beta_diversity", "pcoa"].includes(stepId)) {
    await rehydrateParsed(db, state, { force: Boolean(state.parsed_rehydrated && !state._parsed) });
  }
  let collected = { selected: [], errors: [] };
  let downloaded = { artifacts: [], errors: [] };
  if (options.prefetched) {
    downloaded = { artifacts: options.prefetched, errors: options.prefetchedErrors ?? [] };
  } else if (jobId) {
    collected = options.collected ?? await collectOutputs(adapter, jobId, state.history_id, ctx);
    // QIIME 2 .qza outputs are binary: text export is only attempted when a
    // discovered export tool was explicitly submitted for them. Downloading
    // them here only produces `content_unavailable` noise.
    const textEligible = collected.selected.filter((artifact) =>
      !(artifact.kind === "qza_artifact" || /\bqza\b/i.test(String(artifact.extension ?? ""))));
    downloaded = await downloadSelected(adapter, textEligible, stepId, ctx, { toolVersion: toolMeta?.version ?? null });
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
  applyStageArtifacts(state, stepId, downloaded, collected);
  const exportProvenance = downloaded.artifacts.filter((artifact) => artifact.export_of).map((artifact) => ({
    source_dataset_id: artifact.export_of, exported_dataset_id: artifact.id, kind: artifact.kind,
    tool_id: artifact.export_tool_id ?? null, tool_version: artifact.export_tool_version ?? null,
    basis: "derived_from_executed_tool_output"
  }));
  state.steps[stepId] = { ...(state.steps[stepId] ?? {}), status: "succeeded", finished_at: nowIso(),
    output_artifacts: downloaded.artifacts.map((artifact) => ({ name: artifact.name, kind: artifact.kind,
      dataset_id: artifact.id, checksum: artifact.checksum })),
    ...(exportProvenance.length ? { exports: exportProvenance } : {}) };
  await recordStep(db, state, stepId, "succeeded", { details: state.steps[stepId] });
}

async function finalizeStage(adapter, env, db, row, state, stepId, jobId, ctx, options = {}) {
  return timed("finalizeStage", () => finalizeStageInner(adapter, env, db, row, state, stepId, jobId, ctx, options));
}

function runIdOf(state) {
  return String(state.run_id ?? "");
}

// A single poll must never re-parse every stored artifact: the Worker has a
// hard CPU limit. Rehydration happens at most once per state, only when a local
// computation or the terminal result actually needs parsed tables.
const MAX_PARSE_CHARS = 256 * 1024;
// `report` is excluded: it needs no parsed table, and the terminal result
// performs the single final rehydration for exports/integrity.
const LOCAL_COMPUTE_STEPS = new Set([
  "composition", "alpha_diversity", "beta_diversity", "pcoa", "ordination"
]);

function needsParsedFor(stepId, state) {
  if (!LOCAL_COMPUTE_STEPS.has(stepId)) return false;
  const providerRole = { alpha_diversity: "alpha", beta_diversity: "beta", pcoa: "pcoa" }[stepId];
  // A provider stage does not need a local table parse on a polling request.
  if (providerRole && state.discovery?.tools?.[providerRole]?.id) return false;
  return true;
}

async function rehydrateParsed(db, state, options = {}) {
  // `_parsed` is intentionally not persisted (large tables). The durable marker
  // prevents repeated DB reads on later polls. The terminal result forces one
  // final rebuild so exports/integrity still use the real stored artifacts.
  if (!options.force && (state._parsed || state.parsed_rehydrated)) return;
  const rows = await listRows(db, SQL.listArtifactsForRun, [state.run_id]);
  const parsed = {};
  const limits = [];
  for (const row of rows) {
    const kind = String(row.kind ?? "");
    const text = String(row.content ?? "");
    if (!text) continue;
    if (text.length > MAX_PARSE_CHARS) {
      // Never burn CPU on an oversized artifact; report the honest reason and
      // keep the workflow advancing with no fabricated values.
      limits.push({ kind, name: row.name ?? null, chars: text.length,
        reason: `artifact_exceeds_${MAX_PARSE_CHARS}_character_local_parse_bound` });
      continue;
    }
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
  if (limits.length) {
    state.parse_limits = [...(state.parse_limits ?? []), ...limits].slice(-12);
  }
  state._parsed = parsed;
  state.parsed_rehydrated = true;
  state._parsed_rehydrated_at = nowIso();
}

function localStage(state, stepId) {
  if (stepId === "composition") {
    // Once computed from real parsed artifacts the summary is persisted; do
    // not rebuild it on every poll.
    if (state.results.composition?.available) return state.results.composition;
    const composition = aggregateByRank(state._parsed?.table, state._parsed?.taxonomy, { rank: "phylum" });
    state.results.composition = composition;
    return composition;
  }
  if (stepId === "alpha_diversity") {
    if (!state.results.alpha?.available) {
      state.results.alpha = labelDiversity(computeAlphaFromTable(state._parsed?.table), state, "alpha");
    }
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

export async function buildResult(state) {
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
  const prep = state.classifier_prep ?? null;
  const rarefaction = state.results.rarefaction ?? null;
  const classifierLine = prep
    ? `Classifier preparation: ${prep.status} (${prep.source ?? "no source"}); identity ${prep.identity}; ` +
      `${prep.classifier_kind}; compatible QIIME 2 ${prep.compatible_qiime2}; official URL ${prep.official_url}; ` +
      `expected SHA-256 ${prep.expected_sha256}; expected bytes ${prep.expected_bytes}; ` +
      `computed SHA-256 ${prep.computed_sha256 ?? "not computed"}; ` +
      `dataset ${prep.dataset_id ?? "none"}; history ${prep.history_id ?? "none"}; job ${prep.job_id ?? "none"}.`
    : `Classifier preparation: not recorded; classifier: ${state.discovery.classifier?.available
      ? state.discovery.classifier.option_label : state.discovery.classifier?.reason}`;
  const excludedText = (rarefaction?.excluded ?? []).map((entry) =>
    `${entry.sample_id} (${entry.reason})`).join(", ") || "none";
  const result = {
    workflow_type: "microbiome", run_id: state.run_id, plan_id: state.plan_id,
    status: state.status, input: state.input, input_sha256: state.input_sha256,
    metadata_sha256: state.metadata_sha256,
    params: state.params, tools: state.discovery.tools, classifier: state.discovery.classifier,
    classifier_prep: prep, rarefaction,
    diversity_basis: {
      alpha: state.results.alpha?.basis ?? null, beta: state.results.beta?.basis ?? null,
      pcoa: state.results.pcoa?.basis ?? null,
      note: "Diversity derives only from retrieved Galaxy/QIIME 2 artifacts or deterministic computations on the retrieved feature table; no rooted tree or forced phylogenetic core-metrics pipeline is required."
    },
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
      classifierLine,
      `Rarefaction depth: ${rarefaction?.depth ?? "not chosen"}; basis ${rarefaction?.basis ?? "none"}; ` +
        `included ${rarefaction?.included?.length ?? 0} sample(s); excluded ${excludedText}.`,
      `Diversity basis: alpha ${state.results.alpha?.basis ?? "unavailable"}; beta ${state.results.beta?.basis ?? "unavailable"}; ` +
        `PCoA ${state.results.pcoa?.basis ?? "unavailable"}; derived from retrieved artifacts / real feature-table counts.`,
      `Integrity: ${validateFeatureTableIntegrity({ table: state._parsed?.table, repSeqs: state._parsed?.repSeqs,
        taxonomy: state._parsed?.taxonomy, metadata: { sample_ids: state.input.sample_ids } }).valid ? "passed" : "failed"}.`,
      "No statistical significance or differential-abundance claim is made by this workflow."
    ].join("\n"),
    limitations: [
      "No statistical significance, group separation or differential-abundance claim is made by this workflow.",
      "Relative abundance is computed from actual feature-table counts; unclassified features are retained.",
      "Faith's PD is null unless a valid rooted tree was retrieved; no rooted tree or phylogenetic core-metrics pipeline is required.",
      "qza artifacts are binary; only exported text was parsed, with failures recorded above.",
      prep
        ? `Classifier: ${prep.identity} (${prep.classifier_kind}); official URL ${prep.official_url}; ` +
          `expected SHA-256 ${prep.expected_sha256}; expected size ${prep.expected_bytes} bytes; ` +
          `computed SHA-256 ${prep.computed_sha256 ?? "not computed"}; ` +
          `compatible QIIME 2 ${prep.compatible_qiime2}.`
        : "No verified classifier provenance was recorded; no release or checksum was guessed.",
      ...(prep?.limitations ?? QIIME_CLASSIFIER.limitations),
      `Rarefaction depth is derived from real post-denoising per-sample counts; ${rarefaction?.excluded?.length ?? 0} sample(s) were excluded with reasons: ${excludedText}.`
    ],
    execution_mode: state.execution_mode ?? "real",
    reopen: { ai_run_id: state.run_id, ai_run_url: `/api/ai/runs/${state.run_id}`,
      recovery_url: `/api/ai/runs/${state.run_id}/recovery`, plan_id: state.plan_id }
  };
  result.exports = await timed("buildExports", async () => buildExports(state, result.report));
  return result;
}

async function advanceOneStageInner(db, row, state, env, ctx, options = {}) {
  const stepId = state.current_step;
  if (!stepId) return;
  const step = state.steps[stepId] ?? {};
  if (step.status === "succeeded" || step.status === "unavailable") {
    const index = STEP_IDS.indexOf(stepId);
    state.current_step = STEP_IDS[index + 1] ?? null;
    return;
  }
  if (step.status === "failed") return;
  const adapter = await timed("createAdapter", async () => createAdapter(env));
  // A succeeded demux from an older finalization may have no frontier id.
  // Repair it before any later stage builds its payload, without replaying the
  // demux job or reading binary qza as text.
  if (!["import_reads", "demux"].includes(stepId)) {
    await repairDemuxFrontier(adapter, state, ctx);
  }

  if (stepId === "import_reads") {
    if (!step.provider_job_id) {
      state.status = "failed";
      state.errors.push({ step: stepId, reason: "import_provider_job_missing" });
      return;
    }
    const status = await timed("getJobStatus", async () => adapter.getJobStatus({ job_id: step.provider_job_id }, ctx));
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
    const status = await timed("getJobStatus", async () => adapter.getJobStatus({ job_id: step.provider_job_id }, ctx));
    const classified = classifyJobState(status.output?.structured?.state ?? status.status);
    if (classified === "running" || classified === "unknown") return;
    if (classified === "failed") {
      state.status = "failed";
      state.errors.push({ step: stepId, reason: `provider job ${step.provider_job_id} ended in state ${status.output?.structured?.state ?? status.status}` });
      await recordStep(db, state, stepId, "failed", { details: { reason: state.errors.at(-1).reason } });
      return;
    }

    // Create a DURABLE queue once per succeeded job. Every later poll processes
    // only a small slice, so no single request finalizes a large artifact set.
    if (!state.finalize_queue || state.finalize_queue.step_id !== stepId
        || state.finalize_queue.job_id !== step.provider_job_id) {
      const collected = await collectOutputs(adapter, step.provider_job_id, state.history_id, ctx);
      const submitted = await submitNeededExports(adapter, env, state, stepId, step.provider_job_id, collected, ctx);
      // Create the durable queue even when an export was submitted: later
      // polls poll that export BEFORE processing the artifact slice.
      state.finalize_queue = makeFinalizeQueue(stepId, step.provider_job_id, collected);
      if (submitted.length) state.pending_exports = [...(state.pending_exports ?? []), ...submitted];
      await persistState(db, row, state);
      return;
    }

    // Submit any still-missing export kinds one at a time; state.exports and
    // exportedKinds prevent a second submission for the same source/kind.
    const stillNeeded = await submitNeededExports(adapter, env, state, stepId, step.provider_job_id,
      { selected: state.finalize_queue.items }, ctx);
    if (stillNeeded.length) {
      state.pending_exports = [...(state.pending_exports ?? []), ...stillNeeded];
    }
    const pendingTextArtifacts = [];
    if ((state.pending_exports ?? []).some((entry) => entry.step_id === stepId)) {
      const pending = await pollPendingExports(adapter, state, stepId, ctx);
      if (!pending.done) {
        await persistState(db, row, state);
        return;
      }
      for (const artifact of pending.artifacts) {
        await insertRow(db, SQL.insertArtifact, [makeId("art"), runIdOf(state), artifact.name,
          artifact.kind, `galaxy:${artifact.id}`, artifact.checksum, artifact.bytes, "text/plain",
          artifact.text, nowIso()]);
        state.finalize_queue.downloaded.push({ id: artifact.id, name: artifact.name, kind: artifact.kind,
          checksum: artifact.checksum, bytes: artifact.bytes, export_of: artifact.export_of ?? null,
          export_tool_id: artifact.export_tool_id ?? null, export_tool_version: artifact.export_tool_version ?? null });
        state.artifacts.push({ name: artifact.name, kind: artifact.kind, dataset_id: artifact.id,
          checksum: artifact.checksum, bytes: artifact.bytes, source_step: stepId,
          tool_version: artifact.export_tool_version ?? null, extension: artifact.type ?? null });
        pendingTextArtifacts.push(artifact);
      }
      for (const error of pending.errors) state.errors.push(error);
      // Export text and queue slices share the same per-poll download budget;
      // never do both in one request.
      await persistState(db, row, state);
      return;
    }
    await processFinalizeQueue(adapter, db, row, state, stepId, ctx, pendingTextArtifacts);
    return;
  }

  if (!step.status) {
    if (stepId === "taxonomy") {
      // Exactly one bounded preparation. state.classifier_prep is the durable
      // guard, so a refresh/status replay can never start a second download.
      try {
        await prepareClassifier(adapter, env, db, row, state, ctx, options);
      } catch (caught) {
        if (state.classifier_prep) {
          state.classifier_prep.status = "unavailable";
          state.classifier_prep.reason = `classifier_prep_error: ${safeString(caught?.message ?? caught, 500)}`;
        }
        throw caught;
      }
    }
    if (stepId === "demux") {
      const prepared = await prepareDemuxImport(adapter, env, db, row, state, ctx);
      if (prepared.handled) return;
    }
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
        const reason = safeString(caught?.message ?? caught, 500);
        // A bounded-schema overflow is non-fatal: no job was submitted and no
        // payload was guessed. Record the exact reason and keep advancing.
        if (/schema_traversal_node_limit/.test(reason)) {
          state.steps[stepId] = { status: "unavailable", reason, finished_at: nowIso() };
          state.errors.push({ step: stepId, reason: `schema_traversal_limit: ${reason}` });
          await recordStep(db, state, stepId, "unavailable", { details: { reason } });
          return;
        }
        // A qc_summary schema/data mismatch is non-fatal: no provider job was
        // created and no QC value was fabricated. Mark it unavailable and let
        // later stages run from the real retrieved artifacts.
        if (stepId === "qc_summary"
            && /schema failure|no_data_input|invalid option|submission failed: galaxy returned HTTP 400/i.test(reason)) {
          state.steps[stepId] = { status: "unavailable", reason, finished_at: nowIso() };
          state.errors.push({ step: stepId, reason: `qc_summary_unavailable: ${reason}` });
          await recordStep(db, state, stepId, "unavailable", { details: { reason } });
          return;
        }
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

async function advanceOneStage(db, row, state, env, ctx, options = {}) {
  return timed("advanceOneStage", () => advanceOneStageInner(db, row, state, env, ctx, options));
}

export async function handleStatus(request, env, options = {}) {
  const rejected = requireMethod(request, "GET", "GET, OPTIONS");
  if (rejected) return rejected;
  const db = getDb(env);
  if (!db) return errorResponse("AI database binding is unavailable.", 503, request);
  const row = await timed("getRunByReference", async () => getRunByReference(db, request));
  if (!row) return errorResponse("No stored microbiome run matches this reference.", 404, request);
  const parseStarted = Date.now();
  let state = parseJson(row.state_json);
  diag("parseJson(state)", parseStarted);
  if (!state) return errorResponse("The stored run has no state record; nothing was reconstructed.", 409, request);
  const ctx = ctxFor(env, options);
  // Do NOT rehydrate on provider polls: step status comes only from stored
  // state and the provider, and re-parsing artifacts on every poll exceeded
  // the Worker CPU limit on the live run.
  if (state.status === "running" && needsParsedFor(state.current_step, state)) {
    // Already-computed local summaries need no reopening of artifact text.
    const computed = ["composition", "alpha", "beta", "pcoa", "ordination"]
      .some((key) => state.results?.[key]?.available);
    const rehydrateStarted = Date.now();
    await rehydrateParsed(db, state, { force: Boolean(state.parsed_rehydrated && !state._parsed && !computed) });
    diag("rehydrateParsed/call", rehydrateStarted);
  } else {
    diag("rehydrateParsed/skip", Date.now());
  }
  if (state.status === "running" && state.current_step) {
    state.poll_count = Math.min((state.poll_count ?? 0) + 1, LIMITS.maxProviderPolls);
    try {
      await advanceOneStage(db, row, state, env, ctx, options);
      if (!state.current_step && state.status === "running") {
        // The terminal result is the ONLY place that rebuilds exports; parsed
        // tables are rehydrated at most once from stored artifacts.
        const terminalRehydrate = Date.now();
        await rehydrateParsed(db, state, { force: true });
        diag("rehydrateParsed/terminal", terminalRehydrate);
        state.status = "succeeded";
        const result = await timed("buildResult", async () => buildResult(state));
        await runStatement(db, SQL.saveJobResult, ["succeeded", nowIso(), JSON.stringify(result),
          JSON.stringify(state.validation), null, JSON.stringify(result.provenance),
          JSON.stringify({ report_url: `/api/ai/runs/${state.run_id}/report` }), envExecutionMode(env),
          state.run_id, "running"]);
        await timed("persistState", async () => persistState(db, row, state, result));
      } else {
        await timed("persistState", async () => persistState(db, row, state));
      }
    } catch (caught) {
      state.status = "failed";
      state.errors.push({ step: state.current_step, reason: caught?.message ?? String(caught) });
      await timed("persistState", async () => persistState(db, row, state));
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
    microbiomeRetry: (context) => handleRetry(context.request, context.env, { fetchImpl: context.env?.FETCH_IMPL }),
    microbiomeRefreshDiscovery: (context) => handleRefreshDiscovery(context.request, context.env,
      { fetchImpl: context.env?.FETCH_IMPL }),
    microbiomeResumeStages: (context) => handleResumeStages(context.request, context.env,
      { fetchImpl: context.env?.FETCH_IMPL }),
    microbiomeContinueStages: (context) => handleContinueStages(context.request, context.env, {}),
    microbiomeImportSchema: (context) => handleImportSchema(context.request, context.env,
      { fetchImpl: context.env?.FETCH_IMPL }),
    microbiomeStatus: (context) => handleStatus(context.request, context.env, {}),
    microbiomeResult: (context) => handleResult(context.request, context.env)
  };
}
