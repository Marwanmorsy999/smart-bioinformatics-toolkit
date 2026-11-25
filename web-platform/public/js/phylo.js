// M7.3 website controller â€” upload, plan, approval, live progress, tree view.
const $ = (id) => document.getElementById(id);
if (typeof window !== "undefined") window.__phylo = { renderTree, parseNewick };
let state = { fasta: "", filename: "", objective: "", plan: null, planId: null, pollTimer: null };

async function sha256(text) {
  try {
    const bytes = new TextEncoder().encode(text);
    const hash = await crypto.subtle.digest("SHA-256", bytes);
    return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, "0")).join("");
  } catch {
    // The Worker computes the authoritative SHA-256 from the uploaded bytes;
    // a file:// browser context may not expose SubtleCrypto.
    return "computed-by-worker";
  }
}

$("phylo-file").addEventListener("change", async (event) => {
  const file = event.target.files?.[0];
  if (!file) return;
  state.fasta = await file.text();
  state.filename = file.name;
  $("phylo-status").textContent = `Loaded ${file.name} (${state.fasta.length} characters).`;
});

$("phylo-plan").addEventListener("click", async () => {
  if (!state.fasta.trim()) { $("phylo-status").textContent = "Choose a FASTA file first."; return; }
  $("phylo-status").textContent = "Validating input and preparing planâ€¦";
  state.objective = $("phylo-objective").value.trim();
  const hash = await sha256(state.fasta);
  // The plan is computed from the verified step list; no bytes are transmitted
  // until the visitor approves below.
  state.plan = { steps: [
    { id: "upload_input", tool_id: "upload1", note: "Upload FASTA to a dedicated Galaxy history" },
    { id: "galaxy_mafft", tool_id: "MAFFT (live-discovered version)", note: "Multiple sequence alignment" },
    { id: "galaxy_iqtree", tool_id: "IQ-TREE (live-discovered version)", note: "Phylogenetic tree inference" },
    { id: "retrieve_outputs", tool_id: null, note: "Retrieve alignment + tree datasets" },
    { id: "validate_alignment", tool_id: "phylogenetics.validate", note: "Independent alignment checks" },
    { id: "validate_tree", tool_id: "phylogenetics.tree", note: "Newick parse + taxa checks" },
    { id: "generate_report", tool_id: "phylogenetics.report", note: "Job-derived reproducible report" }
  ], input_sha256: hash, filename: state.filename, objective: state.objective };
  $("phylo-plan-steps").innerHTML = state.plan.steps.map((s) =>
    `<li><strong>${s.id}</strong> â€” ${s.note}${s.tool_id ? ` <code>${s.tool_id}</code>` : ""}</li>`).join("");
  $("phylo-plan-view").hidden = false;
  $("phylo-status").textContent = "Plan ready. Nothing has been uploaded yet â€” approve to execute.";
});

$("phylo-approve-check").addEventListener("change", (e) => {
  $("phylo-run").disabled = !e.target.checked;
});

