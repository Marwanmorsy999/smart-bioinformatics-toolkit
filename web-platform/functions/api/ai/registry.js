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

// A small JSON-Schema-subset check driven by each tool's params_schema:
// required, additionalProperties:false, type, enum, minimum and maximum.
// Values are never interpreted as scientific values; they are passed to the
// local agent verbatim. Unknown schema keywords are deliberately ignored.
function matchesType(value, type) {
  switch (type) {
    case "string": return typeof value === "string";
    case "number": return typeof value === "number" && Number.isFinite(value);
    case "integer": return Number.isInteger(value);
    case "boolean": return typeof value === "boolean";
    case "object": return value !== null && typeof value === "object" && !Array.isArray(value);
    case "array": return Array.isArray(value);
    case "null": return value === null;
    default: return true; // unconstrained when the schema has no known type
  }
}

export function validateParams(toolId, params) {
  const tool = getTool(toolId);
  if (!tool) return { valid: false, error: `Unknown tool: ${toolId}` };
  if (!params || typeof params !== "object" || Array.isArray(params)) {
    return { valid: false, error: "params must be an object." };
  }
  const schema = tool.params_schema ?? {};
  const allowed = schema.properties ?? {};

  if (schema.additionalProperties === false) {
    for (const key of Object.keys(params)) {
      if (!Object.hasOwn(allowed, key)) return { valid: false, error: `Unsupported parameter: ${key}` };
    }
  }
  for (const key of schema.required ?? []) {
    if (!Object.hasOwn(params, key)) return { valid: false, error: `Missing required parameter: ${key}` };
  }
  for (const [key, value] of Object.entries(params)) {
    const rule = allowed[key];
    if (!rule) continue;
    if (!matchesType(value, rule.type)) {
      return { valid: false, error: `${key} must be ${rule.type ?? "a supported type"}.` };
    }
    if (Array.isArray(rule.enum) && !rule.enum.includes(value)) {
      return { valid: false, error: `${key} must be one of: ${rule.enum.join(", ")}.` };
    }
    if (typeof value === "number" && Number.isFinite(value)) {
      if (typeof rule.minimum === "number" && value < rule.minimum) {
        return { valid: false, error: `${key} must be >= ${rule.minimum}.` };
      }
      if (typeof rule.maximum === "number" && value > rule.maximum) {
        return { valid: false, error: `${key} must be <= ${rule.maximum}.` };
      }
    }
  }
  return { valid: true, error: null };
}
