// M7.13 protein workflow handlers. All external calls happen here, on the
// server; the browser only talks to these Worker routes.

import {
  SQL, errorResponse, getDb, getRow, hashInput, insertRow, jsonResponse,
  listRows, makeId, nowIso, parseJson, readJsonBody, requireMethod, safeString
} from "../ai/_lib.js";
import {
  ENDPOINTS, LIMITS, PROTEIN_PROVIDER_VERSION, batchMatches, createProviderCache,
  fetchEntryGo, getIprscanResult, getIprscanStatus, hasContactEmail,
  lookupMatches, normalizeAccession, normalizeGoTerms, parseProteinFasta,
  proteinMd5, resolveAccession, routeBUnavailable, submitIprscan6,
  validateProteinSequence, collectReleases
} from "./provider.js";
import { ROUTE_LABELS, parseIprscan6Result, parseMatchesAnnotation } from "./parser.js";
import { buildProteinReport, finalizeProteinRun, persistProteinRun, readStoredResult } from "./runs.js";

const ROUTES = new Set(["precomputed", "iprscan6"]);

function fetchContext(env, options) {
  const fetchImpl = options?.fetchImpl ?? env?.FETCH_IMPL ?? globalThis.fetch;
  return { fetch: fetchImpl };
}

function routeLabel(route) {
  return route === "iprscan6" ? ROUTE_LABELS.iprscan6 : ROUTE_LABELS.precomputed;
}

// The dedupe key is always (sequence MD5, route); a running executed job is
// additionally keyed by its real provider job id. A precomputed reference run
// can therefore never satisfy a Route B request, or vice versa.
function proteinDedupeKey(md5Key, route, providerJobId = null) {
  return `${String(md5Key ?? "").toUpperCase()}|${route}${providerJobId ? `|${providerJobId}` : ""}`;
}

function storedRouteMatches(stored, route) {
  if (!stored) return true;
  return stored.requested_route === route && stored.route_label === routeLabel(route);
}

function finalStateOf(stored) {
  return stored?.status === "failed" ? "failed" : "succeeded";
}

function observedStateOf(stored) {
  return stored?.provider_state ?? (finalStateOf(stored) === "failed" ? "FAILED" : "FINISHED");
}

// Rebuild the exact original input from the plan written at submission time.
// No sequence bytes are ever reconstructed from memory or from a screenshot.
function inputFromPlan(plan, md5, protein = null) {
  const stored = plan?.input && typeof plan.input === "object" ? plan.input : null;
  return {
    mode: stored?.mode ?? plan?.mode ?? "fasta",
    accession: stored?.accession ?? plan?.accession ?? null,
    filename: stored?.filename ?? plan?.filename ?? "protein.fasta",
    objective: stored?.objective ?? plan?.goal ?? null,
    fasta_text: typeof stored?.fasta_text === "string" ? stored.fasta_text : "",
    input_sha256: stored?.input_sha256 ?? null,
    md5: stored?.md5 ?? md5,
    sequences: Array.isArray(stored?.sequences) ? stored.sequences
      : [{ id: "protein_1", length: protein?.protein_length ?? null, md5, ambiguous: [] }]
  };
}

function errorBody(error, request, fallbackStatus = 502) {
  const code = error?.code ?? "protein_provider_error";
  return jsonResponse({
    error: String(error?.message ?? error),
    error_code: code,
    provider_status: error?.status ?? null,
    workflow_completed: false,
    execution_mode: "real"
  }, error?.status && error.status >= 400 && error.status < 600 ? error.status : fallbackStatus, request);
}

