// M7.13 OFFLINE WORKFLOW TESTS. Provider calls are stubbed in memory; the
// large Matches body is a saved GENUINE response used as an offline fixture.
// Fake job ids and live-shaped result bodies below are labelled FIXTURE.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";

import {
  handleAnnotate, handleDomains, handlePlan, handleResult, handleStatus
} from "../functions/api/protein/workflow.js";
import { handleGetRecovery } from "../functions/api/ai/runs/[id]/recovery.js";
import { createFakeD1AI, mockAIEnv } from "./helpers/fake-d1.mjs";
import { createFetch, handlers } from "../worker.js";

const FIX = new URL("./fixtures/m7_13_protein/", import.meta.url);
const fasta = readFileSync(new URL("P04637.fasta", FIX), "utf8");
const matches = JSON.parse(readFileSync(new URL("matches-P04637.json", FIX), "utf8"));
const uniprot = JSON.parse(readFileSync(new URL("uniprot-P04637.json", FIX), "utf8"));
const interproProtein = JSON.parse(readFileSync(new URL("interpro-protein-P04637.json", FIX), "utf8"));
const MD5 = "c133dfce69f606f20865e9008199f852";
const JOB_ID = "iprscan6-R20260626-231923-0712-31578623-p1m";

function ids(prefix = "id") {
  let counter = 1;
  return (kind) => `${kind}_${(counter++).toString(16).padStart(16, "0")}`;
}

function post(payload, path = "/api/ai/workflows/protein/annotate") {
  return new Request(`https://worker.example.test${path}`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload)
  });
}

function get(path) {
  return new Request(`https://worker.example.test${path}`, { method: "GET" });
}

function setup(handler, { email = null } = {}) {
  const { db, state } = createFakeD1AI();
  const env = mockAIEnv(db);
  if (email) env.INTERPROSCAN_EMAIL = email;
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url: String(url), init: init ?? {} });
    return handler(String(url), init ?? {});
  };
  return { db, state, env, calls, fetchImpl, idFactory: ids() };
}

function genuineFetch(url) {
  if (url.includes("rest.uniprot.org/uniprotkb/P04637.json")) {
    return new Response(JSON.stringify(uniprot), { status: 200 });
  }
  if (url.includes("interpro/api/protein/UniProt/P04637")) {
    return new Response(JSON.stringify(interproProtein), { status: 200 });
  }
  if (url.includes("/matches/api/matches/")) {
    return new Response(JSON.stringify(matches), { status: 200 });
  }
  if (url.includes("/entry/interpro/IPR")) {
    // FIXTURE: the genuine protein GO term list is reused here as an
    // entry-shaped offline stub so enrichment is testable without live calls.
    return new Response(JSON.stringify({ metadata: { go_terms: interproProtein.metadata.go_terms } }), { status: 200 });
  }
  return new Response("{}", { status: 404 });
}

test("PLAN: accession resolution and FASTA validation are server-side; route B needs an email", async () => {
  const noEmail = setup(genuineFetch);
  const accessionPlan = await handlePlan(post({ mode: "accession", accession: "p04637" },
    "/api/ai/workflows/protein/plan"), noEmail.env, { fetchImpl: noEmail.fetchImpl });
  assert.equal(accessionPlan.status, 200);
  const plan = await accessionPlan.json();
  assert.equal(plan.workflow_type, "protein");
  assert.equal(plan.input.md5, MD5.toUpperCase());
  assert.equal(plan.input.sequences[0].length, 393);
  assert.equal(plan.metadata.reviewed, true);
  assert.equal(plan.plan.route_availability.precomputed.label, "precomputed_reference_annotation");
  assert.equal(plan.plan.route_availability.iprscan6.available, false);
  assert.match(plan.plan.route_availability.iprscan6.reason, /route_b_unavailable_no_contact_email/);
  const fastaPlan = await handlePlan(post({ mode: "fasta", fasta_text: fasta },
    "/api/ai/workflows/protein/plan"), noEmail.env, { fetchImpl: noEmail.fetchImpl });
  assert.equal((await fastaPlan.json()).input.md5, MD5.toUpperCase());
  const bad = await handlePlan(post({ mode: "fasta", fasta_text: ">a\nACGTACGTACGTACGTACGTACGTACGTACGTACGTACGT" },
    "/api/ai/workflows/protein/plan"), noEmail.env, { fetchImpl: noEmail.fetchImpl });
  assert.equal(bad.status, 400);
  assert.match((await bad.json()).error, /nucleotide/i);
});

