// M7.10 UI-view tests. jsdom/linkedom are not installed, so DOM wiring is
// checked against the real source (the existing harness) and all data-shaping
// logic is tested through its pure, DOM-free module. No live service is used.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { parseBlastJson2 } from "../functions/api/blast/json2.js";
import {
  alignmentTsv,
  buildInterpretation,
  buildPlanExplanationMessage,
  fullReport,
  hasStructuredHits,
  hitSummaryCsv,
  isSafeAccession
} from "../public/js/16s-results-view.js";
import { JSON2_FIXTURE_TEXT } from "./fixtures/m7_10_json2_fixture.mjs";

const RESULT = parseBlastJson2(JSON2_FIXTURE_TEXT);
const PROVENANCE = { database: "rRNA_typestrains/16S_ribosomal_RNA", program: "blastn", result_format: "json2", derived_from: "json2", cached: false };

test("FIXTURE: only accession-shaped tokens become NCBI nuccore links", () => {
  for (const safe of ["NR_074666.1", "AY123456", "WP_012345678.1", "ABC-123.4"]) {
    assert.equal(isSafeAccession(safe), true, safe);
  }
  for (const unsafe of ["", null, undefined, "javascript:alert(1)", "../x", "A B", "-bad", ".bad", "a..b", "x".repeat(40)]) {
    assert.equal(isSafeAccession(unsafe), false, String(unsafe));
  }
});

test("FIXTURE: interpretation is evidence-based and never claims species certainty", () => {
  const lines = buildInterpretation(RESULT, PROVENANCE, { synthetic: false });
  assert.equal(lines.length >= 4, true);
  assert.match(lines[0], /Francisella tularensis/);
  assert.match(lines[0], /97\.5%/);
  assert.match(lines[0], /100%/);
  assert.match(lines.join(" "), /not species confirmation|does not resolve identity/);
  assert.match(lines.join(" "), /not proof of taxon identity/);
  assert.match(lines.join(" "), /same JSON2 report/);
  for (const falseClaim of [/species (?:confirmed|identified)/i, /diagnos/i, /certain/i]) {
    assert.doesNotMatch(lines.join(" "), falseClaim);
  }
});

test("FIXTURE: interpretation is withheld for synthetic or absent results", () => {
  assert.deepEqual(buildInterpretation(RESULT, PROVENANCE, { synthetic: true }), ["Synthetic/mock data: no biological interpretation applies."]);
  assert.match(buildInterpretation(null, {}, {})[0], /No structured hits/);
  assert.match(buildInterpretation({ hits: [] }, {}, {})[0], /No structured hits/);
  assert.match(buildInterpretation(RESULT, { cached: true }, {}).join(" "), /cached reload/);
  assert.equal(hasStructuredHits(RESULT), true);
  assert.equal(hasStructuredHits({ hits: [] }), false);
});

test("FIXTURE: plan explanation message contains only non-sequence plan metadata", () => {
  const plan = {
    intent: "identify_taxa", domain: "microbiology",
    steps: [{ tool_id: "ncbi.blastn", params: { database: "rRNA_typestrains/16S_ribosomal_RNA", program: "blastn" } }]
  };
  const message = buildPlanExplanationMessage(plan, "Identify taxa using BLASTN");
  assert.match(message, /ncbi\.blastn/);
  assert.match(message, /rRNA_typestrains\/16S_ribosomal_RNA/);
  assert.match(message, /program=blastn/);
  assert.match(message, /no sequence data is included/);
  assert.equal(message.includes("ACGT"), false);
  assert.equal(message.includes(">"), false);

  const withFasta = buildPlanExplanationMessage(plan, ">seq1\nACGTACGTACGTACGTACGTACGT");
  assert.equal(withFasta.includes("seq1"), false);
  assert.equal(/ACGT{2,}/.test(withFasta), false);
  assert.match(withFasta, /objective=identify_taxa/);
});

