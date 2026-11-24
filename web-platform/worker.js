// Standalone Cloudflare Worker entrypoint.
//
// The control plane is a Worker, not a Pages project. The existing
// functions/api/** modules keep their Pages-Functions-shaped `onRequest`
// handlers; this file is the only routing layer that adapts a Worker Request
// to that context. Non-API requests are delegated to the static-assets binding.

import { onRequest as onTools } from "./functions/api/tools.js";
import { onRequest as onAiRequests } from "./functions/api/ai/requests/index.js";
import { onRequest as onAiBackend } from "./functions/api/ai/backend.js";
import { onRequest as onAiJobs } from "./functions/api/ai/jobs/index.js";
import { onRequest as onAiJobResult } from "./functions/api/ai/jobs/[id]/result.js";
import { onRequest as onAiPlan } from "./functions/api/ai/plans/[id]/index.js";
import { onRequest as onAiPlanApprove } from "./functions/api/ai/plans/[id]/approve.js";
import { onRequest as onAiRun } from "./functions/api/ai/runs/[id]/index.js";
import { onRequest as onAiRunProvenance } from "./functions/api/ai/runs/[id]/provenance.js";
import { onRequest as onAiRunReport } from "./functions/api/ai/runs/[id]/report.js";
import { onRequest as onBlastSubmit } from "./functions/api/blast/submit.js";
import { onRequest as onBlastStatus } from "./functions/api/blast/status/[rid].js";
import { onRequest as onBlastResults } from "./functions/api/blast/results/[rid].js";
import { onRequest as onBlastHistory } from "./functions/api/blast/history.js";
import { errorResponse } from "./functions/api/ai/_lib.js";

// Stable keys let unit tests inject stubbed handlers without changing the
// production routing table. The default map is the real onRequest handlers.
export const handlers = {
  tools: onTools,
  aiRequests: onAiRequests,
  aiBackend: onAiBackend,
  aiJobs: onAiJobs,
  aiJobResult: onAiJobResult,
  aiPlan: onAiPlan,
  aiPlanApprove: onAiPlanApprove,
  aiRun: onAiRun,
  aiRunProvenance: onAiRunProvenance,
  aiRunReport: onAiRunReport,
  blastSubmit: onBlastSubmit,
  blastStatus: onBlastStatus,
  blastResults: onBlastResults,
  blastHistory: onBlastHistory
};

// Order is explicit. Static and dynamic patterns do not overlap, but the more
// specific dynamic routes are listed first so future additions stay unambiguous.
// `names` maps capture groups to the `params` object the handlers expect.
const ROUTES = [
  { key: "aiJobResult", re: /^\/api\/ai\/jobs\/([^/]+)\/result\/?$/, names: ["id"] },
  { key: "aiPlanApprove", re: /^\/api\/ai\/plans\/([^/]+)\/approve\/?$/, names: ["id"] },
  { key: "aiRunProvenance", re: /^\/api\/ai\/runs\/([^/]+)\/provenance\/?$/, names: ["id"] },
  { key: "aiRunReport", re: /^\/api\/ai\/runs\/([^/]+)\/report\/?$/, names: ["id"] },
  { key: "blastStatus", re: /^\/api\/blast\/status\/([^/]+)\/?$/, names: ["rid"] },
  { key: "blastResults", re: /^\/api\/blast\/results\/([^/]+)\/?$/, names: ["rid"] },
  { key: "aiPlan", re: /^\/api\/ai\/plans\/([^/]+)\/?$/, names: ["id"] },
  { key: "aiRun", re: /^\/api\/ai\/runs\/([^/]+)\/?$/, names: ["id"] },
  { key: "tools", re: /^\/api\/tools\/?$/, names: [] },
  { key: "aiRequests", re: /^\/api\/ai\/requests\/?$/, names: [] },
  { key: "aiBackend", re: /^\/api\/ai\/backend\/?$/, names: [] },
  { key: "aiJobs", re: /^\/api\/ai\/jobs\/?$/, names: [] },
  { key: "blastSubmit", re: /^\/api\/blast\/submit\/?$/, names: [] },
  { key: "blastHistory", re: /^\/api\/blast\/history\/?$/, names: [] }
];

const ASSET_UNAVAILABLE_HEADERS = {
  "Content-Security-Policy": "default-src 'none'",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "Cache-Control": "no-store",
  "Content-Type": "text/plain; charset=utf-8"
};

function makeContext(request, env, params) {
  return {
    request,
    env,
    params,
    // Pages' next() falls through to another function or a static asset. There
    // is no next function here, and an API path must never fall through to a
    // static HTML file, so this fails closed instead of silently passing through.
    next: () => Promise.resolve(errorResponse("API route not found.", 404, request))
  };
}

function buildParams(match, names) {
  const params = {};
  for (let index = 0; index < names.length; index += 1) {
    const raw = match[index + 1] ?? "";
    try {
      params[names[index]] = decodeURIComponent(raw);
    } catch {
      return null;
    }
  }
  return params;
}

async function serveAsset(request, env) {
  const assets = env?.ASSETS;
  if (!assets || typeof assets.fetch !== "function") {
    return new Response("Static assets are unavailable.", {
      status: 503,
      headers: ASSET_UNAVAILABLE_HEADERS
    });
  }
  // Hand the original request to the Workers assets binding so static paths,
  // legacy pages, JS/CSS and their _headers security policy are served as-is.
  // A binding fault must still fail closed with our own security headers.
  try {
    return await assets.fetch(request);
  } catch {
    return new Response("Static assets are unavailable.", {
      status: 503,
      headers: ASSET_UNAVAILABLE_HEADERS
    });
  }
}

/**
 * Build the Worker `fetch` handler.
 * @param {Record<string, (context: object) => Response | Promise<Response>>} handlerMap
 */
export function createFetch(handlerMap = handlers) {
  const routes = ROUTES.map((route) => ({ ...route, handler: handlerMap[route.key] }));

  return async function workerFetch(request, env, _ctx) {
    let pathname;
    try {
      pathname = new URL(request.url).pathname;
    } catch {
      return errorResponse("Invalid request URL.", 400, request);
    }

    if (pathname !== "/api" && !pathname.startsWith("/api/")) {
      return serveAsset(request, env);
    }

    for (const route of routes) {
      const match = route.re.exec(pathname);
      if (!match) continue;
      const params = buildParams(match, route.names);
      if (params === null) {
        return errorResponse("Invalid URL parameter encoding.", 400, request);
      }
      if (typeof route.handler !== "function") {
        return errorResponse("API handler is unavailable.", 503, request);
      }
      let response;
      try {
        response = await route.handler(makeContext(request, env, params));
      } catch {
        return errorResponse("API handler failed.", 500, request);
      }
      // Handler responses are returned untouched: their CSP/nosniff headers
      // are part of the security contract and must not be replaced here.
      return response instanceof Response
        ? response
        : errorResponse("API handler did not return a response.", 500, request);
    }

    // Unknown API paths fail closed. Never hand an /api/** request to assets.
    return errorResponse("API route not found.", 404, request);
  };
}

export const fetch = createFetch();

export default { fetch };
