import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { IntelligentRouter, startServer, lastUserText } from "../dist/index.js";

/** Fake OpenRouter: records requests, echoes the model back, streams when asked. */
async function fakeOpenRouter() {
  const calls = [];
  const server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", c => (raw += c));
    req.on("end", () => {
      const body = JSON.parse(raw || "{}");
      calls.push({ url: req.url, auth: req.headers.authorization, apiKey: req.headers["x-api-key"], beta: req.headers["anthropic-beta"], body });
      if (body.stream) {
        res.setHeader("Content-Type", "text/event-stream");
        res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: "hi " } }] })}\n\n`);
        res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: body.model } }] })}\n\n`);
        return res.end("data: [DONE]\n\n");
      }
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ model: body.model, choices: [{ message: { role: "assistant", content: "ok" } }] }));
    });
  });
  await new Promise(r => server.listen(0, "127.0.0.1", r));
  return { url: `http://127.0.0.1:${server.address().port}/api/v1`, calls, close: () => new Promise(r => server.close(r)) };
}

const MODELS = { micro: "m/micro", coder: "m/coder", reasoner: "m/reasoner", general: "m/general" };

const CLAUDE = { micro: "c-haiku", coder: "c-sonnet", reasoner: "c-opus", general: "c-sonnet" };

async function setup(apiKey = "sk-or-server", claudeProvider = "openrouter") {
  const upstream = await fakeOpenRouter();
  const router = new IntelligentRouter({ engine: "keyword", models: [] });
  await router.init();
  const server = await startServer(router, 0, "127.0.0.1", {
    upstreamUrl: upstream.url, apiKey, models: MODELS,
    claudeProvider, anthropicUrl: upstream.url.replace("/api/v1", "/v1"), claudeModels: CLAUDE
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  const close = async () => { await new Promise(r => server.close(r)); await upstream.close(); };
  return { base, upstream, close };
}

const post = (url, body, headers = {}) =>
  fetch(url, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) });

test("OpenAI endpoint routes by prompt and forwards to OpenRouter", async () => {
  const { base, upstream, close } = await setup();
  try {
    const res = await post(`${base}/v1/chat/completions`, {
      model: "smart-router/auto",
      messages: [{ role: "user", content: "debug my python function" }]
    });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("x-smart-router-tier"), "coder");
    assert.equal((await res.json()).model, "m/coder");
    assert.equal(upstream.calls[0].url, "/api/v1/chat/completions");
    assert.equal(upstream.calls[0].auth, "Bearer sk-or-server");
  } finally {
    await close();
  }
});

test("explicit OpenRouter model ids are kept, client keys are forwarded", async () => {
  const { base, upstream, close } = await setup();
  try {
    await post(`${base}/v1/chat/completions`, { model: "openai/gpt-4o", messages: [{ role: "user", content: "hi" }] },
      { Authorization: "Bearer sk-or-client" });
    assert.equal(upstream.calls[0].body.model, "openai/gpt-4o");
    assert.equal(upstream.calls[0].auth, "Bearer sk-or-client");
  } finally {
    await close();
  }
});

test("streaming passes through", async () => {
  const { base, close } = await setup();
  try {
    const res = await post(`${base}/v1/chat/completions`, {
      stream: true,
      messages: [{ role: "user", content: "prove this theorem step by step" }]
    });
    assert.match(res.headers.get("content-type"), /event-stream/);
    const text = await res.text();
    assert.match(text, /m\/reasoner/);
    assert.match(text, /\[DONE\]/);
  } finally {
    await close();
  }
});

test("Claude Code via OpenRouter routes claude-* model names", async () => {
  const { base, upstream, close } = await setup();
  try {
    const res = await post(`${base}/v1/messages`, {
      model: "claude-sonnet-4-5",
      max_tokens: 100,
      messages: [{ role: "user", content: [{ type: "text", text: "write a typescript class" }] }]
    }, { "x-api-key": "sk-or-client", "anthropic-version": "2023-06-01" });
    assert.equal(res.status, 200);
    assert.equal(upstream.calls[0].url, "/api/v1/messages");
    assert.equal(upstream.calls[0].body.model, "m/coder");
    assert.equal(upstream.calls[0].auth, "Bearer sk-or-client");
  } finally {
    await close();
  }
});

