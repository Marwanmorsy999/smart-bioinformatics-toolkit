// M7.13.1 INTERPROSCAN 6 FORM CONTRACT — fully stubbed, ZERO live EBI calls.
// Every provider URL is answered by the in-memory fetch stub below; an
// unexpected URL throws. JOB_ID is a labelled FIXTURE, not a live job id, and
// INTERPROSCAN_EMAIL here is a fictional .invalid address (never a real
// deployment contact).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { getIprscanStatus, lookupMatches, submitIprscan6, validateProteinSequence } from "../functions/api/protein/provider.js";
import { handleAnnotate } from "../functions/api/protein/workflow.js";
import { createFakeD1AI, mockAIEnv } from "./helpers/fake-d1.mjs";

const EMAIL = "iprscan6-staging@example.invalid"; // fictional stub contact
const JOB_ID = "iprscan6-FIXTURE-20261126-000000-0000-00000000-p1m"; // labelled FIXTURE
const VARIANT_MD5 = "3dbe08f361d3d3e4c87da05775ccf4c9";
// P68871 beta-globin documented variant (147 aa, including the initiator M).
// The checksum assertion in the first test is the fixture integrity guard.
const VARIANT_SEQUENCE = "MVHLTVEEKSAVTALWGKVNVDEVGGEALGRLLVVYPWTQRFFESFGDLSTPDAVMGNPKV"
  + "KAHGKKVLGAFSDGLAHLDNLKGTFATLSELHCDKLHVDPENFRLLGNVLVCVLAHHFGKE"
  + "FTPPVQAAYQKVVAGVANALAHKYH";
const VARIANT_FASTA = `>P68871 documented variant 147 aa\n${VARIANT_SEQUENCE.match(/.{1,60}/g).join("\n")}\n`;
const P53_MD5 = "c133dfce69f606f20865e9008199f852";
const p53Fasta = readFileSync(new URL("./fixtures/m7_13_protein/P04637.fasta", import.meta.url), "utf8");
const p53Matches = JSON.parse(readFileSync(new URL("./fixtures/m7_13_protein/matches-P04637.json", import.meta.url), "utf8"));

function ids() {
  let counter = 1;
  return (kind) => `${kind}_${(counter++).toString(16).padStart(16, "0")}`;
}

function setup(handler) {
  const { db, state } = createFakeD1AI();
  const env = mockAIEnv(db);
  env.INTERPROSCAN_EMAIL = EMAIL;
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url: String(url), init: init ?? {} });
    return handler(String(url), init ?? {});
  };
  return { db, state, env, calls, fetchImpl, idFactory: ids() };
}

function post(payload) {
  return new Request("https://worker.example.test/api/ai/workflows/protein/annotate", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload)
  });
}

function submissions(calls) {
  return calls.filter((call) => call.url.endsWith("/iprscan6/run"));
}

function routingFetch(url) {
  if (url.includes("/matches/api/matches/")) {
    const md5 = String(url).split("/").at(-1).toUpperCase();
    if (md5 === VARIANT_MD5.toUpperCase()) return new Response("{}", { status: 404 });
    if (md5 === P53_MD5.toUpperCase()) return new Response(JSON.stringify(p53Matches));
    throw new Error(`unexpected Matches MD5 in stub: ${url}`);
  }
  if (url.endsWith("/iprscan6/run")) return new Response(JOB_ID, { status: 200 });
  if (url.includes("/entry/interpro/IPR")) return new Response(JSON.stringify({ metadata: { go_terms: [] } }));
  throw new Error(`unexpected live URL in stub: ${url}`);
}