async function prepareInput(payload, { ctx, cache }) {
  const mode = payload?.mode === "accession" || (payload?.accession && !payload?.fasta_text)
    ? "accession"
    : "fasta";
  let fastaText = null;
  let records = [];
  let metadata = null;
  let metadataReason = null;
  if (mode === "accession") {
    metadata = await resolveAccession(payload.accession, { ctx, cache });
    fastaText = metadata.fasta_text;
    records = [metadata.record];
    metadataReason = metadata.interpro_reason;
  } else {
    const text = payload?.fasta_text ?? payload?.sequence ?? "";
    const parsed = parseProteinFasta(text);
    if (!parsed.valid) {
      const error = new Error(parsed.errors.join(" "));
      error.code = "invalid_protein_input";
      error.status = 400;
      throw error;
    }
    // Preserve the exact submitted bytes (including any trailing newline) so
    // the stored "original FASTA" artifact is byte-for-byte identical.
    fastaText = typeof text === "string" ? text : String(text ?? "");
    records = parsed.records;
  }
  const md5Key = records.map((record) => String(record.md5).toUpperCase()).join(",").slice(0, 2000);
  const inputSha256 = await hashInput(fastaText);
  return {
    mode,
    accession: mode === "accession" ? normalizeAccession(payload.accession) : null,
    fasta_text: fastaText,
    filename: safeString(payload?.filename, 200) || (mode === "accession" ? `${normalizeAccession(payload.accession)}.fasta` : "protein.fasta"),
    objective: safeString(payload?.objective, 1000) || null,
    records,
    md5_key: md5Key,
    input_sha256: inputSha256,
    metadata,
    metadata_reason: metadataReason
  };
}

function emptyAnnotation(record, route, reasons) {
  return {
    route_label: routeLabel(route),
    md5: record.md5.toUpperCase(),
    protein_length: record.length,
    features: [], entries: [], sites: [], special_features: [],
    go: { terms: [], categories: { biological_process: [], molecular_function: [], cellular_component: [], unclassified: [] },
      reasons, basis: "no_source_evidence" },
    pathways: { items: [], reason: "Pathways were not reported because no matches were available." },
    releases: collectReleases([]),
    coverage: { protein_length: record.length, covered_residues: 0, fraction: 0, basis: "no_reported_locations" },
    counts: {}, missing_field_reasons: reasons, parser_version: "m7.13.1"
  };
}

async function enrichGo(annotation, { ctx, cache }) {
  const lookups = [];
  let suppressed = 0;
  for (const entry of annotation.entries.slice(0, LIMITS.maxGoLookupsPerRun)) {
    if (!entry.accession) continue;
    try {
      lookups.push([entry.accession, await fetchEntryGo(entry.accession, { ctx, cache })]);
    } catch {
      lookups.push([entry.accession, { terms: [], reason: `GO lookup for ${entry.accession} failed; no terms were added.` }]);
    }
    suppressed += 1;
  }
  return {
    lookups,
    suppressed: suppressed < annotation.entries.length
      ? `GO lookups were capped at ${LIMITS.maxGoLookupsPerRun} entries per run; remaining entries keep only source-reported GO terms.`
      : null
  };
}

