// Deterministic planner. No heavy compute, no external calls, no invented tools.
// An optional provider may suggest an intent; it is always checked against the
// same closed set, so a paid key is never required and untrusted output cannot
// introduce a tool.

import { validateFasta, makeId, nowIso, MIN_CONFIDENCE } from "./_lib.js";
import { getTool } from "./registry.js";

const KEYWORDS = {
  validate_and_profile: ["validate", "validation", "check", "profile", "stats", "statistic", "statistics", "gc", "composition", "n50", "length"],
  identify_taxa: ["identify", "identification", "taxa", "taxon", "taxonomy", "classify", "classification", "blast", "species", "organism", "genus", "microbiome", "16s"]
};

const CLARIFYING_QUESTION = "Please clarify the task: do you want FASTA validation/statistics (for example 'profile my FASTA' or 'check GC content'), or taxonomic identification (which needs BLAST hits and a local database)?";

const BASE_LIMITATIONS = [
  "Research use only. Outputs are screening evidence, not proof of identity and not a clinical diagnosis.",
  "This MVP accepts nucleotide FASTA (IUPAC codes) only; protein input is not supported by the request flow.",
  "Statistics are descriptive; they do not establish taxonomy, identity or sequencing quality."
];

// Optional LLM provider adapter: implement { classify(text) -> {intent, confidence} }.
// The deterministic default is offline and free.
export const DETERMINISTIC_PROVIDER = {
  name: "deterministic",
  classify(text) {
    return classifyIntent(text);
  }
};

export function classifyIntent(text) {
  const tokens = String(text ?? "").toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  const tokenSet = new Set(tokens);
  const scores = {};
  for (const [intent, keywords] of Object.entries(KEYWORDS)) {
    scores[intent] = keywords.filter((keyword) => tokenSet.has(keyword)).length;
  }
  const profileScore = scores.validate_and_profile;
  const taxaScore = scores.identify_taxa;
  if (profileScore === 0 && taxaScore === 0) {
    return { intent: null, confidence: 0.2, clarifyingQuestion: CLARIFYING_QUESTION };
  }
  if (profileScore === taxaScore) {
    return { intent: null, confidence: 0.45, clarifyingQuestion: CLARIFYING_QUESTION };
  }
  const intent = profileScore > taxaScore ? "validate_and_profile" : "identify_taxa";
  const score = Math.max(profileScore, taxaScore);
  return {
    intent,
    confidence: Math.min(0.95, 0.6 + 0.1 * (score - 1)),
    clarifyingQuestion: null
  };
}

function stepFor(intent, datasetId) {
  // Only registered, available tools may appear in a plan.
  const tool = getTool("sequence-stats.profile");
  if (!tool || !tool.available) return null;
  return {
    id: "step_1",
    tool_id: tool.id,
    backend: tool.backend,
    params: { sequence_type: "dna" },
    inputs: [`dataset:${datasetId}`],
    external_egress: false,
    consent_required: false,
    estimated_seconds: tool.estimated_seconds
  };
}

export function buildPlan({ text, datasetId, requestId, planId, createdAt, now, idFactory, provider = DETERMINISTIC_PROVIDER }) {
  const classification = provider?.classify ? provider.classify(text) : classifyIntent(text);
  // Provider output is untrusted: only a known intent with sufficient confidence is accepted.
  const usable = classification && Object.hasOwn(KEYWORDS, classification.intent)
    && typeof classification.confidence === "number"
    && classification.confidence >= MIN_CONFIDENCE;
  if (!usable) {
    return { plan: null, clarifyingQuestion: classification?.clarifyingQuestion ?? CLARIFYING_QUESTION };
  }

  const intent = classification.intent;
  const timestamp = createdAt ?? nowIso(now);
  const step = stepFor(intent, datasetId);
  if (!step) return { plan: null, clarifyingQuestion: "No registered analysis tool is currently available." };

  const limitations = [...BASE_LIMITATIONS];
  const plan = {
    plan_id: planId ?? makeId("plan", idFactory),
    request_id: requestId,
    domain: intent === "identify_taxa" ? "microbiome-16s" : "sequence-analysis",
    intent,
    confidence: classification.confidence,
    created_at: timestamp,
    steps: [step],
    external_services: [],
    consents_required: [],
    limitations
  };

  if (intent === "identify_taxa") {
    // Real BLAST needs a local database. The plan never claims a taxonomic
    // result from FASTA alone, and no mock data is presented as real.
    plan.requires = ["local_database"];
    plan.limitations.push(
      "Taxonomic identification requires BLAST hits from a locally configured database; this MVP performs sequence profiling only and returns no taxa calls.",
      "No external service is contacted and no consent is required for this plan."
    );
  }
  return { plan, clarifyingQuestion: null };
}

export function planRequest({ text, fasta, datasetId, requestId, planId, now, idFactory, provider }) {
  const preflight = validateFasta(fasta);
  if (!preflight.valid) return { plan: null, preflight, clarifyingQuestion: null };
  const built = buildPlan({ text, datasetId, requestId, planId, now, idFactory, provider });
  return { plan: built.plan, preflight, clarifyingQuestion: built.clarifyingQuestion };
}