test("ROUTE SELECTION: unindexed 147 aa variant (MD5 3dbe08f3…) has no Matches result and takes Route B; indexed sequence takes Route A", async () => {
  const check = validateProteinSequence(VARIANT_SEQUENCE);
  assert.equal(check.valid, true);
  assert.equal(check.length, 147);
  assert.equal(check.md5, VARIANT_MD5, "the documented variant fixture must keep its checksum");

  const ctx = setup(routingFetch);
  const options = { fetchImpl: ctx.fetchImpl, idFactory: ctx.idFactory };
  const variantLookup = await lookupMatches(VARIANT_MD5, { ctx: { fetch: ctx.fetchImpl } });
  assert.equal(variantLookup.status, "miss", "Matches API returned a genuine 404 for the variant");
  assert.equal(variantLookup.match_count, 0);
  const indexedLookup = await lookupMatches(P53_MD5, { ctx: { fetch: ctx.fetchImpl } });
  assert.equal(indexedLookup.status, "hit");
  assert.ok(indexedLookup.match_count > 0);

  // An indexed sequence is annotated from the precomputed evidence on Route A.
  const indexed = await (await handleAnnotate(post({ mode: "fasta", fasta_text: p53Fasta }), ctx.env, options)).json();
  assert.equal(indexed.route_label, "precomputed_reference_annotation");
  assert.equal(indexed.proteins[0].status, "annotated");
  assert.equal(submissions(ctx.calls).length, 0, "Route A never submits a job");

  // The unindexed variant has no precomputed evidence: Route A can only report
  // an honest no_matches result. Route B is then chosen explicitly by the
  // caller (route=iprscan6); no job is auto-submitted by a lookup miss.
  const noMatches = await (await handleAnnotate(post({ mode: "fasta", fasta_text: VARIANT_FASTA }), ctx.env, options)).json();
  assert.equal(noMatches.route_label, "precomputed_reference_annotation");
  assert.equal(noMatches.proteins[0].status, "no_matches");
  assert.equal(submissions(ctx.calls).length, 0);
  const executed = await handleAnnotate(post({ mode: "fasta", fasta_text: VARIANT_FASTA, route: "iprscan6" }), ctx.env, options);
  assert.equal(executed.status, 202);
  const running = await executed.json();
  assert.equal(running.route_label, "executed_interproscan6_analysis");
  assert.equal(running.provider_job_id, JOB_ID);
  assert.equal(submissions(ctx.calls).length, 1);
  const form = new URLSearchParams(submissions(ctx.calls)[0].init.body);
  assert.equal(form.get("sequence"), VARIANT_SEQUENCE);
});

test("SUBMIT FORM: goterms=true, pathways=true, stype=p and a valid job id is captured", async () => {
  const ctx = setup((url) => {
    assert.ok(url.endsWith("/iprscan6/run"));
    return new Response(JOB_ID, { status: 200 });
  });
  const submission = await submitIprscan6({ email: EMAIL, sequence: VARIANT_SEQUENCE, ctx: { fetch: ctx.fetchImpl } });
  assert.equal(submission.job_id, JOB_ID);
  assert.match(submission.job_id, /^iprscan\d?-\S+$/, "a real-shaped job id is captured");
  assert.equal(submission.submitted_sequence_md5, VARIANT_MD5);
  assert.equal(submission.email_used, EMAIL);
  const call = submissions(ctx.calls)[0];
  assert.equal(call.init.method, "POST");
  assert.equal(call.init.headers["Content-Type"], "application/x-www-form-urlencoded");
  const form = new URLSearchParams(call.init.body);
  assert.equal(form.get("goterms"), "true", "EBI boolean contract, not on/off");
  assert.equal(form.get("pathways"), "true", "EBI boolean contract, not on/off");
  assert.equal(form.get("stype"), "p");
  assert.equal(form.get("sequence"), VARIANT_SEQUENCE);
  assert.equal(form.get("email"), EMAIL);

  const off = setup((url) => {
    assert.ok(url.endsWith("/iprscan6/run"));
    return new Response(JOB_ID, { status: 200 });
  });
  await submitIprscan6({ email: EMAIL, sequence: VARIANT_SEQUENCE, goterms: false, pathways: false,
    ctx: { fetch: off.fetchImpl } });
  const offForm = new URLSearchParams(submissions(off.calls)[0].init.body);
  assert.equal(offForm.get("goterms"), "false");
  assert.equal(offForm.get("pathways"), "false");
});

