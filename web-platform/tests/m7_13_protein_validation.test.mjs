// M7.13 OFFLINE TESTS — protein input, MD5, accession resolution, Matches API
// and InterProScan 6 transport. Every provider call is stubbed in memory.
// GENUINE fixtures: tests/fixtures/m7_13_protein/*.json (saved read-only EBI /
// UniProt responses). Synthetic inputs below are labelled FIXTURE and are not
// scientific results. No live EBI/UniProt request is made by this file.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  AMBIGUOUS_AA, batchMatches, collectReleases, createProviderCache,
  getIprscanResult, getIprscanStatus, hasContactEmail, lookupMatches,
  normalizeAccession, normalizeGoTerms, parseProteinFasta, proteinMd5,
  resolveAccession, routeBUnavailable, submitIprscan6, validateProteinSequence
} from "../functions/api/protein/provider.js";

const FIX = new URL("./fixtures/m7_13_protein/", import.meta.url);
const fasta = readFileSync(new URL("P04637.fasta", FIX), "utf8");
const uniprot = JSON.parse(readFileSync(new URL("uniprot-P04637.json", FIX), "utf8"));
const interproProtein = JSON.parse(readFileSync(new URL("interpro-protein-P04637.json", FIX), "utf8"));
const matches = JSON.parse(readFileSync(new URL("matches-P04637.json", FIX), "utf8"));
const TP53 = uniprot.sequence.value;
const TP53_MD5 = "c133dfce69f606f20865e9008199f852";

function stub(handler) {
  return async (url, init) => handler(String(url), init ?? {});
}

test("GENUINE fixture: uppercase-ASCII MD5 convention matches the reported TP53 MD5", () => {
  assert.equal(proteinMd5(TP53), TP53_MD5);
  assert.equal(proteinMd5(TP53.toLowerCase().replace(/(.{10})/g, "$1\n")), TP53_MD5);
  assert.equal(proteinMd5(TP53).toUpperCase(), "C133DFCE69F606F20865E9008199F852");
  assert.equal(String(matches.md5).toUpperCase(), "C133DFCE69F606F20865E9008199F852");
});

test("FIXTURE: standard protein, documented ambiguous residues and rejected input", () => {
  const standard = validateProteinSequence("ACDEFGHIKLMNPQRSTVWY".repeat(2));
  assert.equal(standard.valid, true);
  assert.equal(standard.length, 40);
  assert.equal(standard.ambiguous.length, 0);
  const ambiguous = validateProteinSequence("MEEPQSDPSVBJZXUOACDEFGHIKLMNPQRSTVWY");
  assert.equal(ambiguous.valid, true);
  assert.deepEqual(ambiguous.ambiguous.map((item) => item.residue), ["B", "J", "Z", "X", "U", "O"]);
  for (const residue of Object.keys(AMBIGUOUS_AA)) assert.equal(AMBIGUOUS_AA[residue].length > 0, true);
  assert.equal(validateProteinSequence("ACDEFGH*IKLM").valid, false);
  assert.equal(validateProteinSequence("ACGT").valid, false); // below minimum
  const nucleotide = validateProteinSequence("ACGTACGTACGTACGTACGTACGTACGTACGTACGTACGT");
  assert.equal(nucleotide.valid, false);
  assert.match(nucleotide.errors.join(" "), /nucleotide/i);
  const headerHint = validateProteinSequence("MEEPQSDPSVEPPLSQETFSDLWKLLPENNVL", { header: "16S rRNA gene" });
  assert.equal(headerHint.valid, false);
});

