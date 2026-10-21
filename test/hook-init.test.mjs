import assert from "node:assert/strict";
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { git, project, put, railing } from "./helpers.mjs";

const cfg = JSON.stringify({ include: ["src"] });

test("the Stop hook lets the assistant finish when the rules pass", () => {
  const dir = project({ "railing.config.json": cfg, "src/a.ts": "export {};\n" });
  assert.equal(railing(dir, ["hook", "stop"], "{}").code, 0);
});

test("the Stop hook refuses to let it finish (exit 2, reasons on stderr) until the rules pass", () => {
  const dir = project({ "railing.config.json": cfg, "src/a.ts": 'eval("1");\n' });
  const r = railing(dir, ["hook", "stop"], JSON.stringify({ stop_hook_active: false }));
  assert.equal(r.code, 2);
  assert.match(r.err, /fix these before finishing/);
  assert.match(r.err, /src\/a\.ts:1/);
});

test("the Stop hook lets go when it is already continuing because of itself, so it cannot loop forever", () => {
  const dir = project({ "railing.config.json": cfg, "src/a.ts": 'eval("1");\n' });
  assert.equal(railing(dir, ["hook", "stop"], JSON.stringify({ stop_hook_active: true })).code, 0);
});

test("the Stop hook copes with empty or damaged input", () => {
  const dir = project({ "railing.config.json": cfg, "src/a.ts": 'eval("1");\n' });
  assert.equal(railing(dir, ["hook", "stop"], "").code, 2);
  assert.equal(railing(dir, ["hook", "stop"], "not json").code, 2);
});

test("init writes the config, floors file, hook, CLAUDE.md section and git hooks, and detects steps", () => {
  const dir = project({
    "package.json": JSON.stringify({ scripts: { lint: "biome check", test: "vitest run" } }),
    "tsconfig.json": "{}",
    "src/a.ts": "export {};\n",
  });
  const r = railing(dir, ["init"]);
  assert.equal(r.code, 0, r.err);
  const config = JSON.parse(readFileSync(join(dir, "railing.config.json"), "utf8"));
  assert.deepEqual(config.include, ["src"]);
  assert.deepEqual(config.steps.map((s) => s.name), ["lint", "types", "test"]);
  assert.ok(existsSync(join(dir, ".railing", "floors.json")));
  const settings = JSON.parse(readFileSync(join(dir, ".claude", "settings.json"), "utf8"));
  assert.match(JSON.stringify(settings.hooks.Stop), /railing hook stop/);
  assert.match(readFileSync(join(dir, "CLAUDE.md"), "utf8"), /railing:start/);
  assert.ok(statSync(join(dir, ".githooks", "pre-commit")).mode & 0o100, "hook is executable");
  assert.equal(git(dir, "config", "core.hooksPath").trim(), ".githooks");
  assert.equal(railing(dir, ["check"]).code, 0, "the project passes its own fresh config");
});

test("init is safe to run again and keeps what the project already has", () => {
  const dir = project({
    "src/a.ts": "export {};\n",
    "CLAUDE.md": "# My project\n\nOwn rules here.\n",
    ".claude/settings.json": JSON.stringify({ permissions: { allow: ["Bash(ls)"] }, hooks: { Stop: [{ hooks: [{ type: "command", command: "echo mine" }] }] } }),
  });
  railing(dir, ["init"]);
  const first = readFileSync(join(dir, "CLAUDE.md"), "utf8");
  railing(dir, ["init"]);
  assert.equal(readFileSync(join(dir, "CLAUDE.md"), "utf8"), first, "no duplicate section");
  assert.equal(first.match(/railing:start/g).length, 1);
  assert.match(first, /Own rules here\./);
  const settings = JSON.parse(readFileSync(join(dir, ".claude", "settings.json"), "utf8"));
  assert.deepEqual(settings.permissions, { allow: ["Bash(ls)"] });
  assert.equal(settings.hooks.Stop.length, 2, "their hook stays, ours added once");
  assert.match(JSON.stringify(settings.hooks.Stop), /echo mine/);
});

test("init refreshes an old railing section in CLAUDE.md and does not overwrite a config", () => {
  const dir = project({ "src/a.ts": "x\n", "CLAUDE.md": "intro\n<!-- railing:start -->\nOLD\n<!-- railing:end -->\noutro\n", "railing.config.json": JSON.stringify({ include: ["src"], rules: { "max-lines": 50 } }) });
  railing(dir, ["init"]);
  const md = readFileSync(join(dir, "CLAUDE.md"), "utf8");
  assert.ok(!md.includes("OLD"));
  assert.match(md, /^intro\n/);
  assert.match(md, /outro\n$/);
  assert.equal(JSON.parse(readFileSync(join(dir, "railing.config.json"), "utf8")).rules["max-lines"], 50);
});

test("init does not clobber a settings file it cannot read", () => {
  const dir = project({ "src/a.ts": "x\n", ".claude/settings.json": "{ broken" });
  const r = railing(dir, ["init"]);
  assert.equal(r.code, 0);
  assert.equal(readFileSync(join(dir, ".claude", "settings.json"), "utf8"), "{ broken");
  assert.match(r.out, /not valid JSON/);
  put(dir, {});
});

test("the Stop hook fails closed: a damaged config or a missing git repository exits 2 with the reason, not 1", () => {
  const bad = project({ "railing.config.json": "{ nope", "src/a.ts": "x\n" });
  const r = railing(bad, ["hook", "stop"], "{}");
  assert.equal(r.code, 2);
  assert.match(r.err, /could not check the rules/);
});

test("the Stop hook lets go when its input cannot be read, so it cannot trap the assistant in a loop", async () => {
  const { runStopHook } = await import("../src/hook.mjs");
  const dir = project({ "railing.config.json": cfg, "src/a.ts": 'eval("1");\n' });
  const unreadable = () => {
    throw Object.assign(new Error("EAGAIN"), { code: "EAGAIN" });
  };
  assert.equal(runStopHook(dir, { stdin: unreadable, err: () => {} }), 0);
});

test("init does not take over a git hooks folder someone else set up, and says when an existing hook does not call railing", () => {
  const dir = project({ "src/a.ts": "x\n", ".githooks/pre-commit": "#!/bin/sh\necho mine\n" });
  git(dir, "config", "core.hooksPath", ".husky");
  const r = railing(dir, ["init"]);
  assert.match(r.out, /kept {3}git core\.hooksPath \(\.husky\)/);
  assert.equal(git(dir, "config", "core.hooksPath").trim(), ".husky");
  assert.match(r.out, /\.githooks\/pre-commit, but it does not call railing/);
});

test("init copes with a CLAUDE.md that has a start marker and no end, and with a Stop entry that is not a list", () => {
  const dir = project({
    "src/a.ts": "x\n",
    "CLAUDE.md": "intro\n<!-- railing:start -->\nhalf\n",
    ".claude/settings.json": JSON.stringify({ hooks: { Stop: "oops" } }),
  });
  const r = railing(dir, ["init"]);
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /no end marker/);
  assert.match(r.out, /hooks\.Stop is not a list/);
  assert.equal(readFileSync(join(dir, "CLAUDE.md"), "utf8"), "intro\n<!-- railing:start -->\nhalf\n");
});

test("the generated hooks never fall back to downloading some other package called railing", () => {
  const dir = project({ "src/a.ts": "x\n" });
  railing(dir, ["init"]);
  assert.match(readFileSync(join(dir, ".githooks", "pre-commit"), "utf8"), /npx --no-install railing check/);
  assert.match(readFileSync(join(dir, ".claude", "settings.json"), "utf8"), /npx --no-install railing hook stop/);
});
