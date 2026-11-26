// Standalone Cloudflare Worker entrypoint.
//
// The control plane is a Worker, not a Pages project. The existing
// functions/api/** modules keep their Pages-Functions-shaped `onRequest`
// handlers; this file is the only routing layer that adapts a Worker Request
// to that context. Non-API requests are delegated to the static-assets binding.

import { onRequest as onTools } from "./functions/api/tools.js";
import { onRequest as onAiRequests } from "./functions/api/ai/requests/index.js";
import { onRequest as onWorkspace } from "./functions/api/workspace/index.js";
import { onRequest as onAiBackend } from "./functions/api/ai/backend.js";
import { onRequest as onAiJobs } from "./functions/api/ai/jobs/index.js";
import { onRequest as onAiJobResult } from "./functions/api/ai/jobs/[id]/result.js";
import { onRequest as onPhyloRun } from "./functions/api/ai/workflows/phylo/run.js";
import { onRequest as onPhyloStatus } from "./functions/api/ai/workflows/phylo/status.js";
import { onRequest as onPhyloTool } from "./functions/api/ai/workflows/phylo/tool.js";
import { onRequest as onAiJobReport } from "./functions/api/ai/jobs/[id]/report.js";
import { onRequest as onAiPlan } from "./functions/api/ai/plans/[id]/index.js";
import { onRequest as onAiPlanApprove } from "./functions/api/ai/plans/[id]/approve.js";
import { onRequest as onAiRun } from "./functions/api/ai/runs/[id]/index.js";
import { onRequest as onAiRunProvenance } from "./functions/api/ai/runs/[id]/provenance.js";
import { onRequest as onAiRunReport } from "./functions/api/ai/runs/[id]/report.js";
import { onRequest as onBlastSubmit } from "./functions/api/blast/submit.js";
import { onRequest as onBlastStatus } from "./functions/api/blast/status/[rid].js";
import { onRequest as onBlastResults } from "./functions/api/blast/results/[rid].js";
import { onRequest as onBlastHistory } from "./functions/api/blast/history.js";
import { onRequest as onProviders } from "./functions/api/providers/index.js";
import { onRequest as onProviderDetail } from "./functions/api/providers/[id]/index.js";
import { onRequest as onProviderCapabilities } from "./functions/api/providers/[id]/capabilities.js";
import { onRequest as onProviderLimits } from "./functions/api/providers/[id]/limits.js";
import { onRequest as onProviderUsage } from "./functions/api/providers/usage.js";
import { onRequest as onProviderChat } from "./functions/api/providers/chat.js";
import { onRequest as onProviderPlan } from "./functions/api/providers/plan.js";
import { onRequest as onProviderConsent } from "./functions/api/providers/consent.js";
import { onRequest as onProviderTransfers } from "./functions/api/providers/transfers.js";
import { onRequest as onProviderEmergencyStop } from "./functions/api/providers/emergency-stop.js";
import { onRequest as onProviderBudget } from "./functions/api/providers/budget.js";
import { onRequest as onProviderJobs } from "./functions/api/providers/jobs/index.js";
import { onRequest as onProviderJob } from "./functions/api/providers/jobs/[id]/index.js";
import { onRequest as onProviderJobCancel } from "./functions/api/providers/jobs/[id]/cancel.js";
import { onRequest as onProviderJobArtifacts } from "./functions/api/providers/jobs/[id]/artifacts.js";
import { onRequest as onGalaxyUpload } from "./functions/api/providers/galaxy-artifacts/upload.js";
import { onRequest as onGalaxyDatasetMetadata } from "./functions/api/providers/galaxy-artifacts/datasets/[id]/metadata.js";
import { onRequest as onGalaxyDatasetDownload } from "./functions/api/providers/galaxy-artifacts/datasets/[id]/download.js";
import { onRequest as onGalaxyArtifacts } from "./functions/api/providers/galaxy-artifacts/artifacts.js";
import { onRequest as onArtifactUploadUrl } from "./functions/api/artifacts/upload-url.js";
import { onRequest as onArtifactUpload } from "./functions/api/artifacts/upload.js";
import { onRequest as onArtifactDownloadUrl } from "./functions/api/artifacts/[id]/download-url.js";
import { onRequest as onArtifactContent } from "./functions/api/artifacts/content.js";
import { onRequest as onArtifactDelete } from "./functions/api/artifacts/delete.js";
import { onRequest as onWorkspaceProjects } from "./functions/api/workspace/projects/index.js";
import { onRequest as onWorkspaceProject } from "./functions/api/workspace/projects/[id]/index.js";
import { onRequest as onWorkspaceProjectArchive } from "./functions/api/workspace/projects/[id]/archive.js";
import { onRequest as onWorkspaceProjectActivate } from "./functions/api/workspace/projects/[id]/activate.js";
import { onRequest as onWorkspaceProjectDatasets } from "./functions/api/workspace/projects/[id]/datasets.js";
import { onRequest as onWorkspaceProjectRuns } from "./functions/api/workspace/projects/[id]/runs.js";
import { onRequest as onWorkspaceWorkflows } from "./functions/api/workspace/workflows.js";
import { onRequest as onWorkspaceRun } from "./functions/api/workspace/runs/[id]/index.js";
import { onRequest as onWorkspaceRunProvenance } from "./functions/api/workspace/runs/[id]/provenance.js";
import { onRequest as onWorkspaceRunReport } from "./functions/api/workspace/runs/[id]/report.js";
import { onRequest as onWorkspaceDemo } from "./functions/api/workspace/demo.js";
import { onStatus as onAssistantStatus, onChat as onAssistantChat } from "./functions/api/assistant/index.js";
import { errorResponse } from "./functions/api/ai/_lib.js";