test("FIXTURE: FASTA validation covers single/raw/multi, duplicates and nucleotide input", () => {
  const genuine = parseProteinFasta(fasta);
  assert.equal(genuine.valid, true);
  assert.equal(genuine.records.length, 1);
  assert.equal(genuine.records[0].id, "sp|P04637|P53_HUMAN");
  assert.equal(genuine.records[0].length, 393);
  assert.equal(genuine.records[0].md5, TP53_MD5);
  const multi = parseProteinFasta(">a\nACDEFGHIKLMNPQRSTVWYACDEFGHIKLMNPQRSTVWY\n>b\nMEEPQSDPSVEPPLSQETFSDLWKLLPENNVL");
  assert.equal(multi.valid, true);
  assert.deepEqual(multi.records.map((record) => record.id), ["a", "b"]);
  const duplicate = parseProteinFasta(">a\nACDEFGHIKLMNPQRSTVWYACDEFGHIKLMNPQRSTVWY\n>a\nMEEPQSDPSVEPPLSQETFSDLWKLLPENNVL");
  assert.equal(duplicate.valid, false);
  assert.match(duplicate.errors.join(" "), /Duplicate FASTA identifiers/);
  const empty = parseProteinFasta("   ");
  assert.equal(empty.valid, false);
  assert.match(empty.errors[0], /empty/i);
  const nucleotide = parseProteinFasta(">16S gene\nACGTACGTACGTACGTACGTACGTACGTACGTACGTACGT");
  assert.equal(nucleotide.valid, false);
  assert.match(nucleotide.errors.join(" "), /nucleotide/i);
  const raw = parseProteinFasta("MEEPQSDPSVEPPLSQETFSDLWKLLPENNVL");
  assert.equal(raw.valid, true);
  assert.equal(raw.mode, "raw");
  assert.equal(raw.records[0].id, "sequence_1");
  const twentyOne = Array.from({ length: 21 }, (_, index) =>
    `>s${index}\nACDEFGHIKLMNPQRSTVWYACDEFGHIKLMNPQRSTVWY`).join("\n");
  assert.equal(parseProteinFasta(twentyOne).valid, false);
  assert.equal(normalizeAccession(" p04637 "), "P04637");
  assert.equal(normalizeAccession("not-an-accession"), null);
});

test("GENUINE fixture: accession resolution verifies UniProt MD5 and reads InterPro metadata", async () => {
  const calls = [];
  const fetchImpl = stub((url) => {
    calls.push(url);
    if (url.includes("rest.uniprot.org")) return new Response(JSON.stringify(uniprot), { status: 200 });
    if (url.includes("interpro/api/protein")) return new Response(JSON.stringify(interproProtein), { status: 200 });
    return new Response("{}", { status: 404 });
  });
  const resolved = await resolveAccession("p04637", { ctx: { fetch: fetchImpl }, cache: createProviderCache() });
  assert.equal(resolved.accession, "P04637");
  assert.equal(resolved.record.md5, TP53_MD5);
  assert.equal(resolved.uniprot.reviewed, true);
  assert.equal(resolved.uniprot.entry_type, "UniProtKB reviewed (Swiss-Prot)");
  assert.equal(resolved.uniprot.length, 393);
  assert.equal(resolved.interpro_metadata.metadata.accession, "P04637");
  assert.match(resolved.fasta_text, /^>P04637/);
  assert.equal(calls.some((url) => url.includes("fields=accession,protein_name,sequence,length")), true);
  assert.equal(calls.length, 2);
});

test("FIXTURE: accession resolution fails closed on 404 and on reported/sequence MD5 mismatch", async () => {
  const notFound = await resolveAccession("Q99999", { ctx: { fetch: stub(async () => new Response("{}", { status: 404 })) } })
    .catch((error) => error);
  assert.equal(notFound.code, "uniprot_accession_not_found");
  const altered = { ...uniprot, sequence: { ...uniprot.sequence, value: `${TP53.slice(0, 392)}A` } };
  const mismatch = await resolveAccession("P04637", {
    ctx: { fetch: stub(async (url) => url.includes("rest.uniprot.org")
      ? new Response(JSON.stringify(altered), { status: 200 })
      : new Response("{}", { status: 404 })) }
  }).catch((error) => error);
  assert.equal(mismatch.code, "uniprot_md5_mismatch");
});

test("GENUINE fixture: Matches hit verifies MD5; 404 miss and mismatched body are honest", async () => {
  const hit = await lookupMatches(TP53_MD5, {
    ctx: { fetch: stub(async (url) => {
      assert.equal(url, `https://www.ebi.ac.uk/interpro/matches/api/matches/${TP53_MD5.toUpperCase()}`);
      return new Response(JSON.stringify(matches), { status: 200 });
    }) }, cache: createProviderCache()
  });
  assert.equal(hit.status, "hit");
  assert.equal(hit.match_count, 32);
  assert.equal(hit.body.md5.toUpperCase(), TP53_MD5.toUpperCase());
  const miss = await lookupMatches("00000000000000000000000000000000", {
    ctx: { fetch: stub(async () => new Response("{}", { status: 404 })) }, cache: createProviderCache()
  });
  assert.equal(miss.status, "miss");
  assert.equal(miss.body, null);
  assert.match(miss.reason, /No precomputed/);
  const badBody = await lookupMatches(TP53_MD5, {
    ctx: { fetch: stub(async () => new Response(JSON.stringify({ md5: "00000000000000000000000000000000", matches: [] }))) },
    cache: createProviderCache()
  }).catch((error) => error);
  assert.equal(badBody.code, "matches_md5_mismatch");
  const invalid = await lookupMatches("nope", { ctx: { fetch: stub(async () => new Response("{}")) } }).catch((error) => error);
  assert.equal(invalid.code, "invalid_md5");
});

