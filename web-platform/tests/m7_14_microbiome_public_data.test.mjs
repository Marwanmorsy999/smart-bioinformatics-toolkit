// M7.14 public dataset resolution tests. The fetch stub returns a tiny labelled
// zip fixture; the recorded checksums are recomputed from those fixture bytes.
// No network request is made and no real tutorial result is fabricated.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { deflateRawSync, gzipSync } from "node:zlib";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { resolvePublicDataset } from "../functions/api/ai/workflows/microbiome/public-data.js";
import { sha256Bytes } from "../public/js/microbiome-zip.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const fixture = (name) => readFileSync(resolve(HERE, "fixtures/m7_14_microbiome", name));
const encoder = new TextEncoder();

function u16(value) { return [value & 0xff, (value >> 8) & 0xff]; }
function u32(value) { return [value & 0xff, (value >> 8) & 0xff, (value >> 16) & 0xff, (value >> 24) & 0xff]; }

function makeZip(entries, { streaming = false } = {}) {
  const locals = [];
  const directory = [];
  let offset = 0;
  for (const [name, bytes] of entries) {
    const nameBytes = encoder.encode(name);
    const compressed = deflateRawSync(bytes);
    const flags = streaming ? 0x08 : 0;
    const localSize = streaming ? 0 : compressed.length;
    const local = [
      ...u32(0x04034b50), ...u16(20), ...u16(flags), ...u16(8), 0, 0, 0, 0, 0, 0, 0, 0,
      ...u32(localSize), ...u32(bytes.length), ...u16(nameBytes.length), ...u16(0),
      ...nameBytes, ...compressed
    ];
    locals.push(...local);
    directory.push([name, nameBytes, compressed, bytes.length, offset]);
    offset += local.length;
  }
  const centralStart = offset;
  const central = [];
  for (const [name, nameBytes, compressed, size, localOffset] of directory) {
    central.push(...u32(0x02014b50), ...u16(20), ...u16(20), ...u16(streaming ? 0x08 : 0), ...u16(8),
      0, 0, 0, 0, 0, 0, 0, 0, ...u32(compressed.length), ...u32(size),
      ...u16(nameBytes.length), ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u32(0),
      ...u32(localOffset), ...nameBytes);
  }
  const centralSize = central.length;
  const eocd = [...u32(0x06054b50), 0, 0, 0, 0, ...u16(directory.length), ...u16(directory.length),
    ...u32(centralSize), ...u32(centralStart), 0, 0];
  return new Uint8Array([...locals, ...central, ...eocd]);
}

async function descriptor({ streaming = false, corrupt = false } = {}) {
  const metadata = fixture("sample-metadata.tsv");
  const zip = makeZip([
    ["emp-single-end-sequences/sequences.fastq.gz", gzipSync(fixture("sequences.fastq"))],
    ["emp-single-end-sequences/barcodes.fastq.gz", gzipSync(fixture("barcodes.fastq"))]
  ], { streaming });
  const metadataSha = await sha256Bytes(metadata);
  const zipSha = await sha256Bytes(zip);
  return {
    key: "fixture-dataset", metadata_url: "https://fixture.test/metadata.tsv",
    sequences_zip_url: "https://fixture.test/sequences.zip",
    expected_metadata_sha256: corrupt ? "0".repeat(64) : metadataSha,
    expected_zip_sha256: zipSha,
    sequence_entry: "emp-single-end-sequences/sequences.fastq.gz",
    barcode_entry: "emp-single-end-sequences/barcodes.fastq.gz",
    expected_samples: 3, expected_reads: 3, rationale: "Labelled tiny fixture."
  };
}

function stubFor(metadata, zip) {
  return async (url) => {
    if (String(url).endsWith("metadata.tsv")) return new Response(metadata);
    if (String(url).endsWith("sequences.zip")) return new Response(zip);
    return new Response(null, { status: 404 });
  };
}

test("PUBLIC DATASET: checksums are verified and gzip FASTQ entries are decoded", async () => {
  const metadata = fixture("sample-metadata.tsv");
  const description = await descriptor();
  const zip = makeZip([
    [description.sequence_entry, gzipSync(fixture("sequences.fastq"))],
    [description.barcode_entry, gzipSync(fixture("barcodes.fastq"))]
  ]);
  const resolved = await resolvePublicDataset(description, stubFor(metadata, zip));
  assert.equal(resolved.mode, "public");
  assert.equal(resolved.reads_filename, "sequences.fastq");
  assert.match(resolved.reads_text, /@instrument1 sequences/);
  assert.match(resolved.barcodes_text, /ACCGCACTT/);
  assert.match(resolved.metadata_text, /sampleA/);
  assert.equal(resolved.source.checksums.metadata_sha256.length, 64);
  assert.equal(resolved.source.expected.samples, 3);
});

test("PUBLIC DATASET: streaming local headers fall back to the central directory", async () => {
  const metadata = fixture("sample-metadata.tsv");
  const description = await descriptor({ streaming: true });
  const zip = makeZip([
    [description.sequence_entry, gzipSync(fixture("sequences.fastq"))],
    [description.barcode_entry, gzipSync(fixture("barcodes.fastq"))]
  ], { streaming: true });
  const resolved = await resolvePublicDataset(description, stubFor(metadata, zip));
  assert.match(resolved.reads_text, /@instrument1 sequences/);
  assert.match(resolved.barcodes_text, /@instrument3 barcodes/);
});

test("PUBLIC DATASET: a checksum mismatch fails closed before any byte is used", async () => {
  const metadata = fixture("sample-metadata.tsv");
  const description = await descriptor({ corrupt: true });
  const zip = makeZip([
    [description.sequence_entry, gzipSync(fixture("sequences.fastq"))],
    [description.barcode_entry, gzipSync(fixture("barcodes.fastq"))]
  ]);
  await assert.rejects(() => resolvePublicDataset(description, stubFor(metadata, zip)),
    (error) => error.code === "public_checksum_mismatch");
});