test("ROUTE A: genuine matches produce labelled evidence, 10-section report and 7 exports", async () => {
  const ctx = setup(genuineFetch);
  const response = await handleAnnotate(post({ mode: "fasta", fasta_text: fasta, objective: "domains" }),
    ctx.env, { fetchImpl: ctx.fetchImpl, idFactory: ctx.idFactory });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.route_label, "precomputed_reference_annotation");
  assert.equal(body.status, "succeeded");
  assert.equal(body.proteins[0].annotation.features.length, 32);
  assert.equal(body.proteins[0].annotation.entries.length, 9);
  assert.equal(body.releases.member_databases.Pfam, "39.0");
  assert.equal(body.releases.interpro_release, null);
  assert.equal(body.report.sections.length, 10);
  assert.match(body.report.text, /10\. Reproducibility and exports/);
  assert.match(body.reopen.ai_run_id, /^job_[0-9a-f]{16}$/);
  assert.equal(body.input.fasta_text.trim(), fasta.trim());
  const detail = await (await handleResult(get(`/api/ai/workflows/protein/result?run_id=${body.run_id}`), ctx.env)).json();
  const runDetail = await (await createFetch()(
    new Request(`https://worker.example.test/api/ai/runs/${body.run_id}`),
    { ASSETS: null, AI_DB: ctx.db, BLAST_DB: ctx.db }, null)).json();
  assert.equal(runDetail.artifacts.length, 7);
  assert.deepEqual(runDetail.artifacts.map((artifact) => artifact.name).sort(),
    ["annotation.json", "annotations.gff3", "annotations.tsv", "input.fasta", "provider.json", "report.txt", "summary.json"]);
  assert.equal(detail.route_label, body.route_label);
});

test("ROUTE A: dedupe by sequence MD5 returns the stored run and makes zero new provider calls", async () => {
  const ctx = setup(genuineFetch);
  const options = { fetchImpl: ctx.fetchImpl, idFactory: ctx.idFactory };
  const first = await (await handleAnnotate(post({ mode: "fasta", fasta_text: fasta }), ctx.env, options)).json();
  const callsAfterFirst = ctx.calls.length;
  const second = await (await handleAnnotate(post({ mode: "fasta", fasta_text: fasta }), ctx.env, options)).json();
  assert.equal(second.deduped, true);
  assert.equal(second.dedupe_basis, "stored_protein_run_by_md5");
  assert.equal(second.run_id, first.run_id);
  assert.equal(ctx.calls.length, callsAfterFirst);
});

test("ROUTE A: a genuine 404 miss yields an empty, honestly-labelled result", async () => {
  const ctx = setup(async (url) => url.includes("/matches/api/matches/")
    ? new Response("{}", { status: 404 }) : genuineFetch(url));
  const body = await (await handleAnnotate(post({ mode: "fasta", fasta_text: fasta }), ctx.env,
    { fetchImpl: ctx.fetchImpl, idFactory: ctx.idFactory })).json();
  assert.equal(body.status, "succeeded");
  assert.equal(body.proteins[0].status, "no_matches");
  assert.equal(body.proteins[0].annotation.features.length, 0);
  assert.equal(body.proteins[0].annotation.route_label, "precomputed_reference_annotation");
  assert.match(body.proteins[0].annotation.missing_field_reasons[0], /No precomputed/);
});

test("ROUTE B: absent contact email fails closed before any submission", async () => {
  const ctx = setup(async () => { throw new Error("must not be called"); });
  const response = await handleAnnotate(post({ mode: "fasta", fasta_text: fasta, route: "iprscan6" }),
    ctx.env, { fetchImpl: ctx.fetchImpl, idFactory: ctx.idFactory });
  assert.equal(response.status, 503);
  const body = await response.json();
  assert.equal(body.error_code, "route_b_unavailable_no_contact_email");
  assert.equal(ctx.calls.length, 0);
});

