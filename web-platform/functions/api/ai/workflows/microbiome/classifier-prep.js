// M7.14.2 provenance for the OFFICIAL QIIME 2 SILVA classifier.
//
// Every value here is a published descriptor of the official artifact, NOT a
// guess and NOT a live result. The bytes are verified by streaming SHA-256
// before the Galaxy URL upload; a dataset is reused only when the READ-ONLY
// inventory exposes the same checksum. No SILVA 144 or other release is named.

export const QIIME_CLASSIFIER = Object.freeze({
  filename: "silva-138-99-nb-classifier.qza",
  url: "https://data.qiime2.org/classifiers/sklearn-1.4.2/silva/silva-138-99-nb-classifier.qza",
  expected_sha256: "c08a1aa4d56b449b511f7215543a43249ae9c54b57491428a7e5548a62613616",
  expected_bytes: 218245868,
  identity: "Silva 138 99% OTUs full-length sequences",
  classifier_kind: "sklearn 1.4.2 naive Bayes classifier",
  compatible_qiime2: "2024.5–2026.1",
  primer_region: "F515–R806 (V4)",
  basis: "official_qiime2_classifier_descriptor_stream_verified",
  limitations: Object.freeze([
    "The Moving Pictures reads target the F515–R806 (V4) region, while this is a full-length 16S classifier; taxonomic assignments are therefore not primer-region-specific.",
    "Species-level SILVA assignments can be unreliable; lower-confidence species calls should be treated as indicative rather than definitive.",
    "No other SILVA release is claimed: the artifact identity, URL and checksum are the published descriptors only."
  ])
});

function normalizedChecksum(value) {
  return String(value ?? "").trim().toLowerCase().replace(/^sha256\$/, "") || null;
}

/**
 * READ-ONLY inventory matching. A dataset is reusable only when its name is
 * the official filename, it is ready, its exposed checksum matches the official
 * SHA-256, AND it lives in the current run's history (a tool job cannot consume
 * an HDA from a different history). Missing or mismatched checksums are never
 * treated as verified; they are returned as explicit candidates for the record.
 */
export function inspectClassifierInventory(inventory, historyId, descriptor = QIIME_CLASSIFIER) {
  const wantedName = String(descriptor.filename ?? "").toLowerCase();
  const expected = normalizedChecksum(descriptor.expected_sha256);
  const candidates = [];
  for (const dataset of inventory?.datasets ?? []) {
    if (String(dataset?.name ?? "").trim().toLowerCase() !== wantedName) continue;
    const exposed = normalizedChecksum(dataset.checksum);
    const stateReady = ["ok", "success"].includes(String(dataset?.state ?? "").toLowerCase());
    const sameHistory = Boolean(historyId) && String(dataset?.history_id ?? "") === String(historyId);
    const reason = !stateReady ? "dataset_not_ready"
      : !sameHistory ? "different_history"
        : exposed === null ? "checksum_not_exposed"
          : exposed !== expected ? "checksum_mismatch" : null;
    candidates.push({
      dataset_id: dataset.id ?? null, history_id: dataset.history_id ?? null,
      name: dataset.name ?? null, state: dataset.state ?? null,
      checksum_status: exposed === null ? "not_exposed" : exposed === expected ? "verified" : "mismatch",
      checksum_exposed: exposed, reason
    });
  }
  const verified = candidates.find((candidate) => candidate.reason === null) ?? null;
  return {
    verified, candidates,
    basis: "read_only_galaxy_inventory",
    ok: Boolean(inventory?.ok),
    reason: verified ? null
      : (!inventory?.ok ? "inventory_unavailable"
        : candidates.length ? candidates[0].reason : "classifier_absent_from_inventory")
  };
}

/** Provenance attached to stored state, result and report. All fields are facts. */
export function classifierProvenance(descriptor = QIIME_CLASSIFIER) {
  return {
    official_url: descriptor.url,
    filename: descriptor.filename,
    expected_sha256: descriptor.expected_sha256,
    expected_bytes: descriptor.expected_bytes,
    identity: descriptor.identity,
    classifier_kind: descriptor.classifier_kind,
    compatible_qiime2: descriptor.compatible_qiime2,
    primer_region: descriptor.primer_region,
    basis: descriptor.basis,
    limitations: [...descriptor.limitations]
  };
}
