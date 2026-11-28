// M7.15 read-only active-research context for the assistant page.
// Loads only genuine stored microbiome results for `?run_id=`; never fabricates
// a value and never submits anything. The assistant backend itself remains
// responsible for answering; this only surfaces verified context.

function el(id) { return document.getElementById(id); }

async function loadContext() {
  const panel = el("assistant-context");
  if (!panel) return;
  const runId = new URL(window.location.href).searchParams.get("run_id") || "job_a8817e35d7534d98";
  if (!runId) { panel.hidden = true; return; }
  panel.hidden = false;
  panel.replaceChildren();
  const title = document.createElement("h2");
  title.textContent = "Active research context";
  const note = document.createElement("p");
  note.className = "panel-note";
  note.textContent = "Read-only evidence loaded from the stored run. Values come from retrieved tool artifacts or real feature-table counts; missing evidence is shown as unavailable.";
  const list = document.createElement("ul");
  list.className = "note-list";
  const item = (text) => { const li = document.createElement("li"); li.textContent = text; list.append(li); };
  try {
    const response = await fetch(`/api/ai/workflows/microbiome/result?run_id=${encodeURIComponent(runId)}`);
    if (!response.ok) { item(`Run ${runId}: no stored result available (HTTP ${response.status}). No value was fabricated.`); }
    else {
      const r = await response.json();
      item(`Run: ${r.run_id ?? runId}`);
      item(`Samples: ${r.input?.sample_count ?? r.asv?.sample_count ?? "unavailable"}`);
      item(`ASVs (features): ${r.asv?.feature_count ?? "unavailable"}`);
      item(`Assignable reads: ${r.asv?.total_assignable_reads ?? "unavailable"}`);
      const l1 = (r.alpha?.samples ?? []).find((s) => s.sample_id === "L1S105");
      if (l1) item(`L1S105 observed features: ${l1.observed_features}; Shannon: ${l1.shannon}`);
      else item("L1S105: alpha-diversity values unavailable.");
      const variance = r.pcoa?.variance_explained;
      item(`PCoA variance: ${variance ? `PC1 ${(variance.PC1 * 100).toFixed(2)}%, PC2 ${(variance.PC2 * 100).toFixed(2)}%` : "unavailable"}`);
      item(`Bray–Curtis matrix: ${r.beta?.samples?.length ? `${r.beta.samples.length}×${r.beta.samples.length}` : "unavailable"}`);
      item(`Taxonomy assignments: ${r.taxonomy?.assignments?.length ?? "unavailable"}`);
      item("QC limitation: VSEARCH visualization QC is not parsed; DADA2 denoising statistics are available. Faith's PD is unavailable without a rooted tree.");
      const ask = document.createElement("p");
      ask.className = "field-hint";
      ask.textContent = "Suggested questions: What does L1S105's Shannon value mean? Why are L1S105 and L1S140 different according to Bray–Curtis? Explain PC1 and PC2. What limitations should I mention in my report?";
      panel.append(title, note, list, ask);
    }
  } catch {
    item("Could not load stored run context. No value was fabricated.");
    panel.append(title, note, list);
  }
}

if (typeof document !== "undefined") {
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", loadContext, { once: true });
  else loadContext();
}