test("AMBIGUOUS SUBMISSION: HTTP 200 XML error fails closed with an honest error and no persisted fake job", async () => {
  const xml = '<?xml version="1.0" encoding="UTF-8"?><error><description>Invalid submission</description></error>';
  const ctx = setup((url) => {
    if (url.endsWith("/iprscan6/run")) return new Response(xml, { status: 200 });
    throw new Error(`unexpected live URL in stub: ${url}`);
  });
  await assert.rejects(
    submitIprscan6({ email: EMAIL, sequence: VARIANT_SEQUENCE, ctx: { fetch: ctx.fetchImpl } }),
    (error) => {
      assert.equal(error.code, "iprscan6_invalid_job_id");
      assert.match(error.message, /no job reference was fabricated/);
      return true;
    }
  );
  const response = await handleAnnotate(post({ mode: "fasta", fasta_text: VARIANT_FASTA, route: "iprscan6" }),
    ctx.env, { fetchImpl: ctx.fetchImpl, idFactory: ctx.idFactory });
  assert.equal(response.status, 502);
  const body = await response.json();
  assert.equal(body.error_code, "iprscan6_invalid_job_id");
  assert.match(body.error, /did not return a valid job identifier/);
  assert.equal(body.provider_job_id ?? null, null);
  assert.equal(JSON.stringify(body).includes("iprscan6-"), false, "no fabricated job id in the response");
  assert.equal((ctx.state.tables.protein_runs ?? []).length, 0, "no protein run was persisted");
  assert.equal(submissions(ctx.calls).length, 2, "one direct submit and one handler submit, no retries");
});

test("REPEAT SUBMISSION: same sequence reuses the stored genuine job id with zero second submissions", async () => {
  let state = "RUNNING";
  const ctx = setup((url, init) => {
    if (url.endsWith("/iprscan6/run")) {
      assert.equal(new URLSearchParams(init.body).get("goterms"), "true");
      return new Response(JOB_ID, { status: 200 });
    }
    if (url.includes("/iprscan6/status/")) return new Response(state, { status: 200 });
    throw new Error(`unexpected live URL in stub: ${url}`);
  });
  const options = { fetchImpl: ctx.fetchImpl, idFactory: ctx.idFactory };
  const first = await (await handleAnnotate(post({ mode: "fasta", fasta_text: VARIANT_FASTA, route: "iprscan6" }),
    ctx.env, options)).json();
  assert.equal(first.status, "running");
  assert.equal(first.provider_job_id, JOB_ID);
  const stored = ctx.state.tables.protein_runs ?? [];
  assert.equal(stored.length, 1);
  assert.equal(stored[0].provider_job_id, JOB_ID);
  assert.equal(submissions(ctx.calls).length, 1);

  const second = await (await handleAnnotate(post({ mode: "fasta", fasta_text: VARIANT_FASTA, route: "iprscan6" }),
    ctx.env, options)).json();
  assert.equal(second.deduped, true);
  assert.equal(second.dedupe_route, "iprscan6");
  assert.equal(second.run_id, first.run_id);
  assert.equal(second.provider_job_id, JOB_ID);
  assert.equal(submissions(ctx.calls).length, 1, "refresh reuses the real job id; no second submission");
});

test("STATUS ACCEPT: /status uses Accept: text/plain; plain-text FINISHED is succeeded and ERROR is failed", async () => {
  const states = ["FINISHED", "ERROR"];
  const ctx = setup((url, init) => {
    assert.equal(url, `https://www.ebi.ac.uk/Tools/services/rest/iprscan6/status/${encodeURIComponent(JOB_ID)}`);
    assert.equal(init.method, "GET");
    assert.equal(init.headers.Accept, "text/plain", "EBI /status rejects application/json with HTTP 406");
    return new Response(states.shift() ?? "FINISHED", { status: 200 });
  });
  const finished = await getIprscanStatus(JOB_ID, { ctx: { fetch: ctx.fetchImpl } });
  assert.equal(finished.job_id, JOB_ID);
  assert.equal(finished.state, "FINISHED");
  assert.equal(finished.state_class, "succeeded");
  const errored = await getIprscanStatus(JOB_ID, { ctx: { fetch: ctx.fetchImpl } });
  assert.equal(errored.job_id, JOB_ID);
  assert.equal(errored.state, "ERROR");
  assert.equal(errored.state_class, "failed");
  assert.equal(ctx.calls.length, 2);
  assert.equal(submissions(ctx.calls).length, 0, "polling an existing job never resubmits");
});
