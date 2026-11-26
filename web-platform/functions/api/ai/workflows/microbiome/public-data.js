// Server-side resolution of the documented public Moving Pictures dataset.
// Checksums are verified BEFORE any byte is used; the caller supplies the
// dataset descriptor so offline tests can use a tiny labelled zip fixture.
import { extractZipEntries, maybeGunzip, sha256Bytes } from "../../../../../public/js/microbiome-zip.js";

async function fetchBytes(url, fetchImpl) {
  const response = await fetchImpl(url, { headers: { Accept: "*/*" } });
  if (!response.ok) throw Object.assign(new Error(`public dataset fetch failed with HTTP ${response.status}`), { status: response.status });
  return new Uint8Array(await response.arrayBuffer());
}

export async function resolvePublicDataset(dataset, fetchImpl) {
  if (!dataset) throw Object.assign(new Error("unknown public_dataset descriptor"), { code: "unknown_public_dataset", status: 400 });
  const [metadataBytes, zipBytes] = await Promise.all([
    fetchBytes(dataset.metadata_url, fetchImpl), fetchBytes(dataset.sequences_zip_url, fetchImpl)
  ]);
  const metadataSha = await sha256Bytes(metadataBytes);
  const zipSha = await sha256Bytes(zipBytes);
  if (metadataSha !== dataset.expected_metadata_sha256) {
    throw Object.assign(new Error("public metadata SHA-256 does not match the recorded checksum; nothing was used."),
      { code: "public_checksum_mismatch", status: 502 });
  }
  if (zipSha !== dataset.expected_zip_sha256) {
    throw Object.assign(new Error("public FASTQ archive SHA-256 does not match the recorded checksum; nothing was used."),
      { code: "public_checksum_mismatch", status: 502 });
  }
  const entries = await extractZipEntries(zipBytes, [dataset.sequence_entry, dataset.barcode_entry]);
  const sequences = entries.get(dataset.sequence_entry);
  const barcodes = entries.get(dataset.barcode_entry);
  if (!sequences?.text || !barcodes?.text) {
    throw Object.assign(new Error("the public archive did not contain readable sequences.fastq.gz and barcodes.fastq.gz"),
      { code: "public_entry_unavailable", status: 502 });
  }
  const sequenceBytes = await maybeGunzip(sequences.data ?? new TextEncoder().encode(sequences.text));
  const barcodeBytes = await maybeGunzip(barcodes.data ?? new TextEncoder().encode(barcodes.text));
  return {
    mode: "public", public_dataset: dataset.key ?? null,
    source: { urls: { metadata: dataset.metadata_url, sequences_zip: dataset.sequences_zip_url },
      checksums: { metadata_sha256: metadataSha, zip_sha256: zipSha },
      expected: { samples: dataset.expected_samples, reads: dataset.expected_reads },
      rationale: dataset.rationale ?? null },
    reads_text: new TextDecoder().decode(sequenceBytes),
    barcodes_text: new TextDecoder().decode(barcodeBytes),
    metadata_text: new TextDecoder().decode(metadataBytes),
    reads_filename: "sequences.fastq", barcodes_filename: "barcodes.fastq",
    metadata_filename: "sample-metadata.tsv"
  };
}
