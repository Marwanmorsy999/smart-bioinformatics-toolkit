#!/usr/bin/env node
// OPT-IN live verification of the VERIFIED Galaxy POST /api/tools/fetch upload
// contract. This script is never run by the test suite and writes NO files.
//
// Every value comes from the environment:
//   GALAXY_BASE_URL   (required)  e.g. https://usegalaxy.eu
//   GALAXY_API_KEY    (required)  secret; never printed, logged or written
//   GALAXY_UPLOAD_TESTS=1 (required) explicit write consent
//   GALAXY_WORKSPACE  (optional)  non-secret label used in history names
//   GALAXY_HISTORY / GALAXY_HISTORY_ID (optional) read-only preflight reference
//
// With missing config or no consent the script prints [SKIPPED] and makes no
// network call. With config it creates a dedicated history per test (A: pasted
// text, B: FASTA file), uploads through /api/tools/fetch, resolves the dataset
// by exact filename, checks history membership, retrieves bytes and compares
// their SHA-256 with the original input. Output is [LIVE]/[SKIPPED] and all
// strings pass through scrub(): the API key and secret-bearing query values
// are never printed. A failed check sets exit code 1; no success is implied.

import { createHash } from "node:crypto";
import { joinUrl } from "../../web-platform/providers/common/normalize.js";

const REDACT_NAMES = [
  "GALAXY_API_KEY", "SMARTSBIO_API_KEY", "NINEROUTER_API_KEY", "ARTIFACT_SIGNING_KEY"
];
const TIMEOUT_MS = (() => {
  const raw = Number(process.env.GALAXY_UPLOAD_TIMEOUT_MS);
  return Number.isFinite(raw) && raw > 0 ? Math.min(raw, 120_000) : 15_000;
})();
const POLL_ATTEMPTS = 10;
const POLL_INTERVAL_MS = 600;

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
function failed(message) { console.error(`[LIVE] FAIL ${scrub(message)}`); process.exitCode = 1; }

async function sleep(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function request(base, path, { method = "GET", headers = {}, body, rawText = false } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(joinUrl(base, path), { method, headers, body, signal: controller.signal });
    const text = await response.text();
    let parsed = text;
    if (text && !rawText) {
      try { parsed = JSON.parse(text); } catch { /* non-JSON body: keep raw text */ }
    }
    return { ok: response.ok, status: response.status, body: parsed };
  } finally {
    clearTimeout(timer);
  }
}

function errorMessage(body, status) {
  const source = body && typeof body === "object" ? body : {};
  const rawCode = source.error ?? source.code ?? source.error_code ?? source.detail?.code;
  const code = typeof rawCode === "string" && rawCode.length <= 120 ? rawCode : `http_${status}`;
  const detail = typeof source.message === "string" ? source.message
    : typeof source.detail === "string" ? source.detail : "";
  return scrub(detail ? `${code}: ${detail.slice(0, 160)}` : code);
}

function sha256(text) {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function safeLabel(value) {
  return String(value ?? "").replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 40) || "default";
}

async function createHistory(base, headers, name) {
  const created = await request(base, "/api/histories", {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({ name })
  });
  live(`POST /api/histories -> ${created.status}`);
  if (!created.ok) throw new Error(`history creation failed: ${errorMessage(created.body, created.status)}`);
  const id = created.body?.id;
  if (typeof id !== "string" || !id) throw new Error("history creation returned no id");
  return id;
}

async function submitFetch(base, headers, historyId, target) {
  const form = new FormData();
  form.append("history_id", historyId);
  form.append("targets", JSON.stringify([{
    destination: { type: "hdas" },
    elements: [target.element]
  }]));
  if (target.part) form.append("files", target.part);
  // No Content-Type header: fetch supplies multipart/form-data + boundary.
  const submitted = await request(base, "/api/tools/fetch", { method: "POST", headers, body: form });
  live(`POST /api/tools/fetch -> ${submitted.status}`);
  if (!submitted.ok) throw new Error(`upload failed: ${errorMessage(submitted.body, submitted.status)}`);
  return submitted;
}

async function resolveDataset(base, headers, historyId, filename) {
  const path = `/api/histories/${encodeURIComponent(historyId)}/contents`;
  let lastStatus = 0;
  for (let attempt = 1; attempt <= POLL_ATTEMPTS; attempt += 1) {
    const listed = await request(base, path, { headers });
    lastStatus = listed.status;
    const items = Array.isArray(listed.body) ? listed.body : [];
    const match = items.find((item) => item && item.name === filename && item.deleted !== true);
    if (match?.id) {
      live(`GET /api/histories/{id}/contents -> ${listed.status} (exact filename match: ${match.state || "unknown"})`);
      return match;
    }
    if (attempt < POLL_ATTEMPTS) await sleep(POLL_INTERVAL_MS);
  }
  throw new Error(`dataset "${filename}" not found after ${POLL_ATTEMPTS} attempts (last status ${lastStatus})`);
}

