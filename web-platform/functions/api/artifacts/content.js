// GET /api/artifacts/content?ticket=... — streamed download from private R2.

import { errorResponse, requireMethod, getStore } from "./_lib.js";

export async function onRequest(context) {
  const denied = requireMethod(context.request, "GET", "GET");
  if (denied) return denied;
  const { env, request } = context;
  const store = getStore(env);
  if (store.error) return errorResponse(store.error, 503, request);
  const ticket = await store.verify(new URL(request.url).searchParams.get("ticket"), "download");
  if (!ticket) return errorResponse("Invalid or expired download ticket.", 403, request);

  const object = await store.getObject(ticket.object_key);
  if (!object) return errorResponse("Artifact not found.", 404, request);
  const headers = new Headers({
    "Content-Type": ticket.mime || object.httpMetadata?.contentType || "application/octet-stream",
    "Content-Disposition": `attachment; filename="${String(ticket.filename).replace(/["\r\n]/g, "_")}"`,
    "Content-Security-Policy": "default-src 'none'",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "Cache-Control": "no-store, private",
    "X-Artifact-SHA256": object.customMetadata?.sha256 ?? ""
  });
  if (Number.isFinite(object.size)) headers.set("Content-Length", String(object.size));
  return new Response(object.body, { status: 200, headers });
}
