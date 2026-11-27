// Server-side resolution of the documented public Moving Pictures dataset.
//
// The three published files are fetched DIRECTLY and ALL three SHA-256
// checksums are verified before any byte is decoded. The Worker then keeps the
// original .fastq.gz bytes for upload to Galaxy; it only decompresses a small
// prefix for an explicitly labelled plan-time observation. Full QC, counts and
// diversity always come from genuine Galaxy/QIIME 2 artifacts.
//
// Raw-deflate ZIP extraction is NOT available in the Workers runtime, so no
// ZIP is fetched here. Gzip decompression of a bounded prefix IS supported.

import { sha256Bytes } from "../../../../../public/js/microbiome-zip.js";

async function fetchBytes(url, fetchImpl, label) {
  let response;
  try {
    response = await fetchImpl(url, { headers: { Accept: "*/*" } });
  } catch (error) {
    throw Object.assign(new Error(`public ${label} could not be fetched: ${error?.message ?? error}`),
      { code: "public_entry_unavailable", status: 502 });
  }
  if (!response.ok) {
    throw Object.assign(new Error(`public ${label} fetch failed with HTTP ${response.status}`),
      { code: "public_entry_unavailable", status: 502 });
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (!bytes.length) {
    throw Object.assign(new Error(`public ${label} response was empty`),
      { code: "public_entry_unavailable", status: 502 });
  }
  return bytes;
}

function verifyChecksum(bytes, expected, label) {
  return sha256Bytes(bytes).then((actual) => {
    if (!expected || actual !== expected) {
      throw Object.assign(new Error(`public ${label} SHA-256 does not match the recorded checksum; nothing was used.`),
        { code: "public_checksum_mismatch", status: 502 });
    }
    return actual;
  });
}

/**
 * Decode at most `maxBytes` of a gzip stream, then cancel. The returned text is
 * a labelled sample, NEVER a full read set. Plain (non-gzip) inputs are simply
 * sliced to the same bound.
 */
export async function sampleGzipPrefix(bytes, maxBytes = 200 * 1024) {
  const input = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (!(input[0] === 0x1f && input[1] === 0x8b)) {
    const size = Math.min(input.length, maxBytes);
    return { text: new TextDecoder().decode(input.subarray(0, size)), bytes: size,
      truncated: input.length > size, basis: "plain_prefix_sample" };
  }
  if (typeof DecompressionStream === "undefined") {
    throw Object.assign(new Error("Bounded gzip sampling requires DecompressionStream('gzip')."),
      { code: "public_entry_unavailable", status: 502 });
  }
  const stream = new Blob([input]).stream().pipeThrough(new DecompressionStream("gzip"));
  const reader = stream.getReader();
  const parts = [];
  let total = 0;
  try {
    while (total < maxBytes) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = value instanceof Uint8Array ? value : new Uint8Array(value ?? []);
      const remaining = maxBytes - total;
      parts.push(chunk.length <= remaining ? chunk : chunk.subarray(0, remaining));
      total += Math.min(chunk.length, remaining);
    }
  } finally {
    try { await reader.cancel(); } catch { /* stream already closed */ }
  }
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) { merged.set(part, offset); offset += part.length; }
  return { text: new TextDecoder().decode(merged), bytes: total,
    truncated: total >= maxBytes, basis: "bounded_gzip_prefix_sample" };
}

export async function resolvePublicDataset(dataset, fetchImpl, { sampleBytes = 0 } = {}) {
  if (!dataset?.reads_url || !dataset?.barcodes_url) {
    throw Object.assign(new Error("unknown public_dataset descriptor: direct reads/barcodes sources are not declared"),
      { code: "unknown_public_dataset", status: 400 });
  }
  // Three bounded requests; all checksums are checked before decoding.
  const [metadataBytes, readsBytes, barcodesBytes] = await Promise.all([
    fetchBytes(dataset.metadata_url, fetchImpl, "metadata"),
    fetchBytes(dataset.reads_url, fetchImpl, "reads FASTQ"),
    fetchBytes(dataset.barcodes_url, fetchImpl, "barcode FASTQ")
  ]);
  const metadataSha = await verifyChecksum(metadataBytes, dataset.expected_metadata_sha256, "metadata");
  const readsSha = await verifyChecksum(readsBytes, dataset.expected_reads_sha256, "reads FASTQ");
  const barcodesSha = await verifyChecksum(barcodesBytes, dataset.expected_barcodes_sha256, "barcode FASTQ");

  let observedSample = null;
  if (sampleBytes > 0) {
    try {
      observedSample = {
        reads: await sampleGzipPrefix(readsBytes, sampleBytes),
        barcodes: await sampleGzipPrefix(barcodesBytes, sampleBytes),
        sample_size_bytes: sampleBytes,
        basis: "bounded_first_bytes_sample",
        note: "A bounded prefix used only for the plan-time quality rationale; it is NOT a read count or a QC result."
      };
    } catch (error) {
      throw Object.assign(new Error(`public FASTQ prefix could not be sampled: ${error?.message ?? error}`),
        { code: "public_entry_unavailable", status: 502 });
    }
  }

  return {
    mode: "public", public_dataset: dataset.key ?? null,
    source: {
      urls: { metadata: dataset.metadata_url, reads: dataset.reads_url, barcodes: dataset.barcodes_url,
        sequences_zip: dataset.zip_provenance?.url ?? dataset.sequences_zip_url ?? null },
      checksums: { metadata_sha256: metadataSha, reads_sha256: readsSha, barcodes_sha256: barcodesSha,
        zip_sha256_reference: dataset.zip_provenance?.sha256 ?? dataset.expected_zip_sha256 ?? null },
      provenance_note: "ZIP URL/checksum are provenance references only; the Worker fetches the three direct sources above.",
      expected: { samples: dataset.expected_samples, reads: dataset.expected_reads },
      expectation_basis: "published_descriptor_expectation (not measured in this request)",
      rationale: dataset.rationale ?? null
    },
    // Original gzip bytes are handed straight to the Galaxy upload adapter.
    reads_bytes: readsBytes, barcodes_bytes: barcodesBytes,
    reads_text: null, barcodes_text: null,
    metadata_text: new TextDecoder().decode(metadataBytes),
    reads_filename: "sequences.fastq.gz", barcodes_filename: "barcodes.fastq.gz",
    metadata_filename: "sample-metadata.tsv",
    observed_sample: observedSample
  };
}