async function annotatePrecomputed(input, { ctx, cache }) {
  const proteins = [];
  const notes = [];
  for (const record of input.records) {
    let lookup;
    try {
      lookup = await lookupMatches(record.md5, { ctx, cache });
    } catch (error) {
      const message = error?.message ?? String(error);
      proteins.push({ id: record.id, md5: record.md5, length: record.length, status: "failed",
        reason: message, error_code: error?.code ?? "matches_lookup_failed", route_label: routeLabel("precomputed"),
        annotation: emptyAnnotation(record, "precomputed", [message]), ambiguous: record.ambiguous,
        raw_provider_response: null });
      notes.push(`${record.id}: ${message}`);
      continue;
    }
    if (lookup.status !== "hit") {
      proteins.push({ id: record.id, md5: record.md5, length: record.length, status: "no_matches",
        reason: lookup.reason, route_label: routeLabel("precomputed"),
        annotation: emptyAnnotation(record, "precomputed", [lookup.reason]), ambiguous: record.ambiguous,
        raw_provider_response: null });
      continue;
    }
    const sourceGo = normalizeGoTerms(input.metadata?.interpro_metadata?.metadata?.go_terms ?? []);
    const base = parseMatchesAnnotation(lookup.body, {
      md5: record.md5,
      protein_length: record.length,
      route_label: ROUTE_LABELS.precomputed,
      go_terms: sourceGo.length ? { terms: sourceGo, reason: null } : null
    });
    const enrichment = await enrichGo(base, { ctx, cache });
    const annotation = parseMatchesAnnotation(lookup.body, {
      md5: record.md5,
      protein_length: record.length,
      route_label: ROUTE_LABELS.precomputed,
      go_terms: sourceGo.length ? { terms: sourceGo, reason: null } : null,
      go_enrichment: enrichment.lookups.map(([accession, value]) => [`entry:${accession}`, value])
    });
    if (enrichment.suppressed) annotation.missing_field_reasons.push(enrichment.suppressed);
    if (input.metadata_reason) annotation.missing_field_reasons.push(input.metadata_reason);
    const raw = JSON.stringify(lookup.body);
    proteins.push({
      id: record.id, md5: record.md5, length: record.length, status: "annotated",
      reason: null, route_label: ROUTE_LABELS.precomputed, annotation,
      ambiguous: record.ambiguous,
      raw_provider_response: raw.length > 256_000
        ? { truncated: true, reason: "provider response exceeded the 256 KB evidence cap", bytes: raw.length }
        : lookup.body
    });
  }
  const first = proteins.find((protein) => protein.annotation?.releases)?.annotation;
  return {
    proteins,
    releases: first?.releases ?? collectReleases([]),
    notes,
    status: proteins.some((protein) => protein.status === "failed") ? "failed" : "succeeded"
  };
}

function inputRecords(input) {
  return Array.isArray(input?.records) ? input.records : (Array.isArray(input?.sequences) ? input.sequences : []);
}

function validationFor(input) {
  const ambiguous = inputRecords(input).flatMap((record) => (record.ambiguous ?? []).map((item) => ({
    sequence: record.id, residue: item.residue, count: item.count
  })));
  return {
    status: "pass",
    checked_rules: ["protein_alphabet", "ambiguous_residues_documented", "duplicate_ids", "minimum_length",
      "maximum_length", "nucleotide_rejection", "md5_uppercase_ascii", "matches_md5_verified"],
    records: inputRecords(input).length,
    ambiguous_residues: ambiguous,
    errors: [],
    warnings: ambiguous.length
      ? [`${ambiguous.length} ambiguous residue occurrence type(s) retained; none were resolved.`] : []
  };
}

function provenanceFor(input, route, providerJobId, notes = []) {
  const entries = [
    { step_id: "protein_validate", tool_id: "protein.validate", tool_version: PROTEIN_PROVIDER_VERSION,
      status: "succeeded", source: "worker", detail: { records: inputRecords(input).length, md5: input.md5_key } },
    { step_id: "protein_resolve", tool_id: "protein.annotate", tool_version: PROTEIN_PROVIDER_VERSION,
      status: input.metadata ? "succeeded" : "not_needed",
      source: input.metadata ? "UniProt REST + InterPro protein metadata" : "inline FASTA",
      detail: { accession: input.accession, interpro_metadata: Boolean(input.metadata?.interpro_metadata) } },
    { step_id: "protein_annotate", tool_id: "protein.annotate", tool_version: PROTEIN_PROVIDER_VERSION,
      status: providerJobId ? "running" : "succeeded",
      source: route === "iprscan6" ? ENDPOINTS.iprscanBase : ENDPOINTS.matches("MD5"),
      provider_job_id: providerJobId, detail: { route_label: routeLabel(route), notes } },
    { step_id: "protein_report", tool_id: "protein.report", tool_version: PROTEIN_PROVIDER_VERSION,
      status: providerJobId ? "pending" : "succeeded", source: "worker", detail: { sections: 10 } }
  ];
  return entries;
}

