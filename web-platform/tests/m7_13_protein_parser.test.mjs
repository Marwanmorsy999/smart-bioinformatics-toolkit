// M7.13 OFFLINE PARSER TESTS. The large fixture is a saved GENUINE InterPro
// Matches response; all other bodies are labelled FIXTURE and are deliberately
// minimal/malformed. No live provider call is made.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  ROUTE_LABELS, computeCoverage, parseIprscan6Result, parseMatchesAnnotation,
  summarizeAnnotation
} from "../functions/api/protein/parser.js";
import { buildViewerModel } from "../public/js/protein-viewer.js";

const matches = JSON.parse(readFileSync(new URL("./fixtures/m7_13_protein/matches-P04637.json", import.meta.url), "utf8"));

test("GENUINE fixture: 32 matches parse into distinct signatures, entries, locations and sites", () => {
  const annotation = parseMatchesAnnotation(matches, { md5: matches.md5, protein_length: 393 });
  assert.equal(annotation.route_label, "precomputed_reference_annotation");
  assert.equal(annotation.features.length, 32);
  assert.equal(annotation.entries.length, 9);
  const pfam = annotation.features.find((feature) => feature.signature.accession === "PF00870"
    && feature.source === "Pfam");
  assert.equal(pfam.category, "domain");
  assert.equal(pfam.feature_type, "Domain");
  assert.equal(pfam.entry.accession, "IPR011615");
  assert.deepEqual(pfam.locations[0].fragments[0], { start: 100, end: 288, dc_status: "CONTINUOUS" });
  assert.equal(pfam.signature.release.library, "Pfam");
  assert.equal(pfam.signature.release.version, "39.0");
  const cdd = annotation.features.find((feature) => feature.source === "CDD");
  assert.equal(cdd.locations[0].sites.length, 3);
  assert.equal(cdd.locations[0].sites[0].description, "DNA binding site");
  assert.equal(cdd.locations[0].sites[0].residues.length, 8);
  const mobidb = annotation.features.find((feature) => feature.source === "MobiDB-lite");
  assert.equal(mobidb.category, "disorder");
  assert.equal(mobidb.locations.length, 6);
  assert.equal(mobidb.locations[1].sequence_feature, "Proline-rich");
  assert.equal(annotation.special_features.some((item) => item.label === "disorder"), true);
  assert.equal(annotation.missing_field_reasons.some((reason) => /no integrated InterPro entry/.test(reason)), true);
  assert.equal(annotation.releases.interpro_release, null);
  assert.match(annotation.releases.interpro_release_reason, /not reported by the source/);
  assert.equal(annotation.releases.member_databases.CDD, "3.21");
  assert.match(summarizeAnnotation(annotation), /precomputed_reference_annotation/);
});

test("FIXTURE: absent optional fields stay null/empty with reasons, never invented", () => {
  const sparse = {
    md5: "A".repeat(32),
    matches: [{
      source: "UnknownDB",
      signature: { accession: "X1" },
      locations: [{ start: 4, end: 9 }]
    }]
  };
  const parsed = parseMatchesAnnotation(sparse, { protein_length: 12, md5: sparse.md5 });
  const feature = parsed.features[0];
  assert.equal(feature.category, "other");
  assert.equal(feature.feature_type, null);
  assert.equal(feature.entry, null);
  assert.match(feature.entry_reason, /not integrated/);
  assert.equal(feature.signature.release, null);
  assert.equal(feature.signature.name, null);
  assert.equal(feature.locations[0].evalue, null);
  assert.equal(feature.locations[0].fragments.length, 0);
  assert.equal(parsed.go.terms.length, 0);
  assert.equal(parsed.pathways.items.length, 0);
  assert.match(parsed.pathways.reason, /not reported/);
  assert.equal(parsed.entries.length, 0);
  assert.ok(parsed.missing_field_reasons.length >= 1);
});

test("FIXTURE: overlaps and multiple signatures are retained; coverage is a deterministic union", () => {
  const body = {
    md5: "B".repeat(32),
    matches: [
      { source: "Pfam", signature: { accession: "P1", type: "Domain", signatureLibraryRelease: { library: "Pfam", version: "1" } },
        locations: [{ start: 10, end: 20 }, { start: 30, end: 35 }] },
      { source: "CDD", signature: { accession: "C1", type: "Domain", signatureLibraryRelease: { library: "CDD", version: "2" } },
        locations: [{ start: 15, end: 25 }] },
      { source: "PROSITE patterns", signature: { accession: "PS1", type: "Conserved_site" },
        locations: [{ start: 21, end: 21 }] }
    ]
  };
  const parsed = parseMatchesAnnotation(body, { protein_length: 40 });
  assert.equal(parsed.features.length, 3);
  assert.deepEqual(parsed.features.map((feature) => feature.locations[0].start), [10, 15, 21]);
  assert.equal(parsed.counts.domain, 2);
  assert.equal(parsed.counts.site, 1);
  assert.deepEqual(computeCoverage(parsed.features, 40), {
    protein_length: 40, covered_residues: 22, fraction: 0.55, basis: "union_of_reported_location_intervals"
  });
  assert.deepEqual(computeCoverage(parsed.features, 40), computeCoverage(parsed.features, 40));
});

