// M7.4 workspace UI controller.
const $ = (id) => document.getElementById(id);
let token = "";
let currentProject = null;

async function api(path, options = {}) {
  const headers = { ...(options.headers ?? {}) };
  if (token) headers["X-Agent-Token"] = token;
  if (options.body) headers["Content-Type"] = "application/json";
  const response = await fetch(path, { ...options, headers });
  let body;
  try { body = await response.json(); } catch { body = { error: `HTTP ${response.status}` }; }
  if (!response.ok) throw new Error(body.error ?? `HTTP ${response.status}`);
  return body;
}

$("ws-agent").addEventListener("change", (e) => { token = e.target.value; });
$("ws-load").addEventListener("click", async () => {
  try {
    const { projects } = await api("/api/workspace/projects");
    $("ws-project-list").innerHTML = projects.map((p) =>
      `<li><button type="button" data-project="${p.public_id}">${p.name}</button> — ${p.status}</li>`).join("");
    $("ws-project-list").querySelectorAll("button").forEach((b) => b.addEventListener("click", () => openProject(b.dataset.project)));
    $("ws-status").textContent = `${projects.length} project(s).`;
  } catch (e) { $("ws-status").textContent = `Load failed: ${e.message}`; }
});

$("ws-create").addEventListener("click", async () => {
  try {
    await api("/api/workspace/projects", { method: "POST", body: JSON.stringify({ name: $("ws-name").value, objective: $("ws-objective").value }) });
    $("ws-status").textContent = "Project created.";
    $("ws-load").click();
  } catch (e) { $("ws-status").textContent = `Create failed: ${e.message}`; }
});

async function openProject(id) {
  currentProject = id;
  const [{ project }, { datasets }, { runs }, { workflows }] = await Promise.all([
    api(`/api/workspace/projects/${encodeURIComponent(id)}`),
    api(`/api/workspace/projects/${encodeURIComponent(id)}/datasets`),
    api(`/api/workspace/projects/${encodeURIComponent(id)}/runs`),
    api("/api/workspace/catalog")
  ]);
  $("ws-detail").hidden = false;
  $("ws-detail-title").textContent = project.name;
  $("ws-detail-meta").textContent = `${project.status} · ${project.objective || "No objective"}`;
  $("ws-datasets").innerHTML = datasets.length ? datasets.map((d) =>
    `<li>${d.filename} — ${d.format}, ${d.size_bytes} bytes, sha256 ${d.sha256.slice(0, 12)}… (${d.validation_state})</li>`).join("")
    : "<li>No dataset metadata registered.</li>";
  $("ws-catalog").innerHTML = workflows.map((w) =>
    `<li><a href="${w.entry_point}?project=${encodeURIComponent(id)}">${w.name}</a> — availability: <strong>${w.availability}</strong>${w.blocked_reason ? ` (${w.blocked_reason})` : ""}</li>`).join("");
  $("ws-runs").innerHTML = runs.length ? runs.map((r) =>
    `<li><button type="button" data-run="${r.public_id}">${r.workflow_id}</button> — ${r.public_id}, ${r.state}, execution=${r.stages.execution_completed}, artifacts=${r.stages.artifact_retrieved}, validated=${r.stages.validated}</li>`).join("")
    : "<li>No runs yet.</li>";
  $("ws-runs").querySelectorAll("button").forEach((b) => b.addEventListener("click", async () => {
    const { run } = await api(`/api/workspace/runs/${encodeURIComponent(b.dataset.run)}`);
    $("ws-run-detail").hidden = false;
    $("ws-run-json").textContent = JSON.stringify(run, null, 2);
  }));
}

$("ws-demo-load").addEventListener("click", async () => {
  const demo = await api("/api/workspace/demo");
  $("ws-demo-view").hidden = false;
  $("ws-demo-json").textContent = `${demo.label}\n\n${JSON.stringify(demo, null, 2)}`;
});