function makeResult({ input, route, routeLabelValue, proteins, releases, notes = [], status = "succeeded",
  providerJobId = null, error = null, errorCode = null, runId, planId }) {
  return {
    run_id: runId,
    plan_id: planId,
    workflow_type: "protein",
    status,
    requested_route: route,
    route_label: routeLabelValue,
    provider_job_id: providerJobId,
    error,
    error_code: errorCode,
    input: {
      mode: input.mode,
      accession: input.accession,
      filename: input.filename,
      objective: input.objective,
      fasta_text: input.fasta_text,
      md5: input.md5_key,
      sequences: inputRecords(input).map((record) => ({
        id: record.id, length: record.length, md5: record.md5, ambiguous: record.ambiguous ?? []
      }))
    },
    input_sha256: input.input_sha256,
    proteins,
    releases,
    validation: validationFor(input),
    provenance: provenanceFor(input, route, providerJobId, notes),
    notes,
    execution_mode: "real",
    reopen: {
      ai_run_id: runId,
      ai_run_url: `/api/ai/runs/${runId}`,
      recovery_url: `/api/ai/runs/${runId}/recovery`,
      report_url: `/api/ai/runs/${runId}/report`,
      plan_id: planId
    }
  };
}

// ------------------------------------------------------------------ routes
export async function handlePlan(request, env, options = {}) {
  const rejected = requireMethod(request, "POST", "POST, OPTIONS");
  if (rejected) return rejected;
  const { payload, error } = await readJsonBody(request);
  if (error) return errorResponse(error, 400, request);
  const cache = createProviderCache();
  const ctx = fetchContext(env, options);
  let input;
  try {
    input = await prepareInput(payload, { ctx, cache });
  } catch (caught) {
    return errorBody(caught, request);
  }
  const email = hasContactEmail(env);
  return jsonResponse({
    workflow_type: "protein",
    plan: {
      steps: [
        { id: "protein_validate", tool_id: "protein.validate", tool_version: PROTEIN_PROVIDER_VERSION },
        { id: "protein_resolve", tool_id: "protein.annotate", tool_version: PROTEIN_PROVIDER_VERSION },
        { id: "protein_annotate", tool_id: "protein.annotate", tool_version: PROTEIN_PROVIDER_VERSION },
        { id: "protein_report", tool_id: "protein.report", tool_version: PROTEIN_PROVIDER_VERSION }
      ],
      route_availability: {
        precomputed: { available: true, label: ROUTE_LABELS.precomputed,
          source: ENDPOINTS.matches("MD5") },
        iprscan6: { available: Boolean(email), label: ROUTE_LABELS.iprscan6,
          reason: email ? null : "route_b_unavailable_no_contact_email: no server-side INTERPROSCAN_EMAIL is configured." }
      }
    },
    input: {
      mode: input.mode, accession: input.accession, filename: input.filename,
      md5: input.md5_key, input_sha256: input.input_sha256,
      sequences: input.records.map((record) => ({ id: record.id, length: record.length, md5: record.md5,
        ambiguous: record.ambiguous.map((item) => item.residue) }))
    },
    metadata: input.metadata ? {
      accession: input.metadata.accession,
      reviewed: input.metadata.uniprot.reviewed,
      entry_type: input.metadata.uniprot.entry_type,
      protein_name: input.metadata.uniprot.protein_name,
      organism: input.metadata.uniprot.organism,
      interpro_metadata_present: Boolean(input.metadata.interpro_metadata)
    } : null,
    metadata_reason: input.metadata_reason,
    constraints: { max_records: LIMITS.maxRecords, max_sequence_length: LIMITS.maxSequenceLength,
      min_sequence_length: LIMITS.minSequenceLength, max_polls: LIMITS.maxPolls },
    execution_mode: "real"
  }, 200, request);
}

