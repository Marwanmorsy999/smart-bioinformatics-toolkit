// M7.9 assistant gateway tests. Everything is offline: fetch is stubbed, no
// live 9Router or NCBI call is made, and no secret is printed or asserted on.
import test from "node:test";
import assert from "node:assert/strict";

import { onStatus, onChat, MAX_TOOL_ITERATIONS } from "../functions/api/assistant/index.js";
import { executeTool, getAssistantToolDefinitions } from "../functions/api/assistant/tools.js";
import { createFetch } from "../worker.js";

const ORIGIN = "https://worker.example.test";
const BASE = "https://router.example.invalid/v1";
const KEY = "mock-key-not-a-real-secret";
const FASTA = ">test_sequence\nACGTACGTACGT";
const DATASET = "ds_0123456789abcdef";
const MODELS = {
  data: [
    { id: "auto", name: "Auto router" },
    { id: "mock-reasoner-1", name: "Mock reasoner" }
  ]
};

function env(fetchImpl, overrides = {}) {
  return {
    ASSETS: { fetch() {} },
    BLAST_DB: {},
    NINEROUTER_ENABLED: "true",
    NINEROUTER_BASE_URL: BASE,
    NINEROUTER_API_KEY: KEY,
    NINEROUTER_MODEL: "auto",
    NINEROUTER_TIMEOUT: "5",
    FETCH_IMPL: fetchImpl,
    ...overrides
  };
}

function context(path, requestEnv, init = {}) {
  return {
    request: new Request(ORIGIN + path, init),
    env: requestEnv,
    params: {},
    next: () => Promise.resolve()
  };
}

function post(body, requestEnv, init = {}) {
  return context("/api/assistant/chat", requestEnv, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(init.headers ?? {}) },
    body,
    ...(init.signal ? { signal: init.signal } : {})
  });
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function sse(lines) {
  return new Response(lines.join("\n\n") + "\n\n", { status: 200, headers: { "Content-Type": "text/event-stream" } });
}

function completion({ text = "", toolCalls = [], usage, model = "auto", finishReason } = {}) {
  const message = { role: "assistant", content: text };
  if (toolCalls.length) {
    message.tool_calls = toolCalls.map((call, index) => ({
      id: call.id ?? `call_${index}`,
      type: "function",
      function: { name: call.name, arguments: JSON.stringify(call.args) }
    }));
  }
  const body = {
    id: "chatcmpl_mock",
    model,
    choices: [{ index: 0, message, finish_reason: finishReason ?? (toolCalls.length ? "tool_calls" : "stop") }]
  };
  if (usage) body.usage = usage;
  return json(body);
}

function stub(handler) {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    return handler(String(url), init, calls.length);
  };
  return { calls, fetchImpl };
}

function modelFetch(replies) {
  const list = Array.isArray(replies) ? replies : [replies];
  return stub((url, init, index) => {
    if (url.endsWith("/models")) return json(MODELS);
    const reply = typeof replies === "function" ? replies(JSON.parse(init.body), index) : list[index - 1];
    return reply ?? completion({ text: "Mock final answer." });
  });
}

function toolArgs(name = "sequence-stats.validate", fastaText = FASTA) {
  return {
    name,
    args: { sequence_type: "dna", dataset_id: DATASET, filename: "test.fasta", fasta_text: fastaText }
  };
}

function noLeaks(text, label) {
  for (const secret of [KEY, BASE, "router.example.invalid", "Authorization"]) {
    assert.equal(text.includes(secret), false, `${label} leaked ${secret}`);
  }
}

async function readSse(response) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let raw = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    raw += decoder.decode(value, { stream: true });
  }
  await reader.cancel();
  return raw;
}