async function verifyMembership(base, headers, historyId, datasetId) {
  const inspected = await request(base, `/api/datasets/${encodeURIComponent(datasetId)}`, { headers });
  live(`GET /api/datasets/{id} -> ${inspected.status}`);
  if (!inspected.ok) throw new Error(`dataset lookup failed: ${errorMessage(inspected.body, inspected.status)}`);
  const actual = inspected.body?.history_id;
  if (actual !== historyId) {
    throw new Error(`history membership MISMATCH (expected ${historyId}, got ${String(actual).slice(0, 80)})`);
  }
  live("history membership: OK");
}

async function verifyBytes(base, headers, datasetId, original) {
  const fetched = await request(base, `/api/datasets/${encodeURIComponent(datasetId)}/content`, {
    headers, rawText: true
  });
  live(`GET /api/datasets/{id}/content -> ${fetched.status}`);
  if (!fetched.ok) throw new Error(`content fetch failed: ${errorMessage(fetched.body, fetched.status)}`);
  const actualHash = sha256(String(fetched.body));
  const expectedHash = sha256(original);
  live(`SHA-256 comparison: ${actualHash === expectedHash ? "OK" : "MISMATCH"}`);
  if (actualHash !== expectedHash) {
    live(`SHA-256 expected=${expectedHash} actual=${actualHash}`);
    throw new Error("download bytes differ from the uploaded input");
  }
}

async function runTest(base, headers, options) {
  live(`${options.label} starting (${options.description})`);
  let historyId = null;
  try {
    historyId = await createHistory(base, headers, options.historyName);
    await submitFetch(base, headers, historyId, options.target);
    const dataset = await resolveDataset(base, headers, historyId, options.filename);
    await verifyMembership(base, headers, historyId, dataset.id);
    await verifyBytes(base, headers, dataset.id, options.content);
    live(`${options.label} complete: OK`);
  } catch (error) {
    const reason = scrub(error?.message ?? String(error));
    if (historyId) live(`${options.label} history_id=${historyId}`);
    failed(`${options.label} did not pass: ${reason}`);
  }
}

const base = env("GALAXY_BASE_URL");
const key = env("GALAXY_API_KEY");
const missing = [!base && "GALAXY_BASE_URL", !key && "GALAXY_API_KEY"].filter(Boolean);
if (missing.length) {
  skipped(`set ${missing.join(", ")} to enable live upload verification; no network call made`);
} else if (env("GALAXY_UPLOAD_TESTS") !== "1") {
  skipped("set GALAXY_UPLOAD_TESTS=1 to explicitly allow live write tests; no network call made");
} else {
  const headers = { "X-API-Key": key, Accept: "application/json" };
  const workspace = safeLabel(env("GALAXY_WORKSPACE"));
  const stamp = Date.now();
  const reference = env("GALAXY_HISTORY") || env("GALAXY_HISTORY_ID");
  live("live upload verification enabled (credentials are never printed)");

  if (reference) {
    try {
      const preflight = await request(base, `/api/histories/${encodeURIComponent(reference)}`, { headers });
      live(`optional history preflight GET /api/histories/{id} -> ${preflight.status}`);
    } catch (error) {
      failed(`optional history preflight failed: ${error?.name ?? "error"}`);
    }
  }

  const pastedText = ">live-smoke-pasted\nACGTACGT\n";
  const pastedName = "galaxy-upload-live-pasted.txt";
  const fastaText = ">live-smoke-file\nACGTACGTACGT\n";
  const fastaName = "galaxy-upload-live-file.fasta";

  await runTest(base, headers, {
    label: "Test A (pasted text)",
    description: "src=pasted into a dedicated history",
    historyName: `galaxy-upload-live-${workspace}-a-${stamp}`,
    filename: pastedName,
    content: pastedText,
    target: {
      element: { src: "pasted", paste_content: pastedText, name: pastedName, ext: "txt", to_posix_lines: false },
      part: null
    }
  });

  await runTest(base, headers, {
    label: "Test B (FASTA file)",
    description: "src=files plus a files multipart part into a dedicated history",
    historyName: `galaxy-upload-live-${workspace}-b-${stamp}`,
    filename: fastaName,
    content: fastaText,
    target: {
      element: { src: "files", name: fastaName, ext: "fasta" },
      part: new File([fastaText], fastaName, { type: "text/plain" })
    }
  });
}
