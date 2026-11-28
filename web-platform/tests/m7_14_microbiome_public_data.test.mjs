// M7.14 public dataset resolution tests. The fetch stubs return tiny labelled
// gzip fixtures (or a generated real-shaped fixture); checksums are recomputed
// from those bytes. No network request is made and no result is fabricated.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { resolvePublicDataset, sampleGzipPrefix } from "../functions/api/ai/workflows/microbiome/public-data.js";
import { PUBLIC_DATASETS, sha256Bytes } from "../public/js/microbiome-zip.js";
import { parseFastq, parseMetadataTsv } from "../functions/api/ai/workflows/microbiome/parsers.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const fixture = (name) => readFileSync(resolve(HERE, "fixtures/m7_14_microbiome", name));
const SAMPLE_BYTES = 200 * 1024;

async function descriptor({ corrupt = null, gzReads = true, gzBarcodes = true } = {}) {
  const metadata = fixture("sample-metadata.tsv");
  const reads = gzReads ? gzipSync(fixture("sequences.fastq")) : fixture("sequences.fastq");
  const barcodes = gzBarcodes ? gzipSync(fixture("barcodes.fastq")) : fixture("barcodes.fastq");
  return {
    bytes: { metadata, reads, barcodes },
    descriptor: {
      key: "fixture-dataset",
      metadata_url: "https://fixture.test/metadata.tsv",
      reads_url: "https://fixture.test/sequences.fastq.gz",
      barcodes_url: "https://fixture.test/barcodes.fastq.gz",
      expected_metadata_sha256: corrupt === "metadata" ? "0".repeat(64) : await sha256Bytes(metadata),
      expected_reads_sha256: corrupt === "reads" ? "0".repeat(64) : await sha256Bytes(reads),
      expected_barcodes_sha256: corrupt === "barcodes" ? "0".repeat(64) : await sha256Bytes(barcodes),
      zip_provenance: { url: "https://fixture.test/archive.zip", sha256: "f".repeat(64) },
      expected_samples: 3, expected_reads: 3, rationale: "Labelled tiny fixture."
    }
  };
}

function stubFor({ metadata, reads, barcodes }, overrides = {}) {
  return async (url) => {
    const text = String(url);
    if (Object.hasOwn(overrides, text)) return overrides[text];
    if (text.endsWith("metadata.tsv")) return new Response(metadata);
    if (text.endsWith("sequences.fastq.gz")) return new Response(reads);
    if (text.endsWith("barcodes.fastq.gz")) return new Response(barcodes);
    return new Response(null, { status: 404 });
  };
}

test("PUBLIC DATASET: direct sources are checksum-verified; only a bounded prefix is decoded", async () => {
  const { descriptor: desc, bytes } = await descriptor();
  const resolved = await resolvePublicDataset(desc, stubFor(bytes), { sampleBytes: SAMPLE_BYTES });
  assert.equal(resolved.mode, "public");
  // Original .gz bytes are preserved for upload; NO full text is produced.
  assert.equal(resolved.reads_filename, "sequences.fastq.gz");
  assert.equal(resolved.reads_text, null);
  assert.equal(resolved.barcodes_text, null);
  assert.equal(resolved.reads_bytes.length, bytes.reads.length);
  assert.equal(resolved.barcodes_bytes.length, bytes.barcodes.length);
  assert.match(resolved.metadata_text, /sampleA/);
  assert.equal(resolved.source.urls.reads, desc.reads_url);
  assert.equal(resolved.source.urls.barcodes, desc.barcodes_url);
  assert.equal(resolved.source.checksums.reads_sha256, await sha256Bytes(bytes.reads));
  assert.equal(resolved.source.checksums.barcodes_sha256, await sha256Bytes(bytes.barcodes));
  assert.match(resolved.source.provenance_note, /provenance references only/);
  assert.match(resolved.source.expectation_basis, /published_descriptor_expectation/);
  assert.equal(resolved.observed_sample.basis, "bounded_first_bytes_sample");
  assert.ok(resolved.observed_sample.reads.bytes <= SAMPLE_BYTES);
  assert.match(resolved.observed_sample.reads.text, /@instrument1 sequences/);
  assert.match(resolved.observed_sample.barcodes.text, /ACCGCACTT/);
  assert.match(resolved.observed_sample.note, /NOT a read count/);
});

test("PUBLIC DATASET: sampleGzipPrefix never decodes more than its cap", async () => {
  const big = Buffer.from(("x".repeat(64 * 1024) + "\n").repeat(20));
  const gz = gzipSync(big);
  const sample = await sampleGzipPrefix(new Uint8Array(gz), 4096);
  assert.equal(sample.bytes, 4096);
  assert.equal(sample.text.length, 4096);
  assert.equal(sample.truncated, true);
  assert.equal(sample.basis, "bounded_gzip_prefix_sample");
  const plain = await sampleGzipPrefix(new Uint8Array(Buffer.from("abcdef")), 3);
  assert.equal(plain.text, "abc");
  assert.equal(plain.basis, "plain_prefix_sample");
});

test("PUBLIC DATASET: a checksum mismatch on ANY of the three sources fails closed", async () => {
  for (const field of ["metadata", "reads", "barcodes"]) {
    const { descriptor: desc, bytes } = await descriptor({ corrupt: field });
    await assert.rejects(() => resolvePublicDataset(desc, stubFor(bytes), { sampleBytes: SAMPLE_BYTES }),
      (error) => error.code === "public_checksum_mismatch");
  }
});