test("ROUTE B: job id is stored, never re-submitted, and FINISHED parses the genuine result", async () => {
  let state = "QUEUED";
  let releases = 0;
  const ctx = setup((url, init) => {
    if (url.endsWith("/iprscan6/run")) {
      const form = new URLSearchParams(init.body);
      assert.equal(form.get("email"), "researcher@example.org");
      releases += 1;
      return new Response(JOB_ID, { status: 200 });
    }
    if (url.includes("/iprscan6/status/")) return new Response(state, { status: 200 });
    if (url.includes("/iprscan6/result/")) {
      return new Response(JSON.stringify([{ md5: MD5.toUpperCase(), matches: matches.matches, sequence: uniprot.sequence.value }]),
        { status: 200 });
    }
    return new Response("{}", { status: 404 });
  }, { email: "researcher@example.org" });
  const options = { fetchImpl: ctx.fetchImpl, idFactory: ctx.idFactory };
  const submitted = await handleAnnotate(post({ mode: "fasta", fasta_text: fasta, route: "iprscan6" }), ctx.env, options);
  assert.equal(submitted.status, 202);
  const running = await submitted.json();
  assert.equal(running.route_label, "executed_interproscan6_analysis");
  assert.equal(running.provider_job_id, JOB_ID);
  assert.equal(running.status, "running");
  assert.equal(releases, 1);
  const repeated = await (await handleAnnotate(post({ mode: "fasta", fasta_text: fasta, route: "iprscan6" }),
    ctx.env, options)).json();
  assert.equal(repeated.deduped, true);
  assert.equal(repeated.provider_job_id, JOB_ID);
  assert.equal(releases, 1, "refresh never re-submits");
  const resultWhileRunning = await handleResult(get(`/api/ai/workflows/protein/result?run_id=${running.run_id}`), ctx.env);
  assert.equal(resultWhileRunning.status, 409);

  const queued = await (await handleStatus(get(`/api/ai/workflows/protein/status?run_id=${running.run_id}`), ctx.env, options)).json();
  assert.equal(queued.status, "running");
  assert.equal(queued.state, "QUEUED");
  assert.equal(queued.result_url.includes(running.run_id), true);

  state = "FINISHED";
  const finished = await handleStatus(get(`/api/ai/workflows/protein/status?run_id=${running.run_id}`), ctx.env, options);
  assert.equal(finished.status, 200);
  const final = await finished.json();
  assert.equal(final.status, "succeeded");
  assert.equal(final.route_label, "executed_interproscan6_analysis");
  assert.equal(final.proteins[0].annotation.features.length, 32);
  assert.equal(final.proteins[0].annotation.releases.tool_version, null);
  assert.match(final.proteins[0].annotation.releases.tool_version_reason, /did not report/);
  const stored = await (await handleResult(get(`/api/ai/workflows/protein/result?run_id=${running.run_id}`), ctx.env)).json();
  assert.equal(stored.status, "succeeded");
  assert.equal(releases, 1);
});

test("ROUTE B: ERROR state records honest failure and no fabricated result", async () => {
  const ctx = setup((url) => {
    if (url.endsWith("/iprscan6/run")) return new Response(JOB_ID, { status: 200 });
    if (url.includes("/iprscan6/status/")) return new Response("ERROR", { status: 200 });
    return new Response("{}", { status: 404 });
  }, { email: "researcher@example.org" });
  const options = { fetchImpl: ctx.fetchImpl, idFactory: ctx.idFactory };
  const running = await (await handleAnnotate(post({ mode: "fasta", fasta_text: fasta, route: "iprscan6" }), ctx.env, options)).json();
  const response = await handleStatus(get(`/api/ai/workflows/protein/status?job_id=${JOB_ID}`), ctx.env, options);
  assert.equal(response.status, 502);
  assert.equal(response.headers.get("X-Protein-Error"), "iprscan6_job_failed");
  const result = await handleResult(get(`/api/ai/workflows/protein/result?run_id=${running.run_id}`), ctx.env);
  assert.equal(result.status, 200);
  assert.equal((await result.json()).status, "failed");
});

