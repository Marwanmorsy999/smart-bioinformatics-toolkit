#!/usr/bin/env node
// M7.1 OPT-IN live provider smoke harness.
//
// Every endpoint, credential, workspace, model and timeout comes from
// process.env. There is no URL or credential literal in this file. Missing
// configuration means SKIPPED - never a silent fallback, never a network call.
// Only read-only calls are made. The single write (a tiny Galaxy upload via
// upload1) requires LIVE_WRITE=1 explicitly.
//
// Output is labelled [LIVE] or [SKIPPED] and is redacted: values, headers and
// response bodies are never printed. The only values printed are HTTP status
// codes, counts and OK/MISMATCH flags.
//
// Use --once to avoid spending credits on repeated discovery: it records a
// marker OUTSIDE the repository and skips another run for 30 minutes.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { joinUrl } from "../../web-platform/providers/common/normalize.js";

const REPO_ROOT = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const ONCE_DIR = resolve(process.env.LIVE_SMOKE_CACHE_DIR || "D:\\DevCache\\Temp\\opencode");
const ONCE_FILE = "m7-1-live-smoke-once.json";
const ONCE_TTL_MS = 30 * 60 * 1000;

// Regression expectations (test constants, not deployment configuration).
// Each can be overridden from the environment without editing this file.
const ALPHAFOLD_TOOL = process.env.LIVE_SMOKE_ALPHAFOLD_TOOL || "alphafold-db";
const ALPHAFOLD_ID = process.env.LIVE_SMOKE_UNIPROT_ID || "P04637";
const EXPECTED_GENE = process.env.LIVE_SMOKE_EXPECTED_GENE || "TP53";
const EXPECTED_UNIPROT = process.env.LIVE_SMOKE_EXPECTED_UNIPROT_ID || "P04637";
const EXPECTED_MODEL_PREFIX = process.env.LIVE_SMOKE_EXPECTED_MODEL_PREFIX || `AF-${EXPECTED_UNIPROT}`;
const UPLOAD_FILENAME = process.env.LIVE_SMOKE_UPLOAD_FILENAME || "m7-smoke.fasta";

const REDACT_NAMES = [
  "GALAXY_API_KEY", "SMARTSBIO_API_KEY", "NINEROUTER_API_KEY",
  "SMARTSBIO_WORKSPACE_ID", "ARTIFACT_SIGNING_KEY"
];
const TIMEOUT_MS = (() => {
  const raw = Number(process.env.LIVE_SMOKE_TIMEOUT_MS);
  return Number.isFinite(raw) && raw > 0 ? Math.min(raw, 120_000) : 15_000;
})();

function env(name) {
  const value = process.env[name];
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

function scrub(value) {
  let text = String(value ?? "");
  for (const name of REDACT_NAMES) {
    const secret = env(name);
    if (secret) text = text.split(secret).join("[REDACTED]");
  }
  return text.replace(/([?&](?:api[_-]?key|key|token|signature|sig)=)[^&\s]+/gi, "$1[REDACTED]");
}

function live(message) { console.log(`[LIVE] ${scrub(message)}`); }
function skipped(message) { console.log(`[SKIPPED] ${scrub(message)}`); }
function failed(message) { console.error(`[LIVE] ${scrub(message)}`); process.exitCode = 1; }

// Parse arguments. No provider is ever contacted unless explicitly selected or
// left at the default "all"; there is no implicit discovery target.
let PROVIDER = "all";
let ONCE = false;
for (let i = 2; i < process.argv.length; i += 1) {
  const arg = process.argv[i];
  if (arg === "--once") { ONCE = true; continue; }
  if (arg === "--provider") {
    PROVIDER = process.argv[i + 1] ?? "";
    i += 1;
    continue;
  }
  if (arg === "--help" || arg === "-h") {
    console.log("Usage: provider-live-smoke.mjs [--provider galaxy|smartsbio|ninerouter] [--once]");
    console.log("All configuration comes from environment variables. Set LIVE_WRITE=1 to allow the tiny Galaxy upload.");
    process.exit(0);
  }
  console.error(`Unknown argument: ${arg}`);
  process.exit(2);
}
if (!["all", "galaxy", "smartsbio", "ninerouter"].includes(PROVIDER)) {
  console.error(`Invalid --provider: ${PROVIDER}`);
  process.exit(2);
}

// The marker must never be created inside the repository.
if (ONCE_DIR === REPO_ROOT || ONCE_DIR.startsWith(REPO_ROOT + sep)) {
  console.error("Refusing to write the --once marker inside the repository.");
  process.exit(2);
}

function readMarker() {
  try {
    const raw = readFileSync(resolve(ONCE_DIR, ONCE_FILE), "utf8").replace(/^\uFEFF/, "");
    const parsed = JSON.parse(raw);
    const at = Date.parse(parsed?.at ?? "");
    return Number.isFinite(at) ? at : 0;
  } catch {
    return 0;
  }
}

function writeMarker() {
  try {
    mkdirSync(ONCE_DIR, { recursive: true });
    writeFileSync(resolve(ONCE_DIR, ONCE_FILE), JSON.stringify({ at: new Date().toISOString() }), "utf8");
  } catch (error) {
    failed(`could not record --once marker: ${error?.name ?? "error"}`);
  }
}

if (ONCE) {
  const at = readMarker();
  if (Date.now() - at < ONCE_TTL_MS) {
    skipped(`--once guard active; last discovery was under ${ONCE_TTL_MS / 60_000} minutes ago`);
    for (const id of ["galaxy", "smartsbio", "ninerouter"]) {
      if (PROVIDER === "all" || PROVIDER === id) skipped(`${id}: suppressed by --once`);
    }
    process.exit(0);
  }
}

async function request(base, path, { method = "GET", headers = {}, body } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(joinUrl(base, path), {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal
    });
    const text = await response.text();
    let parsed;
    try { parsed = JSON.parse(text); } catch { parsed = text.slice(0, 200); }
    return { ok: response.ok, status: response.status, body: parsed };
  } finally {
    clearTimeout(timer);
  }
}

