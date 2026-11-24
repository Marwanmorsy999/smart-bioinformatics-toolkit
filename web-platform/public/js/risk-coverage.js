// Risk-coverage sweep. Behaviour matches python-engine/src/smartbio/benchmark/risk_coverage.py.
// Shared fixture: shared/test-cases/risk_coverage_cases.json (synthetic, not performance data).


function normalizeName(name) {
  return String(name || "").trim().split(/\s+/).filter(Boolean).join(" ").toLowerCase();
}

export function evaluateRiskCase(c, threshold, minCoverage = 80.0) {
  const species = c.top_species;
  const identity = c.top_identity;
  const coverage = c.top_query_coverage !== undefined ? c.top_query_coverage : c.query_coverage;
  let call = false;
  let correct = false;
  if (species && identity !== null && identity !== undefined && (coverage === null || coverage === undefined || coverage >= minCoverage) && identity >= threshold) {
    call = true;
    correct = normalizeName(species) === normalizeName(c.true_species);
  }
  return { call, correct, wrong: call && !correct };
}

export function riskCoverageSweep(cases, thresholds, minCoverage = 80.0) {
  const n = cases.length;
  return thresholds.map((t) => {
    const evs = cases.map((c) => evaluateRiskCase(c, t, minCoverage));
    const calls = evs.filter((e) => e.call).length;
    const correct = evs.filter((e) => e.correct).length;
    const wrong = evs.filter((e) => e.wrong).length;
    return {
      species_threshold: t,
      species_call_rate: n ? Math.round((calls / n) * 10000) / 10000 : null,
      wrong_rate_among_calls: calls ? Math.round((wrong / calls) * 10000) / 10000 : null,
      wrong_rate_overall: n ? Math.round((wrong / n) * 10000) / 10000 : null,
      calls,
      wrong,
    };
  });
}

