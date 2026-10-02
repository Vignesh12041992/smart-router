import { test } from "node:test";
import assert from "node:assert/strict";
import { IntelligentRouter, startServer } from "../dist/index.js";
import { fakeOllama } from "./helpers.js";

test("dashboard API routes and streams answers", async () => {
  const ollama = await fakeOllama();
  const router = new IntelligentRouter({ engine: "keyword", ollamaUrl: ollama.url });
  await router.init();
  const server = await startServer(router, 0);
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const page = await fetch(base + "/");
    assert.equal(page.status, 200);
    const html = await page.text();
    assert.match(html, /Smart Router/);
    assert.doesNotMatch(html, /EverOS|Floci/i);

    const status = await (await fetch(base + "/api/status")).json();
    assert.equal(status.ollamaOnline, true);

    const route = await fetch(base + "/api/route", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: "debug my rust code" })
    });
    const decision = await route.json();
    assert.equal(decision.modelName, "qwen2.5-coder:7b");

    const bad = await fetch(base + "/api/route", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    assert.equal(bad.status, 400);

    const stream = await (await fetch(`${base}/api/stream?model=phi:latest&prompt=hi`)).text();
    assert.match(stream, /"token":"Hello "/);
    assert.match(stream, /"token":"phi:latest"/);
    assert.match(stream, /data: \[DONE\]/);
  } finally {
    await new Promise(r => server.close(r));
    await ollama.close();
  }
});

test("stream reports an error when Ollama is down", async () => {
  const router = new IntelligentRouter({ engine: "keyword", ollamaUrl: "http://127.0.0.1:1" });
  await router.init();
  const server = await startServer(router, 0);
  try {
    const text = await (await fetch(`http://127.0.0.1:${server.address().port}/api/stream?model=x&prompt=hi`)).text();
    assert.match(text, /Could not reach Ollama/);
    assert.match(text, /\[DONE\]/);
  } finally {
    await new Promise(r => server.close(r));
  }
});