// Upstream stream whose second content frame is gated. `pull()` (not `start()`)
// is used so the first frame is readable before the gate is released.
function gatedSse(firstFrame, secondFrame) {
  const encoder = new TextEncoder();
  let release = () => {};
  const gate = new Promise((resolve) => { release = resolve; });
  let step = 0;
  const body = new ReadableStream({
    pull(controller) {
      step += 1;
      if (step === 1) {
        controller.enqueue(encoder.encode(`data: ${firstFrame}\n\n`));
      } else if (step === 2) {
        return gate.then(() => {
          controller.enqueue(encoder.encode(`data: ${secondFrame}\n\n`));
          controller.enqueue(encoder.encode("data: [DONE]\n\n"));
          controller.close();
        });
      } else {
        controller.close();
      }
    }
  });
  return {
    response: new Response(body, { status: 200, headers: { "Content-Type": "text/event-stream" } }),
    release: () => release()
  };
}

async function readWithTimeout(reader, timeoutMs = 3000) {
  return Promise.race([
    reader.read(),
    new Promise((resolve) => {
      const timer = setTimeout(() => resolve({ done: true, timedOut: true }), timeoutMs);
      if (typeof timer.unref === "function") timer.unref();
    })
  ]);
}

// ------------------------------------------------------------------ status

test("status reports reachable 9Router, live models, auth and tool calling", async () => {
  const { calls, fetchImpl } = modelFetch(completion());
  const response = await onStatus(context("/api/assistant/status", env(fetchImpl)));
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.available, true);
  assert.equal(body.provider, "ninerouter");
  assert.equal(body.reachable, true);
  assert.equal(body.auth_ok, true);
  assert.equal(body.model_count, 2);
  assert.equal(body.selected_model, "auto");
  assert.equal(body.tool_calling, true);
  assert.deepEqual(body.model, {
    id: "auto", name: "Auto router", source: "ninerouter:/v1/models", discovery_mode: "live"
  });
  assert.equal(typeof body.generated_at, "string");
  assert.equal(body.stages.length, 8);
  assert.equal(calls[0].url, `${BASE}/models`);
  assert.equal(calls.length, 1, "status must reuse one models() result, not discover twice");
  assert.equal(calls.every((call) => !call.url.includes("/v1/v1")), true);
  noLeaks(JSON.stringify(body) + JSON.stringify([...response.headers]), "status");
});

test("status classifies an auth failure without echoing credentials or URLs", async () => {
  const { fetchImpl } = stub((url) => url.endsWith("/models")
    ? json({ error: { code: "invalid_api_key", message: "bad key" } }, 401)
    : completion());
  const response = await onStatus(context("/api/assistant/status", env(fetchImpl)));
  const body = await response.json();
  assert.equal(body.available, false);
  assert.equal(body.reachable, false);
  assert.equal(body.auth_ok, false);
  assert.equal(body.reason, "auth_failed");
  noLeaks(JSON.stringify(body), "auth status");
});

// ----------------------------------------------------------- non-stream chat

test("non-stream chat returns the real upstream reply and reported usage only", async () => {
  const usage = { prompt_tokens: 11, completion_tokens: 7, total_tokens: 18 };
  const { calls, fetchImpl } = modelFetch(completion({ text: "Use FASTA validation first.", usage }));
  const response = await onChat(post(JSON.stringify({ message: "How do I check a FASTA?" }), env(fetchImpl)));
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.reply, "Use FASTA validation first.");
  assert.equal(body.provider, "ninerouter");
  assert.equal(body.model, "auto");
  assert.deepEqual(body.usage, { input_tokens: 11, output_tokens: 7, total_tokens: 18, model: "auto" });
  assert.equal(body.usage_source, "response.usage");
  assert.equal(body.finish_reason, "stop");
  assert.equal(body.evidence_status, "unverified");
  assert.equal(body.validated, false);
  assert.equal(body.generated, true);
  assert.equal(calls.length, 1);
  noLeaks(JSON.stringify(body) + JSON.stringify([...response.headers]), "chat");
});

