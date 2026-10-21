import { execFileSync } from "node:child_process";
import { join } from "node:path";
import assert from "node:assert/strict";
import { test } from "node:test";

import { commit, git, project, put, railing } from "./helpers.mjs";

const floors = (f = {}, c = {}) => `${JSON.stringify({ floors: f, ceilings: c })}\n`;
const config = (extra = {}) => JSON.stringify({ include: ["src"], ratchet: { base: "main" }, ...extra });

function repoWithBase(f, c) {
  const dir = project({ "railing.config.json": config(), ".railing/floors.json": floors(f, c), "src/a.ts": "export {};\n" });
  commit(dir, "base");
  git(dir, "switch", "-q", "-c", "topic");
  return dir;
}

test("a floor that stays or rises and a ceiling that stays or falls pass", () => {
  const dir = repoWithBase({ coverage: 80 }, { warnings: 5 });
  put(dir, { ".railing/floors.json": floors({ coverage: 85, extra: 1 }, { warnings: 3 }) });
  const r = railing(dir, ["ratchet"]);
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /ratchet ok/);
});

test("a floor going down, a ceiling going up, or either being removed fails", () => {
  const dir = repoWithBase({ coverage: 80, branches: 70 }, { warnings: 5 });
  put(dir, { ".railing/floors.json": floors({ coverage: 79 }, { warnings: 6 }) });
  const r = railing(dir, ["ratchet"]);
  assert.equal(r.code, 1);
  assert.match(r.err, /floor "coverage" went down: 80 to 79/);
  assert.match(r.err, /floor "branches" was removed/);
  assert.match(r.err, /ceiling "warnings" went up: 5 to 6/);
});

test("a missing base is skipped with a note, but fails with --strict", () => {
  const dir = project({ "railing.config.json": config({ ratchet: { base: "origin/main" } }), ".railing/floors.json": floors({ a: 1 }) });
  commit(dir);
  const loose = railing(dir, ["ratchet"]);
  assert.equal(loose.code, 0);
  assert.match(loose.out, /not found/);
  const strict = railing(dir, ["ratchet", "--strict"]);
  assert.equal(strict.code, 1);
  assert.match(strict.err, /not found/);
});

test("a new floors file, no file at all and damaged numbers behave sensibly", () => {
  const fresh = project({ "railing.config.json": config(), "src/a.ts": "x\n" });
  commit(fresh);
  assert.match(railing(fresh, ["ratchet"]).out, /nothing to hold/);
  git(fresh, "switch", "-q", "-c", "topic");
  put(fresh, { ".railing/floors.json": floors({ a: 1 }) });
  assert.match(railing(fresh, ["ratchet"]).out, /is new on this branch/);
  put(fresh, { ".railing/floors.json": JSON.stringify({ floors: { a: "high" } }) });
  assert.match(railing(fresh, ["ratchet"]).err, /must be a number/);
});

test("the gate runs rules, then the ratchet, then each step, and stops at the first failure", () => {
  const dir = project({
    "railing.config.json": config({
      steps: [
        { name: "one", run: "node -e \"console.log('step one ran')\"" },
        { name: "two", run: 'node -e "process.exit(3)"' },
        { name: "three", run: "node -e \"console.log('step three ran')\"" },
      ],
    }),
    "src/a.ts": "export {};\n",
  });
  const r = railing(dir, ["gate"]);
  assert.equal(r.code, 3);
  assert.match(r.out, /rules ok/);
  assert.match(r.out, /step one ran/);
  assert.match(r.err, /step "two" failed/);
  assert.ok(!r.out.includes("step three ran"));
});

test("the gate does not run the steps when a rule fails", () => {
  const dir = project({
    "railing.config.json": config({ steps: [{ name: "one", run: "node -e \"console.log('step one ran')\"" }] }),
    "src/a.ts": 'eval("1");\n',
  });
  const r = railing(dir, ["gate"]);
  assert.equal(r.code, 1);
  assert.ok(!r.out.includes("step one ran"));
});

test("a passing gate says so", () => {
  const dir = project({ "railing.config.json": config(), "src/a.ts": "export {};\n" });
  const r = railing(dir, ["gate"]);
  assert.equal(r.code, 0);
  assert.match(r.out, /gate passed/);
});

test("deleting the floors file does not get round the ratchet", () => {
  const dir = repoWithBase({ coverage: 80 });
  put(dir, {});
  execFileSync("rm", [join(dir, ".railing", "floors.json")]);
  const r = railing(dir, ["ratchet"]);
  assert.equal(r.code, 1);
  assert.match(r.err, /was deleted/);
});

test("the ratchet works from a sub-folder of the repository", () => {
  const dir = project({
    "pkg/railing.config.json": config(),
    "pkg/.railing/floors.json": floors({ coverage: 80 }),
    "pkg/src/a.ts": "export {};\n",
  });
  commit(dir, "base");
  git(dir, "switch", "-q", "-c", "topic");
  put(dir, { "pkg/.railing/floors.json": floors({ coverage: 70 }) });
  const r = railing(join(dir, "pkg"), ["ratchet"]);
  assert.equal(r.code, 1, r.out + r.err);
  assert.match(r.err, /went down: 80 to 70/);
});

test("a gate that matched no files warns, and fails with --strict", () => {
  const dir = project({ "railing.config.json": JSON.stringify({ include: ["./src"], ratchet: { base: "main" } }), "src/a.ts": "export {};\n" });
  const loose = railing(dir, ["gate"]);
  assert.equal(loose.code, 0);
  assert.match(loose.err, /nothing was checked/);
  const strict = railing(dir, ["gate", "--strict"]);
  assert.equal(strict.code, 1);
  const check = railing(dir, ["check", "--strict"]);
  assert.equal(check.code, 1);
});

test("an unknown option is refused, not ignored", () => {
  const dir = project({ "railing.config.json": config(), "src/a.ts": "x\n" });
  const r = railing(dir, ["gate", "--stict"]);
  assert.equal(r.code, 1);
  assert.match(r.err, /Unknown option --stict/);
});
