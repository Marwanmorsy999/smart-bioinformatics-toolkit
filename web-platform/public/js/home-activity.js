/* Homepage research activity — real browser-local M7.12 history only.
   No network, no invented runs, no cross-device claims. */
import { readIndex } from "./research-history.js";

const WORKFLOW_LABEL = { phylo: "Phylogenetics", "16s": "16S identification", protein: "Protein annotation", microbiome: "Microbiome", unknown: "Analysis" };
const WORKFLOW_ROUTE = { phylo: "phylo.html", "16s": "16s.html", protein: "protein.html", microbiome: "microbiome.html", unknown: "history.html" };

function el(tag, className, text) { const n = document.createElement(tag); if (className) n.className = className; if (text != null) n.textContent = String(text); return n; }

function render() {
  const list = document.getElementById("research-activity-list");
  const empty = document.getElementById("research-activity-empty");
  if (!list || !empty) return;
  let entries = [];
  try { entries = readIndex().entries; } catch { entries = []; }
  const recent = entries.slice().sort((a, b) => String(b.created_at || "").localeCompare(String(a.created_at || ""))).slice(0, 6);
  list.replaceChildren();
  if (recent.length === 0) { empty.hidden = false; return; }
  empty.hidden = true;
  const table = el("ul", "research-activity-list");
  for (const entry of recent) {
    const li = el("li", "activity-item");
    const meta = el("div", "activity-meta");
    const label = WORKFLOW_LABEL[entry.workflow_type] || "Analysis";
    meta.append(el("span", "activity-workflow", label));
    const statusClass = entry.status === "succeeded" || entry.status === "complete" ? "is-success" : entry.status === "failed" ? "is-error" : entry.status === "running" ? "is-info" : "";
    meta.append(el("span", "status-badge " + statusClass, entry.status));
    const title = el("a", "activity-title", entry.title || `${label} ${entry.run_id}`);
    title.href = (WORKFLOW_ROUTE[entry.workflow_type] || "history.html");
    const when = el("time", "activity-time", entry.created_at ? new Date(entry.created_at).toLocaleString() : "time not recorded");
    const id = el("code", "activity-id", entry.run_id);
    li.append(title, meta, when, id);
    table.append(li);
  }
  list.append(table);
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", render); else render();
