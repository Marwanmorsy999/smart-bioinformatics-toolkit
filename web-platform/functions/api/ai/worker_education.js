// Worker-side FR-8.6 education notes. Caller-supplied `explanation.education`
// is ignored: notes are rebuilt from the validated `validation.flags` using
// the same rule texts as smartbio.aiagent.education in the Python engine.
// A reference key is emitted only when the curated ledger verifies it; an
// abstention is always described as insufficient evidence, never as a call.

import { verifiedReference } from "./reference_ledger.js";

const SPECIES_THRESHOLD = 98.65;
const NEAR_MARGIN = 0.35;
const MIN_COVERAGE = 80;
const MIN_QUERY_LENGTH = 500;

const NEAR_THRESHOLD = `species screening identity ${SPECIES_THRESHOLD}% with near-threshold margin ${NEAR_MARGIN} percentage points (docs/SCIENTIFIC_RULES.md, Verdict layer)`;
const INSUFFICIENT = `taxonomy evidence rule: at least one informative hit with coverage >= ${MIN_COVERAGE}% (docs/SCIENTIFIC_RULES.md, Verdict layer)`;
const BELOW_THRESHOLD = `species screening identity ${SPECIES_THRESHOLD}% (docs/SCIENTIFIC_RULES.md, Verdict layer)`;
const COVERAGE = `minimum query coverage ${MIN_COVERAGE}% (docs/SCIENTIFIC_RULES.md, Verdict layer)`;
const LENGTH = `minimum query length ${MIN_QUERY_LENGTH} nt (docs/SCIENTIFIC_RULES.md, Verdict layer)`;
const NO_HITS = "taxonomy_verdict_has_evidence (at least one BLAST hit required)";
const ALL_100 = "suspicious_taxonomy_patterns (all identities exactly 100%)";
const MALFORMED = "blast_summary_counts_consistent (all rows must parse)";
const MOCK_MODE = "execution_mode_label (scientific results require mode 'real')";
const DIFFICULT_GROUP = "difficult-group caution: each group needs a cited source (docs/SCIENTIFIC_RULES.md, Verdict layer)";
const GC_RULE = "dna_gc_percent_in_range_and_consistent: 0 <= GC% <= 100, computed as (G+C)/(A+C+G+T)*100 with a 0.001 consistency tolerance (docs/SCIENTIFIC_RULES.md, GC percentage)";
const VALIDATION_CONTRACT = "validation_contract (doctor validation input, then re-run)";
// The 16S paper is cited in source comments but its bibliographic details are
// not verified in-tree; its key must therefore resolve to null below.
const UNVERIFIED_16S_KEY = "kim2014_16s_species_threshold";
const VERIFIED_GC_KEY = "smartbio_gc_definition";