// Minimal independent Newick renderer (uses the same grammar expectations as
// the server validator; renders a rectangular cladogram in SVG).
function parseNewick(text) {
  const s = String(text || "").trim();
  let p = 0;
  function node() {
    const n = { name: "", children: [], length: null };
    const label = () => {
      const start = p;
      while (p < s.length && !/[\s(),:;]/.test(s[p])) p++;
      return s.slice(start, p);
    };
    if (s[p] === "(") {
      p++;
      while (p < s.length && s[p] !== ")") {
        n.children.push(node());
        if (s[p] === ",") p++;
      }
      if (s[p] === ")") p++;
      n.name = label();
    } else n.name = label();
    if (s[p] === ":") { p++; const st = p; while (p < s.length && /[-+0-9.eE]/.test(s[p])) p++; n.length = Number(s.slice(st, p)); }
    return n;
  }
  const root = node();
  return root;
}
function layout(root, width, height) {
  const tips = [];
  (function walk(n, depth) {
    n._depth = depth;
    if (!n.children.length) { n._y = (tips.length + 0.5) * (height / Math.max(tips.length, 1)); tips.push(n); }
    else { n.children.forEach((c) => walk(c, depth + 1)); n._y = (n.children[0]._y + n.children[n.children.length - 1]._y) / 2; }
  })(root, 0);
  const maxDepth = Math.max(1, ...tips.map((t) => t._depth));
  (function place(n) {
    n._x = 40 + (n._depth / maxDepth) * (width - 100);
    n.children.forEach(place);
  })(root);
  return tips;
}
function renderTree(newick, mount) {
  const root = parseNewick(newick);
  const tips = [];
  (function walk(n, d) {
    n._d = d;
    if (!n.children.length) tips.push(n);
    else n.children.forEach((c) => walk(c, d + 1));
  })(root, 0);
  const height = Math.max(120, tips.length * 28);
  const rects = [];
  (function walk(n) {
    if (!n.children.length) n._y = (tips.indexOf(n) + 0.5) * (height / tips.length);
    else { n.children.forEach(walk); n._y = (n.children[0]._y + n.children[n.children.length - 1]._y) / 2; }
  })(root);
  const maxD = Math.max(1, ...tips.map((t) => t._d));
  (function walk(n) {
    n._x = 50 + (n._d / maxD) * 460;
    n.children.forEach((c) => {
      rects.push(`<line x1="${n._x}" y1="${n._y}" x2="${c._x}" y2="${c._y}" stroke="#0f2740" stroke-width="2"/>`);
      rects.push(`<line x1="${c._x}" y1="${n._y}" x2="${c._x}" y2="${c._y}" stroke="#0f2740" stroke-width="2"/>`);
      walk(c);
    });
  })(root);
  for (const t of tips) rects.push(`<text x="${t._x + 6}" y="${t._y + 4}" font-size="13" fill="#0f2740">${t.name.replace(/[<>&]/g, "")}</text>`);
  mount.innerHTML = `<svg viewBox="0 0 560 ${height + 20}" width="100%" height="${height + 20}" role="img" aria-label="Phylogenetic tree">${rects.join("")}</svg>`;
}

$("phylo-run").addEventListener("click", async () => {
  $("phylo-run").disabled = true;
  $("phylo-status").textContent = "Approved â€” submitting to Galaxyâ€¦";
  $("phylo-progress").hidden = false;
  const response = await fetch("/api/ai/workflows/phylo/run", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ fasta_text: state.fasta, filename: state.filename, objective: state.objective, sequence_type: "dna" })
  });
  const body = await response.json();
  if (!response.ok) { $("phylo-status").textContent = `Run failed: ${body.error ?? response.status}`; $("phylo-run").disabled = false; return; }
  state.planId = body.plan_id;
  const stage = body.workflow_completed ? "FULL WORKFLOW COMPLETED" : "JOB SUBMITTED / INCOMPLETE â€” artifacts may not be retrieved or validated";
  $("phylo-status").textContent = `Run ${body.run_id}: ${stage} (validation: ${body.validation?.status ?? "unknown"})`;
  $("phylo-provenance").textContent = JSON.stringify(body.provenance, null, 2);
  $("phylo-validation").textContent = `Alignment: ${body.validation?.alignment?.valid ? "PASS" : "FAIL"}; Tree: ${body.validation?.tree?.valid ? "PASS" : "FAIL"}`;
  const treeJob = body.job_ids?.galaxy_iqtree;
  if (treeJob) {
    $("phylo-downloads").innerHTML = `<li><a href="/api/ai/jobs/${encodeURIComponent(treeJob)}/report?format=html">Download HTML report</a></li>`;
    $("phylo-report-link").href = `/api/ai/jobs/${encodeURIComponent(treeJob)}/report?format=html`;
  }
  $("phylo-results").hidden = false;
  // Render a tree if the response includes one (artifact content is available
  // through the job report endpoint; keep the tree view driven by real data).
  if (body.tree_newick) renderTree(body.tree_newick, $("phylo-tree"));
  else $("phylo-tree").textContent = "Tree is available in the job-derived report; awaiting tree dataset text.";
});

