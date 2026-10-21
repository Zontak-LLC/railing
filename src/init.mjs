import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { CONFIG_FILE } from "./config.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const START = "<!-- railing:start -->";
const END = "<!-- railing:end -->";
const HOOK_CMD = "npx --no-install railing hook stop";

const read = (path) => readFileSync(path, "utf8");
const readJson = (path) => {
  try {
    return JSON.parse(read(path));
  } catch {
    return null;
  }
};

/** Looks at the project and proposes the steps the gate should run. Only commands the project already has. */
export function detectSteps(cwd) {
  const pkg = readJson(join(cwd, "package.json"));
  const scripts = pkg?.scripts ?? {};
  const run = (s) => `npm run ${s}`;
  const steps = [];
  for (const name of ["lint", "typecheck", "test"]) if (scripts[name]) steps.push({ name, run: run(name) });
  if (!scripts.typecheck && existsSync(join(cwd, "tsconfig.json"))) steps.splice(scripts.lint ? 1 : 0, 0, { name: "types", run: "npx tsc --noEmit" });
  return steps;
}

function writeIfAbsent(path, content, log) {
  if (existsSync(path)) return log(`kept   ${path} (already there)`);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
  log(`wrote  ${path}`);
}

/** Adds the Stop hook to .claude/settings.json without touching anything else in it. Idempotent. */
function mergeClaudeSettings(cwd, log) {
  const path = join(cwd, ".claude", "settings.json");
  const settings = existsSync(path) ? readJson(path) : {};
  if (settings === null) return log(`skipped ${path}: it is not valid JSON, fix it and run init again`);
  settings.hooks ??= {};
  settings.hooks.Stop ??= [];
  if (!Array.isArray(settings.hooks.Stop)) return log(`skipped ${path}: hooks.Stop is not a list, fix it and run init again`);
  const commands = settings.hooks.Stop.flatMap((h) => (h?.hooks ?? []).map((x) => String(x?.command ?? "")));
  if (commands.some((c) => /\brailing hook stop\b/.test(c))) return log("kept   Claude Code Stop hook (already there)");
  settings.hooks.Stop.push({ hooks: [{ type: "command", command: `cd "$CLAUDE_PROJECT_DIR" && ${HOOK_CMD}` }] });
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(settings, null, 2)}\n`);
  log("wrote  Claude Code Stop hook in .claude/settings.json");
}

function claudeMdSection(cwd, log) {
  const path = join(cwd, "CLAUDE.md");
  const section = read(join(here, "templates", "claude-section.md")).trimEnd();
  const current = existsSync(path) ? read(path) : "";
  const a = current.indexOf(START);
  const b = current.indexOf(END);
  let next;
  if (a !== -1 && b <= a) return log("skipped CLAUDE.md: it has a railing start marker but no end marker, fix it and run init again");
  if (a !== -1 && b > a) next = `${current.slice(0, a)}${section}${current.slice(b + END.length)}`;
  else next = `${current.trimEnd()}${current ? "\n\n" : ""}${section}\n`;
  if (next === current) return log("kept   CLAUDE.md rules section (up to date)");
  writeFileSync(path, next);
  log(a !== -1 ? "updated CLAUDE.md rules section" : "added  CLAUDE.md rules section");
}

function gitHooks(cwd, log) {
  const files = {
    "pre-commit": "#!/bin/sh\n# Fast checks before a commit. The full gate runs before a push and in CI.\nset -e\nnpx --no-install railing check\n",
    "pre-push": "#!/bin/sh\n# The same gate CI runs.\nset -e\nnpx --no-install railing gate\n",
  };
  for (const [name, body] of Object.entries(files)) {
    const path = join(cwd, ".githooks", name);
    if (existsSync(path)) {
      log(/railing/.test(read(path)) ? `kept   .githooks/${name} (already there)` : `kept   .githooks/${name}, but it does not call railing: add \`npx --no-install railing ${name === "pre-commit" ? "check" : "gate"}\` to it`);
      continue;
    }
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, body);
    chmodSync(path, 0o755);
    log(`wrote  .githooks/${name}`);
  }
  let current = "";
  try {
    current = execFileSync("git", ["config", "--get", "core.hooksPath"], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    // not set (git exits 1), or not a repository: handled below
  }
  if (current && current !== ".githooks") {
    return log(`kept   git core.hooksPath (${current}); add railing to those hooks, or point it at .githooks yourself`);
  }
  try {
    execFileSync("git", ["config", "core.hooksPath", ".githooks"], { cwd, stdio: "ignore" });
    log("set    git core.hooksPath to .githooks (teammates: run that once, or add it to your install step)");
  } catch {
    log("skipped git hooks path: not a git repository");
  }
}

/** The whole setup. Safe to run again: it only adds what is missing and refreshes the marked CLAUDE.md section. */
export function init(cwd, { log = console.log } = {}) {
  const config = {
    include: ["src", "app", "lib", "scripts", "test", "tests", "e2e"].filter((d) => existsSync(join(cwd, d))),
    rules: { "no-ts-ignore": true, "no-double-cast": true, "todo-needs-issue": true, "no-eval": true, "no-focused-tests": true, "max-lines": 300 },
    steps: detectSteps(cwd),
  };
  writeIfAbsent(join(cwd, CONFIG_FILE), `${JSON.stringify(config, null, 2)}\n`, log);
  writeIfAbsent(join(cwd, ".railing", "floors.json"), `${JSON.stringify({ floors: {}, ceilings: {} }, null, 2)}\n`, log);
  mergeClaudeSettings(cwd, log);
  claudeMdSection(cwd, log);
  gitHooks(cwd, log);
  log("\nNext: npx railing gate   (add steps to railing.config.json as the project grows)");
}
