/* Pure helpers for the 16S structured-results view. No DOM, no fetch, no
   sequence data: every value comes from an already-retrieved result object.
   Kept separate from 16s-flow.js so the transforms are testable offline. */
import { safeCsvCell } from "./csv-safe.js";

const accessionPattern = /^[A-Za-z0-9_.-]{1,32}$/;

/** Only allow inert accession-shaped tokens into an NCBI nuccore URL. */
export function isSafeAccession(value) {
  if (typeof value !== "string" || !accessionPattern.test(value)) return false;
  return !value.startsWith(".") && !value.startsWith("-") && !value.includes("..");
}

export function hasStructuredHits(result) {
  return Boolean(result && Array.isArray(result.hits) && result.hits.length > 0);
}

function text(value, fallback = "not reported") {
  return value === null || value === undefined || value === "" ? fallback : String(value);
}

function percent(value) {
  return Number.isFinite(value) ? `${value}%` : text(value);
}

function range(values) {
  const finite = values.filter((value) => Number.isFinite(value));
  if (!finite.length) return null;
  const min = Math.min(...finite);
  const max = Math.max(...finite);
  return min === max ? `${min}` : `${min}–${max}`;
}

/** Deterministic, evidence-based wording; never asserts species certainty. */
export function buildInterpretation(result, provenance = {}, options = {}) {
  if (options.synthetic) return ["Synthetic/mock data: no biological interpretation applies."];
  if (!hasStructuredHits(result)) return ["No structured hits were available; no interpretation is offered."];
  const hits = result.hits;
  const top = hits[0];
  const lines = [];
  const label = text(top.organism ?? top.title ?? (top.accession ? null : "an unlabelled record"), "an unlabelled record");
  const accession = top.accession ? ` (${top.accession})` : "";
  lines.push(`The best reported hit is ${label}${accession}, with ${percent(top.identity)} identity and ${percent(top.query_coverage)} hit-level query coverage (union of its HSP query intervals divided by the full query length; individual HSP spans are separate).`);

  const topLabels = hits.slice(0, 3).map((hit) => hit.organism ?? null);
  const present = topLabels.filter((value) => typeof value === "string" && value.trim());
  if (present.length && present.length === topLabels.length && present.every((value) => value === present[0])) {
    lines.push(`The top ${present.length} hit(s) share the same reported organism label (${present[0]}). This is agreement among retrieved descriptions, not species confirmation.`);
  } else if (present.length >= 2) {
    lines.push("The top hits report different organism labels; the retrieved evidence is mixed and does not resolve identity.");
  } else {
    lines.push("Organism labels were not reported for the top hits; no organism-level conclusion is drawn.");
  }

  const identityRange = range(hits.map((hit) => hit.identity));
  const coverageRange = range(hits.map((hit) => hit.query_coverage));
  const bitsRange = range(hits.map((hit) => hit.bitscore));
  if (identityRange || coverageRange || bitsRange) {
    const parts = [];
    if (identityRange) parts.push(`identity ${identityRange}%`);
    if (coverageRange) parts.push(`hit-level query-interval union coverage ${coverageRange}%`);
    if (bitsRange) parts.push(`bit score ${bitsRange}`);
    lines.push(`Across ${hits.length} reported hit(s): ${parts.join("; ")}.`);
  }
  lines.push("These are similarity screening values from the retrieved report, not proof of taxon identity; 16S identity thresholds are not universal species boundaries.");
  if (provenance?.derived_from === "json2") {
    lines.push("The tabular compatibility view is derived from the same JSON2 report, not an independent second retrieval.");
  }
  if (provenance?.cached === true) {
    lines.push("This is a cached reload; no new NCBI retrieval was performed.");
  }
  return lines;
}