test("FIXTURE: GO identifiers and categories come only from reported protein/entry terms", () => {
  const body = { md5: "C".repeat(32), matches: [] };
  const parsed = parseMatchesAnnotation(body, {
    protein_length: 100,
    go_terms: { terms: [
      { identifier: "GO:0003677", name: "DNA binding", category: { code: "F", name: "molecular_function" } },
      { identifier: "GO:0006915", name: "apoptotic process", category: { code: "P", name: "biological_process" } },
      { name: "no identifier reported", category: { code: "C", name: "cellular_component" } }
    ], reason: null },
    go_enrichment: [["entry:IPR000001", { terms: [
      { identifier: "GO:0005634", name: "nucleus", category: { code: "C", name: "cellular_component" } }
    ], reason: null }]]
  });
  assert.equal(parsed.go.terms.length, 4);
  assert.equal(parsed.go.categories.molecular_function.length, 1);
  assert.equal(parsed.go.categories.biological_process.length, 1);
  assert.equal(parsed.go.categories.cellular_component.length, 2);
  assert.equal(parsed.go.terms.find((term) => term.name === "no identifier reported").identifier, null);
  assert.equal(parsed.go.terms.find((term) => term.name === "nucleus").source, "entry:IPR000001");
});

test("FIXTURE: executed InterProScan 6 result keeps its own route label and tool version", () => {
  const body = [{
    md5: "D".repeat(32),
    sequence: "ACDEFGHIKLMNPQRSTVWYACDEFGHIKLMNPQRSTVWY",
    program: "InterProScan 6.1",
    matches: [{ source: "Pfam", signature: { accession: "PF00001", type: "Family",
      signatureLibraryRelease: { library: "Pfam", version: "39.0" } },
      locations: [{ start: 5, end: 18 }] }],
    go_terms: [{ identifier: "GO:0005515", name: "protein binding", category: { code: "F", name: "molecular_function" } }],
    pathways: [{ name: "p53 signaling", source: "KEGG", identifier: "KEGG:04115" }]
  }];
  const result = parseIprscan6Result(body);
  assert.equal(result.result_label, ROUTE_LABELS.iprscan6);
  assert.equal(result.protein_count, 1);
  const protein = result.proteins[0];
  assert.equal(protein.route_label, "executed_interproscan6_analysis");
  assert.equal(protein.releases.tool_version, "InterProScan 6.1");
  assert.equal(protein.features[0].category, "family");
  assert.equal(protein.go.terms[0].identifier, "GO:0005515");
  assert.equal(protein.pathways.items[0].identifier, "KEGG:04115");
  const empty = parseIprscan6Result({ unexpected: true });
  assert.equal(empty.protein_count, 0);
  assert.match(empty.missing_field_reasons[0], /no protein match records/);
});

test("GENUINE fixture: viewer coordinates scale to full length and keep overlaps in separate lanes", () => {
  const annotation = parseMatchesAnnotation(matches, { md5: matches.md5, protein_length: 393 });
  const model = buildViewerModel(annotation, { width: 960 });
  assert.equal(model.protein_length, 393);
  assert.equal(model.basis, "genuine_source_reported_residue_coordinates");
  assert.ok(model.tracks.length > 20);
  assert.ok(model.lanes >= 2);
  for (const track of [...model.tracks, ...model.sites]) {
    assert.ok(track.start >= 1 && track.end <= 393);
    assert.ok(track.x >= model.padding - 0.01 && track.x + track.w <= model.width - model.padding + 0.01);
    assert.equal(track.w >= 1, true);
  }
  // The PF00870 location must stay at its genuine residues, not a rounded bin.
  const pfamTrack = model.tracks.find((track) => track.accession === "PF00870" && track.start === 100 && track.end === 288);
  assert.ok(pfamTrack, "the genuine Pfam PF00870 100-288 interval is drawn");
  const expected = 12 + ((100 - 1) * (960 - 24) / 393);
  assert.equal(Math.abs(pfamTrack.x - expected) < 0.02, true);
  const again = buildViewerModel(annotation, { width: 960 });
  assert.deepEqual(again.tracks.map((track) => [track.x, track.w, track.lane]),
    model.tracks.map((track) => [track.x, track.w, track.lane]));
  const sparse = buildViewerModel({ protein_length: 10, features: [{ locations: [{}] }] });
  assert.equal(sparse.tracks.length, 0);
  assert.equal(sparse.skipped_features, 1);
});
