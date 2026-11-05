import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { commit, project, put, railing } from "./helpers.mjs";

const includeOf = (dir) => JSON.parse(readFileSync(join(dir, "railing.config.json"), "utf8")).include;
const dirty = { 'node_modules/dep/index.js': 'eval("1");\n', "dist/out.js": 'eval("1");\n', "build/x.js": 'eval("1");\n', ".next/y.js": 'eval("1");\n', "coverage/z.js": 'eval("1");\n' };

test("a project with no src folder: init picks the code folders, and the gate passes on a clean project", () => {
  const dir = project({ "package.json": "{}", "server/main.js": "export {};\n", "docs/readme.md": "hi\n", ...dirty });
  commit(dir);
  const init = railing(dir, ["init"]);
  assert.equal(init.code, 0, init.err);
  assert.deepEqual(includeOf(dir), ["server"]);
  assert.match(init.out, /include: \["server"\]/);
  assert.match(init.out, /Change "include" in railing\.config\.json/);
  commit(dir);
  const gate = railing(dir, ["gate"]);
  assert.equal(gate.code, 0, gate.err + gate.out);
  assert.match(gate.out, /rules ok \(1 files\)/);
});

test("a project with no folders at all: init writes an explicit default, says so, and the gate skips node_modules and build output", () => {
  const dir = project({ "package.json": "{}", "index.js": "export {};\n", ...dirty });
  commit(dir);
  const init = railing(dir, ["init"]);
  assert.deepEqual(includeOf(dir), ["."]);
  assert.match(init.out, /no source folders found/);
  commit(dir);
  const gate = railing(dir, ["gate"]);
  assert.equal(gate.code, 0, gate.err + gate.out);
  assert.match(gate.out, /rules ok \(1 files\)/);
});

test("a project with src: init picks src (and the other usual folders that exist) and the gate still catches a real problem", () => {
  const dir = project({ "package.json": "{}", "src/a.ts": "export {};\n", "test/a.test.ts": "export {};\n", "other/b.js": "export {};\n", ...dirty });
  commit(dir);
  railing(dir, ["init"]);
  assert.deepEqual(includeOf(dir), ["src", "test"]);
  commit(dir);
  assert.equal(railing(dir, ["gate"]).code, 0);
  put(dir, { "src/bad.ts": 'eval("1");\n' });
  const gate = railing(dir, ["gate"]);
  assert.equal(gate.code, 1);
  assert.match(gate.err, /src\/bad\.ts:1/);
});

test("an empty include list or a missing one never scans node_modules, .git, build output or Railing's own files", () => {
  for (const config of [{ include: [] }, {}]) {
    const dir = project({ "railing.config.json": JSON.stringify(config), "app/a.ts": "export {};\n", "src/a.ts": "export {};\n", ...dirty, ".railing/hook.js": 'eval("1");\n', ".githooks/x.js": 'eval("1");\n' });
    commit(dir);
    const gate = railing(dir, ["gate"]);
    assert.equal(gate.code, 0, `${JSON.stringify(config)}: ${gate.err}`);
    assert.ok(!gate.err.includes("node_modules"));
  }
});

test("build output is skipped, but real code in a nested folder named build is still checked", () => {
  const dir = project({ "railing.config.json": JSON.stringify({ include: [] }), "src/build/real.ts": 'eval("1");\n', "build/gen.js": 'eval("1");\n' });
  commit(dir);
  const gate = railing(dir, ["gate"]);
  assert.equal(gate.code, 1);
  assert.match(gate.err, /src\/build\/real\.ts:1/);
  assert.ok(!gate.err.includes("build/gen.js"));
});
