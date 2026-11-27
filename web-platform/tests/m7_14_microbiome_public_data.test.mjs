// M7.14 public dataset resolution tests. The fetch stubs return tiny labelled
// gzip fixtures (or a generated real-shaped fixture); checksums are recomputed
// from those bytes. No network request is made and no result is fabricated.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { resolvePublicDataset } from "../functions/api/ai/workflows/microbiome/public-data.js";
import { PUBLIC_DATASETS, sha256Bytes } from "../public/js/microbiome-zip.js";
import { parseFastq, parseMetadataTsv } from "../functions/api/ai/workflows/microbiome/parsers.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const fixture = (name) => readFileSync(resolve(HERE, "fixtures/m7_14_microbiome", name));

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

test("PUBLIC DATASET: three direct gzip sources are checksum-verified and decoded", async () => {
  const { descriptor: desc, bytes } = await descriptor();
  const resolved = await resolvePublicDataset(desc, stubFor(bytes));
  assert.equal(resolved.mode, "public");
  assert.equal(resolved.reads_filename, "sequences.fastq");
  assert.match(resolved.reads_text, /@instrument1 sequences/);
  assert.match(resolved.barcodes_text, /ACCGCACTT/);
  assert.match(resolved.metadata_text, /sampleA/);
  assert.equal(resolved.source.urls.reads, desc.reads_url);
  assert.equal(resolved.source.urls.barcodes, desc.barcodes_url);
  assert.match(resolved.source.urls.sequences_zip, /archive\.zip|moving-pictures/);
  assert.equal(resolved.source.checksums.reads_sha256, await sha256Bytes(bytes.reads));
  assert.equal(resolved.source.checksums.barcodes_sha256, await sha256Bytes(bytes.barcodes));
  assert.match(resolved.source.provenance_note, /provenance references only/);
  assert.equal(resolved.source.expected.samples, 3);
});

test("PUBLIC DATASET: a checksum mismatch on ANY of the three sources fails closed", async () => {
  for (const field of ["metadata", "reads", "barcodes"]) {
    const { descriptor: desc, bytes } = await descriptor({ corrupt: field });
    await assert.rejects(() => resolvePublicDataset(desc, stubFor(bytes)),
      (error) => error.code === "public_checksum_mismatch");
  }
});

test("PUBLIC DATASET: missing entries and decompression failures are honest", async () => {
  const { descriptor: desc, bytes } = await descriptor();
  await assert.rejects(() => resolvePublicDataset(desc, stubFor(bytes, {
    [desc.reads_url]: new Response(null, { status: 404 })
  })), (error) => error.code === "public_entry_unavailable");

  // Bytes with a valid checksum but invalid gzip content must not be used.
  const broken = Buffer.from("not-gzip-data");
  const brokenDesc = { ...desc, expected_reads_sha256: await sha256Bytes(new Uint8Array(broken)) };
  await assert.rejects(() => resolvePublicDataset(brokenDesc,
    stubFor({ ...bytes, reads: new Uint8Array(broken) })),
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

test("REAL SHAPE: 34 samples and 302581 reads parse and are preserved as provenance", async () => {
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

  // 302581 deterministic 152 bp reads (the verified real-file shape). The
  // sequence/quality strings are shared constants so this stays bounded.
  const sequence = "ACGT".repeat(38);
  const quality = "I".repeat(152);
  const chunks = [];
  for (let index = 0; index < dataset.expected_reads; index += 1) {
    chunks.push(`@instrument${index % 34} read${index}\n${sequence}\n+\n${quality}\n`);
  }
  const readsText = chunks.join("");
  const reads = parseFastq(readsText);
  assert.equal(reads.record_count, 302581);
  assert.equal(reads.min_length, 152);
  assert.equal(reads.max_length, 152);

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
  const resolved = await resolvePublicDataset(desc, stubFor(bytes));
  assert.equal(resolved.source.expected.samples, 34);
  assert.equal(resolved.source.expected.reads, 302581);
  assert.equal(parseFastq(resolved.reads_text).record_count, 302581);
  assert.equal(parseMetadataTsv(resolved.metadata_text).sample_ids.length, 34);
});
