import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { IntelligentRouter, startServer, OmniRouteMemory } from "../dist/index.js";

/** Fake OmniRoute (memory store) and fake OpenRouter (records what it is sent). */
async function listen(handler) {
  const server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", c => (raw += c));
    req.on("end", () => handler(req, res, raw ? JSON.parse(raw) : {}));
  });
  await new Promise(r => server.listen(0, "127.0.0.1", r));
  return { server, url: `http://127.0.0.1:${server.address().port}`, close: () => new Promise(r => server.close(r)) };
}

test("a later prompt gets the earlier turn even though another model answers it", async () => {
  const store = [];
  const omni = await listen((req, res, body) => {
    res.setHeader("Content-Type", "application/json");
    if (req.method === "POST") { store.push({ ...body, metadata: body.metadata }); return res.end(JSON.stringify({ success: true })); }
    res.end(JSON.stringify({ data: [...store].reverse() })); // OmniRoute lists newest first
  });
  const sent = [];
  const upstream = await listen((req, res, body) => {
    sent.push(body);
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ choices: [{ message: { role: "assistant", content: `answer from ${body.model}` } }] }));
  });

  const router = new IntelligentRouter({ engine: "keyword", models: [] });
  await router.init();
  const app = await startServer(router, 0, "127.0.0.1", {
    upstreamUrl: `${upstream.url}/api/v1`, apiKey: "sk-or-x",
    models: { micro: "m/micro", coder: "m/coder", reasoner: "m/reasoner", general: "m/general" },
    memory: new OmniRouteMemory(omni.url)
  });
  const base = `http://127.0.0.1:${app.address().port}`;
  const ask = content => fetch(`${base}/v1/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-smart-router-session": "s1" },
    body: JSON.stringify({ model: "smart-router/auto", messages: [{ role: "user", content }] })
  }).then(r => r.json());

  try {
    await ask("write a python function to reverse a linked list"); // coder
    await new Promise(r => setTimeout(r, 100)); // memory is saved after the response ends
    assert.equal(store.length, 1);
    assert.equal(store[0].sessionId, "s1");

    await ask("explain recursion simply and write an essay"); // general, different model
    assert.equal(sent[1].model, "m/general");
    assert.equal(sent[1].messages[0].role, "system");
    assert.match(sent[1].messages[0].content, /reverse a linked list/);
    assert.match(sent[1].messages[0].content, /answer from m\/coder/);
    assert.equal(sent[1].messages.at(-1).content, "explain recursion simply and write an essay");
  } finally {
    await new Promise(r => app.close(r));
    await upstream.close();
    await omni.close();
  }
});

test("requests that already carry history are not given extra context", async () => {
  const omni = await listen((req, res) => { res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify({ data: [{ content: "User: old\nAssistant: old", metadata: { tier: "coder", model: "x" } }] })); });
  const sent = [];
  const upstream = await listen((req, res, body) => { sent.push(body); res.setHeader("Content-Type", "application/json"); res.end("{}"); });
  const router = new IntelligentRouter({ engine: "keyword", models: [] });
  await router.init();
  const app = await startServer(router, 0, "127.0.0.1", { upstreamUrl: `${upstream.url}/api/v1`, apiKey: "sk-or-x", memory: new OmniRouteMemory(omni.url) });
  try {
    await fetch(`http://127.0.0.1:${app.address().port}/v1/chat/completions`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: "smart-router/auto", messages: [{ role: "user", content: "hi" }, { role: "assistant", content: "hello" }, { role: "user", content: "hey again" }] })
    });
    assert.equal(sent[0].messages.length, 3);
  } finally {
    await new Promise(r => app.close(r));
    await upstream.close();
    await omni.close();
  }
});
