import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { IntelligentRouter, startServer, ConversationMemory, LocalStore, OmniRouteStore, memoryFromEnv } from "../dist/index.js";

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

const isSummaryCall = body => /running summary/.test(body.messages?.[0]?.content ?? "");

/**
 * smart-router in front of a fake OpenRouter that answers "answer from <model>".
 * Summary requests are recorded apart and answered with `summaryReply` (a status code fails them).
 */
async function setup(proxy = {}, summaryReply = "SUMMARY") {
  const sent = [];
  const summaries = [];
  const upstream = await listen((req, res, body) => {
    res.setHeader("Content-Type", "application/json");
    if (isSummaryCall(body)) {
      summaries.push(body);
      if (typeof summaryReply === "number") { res.statusCode = summaryReply; return res.end("{}"); }
      return res.end(JSON.stringify({ choices: [{ message: { role: "assistant", content: summaryReply } }] }));
    }
    sent.push(body);
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
  return { sent, summaries, ask, close };
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
    assert.equal(res.headers.get("x-smart-router-session"), "s1");
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
  assert.equal(memoryFromEnv({}).kind, "local");
  assert.equal(memoryFromEnv({ OMNIROUTE_URL: "http://localhost:20128" }).kind, "omniroute");

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

test("memory keeps one entry per repeated prompt; the store forgets idle sessions", async () => {
  const mem = new ConversationMemory(new LocalStore());
  await mem.remember("s", { prompt: "p", reply: "r1", tier: "coder", model: "a" });
  await mem.remember("s", { prompt: "p", reply: "r2", tier: "coder", model: "a" });
  assert.deepEqual((await mem.recall("s")).turns.map(t => t.reply), ["r2"]);

  const old = new LocalStore({ idleMs: -1 });
  await old.save("s", { summary: "", turns: [] });
  assert.equal(await old.load("s"), undefined);
});

const long = n => `please remember detail number ${n} about the billing service and its retry rules`;

test("long conversations: older turns are folded into a summary by the micro model", async () => {
  const memory = new ConversationMemory(new LocalStore(), { tokens: 60 }); // tiny budget, to force a summary
  const { sent, summaries, ask, close } = await setup({ memory });
  try {
    let res;
    for (let i = 1; i <= 5; i++) { res = await ask(long(i)); await settle(); }
    assert.ok(summaries.length >= 1, "a summary was written");
    assert.equal(summaries[0].model, "m/micro");
    assert.match(summaries[0].messages[1].content, /detail number 1/);

    const last = sent.at(-1).messages;
    assert.equal(last[0].content, "Summary of our conversation so far:\nSUMMARY");
    assert.equal(last.at(-1).content, long(5));
    assert.ok(!last.some(m => m.content === long(1)), "summarized turns are not resent word for word");
    assert.match(res.headers.get("x-smart-router-memory"), /\+summary$/);
  } finally {
    await close();
  }
});

test("if the summary call fails, memory still stays within the budget", async () => {
  const memory = new ConversationMemory(new LocalStore(), { tokens: 60 });
  const { sent, summaries, ask, close } = await setup({ memory }, 500);
  try {
    for (let i = 1; i <= 5; i++) { await ask(long(i)); await settle(); }
    assert.ok(summaries.length >= 1);
    const last = sent.at(-1).messages;
    assert.ok(!last[0].content.startsWith("Summary"));
    assert.ok(last.length < 9, "only the newest turns are resent");
    assert.equal(last.at(-1).content, long(5));
  } finally {
    await close();
  }
});

test("tools that resend the whole conversation never trigger a summary", async () => {
  const memory = new ConversationMemory(new LocalStore(), { tokens: 60 });
  const { summaries, ask, close } = await setup({ memory });
  try {
    const messages = [];
    for (let i = 1; i <= 5; i++) {
      messages.push({ role: "user", content: long(i) });
      const reply = (await (await ask([...messages])).json()).choices[0].message.content;
      messages.push({ role: "assistant", content: reply });
      await settle();
    }
    assert.equal(summaries.length, 0);
  } finally {
    await close();
  }
});

test("optional OmniRoute store keeps each session as one entry", async () => {
  const store = new Map();
  const omni = await listen((req, res, body) => {
    res.setHeader("Content-Type", "application/json");
    if (req.method === "POST") { store.set(body.key, body); return res.end(JSON.stringify({ success: true })); }
    const sessionId = new URL(req.url, "http://x").searchParams.get("sessionId");
    res.end(JSON.stringify({ data: [...store.values()].filter(e => e.sessionId === sessionId) }));
  });
  const { sent, ask, close } = await setup({ memory: new ConversationMemory(new OmniRouteStore(omni.url)) });
  try {
    await ask("write a python function to reverse a linked list");
    await settle();
    assert.equal(store.size, 1);
    assert.equal(store.get("smart-router:s1").sessionId, "s1");
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