export async function handleAnnotate(request, env, options = {}) {
  const rejected = requireMethod(request, "POST", "POST, OPTIONS");
  if (rejected) return rejected;
  const { payload, error } = await readJsonBody(request);
  if (error) return errorResponse(error, 400, request);
  const db = getDb(env);
  if (!db) return errorResponse("AI database binding is unavailable.", 503, request);
  const route = ROUTES.has(payload?.route) ? payload.route : "precomputed";
  const cache = createProviderCache();
  const ctx = fetchContext(env, options);
  let input;
  try {
    input = await prepareInput(payload, { ctx, cache });
  } catch (caught) {
    return errorBody(caught, request);
  }

  // Refresh-safe dedupe on (MD5, route), never MD5 alone. A stored Route A
  // run must not satisfy a Route B request: that request falls through to the
  // Route B branch, which fails closed when no contact email is configured.
  // Pick the newest matching run deterministically (the SQL orders ascending).
  const matchingRuns = await listRows(db, SQL.getProteinRunsByMd5AndRoute, [input.md5_key, route]);
  const existing = matchingRuns.at(-1) ?? null;
  if (existing && existing.route === route) {
    const stored = readStoredResult(existing);
    if (stored && storedRouteMatches(stored, route)) {
      return jsonResponse({ ...stored, deduped: true, dedupe_basis: "stored_protein_run_by_md5",
        dedupe_key: proteinDedupeKey(input.md5_key, route), dedupe_route: route }, 200, request);
    }
    // A running executed job is only reusable with its real provider job id;
    // no id means there is no genuine job to return.
    if (!stored && existing.provider_job_id && /^iprscan\d?-\S+$/.test(existing.provider_job_id)) {
      return jsonResponse({
        workflow_type: "protein", status: "running", deduped: true,
        dedupe_basis: "stored_protein_run_by_md5", run_id: existing.public_id,
        dedupe_key: proteinDedupeKey(input.md5_key, route, existing.provider_job_id),
        dedupe_route: route, provider_job_id: existing.provider_job_id,
        route_label: routeLabel(existing.route),
        status_url: `/api/ai/workflows/protein/status?run_id=${encodeURIComponent(existing.public_id)}`,
        result_url: `/api/ai/workflows/protein/result?run_id=${encodeURIComponent(existing.public_id)}`,
        error: null, execution_mode: "real"
      }, 202, request);
    }
  }

  const now = options.now ?? Date.now();
  const idFactory = options.idFactory;
  const runId = makeId("job", idFactory);
  const planId = makeId("plan", idFactory);
  try {
    await insertRow(db, SQL.insertPlan, [planId, `req:${runId}`, 1,
      JSON.stringify({ goal: input.objective || "Protein functional annotation", workflow_type: "protein",
        route, md5: input.md5_key,
        // The exact submitted bytes are persisted up front so an asynchronous
        // FINISHED callback can rebuild the original input verbatim.
        input: { mode: input.mode, accession: input.accession, filename: input.filename,
          objective: input.objective, fasta_text: input.fasta_text, md5: input.md5_key,
          input_sha256: input.input_sha256,
          sequences: input.records.map((record) => ({ id: record.id, length: record.length,
            md5: record.md5, ambiguous: record.ambiguous ?? [] })) },
        steps: [{ id: "protein_validate" }, { id: "protein_resolve" },
          { id: "protein_annotate" }, { id: "protein_report" }] }), nowIso(now)]);
  } catch (caught) {
    return errorResponse(`Could not persist the protein plan: ${caught?.message ?? caught}`, 500, request);
  }

  if (route === "iprscan6") {
    const email = hasContactEmail(env);
    if (!email) return errorBody(routeBUnavailable(), request);
    if (input.records.length !== 1) {
      return errorResponse("Executed InterProScan 6 runs accept one protein at a time; use Route A for a small multi-FASTA. No job was submitted.", 400, request);
    }
    let submission;
    try {
      submission = await submitIprscan6({ email, sequence: input.records[0].sequence, ctx });
    } catch (caught) {
      return errorBody(caught, request);
    }
    const result = makeResult({ input, route, routeLabelValue: ROUTE_LABELS.iprscan6, proteins: [],
      releases: collectReleases([]), notes: ["The job has been submitted; no result is claimed until the dispatcher reports FINISHED."],
      status: "running", providerJobId: submission.job_id, runId, planId });
    await persistProteinRun(db, { runId, planId, md5Key: input.md5_key, route,
      providerJobId: submission.job_id, result, now, idFactory });
    return jsonResponse({ ...result,
      status_url: `/api/ai/workflows/protein/status?run_id=${encodeURIComponent(runId)}`,
      result_url: `/api/ai/workflows/protein/result?run_id=${encodeURIComponent(runId)}`,
      poll_after_ms: LIMITS.pollIntervalMs, max_polls: LIMITS.maxPolls }, 202, request);
  }

  const annotation = await annotatePrecomputed(input, { ctx, cache });
  const result = makeResult({ input, route, routeLabelValue: ROUTE_LABELS.precomputed,
    proteins: annotation.proteins, releases: annotation.releases, notes: annotation.notes,
    status: annotation.status === "failed" ? "failed" : "succeeded",
    error: annotation.status === "failed" ? "One or more provider lookups failed; failed proteins are labelled individually." : null,
    errorCode: annotation.status === "failed" ? "protein_provider_lookup_failed" : null,
    runId, planId });
  if (!result.provider_job_id) result.report = buildProteinReport(result);
  await persistProteinRun(db, { runId, planId, md5Key: input.md5_key, route, result, now, idFactory });
  return jsonResponse({ ...result, status_url: `/api/ai/workflows/protein/status?run_id=${encodeURIComponent(runId)}`,
    result_url: `/api/ai/workflows/protein/result?run_id=${encodeURIComponent(runId)}`,
    poll_after_ms: null, max_polls: LIMITS.maxPolls }, 200, request);
}