test("outgoing request uses the exact /v1 URL, env-only bearer key and server tools", async () => {
  const { calls, fetchImpl } = modelFetch(completion({ text: "Real answer." }));
  const response = await onChat(post(JSON.stringify({ message: "Plan a QC step" }), env(fetchImpl)));
  assert.equal(response.status, 200);
  const call = calls[0];
  assert.equal(call.url, `${BASE}/chat/completions`);
  assert.equal(call.url.includes("/v1/v1"), false);
  assert.equal(call.init.method, "POST");
  assert.equal(call.init.headers.Authorization, `Bearer ${KEY}`);
  assert.equal(call.init.headers.Accept, "application/json");
  const outgoing = JSON.parse(call.init.body);
  assert.equal(outgoing.model, "auto");
  assert.match(outgoing.messages[0].content, /MUST NOT generate/);
  assert.match(outgoing.messages.find((item) => item.role === "system" && item !== outgoing.messages[0]).content, /TOOL USE/);
  assert.equal(outgoing.messages.at(-1).role, "user");
  assert.equal(outgoing.messages.at(-1).content, "Plan a QC step");
  assert.deepEqual(outgoing.tools.map((tool) => tool.function.name), [
    "sequence-stats.validate", "sequence-stats.profile",
    "protein.validate", "protein.annotate", "protein.get_result", "protein.get_domain_details",
    "microbiome.validate", "microbiome.annotate", "microbiome.run", "microbiome.get_result"
  ]);
  assert.equal(outgoing.tool_choice, "auto");
  assert.equal(Object.hasOwn(outgoing, "api_key"), false);
  noLeaks(await response.text(), "chat wire");
});

test("browser history is accepted and bounded; browser-supplied model/messages are rejected", async () => {
  const history = [
    { role: "user", content: "Earlier question" },
    { role: "assistant", content: "Earlier answer" }
  ];
  const { calls, fetchImpl } = modelFetch(completion({ text: "Follow-up answer." }));
  const response = await onChat(post(JSON.stringify({ message: "And now?", history }), env(fetchImpl)));
  assert.equal(response.status, 200);
  const outgoing = JSON.parse(calls[0].init.body);
  assert.deepEqual(outgoing.messages.slice(1).map((item) => item.role), ["system", "user", "assistant", "user"]);
  assert.equal(outgoing.messages[2].content, "Earlier question");
  assert.equal(outgoing.messages[3].content, "Earlier answer");

  for (const field of ["model", "messages", "system", "provider"]) {
    const bad = await onChat(post(JSON.stringify({ message: "hi", [field]: field === "messages" ? [] : "x" }), env(fetchImpl)));
    assert.equal(bad.status, 400, field);
  }
  const tooLong = await onChat(post(JSON.stringify({ message: "hi", history: Array.from({ length: 9 }, () => ({ role: "user", content: "x" })) }), env(fetchImpl)));
  assert.equal(tooLong.status, 400);
  const badRole = await onChat(post(JSON.stringify({ message: "hi", history: [{ role: "system", content: "x" }] }), env(fetchImpl)));
  assert.equal(badRole.status, 400);
});

// ------------------------------------------------------------- tool loop

test("real tool_calls are executed locally and fed back as tool messages", async () => {
  const tool = toolArgs();
  const { calls, fetchImpl } = modelFetch([
    completion({ toolCalls: [tool] }),
    completion({ text: "The validator reported one record." })
  ]);
  const response = await onChat(post(JSON.stringify({ message: "Validate my FASTA", project_context: DATASET }), env(fetchImpl)));
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.reply, "The validator reported one record.");
  assert.equal(body.iterations, 2);
  assert.equal(body.tool_activity.length, 1);
  assert.equal(body.tool_activity[0].tool_id, "sequence-stats.validate");
  assert.equal(body.tool_activity[0].status, "ok");
  assert.equal(body.tool_activity[0].evidence, "actual tool output");
  assert.equal(body.result_card.counts.total_records, 1);
  assert.equal(body.result_card.counts.valid_records, 1);
  assert.equal(body.stages.some((stage) => stage.state === "completed"), true);

  const second = JSON.parse(calls[1].init.body);
  assert.equal(second.messages.at(-2).role, "assistant");
  assert.deepEqual(second.messages.at(-2).tool_calls[0].function, { name: tool.name, arguments: JSON.stringify(tool.args) });
  assert.equal(second.messages.at(-1).role, "tool");
  const toolResult = JSON.parse(second.messages.at(-1).content);
  assert.equal(toolResult.ok, true);
  assert.equal(toolResult.output.validation.records[0].length, 12);
  assert.equal(Object.hasOwn(toolResult, "statistics"), false); // validate tool only
});

