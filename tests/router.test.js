import { test } from "node:test";
import assert from "node:assert/strict";
import { IntelligentRouter, classifyWithKeywords } from "../dist/index.js";
import { MemoryCacheService } from "../dist/services/cache.js";

test("keyword engine picks the right tier", () => {
  assert.equal(classifyWithKeywords("hello, how are you?").tier, "micro");
  assert.equal(classifyWithKeywords("fix this python bug in my function").tier, "coder");
  assert.equal(classifyWithKeywords("prove this theorem step by step").tier, "reasoner");
  assert.equal(classifyWithKeywords("write an essay about the ocean").tier, "general");
});

test("keyword engine keeps scores in range", () => {
  for (const p of ["hi", "x ".repeat(1000), "debug the sql query and optimize the algorithm"]) {
    const r = classifyWithKeywords(p);
    assert.ok(r.score >= 0 && r.score <= 3, `score ${r.score}`);
    assert.ok(r.conf >= 0 && r.conf <= 1, `conf ${r.conf}`);
  }
});

test("router maps tiers to installed models and caches decisions", async () => {
  const router = new IntelligentRouter({ engine: "keyword", models: ["llama3:latest", "codellama:13b"] });
  await router.init();
  const first = await router.processRequest("refactor this javascript function");
  assert.equal(first.modelName, "codellama:13b");
  assert.equal(first.engine, "keyword");
  assert.equal(first.cached, false);
  const second = await router.processRequest("  Refactor this JavaScript   function ");
  assert.equal(second.cached, true);
  assert.equal(second.modelName, first.modelName);
});

test("router falls back to default models when Ollama is offline", async () => {
  const router = new IntelligentRouter({ engine: "keyword", ollamaUrl: "http://127.0.0.1:1" });
  await router.init();
  assert.equal(router.ollamaOnline, false);
  const d = await router.processRequest("write a python script");
  assert.equal(d.modelName, "qwen2.5-coder:7b");
});

test("router uses Laya answers when a Laya model is present", async () => {
  let seen;
  const laya = {
    async systemOne(state, questions) {
      seen = { state, questions };
      return {
        answers: {
          classification: { choice: "reasoner", probabilities: { micro: 0.01, coder: 0.02, reasoner: 0.9, general: 0.07 } },
          complexity: { score: 2.5 }
        }
      };
    }
  };
  const router = new IntelligentRouter({ laya, models: ["deepseek-r1:8b", "llama3:latest"] });
  await router.init();
  const d = await router.processRequest("anything");
  assert.deepEqual(seen.state, { prompt: "anything" });
  assert.deepEqual(Object.keys(seen.questions.classification.criteria), ["micro", "coder", "reasoner", "general"]);
  assert.deepEqual(d, { tier: "reasoner", modelName: "deepseek-r1:8b", complexityScore: "2.50", confidence: "90.0%", engine: "laya", cached: false });
});

test("engine=laya fails loudly when the model cannot load", async () => {
  const router = new IntelligentRouter({ engine: "laya", models: [] });
  // Point the download at an unreachable cache/host so it fails fast.
  process.env.LAYA_CACHE = "/nonexistent-dir-for-test";
  const origFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error("offline"); };
  try {
    await assert.rejects(router.init(), /Could not load Laya model/);
  } finally {
    globalThis.fetch = origFetch;
    delete process.env.LAYA_CACHE;
  }
});

test("engine=auto never downloads Laya when it is not cached", async () => {
  process.env.LAYA_CACHE = "/nonexistent-dir-for-test";
  const origFetch = globalThis.fetch;
  let fetched = false;
  globalThis.fetch = async () => { fetched = true; throw new Error("should not fetch"); };
  try {
    const router = new IntelligentRouter({ engine: "auto", models: [] });
    await router.init();
    assert.equal(router.activeEngine, "keyword");
    assert.equal(fetched, false);
  } finally {
    globalThis.fetch = origFetch;
    delete process.env.LAYA_CACHE;
  }
});

test("empty prompt is rejected", async () => {
  const router = new IntelligentRouter({ engine: "keyword", models: [] });
  await assert.rejects(router.processRequest("   "), /empty/);
});

test("cache evicts oldest entries", () => {
  const cache = new MemoryCacheService(2);
  cache.set("a", 1); cache.set("b", 2); cache.set("c", 3);
  assert.equal(cache.get("a"), undefined);
  assert.equal(cache.get("c"), 3);
  assert.equal(cache.size, 2);
});