test("DOMAINS: stored feature details and evidence links come from the stored run", async () => {
  const ctx = setup(genuineFetch);
  const body = await (await handleAnnotate(post({ mode: "fasta", fasta_text: fasta }), ctx.env,
    { fetchImpl: ctx.fetchImpl, idFactory: ctx.idFactory })).json();
  const response = await handleDomains(get(`/api/ai/workflows/protein/domains?run_id=${body.run_id}&accession=IPR011615`), ctx.env);
  assert.equal(response.status, 200);
  const detail = await response.json();
  assert.equal(detail.entry.accession, "IPR011615");
  assert.ok(detail.locations.length >= 1);
  assert.ok(detail.locations.every((item) => Array.isArray(item.locations) && item.locations.length > 0));
  assert.equal(detail.evidence_links.interpro_entry, "https://www.ebi.ac.uk/interpro/entry/InterPro/IPR011615");
  assert.equal(detail.evidence_links.matches.includes(MD5.toUpperCase()), true);
  const missing = await handleDomains(get(`/api/ai/workflows/protein/domains?run_id=${body.run_id}&accession=IPR999999`), ctx.env);
  assert.equal(missing.status, 404);
});

test("RECOVERY: protein workflow is reconstructed from stored artifacts only, read-only", async () => {
  const ctx = setup(genuineFetch);
  const body = await (await handleAnnotate(post({ mode: "fasta", fasta_text: fasta }), ctx.env,
    { fetchImpl: ctx.fetchImpl, idFactory: ctx.idFactory })).json();
  const before = ctx.calls.length;
  const response = await handleGetRecovery(get(`/api/ai/runs/${body.run_id}/recovery`), ctx.env, body.run_id);
  assert.equal(response.status, 200);
  const recovery = await response.json();
  assert.equal(recovery.workflow_type, "protein");
  assert.equal(recovery.evidence_only, true);
  assert.equal(recovery.protein.route_label, "precomputed_reference_annotation");
  assert.match(recovery.protein.input_fasta, />sp\|P04637/);
  assert.deepEqual(recovery.protein.sequence_identifiers, ["sp|P04637|P53_HUMAN"]);
  assert.equal(recovery.protein.proteins[0].features.length, 32);
  assert.equal(recovery.protein.proteins[0].go.terms.length > 0, true);
  assert.equal(recovery.protein.releases.member_databases.Pfam, "39.0");
  assert.equal(recovery.protein.original_execution_state.provider_job_id, null);
  assert.match(recovery.protein.original_execution_state.note, /No executed provider job/);
  assert.equal(recovery.protein.report.length > 0, true);
  assert.equal(ctx.calls.length, before, "recovery makes no provider call");
});

test("WORKER: all five protein routes are registered before the generic AI run path", () => {
  for (const key of ["proteinPlan", "proteinAnnotate", "proteinStatus", "proteinResult", "proteinDomains"]) {
    assert.equal(typeof handlers[key], "function", key);
  }
  const fetch = createFetch({ ...handlers, proteinAnnotate: () => new Response("ok") });
  return fetch(new Request("https://worker.example.test/api/ai/workflows/protein/annotate", {
    method: "POST"
  }), {}, null).then((response) => assert.equal(response.status, 200));
});

