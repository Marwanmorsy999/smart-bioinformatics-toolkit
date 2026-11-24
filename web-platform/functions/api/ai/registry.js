// Tool registry for the AI control plane. Mirrors shared/plugins/*.json.
// The Worker only advertises tools; it never executes them.
// TOOLS is generated from the validated manifests; do not edit it here.

import { TOOLS } from "./registry.tools.generated.js";

export { TOOLS };

export function getTool(toolId) {
  return TOOLS.find((tool) => tool.id === toolId) ?? null;
}

export function toolIds() {
  return TOOLS.map((tool) => tool.id);
}

export function isKnownTool(toolId) {
  return Boolean(getTool(toolId));
}

// A minimal params check matching the JSON Schema above. Values are never
// interpreted as scientific values; they are passed to the local agent verbatim.
export function validateParams(toolId, params) {
  const tool = getTool(toolId);
  if (!tool) return { valid: false, error: `Unknown tool: ${toolId}` };
  if (!params || typeof params !== "object" || Array.isArray(params)) {
    return { valid: false, error: "params must be an object." };
  }
  const allowed = tool.params_schema.properties ?? {};
  for (const key of Object.keys(params)) {
    if (!Object.hasOwn(allowed, key)) return { valid: false, error: `Unsupported parameter: ${key}` };
  }
  for (const key of tool.params_schema.required ?? []) {
    if (!Object.hasOwn(params, key)) return { valid: false, error: `Missing required parameter: ${key}` };
  }
  if (Object.hasOwn(params, "sequence_type") && !["dna", "protein"].includes(params.sequence_type)) {
    return { valid: false, error: "sequence_type must be dna or protein." };
  }
  return { valid: true, error: null };
}