async function findProteinRun(db, request) {
  const url = new URL(request.url);
  const runId = safeString(url.searchParams.get("run_id"), 100);
  const jobId = safeString(url.searchParams.get("job_id"), 200);
  if (runId) return { row: await getRow(db, SQL.getProteinRunByPublicId, [runId]), error: null };
  if (jobId) return { row: await getRow(db, SQL.getProteinRunByJobId, [jobId]), error: null };
  return { row: null, error: "run_id or job_id is required." };
}

export async function handleStatus(request, env, options = {}) {
  const rejected = requireMethod(request, "GET", "GET, OPTIONS");
  if (rejected) return rejected;
  const db = getDb(env);
  if (!db) return errorResponse("AI database binding is unavailable.", 503, request);
  const { row, error } = await findProteinRun(db, request);
  if (error) return errorResponse(error, 400, request);
  if (!row) return errorResponse("No stored protein run matches this reference.", 404, request);
  const stored = readStoredResult(row);
  // The run's own job row is the link to the plan that holds the exact input.
  const storedJobRow = await getRow(db, SQL.getJob, [row.public_id]);
  const statusPlanRow = storedJobRow?.plan_id ? await getRow(db, SQL.getPlan, [storedJobRow.plan_id]) : null;
  const statusPlan = statusPlanRow ? parseJson(statusPlanRow.plan_json) : null;
  if (stored) {
    const finalState = finalStateOf(stored);
    return jsonResponse({ workflow_type: "protein", run_id: row.public_id, status: finalState,
      state: observedStateOf(stored), result_state: finalState,
      route_label: stored.route_label, provider_job_id: stored.provider_job_id ?? row.provider_job_id ?? null,
      error: stored.error ?? null,
      result_url: `/api/ai/workflows/protein/result?run_id=${row.public_id}`,
      deduped: true, execution_mode: "real" }, 200, request);
  }
  if (!row.provider_job_id || row.state !== "running") {
    return jsonResponse({ workflow_type: "protein", run_id: row.public_id, status: row.state ?? "unknown",
      state: null, reason: "No provider job id is stored for this run; no state was invented." }, 200, request);
  }
  const ctx = fetchContext(env, options);
  let status;
  try {
    status = await getIprscanStatus(row.provider_job_id, { ctx });
  } catch (caught) {
    return errorBody(caught, request);
  }
  if (status.state_class === "running" || status.state_class === "unknown") {
    return jsonResponse({ workflow_type: "protein", run_id: row.public_id, status: "running",
      state: status.state, state_class: status.state_class, provider_job_id: row.provider_job_id,
      result_url: `/api/ai/workflows/protein/result?run_id=${row.public_id}`,
      poll_after_ms: LIMITS.pollIntervalMs, max_polls: LIMITS.maxPolls,
      reason: "No result is claimed until the dispatcher reports FINISHED." }, 200, request);
  }
  if (status.state_class === "failed") {
    const result = { ...(stored ?? {}), run_id: row.public_id, workflow_type: "protein", status: "failed",
      requested_route: row.route, route_label: routeLabel(row.route), provider_job_id: row.provider_job_id,
      provider_state: status.state, provider_state_class: "failed",
      input: inputFromPlan(statusPlan, row.md5),
      input_sha256: statusPlan?.input?.input_sha256 ?? stored?.input_sha256 ?? null,
      proteins: [], error: status.reason ?? `InterProScan 6 job ended in state ${status.state}.`,
      error_code: "iprscan6_job_failed", execution_mode: "real" };
    result.report = null;
    await finalizeProteinRun(db, { runId: row.public_id, providerJobId: row.provider_job_id, result,
      now: options.now ?? Date.now(), idFactory: options.idFactory });
    return jsonResponse({ error: result.error, error_code: result.error_code,
      workflow_type: "protein", run_id: row.public_id, status: "failed", state: status.state,
      result_state: "failed", provider_job_id: row.provider_job_id,
      result_url: `/api/ai/workflows/protein/result?run_id=${row.public_id}`,
      execution_mode: "real" }, 502, request, { "X-Protein-Error": "iprscan6_job_failed" });
  }
  // FINISHED: retrieve and parse the genuine result exactly once.
  let body;
  try {
    body = await getIprscanResult(row.provider_job_id, { ctx });
  } catch (caught) {
    return errorBody(caught, request);
  }
  const parsed = parseIprscan6Result(body);
  const protein = parsed.proteins[0] ?? null;
  const plan = statusPlan;
  // Byte-for-byte from the plan written at submission; the run never loses
  // its original FASTA when the asynchronous result arrives.
  const input = inputFromPlan(plan, row.md5, protein);
  const result = makeResult({ input, route: "iprscan6", routeLabelValue: ROUTE_LABELS.iprscan6,
    proteins: parsed.proteins.map((annotation, index) => ({
      id: `protein_${index + 1}`, md5: annotation.md5 ?? row.md5,
      length: annotation.protein_length, status: "annotated", reason: null,
      route_label: ROUTE_LABELS.iprscan6, annotation, ambiguous: [], raw_provider_response: body
    })),
    releases: protein?.releases ?? collectReleases([]), notes: parsed.missing_field_reasons,
    status: "succeeded", providerJobId: row.provider_job_id,
    runId: row.public_id, planId: statusPlanRow?.public_id ?? plan?.public_id ?? `plan:${row.public_id}` });
  result.provider_state = status.state;
  result.state = "FINISHED";
  result.report = buildProteinReport(result);
  await finalizeProteinRun(db, { runId: row.public_id, providerJobId: row.provider_job_id, result,
    now: options.now ?? Date.now(), idFactory: options.idFactory });
  return jsonResponse({ ...result, status: "succeeded", state: "FINISHED", result_state: "succeeded",
    result_url: `/api/ai/workflows/protein/result?run_id=${row.public_id}` }, 200, request);
}