// --------------------------------------------------------------- M7.13 fixes
test("DEDUPED ROUTES: a Route A run never satisfies a Route B request (and vice versa)", async () => {
  const ctx = setup(genuineFetch);
  const options = { fetchImpl: ctx.fetchImpl, idFactory: ctx.idFactory };
  const precomputed = await (await handleAnnotate(post({ mode: "fasta", fasta_text: fasta }), ctx.env, options)).json();
  const callsBeforeRouteB = ctx.calls.length;
  const routeB = await handleAnnotate(post({ mode: "fasta", fasta_text: fasta, route: "iprscan6" }),
    ctx.env, options);
  assert.equal(routeB.status, 503, "Route B fails closed with no contact email even though MD5 has a Route A run");
  const routeBody = await routeB.json();
  assert.equal(routeBody.error_code, "route_b_unavailable_no_contact_email");
  assert.equal(routeBody.provider_job_id ?? null, null);
  assert.equal(ctx.calls.length, callsBeforeRouteB, "zero submissions");
  const precomputedAgain = await (await handleAnnotate(post({ mode: "fasta", fasta_text: fasta }), ctx.env, options)).json();
  assert.equal(precomputedAgain.run_id, precomputed.run_id);
  assert.equal(precomputedAgain.deduped, true);
  assert.equal(precomputedAgain.dedupe_route, "precomputed");

  // The reverse direction is also separated: an existing running Route B job
  // must not be returned for a Route A annotation of the same sequence.
  const executed = setup((url, init) => {
    if (String(url).endsWith("/iprscan6/run")) return new Response(JOB_ID, { status: 200 });
    if (String(url).includes("/matches/api/matches/")) return new Response(JSON.stringify(matches));
    if (String(url).includes("/entry/interpro/IPR")) {
      return new Response(JSON.stringify({ metadata: { go_terms: [] } }));
    }
    return new Response("{}", { status: 404 });
  }, { email: "researcher@example.org" });
  const executedOptions = { fetchImpl: executed.fetchImpl, idFactory: executed.idFactory };
  const running = await (await handleAnnotate(post({ mode: "fasta", fasta_text: fasta, route: "iprscan6" }),
    executed.env, executedOptions)).json();
  assert.equal(running.status, "running");
  const precomputedAfter = await (await handleAnnotate(post({ mode: "fasta", fasta_text: fasta }),
    executed.env, executedOptions)).json();
  assert.equal(precomputedAfter.deduped ?? false, false, "Route A cannot reuse the Route B job");
  assert.notEqual(precomputedAfter.run_id, running.run_id);
  assert.equal(precomputedAfter.route_label, "precomputed_reference_annotation");
  assert.equal(precomputedAfter.provider_job_id, null);
});

