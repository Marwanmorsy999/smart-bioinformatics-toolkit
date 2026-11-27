// M7 bounded HTTP retry / timeout / SSE helpers for provider adapters.
//
// No secrets, no endpoints, no provider-specific formats live here. Every
// network call in an adapter goes through requestJson()/requestResponse() so
// that timeouts, bounded exponential backoff and normalized failures are
// uniform. Retry policy: 408, 429 and 5xx (plus network errors only when the
// request may safely be repeated). Nothing is retried forever.

import { sanitizeUpstreamExcerpt } from "./contract.js";

const RETRYABLE = new Set([408, 429]);

// TEMP diagnostics: labels, elapsed ms, counts and status codes only. Never log
// URLs, ids, keys, payloads or response bodies.
const JOB_DIAG = true;
function jobDiag(label, started, count = null, status = null) {
  if (!JOB_DIAG) return;
  const ms = Math.round((Date.now() - started) * 10) / 10;
  console.log("[job-diag]", label, `${ms}ms`,
    count === null ? "" : `count=${count}`, status === null ? "" : `status=${status}`);
}

export class ProviderHttpError extends Error {
  constructor({ status = 0, code = "network_error", message = "provider request failed",
    retryable = false, retryAfterMs = 0, upstream_excerpt = "", name = "ProviderHttpError" } = {}) {
    super(message);
    this.name = name;
    this.status = Number(status) || 0;
    this.code = String(code);
    this.retryable = Boolean(retryable);
    this.retryAfterMs = Math.max(0, Number(retryAfterMs) || 0);
    this.upstream_excerpt = String(upstream_excerpt).slice(0, 600);
  }
}

export function isRetryableStatus(status) {
  const code = Number(status) || 0;
  return RETRYABLE.has(code) || code >= 500;
}

function abortError(reason) {
  if (reason && reason.name === "AbortError") return reason;
  // A deadline abort carries a TimeoutError reason. Preserve that name so
  // callers can report provider_timeout honestly instead of a generic abort.
  if (reason && reason.name === "TimeoutError") {
    const error = new Error(reason.message || "provider request timed out");
    error.name = "TimeoutError";
    error.reason = reason;
    return error;
  }
  const error = new Error("provider request aborted");
  error.name = "AbortError";
  error.reason = reason ?? null;
  return error;
}

function timeoutError(message) {
  const error = new Error(message || "provider request timed out");
  error.name = "TimeoutError";
  return error;
}

// Combine a caller-supplied signal with a deadline. Returns {signal, cleanup};
// cleanup MUST be called in a finally block or a pending timer can keep a test
// runner / isolate alive after the call finishes.
export function withTimeout(parent, timeoutMs) {
  const controller = new AbortController();
  let timer = null;
  const onAbort = () => controller.abort(parent?.reason);
  if (parent?.aborted) controller.abort(parent.reason);
  else if (parent) parent.addEventListener("abort", onAbort, { once: true });
  const limit = Number(timeoutMs);
  if (Number.isFinite(limit) && limit > 0) {
    timer = setTimeout(() => controller.abort(timeoutError()), limit);
  }
  return {
    signal: controller.signal,
    cleanup() {
      if (timer !== null) clearTimeout(timer);
      if (parent) parent.removeEventListener("abort", onAbort);
    }
  };
}

