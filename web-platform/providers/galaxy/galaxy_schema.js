// M7.3 schema-driven Galaxy tool payload builder.
// Derives parameter names and verified defaults from the LIVE tool schema
// returned by GET /api/tools/{id}?io_details=true&tool_version=... — no guessed
// MAFFT/IQ-TREE parameters. Secrets stay server-side and are never returned.
const IDEXT = ["fasta", "fa", "fna", "fas", "aln", "phylip", "nex", "clustal", "msf"];

// In-isolate cache only. Large QIIME 2 wrappers expose thousands of conditional
// cases; refetching/reparsing them on every status poll exceeded the Worker CPU
// limit. Keys contain the base URL, tool id and version — never a credential —
// and the cache is bounded FIFO. Cached schemas are read-only by contract.
const SCHEMA_CACHE_LIMIT = 24;
const schemaCache = new Map();
const fetchIdentities = new WeakMap();
let nextFetchIdentity = 1;

// Distinguish injected stub fetches from the stable runtime fetch so offline
// tests with different per-test schemas never share a cached schema.
function fetchIdentity() {
  const impl = globalThis.fetch;
  if (typeof impl !== "function") return "none";
  if (!fetchIdentities.has(impl)) fetchIdentities.set(impl, nextFetchIdentity++);
  return String(fetchIdentities.get(impl));
}

export function clearToolSchemaCache() { schemaCache.clear(); }

export async function fetchToolSchema(env, toolId, version) {
  const base = String(env?.GALAXY_BASE_URL ?? "").trim();
  const key = String(env?.GALAXY_API_KEY ?? "").trim();
  if (!base || !key) throw new Error("Galaxy schema fetch requires server-side credentials");
  const id = String(toolId ?? "").trim();
  if (!/^[A-Za-z0-9._+\-\/]+$/.test(id)) throw new Error("invalid_tool_id");
  const cacheKey = `${fetchIdentity()}|${base}|${id}|${String(version ?? "")}`;
  if (schemaCache.has(cacheKey)) return schemaCache.get(cacheKey);
  const suffix = version ? `&tool_version=${encodeURIComponent(version)}` : "";
  const response = await fetch(`${base}/api/tools/${encodeURIComponent(id)}?io_details=true${suffix}`, {
    headers: { "X-API-Key": key, Accept: "application/json" }
  });
  if (!response.ok) throw Object.assign(new Error(`schema_http_${response.status}`), { status: response.status });
  const schema = await response.json();
  if (!Array.isArray(schema?.inputs) || schema.inputs.length === 0) {
    throw new Error("schema_unavailable: tool exposes no usable io_details inputs");
  }
  if (schemaCache.size >= SCHEMA_CACHE_LIMIT) schemaCache.delete(schemaCache.keys().next().value);
  schemaCache.set(cacheKey, schema);
  return schema;
}

function val(v) {
  return v && typeof v === "object" && "value" in v ? v.value : v;
}

// Walk the verified schema, producing Galaxy form-style names:
// section|param, conditional|test_param, repeat_0|child.
function walk(inputs, prefix, datasetId, out, state) {
  for (const raw of inputs ?? []) {
    const item = raw && typeof raw === "object" ? raw : {};
    const name = String(item.name ?? "");
    if (!name) continue;
    const full = `${prefix}${name}`;
    const kind = String(item.model_class ?? "");
    if (kind === "Section") {
      walk(item.inputs, `${full}|`, datasetId, out, state);
    } else if (kind === "Conditional") {
      const test = item.test_param ?? {};
      const testName = String(test.name ?? "");
      const defaultChoice = val(test.value);
      if (testName && defaultChoice !== undefined && defaultChoice !== null) out[`${full}|${testName}`] = defaultChoice;
      const chosen = (item.cases ?? []).find((c) => String(c.value) === String(defaultChoice));
      if (chosen) walk(chosen.inputs, `${full}|`, datasetId, out, state);
    } else if (kind === "Repeat") {
      const count = Number(item.default ?? 1) || 1;
      for (let i = 0; i < Math.min(count, 5); i += 1) walk(item.inputs, `${full}_${i}|`, datasetId, out, state);
    } else if (kind.includes("DataToolParameter")) {
      const exts = (item.extensions ?? []).map((e) => String(e).toLowerCase());
      const isSequence = exts.some((e) => IDEXT.includes(e));
      if (isSequence && !state.datasetPlaced) {
        out[full] = { src: "hda", id: datasetId };
        state.datasetPlaced = true;
        state.datasetField = full;
      }
    } else {
      // Only verified defaults/values from this instance are applied.
      const value = val(item.value);
      const fallback = val(item.default_value);
      const chosen = value !== undefined && value !== null ? value : fallback;
      if (chosen !== undefined && chosen !== null && String(chosen) !== "") out[full] = chosen;
    }
  }
}

export function buildSchemaPayload(schema, datasetId) {
  if (!schema || !Array.isArray(schema.inputs) || schema.inputs.length === 0) {
    return { valid: false, errors: ["schema_unavailable"], inputs: {} };
  }
  const id = String(datasetId ?? "").trim();
  if (!/^[0-9a-f]+$/i.test(id)) return { valid: false, errors: ["invalid_dataset_id"], inputs: {} };
  const inputs = {};
  const state = { datasetPlaced: false, datasetField: null };
  walk(schema.inputs, "", id, inputs, state);
  const errors = [];
  if (!state.datasetPlaced) errors.push("no_sequence_dataset_input_in_schema");
  if (!inputs[state.datasetField]) errors.push("dataset_reference_missing");
  return { valid: errors.length === 0, errors, inputs, dataset_field: state.datasetField };
}

export function describeSchema(schema) {
  const names = [];
  (function collect(inputs, prefix) {
    for (const raw of inputs ?? []) {
      const item = raw && typeof raw === "object" ? raw : {};
      const name = String(item.name ?? "");
      if (!name) continue;
      const full = `${prefix}${name}`;
      const kind = String(item.model_class ?? "");
      names.push({ name: full, model_class: kind, optional: item.optional === true,
        extensions: Array.isArray(item.extensions) ? item.extensions : [] });
      if (kind === "Section") collect(item.inputs, `${full}|`);
      else if (kind === "Conditional") {
        const chosen = (item.cases ?? []).find((c) => String(c.value) === String(val(item.test_param?.value)));
        if (chosen) collect(chosen.inputs, `${full}|`);
      } else if (kind === "Repeat") collect(item.inputs, `${full}_0|`);
    }
  })(schema?.inputs, "");
  return names;
}