test("DEDUPED ROUTES: repeated running Route B request returns the SAME job id with a route+job dedupe key", async () => {
  const ctx = setup((url, init) => {
    if (String(url).endsWith("/iprscan6/run")) return new Response(JOB_ID, { status: 200 });
    if (String(url).includes("/iprscan6/status/")) return new Response("RUNNING", { status: 200 });
    return new Response("{}", { status: 404 });
  }, { email: "researcher@example.org" });
  const options = { fetchImpl: ctx.fetchImpl, idFactory: ctx.idFactory };
  const first = await (await handleAnnotate(post({ mode: "fasta", fasta_text: fasta, route: "iprscan6" }), ctx.env, options)).json();
  const submitted = ctx.calls.filter((call) => call.url.endsWith("/iprscan6/run")).length;
  const second = await (await handleAnnotate(post({ mode: "fasta", fasta_text: fasta, route: "iprscan6" }), ctx.env, options)).json();
  assert.equal(second.deduped, true);
  assert.equal(second.provider_job_id, first.provider_job_id);
  assert.equal(second.run_id, first.run_id);
  assert.equal(second.dedupe_route, "iprscan6");
  assert.match(second.dedupe_key, new RegExp(JOB_ID.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.equal(ctx.calls.filter((call) => call.url.endsWith("/iprscan6/run")).length, submitted, "no resubmission");
  const status = await (await handleStatus(get(`/api/ai/workflows/protein/status?run_id=${first.run_id}`), ctx.env, options)).json();
  assert.equal(status.status, "running");
  assert.equal(status.state, "RUNNING");
});

test("FAILED EXECUTED JOB: ERROR is reported failed on first and repeated status checks", async () => {
  const ctx = setup((url) => {
    if (String(url).endsWith("/iprscan6/run")) return new Response(JOB_ID, { status: 200 });
    if (String(url).includes("/iprscan6/status/")) return new Response("ERROR", { status: 200 });
    if (String(url).includes("/iprscan6/result/")) throw new Error("no result may be fetched for a failed job");
    return new Response("{}", { status: 404 });
  }, { email: "researcher@example.org" });
  const options = { fetchImpl: ctx.fetchImpl, idFactory: ctx.idFactory };
  const running = await (await handleAnnotate(post({ mode: "fasta", fasta_text: fasta, route: "iprscan6" }), ctx.env, options)).json();
  const firstResponse = await handleStatus(get(`/api/ai/workflows/protein/status?run_id=${running.run_id}`), ctx.env, options);
  const first = await firstResponse.json();
  assert.equal(first.status, "failed");
  assert.equal(first.state, "ERROR");
  assert.equal(first.result_state, "failed");
  const secondResponse = await handleStatus(get(`/api/ai/workflows/protein/status?run_id=${running.run_id}`), ctx.env, options);
  const second = await secondResponse.json();
  assert.equal(second.status, "failed");
  assert.equal(second.state, "ERROR");
  assert.equal(second.result_state, "failed");
  const stored = await (await handleResult(get(`/api/ai/workflows/protein/result?run_id=${running.run_id}`), ctx.env)).json();
  assert.equal(stored.status, "failed");
  assert.equal(stored.result_state, "failed");
  assert.deepEqual(stored.proteins, []);
  assert.equal(stored.route_label, "executed_interproscan6_analysis");
  const recovery = await (await handleGetRecovery(get(`/api/ai/runs/${running.run_id}/recovery`), ctx.env, running.run_id)).json();
  assert.equal(recovery.protein.original_execution_state.run_status, "failed");
  assert.equal(recovery.protein.original_execution_state.provider_job_state, "ERROR");
  assert.equal(recovery.protein.proteins.length, 0);
  const runDetail = await (await createFetch()(new Request(`https://worker.example.test/api/ai/runs/${running.run_id}`),
    { AI_DB: ctx.db, BLAST_DB: ctx.db }, null)).json();
  assert.equal(runDetail.artifacts.length, 0, "no fabricated evidence artifacts for a failed job");
  const stepStatuses = Object.fromEntries((runDetail.jobs ?? []).map((job) => [job.step_id, job.status]));
  assert.equal(stepStatuses.protein_run, "failed");
  assert.equal(stepStatuses.protein_annotate, "failed");
  assert.equal(stepStatuses.protein_report, "skipped_due_to_failure");
});

test("ROUTE B FASTA: FINISHED run stores the submitted bytes verbatim with a matching checksum", async () => {
  let state = "QUEUED";
  const ctx = setup((url, init) => {
    if (String(url).endsWith("/iprscan6/run")) return new Response(JOB_ID, { status: 200 });
    if (String(url).includes("/iprscan6/status/")) return new Response(state, { status: 200 });
    if (String(url).includes("/iprscan6/result/")) {
      return new Response(JSON.stringify([{ md5: MD5.toUpperCase(), matches: matches.matches,
        sequence: fasta.replace(/^>[^\n]*\n/, "").replace(/\s+/g, "") }]), { status: 200 });
    }
    if (String(url).includes("/entry/interpro/IPR")) return new Response(JSON.stringify({ metadata: { go_terms: [] } }));
    return new Response("{}", { status: 404 });
  }, { email: "researcher@example.org" });
  const options = { fetchImpl: ctx.fetchImpl, idFactory: ctx.idFactory };
  const running = await (await handleAnnotate(post({ mode: "fasta", fasta_text: fasta, route: "iprscan6" }), ctx.env, options)).json();
  state = "FINISHED";
  const finished = await (await handleStatus(get(`/api/ai/workflows/protein/status?run_id=${running.run_id}`), ctx.env, options)).json();
  assert.equal(finished.status, "succeeded");
  assert.equal(finished.state, "FINISHED");
  const stored = await (await handleResult(get(`/api/ai/workflows/protein/result?run_id=${running.run_id}`), ctx.env)).json();
  assert.equal(stored.input.fasta_text, fasta, "the exact submitted FASTA survives the asynchronous result");
  const runDetail = await (await createFetch()(new Request(`https://worker.example.test/api/ai/runs/${running.run_id}`),
    { AI_DB: ctx.db, BLAST_DB: ctx.db }, null)).json();
  const fastaArtifact = runDetail.artifacts.find((artifact) => artifact.name === "input.fasta");
  assert.ok(fastaArtifact);
  assert.equal(fastaArtifact.content, fasta);
  assert.equal(fastaArtifact.sha256, createHash("sha256").update(fasta, "utf8").digest("hex"));
  assert.equal(fastaArtifact.bytes, Buffer.byteLength(fasta, "utf8"));
  const recovery = await (await handleGetRecovery(get(`/api/ai/runs/${running.run_id}/recovery`), ctx.env, running.run_id)).json();
  assert.equal(recovery.protein.input_fasta, fasta);
});
