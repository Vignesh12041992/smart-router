import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { IntelligentRouter, startServer, LocalMemory, OmniRouteMemory, memoryFromEnv } from "../dist/index.js";

const MODELS = { micro: "m/micro", coder: "m/coder", reasoner: "m/reasoner", general: "m/general" };

/** A small HTTP server for fakes: OpenRouter (records what it is sent) and OmniRoute (memory store). */
async function listen(handler) {
  const server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", c => (raw += c));
    req.on("end", () => handler(req, res, raw ? JSON.parse(raw) : {}));
  });
  await new Promise(r => server.listen(0, "127.0.0.1", r));
  return { server, url: `http://127.0.0.1:${server.address().port}`, close: () => new Promise(r => server.close(r)) };
}

/** smart-router in front of a fake OpenRouter that answers "answer from <model>". */
async function setup(proxy = {}) {
  const sent = [];
  const upstream = await listen((req, res, body) => {
    sent.push(body);
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ choices: [{ message: { role: "assistant", content: `answer from ${body.model}` } }] }));
  });
  const router = new IntelligentRouter({ engine: "keyword", models: [] });
  await router.init();
  const app = await startServer(router, 0, "127.0.0.1", { upstreamUrl: `${upstream.url}/api/v1`, apiKey: "sk-or-x", models: MODELS, ...proxy });
  const base = `http://127.0.0.1:${app.address().port}`;
  const ask = (messages, session = "s1") => fetch(`${base}/v1/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-smart-router-session": session },
    body: JSON.stringify({ model: "smart-router/auto", messages: typeof messages === "string" ? [{ role: "user", content: messages }] : messages })
  });
  const close = async () => { await new Promise(r => app.close(r)); await upstream.close(); };
  return { sent, ask, close };
}

const settle = () => new Promise(r => setTimeout(r, 50)); // memory is saved after the response ends

test("built-in memory: a model switch mid-conversation keeps the context, with no setup", async () => {
  const { sent, ask, close } = await setup(); // no memory option, no env: built-in memory is on
  try {
    await ask("write a python function to reverse a linked list"); // coder
    await settle();
    const res = await ask("explain recursion simply and write an essay"); // general, a different model
    assert.equal(sent[0].model, "m/coder");
    assert.equal(sent[1].model, "m/general");
    assert.equal(res.headers.get("x-smart-router-memory"), "1");
    assert.deepEqual(sent[1].messages, [
      { role: "user", content: "write a python function to reverse a linked list" },
      { role: "assistant", content: "answer from m/coder" },
      { role: "user", content: "explain recursion simply and write an essay" }
    ]);
  } finally {
    await close();
  }
});

test("system messages stay first and sessions do not mix", async () => {
  const { sent, ask, close } = await setup();
  try {
    await ask("hello there", "a");
    await settle();
    await ask([{ role: "system", content: "be brief" }, { role: "user", content: "and again" }], "a");
    await ask("hi", "b");
    assert.deepEqual(sent[1].messages.map(m => m.role), ["system", "user", "assistant", "user"]);
    assert.equal(sent[2].messages.length, 1);
  } finally {
    await close();
  }
});

test("requests that already carry history are not given extra context", async () => {
  const { sent, ask, close } = await setup();
  try {
    await ask("first question");
    await settle();
    await ask([{ role: "user", content: "hi" }, { role: "assistant", content: "hello" }, { role: "user", content: "hey again" }]);
    assert.equal(sent[1].messages.length, 3);
  } finally {
    await close();
  }
});

test("memory can be turned off", async () => {
  assert.equal(memoryFromEnv({ SMART_ROUTER_MEMORY: "off" }), undefined);
  assert.ok(memoryFromEnv({}) instanceof LocalMemory);
  assert.ok(memoryFromEnv({ OMNIROUTE_URL: "http://localhost:20128" }) instanceof OmniRouteMemory);

  const { sent, ask, close } = await setup({ memory: false });
  try {
    await ask("first question");
    await settle();
    await ask("second question");
    assert.equal(sent[1].messages.length, 1);
  } finally {
    await close();
  }
});

test("LocalMemory keeps one entry per repeated prompt and forgets idle sessions", async () => {
  const mem = new LocalMemory({ idleMs: 1000 });
  await mem.remember("s", { prompt: "p", reply: "r1", tier: "coder", model: "a" });
  await mem.remember("s", { prompt: "p", reply: "r2", tier: "coder", model: "a" });
  assert.deepEqual((await mem.recall("s")).map(t => t.reply), ["r2"]);

  const old = new LocalMemory({ idleMs: -1 });
  await old.remember("s", { prompt: "p", reply: "r", tier: "coder", model: "a" });
  assert.deepEqual(await old.recall("s"), []);
});

test("optional OmniRoute backend stores and recalls turns", async () => {
  const store = [];
  const omni = await listen((req, res, body) => {
    res.setHeader("Content-Type", "application/json");
    if (req.method === "POST") { store.push(body); return res.end(JSON.stringify({ success: true })); }
    res.end(JSON.stringify({ data: [...store].reverse() })); // OmniRoute lists newest first
  });
  const { sent, ask, close } = await setup({ memory: new OmniRouteMemory(omni.url) });
  try {
    await ask("write a python function to reverse a linked list");
    await settle();
    assert.equal(store[0].sessionId, "s1");
    await ask("explain recursion simply and write an essay");
    assert.equal(sent[1].messages[1].content, "answer from m/coder");
  } finally {
    await close();
    await omni.close();
  }
});

test("Anthropic format: a streamed reply is remembered and handed to the next model", async () => {
  const sent = [];
  const anthropic = await listen((req, res, body) => {
    sent.push(body);
    res.setHeader("Content-Type", "text/event-stream");
    res.write(`event: content_block_delta\ndata: ${JSON.stringify({ type: "content_block_delta", delta: { type: "text_delta", text: "answer from " } })}\n\n`);
    res.end(`event: content_block_delta\ndata: ${JSON.stringify({ type: "content_block_delta", delta: { type: "text_delta", text: body.model } })}\n\n`);
  });
  const router = new IntelligentRouter({ engine: "keyword", models: [] });
  await router.init();
  const app = await startServer(router, 0, "127.0.0.1", {
    claudeProvider: "anthropic", anthropicUrl: `${anthropic.url}/v1`,
    claudeModels: { micro: "c-micro", coder: "c-coder", reasoner: "c-reasoner", general: "c-general" }
  });
  const ask = content => fetch(`http://127.0.0.1:${app.address().port}/v1/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": "sk-ant-x" },
    body: JSON.stringify({ model: "claude-sonnet-4-5", stream: true, system: "sys", metadata: { user_id: "conv-1" }, messages: [{ role: "user", content }] })
  }).then(r => r.text());
  try {
    await ask("write a python function to reverse a linked list");
    await settle();
    await ask("explain recursion simply and write an essay");
    assert.equal(sent[1].model, "c-general");
    assert.equal(sent[1].system, "sys");
    assert.deepEqual(sent[1].messages.slice(0, 2), [
      { role: "user", content: "write a python function to reverse a linked list" },
      { role: "assistant", content: "answer from c-coder" }
    ]);
  } finally {
    await new Promise(r => app.close(r));
    await anthropic.close();
  }
});
