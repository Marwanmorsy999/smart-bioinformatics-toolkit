// M7.4 navigation aid only. When the research workspace launches a workflow it
// appends ?project=<id>; the destination page shows a small read-only note.
// No API call, no token, no change to any standalone tool's behavior.
const note = document.getElementById("project-context");
if (note) {
  const projectId = new URLSearchParams(window.location.search).get("project");
  if (projectId && /^[A-Za-z0-9_-]{1,100}$/.test(projectId)) {
    note.textContent = `Project context: ${projectId}`;
    note.hidden = false;
  }
}