test("FIXTURE: batch Matches POST sends uppercase MD5 values and discards unrelated rows", async () => {
  let sent = null;
  const rows = await batchMatches([TP53_MD5, TP53_MD5], { ctx: { fetch: stub((_url, init) => {
    sent = JSON.parse(init.body);
    return new Response(JSON.stringify([
      { md5: TP53_MD5.toUpperCase(), matches: [] },
      { md5: "00000000000000000000000000000000", matches: [] }
    ]));
  }) } });
  assert.deepEqual(sent, { md5: [TP53_MD5.toUpperCase()] });
  assert.equal(rows.length, 1);
});

test("FIXTURE: Route B requires a configured contact email and never fabricates a job id", async () => {
  assert.equal(hasContactEmail({}), null);
  assert.equal(hasContactEmail({ INTERPROSCAN_EMAIL: "researcher@example.org" }), "researcher@example.org");
  assert.equal(routeBUnavailable().code, "route_b_unavailable_no_contact_email");
  const missing = await submitIprscan6({ email: "", sequence: TP53, ctx: { fetch: stub(async () => {
    throw new Error("must not be called");
  }) } }).catch((error) => error);
  assert.equal(missing.code, "route_b_unavailable_no_contact_email");
  let form = null;
  const submission = await submitIprscan6({ email: "researcher@example.org", sequence: TP53,
    ctx: { fetch: stub((_url, init) => {
      form = init.body;
      return new Response("iprscan6-R20260626-231923-0712-31578623-p1m\n", { status: 200 });
    }) } });
  assert.equal(submission.job_id, "iprscan6-R20260626-231923-0712-31578623-p1m");
  assert.equal(submission.submitted_sequence_md5, TP53_MD5);
  const params = new URLSearchParams(form);
  assert.equal(params.get("email"), "researcher@example.org");
  assert.equal(params.get("stype"), "p");
  assert.equal(params.get("sequence"), TP53);
  // EBI's official submit() sends literal true/false booleans, not checkbox on/off.
  assert.equal(params.get("goterms"), "true");
  assert.equal(params.get("pathways"), "true");
  const malformed = await submitIprscan6({ email: "researcher@example.org", sequence: TP53,
    ctx: { fetch: stub(async () => new Response("ok\n")) } }).catch((error) => error);
  assert.equal(malformed.code, "iprscan6_invalid_job_id");
});

test("FIXTURE: InterProScan 6 status classification includes NOT_FOUND and ERROR", async () => {
  const job = "iprscan6-R20260626-231923-0712-31578623-p1m";
  for (const [state, expected] of [["QUEUED", "running"], ["RUNNING", "running"],
    ["FINISHED", "succeeded"], ["ERROR", "failed"], ["FAILURE", "failed"]]) {
    const result = await getIprscanStatus(job, { ctx: { fetch: stub(async () => new Response(state)) } });
    assert.equal(result.state, state);
    assert.equal(result.state_class, expected);
  }
  const notFound = await getIprscanStatus("iprscan6-fake", {
    ctx: { fetch: stub(async () => new Response("{}", { status: 404 })) }
  });
  assert.equal(notFound.state, "NOT_FOUND");
  assert.equal(notFound.state_class, "failed");
  const bad = await getIprscanStatus("bad-id", { ctx: { fetch: stub(async () => new Response("QUEUED")) } }).catch((error) => error);
  assert.equal(bad.code, "invalid_job_id");
  const parsed = await getIprscanResult(job, {
    ctx: { fetch: stub(async (url) => {
      assert.match(url, /\/result\/.*\/json$/);
      return new Response(JSON.stringify([{ md5: TP53_MD5, matches: [] }]));
    }) }
  });
  assert.equal(parsed[0].md5, TP53_MD5);
});

test("FIXTURE: releases come only from member DB fields; no InterPro release is guessed", () => {
  const releases = collectReleases(matches.matches);
  assert.equal(releases.interpro_release, null);
  assert.match(releases.interpro_release_reason, /not reported by the source/);
  assert.equal(releases.member_databases.Pfam, "39.0");
  assert.equal(releases.member_databases.PANTHER, "19.0");
  assert.equal(releases.member_databases["PROSITE patterns"], "2026_01");
  assert.equal(normalizeGoTerms(interproProtein.metadata.go_terms).length, 8);
  assert.equal(normalizeGoTerms([{ name: "orphan term" }])[0].identifier, null);
  assert.match(normalizeGoTerms([{ name: "orphan term" }])[0].identifier_reason, /not reported/);
});
