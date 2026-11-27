// M7.14 CPU-boundary tests: plan-time inspection is sampled and bounded; full
// counts/QC are only claimed from genuine tool artifacts or small local files.
// Every fetch is stubbed; no live job or provider call is made.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { resolvePublicDataset } from "../functions/api/ai/workflows/microbiome/public-data.js";
import { inspectInputs, validationOf, observedQc, LIMITS } from "../functions/api/ai/workflows/microbiome/engine.js";
import { parseFastq, parseQcSummary } from "../functions/api/ai/workflows/microbiome/parsers.js";
import { sha256Bytes } from "../public/js/microbiome-zip.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const fixture = (name) => readFileSync(resolve(HERE, "fixtures/m7_14_microbiome", name));
const SAMPLE_BYTES = LIMITS.publicSampleBytes;

async function sampledResolver() {
  const metadata = fixture("sample-metadata.tsv");
  const reads = gzipSync(fixture("sequences.fastq"));
  const barcodes = gzipSync(fixture("barcodes.fastq"));
  const descriptor = {
    key: "fixture-dataset",
    metadata_url: "https://fixture.test/metadata.tsv",
    reads_url: "https://fixture.test/sequences.fastq.gz",
    barcodes_url: "https://fixture.test/barcodes.fastq.gz",
    expected_metadata_sha256: await sha256Bytes(metadata),
    expected_reads_sha256: await sha256Bytes(reads),
    expected_barcodes_sha256: await sha256Bytes(barcodes),
    zip_provenance: { url: "https://fixture.test/archive.zip", sha256: "f".repeat(64) },
    expected_samples: 3, expected_reads: 3, rationale: "Labelled tiny fixture."
  };
  const fetchImpl = async (url) => {
    if (String(url).endsWith("metadata.tsv")) return new Response(metadata);
    if (String(url).endsWith("sequences.fastq.gz")) return new Response(reads);
    if (String(url).endsWith("barcodes.fastq.gz")) return new Response(barcodes);
    return new Response(null, { status: 404 });
  };
  return { fetchImpl, descriptor, bytes: { metadata, reads, barcodes } };
}

test("BOUNDED PLAN: sampled inspection never claims a full read count", async () => {
  const { fetchImpl, descriptor } = await sampledResolver();
  const resolved = await resolvePublicDataset(descriptor, fetchImpl, { sampleBytes: SAMPLE_BYTES });
  const inspection = inspectInputs(resolved);
  const validation = validationOf(inspection);
  assert.equal(inspection.sampled, true);
  assert.ok(inspection.reads.record_count <= Math.ceil(SAMPLE_BYTES / 40));
  assert.ok(inspection.sample.reads <= Math.ceil(SAMPLE_BYTES / 40));
  assert.equal(validation.status, "pass");
  assert.equal(validation.reads, null, "no full read count is asserted from a sample");
  assert.equal(validation.barcodes, null);
  assert.equal(validation.sample_size_bytes, SAMPLE_BYTES);
  assert.match(validation.warnings.join(" "), /bounded sample/);
  assert.equal(inspection.rawQc, null);
  assert.match(inspection.correspondence.basis, /bounded_sample/);
  assert.equal(resolved.reads_text, null, "no full FASTQ text is produced in the Worker request");
});

test("BOUNDED PLAN: a larger fixture still samples only its bounded prefix", async () => {
  const { fetchImpl, descriptor, bytes } = await sampledResolver();
  const metadata = fixture("sample-metadata.tsv");
  const readsText = (`@i 16S\n${"ACGT".repeat(38)}\n+\n${"I".repeat(152)}\n`).repeat(4000);
  const gz = gzipSync(Buffer.from(readsText));
  const bigDescriptor = { ...descriptor,
    expected_reads_sha256: await sha256Bytes(new Uint8Array(gz)),
    expected_barcodes_sha256: await sha256Bytes(new Uint8Array(gz)) };
  const bigFetch = async (url) => {
    if (String(url).endsWith("metadata.tsv")) return new Response(metadata);
    if (String(url).endsWith("sequences.fastq.gz")) return new Response(gz);
    if (String(url).endsWith("barcodes.fastq.gz")) return new Response(gz);
    return new Response(null, { status: 404 });
  };
  const resolved = await resolvePublicDataset(bigDescriptor, bigFetch, { sampleBytes: 4096 });
  const inspection = inspectInputs(resolved);
  assert.ok(inspection.reads.record_count <= Math.ceil(4096 / 40));
  assert.ok(inspection.reads.record_count < 4000);
  assert.equal(validationOf(inspection).reads, null);
  assert.equal(bytes.reads.length > 0, true);
});

test("QC GATE: plan samples are never reported as QC; tool artifacts are", () => {
  const publicState = { input: { mode: "public" },
    qc: { raw: null, basis: "bounded_first_bytes_sample" } };
  const gated = observedQc(publicState);
  assert.equal(gated.available, false);
  assert.match(gated.reason, /Galaxy artifacts/);

  const uploadedState = { input: { mode: "upload" }, qc: { raw: {
    available: true, basis: "worker_computed_from_uploaded_fastq", reads: { read_count: 3 }
  } } };
  const local = observedQc(uploadedState);
  assert.equal(local.available, true);
  assert.equal(local.basis, "worker_computed_from_uploaded_fastq");

  // A genuine tool artifact is always accepted as QC, independent of source.
  const toolQc = parseQcSummary(fixture("qc-stats.tsv"));
  assert.equal(toolQc.available, true);
  assert.equal(toolQc.samples.length, 3);
  assert.equal(parseFastq(fixture("sequences.fastq")).record_count, 3);
});
