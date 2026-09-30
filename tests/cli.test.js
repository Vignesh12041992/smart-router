import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { fakeOllama } from "./helpers.js";

const CLI = fileURLToPath(new URL("../dist/cli.js", import.meta.url));

function run(args, input) {
  return new Promise(resolve => {
    const child = spawn(process.execPath, [CLI, ...args], { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "", stderr = "";
    child.stdout.on("data", d => (stdout += d));
    child.stderr.on("data", d => (stderr += d));
    child.on("close", code => resolve({ code, stdout, stderr }));
    child.stdin.end(input ?? "");
  });
}

test("--version and --help", async () => {
  assert.match((await run(["--version"])).stdout, /^\d+\.\d+\.\d+/);
  const help = await run(["--help"]);
  assert.equal(help.code, 0);
  assert.match(help.stdout, /smart-router route/);
});

test("route prints JSON", async () => {
  const r = await run(["route", "-e", "keyword", "--json", "--ollama-url", "http://127.0.0.1:1", "write a python function"]);
  assert.equal(r.code, 0, r.stderr);
  const d = JSON.parse(r.stdout);
  assert.equal(d.tier, "coder");
});

test("route reads the prompt from stdin", async () => {
  const r = await run(["route", "-e", "keyword", "--ollama-url", "127.0.0.1:1"], "hello there");
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, /Tier:\s+micro/);
});

test("run streams the answer from Ollama", async () => {
  const ollama = await fakeOllama();
  try {
    const r = await run(["run", "-e", "keyword", "--ollama-url", ollama.url, "prove this theorem step by step"]);
    assert.equal(r.code, 0, r.stderr);
    assert.equal(r.stdout.trim(), "Hello from deepseek-r1:8b");
  } finally {
    await ollama.close();
  }
});

test("models lists Ollama models", async () => {
  const ollama = await fakeOllama(["a:1", "b:2"]);
  try {
    const r = await run(["models", "--ollama-url", ollama.url]);
    assert.equal(r.code, 0);
    assert.equal(r.stdout.trim(), "a:1\nb:2");
  } finally {
    await ollama.close();
  }
});

test("bad input gives a clear error", async () => {
  assert.equal((await run(["nope"])).code, 2);
  assert.equal((await run(["route", "-e", "wrong", "hi"])).code, 2);
  assert.equal((await run(["route"])).code, 2);
  assert.equal((await run(["models", "--ollama-url", "http://127.0.0.1:1"])).code, 1);
});
