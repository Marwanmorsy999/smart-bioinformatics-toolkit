// M7.4 run state machine — distinct execution, retrieval and validation states.
export const RUN_STATES = Object.freeze([
  "draft", "planned", "awaiting_approval", "queued", "running",
  "execution_completed", "artifact_retrieval", "validation", "succeeded", "failed", "cancelled"
]);
const FORWARD = Object.freeze({
  draft: ["planned", "cancelled"],
  planned: ["awaiting_approval", "cancelled"],
  awaiting_approval: ["queued", "cancelled"],
  queued: ["running", "failed", "cancelled"],
  running: ["execution_completed", "failed", "cancelled"],
  execution_completed: ["artifact_retrieval", "failed", "cancelled"],
  artifact_retrieval: ["validation", "failed", "cancelled"],
  validation: ["succeeded", "failed", "cancelled"]
});

export function canTransition(from, to) {
  return (FORWARD[String(from)] ?? []).includes(String(to));
}
export function assertTransition(from, to) {
  if (!canTransition(from, to)) throw new Error(`invalid_run_transition:${from}->${to}`);
  return to;
}
export function isTerminal(state) {
  return ["succeeded", "failed", "cancelled"].includes(String(state));
}
export function runSummary(row) {
  // Stage reporting never claims success from a single completed stage.
  const stages = {
    submitted: !["draft", "planned"].includes(row.state),
    running: ["running", "execution_completed", "artifact_retrieval", "validation", "succeeded"].includes(row.state),
    execution_completed: ["execution_completed", "artifact_retrieval", "validation", "succeeded"].includes(row.state),
    artifact_retrieved: ["artifact_retrieval", "validation", "succeeded"].includes(row.state),
    validated: ["validation", "succeeded"].includes(row.state),
    full_workflow_completed: row.state === "succeeded"
  };
  return { ...stages, state: row.state };
}