// Stable keys let unit tests inject stubbed handlers without changing the
// production routing table. The default map is the real onRequest handlers.
export const handlers = {
  tools: onTools,
  aiRequests: onAiRequests,
  workspace: onWorkspace,
  aiBackend: onAiBackend,
  aiJobs: onAiJobs,
  aiJobResult: onAiJobResult,
  phyloRun: onPhyloRun,
  phyloStatus: onPhyloStatus,
  phyloTool: onPhyloTool,
  aiJobReport: onAiJobReport,
  aiPlan: onAiPlan,
  aiPlanApprove: onAiPlanApprove,
  aiRun: onAiRun,
  aiRunProvenance: onAiRunProvenance,
  aiRunReport: onAiRunReport,
  blastSubmit: onBlastSubmit,
  blastStatus: onBlastStatus,
  blastResults: onBlastResults,
  blastHistory: onBlastHistory,
  providers: onProviders,
  providerDetail: onProviderDetail,
  providerCapabilities: onProviderCapabilities,
  providerLimits: onProviderLimits,
  providerUsage: onProviderUsage,
  providerChat: onProviderChat,
  providerPlan: onProviderPlan,
  providerConsent: onProviderConsent,
  providerTransfers: onProviderTransfers,
  providerEmergencyStop: onProviderEmergencyStop,
  providerBudget: onProviderBudget,
  providerJobs: onProviderJobs,
  providerJob: onProviderJob,
  providerJobCancel: onProviderJobCancel,
  providerJobArtifacts: onProviderJobArtifacts,
  galaxyUpload: onGalaxyUpload,
  galaxyDatasetMetadata: onGalaxyDatasetMetadata,
  galaxyDatasetDownload: onGalaxyDatasetDownload,
  galaxyArtifacts: onGalaxyArtifacts,
  artifactUploadUrl: onArtifactUploadUrl,
  artifactUpload: onArtifactUpload,
  artifactDownloadUrl: onArtifactDownloadUrl,
  artifactContent: onArtifactContent,
  artifactDelete: onArtifactDelete,
  workspaceProjects: onWorkspaceProjects,
  workspaceProject: onWorkspaceProject,
  workspaceProjectArchive: onWorkspaceProjectArchive,
  workspaceProjectActivate: onWorkspaceProjectActivate,
  workspaceProjectDatasets: onWorkspaceProjectDatasets,
  workspaceProjectRuns: onWorkspaceProjectRuns,
  workspaceWorkflows: onWorkspaceWorkflows,
  workspaceRun: onWorkspaceRun,
  workspaceRunProvenance: onWorkspaceRunProvenance,
  workspaceRunReport: onWorkspaceRunReport,
  workspaceDemo: onWorkspaceDemo,
  assistantStatus: onAssistantStatus,
  assistantChat: onAssistantChat
};

