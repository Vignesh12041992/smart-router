import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = p => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

test("npm and Python versions match", () => {
  const npm = JSON.parse(read("package.json")).version;
  assert.equal(read("python/pyproject.toml").match(/^version = "(.+)"/m)[1], npm);
  assert.equal(read("python/smart_router_cli/__init__.py").match(/__version__ = "(.+)"/)[1], npm);
});
