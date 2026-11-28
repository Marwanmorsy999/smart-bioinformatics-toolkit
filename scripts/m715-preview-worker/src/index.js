// M7.15 remote isolated read-only preview worker.
// Serves the exact committed static app + a genuine M7.14.3 snapshot.
// No D1, no R2, no provider secrets, no Galaxy/production/staging calls, no
// scientific jobs, no writes. Any non-GET/HEAD is rejected.

const SEC = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "Cache-Control": "no-store",
  "Content-Security-Policy": "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; object-src 'none'; frame-ancestors 'none'",
  "X-Preview-Isolated": "true",
  "X-Preview-Read-Only": "true"
};

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...SEC, "Content-Type": "application/json; charset=utf-8" } });
}

function withSec(response, status, contentType) {
  const headers = new Headers(SEC);
  if (contentType) headers.set("Content-Type", contentType);
  const len = response.headers.get("Content-Length"); if (len) headers.set("Content-Length", len);
  return new Response(response.body, { status, headers });
}

async function previewAsset(env, request, path, status = 200) {
  const assetReq = new Request(new URL(path, request.url), { method: "GET" });
  const r = await env.ASSETS.fetch(assetReq);
  return withSec(r, status, r.headers.get("Content-Type") ?? undefined);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method !== "GET" && request.method !== "HEAD") {
      return json({ error: "isolated read-only preview: only GET/HEAD allowed" }, 405);
    }
    const path = url.pathname;
    if (path === "/api/ai/workflows/microbiome/result") return previewAsset(env, request, "/preview/m715-result-snapshot.json");
    if (path === "/api/ai/workflows/microbiome/status") {
      const r = await env.ASSETS.fetch(new Request(new URL("/preview/m715-result-snapshot.json", url), { method: "GET" }));
      const snap = await r.json();
      return json({ workflow_type: "microbiome", run_id: snap.run_id ?? "job_a8817e35d7534d98", status: "succeeded", current_step: null, steps: [], terminal: true, preview: true, read_only: true, result_url: "/api/ai/workflows/microbiome/result?run_id=job_a8817e35d7534d98" });
    }
    if (path.startsWith("/api/ai/runs/") && path.endsWith("/recovery")) return previewAsset(env, request, "/preview/m715-recovery-snapshot.json");
    if (path.startsWith("/api/ai/runs/")) return json({ read_only: true, preview: true });
    if (path.startsWith("/api/")) return json({ error: "not available in isolated read-only preview" }, 404);
    // Static app (exact committed public/ directory). SPA fallback to index.html for extensionless routes.
    const assetPath = path === "/" ? "/index.html" : path;
    const r = await env.ASSETS.fetch(new Request(new URL(assetPath, url), { method: "GET" }));
    if (r.status === 404 && !/\.[a-z0-9]+$/i.test(assetPath)) {
      const idx = await env.ASSETS.fetch(new Request(new URL("/index.html", url), { method: "GET" }));
      return withSec(idx, 200, "text/html; charset=utf-8");
    }
    return withSec(r, r.status, r.headers.get("Content-Type") ?? undefined);
  }
};