test("PUBLIC DATASET: missing entries and decompression failures are honest", async () => {
  const { descriptor: desc, bytes } = await descriptor();
  await assert.rejects(() => resolvePublicDataset(desc, stubFor(bytes, {
    [desc.reads_url]: new Response(null, { status: 404 })
  }), { sampleBytes: SAMPLE_BYTES }), (error) => error.code === "public_entry_unavailable");

  // Bytes with a valid checksum but a broken gzip stream must not be used.
  const broken = Buffer.concat([gzipSync(fixture("sequences.fastq")).subarray(0, 12), Buffer.from("garbage")]);
  const brokenDesc = { ...desc, expected_reads_sha256: await sha256Bytes(new Uint8Array(broken)) };
  await assert.rejects(() => resolvePublicDataset(brokenDesc,
    stubFor({ ...bytes, reads: new Uint8Array(broken) }), { sampleBytes: SAMPLE_BYTES }),
  (error) => error.code === "public_entry_unavailable");
});

test("PUBLIC DATASET descriptor: direct URLs and verified checksums are recorded", () => {
  const dataset = PUBLIC_DATASETS["moving-pictures-2026.10"];
  assert.equal(dataset.metadata_url,
    "https://moving-pictures-tutorial.readthedocs.io/en/2026.10/data/moving-pictures/sample-metadata.tsv");
  assert.equal(dataset.expected_metadata_sha256, "245f8e389ddf3dd05a95d870d214de918a06d03c5ce17750860446e09f9a7cc6");
  assert.equal(dataset.reads_url,
    "https://data.qiime2.org/2025.4/tutorials/moving-pictures/emp-single-end-sequences/sequences.fastq.gz");
  assert.equal(dataset.expected_reads_sha256, "7d9b2cea2aebfb46015796c073be6ba514018028cc1452d063aa0d716c059768");
  assert.equal(dataset.barcodes_url,
    "https://data.qiime2.org/2025.4/tutorials/moving-pictures/emp-single-end-sequences/barcodes.fastq.gz");
  assert.equal(dataset.expected_barcodes_sha256, "73c235c8185be1deef3038fd2b6497b7cc02acf3d7a37fda39e65a4a293e0d86");
  assert.equal(dataset.expected_samples, 34);
  assert.equal(dataset.expected_reads, 302581);
  assert.match(dataset.zip_provenance.url, /emp-single-end-sequences\.zip$/);
});

test("REAL SHAPE: 34 samples and 302581 published reads are preserved; plan only samples bytes", async () => {
  const dataset = PUBLIC_DATASETS["moving-pictures-2026.10"];
  const samples = Array.from({ length: 34 }, (_, index) => {
    const id = `sample${String(index + 1).padStart(3, "0")}`;
    const barcode = `${index + 1}`.padStart(2, "0") + "ACGTACGT";
    return { id, barcode };
  });
  const metadataText = ["sample-id\tbarcode-sequence\tbody-site",
    ...samples.map((sample) => `${sample.id}\t${sample.barcode}\ttongue`)].join("\n") + "\n";
  const metadata = parseMetadataTsv(metadataText);
  assert.equal(metadata.sample_ids.length, 34);
  assert.equal(metadata.duplicates.length, 0);

  // 302581 deterministic 152 bp reads match the verified real-file shape.
  const sequence = "ACGT".repeat(38);
  const quality = "I".repeat(152);
  const chunks = [];
  for (let index = 0; index < dataset.expected_reads; index += 1) {
    chunks.push(`@instrument${index % 34} read${index}\n${sequence}\n+\n${quality}\n`);
  }
  const readsText = chunks.join("");
  const fullReads = parseFastq(readsText);
  assert.equal(fullReads.record_count, 302581);
  assert.equal(fullReads.min_length, 152);
  assert.equal(fullReads.max_length, 152);

  const bytes = { metadata: new Uint8Array(Buffer.from(metadataText)),
    reads: new Uint8Array(Buffer.from(readsText)),
    barcodes: new Uint8Array(Buffer.from(readsText)) };
  const desc = {
    key: dataset.key ?? "moving-pictures-2026.10",
    metadata_url: dataset.metadata_url, reads_url: dataset.reads_url, barcodes_url: dataset.barcodes_url,
    expected_metadata_sha256: await sha256Bytes(bytes.metadata),
    expected_reads_sha256: await sha256Bytes(bytes.reads),
    expected_barcodes_sha256: await sha256Bytes(bytes.barcodes),
    zip_provenance: dataset.zip_provenance,
    expected_samples: dataset.expected_samples, expected_reads: dataset.expected_reads,
    rationale: dataset.rationale
  };
  const resolved = await resolvePublicDataset(desc, stubFor(bytes), { sampleBytes: SAMPLE_BYTES });
  assert.equal(resolved.source.expected.samples, 34);
  assert.equal(resolved.source.expected.reads, 302581);
  // The plan path samples at most SAMPLE_BYTES; it never claims the full count.
  assert.equal(resolved.reads_text, null);
  assert.ok(resolved.observed_sample.reads.bytes <= SAMPLE_BYTES);
  assert.ok(parseFastq(resolved.observed_sample.reads.text).record_count < 302581);
  assert.equal(parseMetadataTsv(resolved.metadata_text).sample_ids.length, 34);
});