// Order is explicit. Static and dynamic patterns do not overlap, but the more
// specific dynamic routes are listed first so future additions stay unambiguous.
// `names` maps capture groups to the `params` object the handlers expect.
const ROUTES = [
  // S Bio Assistant gateway. Explicit static routes before every catch-all so
  // an /api/assistant/** path can never fall through to a static HTML page.
  { key: "assistantStatus", re: /^\/api\/assistant\/status\/?$/, names: [] },
  { key: "assistantChat", re: /^\/api\/assistant\/chat\/?$/, names: [] },
  // M7.4 batch-1 workspace routes. Specific sub-paths precede the dynamic
  // /:id routes so "archive", "datasets", "runs" and "report" can never be
  // captured as an id. These are listed before the legacy catch-all below.
  { key: "workspaceProjectArchive", re: /^\/api\/workspace\/projects\/([^/]+)\/archive\/?$/, names: ["id"] },
  { key: "workspaceProjectActivate", re: /^\/api\/workspace\/projects\/([^/]+)\/activate\/?$/, names: ["id"] },
  { key: "workspaceProjectDatasets", re: /^\/api\/workspace\/projects\/([^/]+)\/datasets\/?$/, names: ["id"] },
  { key: "workspaceProjectRuns", re: /^\/api\/workspace\/projects\/([^/]+)\/runs\/?$/, names: ["id"] },
  { key: "workspaceProject", re: /^\/api\/workspace\/projects\/([^/]+)\/?$/, names: ["id"] },
  { key: "workspaceProjects", re: /^\/api\/workspace\/projects\/?$/, names: [] },
  { key: "workspaceRunProvenance", re: /^\/api\/workspace\/runs\/([^/]+)\/provenance\/?$/, names: ["id"] },
  { key: "workspaceRunReport", re: /^\/api\/workspace\/runs\/([^/]+)\/report\/?$/, names: ["id"] },
  { key: "workspaceRun", re: /^\/api\/workspace\/runs\/([^/]+)\/?$/, names: ["id"] },
  { key: "workspaceWorkflows", re: /^\/api\/workspace\/workflows\/?$/, names: [] },
  { key: "workspaceDemo", re: /^\/api\/workspace\/demo\/?$/, names: [] },
  { key: "workspace", re: /^\/api\/workspace(?:\/.*)?$/, names: [] },
  // Galaxy artifact routes. These static/specific paths MUST precede the
  // dynamic /api/providers/:id routes so "galaxy" is never captured as a
  // provider id and the dataset sub-paths stay unambiguous.
  { key: "galaxyDatasetMetadata", re: /^\/api\/providers\/galaxy\/datasets\/([^/]+)\/metadata\/?$/, names: ["id"] },
  { key: "galaxyDatasetDownload", re: /^\/api\/providers\/galaxy\/datasets\/([^/]+)\/download\/?$/, names: ["id"] },
  { key: "galaxyUpload", re: /^\/api\/providers\/galaxy\/upload\/?$/, names: [] },
  { key: "galaxyArtifacts", re: /^\/api\/providers\/galaxy\/artifacts\/?$/, names: [] },

  // M7 provider routes. Static paths precede dynamic /api/providers/:id so a
  // name like "usage" can never be captured as a provider id.
  { key: "providerJobCancel", re: /^\/api\/providers\/jobs\/([^/]+)\/cancel\/?$/, names: ["id"] },
  { key: "providerJobArtifacts", re: /^\/api\/providers\/jobs\/([^/]+)\/artifacts\/?$/, names: ["id"] },
  { key: "providerJob", re: /^\/api\/providers\/jobs\/([^/]+)\/?$/, names: ["id"] },
  { key: "providerCapabilities", re: /^\/api\/providers\/([^/]+)\/capabilities\/?$/, names: ["id"] },
  { key: "providerLimits", re: /^\/api\/providers\/([^/]+)\/limits\/?$/, names: ["id"] },
  { key: "providerUsage", re: /^\/api\/providers\/usage\/?$/, names: [] },
  { key: "providerEmergencyStop", re: /^\/api\/providers\/emergency-stop\/?$/, names: [] },
  { key: "providerBudget", re: /^\/api\/providers\/budget\/?$/, names: [] },
  { key: "providerChat", re: /^\/api\/providers\/chat\/?$/, names: [] },
  { key: "providerPlan", re: /^\/api\/providers\/plan\/?$/, names: [] },
  { key: "providerConsent", re: /^\/api\/providers\/consent\/?$/, names: [] },
  { key: "providerTransfers", re: /^\/api\/providers\/transfers\/?$/, names: [] },
  { key: "providerJobs", re: /^\/api\/providers\/jobs\/?$/, names: [] },
  { key: "artifactUploadUrl", re: /^\/api\/artifacts\/upload-url\/?$/, names: [] },
  { key: "artifactUpload", re: /^\/api\/artifacts\/upload\/?$/, names: [] },
  { key: "artifactContent", re: /^\/api\/artifacts\/content\/?$/, names: [] },
  { key: "artifactDelete", re: /^\/api\/artifacts\/delete\/?$/, names: [] },
  { key: "artifactDownloadUrl", re: /^\/api\/artifacts\/([^/]+)\/download-url\/?$/, names: ["id"] },
  { key: "providers", re: /^\/api\/providers\/?$/, names: [] },
  { key: "providerDetail", re: /^\/api\/providers\/([^/]+)\/?$/, names: ["id"] },
  { key: "aiJobReport", re: /^\/api\/ai\/jobs\/([^/]+)\/report\/?$/, names: ["id"] },
  { key: "phyloTool", re: /^\/api\/ai\/workflows\/phylo\/tool\/?$/, names: [] },
  { key: "phyloStatus", re: /^\/api\/ai\/workflows\/phylo\/status\/?$/, names: [] },
  { key: "phyloRun", re: /^\/api\/ai\/workflows\/phylo\/run\/?$/, names: [] },
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