test("missing key gives a clear 401", async () => {
  const saved = process.env.OPENROUTER_API_KEY;
  delete process.env.OPENROUTER_API_KEY;
  const { base, close } = await setup(null);
  try {
    const res = await post(`${base}/v1/chat/completions`, { messages: [{ role: "user", content: "hi" }] });
    assert.equal(res.status, 401);
    assert.match((await res.json()).error.message, /OPENROUTER_API_KEY/);
  } finally {
    await close();
    if (saved !== undefined) process.env.OPENROUTER_API_KEY = saved;
  }
});

test("/v1/models lists the auto model", async () => {
  const { base, close } = await setup();
  try {
    const { data } = await (await fetch(`${base}/v1/models`)).json();
    assert.equal(data[0].id, "smart-router/auto");
  } finally {
    await close();
  }
});

test("lastUserText skips tool-result turns", () => {
  assert.equal(lastUserText([
    { role: "user", content: [{ type: "text", text: "fix the bug" }] },
    { role: "assistant", content: "..." },
    { role: "user", content: [{ type: "tool_result", content: "ok" }] }
  ]), "fix the bug");
});

test("Claude Code with its own login: only the model changes, auth goes to Anthropic untouched", async () => {
  const { base, upstream, close } = await setup(null, "anthropic");
  try {
    const res = await post(`${base}/v1/messages?beta=true`, {
      model: "claude-sonnet-5-5",
      max_tokens: 100,
      messages: [{ role: "user", content: "prove this theorem step by step" }]
    }, { Authorization: "Bearer user-oauth-token", "anthropic-beta": "oauth-2025-04-20", "anthropic-version": "2023-06-01" });
    assert.equal(res.status, 200);
    assert.equal(upstream.calls[0].url, "/v1/messages?beta=true");
    assert.equal(upstream.calls[0].body.model, "c-opus");
    assert.equal(upstream.calls[0].auth, "Bearer user-oauth-token");
    assert.equal(upstream.calls[0].beta, "oauth-2025-04-20");

    // API-key users work the same way.
    await post(`${base}/v1/messages`, { model: "claude-opus-5-5", messages: [{ role: "user", content: "hi" }] },
      { "x-api-key": "sk-ant-user" });
    assert.equal(upstream.calls[1].apiKey, "sk-ant-user");
    assert.equal(upstream.calls[1].body.model, "c-haiku");
  } finally {
    await close();
  }
});

test("Claude Code background Haiku calls and count_tokens", async () => {
  const { base, upstream, close } = await setup(null, "anthropic");
  try {
    await post(`${base}/v1/messages`, { model: "claude-haiku-4-5", messages: [{ role: "user", content: "write a long essay title" }] });
    assert.equal(upstream.calls[0].body.model, "claude-haiku-4-5");

    await post(`${base}/v1/messages/count_tokens`, { model: "claude-sonnet-5-5", messages: [{ role: "user", content: "debug my python function" }] });
    assert.equal(upstream.calls[1].url, "/v1/messages/count_tokens");
    assert.equal(upstream.calls[1].body.model, "c-sonnet");
  } finally {
    await close();
  }
});