// rule -> { why_insufficient, what_would_help, candidate ledger key }
const RULES = {
  [NEAR_THRESHOLD]: {
    why_insufficient: `The best hit is within ${NEAR_MARGIN} percentage points of the ${SPECIES_THRESHOLD}% screening reference, an experimental margin. Species-level interpretation is withheld rather than forced: a small identity difference could flip the call.`,
    what_would_help: "Provide full-length, high-coverage BLAST hits whose identity is clearly separated from the screening reference, with E-value, aligned length and a type-strain-backed taxonomy mapping under a recorded database release.",
    key: UNVERIFIED_16S_KEY
  },
  [INSUFFICIENT]: {
    why_insufficient: "No qualifying BLAST evidence, taxonomy mapping or concordant lineage was available, so the verdict abstains. The abstention is not converted into a species identification.",
    what_would_help: "Supply parsed BLAST hits with percent identity, query coverage and a curated taxonomy map, including database release and type-strain provenance where available.",
    key: null
  },
  [BELOW_THRESHOLD]: {
    why_insufficient: `The best identity is below the ${SPECIES_THRESHOLD}% screening reference, so a species-level call is not supported. The result stays at genus level or as an abstention and does not establish a novel species.`,
    what_would_help: "Use an independent validated identification method or additional consistent loci; a single screening reference is not proof of novelty.",
    key: UNVERIFIED_16S_KEY
  },
  [COVERAGE]: {
    why_insufficient: "Coverage could not be verified from the supplied data, so the rule cannot confirm that the alignment spans enough of the query.",
    what_would_help: `Provide query lengths (qlen) in the BLAST TSV so coverage can be computed and checked against the ${MIN_COVERAGE}% minimum.`,
    key: null
  },
  [LENGTH]: {
    why_insufficient: "The query is shorter than the minimum length, so similarity evidence is partial and the call is cautioned rather than conclusive.",
    what_would_help: "Use a full-length sequence, or keep the current result explicitly labelled as partial-evidence screening.",
    key: null
  },
  [NO_HITS]: {
    why_insufficient: "Every query lacked hits, so no evidence exists to support any taxonomic conclusion.",
    what_would_help: "Re-run with a valid BLAST TSV from an appropriate database; verify the input format and database choice.",
    key: null
  },
  [ALL_100]: {
    why_insufficient: "Every identity is exactly 100%, a pattern that warrants a caution because it can indicate synthetic or uncurated input rather than independent evidence.",
    what_would_help: "Check the provenance of the BLAST input and reference database and confirm the hits are genuine and independently curated.",
    key: null
  },
  [MALFORMED]: {
    why_insufficient: "Malformed BLAST TSV rows were excluded, so the evidence set is incomplete.",
    what_would_help: "Re-export the BLAST TSV with the full 12-column schema and no truncated rows.",
    key: null
  },
  [MOCK_MODE]: {
    why_insufficient: "The run was labelled mock, so its outputs are not valid scientific evidence.",
    what_would_help: "Re-run in real execution mode with the local tools before drawing any conclusion.",
    key: null
  },
  [DIFFICULT_GROUP]: {
    why_insufficient: "The candidate belongs to a difficult species group. Group membership is illustrative and requires a cited source, so species-level identity is not asserted from this evidence alone.",
    what_would_help: "Provide a cited, curated difficult-group definition and confirm membership against the reference taxonomy under a recorded database release.",
    key: null
  },
  [GC_RULE]: {
    why_insufficient: "The reported GC percentage is outside the valid range or inconsistent with the canonical base counts, so the statistic is not accepted as validated evidence.",
    what_would_help: "Provide a valid DNA FASTA with canonical A/C/G/T counts. Ambiguous bases are excluded from the denominator and GC% is null when no canonical bases exist.",
    key: VERIFIED_GC_KEY
  },
  [VALIDATION_CONTRACT]: {
    why_insufficient: "The validation layer could not complete, so no validated result is available.",
    what_would_help: "Correct the validation input described in the validation flag and re-run the registered tool.",
    key: null
  }
};

const FLAG_RULES = {
  near_threshold: NEAR_THRESHOLD,
  insufficient_evidence: INSUFFICIENT,
  below_screening_threshold: BELOW_THRESHOLD,
  coverage_unavailable: COVERAGE,
  partial_sequence: LENGTH,
  all_queries_no_hit: NO_HITS,
  all_identities_100_percent: ALL_100,
  malformed_blast_rows: MALFORMED,
  mock_execution_mode: MOCK_MODE,
  difficult_group: DIFFICULT_GROUP,
  gc_percent_out_of_range: GC_RULE,
  gc_percent_inconsistent: GC_RULE,
  invalid_gc_percent: GC_RULE,
  validation_error: VALIDATION_CONTRACT
};

const UNKNOWN_RULE = "The deterministic validation layer flagged this run, and no curated rule text is available for it.";
const UNKNOWN_HELP = "Resolve the validation flag and re-run the registered tool; no conclusion is inferred from a flagged result.";

function flagSpec(flag) {
  const name = String(flag).split(":", 1)[0];
  if (name.startsWith("difficult_group")) return { rule: DIFFICULT_GROUP, spec: RULES[DIFFICULT_GROUP] };
  if (FLAG_RULES[name]) return { rule: FLAG_RULES[name], spec: RULES[FLAG_RULES[name]] };
  if (name.startsWith("gc_percent") || name.startsWith("invalid_gc")) return { rule: GC_RULE, spec: RULES[GC_RULE] };
  if (name.startsWith("validation_error")) return { rule: VALIDATION_CONTRACT, spec: RULES[VALIDATION_CONTRACT] };
  return {
    rule: `validation flag: ${name}`,
    spec: { why_insufficient: UNKNOWN_RULE, what_would_help: UNKNOWN_HELP, key: null }
  };
}

export function deriveEducationNotes(validation) {
  const flags = Array.isArray(validation?.flags) ? validation.flags.filter((flag) => typeof flag === "string") : [];
  const notes = [];
  const seen = new Set();
  for (const flag of flags) {
    const { rule, spec } = flagSpec(flag);
    if (seen.has(rule)) continue; // ordered, de-duplicated by rule (Python parity)
    seen.add(rule);
    const extra = flag.includes(":") ? ` ${flag}` : "";
    notes.push({
      rule_or_threshold: rule,
      why_insufficient: `${spec.why_insufficient}${extra}`,
      what_would_help: spec.what_would_help,
      // Only ledger-verified keys may ever appear; abstentions stay null.
      verified_reference: verifiedReference(spec.key) ? spec.key : null
    });
  }
  return { notes };
}