test("invalid tool arguments fail closed as tool data, never as invented output", async () => {
  const tool = toolArgs();
  tool.args.sequence_type = "rna";
  const { calls, fetchImpl } = modelFetch([
    completion({ toolCalls: [tool] }),
    completion({ text: "The requested sequence type is unsupported." })
  ]);
  const response = await onChat(post(JSON.stringify({ message: "Validate as RNA" }), env(fetchImpl)));
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.reply, "The requested sequence type is unsupported.");
  assert.equal(body.tool_activity[0].status, "error");
  assert.equal(body.tool_activity[0].error.code, "invalid_arguments");
  assert.equal(body.result_card, null);
  const second = JSON.parse(calls[1].init.body);
  const toolResult = JSON.parse(second.messages.at(-1).content);
  assert.equal(toolResult.ok, false);
  assert.equal(Object.hasOwn(toolResult, "output"), false);
});

test("ncbi.blastn is never executable from chat and needs the approval path", async () => {
  const { calls, fetchImpl } = modelFetch([
    completion({ toolCalls: [{ name: "ncbi.blastn", args: { database: "16S", program: "BLASTN" } }] }),
    completion({ text: "BLASTN requires approval; I did not run it." })
  ]);
  const response = await onChat(post(JSON.stringify({ message: "Run BLASTN for me" }), env(fetchImpl)));
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.tool_activity[0].status, "error");
  assert.equal(body.tool_activity[0].error.code, "tool_not_executable_from_chat");
  assert.match(body.tool_activity[0].error.message, /approval|consent/i);
  assert.equal(calls.length, 2); // only the two 9Router chat calls
  assert.equal(calls.some((call) => /ncbi|blast/i.test(call.url)), false);
  const direct = await executeTool("ncbi.blastn", { database: "16S", program: "BLASTN" });
  assert.equal(direct.ok, false);
  assert.equal(direct.error.code, "tool_not_executable_from_chat");
});

test("multiple tool calls in one round all execute with real statistics", async () => {
  const { calls, fetchImpl } = modelFetch([
    completion({ toolCalls: [toolArgs("sequence-stats.validate"), toolArgs("sequence-stats.profile")] }),
    completion({ text: "Both tools returned reports." })
  ]);
  const response = await onChat(post(JSON.stringify({ message: "Validate and profile" }), env(fetchImpl)));
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.tool_activity.length, 2);
  assert.equal(body.tool_activity.every((item) => item.status === "ok"), true);
  assert.equal(body.result_card.records[0].gc_percent, 50);
  const second = JSON.parse(calls[1].init.body);
  const toolMessages = second.messages.filter((item) => item.role === "tool");
  assert.equal(toolMessages.length, 2);
  assert.equal(JSON.parse(toolMessages[1].content).output.statistics.summary.total_length, 12);
});

test("the tool loop stops at the iteration limit without fabricating a reply", async () => {
  const { calls, fetchImpl } = modelFetch(() => completion({ toolCalls: [toolArgs()] }));
  const response = await onChat(post(JSON.stringify({ message: "Keep calling tools" }), env(fetchImpl)));
  assert.equal(response.status, 502);
  const body = await response.json();
  assert.equal(body.reason, "tool_loop_limit");
  assert.equal(body.generated, false);
  assert.equal(Object.hasOwn(body, "reply"), false);
  assert.equal(calls.length, MAX_TOOL_ITERATIONS);
  assert.match(body.error, /more tool rounds than permitted/i);
});