function count(value) {
  if (Array.isArray(value)) return value.length;
  if (value && typeof value === "object") {
    const nested = value.data ?? value.tools ?? value.workflows ?? value.results;
    if (Array.isArray(nested)) return nested.length;
  }
  return 0;
}

async function smokeGalaxy() {
  const base = env("GALAXY_BASE_URL");
  const key = env("GALAXY_API_KEY");
  if (!base || !key) {
    skipped(`galaxy: set GALAXY_BASE_URL and GALAXY_API_KEY to enable (missing: ${[
      !base ? "GALAXY_BASE_URL" : null, !key ? "GALAXY_API_KEY" : null
    ].filter(Boolean).join(", ")})`);
    return false;
  }
  const headers = { "X-API-Key": key, Accept: "application/json" };
  try {
    live(`galaxy GET /api/version -> ${(await request(base, "/api/version", { headers })).status}`);
    const tools = await request(base, "/api/tools", { headers });
    live(`galaxy GET /api/tools -> ${tools.status} (${count(tools.body)} tools)`);
    const workflows = await request(base, "/api/workflows", { headers });
    live(`galaxy GET /api/workflows -> ${workflows.status} (${count(workflows.body)} workflows)`);
    const usage = await request(base, "/api/users/current/usage", { headers });
    live(`galaxy GET /api/users/current/usage -> ${usage.status}`);

    if (env("LIVE_WRITE") === "1") {
      const created = await request(base, "/api/histories", {
        method: "POST", headers: { ...headers, "Content-Type": "application/json" },
        body: { name: `m7-live-smoke-${Date.now()}` }
      });
      const historyId = created.body?.id;
      live(`galaxy WRITE (LIVE_WRITE=1) POST /api/histories -> ${created.status} (history created: ${Boolean(historyId)})`);
      if (!historyId) { failed("galaxy WRITE: no history id returned; upload suppressed"); return true; }
      const tiny = ">m7-live-smoke\nACGT\n";
      const uploaded = await request(base, "/api/tools", {
        method: "POST", headers: { ...headers, "Content-Type": "application/json" },
        body: {
          history_id: historyId,
          tool_id: "upload1",
          inputs: { file1: { file_content: tiny, filename: UPLOAD_FILENAME, ext: "fasta" } }
        }
      });
      live(`galaxy WRITE (LIVE_WRITE=1) POST /api/tools upload1 -> ${uploaded.status}`);
    } else {
      skipped("galaxy WRITE: LIVE_WRITE is not 1; no history or upload was created");
    }
    return true;
  } catch (error) {
    failed(`galaxy live call failed: ${error?.name ?? "error"}`);
    return true;
  }
}

function alphaFoldData(body) {
  const envelope = body && typeof body === "object" ? body : {};
  const run = envelope.result ?? envelope.data ?? envelope;
  if (run && typeof run === "object" && run.success === false) return null;
  return run && typeof run === "object" ? (run.data ?? run) : null;
}