/** Plan metadata only. Free text is dropped if it resembles sequence data. */
export function buildPlanExplanationMessage(plan, objective) {
  const step = plan?.steps?.[0] ?? {};
  const params = step.params ?? {};
  const tool = String(step.tool_id ?? "ncbi.blastn").slice(0, 80);
  const database = String(params.database ?? "").slice(0, 120);
  const program = String(params.program ?? "").slice(0, 80);
  const intent = String(plan?.intent ?? "").slice(0, 80);
  const domain = String(plan?.domain ?? "").slice(0, 80);
  let safeObjective = String(objective ?? "").trim().slice(0, 120).replace(/[\r\n>]+/g, " ");
  if (!safeObjective || /[ACGTU]{20,}/i.test(safeObjective)) {
    safeObjective = intent || domain || "16S identification";
  }
  return `Explain this deterministic BLAST plan in plain language for a researcher. Plan metadata only (no sequence data is included): tool=${tool}, database=${database}, program=${program}, objective=${safeObjective}. Do not claim any result and do not discuss any sequence.`;
}

function flatCell(value) {
  if (value === null || value === undefined) return "";
  return String(value).replace(/[\t\r\n]+/g, " ").trim();
}

export function hitSummaryCsv(result) {
  const columns = ["rank", "accession", "organism", "taxid", "identity", "query_coverage", "evalue", "bitscore"];
  const lines = [columns.join(",")];
  for (const hit of (result?.hits ?? [])) lines.push(columns.map((column) => safeCsvCell(hit[column] ?? "")).join(","));
  return lines.join("\r\n") + "\r\n";
}

export function alignmentTsv(result) {
  const columns = ["rank", "hsp", "query_id", "qstart", "qend", "sstart", "send", "strand", "length", "identity", "nident", "gaps", "qseq", "sseq", "midline"];
  const lines = [columns.join("\t")];
  for (const hit of (result?.hits ?? [])) {
    for (const hsp of (hit.hsps ?? [])) {
      const values = {
        ...hsp,
        rank: hit.rank,
        query_id: result?.query?.id ?? ""
      };
      lines.push(columns.map((column) => flatCell(values[column])).join("\t"));
    }
  }
  return lines.join("\n") + "\n";
}

export function fullReport({ rid = null, result = null, provenance = null, parameters = {}, interpretation = [], synthetic = false, cached = false, fetchedAt = null } = {}) {
  const lines = [
    "16S BLAST REPORT",
    "================",
    "Research use only. Similarity is evidence, not proof of species identity or a clinical diagnosis.",
    "",
    "QUERY",
    `  id: ${text(result?.query?.id)}`,
    `  length: ${text(result?.query?.length)}`,
    "",
    "SEARCH OVERVIEW",
    `  RID: ${text(rid)}`,
    `  status: complete`,
    `  retrieved_at: ${text(provenance?.retrieved_at ?? fetchedAt)}`,
    `  cached: ${cached ? "yes (no new NCBI fetch)" : "no"}`,
    `  result_format: ${text(provenance?.result_format ?? "not reported")}`,
    `  database: ${text(provenance?.database)}`,
    `  program: ${text(provenance?.program)}`,
    `  parameters: ${JSON.stringify(parameters ?? {})}`,
    "",
    "FINDINGS",
    ...interpretation.map((line) => `  - ${line}`)
  ];
  if (hasStructuredHits(result)) {
    lines.push("", "HIT SUMMARY (rank | accession | organism | identity | hit coverage % = union of HSP query intervals / full query_len | E-value | bit score)");
    for (const hit of result.hits) {
      lines.push(`  ${hit.rank ?? "—"} | ${text(hit.accession)} | ${text(hit.organism ?? hit.title)} | ${text(hit.identity)} | ${text(hit.query_coverage)} | ${text(hit.evalue)} | ${text(hit.bitscore)}`);
    }
  }
  lines.push(
    "",
    "LIMITATIONS",
    "  - Identity and coverage are screening values, not species boundaries.",
    "  - Only fields present in the retrieved report are shown; missing values remain unreported.",
    "  - No taxonomy mapping file was uploaded; lineages may be unresolved.",
    "  - Independent scientific interpretation is required; not a clinical or diagnostic result.",
    synthetic ? "  - SYNTHETIC/MOCK DATA: not a real NCBI result." : "  - Real retrieved data; no result was fabricated by this platform.",
    "",
    "PROVENANCE",
    JSON.stringify(provenance ?? {}, null, 2)
  );
  return lines.join("\n") + "\n";
}