test("sequential tool rounds execute in order across multiple iterations", async () => {
  const { calls, fetchImpl } = modelFetch([
    completion({ toolCalls: [toolArgs("sequence-stats.validate")] }),
    completion({ toolCalls: [toolArgs("sequence-stats.profile")] }),
    completion({ text: "Validation and profiling both completed." })
  ]);
  const response = await onChat(post(JSON.stringify({ message: "Validate then profile" }), env(fetchImpl)));
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.iterations, 3);
  assert.deepEqual(body.tool_activity.map((item) => item.tool_id), [
    "sequence-stats.validate", "sequence-stats.profile"
  ]);
  assert.equal(body.result_card.statistics.total_length, 12);
  assert.equal(calls.length, 3);
  for (let index = 1; index < calls.length; index += 1) {
    const outgoing = JSON.parse(calls[index].init.body);
    assert.equal(outgoing.messages.filter((item) => item.role === "tool").length, index);
  }
});

test("reported usage is never invented when the provider omits it", async () => {
  const { fetchImpl } = modelFetch(completion({ text: "A real answer with no counters." }));
  const response = await onChat(post(JSON.stringify({ message: "hello" }), env(fetchImpl)));
  const body = await response.json();
  assert.equal(body.usage, null);
  assert.equal(body.usage_source, "not_reported");
  assert.equal(Object.hasOwn(body, "input_tokens"), false);
  assert.equal(Object.hasOwn(body, "total_tokens"), false);
});

test("tool definitions expose the allowlisted registry functions", async () => {
  assert.deepEqual(getAssistantToolDefinitions().map((item) => item.function.name), [
    "sequence-stats.validate", "sequence-stats.profile",
    "protein.validate", "protein.annotate", "protein.get_result", "protein.get_domain_details",
    "microbiome.validate", "microbiome.annotate", "microbiome.run", "microbiome.get_result"
  ]);
  for (const name of ["unknown.tool", "phylogenetics.tree", "microbiome-16s.taxonomy", "ncbi.blastn"]) {
    assert.equal((await executeTool(name, {})).ok, false, name);
  }
});

// ------------------------------------------------------------------ SSE

test("SSE request relays genuine upstream frames, meta model and [DONE]", async () => {
  const frames = [
    'data: {"choices":[{"delta":{"content":"Real "}}]}',
    'data: {"choices":[{"delta":{"content":"streamed answer."}}]}',
    'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}',
    "data: [DONE]"
  ];
  const { calls, fetchImpl } = modelFetch([sse(frames)]);
  const response = await onChat(post(JSON.stringify({ message: "Stream it", stream: true }), env(fetchImpl), {
    headers: { Accept: "text/event-stream" }
  }));
  assert.equal(response.status, 200);
  assert.match(response.headers.get("Content-Type"), /text\/event-stream/);
  assert.equal(response.headers.get("Access-Control-Allow-Origin"), null);
  const raw = await readSse(response);
  assert.match(raw, /event: meta/);
  assert.match(raw, /"model":"auto"/);
  assert.match(raw, /"provider":"ninerouter"/);
  assert.match(raw, /data: \[DONE\]/);
  for (const frame of frames) assert.equal(raw.includes(frame), true, frame);
  assert.equal(raw.includes("event: tool"), false);
  assert.equal(calls[0].url, `${BASE}/chat/completions`);
  noLeaks(raw, "SSE");
});