export async function handleResult(request, env) {
  const rejected = requireMethod(request, "GET", "GET, OPTIONS");
  if (rejected) return rejected;
  const db = getDb(env);
  if (!db) return errorResponse("AI database binding is unavailable.", 503, request);
  const { row, error } = await findProteinRun(db, request);
  if (error) return errorResponse(error, 400, request);
  if (!row) return errorResponse("No stored protein run matches this reference.", 404, request);
  const stored = readStoredResult(row);
  if (!stored) {
    return jsonResponse({ workflow_type: "protein", run_id: row.public_id, status: row.state ?? "running",
      provider_job_id: row.provider_job_id ?? null, error: null,
      reason: "No result has been stored for this run yet. No result was reconstructed.",
      status_url: `/api/ai/workflows/protein/status?run_id=${row.public_id}` }, 409, request);
  }
  const finalState = finalStateOf(stored);
  return jsonResponse({ ...stored,
    status: stored.status ?? finalState, state: stored.state ?? observedStateOf(stored),
    result_state: finalState,
    status_url: `/api/ai/workflows/protein/status?run_id=${row.public_id}`,
    recovery_url: `/api/ai/runs/${row.public_id}/recovery`,
    report_url: finalState === "failed" ? null : `/api/ai/runs/${row.public_id}/report` }, 200, request);
}

