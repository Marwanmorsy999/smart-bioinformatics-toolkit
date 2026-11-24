// Curated local reference ledger, mirrored from the Python ledger at
// python-engine/src/smartbio/aiagent/explanation.py::REFERENCES.
//
// Only entries with `verified: true` are exposed. The four-field projection
// matches _reference_projection() in the Python module (shared contract §3):
// no caller-supplied metadata may widen or alter a citation.
// A test in web-platform/tests guards parity with the Python source.

const PROJECTION_FIELDS = ["key", "title", "url", "verified"];

const LEDGER = Object.freeze({
  smartbio_gc_definition: Object.freeze({
    key: "smartbio_gc_definition",
    title: "Smart Bioinformatics Toolkit: DNA GC percentage definition",
    url: "python-engine/src/smartbio/statistics.py#calculate_statistics",
    verified: true
  })
});

export const VERIFIED_REFERENCE_KEYS = Object.freeze(Object.keys(LEDGER));

// Returns the ledger entry only when it is actually verified; never trust a
// caller's `verified` bit or invent a bibliographic record.
export function verifiedReference(key) {
  const entry = typeof key === "string" ? LEDGER[key] : null;
  return entry && entry.verified === true ? entry : null;
}

export function hasVerifiedReference(key) {
  return verifiedReference(key) !== null;
}

export function projectReference(entry) {
  if (!entry) return null;
  const projected = {};
  for (const field of PROJECTION_FIELDS) projected[field] = entry[field] ?? null;
  return projected;
}

// Mirrors check_explanation() in explanation.py: unknown keys, unverified keys,
// non-boolean `verified` and any field mismatch are all rejected.
export function validateExplanationReferences(references) {
  if (!Array.isArray(references)) {
    return { valid: false, error: "explanation.references must be an array." };
  }
  for (let index = 0; index < references.length; index += 1) {
    const reference = references[index];
    const where = `explanation.references[${index}]`;
    if (!reference || typeof reference !== "object" || Array.isArray(reference)) {
      return { valid: false, error: `${where} must be an object.` };
    }
    const key = typeof reference.key === "string" ? reference.key : "";
    const entry = verifiedReference(key);
    if (!entry) {
      return { valid: false, error: `unverified_reference:${where}:${key}` };
    }
    if (typeof reference.verified !== "boolean") {
      return { valid: false, error: `invalid_reference_metadata:${where}:${key}` };
    }
    const projected = projectReference(entry);
    const exact = Object.keys(reference).length === PROJECTION_FIELDS.length
      && PROJECTION_FIELDS.every((field) => reference[field] === projected[field]);
    if (!exact) {
      return { valid: false, error: `reference_metadata_mismatch:${where}:${key}` };
    }
    if (entry.verified !== true) {
      return { valid: false, error: `unverified_reference:${where}:${key}` };
    }
  }
  return { valid: true, error: null };
}

// Rebuild citations from the ledger so the stored/served record cannot carry
// caller-supplied titles, URLs or a self-asserted `verified` flag.
export function projectExplanationReferences(references) {
  if (!Array.isArray(references)) return [];
  return references.map((reference) => projectReference(verifiedReference(reference?.key)));
}