test("an Opus-shaped Claude Code request routed to Haiku is adjusted to what Haiku accepts", async () => {
  const { base, upstream, close } = await setup(null, "anthropic");
  try {
    // What Claude Code sends when set to Opus 5.5: 128K output, adaptive thinking, effort.
    const res = await post(`${base}/v1/messages`, {
      model: "claude-opus-5-5", max_tokens: 128000, stream: true,
      thinking: { type: "adaptive" }, output_config: { effort: "xhigh" },
      messages: [{ role: "user", content: "what is 1+1?" }]
    }, { "x-api-key": "sk-ant-user" });
    assert.equal(res.status, 200);
    const sent = upstream.calls[0].body;
    assert.equal(sent.model, "c-haiku");
    assert.equal(sent.max_tokens, 64000);
    assert.equal(sent.thinking, undefined);
    assert.equal(sent.output_config, undefined);

    // Sonnet and Opus take the request as is.
    await post(`${base}/v1/messages`, {
      model: "claude-opus-5-5", max_tokens: 128000, thinking: { type: "adaptive" }, output_config: { effort: "xhigh" },
      messages: [{ role: "user", content: "prove this theorem step by step" }]
    }, { "x-api-key": "sk-ant-user" });
    assert.equal(upstream.calls[1].body.model, "c-opus");
    assert.equal(upstream.calls[1].body.max_tokens, 128000);
    assert.deepEqual(upstream.calls[1].body.output_config, { effort: "xhigh" });

    // A conversation too long for Haiku's 200K window goes to the general model instead.
    await post(`${base}/v1/messages`, {
      model: "claude-opus-5-5", max_tokens: 128000,
      messages: [{ role: "user", content: "x".repeat(700_000) }, { role: "assistant", content: "ok" }, { role: "user", content: "thanks" }]
    }, { "x-api-key": "sk-ant-user" });
    assert.equal(upstream.calls[2].body.model, "c-sonnet");
  } finally {
    await close();
  }
});

test("fitToClaudeModel keeps a valid Haiku thinking budget and turns system messages into user turns", async () => {
  const { fitToClaudeModel } = await import("../dist/index.js");
  const out = fitToClaudeModel({
    max_tokens: 100000, thinking: { type: "enabled", budget_tokens: 90000 },
    messages: [{ role: "user", content: "a" }, { role: "system", content: "be brief" }, { role: "system", content: [] }]
  }, "claude-haiku-4-5");
  assert.equal(out.max_tokens, 64000);
  assert.deepEqual(out.thinking, { type: "enabled", budget_tokens: 63999 });
  assert.deepEqual(out.messages, [{ role: "user", content: "a" }, { role: "user", content: "be brief" }]);
});

test("Claude Code's <system-reminder> context is not routed as part of the prompt", async () => {
  const reminder = "<system-reminder>\nContext: debug the python function, refactor the typescript class, fix the bug, implement the api\n</system-reminder>";
  assert.equal(lastUserText([{ role: "user", content: [{ type: "text", text: reminder }, { type: "text", text: "hey" }] }]), "hey");
  assert.equal(lastUserText([{ role: "user", content: `${reminder}\nwhat is 1+1?` }]), "what is 1+1?");

  const { base, upstream, close } = await setup(null, "anthropic");
  try {
    await post(`${base}/v1/messages`, {
      model: "claude-opus-5-5", max_tokens: 128000,
      messages: [{ role: "user", content: [{ type: "text", text: reminder }, { type: "text", text: "hey" }] }]
    }, { "x-api-key": "sk-ant-user" });
    assert.equal(upstream.calls[0].body.model, "c-haiku");
  } finally {
    await close();
  }
});

test("pasted images and thinking signatures do not make a short chat look too long for Haiku", async () => {
  const { estimateTokens } = await import("../dist/index.js");
  const image = { type: "image", source: { type: "base64", media_type: "image/png", data: "A".repeat(2_000_000) } };
  const thinking = { type: "thinking", thinking: "", signature: "S".repeat(500_000) };
  const body = { messages: [{ role: "user", content: [image, { type: "text", text: "what is this?" }] }, { role: "assistant", content: [thinking, { type: "text", text: "a chart" }] }, { role: "user", content: "hey" }] };
  assert.ok(estimateTokens(body) < 2000);

  const { base, upstream, close } = await setup(null, "anthropic");
  try {
    await post(`${base}/v1/messages`, { model: "claude-opus-5-5", max_tokens: 128000, ...body }, { "x-api-key": "sk-ant-user" });
    assert.equal(upstream.calls[0].body.model, "c-haiku");
  } finally {
    await close();
  }
});
