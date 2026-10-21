import { execFileSync } from "node:child_process";
import { join } from "node:path";
import assert from "node:assert/strict";
import { test } from "node:test";

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";

import { project, railing } from "./helpers.mjs";

const cfg = (extra = {}) => JSON.stringify({ include: ["src"], ...extra });
const TS = ["@ts", "ignore"].join("-"); // written in pieces so this file does not trip the rule itself
const TODO = ["TO", "DO"].join("");

test("a clean project passes and says how many files it looked at", () => {
  const dir = project({ "railing.config.json": cfg(), "src/a.ts": "export const a = 1;\n" });
  const r = railing(dir, ["check"]);
  assert.equal(r.code, 0);
  assert.match(r.out, /rules ok \(1 files\)/);
});

test("each built-in rule fails with file, line and reason", () => {
  const dir = project({
    "railing.config.json": cfg(),
    "src/a.ts": `// ${TS}\nconst x = y as unknown as Z;\n// ${TODO} later\neval("1");\n`,
    "src/b.test.ts": "it.only('x', () => {});\n",
  });
  const r = railing(dir, ["check"]);
  assert.equal(r.code, 1);
  for (const want of ["src/a.ts:1", "src/a.ts:2", "src/a.ts:3", "src/a.ts:4", "src/b.test.ts:1"]) assert.ok(r.err.includes(want), `${want} in:\n${r.err}`);
});

test("a TODO that names an issue is fine; a double cast in a test file is fine", () => {
  const dir = project({
    "railing.config.json": cfg(),
    "src/a.ts": `// ${TODO}(#41) later\n`,
    "src/a.test.ts": "const x = y as unknown as Z;\n",
  });
  assert.equal(railing(dir, ["check"]).code, 0);
});

test("an exemption needs a real reason, on the line or the line above", () => {
  const ok = project({ "railing.config.json": cfg(), "src/a.ts": `// railing-ok: generated file\n// ${TS}\nconst x = 1; // ${TS} railing-ok: vendor typing bug\n` });
  assert.equal(railing(ok, ["check"]).code, 0);
  const bare = project({ "railing.config.json": cfg(), "src/a.ts": `// ${TS} railing-ok:\n` });
  const r = railing(bare, ["check"]);
  assert.equal(r.code, 1);
  assert.match(r.err, /needs a reason/);
});

test("max-lines flags a long file, an exemption at the top excuses it, and false turns the rule off", () => {
  const long = `${"x\n".repeat(12)}`;
  const dir = project({ "railing.config.json": cfg({ rules: { "max-lines": 10 } }), "src/a.ts": long });
  const r = railing(dir, ["check"]);
  assert.equal(r.code, 1);
  assert.match(r.err, /file is 12 lines \(limit 10\)/);
  const excused = project({ "railing.config.json": cfg({ rules: { "max-lines": 10 } }), "src/a.ts": `// railing-ok: a lookup table\n${long}` });
  assert.equal(railing(excused, ["check"]).code, 0);
  const off = project({ "railing.config.json": cfg({ rules: { "max-lines": 0 } }), "src/a.ts": long });
  assert.equal(railing(off, ["check"]).code, 0);
});

test("a rule can be switched off, and a custom rule with only/skip works", () => {
  const dir = project({
    "railing.config.json": cfg({
      rules: { "no-eval": false },
      custom: [{ name: "no console in app code", pattern: "console\\.log", only: "^src/", skip: "\\.test\\." }],
    }),
    "src/a.ts": 'eval("1");\nconsole.log(1);\n',
    "src/a.test.ts": "console.log(2);\n",
  });
  const r = railing(dir, ["check"]);
  assert.equal(r.code, 1);
  assert.ok(r.err.includes("src/a.ts:2"));
  assert.ok(!r.err.includes("src/a.ts:1"), "eval rule is off");
  assert.ok(!r.err.includes("a.test.ts"), "skip pattern respected");
});

