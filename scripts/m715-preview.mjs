// M7.15 isolated read-only preview server.
// Serves the redesigned static app and returns a GENUINE stored M7.14.3 result
// snapshot. It never proxies to production/staging, never submits any scientific
// job, never writes a database, and never exposes secrets. Bind to localhost.
//
//   node scripts/m715-preview.mjs [port=8734]
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const publicRoot = path.join(root, "web-platform", "public");
const snapshotPath = path.join(root, "docs", "preview", "m715-result-snapshot.json");
const result = JSON.parse(fs.readFileSync(snapshotPath, "utf8"));
const port = Number(process.argv[2] ?? process.env.PORT ?? 8734);
const types = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".svg": "image/svg+xml", ".json": "application/json", ".png": "image/png" };
const SEC_HEADERS = { "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer", "Cache-Control": "no-store" };

const server = http.createServer((req, res) => {
  const u = new URL(req.url, `http://localhost:${port}`);
  if (req.method !== "GET" && req.method !== "HEAD") { res.writeHead(405, SEC_HEADERS); res.end(); return; }
  if (u.pathname === "/api/ai/workflows/microbiome/result") { res.writeHead(200, { ...SEC_HEADERS, "Content-Type": "application/json" }); res.end(JSON.stringify(result)); return; }
  if (u.pathname === "/api/ai/workflows/microbiome/status") { res.writeHead(200, { ...SEC_HEADERS, "Content-Type": "application/json" }); res.end(JSON.stringify({ workflow_type: "microbiome", run_id: result.run_id, status: "succeeded", current_step: null, steps: [], terminal: true, result_url: `/api/ai/workflows/microbiome/result?run_id=${encodeURIComponent(result.run_id)}`, preview: true, read_only: true })); return; }
  if (u.pathname.startsWith("/api/ai/runs/")) { res.writeHead(200, { ...SEC_HEADERS, "Content-Type": "application/json" }); res.end("{}"); return; }
  if (u.pathname.startsWith("/api/")) { res.writeHead(404, { ...SEC_HEADERS, "Content-Type": "application/json" }); res.end(JSON.stringify({ error: "not available in isolated read-only preview" })); return; }
  let p = path.resolve(path.join(publicRoot, decodeURIComponent(u.pathname)));
  if (u.pathname === "/" ) p = path.join(publicRoot, "index.html");
  if (p !== publicRoot && !p.startsWith(publicRoot + path.sep)) { res.writeHead(403, SEC_HEADERS); res.end(); return; }
  fs.readFile(p, (err, data) => { if (err) { res.writeHead(404, SEC_HEADERS); res.end("not found"); return; } res.writeHead(200, { ...SEC_HEADERS, "Content-Type": types[path.extname(p)] ?? "application/octet-stream" }); res.end(data); });
});
server.listen(port, "127.0.0.1", () => console.log(`M7.15 read-only preview ready on http://127.0.0.1:${port}`));