// Abortable delay. Sleep is injectable so tests never wait on real backoff.
export function delay(ms, signal, sleepFn = null) {
  const wait = Math.max(0, Number(ms) || 0);
  if (typeof sleepFn === "function") {
    if (signal?.aborted) return Promise.reject(abortError(signal.reason));
    return Promise.resolve(sleepFn(wait, signal));
  }
  if (wait === 0) return signal?.aborted ? Promise.reject(abortError(signal.reason)) : Promise.resolve();
  return new Promise((resolve, reject) => {
    const onAbort = () => { clearTimeout(timer); reject(abortError(signal?.reason)); };
    if (signal?.aborted) { reject(abortError(signal.reason)); return; }
    const timer = setTimeout(() => { signal?.removeEventListener("abort", onAbort); resolve(); }, wait);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function retryAfterMs(response) {
  const raw = response?.headers?.get?.("Retry-After");
  if (!raw) return 0;
  const seconds = Number(raw);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1000, 10_000);
  const at = Date.parse(raw);
  if (Number.isFinite(at)) return Math.min(Math.max(0, at - Date.now()), 10_000);
  return 0;
}

// Extract a bounded *code* plus a bounded, redacted excerpt. Raw provider
// bodies are never surfaced; normalizeProviderError() is the only outward seam.
async function errorDetailsFrom(response, env = {}) {
  let body = null;
  const jsonStarted = Date.now();
  try { body = await response.clone().json(); }
  catch {
    jobDiag("errorDetailsFrom.json", jsonStarted);
    const textStarted = Date.now();
    try { body = await response.clone().text(); } catch { /* unavailable */ }
    jobDiag("errorDetailsFrom.text", textStarted);
  }
  if (body !== null) jobDiag("errorDetailsFrom.json", jsonStarted);
  let code = null;
  if (body && typeof body === "object") {
    const candidate = body.error ?? body.code ?? body.error_code ?? body.detail?.code;
    if (typeof candidate === "string" && candidate.length <= 120) code = candidate;
    else if (candidate && typeof candidate === "object" && typeof candidate.code === "string") code = candidate.code;
  }
  return { code, excerpt: sanitizeUpstreamExcerpt(body, env, 600) };
}

function defaultFetch() {
  const impl = globalThis.fetch;
  if (typeof impl !== "function") throw new Error("No fetch implementation available.");
  return impl.bind(globalThis);
}

/**
 * Perform one logical HTTP request with bounded retries.
 * Returns { response, cleanup, attempts }. For `parse: "stream"` the caller
 * owns response.body and MUST call cleanup() when the stream is finished.
 */
export async function requestResponse(provider, fetchImpl, url, options = {}, opts = {}) {
  const fetcher = typeof fetchImpl === "function" ? fetchImpl : defaultFetch();
  const timeoutMs = Number(opts.timeoutMs) > 0 ? Number(opts.timeoutMs) : 20_000;
  const attempts = Math.max(1, Math.min(Number(opts.attempts) || 3, 5));
  const baseDelay = Math.max(0, Number(opts.baseDelayMs) || 200);
  const maxDelay = Math.max(baseDelay, Number(opts.maxDelayMs) || 2_000);
  const sleepFn = opts.sleep ?? null;
  const parentSignal = opts.signal ?? options.signal ?? null;
  const timer = withTimeout(parentSignal, timeoutMs);
  let handedOff = false;
  let lastError = null;
  const loopStarted = Date.now();
  let attemptCount = 0;
  try {
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      attemptCount = attempt;
      let error = null;
      try {
        const fetchStarted = Date.now();
        const response = await fetcher(url, { ...options, signal: timer.signal });
        jobDiag("fetch", fetchStarted, null, response?.status ?? null);
        if (response?.ok) {
          handedOff = true;
          return { response, cleanup: () => timer.cleanup(), attempts: attempt };
        }
        const status = Number(response?.status) || 0;
        const detailsStarted = Date.now();
        const details = await errorDetailsFrom(response, opts.env);
        jobDiag("errorDetailsFrom", detailsStarted);
        error = new ProviderHttpError({
          status,
          code: details.code || `http_${status || 0}`,
          message: `${provider} returned HTTP ${status || 0}`,
          retryable: isRetryableStatus(status),
          retryAfterMs: retryAfterMs(response),
          upstream_excerpt: details.excerpt
        });
      } catch (caught) {
        if (timer.signal.aborted) throw abortError(parentSignal?.reason ?? caught?.reason ?? caught);
        if (caught instanceof ProviderHttpError && !caught.retryable) throw caught;
        error = caught instanceof ProviderHttpError ? caught : new ProviderHttpError({
          status: Number(caught?.status) || 0,
          code: String(caught?.code || "network_error"),
          message: `${provider} network failure`,
          retryable: true
        });
      }
      lastError = error;
      if (!error.retryable || attempt >= attempts) throw error;
      const backoff = Math.min(maxDelay, baseDelay * (2 ** (attempt - 1)));
      await delay(Math.max(backoff, error.retryAfterMs), timer.signal, sleepFn);
    }
    throw lastError || new ProviderHttpError({ message: `${provider} request failed` });
  } finally {
    jobDiag("retry-loop", loopStarted, attemptCount);
    // On success the caller owns cleanup (it may still be reading a stream).
    // On any thrown error there is nothing left to consume: release here.
    if (!handedOff) timer.cleanup();
  }
}

export async function requestJson(provider, fetchImpl, url, options = {}, opts = {}) {
  const { response, cleanup, attempts } = await requestResponse(provider, fetchImpl, url, options, opts);
  // The stream body is owned by the caller; handing off cleanup keeps the
  // request deadline active until the caller finishes reading.
  if (opts.parse === "stream") return { body: null, response, attempts, cleanup };
  try {
    if (opts.parse === "text") {
      const textStarted = Date.now();
      const body = await response.text();
      jobDiag("response.text", textStarted);
      return { body, response, attempts };
    }
    let body;
    const jsonStarted = Date.now();
    try { body = await response.json(); }
    catch {
      throw new ProviderHttpError({
        status: response.status,
        code: "invalid_json",
        message: `${provider} returned an invalid JSON body`,
        retryable: false
      });
    } finally {
      jobDiag("response.json", jsonStarted);
    }
    return { body, response, attempts };
  } finally {
    cleanup();
  }
}

// Minimal Server-Sent-Event reader. Emits one object per `data:` payload;
// OpenAI's `[DONE]` sentinel becomes { __done: true }. Invalid JSON payloads
// are reported as { __invalid: true } and never throw into the caller's loop.
export async function readSse(response, onData, signal) {
  const reader = response?.body?.getReader?.();
  if (!reader) throw new ProviderHttpError({ status: response?.status || 0, code: "stream_unavailable", message: "provider stream unavailable", retryable: false });
  const decoder = new TextDecoder();
  let buffer = "";
  const emitLine = (raw) => {
    const line = raw.endsWith("\r") ? raw.slice(0, -1) : raw;
    if (!line.startsWith("data:")) return;
    const data = line.slice(5).trim();
    if (!data) return;
    if (data === "[DONE]") { onData({ __done: true }); return; }
    try { onData(JSON.parse(data)); }
    catch { onData({ __invalid: true }); }
  };
  try {
    for (;;) {
      if (signal?.aborted) throw abortError(signal?.reason);
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let index;
      while ((index = buffer.indexOf("\n")) !== -1) {
        emitLine(buffer.slice(0, index));
        buffer = buffer.slice(index + 1);
      }
    }
    if (buffer.trim()) emitLine(buffer);
  } finally {
    try { await reader.cancel(); } catch { /* stream already closed */ }
  }
}