async function smokeSmartsbio() {
  const base = env("SMARTSBIO_BASE_URL");
  const key = env("SMARTSBIO_API_KEY");
  const workspace = env("SMARTSBIO_WORKSPACE_ID");
  const missing = [!base && "SMARTSBIO_BASE_URL", !key && "SMARTSBIO_API_KEY", !workspace && "SMARTSBIO_WORKSPACE_ID"].filter(Boolean);
  if (missing.length) {
    skipped(`smartsbio: set ${missing.join(", ")} to enable`);
    return false;
  }
  if (process.env.SMARTSBIO_PUBLIC_AUTHORIZED !== "true") {
    skipped("smartsbio: SMARTSBIO_PUBLIC_AUTHORIZED is not true (competitor written-authorization gate)");
    return false;
  }
  const headers = { Authorization: `Bearer ${key}`, Accept: "application/json", "Content-Type": "application/json" };
  try {
    const workspaces = await request(base, "/v1/workspaces", { headers });
    const visible = count(workspaces.body) > 0;
    live(`smartsbio GET /v1/workspaces -> ${workspaces.status} (workspace listed: ${visible})`);
    const tools = await request(base, "/v1/tools", { headers });
    live(`smartsbio GET /v1/tools -> ${tools.status} (${count(tools.body)} tools)`);

    // AlphaFold lookup regression. VERIFIED request shape: singular `input` key.
    const lookup = await request(base, `/v1/tools/${encodeURIComponent(ALPHAFOLD_TOOL)}/run`, {
      method: "POST",
      headers,
      body: {
        input: { query_type: "uniprot", identifier: ALPHAFOLD_ID, format: "json", limit: 1 },
        workspace_id: workspace
      }
    });
    live(`smartsbio POST /v1/tools/${ALPHAFOLD_TOOL}/run -> ${lookup.status}`);
    const data = alphaFoldData(lookup.body);
    if (!data) {
      failed("smartsbio AlphaFold regression: no successful result payload");
      return true;
    }
    const geneOk = data.gene === EXPECTED_GENE;
    const uniprotOk = data.uniprot_id === EXPECTED_UNIPROT;
    const modelOk = String(data.model_identifier ?? "").startsWith(EXPECTED_MODEL_PREFIX);
    const artifactCount = Array.isArray(data.output_paths) ? data.output_paths.length : 0;
    live(`smartsbio AlphaFold regression: gene=${geneOk ? "OK" : "MISMATCH"} `
      + `uniprot_id=${uniprotOk ? "OK" : "MISMATCH"} model_identifier=${modelOk ? "OK" : "MISMATCH"} artifacts=${artifactCount}`);
    if (!geneOk || !uniprotOk || !modelOk || artifactCount === 0) {
      failed("smartsbio AlphaFold regression: expected-result check did not pass");
    }
    return true;
  } catch (error) {
    failed(`smartsbio live call failed: ${error?.name ?? "error"}`);
    return true;
  }
}

async function smokeNinerouter() {
  const base = env("NINEROUTER_BASE_URL");
  const key = env("NINEROUTER_API_KEY");
  if (!base || !key) {
    skipped(`ninerouter: set ${[!base && "NINEROUTER_BASE_URL", !key && "NINEROUTER_API_KEY"].filter(Boolean).join(", ")} to enable`);
    return false;
  }
  // No chat/completion call: read-only model listing only, so no credits.
  try {
    const models = await request(base, "/v1/models", {
      headers: { Authorization: `Bearer ${key}`, Accept: "application/json" }
    });
    const wanted = env("NINEROUTER_MODEL");
    const found = wanted && Array.isArray(models.body?.data)
      ? models.body.data.some((entry) => entry?.id === wanted)
      : null;
    live(`ninerouter GET /v1/models -> ${models.status} (${count(models.body)} models)`
      + (found === null ? "" : ` configured_model=${found ? "OK" : "MISMATCH"}`));
    if (found === false) failed("ninerouter: configured model is not advertised");
    return true;
  } catch (error) {
    failed(`ninerouter live call failed: ${error?.name ?? "error"}`);
    return true;
  }
}

const tasks = [];
if (PROVIDER === "all" || PROVIDER === "galaxy") tasks.push(["galaxy", smokeGalaxy]);
if (PROVIDER === "all" || PROVIDER === "smartsbio") tasks.push(["smartsbio", smokeSmartsbio]);
if (PROVIDER === "all" || PROVIDER === "ninerouter") tasks.push(["ninerouter", smokeNinerouter]);

let ranLive = false;
try {
  for (const [id, task] of tasks) {
    if (await task()) ranLive = true;
    else skipped(`${id}: unconfigured`);
  }
} finally {
  if (ONCE && ranLive) writeMarker();
}