test("only the configured folders, extensions and non-excluded files are read; untracked files count, ignored ones do not", () => {
  const dir = project({
    "railing.config.json": cfg({ exclude: ["^src/gen/"] }),
    ".gitignore": "src/ignored.ts\n",
    "src/gen/a.ts": 'eval("1");\n',
    "src/ignored.ts": 'eval("1");\n',
    "src/notes.md": 'eval("1");\n',
    "other/a.ts": 'eval("1");\n',
    "src/new.ts": 'eval("1");\n',
  });
  const r = railing(dir, ["check"]);
  assert.equal(r.code, 1);
  assert.ok(r.err.includes("src/new.ts:1"));
  assert.equal(r.err.split("\n").filter((l) => l.includes(":1")).length, 1, r.err);
});

test("damaged config and unknown rules are explained, not crashed on", () => {
  const bad = project({ "railing.config.json": "{ nope" });
  assert.match(railing(bad, ["check"]).err, /not valid JSON/);
  const unknown = project({ "railing.config.json": cfg({ rules: { "no-such-rule": true } }), "src/a.ts": "x\n" });
  assert.match(railing(unknown, ["check"]).err, /Unknown rule "no-such-rule"/);
  const badRe = project({ "railing.config.json": cfg({ custom: [{ name: "x", pattern: "(" }] }) });
  assert.match(railing(badRe, ["check"]).err, /invalid pattern expression/);
});

test("outside a git repository it says so", () => {
  const dir = mkdtempSync(join(tmpdir(), "railing-nogit-"));
  const out = railing(dir, ["check"]);
  assert.equal(out.code, 1);
  assert.match(out.err, /needs a git repository/);
});

test("a file deleted from disk but still listed by git, and a name with a space or an accent, do not crash the check", () => {
  const dir = project({ "railing.config.json": cfg(), "src/gone.ts": "x\n", "src/café au lait.ts": 'eval("1");\n', "src/ok file.ts": "x\n" });
  execFileSync("git", ["add", "-A"], { cwd: dir });
  execFileSync("rm", [join(dir, "src", "gone.ts")]);
  const r = railing(dir, ["check"]);
  assert.equal(r.code, 1);
  assert.ok(r.err.includes("src/café au lait.ts:1"), r.err);
  assert.ok(!r.err.includes("ENOENT"));
});

test("a rule given the wrong kind of value is an error, not silently off", () => {
  for (const rules of [{ "no-eval": "true" }, { "no-eval": 1 }, { "max-lines": "300" }, { "max-lines": -1 }]) {
    const dir = project({ "railing.config.json": cfg({ rules }), "src/a.ts": 'eval("1");\n' });
    const r = railing(dir, ["check"]);
    assert.equal(r.code, 1, JSON.stringify(rules));
    assert.match(r.err, /rules\.(no-eval|max-lines)/);
  }
});

test("a root test/ folder gets the test-only rules, and skips the app-only ones", () => {
  const dir = project({ "railing.config.json": JSON.stringify({ include: ["test"] }), "test/a.mjs": "it.only('x', () => {});\nconst y = z as unknown as Q;\n" });
  const r = railing(dir, ["check"]);
  assert.equal(r.code, 1);
  assert.ok(r.err.includes("test/a.mjs:1"));
  assert.ok(!r.err.includes("test/a.mjs:2"), "double cast is allowed in tests");
});

test("an exemption does not leak: a trailing comment covers its own line only, a comment line covers the next one", () => {
  const dir = project({
    "railing.config.json": cfg(),
    "src/a.ts": `const a = 1; // ${TS} railing-ok: vendor bug\n// ${TS}\n`,
  });
  const r = railing(dir, ["check"]);
  assert.equal(r.code, 1);
  assert.ok(r.err.includes("src/a.ts:2"), "line 2 is not covered by line 1's trailing comment");
  const covered = project({ "railing.config.json": cfg(), "src/a.ts": `// railing-ok: vendor bug\n// ${TS}\n` });
  assert.equal(railing(covered, ["check"]).code, 0);
  const longFile = project({ "railing.config.json": cfg({ rules: { "max-lines": 3 } }), "src/a.ts": `const a = 1; // railing-ok: not a comment line\nx\nx\nx\nx\n` });
  assert.equal(railing(longFile, ["check"]).code, 1, "a trailing comment cannot excuse a long file");
});
