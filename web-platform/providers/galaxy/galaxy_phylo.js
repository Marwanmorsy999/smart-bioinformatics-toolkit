// M7.3: Pure discovery helpers for the Galaxy phylogenetic workflow.
// Tool IDs are NEVER hardcoded: MAFFT and IQ-TREE are located from the live
// panel (GET /api/tools) by name + description, and the matched versioned id
// is used in provenance.
import { asArray, asObject, safeString } from "../common/normalize.js";

function toLower(value) {
  return safeString(value, 500).trim().toLowerCase();
}
function matchesAny(haystack, needles) {
  if (!needles.length) return true;
  const hay = toLower(haystack);
  return needles.some((needle) => hay.includes(needle));
}
export function findToolById(tools, criteria = {}) {
  const list = asArray(tools);
  // Exact full names are tried IN ORDER when supplied. `strictExact` means a
  // miss is an honest null: loose substring matching may never pull in an
  // unrelated tool (e.g. cutadapt demux-paired for emp-single).
  const exactNames = (criteria.exactNames ?? []).map(toLower).filter(Boolean);
  if (exactNames.length) {
    const normalized = list.map(asObject);
    for (const wanted of exactNames) {
      const found = normalized.find((tool) => toLower(tool.name ?? tool.label) === wanted);
      if (found) return found;
    }
    if (criteria.strictExact === true) return null;
  }
  const nameIncludes = (criteria.nameIncludes ?? []).map(toLower).filter(Boolean);
  const descriptionIncludes = (criteria.descriptionIncludes ?? []).map(toLower).filter(Boolean);
  const versionIncludes = (criteria.versionIncludes ?? []).map(toLower).filter(Boolean);
  const entry = list.map(asObject).find((tool) => (
    matchesAny(tool.id, criteria.id ? [toLower(criteria.id)] : [])
    && matchesAny(tool.name ?? tool.label, nameIncludes)
    && matchesAny(tool.description ?? tool.help, descriptionIncludes)
    && matchesAny(tool.version, versionIncludes)
  ));
  return entry ?? null;
}
export function findPhyloTools(tools) {
  return {
    mafft: findToolById(tools, { nameIncludes: ["mafft"], descriptionIncludes: ["alignment program"] }),
    iqtree: findToolById(tools, { nameIncludes: ["iq-tree", "iqtree"], descriptionIncludes: ["evolutionary tree", "phylogenomic"] })
  };
}