test("FIXTURE: CSV, alignment TSV and full report export only retrieved values", () => {
  const csv = hitSummaryCsv(RESULT);
  const csvLines = csv.trim().split("\r\n");
  assert.equal(csvLines.length, 4, "header + 3 fixture hits");
  assert.match(csvLines[0], /^rank,accession,organism,taxid,identity,query_coverage,evalue,bitscore$/);
  assert.match(csvLines[1], /NR_074666\.1,Francisella tularensis/);

  const tsv = alignmentTsv(RESULT);
  const tsvLines = tsv.trim().split("\n");
  assert.equal(tsvLines.length, 5, "header + 2 + 1 + 1 fixture HSPs");
  assert.match(tsvLines[0], /^rank\thsp\tquery_id\tqstart/);
  assert.match(tsvLines.join("\n"), /minus/);
  assert.match(tsvLines[1], /ACGTACGTACGTACGTACGTACGTACGTACGTACGT/);

  const report = fullReport({
    rid: "M7T10RID123", result: RESULT, provenance: PROVENANCE,
    parameters: { database: "rRNA_typestrains/16S_ribosomal_RNA", program: "blastn" },
    interpretation: buildInterpretation(RESULT, PROVENANCE, {}), synthetic: false
  });
  for (const section of ["QUERY", "SEARCH OVERVIEW", "FINDINGS", "LIMITATIONS", "PROVENANCE"]) {
    assert.match(report, new RegExp(section));
  }
  assert.match(report, /research use only/i);
  assert.match(fullReport({ synthetic: true }), /SYNTHETIC\/MOCK DATA/);
});

test("UI WIRING: structured sections, exports and assistant explanation are present", () => {
  const html = readFileSync(new URL("../public/16s.html", import.meta.url), "utf8");
  const js = readFileSync(new URL("../public/js/16s-flow.js", import.meta.url), "utf8");
  const view = readFileSync(new URL("../public/js/16s-results-view.js", import.meta.url), "utf8");

  for (const id of [
    "plan-explanation", "search-overview", "interpretation-view", "best-hits-body",
    "download-csv", "download-report", "download-alignment"
  ]) {
    assert.equal(html.includes(`id="${id}"`), true, id);
  }
  assert.match(html, /AI-generated explanation; plan is deterministic|plan-explanation/);
  assert.match(js, /AI-generated explanation; plan is deterministic/);
  assert.match(js, /\/api\/assistant\/chat/);
  assert.match(js, /stream: false/);
  assert.match(js, /buildPlanExplanationMessage\(plan, ui\.objective\.value\.trim\(\)\)/);
  assert.match(js, /structured=1/);
  assert.match(js, /cached=1/);
  assert.match(js, /https:\/\/www\.ncbi\.nlm\.nih\.gov\/nuccore\//);
  assert.match(js, /isSafeAccession\(hit\.accession\)/);
  assert.match(js, /alignment-block/);
  assert.match(js, /textContent/);
  assert.doesNotMatch(js, /innerHTML/, "untrusted data must never enter innerHTML");
  assert.match(view, /safeCsvCell/);
});

test("UI WIRING: banner is format-aware and cached labelling is response-derived", () => {
  const js = readFileSync(new URL("../public/js/16s-flow.js", import.meta.url), "utf8");
  // The two honest real-result wordings are kept distinct; mock stays labelled.
  assert.match(js, /Real NCBI JSON2 result parsed into a derived table/);
  assert.match(js, /Real tabular result retrieved from NCBI/);
  assert.match(js, /state\.resultFormat === "json2"/);
  assert.match(js, /SYNTHETIC \/ MOCK DATA/);
  // Terminal handling no longer keys off the request flag alone.
  assert.doesNotMatch(js, /if \(cached\) \{/);
  assert.match(js, /state\.cached = envelope\.cached === true \|\| state\.provenance\?\.cached === true/);
  assert.match(js, /state\.fetchedAt = state\.provenance\?\.retrieved_at \?\? \(state\.cached \? null : new Date\(\)\.toISOString\(\)\)/);
  assert.doesNotMatch(js, /if \(state\.cached\) state\.fetchedAt = null/, "cached reloads keep the original retrieval time");
  assert.match(js, /union of its HSP query intervals/);
  assert.match(js, /HSP span coverage \(this alignment only\)/);
});

test("OFFLINE HARNESS: e2e stubs assistant chat with an honestly labelled fixture", () => {
  const e2e = readFileSync(new URL("./sixteen_s.e2e.mjs", import.meta.url), "utf8");
  assert.match(e2e, /context\.route\("\*\*\/api\/assistant\/chat"/);
  assert.match(e2e, /generated: false/);
  assert.match(e2e, /available: false/);
  assert.match(e2e, /offline_fixture/);
  // The zero-console-error assertion itself is unchanged (no error filtering).
  assert.match(e2e, /assert\.deepEqual\(browserErrors, \[\]/);
  assert.doesNotMatch(e2e, /browserErrors\.filter/);
});