test("SSE tool rounds emit tool events before the final data frames", async () => {
  const tool = toolArgs("sequence-stats.profile");
  const toolFrame = `data: ${JSON.stringify({
    choices: [{ delta: { tool_calls: [{ index: 0, id: "call_0", type: "function", function: { name: tool.name, arguments: JSON.stringify(tool.args) } }] } }]
  })}`;
  const finalFrames = [
    'data: {"choices":[{"delta":{"content":"Profile complete."}}]}',
    "data: [DONE]"
  ];
  const { fetchImpl } = modelFetch([sse([toolFrame, "data: [DONE]"]), sse(finalFrames)]);
  const response = await onChat(post(JSON.stringify({ message: "Profile it" }), env(fetchImpl), {
    headers: { Accept: "text/event-stream" }
  }));
  const raw = await readSse(response);
  assert.equal(raw.indexOf("event: tool"), 0);
  assert.match(raw, /"tool_id":"sequence-stats.profile"/);
  assert.match(raw, /"status":"ok"/);
  assert.ok(raw.indexOf("event: tool") < raw.indexOf("data: {\"choices\":[{\"delta\":{\"content\":\"Profile complete.\""));
  assert.match(raw, /Profile complete\./);
  assert.match(raw, /data: \[DONE\]/);
  noLeaks(raw, "tool SSE");
});

test("SSE tolerates malformed frames and reports upstream error frames", async () => {
  const malformed = modelFetch([sse([
    "data: {not valid json}",
    'data: {"choices":[{"delta":{"content":"Still real."}}]}',
    "data: [DONE]"
  ])]);
  const okResponse = await onChat(post(JSON.stringify({ message: "x", stream: true }), env(malformed.fetchImpl)));
  const okRaw = await readSse(okResponse);
  assert.match(okRaw, /Still real\./);
  assert.match(okRaw, /data: \[DONE\]/);

  const failing = modelFetch([sse(['data: {"error":{"code":"upstream_error","message":"nope"}}'])]);
  const errorResponse = await onChat(post(JSON.stringify({ message: "x", stream: true }), env(failing.fetchImpl)));
  const errorRaw = await readSse(errorResponse);
  assert.match(errorRaw, /event: error/);
  assert.match(errorRaw, /"reason":"provider_stream_error"|"reason":"connection_failed"|"reason":"auth_failed"/);
  assert.match(errorRaw, /data: \[DONE\]/);
  assert.equal(errorRaw.includes("Real answer"), false);
});

test("SSE responses close on client abort instead of loading forever", async () => {
  const controller = new AbortController();
  const timeout = new Promise((resolve) => {
    const timer = setTimeout(() => resolve("hung"), 2000);
    if (typeof timer.unref === "function") timer.unref();
  });
  const { fetchImpl } = modelFetch([new Response(new ReadableStream({
    start(c) { c.enqueue(new TextEncoder().encode('data: {"choices":[]}\n\n')); }
    // Never closes; the client abort is the only way out.
  }), { status: 200, headers: { "Content-Type": "text/event-stream" } })]);
  const response = await onChat(post(JSON.stringify({ message: "x", stream: true }), env(fetchImpl), {
    headers: { Accept: "text/event-stream" }, signal: controller.signal
  }));
  assert.equal(response.status, 200);
  controller.abort();
  const raw = await Promise.race([readSse(response), timeout]);
  assert.notEqual(raw, "hung");
  assert.equal(typeof raw, "string");
});

test("SSE deltas reach the browser live, before later upstream frames are emitted", async () => {
  const first = JSON.stringify({ choices: [{ delta: { content: "FIRST_DELTA" } }] });
  const second = JSON.stringify({ choices: [{ delta: { content: "SECOND_DELTA" } }] });
  const upstream = gatedSse(first, second);
  const { fetchImpl } = modelFetch([upstream.response]);
  const response = await onChat(post(JSON.stringify({ message: "stream live", stream: true }), env(fetchImpl), {
    headers: { Accept: "text/event-stream" }
  }));
  assert.equal(response.headers.get("Content-Type"), "text/event-stream; charset=utf-8");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();

  let prefix = "";
  while (!prefix.includes("FIRST_DELTA")) {
    const chunk = await readWithTimeout(reader);
    assert.notEqual(chunk.timedOut, true, "first upstream delta was batched");
    assert.equal(chunk.done, false);
    prefix += decoder.decode(chunk.value, { stream: true });
  }
  assert.equal(prefix.includes("SECOND_DELTA"), false, "second frame arrived before it was emitted upstream");

  upstream.release();
  let rest = "";
  for (;;) {
    const chunk = await readWithTimeout(reader);
    assert.notEqual(chunk.timedOut, true, "stream hung after the gate was released");
    if (chunk.done) break;
    rest += decoder.decode(chunk.value, { stream: true });
  }
  const wire = prefix + rest;
  assert.match(wire, /SECOND_DELTA/);
  assert.match(wire, /data: \[DONE\]/);
  const frames = [...wire.matchAll(/data: (\{.*\})\n\n/g)]
    .map((match) => JSON.parse(match[1]))
    .filter((frame) => Array.isArray(frame.choices));
  assert.deepEqual(
    frames.map((frame) => frame.choices[0]?.delta?.content).filter(Boolean),
    ["FIRST_DELTA", "SECOND_DELTA"]
  );
  noLeaks(wire, "live SSE");
});