export async function handleDomains(request, env) {
  const rejected = requireMethod(request, "GET", "GET, OPTIONS");
  if (rejected) return rejected;
  const db = getDb(env);
  if (!db) return errorResponse("AI database binding is unavailable.", 503, request);
  const { row, error } = await findProteinRun(db, request);
  if (error) return errorResponse(error, 400, request);
  if (!row) return errorResponse("No stored protein run matches this reference.", 404, request);
  const stored = readStoredResult(row);
  if (!stored) return errorResponse("This run has no stored annotation yet.", 409, request);
  const accession = safeString(new URL(request.url).searchParams.get("accession"), 120);
  if (!accession) return errorResponse("accession is required.", 400, request);
  const match = [];
  for (const protein of stored.proteins ?? []) {
    for (const feature of protein.annotation?.features ?? []) {
      if (feature.entry?.accession === accession || feature.signature.accession === accession) {
        match.push({ protein_id: protein.id, md5: protein.md5, feature });
      }
    }
  }
  if (!match.length) return errorResponse(`No stored feature matches ${accession}.`, 404, request);
  const first = match[0].feature;
  return jsonResponse({
    run_id: row.public_id, accession,
    evidence_links: {
      interpro_entry: first.entry?.accession ? `https://www.ebi.ac.uk/interpro/entry/InterPro/${encodeURIComponent(first.entry.accession)}` : null,
      interpro_signature: first.signature.accession
        ? `https://www.ebi.ac.uk/interpro/entry/${encodeURIComponent(first.source ?? "InterPro")}/${encodeURIComponent(first.signature.accession)}` : null,
      matches: `https://www.ebi.ac.uk/interpro/matches/api/matches/${encodeURIComponent(String(match[0].md5).toUpperCase())}`
    },
    entry: first.entry,
    signature: first.signature,
    locations: match.map((item) => ({ protein_id: item.protein_id, locations: item.feature.locations,
      score: item.feature.score, evalue: item.feature.evalue, category: item.feature.category,
      feature_type: item.feature.feature_type, source: item.feature.source })),
    go_terms: (stored.proteins ?? []).flatMap((protein) => protein.annotation?.go?.terms ?? [])
      .filter((term) => term.source === "protein_metadata" || term.source === "entry"),
    source_releases: stored.releases?.member_databases ?? null,
    provenance: { route_label: stored.route_label, tool_version: PROTEIN_PROVIDER_VERSION,
      basis: "stored_protein_run_result", evidence_only: true }
  }, 200, request);
}

export function proteinHandlers() {
  return {
    proteinPlan: (context) => handlePlan(context.request, context.env, {}),
    proteinAnnotate: (context) => handleAnnotate(context.request, context.env, {}),
    proteinStatus: (context) => handleStatus(context.request, context.env, {}),
    proteinResult: (context) => handleResult(context.request, context.env),
    proteinDomains: (context) => handleDomains(context.request, context.env)
  };
}
