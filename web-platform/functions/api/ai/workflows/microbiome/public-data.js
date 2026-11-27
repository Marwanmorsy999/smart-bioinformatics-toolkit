// Server-side resolution of the documented public Moving Pictures dataset.
//
// The three published files are fetched DIRECTLY (metadata TSV, reads FASTQ.gz,
// barcodes FASTQ.gz) and ALL three SHA-256 checksums are verified before any
// byte is decoded. Raw-deflate ZIP extraction is not available in the Workers
// runtime, so no ZIP is fetched here. Gzip decompression IS supported.
// The caller supplies the descriptor so offline tests can use labelled stubs.

import { maybeGunzip, sha256Bytes } from "../../../../../public/js/microbiome-zip.js";

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

async function decodeFastaGzip(bytes, label) {
  try {
    return new TextDecoder().decode(await maybeGunzip(bytes));
  } catch (error) {
    throw Object.assign(new Error(`public ${label} could not be decompressed: ${error?.message ?? error}`),
      { code: "public_entry_unavailable", status: 502 });
  }
}

export async function resolvePublicDataset(dataset, fetchImpl) {
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
  const readsText = await decodeFastaGzip(readsBytes, "reads FASTQ");
  const barcodesText = await decodeFastaGzip(barcodesBytes, "barcode FASTQ");
  if (!readsText.includes("@") || !barcodesText.includes("@")) {
    throw Object.assign(new Error("the public FASTQ sources did not contain readable FASTQ records"),
      { code: "public_entry_unavailable", status: 502 });
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
      rationale: dataset.rationale ?? null
    },
    reads_text: readsText,
    barcodes_text: barcodesText,
    metadata_text: new TextDecoder().decode(metadataBytes),
    reads_filename: "sequences.fastq", barcodes_filename: "barcodes.fastq",
    metadata_filename: "sample-metadata.tsv"
  };
}