test("a tool round is followed by a live final round with immediate deltas", async () => {
  const tool = toolArgs("sequence-stats.profile");
  const toolFrame = `data: ${JSON.stringify({
    choices: [{ delta: { tool_calls: [{ index: 0, id: "call_0", type: "function", function: { name: tool.name, arguments: JSON.stringify(tool.args) } }] } }]
  })}`;
  const first = JSON.stringify({ choices: [{ delta: { content: "LIVE_FIRST" } }] });
  const second = JSON.stringify({ choices: [{ delta: { content: "LIVE_SECOND" } }] });
  const upstream = gatedSse(first, second);
  const { fetchImpl } = modelFetch([sse([toolFrame, "data: [DONE]"]), upstream.response]);

  const response = await onChat(post(JSON.stringify({ message: "profile live", stream: true }), env(fetchImpl), {
    headers: { Accept: "text/event-stream" }
  }));
  const reader = response.body.getReader();
  const decoder = new TextDecoder();

  let prefix = "";
  while (!prefix.includes("LIVE_FIRST")) {
    const chunk = await readWithTimeout(reader);
    assert.notEqual(chunk.timedOut, true, "final-round delta was batched");
    assert.equal(chunk.done, false);
    prefix += decoder.decode(chunk.value, { stream: true });
  }
  assert.match(prefix, /event: tool/);
  assert.match(prefix, /"tool_id":"sequence-stats.profile"/);
  assert.ok(prefix.indexOf("event: tool") < prefix.indexOf("LIVE_FIRST"));
  assert.equal(prefix.includes("LIVE_SECOND"), false);

  upstream.release();
  let rest = "";
  for (;;) {
    const chunk = await readWithTimeout(reader);
    assert.notEqual(chunk.timedOut, true, "stream hung after the gate was released");
    if (chunk.done) break;
    rest += decoder.decode(chunk.value, { stream: true });
  }
  const wire = prefix + rest;
  assert.match(wire, /LIVE_SECOND/);
  assert.match(wire, /data: \[DONE\]/);
  assert.equal(wire.lastIndexOf("event: tool") < wire.indexOf("LIVE_SECOND"), true);
  noLeaks(wire, "tool-then-live SSE");
});

// -------------------------------------------------------------- routes

test("assistant routes stay registered on the Worker with the real handlers", async () => {
  const { fetchImpl } = modelFetch(completion({ text: "Real answer." }));
  const requestEnv = env(fetchImpl);
  const workerFetch = createFetch();
  for (const path of ["/api/assistant/status", "/api/assistant/chat"]) {
    const response = await workerFetch(new Request(ORIGIN + path, {
      method: path.endsWith("chat") ? "POST" : "GET",
      headers: { "Content-Type": "application/json" },
      body: path.endsWith("chat") ? JSON.stringify({ message: "hello" }) : undefined
    }), requestEnv, {});
    assert.equal(response.status, 200, path);
    assert.equal(response.headers.get("X-Content-Type-Options"), "nosniff");
    assert.doesNotMatch(await response.clone().text(), /<!doctype/i);
  }
});
